import {
  CONVERSATIONAL_CYCLES,
  CycleParameterError,
  contractForCycle,
  defaultCycleParams,
  estimateProgramSeconds,
  generateConversationalProgram,
  getConversationalCycle,
} from "./conversational-cam.js";
import { validateMr1Nc } from "./nc-safety-validator.js";

// Self-contained conversational CAM panel. It owns its DOM (reusing the
// probing-panel styling) and hands validated programs back to the host via
// the loadProgram callback; it never talks to machine command paths itself.

const PARAM_STORE_PREFIX = "mr1.conversational.params.";

function loadStoredParams(cycle) {
  try {
    const raw = localStorage.getItem(PARAM_STORE_PREFIX + cycle.id);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    // Sanitize against a poisoned or stale store: every restored value must
    // be a finite number clamped to the spec range, or a listed option.
    const sanitized = {};
    for (const spec of cycle.params) {
      const value = parsed[spec.key];
      if (spec.options) {
        if (spec.options.includes(value)) sanitized[spec.key] = value;
      } else {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
          sanitized[spec.key] = Math.min(spec.max, Math.max(spec.min, numeric));
        }
      }
    }
    return sanitized;
  } catch {
    return null;
  }
}

function storeParams(cycleId, params) {
  try {
    localStorage.setItem(PARAM_STORE_PREFIX + cycleId, JSON.stringify(params));
  } catch {
    // Storage may be unavailable; persistence is best-effort only.
  }
}

function formatSeconds(totalSeconds) {
  const rounded = Math.max(1, Math.round(totalSeconds));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function element(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

export function initConversationalCamPanel({ openButton, loadProgram, onOpen = null }) {
  const state = {
    cycleId: CONVERSATIONAL_CYCLES[0].id,
    generated: null,
  };

  const panel = element("aside", {
    id: "conversational-panel",
    class: "probing-panel",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Conversational CAM",
    "aria-hidden": "true",
    tabindex: "-1",
  });
  panel.inert = true;
  let restoreFocusTo = null;

  const closeButton = element("button", {
    class: "panel-icon-button",
    type: "button",
    "aria-label": "Close conversational CAM",
    "data-tooltip": "Close",
    text: "✕",
  });
  panel.append(
    element("header", { class: "probing-panel-header" }, [
      element("div", {}, [
        element("span", { class: "panel-kicker", text: "CAM FUNCTIONS" }),
        element("h2", { text: "CONVERSATIONAL" }),
      ]),
      closeButton,
    ]),
  );

  const cycleSelect = element("select", { id: "conversational-cycle", "aria-label": "Conversational cycle" });
  const groups = new Map();
  for (const cycle of CONVERSATIONAL_CYCLES) {
    if (!groups.has(cycle.group)) {
      const optgroup = element("optgroup", { label: cycle.group });
      groups.set(cycle.group, optgroup);
      cycleSelect.append(optgroup);
    }
    groups.get(cycle.group).append(element("option", { value: cycle.id, text: cycle.title }));
  }
  panel.append(element("div", { class: "conversational-cycle-row" }, [cycleSelect]));

  const scroll = element("div", { class: "probing-panel-scroll" });
  const gateState = element("output", { id: "conversational-gate-state", "data-state": "alarm", text: "NOT RUN" });
  const groupState = element("output", { id: "conversational-group-state", text: CONVERSATIONAL_CYCLES[0].group.toUpperCase() });
  const timeState = element("output", { id: "conversational-time-state", text: "--" });
  const statusGrid = element("div", { class: "probe-status-grid" }, [
    element("div", {}, [element("span", { text: "GROUP" }), groupState]),
    element("div", {}, [element("span", { text: "EST TIME" }), timeState]),
    element("div", {}, [element("span", { text: "SAFETY GATE" }), gateState]),
  ]);
  scroll.append(statusGrid);
  const description = element("p", { id: "conversational-description", class: "conversational-description" });
  const form = element("form", { id: "conversational-form", class: "probe-settings-form", novalidate: "" });
  const fields = element("fieldset", { class: "setting-section" }, [
    element("legend", { text: "CYCLE PARAMETERS" }),
  ]);
  const fieldGrid = element("div", { class: "number-settings" });
  fields.append(fieldGrid);
  form.append(fields);

  const generateButton = element("button", {
    class: "panel-run-button",
    type: "submit",
    text: "GENERATE + VALIDATE",
  });
  const status = element("output", { id: "conversational-status", class: "conversational-status", "aria-live": "polite" });

  const preview = element("textarea", {
    id: "conversational-preview",
    class: "conversational-preview",
    readonly: "",
    rows: "12",
    "aria-label": "Generated NC program",
    spellcheck: "false",
  });
  preview.hidden = true;

  const loadButton = element("button", { class: "panel-run-button", type: "button", text: "LOAD INTO PREVIEW" });
  const downloadButton = element("button", { class: "panel-save-button", type: "button", text: "DOWNLOAD .NC" });
  loadButton.hidden = true;
  downloadButton.hidden = true;

  const actions = element("div", { class: "panel-actions" }, [generateButton]);
  const resultActions = element("div", { class: "panel-actions" }, [loadButton, downloadButton]);
  form.append(actions, status, preview, resultActions);
  scroll.append(description, form);
  panel.append(scroll);
  document.body.append(panel);

  function setStatus(message, tone = "") {
    status.textContent = message;
    if (tone) status.setAttribute("data-state", tone);
    else status.removeAttribute("data-state");
  }

  function setGate(label, tone) {
    gateState.textContent = label;
    gateState.setAttribute("data-state", tone);
  }

  function renderCycle() {
    const cycle = getConversationalCycle(state.cycleId);
    description.textContent = cycle.description;
    fieldGrid.replaceChildren();
    const defaults = { ...defaultCycleParams(cycle), ...(loadStoredParams(cycle) ?? {}) };
    for (const spec of cycle.params) {
      let input;
      if (spec.options) {
        input = element("select", { "data-param": spec.key, "aria-label": spec.label });
        for (const option of spec.options) input.append(element("option", { value: option, text: option }));
        input.value = String(defaults[spec.key]);
      } else {
        input = element("input", {
          type: "number",
          inputmode: "decimal",
          "data-param": spec.key,
          min: String(spec.min),
          max: String(spec.max),
          step: String(spec.step),
          value: String(defaults[spec.key]),
          "aria-label": spec.label,
        });
      }
      const wrapper = element("label", {}, [
        element("span", { text: spec.label.toUpperCase() }),
        element("span", { class: "input-with-unit" }, [input, element("small", { text: spec.unit })]),
      ]);
      fieldGrid.append(wrapper);
    }
    state.generated = null;
    preview.hidden = true;
    loadButton.hidden = true;
    downloadButton.hidden = true;
    setStatus("");
    groupState.textContent = cycle.group.toUpperCase();
    timeState.textContent = "--";
    setGate("NOT RUN", "alarm");
  }

  function collectParams() {
    const params = {};
    for (const input of fieldGrid.querySelectorAll("[data-param]")) {
      params[input.dataset.param] = input.tagName === "SELECT" ? input.value : Number(input.value);
    }
    return params;
  }

  function generate() {
    const cycle = getConversationalCycle(state.cycleId);
    const params = collectParams();
    let result;
    try {
      result = generateConversationalProgram(cycle.id, params);
    } catch (error) {
      const reason = error instanceof CycleParameterError ? error.message : "The cycle could not be generated.";
      setStatus(`REJECTED\n${reason}`, "error");
      setGate("REJECTED", "alarm");
      timeState.textContent = "--";
      state.generated = null;
      preview.hidden = true;
      loadButton.hidden = true;
      downloadButton.hidden = true;
      status.scrollIntoView({ block: "nearest" });
      return;
    }
    // Lathe cycles are gated by the lathe contract (G18, no Y axis, its own
    // ceilings); mill cycles keep the MR-1 contract.
    const verdict = validateMr1Nc(result.gcode, { name: result.name, contract: contractForCycle(cycle) });
    if (!verdict.ok) {
      // Fail closed: a generator bug must never hand out an unsafe program.
      const first = verdict.blockers[0];
      setStatus(`SAFETY GATE BLOCKED\n${first.code} at line ${first.line}: ${first.message}`, "error");
      setGate("BLOCKED", "alarm");
      timeState.textContent = "--";
      state.generated = null;
      preview.hidden = true;
      loadButton.hidden = true;
      downloadButton.hidden = true;
      status.scrollIntoView({ block: "nearest" });
      return;
    }
    state.generated = result;
    storeParams(cycle.id, params);
    preview.value = result.gcode;
    preview.hidden = false;
    loadButton.hidden = false;
    downloadButton.hidden = false;
    const lines = result.gcode.split("\n").length;
    const estimate = formatSeconds(estimateProgramSeconds(result.gcode));
    setGate("PASS", "active");
    timeState.textContent = `~${estimate}`;
    setStatus(
      `VALIDATED - 0 BLOCKERS\n${result.name} · ${lines} lines · ~${estimate} · max ${verdict.summary.maximumFeedMmPerMinute} mm/min · S${verdict.summary.maximumSpindleRpm}`,
      "ok",
    );
    // The result lands below the fold on smaller panels; bring it into view.
    resultActions.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function setOpen(open, restoreFocus = true) {
    panel.classList.toggle("open", open);
    panel.inert = !open;
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    openButton.setAttribute("aria-pressed", open ? "true" : "false");
    if (open) {
      onOpen?.();
      scroll.scrollTop = 0;
      restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : openButton;
      panel.focus();
    } else if (restoreFocus) {
      (restoreFocusTo ?? openButton).focus?.();
      restoreFocusTo = null;
    }
  }

  cycleSelect.addEventListener("change", () => {
    state.cycleId = cycleSelect.value;
    renderCycle();
  });
  // Any parameter edit invalidates the generated program so a stale one can
  // never be loaded or downloaded.
  fieldGrid.addEventListener("input", () => {
    if (!state.generated) return;
    state.generated = null;
    preview.hidden = true;
    loadButton.hidden = true;
    downloadButton.hidden = true;
    setStatus("Parameters changed - generate again to validate.");
    setGate("NOT RUN", "alarm");
    timeState.textContent = "--";
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    generate();
  });
  loadButton.addEventListener("click", async () => {
    if (!state.generated) return;
    loadButton.disabled = true;
    try {
      const accepted = await loadProgram(state.generated.gcode, state.generated.name);
      if (accepted === false) {
        setStatus("ANOTHER IMPORT IS IN PROGRESS\nWait for it to finish or cancel it, then load again.", "error");
        return;
      }
      setOpen(false);
    } finally {
      loadButton.disabled = false;
    }
  });
  downloadButton.addEventListener("click", () => {
    if (!state.generated) return;
    const blob = new Blob([state.generated.gcode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = element("a", { href: url, download: state.generated.name });
    anchor.click();
    // Revoking synchronously can cancel the save in some engines; give the
    // download a generous window before releasing the object URL.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
  openButton.addEventListener("click", () => setOpen(panel.getAttribute("aria-hidden") === "true"));
  closeButton.addEventListener("click", () => setOpen(false));
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
  // Panel exclusivity: opening any other right-side panel closes this one.
  document.addEventListener("click", (event) => {
    if (panel.getAttribute("aria-hidden") === "true") return;
    const other = event.target instanceof Element ? event.target.closest('button[id^="open-"]') : null;
    if (other && other !== openButton) setOpen(false, false);
  }, true);

  renderCycle();
  return { setOpen, panel };
}
