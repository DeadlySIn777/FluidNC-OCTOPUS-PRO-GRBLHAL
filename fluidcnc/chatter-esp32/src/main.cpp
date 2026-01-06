/**
 * CNC Chatter Detection System - ESP32 DevKit 38-pin
 * 
 * Triple Sensor Fusion:
 *   - MPU-6050 accelerometer (I2C) - mechanical vibration
 *   - INMP441 I2S microphone - acoustic chatter
 *   - ACS712 current sensor (e.g., ACS712T ELC-30A) - spindle load
 * 
 * Sends real-time feed override commands to grblHAL via UART
 * Serves WebSocket data to FluidCNC web UI
 * 
 * FEATURES:
 *   - Material-aware detection (7 profiles)
 *   - Persistent settings (survives reboot)
 *   - OTA firmware updates
 *   - mDNS discovery (chatter.local)
 *   - Auto-calibration
 *   - Spindle state detection
 *   - 1.28" Round TFT Display (GC9A01 240x240)
 */

#include <Arduino.h>
#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <MPU6050.h>
#include <arduinoFFT.h>
#include <driver/i2s.h>
#include <Preferences.h>      // For persistent settings
#include <ESPmDNS.h>          // For mDNS (chatter.local)
#include <ArduinoOTA.h>       // For IDE OTA updates
#include <Update.h>           // For web-based OTA updates
#include <TFT_eSPI.h>         // For GC9A01 round TFT display
#include <esp_task_wdt.h>     // Watchdog timer
#include "vfd_modbus.h"       // VFD telemetry via RS-485 Modbus

// Watchdog timeout (seconds) - reboot if loop hangs
#define WDT_TIMEOUT 10

// Preferences for persistent storage
Preferences prefs;

// VFD Modbus telemetry (optional, enable if RS-485 wired)
VFDModbus vfd;

// ============================================================================
// SYSTEM HEALTH MONITORING
// ============================================================================

// Sensor error codes (for troubleshooting)
enum SensorError {
    SENSOR_OK = 0,
    SENSOR_NOT_FOUND = 1,
    SENSOR_TIMEOUT = 2,
    SENSOR_INVALID_DATA = 3,
    SENSOR_STUCK = 4,        // Same value for too long
    SENSOR_OUT_OF_RANGE = 5
};

const char* getSensorErrorString(SensorError err) {
    switch(err) {
        case SENSOR_OK: return "OK";
        case SENSOR_NOT_FOUND: return "Not found - check wiring";
        case SENSOR_TIMEOUT: return "Timeout - no response";
        case SENSOR_INVALID_DATA: return "Invalid data received";
        case SENSOR_STUCK: return "Stuck - same value too long";
        case SENSOR_OUT_OF_RANGE: return "Out of range";
        default: return "Unknown error";
    }
}

struct SystemHealth {
    // Sensor status
    bool mpuOk = false;
    bool i2sOk = false;
    bool adcOk = false;
    bool wifiOk = false;
    bool vfdOk = false;
    
    // Error codes (0 = OK)
    SensorError mpuError = SENSOR_NOT_FOUND;
    SensorError i2sError = SENSOR_NOT_FOUND;
    SensorError adcError = SENSOR_NOT_FOUND;
    SensorError vfdError = SENSOR_NOT_FOUND;
    
    // Last read timestamps (for timeout detection)
    unsigned long lastMpuRead = 0;
    unsigned long lastI2sRead = 0;
    unsigned long lastAdcRead = 0;
    unsigned long lastWifiCheck = 0;
    
    // Stuck detection (last values)
    float lastMpuValue = 0;
    int mpuStuckCount = 0;
    float lastI2sValue = 0;
    int i2sStuckCount = 0;
    float lastAdcValue = 0;
    int adcStuckCount = 0;
    
    // WiFi
    int wifiReconnectAttempts = 0;
    
    // System stats
    unsigned long uptime = 0;
    float cpuTemp = 0;
    uint32_t freeHeap = 0;
    uint32_t minFreeHeap = UINT32_MAX;
    unsigned long loopCount = 0;
    float loopsPerSecond = 0;
} health;

// Check if a sensor value is stuck (same value for too many reads)
bool checkSensorStuck(float current, float& last, int& stuckCount, float tolerance = 0.001f) {
    if (abs(current - last) < tolerance) {
        stuckCount++;
        if (stuckCount > 100) {  // ~5 seconds at 20Hz
            return true;  // Stuck!
        }
    } else {
        stuckCount = 0;
    }
    last = current;
    return false;
}

// ============================================================================
// TFT DISPLAY CONFIGURATION - 1.28" Round GC9A01 240x240
// ============================================================================
// Pin definitions (directly in code, or override in User_Setup.h)
// DC  = GPIO 2
// CS  = GPIO 15
// SCK = GPIO 18
// SDA = GPIO 23
// RST = GPIO 4
// BL  = GPIO 5 (backlight)

#ifndef TFT_BL
#define TFT_BL 5              // Backlight pin
#endif

#ifndef TFT_WIDTH
#define TFT_WIDTH 240
#endif

#ifndef TFT_HEIGHT
#define TFT_HEIGHT 240
#endif
#define TFT_CENTER_X 120
#define TFT_CENTER_Y 120
#define TFT_RADIUS 118        // Usable radius (slightly less than 120 for border)

// Beautiful color scheme matching FluidCNC UI
#define COLOR_BG          0x0A12      // Dark blue background (#1a1a2e)
#define COLOR_BG_DARK     0x0810      // Darker variant (#16213e)
#define COLOR_GREEN       0x27E9      // Success green (#44ff44)
#define COLOR_YELLOW      0xFE40      // Warning yellow (#ffc800)
#define COLOR_RED         0xF886      // Danger red (#ff4444)
#define COLOR_BLUE        0x033F      // Accent blue (#0066ff)
#define COLOR_ORANGE      0xFBC0      // Orange (#ff6b35)
#define COLOR_WHITE       0xFFFF
#define COLOR_GRAY        0x7BEF      // Light gray
#define COLOR_DARK_GRAY   0x4208      // Dark gray

// TFT object
TFT_eSPI tft = TFT_eSPI();
TFT_eSprite sprite = TFT_eSprite(&tft);  // Sprite for smooth updates
bool spriteReady = false;

void readCurrentSamples();

// Display state
struct DisplayState {
    float lastScore = -1;
    int lastFeed = -1;
    bool lastChatter = false;
    bool lastConnected = false;
    bool lastCutting = false;
    String lastMaterial = "";
    unsigned long lastFullRedraw = 0;
    bool needsFullRedraw = true;
} displayState;

// ============================================================================
// CONFIGURATION - ADJUST FOR YOUR MACHINE
// ============================================================================

// WiFi credentials (set via AP mode portal if not configured)
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// Access Point mode (fallback hotspot for setup)
const char* AP_SSID = "ChatterDetect";
const char* AP_PASS = "chatter123";  // Min 8 chars, or empty for open
const IPAddress AP_IP(192, 168, 4, 1);
const IPAddress AP_GATEWAY(192, 168, 4, 1);
const IPAddress AP_SUBNET(255, 255, 255, 0);

// mDNS hostname (access via http://chatter.local)
const char* MDNS_HOSTNAME = "chatter";

// AP mode state
bool apModeActive = false;
String configuredSSID = "";
String configuredPass = "";

// ============================================================================
// MATERIAL PROFILES - THIS MATTERS FOR MINI MILLS!
// ============================================================================
// Different materials chatter at different frequencies and amplitudes
// Mini mills are less rigid, so these are tuned for that

struct MaterialProfile {
    const char* name;
    
    // Frequency ranges where chatter typically occurs (Hz)
    int audioFreqLow;
    int audioFreqHigh;
    int accelFreqLow;
    int accelFreqHigh;
    
    // Detection sensitivity (lower = more sensitive)
    float chatterThreshold;
    float recoveryThreshold;
    
    // Sensor weights (which sensor matters more for this material)
    float weightAudio;
    float weightAccel;
    float weightCurrent;
    
    // Feed adjustment behavior
    int minFeed;           // Never go below this %
    int feedDecreaseStep;  // How much to reduce on chatter
    int feedIncreaseStep;  // How much to recover
    
    // Expected current draw range (helps detect issues)
    float typicalAmpsLow;
    float typicalAmpsHigh;
};

// Material profiles for mini mill
const MaterialProfile PROFILES[] = {
    // ALUMINUM - High pitch chatter, current spikes
    {
        "aluminum",
        800, 4000,    // Audio: 800-4000 Hz (high pitch squeal)
        100, 400,     // Accel: 100-400 Hz
        0.45f, 0.20f, // Lower threshold - Al chatters easily on mini mills
        0.25f, 0.35f, 0.40f,  // Current matters more (gummy chips load spindle)
        30, 15, 3,    // Aggressive reduction, slow recovery
        2.0f, 8.0f    // Typical current range
    },
    // STEEL / STAINLESS - Lower frequency, high forces
    {
        "steel",
        400, 2500,    // Audio: 400-2500 Hz (growling)
        50, 300,      // Accel: lower frequency vibration
        0.50f, 0.25f, // Medium threshold
        0.30f, 0.40f, 0.30f,  // Accel matters more (vibration)
        35, 10, 2,    // Conservative - steel is hard on mini mills
        3.0f, 12.0f   // Higher current expected
    },
    // PLASTIC / DELRIN / HDPE
    {
        "plastic",
        600, 3000,    // Audio: medium range
        80, 350,      // Accel
        0.60f, 0.30f, // Higher threshold - plastics are forgiving
        0.40f, 0.35f, 0.25f,  // Audio matters (melting sounds)
        25, 10, 5,    // Can recover faster
        1.0f, 4.0f    // Low current
    },
    // WOOD / MDF
    {
        "wood",
        500, 2500,    // Audio
        60, 300,      // Accel
        0.65f, 0.35f, // High threshold - wood is very forgiving
        0.45f, 0.30f, 0.25f,  // Audio matters (burning smell = too slow)
        20, 8, 8,     // Fast recovery OK
        0.5f, 3.0f    // Very low current
    },
    // BRASS / BRONZE
    {
        "brass",
        700, 3500,    // Audio
        90, 380,      // Accel
        0.50f, 0.25f, // Medium threshold
        0.30f, 0.35f, 0.35f,  // Balanced
        30, 12, 4,    // Medium response
        2.5f, 7.0f    // Medium current
    },
    // CARBON FIBER / G10 / FR4
    {
        "composite",
        1000, 5000,   // Audio: high pitch
        150, 500,     // Accel: higher freq
        0.40f, 0.15f, // Very sensitive - composites delaminate!
        0.35f, 0.40f, 0.25f,  // Accel critical (delamination vibration)
        40, 20, 2,    // Very aggressive reduction
        1.5f, 5.0f    // Low-medium current
    },
    // COPPER
    {
        "copper",
        600, 3000,    // Audio
        80, 350,      // Accel
        0.55f, 0.28f, // Medium-high threshold
        0.25f, 0.35f, 0.40f,  // Current matters (gummy like Al)
        30, 12, 4,    // Medium response
        2.0f, 7.0f    // Medium current
    }
};

const int NUM_PROFILES = sizeof(PROFILES) / sizeof(PROFILES[0]);
int currentProfileIndex = 0;  // Default to aluminum

// Operation type affects behavior
enum OperationType {
    OP_ROUGHING = 0,    // Heavy cuts, more chatter tolerance
    OP_FINISHING = 1,   // Light cuts, less tolerance (surface finish matters)
    OP_DRILLING = 2,    // Different vibration pattern
    OP_SLOTTING = 3     // Full width cuts, high chatter risk
};
OperationType currentOperation = OP_ROUGHING;

// Tool info (affects chatter frequency)
float toolDiameter = 6.0f;  // mm
int toolFlutes = 2;
float spindleRPM = 10000;

// Chatter detection thresholds (will be set from profile)
float CHATTER_THRESHOLD = 0.55f;
float RECOVERY_THRESHOLD = 0.25f;
int MIN_FEED_OVERRIDE = 25;
int MAX_FEED_OVERRIDE = 100;
int FEED_DECREASE_STEP = 10;
int FEED_INCREASE_STEP = 5;
#define ADJUSTMENT_INTERVAL   500     // Only adjust every 500ms

// Sensor fusion weights (will be set from profile)
float WEIGHT_AUDIO = 0.30f;
float WEIGHT_ACCEL = 0.40f;
float WEIGHT_CURRENT = 0.30f;

// Current sensor calibration
// Assumptions (default wiring):
// - ACS712T ELC-30A module powered from 5V
// - Output protected into ESP32 ADC with a 10k/20k divider (~0.666) as shown in docs
//   => ADC sees ~3.3V max, centered around ~1.65V
// - ACS712-30A nominal sensitivity is ~66mV/A @ 5V supply
//   => effective sensitivity at ADC ~= 66mV/A * 0.666 ~= 44mV/A
#define CURRENT_ADC_VREF_V        3.3f
#define CURRENT_ADC_OFFSET_V      (CURRENT_ADC_VREF_V * 0.5f)
#define CURRENT_ADC_MV_PER_AMP    44.0f
float OVERLOAD_AMPS = 15.0f;          // Will be set from profile
#define TOOL_BREAK_RATIO      0.30f   // 30% of baseline = broken tool

// Forward declarations (defined after all variables are declared)
void applyProfile(int index);
void applyOperation(OperationType op);
float calculateToothPassFrequency();

// ============================================================================
// PIN DEFINITIONS - ESP32 DevKit 38-pin
// ============================================================================

// I2C for MPU-6050
#define I2C_SDA               21
#define I2C_SCL               22

// I2S for INMP441 microphone
#define I2S_WS                25      // Word Select (LRCLK)
#define I2S_SD                32      // Serial Data
#define I2S_SCK               26      // Serial Clock (BCLK)

// ADC for ACS712 current sensor
#define CURRENT_ADC_PIN       34      // ADC1_CH6 (GPIO 34)

// UART to grblHAL (Octopus Pro)
#define GRBL_TX               17      // ESP TX -> Octopus RX
#define GRBL_RX               16      // ESP RX <- Octopus TX

// ============================================================================
// GRBLHAL REAL-TIME COMMANDS
// ============================================================================

#define GRBL_RESET            0x18    // Ctrl+X soft reset
#define GRBL_FEED_100         0x90    // Reset to 100%
#define GRBL_FEED_PLUS_10     0x91    // +10%
#define GRBL_FEED_MINUS_10    0x92    // -10%
#define GRBL_FEED_PLUS_1      0x93    // +1%
#define GRBL_FEED_MINUS_1     0x94    // -1%

// ============================================================================
// FFT CONFIGURATION
// ============================================================================

#define AUDIO_SAMPLE_RATE     22050
#define AUDIO_FFT_SIZE        1024
#define ACCEL_SAMPLE_RATE     1000
#define ACCEL_FFT_SIZE        256
#define CURRENT_SAMPLE_RATE   2000
#define CURRENT_FFT_SIZE      256

// Frequency bin ranges for chatter detection (dynamic based on material!)
// bin = freq * fftSize / sampleRate
int AUDIO_BIN_START = 23;     // Updated by applyProfile()
int AUDIO_BIN_END = 232;
int ACCEL_BIN_START = 13;
int ACCEL_BIN_END = 128;
#define CURRENT_BIN_START     3       // ~20 Hz (current stays fixed)
#define CURRENT_BIN_END       26      // ~200 Hz

// Helper to calculate bin from frequency
int freqToBin(float freq, int sampleRate, int fftSize) {
    return (int)((freq * fftSize) / sampleRate);
}

// ============================================================================
// GLOBAL OBJECTS
// ============================================================================

// Web server and WebSocket
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// UART to grblHAL
HardwareSerial grblSerial(2);

// MPU-6050
MPU6050 mpu;

// FFT objects
ArduinoFFT<double> audioFFT;
ArduinoFFT<double> accelFFT;
ArduinoFFT<double> currentFFT;

// FFT buffers
double audioReal[AUDIO_FFT_SIZE];
double audioImag[AUDIO_FFT_SIZE];
double accelReal[ACCEL_FFT_SIZE];
double accelImag[ACCEL_FFT_SIZE];
double currentReal[CURRENT_FFT_SIZE];
double currentImag[CURRENT_FFT_SIZE];

// ============================================================================
// STATE VARIABLES
// ============================================================================

struct ChatterState {
    bool enabled = true;
    bool connected = false;
    
    // Sensor scores (0-1)
    float audioScore = 0;
    float accelScore = 0;
    float currentScore = 0;
    float combinedScore = 0;
    
    // Current sensor
    float currentAmps = 0;
    float baselineCurrent = 2.0f;  // Will be calibrated
    bool calibrating = false;
    float calibrationSum = 0;
    int calibrationCount = 0;
    
    // Detected frequency (Hz)
    float dominantFreq = 0;
    
    // Feed override
    int feedOverride = 100;
    unsigned long lastAdjustment = 0;
    
    // Alerts
    bool toolBroken = false;
    bool overload = false;
    bool chatterDetected = false;
    
    // ========== INTELLIGENT FEATURES ==========
    
    // Moving average filter (reduces noise/false positives)
    float audioHistory[8] = {0};
    float accelHistory[8] = {0};
    float currentHistory[8] = {0};
    int historyIndex = 0;
    
    // Trend detection (is chatter getting worse?)
    float combinedHistory[16] = {0};
    int trendIndex = 0;
    float trendSlope = 0;  // positive = getting worse
    
    // Adaptive thresholds (learn from your machine)
    float adaptiveThreshold = 0.55f;
    float noiseFloor = 0.05f;  // Learned background noise
    bool learning = false;
    float learnSum = 0;
    int learnCount = 0;
    
    // Hysteresis (prevent oscillation)
    int stableCount = 0;        // How many cycles stable after chatter
    int chatterCount = 0;       // How many cycles of chatter
    bool inChatterZone = false; // Currently in chatter state
    
    // Recovery tracking
    int recoveryAttempts = 0;   // How many times we tried to recover
    int lastStableFeed = 100;   // Last feed rate that was stable
    unsigned long chatterStartTime = 0;
    
    // Operating mode
    int mode = 0;  // 0=auto, 1=aggressive, 2=conservative, 3=learning
    
    // ========== SPINDLE STATE DETECTION ==========
    bool spindleRunning = false;    // Is spindle actually spinning?
    bool cutting = false;           // Are we actually cutting material?
    float idleCurrent = 0.5f;       // Current when spindle running but not cutting
    float cuttingThreshold = 1.5f;  // Current above this = cutting
    unsigned long lastCuttingTime = 0;
    
    // Statistics (for learning/tuning)
    unsigned long totalChatterEvents = 0;
    unsigned long totalCuttingTime = 0;
    float maxChatterScore = 0;
    float avgChatterScore = 0;
    int chatterEventCount = 0;
    
    // ========== ADVANCED DETECTION FEATURES ==========
    
    // Exponential Moving Average (faster response, less noise)
    float emaAudio = 0;
    float emaAccel = 0;
    float emaCurrent = 0;
    float emaCombined = 0;
    static constexpr float EMA_FAST = 0.3f;   // Fast response
    static constexpr float EMA_SLOW = 0.1f;   // Slow/stable
    
    // Harmonic detection (chatter has characteristic harmonics)
    float harmonicRatio = 0;      // Ratio of harmonics to fundamental
    float harmonicFreqs[5] = {0}; // Detected harmonic frequencies
    bool harmonicsDetected = false;
    
    // Frequency band energy
    float lowBandEnergy = 0;      // 50-200 Hz (spindle noise)
    float midBandEnergy = 0;      // 200-1000 Hz (chatter zone)
    float highBandEnergy = 0;     // 1000+ Hz (tool squeal)
    
    // Position tracking (where chatter occurs)
    float posX = 0, posY = 0, posZ = 0;
    float chatterPosX[32] = {0};  // Log of chatter positions
    float chatterPosY[32] = {0};
    float chatterPosZ[32] = {0};
    float chatterScores[32] = {0};
    int chatterPosIndex = 0;
    int chatterPosCount = 0;
    
    // Pattern detection
    float scoreVariance = 0;       // How much score fluctuates
    float scoreDelta = 0;          // Rate of change
    bool risingChatter = false;    // Chatter getting worse fast
    bool stableChatter = false;    // Chatter at constant level
    bool intermittent = false;     // Comes and goes
    
    // Prediction
    float predictedScore = 0;      // Where we think score is going
    int ticksToChatter = -1;       // Estimated ticks until threshold
    bool warningIssued = false;    // Already sent predictive warning
    
    // Machine learning ready features
    float features[16] = {0};      // Feature vector for future ML
    unsigned long sampleCount = 0;
    
    // Detection confidence
    float confidence = 0;          // How confident are we (0-1)
    
    // Cutting efficiency (NEW!)
    float efficiency = 0;          // How optimal is current cutting (0-1)
    float bestFeedForMaterial = 100;  // Learned best feed for current material
    
} state;

// Adaptive weight factors (can be tuned via WebSocket)
float weightAudio = WEIGHT_AUDIO;
float weightAccel = WEIGHT_ACCEL;
float weightCurrent = WEIGHT_CURRENT;

// ============================================================================
// PERSISTENT SETTINGS (saved to flash)
// ============================================================================

void saveSettings() {
    prefs.begin("chatter", false);
    prefs.putInt("material", currentProfileIndex);
    prefs.putInt("operation", (int)currentOperation);
    prefs.putFloat("toolDia", toolDiameter);
    prefs.putInt("toolFlutes", toolFlutes);
    prefs.putFloat("rpm", spindleRPM);
    prefs.putFloat("baseline", state.baselineCurrent);
    prefs.putFloat("noiseFloor", state.noiseFloor);
    prefs.putFloat("idleCurrent", state.idleCurrent);
    prefs.putInt("mode", state.mode);
    prefs.end();
    Serial.println("Settings saved to flash");
}

void loadSettings() {
    prefs.begin("chatter", true);  // Read-only
    
    int savedMaterial = prefs.getInt("material", 0);
    int savedOp = prefs.getInt("operation", 0);
    toolDiameter = prefs.getFloat("toolDia", 6.0f);
    toolFlutes = prefs.getInt("toolFlutes", 2);
    spindleRPM = prefs.getFloat("rpm", 10000.0f);
    state.baselineCurrent = prefs.getFloat("baseline", 2.0f);
    state.noiseFloor = prefs.getFloat("noiseFloor", 0.05f);
    state.idleCurrent = prefs.getFloat("idleCurrent", 0.5f);
    state.mode = prefs.getInt("mode", 0);
    
    prefs.end();
    
    // Apply loaded settings
    if (savedMaterial >= 0 && savedMaterial < NUM_PROFILES) {
        applyProfile(savedMaterial);
    }
    applyOperation((OperationType)savedOp);
    
    Serial.printf("Loaded settings: %s, op=%d, tool=%.1fmm %dF @%.0f RPM\n",
        PROFILES[currentProfileIndex].name, savedOp, toolDiameter, toolFlutes, spindleRPM);
}

// ============================================================================
// MATERIAL/OPERATION/TOOL FUNCTIONS (defined here after all variables)
// ============================================================================

// Calculate expected chatter frequency based on tool and spindle
float calculateToothPassFrequency() {
    // Tooth passing frequency = (RPM * flutes) / 60
    return (spindleRPM * toolFlutes) / 60.0f;
}

// Apply a material profile
void applyProfile(int index) {
    if (index < 0 || index >= NUM_PROFILES) return;
    
    currentProfileIndex = index;
    const MaterialProfile& p = PROFILES[index];
    
    CHATTER_THRESHOLD = p.chatterThreshold;
    RECOVERY_THRESHOLD = p.recoveryThreshold;
    WEIGHT_AUDIO = p.weightAudio;
    WEIGHT_ACCEL = p.weightAccel;
    WEIGHT_CURRENT = p.weightCurrent;
    MIN_FEED_OVERRIDE = p.minFeed;
    FEED_DECREASE_STEP = p.feedDecreaseStep;
    FEED_INCREASE_STEP = p.feedIncreaseStep;
    OVERLOAD_AMPS = p.typicalAmpsHigh * 1.5f;  // 50% above typical max
    
    // Update FFT bin ranges based on material frequency range
    // This is critical - different materials chatter at different frequencies!
    AUDIO_BIN_START = freqToBin(p.audioFreqLow, AUDIO_SAMPLE_RATE, AUDIO_FFT_SIZE);
    AUDIO_BIN_END = freqToBin(p.audioFreqHigh, AUDIO_SAMPLE_RATE, AUDIO_FFT_SIZE);
    ACCEL_BIN_START = freqToBin(p.accelFreqLow, ACCEL_SAMPLE_RATE, ACCEL_FFT_SIZE);
    ACCEL_BIN_END = freqToBin(p.accelFreqHigh, ACCEL_SAMPLE_RATE, ACCEL_FFT_SIZE);
    
    // Sanity check bins
    if (AUDIO_BIN_START < 1) AUDIO_BIN_START = 1;
    if (AUDIO_BIN_END > AUDIO_FFT_SIZE/2) AUDIO_BIN_END = AUDIO_FFT_SIZE/2;
    if (ACCEL_BIN_START < 1) ACCEL_BIN_START = 1;
    if (ACCEL_BIN_END > ACCEL_FFT_SIZE/2) ACCEL_BIN_END = ACCEL_FFT_SIZE/2;
    
    // Also update state threshold
    state.adaptiveThreshold = CHATTER_THRESHOLD;
    
    // Update weights
    weightAudio = WEIGHT_AUDIO;
    weightAccel = WEIGHT_ACCEL;
    weightCurrent = WEIGHT_CURRENT;
    
    Serial.printf("Profile: %s | Thresh=%.2f | Audio=%d-%dHz (bins %d-%d) | Accel=%d-%dHz (bins %d-%d)\n",
        p.name, CHATTER_THRESHOLD, 
        p.audioFreqLow, p.audioFreqHigh, AUDIO_BIN_START, AUDIO_BIN_END,
        p.accelFreqLow, p.accelFreqHigh, ACCEL_BIN_START, ACCEL_BIN_END);
}

// Adjust for operation type
void applyOperation(OperationType op) {
    currentOperation = op;
    
    switch (op) {
        case OP_ROUGHING:
            // More tolerant - we expect some vibration
            state.adaptiveThreshold = CHATTER_THRESHOLD * 1.1f;
            FEED_DECREASE_STEP = PROFILES[currentProfileIndex].feedDecreaseStep;
            break;
            
        case OP_FINISHING:
            // Less tolerant - surface finish matters
            state.adaptiveThreshold = CHATTER_THRESHOLD * 0.85f;
            FEED_DECREASE_STEP = PROFILES[currentProfileIndex].feedDecreaseStep + 5;
            break;
            
        case OP_DRILLING:
            // Different pattern - mainly current monitoring
            WEIGHT_CURRENT = 0.50f;
            WEIGHT_ACCEL = 0.35f;
            WEIGHT_AUDIO = 0.15f;
            weightCurrent = 0.50f;
            weightAccel = 0.35f;
            weightAudio = 0.15f;
            break;
            
        case OP_SLOTTING:
            // High chatter risk - be aggressive
            state.adaptiveThreshold = CHATTER_THRESHOLD * 0.75f;
            FEED_DECREASE_STEP = PROFILES[currentProfileIndex].feedDecreaseStep + 10;
            break;
    }
    
    Serial.printf("Operation: %d (threshold=%.2f)\n", op, state.adaptiveThreshold);
}

// ============================================================================
// SPINDLE STATE DETECTION
// ============================================================================

void detectSpindleState() {
    // Detect if spindle is running based on current and vibration
    float avgCurrent = 0;
    for (int i = 0; i < 8; i++) {
        avgCurrent += state.currentHistory[i];
    }
    avgCurrent /= 8;
    
    // Also check accelerometer for spindle vibration signature
    float avgVibration = 0;
    for (int i = 0; i < 8; i++) {
        avgVibration += state.accelHistory[i];
    }
    avgVibration /= 8;
    
    // Spindle running: current > idle threshold OR significant vibration
    bool wasRunning = state.spindleRunning;
    state.spindleRunning = (state.currentAmps > state.idleCurrent * 0.3f) || (avgVibration > 0.1f);
    
    // Cutting: current significantly above idle
    bool wasCutting = state.cutting;
    state.cutting = state.spindleRunning && (state.currentAmps > state.cuttingThreshold);
    
    // Log state changes
    if (state.spindleRunning && !wasRunning) {
        Serial.println(">>> Spindle started <<<");
    }
    if (!state.spindleRunning && wasRunning) {
        Serial.println(">>> Spindle stopped <<<");
        // Reset chatter state when spindle stops
        state.inChatterZone = false;
        state.chatterDetected = false;
        state.feedOverride = 100;
        state.chatterCount = 0;
        state.stableCount = 0;
    }
    if (state.cutting && !wasCutting) {
        Serial.println(">>> Cutting started <<<");
        state.lastCuttingTime = millis();
    }
    if (!state.cutting && wasCutting) {
        Serial.println(">>> Cutting stopped <<<");
    }
}

// Auto-calibrate idle current (call when spindle running but not cutting)
void autoCalibrate() {
    if (!state.spindleRunning) {
        Serial.println("Cannot calibrate - spindle not running");
        return;
    }
    
    Serial.println("Auto-calibrating idle current (5 seconds)...");
    float sum = 0;
    int count = 0;
    unsigned long start = millis();
    
    while (millis() - start < 5000) {
        readCurrentSamples();
        sum += state.currentAmps;
        count++;
        delay(50);
    }
    
    state.idleCurrent = sum / count;
    state.cuttingThreshold = state.idleCurrent * 1.5f;  // 50% above idle
    state.baselineCurrent = state.idleCurrent * 2.0f;   // Baseline for cutting
    
    Serial.printf("Calibration complete: idle=%.2fA, cutting threshold=%.2fA\n",
        state.idleCurrent, state.cuttingThreshold);
    
    // Save to flash
    saveSettings();
}

// ============================================================================
// I2S MICROPHONE SETUP
// ============================================================================

void setupI2S() {
    i2s_config_t i2s_config = {
        .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
        .sample_rate = AUDIO_SAMPLE_RATE,
        .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
        .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
        .communication_format = I2S_COMM_FORMAT_STAND_I2S,
        .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
        .dma_buf_count = 4,
        .dma_buf_len = 256,
        .use_apll = false,
        .tx_desc_auto_clear = false,
        .fixed_mclk = 0
    };
    
    i2s_pin_config_t pin_config = {
        .bck_io_num = I2S_SCK,
        .ws_io_num = I2S_WS,
        .data_out_num = I2S_PIN_NO_CHANGE,
        .data_in_num = I2S_SD
    };
    
    i2s_driver_install(I2S_NUM_0, &i2s_config, 0, NULL);
    i2s_set_pin(I2S_NUM_0, &pin_config);
}

// ============================================================================
// SENSOR READING FUNCTIONS
// ============================================================================

void readAudioSamples() {
    int32_t samples[AUDIO_FFT_SIZE];
    size_t bytesRead;
    
    esp_err_t err = i2s_read(I2S_NUM_0, samples, sizeof(samples), &bytesRead, pdMS_TO_TICKS(100));
    
    if (err != ESP_OK || bytesRead == 0) {
        health.i2sOk = false;
        health.i2sError = SENSOR_TIMEOUT;
        return;
    }
    
    float sumAbs = 0;
    for (int i = 0; i < AUDIO_FFT_SIZE; i++) {
        // Convert 32-bit I2S to normalized double
        audioReal[i] = (double)(samples[i] >> 14) / 32768.0;
        audioImag[i] = 0;
        sumAbs += abs(audioReal[i]);
    }
    
    // Check for stuck/invalid data
    float avgLevel = sumAbs / AUDIO_FFT_SIZE;
    if (checkSensorStuck(avgLevel, health.lastI2sValue, health.i2sStuckCount, 0.0001f)) {
        health.i2sOk = false;
        health.i2sError = SENSOR_STUCK;
    } else {
        health.i2sOk = true;
        health.i2sError = SENSOR_OK;
        health.lastI2sRead = millis();
    }
}

void readAccelSamples() {
    bool gotData = false;
    float sumMag = 0;
    
    for (int i = 0; i < ACCEL_FFT_SIZE; i++) {
        int16_t ax, ay, az;
        mpu.getAcceleration(&ax, &ay, &az);
        
        // Check if MPU returned valid data (not all zeros or all max)
        if (ax != 0 || ay != 0 || az != 0) {
            gotData = true;
        }
        
        // Compute magnitude
        float magnitude = sqrt((float)ax*ax + (float)ay*ay + (float)az*az);
        accelReal[i] = magnitude / 32768.0;  // Normalize
        accelImag[i] = 0;
        sumMag += magnitude;
        
        delayMicroseconds(1000000 / ACCEL_SAMPLE_RATE);
    }
    
    if (!gotData) {
        health.mpuOk = false;
        health.mpuError = SENSOR_INVALID_DATA;
    } else {
        float avgMag = sumMag / ACCEL_FFT_SIZE;
        if (checkSensorStuck(avgMag, health.lastMpuValue, health.mpuStuckCount, 10.0f)) {
            health.mpuOk = false;
            health.mpuError = SENSOR_STUCK;
        } else {
            health.mpuOk = true;
            health.mpuError = SENSOR_OK;
            health.lastMpuRead = millis();
        }
    }
}

void readCurrentSamples() {
    float sumVal = 0;
    bool inRange = true;
    
    for (int i = 0; i < CURRENT_FFT_SIZE; i++) {
        int adcValue = analogRead(CURRENT_ADC_PIN);
        
        // Check for out of range (stuck at 0 or max)
        if (adcValue < 10 || adcValue > 4085) {
            inRange = false;
        }
        
        // Convert ADC reading to current using configured slope/offset.
        // NOTE: The firmware rectifies (abs) and then RMS-es the samples; this is meant to track load changes,
        // not serve as a lab-grade AC RMS meter.
        float voltage = (adcValue / 4095.0f) * CURRENT_ADC_VREF_V;
        float current = (voltage - CURRENT_ADC_OFFSET_V) / (CURRENT_ADC_MV_PER_AMP / 1000.0f);
        
        currentReal[i] = abs(current);  // Rectify AC
        currentImag[i] = 0;
        sumVal += currentReal[i];
        
        delayMicroseconds(1000000 / CURRENT_SAMPLE_RATE);
    }
    
    // Update current reading (RMS of samples)
    float sumSq = 0;
    for (int i = 0; i < CURRENT_FFT_SIZE; i++) {
        sumSq += currentReal[i] * currentReal[i];
    }
    state.currentAmps = sqrt(sumSq / CURRENT_FFT_SIZE);
    
    // Check sensor health
    float avgCurrent = sumVal / CURRENT_FFT_SIZE;
    if (!inRange) {
        health.adcOk = false;
        health.adcError = SENSOR_OUT_OF_RANGE;
    } else if (checkSensorStuck(avgCurrent, health.lastAdcValue, health.adcStuckCount, 0.01f)) {
        health.adcOk = false;
        health.adcError = SENSOR_STUCK;
    } else {
        health.adcOk = true;
        health.adcError = SENSOR_OK;
        health.lastAdcRead = millis();
    }
    
    // Calibration mode
    if (state.calibrating) {
        state.calibrationSum += state.currentAmps;
        state.calibrationCount++;
        if (state.calibrationCount >= 100) {
            state.baselineCurrent = state.calibrationSum / state.calibrationCount;
            state.calibrating = false;
            Serial.printf("Calibration complete: baseline = %.2f A\n", state.baselineCurrent);
        }
    }
}

// ============================================================================
// FFT ANALYSIS - CHATTER SCORE CALCULATION
// ============================================================================

// Check if a frequency is near the tooth passing frequency (or harmonics)
bool isToothPassFrequency(float freq, float binWidth) {
    float tpf = calculateToothPassFrequency();
    if (tpf < 10) return false;  // Spindle off
    
    // Check fundamental and first 3 harmonics
    for (int h = 1; h <= 4; h++) {
        float harmonic = tpf * h;
        float tolerance = binWidth * 2;  // +/- 2 bins
        if (abs(freq - harmonic) < tolerance) {
            return true;
        }
    }
    return false;
}

// Analyze frequency band energy (chatter typically in 200-1000Hz range)
void analyzeFrequencyBands(double* fftData, int size, float binWidth) {
    state.lowBandEnergy = 0;
    state.midBandEnergy = 0;
    state.highBandEnergy = 0;
    
    for (int i = 1; i < size / 2; i++) {
        float freq = i * binWidth;
        double mag = fftData[i];
        
        if (freq >= 50 && freq < 200) {
            state.lowBandEnergy += mag;
        } else if (freq >= 200 && freq < 1000) {
            state.midBandEnergy += mag;  // Chatter zone!
        } else if (freq >= 1000 && freq < 4000) {
            state.highBandEnergy += mag;
        }
    }
    
    // Normalize by band width
    state.lowBandEnergy /= 150.0f;   // 150 Hz range
    state.midBandEnergy /= 800.0f;   // 800 Hz range
    state.highBandEnergy /= 3000.0f; // 3000 Hz range
}

// Detect harmonic structure (chatter has strong harmonics)
void detectHarmonics(double* fftData, int size, float binWidth, float fundamentalFreq) {
    if (fundamentalFreq < 50) {
        state.harmonicsDetected = false;
        state.harmonicRatio = 0;
        return;
    }
    
    int fundBin = (int)(fundamentalFreq / binWidth);
    double fundMag = (fundBin > 0 && fundBin < size/2) ? fftData[fundBin] : 0;
    
    if (fundMag < 10) {  // Too weak
        state.harmonicsDetected = false;
        return;
    }
    
    // Look for harmonics (2x, 3x, 4x, 5x fundamental)
    int harmonicsFound = 0;
    double harmonicTotal = 0;
    
    for (int h = 2; h <= 5; h++) {
        int harmBin = fundBin * h;
        if (harmBin >= size / 2) break;
        
        // Check if there's a peak near the expected harmonic
        double peakMag = 0;
        for (int j = -2; j <= 2; j++) {
            int bin = harmBin + j;
            if (bin > 0 && bin < size/2) {
                peakMag = max(peakMag, fftData[bin]);
            }
        }
        
        state.harmonicFreqs[h-1] = harmBin * binWidth;
        
        // If harmonic is at least 10% of fundamental, count it
        if (peakMag > fundMag * 0.1) {
            harmonicsFound++;
            harmonicTotal += peakMag;
        }
    }
    
    // Strong harmonics = likely chatter
    state.harmonicsDetected = harmonicsFound >= 2;
    state.harmonicRatio = (fundMag > 0) ? (harmonicTotal / fundMag) : 0;
}

// Calculate detection confidence based on multiple factors
float calculateConfidence() {
    float conf = 0;
    
    // Sensor agreement (all sensors showing similar scores)
    float sensorSpread = max(max(state.audioScore, state.accelScore), state.currentScore) -
                         min(min(state.audioScore, state.accelScore), state.currentScore);
    float sensorAgreement = 1.0f - sensorSpread;
    conf += sensorAgreement * 0.3f;
    
    // Harmonic detection adds confidence
    if (state.harmonicsDetected) {
        conf += 0.2f + min(state.harmonicRatio * 0.1f, 0.1f);
    }
    
    // Mid-band energy (chatter zone) higher than other bands
    float totalEnergy = state.lowBandEnergy + state.midBandEnergy + state.highBandEnergy;
    if (totalEnergy > 0) {
        float midRatio = state.midBandEnergy / totalEnergy;
        if (midRatio > 0.5f) conf += 0.2f;
    }
    
    // Trend consistency (steady increase = likely real chatter)
    if (state.trendSlope > 0.01f && state.combinedScore > 0.3f) {
        conf += 0.1f;
    }
    
    // Score above threshold adds base confidence
    if (state.combinedScore > state.adaptiveThreshold) {
        conf += 0.1f;
    }
    
    return constrain(conf, 0, 1);
}

// Predict future score using exponential extrapolation
void predictChatter() {
    // Use EMA trend to predict
    float prediction = state.emaCombined + state.trendSlope * 5;  // 5 ticks ahead
    state.predictedScore = constrain(prediction, 0, 1);
    
    // Estimate ticks until threshold
    if (state.trendSlope > 0.001f && state.emaCombined < state.adaptiveThreshold) {
        float gap = state.adaptiveThreshold - state.emaCombined;
        state.ticksToChatter = (int)(gap / state.trendSlope);
        if (state.ticksToChatter < 0) state.ticksToChatter = -1;
    } else {
        state.ticksToChatter = -1;
    }
}

// Log chatter position for mapping
void logChatterPosition(float score) {
    if (state.chatterPosCount < 32 && score > state.adaptiveThreshold * 0.8f) {
        state.chatterPosX[state.chatterPosIndex] = state.posX;
        state.chatterPosY[state.chatterPosIndex] = state.posY;
        state.chatterPosZ[state.chatterPosIndex] = state.posZ;
        state.chatterScores[state.chatterPosIndex] = score;
        state.chatterPosIndex = (state.chatterPosIndex + 1) % 32;
        if (state.chatterPosCount < 32) state.chatterPosCount++;
    }
}

// Build feature vector for future ML
void buildFeatureVector() {
    state.features[0] = state.emaAudio;
    state.features[1] = state.emaAccel;
    state.features[2] = state.emaCurrent;
    state.features[3] = state.emaCombined;
    state.features[4] = state.dominantFreq / 1000.0f;  // Normalized
    state.features[5] = state.harmonicRatio;
    state.features[6] = state.lowBandEnergy;
    state.features[7] = state.midBandEnergy;
    state.features[8] = state.highBandEnergy;
    state.features[9] = state.trendSlope;
    state.features[10] = state.scoreVariance;
    state.features[11] = state.harmonicsDetected ? 1.0f : 0.0f;
    state.features[12] = (float)currentProfileIndex / NUM_PROFILES;
    state.features[13] = state.confidence;
    state.features[14] = state.currentAmps / 10.0f;
    state.features[15] = state.spindleRunning ? 1.0f : 0.0f;
}

float analyzeChatter(double* fftData, int binStart, int binEnd, float* dominantFreq, float binWidth) {
    double maxMag = 0;
    double avgMag = 0;
    int maxBin = binStart;
    float tpf = calculateToothPassFrequency();
    int tpfBin = (tpf > 0) ? (int)(tpf / binWidth) : -1;
    
    for (int i = binStart; i < binEnd; i++) {
        double mag = fftData[i];
        
        // Reduce weight of tooth-pass frequency bins (not chatter!)
        float freq = i * binWidth;
        if (isToothPassFrequency(freq, binWidth)) {
            mag *= 0.3f;  // De-emphasize normal cutting frequency
        }
        
        avgMag += mag;
        if (mag > maxMag) {
            maxMag = mag;
            maxBin = i;
        }
    }
    avgMag /= (binEnd - binStart);
    
    // Calculate dominant frequency
    float freqResult = maxBin * binWidth;
    if (dominantFreq != nullptr) {
        *dominantFreq = freqResult;
    }
    
    // Analyze harmonics at dominant frequency
    detectHarmonics(fftData, binEnd * 2, binWidth, freqResult);
    
    // Peak-to-average ratio (chatter shows as sharp peak)
    float peakRatio = (avgMag > 0) ? (maxMag / avgMag) : 0;
    
    // Boost score if harmonics detected (strong chatter indicator)
    if (state.harmonicsDetected) {
        peakRatio *= 1.0f + min(state.harmonicRatio * 0.2f, 0.3f);
    }
    
    // Normalize to 0-1 range (tune these values for your machine!)
    float score = (peakRatio - 3.0f) / 10.0f;
    
    // Clamp
    if (score < 0) score = 0;
    if (score > 1) score = 1;
    
    return score;
}

void processAudio() {
    readAudioSamples();
    
    audioFFT.windowing(audioReal, AUDIO_FFT_SIZE, FFT_WIN_TYP_HAMMING, FFT_FORWARD);
    audioFFT.compute(audioReal, audioImag, AUDIO_FFT_SIZE, FFT_FORWARD);
    audioFFT.complexToMagnitude(audioReal, audioImag, AUDIO_FFT_SIZE);
    
    float binWidth = (float)AUDIO_SAMPLE_RATE / AUDIO_FFT_SIZE;
    
    // Analyze frequency bands for chatter zone detection
    analyzeFrequencyBands(audioReal, AUDIO_FFT_SIZE, binWidth);
    
    state.audioScore = analyzeChatter(audioReal, AUDIO_BIN_START, AUDIO_BIN_END, &state.dominantFreq, binWidth);
    
    // Apply EMA smoothing
    state.emaAudio = state.emaAudio * (1.0f - state.EMA_FAST) + state.audioScore * state.EMA_FAST;
}

void processAccel() {
    readAccelSamples();
    
    accelFFT.windowing(accelReal, ACCEL_FFT_SIZE, FFT_WIN_TYP_HAMMING, FFT_FORWARD);
    accelFFT.compute(accelReal, accelImag, ACCEL_FFT_SIZE, FFT_FORWARD);
    accelFFT.complexToMagnitude(accelReal, accelImag, ACCEL_FFT_SIZE);
    
    float binWidth = (float)ACCEL_SAMPLE_RATE / ACCEL_FFT_SIZE;
    float freq;
    state.accelScore = analyzeChatter(accelReal, ACCEL_BIN_START, ACCEL_BIN_END, &freq, binWidth);
    
    // Apply EMA smoothing
    state.emaAccel = state.emaAccel * (1.0f - state.EMA_FAST) + state.accelScore * state.EMA_FAST;
}

void processCurrent() {
    readCurrentSamples();
    
    currentFFT.windowing(currentReal, CURRENT_FFT_SIZE, FFT_WIN_TYP_HAMMING, FFT_FORWARD);
    currentFFT.compute(currentReal, currentImag, CURRENT_FFT_SIZE, FFT_FORWARD);
    currentFFT.complexToMagnitude(currentReal, currentImag, CURRENT_FFT_SIZE);
    
    float binWidth = (float)CURRENT_SAMPLE_RATE / CURRENT_FFT_SIZE;
    float freq;
    state.currentScore = analyzeChatter(currentReal, CURRENT_BIN_START, CURRENT_BIN_END, &freq, binWidth);
    
    // Apply EMA smoothing
    state.emaCurrent = state.emaCurrent * (1.0f - state.EMA_FAST) + state.currentScore * state.EMA_FAST;
}

// ============================================================================
// FEED OVERRIDE CONTROL
// ============================================================================

void sendFeedOverride(int percent) {
    // Clamp to safe range
    if (percent < MIN_FEED_OVERRIDE) percent = MIN_FEED_OVERRIDE;
    if (percent > MAX_FEED_OVERRIDE) percent = MAX_FEED_OVERRIDE;
    
    // First reset to 100%
    grblSerial.write(GRBL_FEED_100);
    delay(10);
    
    // Then reduce in 10% steps
    int tens = (100 - percent) / 10;
    for (int i = 0; i < tens; i++) {
        grblSerial.write(GRBL_FEED_MINUS_10);
        delay(5);
    }
    
    // Fine adjustment with 1% steps
    int ones = (100 - percent) % 10;
    for (int i = 0; i < ones; i++) {
        grblSerial.write(GRBL_FEED_MINUS_1);
        delay(5);
    }
    
    state.feedOverride = percent;
    Serial.printf("Feed override: %d%%\n", percent);
}

void emergencyStop() {
    grblSerial.write(GRBL_RESET);
    delay(100);
    grblSerial.println("M5");  // Spindle off
    Serial.println("!!! EMERGENCY STOP !!!");
}

// ============================================================================
// MAIN DETECTION LOGIC - WITH ACTUAL INTELLIGENCE
// ============================================================================

// Moving average filter - smooths out noise
float applyMovingAverage(float* history, int size, float newValue) {
    float sum = 0;
    for (int i = 0; i < size - 1; i++) {
        history[i] = history[i + 1];
        sum += history[i];
    }
    history[size - 1] = newValue;
    sum += newValue;
    return sum / size;
}

// Calculate trend slope (is chatter getting worse or better?)
float calculateTrend(float* history, int size) {
    // Simple linear regression
    float sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (int i = 0; i < size; i++) {
        sumX += i;
        sumY += history[i];
        sumXY += i * history[i];
        sumX2 += i * i;
    }
    float n = size;
    float slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope;  // Positive = getting worse, negative = improving
}

// Smart feed adjustment based on severity and trend
int calculateFeedAdjustment(float score, float trend, int currentFeed) {
    // Base adjustment on how far over threshold we are
    float severity = (score - state.adaptiveThreshold) / (1.0f - state.adaptiveThreshold);
    severity = constrain(severity, 0, 1);
    
    // More aggressive if trend is rising
    float trendFactor = 1.0f + constrain(trend * 10, 0, 1);
    
    // Calculate step size: 5-20% depending on severity
    int step = 5 + (int)(severity * 15 * trendFactor);
    
    // But never go below minimum
    int newFeed = currentFeed - step;
    if (newFeed < MIN_FEED_OVERRIDE) newFeed = MIN_FEED_OVERRIDE;
    
    return newFeed;
}

// Smart recovery - don't just blindly increase
int calculateRecovery(int currentFeed) {
    // Slower recovery if we've had multiple chatter events
    int baseStep = 5;
    if (state.recoveryAttempts > 3) baseStep = 2;
    if (state.recoveryAttempts > 6) baseStep = 1;
    
    // Don't recover past the last known stable feed
    int targetFeed = min(currentFeed + baseStep, state.lastStableFeed);
    
    // But slowly push toward 100% if we've been stable for a while
    if (state.stableCount > 20 && state.lastStableFeed < 100) {
        state.lastStableFeed += 1;  // Slowly raise the ceiling
    }
    
    return min(targetFeed, MAX_FEED_OVERRIDE);
}

// Find optimal cutting zone - balance between efficiency and stability
float findOptimalZone() {
    // The "sweet spot" is where:
    // - Current draw indicates good material removal (not air cutting)
    // - Chatter score is low but not too low (indicates engagement)
    // - Score is stable (low variance)
    
    float efficiency = 0;
    
    // Material engagement factor (0-1)
    float engagement = 0;
    float loadRange = state.cuttingThreshold - state.idleCurrent;
    if (state.currentAmps > state.idleCurrent && loadRange > 0.1f) {
        float loadRatio = (state.currentAmps - state.idleCurrent) / loadRange;
        engagement = constrain(loadRatio, 0, 1);
    }
    
    // Stability factor (higher is better)
    float stability = 1.0f - constrain(state.scoreVariance * 10, 0, 1);
    
    // Safety margin (how far below threshold)
    float margin = 0;
    if (state.adaptiveThreshold > 0.01f) {
        margin = 1.0f - (state.combinedScore / state.adaptiveThreshold);
        margin = constrain(margin, 0, 1);
    }
    
    // Optimal zone score combines all factors
    // We want: high engagement, high stability, good margin
    efficiency = (engagement * 0.4f) + (stability * 0.3f) + (margin * 0.3f);
    
    return efficiency;
}

void runChatterDetection() {
    if (!state.enabled) return;
    
    // Auto-pause detection when spindle is off or not cutting
    if (!state.spindleRunning) {
        // Keep monitoring but don't act - just track baseline
        state.chatterDetected = false;
        state.inChatterZone = false;
        return;
    }
    
    // Track cutting time for statistics
    if (state.cutting) {
        state.totalCuttingTime++;
        state.lastCuttingTime = millis();
    }
    
    state.sampleCount++;
    
    // Process all sensors
    processAudio();
    processAccel();
    processCurrent();
    
    // Apply moving average filter to reduce noise
    float smoothedAudio = applyMovingAverage(state.audioHistory, 8, state.audioScore);
    float smoothedAccel = applyMovingAverage(state.accelHistory, 8, state.accelScore);
    float smoothedCurrent = applyMovingAverage(state.currentHistory, 8, state.currentScore);
    
    // Subtract learned noise floor
    smoothedAudio = max(0.0f, smoothedAudio - state.noiseFloor);
    smoothedAccel = max(0.0f, smoothedAccel - state.noiseFloor);
    smoothedCurrent = max(0.0f, smoothedCurrent - state.noiseFloor);
    
    // Sensor fusion with adaptive weights
    state.combinedScore = 
        (smoothedAudio * weightAudio) +
        (smoothedAccel * weightAccel) +
        (smoothedCurrent * weightCurrent);
    
    // Apply EMA to combined score for smoother trends
    state.emaCombined = state.emaCombined * (1.0f - state.EMA_SLOW) + state.combinedScore * state.EMA_SLOW;
    
    // Update trend history
    state.combinedHistory[state.trendIndex] = state.combinedScore;
    state.trendIndex = (state.trendIndex + 1) % 16;
    state.trendSlope = calculateTrend(state.combinedHistory, 16);
    
    // Calculate score variance (for pattern detection)
    float sumSq = 0, sum = 0;
    for (int i = 0; i < 16; i++) {
        sum += state.combinedHistory[i];
        sumSq += state.combinedHistory[i] * state.combinedHistory[i];
    }
    float mean = sum / 16;
    state.scoreVariance = (sumSq / 16) - (mean * mean);
    
    // Calculate rate of change
    state.scoreDelta = state.combinedScore - state.combinedHistory[(state.trendIndex + 15) % 16];
    
    // Pattern classification
    state.risingChatter = state.trendSlope > 0.02f && state.combinedScore > 0.3f;
    state.stableChatter = state.combinedScore > state.adaptiveThreshold && state.scoreVariance < 0.01f;
    state.intermittent = state.scoreVariance > 0.05f && mean > 0.2f;
    
    // Prediction
    predictChatter();
    
    // Build feature vector for ML
    buildFeatureVector();
    
    // Calculate confidence
    state.confidence = calculateConfidence();
    
    // Calculate cutting efficiency
    state.efficiency = findOptimalZone();
    
    // Learn best feed rate for this material (only when actually cutting with valid data)
    if (state.cutting && state.efficiency > 0.7f && !state.inChatterZone && 
        state.feedOverride < 100 && state.sampleCount > 100) {
        // This is a good cutting zone - remember this feed rate
        state.bestFeedForMaterial = state.feedOverride;
    }
    
    // Predictive warning (before chatter actually happens)
    if (!state.warningIssued && state.ticksToChatter > 0 && state.ticksToChatter < 10 && state.confidence > 0.6f) {
        Serial.println("*** PREDICTIVE WARNING: Chatter likely in ~2 seconds ***");
        state.warningIssued = true;
    } else if (state.ticksToChatter < 0 || state.combinedScore < state.adaptiveThreshold * 0.5f) {
        state.warningIssued = false;
    }
    
    // Log chatter position if score is high
    if (state.combinedScore > state.adaptiveThreshold * 0.8f) {
        logChatterPosition(state.combinedScore);
    }
    
    // Learning mode - establish noise floor
    if (state.learning) {
        state.learnSum += state.combinedScore;
        state.learnCount++;
        if (state.learnCount >= 200) {  // ~10 seconds of data
            state.noiseFloor = (state.learnSum / state.learnCount) * 1.5f;  // 50% margin
            state.adaptiveThreshold = state.noiseFloor + 0.3f;  // Threshold above noise
            state.learning = false;
            Serial.printf("Learning complete: noise=%.3f, threshold=%.3f\n", 
                state.noiseFloor, state.adaptiveThreshold);
        }
        return;  // Don't adjust feed while learning
    }
    
    // Tool breakage detection (only during cutting)
    if (state.currentAmps > state.baselineCurrent * 0.5f) {
        if (state.currentAmps < state.baselineCurrent * TOOL_BREAK_RATIO) {
            state.toolBroken = true;
            emergencyStop();
            return;
        }
    }
    
    // Overload protection
    if (state.currentAmps > OVERLOAD_AMPS) {
        state.overload = true;
        if (millis() - state.lastAdjustment > ADJUSTMENT_INTERVAL) {
            int newFeed = state.feedOverride - 30;
            sendFeedOverride(newFeed);
            state.lastAdjustment = millis();
        }
        return;
    } else {
        state.overload = false;
    }
    
    // Rate limit adjustments
    if (millis() - state.lastAdjustment < ADJUSTMENT_INTERVAL) return;
    
    // ========== INTELLIGENT CHATTER DETECTION WITH HYSTERESIS ==========
    
    // Determine effective threshold with hysteresis
    float effectiveThreshold = state.adaptiveThreshold;
    if (state.inChatterZone) {
        // Once in chatter, need to drop further before we consider it "stable"
        effectiveThreshold = state.adaptiveThreshold - 0.1f;
    }
    
    // Check for rising trend (predictive - catch it before it's bad!)
    bool risingFast = state.trendSlope > 0.02f && state.combinedScore > state.adaptiveThreshold * 0.7f;
    
    // Main chatter detection
    if ((state.combinedScore > effectiveThreshold || risingFast) && state.feedOverride > MIN_FEED_OVERRIDE) {
        state.chatterCount++;
        state.stableCount = 0;
        
        // Require 2+ consecutive readings to confirm chatter (debounce)
        if (state.chatterCount >= 2 || risingFast) {
            if (!state.inChatterZone) {
                state.inChatterZone = true;
                state.chatterStartTime = millis();
                state.recoveryAttempts = 0;
                Serial.println(">>> CHATTER ZONE ENTERED <<<");
            }
            
            state.chatterDetected = true;
            int newFeed = calculateFeedAdjustment(state.combinedScore, state.trendSlope, state.feedOverride);
            sendFeedOverride(newFeed);
            state.lastAdjustment = millis();
        }
    }
    // Stable - consider recovery
    else if (state.combinedScore < effectiveThreshold && state.feedOverride < MAX_FEED_OVERRIDE) {
        state.stableCount++;
        state.chatterCount = 0;
        
        // Require stability for longer before recovering (8+ cycles = ~4 seconds)
        if (state.stableCount >= 8) {
            if (state.inChatterZone) {
                // Record this feed as stable
                state.lastStableFeed = state.feedOverride;
            }
            
            state.chatterDetected = false;
            int newFeed = calculateRecovery(state.feedOverride);
            
            if (newFeed > state.feedOverride) {
                state.recoveryAttempts++;
                sendFeedOverride(newFeed);
                state.lastAdjustment = millis();
                
                // If we successfully recover to 95%+, exit chatter zone
                if (newFeed >= 95) {
                    state.inChatterZone = false;
                    state.recoveryAttempts = 0;
                    Serial.println("<<< EXITED CHATTER ZONE >>>");
                }
            }
        }
    }
    else {
        // In the gray zone - maintain current state
        state.chatterDetected = state.combinedScore > state.adaptiveThreshold;
    }
}

// ============================================================================
// WEBSOCKET HANDLING
// ============================================================================

void sendWebSocketUpdate() {
    StaticJsonDocument<2048> doc;
    
    // Raw sensor scores
    doc["audio"] = round(state.audioScore * 100) / 100.0;
    doc["accel"] = round(state.accelScore * 100) / 100.0;
    doc["current"] = round(state.currentScore * 100) / 100.0;
    doc["combined"] = round(state.combinedScore * 100) / 100.0;
    
    // EMA smoothed scores
    doc["emaAudio"] = round(state.emaAudio * 100) / 100.0;
    doc["emaAccel"] = round(state.emaAccel * 100) / 100.0;
    doc["emaCurrent"] = round(state.emaCurrent * 100) / 100.0;
    doc["emaCombined"] = round(state.emaCombined * 100) / 100.0;
    
    // Current/power
    doc["amps"] = round(state.currentAmps * 10) / 10.0;
    doc["baseline"] = round(state.baselineCurrent * 10) / 10.0;
    
    // Frequency analysis
    doc["freq"] = (int)state.dominantFreq;
    doc["toothFreq"] = (int)calculateToothPassFrequency();
    
    // Frequency bands (chatter zone detection)
    doc["lowBand"] = round(state.lowBandEnergy * 100) / 100.0;
    doc["midBand"] = round(state.midBandEnergy * 100) / 100.0;
    doc["highBand"] = round(state.highBandEnergy * 100) / 100.0;
    
    // Harmonic detection
    doc["harmonics"] = state.harmonicsDetected;
    doc["harmonicRatio"] = round(state.harmonicRatio * 100) / 100.0;
    
    // Feed control
    doc["feed"] = state.feedOverride;
    doc["lastStable"] = state.lastStableFeed;
    doc["minFeed"] = MIN_FEED_OVERRIDE;
    
    // State flags
    doc["enabled"] = state.enabled;
    doc["chatter"] = state.chatterDetected;
    doc["inChatterZone"] = state.inChatterZone;
    doc["toolBroken"] = state.toolBroken;
    doc["overload"] = state.overload;
    doc["learning"] = state.learning;
    doc["calibrating"] = state.calibrating;
    
    // Intelligence data
    doc["trend"] = round(state.trendSlope * 1000) / 1000.0;
    doc["threshold"] = round(state.adaptiveThreshold * 100) / 100.0;
    doc["noiseFloor"] = round(state.noiseFloor * 100) / 100.0;
    doc["recoveryAttempts"] = state.recoveryAttempts;
    doc["stableCount"] = state.stableCount;
    doc["mode"] = state.mode;
    
    // Advanced detection (new!)
    doc["confidence"] = round(state.confidence * 100) / 100.0;
    doc["variance"] = round(state.scoreVariance * 1000) / 1000.0;
    doc["delta"] = round(state.scoreDelta * 100) / 100.0;
    doc["predicted"] = round(state.predictedScore * 100) / 100.0;
    doc["ticksToChatter"] = state.ticksToChatter;
    
    // Pattern flags
    doc["risingChatter"] = state.risingChatter;
    doc["stableChatter"] = state.stableChatter;
    doc["intermittent"] = state.intermittent;
    
    // Material/operation info
    doc["material"] = PROFILES[currentProfileIndex].name;
    doc["materialIndex"] = currentProfileIndex;
    doc["operation"] = (int)currentOperation;
    doc["toolDia"] = toolDiameter;
    doc["toolFlutes"] = toolFlutes;
    doc["rpm"] = (int)spindleRPM;
    
    // Weights (for tuning UI)
    doc["wAudio"] = WEIGHT_AUDIO;
    doc["wAccel"] = WEIGHT_ACCEL;
    doc["wCurrent"] = WEIGHT_CURRENT;
    
    // Expected current range for this material
    doc["expectedAmpsLow"] = PROFILES[currentProfileIndex].typicalAmpsLow;
    doc["expectedAmpsHigh"] = PROFILES[currentProfileIndex].typicalAmpsHigh;
    
    // Spindle state (new!)
    doc["spindleRunning"] = state.spindleRunning;
    doc["cutting"] = state.cutting;
    doc["idleCurrent"] = round(state.idleCurrent * 100) / 100.0;
    
    // Cutting efficiency (new!)
    doc["efficiency"] = round(state.efficiency * 100) / 100.0;
    doc["bestFeed"] = state.bestFeedForMaterial;
    
    // Position (if available)
    doc["posX"] = round(state.posX * 100) / 100.0;
    doc["posY"] = round(state.posY * 100) / 100.0;
    doc["posZ"] = round(state.posZ * 100) / 100.0;
    
    // VFD telemetry (if enabled)
    if (vfd.state.enabled) {
        JsonObject vfdObj = doc.createNestedObject("vfd");
        vfdObj["ok"] = vfd.state.connected;
        vfdObj["run"] = vfd.state.running;
        vfdObj["freq"] = round(vfd.state.freqHz * 10) / 10.0;
        vfdObj["rpm"] = (int)vfd.state.rpm;
        vfdObj["amps"] = round(vfd.state.currentA * 10) / 10.0;
        vfdObj["dcv"] = (int)vfd.state.dcBusV;
        vfdObj["fault"] = vfd.state.faultCode;
        if (vfd.state.faultCode > 0) {
            vfdObj["faultStr"] = vfd.state.faultString;
        }
    }
    
    // Sensor health status (for UI diagnostics)
    JsonObject sensors = doc.createNestedObject("sensors");
    sensors["mpuOk"] = health.mpuOk;
    sensors["mpuErr"] = (int)health.mpuError;
    sensors["mpuErrStr"] = getSensorErrorString(health.mpuError);
    sensors["i2sOk"] = health.i2sOk;
    sensors["i2sErr"] = (int)health.i2sError;
    sensors["i2sErrStr"] = getSensorErrorString(health.i2sError);
    sensors["adcOk"] = health.adcOk;
    sensors["adcErr"] = (int)health.adcError;
    sensors["adcErrStr"] = getSensorErrorString(health.adcError);
    // VFD health (only if enabled)
    if (vfd.state.enabled) {
        sensors["vfdOk"] = health.vfdOk;
        sensors["vfdErr"] = (int)health.vfdError;
        sensors["vfdErrStr"] = getSensorErrorString(health.vfdError);
        if (vfd.state.faultCode > 0) {
            sensors["vfdFault"] = vfd.state.faultString;
        }
    }
    sensors["allOk"] = health.mpuOk && health.i2sOk && health.adcOk && (!vfd.state.enabled || health.vfdOk);
    
    String output;
    serializeJson(doc, output);
    ws.textAll(output);
}

void onWsEvent(AsyncWebSocket* server, AsyncWebSocketClient* client, 
               AwsEventType type, void* arg, uint8_t* data, size_t len) {
    if (type == WS_EVT_CONNECT) {
        Serial.printf("WebSocket client connected: %u\n", client->id());
        state.connected = true;
        // Send current config on connect
        StaticJsonDocument<256> welcome;
        welcome["type"] = "config";
        welcome["material"] = PROFILES[currentProfileIndex].name;
        welcome["materialIndex"] = currentProfileIndex;
        welcome["operation"] = (int)currentOperation;
        welcome["toolDia"] = toolDiameter;
        welcome["toolFlutes"] = toolFlutes;
        welcome["rpm"] = (int)spindleRPM;
        welcome["numMaterials"] = NUM_PROFILES;
        String out;
        serializeJson(welcome, out);
        client->text(out);
    }
    else if (type == WS_EVT_DISCONNECT) {
        Serial.printf("WebSocket client disconnected: %u\n", client->id());
        if (ws.count() == 0) state.connected = false;
    }
    else if (type == WS_EVT_DATA) {
        String msg = String((char*)data).substring(0, len);
        msg.trim();
        
        // Basic commands
        if (msg == "enable") {
            state.enabled = true;
            Serial.println("Chatter detection enabled");
        }
        else if (msg == "disable") {
            state.enabled = false;
            sendFeedOverride(100);
            state.inChatterZone = false;
            state.recoveryAttempts = 0;
            Serial.println("Chatter detection disabled");
        }
        else if (msg == "calibrate") {
            state.calibrating = true;
            state.calibrationSum = 0;
            state.calibrationCount = 0;
            Serial.println("Starting current calibration...");
        }
        else if (msg == "learn") {
            state.learning = true;
            state.learnSum = 0;
            state.learnCount = 0;
            Serial.println("Learning noise floor (10 seconds)...");
        }
        else if (msg == "reset") {
            state.toolBroken = false;
            state.overload = false;
            state.inChatterZone = false;
            state.recoveryAttempts = 0;
            state.stableCount = 0;
            state.chatterCount = 0;
            state.lastStableFeed = 100;
            sendFeedOverride(100);
            Serial.println("Full reset complete");
        }
        else if (msg == "ping") {
            client->text("{\"pong\":true}");
        }
        else if (msg == "getConfig") {
            // Send full config
            StaticJsonDocument<512> cfg;
            cfg["type"] = "config";
            cfg["material"] = PROFILES[currentProfileIndex].name;
            cfg["materialIndex"] = currentProfileIndex;
            cfg["operation"] = (int)currentOperation;
            cfg["toolDia"] = toolDiameter;
            cfg["toolFlutes"] = toolFlutes;
            cfg["rpm"] = (int)spindleRPM;
            cfg["numMaterials"] = NUM_PROFILES;
            // List all materials
            JsonArray mats = cfg.createNestedArray("materials");
            for (int i = 0; i < NUM_PROFILES; i++) {
                mats.add(PROFILES[i].name);
            }
            String out;
            serializeJson(cfg, out);
            client->text(out);
        }
        // Material selection
        else if (msg.startsWith("material:")) {
            String matName = msg.substring(9);
            matName.toLowerCase();
            for (int i = 0; i < NUM_PROFILES; i++) {
                if (matName == PROFILES[i].name) {
                    applyProfile(i);
                    client->text("{\"ok\":true,\"material\":\"" + String(PROFILES[i].name) + "\"}");
                    break;
                }
            }
        }
        else if (msg.startsWith("materialIndex:")) {
            int idx = msg.substring(14).toInt();
            if (idx >= 0 && idx < NUM_PROFILES) {
                applyProfile(idx);
                client->text("{\"ok\":true,\"material\":\"" + String(PROFILES[idx].name) + "\"}");
            }
        }
        // Operation type
        else if (msg.startsWith("operation:")) {
            String opName = msg.substring(10);
            opName.toLowerCase();
            if (opName == "roughing") applyOperation(OP_ROUGHING);
            else if (opName == "finishing") applyOperation(OP_FINISHING);
            else if (opName == "drilling") applyOperation(OP_DRILLING);
            else if (opName == "slotting") applyOperation(OP_SLOTTING);
            client->text("{\"ok\":true,\"operation\":\"" + opName + "\"}");
        }
        // Tool info
        else if (msg.startsWith("tool:")) {
            // Format: tool:6,2,10000 (diameter mm, flutes, rpm)
            String params = msg.substring(5);
            int c1 = params.indexOf(',');
            int c2 = params.indexOf(',', c1 + 1);
            if (c1 > 0 && c2 > c1) {
                toolDiameter = params.substring(0, c1).toFloat();
                toolFlutes = params.substring(c1 + 1, c2).toInt();
                spindleRPM = params.substring(c2 + 1).toFloat();
                Serial.printf("Tool: %.1fmm, %d flutes, %.0f RPM\n", toolDiameter, toolFlutes, spindleRPM);
                client->text("{\"ok\":true,\"toolDia\":" + String(toolDiameter) + 
                    ",\"toolFlutes\":" + String(toolFlutes) + 
                    ",\"rpm\":" + String((int)spindleRPM) + "}");
            }
        }
        // Mode switching
        else if (msg == "mode:auto") {
            state.mode = 0;
            applyProfile(currentProfileIndex);  // Reset to profile defaults
            Serial.println("Mode: Auto");
        }
        else if (msg == "mode:aggressive") {
            state.mode = 1;
            state.adaptiveThreshold = CHATTER_THRESHOLD * 0.75f;
            Serial.println("Mode: Aggressive");
        }
        else if (msg == "mode:conservative") {
            state.mode = 2;
            state.adaptiveThreshold = CHATTER_THRESHOLD * 1.25f;
            Serial.println("Mode: Conservative");
        }
        // Save settings to flash
        else if (msg == "save") {
            saveSettings();
            client->text("{\"ok\":true,\"saved\":true}");
        }
        // Auto-calibrate idle current
        else if (msg == "autoCal") {
            autoCalibrate();
            client->text("{\"ok\":true,\"idleCurrent\":" + String(state.idleCurrent) + "}");
        }
        // Get statistics
        else if (msg == "stats") {
            StaticJsonDocument<256> stats;
            stats["type"] = "stats";
            stats["totalChatterEvents"] = state.totalChatterEvents;
            stats["totalCuttingTime"] = state.totalCuttingTime / 1000;  // seconds
            stats["maxChatterScore"] = state.maxChatterScore;
            stats["chatterEventCount"] = state.chatterEventCount;
            String out;
            serializeJson(stats, out);
            client->text(out);
        }
        // Reset statistics
        else if (msg == "resetStats") {
            state.totalChatterEvents = 0;
            state.totalCuttingTime = 0;
            state.maxChatterScore = 0;
            state.chatterEventCount = 0;
            client->text("{\"ok\":true,\"statsReset\":true}");
        }
        // Set RPM directly (from FluidCNC spindle feedback)
        else if (msg.startsWith("rpm:")) {
            spindleRPM = msg.substring(4).toFloat();
            Serial.printf("RPM updated: %.0f\n", spindleRPM);
        }
        // Get FFT spectrum data for debugging/visualization
        else if (msg == "spectrum") {
            // Send top 16 frequency bins for each sensor
            StaticJsonDocument<1024> spectrum;
            spectrum["type"] = "spectrum";
            
            // Audio spectrum (most relevant bins)
            JsonArray audioArr = spectrum.createNestedArray("audio");
            for (int i = AUDIO_BIN_START; i < min(AUDIO_BIN_START + 32, AUDIO_BIN_END); i++) {
                audioArr.add((int)(audioReal[i] * 1000));  // Scale for transmission
            }
            
            // Accel spectrum
            JsonArray accelArr = spectrum.createNestedArray("accel");
            for (int i = ACCEL_BIN_START; i < min(ACCEL_BIN_START + 16, ACCEL_BIN_END); i++) {
                accelArr.add((int)(accelReal[i] * 1000));
            }
            
            // Frequency info
            float binWidthAudio = (float)AUDIO_SAMPLE_RATE / AUDIO_FFT_SIZE;
            float binWidthAccel = (float)ACCEL_SAMPLE_RATE / ACCEL_FFT_SIZE;
            spectrum["audioStartHz"] = (int)(AUDIO_BIN_START * binWidthAudio);
            spectrum["audioHzPerBin"] = (int)binWidthAudio;
            spectrum["accelStartHz"] = (int)(ACCEL_BIN_START * binWidthAccel);
            spectrum["accelHzPerBin"] = (int)binWidthAccel;
            spectrum["dominantFreq"] = (int)state.dominantFreq;
            
            String out;
            serializeJson(spectrum, out);
            client->text(out);
        }
        // Get diagnostic info (enhanced with system health)
        else if (msg == "diag") {
            StaticJsonDocument<768> diag;
            diag["type"] = "diagnostic";
            
            // System info
            diag["freeHeap"] = ESP.getFreeHeap();
            diag["minFreeHeap"] = ESP.getMinFreeHeap();
            diag["heapSize"] = ESP.getHeapSize();
            diag["uptime"] = millis() / 1000;
            diag["uptimeStr"] = String(millis() / 3600000) + "h " + String((millis() % 3600000) / 60000) + "m";
            diag["cpuFreq"] = ESP.getCpuFreqMHz();
            diag["flashSize"] = ESP.getFlashChipSize() / 1024;  // KB
            diag["sketchSize"] = ESP.getSketchSize() / 1024;     // KB
            diag["freeSketch"] = ESP.getFreeSketchSpace() / 1024; // KB
            
            // WiFi info
            diag["wifiRSSI"] = WiFi.RSSI();
            diag["wifiSSID"] = WiFi.SSID();
            diag["apMode"] = apModeActive;
            diag["ip"] = apModeActive ? WiFi.softAPIP().toString() : WiFi.localIP().toString();
            diag["mac"] = WiFi.macAddress();
            
            // WebSocket info
            diag["wsClients"] = ws.count();
            
            // Chatter detection config
            diag["material"] = PROFILES[currentProfileIndex].name;
            diag["audioRange"] = String(PROFILES[currentProfileIndex].audioFreqLow) + "-" + 
                                 String(PROFILES[currentProfileIndex].audioFreqHigh) + "Hz";
            diag["accelRange"] = String(PROFILES[currentProfileIndex].accelFreqLow) + "-" + 
                                 String(PROFILES[currentProfileIndex].accelFreqHigh) + "Hz";
            diag["toothPassFreq"] = (int)calculateToothPassFrequency();
            diag["threshold"] = state.adaptiveThreshold;
            diag["noiseFloor"] = state.noiseFloor;
            
            // Session stats
            diag["chatterEvents"] = state.totalChatterEvents;
            diag["cuttingTime"] = state.totalCuttingTime / 1000;
            diag["maxScore"] = state.maxChatterScore;
            
            // Sensor health status
            JsonObject sensors = diag.createNestedObject("sensors");
            sensors["mpu"] = health.mpuOk ? "OK" : getSensorErrorString(health.mpuError);
            sensors["mpuCode"] = (int)health.mpuError;
            sensors["i2s"] = health.i2sOk ? "OK" : getSensorErrorString(health.i2sError);
            sensors["i2sCode"] = (int)health.i2sError;
            sensors["adc"] = health.adcOk ? "OK" : getSensorErrorString(health.adcError);
            sensors["adcCode"] = (int)health.adcError;
            // VFD health (only if enabled)
            if (vfd.state.enabled) {
                sensors["vfd"] = health.vfdOk ? "OK" : getSensorErrorString(health.vfdError);
                sensors["vfdCode"] = (int)health.vfdError;
                if (vfd.state.faultCode > 0) {
                    sensors["vfdFault"] = vfd.state.faultString;
                }
            }
            sensors["allOk"] = health.mpuOk && health.i2sOk && health.adcOk && (!vfd.state.enabled || health.vfdOk);
            
            String out;
            serializeJson(diag, out);
            client->text(out);
        }
        // Switch to AP mode for WiFi setup
        else if (msg == "apMode" || msg == "setupWifi") {
            client->text("{\"ok\":true,\"msg\":\"Switching to AP mode...\"}");
            delay(500);
            WiFi.disconnect();
            WiFi.mode(WIFI_AP);
            WiFi.softAPConfig(AP_IP, AP_GATEWAY, AP_SUBNET);
            WiFi.softAP(AP_SSID, AP_PASS);
            apModeActive = true;
            Serial.printf("AP Mode started: %s @ %s\n", AP_SSID, WiFi.softAPIP().toString().c_str());
        }
        // Reboot ESP32
        else if (msg == "reboot") {
            client->text("{\"ok\":true,\"msg\":\"Rebooting...\"}");
            delay(500);
            ESP.restart();
        }
        // Get network info
        else if (msg == "network" || msg == "getNetwork") {
            StaticJsonDocument<256> net;
            net["type"] = "network";
            net["apMode"] = apModeActive;
            net["ssid"] = apModeActive ? AP_SSID : WiFi.SSID();
            net["ip"] = apModeActive ? WiFi.softAPIP().toString() : WiFi.localIP().toString();
            net["rssi"] = apModeActive ? 0 : WiFi.RSSI();
            net["hostname"] = MDNS_HOSTNAME;
            String out;
            serializeJson(net, out);
            client->text(out);
        }
        // Weight adjustment (JSON format: {"wAudio":0.3,"wAccel":0.4,"wCurrent":0.3})
        else if (msg.startsWith("{")) {
            StaticJsonDocument<128> cmdDoc;
            if (deserializeJson(cmdDoc, msg) == DeserializationError::Ok) {
                if (cmdDoc.containsKey("wAudio")) weightAudio = cmdDoc["wAudio"];
                if (cmdDoc.containsKey("wAccel")) weightAccel = cmdDoc["wAccel"];
                if (cmdDoc.containsKey("wCurrent")) weightCurrent = cmdDoc["wCurrent"];
                if (cmdDoc.containsKey("threshold")) state.adaptiveThreshold = cmdDoc["threshold"];
                Serial.printf("Weights updated: A=%.2f V=%.2f C=%.2f T=%.2f\n", 
                    weightAudio, weightAccel, weightCurrent, state.adaptiveThreshold);
            }
        }
        // Get chatter map (positions where chatter was detected)
        else if (msg == "chatterMap" || msg == "map") {
            StaticJsonDocument<2048> mapDoc;
            mapDoc["type"] = "chatterMap";
            mapDoc["count"] = state.chatterPosCount;
            
            JsonArray positions = mapDoc.createNestedArray("positions");
            for (int i = 0; i < state.chatterPosCount; i++) {
                JsonObject pos = positions.createNestedObject();
                pos["x"] = round(state.chatterPosX[i] * 100) / 100.0;
                pos["y"] = round(state.chatterPosY[i] * 100) / 100.0;
                pos["z"] = round(state.chatterPosZ[i] * 100) / 100.0;
                pos["score"] = round(state.chatterScores[i] * 100) / 100.0;
            }
            
            String out;
            serializeJson(mapDoc, out);
            client->text(out);
        }
        // Clear chatter map
        else if (msg == "clearMap") {
            state.chatterPosCount = 0;
            state.chatterPosIndex = 0;
            for (int i = 0; i < 32; i++) {
                state.chatterPosX[i] = 0;
                state.chatterPosY[i] = 0;
                state.chatterPosZ[i] = 0;
                state.chatterScores[i] = 0;
            }
            client->text("{\"ok\":true,\"mapCleared\":true}");
        }
        // Update position from FluidCNC
        else if (msg.startsWith("pos:")) {
            String params = msg.substring(4);
            int c1 = params.indexOf(',');
            int c2 = params.indexOf(',', c1 + 1);
            if (c1 > 0 && c2 > c1) {
                state.posX = params.substring(0, c1).toFloat();
                state.posY = params.substring(c1 + 1, c2).toFloat();
                state.posZ = params.substring(c2 + 1).toFloat();
            }
        }
        // Get ML features (for training)
        else if (msg == "features" || msg == "mlFeatures") {
            StaticJsonDocument<512> featureDoc;
            featureDoc["type"] = "features";
            featureDoc["sampleCount"] = state.sampleCount;
            featureDoc["label"] = state.chatterDetected ? 1 : 0;  // For training
            
            JsonArray features = featureDoc.createNestedArray("features");
            for (int i = 0; i < 16; i++) {
                features.add(round(state.features[i] * 10000) / 10000.0);
            }
            
            String out;
            serializeJson(featureDoc, out);
            client->text(out);
        }
        // Get advanced analysis data
        else if (msg == "analysis" || msg == "advanced") {
            StaticJsonDocument<512> analysisDoc;
            analysisDoc["type"] = "analysis";
            
            // Frequency bands
            analysisDoc["lowBand"] = round(state.lowBandEnergy * 100) / 100.0;
            analysisDoc["midBand"] = round(state.midBandEnergy * 100) / 100.0;
            analysisDoc["highBand"] = round(state.highBandEnergy * 100) / 100.0;
            
            // Harmonics
            analysisDoc["harmonicsDetected"] = state.harmonicsDetected;
            analysisDoc["harmonicRatio"] = round(state.harmonicRatio * 100) / 100.0;
            JsonArray harmonics = analysisDoc.createNestedArray("harmonicFreqs");
            for (int i = 0; i < 5; i++) {
                harmonics.add((int)state.harmonicFreqs[i]);
            }
            
            // Pattern detection
            analysisDoc["risingChatter"] = state.risingChatter;
            analysisDoc["stableChatter"] = state.stableChatter;
            analysisDoc["intermittent"] = state.intermittent;
            
            // Prediction
            analysisDoc["confidence"] = round(state.confidence * 100) / 100.0;
            analysisDoc["predicted"] = round(state.predictedScore * 100) / 100.0;
            analysisDoc["ticksToChatter"] = state.ticksToChatter;
            analysisDoc["variance"] = round(state.scoreVariance * 1000) / 1000.0;
            
            String out;
            serializeJson(analysisDoc, out);
            client->text(out);
        }
        // Set sensor weights dynamically
        else if (msg.startsWith("weights:")) {
            String params = msg.substring(8);
            int c1 = params.indexOf(',');
            int c2 = params.indexOf(',', c1 + 1);
            if (c1 > 0 && c2 > c1) {
                weightAudio = params.substring(0, c1).toFloat();
                weightAccel = params.substring(c1 + 1, c2).toFloat();
                weightCurrent = params.substring(c2 + 1).toFloat();
                Serial.printf("Weights: A=%.2f V=%.2f C=%.2f\n", weightAudio, weightAccel, weightCurrent);
                client->text("{\"ok\":true}");
            }
        }
        // Export all settings as JSON
        else if (msg == "exportSettings") {
            StaticJsonDocument<512> settings;
            settings["type"] = "settings";
            settings["material"] = currentProfileIndex;
            settings["operation"] = (int)currentOperation;
            settings["toolDia"] = toolDiameter;
            settings["toolFlutes"] = toolFlutes;
            settings["rpm"] = spindleRPM;
            settings["baseline"] = state.baselineCurrent;
            settings["noiseFloor"] = state.noiseFloor;
            settings["idleCurrent"] = state.idleCurrent;
            settings["mode"] = state.mode;
            settings["threshold"] = state.adaptiveThreshold;
            settings["wAudio"] = weightAudio;
            settings["wAccel"] = weightAccel;
            settings["wCurrent"] = weightCurrent;
            String out;
            serializeJson(settings, out);
            client->text(out);
        }
    }
}

// ============================================================================
// TFT DISPLAY - BEAUTIFUL ROUND GUI FOR 1.28" GC9A01
// ============================================================================

// Draw a filled arc (for gauges)
void drawArc(int x, int y, int r, int startAngle, int endAngle, int thickness, uint16_t color) {
    for (int i = startAngle; i <= endAngle; i++) {
        float rad = i * DEG_TO_RAD;
        for (int t = 0; t < thickness; t++) {
            int px = x + (r - t) * cos(rad);
            int py = y + (r - t) * sin(rad);
            sprite.drawPixel(px, py, color);
        }
    }
}

// Get color based on score (green->yellow->red gradient)
uint16_t getScoreColor(float score, float threshold) {
    if (score < threshold * 0.5f) return COLOR_GREEN;
    if (score < threshold * 0.75f) return COLOR_YELLOW;
    if (score < threshold) return COLOR_ORANGE;
    return COLOR_RED;
}

// Draw the main circular gauge
void drawMainGauge(float score, float threshold, bool inChatterZone) {
    int gaugeRadius = 95;
    int gaugeThickness = 12;
    int startAngle = 135;   // Bottom-left
    int endAngle = 405;     // Bottom-right (270° arc)
    
    // Background arc (dark gray)
    drawArc(TFT_CENTER_X, TFT_CENTER_Y, gaugeRadius, startAngle, endAngle, gaugeThickness, COLOR_DARK_GRAY);
    
    // Score arc (colored based on level)
    int scoreAngle = startAngle + (int)((endAngle - startAngle) * min(score, 1.0f));
    uint16_t scoreColor = getScoreColor(score, threshold);
    drawArc(TFT_CENTER_X, TFT_CENTER_Y, gaugeRadius, startAngle, scoreAngle, gaugeThickness, scoreColor);
    
    // Threshold marker
    int threshAngle = startAngle + (int)((endAngle - startAngle) * threshold);
    float threshRad = threshAngle * DEG_TO_RAD;
    int tx1 = TFT_CENTER_X + (gaugeRadius - gaugeThickness - 2) * cos(threshRad);
    int ty1 = TFT_CENTER_Y + (gaugeRadius - gaugeThickness - 2) * sin(threshRad);
    int tx2 = TFT_CENTER_X + (gaugeRadius + 3) * cos(threshRad);
    int ty2 = TFT_CENTER_Y + (gaugeRadius + 3) * sin(threshRad);
    sprite.drawLine(tx1, ty1, tx2, ty2, COLOR_YELLOW);
}

// Draw center status area
void drawCenterStatus(float score, int feed, bool cutting, bool chatter) {
    // Large score number in center
    sprite.setTextDatum(MC_DATUM);
    
    if (chatter) {
        // Flashing CHATTER warning
        static bool flash = false;
        flash = !flash;
        if (flash) {
            sprite.setTextColor(COLOR_RED);
            sprite.setTextSize(2);
            sprite.drawString("CHATTER!", TFT_CENTER_X, TFT_CENTER_Y - 20);
        }
    }
    
    // Score value
    char scoreStr[8];
    sprintf(scoreStr, "%.2f", score);
    sprite.setTextColor(getScoreColor(score, state.adaptiveThreshold));
    sprite.setTextSize(3);
    sprite.drawString(scoreStr, TFT_CENTER_X, TFT_CENTER_Y + (chatter ? 10 : 0));
    
    // Feed override below
    sprite.setTextColor(COLOR_WHITE);
    sprite.setTextSize(1);
    char feedStr[16];
    sprintf(feedStr, "FEED %d%%", feed);
    sprite.drawString(feedStr, TFT_CENTER_X, TFT_CENTER_Y + 35);
    
    // Status label
    sprite.setTextSize(1);
    if (!cutting) {
        sprite.setTextColor(COLOR_GRAY);
        sprite.drawString("IDLE", TFT_CENTER_X, TFT_CENTER_Y + 50);
    } else if (chatter) {
        sprite.setTextColor(COLOR_RED);
        sprite.drawString("REDUCING FEED", TFT_CENTER_X, TFT_CENTER_Y + 50);
    } else {
        sprite.setTextColor(COLOR_GREEN);
        sprite.drawString("CUTTING", TFT_CENTER_X, TFT_CENTER_Y + 50);
    }
}

// Draw outer ring with status icons
void drawStatusRing() {
    int iconRadius = 105;
    
    // WiFi icon (top)
    sprite.setTextDatum(MC_DATUM);
    sprite.setTextSize(1);
    sprite.setTextColor(state.connected ? COLOR_GREEN : COLOR_RED);
    float wifiAngle = -90 * DEG_TO_RAD;
    int wx = TFT_CENTER_X + iconRadius * cos(wifiAngle);
    int wy = TFT_CENTER_Y + iconRadius * sin(wifiAngle);
    sprite.drawString(state.connected ? "WiFi" : "----", wx, wy);
    
    // Material (left)
    sprite.setTextColor(COLOR_BLUE);
    float matAngle = 180 * DEG_TO_RAD;
    int mx = TFT_CENTER_X + (iconRadius - 15) * cos(matAngle);
    int my = TFT_CENTER_Y + (iconRadius - 15) * sin(matAngle);
    String matShort = String(PROFILES[currentProfileIndex].name).substring(0, 4);
    matShort.toUpperCase();
    sprite.drawString(matShort, mx, my);
    
    // RPM (right)
    sprite.setTextColor(COLOR_ORANGE);
    float rpmAngle = 0 * DEG_TO_RAD;
    int rx = TFT_CENTER_X + (iconRadius - 15) * cos(rpmAngle);
    int ry = TFT_CENTER_Y + (iconRadius - 15) * sin(rpmAngle);
    char rpmStr[8];
    if (spindleRPM >= 1000) {
        sprintf(rpmStr, "%.1fK", spindleRPM / 1000.0f);
    } else {
        sprintf(rpmStr, "%.0f", spindleRPM);
    }
    sprite.drawString(rpmStr, rx, ry);
}

// Draw small sensor bars at bottom
void drawSensorBars() {
    int barY = 200;
    int barH = 8;
    int barW = 50;
    int gap = 10;
    int startX = (TFT_WIDTH - (3 * barW + 2 * gap)) / 2;
    
    // Audio bar
    sprite.setTextDatum(TC_DATUM);
    sprite.setTextSize(1);
    sprite.setTextColor(COLOR_GRAY);
    sprite.drawString("A", startX + barW/2, barY - 10);
    sprite.drawRect(startX, barY, barW, barH, COLOR_DARK_GRAY);
    int aFill = (int)(barW * min(state.audioScore, 1.0f));
    sprite.fillRect(startX, barY, aFill, barH, getScoreColor(state.audioScore, state.adaptiveThreshold));
    
    // Accel bar
    int ax = startX + barW + gap;
    sprite.drawString("V", ax + barW/2, barY - 10);
    sprite.drawRect(ax, barY, barW, barH, COLOR_DARK_GRAY);
    int vFill = (int)(barW * min(state.accelScore, 1.0f));
    sprite.fillRect(ax, barY, vFill, barH, getScoreColor(state.accelScore, state.adaptiveThreshold));
    
    // Current bar
    int cx = ax + barW + gap;
    sprite.drawString("I", cx + barW/2, barY - 10);
    sprite.drawRect(cx, barY, barW, barH, COLOR_DARK_GRAY);
    int cFill = (int)(barW * min(state.currentScore, 1.0f));
    sprite.fillRect(cx, barY, cFill, barH, getScoreColor(state.currentScore, state.adaptiveThreshold));
}

// Draw trend arrow
void drawTrendArrow() {
    int arrowX = TFT_CENTER_X;
    int arrowY = TFT_CENTER_Y - 50;
    
    if (state.trendSlope > 0.02f) {
        // Rising fast - double up arrow (red)
        sprite.setTextColor(COLOR_RED);
        sprite.setTextDatum(MC_DATUM);
        sprite.setTextSize(2);
        sprite.drawString("^^", arrowX, arrowY);
    } else if (state.trendSlope > 0.005f) {
        // Rising - up arrow (yellow)
        sprite.setTextColor(COLOR_YELLOW);
        sprite.setTextDatum(MC_DATUM);
        sprite.setTextSize(2);
        sprite.drawString("^", arrowX, arrowY);
    } else if (state.trendSlope < -0.02f) {
        // Falling fast - double down arrow (green)
        sprite.setTextColor(COLOR_GREEN);
        sprite.setTextDatum(MC_DATUM);
        sprite.setTextSize(2);
        sprite.drawString("vv", arrowX, arrowY);
    } else if (state.trendSlope < -0.005f) {
        // Falling - down arrow (green)
        sprite.setTextColor(COLOR_GREEN);
        sprite.setTextDatum(MC_DATUM);
        sprite.setTextSize(2);
        sprite.drawString("v", arrowX, arrowY);
    }
    // If stable, show nothing
}

// Draw AI status indicator
void drawAIStatus() {
    // Small AI badge at top-left
    int badgeX = 35;
    int badgeY = 35;
    
    // Pulsing effect when active
    static uint8_t pulse = 0;
    pulse += 8;
    uint8_t brightness = 128 + (sin(pulse * 0.05f) * 127);
    
    if (state.enabled && state.cutting) {
        // AI actively monitoring - pulsing blue
        uint16_t pulseColor = tft.color565(0, brightness/4, brightness);
        sprite.fillCircle(badgeX, badgeY, 12, pulseColor);
        sprite.setTextColor(COLOR_WHITE);
    } else if (state.enabled) {
        // AI enabled but idle
        sprite.fillCircle(badgeX, badgeY, 12, COLOR_DARK_GRAY);
        sprite.setTextColor(COLOR_GRAY);
    } else {
        // AI disabled
        sprite.drawCircle(badgeX, badgeY, 12, COLOR_RED);
        sprite.setTextColor(COLOR_RED);
    }
    
    sprite.setTextDatum(MC_DATUM);
    sprite.setTextSize(1);
    sprite.drawString("AI", badgeX, badgeY);
}

// Draw FluidCNC connection status
void drawFluidStatus() {
    int badgeX = TFT_WIDTH - 35;
    int badgeY = 35;
    
    if (state.connected) {
        sprite.fillCircle(badgeX, badgeY, 12, COLOR_GREEN);
        sprite.setTextColor(COLOR_BG);
    } else {
        sprite.drawCircle(badgeX, badgeY, 12, COLOR_ORANGE);
        sprite.setTextColor(COLOR_ORANGE);
    }
    
    sprite.setTextDatum(MC_DATUM);
    sprite.setTextSize(1);
    sprite.drawString("WS", badgeX, badgeY);
}

// Main display update function
void updateDisplay() {
    // Check if we need to update (avoid flicker)
    bool scoreChanged = abs(state.combinedScore - displayState.lastScore) > 0.01f;
    bool feedChanged = state.feedOverride != displayState.lastFeed;
    bool chatterChanged = state.inChatterZone != displayState.lastChatter;
    bool connectionChanged = state.connected != displayState.lastConnected;
    bool cuttingChanged = state.cutting != displayState.lastCutting;
    
    // Full redraw every 5 seconds or on major state change
    bool needsUpdate = scoreChanged || feedChanged || chatterChanged || 
                       connectionChanged || cuttingChanged || displayState.needsFullRedraw;
    
    if (!needsUpdate) return;
    
    // Allocate sprite once (avoids heap fragmentation)
    if (!spriteReady) {
        sprite.setColorDepth(16);
        sprite.createSprite(TFT_WIDTH, TFT_HEIGHT);
        spriteReady = true;
    }

    // Black background so square corners are hidden behind the round panel
    sprite.fillSprite(0x0000);
    sprite.fillCircle(TFT_CENTER_X, TFT_CENTER_Y, TFT_RADIUS + 5, COLOR_BG);
    
    // Draw all elements
    drawMainGauge(state.combinedScore, state.adaptiveThreshold, state.inChatterZone);
    drawCenterStatus(state.combinedScore, state.feedOverride, state.cutting, state.inChatterZone);
    drawStatusRing();
    drawSensorBars();
    drawTrendArrow();
    drawAIStatus();
    drawFluidStatus();
    
    // Push sprite to display
    sprite.pushSprite(0, 0);
    
    // Update state tracking
    displayState.lastScore = state.combinedScore;
    displayState.lastFeed = state.feedOverride;
    displayState.lastChatter = state.inChatterZone;
    displayState.lastConnected = state.connected;
    displayState.lastCutting = state.cutting;
    displayState.needsFullRedraw = false;
}

// Initialize the TFT display
void setupDisplay() {
    // Initialize TFT
    tft.init();
    tft.setRotation(0);  // Adjust based on mounting
    tft.fillScreen(COLOR_BG);
    
    // Setup backlight
    pinMode(TFT_BL, OUTPUT);
    digitalWrite(TFT_BL, HIGH);

    // Prepare sprite buffer once
    if (!spriteReady) {
        sprite.setColorDepth(16);
        sprite.createSprite(TFT_WIDTH, TFT_HEIGHT);
        spriteReady = true;
    }
    
    // Show boot screen
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(COLOR_WHITE);
    tft.setTextSize(2);
    tft.drawString("FluidCNC", TFT_CENTER_X, TFT_CENTER_Y - 30);
    tft.setTextSize(1);
    tft.setTextColor(COLOR_BLUE);
    tft.drawString("Chatter Detection", TFT_CENTER_X, TFT_CENTER_Y);
    tft.setTextColor(COLOR_GRAY);
    tft.drawString("Initializing...", TFT_CENTER_X, TFT_CENTER_Y + 30);
    
    // Draw boot animation - expanding rings
    for (int r = 10; r < TFT_RADIUS; r += 15) {
        tft.drawCircle(TFT_CENTER_X, TFT_CENTER_Y, r, COLOR_BLUE);
        delay(30);
    }
    
    delay(500);
    
    displayState.needsFullRedraw = true;
    Serial.println("✓ TFT Display initialized (GC9A01 240x240)");
}

// Show WiFi connection status on display
void displayWiFiStatus(const char* status, bool connected) {
    tft.fillRect(0, TFT_CENTER_Y + 20, TFT_WIDTH, 40, COLOR_BG);
    tft.setTextDatum(MC_DATUM);
    tft.setTextSize(1);
    tft.setTextColor(connected ? COLOR_GREEN : COLOR_YELLOW);
    tft.drawString(status, TFT_CENTER_X, TFT_CENTER_Y + 40);
}

// Show init progress on display
void displayInitProgress(const char* item, bool success) {
    static int progY = 100;
    tft.setTextDatum(ML_DATUM);
    tft.setTextSize(1);
    tft.setTextColor(success ? COLOR_GREEN : COLOR_RED);
    tft.drawString(success ? "+" : "x", 50, progY);
    tft.setTextColor(COLOR_WHITE);
    tft.drawString(item, 65, progY);
    progY += 15;
    if (progY > 200) progY = 100;
}

// ============================================================================
// WEB SERVER SETUP
// ============================================================================

// HTML page for WiFi configuration
const char CONFIG_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chatter Detect Setup</title>
<style>
body{font-family:Arial;background:#1a1a2e;color:#fff;padding:20px;max-width:400px;margin:0 auto;}
h1{color:#4ade80;text-align:center;}h2{color:#fbbf24;}
input,button{width:100%;padding:12px;margin:8px 0;border:none;border-radius:8px;font-size:16px;box-sizing:border-box;}
input{background:#2d2d44;color:#fff;}button{background:#4ade80;color:#000;cursor:pointer;font-weight:bold;}
button:hover{background:#22c55e;}.card{background:#16213e;padding:20px;border-radius:12px;margin:15px 0;}
.status{padding:10px;border-radius:8px;text-align:center;margin:10px 0;}
.ok{background:#166534;}.err{background:#991b1b;}
a{color:#60a5fa;}
</style></head><body>
<h1>🔧 Chatter Detect</h1>
<div class="card">
<h2>WiFi Setup</h2>
<form action="/saveWifi" method="POST">
<input type="text" name="ssid" placeholder="WiFi Network Name" required>
<input type="password" name="pass" placeholder="WiFi Password">
<button type="submit">💾 Save & Connect</button>
</form>
</div>
<div class="card">
<h2>Current Status</h2>
<p>Mode: <b>%MODE%</b></p>
<p>IP: <b>%IP%</b></p>
<p>RSSI: <b>%RSSI% dBm</b></p>
<p>Heap: <b>%HEAP% bytes</b></p>
</div>
<div class="card">
<h2>Firmware Update</h2>
<form method="POST" action="/update" enctype="multipart/form-data">
<input type="file" name="update" accept=".bin" required>
<button type="submit">⬆️ Upload Firmware</button>
</form>
</div>
<p style="text-align:center;font-size:12px;">Connect to FluidCNC: <a href="http://chatter.local">chatter.local</a></p>
</body></html>
)rawliteral";

// HTML for OTA update result
const char UPDATE_OK_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="15;url=/">
<title>Update OK</title>
<style>body{font-family:Arial;background:#1a1a2e;color:#fff;text-align:center;padding:50px;}
h1{color:#4ade80;}</style>
</head><body><h1>✅ Update Successful!</h1><p>Rebooting in 15 seconds...</p></body></html>
)rawliteral";

const char UPDATE_FAIL_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Update Failed</title>
<style>body{font-family:Arial;background:#1a1a2e;color:#fff;text-align:center;padding:50px;}
h1{color:#ef4444;}</style>
</head><body><h1>❌ Update Failed</h1><p>Please try again.</p><a href="/" style="color:#60a5fa;">Back</a></body></html>
)rawliteral";

void setupWebServer() {
    // CORS headers for FluidCNC UI
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "*");
    
    // Main page - config portal
    server.on("/", HTTP_GET, [](AsyncWebServerRequest* request) {
        String html = FPSTR(CONFIG_HTML);
        html.replace("%MODE%", apModeActive ? "AP Hotspot" : "WiFi Client");
        html.replace("%IP%", WiFi.localIP().toString());
        html.replace("%RSSI%", String(WiFi.RSSI()));
        html.replace("%HEAP%", String(ESP.getFreeHeap()));
        request->send(200, "text/html", html);
    });
    
    // Save WiFi credentials
    server.on("/saveWifi", HTTP_POST, [](AsyncWebServerRequest* request) {
        if (request->hasParam("ssid", true)) {
            String newSSID = request->getParam("ssid", true)->value();
            String newPass = request->getParam("pass", true)->value();
            
            // Save to preferences
            prefs.begin("wifi", false);
            prefs.putString("ssid", newSSID);
            prefs.putString("pass", newPass);
            prefs.end();
            
            Serial.printf("WiFi credentials saved: %s\n", newSSID.c_str());
            
            request->send(200, "text/html", "<html><body style='background:#1a1a2e;color:#fff;text-align:center;padding:50px;font-family:Arial;'>"
                "<h1 style='color:#4ade80;'>✅ Saved!</h1><p>Rebooting to connect to: " + newSSID + "</p></body></html>");
            
            delay(1000);
            ESP.restart();
        } else {
            request->send(400, "text/plain", "Missing SSID");
        }
    });
    
    // Web-based OTA update
    server.on("/update", HTTP_POST, 
        [](AsyncWebServerRequest* request) {
            bool success = !Update.hasError();
            request->send(200, "text/html", success ? FPSTR(UPDATE_OK_HTML) : FPSTR(UPDATE_FAIL_HTML));
            if (success) {
                delay(1000);
                ESP.restart();
            }
        },
        [](AsyncWebServerRequest* request, String filename, size_t index, uint8_t* data, size_t len, bool final) {
            if (!index) {
                Serial.printf("OTA Update: %s\n", filename.c_str());
                state.enabled = false;  // Disable chatter detection
                if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
                    Update.printError(Serial);
                }
            }
            if (Update.write(data, len) != len) {
                Update.printError(Serial);
            }
            if (final) {
                if (Update.end(true)) {
                    Serial.printf("OTA Success: %u bytes\n", index + len);
                } else {
                    Update.printError(Serial);
                }
            }
        }
    );
    
    // Status JSON endpoint
    server.on("/status", HTTP_GET, [](AsyncWebServerRequest* request) {
        StaticJsonDocument<256> doc;
        doc["audio"] = state.audioScore;
        doc["accel"] = state.accelScore;
        doc["current"] = state.currentScore;
        doc["combined"] = state.combinedScore;
        doc["amps"] = state.currentAmps;
        doc["feed"] = state.feedOverride;
        doc["enabled"] = state.enabled;
        
        String output;
        serializeJson(doc, output);
        request->send(200, "application/json", output);
    });
    
    // WebSocket
    ws.onEvent(onWsEvent);
    server.addHandler(&ws);
    
    server.begin();
    Serial.println("Web server started on port 80");
}

// ============================================================================
// SETUP
// ============================================================================

void setup() {
    Serial.begin(115200);
    Serial.println("\n\n=== CNC Chatter Detection System ===");
    Serial.println("ESP32 DevKit 38-pin");
    Serial.println("Triple Sensor Fusion: MPU-6050 + INMP441 + ACS712\n");
    
    // Initialize TFT Display FIRST (shows boot screen)
    setupDisplay();
    
    // Clear screen for init progress
    tft.fillScreen(COLOR_BG);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(COLOR_WHITE);
    tft.setTextSize(1);
    tft.drawString("Initializing...", TFT_CENTER_X, 40);
    
    // Initialize I2C for MPU-6050
    Wire.begin(I2C_SDA, I2C_SCL);
    mpu.initialize();
    bool mpuOk = mpu.testConnection();
    if (mpuOk) {
        Serial.println("✓ MPU-6050 connected");
        mpu.setFullScaleAccelRange(MPU6050_ACCEL_FS_8);  // ±8g
        mpu.setDLPFMode(MPU6050_DLPF_BW_42);  // 42Hz bandwidth
    } else {
        Serial.println("✗ MPU-6050 not found!");
    }
    displayInitProgress("MPU-6050 Accel", mpuOk);
    
    // Initialize I2S for INMP441
    setupI2S();
    Serial.println("✓ I2S microphone initialized");
    displayInitProgress("INMP441 Mic", true);
    
    // Initialize ADC for ACS712
    analogReadResolution(12);
    analogSetAttenuation(ADC_11db);  // Full 0-3.3V range
    pinMode(CURRENT_ADC_PIN, INPUT);
    Serial.println("✓ Current sensor ADC configured");
    displayInitProgress("ACS712 Current", true);
    
    // Initialize UART to grblHAL
    grblSerial.begin(115200, SERIAL_8N1, GRBL_RX, GRBL_TX);
    Serial.println("✓ UART to grblHAL initialized");
    displayInitProgress("grblHAL UART", true);
    
    // Initialize VFD Modbus (optional - enable if RS-485 module connected)
    // Uncomment the next line to enable VFD telemetry:
    // vfd.begin();
    // vfd.setSpindleConfig(400.0f, 24000.0f, 4);  // maxFreq=400Hz, maxRPM=24000, 4-pole
    if (vfd.state.enabled) {
        displayInitProgress("VFD Modbus", true);
    }
    
    // Load saved WiFi credentials (if any)
    prefs.begin("wifi", true);  // Read-only
    configuredSSID = prefs.getString("ssid", "");
    configuredPass = prefs.getString("pass", "");
    prefs.end();
    
    // Use saved credentials if available, otherwise use defaults
    const char* useSSID = configuredSSID.length() > 0 ? configuredSSID.c_str() : WIFI_SSID;
    const char* usePass = configuredPass.length() > 0 ? configuredPass.c_str() : WIFI_PASS;
    
    // Try to connect to WiFi
    Serial.printf("Connecting to WiFi: %s", useSSID);
    displayWiFiStatus("Connecting WiFi...", false);
    WiFi.mode(WIFI_STA);
    WiFi.begin(useSSID, usePass);
    
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
        delay(500);
        Serial.print(".");
        char dots[5] = {0};
        for (int d = 0; d <= (attempts % 4); d++) dots[d] = '.';
        char wifiMsg[32];
        sprintf(wifiMsg, "WiFi%s", dots);
        displayWiFiStatus(wifiMsg, false);
        attempts++;
    }
    
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println(" Connected!");
        Serial.printf("IP Address: %s\n", WiFi.localIP().toString().c_str());
        Serial.printf("WebSocket: ws://%s/ws\n", WiFi.localIP().toString().c_str());
        
        char ipMsg[32];
        sprintf(ipMsg, "%s", WiFi.localIP().toString().c_str());
        displayWiFiStatus(ipMsg, true);
        displayInitProgress("WiFi Connected", true);
        apModeActive = false;
        
        setupWebServer();
        displayInitProgress("Web Server", true);
        
        // Setup mDNS
        if (MDNS.begin(MDNS_HOSTNAME)) {
            MDNS.addService("http", "tcp", 80);
            MDNS.addService("ws", "tcp", 80);
            Serial.printf("✓ mDNS started: http://%s.local\n", MDNS_HOSTNAME);
            displayInitProgress("mDNS", true);
        }
        
        // Setup ArduinoOTA (IDE OTA)
        ArduinoOTA.setHostname(MDNS_HOSTNAME);
        ArduinoOTA.onStart([]() {
            Serial.println("OTA Update starting...");
            state.enabled = false;
        });
        ArduinoOTA.onEnd([]() { Serial.println("\nOTA Update complete!"); });
        ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
            Serial.printf("OTA Progress: %u%%\r", (progress / (total / 100)));
        });
        ArduinoOTA.onError([](ota_error_t error) {
            Serial.printf("OTA Error[%u]\n", error);
        });
        ArduinoOTA.begin();
        Serial.println("✓ OTA updates enabled");
        displayInitProgress("OTA Updates", true);
    } else {
        // FALLBACK: Start Access Point mode for configuration
        Serial.println("\nWiFi failed! Starting AP mode for setup...");
        displayWiFiStatus("Starting AP...", false);
        
        WiFi.mode(WIFI_AP);
        WiFi.softAPConfig(AP_IP, AP_GATEWAY, AP_SUBNET);
        WiFi.softAP(AP_SSID, AP_PASS);
        apModeActive = true;
        
        Serial.printf("✓ AP Mode: %s\n", AP_SSID);
        Serial.printf("  Password: %s\n", AP_PASS);
        Serial.printf("  IP: %s\n", WiFi.softAPIP().toString().c_str());
        Serial.println("  Connect to WiFi 'ChatterDetect' and go to 192.168.4.1");
        
        char apMsg[32];
        sprintf(apMsg, "AP:%s", AP_SSID);
        displayWiFiStatus(apMsg, true);
        displayInitProgress("AP Mode Active", true);
        
        setupWebServer();
        displayInitProgress("Config Portal", true);
        
        // mDNS in AP mode
        if (MDNS.begin(MDNS_HOSTNAME)) {
            MDNS.addService("http", "tcp", 80);
        }
    }
    
    // Load saved settings from flash (or use defaults)
    loadSettings();
    displayInitProgress("Settings Loaded", true);
    
    // Calculate tooth passing frequency
    float tpf = calculateToothPassFrequency();
    Serial.printf("Tool: %.1fmm, %d flutes @ %.0f RPM = %.0f Hz tooth pass\n", 
        toolDiameter, toolFlutes, spindleRPM, tpf);
    
    Serial.println("\n=== System Ready ===\n");
    Serial.println("Access via: http://chatter.local or ws://chatter.local/ws");
    Serial.println("Settings persist across reboots. OTA updates enabled.\n");
    
    // Show READY screen for a moment
    delay(500);
    tft.fillScreen(COLOR_BG);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(COLOR_GREEN);
    tft.setTextSize(2);
    tft.drawString("READY", TFT_CENTER_X, TFT_CENTER_Y - 20);
    tft.setTextSize(1);
    tft.setTextColor(COLOR_WHITE);
    tft.drawString(PROFILES[currentProfileIndex].name, TFT_CENTER_X, TFT_CENTER_Y + 10);
    if (WiFi.status() == WL_CONNECTED) {
        tft.setTextColor(COLOR_GRAY);
        tft.drawString(WiFi.localIP().toString().c_str(), TFT_CENTER_X, TFT_CENTER_Y + 30);
    }
    delay(1500);
    
    // Force first display update
    displayState.needsFullRedraw = true;
}

// ============================================================================
// GRBLHAL STATUS PARSING
// ============================================================================

// Parse grblHAL status response for actual spindle RPM
// Status format: <Idle|MPos:0.000,0.000,0.000|FS:0,12000>
void parseGrblStatus(String& status) {
    // Look for FS: (feed and spindle)
    int fsIdx = status.indexOf("FS:");
    if (fsIdx > 0) {
        int commaIdx = status.indexOf(',', fsIdx + 3);
        if (commaIdx > fsIdx) {
            int endIdx = status.indexOf('|', commaIdx);
            if (endIdx < 0) endIdx = status.indexOf('>', commaIdx);
            if (endIdx > commaIdx) {
                float rpm = status.substring(commaIdx + 1, endIdx).toFloat();
                if (rpm > 0 && rpm != spindleRPM) {
                    spindleRPM = rpm;
                    Serial.printf("[grblHAL] Spindle RPM: %.0f\n", rpm);
                }
            }
        }
    }
    
    // Look for |S: (spindle speed override)
    int sIdx = status.indexOf("|S:");
    if (sIdx > 0) {
        int endIdx = status.indexOf('|', sIdx + 3);
        if (endIdx < 0) endIdx = status.indexOf('>', sIdx + 3);
        if (endIdx > sIdx) {
            float rpm = status.substring(sIdx + 3, endIdx).toFloat();
            if (rpm > 0 && rpm != spindleRPM) {
                spindleRPM = rpm;
                Serial.printf("[grblHAL] Spindle RPM: %.0f\n", rpm);
            }
        }
    }
}

// Read and parse any incoming grblHAL data
void processGrblSerial() {
    static String grblBuffer = "";
    
    while (grblSerial.available()) {
        char c = grblSerial.read();
        
        if (c == '\n' || c == '\r') {
            if (grblBuffer.length() > 0) {
                // Check if it's a status message
                if (grblBuffer.startsWith("<") && grblBuffer.endsWith(">")) {
                    parseGrblStatus(grblBuffer);
                }
                grblBuffer = "";
            }
        } else {
            grblBuffer += c;
            // Prevent buffer overflow
            if (grblBuffer.length() > 200) {
                grblBuffer = "";
            }
        }
    }
}

// Request status from grblHAL (call periodically)
unsigned long lastStatusRequest = 0;
const unsigned long STATUS_REQUEST_INTERVAL = 500;  // Every 500ms

void requestGrblStatus() {
    if (millis() - lastStatusRequest >= STATUS_REQUEST_INTERVAL) {
        grblSerial.write('?');  // Status report request
        lastStatusRequest = millis();
    }
}

// ============================================================================
// MAIN LOOP
// ============================================================================

unsigned long lastUpdate = 0;
unsigned long lastDisplayUpdate = 0;
const unsigned long UPDATE_INTERVAL = 50;  // 20 Hz update rate
const unsigned long DISPLAY_INTERVAL = 100;  // 10 Hz display update (smooth but not too CPU intensive)

void loop() {
    // Handle OTA updates (only in station mode)
    if (!apModeActive) {
        ArduinoOTA.handle();
    }
    
    // Process grblHAL serial data
    processGrblSerial();
    requestGrblStatus();
    
    // Poll VFD Modbus telemetry (if enabled)
    vfd.poll();
    
    // Sync VFD health to SystemHealth struct
    if (vfd.state.enabled) {
        health.vfdOk = vfd.state.connected;
        if (!vfd.state.connected) {
            if (vfd.state.consecutiveFails > 5) {
                health.vfdError = SENSOR_TIMEOUT;  // No response from VFD
            } else {
                health.vfdError = SENSOR_NOT_FOUND;  // Not initialized or first fails
            }
        } else if (vfd.state.faultCode > 0) {
            health.vfdError = SENSOR_INVALID_DATA;  // VFD fault active
        } else {
            health.vfdError = SENSOR_OK;
        }
    }
    
    // Use VFD RPM if available (more accurate than grblHAL commanded RPM)
    if (vfd.state.enabled && vfd.state.connected && vfd.state.rpm > 0) {
        spindleRPM = vfd.state.rpm;
    }
    
    // Detect spindle state from current
    detectSpindleState();
    
    // Run chatter detection (only when spindle running and sensors healthy)
    if (state.spindleRunning) {
        runChatterDetection();
    }
    
    // System health check (every 5 seconds)
    static unsigned long lastHealthCheck = 0;
    if (millis() - lastHealthCheck >= 5000) {
        lastHealthCheck = millis();
        
        // Check WiFi and reconnect if needed (not in AP mode)
        if (!apModeActive && WiFi.status() != WL_CONNECTED) {
            Serial.println("WiFi disconnected! Attempting reconnect...");
            WiFi.disconnect();
            WiFi.reconnect();
        }
        
        // Log heap status periodically
        static uint32_t minHeap = UINT32_MAX;
        uint32_t freeHeap = ESP.getFreeHeap();
        if (freeHeap < minHeap) minHeap = freeHeap;
        
        // Warn if heap is getting low
        if (freeHeap < 20000) {
            Serial.printf("WARNING: Low heap! Free: %u, Min: %u\n", freeHeap, minHeap);
        }
    }
    
    // Send WebSocket updates at fixed rate
    if (millis() - lastUpdate >= UPDATE_INTERVAL) {
        lastUpdate = millis();
        
        if (ws.count() > 0) {
            sendWebSocketUpdate();
        }
        
        // Debug output (less verbose when idle)
        if (state.cutting) {
            Serial.printf("A:%.2f V:%.2f C:%.2f => %.2f | %.1fA | Feed:%d%% %s\\n",
                state.audioScore, state.accelScore, state.currentScore,
                state.combinedScore, state.currentAmps, state.feedOverride,
                state.chatterDetected ? "CHATTER!" : "");
        }
    }
    
    // Update TFT display at lower rate (smooth but efficient)
    if (millis() - lastDisplayUpdate >= DISPLAY_INTERVAL) {
        lastDisplayUpdate = millis();
        updateDisplay();
    }
    
    // Update statistics
    if (state.cutting) {
        state.totalCuttingTime += UPDATE_INTERVAL;
    }
    
    // Clean up WebSocket connections
    ws.cleanupClients();
}
