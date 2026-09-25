import { MachineCommandError } from "../src/machine-command.js";
import { evaluateToolSetter, evaluateTouchProbe } from "../src/probing-profile.js";

const WCS_INDEX = Object.freeze({ G54: 1, G55: 2, G56: 3, G57: 4, G58: 5, G59: 6 });

function wait(milliseconds, signal = null) {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error("Virtual transaction aborted."), { code: "COMMAND_CANCELLED" }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(Object.assign(new Error("Virtual transaction aborted."), { code: "COMMAND_CANCELLED" }));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function vectorClose(left, right, tolerance = 0.0005) {
  return ["x", "y", "z"].every((axis) => (
    Number.isFinite(left?.[axis])
    && Number.isFinite(right?.[axis])
    && Math.abs(left[axis] - right[axis]) <= tolerance
  ));
}

function formatVector(vector) {
  return ["x", "y", "z"].map((axis) => Number(vector[axis]).toFixed(3)).join(",");
}

export class VirtualMr1Controller {
  constructor(options = {}) {
    this.phaseDelayMs = Math.max(1, Number(options.phaseDelayMs ?? 24));
    this.publishStatus = options.publishStatus ?? (() => {});
    this.publishControllerLine = options.publishControllerLine ?? (() => {});
    this.state = "Idle";
    this.machine = { x: -283.21, y: -273.05, z: -20 };
    this.workOffsets = new Map([
      ["G54", { x: -283.21, y: -273.05, z: -25 }],
      ["G55", { x: -190, y: -273.05, z: -25 }],
      ["G56", { x: -96.79, y: -273.05, z: -25 }],
      ["G57", { x: -236.605, y: -130, z: -25 }],
      ["G58", { x: -143.395, y: -130, z: -25 }],
      ["G59", { x: -283.21, y: -273.05, z: -145 }],
    ]);
    this.activeWcs = "G54";
    this.feed = 0;
    this.tool = 3;
    this.homed = true;
    this.probeTriggered = false;
    this.lastProbe = null;
    this.lastAcknowledgedCommand = null;
    this.activeSignal = null;
  }

  get wco() {
    return this.workOffsets.get(this.activeWcs);
  }

  statusLine() {
    const pins = this.probeTriggered ? "P" : "";
    return `<${this.state}|MPos:${formatVector(this.machine)}|Bf:35,255|FS:${this.feed.toFixed(1)},0,0|WCO:${formatVector(this.wco)}|Pn:${pins}|Ov:100,100,100|A:|WCS:${this.activeWcs}|T:${this.tool}|P:0|H:${this.homed ? "1" : "0"},7>`;
  }

  publish() {
    this.publishStatus(this.statusLine());
  }

  async phase(callback, state, phase, progress, detail) {
    callback(state, phase, progress, detail);
    await wait(this.phaseDelayMs, this.activeSignal);
  }

  async moveTo(target, options = {}) {
    const start = { ...this.machine };
    const steps = Math.max(1, Number(options.steps ?? 4));
    this.state = options.state ?? "Run";
    this.feed = Number(options.feed ?? 0);
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      for (const axis of ["x", "y", "z"]) {
        if (Number.isFinite(target[axis])) this.machine[axis] = start[axis] + (target[axis] - start[axis]) * ratio;
      }
      this.publish();
      await wait(this.phaseDelayMs, this.activeSignal);
    }
    this.feed = 0;
  }

  async executeApplyWorkOffset(intent, callbacks) {
    const command = `G10 L2 P${WCS_INDEX[intent.wcs]} X${intent.offset.x.toFixed(4)} Y${intent.offset.y.toFixed(4)} Z${intent.offset.z.toFixed(4)}`;
    await this.phase(callbacks.onPhase, "dispatching", "typed-wcs-command", 0.2, command);
    this.lastAcknowledgedCommand = command;
    callbacks.onPhase("acknowledged", "controller-ok", 0.45, "VIRTUAL CONTROLLER ACKNOWLEDGED G10");
    this.publishControllerLine("ok");
    this.workOffsets.set(intent.wcs, { ...intent.offset });
    this.activeWcs = intent.wcs;
    this.publish();
    await this.phase(callbacks.onPhase, "running", "wco-observation", 0.8, `${intent.wcs} WCO UPDATED`);
    return {
      intentType: intent.type,
      wcs: intent.wcs,
      fixtureId: intent.fixtureId,
      wco: { ...this.wco },
      controllerCommand: command,
      controllerAcknowledged: true,
    };
  }

  async executeJog(intent, callbacks) {
    const target = { ...this.machine };
    target[intent.axis] += intent.direction * intent.distance;
    const command = `$J=G91 ${intent.axis.toUpperCase()}${(intent.direction * intent.distance).toFixed(4)} F${intent.feed.toFixed(1)}`;
    await this.phase(callbacks.onPhase, "dispatching", "typed-jog-command", 0.18, command);
    this.lastAcknowledgedCommand = command;
    callbacks.onPhase("acknowledged", "controller-ok", 0.32, "VIRTUAL CONTROLLER ACKNOWLEDGED JOG");
    this.publishControllerLine("ok");
    callbacks.onPhase("running", "bounded-jog-motion", 0.5, `${intent.axis.toUpperCase()} TO ${target[intent.axis].toFixed(3)} MM`);
    await this.moveTo(target, { state: "Jog", feed: intent.feed, steps: 4 });
    this.state = "Idle";
    this.publish();
    callbacks.onPhase("running", "idle-observed", 0.9, "JOG COMPLETE / IDLE");
    return {
      intentType: intent.type,
      axis: intent.axis,
      machinePosition: { ...this.machine },
      controllerCommand: command,
      controllerAcknowledged: true,
    };
  }

  async executeToolSetter(intent, callbacks) {
    const settings = intent.settings;
    const envelope = evaluateToolSetter(settings, { activeTool: this.tool }).envelope;
    callbacks.onPhase("dispatching", "protected-cycle-plan", 0.14, "G53 TRAVEL / GUARDED Z / DOUBLE TOUCH / FAIL RETRACT");
    this.lastAcknowledgedCommand = "MR1:TYPED:TOOL_SETTER";
    this.publishControllerLine("ok");
    await this.phase(callbacks.onPhase, "acknowledged", "cycle-owned", 0.22, "VIRTUAL CONTROLLER OWNS PROTECTED CYCLE");

    callbacks.onPhase("running", "safe-z-travel", 0.3, `G53 Z${settings.travelZ.toFixed(3)}`);
    await this.moveTo({ z: settings.travelZ }, { feed: settings.retractFeed, state: "Run" });
    callbacks.onPhase("running", "setter-xy-travel", 0.4, `G53 X${settings.x.toFixed(3)} Y${settings.y.toFixed(3)}`);
    await this.moveTo({ x: settings.x, y: settings.y }, { feed: 600, state: "Run" });
    callbacks.onPhase("running", "guarded-approach", 0.52, `Z${envelope.approachZ.toFixed(3)} @ ${settings.guardedApproachFeed}`);
    await this.moveTo({ z: envelope.approachZ }, { feed: settings.guardedApproachFeed, state: "Run" });

    callbacks.onPhase("running", "first-contact-search", 0.64, `MAX ${settings.maxSearch.toFixed(3)} MM`);
    await this.moveTo({ z: envelope.expectedContactZ }, { feed: settings.seekFeed, state: "Run", steps: 3 });
    this.probeTriggered = true;
    this.lastProbe = { ...this.machine };
    this.publish();
    this.publishControllerLine(`[PRB:${formatVector(this.lastProbe)}:1]`);
    await wait(this.phaseDelayMs, this.activeSignal);
    this.probeTriggered = false;

    if (settings.doubleTouch) {
      const pullOffZ = envelope.expectedContactZ + settings.latchPullOff;
      callbacks.onPhase("running", "latch-pull-off", 0.72, `${settings.latchPullOff.toFixed(3)} MM`);
      await this.moveTo({ z: pullOffZ }, { feed: settings.retractFeed, state: "Run", steps: 2 });
      callbacks.onPhase("running", "precision-contact", 0.8, `${settings.latchFeed.toFixed(1)} MM/MIN`);
      await this.moveTo({ z: envelope.expectedContactZ }, { feed: settings.latchFeed, state: "Run", steps: 3 });
      this.probeTriggered = true;
      this.lastProbe = { ...this.machine };
      this.publish();
      this.publishControllerLine(`[PRB:${formatVector(this.lastProbe)}:1]`);
      await wait(this.phaseDelayMs, this.activeSignal);
      this.probeTriggered = false;
    }

    callbacks.onPhase("running", "mandatory-retract", 0.88, `G53 Z${envelope.retractZ.toFixed(3)}`);
    await this.moveTo({ z: envelope.retractZ }, { feed: settings.retractFeed, state: "Run", steps: 3 });
    const contactRetractedToZ = this.machine.z;
    callbacks.onPhase("running", "safe-z-return", 0.93, `G53 Z${settings.travelZ.toFixed(3)}`);
    await this.moveTo({ z: settings.travelZ }, { feed: settings.retractFeed, state: "Run", steps: 3 });
    this.state = "Idle";
    this.feed = 0;
    this.publish();
    return {
      intentType: intent.type,
      tool: this.tool,
      measuredContact: { ...this.lastProbe },
      expectedContactZ: envelope.expectedContactZ,
      errorMm: this.lastProbe.z - envelope.expectedContactZ,
      contactRetractedToZ,
      safeTravelZ: this.machine.z,
      doubleTouch: settings.doubleTouch,
      controllerCommand: "MR1:TYPED:TOOL_SETTER",
      controllerAcknowledged: true,
    };
  }

  async emitProbeHit() {
    this.probeTriggered = true;
    this.lastProbe = { ...this.machine };
    this.publish();
    this.publishControllerLine(`[PRB:${formatVector(this.lastProbe)}:1]`);
    await wait(this.phaseDelayMs, this.activeSignal);
    this.probeTriggered = false;
    this.publish();
    return { ...this.lastProbe };
  }

  async executeTouchContact(contact, settings, callbacks, index, count) {
    const span = 0.64 / count;
    const progress = (fraction) => 0.25 + span * (index + fraction);
    const phaseId = contact.id.replaceAll("_", "-");

    callbacks.onPhase("running", `${phaseId}-safe-z`, progress(0.08), `G53 Z${settings.safeZ.toFixed(3)}`);
    await this.moveTo({ z: settings.safeZ }, { feed: settings.retractFeed, state: "Run", steps: 3 });
    callbacks.onPhase(
      "running",
      `${phaseId}-xy-start`,
      progress(0.22),
      `G53 X${contact.start.x.toFixed(3)} Y${contact.start.y.toFixed(3)}`,
    );
    await this.moveTo({ x: contact.start.x, y: contact.start.y }, { feed: 600, state: "Run", steps: 3 });
    callbacks.onPhase(
      "running",
      `${phaseId}-guarded-depth`,
      progress(0.36),
      `G53 Z${contact.start.z.toFixed(3)} @ ${settings.guardedApproachFeed.toFixed(1)}`,
    );
    await this.moveTo({ z: contact.start.z }, {
      feed: settings.guardedApproachFeed,
      state: "Run",
      steps: 3,
    });

    callbacks.onPhase(
      "running",
      `${phaseId}-search`,
      progress(0.52),
      `${contact.directionLabel} / LIMIT ${contact.searchLimit[contact.axis].toFixed(3)} / ${settings.seekFeed.toFixed(1)} MM/MIN`,
    );
    await this.moveTo(contact.expectedCenter, { feed: settings.seekFeed, state: "Run", steps: 3 });
    let rawCenter = await this.emitProbeHit();

    if (settings.doubleTouch) {
      const pullOff = {
        ...contact.expectedCenter,
        [contact.axis]: contact.expectedCenter[contact.axis] - contact.direction * settings.latchPullOff,
      };
      callbacks.onPhase(
        "running",
        `${phaseId}-latch-pull-off`,
        progress(0.65),
        `${settings.latchPullOff.toFixed(3)} MM OPPOSITE ${contact.directionLabel}`,
      );
      await this.moveTo(pullOff, { feed: settings.retractFeed, state: "Run", steps: 2 });
      callbacks.onPhase(
        "running",
        `${phaseId}-precision-contact`,
        progress(0.76),
        `${contact.directionLabel} @ ${settings.latchFeed.toFixed(1)} MM/MIN`,
      );
      await this.moveTo(contact.expectedCenter, { feed: settings.latchFeed, state: "Run", steps: 3 });
      rawCenter = await this.emitProbeHit();
    }

    callbacks.onPhase(
      "running",
      `${phaseId}-mandatory-retract`,
      progress(0.88),
      `${contact.axis.toUpperCase()}${contact.retract[contact.axis].toFixed(3)} / FAIL RETRACT`,
    );
    await this.moveTo(contact.retract, { feed: settings.retractFeed, state: "Run", steps: 3 });
    const retractedTo = { ...this.machine };
    callbacks.onPhase("running", `${phaseId}-clearance-return`, progress(0.98), `G53 Z${settings.safeZ.toFixed(3)}`);
    await this.moveTo({ z: settings.safeZ }, { feed: settings.retractFeed, state: "Run", steps: 3 });

    const correctedSurfaceCoordinate = rawCenter[contact.axis]
      + contact.direction * settings.tipDiameter / 2;
    return {
      id: contact.id,
      label: contact.label,
      axis: contact.axis,
      direction: contact.direction,
      directionLabel: contact.directionLabel,
      rawCenter,
      correctedSurfaceCoordinate,
      expectedSurfaceCoordinate: contact.surfaceCoordinate,
      errorMm: correctedSurfaceCoordinate - contact.surfaceCoordinate,
      retractedTo,
      safeZObserved: this.machine.z,
    };
  }

  touchFeatureResult(settings, measurements) {
    if (settings.cycle === "outside-corner") {
      const x = measurements.find(({ axis }) => axis === "x");
      const y = measurements.find(({ axis }) => axis === "y");
      return {
        type: "outside-corner",
        x: x.correctedSurfaceCoordinate,
        y: y.correctedSurfaceCoordinate,
        expectedX: settings.targetX,
        expectedY: settings.targetY,
      };
    }
    if (settings.cycle === "bore-center") {
      const byId = Object.fromEntries(measurements.map((measurement) => [measurement.id, measurement]));
      const xPlus = byId["bore-x-plus"].rawCenter.x;
      const xMinus = byId["bore-x-minus"].rawCenter.x;
      const yPlus = byId["bore-y-plus"].rawCenter.y;
      const yMinus = byId["bore-y-minus"].rawCenter.y;
      const diameterX = xPlus - xMinus + settings.tipDiameter;
      const diameterY = yPlus - yMinus + settings.tipDiameter;
      return {
        type: "bore",
        centerX: (xPlus + xMinus) / 2,
        centerY: (yPlus + yMinus) / 2,
        diameterX,
        diameterY,
        diameter: (diameterX + diameterY) / 2,
        expectedCenterX: settings.targetX,
        expectedCenterY: settings.targetY,
        expectedDiameter: settings.featureDiameter,
      };
    }
    const measurement = measurements[0];
    return {
      type: "surface",
      axis: measurement.axis,
      coordinate: measurement.correctedSurfaceCoordinate,
      expectedCoordinate: measurement.expectedSurfaceCoordinate,
    };
  }

  async executeTouchProbe(intent, callbacks) {
    const settings = intent.settings;
    const evaluation = evaluateTouchProbe(settings);
    if (!evaluation.ready || !evaluation.plan) {
      throw new MachineCommandError("Protected touch-probe plan is not ready.", {
        code: "TOUCH_PROBE_PLAN_NOT_READY",
      });
    }
    callbacks.onPhase(
      "dispatching",
      "protected-probe-plan",
      0.14,
      `${evaluation.plan.contactCount} CONTACTS / ${evaluation.plan.reportedTouchCount} TOUCHES / CLEARANCE RETURN EACH FACE`,
    );
    this.lastAcknowledgedCommand = `MR1:TYPED:TOUCH_PROBE:${settings.cycle}`;
    this.publishControllerLine("ok");
    await this.phase(callbacks.onPhase, "acknowledged", "probe-cycle-owned", 0.22, "VIRTUAL CONTROLLER OWNS PROTECTED PROBE CYCLE");

    const measurements = [];
    for (let index = 0; index < evaluation.plan.contacts.length; index += 1) {
      measurements.push(await this.executeTouchContact(
        evaluation.plan.contacts[index],
        settings,
        callbacks,
        index,
        evaluation.plan.contacts.length,
      ));
    }
    this.state = "Idle";
    this.feed = 0;
    this.probeTriggered = false;
    this.publish();
    return {
      intentType: intent.type,
      cycle: settings.cycle,
      measurements,
      feature: this.touchFeatureResult(settings, measurements),
      finalMachinePosition: { ...this.machine },
      safeTravelZ: settings.safeZ,
      doubleTouch: settings.doubleTouch,
      controllerCommand: this.lastAcknowledgedCommand,
      controllerAcknowledged: true,
    };
  }

  async execute(intent, callbacks) {
    if (this.state !== "Idle") {
      throw new MachineCommandError(`Virtual controller changed to ${this.state}.`, {
        code: "VIRTUAL_CONTROLLER_NOT_IDLE",
      });
    }
    this.activeSignal = callbacks.signal ?? null;
    try {
      if (intent.type === "apply-work-offset") return await this.executeApplyWorkOffset(intent, callbacks);
      if (intent.type === "jog") return await this.executeJog(intent, callbacks);
      if (intent.type === "tool-setter") return await this.executeToolSetter(intent, callbacks);
      if (intent.type === "touch-probe") return await this.executeTouchProbe(intent, callbacks);
      throw new MachineCommandError("Virtual controller does not implement this typed intent.", {
        code: "VIRTUAL_INTENT_UNSUPPORTED",
      });
    } finally {
      if (this.activeSignal?.aborted) {
        this.feed = 0;
        this.probeTriggered = false;
        this.state = "Hold";
        this.publish();
      }
      this.activeSignal = null;
    }
  }

  async verify(intent, result) {
    if (this.state !== "Idle") {
      throw new MachineCommandError("Controller did not return to Idle.", { code: "IDLE_NOT_OBSERVED" });
    }
    if (intent.type === "apply-work-offset") {
      if (this.activeWcs !== intent.wcs || !vectorClose(this.wco, intent.offset)) {
        throw new MachineCommandError("Applied work offset was not observed in controller state.", {
          code: "WCO_NOT_OBSERVED",
        });
      }
    }
    if (intent.type === "jog" && !vectorClose(this.machine, result.machinePosition)) {
      throw new MachineCommandError("Final jog machine position was not observed.", {
        code: "JOG_POSITION_NOT_OBSERVED",
      });
    }
    if (intent.type === "tool-setter") {
      const contactRetractObserved = Number.isFinite(result.contactRetractedToZ)
        && result.contactRetractedToZ >= result.measuredContact?.z;
      const safeTravelObserved = Math.abs(this.machine.z - result.safeTravelZ) <= 0.001;
      if (!result.measuredContact || Math.abs(result.errorMm) > 0.001 || !contactRetractObserved || !safeTravelObserved) {
        throw new MachineCommandError("Tool-setter contact, contact retract, and safe-Z return were not all observed.", {
          code: "TOOL_SETTER_RESULT_NOT_OBSERVED",
        });
      }
    }
    if (intent.type === "touch-probe") {
      const evaluation = evaluateTouchProbe(intent.settings);
      const expectedContacts = evaluation.plan?.contacts ?? [];
      const measurementCountMatches = result.measurements?.length === expectedContacts.length;
      const measurementsObserved = measurementCountMatches && result.measurements.every((measurement, index) => (
        measurement.id === expectedContacts[index].id
        && Math.abs(measurement.errorMm) <= 0.001
        && vectorClose(measurement.retractedTo, expectedContacts[index].retract, 0.001)
        && Math.abs(measurement.safeZObserved - intent.settings.safeZ) <= 0.001
      ));
      const safeReturnObserved = Math.abs(this.machine.z - intent.settings.safeZ) <= 0.001;
      if (!measurementsObserved || !safeReturnObserved || this.probeTriggered) {
        throw new MachineCommandError("Probe contacts, mandatory retracts, and clearance returns were not all observed.", {
          code: "TOUCH_PROBE_RESULT_NOT_OBSERVED",
        });
      }
    }
    return true;
  }
}
