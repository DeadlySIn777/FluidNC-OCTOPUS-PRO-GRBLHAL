import assert from "node:assert/strict";
import test from "node:test";
import { calculateLimitDistances, continuousJogDistance, movePreviewPosition } from "../src/jog-control.js";

test("calculates signed distance from machine position to both travel limits", () => {
  const distances = calculateLimitDistances(
    { x: -100, y: -200, z: -50 },
    {
      x: { min: -564.42, max: -2 },
      y: { min: -544.1, max: -2 },
      z: { min: -152.94, max: -2 },
    },
  );

  assert.equal(distances.x.negative.toFixed(3), "464.420");
  assert.equal(distances.x.positive, 98);
  assert.equal(distances.y.negative.toFixed(3), "344.100");
  assert.equal(distances.y.positive, 198);
  assert.equal(distances.z.negative.toFixed(3), "102.940");
  assert.equal(distances.z.positive, 48);
  assert.equal(Object.values(distances).every((axis) => axis.inside), true);
});

test("reports negative clearance when a position is outside the envelope", () => {
  const distances = calculateLimitDistances(
    { x: 0, y: -2, z: -160 },
    {
      x: { min: -10, max: -2 },
      y: { min: -10, max: -2 },
      z: { min: -10, max: -2 },
    },
  );

  assert.equal(distances.x.positive, -2);
  assert.equal(distances.x.inside, false);
  assert.equal(distances.y.positive, 0);
  assert.equal(distances.y.inside, true);
  assert.equal(distances.z.negative, -150);
  assert.equal(distances.z.inside, false);
});

test("rejects incomplete vectors instead of inventing travel clearance", () => {
  assert.equal(calculateLimitDistances({ x: 0, y: 0 }, {}), null);
  assert.equal(calculateLimitDistances(null, {}), null);
});

test("converts continuous jog speed and interval into preview distance", () => {
  assert.equal(continuousJogDistance(600, 100), 1);
  assert.equal(continuousJogDistance(0, 100), 0);
  assert.equal(continuousJogDistance(600, -1), 0);
});

test("moves one preview axis without mutating the original position", () => {
  const original = { x: 1, y: 2, z: 3 };
  assert.deepEqual(movePreviewPosition(original, "y", -1, 0.25), { x: 1, y: 1.75, z: 3 });
  assert.deepEqual(original, { x: 1, y: 2, z: 3 });
  assert.equal(movePreviewPosition(original, "a", 1, 1), null);
  assert.equal(movePreviewPosition(original, "x", 0, 1), null);
});
