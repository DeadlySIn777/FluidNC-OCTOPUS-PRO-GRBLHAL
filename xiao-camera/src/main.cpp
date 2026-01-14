/*
 * XIAO ESP32-S3 Sense - FluidCNC Camera & Audio Module
 * 
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║  PLUG & PLAY USB SETUP - NO WIFI CONFIG NEEDED!               ║
 * ╠═══════════════════════════════════════════════════════════════╣
 * ║  1. Plug XIAO into USB hub (or directly to PC)                ║
 * ║  2. Camera auto-creates WiFi: "FluidCNC-Camera"               ║
 * ║  3. Connect phone/PC to that WiFi                             ║
 * ║  4. Open http://192.168.4.1 to see video                      ║
 * ║                                                               ║
 * ║  OR for same-network access:                                  ║
 * ║  - Connect to FluidCNC-Camera WiFi                            ║
 * ║  - Go to http://192.168.4.1/setup                             ║
 * ║  - Enter your home WiFi credentials                           ║
 * ╚═══════════════════════════════════════════════════════════════╝
 * 
 * CONNECTION MODES:
 *   Mode 1: USB Power + Camera's Own WiFi AP (simplest - default)
 *           Just plug in USB, connect to "FluidCNC-Camera" network
 *           
 *   Mode 2: USB Power + Your Home WiFi (optional setup)
 *           Configure via /setup page if you want one network
 *
 * Features:
 * - MJPEG video streaming for machine monitoring
 * - USB Serial for snapshots and control commands
 * - Optional audio capture for chatter detection
 * - WebSocket interface for real-time data
 * - LED status indicator
 * - mDNS discovery (fluidcnc-camera.local)
 */

#include <Arduino.h>
#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>
#include <ArduinoJson.h>
#include "esp_camera.h"
#include <driver/i2s.h>
#include <Preferences.h>
#include <ESPmDNS.h>

// ================================================================
// CONFIGURATION
// ================================================================

Preferences preferences;

// WiFi credentials (loaded from flash, or empty = AP mode)
String wifiSSID = "";
String wifiPass = "";
bool wifiConfigured = false;

// AP mode - ALWAYS available (this is the "plug and play" mode)
const char* AP_SSID = "FluidCNC-Camera";
const char* AP_PASS = "fluidcnc123";
bool alwaysEnableAP = true;  // Keep AP running even when connected to home WiFi

// mDNS name - access via http://fluidcnc-camera.local
const char* MDNS_NAME = "fluidcnc-camera";

// USB Serial Commands (for control via USB hub)
// Send these commands over USB Serial (115200 baud):
//   SNAP    - Capture and send JPEG over serial (base64)
//   STATUS  - Get JSON status
//   RESET   - Reset WiFi config

// Feature flags
bool ENABLE_AUDIO_FORWARD = false;
bool ENABLE_STREAMING = true;

// Camera pins for XIAO ESP32-S3 Sense
#define PWDN_GPIO_NUM     -1
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM     10
#define SIOD_GPIO_NUM     40
#define SIOC_GPIO_NUM     39

#define Y9_GPIO_NUM       48
#define Y8_GPIO_NUM       11
#define Y7_GPIO_NUM       12
#define Y6_GPIO_NUM       14
#define Y5_GPIO_NUM       16
#define Y4_GPIO_NUM       18
#define Y3_GPIO_NUM       17
#define Y2_GPIO_NUM       15
#define VSYNC_GPIO_NUM    38
#define HREF_GPIO_NUM     47
#define PCLK_GPIO_NUM     13

// Microphone (PDM) pins - XIAO ESP32-S3 Sense
#define I2S_MIC_SERIAL_CLOCK    GPIO_NUM_42
#define I2S_MIC_LEFT_RIGHT_CLOCK GPIO_NUM_42  // PDM uses same pin
#define I2S_MIC_SERIAL_DATA     GPIO_NUM_41

// LED pin
#define LED_PIN 21

// ================================================================
// GLOBALS
// ================================================================

AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// Camera state
bool cameraInitialized = false;
int frameRate = 10;  // Target FPS
int jpegQuality = 12; // 10-63, lower = better quality

// Audio state
bool audioEnabled = false;
#define AUDIO_SAMPLE_RATE 16000
#define AUDIO_BUFFER_SIZE 1024
int16_t audioBuffer[AUDIO_BUFFER_SIZE];

// Stats
unsigned long frameCount = 0;
unsigned long lastStatTime = 0;
float currentFPS = 0;

// ================================================================
// CAMERA FUNCTIONS
// ================================================================

bool initCamera() {
    camera_config_t config;
    config.ledc_channel = LEDC_CHANNEL_0;
    config.ledc_timer = LEDC_TIMER_0;
    config.pin_d0 = Y2_GPIO_NUM;
    config.pin_d1 = Y3_GPIO_NUM;
    config.pin_d2 = Y4_GPIO_NUM;
    config.pin_d3 = Y5_GPIO_NUM;
    config.pin_d4 = Y6_GPIO_NUM;
    config.pin_d5 = Y7_GPIO_NUM;
    config.pin_d6 = Y8_GPIO_NUM;
    config.pin_d7 = Y9_GPIO_NUM;
    config.pin_xclk = XCLK_GPIO_NUM;
    config.pin_pclk = PCLK_GPIO_NUM;
    config.pin_vsync = VSYNC_GPIO_NUM;
    config.pin_href = HREF_GPIO_NUM;
    config.pin_sccb_sda = SIOD_GPIO_NUM;
    config.pin_sccb_scl = SIOC_GPIO_NUM;
    config.pin_pwdn = PWDN_GPIO_NUM;
    config.pin_reset = RESET_GPIO_NUM;
    config.xclk_freq_hz = 20000000;
    config.frame_size = FRAMESIZE_VGA;      // 640x480
    config.pixel_format = PIXFORMAT_JPEG;
    config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
    config.fb_location = CAMERA_FB_IN_PSRAM;
    config.jpeg_quality = jpegQuality;
    config.fb_count = 2;

    // Use PSRAM for frame buffers
    if (psramFound()) {
        config.jpeg_quality = 10;
        config.fb_count = 2;
        config.grab_mode = CAMERA_GRAB_LATEST;
    } else {
        config.frame_size = FRAMESIZE_SVGA;
        config.fb_location = CAMERA_FB_IN_DRAM;
    }

    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        Serial.printf("Camera init failed with error 0x%x\n", err);
        return false;
    }

    // Adjust camera settings for machine shop environment
    sensor_t* s = esp_camera_sensor_get();
    if (s) {
        s->set_brightness(s, 0);     // -2 to 2
        s->set_contrast(s, 0);       // -2 to 2
        s->set_saturation(s, 0);     // -2 to 2
        s->set_special_effect(s, 0); // 0 = no effect
        s->set_whitebal(s, 1);       // 0 = disable, 1 = enable
        s->set_awb_gain(s, 1);       // 0 = disable, 1 = enable
        s->set_wb_mode(s, 0);        // 0 = auto
        s->set_exposure_ctrl(s, 1);  // 0 = disable, 1 = enable
        s->set_aec2(s, 1);           // 0 = disable, 1 = enable
        s->set_ae_level(s, 0);       // -2 to 2
        s->set_aec_value(s, 300);    // 0 to 1200
        s->set_gain_ctrl(s, 1);      // 0 = disable, 1 = enable
        s->set_agc_gain(s, 0);       // 0 to 30
        s->set_gainceiling(s, (gainceiling_t)0); // 0 to 6
        s->set_bpc(s, 0);            // 0 = disable, 1 = enable
        s->set_wpc(s, 1);            // 0 = disable, 1 = enable
        s->set_raw_gma(s, 1);        // 0 = disable, 1 = enable
        s->set_lenc(s, 1);           // 0 = disable, 1 = enable
        s->set_hmirror(s, 0);        // 0 = disable, 1 = enable
        s->set_vflip(s, 0);          // 0 = disable, 1 = enable
        s->set_dcw(s, 1);            // 0 = disable, 1 = enable
    }

    cameraInitialized = true;
    Serial.println("Camera initialized successfully");
    return true;
}

// ================================================================
// MICROPHONE (PDM) FUNCTIONS
// ================================================================

bool initMicrophone() {
    i2s_config_t i2s_config = {
        .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX | I2S_MODE_PDM),
        .sample_rate = AUDIO_SAMPLE_RATE,
        .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
        .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
        .communication_format = I2S_COMM_FORMAT_STAND_I2S,
        .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
        .dma_buf_count = 8,
        .dma_buf_len = 1024,
        .use_apll = false,
        .tx_desc_auto_clear = false,
        .fixed_mclk = 0
    };

    i2s_pin_config_t pin_config = {
        .mck_io_num = I2S_PIN_NO_CHANGE,
        .bck_io_num = I2S_PIN_NO_CHANGE,
        .ws_io_num = I2S_MIC_LEFT_RIGHT_CLOCK,
        .data_out_num = I2S_PIN_NO_CHANGE,
        .data_in_num = I2S_MIC_SERIAL_DATA
    };

    esp_err_t err = i2s_driver_install(I2S_NUM_0, &i2s_config, 0, NULL);
    if (err != ESP_OK) {
        Serial.printf("I2S driver install failed: %d\n", err);
        return false;
    }

    err = i2s_set_pin(I2S_NUM_0, &pin_config);
    if (err != ESP_OK) {
        Serial.printf("I2S set pin failed: %d\n", err);
        return false;
    }

    audioEnabled = true;
    Serial.println("Microphone initialized successfully");
    return true;
}

// Read audio samples and calculate RMS level
float readAudioLevel() {
    if (!audioEnabled) return 0;

    size_t bytesRead = 0;
    // CRITICAL SAFETY: Use timeout instead of infinite wait!
    // portMAX_DELAY blocks forever if microphone hardware fails
    esp_err_t result = i2s_read(I2S_NUM_0, audioBuffer, sizeof(audioBuffer), &bytesRead, pdMS_TO_TICKS(100));
    
    if (result == ESP_ERR_TIMEOUT) {
        // Timeout is not an error - just return 0 level
        return 0;
    }
    if (result != ESP_OK || bytesRead == 0) return 0;

    int samples = bytesRead / sizeof(int16_t);
    // SAFETY: Prevent division by zero
    if (samples == 0) return 0;
    
    int64_t sum = 0;
    
    for (int i = 0; i < samples; i++) {
        sum += (int64_t)audioBuffer[i] * audioBuffer[i];
    }
    
    float rms = sqrt((float)sum / samples);
    return rms / 32768.0f;  // Normalize to 0-1
}

// ================================================================
// WIFI PROVISIONING PORTAL
// ================================================================

// Load saved WiFi credentials from flash
void loadWiFiCredentials() {
    preferences.begin("fluidcnc", true);  // Read-only
    wifiSSID = preferences.getString("ssid", "");
    wifiPass = preferences.getString("pass", "");
    wifiConfigured = wifiSSID.length() > 0;
    preferences.end();
    
    if (wifiConfigured) {
        Serial.printf("[WiFi] Loaded credentials for: %s\n", wifiSSID.c_str());
    } else {
        Serial.println("[WiFi] No saved credentials - will start setup portal");
    }
}

// Save WiFi credentials to flash
void saveWiFiCredentials(const String& ssid, const String& pass) {
    preferences.begin("fluidcnc", false);  // Read-write
    preferences.putString("ssid", ssid);
    preferences.putString("pass", pass);
    preferences.end();
    
    wifiSSID = ssid;
    wifiPass = pass;
    wifiConfigured = true;
    Serial.printf("[WiFi] Saved credentials for: %s\n", ssid.c_str());
}

// WiFi setup portal HTML
const char SETUP_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
    <title>FluidCNC Camera Setup</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .card {
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 32px;
            width: 90%;
            max-width: 380px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        }
        .logo {
            text-align: center;
            margin-bottom: 24px;
        }
        .logo span { font-size: 48px; }
        h1 { 
            text-align: center;
            font-size: 22px;
            margin-bottom: 8px;
        }
        .subtitle {
            text-align: center;
            opacity: 0.7;
            font-size: 14px;
            margin-bottom: 24px;
        }
        .form-group {
            margin-bottom: 16px;
        }
        label {
            display: block;
            margin-bottom: 6px;
            font-size: 14px;
            opacity: 0.9;
        }
        input, select {
            width: 100%;
            padding: 12px 16px;
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 8px;
            background: rgba(255,255,255,0.1);
            color: #fff;
            font-size: 16px;
        }
        input:focus, select:focus {
            outline: none;
            border-color: #00d4ff;
            box-shadow: 0 0 0 3px rgba(0,212,255,0.2);
        }
        input::placeholder { color: rgba(255,255,255,0.4); }
        button {
            width: 100%;
            padding: 14px;
            border: none;
            border-radius: 8px;
            background: linear-gradient(135deg, #00d4ff 0%, #0099cc 100%);
            color: #fff;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            margin-top: 8px;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 20px rgba(0,212,255,0.4);
        }
        .networks {
            max-height: 150px;
            overflow-y: auto;
            margin-bottom: 16px;
        }
        .network {
            padding: 10px 12px;
            background: rgba(255,255,255,0.05);
            border-radius: 6px;
            margin-bottom: 6px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .network:hover { background: rgba(255,255,255,0.1); }
        .signal { font-size: 12px; opacity: 0.6; }
        .success {
            background: rgba(76,175,80,0.2);
            border: 1px solid #4caf50;
            border-radius: 8px;
            padding: 16px;
            text-align: center;
            display: none;
        }
        .success.show { display: block; }
        .spinner {
            display: none;
            width: 24px;
            height: 24px;
            border: 3px solid rgba(255,255,255,0.3);
            border-top-color: #fff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="card">
        <div class="logo"><span>📹</span></div>
        <h1>FluidCNC Camera Setup</h1>
        <p class="subtitle">Connect your camera to WiFi</p>
        
        <div id="form">
            <div class="form-group">
                <label>Select Network</label>
                <div class="networks" id="networks">
                    <div class="network"><span>Scanning...</span></div>
                </div>
            </div>
            
            <div class="form-group">
                <label>WiFi Network Name</label>
                <input type="text" id="ssid" placeholder="Your network name">
            </div>
            
            <div class="form-group">
                <label>Password</label>
                <input type="password" id="pass" placeholder="WiFi password">
            </div>
            
            <button onclick="saveSettings()">Connect & Save</button>
            <div class="spinner" id="spinner"></div>
        </div>
        
        <div class="success" id="success">
            <p style="font-size: 24px; margin-bottom: 8px;">✅</p>
            <p><strong>Connected!</strong></p>
            <p style="margin-top: 8px; opacity: 0.8;">Camera is rebooting...</p>
            <p style="margin-top: 4px; font-size: 12px;">Access at: <span id="newip"></span></p>
        </div>
    </div>
    
    <script>
        // Scan for networks on load
        fetch('/scan').then(r => r.json()).then(networks => {
            const container = document.getElementById('networks');
            if (networks.length === 0) {
                container.innerHTML = '<div class="network"><span>No networks found</span></div>';
                return;
            }
            container.innerHTML = networks.map(n => 
                `<div class="network" onclick="selectNetwork('${n.ssid}')">
                    <span>${n.ssid}</span>
                    <span class="signal">${n.rssi} dBm</span>
                </div>`
            ).join('');
        }).catch(() => {
            document.getElementById('networks').innerHTML = '<div class="network"><span>Scan failed</span></div>';
        });
        
        function selectNetwork(ssid) {
            document.getElementById('ssid').value = ssid;
            document.getElementById('pass').focus();
        }
        
        function saveSettings() {
            const ssid = document.getElementById('ssid').value;
            const pass = document.getElementById('pass').value;
            
            if (!ssid) {
                alert('Please enter a network name');
                return;
            }
            
            document.getElementById('spinner').style.display = 'block';
            
            fetch('/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `ssid=${encodeURIComponent(ssid)}&pass=${encodeURIComponent(pass)}`
            }).then(r => r.json()).then(data => {
                document.getElementById('spinner').style.display = 'none';
                if (data.success) {
                    document.getElementById('form').style.display = 'none';
                    document.getElementById('success').classList.add('show');
                    document.getElementById('newip').textContent = data.ip || 'fluidcnc-camera.local';
                } else {
                    alert('Connection failed: ' + (data.error || 'Unknown error'));
                }
            }).catch(err => {
                document.getElementById('spinner').style.display = 'none';
                alert('Error: ' + err.message);
            });
        }
    </script>
</body>
</html>
)rawliteral";

// Handle WiFi scan request
void handleScan(AsyncWebServerRequest* request) {
    int n = WiFi.scanComplete();
    if (n == WIFI_SCAN_FAILED) {
        WiFi.scanNetworks(true);  // Start async scan
        request->send(200, "application/json", "[]");
        return;
    }
    if (n == WIFI_SCAN_RUNNING) {
        request->send(200, "application/json", "[]");
        return;
    }
    
    StaticJsonDocument<1024> doc;
    JsonArray arr = doc.to<JsonArray>();
    
    for (int i = 0; i < n && i < 10; i++) {
        JsonObject net = arr.createNestedObject();
        net["ssid"] = WiFi.SSID(i);
        net["rssi"] = WiFi.RSSI(i);
        net["secure"] = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
    }
    
    WiFi.scanDelete();
    WiFi.scanNetworks(true);  // Start new scan
    
    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
}

// Handle WiFi save request
void handleSaveWiFi(AsyncWebServerRequest* request) {
    if (!request->hasParam("ssid", true)) {
        request->send(400, "application/json", "{\"success\":false,\"error\":\"Missing SSID\"}");
        return;
    }
    
    String ssid = request->getParam("ssid", true)->value();
    String pass = request->hasParam("pass", true) ? request->getParam("pass", true)->value() : "";
    
    Serial.printf("[WiFi] Testing connection to: %s\n", ssid.c_str());
    
    // Try to connect
    WiFi.mode(WIFI_AP_STA);
    WiFi.begin(ssid.c_str(), pass.c_str());
    
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        delay(500);
        Serial.print(".");
        attempts++;
    }
    
    if (WiFi.status() == WL_CONNECTED) {
        // Save credentials
        saveWiFiCredentials(ssid, pass);
        
        String ip = WiFi.localIP().toString();
        Serial.printf("\n[WiFi] Connected! IP: %s\n", ip.c_str());
        
        StaticJsonDocument<128> doc;
        doc["success"] = true;
        doc["ip"] = ip;
        
        String json;
        serializeJson(doc, json);
        request->send(200, "application/json", json);
        
        // Schedule reboot
        delay(1000);
        ESP.restart();
    } else {
        Serial.println("\n[WiFi] Connection failed!");
        request->send(200, "application/json", "{\"success\":false,\"error\":\"Could not connect\"}");
        
        // Go back to AP mode
        WiFi.disconnect();
        WiFi.mode(WIFI_AP);
    }
}

// Handle setup portal root
void handleSetup(AsyncWebServerRequest* request) {
    request->send_P(200, "text/html", SETUP_HTML);
}

bool connectWiFi() {
    loadWiFiCredentials();
    
    // PLUG & PLAY MODE: Always start AP so camera works immediately via USB
    Serial.println("\n[WiFi] Starting in Plug & Play mode...");
    
    if (wifiConfigured && wifiSSID.length() > 0) {
        // User has configured home WiFi - try to connect while also running AP
        Serial.printf("[WiFi] Also connecting to: %s\n", wifiSSID.c_str());
        WiFi.mode(WIFI_AP_STA);  // Run BOTH AP and STA
        WiFi.softAP(AP_SSID, AP_PASS);
        WiFi.begin(wifiSSID.c_str(), wifiPass.c_str());
        
        int attempts = 0;
        while (WiFi.status() != WL_CONNECTED && attempts < 20) {
            delay(500);
            Serial.print(".");
            attempts++;
            digitalWrite(LED_PIN, attempts % 2);
        }
        
        if (WiFi.status() == WL_CONNECTED) {
            Serial.printf("\n[WiFi] Connected to home network! IP: %s\n", WiFi.localIP().toString().c_str());
            Serial.printf("[WiFi] ALSO available at AP: %s -> %s\n", AP_SSID, WiFi.softAPIP().toString().c_str());
            
            // Start mDNS for easy discovery
            if (MDNS.begin(MDNS_NAME)) {
                MDNS.addService("http", "tcp", 80);
                MDNS.addService("fluidcnc-camera", "tcp", 80);
                Serial.printf("[mDNS] Also at: http://%s.local\n", MDNS_NAME);
            }
            
            digitalWrite(LED_PIN, LOW);
            return true;
        } else {
            Serial.println("\n[WiFi] Home network unavailable, AP-only mode");
        }
    } else {
        // No home WiFi configured - just run AP (simplest mode)
        WiFi.mode(WIFI_AP);
        WiFi.softAP(AP_SSID, AP_PASS);
    }
    
    Serial.println("");
    Serial.println("╔══════════════════════════════════════════════════════╗");
    Serial.println("║  📹 CAMERA READY - PLUG & PLAY MODE                  ║");
    Serial.println("╠══════════════════════════════════════════════════════╣");
    Serial.printf("║  WiFi Network: %-38s ║\n", AP_SSID);
    Serial.printf("║  Password:     %-38s ║\n", AP_PASS);
    Serial.printf("║  Open:         http://%-30s ║\n", WiFi.softAPIP().toString().c_str());
    Serial.println("╠══════════════════════════════════════════════════════╣");
    Serial.println("║  Optional: Go to /setup to add home WiFi             ║");
    Serial.println("╚══════════════════════════════════════════════════════╝");
    Serial.println("");
    
    digitalWrite(LED_PIN, LOW);
    return false;
}

// ================================================================
// USB SERIAL COMMANDS (for control via USB hub)
// ================================================================

void handleSerialCommands() {
    if (!Serial.available()) return;
    
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    cmd.toUpperCase();
    
    if (cmd == "STATUS" || cmd == "INFO") {
        // Return JSON status
        StaticJsonDocument<256> doc;
        doc["device"] = "fluidcnc-camera";
        doc["camera"] = cameraInitialized;
        doc["audio"] = audioEnabled;
        doc["fps"] = currentFPS;
        doc["ap_ip"] = WiFi.softAPIP().toString();
        doc["ap_ssid"] = AP_SSID;
        if (WiFi.status() == WL_CONNECTED) {
            doc["sta_ip"] = WiFi.localIP().toString();
        }
        doc["heap"] = ESP.getFreeHeap();
        
        String json;
        serializeJson(doc, json);
        Serial.println(json);
    }
    else if (cmd == "SNAP" || cmd == "CAPTURE") {
        // Capture snapshot and send as base64 (for USB-only mode)
        if (!cameraInitialized) {
            Serial.println("{\"error\":\"Camera not initialized\"}");
            return;
        }
        
        camera_fb_t* fb = esp_camera_fb_get();
        if (!fb) {
            Serial.println("{\"error\":\"Capture failed\"}");
            return;
        }
        
        // Send image info then base64 data
        Serial.printf("{\"image\":{\"size\":%u,\"width\":%u,\"height\":%u,\"format\":\"jpeg\"}}\n", 
                      fb->len, fb->width, fb->height);
        
        // Base64 encode and send in chunks
        Serial.print("DATA:");
        const char* b64chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (size_t i = 0; i < fb->len; i += 3) {
            uint32_t n = (fb->buf[i] << 16);
            if (i + 1 < fb->len) n |= (fb->buf[i + 1] << 8);
            if (i + 2 < fb->len) n |= fb->buf[i + 2];
            
            Serial.print(b64chars[(n >> 18) & 0x3F]);
            Serial.print(b64chars[(n >> 12) & 0x3F]);
            Serial.print((i + 1 < fb->len) ? b64chars[(n >> 6) & 0x3F] : '=');
            Serial.print((i + 2 < fb->len) ? b64chars[n & 0x3F] : '=');
        }
        Serial.println();
        Serial.println("END");
        
        esp_camera_fb_return(fb);
    }
    else if (cmd == "RESET" || cmd == "FACTORY") {
        // Clear saved WiFi credentials
        preferences.begin("fluidcnc", false);
        preferences.clear();
        preferences.end();
        Serial.println("{\"success\":true,\"message\":\"WiFi credentials cleared, restarting...\"}");
        delay(500);
        ESP.restart();
    }
    else if (cmd.startsWith("WIFI:")) {
        // Quick WiFi config: WIFI:ssid:password
        int firstColon = cmd.indexOf(':', 5);
        if (firstColon > 5) {
            String ssid = cmd.substring(5, firstColon);
            String pass = cmd.substring(firstColon + 1);
            saveWiFiCredentials(ssid, pass);
            Serial.println("{\"success\":true,\"message\":\"WiFi configured, restarting...\"}");
            delay(500);
            ESP.restart();
        } else {
            Serial.println("{\"error\":\"Format: WIFI:ssid:password\"}");
        }
    }
    else if (cmd == "HELP" || cmd == "?") {
        Serial.println("FluidCNC Camera USB Commands:");
        Serial.println("  STATUS  - Get camera status (JSON)");
        Serial.println("  SNAP    - Capture snapshot (base64)");
        Serial.println("  RESET   - Clear WiFi credentials");
        Serial.println("  WIFI:ssid:pass - Configure WiFi");
        Serial.println("  HELP    - Show this help");
    }
}

// ================================================================
// WEB SERVER HANDLERS
// ================================================================

// Main page with camera view
const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
    <title>FluidCNC Camera</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            background: #1a1a1a; 
            color: #fff;
            min-height: 100vh;
        }
        .container { 
            max-width: 800px; 
            margin: 0 auto; 
            padding: 16px; 
        }
        h1 { 
            font-size: 18px; 
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .status { 
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #4caf50;
        }
        .status.offline { background: #f44336; }
        .video-container {
            position: relative;
            background: #000;
            border-radius: 8px;
            overflow: hidden;
            aspect-ratio: 4/3;
        }
        #stream {
            width: 100%;
            height: 100%;
            object-fit: contain;
        }
        .overlay {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: linear-gradient(transparent, rgba(0,0,0,0.7));
            padding: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .stats { font-size: 12px; opacity: 0.8; }
        .controls {
            display: flex;
            gap: 8px;
            margin-top: 16px;
            flex-wrap: wrap;
        }
        button {
            padding: 10px 16px;
            border: none;
            border-radius: 6px;
            background: #333;
            color: #fff;
            cursor: pointer;
            font-size: 14px;
        }
        button:hover { background: #444; }
        button.primary { background: #2196f3; }
        button.primary:hover { background: #1976d2; }
        .audio-meter {
            margin-top: 16px;
            background: #333;
            border-radius: 4px;
            padding: 12px;
        }
        .meter-bar {
            height: 20px;
            background: #222;
            border-radius: 4px;
            overflow: hidden;
        }
        .meter-fill {
            height: 100%;
            background: linear-gradient(90deg, #4caf50, #ff9800, #f44336);
            transition: width 0.1s;
            width: 0%;
        }
        .settings {
            margin-top: 16px;
            background: #252525;
            border-radius: 8px;
            padding: 16px;
        }
        .setting-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
        }
        select, input[type="range"] {
            background: #333;
            border: none;
            color: #fff;
            padding: 6px 10px;
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>
            <span class="status" id="status"></span>
            FluidCNC Machine Camera
        </h1>
        
        <div class="video-container">
            <img id="stream" src="/stream">
            <div class="overlay">
                <span class="stats" id="fps">-- FPS</span>
                <span class="stats" id="resolution">640x480</span>
            </div>
        </div>
        
        <div class="controls">
            <button onclick="captureSnapshot()" class="primary">📷 Snapshot</button>
            <button onclick="toggleStream()">⏸️ Pause</button>
            <button onclick="toggleFullscreen()">🔲 Fullscreen</button>
        </div>
        
        <div class="audio-meter">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span>🎤 Microphone Level</span>
                <span id="audio-db">-- dB</span>
            </div>
            <div class="meter-bar">
                <div class="meter-fill" id="audio-fill"></div>
            </div>
        </div>
        
        <div class="settings">
            <h3 style="margin-bottom: 12px;">Settings</h3>
            <div class="setting-row">
                <span>Resolution</span>
                <select id="resolution-select" onchange="setResolution(this.value)">
                    <option value="QVGA">320x240</option>
                    <option value="VGA" selected>640x480</option>
                    <option value="SVGA">800x600</option>
                    <option value="XGA">1024x768</option>
                </select>
            </div>
            <div class="setting-row">
                <span>Quality</span>
                <input type="range" min="10" max="63" value="12" 
                       onchange="setQuality(this.value)">
            </div>
            <div class="setting-row">
                <span>Forward Audio to Chatter ESP</span>
                <button onclick="toggleAudioForward()" id="audio-fwd-btn">Enable</button>
            </div>
        </div>
    </div>
    
    <script>
        let ws;
        let streaming = true;
        let audioForward = false;
        
        function connectWS() {
            ws = new WebSocket(`ws://${location.host}/ws`);
            ws.onopen = () => {
                document.getElementById('status').classList.remove('offline');
            };
            ws.onclose = () => {
                document.getElementById('status').classList.add('offline');
                setTimeout(connectWS, 2000);
            };
            ws.onmessage = (e) => {
                const data = JSON.parse(e.data);
                if (data.fps) document.getElementById('fps').textContent = data.fps.toFixed(1) + ' FPS';
                if (data.audioLevel !== undefined) {
                    const pct = Math.min(100, data.audioLevel * 200);
                    document.getElementById('audio-fill').style.width = pct + '%';
                    const db = data.audioLevel > 0 ? (20 * Math.log10(data.audioLevel)).toFixed(1) : '-∞';
                    document.getElementById('audio-db').textContent = db + ' dB';
                }
            };
        }
        connectWS();
        
        function captureSnapshot() {
            const link = document.createElement('a');
            link.href = '/capture';
            link.download = 'fluidcnc_' + Date.now() + '.jpg';
            link.click();
        }
        
        function toggleStream() {
            const img = document.getElementById('stream');
            streaming = !streaming;
            img.src = streaming ? '/stream' : '/capture';
            event.target.textContent = streaming ? '⏸️ Pause' : '▶️ Resume';
        }
        
        function toggleFullscreen() {
            const container = document.querySelector('.video-container');
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                container.requestFullscreen();
            }
        }
        
        function setResolution(res) {
            fetch('/control?resolution=' + res);
        }
        
        function setQuality(q) {
            fetch('/control?quality=' + q);
        }
        
        function toggleAudioForward() {
            audioForward = !audioForward;
            fetch('/control?audioForward=' + (audioForward ? '1' : '0'));
            document.getElementById('audio-fwd-btn').textContent = audioForward ? 'Disable' : 'Enable';
        }
    </script>
</body>
</html>
)rawliteral";

void handleRoot(AsyncWebServerRequest* request) {
    request->send_P(200, "text/html", INDEX_HTML);
}

// MJPEG stream handler
void handleStream(AsyncWebServerRequest* request) {
    if (!cameraInitialized) {
        request->send(503, "text/plain", "Camera not initialized");
        return;
    }
    
    AsyncWebServerResponse* response = request->beginChunkedResponse("multipart/x-mixed-replace; boundary=frame",
        [](uint8_t* buffer, size_t maxLen, size_t index) -> size_t {
            camera_fb_t* fb = esp_camera_fb_get();
            if (!fb) return 0;
            
            // Build MJPEG frame header
            char header[64];
            int headerLen = snprintf(header, sizeof(header),
                "\r\n--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
                fb->len);
            
            size_t totalLen = headerLen + fb->len;
            if (totalLen > maxLen) {
                esp_camera_fb_return(fb);
                return 0;
            }
            
            memcpy(buffer, header, headerLen);
            memcpy(buffer + headerLen, fb->buf, fb->len);
            
            esp_camera_fb_return(fb);
            frameCount++;
            
            return totalLen;
        }
    );
    
    response->addHeader("Access-Control-Allow-Origin", "*");
    request->send(response);
}

// Single frame capture
void handleCapture(AsyncWebServerRequest* request) {
    if (!cameraInitialized) {
        request->send(503, "text/plain", "Camera not initialized");
        return;
    }
    
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) {
        request->send(500, "text/plain", "Camera capture failed");
        return;
    }
    
    AsyncWebServerResponse* response = request->beginResponse_P(200, "image/jpeg", fb->buf, fb->len);
    response->addHeader("Content-Disposition", "inline; filename=capture.jpg");
    response->addHeader("Access-Control-Allow-Origin", "*");
    request->send(response);
    
    esp_camera_fb_return(fb);
}

// Camera/audio control
void handleControl(AsyncWebServerRequest* request) {
    if (request->hasParam("resolution")) {
        String res = request->getParam("resolution")->value();
        sensor_t* s = esp_camera_sensor_get();
        if (s) {
            if (res == "QVGA") s->set_framesize(s, FRAMESIZE_QVGA);
            else if (res == "VGA") s->set_framesize(s, FRAMESIZE_VGA);
            else if (res == "SVGA") s->set_framesize(s, FRAMESIZE_SVGA);
            else if (res == "XGA") s->set_framesize(s, FRAMESIZE_XGA);
        }
    }
    
    if (request->hasParam("quality")) {
        int q = request->getParam("quality")->value().toInt();
        sensor_t* s = esp_camera_sensor_get();
        if (s) s->set_quality(s, q);
    }
    
    if (request->hasParam("audioForward")) {
        ENABLE_AUDIO_FORWARD = request->getParam("audioForward")->value() == "1";
    }
    
    request->send(200, "text/plain", "OK");
}

// Status endpoint
void handleStatus(AsyncWebServerRequest* request) {
    StaticJsonDocument<256> doc;
    doc["camera"] = cameraInitialized;
    doc["audio"] = audioEnabled;
    doc["fps"] = currentFPS;
    doc["frames"] = frameCount;
    doc["heap"] = ESP.getFreeHeap();
    doc["psram"] = ESP.getFreePsram();
    doc["audioForward"] = ENABLE_AUDIO_FORWARD;
    
    String output;
    serializeJson(doc, output);
    request->send(200, "application/json", output);
}

// WebSocket events
void onWsEvent(AsyncWebSocket* server, AsyncWebSocketClient* client,
               AwsEventType type, void* arg, uint8_t* data, size_t len) {
    if (type == WS_EVT_CONNECT) {
        Serial.printf("WebSocket client connected: %u\n", client->id());
    } else if (type == WS_EVT_DISCONNECT) {
        Serial.printf("WebSocket client disconnected: %u\n", client->id());
    }
}

// ================================================================
// AUDIO FORWARDING TO CHATTER ESP32
// ================================================================

WiFiClient chatterClient;

void forwardAudioData(float audioLevel, int16_t* samples, size_t count) {
    if (!ENABLE_AUDIO_FORWARD) return;
    
    // Send via HTTP POST to chatter ESP32
    if (!chatterClient.connected()) {
        if (!chatterClient.connect(CHATTER_ESP_IP, CHATTER_ESP_PORT)) {
            return;
        }
    }
    
    // Simple protocol: JSON with audio level and optional raw samples
    StaticJsonDocument<128> doc;
    doc["type"] = "audio";
    doc["level"] = audioLevel;
    doc["source"] = "xiao";
    
    String json;
    serializeJson(doc, json);
    
    chatterClient.println("POST /audio HTTP/1.1");
    chatterClient.println("Content-Type: application/json");
    chatterClient.printf("Content-Length: %d\r\n", json.length());
    chatterClient.println();
    chatterClient.println(json);
}

// ================================================================
// MAIN SETUP & LOOP
// ================================================================

void setup() {
    Serial.begin(115200);
    Serial.println("\n\n=== FluidCNC XIAO Camera Module ===");
    
    // LED indicator
    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, HIGH);
    
    // Initialize PSRAM
    if (psramFound()) {
        Serial.printf("PSRAM found: %d bytes\n", ESP.getPsramSize());
    } else {
        Serial.println("Warning: No PSRAM found");
    }
    
    // Initialize camera
    if (!initCamera()) {
        Serial.println("ERROR: Camera init failed!");
    }
    
    // Initialize microphone
    if (!initMicrophone()) {
        Serial.println("Warning: Microphone init failed");
    }
    
    // Connect WiFi (or start setup portal)
    bool wifiConnected = connectWiFi();
    
    // Start WiFi scan for setup portal
    WiFi.scanNetworks(true);
    
    // Setup web server
    ws.onEvent(onWsEvent);
    server.addHandler(&ws);
    
    // If not configured, show setup portal as main page
    if (!wifiConfigured) {
        server.on("/", HTTP_GET, handleSetup);
        server.on("/scan", HTTP_GET, handleScan);
        server.on("/save", HTTP_POST, handleSaveWiFi);
        Serial.println("\n==========================================");
        Serial.println("   FIRST-TIME SETUP REQUIRED");
        Serial.println("==========================================");
        Serial.printf("1. Connect to WiFi: %s\n", AP_SSID);
        Serial.printf("   Password: %s\n", AP_PASS);
        Serial.println("2. Open http://192.168.4.1 in browser");
        Serial.println("3. Enter your home WiFi credentials");
        Serial.println("==========================================\n");
    } else {
        // Normal operation - camera interface
        server.on("/", HTTP_GET, handleRoot);
        server.on("/setup", HTTP_GET, handleSetup);  // Setup still available
        server.on("/scan", HTTP_GET, handleScan);
        server.on("/save", HTTP_POST, handleSaveWiFi);
    }
    
    server.on("/stream", HTTP_GET, handleStream);
    server.on("/capture", HTTP_GET, handleCapture);
    server.on("/control", HTTP_GET, handleControl);
    server.on("/status", HTTP_GET, handleStatus);
    
    // Discovery endpoint for FluidCNC
    server.on("/discover", HTTP_GET, [](AsyncWebServerRequest* request) {
        StaticJsonDocument<256> doc;
        doc["device"] = "fluidcnc-camera";
        doc["type"] = "xiao-esp32s3-sense";
        doc["version"] = "2.0";
        doc["camera"] = cameraInitialized;
        doc["audio"] = audioEnabled;
        doc["ip"] = WiFi.localIP().toString();
        doc["mac"] = WiFi.macAddress();
        
        String json;
        serializeJson(doc, json);
        request->send(200, "application/json", json);
    });
    
    server.begin();
    Serial.println("HTTP server started");
    
    digitalWrite(LED_PIN, LOW);
    Serial.println("=== Ready ===\n");
}

void loop() {
    // Handle USB Serial commands (for USB hub control)
    handleSerialCommands();
    
    // Update FPS counter
    unsigned long now = millis();
    if (now - lastStatTime > 1000) {
        currentFPS = (float)frameCount * 1000.0 / (now - lastStatTime);
        frameCount = 0;
        lastStatTime = now;
        
        // Read audio level
        float audioLevel = readAudioLevel();
        
        // Send WebSocket update
        if (ws.count() > 0) {
            StaticJsonDocument<128> doc;
            doc["fps"] = currentFPS;
            doc["audioLevel"] = audioLevel;
            doc["heap"] = ESP.getFreeHeap();
            
            String json;
            serializeJson(doc, json);
            ws.textAll(json);
        }
        
        // Forward audio if enabled
        if (ENABLE_AUDIO_FORWARD && audioLevel > 0.01) {
            forwardAudioData(audioLevel, audioBuffer, AUDIO_BUFFER_SIZE);
        }
    }
    
    // Blink LED when streaming
    static unsigned long lastBlink = 0;
    if (ws.count() > 0 && now - lastBlink > 2000) {
        digitalWrite(LED_PIN, HIGH);
        delay(50);
        digitalWrite(LED_PIN, LOW);
        lastBlink = now;
    }
    
    ws.cleanupClients();
    delay(10);
}
