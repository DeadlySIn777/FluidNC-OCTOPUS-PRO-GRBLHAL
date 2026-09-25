/*
 * Adaptive Chatter Detection with Self-Learning + Advanced DSP
 * 
 * This is a REAL machine learning approach that:
 * 1. Auto-calibrates to YOUR machine's baseline noise
 * 2. Learns chatter patterns from confirmed events
 * 3. Adapts frequency bands based on spindle speed
 * 4. Stores successful interventions and learns from them
 * 5. Uses statistical anomaly detection, not fixed thresholds
 * 6. Stability lobe prediction based on tool/spindle geometry
 * 7. Harmonic series detection (real chatter signature)
 * 8. Cross-correlation between sensors for confidence
 * 9. TMC2209 StallGuard oscillation detection (if UART enabled)
 */

#ifndef ADAPTIVE_CHATTER_H
#define ADAPTIVE_CHATTER_H

#include <Arduino.h>
#include <Preferences.h>
#include <vector>
#include <algorithm>
#include "advanced_dsp.h"

// ============================================================================
// Statistical Helper - Running Statistics (Welford's algorithm)
// ============================================================================

class RunningStats {
public:
    void clear() {
        n = 0;
        mean = 0;
        M2 = 0;
        minVal = INFINITY;
        maxVal = -INFINITY;
    }
    
    void push(float x) {
        // CRITICAL SAFETY: Reject invalid data - NaN/Inf must not corrupt statistics
        if (!isfinite(x)) return;
        
        n++;
        float delta = x - mean;
        mean += delta / n;
        float delta2 = x - mean;
        M2 += delta * delta2;
        
        if (x < minVal) minVal = x;
        if (x > maxVal) maxVal = x;
    }
    
    float getMean() const { return (n > 0) ? mean : 0; }
    float getVariance() const { return (n > 1) ? M2 / (n - 1) : 0; }
    // CRITICAL SAFETY: Guard against sqrt of negative (can happen with floating point errors)
    float getStdDev() const { 
        float v = getVariance();
        return (isfinite(v) && v > 0) ? sqrt(v) : 0; 
    }
    float getMin() const { return (n > 0) ? minVal : 0; }
    float getMax() const { return (n > 0) ? maxVal : 0; }
    uint32_t getCount() const { return n; }
    
private:
    uint32_t n = 0;
    float mean = 0;
    float M2 = 0;
    float minVal = INFINITY;
    float maxVal = -INFINITY;
};

// ============================================================================
// Frequency Band Analyzer - Adaptive frequency tracking
// ============================================================================

class FrequencyBandAnalyzer {
public:
    static const int NUM_BANDS = 16;
    static const int HISTORY_SIZE = 64;
    
    struct Band {
        float centerFreq;
        float energy;
        RunningStats baseline;  // What's "normal" for this band
        float zScore;           // How many std devs above normal
        bool isAnomaly;
    };
    
    Band bands[NUM_BANDS];
    
    void init(float sampleRate, int fftSize) {
        binWidth = sampleRate / fftSize;
        
        // Logarithmic frequency bands from 100Hz to 8000Hz
        float minFreq = 100;
        float maxFreq = 8000;
        float logMin = log10(minFreq);
        float logMax = log10(maxFreq);
        float logStep = (logMax - logMin) / NUM_BANDS;
        
        for (int i = 0; i < NUM_BANDS; i++) {
            bands[i].centerFreq = pow(10, logMin + (i + 0.5) * logStep);
            bands[i].baseline.clear();
            bands[i].energy = 0;
            bands[i].zScore = 0;
            bands[i].isAnomaly = false;
        }
        
        calibrated = false;
        calibrationSamples = 0;
    }
    
    void analyze(double* magnitudes, int size) {
        // Calculate energy in each band
        for (int b = 0; b < NUM_BANDS; b++) {
            float lowFreq = bands[b].centerFreq / sqrt(2);
            float highFreq = bands[b].centerFreq * sqrt(2);
            int lowBin = max(1, (int)(lowFreq / binWidth));
            int highBin = min(size/2 - 1, (int)(highFreq / binWidth));
            
            float energy = 0;
            for (int i = lowBin; i <= highBin; i++) {
                energy += magnitudes[i] * magnitudes[i];
            }
            bands[b].energy = sqrt(energy);
            
            // Calculate z-score if calibrated
            if (calibrated && bands[b].baseline.getStdDev() > 0) {
                bands[b].zScore = (bands[b].energy - bands[b].baseline.getMean()) 
                                  / bands[b].baseline.getStdDev();
                bands[b].isAnomaly = (bands[b].zScore > ANOMALY_THRESHOLD);
            }
        }
    }
    
    void updateBaseline() {
        // Only update baseline when machine is "idle" or we're calibrating
        for (int b = 0; b < NUM_BANDS; b++) {
            bands[b].baseline.push(bands[b].energy);
        }
        calibrationSamples++;
        
        if (calibrationSamples >= MIN_CALIBRATION_SAMPLES) {
            calibrated = true;
        }
    }
    
    float getAnomalyScore() {
        if (!calibrated) return 0;
        
        float maxZ = 0;
        int anomalyCount = 0;
        
        for (int b = 0; b < NUM_BANDS; b++) {
            if (bands[b].zScore > maxZ) maxZ = bands[b].zScore;
            if (bands[b].isAnomaly) anomalyCount++;
        }
        
        // Score based on both peak anomaly and number of affected bands
        return min(100.0f, maxZ * 10.0f + anomalyCount * 5.0f);
    }
    
    float getDominantAnomalyFreq() {
        float maxZ = 0;
        float freq = 0;
        
        for (int b = 0; b < NUM_BANDS; b++) {
            if (bands[b].zScore > maxZ) {
                maxZ = bands[b].zScore;
                freq = bands[b].centerFreq;
            }
        }
        return freq;
    }
    
    bool isCalibrated() const { return calibrated; }
    int getCalibrationProgress() const { 
        return min(100, (calibrationSamples * 100) / MIN_CALIBRATION_SAMPLES); 
    }
    
private:
    float binWidth = 15.625;  // Default for 16kHz/1024
    bool calibrated = false;
    int calibrationSamples = 0;
    
    static constexpr int MIN_CALIBRATION_SAMPLES = 100;  // ~5 seconds at 20Hz
    static constexpr float ANOMALY_THRESHOLD = 3.0;       // 3 sigma = 99.7% confidence
};

// ============================================================================
// Chatter Pattern Memory - Learns from confirmed chatter events
// ============================================================================

struct ChatterEvent {
    float frequency;          // Dominant chatter frequency
    float spindleRPM;         // Spindle speed when it happened
    float feedRate;           // Feed rate when it happened
    float severity;           // How bad it was (0-100)
    float feedReduction;      // How much we reduced feed (%)
    bool resolved;            // Did the intervention work?
    uint32_t timestamp;       // When it happened
};

class ChatterMemory {
public:
    static const int MAX_EVENTS = 50;
    
    void init() {
        prefs.begin("chatter", false);
        loadFromFlash();
    }
    
    void recordEvent(const ChatterEvent& event) {
        events.push_back(event);
        
        // Keep only recent events
        if (events.size() > MAX_EVENTS) {
            events.erase(events.begin());
        }
        
        // Update frequency histogram
        int freqBin = (int)(event.frequency / 100);
        if (freqBin >= 0 && freqBin < 100) {
            chatterFreqHistogram[freqBin]++;
        }
        
        saveToFlash();
    }
    
    void markResolved(float feedReduction) {
        if (!events.empty()) {
            events.back().resolved = true;
            events.back().feedReduction = feedReduction;
            
            // Learn: this feed reduction worked at this frequency
            learnSuccess(events.back());
            saveToFlash();
        }
    }
    
    // Predict how much feed to reduce based on learned patterns
    float predictFeedReduction(float frequency, float spindleRPM) {
        float totalWeight = 0;
        float weightedReduction = 0;
        
        for (const auto& e : events) {
            if (!e.resolved) continue;
            
            // Weight by similarity (closer freq/RPM = more relevant)
            float freqDiff = abs(e.frequency - frequency) / 500.0;
            float rpmDiff = abs(e.spindleRPM - spindleRPM) / 3000.0;
            float weight = exp(-(freqDiff + rpmDiff));
            
            totalWeight += weight;
            weightedReduction += weight * e.feedReduction;
        }
        
        if (totalWeight > 0.1) {
            return weightedReduction / totalWeight;
        }
        return 20.0;  // Default 20% if no learned data
    }
    
    // Get most common chatter frequency range for this spindle speed
    void getPredictedChatterRange(float spindleRPM, float& lowHz, float& highHz) {
        // Tooling chatter typically occurs at:
        // f_chatter = (tooth_passing_freq * k) where k is a stability lobe integer
        // Without knowing tool geometry, we estimate based on learned patterns
        
        float maxCount = 0;
        int peakBin = 20;  // Default ~2000Hz
        
        for (int i = 5; i < 80; i++) {  // 500Hz to 8000Hz
            if (chatterFreqHistogram[i] > maxCount) {
                maxCount = chatterFreqHistogram[i];
                peakBin = i;
            }
        }
        
        lowHz = max(500.0f, (peakBin - 5) * 100.0f);
        highHz = min(8000.0f, (peakBin + 5) * 100.0f);
    }
    
    int getEventCount() const { return events.size(); }
    int getResolvedCount() const {
        return count_if(events.begin(), events.end(), 
                       [](const ChatterEvent& e) { return e.resolved; });
    }
    
private:
    Preferences prefs;
    std::vector<ChatterEvent> events;
    uint16_t chatterFreqHistogram[100] = {0};  // 100Hz bins from 0-10kHz
    
    void learnSuccess(const ChatterEvent& e) {
        // Reinforce this frequency range as problematic
        int bin = (int)(e.frequency / 100);
        if (bin >= 0 && bin < 100) {
            chatterFreqHistogram[bin] += 2;  // Extra weight for resolved events
        }
    }
    
    void saveToFlash() {
        prefs.putBytes("histogram", chatterFreqHistogram, sizeof(chatterFreqHistogram));
        prefs.putInt("eventCount", events.size());
        
        // Save last 10 events
        for (int i = 0; i < min(10, (int)events.size()); i++) {
            String key = "evt" + String(i);
            prefs.putBytes(key.c_str(), &events[events.size() - 1 - i], sizeof(ChatterEvent));
        }
    }
    
    void loadFromFlash() {
        prefs.getBytes("histogram", chatterFreqHistogram, sizeof(chatterFreqHistogram));
        int count = prefs.getInt("eventCount", 0);
        
        events.clear();
        for (int i = min(9, count - 1); i >= 0; i--) {
            String key = "evt" + String(i);
            ChatterEvent e;
            if (prefs.getBytes(key.c_str(), &e, sizeof(ChatterEvent)) == sizeof(ChatterEvent)) {
                events.push_back(e);
            }
        }
    }
};

// ============================================================================
// Vibration Baseline Tracker
// ============================================================================

class VibrationTracker {
public:
    void init() {
        baseline.clear();
        recent.clear();
    }
    
    void push(float vibMagnitude, bool isCalibrating) {
        recent.push(vibMagnitude);
        
        if (isCalibrating) {
            baseline.push(vibMagnitude);
        }
    }
    
    float getZScore() {
        if (baseline.getStdDev() < 0.001) return 0;
        return (recent.getMean() - baseline.getMean()) / baseline.getStdDev();
    }
    
    float getAnomalyScore() {
        float z = getZScore();
        return min(100.0f, max(0.0f, (z - 1.0f) * 25.0f));  // Score starts at z=1
    }
    
    bool isCalibrated() { return baseline.getCount() >= 50; }
    
private:
    RunningStats baseline;  // Long-term baseline
    RunningStats recent;    // Recent 1-second window
};

// ============================================================================
// Main Adaptive Chatter Detector
// ============================================================================

class AdaptiveChatterDetector {
public:
    enum State {
        CALIBRATING,
        MONITORING,
        WARNING,
        CHATTER,
        RECOVERING
    };
    
    struct Status {
        State state;
        float score;              // 0-100 chatter likelihood
        float confidence;         // 0-100 how sure we are
        float dominantFreq;       // Hz
        float vibrationG;         // g-force
        float suggestedFeedPct;   // Suggested feed reduction %
        bool learned;             // Using learned patterns?
        int calibrationPct;       // Calibration progress
        int learnedEvents;        // How many events we've learned from
        // Advanced DSP metrics
        float harmonicStrength;   // 0-1 harmonic series detection
        float stabilityMatch;     // 0-1 matches predicted lobe
        float sensorAgreement;    // Mic/IMU correlation
        float stallGuardScore;    // TMC2209 oscillation
        bool isEngaged;           // Tool in material
        bool isGrowing;           // Amplitude rising
    };
    
    void init(float sampleRate, int fftSize) {
        this->sampleRate = sampleRate;
        this->fftSize = fftSize;
        
        freqAnalyzer.init(sampleRate, fftSize);
        vibTracker.init();
        memory.init();
        advancedDSP.init(sampleRate, fftSize);
        
        currentState = CALIBRATING;
        spindleRPM = 0;
        feedRate = 100;
        lastChatterTime = 0;
        interventionFeed = 100;
        
        Serial.println("[ADAPTIVE+DSP] Chatter detector initialized");
        Serial.printf("[ADAPTIVE+DSP] Learned from %d events (%d resolved)\n",
                      memory.getEventCount(), memory.getResolvedCount());
    }
    
    void setSpindleRPM(float rpm) { 
        spindleRPM = rpm; 
        advancedDSP.setSpindleRPM(rpm);
    }
    
    void setFeedRate(float feed) { feedRate = feed; }
    
    void setToolParams(int teeth, float diameter) {
        advancedDSP.setToolParams(teeth, diameter);
    }
    
    void pushStallGuard(int axis, uint16_t sg) {
        advancedDSP.pushStallGuard(axis, sg);
    }
    
    void update(double* fftMagnitudes, int fftSize, float vibMagnitude, float micRMS = 0) {
        // Update frequency analysis
        freqAnalyzer.analyze(fftMagnitudes, fftSize);
        
        // Update vibration tracking
        bool isCalibrating = (currentState == CALIBRATING);
        vibTracker.push(vibMagnitude, isCalibrating);
        
        if (isCalibrating) {
            freqAnalyzer.updateBaseline();
            
            if (freqAnalyzer.isCalibrated() && vibTracker.isCalibrated()) {
                currentState = MONITORING;
                Serial.println("[ADAPTIVE+DSP] Calibration complete - monitoring");
            }
            return;
        }
        
        // === BASELINE ANOMALY DETECTION ===
        float freqScore = freqAnalyzer.getAnomalyScore();
        float vibScore = vibTracker.getAnomalyScore();
        float baselineScore = (freqScore * 0.5 + vibScore * 0.3);
        
        // === ADVANCED DSP ANALYSIS ===
        lastAdvResult = advancedDSP.analyze(fftMagnitudes, fftSize, vibMagnitude, micRMS);
        float dspScore = lastAdvResult.chatterScore;
        
        // === FUSION: Baseline + Advanced DSP ===
        float rawScore = (baselineScore * 0.4) + (dspScore * 0.6);
        
        // Apply learned frequency weighting
        float dominantFreq = lastAdvResult.dominantFreq;
        if (dominantFreq < 100) dominantFreq = freqAnalyzer.getDominantAnomalyFreq();
        
        float lowHz, highHz;
        memory.getPredictedChatterRange(spindleRPM, lowHz, highHz);
        
        if (dominantFreq >= lowHz && dominantFreq <= highHz) {
            rawScore *= 1.25;  // In learned chatter range
            usingLearnedData = true;
        } else {
            usingLearnedData = (memory.getResolvedCount() > 0);
        }
        
        // Boost if advanced indicators are strong
        if (lastAdvResult.harmonicStrength > 0.6) rawScore *= 1.15;
        if (lastAdvResult.isGrowing && lastAdvResult.isEngaged) rawScore *= 1.1;
        if (lastAdvResult.stallGuardScore > 0.5) rawScore *= 1.2;
        
        // Clamp and smooth
        rawScore = min(100.0f, rawScore);
        smoothedScore = smoothedScore * 0.7 + rawScore * 0.3;
        
        // State machine
        updateState(smoothedScore, dominantFreq);
    }
    
    Status getStatus() {
        Status s;
        s.state = currentState;
        s.score = smoothedScore;
        s.confidence = calculateConfidence();
        s.dominantFreq = lastAdvResult.dominantFreq > 100 ? 
                         lastAdvResult.dominantFreq : 
                         freqAnalyzer.getDominantAnomalyFreq();
        s.vibrationG = vibTracker.getZScore() * 0.1;
        s.suggestedFeedPct = suggestedFeed;
        s.learned = usingLearnedData;
        s.calibrationPct = freqAnalyzer.getCalibrationProgress();
        s.learnedEvents = memory.getResolvedCount();
        
        // Advanced DSP metrics
        s.harmonicStrength = lastAdvResult.harmonicStrength;
        s.stabilityMatch = lastAdvResult.stabilityLobeMatch;
        s.sensorAgreement = lastAdvResult.sensorAgreement;
        s.stallGuardScore = lastAdvResult.stallGuardScore;
        s.isEngaged = lastAdvResult.isEngaged;
        s.isGrowing = lastAdvResult.isGrowing;
        
        return s;
    }
    
    void confirmChatterResolved() {
        // User or auto-feedback that intervention worked
        float reduction = 100 - interventionFeed;
        memory.markResolved(reduction);
        Serial.printf("[ADAPTIVE] Learned: %.0f%% feed reduction resolved chatter\n", reduction);
    }
    
    void startCalibration() {
        freqAnalyzer.init(16000, 1024);  // Re-init with defaults
        vibTracker.init();
        currentState = CALIBRATING;
        Serial.println("[ADAPTIVE] Re-calibrating baseline...");
    }
    
    const char* getStateString() {
        switch (currentState) {
            case CALIBRATING: return "calibrating";
            case MONITORING: return "ok";
            case WARNING: return "warning";
            case CHATTER: return "chatter";
            case RECOVERING: return "recovering";
            default: return "unknown";
        }
    }
    
private:
    FrequencyBandAnalyzer freqAnalyzer;
    VibrationTracker vibTracker;
    ChatterMemory memory;
    AdvancedDSP advancedDSP;
    AdvancedDSP::AdvancedResult lastAdvResult = {0};
    
    float sampleRate = 16000;
    int fftSize = 1024;
    State currentState = CALIBRATING;
    float smoothedScore = 0;
    float spindleRPM = 0;
    float feedRate = 100;
    float suggestedFeed = 100;
    float interventionFeed = 100;
    bool usingLearnedData = false;
    unsigned long lastChatterTime = 0;
    
    void updateState(float score, float dominantFreq) {
        unsigned long now = millis();
        
        switch (currentState) {
            case MONITORING:
                if (score > 70) {
                    currentState = CHATTER;
                    lastChatterTime = now;
                    recordChatterEvent(dominantFreq, score);
                    suggestedFeed = memory.predictFeedReduction(dominantFreq, spindleRPM);
                } else if (score > 40) {
                    currentState = WARNING;
                }
                break;
                
            case WARNING:
                if (score > 70) {
                    currentState = CHATTER;
                    lastChatterTime = now;
                    recordChatterEvent(dominantFreq, score);
                    suggestedFeed = memory.predictFeedReduction(dominantFreq, spindleRPM);
                } else if (score < 30) {
                    currentState = MONITORING;
                }
                break;
                
            case CHATTER:
                interventionFeed = feedRate;  // Track what feed we dropped to
                if (score < 40) {
                    currentState = RECOVERING;
                    // Auto-confirm if chatter resolved after feed reduction
                    if (feedRate < 95) {
                        confirmChatterResolved();
                    }
                }
                break;
                
            case RECOVERING:
                if (score > 60) {
                    currentState = CHATTER;
                    lastChatterTime = now;
                } else if (score < 25 && (now - lastChatterTime > 5000)) {
                    currentState = MONITORING;
                    suggestedFeed = 100;  // Reset suggestion
                }
                break;
                
            default:
                break;
        }
    }
    
    void recordChatterEvent(float freq, float severity) {
        ChatterEvent e;
        e.frequency = freq;
        e.spindleRPM = spindleRPM;
        e.feedRate = feedRate;
        e.severity = severity;
        e.feedReduction = 0;
        e.resolved = false;
        e.timestamp = millis();
        
        memory.recordEvent(e);
        Serial.printf("[ADAPTIVE+DSP] Recorded chatter @ %.0fHz, %.0f%% severity\n", freq, severity);
    }
    
    float calculateConfidence() {
        float conf = 40;  // Base confidence
        
        // More calibration data = higher confidence
        conf += min(15.0f, freqAnalyzer.getCalibrationProgress() * 0.15f);
        
        // More learned events = higher confidence
        conf += min(15.0f, memory.getResolvedCount() * 1.5f);
        
        // Using learned data = higher confidence
        if (usingLearnedData) conf += 8;
        
        // === ADVANCED DSP CONFIDENCE BOOSTERS ===
        
        // Strong harmonics = definite tonal signal (chatter)
        if (lastAdvResult.harmonicStrength > 0.6) conf += 12;
        else if (lastAdvResult.harmonicStrength > 0.3) conf += 6;
        
        // Sensors agree = not noise
        if (lastAdvResult.sensorAgreement > 0.7) conf += 10;
        else if (lastAdvResult.sensorAgreement > 0.4) conf += 5;
        
        // Stable frequency = sustained oscillation
        if (lastAdvResult.freqStability > 0.7) conf += 8;
        
        // Matches stability lobe prediction = physics agrees
        if (lastAdvResult.stabilityLobeMatch > 0.8) conf += 10;
        
        // TMC2209 data available = motor load confirmation
        if (lastAdvResult.stallGuardScore > 0.5) conf += 12;
        else if (lastAdvResult.stallGuardScore > 0.2) conf += 5;
        
        return min(100.0f, conf);
    }
};

#endif // ADAPTIVE_CHATTER_H
