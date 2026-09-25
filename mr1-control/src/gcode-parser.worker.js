import { parseGcodeProgram } from "./gcode-program.js";
import { applyFixtureMapToJob } from "./fixture-map-profile.js";

const SEGMENT_CHUNK_SIZE = 500;

self.addEventListener("message", (event) => {
  const { id, source, options, fixtureMapProfile } = event.data ?? {};
  try {
    const parseStartedAt = performance.now();
    const job = parseGcodeProgram(source, options);
    const parseFinishedAt = performance.now();
    if (fixtureMapProfile) applyFixtureMapToJob(job, fixtureMapProfile);
    const mapFinishedAt = performance.now();
    job.workerTiming = {
      parseMs: parseFinishedAt - parseStartedAt,
      fixtureMapMs: mapFinishedAt - parseFinishedAt,
    };

    const { segments, ...metadata } = job;
    self.postMessage({
      id,
      type: "start",
      job: { ...metadata, segments: [] },
      segmentCount: segments.length,
    });
    for (let start = 0; start < segments.length; start += SEGMENT_CHUNK_SIZE) {
      self.postMessage({
        id,
        type: "segments",
        start,
        segments: segments.slice(start, start + SEGMENT_CHUNK_SIZE),
      });
    }
    self.postMessage({ id, type: "complete" });
  } catch (error) {
    self.postMessage({
      id,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      },
    });
  }
});
