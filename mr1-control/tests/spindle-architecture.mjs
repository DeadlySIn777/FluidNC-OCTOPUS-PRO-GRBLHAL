import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  NOMINAL_SPINDLE_PER_MOTOR_RATIO,
  SPINDLE_ARCHITECTURE,
  controlPathLabel,
  nominalMotorTargetRpm,
} from "../src/spindle-architecture.js";

const pendingProfile = JSON.parse(readFileSync(
  new URL("../../grblHAL-STM32F4/mr1/servo-profile.pending.json", import.meta.url),
  "utf8",
));

test("control screen architecture matches the canonical pending servo profile", () => {
  assert.deepEqual(SPINDLE_ARCHITECTURE, pendingProfile.architecture);
  assert.equal(NOMINAL_SPINDLE_PER_MOTOR_RATIO, pendingProfile.mechanics.nominalSpindlePerMotorRatio);
  assert.equal(pendingProfile.architecture.browserCommandAuthority, false);
  assert.equal(pendingProfile.architecture.dualCommandAuthorityAllowed, false);
  assert.ok(Object.values(pendingProfile.permits).every((permit) => permit === false));
});

test("nominal motor target uses the MR-1 two-to-one overdrive without inventing out-of-range values", () => {
  assert.equal(nominalMotorTargetRpm(0), 0);
  assert.equal(nominalMotorTargetRpm(7200), 3600);
  assert.equal(nominalMotorTargetRpm(8000), 4000);
  assert.equal(nominalMotorTargetRpm(-1), null);
  assert.equal(nominalMotorTargetRpm(8001), null);
  assert.equal(nominalMotorTargetRpm("not-rpm"), null);
});

test("control path labels keep digital, analog, and unknown states explicit", () => {
  assert.equal(controlPathLabel("digital"), "DIGITAL / RS-485");
  assert.equal(controlPathLabel("analog"), "ANALOG / FWD");
  assert.equal(controlPathLabel("disabled"), "DISABLED");
  assert.equal(controlPathLabel("anything-else"), "--");
});
