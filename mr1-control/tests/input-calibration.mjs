import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeInputCalibration,
  createPreviewInputCalibration,
} from "../src/input-calibration.js";

function createSamples({ delayUs, residuals = [0, 0, 0], feeds = [5, 10, 20] }) {
  const slope = -delayUs / 60_000_000;
  return feeds.flatMap((feedMmMin) => residuals.map((residual) => ({
    feedMmMin,
    positionMm: -40 + slope * feedMmMin + residual,
  })));
}

test("resolvable end-to-end delay produces a feed-specific correction", () => {
  const result = analyzeInputCalibration(createSamples({ delayUs: 20_000 }), {
    workingFeedMmMin: 10,
    positionResolutionMm: 0.0001,
  });

  assert.equal(result.valid, true);
  assert.equal(result.identifiable, true);
  assert.ok(Math.abs(result.latencyUs - 20_000) < 0.01);
  assert.ok(Math.abs(result.compensationMm - 0.0033333333) < 1e-9);
});

test("fast optocoupler delay below machine resolution is not compensated", () => {
  const result = analyzeInputCalibration(createSamples({ delayUs: 50 }), {
    workingFeedMmMin: 10,
    positionResolutionMm: 1 / 533.333333,
  });

  assert.equal(result.valid, true);
  assert.equal(result.identifiable, false);
  assert.equal(result.compensationMm, 0);
  assert.ok(result.latencyUpperBoundUs > result.latencyUs);
});

test("repeatability is checked independently of fitted latency", () => {
  const result = analyzeInputCalibration(createSamples({
    delayUs: 20_000,
    residuals: [-0.006, 0, 0.006],
  }), { maxSpreadMm: 0.01, positionResolutionMm: 0.0001 });

  assert.equal(result.valid, true);
  assert.equal(result.repeatabilityPass, false);
  assert.ok(Math.abs(result.repeatabilityMm - 0.012) < 1e-9);
});

test("preview calibration is deterministic and remains below motion resolution", () => {
  const samples = createPreviewInputCalibration({ channel: "setter", samplesPerFeed: 7 });
  const result = analyzeInputCalibration(samples, { workingFeedMmMin: 10 });

  assert.equal(samples.length, 21);
  assert.equal(result.valid, true);
  assert.equal(result.sampleCount, 21);
  assert.equal(result.identifiable, false);
  assert.equal(result.repeatabilityPass, true);
});

test("calibration rejects one-speed and malformed data", () => {
  assert.equal(analyzeInputCalibration([{ feedMmMin: 10, positionMm: -1 }]).valid, false);
  assert.equal(analyzeInputCalibration(createSamples({ delayUs: 10, feeds: [10] })).valid, false);
});
