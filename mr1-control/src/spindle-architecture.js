export const SPINDLE_ARCHITECTURE = Object.freeze({
  decision: "digital-first-with-analog-fallback",
  targetCommandPath: "isolated-rs485-modbus-rtu",
  commissioningBaselinePath: "isolated-0-5v-analog-forward-only",
  targetCommandOwner: "grblhal-custom-servo-plugin",
  currentCommandOwner: "grblhal-pwm-spindle",
  browserCommandAuthority: false,
  hardwiredSafetyAuthority: true,
  dualCommandAuthorityAllowed: false,
});

export const NOMINAL_SPINDLE_PER_MOTOR_RATIO = 2;
export const SPINDLE_RPM_RANGE = Object.freeze({ minimum: 0, maximum: 8000 });

const CONTROL_PATH_LABELS = Object.freeze({
  analog: "ANALOG / FWD",
  digital: "DIGITAL / RS-485",
  disabled: "DISABLED",
  unknown: "UNKNOWN",
});

export function nominalMotorTargetRpm(spindleRpm) {
  const rpm = Number(spindleRpm);
  if (!Number.isFinite(rpm) || rpm < SPINDLE_RPM_RANGE.minimum || rpm > SPINDLE_RPM_RANGE.maximum) {
    return null;
  }
  return rpm / NOMINAL_SPINDLE_PER_MOTOR_RATIO;
}

export function controlPathLabel(path) {
  return CONTROL_PATH_LABELS[path] ?? "--";
}
