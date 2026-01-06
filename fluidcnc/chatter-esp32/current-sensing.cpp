/**
 * FluidCNC - Cheap Current Sensing for Step Loss Detection
 * 
 * ESP32 firmware addition to read motor current via:
 * 1. Shunt resistor + INA219 (best, $3)
 * 2. ACS712 Hall effect sensor ($2)
 * 3. Trinamic SPI readout (free if using TMC drivers)
 * 
 * Sends data to main FluidCNC via existing WebSocket
 */

#include <Arduino.h>
#include <Wire.h>

// ================================================================
// METHOD 1: TMC Driver SPI Readout (FREE - already have hardware)
// Works with TMC2209, TMC2130, TMC5160, etc.
// ================================================================

#ifdef USE_TMC_DRIVERS
#include <TMCStepper.h>

// Define your driver pins (adjust for your setup)
#define X_CS_PIN 17
#define Y_CS_PIN 16  
#define Z_CS_PIN 4

TMC2209Stepper driverX(X_CS_PIN, 0.11f, 0);  // CS pin, R_sense, address
TMC2209Stepper driverY(Y_CS_PIN, 0.11f, 1);
TMC2209Stepper driverZ(Z_CS_PIN, 0.11f, 2);

struct MotorLoad {
    uint16_t sgResult;      // StallGuard result (0-1023)
    uint16_t current;       // Actual current (mA)
    bool stalled;           // StallGuard triggered
    bool overtemp;          // Overtemperature warning
};

MotorLoad readTMCLoad(TMC2209Stepper& driver) {
    MotorLoad load;
    
    // StallGuard value - lower = higher load
    // Typical: 0-100 = stalled, 100-500 = heavy load, >500 = light/no load
    load.sgResult = driver.SG_RESULT();
    
    // Actual current from driver
    load.current = driver.cs2rms(driver.cs_actual());
    
    // Check status flags
    uint32_t status = driver.DRV_STATUS();
    load.stalled = status & (1 << 24);  // StallGuard flag
    load.overtemp = status & (1 << 25); // Overtemp prewarning
    
    return load;
}

void setupTMCDrivers() {
    SPI.begin();
    
    driverX.begin();
    driverX.toff(4);
    driverX.blank_time(24);
    driverX.rms_current(800);     // mA
    driverX.microsteps(16);
    driverX.TCOOLTHRS(0xFFFFF);   // Enable StallGuard
    driverX.semin(5);             // CoolStep lower threshold
    driverX.semax(2);             // CoolStep upper threshold
    driverX.SGTHRS(50);           // StallGuard threshold
    
    // Repeat for Y and Z...
    driverY.begin();
    driverY.toff(4);
    driverY.rms_current(800);
    driverY.microsteps(16);
    driverY.TCOOLTHRS(0xFFFFF);
    driverY.SGTHRS(50);
    
    driverZ.begin();
    driverZ.toff(4);
    driverZ.rms_current(800);
    driverZ.microsteps(16);
    driverZ.TCOOLTHRS(0xFFFFF);
    driverZ.SGTHRS(50);
}

#endif

// ================================================================
// METHOD 2: ACS712 Hall Effect Current Sensor ($2)
// ================================================================

#ifdef USE_ACS712

// ACS712 connected to ESP32 ADC
#define ACS712_X_PIN 34
#define ACS712_Y_PIN 35
#define ACS712_Z_PIN 32

// ACS712-20A: 100mV/A, zero point at VCC/2
#define ACS712_SENSITIVITY 0.100f  // V/A
#define ACS712_ZERO_OFFSET 1.65f   // V at 0A (3.3V/2)
#define ADC_RESOLUTION 4095.0f
#define ADC_VOLTAGE 3.3f

float readACS712Current(int pin) {
    // Average multiple samples for noise reduction
    long sum = 0;
    for (int i = 0; i < 100; i++) {
        sum += analogRead(pin);
        delayMicroseconds(100);
    }
    float avgReading = sum / 100.0f;
    
    // Convert to voltage
    float voltage = (avgReading / ADC_RESOLUTION) * ADC_VOLTAGE;
    
    // Convert to current
    float current = (voltage - ACS712_ZERO_OFFSET) / ACS712_SENSITIVITY;
    
    return abs(current);  // Return absolute value (we don't care about direction)
}

#endif

// ================================================================
// METHOD 3: INA219 I2C Current Sensor ($3, most accurate)
// ================================================================

#ifdef USE_INA219
#include <Adafruit_INA219.h>

Adafruit_INA219 inaX(0x40);  // Default address
Adafruit_INA219 inaY(0x41);  // A0 jumpered
Adafruit_INA219 inaZ(0x44);  // A1 jumpered

void setupINA219() {
    inaX.begin();
    inaY.begin();
    inaZ.begin();
    
    // Set for maximum sensitivity
    // Adjust based on your motor current
    inaX.setCalibration_16V_400mA();  // For small steppers
    // or inaX.setCalibration_32V_2A(); // For larger steppers
}

float readINA219Current(Adafruit_INA219& ina) {
    return ina.getCurrent_mA() / 1000.0f;  // Return Amps
}

#endif

// ================================================================
// METHOD 4: Back-EMF Sensing (FREE, no extra hardware)
// Read motor coils during off-phase to detect stall
// ================================================================

#ifdef USE_BACK_EMF

// Connect motor phase to ESP32 ADC via voltage divider
// CAUTION: Motor voltage may exceed 3.3V!
// Use voltage divider: 10K + 3.3K gives 3.3V max from 13V
#define BEMF_X_PIN 36
#define BEMF_Y_PIN 39
#define BEMF_Z_PIN 34

// Sample timing - must be during driver off-phase
// Depends on your microstepping frequency

volatile uint32_t bemfSamples[3][10];
volatile int bemfIndex = 0;

void IRAM_ATTR sampleBEMF() {
    // Called from timer interrupt during known off-phase
    bemfSamples[0][bemfIndex] = analogRead(BEMF_X_PIN);
    bemfSamples[1][bemfIndex] = analogRead(BEMF_Y_PIN);
    bemfSamples[2][bemfIndex] = analogRead(BEMF_Z_PIN);
    bemfIndex = (bemfIndex + 1) % 10;
}

float analyzeBEMF(int axis) {
    // When motor is spinning freely, BEMF is sinusoidal
    // When stalled, BEMF collapses
    
    uint32_t sum = 0;
    uint32_t max = 0;
    uint32_t min = 4095;
    
    for (int i = 0; i < 10; i++) {
        sum += bemfSamples[axis][i];
        if (bemfSamples[axis][i] > max) max = bemfSamples[axis][i];
        if (bemfSamples[axis][i] < min) min = bemfSamples[axis][i];
    }
    
    float avg = sum / 10.0f;
    float peakToPeak = max - min;
    
    // Healthy motor: good peak-to-peak variation
    // Stalled motor: low or no variation
    return peakToPeak;
}

bool isBEMFStalled(int axis, float threshold = 100.0f) {
    return analyzeBEMF(axis) < threshold;
}

#endif

// ================================================================
// CHEAP OPTICAL ENCODER (using IR LED + phototransistor, $0.50)
// ================================================================

#ifdef USE_CHEAP_ENCODER

// Use reflective optical sensor aimed at leadscrew or pulley
// Count reflections to verify rotation

#define ENCODER_X_PIN 25
#define ENCODER_Y_PIN 26
#define ENCODER_Z_PIN 27

volatile uint32_t encoderCounts[3] = {0, 0, 0};
volatile uint32_t lastEncoderTime[3] = {0, 0, 0};

void IRAM_ATTR encoderISR_X() { 
    encoderCounts[0]++; 
    lastEncoderTime[0] = micros();
}
void IRAM_ATTR encoderISR_Y() { 
    encoderCounts[1]++; 
    lastEncoderTime[1] = micros();
}
void IRAM_ATTR encoderISR_Z() { 
    encoderCounts[2]++; 
    lastEncoderTime[2] = micros();
}

void setupCheapEncoders() {
    pinMode(ENCODER_X_PIN, INPUT_PULLUP);
    pinMode(ENCODER_Y_PIN, INPUT_PULLUP);
    pinMode(ENCODER_Z_PIN, INPUT_PULLUP);
    
    attachInterrupt(ENCODER_X_PIN, encoderISR_X, RISING);
    attachInterrupt(ENCODER_Y_PIN, encoderISR_Y, RISING);
    attachInterrupt(ENCODER_Z_PIN, encoderISR_Z, RISING);
}

bool isMotorSpinning(int axis) {
    // If no pulses in last 100ms during expected motion = stall
    return (micros() - lastEncoderTime[axis]) < 100000;
}

float getEncoderRPM(int axis, float pulsesPerRev) {
    static uint32_t lastCount[3] = {0, 0, 0};
    static uint32_t lastTime[3] = {0, 0, 0};
    
    uint32_t now = millis();
    uint32_t count = encoderCounts[axis];
    uint32_t dt = now - lastTime[axis];
    
    if (dt < 100) return -1;  // Too soon
    
    uint32_t dCount = count - lastCount[axis];
    float rpm = (dCount / pulsesPerRev) * (60000.0f / dt);
    
    lastCount[axis] = count;
    lastTime[axis] = now;
    
    return rpm;
}

#endif

// ================================================================
// MAGNETIC STRIPE ENCODER (cheap alternative to glass scales)
// Using AS5311 or AS5600 + magnetic strip, ~$10 total
// ================================================================

#ifdef USE_MAGNETIC_ENCODER
#include <AS5600.h>

AS5600 magneticEncoder;

// Magnetic strip: 2mm pole pitch = 0.5mm resolution with quadrature
#define POLE_PITCH_MM 2.0f

void setupMagneticEncoder() {
    Wire.begin();
    magneticEncoder.begin();
    magneticEncoder.setDirection(AS5600_CLOCK_WISE);
}

float getMagneticPosition() {
    // Raw angle from encoder
    uint16_t rawAngle = magneticEncoder.rawAngle();
    
    // Convert to linear position
    // Each rotation = 1 pole pitch (2mm)
    // 4096 counts per rotation
    static int32_t totalCounts = 0;
    static uint16_t lastAngle = 0;
    
    int16_t delta = (int16_t)rawAngle - (int16_t)lastAngle;
    
    // Handle wraparound
    if (delta > 2048) delta -= 4096;
    if (delta < -2048) delta += 4096;
    
    totalCounts += delta;
    lastAngle = rawAngle;
    
    return (totalCounts / 4096.0f) * POLE_PITCH_MM;
}

#endif

// ================================================================
// MAIN INTEGRATION - Send data to FluidCNC
// ================================================================

struct SensorData {
    float currentX, currentY, currentZ;
    uint16_t stallGuardX, stallGuardY, stallGuardZ;
    float encoderX, encoderY, encoderZ;
    float bemfX, bemfY, bemfZ;
    bool stallX, stallY, stallZ;
    float temperature;
};

SensorData readAllSensors() {
    SensorData data = {0};
    
    #ifdef USE_TMC_DRIVERS
    auto loadX = readTMCLoad(driverX);
    auto loadY = readTMCLoad(driverY);
    auto loadZ = readTMCLoad(driverZ);
    
    data.currentX = loadX.current / 1000.0f;
    data.currentY = loadY.current / 1000.0f;
    data.currentZ = loadZ.current / 1000.0f;
    data.stallGuardX = loadX.sgResult;
    data.stallGuardY = loadY.sgResult;
    data.stallGuardZ = loadZ.sgResult;
    data.stallX = loadX.stalled;
    data.stallY = loadY.stalled;
    data.stallZ = loadZ.stalled;
    #endif
    
    #ifdef USE_ACS712
    data.currentX = readACS712Current(ACS712_X_PIN);
    data.currentY = readACS712Current(ACS712_Y_PIN);
    data.currentZ = readACS712Current(ACS712_Z_PIN);
    #endif
    
    #ifdef USE_INA219
    data.currentX = readINA219Current(inaX);
    data.currentY = readINA219Current(inaY);
    data.currentZ = readINA219Current(inaZ);
    #endif
    
    #ifdef USE_BACK_EMF
    data.bemfX = analyzeBEMF(0);
    data.bemfY = analyzeBEMF(1);
    data.bemfZ = analyzeBEMF(2);
    #endif
    
    #ifdef USE_CHEAP_ENCODER
    data.stallX = !isMotorSpinning(0);
    data.stallY = !isMotorSpinning(1);
    data.stallZ = !isMotorSpinning(2);
    #endif
    
    return data;
}

String sensorDataToJSON(SensorData& data) {
    String json = "{";
    json += "\"current\":{";
    json += "\"x\":" + String(data.currentX, 3) + ",";
    json += "\"y\":" + String(data.currentY, 3) + ",";
    json += "\"z\":" + String(data.currentZ, 3);
    json += "},";
    json += "\"stallGuard\":{";
    json += "\"x\":" + String(data.stallGuardX) + ",";
    json += "\"y\":" + String(data.stallGuardY) + ",";
    json += "\"z\":" + String(data.stallGuardZ);
    json += "},";
    json += "\"stall\":{";
    json += "\"x\":" + String(data.stallX ? "true" : "false") + ",";
    json += "\"y\":" + String(data.stallY ? "true" : "false") + ",";
    json += "\"z\":" + String(data.stallZ ? "true" : "false");
    json += "},";
    json += "\"bemf\":{";
    json += "\"x\":" + String(data.bemfX, 1) + ",";
    json += "\"y\":" + String(data.bemfY, 1) + ",";
    json += "\"z\":" + String(data.bemfZ, 1);
    json += "}";
    json += "}";
    return json;
}

// WebSocket integration (add to existing chatter-detection ESP32 code)
void broadcastSensorData(SensorData& data) {
    // This integrates with existing WebSocket server
    // Send as part of the regular chatter update
    String json = sensorDataToJSON(data);
    // ws.textAll(json);  // Uncomment when integrated
}

// ================================================================
// STALL PREVENTION STRATEGIES
// ================================================================

struct MotionParams {
    float feedRate;
    float acceleration;
    uint8_t microsteps;
    uint16_t current;
};

MotionParams optimizeForLoad(float loadPercent, float requestedFeed) {
    MotionParams params;
    
    if (loadPercent > 80) {
        // Very heavy load - maximum torque mode
        params.feedRate = requestedFeed * 0.5;
        params.acceleration = 500;   // mm/s²
        params.microsteps = 4;       // Full torque
        params.current = 1200;       // mA - increase current
    } else if (loadPercent > 60) {
        // Heavy load
        params.feedRate = requestedFeed * 0.7;
        params.acceleration = 1000;
        params.microsteps = 8;
        params.current = 1000;
    } else if (loadPercent > 40) {
        // Moderate load
        params.feedRate = requestedFeed * 0.9;
        params.acceleration = 2000;
        params.microsteps = 16;
        params.current = 800;
    } else {
        // Light load - optimize for smoothness
        params.feedRate = requestedFeed;
        params.acceleration = 3000;
        params.microsteps = 32;
        params.current = 600;
    }
    
    return params;
}

// ================================================================
// RESONANCE DETECTION VIA CURRENT RIPPLE
// ================================================================

class ResonanceDetector {
public:
    static const int SAMPLE_SIZE = 256;
    float samples[SAMPLE_SIZE];
    int sampleIndex = 0;
    
    void addSample(float current) {
        samples[sampleIndex++] = current;
        if (sampleIndex >= SAMPLE_SIZE) {
            sampleIndex = 0;
            analyzeResonance();
        }
    }
    
    void analyzeResonance() {
        // Simple FFT-like analysis for dominant frequency
        // Look for periodic current spikes indicating resonance
        
        float sum = 0;
        float sumSq = 0;
        
        for (int i = 0; i < SAMPLE_SIZE; i++) {
            sum += samples[i];
            sumSq += samples[i] * samples[i];
        }
        
        float mean = sum / SAMPLE_SIZE;
        float variance = (sumSq / SAMPLE_SIZE) - (mean * mean);
        float stdDev = sqrt(variance);
        
        // High variance at certain speeds indicates resonance
        // Normal: stdDev < 0.1 * mean
        // Resonance: stdDev > 0.3 * mean
        
        if (stdDev > 0.3 * mean) {
            // In resonance zone!
            // Calculate approximate frequency from sample rate
            // Notify main system
        }
    }
};
