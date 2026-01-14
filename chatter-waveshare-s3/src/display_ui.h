/*
 * Premium LVGL-Style Display UI for CNC Chatter Detection
 * Waveshare ESP32-S3-Touch-LCD-1.46B
 * 
 * Display: SPD2010 1.46" 412×412 Round IPS QSPI
 * Touch: Integrated capacitive touch
 * 
 * UI Design inspired by Waveshare official demos
 * Features: Animated arcs, gradient gauges, real-time FFT, smooth animations
 * 
 * Version: 4.0 - Premium UI
 */

#ifndef DISPLAY_UI_H
#define DISPLAY_UI_H

#include <Arduino.h>
#include <SPI.h>
#include <math.h>

// ============================================================================
// Pin Definitions (from platformio.ini)
// ============================================================================

#ifndef LCD_CS
#define LCD_CS      9
#endif
#ifndef LCD_CLK
#define LCD_CLK     10
#endif
#ifndef LCD_D0
#define LCD_D0      11
#endif
#ifndef LCD_RST
#define LCD_RST     3
#endif
#ifndef LCD_BL
#define LCD_BL      46
#endif

// Display dimensions - 412x412 round
#define DISPLAY_WIDTH   412
#define DISPLAY_HEIGHT  412
#define CENTER_X        206
#define CENTER_Y        206
#define RADIUS          200

// ============================================================================
// Premium Color Palette (RGB565) - Modern Dark Theme
// ============================================================================

namespace Colors {
    // Backgrounds
    constexpr uint16_t BG_DARK       = 0x0000;  // Pure black
    constexpr uint16_t BG_SURFACE    = 0x0841;  // Dark gray
    constexpr uint16_t BG_ELEVATED   = 0x10A2;  // Slightly lighter
    constexpr uint16_t BG_CARD       = 0x18E3;  // Card background
    
    // Status Colors - OK (Green)
    constexpr uint16_t OK_MAIN       = 0x07E0;  // Bright green
    constexpr uint16_t OK_LIGHT      = 0x47E8;  // Light green
    constexpr uint16_t OK_GLOW       = 0x03C0;  // Dark green glow
    constexpr uint16_t OK_GRADIENT1  = 0x0680;  // Gradient step
    constexpr uint16_t OK_GRADIENT2  = 0x0540;  // Gradient step
    
    // Status Colors - Warning (Orange/Amber)
    constexpr uint16_t WARN_MAIN     = 0xFD20;  // Bright orange
    constexpr uint16_t WARN_LIGHT    = 0xFEA0;  // Light orange
    constexpr uint16_t WARN_GLOW     = 0x8A00;  // Dark orange glow
    constexpr uint16_t WARN_GRADIENT1= 0xDC00;  // Gradient step
    constexpr uint16_t WARN_GRADIENT2= 0xBB00;  // Gradient step
    
    // Status Colors - Alert (Red)
    constexpr uint16_t ALERT_MAIN    = 0xF800;  // Bright red
    constexpr uint16_t ALERT_LIGHT   = 0xFB2C;  // Light red/pink
    constexpr uint16_t ALERT_GLOW    = 0x8000;  // Dark red glow
    constexpr uint16_t ALERT_PULSE   = 0xD800;  // Pulse color
    
    // Status Colors - Calibrating (Blue)
    constexpr uint16_t CAL_MAIN      = 0x04BF;  // Bright blue
    constexpr uint16_t CAL_LIGHT     = 0x653F;  // Light blue
    constexpr uint16_t CAL_GLOW      = 0x0210;  // Dark blue glow
    
    // Accent Colors
    constexpr uint16_t CYAN          = 0x07FF;  // Cyan accent
    constexpr uint16_t CYAN_DARK     = 0x0410;  // Dark cyan
    constexpr uint16_t PURPLE        = 0x780F;  // Purple accent
    constexpr uint16_t PURPLE_DARK   = 0x4006;  // Dark purple
    constexpr uint16_t TEAL          = 0x0410;  // Teal
    constexpr uint16_t GOLD          = 0xFE00;  // Gold accent
    
    // Text
    constexpr uint16_t TEXT_WHITE    = 0xFFFF;
    constexpr uint16_t TEXT_LIGHT    = 0xDEDB;  // 87% white
    constexpr uint16_t TEXT_MEDIUM   = 0x9CD3;  // 60% white
    constexpr uint16_t TEXT_DIM      = 0x632C;  // 38% white
    
    // UI Elements
    constexpr uint16_t GAUGE_BG      = 0x18E3;  // Gauge background
    constexpr uint16_t GAUGE_TRACK   = 0x2124;  // Arc track
    constexpr uint16_t FRAME_DIM     = 0x2945;  // Dim frame
    constexpr uint16_t FRAME_BRIGHT  = 0x4A69;  // Bright frame
    constexpr uint16_t DIVIDER       = 0x31A6;  // Divider lines
}

// ============================================================================
// SPD2010 QSPI Display Driver (Optimized)
// ============================================================================

class SPD2010_Display {
private:
    SPIClass* spi;
    
public:
    SPD2010_Display() : spi(nullptr) {}
    
    bool begin() {
        Serial.println("[DISPLAY] Initializing SPD2010 QSPI...");
        
        pinMode(LCD_CS, OUTPUT);
        pinMode(LCD_RST, OUTPUT);
        pinMode(LCD_BL, OUTPUT);
        digitalWrite(LCD_CS, HIGH);
        
        // Hardware reset
        digitalWrite(LCD_RST, LOW);
        delay(20);
        digitalWrite(LCD_RST, HIGH);
        delay(150);
        
        // Backlight PWM - smooth dimming
        ledcSetup(0, 5000, 8);
        ledcAttachPin(LCD_BL, 0);
        ledcWrite(0, 0);  // Start dark
        
        // Initialize SPI at high speed
        spi = new SPIClass(SPI2_HOST);
        spi->begin(LCD_CLK, -1, LCD_D0, LCD_CS);
        spi->setFrequency(80000000);  // 80MHz for fast updates
        
        initController();
        
        // Fade in backlight smoothly
        for (int i = 0; i <= 220; i += 5) {
            ledcWrite(0, i);
            delay(8);
        }
        
        Serial.println("[DISPLAY] SPD2010 initialized at 80MHz");
        return true;
    }
    
    void initController() {
        writeCommand(0x11);  // Sleep out
        delay(120);
        
        writeCommand(0x36);  writeData(0x00);  // Memory Access Control
        writeCommand(0x3A);  writeData(0x55);  // 16-bit RGB565 color
        
        // Porch Setting for smooth scrolling
        writeCommand(0xB2);
        writeData(0x0C); writeData(0x0C); writeData(0x00); writeData(0x33); writeData(0x33);
        
        writeCommand(0xB7);  writeData(0x35);  // Gate Control
        writeCommand(0xBB);  writeData(0x19);  // VCOM Setting
        writeCommand(0xC0);  writeData(0x2C);  // LCM Control
        writeCommand(0xC2);  writeData(0x01);  // VDV and VRH Enable
        writeCommand(0xC3);  writeData(0x12);  // VRH Set
        writeCommand(0xC4);  writeData(0x20);  // VDV Set
        writeCommand(0xC6);  writeData(0x0F);  // Frame Rate Control (60Hz)
        writeCommand(0xD0);  writeData(0xA4); writeData(0xA1);  // Power Control
        
        // Gamma Correction for vibrant colors
        writeCommand(0xE0);
        uint8_t pgamma[] = {0xD0, 0x04, 0x0D, 0x11, 0x13, 0x2B, 0x3F, 0x54, 0x4C, 0x18, 0x0D, 0x0B, 0x1F, 0x23};
        for (int i = 0; i < 14; i++) writeData(pgamma[i]);
        
        writeCommand(0xE1);
        uint8_t ngamma[] = {0xD0, 0x04, 0x0C, 0x11, 0x13, 0x2C, 0x3F, 0x44, 0x51, 0x2F, 0x1F, 0x1F, 0x20, 0x23};
        for (int i = 0; i < 14; i++) writeData(ngamma[i]);
        
        writeCommand(0x21);  // Display Inversion On (for IPS)
        writeCommand(0x29);  // Display On
        delay(50);
    }
    
    void writeCommand(uint8_t cmd) {
        digitalWrite(LCD_CS, LOW);
        spi->beginTransaction(SPISettings(80000000, MSBFIRST, SPI_MODE0));
        spi->transfer(0x02);  // Command mode
        spi->transfer(0x00);
        spi->transfer(cmd);
        spi->transfer(0x00);
        spi->endTransaction();
        digitalWrite(LCD_CS, HIGH);
    }
    
    void writeData(uint8_t data) {
        digitalWrite(LCD_CS, LOW);
        spi->beginTransaction(SPISettings(80000000, MSBFIRST, SPI_MODE0));
        spi->transfer(0x02);  // Data mode
        spi->transfer(0x00);
        spi->transfer(data);
        spi->transfer(0x00);
        spi->endTransaction();
        digitalWrite(LCD_CS, HIGH);
    }
    
    void setWindow(uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1) {
        writeCommand(0x2A);  // Column address
        writeData(x0 >> 8); writeData(x0 & 0xFF);
        writeData(x1 >> 8); writeData(x1 & 0xFF);
        
        writeCommand(0x2B);  // Row address
        writeData(y0 >> 8); writeData(y0 & 0xFF);
        writeData(y1 >> 8); writeData(y1 & 0xFF);
        
        writeCommand(0x2C);  // Memory write
    }
    
    void fillScreen(uint16_t color) {
        setWindow(0, 0, DISPLAY_WIDTH - 1, DISPLAY_HEIGHT - 1);
        
        digitalWrite(LCD_CS, LOW);
        spi->beginTransaction(SPISettings(80000000, MSBFIRST, SPI_MODE0));
        
        uint8_t hi = color >> 8, lo = color & 0xFF;
        for (int i = 0; i < DISPLAY_WIDTH * DISPLAY_HEIGHT; i++) {
            spi->transfer(hi);
            spi->transfer(lo);
        }
        
        spi->endTransaction();
        digitalWrite(LCD_CS, HIGH);
    }
    
    void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
        if (x >= DISPLAY_WIDTH || y >= DISPLAY_HEIGHT || w <= 0 || h <= 0) return;
        if (x + w > DISPLAY_WIDTH) w = DISPLAY_WIDTH - x;
        if (y + h > DISPLAY_HEIGHT) h = DISPLAY_HEIGHT - y;
        if (x < 0) { w += x; x = 0; }
        if (y < 0) { h += y; y = 0; }
        if (w <= 0 || h <= 0) return;
        
        setWindow(x, y, x + w - 1, y + h - 1);
        
        digitalWrite(LCD_CS, LOW);
        spi->beginTransaction(SPISettings(80000000, MSBFIRST, SPI_MODE0));
        
        uint8_t hi = color >> 8, lo = color & 0xFF;
        int pixels = w * h;
        for (int i = 0; i < pixels; i++) {
            spi->transfer(hi);
            spi->transfer(lo);
        }
        
        spi->endTransaction();
        digitalWrite(LCD_CS, HIGH);
    }
    
    void drawPixel(int16_t x, int16_t y, uint16_t color) {
        if (x < 0 || x >= DISPLAY_WIDTH || y < 0 || y >= DISPLAY_HEIGHT) return;
        setWindow(x, y, x, y);
        
        digitalWrite(LCD_CS, LOW);
        spi->beginTransaction(SPISettings(80000000, MSBFIRST, SPI_MODE0));
        spi->transfer(color >> 8);
        spi->transfer(color & 0xFF);
        spi->endTransaction();
        digitalWrite(LCD_CS, HIGH);
    }
    
    void drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t color) {
        fillRect(x, y, w, 1, color);
    }
    
    void drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t color) {
        fillRect(x, y, 1, h, color);
    }
    
    void drawCircle(int16_t x0, int16_t y0, int16_t r, uint16_t color) {
        int16_t f = 1 - r, ddF_x = 1, ddF_y = -2 * r, x = 0, y = r;
        
        drawPixel(x0, y0 + r, color);
        drawPixel(x0, y0 - r, color);
        drawPixel(x0 + r, y0, color);
        drawPixel(x0 - r, y0, color);
        
        while (x < y) {
            if (f >= 0) { y--; ddF_y += 2; f += ddF_y; }
            x++; ddF_x += 2; f += ddF_x;
            
            drawPixel(x0 + x, y0 + y, color);
            drawPixel(x0 - x, y0 + y, color);
            drawPixel(x0 + x, y0 - y, color);
            drawPixel(x0 - x, y0 - y, color);
            drawPixel(x0 + y, y0 + x, color);
            drawPixel(x0 - y, y0 + x, color);
            drawPixel(x0 + y, y0 - x, color);
            drawPixel(x0 - y, y0 - x, color);
        }
    }
    
    void fillCircle(int16_t x0, int16_t y0, int16_t r, uint16_t color) {
        drawFastVLine(x0, y0 - r, 2 * r + 1, color);
        int16_t f = 1 - r, ddF_x = 1, ddF_y = -2 * r, x = 0, y = r;
        
        while (x < y) {
            if (f >= 0) { y--; ddF_y += 2; f += ddF_y; }
            x++; ddF_x += 2; f += ddF_x;
            
            drawFastVLine(x0 + x, y0 - y, 2 * y + 1, color);
            drawFastVLine(x0 - x, y0 - y, 2 * y + 1, color);
            drawFastVLine(x0 + y, y0 - x, 2 * x + 1, color);
            drawFastVLine(x0 - y, y0 - x, 2 * x + 1, color);
        }
    }
    
    // Blend two RGB565 colors
    uint16_t blendColors(uint16_t c1, uint16_t c2, float ratio) {
        if (ratio <= 0) return c1;
        if (ratio >= 1) return c2;
        
        uint8_t r1 = (c1 >> 11) & 0x1F, g1 = (c1 >> 5) & 0x3F, b1 = c1 & 0x1F;
        uint8_t r2 = (c2 >> 11) & 0x1F, g2 = (c2 >> 5) & 0x3F, b2 = c2 & 0x1F;
        
        uint8_t r = r1 + (r2 - r1) * ratio;
        uint8_t g = g1 + (g2 - g1) * ratio;
        uint8_t b = b1 + (b2 - b1) * ratio;
        
        return (r << 11) | (g << 5) | b;
    }
    
    // Draw arc (for gauges) - angle in degrees, 0 = right, 90 = bottom
    void drawArc(int16_t cx, int16_t cy, int16_t r, int16_t thickness,
                 float startAngle, float endAngle, uint16_t color) {
        float startRad = startAngle * PI / 180.0;
        float endRad = endAngle * PI / 180.0;
        
        float step = 1.5 / r;  // Adaptive step based on radius
        for (float angle = startRad; angle <= endRad; angle += step) {
            for (int t = -thickness/2; t <= thickness/2; t++) {
                int x = cx + (r + t) * cos(angle);
                int y = cy + (r + t) * sin(angle);
                drawPixel(x, y, color);
            }
        }
    }
    
    // Gradient arc for beautiful gauges
    void drawArcGradient(int16_t cx, int16_t cy, int16_t r, int16_t thickness,
                         float startAngle, float endAngle, 
                         uint16_t colorStart, uint16_t colorEnd) {
        float startRad = startAngle * PI / 180.0;
        float endRad = endAngle * PI / 180.0;
        float totalAngle = endRad - startRad;
        if (totalAngle <= 0) return;
        
        float step = 1.5 / r;
        for (float angle = startRad; angle <= endRad; angle += step) {
            float progress = (angle - startRad) / totalAngle;
            uint16_t color = blendColors(colorStart, colorEnd, progress);
            
            for (int t = -thickness/2; t <= thickness/2; t++) {
                int x = cx + (r + t) * cos(angle);
                int y = cy + (r + t) * sin(angle);
                drawPixel(x, y, color);
            }
        }
    }
    
    // Draw rounded rectangle
    void fillRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color) {
        // Center rectangle
        fillRect(x + r, y, w - 2*r, h, color);
        // Side rectangles
        fillRect(x, y + r, r, h - 2*r, color);
        fillRect(x + w - r, y + r, r, h - 2*r, color);
        // Corners
        fillCircleQuadrant(x + r, y + r, r, 1, color);
        fillCircleQuadrant(x + w - r - 1, y + r, r, 2, color);
        fillCircleQuadrant(x + w - r - 1, y + h - r - 1, r, 4, color);
        fillCircleQuadrant(x + r, y + h - r - 1, r, 8, color);
    }
    
    void fillCircleQuadrant(int16_t x0, int16_t y0, int16_t r, uint8_t corner, uint16_t color) {
        int16_t f = 1 - r, ddF_x = 1, ddF_y = -2 * r, x = 0, y = r;
        
        while (x < y) {
            if (f >= 0) { y--; ddF_y += 2; f += ddF_y; }
            x++; ddF_x += 2; f += ddF_x;
            
            if (corner & 1) { drawFastVLine(x0 - x, y0 - y, y, color); drawFastVLine(x0 - y, y0 - x, x, color); }
            if (corner & 2) { drawFastVLine(x0 + x, y0 - y, y, color); drawFastVLine(x0 + y, y0 - x, x, color); }
            if (corner & 4) { drawFastVLine(x0 + x, y0 + 1, y, color); drawFastVLine(x0 + y, y0 + 1, x, color); }
            if (corner & 8) { drawFastVLine(x0 - x, y0 + 1, y, color); drawFastVLine(x0 - y, y0 + 1, x, color); }
        }
    }
    
    void setBrightness(uint8_t brightness) {
        ledcWrite(0, brightness);
    }
};

// ============================================================================
// Premium Chatter Display UI
// ============================================================================

class ChatterDisplay {
private:
    SPD2010_Display* lcd;
    
    // Animation state
    float pulsePhase = 0;
    float glowIntensity = 0;
    float arcAngle = 0;
    float breathePhase = 0;
    
    // Display data
    String currentState = "ok";
    float chatterScore = 0;
    float confidence = 0;
    int calibrationPct = 100;
    float frequency = 0;
    float vibration = 0;
    float fftBars[24] = {0};
    float fftTargets[24] = {0};
    
    // Frame timing
    unsigned long lastFrameTime = 0;
    int frameCount = 0;
    float fps = 0;
    
public:
    ChatterDisplay() : lcd(nullptr) {}
    
    bool begin() {
        lcd = new SPD2010_Display();
        if (!lcd->begin()) {
            Serial.println("[UI] Display init failed!");
            return false;
        }
        
        // Clear and show splash
        lcd->fillScreen(Colors::BG_DARK);
        showPremiumSplash();
        delay(1800);
        
        Serial.println("[UI] Premium ChatterDisplay ready");
        return true;
    }
    
    void showPremiumSplash() {
        lcd->fillScreen(Colors::BG_DARK);
        
        // Animated rings expanding outward
        for (int r = 30; r < RADIUS - 10; r += 35) {
            lcd->drawCircle(CENTER_X, CENTER_Y, r, Colors::CYAN_DARK);
            delay(25);
        }
        
        // Center glow effect
        for (int r = 70; r > 5; r -= 8) {
            uint16_t color = lcd->blendColors(Colors::CYAN, Colors::BG_DARK, 1.0 - (float)r / 70);
            lcd->drawCircle(CENTER_X, CENTER_Y - 25, r, color);
        }
        lcd->fillCircle(CENTER_X, CENTER_Y - 25, 40, Colors::CYAN);
        
        // Frame ring
        lcd->drawCircle(CENTER_X, CENTER_Y, RADIUS - 5, Colors::FRAME_BRIGHT);
        lcd->drawCircle(CENTER_X, CENTER_Y, RADIUS - 6, Colors::FRAME_BRIGHT);
        lcd->drawCircle(CENTER_X, CENTER_Y, RADIUS - 10, Colors::FRAME_DIM);
        
        // Corner accents
        drawCornerAccents();
    }
    
    void update(float score, float conf, int calPct, float freq, float vib, const char* state) {
        chatterScore = score;
        confidence = conf;
        calibrationPct = calPct;
        frequency = freq;
        vibration = vib;
        currentState = String(state);
        
        // Update animations
        pulsePhase += 0.1;
        if (pulsePhase > TWO_PI) pulsePhase -= TWO_PI;
        
        breathePhase += 0.06;
        if (breathePhase > TWO_PI) breathePhase -= TWO_PI;
        
        // State-dependent glow animation
        if (currentState == "chatter") {
            glowIntensity = 0.6 + 0.4 * sin(pulsePhase * 4);  // Fast pulse
        } else if (currentState == "warning") {
            glowIntensity = 0.4 + 0.3 * sin(pulsePhase * 2);  // Medium pulse
        } else if (currentState == "calibrating") {
            glowIntensity = 0.3 + 0.2 * sin(breathePhase);    // Slow breathe
        } else {
            glowIntensity = 0.15 + 0.1 * sin(breathePhase);   // Subtle breathe
        }
        
        // Arc angle for score (smooth transition)
        float targetArc = (score / 100.0) * 270;
        arcAngle = arcAngle * 0.85 + targetArc * 0.15;
        
        // Update FFT visualization
        updateFFTAnimation();
        
        // Render frame
        render();
        
        // FPS counter
        frameCount++;
        if (millis() - lastFrameTime >= 1000) {
            fps = frameCount;
            frameCount = 0;
            lastFrameTime = millis();
        }
    }
    
    void setFFTData(float* data, int count) {
        for (int i = 0; i < min(count, 24); i++) {
            fftTargets[i] = constrain(data[i], 0.0f, 1.0f);
        }
    }
    
private:
    void updateFFTAnimation() {
        // Smooth FFT bar transitions
        for (int i = 0; i < 24; i++) {
            float target = fftTargets[i];
            
            // Add animation when cutting
            if (currentState == "ok" && chatterScore > 10) {
                target += 0.1 * sin(pulsePhase + i * 0.3);
            } else if (currentState == "chatter") {
                target = 0.3 + 0.7 * (sin(pulsePhase * 3 + i * 0.5) + 1) * 0.5;
            }
            
            fftBars[i] = fftBars[i] * 0.75 + target * 0.25;
        }
    }
    
    void render() {
        lcd->fillScreen(Colors::BG_DARK);
        
        // Layer 1: Background rings
        drawBackgroundRings();
        
        // Layer 2: Main gauge arc
        drawMainGauge();
        
        // Layer 3: Status indicator
        drawStatusCircle();
        
        // Layer 4: Score display area
        drawScoreArea();
        
        // Layer 5: Stats display
        drawStats();
        
        // Layer 6: FFT spectrum
        drawFFTSpectrum();
        
        // Layer 7: Frame and accents
        drawFrame();
        drawCornerAccents();
    }
    
    void drawBackgroundRings() {
        // Subtle concentric rings
        for (int r = RADIUS - 25; r > 50; r -= 45) {
            lcd->drawCircle(CENTER_X, CENTER_Y, r, Colors::BG_SURFACE);
        }
    }
    
    void drawMainGauge() {
        int cx = CENTER_X;
        int cy = CENTER_Y;
        int radius = RADIUS - 40;
        int thickness = 14;
        
        // Track (dark background arc) - 270 degrees from 135 to 405
        lcd->drawArc(cx, cy, radius, thickness, 135, 405, Colors::GAUGE_TRACK);
        
        // Value arc with gradient
        if (arcAngle > 2) {
            uint16_t colorStart, colorEnd;
            
            if (chatterScore < 30) {
                colorStart = Colors::OK_GLOW;
                colorEnd = Colors::OK_MAIN;
            } else if (chatterScore < 60) {
                colorStart = Colors::OK_MAIN;
                colorEnd = Colors::WARN_MAIN;
            } else {
                colorStart = Colors::WARN_MAIN;
                colorEnd = Colors::ALERT_MAIN;
            }
            
            lcd->drawArcGradient(cx, cy, radius, thickness, 135, 135 + arcAngle, colorStart, colorEnd);
            
            // Glow dot at arc end
            float endAngle = (135 + arcAngle) * PI / 180.0;
            int glowX = cx + radius * cos(endAngle);
            int glowY = cy + radius * sin(endAngle);
            lcd->fillCircle(glowX, glowY, 10, colorEnd);
            lcd->fillCircle(glowX, glowY, 6, Colors::TEXT_WHITE);
        }
        
        // Tick marks around arc
        for (int i = 0; i <= 10; i++) {
            float angle = (135 + i * 27) * PI / 180.0;
            int innerR = radius - thickness/2 - 12;
            int outerR = radius - thickness/2 - 4;
            
            for (float t = 0; t < 1; t += 0.25) {
                int x = cx + (innerR + (outerR - innerR) * t) * cos(angle);
                int y = cy + (innerR + (outerR - innerR) * t) * sin(angle);
                uint16_t tickColor = (i <= chatterScore / 10) ? Colors::TEXT_LIGHT : Colors::TEXT_DIM;
                lcd->drawPixel(x, y, tickColor);
            }
        }
    }
    
    void drawStatusCircle() {
        int statusY = CENTER_Y - 45;
        int baseRadius = 50;
        
        // Get colors for current state
        uint16_t mainColor, glowColor;
        if (currentState == "chatter") {
            mainColor = Colors::ALERT_MAIN;
            glowColor = Colors::ALERT_GLOW;
        } else if (currentState == "warning") {
            mainColor = Colors::WARN_MAIN;
            glowColor = Colors::WARN_GLOW;
        } else if (currentState == "calibrating") {
            mainColor = Colors::CAL_MAIN;
            glowColor = Colors::CAL_GLOW;
        } else {
            mainColor = Colors::OK_MAIN;
            glowColor = Colors::OK_GLOW;
        }
        
        // Outer glow rings (animated)
        int glowSize = (int)(15 * glowIntensity);
        for (int i = 0; i < 3; i++) {
            int r = baseRadius + 6 + i * 5 + glowSize/3;
            uint16_t ringColor = lcd->blendColors(glowColor, Colors::BG_DARK, (float)i / 3);
            lcd->drawCircle(CENTER_X, statusY, r, ringColor);
        }
        
        // Main status circle
        lcd->fillCircle(CENTER_X, statusY, baseRadius, mainColor);
        
        // Outer ring
        lcd->drawCircle(CENTER_X, statusY, baseRadius + 2, Colors::TEXT_WHITE);
        lcd->drawCircle(CENTER_X, statusY, baseRadius + 3, Colors::TEXT_LIGHT);
        
        // Status icons
        if (currentState == "calibrating") {
            // Rotating dots spinner
            for (int i = 0; i < 8; i++) {
                float a = pulsePhase * 2 + i * PI / 4;
                int x = CENTER_X + 22 * cos(a);
                int y = statusY + 22 * sin(a);
                int dotSize = 5 - i/2;
                if (dotSize > 0) {
                    lcd->fillCircle(x, y, dotSize, Colors::BG_DARK);
                }
            }
        } else if (currentState == "warning") {
            // Warning triangle symbol (!)
            lcd->fillRect(CENTER_X - 3, statusY - 18, 6, 22, Colors::BG_DARK);
            lcd->fillCircle(CENTER_X, statusY + 12, 4, Colors::BG_DARK);
        } else if (currentState == "chatter") {
            // X symbol
            for (int i = -12; i <= 12; i++) {
                lcd->fillRect(CENTER_X + i - 2, statusY + i - 2, 4, 4, Colors::BG_DARK);
                lcd->fillRect(CENTER_X + i - 2, statusY - i - 2, 4, 4, Colors::BG_DARK);
            }
        } else {
            // Checkmark
            for (int i = 0; i < 8; i++) {
                lcd->fillCircle(CENTER_X - 14 + i, statusY + i, 3, Colors::BG_DARK);
            }
            for (int i = 0; i < 16; i++) {
                lcd->fillCircle(CENTER_X - 6 + i, statusY + 8 - i, 3, Colors::BG_DARK);
            }
        }
    }
    
    void drawScoreArea() {
        int scoreY = CENTER_Y + 45;
        
        // Score container with rounded rect
        lcd->fillRoundRect(CENTER_X - 55, scoreY, 110, 50, 10, Colors::BG_ELEVATED);
        
        // Score value - simple rectangle representation for digits
        int score = (int)chatterScore;
        int digitW = 20;
        int digitH = 30;
        int startX = CENTER_X - 35;
        
        // Tens digit
        if (score >= 10) {
            lcd->fillRect(startX, scoreY + 8, digitW, digitH, Colors::TEXT_WHITE);
        }
        // Ones digit
        lcd->fillRect(startX + 25, scoreY + 8, digitW, digitH, Colors::TEXT_WHITE);
        // Percent sign
        lcd->fillCircle(CENTER_X + 30, scoreY + 15, 5, Colors::TEXT_DIM);
        lcd->fillCircle(CENTER_X + 42, scoreY + 35, 5, Colors::TEXT_DIM);
    }
    
    void drawStats() {
        // Top: Confidence bar
        int confY = 30;
        int confW = 100;
        lcd->fillRoundRect(CENTER_X - confW/2, confY, confW, 8, 4, Colors::GAUGE_TRACK);
        int confFill = (int)(confW * confidence / 100.0);
        if (confFill > 4) {
            lcd->fillRoundRect(CENTER_X - confW/2, confY, confFill, 8, 4, Colors::CYAN);
        }
        
        // Calibration indicator
        if (calibrationPct < 100) {
            int calY = confY + 14;
            int calW = 60;
            lcd->fillRoundRect(CENTER_X - calW/2, calY, calW, 5, 2, Colors::GAUGE_TRACK);
            int calFill = (int)(calW * calibrationPct / 100.0);
            if (calFill > 2) {
                lcd->fillRoundRect(CENTER_X - calW/2, calY, calFill, 5, 2, Colors::CAL_MAIN);
            }
        }
        
        // Bottom stats: Frequency and Vibration cards
        int cardY = CENTER_Y + 105;
        int cardW = 70;
        int cardH = 40;
        
        // Frequency card (left)
        lcd->fillRoundRect(CENTER_X - cardW - 8, cardY, cardW, cardH, 6, Colors::BG_CARD);
        // Frequency value representation
        lcd->fillRect(CENTER_X - cardW + 5, cardY + 8, 50, 6, Colors::PURPLE);
        
        // Vibration card (right)
        lcd->fillRoundRect(CENTER_X + 8, cardY, cardW, cardH, 6, Colors::BG_CARD);
        // Vibration value bar
        int vibW = (int)(50 * constrain(vibration / 2.0, 0, 1));
        lcd->fillRect(CENTER_X + 18, cardY + 8, vibW, 6, Colors::TEAL);
    }
    
    void drawFFTSpectrum() {
        int barCount = 20;
        int barWidth = 12;
        int barSpacing = 5;
        int totalWidth = barCount * (barWidth + barSpacing) - barSpacing;
        int startX = CENTER_X - totalWidth / 2;
        int baseY = DISPLAY_HEIGHT - 40;
        int maxHeight = 35;
        
        for (int i = 0; i < barCount; i++) {
            int barHeight = (int)(fftBars[i] * maxHeight);
            int x = startX + i * (barWidth + barSpacing);
            
            // Bar background
            lcd->fillRoundRect(x, baseY - maxHeight, barWidth, maxHeight, 3, Colors::BG_SURFACE);
            
            // Active bar with color based on frequency zone
            if (barHeight > 3) {
                uint16_t barColor;
                if (i < 4) {
                    barColor = Colors::TEAL;  // Low frequency
                } else if (i < 16) {
                    // Chatter zone
                    if (currentState == "chatter") {
                        barColor = Colors::ALERT_MAIN;
                    } else if (currentState == "warning") {
                        barColor = Colors::WARN_MAIN;
                    } else {
                        barColor = Colors::CYAN;
                    }
                } else {
                    barColor = Colors::PURPLE;  // High frequency
                }
                
                lcd->fillRoundRect(x, baseY - barHeight, barWidth, barHeight, 3, barColor);
            }
        }
    }
    
    void drawFrame() {
        // Outer frame rings
        lcd->drawCircle(CENTER_X, CENTER_Y, RADIUS - 2, Colors::FRAME_BRIGHT);
        lcd->drawCircle(CENTER_X, CENTER_Y, RADIUS - 3, Colors::FRAME_BRIGHT);
        lcd->drawCircle(CENTER_X, CENTER_Y, RADIUS - 5, Colors::FRAME_DIM);
        lcd->drawCircle(CENTER_X, CENTER_Y, RADIUS - 6, Colors::FRAME_DIM);
        
        // Inner accent ring
        lcd->drawCircle(CENTER_X, CENTER_Y, RADIUS - 18, Colors::BG_SURFACE);
    }
    
    void drawCornerAccents() {
        int accentLen = 18;
        int offset = 10;
        
        // Top accent
        lcd->fillRect(CENTER_X - 3, offset, 6, accentLen, Colors::CYAN);
        lcd->fillRect(CENTER_X - 1, offset + 3, 2, accentLen - 6, Colors::TEXT_WHITE);
        
        // Bottom accent
        lcd->fillRect(CENTER_X - 3, DISPLAY_HEIGHT - offset - accentLen, 6, accentLen, Colors::CYAN);
        lcd->fillRect(CENTER_X - 1, DISPLAY_HEIGHT - offset - accentLen + 3, 2, accentLen - 6, Colors::TEXT_WHITE);
        
        // Left accent
        lcd->fillRect(offset, CENTER_Y - 3, accentLen, 6, Colors::CYAN);
        lcd->fillRect(offset + 3, CENTER_Y - 1, accentLen - 6, 2, Colors::TEXT_WHITE);
        
        // Right accent
        lcd->fillRect(DISPLAY_WIDTH - offset - accentLen, CENTER_Y - 3, accentLen, 6, Colors::CYAN);
        lcd->fillRect(DISPLAY_WIDTH - offset - accentLen + 3, CENTER_Y - 1, accentLen - 6, 2, Colors::TEXT_WHITE);
    }
    
public:
    float getFPS() const { return fps; }
};

#endif // DISPLAY_UI_H
