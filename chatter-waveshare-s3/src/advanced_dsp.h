/*
 * Advanced DSP for Chatter Detection
 * 
 * Implements real machining science:
 * - Stability Lobe Theory (predict chatter-prone RPMs)
 * - Spectral Signature Matching (not just energy, but SHAPE)
 * - Harmonic Series Detection (real chatter has harmonics)
 * - Cross-correlation (mic/IMU agreement = confidence boost)
 * - Onset Detection (tool engagement timing)
 * - Crest Factor Analysis (peak-to-RMS ratio)
 */

#ifndef ADVANCED_DSP_H
#define ADVANCED_DSP_H

#include <Arduino.h>
#include <cmath>

// ============================================================================
// Stability Lobe Predictor
// Based on: f_chatter = n * f_tooth + f_natural
// where f_tooth = (RPM * teeth) / 60
// ============================================================================

class StabilityLobePredictor {
public:
    void setToolParams(int numTeeth, float toolDiameter, float naturalFreq = 800) {
        teeth = numTeeth;
        diameter = toolDiameter;
        fn = naturalFreq;  // Tool/holder natural frequency (usually 600-1500 Hz)
    }
    
    void setSpindleRPM(float rpm) {
        spindleRPM = rpm;
        toothPassFreq = (rpm * teeth) / 60.0f;
    }
    
    // Predict likely chatter frequencies for current RPM
    void getPredictedChatterFreqs(float* freqs, int& count, int maxCount = 5) {
        count = 0;
        if (spindleRPM < 100) return;
        
        // Regenerative chatter occurs near: f = k * f_tooth ± f_natural
        // where k = 1, 2, 3... (stability lobes)
        for (int k = 1; k <= 5 && count < maxCount; k++) {
            float f1 = k * toothPassFreq + fn;
            float f2 = abs(k * toothPassFreq - fn);
            
            if (f1 > 200 && f1 < 10000) freqs[count++] = f1;
            if (f2 > 200 && f2 < 10000 && count < maxCount) freqs[count++] = f2;
        }
        
        // Also add tooth passing frequency harmonics (forced vibration)
        for (int k = 1; k <= 3 && count < maxCount; k++) {
            float f = k * toothPassFreq;
            if (f > 200 && f < 10000) freqs[count++] = f;
        }
    }
    
    // Score how "suspicious" a detected frequency is
    float scoreFrequency(float detectedFreq) {
        if (spindleRPM < 100) return 0.5;  // No RPM data, neutral score
        
        float predictedFreqs[10];
        int count;
        getPredictedChatterFreqs(predictedFreqs, count, 10);
        
        float minDist = 10000;
        for (int i = 0; i < count; i++) {
            float dist = abs(detectedFreq - predictedFreqs[i]);
            if (dist < minDist) minDist = dist;
        }
        
        // Close to predicted = high score
        // Within 50Hz = 1.0, 200Hz away = 0.5, 500Hz+ = 0.1
        if (minDist < 50) return 1.0;
        if (minDist < 200) return 0.8;
        if (minDist < 500) return 0.5;
        return 0.2;
    }
    
    float getToothPassFreq() const { return toothPassFreq; }
    
private:
    int teeth = 2;
    float diameter = 6.0;
    float fn = 800;  // Natural frequency estimate
    float spindleRPM = 0;
    float toothPassFreq = 0;
};

// ============================================================================
// Harmonic Series Detector
// Real chatter has strong harmonics at 2x, 3x, 4x fundamental
// Random noise doesn't
// ============================================================================

class HarmonicDetector {
public:
    // Find fundamental and check for harmonics
    // Returns harmonic strength score 0-1
    float analyze(double* magnitudes, int size, float binWidth, float& fundamental) {
        // Find strongest peak above 500 Hz
        float maxMag = 0;
        int maxBin = 0;
        int minBin = (int)(500 / binWidth);
        int maxSearchBin = min(size/2, (int)(8000 / binWidth));
        
        for (int i = minBin; i < maxSearchBin; i++) {
            if (magnitudes[i] > maxMag) {
                maxMag = magnitudes[i];
                maxBin = i;
            }
        }
        
        if (maxMag < 100) {
            fundamental = 0;
            return 0;
        }
        
        fundamental = maxBin * binWidth;
        
        // Check for harmonics at 2x, 3x, 4x
        float harmonicScore = 0;
        int harmonicsFound = 0;
        
        for (int h = 2; h <= 4; h++) {
            int harmonicBin = maxBin * h;
            if (harmonicBin >= size/2) break;
            
            // Look in ±3 bins around expected harmonic
            float localMax = 0;
            for (int j = max(0, harmonicBin-3); j <= min(size/2-1, harmonicBin+3); j++) {
                if (magnitudes[j] > localMax) localMax = magnitudes[j];
            }
            
            // Harmonic should be at least 20% of fundamental
            if (localMax > maxMag * 0.2) {
                harmonicsFound++;
                harmonicScore += localMax / maxMag;
            }
        }
        
        // Strong harmonics = likely chatter, not noise
        return min(1.0f, harmonicScore / 2.0f);
    }
};

// ============================================================================
// Crest Factor Analyzer (Peak-to-RMS ratio)
// Chatter has distinctive crest factor (typically 3-6)
// Normal cutting is lower, random noise is higher
// ============================================================================

class CrestFactorAnalyzer {
public:
    void push(float sample) {
        // Ring buffer for last N samples
        buffer[bufIdx] = sample;
        bufIdx = (bufIdx + 1) % BUFFER_SIZE;
        if (count < BUFFER_SIZE) count++;
    }
    
    float getCrestFactor() {
        if (count < 10) return 0;
        
        float sum = 0, sumSq = 0, peak = 0;
        for (int i = 0; i < count; i++) {
            float v = abs(buffer[i]);
            sum += buffer[i];
            sumSq += buffer[i] * buffer[i];
            if (v > peak) peak = v;
        }
        
        float mean = sum / count;
        float rms = sqrt(sumSq / count);
        
        if (rms < 0.001) return 0;
        return peak / rms;
    }
    
    // Score how "chatter-like" the crest factor is
    float getChatterScore() {
        float cf = getCrestFactor();
        
        // Chatter typically has crest factor 3-6
        if (cf >= 3.0 && cf <= 6.0) return 1.0;
        if (cf >= 2.5 && cf <= 7.0) return 0.7;
        if (cf >= 2.0 && cf <= 8.0) return 0.4;
        return 0.1;
    }
    
private:
    static const int BUFFER_SIZE = 256;
    float buffer[BUFFER_SIZE] = {0};
    int bufIdx = 0;
    int count = 0;
};

// ============================================================================
// Cross-Correlation (Mic vs IMU agreement)
// If both sensors see the same pattern, confidence is high
// ============================================================================

class CrossCorrelator {
public:
    void pushMic(float v) {
        micBuf[micIdx] = v;
        micIdx = (micIdx + 1) % BUF_SIZE;
    }
    
    void pushIMU(float v) {
        imuBuf[imuIdx] = v;
        imuIdx = (imuIdx + 1) % BUF_SIZE;
    }
    
    // Normalized cross-correlation at zero lag
    float getCorrelation() {
        float sumMic = 0, sumIMU = 0;
        for (int i = 0; i < BUF_SIZE; i++) {
            sumMic += micBuf[i];
            sumIMU += imuBuf[i];
        }
        float meanMic = sumMic / BUF_SIZE;
        float meanIMU = sumIMU / BUF_SIZE;
        
        float num = 0, denMic = 0, denIMU = 0;
        for (int i = 0; i < BUF_SIZE; i++) {
            float dm = micBuf[i] - meanMic;
            float di = imuBuf[i] - meanIMU;
            num += dm * di;
            denMic += dm * dm;
            denIMU += di * di;
        }
        
        float den = sqrt(denMic * denIMU);
        if (den < 0.0001) return 0;
        
        return num / den;  // -1 to +1
    }
    
    // Confidence boost if sensors agree
    float getConfidenceMultiplier() {
        float corr = getCorrelation();
        
        // High positive correlation = both seeing same thing
        if (corr > 0.7) return 1.3;
        if (corr > 0.5) return 1.15;
        if (corr > 0.3) return 1.0;
        if (corr > 0.0) return 0.9;
        return 0.7;  // Negative correlation = something weird
    }
    
private:
    static const int BUF_SIZE = 64;
    float micBuf[BUF_SIZE] = {0};
    float imuBuf[BUF_SIZE] = {0};
    int micIdx = 0;
    int imuIdx = 0;
};

// ============================================================================
// Onset Detector (detects tool engagement)
// Uses spectral flux - rate of change in spectrum
// ============================================================================

class OnsetDetector {
public:
    void init(int numBins) {
        nBins = min(numBins, MAX_BINS);
        for (int i = 0; i < nBins; i++) prevMag[i] = 0;
        engaged = false;
        engageTime = 0;
    }
    
    // Call with FFT magnitude spectrum
    float update(double* magnitudes) {
        float flux = 0;
        
        for (int i = 1; i < nBins; i++) {
            float diff = magnitudes[i] - prevMag[i];
            if (diff > 0) flux += diff;  // Half-wave rectified
            prevMag[i] = magnitudes[i];
        }
        
        // Detect engagement (sudden increase in spectral energy)
        float threshold = avgFlux * 3.0 + 100;
        
        if (flux > threshold && !engaged) {
            engaged = true;
            engageTime = millis();
        } else if (flux < avgFlux * 0.5 && engaged) {
            engaged = false;
        }
        
        // Update running average
        avgFlux = avgFlux * 0.95 + flux * 0.05;
        
        return flux;
    }
    
    bool isEngaged() const { return engaged; }
    unsigned long getEngageTime() const { return engageTime; }
    
    // Chatter typically starts 100-500ms after engagement
    bool inChatterWindow() const {
        if (!engaged) return false;
        unsigned long dt = millis() - engageTime;
        return (dt > 100 && dt < 5000);
    }
    
private:
    static const int MAX_BINS = 256;
    float prevMag[MAX_BINS] = {0};
    int nBins = 128;
    float avgFlux = 0;
    bool engaged = false;
    unsigned long engageTime = 0;
};

// ============================================================================
// Spectral Centroid & Spread
// Chatter has narrow spectral spread around a center frequency
// Noise has wide spread
// ============================================================================

class SpectralShape {
public:
    void analyze(double* magnitudes, int size, float binWidth) {
        float totalEnergy = 0;
        float weightedSum = 0;
        
        for (int i = 1; i < size/2; i++) {
            float freq = i * binWidth;
            float energy = magnitudes[i] * magnitudes[i];
            totalEnergy += energy;
            weightedSum += freq * energy;
        }
        
        if (totalEnergy < 1) {
            centroid = 0;
            spread = 10000;
            return;
        }
        
        centroid = weightedSum / totalEnergy;
        
        // Calculate spread (standard deviation around centroid)
        float varSum = 0;
        for (int i = 1; i < size/2; i++) {
            float freq = i * binWidth;
            float energy = magnitudes[i] * magnitudes[i];
            float diff = freq - centroid;
            varSum += diff * diff * energy;
        }
        
        spread = sqrt(varSum / totalEnergy);
    }
    
    float getCentroid() const { return centroid; }
    float getSpread() const { return spread; }
    
    // Narrow spread = likely tonal (chatter), wide = noise
    float getNarrowScore() {
        // Chatter typically has spread < 500 Hz
        if (spread < 200) return 1.0;
        if (spread < 500) return 0.8;
        if (spread < 1000) return 0.5;
        return 0.2;
    }
    
private:
    float centroid = 0;
    float spread = 10000;
};

// ============================================================================
// STFT Ring Buffer - Track frequency evolution over time
// Chatter has characteristic onset: gradual frequency/amplitude increase
// ============================================================================

class FrequencyTracker {
public:
    void push(float frequency, float amplitude) {
        freqHistory[histIdx] = frequency;
        ampHistory[histIdx] = amplitude;
        histIdx = (histIdx + 1) % HISTORY_SIZE;
        if (count < HISTORY_SIZE) count++;
    }
    
    // Check if frequency is stable (chatter) vs wandering (noise)
    float getFrequencyStability() {
        if (count < 10) return 0;
        
        float sum = 0, sumSq = 0;
        for (int i = 0; i < count; i++) {
            sum += freqHistory[i];
            sumSq += freqHistory[i] * freqHistory[i];
        }
        
        float mean = sum / count;
        float variance = (sumSq / count) - (mean * mean);
        float stdDev = sqrt(max(0.0f, variance));
        
        // Coefficient of variation
        float cv = (mean > 100) ? (stdDev / mean) : 1.0;
        
        // Low CV = stable frequency = chatter
        if (cv < 0.05) return 1.0;
        if (cv < 0.10) return 0.8;
        if (cv < 0.20) return 0.5;
        return 0.2;
    }
    
    // Check for amplitude growth (chatter onset characteristic)
    bool isAmplitudeGrowing() {
        if (count < 20) return false;
        
        // Compare recent vs older
        float oldAvg = 0, newAvg = 0;
        int halfCount = count / 2;
        
        for (int i = 0; i < halfCount; i++) {
            int oldIdx = (histIdx - count + i + HISTORY_SIZE) % HISTORY_SIZE;
            int newIdx = (histIdx - halfCount + i + HISTORY_SIZE) % HISTORY_SIZE;
            oldAvg += ampHistory[oldIdx];
            newAvg += ampHistory[newIdx];
        }
        
        oldAvg /= halfCount;
        newAvg /= halfCount;
        
        // Growing if new > old by 30%+
        return (newAvg > oldAvg * 1.3);
    }
    
private:
    static const int HISTORY_SIZE = 50;  // ~2.5 seconds at 20Hz
    float freqHistory[HISTORY_SIZE] = {0};
    float ampHistory[HISTORY_SIZE] = {0};
    int histIdx = 0;
    int count = 0;
};

// ============================================================================
// TMC2209 StallGuard Analyzer
// If we have UART data from drivers, oscillation in SG = chatter
// ============================================================================

class StallGuardAnalyzer {
public:
    void pushSG(int axis, uint16_t sgValue) {
        if (axis >= 0 && axis < 3) {
            sgBuffer[axis][sgIdx[axis]] = sgValue;
            sgIdx[axis] = (sgIdx[axis] + 1) % SG_BUFFER_SIZE;
            if (sgCount[axis] < SG_BUFFER_SIZE) sgCount[axis]++;
        }
    }
    
    // Detect rapid oscillation in StallGuard = vibration/chatter
    float getOscillationScore(int axis) {
        if (axis < 0 || axis >= 3 || sgCount[axis] < 10) return 0;
        
        // Count zero-crossings of derivative (oscillation detector)
        int crossings = 0;
        int lastSign = 0;
        
        for (int i = 1; i < sgCount[axis]; i++) {
            int idx = (sgIdx[axis] - sgCount[axis] + i + SG_BUFFER_SIZE) % SG_BUFFER_SIZE;
            int prevIdx = (idx - 1 + SG_BUFFER_SIZE) % SG_BUFFER_SIZE;
            
            int diff = (int)sgBuffer[axis][idx] - (int)sgBuffer[axis][prevIdx];
            int sign = (diff > 5) ? 1 : (diff < -5) ? -1 : 0;
            
            if (sign != 0 && sign != lastSign && lastSign != 0) {
                crossings++;
            }
            if (sign != 0) lastSign = sign;
        }
        
        // High crossing rate = oscillation
        float rate = (float)crossings / sgCount[axis];
        
        if (rate > 0.3) return 1.0;   // Rapid oscillation
        if (rate > 0.2) return 0.7;
        if (rate > 0.1) return 0.4;
        return 0.1;
    }
    
    // Combined score from all axes
    float getCombinedScore() {
        float maxScore = 0;
        for (int i = 0; i < 3; i++) {
            float s = getOscillationScore(i);
            if (s > maxScore) maxScore = s;
        }
        return maxScore;
    }
    
    bool hasData() const {
        return (sgCount[0] > 10 || sgCount[1] > 10 || sgCount[2] > 10);
    }
    
private:
    static const int SG_BUFFER_SIZE = 32;
    uint16_t sgBuffer[3][SG_BUFFER_SIZE] = {{0}};
    int sgIdx[3] = {0};
    int sgCount[3] = {0};
};

// ============================================================================
// Master Advanced DSP Engine
// ============================================================================

class AdvancedDSP {
public:
    StabilityLobePredictor stabilityLobe;
    HarmonicDetector harmonicDetector;
    CrestFactorAnalyzer crestAnalyzer;
    CrossCorrelator crossCorr;
    OnsetDetector onsetDetector;
    SpectralShape spectralShape;
    FrequencyTracker freqTracker;
    StallGuardAnalyzer stallGuard;
    
    void init(float sampleRate, int fftSize) {
        binWidth = sampleRate / fftSize;
        onsetDetector.init(fftSize / 4);
    }
    
    struct AdvancedResult {
        float chatterScore;        // Final weighted score 0-100
        float confidence;          // How sure we are 0-100
        float dominantFreq;        // Detected frequency
        float harmonicStrength;    // 0-1
        float stabilityLobeMatch;  // How well freq matches predicted
        float spectralNarrowness;  // 0-1 (narrow = chatter)
        float freqStability;       // 0-1 (stable = chatter)
        float sensorAgreement;     // Mic/IMU correlation
        bool isEngaged;            // Tool in material?
        bool isGrowing;            // Amplitude increasing?
        float stallGuardScore;     // TMC2209 data if available
    };
    
    AdvancedResult analyze(double* fftMagnitudes, int fftSize, 
                           float vibMagnitude, float micRMS) {
        AdvancedResult r = {0};
        
        // Push samples for correlation
        crossCorr.pushMic(micRMS);
        crossCorr.pushIMU(vibMagnitude);
        crestAnalyzer.push(micRMS);
        
        // Spectral analysis
        spectralShape.analyze(fftMagnitudes, fftSize, binWidth);
        onsetDetector.update(fftMagnitudes);
        
        // Harmonic detection
        float fundamental;
        r.harmonicStrength = harmonicDetector.analyze(fftMagnitudes, fftSize, binWidth, fundamental);
        r.dominantFreq = fundamental;
        
        // Track frequency over time
        float peakMag = 0;
        for (int i = 1; i < fftSize/2; i++) {
            if (fftMagnitudes[i] > peakMag) peakMag = fftMagnitudes[i];
        }
        freqTracker.push(fundamental, peakMag);
        
        // Get all sub-scores
        r.stabilityLobeMatch = stabilityLobe.scoreFrequency(fundamental);
        r.spectralNarrowness = spectralShape.getNarrowScore();
        r.freqStability = freqTracker.getFrequencyStability();
        r.sensorAgreement = crossCorr.getCorrelation();
        r.isEngaged = onsetDetector.isEngaged();
        r.isGrowing = freqTracker.isAmplitudeGrowing();
        r.stallGuardScore = stallGuard.getCombinedScore();
        
        // === WEIGHTED FUSION ===
        // Base score from anomaly detection (passed in from adaptive_chatter.h)
        // Here we MODIFY it based on advanced features
        
        float score = 0;
        float weights = 0;
        
        // Harmonic strength (strong indicator)
        score += r.harmonicStrength * 30;
        weights += 30;
        
        // Spectral narrowness
        score += r.spectralNarrowness * 20;
        weights += 20;
        
        // Frequency stability
        score += r.freqStability * 15;
        weights += 15;
        
        // Stability lobe match (if we have RPM data)
        if (stabilityLobe.getToothPassFreq() > 10) {
            score += r.stabilityLobeMatch * 20;
            weights += 20;
        }
        
        // StallGuard oscillation (if available)
        if (stallGuard.hasData()) {
            score += r.stallGuardScore * 25;
            weights += 25;
        }
        
        // Crest factor
        score += crestAnalyzer.getChatterScore() * 10;
        weights += 10;
        
        r.chatterScore = (weights > 0) ? (score / weights) * 100 : 0;
        
        // Confidence boosters
        r.confidence = 50;  // Base
        r.confidence += crossCorr.getConfidenceMultiplier() * 10;
        if (r.harmonicStrength > 0.5) r.confidence += 15;
        if (r.freqStability > 0.7) r.confidence += 10;
        if (r.isGrowing && r.chatterScore > 50) r.confidence += 10;
        if (stallGuard.hasData()) r.confidence += 10;
        
        r.confidence = min(100.0f, r.confidence);
        
        return r;
    }
    
    void setToolParams(int teeth, float diameter) {
        stabilityLobe.setToolParams(teeth, diameter);
    }
    
    void setSpindleRPM(float rpm) {
        stabilityLobe.setSpindleRPM(rpm);
    }
    
    void pushStallGuard(int axis, uint16_t sg) {
        stallGuard.pushSG(axis, sg);
    }
    
private:
    float binWidth = 15.625;
};

#endif // ADVANCED_DSP_H
