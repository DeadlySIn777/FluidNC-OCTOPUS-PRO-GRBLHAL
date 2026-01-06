/**
 * VFD Modbus Telemetry for CNC Chatter Detection System
 * 
 * Supports common Chinese VFDs (Huanyang and clones) via RS-485 Modbus RTU.
 * Most 1.5kW-2.2kW spindle kits from Amazon/AliExpress use these VFDs.
 * 
 * HARDWARE REQUIRED:
 *   - RS-485 transceiver module (MAX485, SP3485, or similar)
 *   - Preferably isolated (ISO1050/ADM2587E) for noisy VFD environments
 * 
 * WIRING (ESP32 ↔ RS-485 module ↔ VFD):
 *   ESP32 GPIO13 (TX) → DI (driver input) on RS-485 module
 *   ESP32 GPIO14 (RX) ← RO (receiver output) on RS-485 module  
 *   ESP32 GPIO27      → DE+RE (direction enable, active high = transmit)
 *   ESP32 GND         → GND on RS-485 module
 *   ESP32 3.3V        → VCC on RS-485 module (if 3.3V tolerant) or 5V if not
 *   RS-485 A          → VFD RS+ (sometimes labeled D+ or A)
 *   RS-485 B          → VFD RS- (sometimes labeled D- or B)
 *   RS-485 GND        → VFD GND/COM (if available, helps noise)
 * 
 * VFD SETTINGS (typical Huanyang):
 *   PD163 = 1 (communication mode)
 *   PD164 = 1 (slave address, we use 1)
 *   PD165 = 1 (9600 baud, or 2=19200)
 * 
 * HUANYANG MODBUS PROTOCOL:
 *   The Huanyang protocol is NOT standard Modbus but a close variant.
 *   Function codes: 0x03 = read, 0x06 = write single register
 *   Data registers store frequency in 0.01Hz units (24000 = 240.00 Hz)
 *   Status registers give running state, output current, DC bus voltage
 */

#ifndef VFD_MODBUS_H
#define VFD_MODBUS_H

#include <Arduino.h>
#include <HardwareSerial.h>

// ============================================================================
// PIN DEFINITIONS (UART1, doesn't conflict with existing UART2 to grblHAL)
// ============================================================================
#define VFD_TX_PIN        13      // ESP32 TX → RS-485 DI
#define VFD_RX_PIN        14      // ESP32 RX ← RS-485 RO
#define VFD_DE_PIN        27      // Direction enable (high = transmit)

// ============================================================================
// VFD COMMUNICATION SETTINGS
// ============================================================================
#define VFD_BAUD          9600    // Common default (PD165=1)
#define VFD_SLAVE_ADDR    1       // Default slave address (PD164=1)
#define VFD_TIMEOUT_MS    100     // Response timeout
#define VFD_POLL_INTERVAL 500     // Poll every 500ms

// ============================================================================
// HUANYANG REGISTER MAP (may vary slightly between clones)
// ============================================================================
// Control registers (write)
#define HY_REG_CONTROL      0x2000  // Control word (run/stop/direction)
#define HY_REG_FREQ_CMD     0x2001  // Commanded frequency (0.01 Hz units)

// Status registers (read)
#define HY_REG_FREQ_OUT     0x3001  // Output frequency (0.01 Hz units)
#define HY_REG_CURRENT_OUT  0x3002  // Output current (0.1 A units)
#define HY_REG_RPM_OUT      0x3003  // Output RPM (often same as freq * motor poles)
#define HY_REG_DC_BUS       0x3004  // DC bus voltage (0.1 V units)
#define HY_REG_STATUS       0x3005  // Status word
#define HY_REG_TEMP         0x3006  // VFD temperature (°C or 0.1°C)

// Fault codes (common)
#define VFD_FAULT_NONE      0
#define VFD_FAULT_OVERCURR  1       // OC - Overcurrent
#define VFD_FAULT_OVERVOLT  2       // OV - Overvoltage
#define VFD_FAULT_UNDERVOLT 3       // UV - Undervoltage
#define VFD_FAULT_OVERHEAT  4       // OH - Overheat
#define VFD_FAULT_OVERLOAD  5       // OL - Overload

// ============================================================================
// VFD STATE STRUCTURE
// ============================================================================
struct VFDState {
    bool enabled = false;           // VFD telemetry enabled
    bool connected = false;         // Successfully communicating
    bool running = false;           // Spindle running
    bool forward = true;            // Direction (true = CW/M3)
    
    // Telemetry values
    float freqHz = 0;               // Output frequency (Hz)
    float currentA = 0;             // Output current (A)
    float rpm = 0;                  // Calculated RPM
    float dcBusV = 0;               // DC bus voltage (V)
    float tempC = 0;                // VFD temperature (°C)
    
    // Commanded values
    float cmdFreqHz = 0;            // Commanded frequency
    float cmdRpm = 0;               // Commanded RPM
    
    // Fault status
    uint8_t faultCode = 0;          // 0 = no fault
    String faultString = "";        // Human-readable fault
    unsigned long lastFaultTime = 0;
    
    // Communication stats
    unsigned long lastSuccess = 0;  // Last successful read (ms)
    unsigned long lastAttempt = 0;  // Last poll attempt (ms)
    unsigned int successCount = 0;
    unsigned int failCount = 0;
    unsigned int consecutiveFails = 0;
    
    // Spindle config (for RPM calculation)
    uint8_t motorPoles = 4;         // 2-pole = 1, 4-pole = 2 (divisor)
    float maxFreqHz = 400.0f;       // VFD max frequency setting
    float maxRpm = 24000.0f;        // Spindle max RPM
};

// ============================================================================
// VFD MODBUS CLASS
// ============================================================================
class VFDModbus {
public:
    VFDState state;
    
    VFDModbus() : serial(1) {}  // Use UART1
    
    // Initialize VFD Modbus communication
    void begin() {
        pinMode(VFD_DE_PIN, OUTPUT);
        digitalWrite(VFD_DE_PIN, LOW);  // Start in receive mode
        
        serial.begin(VFD_BAUD, SERIAL_8N1, VFD_RX_PIN, VFD_TX_PIN);
        
        state.enabled = true;
        Serial.println("✓ VFD Modbus initialized (UART1)");
        Serial.printf("  TX=GPIO%d, RX=GPIO%d, DE=GPIO%d, %d baud\n", 
            VFD_TX_PIN, VFD_RX_PIN, VFD_DE_PIN, VFD_BAUD);
    }
    
    // Disable VFD telemetry
    void disable() {
        state.enabled = false;
        state.connected = false;
    }
    
    // Poll VFD for status (call from main loop, respects poll interval)
    void poll() {
        if (!state.enabled) return;
        
        unsigned long now = millis();
        if (now - state.lastAttempt < VFD_POLL_INTERVAL) return;
        state.lastAttempt = now;
        
        // Read output frequency
        uint16_t freqRaw = 0;
        if (readRegister(HY_REG_FREQ_OUT, freqRaw)) {
            state.freqHz = freqRaw / 100.0f;
            state.rpm = freqToRpm(state.freqHz);
            state.running = (state.freqHz > 1.0f);
            
            state.consecutiveFails = 0;
            state.successCount++;
            state.lastSuccess = now;
            state.connected = true;
        } else {
            state.consecutiveFails++;
            state.failCount++;
            if (state.consecutiveFails > 5) {
                state.connected = false;
            }
            return;  // Skip other reads if first one failed
        }
        
        // Read output current
        uint16_t currRaw = 0;
        if (readRegister(HY_REG_CURRENT_OUT, currRaw)) {
            state.currentA = currRaw / 10.0f;
        }
        
        // Read DC bus voltage
        uint16_t dcRaw = 0;
        if (readRegister(HY_REG_DC_BUS, dcRaw)) {
            state.dcBusV = dcRaw / 10.0f;
        }
        
        // Read status/fault
        uint16_t statusRaw = 0;
        if (readRegister(HY_REG_STATUS, statusRaw)) {
            parseFaultCode(statusRaw);
        }
    }
    
    // Get JSON string for WebSocket
    String toJSON() {
        char buf[256];
        snprintf(buf, sizeof(buf),
            "\"vfd\":{\"ok\":%s,\"run\":%s,\"freq\":%.1f,\"rpm\":%.0f,\"amps\":%.1f,\"dcv\":%.0f,\"temp\":%.0f,\"fault\":%d}",
            state.connected ? "true" : "false",
            state.running ? "true" : "false",
            state.freqHz,
            state.rpm,
            state.currentA,
            state.dcBusV,
            state.tempC,
            state.faultCode
        );
        return String(buf);
    }
    
    // Set spindle config for accurate RPM calculation
    void setSpindleConfig(float maxFreq, float maxRpm, uint8_t poles) {
        state.maxFreqHz = maxFreq;
        state.maxRpm = maxRpm;
        state.motorPoles = poles;
    }
    
private:
    HardwareSerial serial;
    
    // Convert frequency to RPM using spindle config
    float freqToRpm(float freqHz) {
        // RPM = (freq / maxFreq) * maxRPM
        // For most spindles: RPM = freq * 60 / (poles/2)
        // But for VFD-controlled spindles, it's usually linear mapping
        return (freqHz / state.maxFreqHz) * state.maxRpm;
    }
    
    // Parse fault code from status register
    void parseFaultCode(uint16_t status) {
        // Huanyang fault codes are in lower byte
        uint8_t fault = status & 0xFF;
        if (fault != state.faultCode) {
            state.faultCode = fault;
            state.lastFaultTime = millis();
            
            switch (fault) {
                case 0: state.faultString = ""; break;
                case 1: state.faultString = "Overcurrent (OC)"; break;
                case 2: state.faultString = "Overvoltage (OV)"; break;
                case 3: state.faultString = "Undervoltage (UV)"; break;
                case 4: state.faultString = "Overheat (OH)"; break;
                case 5: state.faultString = "Overload (OL)"; break;
                default: state.faultString = "Unknown fault"; break;
            }
            
            if (fault > 0) {
                Serial.printf("[VFD] FAULT: %s (code %d)\n", 
                    state.faultString.c_str(), fault);
            }
        }
    }
    
    // Read a single Huanyang register
    bool readRegister(uint16_t reg, uint16_t& value) {
        // Build Huanyang read request
        // Format: [addr][func][reg_hi][reg_lo][0x00][0x01][crc_lo][crc_hi]
        uint8_t request[8];
        request[0] = VFD_SLAVE_ADDR;
        request[1] = 0x03;  // Read function
        request[2] = (reg >> 8) & 0xFF;
        request[3] = reg & 0xFF;
        request[4] = 0x00;  // Number of registers (high)
        request[5] = 0x01;  // Number of registers (low) = 1
        
        uint16_t crc = calculateCRC(request, 6);
        request[6] = crc & 0xFF;
        request[7] = (crc >> 8) & 0xFF;
        
        // Clear receive buffer
        while (serial.available()) serial.read();
        
        // Enable transmit
        digitalWrite(VFD_DE_PIN, HIGH);
        delayMicroseconds(100);
        
        // Send request
        serial.write(request, 8);
        serial.flush();
        
        // Switch to receive
        delayMicroseconds(100);
        digitalWrite(VFD_DE_PIN, LOW);
        
        // Wait for response
        unsigned long start = millis();
        while (serial.available() < 7 && (millis() - start) < VFD_TIMEOUT_MS) {
            delayMicroseconds(100);
        }
        
        if (serial.available() < 7) {
            return false;  // Timeout
        }
        
        // Read response
        // Format: [addr][func][len][data_hi][data_lo][crc_lo][crc_hi]
        uint8_t response[16];
        int len = serial.readBytes(response, min((int)serial.available(), 16));
        
        if (len < 7) return false;
        
        // Verify address and function
        if (response[0] != VFD_SLAVE_ADDR || response[1] != 0x03) {
            return false;
        }
        
        // Verify CRC
        uint16_t recvCrc = response[len-1] << 8 | response[len-2];
        uint16_t calcCrc = calculateCRC(response, len - 2);
        if (recvCrc != calcCrc) {
            return false;
        }
        
        // Extract value (big-endian)
        value = (response[3] << 8) | response[4];
        return true;
    }
    
    // Calculate Modbus CRC-16
    uint16_t calculateCRC(uint8_t* data, size_t len) {
        uint16_t crc = 0xFFFF;
        for (size_t i = 0; i < len; i++) {
            crc ^= data[i];
            for (int j = 0; j < 8; j++) {
                if (crc & 0x0001) {
                    crc = (crc >> 1) ^ 0xA001;
                } else {
                    crc >>= 1;
                }
            }
        }
        return crc;
    }
};

// Global VFD instance
extern VFDModbus vfd;

#endif // VFD_MODBUS_H
