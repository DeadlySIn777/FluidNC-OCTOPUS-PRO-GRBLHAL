/*
 * Chatter Detection System v4.0 - ADAPTIVE
 * For Waveshare ESP32-S3-Touch-LCD-1.46B
 * 
 * Features:
 * - SELF-CALIBRATING baseline (learns YOUR machine's normal noise)
 * - ADAPTIVE frequency bands (tracks spindle speed)
 * - MACHINE LEARNING from past chatter events
 * - STATISTICAL anomaly detection (z-score, not fixed thresholds)
 * - LEARNS what feed reductions work
 * - PERSISTENT memory (survives power cycles)
 * 
 * Hardware:
 * - ESP32-S3R8 @ 240MHz
 * - 16MB Flash, 8MB PSRAM
 * - 1.46" 412x412 IPS LCD (SPD2010 QSPI)
 * - QMI8658C IMU (I2C)
 * - PDM Microphone
 */

#include <Arduino.h>
#include <Wire.h>
#include <driver/i2s.h>
#include "arduinoFFT.h"
#include "display_ui.h"
#include "adaptive_chatter.h"
#include <OneWire.h>
#include <DallasTemperature.h>

// ============================================================================
// Pin Definitions (from Waveshare schematic)
// ============================================================================

// Display (QSPI - SPD2010)
#define LCD_CS      9
#define LCD_CLK     10
#define LCD_D0      11
#define LCD_D1      12
#define LCD_D2      13
#define LCD_D3      14
#define LCD_RST     3
#define LCD_BL      46

// Touch & IMU (shared I2C bus)
#define I2C_SDA     39
#define I2C_SCL     40
#define TOUCH_INT   38
#define IMU_INT1    4
#define IMU_INT2    5

// PDM Microphone
#define PDM_CLK     41
#define PDM_DATA    42

// Speaker (I2S - PCM5101)
#define I2S_BCLK    17
#define I2S_LRCK    18
#define I2S_DOUT    8

// SD Card
#define SD_CS       21
#define SD_CLK      47
#define SD_MOSI     48
#define SD_MISO     45

// Battery ADC
#define BAT_ADC     7

// Buttons
#define BOOT_BTN    0

// DS18B20 Temperature Sensor (for spindle shell temperature)
#define DS18B20_PIN 16  // GPIO 16 - requires 4.7k pull-up to 3.3V

// ============================================================================
// QMI8658C IMU Registers
// ============================================================================

#define QMI8658_ADDR        0x6B  // or 0x6A depending on SA0 pin
#define QMI8658_WHO_AM_I    0x00  // Should return 0x05
#define QMI8658_CTRL1       0x02  // Sensor enable
#define QMI8658_CTRL2       0x03  // Accelerometer settings
#define QMI8658_CTRL3       0x04  // Gyroscope settings
#define QMI8658_CTRL5       0x06  // Low power mode
#define QMI8658_CTRL7       0x08  // Enable sensors
#define QMI8658_AX_L        0x35  // Accel X low byte
#define QMI8658_GX_L        0x3B  // Gyro X low byte

// ============================================================================
// FFT Configuration
// ============================================================================

#define SAMPLES         1024      // FFT samples (power of 2)
#define SAMPLING_FREQ   16000     // 16kHz sampling rate
#define MIC_I2S_PORT    I2S_NUM_0

// Chatter detection frequency bands (Hz)
#define CHATTER_LOW_HZ      800   // Low end of chatter range
#define CHATTER_HIGH_HZ     4000  // High end of chatter range
#define CHATTER_THRESHOLD   2000  // Magnitude threshold for chatter

// Vibration detection thresholds
#define VIBRATION_THRESHOLD 1.5   // G-force threshold
#define GYRO_THRESHOLD      100   // deg/s threshold

// ============================================================================
// Global Variables
// ============================================================================

// FFT
double vReal[SAMPLES];
double vImag[SAMPLES];
ArduinoFFT<double> FFT = ArduinoFFT<double>(vReal, vImag, SAMPLES, SAMPLING_FREQ);

// ADAPTIVE CHATTER DETECTOR
AdaptiveChatterDetector chatterDetector;

// DS18B20 Temperature Sensor
OneWire oneWire(DS18B20_PIN);
DallasTemperature tempSensors(&oneWire);
float spindleTempC = -127.0;  // -127 = no sensor found
bool tempSensorFound = false;
unsigned long lastTempRead = 0;
const unsigned long TEMP_READ_INTERVAL = 1000;  // Read temp every 1 second

// IMU data
float accelX, accelY, accelZ;
float gyroX, gyroY, gyroZ;
float vibrationMagnitude;

// Microphone data
int32_t micBuffer[SAMPLES];

// Chatter detection state
enum ChatterState {
    STATE_OK,
    STATE_WARNING,
    STATE_CHATTER
};

ChatterState currentState = STATE_OK;
ChatterState previousState = STATE_OK;

// Detection metrics
float micChatterScore = 0;
float imuChatterScore = 0;
float fusedChatterScore = 0;
float dominantFrequency = 0;
float chatterHistory[10] = {0};
int historyIndex = 0;

// Timing
unsigned long lastUpdate = 0;
unsigned long lastDisplayUpdate = 0;
const unsigned long UPDATE_INTERVAL = 50;      // 20Hz sensor update
const unsigned long DISPLAY_INTERVAL = 100;    // 10Hz display update

// ============================================================================
// I2C Helper Functions
// ============================================================================

void i2cWriteByte(uint8_t addr, uint8_t reg, uint8_t value) {
    Wire.beginTransmission(addr);
    Wire.write(reg);
    Wire.write(value);
    Wire.endTransmission();
}

uint8_t i2cReadByte(uint8_t addr, uint8_t reg) {
    Wire.beginTransmission(addr);
    Wire.write(reg);
    Wire.endTransmission(false);
    Wire.requestFrom(addr, (uint8_t)1);
    return Wire.read();
}

void i2cReadBytes(uint8_t addr, uint8_t reg, uint8_t* buffer, uint8_t len) {
    Wire.beginTransmission(addr);
    Wire.write(reg);
    Wire.endTransmission(false);
    Wire.requestFrom(addr, len);
    for (int i = 0; i < len && Wire.available(); i++) {
        buffer[i] = Wire.read();
    }
}

// ============================================================================
// QMI8658C IMU Functions
// ============================================================================

bool initIMU() {
    Serial.println("[IMU] Initializing QMI8658C...");
    
    // Check WHO_AM_I
    uint8_t whoami = i2cReadByte(QMI8658_ADDR, QMI8658_WHO_AM_I);
    Serial.printf("[IMU] WHO_AM_I: 0x%02X (expected 0x05)\n", whoami);
    
    if (whoami != 0x05) {
        // Try alternate address
        whoami = i2cReadByte(0x6A, QMI8658_WHO_AM_I);
        if (whoami == 0x05) {
            Serial.println("[IMU] Found at alternate address 0x6A");
        } else {
            Serial.println("[IMU] ERROR: QMI8658C not found!");
            return false;
        }
    }
    
    // Reset
    i2cWriteByte(QMI8658_ADDR, 0x60, 0xB0);  // Soft reset
    delay(50);
    
    // Configure accelerometer: ±8g, 500Hz ODR
    i2cWriteByte(QMI8658_ADDR, QMI8658_CTRL2, 0x25);
    
    // Configure gyroscope: ±2048 dps, 500Hz ODR
    i2cWriteByte(QMI8658_ADDR, QMI8658_CTRL3, 0x65);
    
    // Enable accelerometer and gyroscope
    i2cWriteByte(QMI8658_ADDR, QMI8658_CTRL7, 0x03);
    
    Serial.println("[IMU] QMI8658C initialized successfully");
    return true;
}

void readIMU() {
    uint8_t buffer[12];
    
    // Read 6 bytes of accelerometer data
    i2cReadBytes(QMI8658_ADDR, QMI8658_AX_L, buffer, 6);
    
    int16_t ax = (buffer[1] << 8) | buffer[0];
    int16_t ay = (buffer[3] << 8) | buffer[2];
    int16_t az = (buffer[5] << 8) | buffer[4];
    
    // Convert to g (±8g range, 16-bit signed)
    accelX = ax / 4096.0;
    accelY = ay / 4096.0;
    accelZ = az / 4096.0;
    
    // Read 6 bytes of gyroscope data
    i2cReadBytes(QMI8658_ADDR, QMI8658_GX_L, buffer, 6);
    
    int16_t gx = (buffer[1] << 8) | buffer[0];
    int16_t gy = (buffer[3] << 8) | buffer[2];
    int16_t gz = (buffer[5] << 8) | buffer[4];
    
    // Convert to dps (±2048 dps range, 16-bit signed)
    gyroX = gx / 16.0;
    gyroY = gy / 16.0;
    gyroZ = gz / 16.0;
    
    // Calculate vibration magnitude (deviation from 1g at rest)
    float totalAccel = sqrt(accelX*accelX + accelY*accelY + accelZ*accelZ);
    vibrationMagnitude = abs(totalAccel - 1.0);  // Deviation from gravity
}

// ============================================================================
// PDM Microphone Functions
// ============================================================================

bool initMicrophone() {
    Serial.println("[MIC] Initializing PDM microphone...");
    
    // Configure I2S for PDM input
    i2s_config_t i2s_config = {
        .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX | I2S_MODE_PDM),
        .sample_rate = SAMPLING_FREQ,
        .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
        .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
        .communication_format = I2S_COMM_FORMAT_STAND_I2S,
        .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
        .dma_buf_count = 8,
        .dma_buf_len = 256,
        .use_apll = false,
        .tx_desc_auto_clear = false,
        .fixed_mclk = 0
    };
    
    i2s_pin_config_t pin_config = {
        .bck_io_num = I2S_PIN_NO_CHANGE,
        .ws_io_num = PDM_CLK,
        .data_out_num = I2S_PIN_NO_CHANGE,
        .data_in_num = PDM_DATA
    };
    
    esp_err_t err = i2s_driver_install(MIC_I2S_PORT, &i2s_config, 0, NULL);
    if (err != ESP_OK) {
        Serial.printf("[MIC] I2S driver install failed: %d\n", err);
        return false;
    }
    
    err = i2s_set_pin(MIC_I2S_PORT, &pin_config);
    if (err != ESP_OK) {
        Serial.printf("[MIC] I2S set pin failed: %d\n", err);
        return false;
    }
    
    Serial.println("[MIC] PDM microphone initialized");
    return true;
}

void readMicrophone() {
    size_t bytesRead = 0;
    // CRITICAL SAFETY: Use timeout instead of infinite wait!
    // portMAX_DELAY would block forever if microphone fails
    esp_err_t err = i2s_read(MIC_I2S_PORT, micBuffer, SAMPLES * sizeof(int32_t), 
                              &bytesRead, pdMS_TO_TICKS(200));
    
    // Handle read failure gracefully
    if (err != ESP_OK || bytesRead < SAMPLES * sizeof(int32_t)) {
        // Zero-fill buffer to prevent processing garbage data
        memset(micBuffer, 0, sizeof(micBuffer));
        memset(vReal, 0, sizeof(vReal));
        memset(vImag, 0, sizeof(vImag));
        Serial.println("[MIC] Read timeout or error - using zero data");
        return;
    }
    
    // Convert to double for FFT and apply window
    for (int i = 0; i < SAMPLES; i++) {
        vReal[i] = (double)(micBuffer[i] >> 14);  // Normalize
        vImag[i] = 0;
    }
}

// ============================================================================
// FFT Analysis
// ============================================================================

void analyzeAudio() {
    // Apply Hamming window
    FFT.windowing(FFT_WIN_TYP_HAMMING, FFT_FORWARD);
    
    // Compute FFT
    FFT.compute(FFT_FORWARD);
    
    // Compute magnitudes
    FFT.complexToMagnitude();
    
    // Find chatter frequencies
    float chatterEnergy = 0;
    float totalEnergy = 0;
    float maxMagnitude = 0;
    int maxBin = 0;
    
    float binWidth = (float)SAMPLING_FREQ / SAMPLES;
    int lowBin = CHATTER_LOW_HZ / binWidth;
    int highBin = CHATTER_HIGH_HZ / binWidth;
    
    for (int i = 2; i < SAMPLES / 2; i++) {
        float freq = i * binWidth;
        float magnitude = vReal[i];
        
        totalEnergy += magnitude;
        
        // Check if in chatter frequency range
        if (i >= lowBin && i <= highBin) {
            chatterEnergy += magnitude;
            
            if (magnitude > maxMagnitude) {
                maxMagnitude = magnitude;
                maxBin = i;
            }
        }
    }
    
    dominantFrequency = maxBin * binWidth;
    
    // Calculate chatter score (0-100)
    if (totalEnergy > 0) {
        micChatterScore = (chatterEnergy / totalEnergy) * 100.0;
        if (maxMagnitude > CHATTER_THRESHOLD) {
            micChatterScore += 20;  // Boost if strong peak detected
        }
    }
    
    // Clamp to 0-100
    micChatterScore = constrain(micChatterScore, 0, 100);
}

// ============================================================================
// Sensor Fusion (now using Adaptive Detector)
// ============================================================================

void fuseSensors() {
    // Feed FFT magnitudes and vibration to adaptive detector
    chatterDetector.update(vReal, SAMPLES, vibrationMagnitude);
    
    // Get adaptive status
    auto status = chatterDetector.getStatus();
    
    // Map to legacy variables for display compatibility
    fusedChatterScore = status.score;
    micChatterScore = status.score;  // Display uses these
    imuChatterScore = status.vibrationG * 20;  // Scale for display
    dominantFrequency = status.dominantFreq;
    
    // Map state
    if (status.state == AdaptiveChatterDetector::CHATTER) {
        currentState = STATE_CHATTER;
    } else if (status.state == AdaptiveChatterDetector::WARNING) {
        currentState = STATE_WARNING;
    } else if (status.state == AdaptiveChatterDetector::CALIBRATING) {
        currentState = STATE_OK;  // Show OK while calibrating
    } else {
        currentState = STATE_OK;
    }
}

// ============================================================================
// Display Functions
// ============================================================================

ChatterDisplay display;

void initDisplay() {
    Serial.println("[DISPLAY] Initializing 412x412 IPS LCD...");
    
    if (!display.begin()) {
        Serial.println("[DISPLAY] ERROR: Display init failed!");
    } else {
        Serial.println("[DISPLAY] Display initialized successfully");
    }
}

void updateDisplay() {
    auto status = chatterDetector.getStatus();
    
    const char* stateStr = (status.state == AdaptiveChatterDetector::CALIBRATING) ? "calibrating" :
                           (status.state == AdaptiveChatterDetector::CHATTER) ? "chatter" :
                           (status.state == AdaptiveChatterDetector::WARNING) ? "warning" :
                           (status.state == AdaptiveChatterDetector::RECOVERING) ? "recovering" : "ok";
    
    display.update(
        status.score,
        status.confidence,        // Show confidence instead of mic score
        status.calibrationPct,    // Show calibration progress
        status.dominantFreq,
        status.vibrationG,
        stateStr
    );
    
    // Debug output to serial
    static unsigned long lastPrint = 0;
    if (millis() - lastPrint > 1000) {
        lastPrint = millis();
        
        Serial.printf("\n=== CHATTER v4.0 ADAPTIVE ===\n");
        Serial.printf("State: %s | Confidence: %.0f%%\n", stateStr, status.confidence);
        Serial.printf("Score: %.1f%% | Freq: %.0f Hz | Vib: %.3f g\n", 
                      status.score, status.dominantFreq, status.vibrationG);
        Serial.printf("Calibration: %d%% | Learned Events: %d\n", 
                      status.calibrationPct, status.learnedEvents);
        if (status.suggestedFeedPct < 100) {
            Serial.printf(">>> Suggested Feed: %.0f%%\n", status.suggestedFeedPct);
        }
        Serial.printf("FPS: %.0f\n", display.getFPS());
    }
}

// ============================================================================
// Serial Communication (for FluidCNC integration)
// ============================================================================

void sendChatterStatus() {
    auto status = chatterDetector.getStatus();
    
    // Send JSON status over serial for FluidCNC web UI
    // Now includes adaptive learning info AND spindle temperature!
    Serial.printf("{\"chatter\":{\"state\":\"%s\",\"score\":%.1f,\"freq\":%.0f,\"vib\":%.3f,"
                  "\"conf\":%.0f,\"cal\":%d,\"learned\":%d,\"feed\":%.0f,\"spindleTempC\":%.1f}}\n",
        status.state == AdaptiveChatterDetector::CALIBRATING ? "calibrating" :
        status.state == AdaptiveChatterDetector::CHATTER ? "chatter" :
        status.state == AdaptiveChatterDetector::WARNING ? "warning" :
        status.state == AdaptiveChatterDetector::RECOVERING ? "recovering" : "ok",
        status.score,
        status.dominantFreq,
        status.vibrationG,
        status.confidence,
        status.calibrationPct,
        status.learnedEvents,
        status.suggestedFeedPct,
        spindleTempC
    );
}

void handleSerialCommands() {
    if (Serial.available()) {
        String cmd = Serial.readStringUntil('\n');
        cmd.trim();
        
        if (cmd == "CAL" || cmd == "CALIBRATE") {
            chatterDetector.startCalibration();
            Serial.println("{\"response\":\"calibration_started\"}");
        }
        else if (cmd == "RESOLVED") {
            chatterDetector.confirmChatterResolved();
            Serial.println("{\"response\":\"learned_success\"}");
        }
        else if (cmd.startsWith("RPM:")) {
            float rpm = cmd.substring(4).toFloat();
            chatterDetector.setSpindleRPM(rpm);
        }
        else if (cmd.startsWith("FEED:")) {
            float feed = cmd.substring(5).toFloat();
            chatterDetector.setFeedRate(feed);
        }
        else if (cmd.startsWith("TOOL:")) {
            // TOOL:teeth,diameter e.g., TOOL:4,6.0
            int comma = cmd.indexOf(',', 5);
            if (comma > 0) {
                int teeth = cmd.substring(5, comma).toInt();
                float diameter = cmd.substring(comma + 1).toFloat();
                chatterDetector.setToolParams(teeth, diameter);
                Serial.printf("{\"response\":\"tool_set\",\"teeth\":%d,\"diameter\":%.1f}\n", teeth, diameter);
            }
        }
        else if (cmd.startsWith("SG:")) {
            // StallGuard data from grblHAL: SG:axis,value e.g., SG:0,245
            // This comes from TMC2209 UART if enabled
            int comma = cmd.indexOf(',', 3);
            if (comma > 0) {
                int axis = cmd.substring(3, comma).toInt();
                uint16_t sg = cmd.substring(comma + 1).toInt();
                chatterDetector.pushStallGuard(axis, sg);
            }
        }
        else if (cmd == "INFO") {
            auto s = chatterDetector.getStatus();
            Serial.printf("{\"info\":{\"version\":\"4.2-temp-sensor\",\"calibrated\":%s,"
                         "\"learnedEvents\":%d,\"confidence\":%.0f,\"harmonics\":%.2f,"
                         "\"stallguard\":%.2f,\"engaged\":%s,\"tempSensor\":%s,\"spindleTempC\":%.1f}}\n",
                         s.calibrationPct >= 100 ? "true" : "false",
                         s.learnedEvents, s.confidence, s.harmonicStrength,
                         s.stallGuardScore, s.isEngaged ? "true" : "false",
                         tempSensorFound ? "true" : "false", spindleTempC);
        }
        else if (cmd == "TEMP") {
            // Request current spindle temperature
            Serial.printf("{\"temp\":{\"spindleTempC\":%.1f,\"sensor\":%s}}\n",
                         spindleTempC, tempSensorFound ? "true" : "false");
        }
    }
}

// ============================================================================
// Setup
// ============================================================================

void setup() {
    Serial.begin(115200);
    delay(1000);
    
    Serial.println("\n========================================");
    Serial.println("  Chatter Detection System v4.2");
    Serial.println("  ADAPTIVE + ADVANCED DSP + TEMP");
    Serial.println("  Waveshare ESP32-S3-Touch-LCD-1.46B");
    Serial.println("========================================");
    Serial.println("  Features:");
    Serial.println("  - Self-calibrating baseline");
    Serial.println("  - Stability lobe prediction");
    Serial.println("  - Harmonic series detection");
    Serial.println("  - Cross-sensor correlation");
    Serial.println("  - TMC2209 StallGuard support");
    Serial.println("  - Persistent learning memory");
    Serial.println("  - DS18B20 spindle temp sensor");
    Serial.println("========================================\n");
    
    // Initialize I2C for IMU and touch
    Wire.begin(I2C_SDA, I2C_SCL);
    Wire.setClock(400000);  // 400kHz
    
    // Initialize display first (visual feedback)
    initDisplay();
    
    // Initialize sensors
    if (!initIMU()) {
        Serial.println("[ERROR] IMU initialization failed!");
    }
    
    if (!initMicrophone()) {
        Serial.println("[ERROR] Microphone initialization failed!");
    }
    
    // Initialize ADAPTIVE chatter detector
    chatterDetector.init(SAMPLING_FREQ, SAMPLES);
    
    // Initialize DS18B20 temperature sensor
    Serial.println("[TEMP] Initializing DS18B20 on GPIO 16...");
    tempSensors.begin();
    int deviceCount = tempSensors.getDeviceCount();
    if (deviceCount > 0) {
        tempSensorFound = true;
        tempSensors.setResolution(12);  // 12-bit = 0.0625°C resolution
        tempSensors.setWaitForConversion(false);  // Non-blocking reads
        tempSensors.requestTemperatures();  // Start first conversion
        Serial.printf("[TEMP] Found %d DS18B20 sensor(s)\n", deviceCount);
    } else {
        Serial.println("[TEMP] No DS18B20 sensor found on GPIO 16");
        Serial.println("[TEMP] Wiring: DATA -> GPIO 16 + 4.7kΩ pull-up to 3.3V");
    }
    
    Serial.println("\n[SYSTEM] Initialization complete!");
    Serial.println("[SYSTEM] Auto-calibrating baseline (keep machine idle for 5 sec)...\n");
}

// ============================================================================
// Main Loop
// ============================================================================

void loop() {
    unsigned long now = millis();
    
    // Handle serial commands (CAL, RESOLVED, RPM:xxx, FEED:xxx)
    handleSerialCommands();
    
    // Sensor update at 20Hz
    if (now - lastUpdate >= UPDATE_INTERVAL) {
        lastUpdate = now;
        
        // Read sensors
        readIMU();
        readMicrophone();
        
        // Analyze audio (FFT)
        analyzeAudio();
        
        // Feed to adaptive detector
        fuseSensors();
        
        // Read DS18B20 temperature (non-blocking)
        if (tempSensorFound && (now - lastTempRead >= TEMP_READ_INTERVAL)) {
            lastTempRead = now;
            float temp = tempSensors.getTempCByIndex(0);
            if (temp != DEVICE_DISCONNECTED_C) {
                spindleTempC = temp;
            }
            tempSensors.requestTemperatures();  // Start next conversion
        }
        
        // Send status on state change OR every 500ms
        static unsigned long lastSend = 0;
        if (currentState != previousState || (now - lastSend > 500)) {
            sendChatterStatus();
            lastSend = now;
            previousState = currentState;
        }
    }
    
    // Display update at 10Hz
    if (now - lastDisplayUpdate >= DISPLAY_INTERVAL) {
        lastDisplayUpdate = now;
        updateDisplay();
    }
    
    // Small delay to prevent watchdog
    delay(1);
}
