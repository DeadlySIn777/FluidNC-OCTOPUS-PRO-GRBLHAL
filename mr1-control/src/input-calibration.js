const DEFAULT_Z_POSITION_RESOLUTION_MM = 1 / 533.333333;

function finiteSamples(samples) {
  return (Array.isArray(samples) ? samples : [])
    .map((sample) => ({
      feedMmMin: Number(sample?.feedMmMin),
      positionMm: Number(sample?.positionMm),
    }))
    .filter((sample) => Number.isFinite(sample.feedMmMin)
      && sample.feedMmMin > 0
      && Number.isFinite(sample.positionMm));
}

function linearFit(samples) {
  const count = samples.length;
  const meanFeed = samples.reduce((sum, sample) => sum + sample.feedMmMin, 0) / count;
  const meanPosition = samples.reduce((sum, sample) => sum + sample.positionMm, 0) / count;
  const feedVariance = samples.reduce(
    (sum, sample) => sum + (sample.feedMmMin - meanFeed) ** 2,
    0,
  );
  if (feedVariance <= Number.EPSILON) return null;

  const slopeMmPerMmMin = samples.reduce(
    (sum, sample) => sum
      + (sample.feedMmMin - meanFeed) * (sample.positionMm - meanPosition),
    0,
  ) / feedVariance;
  const interceptMm = meanPosition - slopeMmPerMmMin * meanFeed;
  const residuals = samples.map(
    (sample) => sample.positionMm - (interceptMm + slopeMmPerMmMin * sample.feedMmMin),
  );
  const residualRmsMm = Math.sqrt(
    residuals.reduce((sum, residual) => sum + residual ** 2, 0) / count,
  );
  const totalVariance = samples.reduce(
    (sum, sample) => sum + (sample.positionMm - meanPosition) ** 2,
    0,
  );
  const residualVariance = residuals.reduce((sum, residual) => sum + residual ** 2, 0);
  const rSquared = totalVariance <= Number.EPSILON
    ? 1
    : Math.max(0, 1 - residualVariance / totalVariance);

  return { interceptMm, slopeMmPerMmMin, residualRmsMm, rSquared };
}

function repeatabilityByFeed(samples) {
  const groups = new Map();
  for (const sample of samples) {
    const group = groups.get(sample.feedMmMin) ?? [];
    group.push(sample.positionMm);
    groups.set(sample.feedMmMin, group);
  }
  return [...groups.entries()].map(([feedMmMin, positions]) => ({
    feedMmMin,
    count: positions.length,
    spreadMm: Math.max(...positions) - Math.min(...positions),
  }));
}

export function analyzeInputCalibration(samples, options = {}) {
  const clean = finiteSamples(samples);
  const feeds = [...new Set(clean.map((sample) => sample.feedMmMin))].sort((a, b) => a - b);
  const workingFeedMmMin = Number(options.workingFeedMmMin ?? 10);
  const maxSpreadMm = Number(options.maxSpreadMm ?? 0.01);
  const positionResolutionMm = Number(
    options.positionResolutionMm ?? DEFAULT_Z_POSITION_RESOLUTION_MM,
  );

  if (clean.length < 6 || feeds.length < 2 || !Number.isFinite(workingFeedMmMin)
    || workingFeedMmMin <= 0 || !Number.isFinite(maxSpreadMm) || maxSpreadMm <= 0
    || !Number.isFinite(positionResolutionMm) || positionResolutionMm <= 0) {
    return Object.freeze({ valid: false, reason: "INSUFFICIENT CALIBRATION DATA" });
  }

  const fit = linearFit(clean);
  if (!fit) return Object.freeze({ valid: false, reason: "FEED RANGE REQUIRED" });

  const repeatability = repeatabilityByFeed(clean);
  const repeatabilityMm = Math.max(...repeatability.map((group) => group.spreadMm));
  const feedSpanMmMin = feeds.at(-1) - feeds[0];
  const measuredShiftMm = Math.abs(fit.slopeMmPerMmMin) * feedSpanMmMin;
  const detectionFloorMm = Math.max(positionResolutionMm * 2, fit.residualRmsMm * 3);
  const identifiable = measuredShiftMm >= detectionFloorMm && fit.rSquared >= 0.8;
  const latencyUs = Math.abs(fit.slopeMmPerMmMin) * 60_000_000;
  const latencyUpperBoundUs = detectionFloorMm / feedSpanMmMin * 60_000_000;
  const effectiveErrorMicrons = Math.abs(fit.slopeMmPerMmMin) * workingFeedMmMin * 1000;
  const compensationMm = identifiable ? -fit.slopeMmPerMmMin * workingFeedMmMin : 0;
  const repeatabilityPass = repeatabilityMm <= maxSpreadMm;

  return Object.freeze({
    valid: true,
    sampleCount: clean.length,
    feedCount: feeds.length,
    feeds: Object.freeze(feeds),
    repeatability: Object.freeze(repeatability.map(Object.freeze)),
    repeatabilityMm,
    repeatabilityPass,
    positionResolutionMm,
    measuredShiftMm,
    detectionFloorMm,
    identifiable,
    latencyUs,
    latencyUpperBoundUs,
    effectiveErrorMicrons,
    compensationMm,
    interceptMm: fit.interceptMm,
    slopeMmPerMmMin: fit.slopeMmPerMmMin,
    residualRmsMm: fit.residualRmsMm,
    rSquared: fit.rSquared,
  });
}

export function createPreviewInputCalibration(options = {}) {
  const channel = options.channel === "setter" ? "setter" : "touch";
  const samplesPerFeed = Math.max(5, Math.min(20, Math.round(Number(options.samplesPerFeed ?? 7))));
  const feeds = (Array.isArray(options.feeds) ? options.feeds : [5, 10, 20])
    .map(Number)
    .filter((feed) => Number.isFinite(feed) && feed > 0);
  const basePositionMm = channel === "setter" ? -38.4 : -82.25;
  const simulatedDelayUs = channel === "setter" ? 24 : 18;
  const slopeMmPerMmMin = -simulatedDelayUs / 60_000_000;
  const residualPatternMm = [-0.0011, 0.0004, 0.0009, -0.0003, 0.0001, -0.0007, 0.0007];
  const samples = [];

  for (const feedMmMin of feeds) {
    for (let index = 0; index < samplesPerFeed; index += 1) {
      samples.push(Object.freeze({
        feedMmMin,
        positionMm: basePositionMm
          + slopeMmPerMmMin * feedMmMin
          + residualPatternMm[index % residualPatternMm.length],
      }));
    }
  }
  return Object.freeze(samples);
}
