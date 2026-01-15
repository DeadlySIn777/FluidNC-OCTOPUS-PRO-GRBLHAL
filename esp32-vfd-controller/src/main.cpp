/*
 * ESP32 VFD Controller
 * ====================
 * USB Serial control of H100/Huanyang VFD via RS485 Modbus
 * 
 * Reads ALL available VFD data:
 * - Set frequency / actual frequency
 * - Output current (amps)
 * - Output voltage
 * - DC bus voltage
 * - Motor temperature (if sensor connected)
 * - VFD temperature
 * - Fault codes
 * - Running status
 * - Direction (FWD/REV)
 * 
 * Wiring (38-pin ESP32 dev module):
 * ---------------------------------
 * ESP32 GPIO17 (TX2) --> MAX485 DI
 * ESP32 GPIO16 (RX2) --> MAX485 RO
 * ESP32 GPIO4        --> MAX485 DE + RE (tied together)
 * ESP32 GND          --> MAX485 GND --> VFD GND
 * MAX485 A           --> VFD 485- (or RS-)
 * MAX485 B           --> VFD 485+ (or RS+)
 * 
 * Serial Commands (from PC):
 * --------------------------
 * RPM:12000       - Set spindle to 12000 RPM
 * STOP            - Stop spindle
 * FWD             - Run forward at last RPM
 * REV             - Run reverse at last RPM
 * STATUS          - Get full status JSON
 * CONFIG          - Show current config
 * BAUD:9600       - Set Modbus baud rate
 * ADDR:1          - Set VFD address
 * MAXRPM:24000    - Set max RPM for scaling
 * MINRPM:0        - Set min RPM
 * DEBUG:1         - Enable debug output
 * DEBUG:0         - Disable debug output
 * SAVE            - Save config to flash
 * RESET           - Reset ESP32
 * HELP            - Show commands
 */

#include <Arduino.h>
#include <ModbusMaster.h>
#include <Preferences.h>

// ============================================================================
// PIN DEFINITIONS - 38-pin ESP32 Dev Module
// ============================================================================
#define RS485_TX_PIN     17    // GPIO17 = TX2
#define RS485_RX_PIN     16    // GPIO16 = RX2
#define RS485_DE_RE_PIN  4     // GPIO4 = Direction control (DE+RE tied)

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================
#define DEFAULT_VFD_ADDRESS     1
#define DEFAULT_MODBUS_BAUD     9600
#define DEFAULT_MAX_RPM         24000
#define DEFAULT_MIN_RPM         0
#define DEFAULT_MAX_FREQ        400     // 400Hz = 24000 RPM for 2-pole motor
#define DEFAULT_POLL_INTERVAL   500     // ms between status polls
#define DEFAULT_DEBUG           false

// ============================================================================
// H100 / HUANYANG VFD REGISTER MAP
// ============================================================================
// Function codes
#define MODBUS_READ_HOLDING    0x03
#define MODBUS_READ_INPUT      0x04
#define MODBUS_WRITE_SINGLE    0x06
#define MODBUS_WRITE_COIL      0x05

// H100 Coil addresses for control (Function 05)
#define H100_COIL_OP_ENABLE    0x0048    // Operation Enable (must be ON to run)
#define H100_COIL_RUN_FWD      0x0049    // Run forward
#define H100_COIL_RUN_REV      0x004A    // Run reverse  
#define H100_COIL_STOP         0x004B    // Stop

// H100 Holding registers for read (some VFDs use these)
#define H100_REG_SET_FREQ      0x0201    // Set frequency register (F169 determines decimal)
#define H100_REG_PD005         0x0005    // Max frequency (F005)
#define H100_REG_PD011         0x000B    // Min frequency (F011)

// ============================================================================
// H100 PARAMETER REGISTERS (Verified from translated manual!)
// Internal parameters are at address 0x0000-0x00FF = F000-F255
// ============================================================================
#define H100_REG_F014          0x000E    // F014 = Acceleration time I (0.1s units)
#define H100_REG_F015          0x000F    // F015 = Deceleration time I (0.1s units)
#define H100_REG_F016          0x0010    // F016 = Acceleration time II
#define H100_REG_F017          0x0011    // F017 = Deceleration time II
#define H100_REG_F022          0x0016    // F022 = Emergency stop decel (0=coast)
#define H100_REG_F026          0x001A    // F026 = Stop mode (0=ramp, 1=coast)

// Changrong H100 clone status registers (holding registers, function 0x03)
// Tested: Register 0x0000 works and returns frequency
// These clones use simple consecutive registers starting at 0x0000
#define H100_REG_OUTPUT_FREQ   0x0000    // Output frequency (0.01 Hz units) - per manual
#define H100_REG_SET_FREQ      0x0001    // Set frequency (0.01 Hz units)
#define H100_REG_OUTPUT_AMPS   0x0002    // Output current (0.1 A units)
#define H100_REG_OUTPUT_RPM    0x0003    // Output speed (RPM)
#define H100_REG_DC_BUS        0x0004    // DC bus voltage (V)
#define H100_REG_AC_VOLTS      0x0005    // AC output voltage (V)
#define H100_REG_TEMPERATURE   0x0006    // Heatsink temperature (°C) - THIS IS THE TEMP!
#define H100_REG_COUNTER       0x0007    // Counter
#define H100_REG_PID_TARGET    0x0008    // PID target value
#define H100_REG_PID_FEEDBACK  0x0009    // PID feedback value
#define H100_REG_FAULT_CODE    0x000A    // Current fault code
#define H100_REG_TOTAL_HOURS   0x000B    // Total operating hours
#define H100_REG_OUTPUT_POWER  0x000C    // Output power
#define H100_REG_X_TERMINAL    0x000D    // X terminal state

// Alternative register addresses for Huanyang protocol
#define HY_REG_SET_FREQ        0x0002    // Set frequency
#define HY_REG_OUTPUT_FREQ     0x0000    // Running frequency  
#define HY_REG_OUTPUT_AMPS     0x0003    // Output current
#define HY_REG_RPM             0x0004    // RPM (some models)

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================
ModbusMaster modbus;
Preferences prefs;
HardwareSerial RS485Serial(2);  // UART2 for RS485

// Configuration (saved to flash)
struct Config {
    uint8_t vfdAddress;
    uint32_t modbusBaud;
    uint32_t maxRpm;
    uint32_t minRpm;
    uint32_t maxFreq;       // Max frequency in Hz * 10
    uint32_t pollInterval;
    bool debugMode;
    uint16_t accelTime;     // Acceleration time in 0.1s (default 50 = 5s, we want FAST)
    uint16_t decelTime;     // Deceleration time in 0.1s (without brake resistor, use coast)
} config;

// VFD Status (updated by polling)
struct VFDStatus {
    bool online = false;
    bool running = false;
    bool forward = true;   // Default to forward
    bool fault = false;
    uint16_t faultCode = 0;
    float setFreqHz = 0;
    float actualFreqHz = 0;
    float outputAmps = 0;
    float outputVolts = 0;
    float dcBusVolts = 0;
    float motorTempC = 0;
    float vfdTempC = 0;
    uint32_t setRpm = 0;
    uint32_t actualRpm = 0;
    float loadPercent = 0;
    float outputPower = 0;      // Output power (kW or %)
    uint32_t totalHours = 0;    // Total operating hours from VFD
    uint32_t lastUpdate = 0;
    uint32_t commErrors = 0;
    uint32_t successCount = 0;
} vfd;

// Command state
float targetRpm = 0;
bool spindleEnabled = false;
bool spindleReverse = false;
unsigned long lastPoll = 0;
unsigned long lastStatusPrint = 0;

// ============================================================================
// RS485 DIRECTION CONTROL
// ============================================================================
void rs485PreTransmission() {
    // Flush any garbage from RX buffer first
    while (RS485Serial.available()) RS485Serial.read();
    digitalWrite(RS485_DE_RE_PIN, HIGH);
    delayMicroseconds(1000);  // Allow transceiver to stabilize (increased from 500)
}

void rs485PostTransmission() {
    // Wait for transmission to fully complete before switching to RX
    RS485Serial.flush();
    // Switch to RX mode IMMEDIATELY - VFD responds fast!
    delayMicroseconds(500);  // Minimal delay - just for last bit to finish
    digitalWrite(RS485_DE_RE_PIN, LOW);
    // DON'T clear RX buffer here - we want to capture VFD response!
}

// ============================================================================
// CONFIGURATION MANAGEMENT
// ============================================================================
void loadConfig() {
    prefs.begin("vfd", true);  // Read-only
    config.vfdAddress = prefs.getUChar("addr", DEFAULT_VFD_ADDRESS);
    config.modbusBaud = prefs.getUInt("baud", DEFAULT_MODBUS_BAUD);
    config.maxRpm = prefs.getUInt("maxrpm", DEFAULT_MAX_RPM);
    config.minRpm = prefs.getUInt("minrpm", DEFAULT_MIN_RPM);
    config.maxFreq = prefs.getUInt("maxfreq", DEFAULT_MAX_FREQ);
    config.pollInterval = prefs.getUInt("poll", DEFAULT_POLL_INTERVAL);
    config.debugMode = prefs.getBool("debug", DEFAULT_DEBUG);
    config.accelTime = prefs.getUShort("accel", 10);   // Default 1.0 seconds (FAST!)
    config.decelTime = prefs.getUShort("decel", 30);   // Default 3.0 seconds (coast without braking resistor)
    prefs.end();
}

void saveConfig() {
    prefs.begin("vfd", false);  // Read-write
    prefs.putUChar("addr", config.vfdAddress);
    prefs.putUInt("baud", config.modbusBaud);
    prefs.putUInt("maxrpm", config.maxRpm);
    prefs.putUInt("minrpm", config.minRpm);
    prefs.putUInt("maxfreq", config.maxFreq);
    prefs.putUInt("poll", config.pollInterval);
    prefs.putBool("debug", config.debugMode);
    prefs.putUShort("accel", config.accelTime);
    prefs.putUShort("decel", config.decelTime);
    prefs.end();
    Serial.println("{\"saved\":true}");
}

void printConfig() {
    Serial.printf("{\"config\":{\"addr\":%d,\"baud\":%d,\"maxRpm\":%d,\"minRpm\":%d,\"maxFreq\":%d,\"poll\":%d,\"debug\":%s,\"accelTime\":%.1f,\"decelTime\":%.1f}}\n",
        config.vfdAddress,
        config.modbusBaud,
        config.maxRpm,
        config.minRpm,
        config.maxFreq,
        config.pollInterval,
        config.debugMode ? "true" : "false",
        config.accelTime / 10.0,
        config.decelTime / 10.0
    );
}

// ============================================================================
// VFD COMMUNICATION
// ============================================================================
float rpmToFreq(uint32_t rpm) {
    // Convert RPM to frequency (Hz * 10 for VFD register)
    // Assuming 2-pole motor: RPM = Freq * 60
    return (float)rpm / 60.0f;
}

uint32_t freqToRpm(float freqHz) {
    return (uint32_t)(freqHz * 60.0f);
}

bool vfdSetFrequency(float freqHz) {
    // H100 clone uses 0.1Hz resolution (F169=0)
    // So 50Hz = 500, 100Hz = 1000
    uint16_t freqReg = (uint16_t)(freqHz * 10.0f);
    
    if (config.debugMode) {
        Serial.printf("[DEBUG] Setting frequency: %.2f Hz (reg: %d)\n", freqHz, freqReg);
    }
    
    uint8_t result = modbus.writeSingleRegister(H100_REG_SET_FREQ, freqReg);
    
    if (result == modbus.ku8MBSuccess) {
        vfd.setFreqHz = freqHz;
        vfd.setRpm = freqToRpm(freqHz);
        vfd.successCount++;
        return true;
    } else {
        vfd.commErrors++;
        if (config.debugMode) {
            Serial.printf("[DEBUG] Write frequency failed: 0x%02X\n", result);
        }
        return false;
    }
}

// Write a VFD parameter register (for configuring PD003/PD004 accel/decel times)
bool vfdWriteParameter(uint16_t paramReg, uint16_t value) {
    if (config.debugMode) {
        Serial.printf("[DEBUG] Writing parameter 0x%04X = %d\n", paramReg, value);
    }
    
    // VFD parameters are typically in a different address range
    // For H100/Huanyang clones, parameters are often at their PD number
    // PD003 = acceleration time (0.1s units)
    // PD004 = deceleration time (0.1s units)
    
    uint8_t result = modbus.writeSingleRegister(paramReg, value);
    
    if (result == modbus.ku8MBSuccess) {
        vfd.successCount++;
        Serial.printf("{\"paramWrite\":true,\"reg\":\"0x%04X\",\"value\":%d}\n", paramReg, value);
        return true;
    } else {
        vfd.commErrors++;
        Serial.printf("{\"paramWrite\":false,\"reg\":\"0x%04X\",\"error\":\"0x%02X\"}\n", paramReg, result);
        
        // Some VFDs need the parameter written differently
        // Try alternative approach: some use function code 0x06 with address offset
        if (config.debugMode) {
            Serial.println("[DEBUG] Trying alternative parameter write...");
        }
        
        // Try writing to address + 0x1000 offset (some Huanyang variants)
        result = modbus.writeSingleRegister(paramReg + 0x1000, value);
        if (result == modbus.ku8MBSuccess) {
            Serial.printf("{\"paramWrite\":true,\"reg\":\"0x%04X\",\"value\":%d,\"method\":\"offset\"}\n", paramReg + 0x1000, value);
            return true;
        }
        
        return false;
    }
}

bool vfdRunForward() {
    if (config.debugMode) {
        Serial.println("[DEBUG] Sending RUN FWD command");
    }
    
    // Step 1: Enable operation (coil 0x0048)
    uint8_t result = modbus.writeSingleCoil(H100_COIL_OP_ENABLE, 1);
    if (result != modbus.ku8MBSuccess) {
        vfd.commErrors++;
        if (config.debugMode) {
            Serial.printf("[DEBUG] OP Enable failed: 0x%02X\n", result);
        }
        return false;
    }
    delay(10);  // Small delay between commands
    
    // Step 2: Run forward (coil 0x0049)
    result = modbus.writeSingleCoil(H100_COIL_RUN_FWD, 1);
    
    if (result == modbus.ku8MBSuccess) {
        vfd.running = true;
        vfd.forward = true;
        vfd.successCount++;
        return true;
    } else {
        vfd.commErrors++;
        if (config.debugMode) {
            Serial.printf("[DEBUG] RUN FWD failed: 0x%02X\n", result);
        }
        return false;
    }
}

bool vfdRunReverse() {
    if (config.debugMode) {
        Serial.println("[DEBUG] Sending RUN REV command");
    }
    
    // Step 1: Enable operation (coil 0x0048)
    uint8_t result = modbus.writeSingleCoil(H100_COIL_OP_ENABLE, 1);
    if (result != modbus.ku8MBSuccess) {
        vfd.commErrors++;
        if (config.debugMode) {
            Serial.printf("[DEBUG] OP Enable failed: 0x%02X\n", result);
        }
        return false;
    }
    delay(10);  // Small delay between commands
    
    // Step 2: Run reverse (coil 0x004A)
    result = modbus.writeSingleCoil(H100_COIL_RUN_REV, 1);
    
    if (result == modbus.ku8MBSuccess) {
        vfd.running = true;
        vfd.forward = false;
        vfd.successCount++;
        return true;
    } else {
        vfd.commErrors++;
        if (config.debugMode) {
            Serial.printf("[DEBUG] RUN REV failed: 0x%02X\n", result);
        }
        return false;
    }
}

bool vfdStop() {
    if (config.debugMode) {
        Serial.println("[DEBUG] Sending STOP command");
    }
    
    uint8_t result = modbus.writeSingleCoil(H100_COIL_STOP, 1);
    
    if (result == modbus.ku8MBSuccess) {
        vfd.running = false;
        vfd.successCount++;
        return true;
    } else {
        vfd.commErrors++;
        if (config.debugMode) {
            Serial.printf("[DEBUG] STOP failed: 0x%02X\n", result);
        }
        return false;
    }
}

void pollVFDStatus() {
    static uint8_t pollPhase = 0;
    uint8_t result;
    
    // H100 VFD Input Registers (Function 0x04) - FROM MANUAL:
    // 0x0000: Output frequency (0.01 Hz units)
    // 0x0001: Set frequency (0.01 Hz units)
    // 0x0002: Output current (0.1A units)
    // 0x0003: Output speed (RPM)
    // 0x0004: DC voltage (V)
    // 0x0005: AC voltage (V) 
    // 0x0006: Temperature (heatsink °C)
    // 0x0007: Counter
    // 0x000A: Current fault code
    // 0x000B: Total operating hours
    // 0x000C: Output power
    
    switch (pollPhase) {
        case 0:
            // Read input registers 0-3 (output freq, set freq, current, RPM)
            result = modbus.readInputRegisters(0x0000, 4);
            if (result == modbus.ku8MBSuccess) {
                vfd.actualFreqHz = modbus.getResponseBuffer(0) / 100.0f;  // 0.01 Hz units
                vfd.setFreqHz = modbus.getResponseBuffer(1) / 100.0f;     // 0.01 Hz units
                vfd.outputAmps = modbus.getResponseBuffer(2) / 10.0f;     // 0.1A units
                vfd.actualRpm = modbus.getResponseBuffer(3);
                vfd.setRpm = freqToRpm(vfd.setFreqHz);
                vfd.online = true;
                vfd.running = (vfd.actualFreqHz > 0.5f);
                vfd.successCount++;
            } else {
                vfd.commErrors++;
                if (config.debugMode) {
                    Serial.printf("[DEBUG] Read input regs 0-3 failed: 0x%02X\n", result);
                }
            }
            break;
            
        case 1:
            // Read DC voltage, AC voltage, Temperature (registers 4, 5, 6)
            result = modbus.readInputRegisters(0x0004, 3);
            if (result == modbus.ku8MBSuccess) {
                vfd.dcBusVolts = modbus.getResponseBuffer(0);    // 0x0004 DC voltage
                vfd.outputVolts = modbus.getResponseBuffer(1);   // 0x0005 AC voltage
                vfd.vfdTempC = modbus.getResponseBuffer(2);      // 0x0006 Heatsink temp!
                vfd.motorTempC = vfd.vfdTempC;  // Use heatsink as estimate
                vfd.successCount++;
            }
            break;
        
        case 2:
            // Read fault code (0x000A), total hours (0x000B), power (0x000C)
            result = modbus.readInputRegisters(0x000A, 3);
            if (result == modbus.ku8MBSuccess) {
                uint16_t faultRaw = modbus.getResponseBuffer(0);
                vfd.fault = (faultRaw != 0);
                vfd.faultCode = faultRaw;
                vfd.totalHours = modbus.getResponseBuffer(1);    // 0x000B total hours
                vfd.outputPower = modbus.getResponseBuffer(2);   // 0x000C output power
                vfd.successCount++;
            }
            break;
            
        case 3:
            // Calculate derived values
            vfd.loadPercent = min(100.0f, (vfd.outputAmps / 10.0f) * 100.0f);
            break;
    }
    
    pollPhase = (pollPhase + 1) % 4;
    vfd.lastUpdate = millis();
}

// ============================================================================
// FAULT CODE DECODER (H100/Changrong VFD)
// ============================================================================
const char* decodeFaultCode(uint16_t code) {
    switch (code) {
        case 0:  return "None";
        case 1:  return "OC1: Overcurrent during accel";
        case 2:  return "OC2: Overcurrent during decel";
        case 3:  return "OC3: Overcurrent at constant speed";
        case 4:  return "OV1: Overvoltage during accel";
        case 5:  return "OV2: Overvoltage during decel";
        case 6:  return "OV3: Overvoltage at constant speed";
        case 7:  return "UV: DC bus undervoltage";
        case 8:  return "OH: Inverter overheat";
        case 9:  return "I.t: Motor overload";
        case 10: return "OL: Inverter overload";
        case 11: return "PF: Input phase loss";
        case 12: return "OP: Output phase loss";
        case 13: return "Epr: EEPROM fault";
        case 14: return "E.oH: External fault / overheat";
        case 15: return "SC: Short circuit";
        case 16: return "LU: Motor stall / load too heavy";
        case 17: return "bC: IGBT fault";
        case 18: return "SP: Speed deviation too large";
        case 19: return "RES: Reserved";
        case 20: return "AE: Analog input loss";
        case 21: return "CE: Comm timeout (Modbus)";
        case 22: return "tE: Current detect fault";
        case 23: return "rE: Motor auto-tune fail";
        default: return "Unknown fault";
    }
}

// ============================================================================
// STATUS REPORTING
// ============================================================================
void printStatus() {
    // Get fault string
    const char* faultStr = decodeFaultCode(vfd.faultCode);
    
    // Full JSON status - sent to FluidCNC server
    Serial.printf(
        "{\"vfd\":{"
        "\"online\":%s,"
        "\"running\":%s,"
        "\"direction\":\"%s\","
        "\"fault\":%s,"
        "\"faultCode\":%d,"
        "\"faultString\":\"%s\","
        "\"setRpm\":%d,"
        "\"actualRpm\":%d,"
        "\"setFreqHz\":%.2f,"
        "\"actualFreqHz\":%.2f,"
        "\"outputAmps\":%.1f,"
        "\"outputVolts\":%.0f,"
        "\"dcBusVolts\":%.0f,"
        "\"motorTempC\":%.0f,"
        "\"vfdTempC\":%.0f,"
        "\"outputPower\":%.0f,"
        "\"totalHours\":%lu,"
        "\"loadPercent\":%.1f,"
        "\"commErrors\":%d,"
        "\"successCount\":%d,"
        "\"uptime\":%lu"
        "}}\n",
        vfd.online ? "true" : "false",
        vfd.running ? "true" : "false",
        vfd.forward ? "FWD" : "REV",
        vfd.fault ? "true" : "false",
        vfd.faultCode,
        faultStr,
        vfd.setRpm,
        vfd.actualRpm,
        vfd.setFreqHz,
        vfd.actualFreqHz,
        vfd.outputAmps,
        vfd.outputVolts,
        vfd.dcBusVolts,
        vfd.motorTempC,
        vfd.vfdTempC,
        vfd.outputPower,
        vfd.totalHours,
        vfd.loadPercent,
        vfd.commErrors,
        vfd.successCount,
        millis() / 1000
    );
}

void printHelp() {
    Serial.println(F(
        "\n"
        "ESP32 VFD Controller Commands:\n"
        "==============================\n"
        "RPM:12000    - Set spindle RPM\n"
        "STOP         - Stop spindle\n"
        "FWD          - Run forward\n"
        "REV          - Run reverse\n"
        "STATUS       - Get JSON status\n"
        "CONFIG       - Show config\n"
        "WARMUP       - Run spindle warmup cycle\n"
        "\n"
        "=== Speed Ramp Settings ===\n"
        "ACCEL:1.0    - Set accel time (seconds) - how fast spindle speeds UP\n"
        "DECEL:3.0    - Set decel time (seconds) - how fast spindle slows DOWN\n"
        "FASTRAMP     - Quick preset: 1s accel, 2s decel (RECOMMENDED)\n"
        "SLOWRAMP     - Safe preset: 5s accel, 8s decel\n"
        "             Note: Without braking resistor, decel can't be instant!\n"
        "\n"
        "=== Configuration ===\n"
        "BAUD:9600    - Set Modbus baud (9600/19200/38400)\n"
        "ADDR:1       - Set VFD address (1-247)\n"
        "MAXRPM:24000 - Set max RPM\n"
        "MINRPM:0     - Set min RPM\n"
        "MAXFREQ:400  - Set max frequency (Hz)\n"
        "POLL:100     - Set poll interval (ms)\n"
        "DEBUG:1      - Enable debug\n"
        "DEBUG:0      - Disable debug\n"
        "SAVE         - Save config to flash\n"
        "RESET        - Restart ESP32\n"
        "\n"
        "=== Diagnostics ===\n"
        "FINDBAUD     - Find VFD baud rate (F164 setting)\n"
        "MANUALRUN    - Spin using EXACT manual protocol\n"
        "SHOTGUN      - Find VFD (all baud/addr combos)\n"
        "FREQTEST     - Test freq register addresses\n"
        "H100SPIN     - H100 coil spin test\n"
        "LOOPBACK     - RS485 loopback test\n"
        "UARTLOOP     - Direct UART loopback\n"
        "PINTEST      - Toggle DE/RE pin\n"
        "\n"
        "HELP         - Show this\n"
    ));
}

// ============================================================================
// COMMAND PROCESSING
// ============================================================================
void processCommand(String cmd) {
    cmd.trim();
    cmd.toUpperCase();
    
    if (config.debugMode) {
        Serial.printf("[DEBUG] Command: %s\n", cmd.c_str());
    }
    
    if (cmd.startsWith("RPM:")) {
        int rpm = cmd.substring(4).toInt();
        rpm = constrain(rpm, config.minRpm, config.maxRpm);
        targetRpm = rpm;
        float freq = rpmToFreq(rpm);
        
        if (rpm == 0) {
            vfdStop();
            spindleEnabled = false;
            Serial.printf("{\"cmd\":\"RPM\",\"rpm\":0,\"status\":\"stopped\"}\n");
        } else {
            vfdSetFrequency(freq);
            if (!vfd.running) {
                if (spindleReverse) {
                    vfdRunReverse();
                } else {
                    vfdRunForward();
                }
            }
            spindleEnabled = true;
            Serial.printf("{\"cmd\":\"RPM\",\"rpm\":%d,\"freqHz\":%.2f}\n", rpm, freq);
        }
    }
    else if (cmd == "STOP") {
        vfdStop();
        targetRpm = 0;
        spindleEnabled = false;
        Serial.println("{\"cmd\":\"STOP\",\"status\":\"ok\"}");
    }
    else if (cmd == "FWD") {
        spindleReverse = false;
        vfd.forward = true;  // Always update direction state
        if (targetRpm > 0) {
            vfdRunForward();
        }
        Serial.println("{\"cmd\":\"FWD\",\"status\":\"ok\"}");
    }
    else if (cmd == "REV") {
        spindleReverse = true;
        vfd.forward = false;  // Always update direction state
        if (targetRpm > 0) {
            vfdRunReverse();
        }
        Serial.println("{\"cmd\":\"REV\",\"status\":\"ok\"}");
    }
    else if (cmd == "STATUS") {
        printStatus();
    }
    else if (cmd == "CONFIG") {
        printConfig();
    }
    else if (cmd == "FINDBAUD") {
        // Comprehensive baud rate finder with proper timing
        Serial.println(F("\n=== COMPREHENSIVE BAUD FINDER ==="));
        Serial.println(F("Testing all baud rates at addresses 1-5...\n"));
        
        uint32_t bauds[] = {4800, 9600, 19200, 38400};
        const char* baudNames[] = {"4800", "9600", "19200", "38400"};
        
        auto calcCRC = [](uint8_t* data, int len) -> uint16_t {
            uint16_t crc = 0xFFFF;
            for (int i = 0; i < len; i++) {
                crc ^= data[i];
                for (int j = 0; j < 8; j++) {
                    if (crc & 1) crc = (crc >> 1) ^ 0xA001;
                    else crc >>= 1;
                }
            }
            return crc;
        };
        
        bool found = false;
        
        for (int b = 0; b < 4 && !found; b++) {
            Serial.printf("--- Testing %s baud ---\n", baudNames[b]);
            RS485Serial.updateBaudRate(bauds[b]);
            delay(100);
            
            for (int addr = 1; addr <= 5 && !found; addr++) {
                // Clear any garbage
                while (RS485Serial.available()) RS485Serial.read();
                
                // Build read request for this address
                uint8_t frame[8];
                frame[0] = addr;
                frame[1] = 0x03;  // Read holding registers
                frame[2] = 0x00;
                frame[3] = 0x00;
                frame[4] = 0x00;
                frame[5] = 0x01;
                uint16_t crc = calcCRC(frame, 6);
                frame[6] = crc & 0xFF;
                frame[7] = (crc >> 8) & 0xFF;
                
                // Transmit
                digitalWrite(RS485_DE_RE_PIN, HIGH);
                delay(2);
                RS485Serial.write(frame, 8);
                RS485Serial.flush();
                delay(15);  // Wait for TX to complete
                digitalWrite(RS485_DE_RE_PIN, LOW);
                
                // Clear TX echo garbage
                delay(5);
                while (RS485Serial.available()) RS485Serial.read();
                
                // Wait for real response
                delay(100);
                
                if (RS485Serial.available() > 0) {
                    // Got something - check if it's valid
                    uint8_t rx[16];
                    int n = 0;
                    while (RS485Serial.available() && n < 16) {
                        rx[n++] = RS485Serial.read();
                        delay(2);
                    }
                    
                    // Valid response should be: addr, 0x03, 0x02, data_hi, data_lo, crc_lo, crc_hi
                    if (n >= 5 && rx[0] == addr && rx[1] == 0x03) {
                        Serial.printf("*** FOUND! Addr=%d Baud=%s ***\n", addr, baudNames[b]);
                        Serial.print(F("Response: "));
                        for (int i = 0; i < n; i++) Serial.printf("%02X ", rx[i]);
                        Serial.println();
                        config.vfdAddress = addr;
                        config.modbusBaud = bauds[b];
                        found = true;
                    } else {
                        Serial.printf("  Addr %d: Got %d bytes but invalid format\n", addr, n);
                    }
                }
            }
        }
        
        if (!found) {
            Serial.println(F("\nNO VFD FOUND!"));
            Serial.println(F("Possible issues:"));
            Serial.println(F("1. Wiring: Check A/B connections (try swapping)"));
            Serial.println(F("2. VFD power: Is the VFD powered on?"));
            Serial.println(F("3. VFD settings: F163 must be 1-250 (not 0)"));
            Serial.println(F("4. Termination: May need 120ohm resistor"));
        } else {
            Serial.printf("\nUsing: Addr=%d Baud=%d\n", config.vfdAddress, config.modbusBaud);
            RS485Serial.updateBaudRate(config.modbusBaud);
        }
    }
    else if (cmd.startsWith("BAUD:")) {
        config.modbusBaud = cmd.substring(5).toInt();
        RS485Serial.updateBaudRate(config.modbusBaud);
        Serial.printf("{\"cmd\":\"BAUD\",\"value\":%d}\n", config.modbusBaud);
    }
    else if (cmd.startsWith("ADDR:")) {
        config.vfdAddress = cmd.substring(5).toInt();
        modbus.begin(config.vfdAddress, RS485Serial);
        Serial.printf("{\"cmd\":\"ADDR\",\"value\":%d}\n", config.vfdAddress);
    }
    else if (cmd.startsWith("MAXRPM:")) {
        config.maxRpm = cmd.substring(7).toInt();
        Serial.printf("{\"cmd\":\"MAXRPM\",\"value\":%d}\n", config.maxRpm);
    }
    else if (cmd.startsWith("MINRPM:")) {
        config.minRpm = cmd.substring(7).toInt();
        Serial.printf("{\"cmd\":\"MINRPM\",\"value\":%d}\n", config.minRpm);
    }
    else if (cmd.startsWith("MAXFREQ:")) {
        config.maxFreq = cmd.substring(8).toInt();
        Serial.printf("{\"cmd\":\"MAXFREQ\",\"value\":%d}\n", config.maxFreq);
    }
    else if (cmd.startsWith("POLL:")) {
        config.pollInterval = cmd.substring(5).toInt();
        Serial.printf("{\"cmd\":\"POLL\",\"value\":%d}\n", config.pollInterval);
    }
    else if (cmd.startsWith("DEBUG:")) {
        config.debugMode = cmd.substring(6).toInt() != 0;
        Serial.printf("{\"cmd\":\"DEBUG\",\"value\":%s}\n", config.debugMode ? "true" : "false");
    }
    else if (cmd.startsWith("ACCEL:")) {
        // Set acceleration time in seconds (e.g., ACCEL:1.0 = 1 second)
        float secs = cmd.substring(6).toFloat();
        config.accelTime = (uint16_t)(secs * 10);  // Store as 0.1s units
        config.accelTime = constrain(config.accelTime, 1, 600);  // 0.1s to 60s
        Serial.printf("{\"cmd\":\"ACCEL\",\"seconds\":%.1f,\"value\":%d}\n", secs, config.accelTime);
        
        // Write to VFD immediately (F014 = accel time, address 0x000E)
        vfdWriteParameter(H100_REG_F014, config.accelTime);
    }
    else if (cmd.startsWith("DECEL:")) {
        // Set deceleration time in seconds (e.g., DECEL:3.0 = 3 seconds)
        float secs = cmd.substring(6).toFloat();
        config.decelTime = (uint16_t)(secs * 10);  // Store as 0.1s units
        config.decelTime = constrain(config.decelTime, 1, 600);  // 0.1s to 60s
        Serial.printf("{\"cmd\":\"DECEL\",\"seconds\":%.1f,\"value\":%d}\n", secs, config.decelTime);
        
        // Write to VFD immediately (F015 = decel time, address 0x000F)
        vfdWriteParameter(H100_REG_F015, config.decelTime);
    }
    else if (cmd == "FASTRAMP") {
        // Quick preset for fast acceleration (1 second up, 2 seconds down)
        config.accelTime = 10;  // 1.0 seconds
        config.decelTime = 20;  // 2.0 seconds (still need to coast a bit without braking resistor)
        vfdWriteParameter(H100_REG_F014, config.accelTime);
        delay(50);
        vfdWriteParameter(H100_REG_F015, config.decelTime);
        Serial.println("{\"cmd\":\"FASTRAMP\",\"accel\":1.0,\"decel\":2.0,\"note\":\"Fast ramp applied!\"}");
    }
    else if (cmd == "SLOWRAMP") {
        // Safe preset for slow acceleration
        config.accelTime = 50;  // 5.0 seconds
        config.decelTime = 80;  // 8.0 seconds (coast down safely)
        vfdWriteParameter(H100_REG_F014, config.accelTime);
        delay(50);
        vfdWriteParameter(H100_REG_F015, config.decelTime);
        Serial.println("{\"cmd\":\"SLOWRAMP\",\"accel\":5.0,\"decel\":8.0}");
    }
    else if (cmd == "SAVE") {
        saveConfig();
    }
    else if (cmd == "RESET") {
        Serial.println("{\"cmd\":\"RESET\",\"status\":\"rebooting\"}");
        delay(100);
        ESP.restart();
    }
    else if (cmd == "HELP") {
        printHelp();
    }
    else if (cmd == "WARMUP") {
        // Spindle warmup cycle - gradually ramps through speeds
        Serial.println(F("{\"cmd\":\"WARMUP\",\"status\":\"starting\"}"));
        
        struct WarmupStep { int rpm; int duration; };
        WarmupStep steps[] = {
            {3000, 15},   // 3000 RPM for 15s
            {6000, 15},
            {10000, 20},
            {15000, 20},
            {20000, 30},
            {(int)config.maxRpm, 30}
        };
        
        for (auto& step : steps) {
            Serial.printf("{\"warmup\":{\"rpm\":%d,\"duration\":%d}}\n", step.rpm, step.duration);
            
            // Set frequency and run
            float freq = rpmToFreq(step.rpm);
            vfdSetFrequency(freq);
            if (!vfd.running) {
                vfdRunForward();
            }
            
            // Wait for duration (but poll status)
            for (int i = 0; i < step.duration * 2; i++) {
                pollVFDStatus();
                delay(500);
                
                // Check for STOP command
                if (Serial.available()) {
                    String input = Serial.readStringUntil('\n');
                    input.trim();
                    input.toUpperCase();
                    if (input == "STOP") {
                        vfdStop();
                        Serial.println(F("{\"cmd\":\"WARMUP\",\"status\":\"aborted\"}"));
                        return;
                    }
                }
            }
        }
        
        vfdStop();
        Serial.println(F("{\"cmd\":\"WARMUP\",\"status\":\"complete\"}"));
    }
    else if (cmd == "LOOPBACK") {
        // RS485 loopback test - SHORT A to B on the MAX485, should echo back
        Serial.println(F("RS485 Loopback Test"));
        Serial.println(F("SHORT the RS485 A/B wires together (or just use loopback on MAX485)"));
        Serial.println(F("Sending test bytes..."));
        
        // Flush any garbage
        while (RS485Serial.available()) RS485Serial.read();
        
        // For loopback, we need to receive while transmitting
        // Some MAX485 modules can do this if DE=HIGH and RE=LOW (tied to GND separately)
        // But typically DE+RE are tied together, so we transmit then quickly switch
        
        // Enable transmit
        digitalWrite(RS485_DE_RE_PIN, HIGH);
        delay(5);  // Give time to stabilize
        
        // Send test pattern
        uint8_t testData[] = {0x01, 0x03, 0x00, 0x00, 0x00, 0x02, 0xC4, 0x0B};  // Modbus read holding regs
        RS485Serial.write(testData, 8);
        RS485Serial.flush();  // Wait for transmit complete
        
        // At 9600 baud: 8 bytes = ~8.3ms to transmit
        // We missed them because RX was disabled. For loopback test with DE+RE tied,
        // we can't truly loopback. So let's just verify TX is sending correctly.
        
        delay(10);  // Wait for line to settle
        digitalWrite(RS485_DE_RE_PIN, LOW);  // Back to receive
        
        // Wait for any echo (if VFD is connected and responds)
        delay(100);
        
        Serial.printf("Bytes in RX buffer: %d\n", RS485Serial.available());
        
        int rxCount = RS485Serial.available();
        if (rxCount > 0) {
            Serial.print("Received: ");
            bool match = true;
            for (int i = 0; i < rxCount; i++) {
                uint8_t b = RS485Serial.read();
                Serial.printf("%02X ", b);
                if (i < 8 && b != testData[i]) match = false;
            }
            Serial.println();
            if (rxCount >= 8 && match) {
                Serial.println(F("SUCCESS! RS485 loopback working - wiring to ESP32/MAX485 is GOOD"));
            } else if (rxCount >= 8) {
                Serial.println(F("PARTIAL - Got 8+ bytes but data mismatch - possible noise/corruption"));
            } else {
                Serial.printf("PARTIAL - Only got %d of 8 bytes\n", rxCount);
                Serial.println(F("TX works but possible timing or RX issue"));
            }
        } else {
            Serial.println(F("FAIL - No echo received"));
            Serial.println(F("Check wiring:"));
            Serial.printf("  GPIO%d (TX2) -> MAX485 DI (pin 4)\n", RS485_TX_PIN);
            Serial.printf("  GPIO%d (RX2) -> MAX485 RO (pin 1)\n", RS485_RX_PIN);
            Serial.printf("  GPIO%d       -> MAX485 DE (pin 3) + RE (pin 2)\n", RS485_DE_RE_PIN);
            Serial.println(F("  ESP32 GND   -> MAX485 GND"));
            Serial.println(F("  ESP32 3.3V  -> MAX485 VCC"));
        }
        
        // Drain any remaining
        while (RS485Serial.available()) RS485Serial.read();
    }
    else if (cmd == "RAWTEST") {
        // Just toggle DE/RE and send raw bytes to verify output
        Serial.println(F("Raw RS485 Output Test"));
        Serial.println(F("Put oscilloscope/logic analyzer on MAX485 A/B or DI pin"));
        
        for (int i = 0; i < 5; i++) {
            Serial.printf("Sending burst %d/5...\n", i + 1);
            
            digitalWrite(RS485_DE_RE_PIN, HIGH);
            delayMicroseconds(50);
            
            // Send some bytes
            RS485Serial.write(0x55);  // 01010101 - nice pattern
            RS485Serial.write(0xAA);  // 10101010
            RS485Serial.write(0x01);  // Address
            RS485Serial.write(0x03);  // Function
            RS485Serial.flush();
            
            delayMicroseconds(50);
            digitalWrite(RS485_DE_RE_PIN, LOW);
            
            delay(200);
        }
        Serial.println(F("Done. Did you see activity on RS485 lines?"));
    }
    else if (cmd == "UARTLOOP") {
        // Direct UART loopback - bypass MAX485 entirely
        // Connect GPIO17 (TX) directly to GPIO16 (RX) with a jumper wire
        Serial.println(F("Direct UART Loopback Test"));
        Serial.println(F("DISCONNECT MAX485 and jumper GPIO17 -> GPIO16 directly"));
        Serial.println(F("This tests ESP32 UART only, no MAX485 involved"));
        
        // Flush RX buffer
        while (RS485Serial.available()) RS485Serial.read();
        
        // Send test pattern (DE/RE doesn't matter for direct UART)
        uint8_t testData[] = {0x01, 0x03, 0x00, 0x00, 0x00, 0x02, 0xC4, 0x0B};
        RS485Serial.write(testData, 8);
        RS485Serial.flush();
        
        // Wait for data to loop back
        delay(20);
        
        Serial.printf("Bytes in RX buffer: %d\n", RS485Serial.available());
        
        int rxCount = RS485Serial.available();
        if (rxCount >= 8) {
            Serial.print("Received: ");
            bool match = true;
            for (int i = 0; i < rxCount; i++) {
                uint8_t b = RS485Serial.read();
                Serial.printf("%02X ", b);
                if (i < 8 && b != testData[i]) match = false;
            }
            Serial.println();
            if (match) {
                Serial.println(F("SUCCESS! ESP32 UART2 working correctly"));
            } else {
                Serial.println(F("FAIL - Data corrupted"));
            }
        } else {
            Serial.println(F("FAIL - No loopback received"));
            Serial.println(F("Make sure GPIO17 is directly connected to GPIO16 (no MAX485)"));
        }
        while (RS485Serial.available()) RS485Serial.read();
    }
    else if (cmd == "RAWDEBUG") {
        // Detailed TX/RX debug - shows exactly what's happening
        Serial.println(F("\n=== RAW MODBUS DEBUG ==="));
        Serial.println(F("Sending a simple read and showing EXACT bytes\n"));
        
        auto calcCRC = [](uint8_t* data, int len) -> uint16_t {
            uint16_t crc = 0xFFFF;
            for (int i = 0; i < len; i++) {
                crc ^= data[i];
                for (int j = 0; j < 8; j++) {
                    if (crc & 1) crc = (crc >> 1) ^ 0xA001;
                    else crc >>= 1;
                }
            }
            return crc;
        };
        
        // Clear any pending data
        while (RS485Serial.available()) RS485Serial.read();
        
        // Build a simple read request: Read holding register 0x0000
        uint8_t frame[8];
        frame[0] = 0x01;  // Address
        frame[1] = 0x03;  // Function: Read holding registers
        frame[2] = 0x00;  // Register high
        frame[3] = 0x00;  // Register low
        frame[4] = 0x00;  // Count high
        frame[5] = 0x01;  // Count low (1 register)
        uint16_t crc = calcCRC(frame, 6);
        frame[6] = crc & 0xFF;
        frame[7] = (crc >> 8) & 0xFF;
        
        Serial.print(F("TX frame: "));
        for (int i = 0; i < 8; i++) Serial.printf("%02X ", frame[i]);
        Serial.println();
        
        // Clear RX buffer before transmitting
        while (RS485Serial.available()) RS485Serial.read();
        
        // Transmit
        digitalWrite(RS485_DE_RE_PIN, HIGH);
        delay(2);  // Let DE/RE stabilize
        unsigned long txStart = micros();
        RS485Serial.write(frame, 8);
        RS485Serial.flush();
        unsigned long txEnd = micros();
        delayMicroseconds(500);  // Minimal delay - just for last bit
        digitalWrite(RS485_DE_RE_PIN, LOW);  // Switch to RX IMMEDIATELY
        
        // DON'T clear buffer - VFD response comes FAST
        // Our own TX echo will be in the buffer too - we'll deal with it
        
        Serial.printf("TX took: %lu us\n", txEnd - txStart);
        Serial.println(F("Waiting for response..."));
        
        // Wait for response with timeout
        unsigned long start = millis();
        while (millis() - start < 200) {
            if (RS485Serial.available() > 0) break;
            delayMicroseconds(100);
        }
        
        Serial.printf("Time to first byte: %lu ms\n", millis() - start);
        Serial.printf("Bytes available: %d\n", RS485Serial.available());
        
        // Read response
        if (RS485Serial.available() > 0) {
            Serial.print(F("RX frame: "));
            uint8_t rx[32];
            int n = 0;
            while (RS485Serial.available() && n < 32) {
                rx[n++] = RS485Serial.read();
                delay(2);  // Wait for more bytes
            }
            for (int i = 0; i < n; i++) Serial.printf("%02X ", rx[i]);
            Serial.println();
            
            // Analyze
            if (n >= 7 && rx[0] == 0x01 && rx[1] == 0x03 && rx[2] == 0x02) {
                int value = (rx[3] << 8) | rx[4];
                Serial.printf("\nVALID RESPONSE! Register value = %d (0x%04X)\n", value, value);
            } else if (n >= 5 && rx[0] == 0x01 && rx[1] == 0x83) {
                Serial.printf("\nMODBUS EXCEPTION! Code = 0x%02X\n", rx[2]);
                if (rx[2] == 0x01) Serial.println(F("  = Illegal Function"));
                if (rx[2] == 0x02) Serial.println(F("  = Illegal Data Address"));
                if (rx[2] == 0x03) Serial.println(F("  = Illegal Data Value"));
            } else if (n >= 8) {
                // Check if it's our own echo
                bool isEcho = true;
                for (int i = 0; i < 8 && i < n; i++) {
                    if (rx[i] != frame[i]) isEcho = false;
                }
                if (isEcho) {
                    Serial.println(F("\nWARNING: Received our own TX! This means:"));
                    Serial.println(F("  1. MAX485 RE not disabled during TX, OR"));
                    Serial.println(F("  2. VFD not connected/responding"));
                }
            } else {
                Serial.println(F("\nUnknown/partial response"));
            }
        } else {
            Serial.println(F("NO RESPONSE - VFD not responding or not connected"));
        }
    }
    else if (cmd == "WRITETEST") {
        // Try write commands - some VFDs only respond to writes
        Serial.println(F("\n=== WRITE COMMAND TEST ==="));
        Serial.println(F("Testing if VFD responds to write commands..."));
        
        auto calcCRC = [](uint8_t* data, int len) -> uint16_t {
            uint16_t crc = 0xFFFF;
            for (int i = 0; i < len; i++) {
                crc ^= data[i];
                for (int j = 0; j < 8; j++) {
                    if (crc & 1) crc = (crc >> 1) ^ 0xA001;
                    else crc >>= 1;
                }
            }
            return crc;
        };
        
        auto testFrame = [&](const char* name, uint8_t* data, int len) {
            while (RS485Serial.available()) RS485Serial.read();
            uint16_t crc = calcCRC(data, len);
            
            Serial.printf("%s TX: ", name);
            for (int i = 0; i < len; i++) Serial.printf("%02X ", data[i]);
            Serial.printf("%02X %02X\n", crc & 0xFF, (crc >> 8) & 0xFF);
            
            digitalWrite(RS485_DE_RE_PIN, HIGH);
            delay(5);
            RS485Serial.write(data, len);
            RS485Serial.write(crc & 0xFF);
            RS485Serial.write((crc >> 8) & 0xFF);
            RS485Serial.flush();
            delay(15);
            digitalWrite(RS485_DE_RE_PIN, LOW);
            delay(5);
            while (RS485Serial.available()) RS485Serial.read();  // Clear echo
            delay(150);  // Wait for response
            
            Serial.print(F("      RX: "));
            if (RS485Serial.available() > 0) {
                while (RS485Serial.available()) Serial.printf("%02X ", RS485Serial.read());
                Serial.println(F(" <-- RESPONSE!"));
            } else {
                Serial.println(F("(none)"));
            }
        };
        
        // Test 1: Standard Modbus write single register (FC 06)
        // Write 0 to register 0x0201 (safe - just sets freq to 0)
        uint8_t write1[] = {0x01, 0x06, 0x02, 0x01, 0x00, 0x00};
        testFrame("Modbus FC06 reg 0x0201", write1, 6);
        
        // Test 2: Standard Modbus write coil (FC 05)
        uint8_t write2[] = {0x01, 0x05, 0x00, 0x4B, 0xFF, 0x00};  // Stop coil
        testFrame("Modbus FC05 coil 0x004B", write2, 6);
        
        // Test 3: Write to register 0x0200 (main control)
        uint8_t write3[] = {0x01, 0x06, 0x02, 0x00, 0x00, 0x00};
        testFrame("Modbus FC06 reg 0x0200", write3, 6);
        
        // Test 4: Huanyang set freq
        uint8_t hy1[] = {0x01, 0x02, 0x02, 0x00, 0x00};
        testFrame("Huanyang set freq 0", hy1, 5);
        
        // Test 5: Huanyang control (stop)
        uint8_t hy2[] = {0x01, 0x01, 0x03, 0x08, 0x00, 0x00};
        testFrame("Huanyang stop cmd", hy2, 6);
        
        // Test 6: Different addresses
        uint8_t addr2[] = {0x02, 0x03, 0x00, 0x00, 0x00, 0x01};
        testFrame("Addr 2 read", addr2, 6);
        
        uint8_t addr0[] = {0x00, 0x06, 0x02, 0x01, 0x00, 0x00};  // Broadcast write
        testFrame("Broadcast write", addr0, 6);
        
        Serial.println(F("\nIf NO responses, check:"));
        Serial.println(F("  - F163 must be 1-250 (not 0)"));
        Serial.println(F("  - Correct RS485 terminals (485+/485-)"));
        Serial.println(F("  - Try swapping A/B wires again"));
        Serial.println(F("  - Check VFD is powered and not in fault"));
    }
    else if (cmd == "PINTEST") {
        // Test that DE/RE pin is working
        Serial.println(F("DE/RE Pin Toggle Test"));
        Serial.printf("GPIO%d will toggle HIGH/LOW 5 times\n", RS485_DE_RE_PIN);
        Serial.println(F("Measure with multimeter or scope:"));
        Serial.println(F("  HIGH = ~3.3V (transmit mode)"));
        Serial.println(F("  LOW  = ~0V (receive mode)"));
        
        for (int i = 0; i < 5; i++) {
            Serial.println(F("HIGH..."));
            digitalWrite(RS485_DE_RE_PIN, HIGH);
            delay(1000);
            Serial.println(F("LOW..."));
            digitalWrite(RS485_DE_RE_PIN, LOW);
            delay(1000);
        }
        Serial.println(F("Done."));
    }
    else if (cmd == "TEST8N2") {
        // Test with 8N1 at 19200 - matches F164=2, F165=3 (RTU 8N1!)
        Serial.println(F("=== TEST @ 19200 BAUD 8N1 RTU ==="));
        Serial.println(F("F164=2 (19200), F165=3 (8N1 RTU mode)"));
        Serial.println();
        
        // Reconfigure serial with 8N1 at 19200
        RS485Serial.end();
        delay(50);
        RS485Serial.begin(19200, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);
        delay(100);
        
        // Clear buffer
        while (RS485Serial.available()) RS485Serial.read();
        
        auto calcCRC = [](uint8_t* data, int len) -> uint16_t {
            uint16_t crc = 0xFFFF;
            for (int i = 0; i < len; i++) {
                crc ^= data[i];
                for (int j = 0; j < 8; j++) {
                    if (crc & 1) crc = (crc >> 1) ^ 0xA001;
                    else crc >>= 1;
                }
            }
            return crc;
        };
        
        // Try reading register 0x0210 (main control bit status)
        // Frame: 01 03 02 10 00 01 CRC
        uint8_t frame[8];
        frame[0] = 0x01;  // Slave address
        frame[1] = 0x03;  // Read holding registers
        frame[2] = 0x02;  // High byte of reg 0x0210
        frame[3] = 0x10;  // Low byte
        frame[4] = 0x00;  // Read 1 register
        frame[5] = 0x01;
        uint16_t crc = calcCRC(frame, 6);
        frame[6] = crc & 0xFF;
        frame[7] = (crc >> 8) & 0xFF;
        
        Serial.print(F("TX (reg 0x0210): "));
        for (int i = 0; i < 8; i++) Serial.printf("%02X ", frame[i]);
        Serial.println();
        
        // Transmit
        digitalWrite(RS485_DE_RE_PIN, HIGH);
        delay(2);
        RS485Serial.write(frame, 8);
        RS485Serial.flush();
        delay(20);
        digitalWrite(RS485_DE_RE_PIN, LOW);
        
        // Clear echo
        delay(10);
        while (RS485Serial.available()) RS485Serial.read();
        
        // Wait for response
        delay(200);
        
        int avail = RS485Serial.available();
        if (avail > 0) {
            Serial.print(F("RX: "));
            while (RS485Serial.available()) {
                Serial.printf("%02X ", RS485Serial.read());
            }
            Serial.println();
            Serial.println(F("*** VFD RESPONDED! ***"));
        } else {
            Serial.println(F("No response to 0x0210. Trying 0x0220 (output freq)..."));
            
            // Try 0x0220 - output frequency (input register mapped)
            while (RS485Serial.available()) RS485Serial.read();
            frame[2] = 0x02;
            frame[3] = 0x20;
            crc = calcCRC(frame, 6);
            frame[6] = crc & 0xFF;
            frame[7] = (crc >> 8) & 0xFF;
            
            Serial.print(F("TX (reg 0x0220): "));
            for (int i = 0; i < 8; i++) Serial.printf("%02X ", frame[i]);
            Serial.println();
            
            digitalWrite(RS485_DE_RE_PIN, HIGH);
            delay(2);
            RS485Serial.write(frame, 8);
            RS485Serial.flush();
            delay(20);
            digitalWrite(RS485_DE_RE_PIN, LOW);
            delay(10);
            while (RS485Serial.available()) RS485Serial.read();
            delay(200);
            
            if (RS485Serial.available() > 0) {
                Serial.print(F("RX: "));
                while (RS485Serial.available()) Serial.printf("%02X ", RS485Serial.read());
                Serial.println(F("\n*** VFD RESPONDED! ***"));
            } else {
                Serial.println(F("No response. Trying FC 0x04 (input register)..."));
                
                // Try function 04 (read input registers) at 0x0000
                while (RS485Serial.available()) RS485Serial.read();
                frame[1] = 0x04;  // Read input registers
                frame[2] = 0x00;
                frame[3] = 0x00;
                crc = calcCRC(frame, 6);
                frame[6] = crc & 0xFF;
                frame[7] = (crc >> 8) & 0xFF;
                
                Serial.print(F("TX (FC04, reg 0x0000): "));
                for (int i = 0; i < 8; i++) Serial.printf("%02X ", frame[i]);
                Serial.println();
                
                digitalWrite(RS485_DE_RE_PIN, HIGH);
                delay(2);
                RS485Serial.write(frame, 8);
                RS485Serial.flush();
                delay(20);
                digitalWrite(RS485_DE_RE_PIN, LOW);
                delay(10);
                while (RS485Serial.available()) RS485Serial.read();
                delay(200);
                
                if (RS485Serial.available() > 0) {
                    Serial.print(F("RX: "));
                    while (RS485Serial.available()) Serial.printf("%02X ", RS485Serial.read());
                    Serial.println(F("\n*** VFD RESPONDED! ***"));
                } else {
                    Serial.println(F("Still no response. VFD RS485 may be dead."));
                }
            }
        }
        
        // Restore original config
        RS485Serial.end();
        delay(50);
        RS485Serial.begin(config.modbusBaud, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);
    }
    else if (cmd == "FASTLOOP") {
        // Minimal delay loopback - tests RX path
        Serial.println(F("=== FAST LOOPBACK TEST ==="));
        Serial.println(F("Short A and B together!"));
        Serial.println();
        
        while (RS485Serial.available()) RS485Serial.read();
        
        digitalWrite(RS485_DE_RE_PIN, HIGH);
        delayMicroseconds(50);
        
        RS485Serial.write(0xAA);
        RS485Serial.write(0x55);
        RS485Serial.flush();
        
        // Immediate RX mode
        digitalWrite(RS485_DE_RE_PIN, LOW);
        delay(20);
        
        int cnt = RS485Serial.available();
        Serial.printf("Bytes received: %d\n", cnt);
        while (RS485Serial.available()) {
            uint8_t b = RS485Serial.read();
            Serial.printf("  0x%02X\n", b);
        }
        if (cnt == 2) Serial.println(F("SUCCESS - RX path works!"));
        else if (cnt == 0) Serial.println(F("FAIL - No echo. Check GPIO16 to RO connection"));
        else Serial.println(F("PARTIAL - Timing issue"));
    }
    else if (cmd == "RXPIN") {
        // Check if RX pin sees anything
        Serial.println(F("=== GPIO16 RX PIN TEST ==="));
        Serial.println(F("Put in RX mode and watch for 5 seconds..."));
        
        digitalWrite(RS485_DE_RE_PIN, LOW);
        while (RS485Serial.available()) RS485Serial.read();
        
        unsigned long start = millis();
        int total = 0;
        while (millis() - start < 5000) {
            if (RS485Serial.available()) {
                uint8_t b = RS485Serial.read();
                Serial.printf("RX: 0x%02X\n", b);
                total++;
            }
        }
        Serial.printf("Total received: %d\n", total);
        Serial.println(F("If 0, RX pin might not be connected to MAX485 RO"));
    }
    else if (cmd == "CAPTUREALL") {
        // Capture EVERYTHING - TX echo + VFD response
        Serial.println(F("=== CAPTURE ALL BYTES ==="));
        Serial.println(F("Will show TX echo AND any VFD response"));
        Serial.println();
        
        RS485Serial.end();
        delay(50);
        RS485Serial.begin(19200, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);
        delay(100);
        
        while (RS485Serial.available()) RS485Serial.read();
        
        // Build read request
        uint8_t frame[8] = {0x01, 0x03, 0x00, 0x00, 0x00, 0x01, 0x84, 0x0A};
        
        Serial.print(F("TX: "));
        for (int i = 0; i < 8; i++) Serial.printf("%02X ", frame[i]);
        Serial.println();
        
        // TX mode
        digitalWrite(RS485_DE_RE_PIN, HIGH);
        delayMicroseconds(100);
        
        // Send and immediately switch to RX
        RS485Serial.write(frame, 8);
        RS485Serial.flush();
        
        // Switch to RX as fast as possible
        digitalWrite(RS485_DE_RE_PIN, LOW);
        
        // Wait and capture everything
        delay(500);
        
        int n = RS485Serial.available();
        Serial.printf("Total bytes in buffer: %d\n", n);
        Serial.print(F("RX: "));
        while (RS485Serial.available()) {
            Serial.printf("%02X ", RS485Serial.read());
        }
        Serial.println();
        
        if (n > 8) {
            Serial.println(F("Got more than 8 bytes - VFD responded!"));
        } else if (n == 8) {
            Serial.println(F("Got exactly 8 bytes - just our TX echo"));
        } else {
            Serial.println(F("Got less than 8 - timing issue"));
        }
        
        RS485Serial.end();
        delay(50);
        RS485Serial.begin(config.modbusBaud, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);
    }
    else if (cmd == "SCANREG") {
        // Scan registers and show values
        Serial.println(F("=== REGISTER SCAN ==="));
        Serial.println(F("Reading key register ranges..."));
        Serial.println();
        
        // Holding registers 0x0000-0x000F (Function 03)
        Serial.println(F("--- Holding Regs 0x0000-0x000F (FC03) ---"));
        for (int reg = 0; reg <= 15; reg++) {
            uint8_t result = modbus.readHoldingRegisters(reg, 1);
            if (result == modbus.ku8MBSuccess) {
                uint16_t val = modbus.getResponseBuffer(0);
                Serial.printf("H0x%04X = %5u\n", reg, val);
            } else {
                Serial.printf("H0x%04X = ERR\n", reg);
            }
            delay(30);
        }
        
        // Input registers 0x0000-0x000F (Function 04) - often used for status
        Serial.println(F("\n--- Input Regs 0x0000-0x000F (FC04) ---"));
        for (int reg = 0; reg <= 15; reg++) {
            uint8_t result = modbus.readInputRegisters(reg, 1);
            if (result == modbus.ku8MBSuccess) {
                uint16_t val = modbus.getResponseBuffer(0);
                Serial.printf("I0x%04X = %5u\n", reg, val);
            } else {
                Serial.printf("I0x%04X = ERR\n", reg);
            }
            delay(30);
        }
        
        // Holding 0x0200-0x020F (control area)
        Serial.println(F("\n--- Holding Regs 0x0200-0x020F (FC03) ---"));
        for (int reg = 0x0200; reg <= 0x020F; reg++) {
            uint8_t result = modbus.readHoldingRegisters(reg, 1);
            if (result == modbus.ku8MBSuccess) {
                uint16_t val = modbus.getResponseBuffer(0);
                Serial.printf("H0x%04X = %5u\n", reg, val);
            } else {
                Serial.printf("H0x%04X = ERR\n", reg);
            }
            delay(30);
        }
        
        Serial.println(F("\nDone."));
    }
    else if (cmd == "MANUALTEST") {
        // Try EXACTLY what the manual says
        Serial.println(F("=== MANUAL PROTOCOL TEST ==="));
        Serial.println(F("Using EXACT frames from H100 manual"));
        Serial.println();
        
        // Ensure 19200 baud 8N1
        RS485Serial.end();
        delay(50);
        RS485Serial.begin(19200, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);
        delay(100);
        
        auto calcCRC = [](uint8_t* data, int len) -> uint16_t {
            uint16_t crc = 0xFFFF;
            for (int i = 0; i < len; i++) {
                crc ^= data[i];
                for (int j = 0; j < 8; j++) {
                    if (crc & 1) crc = (crc >> 1) ^ 0xA001;
                    else crc >>= 1;
                }
            }
            return crc;
        };
        
        auto sendFrame = [&](uint8_t* frame, int len, const char* desc) -> bool {
            uint16_t crc = calcCRC(frame, len);
            frame[len] = crc & 0xFF;
            frame[len+1] = (crc >> 8) & 0xFF;
            
            Serial.printf("%s\n  TX: ", desc);
            for (int i = 0; i < len+2; i++) Serial.printf("%02X ", frame[i]);
            Serial.println();
            
            while (RS485Serial.available()) RS485Serial.read();
            
            digitalWrite(RS485_DE_RE_PIN, HIGH);
            delay(5);
            RS485Serial.write(frame, len+2);
            RS485Serial.flush();
            delay(20);
            digitalWrite(RS485_DE_RE_PIN, LOW);
            
            delay(10);
            while (RS485Serial.available()) RS485Serial.read(); // clear echo
            delay(300);
            
            if (RS485Serial.available() > 0) {
                Serial.print(F("  RX: "));
                while (RS485Serial.available()) {
                    Serial.printf("%02X ", RS485Serial.read());
                }
                Serial.println(F(" <-- RESPONSE!"));
                return true;
            }
            Serial.println(F("  No response"));
            return false;
        };
        
        // Test 1: Read F000 (parameter lock) at register 0x0000
        // Manual says F000-F255 map to 0x0000-0x00FF
        uint8_t frame[12];
        frame[0] = 0x01;  // Address 1
        frame[1] = 0x03;  // Read holding registers
        frame[2] = 0x00;  // Reg 0x0000 hi
        frame[3] = 0x00;  // Reg 0x0000 lo
        frame[4] = 0x00;  // Count hi
        frame[5] = 0x01;  // Count lo = 1
        sendFrame(frame, 6, "1. Read F000 (reg 0x0000)");
        
        // Test 2: Read F001 (control mode)
        frame[3] = 0x01;
        sendFrame(frame, 6, "2. Read F001 (reg 0x0001)");
        
        // Test 3: Read input register 0x0000 (output freq) with FC 04
        frame[1] = 0x04;  // Read input registers
        frame[2] = 0x00;
        frame[3] = 0x00;
        sendFrame(frame, 6, "3. Read input reg 0x0000 (FC 04)");
        
        // Test 4: Read holding register 0x0220 (mapped output freq)
        frame[1] = 0x03;
        frame[2] = 0x02;
        frame[3] = 0x20;
        sendFrame(frame, 6, "4. Read reg 0x0220 (output freq mapped)");
        
        // Test 5: Read main control status 0x0210
        frame[3] = 0x10;
        sendFrame(frame, 6, "5. Read reg 0x0210 (main control status)");
        
        // Test 6: Try address 2 reading F000
        frame[0] = 0x02;
        frame[1] = 0x03;
        frame[2] = 0x00;
        frame[3] = 0x00;
        sendFrame(frame, 6, "6. Addr 2, Read F000");
        
        // Test 7: Broadcast (address 0) - no response expected but might wake VFD
        frame[0] = 0x00;
        Serial.println(F("7. Broadcast (addr 0) - no response expected"));
        uint16_t crc = calcCRC(frame, 6);
        frame[6] = crc & 0xFF;
        frame[7] = (crc >> 8) & 0xFF;
        while (RS485Serial.available()) RS485Serial.read();
        digitalWrite(RS485_DE_RE_PIN, HIGH);
        delay(5);
        RS485Serial.write(frame, 8);
        RS485Serial.flush();
        delay(20);
        digitalWrite(RS485_DE_RE_PIN, LOW);
        delay(500);
        
        // Test 8: Back to address 1, try FC 01 (read coil status)
        frame[0] = 0x01;
        frame[1] = 0x01;  // Read coil status
        frame[2] = 0x00;
        frame[3] = 0x00;
        frame[4] = 0x00;
        frame[5] = 0x08;  // Read 8 coils
        sendFrame(frame, 6, "8. Read coils 0x0000 (FC 01)");
        
        Serial.println(F("\nDone."));
        
        // Restore
        RS485Serial.end();
        delay(50);
        RS485Serial.begin(config.modbusBaud, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);
    }
    else if (cmd == "PROBE") {
        // Try multiple Modbus protocols to find what the VFD responds to
        Serial.println(F("Probing VFD with multiple protocols..."));
        Serial.println(F("Trying Huanyang, H100, and standard Modbus frames\n"));
        
        // Flush RX
        while (RS485Serial.available()) RS485Serial.read();
        
        // Huanyang protocol: Read control status
        // Frame: ADDR CMD LEN DATA... CRC16
        // Read status: 01 04 03 01 00 00 (addr=1, cmd=4, len=3, data=01 00 00)
        uint8_t hyRead[] = {0x01, 0x04, 0x03, 0x01, 0x00, 0x00};
        uint16_t crc = 0xFFFF;
        for (int i = 0; i < 6; i++) {
            crc ^= hyRead[i];
            for (int j = 0; j < 8; j++) {
                if (crc & 1) crc = (crc >> 1) ^ 0xA001;
                else crc >>= 1;
            }
        }
        
        Serial.print(F("1. Huanyang read status: "));
        digitalWrite(RS485_DE_RE_PIN, HIGH);
        delay(5);
        RS485Serial.write(hyRead, 6);
        RS485Serial.write(crc & 0xFF);
        RS485Serial.write((crc >> 8) & 0xFF);
        RS485Serial.flush();
        delay(10);
        digitalWrite(RS485_DE_RE_PIN, LOW);
        delay(100);
        
        if (RS485Serial.available() > 0) {
            Serial.print(F("RESPONSE: "));
            while (RS485Serial.available()) {
                Serial.printf("%02X ", RS485Serial.read());
            }
            Serial.println(F(" <-- VFD responded!"));
        } else {
            Serial.println(F("no response"));
        }
        
        delay(50);
        while (RS485Serial.available()) RS485Serial.read();
        
        // Standard Modbus: Read holding register 0
        // 01 03 00 00 00 01 84 0A
        uint8_t mbRead[] = {0x01, 0x03, 0x00, 0x00, 0x00, 0x01, 0x84, 0x0A};
        
        Serial.print(F("2. Modbus read reg 0: "));
        digitalWrite(RS485_DE_RE_PIN, HIGH);
        delay(5);
        RS485Serial.write(mbRead, 8);
        RS485Serial.flush();
        delay(10);
        digitalWrite(RS485_DE_RE_PIN, LOW);
        delay(100);
        
        if (RS485Serial.available() > 0) {
            Serial.print(F("RESPONSE: "));
            while (RS485Serial.available()) {
                Serial.printf("%02X ", RS485Serial.read());
            }
            Serial.println(F(" <-- VFD responded!"));
        } else {
            Serial.println(F("no response"));
        }
        
        delay(50);
        while (RS485Serial.available()) RS485Serial.read();
        
        // Try broadcast address (0)
        uint8_t bcRead[] = {0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x85, 0xDB};
        
        Serial.print(F("3. Broadcast read: "));
        digitalWrite(RS485_DE_RE_PIN, HIGH);
        delay(5);
        RS485Serial.write(bcRead, 8);
        RS485Serial.flush();
        delay(10);
        digitalWrite(RS485_DE_RE_PIN, LOW);
        delay(100);
        
        if (RS485Serial.available() > 0) {
            Serial.print(F("RESPONSE: "));
            while (RS485Serial.available()) {
                Serial.printf("%02X ", RS485Serial.read());
            }
            Serial.println(F(" <-- VFD responded!"));
        } else {
            Serial.println(F("no response"));
        }
        
        delay(50);
        while (RS485Serial.available()) RS485Serial.read();
        
        // Try address 2
        uint8_t a2Read[] = {0x02, 0x03, 0x00, 0x00, 0x00, 0x01, 0x84, 0x39};
        
        Serial.print(F("4. Address 2 read: "));
        digitalWrite(RS485_DE_RE_PIN, HIGH);
        delay(5);
        RS485Serial.write(a2Read, 8);
        RS485Serial.flush();
        delay(10);
        digitalWrite(RS485_DE_RE_PIN, LOW);
        delay(100);
        
        if (RS485Serial.available() > 0) {
            Serial.print(F("RESPONSE: "));
            while (RS485Serial.available()) {
                Serial.printf("%02X ", RS485Serial.read());
            }
            Serial.println(F(" <-- VFD responded!"));
        } else {
            Serial.println(F("no response"));
        }
        
        Serial.println(F("\nIf all 'no response' - check wiring or VFD RS485 settings"));
    }
    else if (cmd == "HYSPIN") {
        // Huanyang protocol spin command
        Serial.println(F("\n=== HUANYANG PROTOCOL SPIN ==="));
        Serial.println(F("Using Huanyang VFD protocol to spin spindle"));
        
        auto calcCRC = [](uint8_t* data, int len) -> uint16_t {
            uint16_t crc = 0xFFFF;
            for (int i = 0; i < len; i++) {
                crc ^= data[i];
                for (int j = 0; j < 8; j++) {
                    if (crc & 1) crc = (crc >> 1) ^ 0xA001;
                    else crc >>= 1;
                }
            }
            return crc;
        };
        
        auto sendHY = [&](const char* name, uint8_t* data, int len) -> bool {
            while (RS485Serial.available()) RS485Serial.read();
            uint16_t crc = calcCRC(data, len);
            
            Serial.printf("%s: TX=", name);
            for (int i = 0; i < len; i++) Serial.printf("%02X ", data[i]);
            Serial.printf("%02X %02X -> ", crc & 0xFF, (crc >> 8) & 0xFF);
            
            digitalWrite(RS485_DE_RE_PIN, HIGH);
            delay(5);
            RS485Serial.write(data, len);
            RS485Serial.write(crc & 0xFF);
            RS485Serial.write((crc >> 8) & 0xFF);
            RS485Serial.flush();
            delay(15);
            digitalWrite(RS485_DE_RE_PIN, LOW);
            
            // Clear echo garbage
            delay(5);
            while (RS485Serial.available()) RS485Serial.read();
            
            // Wait for real response
            delay(100);
            
            if (RS485Serial.available() > 0) {
                Serial.print(F("RX="));
                while (RS485Serial.available()) {
                    Serial.printf("%02X ", RS485Serial.read());
                }
                Serial.println(F(" OK"));
                return true;
            } else {
                Serial.println(F("no response"));
                return false;
            }
        };
        
        // Huanyang protocol format:
        // ADDR CMD LEN DATA... CRC16
        // CMD: 01=control, 02=set freq, 03=read param, 04=write param, 05=read status
        
        // Step 1: Set frequency - CMD=02, LEN=02, DATA=freq_hi, freq_lo
        // Frequency in 0.01Hz units: 50Hz = 5000 = 0x1388
        Serial.println(F("\nStep 1: Set frequency to 50Hz (5000 = 0x1388)"));
        uint8_t setFreq[] = {0x01, 0x02, 0x02, 0x13, 0x88};  // addr=1, cmd=2, len=2, freq=5000
        sendHY("Set Freq", setFreq, 5);
        delay(200);
        
        // Step 2: Run Forward - CMD=01, LEN=03, DATA=01 (control word), 01 (run), 00 (reserved)
        // Control word meanings: 01=run, 08=stop, 11=jog fwd, 21=jog rev
        Serial.println(F("\nStep 2: Run Forward"));
        uint8_t runFwd[] = {0x01, 0x01, 0x03, 0x01, 0x00, 0x00};  // addr=1, cmd=1, len=3, run fwd
        sendHY("Run FWD", runFwd, 6);
        delay(2000);
        
        Serial.println(F("\n*** SPINDLE SHOULD BE RUNNING NOW! ***"));
        Serial.println(F("Send HYSTOP to stop."));
    }
    else if (cmd == "HYSTOP") {
        // Huanyang protocol stop command
        Serial.println(F("\n=== HUANYANG STOP ==="));
        
        auto calcCRC = [](uint8_t* data, int len) -> uint16_t {
            uint16_t crc = 0xFFFF;
            for (int i = 0; i < len; i++) {
                crc ^= data[i];
                for (int j = 0; j < 8; j++) {
                    if (crc & 1) crc = (crc >> 1) ^ 0xA001;
                    else crc >>= 1;
                }
            }
            return crc;
        };
        
        // Stop - CMD=01, DATA=08 (stop)
        uint8_t stop[] = {0x01, 0x01, 0x03, 0x08, 0x00, 0x00};
        uint16_t crc = calcCRC(stop, 6);
        
        while (RS485Serial.available()) RS485Serial.read();
        
        Serial.print(F("Sending STOP: "));
        for (int i = 0; i < 6; i++) Serial.printf("%02X ", stop[i]);
        Serial.printf("%02X %02X\n", crc & 0xFF, (crc >> 8) & 0xFF);
        
        digitalWrite(RS485_DE_RE_PIN, HIGH);
        delay(5);
        RS485Serial.write(stop, 6);
        RS485Serial.write(crc & 0xFF);
        RS485Serial.write((crc >> 8) & 0xFF);
        RS485Serial.flush();
        delay(15);
        digitalWrite(RS485_DE_RE_PIN, LOW);
        delay(5);
        while (RS485Serial.available()) RS485Serial.read();
        delay(100);
        
        if (RS485Serial.available() > 0) {
            Serial.print(F("Response: "));
            while (RS485Serial.available()) Serial.printf("%02X ", RS485Serial.read());
            Serial.println();
        }
        Serial.println(F("Stop sent."));
    }
    else if (cmd == "SPINTEST") {
        // Try multiple ways to spin the VFD
        Serial.println(F("\n=== SPIN TEST ==="));
        Serial.println(F("Trying different protocols to spin VFD...\n"));
        
        // Helper for CRC
        auto calcCRC = [](uint8_t* data, int len) -> uint16_t {
            uint16_t crc = 0xFFFF;
            for (int i = 0; i < len; i++) {
                crc ^= data[i];
                for (int j = 0; j < 8; j++) {
                    if (crc & 1) crc = (crc >> 1) ^ 0xA001;
                    else crc >>= 1;
                }
            }
            return crc;
        };
        
        auto sendAndCheck = [&](const char* name, uint8_t* data, int len) -> bool {
            while (RS485Serial.available()) RS485Serial.read();
            
            uint16_t crc = calcCRC(data, len);
            
            digitalWrite(RS485_DE_RE_PIN, HIGH);
            delay(3);
            RS485Serial.write(data, len);
            RS485Serial.write(crc & 0xFF);
            RS485Serial.write((crc >> 8) & 0xFF);
            RS485Serial.flush();
            delay(5);
            digitalWrite(RS485_DE_RE_PIN, LOW);
            delay(100);
            
            Serial.printf("%s: ", name);
            if (RS485Serial.available() > 0) {
                while (RS485Serial.available()) Serial.printf("%02X ", RS485Serial.read());
                Serial.println(F(" <- Response!"));
                return true;
            } else {
                Serial.println(F("no response"));
                return false;
            }
        };
        
        // 1. Huanyang: Write control - RUN FWD at 50Hz (3000 RPM for 2-pole)
        // Frame: 01 05 02 LO HI (addr, cmd=5 write ctrl, len=2, freq low, freq high)
        // Freq = 5000 = 50.00 Hz
        Serial.println(F("--- Huanyang Protocol ---"));
        uint8_t hyRun[] = {0x01, 0x05, 0x02, 0x88, 0x13};  // 5000 = 0x1388
        sendAndCheck("HY Run 50Hz", hyRun, 5);
        
        // Huanyang control word: 01 03 01 01 (run fwd)
        uint8_t hyCtrl[] = {0x01, 0x03, 0x01, 0x01};
        sendAndCheck("HY Control FWD", hyCtrl, 4);
        
        delay(500);
        
        // 2. Standard Modbus: Write holding register 0x2000 = run fwd
        Serial.println(F("\n--- Standard Modbus ---"));
        uint8_t mbCtrl[] = {0x01, 0x06, 0x20, 0x00, 0x00, 0x01};  // Write reg 0x2000 = 1
        sendAndCheck("MB Write 0x2000=1", mbCtrl, 6);
        
        // Write frequency to 0x2001 = 5000 (50Hz)
        uint8_t mbFreq[] = {0x01, 0x06, 0x20, 0x01, 0x13, 0x88};
        sendAndCheck("MB Write 0x2001=5000", mbFreq, 6);
        
        delay(500);
        
        // 3. H100 coil style: Write coil 0x0049 = ON
        Serial.println(F("\n--- H100 Coils ---"));
        uint8_t coilFwd[] = {0x01, 0x05, 0x00, 0x49, 0xFF, 0x00};
        sendAndCheck("Coil 0x0049=ON", coilFwd, 6);
        
        delay(500);
        
        // 4. Try different run registers
        Serial.println(F("\n--- Alt Registers ---"));
        uint8_t alt1[] = {0x01, 0x06, 0x00, 0x00, 0x00, 0x01};  // Reg 0 = 1
        sendAndCheck("Reg 0x0000=1", alt1, 6);
        
        uint8_t alt2[] = {0x01, 0x06, 0x00, 0x01, 0x13, 0x88};  // Reg 1 = 5000 (50Hz)
        sendAndCheck("Reg 0x0001=5000", alt2, 6);
        
        uint8_t alt3[] = {0x01, 0x06, 0x10, 0x00, 0x00, 0x01};  // Reg 0x1000 = 1
        sendAndCheck("Reg 0x1000=1", alt3, 6);
        
        Serial.println(F("\nDid the spindle move? If yes, note which command worked!"));
    }
    else if (cmd == "FORCESPIN") {
        // Aggressive spin attempt - try EVERYTHING
        Serial.println(F("\n=== FORCE SPIN ==="));
        
        auto calcCRC = [](uint8_t* data, int len) -> uint16_t {
            uint16_t crc = 0xFFFF;
            for (int i = 0; i < len; i++) {
                crc ^= data[i];
                for (int j = 0; j < 8; j++) {
                    if (crc & 1) crc = (crc >> 1) ^ 0xA001;
                    else crc >>= 1;
                }
            }
            return crc;
        };
        
        auto sendRaw = [&](const char* name, uint8_t* data, int len) {
            while (RS485Serial.available()) RS485Serial.read();
            uint16_t crc = calcCRC(data, len);
            digitalWrite(RS485_DE_RE_PIN, HIGH);
            delay(3);
            RS485Serial.write(data, len);
            RS485Serial.write(crc & 0xFF);
            RS485Serial.write((crc >> 8) & 0xFF);
            RS485Serial.flush();
            delay(5);
            digitalWrite(RS485_DE_RE_PIN, LOW);
            delay(80);
            Serial.printf("%s: ", name);
            if (RS485Serial.available() > 0) {
                while (RS485Serial.available()) Serial.printf("%02X ", RS485Serial.read());
                Serial.println();
            } else {
                Serial.println(F("no resp"));
            }
        };
        
        // Nowforever / INVT protocol - common for clones
        Serial.println(F("--- Nowforever/INVT ---"));
        uint8_t nf1[] = {0x01, 0x06, 0x00, 0x00, 0x00, 0x01};  // Control word = run fwd
        sendRaw("Ctrl=1", nf1, 6);
        uint8_t nf2[] = {0x01, 0x06, 0x00, 0x01, 0x13, 0x88};  // Freq = 5000
        sendRaw("Freq=5000", nf2, 6);
        
        delay(200);
        
        // GD10 / Goodrive style
        Serial.println(F("--- Goodrive ---"));
        uint8_t gd1[] = {0x01, 0x06, 0x10, 0x00, 0x00, 0x01};  // 0x1000 = run
        sendRaw("0x1000=1", gd1, 6);
        uint8_t gd2[] = {0x01, 0x06, 0x10, 0x01, 0x13, 0x88};  // 0x1001 = freq
        sendRaw("0x1001=5000", gd2, 6);
        
        delay(200);
        
        // DELTA style
        Serial.println(F("--- Delta ---"));
        uint8_t d1[] = {0x01, 0x06, 0x20, 0x00, 0x00, 0x12};   // Run FWD
        sendRaw("0x2000=0x12", d1, 6);
        uint8_t d2[] = {0x01, 0x06, 0x20, 0x01, 0x13, 0x88};   // Freq
        sendRaw("0x2001=5000", d2, 6);
        
        delay(200);
        
        // Huanyang proper sequence
        Serial.println(F("--- Huanyang Seq ---"));
        uint8_t hy1[] = {0x01, 0x03, 0x01, 0x01};  // Control: run fwd
        sendRaw("HY Ctrl=RunFwd", hy1, 4);
        delay(100);
        uint8_t hy2[] = {0x01, 0x05, 0x02, 0x13, 0x88};  // Set freq 5000
        sendRaw("HY Freq=5000", hy2, 5);
        
        delay(200);
        
        // Try register 0x2000 with different values
        Serial.println(F("--- 0x2000 variations ---"));
        uint8_t v1[] = {0x01, 0x06, 0x20, 0x00, 0x00, 0x02};  // 2 = run fwd
        sendRaw("0x2000=2", v1, 6);
        uint8_t v2[] = {0x01, 0x06, 0x20, 0x00, 0x00, 0x11};  // 0x11
        sendRaw("0x2000=0x11", v2, 6);
        uint8_t v3[] = {0x01, 0x06, 0x20, 0x00, 0x00, 0x47};  // 0x47 = run
        sendRaw("0x2000=0x47", v3, 6);
        
        delay(200);
        
        // Control register at different addresses
        Serial.println(F("--- Alt ctrl addrs ---"));
        uint8_t a1[] = {0x01, 0x06, 0x00, 0x02, 0x00, 0x01};  // reg 2
        sendRaw("Reg2=1", a1, 6);
        uint8_t a2[] = {0x01, 0x06, 0x01, 0x00, 0x00, 0x01};  // reg 0x100
        sendRaw("0x100=1", a2, 6);
        uint8_t a3[] = {0x01, 0x06, 0x30, 0x00, 0x00, 0x01};  // reg 0x3000
        sendRaw("0x3000=1", a3, 6);
        
        Serial.println(F("\n*** IS IT SPINNING NOW? ***"));
    }
    else if (cmd == "H100SPIN") {
        // Exact H100 protocol from grblHAL
        Serial.println(F("\n=== H100 EXACT PROTOCOL ==="));
        
        auto calcCRC = [](uint8_t* data, int len) -> uint16_t {
            uint16_t crc = 0xFFFF;
            for (int i = 0; i < len; i++) {
                crc ^= data[i];
                for (int j = 0; j < 8; j++) {
                    if (crc & 1) crc = (crc >> 1) ^ 0xA001;
                    else crc >>= 1;
                }
            }
            return crc;
        };
        
        auto sendFrame = [&](const char* name, uint8_t* data, int len) -> bool {
            while (RS485Serial.available()) RS485Serial.read();
            uint16_t crc = calcCRC(data, len);
            digitalWrite(RS485_DE_RE_PIN, HIGH);
            delay(5);
            RS485Serial.write(data, len);
            RS485Serial.write(crc & 0xFF);
            RS485Serial.write((crc >> 8) & 0xFF);
            RS485Serial.flush();
            delay(10);
            digitalWrite(RS485_DE_RE_PIN, LOW);
            delay(100);
            Serial.printf("%s: ", name);
            if (RS485Serial.available() > 0) {
                while (RS485Serial.available()) Serial.printf("%02X ", RS485Serial.read());
                Serial.println(F(" OK"));
                return true;
            } else {
                Serial.println(F("no response"));
                return false;
            }
        };
        
        // Step 1: Set frequency (0.1Hz resolution, so 1000 = 100Hz = 6000 RPM)
        Serial.println(F("Step 1: Set frequency (0x0201 = 1000 = 100Hz)"));
        uint8_t setFreq[] = {0x01, 0x06, 0x02, 0x01, 0x03, 0xE8};  // 1000 = 0x03E8
        sendFrame("Set Freq 100Hz", setFreq, 6);
        
        delay(100);
        
        // Step 2: Enable operation (coil 0x0048)
        Serial.println(F("Step 2: Enable Operation (coil 0x0048=0xFF00)"));
        uint8_t opEnable[] = {0x01, 0x05, 0x00, 0x48, 0xFF, 0x00};
        sendFrame("OP Enable", opEnable, 6);
        
        delay(100);
        
        // Step 3: Run forward using coil 0x0049
        Serial.println(F("Step 3: Run Forward (coil 0x0049=0xFF00)"));
        uint8_t runFwd[] = {0x01, 0x05, 0x00, 0x49, 0xFF, 0x00};
        sendFrame("Run FWD", runFwd, 6);
        
        delay(2000);
        Serial.println(F("\n*** SPINDLE SHOULD BE RUNNING NOW ***"));
        Serial.println(F("Send STOP to stop it."));
    }
    else if (cmd == "FREQTEST") {
        // Try different frequency registers
        Serial.println(F("\n=== FREQUENCY REGISTER TEST ==="));
        
        auto calcCRC = [](uint8_t* data, int len) -> uint16_t {
            uint16_t crc = 0xFFFF;
            for (int i = 0; i < len; i++) {
                crc ^= data[i];
                for (int j = 0; j < 8; j++) {
                    if (crc & 1) crc = (crc >> 1) ^ 0xA001;
                    else crc >>= 1;
                }
            }
            return crc;
        };
        
        auto sendFrame = [&](const char* name, uint8_t* data, int len) -> bool {
            while (RS485Serial.available()) RS485Serial.read();
            uint16_t crc = calcCRC(data, len);
            digitalWrite(RS485_DE_RE_PIN, HIGH);
            delay(5);
            RS485Serial.write(data, len);
            RS485Serial.write(crc & 0xFF);
            RS485Serial.write((crc >> 8) & 0xFF);
            RS485Serial.flush();
            delay(10);
            digitalWrite(RS485_DE_RE_PIN, LOW);
            delay(100);
            Serial.printf("%s: ", name);
            if (RS485Serial.available() > 0) {
                while (RS485Serial.available()) Serial.printf("%02X ", RS485Serial.read());
                Serial.println(F(" <- WORKS!"));
                return true;
            } else {
                Serial.println(F("no response"));
                return false;
            }
        };
        
        // Try all possible frequency register addresses
        // Value = 5000 = 50.00Hz (0x1388)
        Serial.println(F("Testing frequency registers (value=5000=50Hz)...\n"));
        
        uint8_t f1[] = {0x01, 0x06, 0x00, 0x01, 0x13, 0x88};  // Reg 0x0001
        sendFrame("Reg 0x0001", f1, 6);
        
        uint8_t f2[] = {0x01, 0x06, 0x00, 0x02, 0x13, 0x88};  // Reg 0x0002
        sendFrame("Reg 0x0002", f2, 6);
        
        uint8_t f3[] = {0x01, 0x06, 0x02, 0x00, 0x13, 0x88};  // Reg 0x0200
        sendFrame("Reg 0x0200", f3, 6);
        
        uint8_t f4[] = {0x01, 0x06, 0x02, 0x01, 0x13, 0x88};  // Reg 0x0201
        sendFrame("Reg 0x0201", f4, 6);
        
        uint8_t f5[] = {0x01, 0x06, 0x10, 0x01, 0x13, 0x88};  // Reg 0x1001
        sendFrame("Reg 0x1001", f5, 6);
        
        uint8_t f6[] = {0x01, 0x06, 0x20, 0x01, 0x13, 0x88};  // Reg 0x2001 (YL620 style)
        sendFrame("Reg 0x2001", f6, 6);
        
        // Huanyang style: 01 05 02 HI LO
        uint8_t hy[] = {0x01, 0x05, 0x02, 0x13, 0x88};
        sendFrame("HY style", hy, 5);
        
        Serial.println(F("\nNow running FWD..."));
        uint8_t runFwd[] = {0x01, 0x05, 0x00, 0x49, 0xFF, 0x00};
        sendFrame("Run FWD", runFwd, 6);
        
        Serial.println(F("\n*** Check VFD display for frequency! ***"));
    }
    else if (cmd == "READPARAMS") {
        // Read critical VFD parameters to verify configuration
        Serial.println(F("\n=== READING VFD PARAMETERS ==="));
        Serial.println(F("Checking F001, F002, F163, F164, F165, F169...\n"));
        
        auto calcCRC = [](uint8_t* data, int len) -> uint16_t {
            uint16_t crc = 0xFFFF;
            for (int i = 0; i < len; i++) {
                crc ^= data[i];
                for (int j = 0; j < 8; j++) {
                    if (crc & 1) crc = (crc >> 1) ^ 0xA001;
                    else crc >>= 1;
                }
            }
            return crc;
        };
        
        auto readReg = [&](const char* name, uint16_t regAddr) -> int {
            while (RS485Serial.available()) RS485Serial.read();
            
            uint8_t frame[8];
            frame[0] = 0x01;  // Address
            frame[1] = 0x03;  // Read holding register
            frame[2] = (regAddr >> 8) & 0xFF;
            frame[3] = regAddr & 0xFF;
            frame[4] = 0x00;  // Count high
            frame[5] = 0x01;  // Count low (1 register)
            uint16_t crc = calcCRC(frame, 6);
            frame[6] = crc & 0xFF;
            frame[7] = (crc >> 8) & 0xFF;
            
            digitalWrite(RS485_DE_RE_PIN, HIGH);
            delay(5);
            RS485Serial.write(frame, 8);
            RS485Serial.flush();
            delay(10);
            digitalWrite(RS485_DE_RE_PIN, LOW);
            delay(100);
            
            Serial.printf("%s (0x%04X): ", name, regAddr);
            if (RS485Serial.available() >= 5) {
                uint8_t resp[10];
                int n = 0;
                while (RS485Serial.available() && n < 10) {
                    resp[n++] = RS485Serial.read();
                }
                // Response: addr, func, len, data_hi, data_lo, crc_lo, crc_hi
                if (n >= 5 && resp[1] == 0x03 && resp[2] == 0x02) {
                    int value = (resp[3] << 8) | resp[4];
                    Serial.printf("%d\n", value);
                    return value;
                } else {
                    Serial.print("Bad response: ");
                    for (int i = 0; i < n; i++) Serial.printf("%02X ", resp[i]);
                    Serial.println();
                    return -1;
                }
            } else {
                Serial.println("No response");
                return -1;
            }
        };
        
        // According to manual, internal params are at 0x0000-0x00FF (F000-F255)
        int f001 = readReg("F001 (Control mode)", 0x0001);
        int f002 = readReg("F002 (Freq source)", 0x0002);
        int f163 = readReg("F163 (Modbus addr)", 0x00A3);  // 163 = 0xA3
        int f164 = readReg("F164 (Baud rate)", 0x00A4);
        int f165 = readReg("F165 (Data mode)", 0x00A5);
        int f169 = readReg("F169 (Freq decimal)", 0x00A9);
        
        Serial.println(F("\n--- INTERPRETATION ---"));
        
        if (f001 >= 0) {
            Serial.printf("F001 = %d -> ", f001);
            if (f001 == 0) Serial.println(F("KEYBOARD CONTROL (wrong! need 2)"));
            else if (f001 == 1) Serial.println(F("EXTERNAL TERMINAL (wrong! need 2)"));
            else if (f001 == 2) Serial.println(F("COMMUNICATION PORT (correct!)"));
            else Serial.println(F("Unknown"));
        }
        
        if (f002 >= 0) {
            Serial.printf("F002 = %d -> ", f002);
            if (f002 == 0) Serial.println(F("Keyboard (wrong! need 2)"));
            else if (f002 == 1) Serial.println(F("AI1 analog (wrong! need 2)"));
            else if (f002 == 2) Serial.println(F("Communication (correct!)"));
            else if (f002 == 3) Serial.println(F("Potentiometer (wrong! need 2)"));
            else Serial.println(F("Other"));
        }
        
        if (f164 >= 0) {
            Serial.printf("F164 = %d -> ", f164);
            const char* bauds[] = {"4800", "9600", "19200", "38400"};
            if (f164 <= 3) Serial.printf("%s baud\n", bauds[f164]);
            else Serial.println(F("Unknown"));
        }
        
        if (f001 != 2 || f002 != 2) {
            Serial.println(F("\n*** PROBLEM: F001 or F002 not set correctly! ***"));
            Serial.println(F("You MUST set F001=2 and F002=2 on the VFD panel!"));
        } else {
            Serial.println(F("\n*** Settings look correct! ***"));
        }
    }
    else if (cmd == "MANUALRUN") {
        // === EXACT PROTOCOL FROM H100 MANUAL ===
        // Manual page 87-88 shows you need to:
        // 1. Set frequency via register 0x0201
        // 2. Start spindle via coil 0x0048 (Operation) OR register 0x0200 (Main Control)
        // 3. Set direction via coil 0x0049 (Forward) or 0x004A (Reverse)
        Serial.println(F("\n=== MANUAL PROTOCOL RUN TEST ==="));
        Serial.println(F("Following H100 manual EXACTLY:\n"));
        
        auto calcCRC = [](uint8_t* data, int len) -> uint16_t {
            uint16_t crc = 0xFFFF;
            for (int i = 0; i < len; i++) {
                crc ^= data[i];
                for (int j = 0; j < 8; j++) {
                    if (crc & 1) crc = (crc >> 1) ^ 0xA001;
                    else crc >>= 1;
                }
            }
            return crc;
        };
        
        auto sendFrame = [&](const char* name, uint8_t* data, int len) -> bool {
            while (RS485Serial.available()) RS485Serial.read();
            uint16_t crc = calcCRC(data, len);
            digitalWrite(RS485_DE_RE_PIN, HIGH);
            delay(5);
            RS485Serial.write(data, len);
            RS485Serial.write(crc & 0xFF);
            RS485Serial.write((crc >> 8) & 0xFF);
            RS485Serial.flush();
            delay(10);
            digitalWrite(RS485_DE_RE_PIN, LOW);
            delay(200);  // Longer wait for motor response
            Serial.printf("%s: ", name);
            if (RS485Serial.available() > 0) {
                while (RS485Serial.available()) Serial.printf("%02X ", RS485Serial.read());
                Serial.println(F(" OK"));
                return true;
            } else {
                Serial.println(F("no response"));
                return false;
            }
        };
        
        // === METHOD 1: Using coils (Function 05H) - per manual page 88 ===
        Serial.println(F("--- Method 1: Using Coils (FC 05) ---"));
        
        // Set frequency first: 50Hz = 5000 (0x1388) in 0.01Hz units
        // According to manual F169=0 means 1 decimal place, so 500 = 50.0Hz
        Serial.println(F("Step 1: Set frequency 0x0201 = 500 (50.0Hz)"));
        uint8_t setFreq1[] = {0x01, 0x06, 0x02, 0x01, 0x01, 0xF4};  // 500 = 0x01F4
        sendFrame("Set Freq 50Hz", setFreq1, 6);
        delay(100);
        
        // Operation Enable: Write 0xFF00 to coil 0x0048
        Serial.println(F("Step 2: Operation Enable (coil 0x0048 = 0xFF00)"));
        uint8_t opEnable[] = {0x01, 0x05, 0x00, 0x48, 0xFF, 0x00};
        sendFrame("OP Enable", opEnable, 6);
        delay(100);
        
        // Forward: Write 0xFF00 to coil 0x0049
        Serial.println(F("Step 3: Forward (coil 0x0049 = 0xFF00)"));
        uint8_t fwd[] = {0x01, 0x05, 0x00, 0x49, 0xFF, 0x00};
        sendFrame("Forward", fwd, 6);
        delay(2000);
        
        // Check if spindle is running
        Serial.println(F("\n=== Check spindle status ==="));
        uint8_t readStatus[] = {0x01, 0x01, 0x00, 0x00, 0x00, 0x10};  // Read 16 coil states
        sendFrame("Read coils", readStatus, 6);
        
        // === METHOD 2: Using register 0x0200 (Main Control Bit) ===
        Serial.println(F("\n--- Method 2: Using Main Control Register 0x0200 ---"));
        Serial.println(F("Manual says: BIT0-BIT7 of 0x0200 map to coils 0x0048-0x004F"));
        Serial.println(F("BIT0 = Operation (0x0048), BIT1 = Forward (0x0049)"));
        Serial.println(F("So writing 0x0003 = Operation + Forward"));
        
        // Also need BIT8 for virtual terminal enable per manual
        Serial.println(F("\nStep 1: Write 0x0103 to 0x0200 (BIT0+BIT1+BIT8)"));
        uint8_t mainCtrl[] = {0x01, 0x06, 0x02, 0x00, 0x01, 0x03};  // 0x0103 = Operation + Forward + VT Enable
        sendFrame("Main Ctrl", mainCtrl, 6);
        delay(2000);
        
        // Also try just 0x0003
        Serial.println(F("Step 2: Write 0x0003 to 0x0200 (just BIT0+BIT1)"));
        uint8_t mainCtrl2[] = {0x01, 0x06, 0x02, 0x00, 0x00, 0x03};
        sendFrame("Main Ctrl2", mainCtrl2, 6);
        delay(2000);
        
        Serial.println(F("\n*** SPINDLE SHOULD BE RUNNING NOW ***"));
        Serial.println(F("If not running:"));
        Serial.println(F("  1. Check F001=2 (RS485 control)"));
        Serial.println(F("  2. Check F002=2 (RS485 frequency source)"));
        Serial.println(F("  3. Check F164 baud rate matches ESP32"));
        Serial.println(F("  4. Try BAUD:19200 then MANUALRUN if F164=2"));
        Serial.println(F("\nSend STOP to stop spindle."));
    }
    else if (cmd == "SHOTGUN") {
        // Brute force probe - try everything!
        Serial.println(F("\n=== SHOTGUN DIAGNOSTICS ==="));
        Serial.println(F("Trying ALL baud/address/protocol combinations...\n"));
        
        uint32_t bauds[] = {9600, 19200, 38400, 4800, 2400, 115200};
        int numBauds = 6;
        
        bool found = false;
        
        for (int b = 0; b < numBauds && !found; b++) {
            Serial.printf("\n--- Baud %d ---\n", bauds[b]);
            RS485Serial.updateBaudRate(bauds[b]);
            delay(50);
            
            for (int addr = 1; addr <= 10 && !found; addr++) {
                while (RS485Serial.available()) RS485Serial.read();
                
                // Standard Modbus read holding reg 0
                uint8_t frame[8];
                frame[0] = addr;
                frame[1] = 0x03;
                frame[2] = 0x00;
                frame[3] = 0x00;
                frame[4] = 0x00;
                frame[5] = 0x01;
                uint16_t crc = 0xFFFF;
                for (int i = 0; i < 6; i++) {
                    crc ^= frame[i];
                    for (int j = 0; j < 8; j++) {
                        if (crc & 1) crc = (crc >> 1) ^ 0xA001;
                        else crc >>= 1;
                    }
                }
                frame[6] = crc & 0xFF;
                frame[7] = (crc >> 8) & 0xFF;
                
                digitalWrite(RS485_DE_RE_PIN, HIGH);
                delay(2);
                RS485Serial.write(frame, 8);
                RS485Serial.flush();
                delay(5);
                digitalWrite(RS485_DE_RE_PIN, LOW);
                delay(30);
                
                if (RS485Serial.available() > 0) {
                    Serial.printf("FOUND! Baud=%d Addr=%d FC03: ", bauds[b], addr);
                    while (RS485Serial.available()) Serial.printf("%02X ", RS485Serial.read());
                    Serial.println();
                    found = true;
                    config.modbusBaud = bauds[b];
                    config.vfdAddress = addr;
                    break;
                }
                
                // Huanyang protocol
                while (RS485Serial.available()) RS485Serial.read();
                uint8_t hy[8] = {(uint8_t)addr, 0x04, 0x03, 0x01, 0x00, 0x00, 0, 0};
                crc = 0xFFFF;
                for (int i = 0; i < 6; i++) {
                    crc ^= hy[i];
                    for (int j = 0; j < 8; j++) {
                        if (crc & 1) crc = (crc >> 1) ^ 0xA001;
                        else crc >>= 1;
                    }
                }
                hy[6] = crc & 0xFF;
                hy[7] = (crc >> 8) & 0xFF;
                
                digitalWrite(RS485_DE_RE_PIN, HIGH);
                delay(2);
                RS485Serial.write(hy, 8);
                RS485Serial.flush();
                delay(5);
                digitalWrite(RS485_DE_RE_PIN, LOW);
                delay(30);
                
                if (RS485Serial.available() > 0) {
                    Serial.printf("FOUND! Baud=%d Addr=%d Huanyang: ", bauds[b], addr);
                    while (RS485Serial.available()) Serial.printf("%02X ", RS485Serial.read());
                    Serial.println();
                    found = true;
                    config.modbusBaud = bauds[b];
                    config.vfdAddress = addr;
                    break;
                }
            }
        }
        
        if (found) {
            Serial.printf("\n*** SUCCESS! BAUD:%d ADDR:%d ***\n", config.modbusBaud, config.vfdAddress);
            RS485Serial.updateBaudRate(config.modbusBaud);
            modbus.begin(config.vfdAddress, RS485Serial);
        } else {
            Serial.println(F("\nNO RESPONSE from VFD."));
            Serial.println(F("Physical layer issue:"));
            Serial.println(F("  - Is VFD powered ON?"));
            Serial.println(F("  - Is RS485 wired correctly?"));
            Serial.println(F("  - Is F001=2 (RS485 control mode)?"));
            Serial.println(F("  - Swap A/B wires?"));
            RS485Serial.updateBaudRate(config.modbusBaud);
        }
    }
    else if (cmd.length() > 0) {
        Serial.printf("{\"error\":\"unknown command: %s\"}\n", cmd.c_str());
    }
}

// ============================================================================
// SETUP
// ============================================================================
void setup() {
    // USB Serial for PC communication
    Serial.begin(115200);
    while (!Serial && millis() < 3000);  // Wait up to 3s for serial
    
    Serial.println(F("\n\n========================================"));
    Serial.println(F("  ESP32 VFD Controller v1.0"));
    Serial.println(F("  USB Serial + RS485 Modbus"));
    Serial.println(F("========================================"));
    Serial.println(F("\nGPIO Pins:"));
    Serial.printf("  TX (to MAX485 DI):  GPIO%d\n", RS485_TX_PIN);
    Serial.printf("  RX (to MAX485 RO):  GPIO%d\n", RS485_RX_PIN);
    Serial.printf("  DE+RE (direction):  GPIO%d\n", RS485_DE_RE_PIN);
    Serial.println();
    
    // Load saved config
    loadConfig();
    printConfig();
    
    // RS485 direction pin
    pinMode(RS485_DE_RE_PIN, OUTPUT);
    digitalWrite(RS485_DE_RE_PIN, LOW);  // Start in receive mode
    
    // RS485 serial port
    RS485Serial.begin(config.modbusBaud, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);
    
    // Modbus master
    modbus.begin(config.vfdAddress, RS485Serial);
    modbus.preTransmission(rs485PreTransmission);
    modbus.postTransmission(rs485PostTransmission);
    
    // Initialize VFD status
    memset(&vfd, 0, sizeof(vfd));
    
    Serial.println(F("\nReady. Type HELP for commands.\n"));
}

// ============================================================================
// MAIN LOOP
// ============================================================================
void loop() {
    // Process serial commands
    if (Serial.available()) {
        String cmd = Serial.readStringUntil('\n');
        processCommand(cmd);
    }
    
    // Poll VFD status periodically
    if (millis() - lastPoll >= config.pollInterval) {
        lastPoll = millis();
        pollVFDStatus();
        
        // Auto-print status every second if debug mode
        if (config.debugMode && (millis() - lastStatusPrint >= 1000)) {
            lastStatusPrint = millis();
            printStatus();
        }
    }
    
    // Small delay to prevent busy-looping
    delay(1);
}
