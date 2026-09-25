import { mountNativeControlPanel } from './native-control-panel.js';
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BadgeCheck,
  Box,
  Cable,
  Camera,
  Check,
  ChevronsDown,
  ChevronsUp,
  Circle,
  CircleSlash2,
  Crosshair,
  Download,
  FolderOpen,
  Gauge,
  Grid3x3,
  HeartPulse,
  House,
  Link,
  LockKeyhole,
  Maximize2,
  Move3d,
  PanelLeft,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Route,
  Save,
  Scan,
  Search,
  Settings2,
  Shapes,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Trash2,
  Upload,
  Zap,
  X,
  createIcons,
} from "lucide";
import "./styles.css";
import { createDemoJob, sampleJob } from "./demo-job.js";
import {
  evaluateCutterCompensation,
  jobToolNumbers,
  loadCutterCompensationProfile,
  normalizeCutterTool,
  removeCutterTool,
  saveCutterCompensationProfile,
  upsertCutterTool,
} from "./cutter-compensation.js";
import {
  addMetrologyPoint,
  analyzeMetrology,
  clearMetrologyPoints,
  createManualMetrologyPoint,
  createProbeMetrologyPoint,
  exportMetrologyCsv,
  exportMetrologyJson,
  exportMetrologyPly,
  exportMetrologyXyz,
  loadMetrologySession,
  normalizeMetrologySession,
  recompensateMetrologyPoints,
  removeLastMetrologyPoint,
  saveMetrologySession,
} from "./metrology-session.js";
import {
  evaluateProbeCalibration,
  loadProbeCalibration,
  normalizeProbeCalibration,
  saveProbeCalibration,
} from "./probe-calibration.js";
import {
  WCS_FIXTURE_ASSIGNMENTS,
  VISE_DATUM_PRESETS,
  applyFixtureMapToJob,
  addressableCellCount,
  addressToCad,
  cadPointToAddress,
  calculateFixtureWorkOffset,
  columnLabel,
  evaluateFixtureMapProfile,
  fixtureLayout,
  viseFootprintForOpening,
  gridCellToCad,
  loadFixtureMapProfile,
  normalizeFixtureMapProfile,
  parseHoleAddress,
  saveFixtureMapProfile,
} from "./fixture-map-profile.js";
import {
  SCENE_FEATURE_TYPES,
  addSceneHypothesis,
  addSceneReference,
  bindSceneRegistrationFrame,
  buildGuidedProbePlan,
  clearSceneReferences,
  evaluateSceneRegistrationProfile,
  importSceneDetections,
  loadSceneRegistrationProfile,
  normalizeSceneRegistrationProfile,
  pixelToRegisteredPoint,
  projectHomography,
  registrationFootprint,
  removeSceneHypothesis,
  removeSceneReference,
  saveSceneRegistrationProfile,
  visibleFixtureReferences,
} from "./scene-registration.js";
import {
  DEFAULT_TABLE_FRAME_CALIBRATION,
  addTableFrameReference,
  clearTableFrameReferences,
  evaluateTableFrameCalibration,
  finalizeTableFrameCalibration,
  normalizeTableFrameCalibration,
  removeTableFrameReference,
  tableCalibrationFrameMatches,
} from "./table-frame-calibration.js";
import {
  evaluateFissionImportProfile,
  hasFusionPersonalNotice,
  loadFissionImportProfile,
  requestFissionOptimization,
  saveFissionImportProfile,
  verifyFissionPreview,
} from "./fission-import.js";
import { parseGcodeProgramAsync } from "./gcode-parser-client.js";
import { calculateLimitDistances, continuousJogDistance, movePreviewPosition } from "./jog-control.js";
import { MachineCommandClient, MachineCommandRequestError } from "./machine-command-client.js";
import { evaluateMachineCommand, transactionIsTerminal } from "./machine-command.js";
import { ConfigurationJournalClient } from "./configuration-journal-client.js";
import {
  captureCompanionToken,
  companionMode,
  serviceEndpoint,
  serviceOrigin,
} from "./service-endpoints.js";
import { initializePwa } from "./pwa.js";
import { initConversationalCamPanel } from "./conversational-cam-panel.js";
import {
  MACHINE_CONFIGURATION_SECTIONS,
  applyMachineBundle,
  createMachineBundle,
  diffMachineConfigurations,
  parseMachineBundle,
} from "./machine-bundle.js";
import {
  loadMachineIdentity,
  saveMachineIdentity,
} from "./machine-identity.js";
import {
  analyzeInputCalibration,
  createPreviewInputCalibration,
} from "./input-calibration.js";
import { coolantAccessoryMode, MR1_CONFIG } from "./machine-config.js";
import {
  SPINDLE_ARCHITECTURE,
  controlPathLabel,
  nominalMotorTargetRpm,
} from "./spindle-architecture.js";
import {
  RIGID_TAPPING_AUDIT,
} from "./rigid-tapping.js";
import {
  PENDING_SERVO_AXIS_TAPPING_EVIDENCE,
  SERVO_AXIS_TAPPING_PROFILE,
  calculateServoAxisTapPlan,
  evaluateServoAxisTappingReadiness,
} from "./servo-axis-tapping.js";
import {
  evaluateToolSetter,
  evaluateTouchProbe,
  loadProbingProfile,
  saveProbingProfile,
} from "./probing-profile.js";
import {
  DEFAULT_SENSOR_WIRING_PROFILE,
  WIRE_COLORS,
  evaluateSensorWiringProfile,
  loadSensorWiringProfile,
  saveSensorWiringProfile,
  sensorDestination,
} from "./sensor-wiring-profile.js";
import {
  FIRMWARE_FLASH_ATTESTATIONS,
  createFirmwareFlashRecord,
  evaluateFirmwareFlashEvidence,
  verifyFirmwareCandidateFile,
} from "./firmware-verification.js";
import {
  OCTOPUS_FIRMWARE_CANDIDATE,
  WIRING_AUDIT,
  WIRING_EVIDENCE_GATES,
  WIRING_INSTALL_STEPS,
  WIRING_PIGTAIL_SCHEDULE,
  evaluateWiringEvidence,
  loadWiringEvidence,
  saveWiringEvidence,
} from "./wiring-installation.js";
import {
  COMMISSIONING_CHECKS,
  COMMISSIONING_STAGES,
  createCommissioningBundle,
  createCommissioningEvidence,
  evaluateCommissioningRecord,
  normalizeCommissioningRecord,
  parseCommissioningBundle,
  removeCommissioningEvidence,
  upsertCommissioningEvidence,
} from "./commissioning-record.js";
import { sha256BytesHex, sha256TextHex } from "./browser-crypto.js";
import { TelemetryClient } from "./telemetry/client.js";
import {
  LatencyMonitor,
  createLatencyEvidence,
  evaluateLatencySnapshot,
  requestLatencySample,
} from "./latency-monitor.js";
import { SpindleFaultRecorder } from "./telemetry/spindle-fault-recorder.js";
import {
  SensorSession,
  calculateVibrationOrder,
  evaluateSensorHealth,
} from "./sensor-session.js";
import {
  sensorSourceIsSimulation,
  sensorSpindleRpm,
} from "./sensor-source.js";
import {
  CONTROLLER_SETTINGS_PLAN_PROTOCOL,
  createControllerSettingsPlan,
  createControllerSettingsSnapshot,
  evaluateControllerSettingsPlan,
  normalizeControllerSettingsReport,
} from "./controller-settings.js";

const MAX_GCODE_BYTES = 25 * 1024 * 1024;
const MAX_EVENT_JOURNAL_BYTES = 24 * 1024 * 1024;
const GCODE_EXTENSION = /\.(?:nc|ngc|gcode|tap|cnc|txt)$/i;
const CONTINUOUS_JOG_INTERVAL_MS = 80;
const COMPANION_TOKEN = captureCompanionToken();
const pairedServiceEndpoint = (path) => serviceEndpoint(path, { token: COMPANION_TOKEN });
const COMPANION_MODE = companionMode();
const NATIVE_MODE = new URLSearchParams(location.search).get('native') === '1';
let nativeControl = null;
let nativeState = null;
const SERVICE_ORIGIN = serviceOrigin();
const FISSION_HEALTH_ENDPOINT = pairedServiceEndpoint("/health");
const FISSION_OPTIMIZE_ENDPOINT = pairedServiceEndpoint("/optimize/fission");
const SENSOR_CALIBRATION_ENDPOINT = pairedServiceEndpoint("/sensor/calibration");
const CONTROLLER_PREFLIGHT_ENDPOINT = pairedServiceEndpoint("/controller/preflight");
const CONTROLLER_SETTINGS_APPLY_ENDPOINT = pairedServiceEndpoint("/controller/settings/apply");
const JOURNAL_RECONCILIATION_ENDPOINT = pairedServiceEndpoint("/journal/reconciliation/acknowledge");
const CONFIGURATION_JOURNAL_ENDPOINT = pairedServiceEndpoint("/journal/configuration");
const LATENCY_ENDPOINT = pairedServiceEndpoint("/latency/ping");
const JOURNAL_RECONCILIATION_ACK_PROTOCOL = "mr1-journal-reconciliation-ack-v1";
const configurationJournalClient = new ConfigurationJournalClient({
  storage: localStorage,
  endpoint: CONFIGURATION_JOURNAL_ENDPOINT,
  autoFlush: false,
});
const configurationStorage = configurationJournalClient.storage;

document.documentElement.dataset.companion = COMPANION_MODE ? "true" : "false";
if (COMPANION_MODE) {
  document.title = "MR-1 Companion";
  const subtitle = document.querySelector(".brand-subtitle");
  if (subtitle) subtitle.textContent = "COMPANION";
}

createIcons({
  icons: {
    Activity,
    ArrowDown,
    ArrowDownToLine,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    BadgeCheck,
    Box,
    Cable,
    Camera,
    Check,
    ChevronsDown,
    ChevronsUp,
    Circle,
    CircleSlash2,
    Crosshair,
    Download,
    FolderOpen,
    Gauge,
    Grid3x3,
    HeartPulse,
    House,
    Link,
    LockKeyhole,
    Maximize2,
    Move3d,
    PanelLeft,
    Pause,
    Pencil,
    Play,
    Plus,
    Radio,
    RotateCcw,
    Route,
    Save,
    Scan,
    Search,
    Settings2,
    Shapes,
    ShieldCheck,
    SlidersHorizontal,
    Square,
    Trash2,
    Upload,
    Zap,
    X,
  },
});

const elements = {
  app: document.getElementById("app"),
  viewer: document.getElementById("viewer"),
  machineState: document.getElementById("machine-state"),
  clock: document.getElementById("clock"),
  coordinateMode: document.getElementById("coordinate-mode"),
  droX: document.getElementById("dro-x"),
  droY: document.getElementById("dro-y"),
  droZ: document.getElementById("dro-z"),
  spindleRpm: document.getElementById("spindle-rpm"),
  feedRate: document.getElementById("feed-rate"),
  toolNumber: document.getElementById("tool-number"),
  toolDescription: document.getElementById("tool-description"),
  chatterValue: document.getElementById("chatter-value"),
  tempLabel: document.getElementById("temp-label"),
  tempValue: document.getElementById("temp-value"),
  probeState: document.getElementById("probe-state"),
  safetyState: document.getElementById("safety-state"),
  driveState: document.getElementById("drive-state"),
  viewLabel: document.getElementById("view-label"),
  rendererStatus: document.getElementById("renderer-status"),
  jobName: document.getElementById("job-name"),
  jobStatus: document.getElementById("job-status"),
  lineStatus: document.getElementById("line-status"),
  timeStatus: document.getElementById("time-status"),
  progress: document.getElementById("job-progress"),
  progressPercent: document.getElementById("progress-percent"),
  restart: document.getElementById("restart-preview"),
  feedHold: document.getElementById("feed-hold"),
  programStop: document.getElementById("program-stop"),
  cycleStart: document.getElementById("cycle-start"),
  followTool: document.getElementById("follow-tool"),
  openGcode: document.getElementById("open-gcode"),
  gcodeFile: document.getElementById("gcode-file"),
  cancelGcodeLoad: document.getElementById("cancel-gcode-load"),
  gcodeLoadProgress: document.getElementById("gcode-load-progress"),
  telemetryConnect: document.getElementById("telemetry-connect"),
  installCompanion: document.getElementById("install-companion"),
  telemetrySource: document.getElementById("telemetry-source"),
  openHealth: document.getElementById("open-health"),
  closeHealth: document.getElementById("close-health"),
  healthScrim: document.getElementById("health-scrim"),
  healthPanel: document.getElementById("health-panel"),
  openCommissioning: document.getElementById("open-commissioning"),
  closeCommissioning: document.getElementById("close-commissioning"),
  commissioningScrim: document.getElementById("commissioning-scrim"),
  commissioningPanel: document.getElementById("commissioning-panel"),
  permitStatus: document.getElementById("permit-status"),
  permitLabel: document.getElementById("permit-label"),
  openJog: document.getElementById("open-jog"),
  closeJog: document.getElementById("close-jog"),
  jogScrim: document.getElementById("jog-scrim"),
  jogPanel: document.getElementById("jog-panel"),
  openFixtureMap: document.getElementById("open-fixture-map"),
  closeFixtureMap: document.getElementById("close-fixture-map"),
  fixtureMapScrim: document.getElementById("fixture-map-scrim"),
  fixtureMapPanel: document.getElementById("fixture-map-panel"),
  openSceneRegistration: document.getElementById("open-scene-registration"),
  closeSceneRegistration: document.getElementById("close-scene-registration"),
  sceneRegistrationScrim: document.getElementById("scene-registration-scrim"),
  sceneRegistrationPanel: document.getElementById("scene-registration-panel"),
  openCutterComp: document.getElementById("open-cutter-comp"),
  closeCutterComp: document.getElementById("close-cutter-comp"),
  cutterCompScrim: document.getElementById("cutter-comp-scrim"),
  cutterCompPanel: document.getElementById("cutter-comp-panel"),
  openMetrology: document.getElementById("open-metrology"),
  closeMetrology: document.getElementById("close-metrology"),
  metrologyScrim: document.getElementById("metrology-scrim"),
  metrologyPanel: document.getElementById("metrology-panel"),
  openSpindle: document.getElementById("open-spindle"),
  openSensor: document.getElementById("open-sensor"),
  closeSpindle: document.getElementById("close-spindle"),
  spindleScrim: document.getElementById("spindle-scrim"),
  spindlePanel: document.getElementById("spindle-panel"),
  spindlePanelTitle: document.getElementById("spindle-panel-title"),
  openWiring: document.getElementById("open-wiring"),
  closeWiring: document.getElementById("close-wiring"),
  wiringScrim: document.getElementById("wiring-scrim"),
  wiringPanel: document.getElementById("wiring-panel"),
  openControllerSettings: document.getElementById("open-controller-settings"),
  closeControllerSettings: document.getElementById("close-controller-settings"),
  controllerSettingsScrim: document.getElementById("controller-settings-scrim"),
  controllerSettingsPanel: document.getElementById("controller-settings-panel"),
  openProbing: document.getElementById("open-probing"),
  closeProbing: document.getElementById("close-probing"),
  probingScrim: document.getElementById("probing-scrim"),
  probingPanel: document.getElementById("probing-panel"),
  openMachineData: document.getElementById("open-machine-data"),
  closeMachineData: document.getElementById("close-machine-data"),
  machineDataScrim: document.getElementById("machine-data-scrim"),
  machineDataPanel: document.getElementById("machine-data-panel"),
  setterForm: document.getElementById("setter-form"),
  setterInputState: document.getElementById("setter-input-state"),
  setterCalibrationState: document.getElementById("setter-calibration-state"),
  setterX: document.getElementById("setter-x"),
  setterY: document.getElementById("setter-y"),
  setterTravelZ: document.getElementById("setter-travel-z"),
  setterReferenceContactZ: document.getElementById("setter-reference-contact-z"),
  setterReferenceGaugeLength: document.getElementById("setter-reference-gauge-length"),
  setterToolNumber: document.getElementById("setter-tool-number"),
  setterCurrentGaugeLength: document.getElementById("setter-current-gauge-length"),
  setterClearance: document.getElementById("setter-clearance"),
  setterSearch: document.getElementById("setter-search"),
  setterRetract: document.getElementById("setter-retract"),
  setterGuardFeed: document.getElementById("setter-guard-feed"),
  setterLatchPullOff: document.getElementById("setter-latch-pulloff"),
  setterSeekFeed: document.getElementById("setter-seek-feed"),
  setterLatchFeed: document.getElementById("setter-latch-feed"),
  setterRetractFeed: document.getElementById("setter-retract-feed"),
  setterDoubleTouch: document.getElementById("setter-double-touch"),
  setterExpectedContactZ: document.getElementById("setter-expected-contact-z"),
  setterStartZ: document.getElementById("setter-start-z"),
  setterLimitZ: document.getElementById("setter-limit-z"),
  setterPastExpected: document.getElementById("setter-past-expected"),
  setterValidation: document.getElementById("setter-validation"),
  saveSetterProfile: document.getElementById("save-setter-profile"),
  setterCommandState: document.getElementById("setter-command-state"),
  runToolSetter: document.getElementById("run-tool-setter"),
  touchForm: document.getElementById("touch-form"),
  touchInputState: document.getElementById("touch-input-state"),
  activeProbeState: document.getElementById("active-probe-state"),
  touchCycle: document.getElementById("touch-cycle"),
  touchTipDiameter: document.getElementById("touch-tip-diameter"),
  touchTargetX: document.getElementById("touch-target-x"),
  touchTargetY: document.getElementById("touch-target-y"),
  touchTargetZ: document.getElementById("touch-target-z"),
  touchSafeZ: document.getElementById("touch-safe-z"),
  touchMeasurementZ: document.getElementById("touch-measurement-z"),
  touchDirectionX: document.getElementById("touch-direction-x"),
  touchDirectionY: document.getElementById("touch-direction-y"),
  touchFeatureDiameter: document.getElementById("touch-feature-diameter"),
  touchCornerOffset: document.getElementById("touch-corner-offset"),
  touchClearance: document.getElementById("touch-clearance"),
  touchSearch: document.getElementById("touch-search"),
  touchRetract: document.getElementById("touch-retract"),
  touchGuardFeed: document.getElementById("touch-guard-feed"),
  touchLatchPullOff: document.getElementById("touch-latch-pulloff"),
  touchSeekFeed: document.getElementById("touch-seek-feed"),
  touchLatchFeed: document.getElementById("touch-latch-feed"),
  touchRetractFeed: document.getElementById("touch-retract-feed"),
  touchDoubleTouch: document.getElementById("touch-double-touch"),
  touchCaptureXy: document.getElementById("touch-capture-xy"),
  touchCaptureSafeZ: document.getElementById("touch-capture-safe-z"),
  touchPlanContacts: document.getElementById("touch-plan-contacts"),
  touchPlanStart: document.getElementById("touch-plan-start"),
  touchPlanLimit: document.getElementById("touch-plan-limit"),
  touchPlanOvertravel: document.getElementById("touch-plan-overtravel"),
  touchValidation: document.getElementById("touch-validation"),
  saveTouchProfile: document.getElementById("save-touch-profile"),
  touchCommandState: document.getElementById("touch-command-state"),
  runTouchProbe: document.getElementById("run-touch-probe"),
  inputCalForm: document.getElementById("input-cal-form"),
  inputCalChannel: document.getElementById("input-cal-channel"),
  inputCalSamples: document.getElementById("input-cal-samples"),
  inputCalFeedLow: document.getElementById("input-cal-feed-low"),
  inputCalFeedWork: document.getElementById("input-cal-feed-work"),
  inputCalFeedHigh: document.getElementById("input-cal-feed-high"),
  inputCalMaxSpread: document.getElementById("input-cal-max-spread"),
  inputCalState: document.getElementById("input-cal-state"),
  inputCalRepeatability: document.getElementById("input-cal-repeatability"),
  inputCalLatency: document.getElementById("input-cal-latency"),
  inputCalError: document.getElementById("input-cal-error"),
  inputCalCompensation: document.getElementById("input-cal-compensation"),
  inputCalResolution: document.getElementById("input-cal-resolution"),
  inputCalFit: document.getElementById("input-cal-fit"),
  inputCalValidation: document.getElementById("input-cal-validation"),
  previewInputCal: document.getElementById("preview-input-cal"),
};

const healthElements = {
  state: document.getElementById("health-state"),
  stateLight: document.getElementById("health-state-light"),
  bridge: document.getElementById("health-bridge"),
  clock: document.getElementById("health-clock"),
  stream: document.getElementById("health-stream"),
  samples: document.getElementById("health-samples"),
  chart: document.getElementById("health-chart"),
  chartScale: document.getElementById("health-chart-scale"),
  rtt: ["now", "p50", "p95", "p99"].map((suffix) => document.getElementById(`health-rtt-${suffix}`)),
  visible: ["now", "p50", "p95", "p99"].map((suffix) => document.getElementById(`health-visible-${suffix}`)),
  bridgeTiming: ["now", "p50", "p95", "p99"].map((suffix) => document.getElementById(`health-bridge-${suffix}`)),
  render: ["now", "p50", "p95", "p99"].map((suffix) => document.getElementById(`health-render-${suffix}`)),
  gaps: document.getElementById("health-gaps"),
  duplicates: document.getElementById("health-duplicates"),
  resets: document.getElementById("health-resets"),
  reconnects: document.getElementById("health-reconnects"),
  poll: document.getElementById("health-poll"),
  renderProfile: document.getElementById("health-render-profile"),
  clockOffset: document.getElementById("health-clock-offset"),
  checkState: document.getElementById("health-check-state"),
  checkProgress: document.getElementById("health-check-progress"),
  runCheck: document.getElementById("run-health-check"),
  exportEvidence: document.getElementById("export-health-evidence"),
  reset: document.getElementById("reset-health-history"),
  checkDetail: document.getElementById("health-check-detail"),
};

const commissioningElements = {
  state: document.getElementById("commissioning-state"),
  stageCount: document.getElementById("commissioning-stage-count"),
  checkCount: document.getElementById("commissioning-check-count"),
  binding: document.getElementById("commissioning-binding"),
  motion: document.getElementById("commissioning-motion"),
  next: document.getElementById("commissioning-next"),
  machineId: document.getElementById("commissioning-machine-id"),
  controllerId: document.getElementById("commissioning-controller-id"),
  firmwareId: document.getElementById("commissioning-firmware-id"),
  stageTitle: document.getElementById("commissioning-stage-title"),
  stageSummary: document.getElementById("commissioning-stage-summary"),
  stageProgress: document.getElementById("commissioning-stage-progress"),
  stageList: document.getElementById("commissioning-stage-list"),
  checkList: document.getElementById("commissioning-check-list"),
  checkMethod: document.getElementById("commissioning-check-method"),
  checkTitle: document.getElementById("commissioning-check-title"),
  checkState: document.getElementById("commissioning-check-state"),
  checkCriterion: document.getElementById("commissioning-check-criterion"),
  requirements: document.getElementById("commissioning-check-requirements"),
  form: document.getElementById("commissioning-evidence-form"),
  result: [...document.querySelectorAll('input[name="commissioning-result"]')],
  source: document.getElementById("commissioning-source"),
  operator: document.getElementById("commissioning-operator"),
  instrument: document.getElementById("commissioning-instrument"),
  instrumentId: document.getElementById("commissioning-instrument-id"),
  value: document.getElementById("commissioning-value"),
  unit: document.getElementById("commissioning-unit"),
  artifactFile: document.getElementById("commissioning-artifact-file"),
  chooseArtifact: document.getElementById("choose-commissioning-artifact"),
  artifactName: document.getElementById("commissioning-artifact-name"),
  artifactHash: document.getElementById("commissioning-artifact-hash"),
  notes: document.getElementById("commissioning-notes"),
  save: document.getElementById("save-commissioning-evidence"),
  remove: document.getElementById("remove-commissioning-evidence"),
  validation: document.getElementById("commissioning-validation"),
  transferState: document.getElementById("commissioning-transfer-state"),
  export: document.getElementById("export-commissioning-record"),
  importFile: document.getElementById("commissioning-import-file"),
  chooseImport: document.getElementById("choose-commissioning-record"),
  importConfirm: document.getElementById("commissioning-import-confirm"),
  import: document.getElementById("import-commissioning-record"),
  resetConfirm: document.getElementById("commissioning-reset-confirm"),
  reset: document.getElementById("reset-commissioning-record"),
};

const controllerSettingsElements = {
  tabs: [...document.querySelectorAll("[data-controller-system-tab]")],
  panels: [...document.querySelectorAll("[data-controller-system-panel]")],
  source: document.getElementById("controller-settings-source"),
  profile: document.getElementById("controller-settings-profile"),
  count: document.getElementById("controller-settings-count"),
  staged: document.getElementById("controller-settings-staged"),
  search: document.getElementById("controller-settings-search"),
  category: document.getElementById("controller-settings-category"),
  state: document.getElementById("controller-settings-state"),
  refresh: document.getElementById("refresh-controller-settings"),
  captured: document.getElementById("controller-settings-captured"),
  fingerprint: document.getElementById("controller-settings-fingerprint"),
  list: document.getElementById("controller-settings-list"),
  empty: document.getElementById("controller-settings-empty"),
  diff: document.getElementById("controller-settings-diff"),
  discard: document.getElementById("discard-controller-settings"),
  confirm: document.getElementById("controller-settings-confirm"),
  validation: document.getElementById("controller-settings-validation"),
  exportSnapshot: document.getElementById("export-controller-snapshot"),
  exportPlan: document.getElementById("export-controller-plan"),
  apply: document.getElementById("apply-controller-settings"),
  policy: document.getElementById("controller-settings-write-policy"),
  firmwareBoard: document.getElementById("controller-firmware-board"),
  firmwareMcu: document.getElementById("controller-firmware-mcu"),
  firmwareImage: document.getElementById("controller-firmware-image"),
  firmwarePreflight: document.getElementById("controller-firmware-preflight"),
  firmwareFilename: document.getElementById("controller-firmware-filename"),
  firmwareBytes: document.getElementById("controller-firmware-bytes"),
  firmwareSha: document.getElementById("controller-firmware-sha"),
  firmwareAddress: document.getElementById("controller-firmware-address"),
  firmwareDownload: document.getElementById("controller-firmware-download"),
  firmwareManifest: document.getElementById("controller-firmware-manifest"),
  firmwareSimulation: document.getElementById("controller-firmware-simulation"),
  openFlashWorkflow: document.getElementById("open-verified-flash-workflow"),
};

const machineDataElements = {
  state: document.getElementById("machine-data-state"),
  controller: document.getElementById("machine-data-controller"),
  transfer: document.getElementById("machine-data-transfer"),
  name: document.getElementById("machine-data-name"),
  id: document.getElementById("machine-data-id"),
  fingerprint: document.getElementById("machine-data-fingerprint"),
  saveIdentity: document.getElementById("save-machine-identity"),
  profileCount: document.getElementById("machine-data-profile-count"),
  pointCount: document.getElementById("machine-data-point-count"),
  digest: document.getElementById("machine-data-digest"),
  exportBundle: document.getElementById("export-machine-bundle"),
  journalState: document.getElementById("machine-journal-state"),
  journalEntries: document.getElementById("machine-journal-entries"),
  configurationJournalEvents: document.getElementById("machine-config-journal-events"),
  configurationJournalLast: document.getElementById("machine-config-journal-last"),
  configurationJournalQueue: document.getElementById("machine-config-journal-queue"),
  journalDigest: document.getElementById("machine-journal-digest"),
  downloadJournal: document.getElementById("download-event-journal"),
  reconciliationSession: document.getElementById("machine-reconciliation-session"),
  reconciliationState: document.getElementById("machine-reconciliation-state"),
  reconciliationHistory: document.getElementById("machine-reconciliation-history"),
  reconciliationUnfinished: document.getElementById("machine-reconciliation-unfinished"),
  reconciliationInterlock: document.getElementById("machine-reconciliation-interlock"),
  reconciliationMessage: document.getElementById("machine-reconciliation-message"),
  reconciliationConfirm: document.getElementById("machine-reconciliation-confirm"),
  acknowledgeReconciliation: document.getElementById("acknowledge-machine-reconciliation"),
  file: document.getElementById("machine-bundle-file"),
  chooseBundle: document.getElementById("choose-machine-bundle"),
  validation: document.getElementById("machine-bundle-validation"),
  source: document.getElementById("machine-bundle-source"),
  created: document.getElementById("machine-bundle-created"),
  changeCount: document.getElementById("machine-bundle-change-count"),
  diff: document.getElementById("machine-bundle-diff"),
  adoptIdentity: document.getElementById("machine-bundle-adopt-identity"),
  confirm: document.getElementById("machine-bundle-confirm"),
  applyBundle: document.getElementById("apply-machine-bundle"),
};

configurationJournalClient.onStatus = () => {
  if (telemetryClient.active) void configurationJournalClient.flush();
  if (elements.machineDataPanel.getAttribute("aria-hidden") === "false") renderMachineData();
};

const fissionElements = {
  open: document.getElementById("open-fission-settings"),
  close: document.getElementById("close-fission-settings"),
  panel: document.getElementById("fission-settings-panel"),
  form: document.getElementById("fission-settings-form"),
  enabled: document.getElementById("fission-enabled"),
  safeZ: document.getElementById("fission-safe-z"),
  safeZVerified: document.getElementById("fission-safe-z-verified"),
  traverses: document.getElementById("fission-traverses"),
  retracts: document.getElementById("fission-retracts"),
  autoState: document.getElementById("fission-auto-state"),
  safeZState: document.getElementById("fission-safe-z-state"),
  processorState: document.getElementById("fission-processor-state"),
  validation: document.getElementById("fission-settings-validation"),
  save: document.getElementById("save-fission-settings"),
  cancel: document.getElementById("cancel-fission-settings"),
};

const cutterCompElements = {
  form: document.getElementById("cutter-comp-form"),
  jobTools: document.getElementById("cutter-job-tools"),
  jobToolList: document.getElementById("cutter-job-tool-list"),
  savedToolList: document.getElementById("cutter-saved-tool-list"),
  toolNumber: document.getElementById("cutter-tool-number"),
  toolLabel: document.getElementById("cutter-tool-label"),
  programmedDiameter: document.getElementById("cutter-programmed-diameter"),
  measuredDiameter: document.getElementById("cutter-measured-diameter"),
  featureSection: document.getElementById("cutter-feature-section"),
  targetSize: document.getElementById("cutter-target-size"),
  measuredSize: document.getElementById("cutter-measured-size"),
  maxFeatureError: document.getElementById("cutter-max-feature-error"),
  nextDiameter: document.getElementById("cutter-next-diameter"),
  diameterAdjustment: document.getElementById("cutter-diameter-adjustment"),
  radialShift: document.getElementById("cutter-radial-shift"),
  featureError: document.getElementById("cutter-feature-error"),
  validation: document.getElementById("cutter-comp-validation"),
  save: document.getElementById("save-cutter-tool"),
  delete: document.getElementById("delete-cutter-tool"),
  modeButtons: [...document.querySelectorAll("[data-cutter-mode]")],
  featureButtons: [...document.querySelectorAll("[data-cutter-feature]")],
};

const metrologyElements = {
  form: document.getElementById("metrology-form"),
  probeLink: document.getElementById("metrology-probe-link"),
  captureState: document.getElementById("metrology-capture-state"),
  pointCount: document.getElementById("metrology-point-count"),
  probeCalibrationState: document.getElementById("metrology-probe-cal-state"),
  sessionName: document.getElementById("metrology-session-name"),
  captureArmed: document.getElementById("metrology-capture-armed"),
  contactDirection: document.getElementById("metrology-contact-direction"),
  lastProbeState: document.getElementById("metrology-last-probe-state"),
  lastProbePosition: document.getElementById("metrology-last-probe-position"),
  lastCorrectedPosition: document.getElementById("metrology-last-corrected-position"),
  addLastProbe: document.getElementById("metrology-add-last-probe"),
  pointX: document.getElementById("metrology-point-x"),
  pointY: document.getElementById("metrology-point-y"),
  pointZ: document.getElementById("metrology-point-z"),
  addManual: document.getElementById("metrology-add-manual"),
  analysisMode: document.getElementById("metrology-analysis-mode"),
  tolerance: document.getElementById("metrology-tolerance"),
  nominalSize: document.getElementById("metrology-nominal-size"),
  resultLabel: document.getElementById("metrology-result-label"),
  resultType: document.getElementById("metrology-result-type"),
  resultValue: document.getElementById("metrology-result-value"),
  resultGrid: document.getElementById("metrology-result-grid"),
  pointList: document.getElementById("metrology-point-list"),
  removeLast: document.getElementById("metrology-remove-last"),
  clear: document.getElementById("metrology-clear"),
  validation: document.getElementById("metrology-validation"),
  spaceButtons: [...document.querySelectorAll("[data-metrology-space]")],
  pointModeButtons: [...document.querySelectorAll("[data-metrology-point-mode]")],
  exportButtons: [...document.querySelectorAll("[data-metrology-export]")],
  probeId: document.getElementById("metrology-probe-id"),
  probeName: document.getElementById("metrology-probe-name"),
  ballDiameter: document.getElementById("metrology-ball-diameter"),
  stylusLength: document.getElementById("metrology-stylus-length"),
  tipOffsetX: document.getElementById("metrology-tip-offset-x"),
  tipOffsetY: document.getElementById("metrology-tip-offset-y"),
  tipOffsetZ: document.getElementById("metrology-tip-offset-z"),
  artifactType: document.getElementById("metrology-artifact-type"),
  artifactId: document.getElementById("metrology-artifact-id"),
  artifactSize: document.getElementById("metrology-artifact-size"),
  calibratedAt: document.getElementById("metrology-calibrated-at"),
  repeatability: document.getElementById("metrology-repeatability"),
  repeatabilityLimit: document.getElementById("metrology-repeatability-limit"),
  sampleCount: document.getElementById("metrology-sample-count"),
  validDays: document.getElementById("metrology-valid-days"),
  directionRadii: [...document.querySelectorAll("[data-metrology-radius]")],
  saveCalibration: document.getElementById("metrology-save-calibration"),
  calibrationValidation: document.getElementById("metrology-calibration-validation"),
};

const wiringProfileElements = {
  targetPath: document.getElementById("wiring-target-path"),
  fieldPower: document.getElementById("wiring-field-power"),
  firmwareState: document.getElementById("wiring-firmware-state"),
  activeName: document.getElementById("wiring-active-name"),
  activeInterface: document.getElementById("wiring-active-interface"),
  activeTrigger: document.getElementById("wiring-active-trigger"),
  activeTouchName: document.getElementById("wiring-active-touch-name"),
  activeTouchField: document.getElementById("wiring-active-touch-field"),
  activeTouchLogic: document.getElementById("wiring-active-touch-logic"),
  activeSetterName: document.getElementById("wiring-active-setter-name"),
  activeSetterField: document.getElementById("wiring-active-setter-field"),
  activeSetterLogic: document.getElementById("wiring-active-setter-logic"),
  state: document.getElementById("wiring-profile-state"),
  edit: document.getElementById("edit-wiring-profile"),
  form: document.getElementById("wiring-profile-form"),
  validation: document.getElementById("wiring-profile-validation"),
  save: document.getElementById("save-wiring-profile"),
  cancel: document.getElementById("cancel-wiring-profile"),
  reset: document.getElementById("reset-wiring-profile"),
  name: document.getElementById("wiring-profile-name"),
  interfaceType: document.getElementById("wiring-interface-type"),
  interfaceLabel: document.getElementById("wiring-interface-label"),
  fieldVoltage: document.getElementById("wiring-field-voltage"),
  pullup: document.getElementById("wiring-pullup"),
  trigger: document.getElementById("wiring-trigger-type"),
  isolatedSupply: document.getElementById("wiring-isolated-supply"),
  sensors: Object.freeze({
    touch: Object.freeze({
      enabled: document.getElementById("wiring-touch-enabled"),
      label: document.getElementById("wiring-touch-label"),
      destination: document.getElementById("wiring-touch-destination"),
      input: document.getElementById("wiring-touch-input"),
      output: document.getElementById("wiring-touch-output"),
      customConnector: document.getElementById("wiring-touch-custom-connector"),
      customGpio: document.getElementById("wiring-touch-custom-gpio"),
      colors: Object.freeze({
        power: document.getElementById("wiring-touch-power-color"),
        signal: document.getElementById("wiring-touch-signal-color"),
        return: document.getElementById("wiring-touch-return-color"),
        shield: document.getElementById("wiring-touch-shield-color"),
      }),
    }),
    setter: Object.freeze({
      enabled: document.getElementById("wiring-setter-enabled"),
      label: document.getElementById("wiring-setter-label"),
      destination: document.getElementById("wiring-setter-destination"),
      input: document.getElementById("wiring-setter-input"),
      output: document.getElementById("wiring-setter-output"),
      customConnector: document.getElementById("wiring-setter-custom-connector"),
      customGpio: document.getElementById("wiring-setter-custom-gpio"),
      colors: Object.freeze({
        power: document.getElementById("wiring-setter-power-color"),
        signal: document.getElementById("wiring-setter-signal-color"),
        return: document.getElementById("wiring-setter-return-color"),
        shield: document.getElementById("wiring-setter-shield-color"),
      }),
    }),
  }),
};

const wiringInstallationElements = {
  steps: document.getElementById("wiring-install-steps"),
  evidenceList: document.getElementById("wiring-evidence-list"),
  evidenceCount: document.getElementById("wiring-evidence-count"),
  evidenceState: document.getElementById("wiring-evidence-state"),
  resetEvidence: document.getElementById("reset-wiring-evidence"),
  boardMap: document.getElementById("octopus-board-map"),
  expandBoardMap: document.getElementById("expand-board-map"),
  pigtailList: document.getElementById("wiring-pigtail-list"),
  firmware: Object.freeze({
    file: document.getElementById("octopus-firmware-file"),
    choose: document.getElementById("choose-octopus-firmware"),
    verdict: document.getElementById("octopus-firmware-verdict"),
    name: document.getElementById("octopus-firmware-name"),
    bytes: document.getElementById("octopus-firmware-bytes"),
    role: document.getElementById("octopus-firmware-role"),
    content: document.getElementById("octopus-firmware-content"),
    sha256: document.getElementById("octopus-firmware-sha256"),
    validation: document.getElementById("octopus-firmware-validation"),
    recordCount: document.getElementById("octopus-flash-record-count"),
    recordState: document.getElementById("octopus-flash-record-state"),
    downloadRecord: document.getElementById("download-octopus-flash-record"),
    attestations: Object.freeze([...document.querySelectorAll("[data-firmware-attestation]")]),
    gates: Object.freeze({
      content: document.getElementById("octopus-flash-gate-content"),
      card: document.getElementById("octopus-flash-gate-card"),
      operator: document.getElementById("octopus-flash-gate-operator"),
      preflight: document.getElementById("octopus-flash-gate-preflight"),
    }),
  }),
  preflight: Object.freeze({
    state: document.getElementById("controller-preflight-state"),
    board: document.getElementById("controller-preflight-board"),
    settings: document.getElementById("controller-preflight-settings"),
    machine: document.getElementById("controller-preflight-machine"),
    inputs: document.getElementById("controller-preflight-inputs"),
    policy: document.getElementById("controller-preflight-policy"),
    fingerprint: document.getElementById("controller-preflight-fingerprint"),
    issues: document.getElementById("controller-preflight-issues"),
    next: document.getElementById("controller-preflight-next"),
    download: document.getElementById("download-controller-preflight"),
  }),
};

const fixtureMapElements = {
  form: document.getElementById("fixture-map-form"),
  canvas: document.getElementById("fixture-map-canvas"),
  activeWcs: document.getElementById("fixture-active-wcs"),
  frameState: document.getElementById("fixture-frame-state"),
  gridSummary: document.getElementById("fixture-grid-summary"),
  selectionWcs: document.getElementById("fixture-selection-wcs"),
  selectionName: document.getElementById("fixture-selection-name"),
  selectionAddress: document.getElementById("fixture-selection-address"),
  gridColumns: document.getElementById("fixture-grid-columns"),
  gridRows: document.getElementById("fixture-grid-rows"),
  gridPitchX: document.getElementById("fixture-grid-pitch-x"),
  gridPitchY: document.getElementById("fixture-grid-pitch-y"),
  address: document.getElementById("fixture-address"),
  jawOpening: document.getElementById("fixture-jaw-opening"),
  jawOpeningRange: document.getElementById("fixture-jaw-opening-range"),
  jawOpeningOutput: document.getElementById("fixture-jaw-opening-output"),
  datumReference: document.getElementById("fixture-datum-reference"),
  datumX: document.getElementById("fixture-datum-x"),
  datumY: document.getElementById("fixture-datum-y"),
  datumZ: document.getElementById("fixture-datum-z"),
  frameX: document.getElementById("fixture-frame-x"),
  frameY: document.getElementById("fixture-frame-y"),
  frameZ: document.getElementById("fixture-frame-z"),
  frameRotation: document.getElementById("fixture-frame-rotation"),
  locationsVerified: document.getElementById("fixture-locations-verified"),
  calibrationProbe: document.getElementById("fixture-cal-probe"),
  calibrationHomed: document.getElementById("fixture-cal-homed"),
  calibrationState: document.getElementById("fixture-cal-state"),
  calibrationAddress: document.getElementById("fixture-cal-address"),
  calibrationX: document.getElementById("fixture-cal-x"),
  calibrationY: document.getElementById("fixture-cal-y"),
  calibrationZ: document.getElementById("fixture-cal-z"),
  calibrationAdd: document.getElementById("fixture-cal-add"),
  calibrationUseXy: document.getElementById("fixture-cal-use-xy"),
  calibrationUseZ: document.getElementById("fixture-cal-use-z"),
  calibrationReferenceList: document.getElementById("fixture-cal-reference-list"),
  calibrationMinimumReferences: document.getElementById("fixture-cal-min-references"),
  calibrationMinimumCoverage: document.getElementById("fixture-cal-min-coverage"),
  calibrationMaximumRms: document.getElementById("fixture-cal-max-rms"),
  calibrationMaximumPoint: document.getElementById("fixture-cal-max-point"),
  calibrationMaximumScale: document.getElementById("fixture-cal-max-scale"),
  calibrationMaximumTilt: document.getElementById("fixture-cal-max-tilt"),
  calibrationConsensus: document.getElementById("fixture-cal-consensus"),
  calibrationCoverage: document.getElementById("fixture-cal-coverage"),
  calibrationXyError: document.getElementById("fixture-cal-xy-error"),
  calibrationScale: document.getElementById("fixture-cal-scale"),
  calibrationTopError: document.getElementById("fixture-cal-top-error"),
  calibrationTilt: document.getElementById("fixture-cal-tilt"),
  calibrationCenter: document.getElementById("fixture-cal-center"),
  calibrationYaw: document.getElementById("fixture-cal-yaw"),
  calibrationValidation: document.getElementById("fixture-cal-validation"),
  calibrationApply: document.getElementById("fixture-cal-apply"),
  calibrationClear: document.getElementById("fixture-cal-clear"),
  offsetWcs: document.getElementById("fixture-offset-wcs"),
  offsetX: document.getElementById("fixture-offset-x"),
  offsetY: document.getElementById("fixture-offset-y"),
  offsetZ: document.getElementById("fixture-offset-z"),
  liveMpos: document.getElementById("fixture-live-mpos"),
  liveWco: document.getElementById("fixture-live-wco"),
  liveWpos: document.getElementById("fixture-live-wpos"),
  validation: document.getElementById("fixture-map-validation"),
  save: document.getElementById("save-fixture-map"),
  commandState: document.getElementById("fixture-command-state"),
  applyWorkOffset: document.getElementById("apply-work-offset"),
  rotationButtons: [...document.querySelectorAll("[data-fixture-rotation]")],
  stationButtons: [...document.querySelectorAll("[data-fixture-id]")],
  enabledToggles: [...document.querySelectorAll("[data-fixture-enabled]")],
};

const sceneRegistrationElements = {
  form: document.getElementById("scene-registration-form"),
  cameraState: document.getElementById("scene-camera-state"),
  frameState: document.getElementById("scene-frame-state"),
  referenceCount: document.getElementById("scene-reference-count"),
  rmsError: document.getElementById("scene-rms-error"),
  authority: document.getElementById("scene-authority"),
  pipelineGrid: document.getElementById("scene-pipeline-grid"),
  pipelineMask: document.getElementById("scene-pipeline-mask"),
  pipelineFeatures: document.getElementById("scene-pipeline-features"),
  pipelinePlan: document.getElementById("scene-pipeline-plan"),
  visibleHoleCount: document.getElementById("scene-visible-hole-count"),
  frameMedia: document.getElementById("scene-frame-media"),
  video: document.getElementById("scene-camera-video"),
  canvas: document.getElementById("scene-registration-canvas"),
  frameEmpty: document.getElementById("scene-frame-empty"),
  frameFile: document.getElementById("scene-frame-file"),
  detectionFile: document.getElementById("scene-detection-file"),
  connectCamera: document.getElementById("scene-connect-camera"),
  captureFrame: document.getElementById("scene-capture-frame"),
  openFrame: document.getElementById("scene-open-frame"),
  importDetections: document.getElementById("scene-import-detections"),
  bindFrame: document.getElementById("scene-bind-frame"),
  cameraId: document.getElementById("scene-camera-id"),
  cameraName: document.getElementById("scene-camera-name"),
  cameraWidth: document.getElementById("scene-camera-width"),
  cameraHeight: document.getElementById("scene-camera-height"),
  lensProfileId: document.getElementById("scene-lens-profile-id"),
  intrinsicsCalibrated: document.getElementById("scene-intrinsics-calibrated"),
  referenceAddress: document.getElementById("scene-reference-address"),
  referenceX: document.getElementById("scene-reference-x"),
  referenceY: document.getElementById("scene-reference-y"),
  addReference: document.getElementById("scene-add-reference"),
  referenceList: document.getElementById("scene-reference-list"),
  clearReferences: document.getElementById("scene-clear-references"),
  minimumReferences: document.getElementById("scene-min-references"),
  minimumCoverage: document.getElementById("scene-min-coverage"),
  maximumRms: document.getElementById("scene-max-rms"),
  maximumPointError: document.getElementById("scene-max-point-error"),
  ransacThreshold: document.getElementById("scene-ransac-threshold"),
  maximumOutlierRatio: document.getElementById("scene-max-outlier-ratio"),
  maximumAge: document.getElementById("scene-max-age"),
  fitCoverage: document.getElementById("scene-fit-coverage"),
  fitMaximumError: document.getElementById("scene-fit-max-error"),
  fitConsensus: document.getElementById("scene-fit-consensus"),
  fitMmError: document.getElementById("scene-fit-mm-error"),
  fitFrame: document.getElementById("scene-fit-frame"),
  fitAge: document.getElementById("scene-fit-age"),
  fitState: document.getElementById("scene-fit-state"),
  featureType: document.getElementById("scene-feature-type"),
  featureX: document.getElementById("scene-feature-x"),
  featureY: document.getElementById("scene-feature-y"),
  featureSize: document.getElementById("scene-feature-size"),
  addFeature: document.getElementById("scene-add-feature"),
  featureList: document.getElementById("scene-feature-list"),
  planOperations: document.getElementById("scene-plan-operations"),
  planContacts: document.getElementById("scene-plan-contacts"),
  planProbe: document.getElementById("scene-plan-probe"),
  planList: document.getElementById("scene-probe-plan"),
  validation: document.getElementById("scene-registration-validation"),
  save: document.getElementById("scene-save-registration"),
};

const jogElements = {
  commandMode: document.getElementById("jog-command-mode"),
  serialOwner: document.getElementById("jog-serial-owner"),
  dro: Object.freeze({
    x: document.getElementById("jog-dro-x"),
    y: document.getElementById("jog-dro-y"),
    z: document.getElementById("jog-dro-z"),
  }),
  limits: Object.freeze({
    x: Object.freeze({
      negative: document.getElementById("jog-limit-x-negative"),
      positive: document.getElementById("jog-limit-x-positive"),
    }),
    y: Object.freeze({
      negative: document.getElementById("jog-limit-y-negative"),
      positive: document.getElementById("jog-limit-y-positive"),
    }),
    z: Object.freeze({
      negative: document.getElementById("jog-limit-z-negative"),
      positive: document.getElementById("jog-limit-z-positive"),
    }),
  }),
  stepValue: document.getElementById("jog-step-value"),
  speedValue: document.getElementById("jog-speed-value"),
  commandStatus: document.getElementById("jog-command-status"),
  directionButtons: [...document.querySelectorAll("[data-jog-axis]")],
};

const spindleElements = {
  source: document.getElementById("spindle-source"),
  profile: document.getElementById("spindle-profile"),
  stage: document.getElementById("spindle-stage"),
  targetPath: document.getElementById("spindle-target-path"),
  productionPath: document.getElementById("spindle-production-path"),
  activePath: document.getElementById("spindle-active-path"),
  commandOwner: document.getElementById("spindle-command-owner"),
  safetyAuthority: document.getElementById("spindle-safety-authority"),
  fallback: document.getElementById("spindle-fallback"),
  commandRpm: document.getElementById("spindle-command-rpm"),
  motorTargetRpm: document.getElementById("spindle-motor-target-rpm"),
  controllerRpm: document.getElementById("spindle-controller-rpm"),
  motorRpm: document.getElementById("spindle-motor-rpm"),
  calculatedRpm: document.getElementById("spindle-calculated-rpm"),
  encoderRpm: document.getElementById("spindle-encoder-rpm"),
  torque: document.getElementById("spindle-torque"),
  current: document.getElementById("spindle-current"),
  peakCurrent: document.getElementById("spindle-peak-current"),
  averageLoad: document.getElementById("spindle-average-load"),
  regenerativeLoad: document.getElementById("spindle-regenerative-load"),
  driveState: document.getElementById("spindle-drive-state"),
  mode: document.getElementById("spindle-mode"),
  ready: document.getElementById("spindle-ready"),
  alarmSignal: document.getElementById("spindle-alarm-signal"),
  servoOn: document.getElementById("spindle-servo-on"),
  atSpeed: document.getElementById("spindle-at-speed"),
  zeroSpeed: document.getElementById("spindle-zero-speed"),
  inPosition: document.getElementById("spindle-in-position"),
  modeSwitched: document.getElementById("spindle-mode-switched"),
  modbusAge: document.getElementById("spindle-modbus-age"),
  encoderAge: document.getElementById("spindle-encoder-age"),
  indexAge: document.getElementById("spindle-index-age"),
  ratio: document.getElementById("spindle-ratio"),
  disagreement: document.getElementById("spindle-disagreement"),
  errors: document.getElementById("spindle-errors"),
  alarmCode: document.getElementById("spindle-alarm-code"),
  freezeFrame: document.getElementById("spindle-freeze-frame"),
  modbusReadPermit: document.getElementById("spindle-modbus-read-permit"),
  modbusWritePermit: document.getElementById("spindle-modbus-write-permit"),
  m3Permit: document.getElementById("spindle-m3-permit"),
  m4Permit: document.getElementById("spindle-m4-permit"),
  m5Permit: document.getElementById("spindle-m5-permit"),
  m19Permit: document.getElementById("spindle-m19-permit"),
  rigidTappingPermit: document.getElementById("spindle-rigid-tapping-permit"),
};

const sensorElements = {
  section: document.getElementById("esp32-health-section"),
  healthState: document.getElementById("sensor-health-state"),
  fusedScore: document.getElementById("sensor-fused-score"),
  frequency: document.getElementById("sensor-frequency"),
  vibration: document.getElementById("sensor-vibration"),
  rotation: document.getElementById("sensor-rotation"),
  historyCanvas: document.getElementById("sensor-history-canvas"),
  componentBars: Object.freeze({
    microphone: document.getElementById("sensor-microphone-bar"),
    accelerometer: document.getElementById("sensor-accelerometer-bar"),
    gyroscope: document.getElementById("sensor-gyroscope-bar"),
  }),
  componentScores: Object.freeze({
    microphone: document.getElementById("sensor-microphone-score"),
    accelerometer: document.getElementById("sensor-accelerometer-score"),
    gyroscope: document.getElementById("sensor-gyroscope-score"),
  }),
  spindleRpm: document.getElementById("sensor-spindle-rpm"),
  rotationalFrequency: document.getElementById("sensor-rotational-frequency"),
  vibrationOrder: document.getElementById("sensor-vibration-order"),
  nearestOrder: document.getElementById("sensor-nearest-order"),
  calibration: document.getElementById("sensor-calibration"),
  imuHealth: document.getElementById("sensor-imu-health"),
  audioHealth: document.getElementById("sensor-audio-health"),
  externalTempHealth: document.getElementById("sensor-external-temp-health"),
  firmware: document.getElementById("sensor-firmware"),
  deviceUptime: document.getElementById("sensor-device-uptime"),
  processingTime: document.getElementById("sensor-processing-time"),
  sampleAge: document.getElementById("sensor-sample-age"),
  packetAge: document.getElementById("sensor-packet-age"),
  imuSamples: document.getElementById("sensor-imu-samples"),
  heap: document.getElementById("sensor-heap"),
  sequences: document.getElementById("sensor-sequences"),
  gaps: document.getElementById("sensor-gaps"),
  resets: document.getElementById("sensor-resets"),
  baselineVibration: document.getElementById("sensor-baseline-vibration"),
  baselineRotation: document.getElementById("sensor-baseline-rotation"),
  baselineMicrophone: document.getElementById("sensor-baseline-microphone"),
  sessionScore: document.getElementById("sensor-session-score"),
  sessionVibration: document.getElementById("sensor-session-vibration"),
  sessionTemperature: document.getElementById("sensor-session-temperature"),
  advisoryState: document.getElementById("sensor-advisory-state"),
  startCalibration: document.getElementById("start-sensor-calibration"),
  clearCalibration: document.getElementById("clear-sensor-calibration"),
  exportSession: document.getElementById("export-sensor-session"),
};

const rigidTappingElements = {
  status: document.getElementById("rigid-tapping-status"),
  controller: document.getElementById("rigid-tapping-controller"),
  production: document.getElementById("rigid-tapping-production"),
  core: document.getElementById("rigid-tapping-core"),
  pitch: document.getElementById("rigid-tapping-pitch"),
  depth: document.getElementById("rigid-tapping-depth"),
  rpm: document.getElementById("rigid-tapping-rpm"),
  feed: document.getElementById("rigid-tapping-feed"),
  utilization: document.getElementById("rigid-tapping-utilization"),
  aPulse: document.getElementById("rigid-tapping-a-pulse"),
  zPulse: document.getElementById("rigid-tapping-z-pulse"),
  rotation: document.getElementById("rigid-tapping-rotation"),
  inverseTime: document.getElementById("rigid-tapping-inverse-time"),
  pitchError: document.getElementById("rigid-tapping-pitch-error"),
  gates: {
    octopusBoardAndMcuVerified: document.getElementById("rigid-gate-board"),
    fiveMotionOutputsScopeVerified: document.getElementById("rigid-gate-five-output"),
    installedServoDriveIdentified: document.getElementById("rigid-gate-drive"),
    positionModeSupported: document.getElementById("rigid-gate-position"),
    isolatedInterfaceApproved: document.getElementById("rigid-gate-interface"),
    azRatioScopeVerified: document.getElementById("rigid-gate-az"),
    bottomReversalScopeVerified: document.getElementById("rigid-gate-reversal"),
    usbDisconnectSafeStateVerified: document.getElementById("rigid-gate-safety"),
    waxTestPassed: document.getElementById("rigid-gate-wax"),
    aluminumTestPassed: document.getElementById("rigid-gate-aluminum"),
  },
};

let job = createDemoJob();
let probingProfile = loadProbingProfile(configurationStorage);
let sensorWiringProfile = loadSensorWiringProfile(configurationStorage);
let wiringEvidence = loadWiringEvidence(configurationStorage);
let commissioningRecord = wiringEvidence.commissioning;
let selectedCommissioningStageId = null;
let selectedCommissioningCheckId = null;
let commissioningArtifact = null;
let commissioningArtifactBusy = false;
let pendingCommissioningBundle = null;
let commissioningTransferMessage = "NO IMPORT";
let commissioningTransferState = "";
let firmwareVerification = null;
let firmwareFlashAttestations = Object.fromEntries(FIRMWARE_FLASH_ATTESTATIONS.map(({ id }) => [id, false]));
let firmwareFlashRecordBusy = false;
let controllerSettingsReport = null;
let controllerSettingsStaged = {};
let controllerSettingsBusy = false;
let controllerSettingsMessage = "CONNECT LOCAL SERVICE TO LOAD SETTINGS";
let controllerSettingsMessageState = "";
let fixtureMapProfile = loadFixtureMapProfile(configurationStorage);
let tableFrameCalibration = normalizeTableFrameCalibration(
  fixtureMapProfile.plateCalibration ?? DEFAULT_TABLE_FRAME_CALIBRATION,
);
let sceneRegistrationProfile = loadSceneRegistrationProfile(configurationStorage, fixtureMapProfile);
let cutterCompProfile = loadCutterCompensationProfile(configurationStorage);
let metrologySession = loadMetrologySession(configurationStorage);
let probeCalibration = loadProbeCalibration(configurationStorage);
let lastMetrologyProbePoint = null;
let lastMetrologyProbeEvent = null;
let metrologyProbeSequence = 0;
let sceneCameraStream = null;
let sceneFrameBitmap = null;
let sceneActiveFrame = null;
let sceneRegistrationIssue = "";
let scenePickedPixel = null;
let fissionImportProfile = loadFissionImportProfile(configurationStorage);
let fissionProcessorStatus = { state: "checking", available: null, reviewed: null };
let machineIdentity = loadMachineIdentity(configurationStorage);
let pendingMachineBundle = null;
let pendingMachineBundleDiff = null;
let machineBundleMessage = "NO BUNDLE SELECTED";
let machineBundleMessageState = "";
let lastMachineBundleDigest = null;
let reconciliationRequestBusy = false;
let journalDownloadBusy = false;
let reconciliationRequestMessage = "";
let reconciliationRequestMessageState = "";
const spindleFaultRecorder = new SpindleFaultRecorder();
const sensorSession = new SensorSession();
const latencyMonitor = new LatencyMonitor();
const machineCommandClient = new MachineCommandClient({
  endpoint: pairedServiceEndpoint("/machine/transactions"),
  cancelEndpoint: pairedServiceEndpoint("/machine/cancel"),
});
// The service never publishes raw owner IDs (they are bearer credentials);
// shared transactions and lease snapshots carry a derived ownerTag instead.
machineCommandClient.ownerTag = null;
void sha256TextHex(`mr1-owner-tag:${machineCommandClient.ownerId}`).then((tag) => {
  machineCommandClient.ownerTag = tag;
});
function transactionOwnedByThisUi(candidate) {
  if (!candidate || typeof candidate !== "object") return false;
  if (typeof candidate.ownerTag === "string") return candidate.ownerTag === machineCommandClient.ownerTag;
  return candidate.ownerId === machineCommandClient.ownerId;
}
elements.jobName.textContent = job.name;

let viewer;

const runtime = {
  elapsed: 0,
  playing: false,
  stopped: false,
  coordinateMode: "work",
  viewMode: "machine",
  playbackRate: 4,
  lastFrame: performance.now(),
  lastSegment: -1,
  live: false,
  bridge: null,
  telemetry: null,
  renderedTelemetry: null,
  telemetryMeta: null,
  telemetryLinked: false,
  telemetryWatchdog: null,
  pendingTelemetry: null,
  pendingSensor: null,
  pendingSpindleRender: false,
  liveRenderFrame: null,
  liveRenderStats: { packets: 0, frames: 0 },
  renderedTelemetryTool: null,
  sensor: null,
  sensorMeta: null,
  sensorWatchdog: null,
  sensorCommandPending: false,
  sensorCommandFeedback: null,
  spindle: null,
  spindleWatchdog: null,
  spindleProtocolError: false,
  spindleStale: false,
  spindlePanelTrigger: "spindle",
  previewToolDescription: "6 mm",
  jogCoordinateMode: "work",
  jogStep: 1,
  jogSpeed: 500,
  previewJogPosition: null,
  continuousJogTimer: null,
  continuousJogButton: null,
  continuousJogReleasePending: false,
  commandPending: false,
  commandFeedback: null,
  transaction: null,
  typedProbeCycleActive: false,
  capturedProbeTransactionIds: new Set(),
  importedProgram: null,
  lastGcodeLoad: null,
  gcodeLoad: null,
  gcodeLoadSequence: 0,
  healthPingTimer: null,
  healthPingBusy: false,
  healthLastPingError: null,
  healthRenderTimer: null,
  healthCheck: null,
  healthLastEvidence: null,
  healthHistoryMark: null,
  clockMaintenanceTimer: null,
};

async function initializeViewer() {
  try {
    const { Mr1Scene } = await import("./mr1-scene.js");
    const requestedRenderQuality = new URLSearchParams(window.location.search).get("render-quality");
    const renderQuality = requestedRenderQuality ?? (COMPANION_MODE ? "reduced" : "auto");
    viewer = new Mr1Scene(elements.viewer, {
      renderQuality: ["full", "balanced", "reduced"].includes(renderQuality) ? renderQuality : "auto",
    });
    if (viewer.renderProfile.quality === "reduced") {
      elements.rendererStatus.hidden = false;
      elements.rendererStatus.dataset.state = "reduced";
      elements.rendererStatus.textContent = "SOFTWARE GPU · LIGHT 3D";
      elements.rendererStatus.title = viewer.renderProfile.rendererName;
    } else if (viewer.renderProfile.quality === "balanced") {
      elements.rendererStatus.hidden = false;
      elements.rendererStatus.dataset.state = "balanced";
      elements.rendererStatus.textContent = "MINI PC · BALANCED 3D";
      elements.rendererStatus.title = `${viewer.renderProfile.rendererName} · ${viewer.renderProfile.hardwareConcurrency ?? "?"} threads`;
    } else {
      elements.rendererStatus.hidden = true;
      elements.rendererStatus.dataset.state = "full";
      elements.rendererStatus.textContent = "";
      elements.rendererStatus.title = viewer.renderProfile.rendererName;
    }
    const initialJob = job;
    const initialJobBuild = viewer.setJob(initialJob);
    viewer.setFixtureLayout(fixtureLayout(fixtureMapProfile), fixtureMapProfile.selectedFixtureId);
    syncMetrologyOverlay();
    viewer.setMode(runtime.viewMode);
    const built = await initialJobBuild;
    if (built !== false && job === initialJob) updateScene();
  } catch (error) {
    console.error("MR-1 viewer failed to initialize", error);
    const failure = document.createElement("div");
    failure.className = "viewer-failure";
    failure.textContent = "3D VIEW UNAVAILABLE";
    elements.viewer.append(failure);
  }
}

requestAnimationFrame(() => requestAnimationFrame(() => void initializeViewer()));

function formatTime(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainingSeconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function setMachineState(label, state) {
  if (elements.machineState.textContent !== label) elements.machineState.textContent = label;
  if (elements.machineState.dataset.state !== state) elements.machineState.dataset.state = state;
}

function setCycleButtonLabel(label) {
  const text = elements.cycleStart.querySelector("span");
  if (text) text.textContent = label;
}

function setJobStatus(label, state = "", details = "") {
  elements.jobStatus.textContent = label;
  elements.jobStatus.dataset.state = state;
  elements.jobStatus.title = details;
}

function createGcodeImportAbortError(message = "G-code import cancelled.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function throwIfGcodeImportAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error && signal.reason.name === "AbortError") throw signal.reason;
  throw createGcodeImportAbortError();
}

function isGcodeImportAbort(error, signal = null) {
  return signal?.aborted === true || error?.name === "AbortError";
}

function setGcodeLoadProgress(fraction = null) {
  elements.gcodeLoadProgress.hidden = false;
  if (Number.isFinite(fraction)) {
    elements.gcodeLoadProgress.value = Math.max(0, Math.min(1, fraction));
  } else {
    elements.gcodeLoadProgress.removeAttribute("value");
  }
}

function setGcodeLoadUi(active) {
  elements.openGcode.disabled = active;
  elements.cancelGcodeLoad.hidden = !active;
  elements.cancelGcodeLoad.disabled = false;
  if (!active) {
    elements.gcodeLoadProgress.hidden = true;
    elements.gcodeLoadProgress.value = 0;
  }
}

async function readGcodeFileText(file, { signal, onProgress } = {}) {
  throwIfGcodeImportAborted(signal);
  if (typeof file.stream !== "function") {
    const source = await file.text();
    throwIfGcodeImportAborted(signal);
    onProgress?.(1);
    return source;
  }

  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  const textChunks = [];
  let bytesRead = 0;
  const cancelReader = () => void reader.cancel(signal?.reason).catch(() => {});
  signal?.addEventListener("abort", cancelReader, { once: true });
  try {
    while (true) {
      throwIfGcodeImportAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      textChunks.push(decoder.decode(value, { stream: true }));
      bytesRead += value.byteLength;
      onProgress?.(file.size > 0 ? Math.min(1, bytesRead / file.size) : 1);
    }
    textChunks.push(decoder.decode());
    throwIfGcodeImportAborted(signal);
    onProgress?.(1);
    return textChunks.join("");
  } finally {
    signal?.removeEventListener("abort", cancelReader);
    reader.releaseLock();
  }
}

function collectFissionImportProfile() {
  const safeZ = fissionElements.safeZ.value.trim();
  return {
    enabled: fissionElements.enabled.checked,
    safeZ: safeZ === "" ? "" : Number(safeZ),
    safeZVerified: fissionElements.safeZVerified.checked,
    traverses: fissionElements.traverses.value,
    retracts: fissionElements.retracts.value,
  };
}

function populateFissionImportProfile(profile) {
  fissionElements.enabled.checked = profile.enabled;
  fissionElements.safeZ.value = String(profile.safeZ);
  fissionElements.safeZVerified.checked = profile.safeZVerified;
  fissionElements.traverses.value = profile.traverses;
  fissionElements.retracts.value = profile.retracts;
}

function renderFissionImportProfile(profile = collectFissionImportProfile(), options = {}) {
  const evaluation = evaluateFissionImportProfile(profile);
  const processorReady = fissionProcessorStatus.available === true
    && fissionProcessorStatus.reviewed === true;
  const autoLabel = !evaluation.profile.enabled
    ? "OFF"
    : evaluation.ready
      ? "ARMED"
      : "HELD";
  const autoState = evaluation.ready ? "active" : evaluation.profile.enabled ? "alarm" : "";
  setIndicator(fissionElements.autoState, autoLabel, autoState);
  setIndicator(
    fissionElements.safeZState,
    `${evaluation.profile.safeZ.toFixed(3)} MM`,
    evaluation.profile.safeZVerified ? "active" : "alarm",
  );

  if (fissionProcessorStatus.state === "checking") {
    setIndicator(fissionElements.processorState, "CHECKING", "");
  } else if (processorReady) {
    setIndicator(fissionElements.processorState, "REVIEWED", "active");
  } else if (fissionProcessorStatus.state === "offline") {
    setIndicator(fissionElements.processorState, "OFFLINE", "alarm");
  } else {
    setIndicator(fissionElements.processorState, "LOCKED", "alarm");
  }

  let validation = options.message ?? "UPWARD RETRACTS + CLEARANCE XY ONLY";
  let validationState = evaluation.ready && processorReady ? "valid" : "";
  if (!evaluation.valid) {
    validation = evaluation.errors.join(" ").toUpperCase();
    validationState = "alarm";
  } else if (!evaluation.profile.enabled) {
    validation = "AUTOMATIC RAPID RESTORE OFF";
  } else if (!evaluation.profile.safeZVerified) {
    validation = "VERIFY WORK-COORDINATE SAFE Z TO ARM";
    validationState = "alarm";
  } else if (fissionProcessorStatus.state === "offline") {
    validation = "LOCAL PROCESSOR OFFLINE / ORIGINAL FILES ONLY";
    validationState = "alarm";
  } else if (fissionProcessorStatus.available === false) {
    validation = "PROCESSOR SOURCE NOT REVIEWED / ORIGINAL FILES ONLY";
    validationState = "alarm";
  } else if (!processorReady) {
    validation = "PROFILE READY / CHECKING LOCAL PROCESSOR";
  }
  fissionElements.validation.textContent = validation;
  fissionElements.validation.dataset.state = validationState;
  fissionElements.safeZ.dataset.invalid = evaluation.errors.some((error) => error.startsWith("Safe Z"))
    ? "true"
    : "false";
  fissionElements.save.disabled = !evaluation.valid;

  const armed = evaluation.ready && processorReady;
  fissionElements.open.dataset.state = armed ? "armed" : evaluation.profile.enabled ? "held" : "off";
  fissionElements.open.dataset.tooltip = armed ? "Rapid restore armed" : "Fusion rapid restore";
  return evaluation;
}

async function refreshFissionProcessorStatus() {
  fissionProcessorStatus = { state: "checking", available: null, reviewed: null };
  renderFissionImportProfile(fissionImportProfile);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(FISSION_HEALTH_ENDPOINT, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    fissionProcessorStatus = {
      state: "ready",
      available: health.fission?.available === true,
      reviewed: health.fission?.reviewed === true,
      reason: health.fission?.reason ?? null,
    };
  } catch (error) {
    fissionProcessorStatus = {
      state: "offline",
      available: false,
      reviewed: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
    renderFissionImportProfile(fissionImportProfile);
  }
}

function setFissionSettingsPanel(open) {
  if (open && elements.controllerSettingsPanel.getAttribute("aria-hidden") === "false") {
    setControllerSettingsPanel(false, false);
  }
  if (open && elements.sceneRegistrationPanel.getAttribute("aria-hidden") === "false") {
    setSceneRegistrationPanel(false, false);
  }
  fissionElements.panel.hidden = !open;
  fissionElements.panel.setAttribute("aria-hidden", open ? "false" : "true");
  fissionElements.open.setAttribute("aria-pressed", open ? "true" : "false");
  if (!open) return;
  populateFissionImportProfile(fissionImportProfile);
  renderFissionImportProfile(fissionImportProfile);
  void refreshFissionProcessorStatus();
}

function setIndicator(element, label, state = "") {
  if (element.value !== label) element.value = label;
  if (element.dataset.state !== state) element.dataset.state = state;
}

function optionalInputNumber(element) {
  const value = element.value.trim();
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function inputNumber(element) {
  const number = Number(element.value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function setNumberInput(element, value, maximumFractionDigits = null) {
  const formatted = Number.isFinite(value) && Number.isInteger(maximumFractionDigits)
    ? Number(value.toFixed(maximumFractionDigits))
    : value;
  element.value = Number.isFinite(formatted) ? String(formatted) : "";
}

function selectedCutterMode() {
  return cutterCompElements.modeButtons.find((button) => button.getAttribute("aria-pressed") === "true")
    ?.dataset.cutterMode ?? "tool";
}

function selectedCutterFeatureType() {
  return cutterCompElements.featureButtons.find((button) => button.getAttribute("aria-pressed") === "true")
    ?.dataset.cutterFeature ?? "external";
}

function setCutterMode(mode) {
  const selected = mode === "feature" ? "feature" : "tool";
  cutterCompElements.modeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.cutterMode === selected ? "true" : "false");
  });
  const featureMode = selected === "feature";
  cutterCompElements.featureSection.hidden = !featureMode;
  cutterCompElements.targetSize.disabled = !featureMode;
  cutterCompElements.measuredSize.disabled = !featureMode;
  cutterCompElements.maxFeatureError.disabled = !featureMode;
}

function setCutterFeatureType(type) {
  const selected = type === "internal" ? "internal" : "external";
  cutterCompElements.featureButtons.forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.cutterFeature === selected ? "true" : "false");
  });
}

function collectCutterTool() {
  return {
    number: inputNumber(cutterCompElements.toolNumber),
    label: cutterCompElements.toolLabel.value,
    programmedDiameterMm: optionalInputNumber(cutterCompElements.programmedDiameter),
    measuredDiameterMm: optionalInputNumber(cutterCompElements.measuredDiameter),
    correctionMode: selectedCutterMode(),
    featureType: selectedCutterFeatureType(),
    targetSizeMm: optionalInputNumber(cutterCompElements.targetSize),
    measuredSizeMm: optionalInputNumber(cutterCompElements.measuredSize),
  };
}

function populateCutterTool(toolCandidate) {
  const tool = normalizeCutterTool(toolCandidate, 1);
  if (!tool) return;
  setNumberInput(cutterCompElements.toolNumber, tool.number);
  cutterCompElements.toolLabel.value = tool.label;
  setNumberInput(cutterCompElements.programmedDiameter, tool.programmedDiameterMm);
  setNumberInput(cutterCompElements.measuredDiameter, tool.measuredDiameterMm);
  setCutterMode(tool.correctionMode);
  setCutterFeatureType(tool.featureType);
  setNumberInput(cutterCompElements.targetSize, tool.targetSizeMm);
  setNumberInput(cutterCompElements.measuredSize, tool.measuredSizeMm);
  setNumberInput(cutterCompElements.maxFeatureError, cutterCompProfile.maxFeatureErrorMm);
}

function activeLiveTool() {
  if (runtime.live && Number.isInteger(runtime.telemetry?.tool)) return runtime.telemetry.tool;
  return null;
}

function currentJobTools() {
  return jobToolNumbers(job, activeLiveTool() ?? 1);
}

function toolDiameterSummary(tool) {
  const programmed = Number.isFinite(tool.programmedDiameterMm)
    ? tool.programmedDiameterMm.toFixed(3)
    : "---";
  const measured = Number.isFinite(tool.measuredDiameterMm)
    ? tool.measuredDiameterMm.toFixed(3)
    : "---";
  return `${programmed} / ${measured} mm`;
}

function renderCutterToolLists(activeNumber) {
  const detected = currentJobTools();
  cutterCompElements.jobTools.value = detected.length > 0
    ? detected.map((number) => `T${number}`).join(" / ")
    : "NONE";
  cutterCompElements.jobToolList.replaceChildren(...detected.map((number) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.cutterLoadTool = String(number);
    button.dataset.saved = cutterCompProfile.tools[String(number)] ? "true" : "false";
    button.setAttribute("aria-pressed", number === activeNumber ? "true" : "false");
    button.textContent = `T${number}`;
    button.title = button.dataset.saved === "true" ? "Load saved tool" : "Create tool profile";
    return button;
  }));

  const tools = Object.values(cutterCompProfile.tools).sort((a, b) => a.number - b.number);
  cutterCompElements.savedToolList.replaceChildren(...tools.map((tool) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.cutterLoadTool = String(tool.number);
    button.setAttribute("aria-pressed", tool.number === activeNumber ? "true" : "false");
    const number = document.createElement("strong");
    number.textContent = `T${tool.number}`;
    const label = document.createElement("span");
    label.textContent = tool.label;
    const diameter = document.createElement("small");
    diameter.textContent = toolDiameterSummary(tool);
    button.append(number, label, diameter);
    return button;
  }));
}

function signedMillimeters(value) {
  if (!Number.isFinite(value)) return "--.--- mm";
  const normalized = Math.abs(value) < 0.0005 ? 0 : value;
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(3)} mm`;
}

function renderCutterCompensation(message = "") {
  const tool = collectCutterTool();
  const maxFeatureErrorMm = optionalInputNumber(cutterCompElements.maxFeatureError);
  const evaluation = evaluateCutterCompensation(tool, { maxFeatureErrorMm });
  const activeNumber = Number.isInteger(tool.number) ? tool.number : cutterCompProfile.activeTool;
  renderCutterToolLists(activeNumber);

  const recommendation = evaluation.recommendation;
  cutterCompElements.nextDiameter.value = recommendation
    ? `${recommendation.nextFusionDiameterMm.toFixed(3)} mm`
    : "--.--- mm";
  cutterCompElements.diameterAdjustment.value = recommendation
    ? signedMillimeters(recommendation.diameterAdjustmentMm)
    : "--.--- mm";
  cutterCompElements.radialShift.value = recommendation
    ? `${recommendation.radialPathShiftMm.toFixed(3)} mm`
    : "--.--- mm";
  cutterCompElements.featureError.value = Number.isFinite(recommendation?.featureErrorMm)
    ? signedMillimeters(recommendation.featureErrorMm)
    : "N/A";
  cutterCompElements.nextDiameter.dataset.state = evaluation.ready ? "" : "alarm";
  cutterCompElements.save.disabled = !evaluation.valid;
  cutterCompElements.delete.disabled = !cutterCompProfile.tools[String(activeNumber)];

  for (const input of [
    cutterCompElements.toolNumber,
    cutterCompElements.programmedDiameter,
    cutterCompElements.measuredDiameter,
    cutterCompElements.targetSize,
    cutterCompElements.measuredSize,
    cutterCompElements.maxFeatureError,
  ]) input.dataset.invalid = "false";
  const errorText = evaluation.errors.join(" ");
  if (/Tool number/.test(errorText)) cutterCompElements.toolNumber.dataset.invalid = "true";
  if (/Fusion diameter/.test(errorText)) cutterCompElements.programmedDiameter.dataset.invalid = "true";
  if (/Measured cutter/.test(errorText)) cutterCompElements.measuredDiameter.dataset.invalid = "true";
  if (/Target feature/.test(errorText)) cutterCompElements.targetSize.dataset.invalid = "true";
  if (/Measured feature/.test(errorText)) cutterCompElements.measuredSize.dataset.invalid = "true";
  if (/Feature error limit/.test(errorText)) cutterCompElements.maxFeatureError.dataset.invalid = "true";

  if (!evaluation.valid) {
    cutterCompElements.validation.textContent = evaluation.errors.join(" ").toUpperCase();
    cutterCompElements.validation.dataset.state = "alarm";
  } else if (!evaluation.ready) {
    cutterCompElements.validation.textContent = `HOLD / ${evaluation.holds.join(" ")}`.toUpperCase();
    cutterCompElements.validation.dataset.state = "alarm";
  } else {
    cutterCompElements.validation.textContent = message || "READY / ENTER VALUE IN FUSION AND REPOST";
    cutterCompElements.validation.dataset.state = "valid";
  }
  return evaluation;
}

function loadCutterToolIntoForm(toolNumber) {
  const number = Number(toolNumber);
  const tool = cutterCompProfile.tools[String(number)] ?? {
    number,
    label: `TOOL ${number}`,
    programmedDiameterMm: null,
    measuredDiameterMm: null,
    correctionMode: "tool",
    featureType: "external",
    targetSizeMm: null,
    measuredSizeMm: null,
  };
  populateCutterTool(tool);
  renderCutterCompensation();
}

function setCutterCompPanel(open, restoreFocus = true) {
  if (open && elements.controllerSettingsPanel.getAttribute("aria-hidden") === "false") {
    setControllerSettingsPanel(false, false);
  }
  if (open && elements.machineDataPanel.getAttribute("aria-hidden") === "false") {
    setMachineDataPanel(false, false);
  }
  if (open && elements.sceneRegistrationPanel.getAttribute("aria-hidden") === "false") {
    setSceneRegistrationPanel(false, false);
  }
  if (open && elements.metrologyPanel.getAttribute("aria-hidden") === "false") {
    setMetrologyPanel(false, false);
  }
  if (open && elements.fixtureMapPanel.getAttribute("aria-hidden") === "false") {
    setFixtureMapPanel(false, false);
  }
  if (open && elements.probingPanel.getAttribute("aria-hidden") === "false") {
    setProbingPanel(false, false);
  }
  if (open && elements.spindlePanel.getAttribute("aria-hidden") === "false") {
    setSpindlePanel(false, false);
  }
  if (open && elements.wiringPanel.getAttribute("aria-hidden") === "false") {
    setWiringPanel(false, false);
  }
  if (open && elements.jogPanel.getAttribute("aria-hidden") === "false") {
    setJogPanel(false, false);
  }
  elements.cutterCompPanel.classList.toggle("open", open);
  elements.cutterCompScrim.classList.toggle("open", open);
  elements.cutterCompPanel.inert = !open;
  elements.cutterCompPanel.setAttribute("aria-hidden", open ? "false" : "true");
  elements.openCutterComp.setAttribute("aria-pressed", open ? "true" : "false");
  elements.cutterCompScrim.tabIndex = open ? 0 : -1;
  if (open) {
    if (!runtime.live && runtime.playing) holdPreview();
    const active = cutterCompProfile.tools[String(cutterCompProfile.activeTool)];
    populateCutterTool(active);
    renderCutterCompensation();
    elements.cutterCompPanel.querySelector(".cutter-comp-scroll").scrollTop = 0;
    elements.closeCutterComp.focus();
  } else if (restoreFocus) {
    elements.openCutterComp.focus();
  }
}

function selectedMetrologySpace() {
  return metrologyElements.spaceButtons.find((button) => button.getAttribute("aria-pressed") === "true")
    ?.dataset.metrologySpace ?? "work";
}

function setMetrologySpace(space) {
  const selected = space === "machine" ? "machine" : "work";
  metrologyElements.spaceButtons.forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.metrologySpace === selected ? "true" : "false");
  });
}

function selectedMetrologyPointMode() {
  return metrologyElements.pointModeButtons.find((button) => button.getAttribute("aria-pressed") === "true")
    ?.dataset.metrologyPointMode ?? "raw";
}

function setMetrologyPointMode(mode) {
  const selected = mode === "corrected" ? "corrected" : "raw";
  metrologyElements.pointModeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.metrologyPointMode === selected ? "true" : "false");
  });
}

function populateMetrologyForm(session) {
  metrologyElements.sessionName.value = session.name;
  setMetrologySpace(session.coordinateSpace);
  setMetrologyPointMode(session.pointMode);
  metrologyElements.captureArmed.checked = session.captureArmed;
  metrologyElements.contactDirection.value = session.captureDirection ?? "";
  metrologyElements.analysisMode.value = session.analysisMode;
  setNumberInput(metrologyElements.tolerance, session.toleranceMm);
  setNumberInput(metrologyElements.nominalSize, session.nominalSizeMm);
}

function collectMetrologySession() {
  return {
    ...metrologySession,
    name: metrologyElements.sessionName.value,
    coordinateSpace: selectedMetrologySpace(),
    pointMode: selectedMetrologyPointMode(),
    captureArmed: metrologyElements.captureArmed.checked,
    captureDirection: metrologyElements.contactDirection.value,
    analysisMode: metrologyElements.analysisMode.value,
    toleranceMm: inputNumber(metrologyElements.tolerance),
    nominalSizeMm: optionalInputNumber(metrologyElements.nominalSize),
  };
}

function populateProbeCalibrationForm(profileCandidate) {
  const profile = normalizeProbeCalibration(profileCandidate);
  metrologyElements.probeId.value = profile.probeId;
  metrologyElements.probeName.value = profile.probeName;
  setNumberInput(metrologyElements.ballDiameter, profile.ballDiameterMm);
  setNumberInput(metrologyElements.stylusLength, profile.stylusLengthMm);
  setNumberInput(metrologyElements.tipOffsetX, profile.tipOffsetMm.x);
  setNumberInput(metrologyElements.tipOffsetY, profile.tipOffsetMm.y);
  setNumberInput(metrologyElements.tipOffsetZ, profile.tipOffsetMm.z);
  metrologyElements.artifactType.value = profile.artifact.type;
  metrologyElements.artifactId.value = profile.artifact.id;
  setNumberInput(metrologyElements.artifactSize, profile.artifact.nominalSizeMm);
  metrologyElements.calibratedAt.value = profile.calibratedAt?.slice(0, 10) ?? "";
  setNumberInput(metrologyElements.repeatability, profile.repeatabilityMm);
  setNumberInput(metrologyElements.repeatabilityLimit, profile.repeatabilityLimitMm);
  setNumberInput(metrologyElements.sampleCount, profile.sampleCount);
  setNumberInput(metrologyElements.validDays, profile.validForDays);
  metrologyElements.directionRadii.forEach((input) => {
    setNumberInput(input, profile.effectiveRadiusMm[input.dataset.metrologyRadius]);
  });
}

function collectProbeCalibration() {
  const calibratedDate = metrologyElements.calibratedAt.value;
  return normalizeProbeCalibration({
    ...probeCalibration,
    probeId: metrologyElements.probeId.value,
    probeName: metrologyElements.probeName.value,
    ballDiameterMm: optionalInputNumber(metrologyElements.ballDiameter),
    stylusLengthMm: optionalInputNumber(metrologyElements.stylusLength),
    tipOffsetMm: {
      x: optionalInputNumber(metrologyElements.tipOffsetX),
      y: optionalInputNumber(metrologyElements.tipOffsetY),
      z: optionalInputNumber(metrologyElements.tipOffsetZ),
    },
    effectiveRadiusMm: Object.fromEntries(metrologyElements.directionRadii.map((input) => [
      input.dataset.metrologyRadius,
      optionalInputNumber(input),
    ])),
    repeatabilityMm: optionalInputNumber(metrologyElements.repeatability),
    repeatabilityLimitMm: optionalInputNumber(metrologyElements.repeatabilityLimit),
    sampleCount: optionalInputNumber(metrologyElements.sampleCount),
    calibratedAt: calibratedDate ? `${calibratedDate}T00:00:00.000Z` : null,
    validForDays: optionalInputNumber(metrologyElements.validDays),
    artifact: {
      type: metrologyElements.artifactType.value,
      id: metrologyElements.artifactId.value,
      nominalSizeMm: optionalInputNumber(metrologyElements.artifactSize),
    },
  });
}

function renderProbeCalibration(profileCandidate = collectProbeCalibration()) {
  const evaluation = evaluateProbeCalibration(profileCandidate);
  const directionCount = evaluation.readyDirections.length;
  setIndicator(
    metrologyElements.probeCalibrationState,
    evaluation.qualified ? "6 OF 6" : `${directionCount} OF 6`,
    evaluation.qualified ? "active" : "alarm",
  );
  if (evaluation.qualified) {
    metrologyElements.calibrationValidation.textContent = `QUALIFIED / ${evaluation.profile.probeId} / ${evaluation.ageDays.toFixed(1)} DAYS OLD`;
    metrologyElements.calibrationValidation.dataset.state = "valid";
  } else if (evaluation.usable) {
    metrologyElements.calibrationValidation.textContent = `PARTIAL / ${directionCount} DIRECTIONS / UNCALIBRATED DIRECTIONS REMAIN RAW`;
    metrologyElements.calibrationValidation.dataset.state = "alarm";
  } else {
    metrologyElements.calibrationValidation.textContent = evaluation.reasons[0] ?? "PROBE CALIBRATION REQUIRED";
    metrologyElements.calibrationValidation.dataset.state = "alarm";
  }
  return evaluation;
}

function metrologyContext() {
  const wcs = runtime.telemetry?.workCoordinateSystem ?? null;
  return {
    workOffset: runtime.telemetry?.position?.wco ?? null,
    wcs,
    fixtureOffset: fixtureOffsetForWorkCoordinate(wcs),
  };
}

function syncMetrologyOverlay() {
  const pointMode = metrologySession.pointMode;
  viewer?.setMetrologyPoints(metrologySession.points.map((point) => ({
    ...point,
    machine: pointMode === "corrected" ? point.correctedMachine : point.rawMachine,
    work: pointMode === "corrected" ? point.correctedWork : point.rawWork,
  })));
}

function metrologyMillimeters(value, digits = 3) {
  return Number.isFinite(value) ? `${value.toFixed(digits)} mm` : "--.--- mm";
}

function metrologySignedMillimeters(value) {
  if (!Number.isFinite(value)) return "--.--- mm";
  const normalized = Math.abs(value) < 0.0005 ? 0 : value;
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(3)} mm`;
}

function metrologyVector(vector, digits = 3) {
  return vector && [vector.x, vector.y, vector.z].every(Number.isFinite)
    ? `${vector.x.toFixed(digits)} / ${vector.y.toFixed(digits)} / ${vector.z.toFixed(digits)}`
    : "-- / -- / --";
}

function appendMetrologyMetric(label, value, state = "") {
  const row = document.createElement("div");
  const name = document.createElement("span");
  name.textContent = label;
  const output = document.createElement("output");
  output.value = value;
  output.dataset.state = state;
  row.append(name, output);
  metrologyElements.resultGrid.append(row);
}

function renderMetrologyResult(analysis) {
  metrologyElements.resultGrid.replaceChildren();
  metrologyElements.resultLabel.textContent = analysis.requestedMode === "auto"
    ? "AUTO CLASSIFIED"
    : "REQUESTED FIT";
  metrologyElements.resultValue.dataset.state = analysis.withinTolerance === false ? "alarm" : "";
  const result = analysis.result;
  if (!result) {
    metrologyElements.resultType.textContent = analysis.pointCount === 0 ? "WAITING FOR POINTS" : "MORE POINTS REQUIRED";
    metrologyElements.resultValue.value = "--.--- mm";
    return;
  }

  if (result.type === "point") {
    metrologyElements.resultType.textContent = "SINGLE POINT";
    metrologyElements.resultValue.value = metrologyVector(result.position);
    appendMetrologyMetric("COORDINATE FRAME", analysis.coordinateSpace.toUpperCase());
  } else if (result.type === "distance") {
    metrologyElements.resultType.textContent = "TWO-POINT DISTANCE";
    metrologyElements.resultValue.value = metrologyMillimeters(result.distanceMm);
    appendMetrologyMetric("DELTA XYZ", metrologyVector(result.delta));
  } else if (result.type === "circle") {
    metrologyElements.resultType.textContent = "CIRCLE / BORE XY";
    metrologyElements.resultValue.value = metrologyMillimeters(result.diameterMm);
    appendMetrologyMetric("CENTER XYZ", metrologyVector(result.center));
    appendMetrologyMetric("RADIUS", metrologyMillimeters(result.radiusMm));
    appendMetrologyMetric("RMS RESIDUAL", metrologyMillimeters(result.rmsMm, 4));
    appendMetrologyMetric("MAX RESIDUAL", metrologyMillimeters(result.maximumResidualMm, 4));
    appendMetrologyMetric("RADIAL RANGE", metrologyMillimeters(result.rangeMm, 4));
    appendMetrologyMetric("ANGULAR COVERAGE", `${result.angularCoverageDeg.toFixed(1)} deg`);
    appendMetrologyMetric("Z RANGE", metrologyMillimeters(result.zRangeMm, 4));
  } else if (result.type === "line") {
    metrologyElements.resultType.textContent = "LINE / EDGE XY";
    metrologyElements.resultValue.value = metrologyMillimeters(result.lengthMm);
    appendMetrologyMetric("CENTER XYZ", metrologyVector(result.center));
    appendMetrologyMetric("ANGLE", `${result.angleDeg.toFixed(3)} deg`);
    appendMetrologyMetric("STRAIGHTNESS", metrologyMillimeters(result.straightnessMm, 4));
    appendMetrologyMetric("RMS RESIDUAL", metrologyMillimeters(result.rmsMm, 4));
    appendMetrologyMetric("MAX RESIDUAL", metrologyMillimeters(result.maximumResidualMm, 4));
  } else if (result.type === "plane") {
    metrologyElements.resultType.textContent = "PLANE XYZ";
    metrologyElements.resultValue.value = metrologyMillimeters(result.flatnessMm, 4);
    appendMetrologyMetric("CENTER XYZ", metrologyVector(result.center));
    appendMetrologyMetric("NORMAL XYZ", metrologyVector(result.normal, 5));
    appendMetrologyMetric("TILT", `${result.tiltDeg.toFixed(4)} deg`);
    appendMetrologyMetric("AZIMUTH", `${result.azimuthDeg.toFixed(3)} deg`);
    appendMetrologyMetric("RMS RESIDUAL", metrologyMillimeters(result.rmsMm, 4));
    appendMetrologyMetric("MAX RESIDUAL", metrologyMillimeters(result.maximumResidualMm, 4));
  }

  appendMetrologyMetric(
    "POINT DATA",
    analysis.pointMode === "corrected" ? "CORRECTED SURFACE" : "RAW CONTROLLER",
    analysis.pointMode === "corrected" ? "active" : "",
  );
  appendMetrologyMetric("FIT QUALITY", `${analysis.quality.label} / ${(analysis.quality.score * 100).toFixed(0)} %`, analysis.quality.label === "LOW" ? "alarm" : "active");
  if (Number.isFinite(analysis.nominalSizeMm)) {
    appendMetrologyMetric("NOMINAL", metrologyMillimeters(analysis.nominalSizeMm));
  }
  if (Number.isFinite(analysis.deviationMm)) {
    appendMetrologyMetric(
      "SIZE DEVIATION",
      metrologySignedMillimeters(analysis.deviationMm),
      analysis.withinTolerance ? "active" : "alarm",
    );
  }
  if (analysis.withinTolerance !== null) {
    appendMetrologyMetric(
      "TOLERANCE",
      analysis.withinTolerance ? "PASS" : "FAIL",
      analysis.withinTolerance ? "active" : "alarm",
    );
  }
}

function renderMetrologyPointList(coordinateSpace) {
  const visiblePoints = metrologySession.points.slice(-100).reverse();
  if (visiblePoints.length === 0) {
    const empty = document.createElement("div");
    empty.className = "metrology-empty-points";
    empty.textContent = "NO CAPTURED POINTS";
    metrologyElements.pointList.replaceChildren(empty);
    return;
  }
  metrologyElements.pointList.replaceChildren(...visiblePoints.map((point) => {
    const row = document.createElement("div");
    row.className = "metrology-point-row";
    const sequence = document.createElement("span");
    sequence.textContent = `#${point.sequence}`;
    const source = document.createElement("strong");
    source.textContent = point.source.toUpperCase();
    const coordinates = document.createElement("code");
    const coordinatesValue = selectedMetrologyPointMode() === "corrected"
      ? point[coordinateSpace === "machine" ? "correctedMachine" : "correctedWork"]
      : point[coordinateSpace === "machine" ? "rawMachine" : "rawWork"];
    coordinates.textContent = metrologyVector(coordinatesValue);
    const wcs = document.createElement("small");
    wcs.textContent = point.direction
      ? `${point.direction.toUpperCase()} / ${point.compensation?.probeId ?? "RAW"}`
      : point.wcs ?? coordinateSpace.toUpperCase();
    row.append(sequence, source, coordinates, wcs);
    return row;
  }));
}

function renderMetrology(message = "") {
  const draft = collectMetrologySession();
  const toleranceValid = metrologyElements.tolerance.checkValidity()
    && metrologyElements.tolerance.value.trim() !== "";
  const nominalValid = metrologyElements.nominalSize.value.trim() === ""
    || metrologyElements.nominalSize.checkValidity();
  metrologyElements.tolerance.dataset.invalid = toleranceValid ? "false" : "true";
  metrologyElements.nominalSize.dataset.invalid = nominalValid ? "false" : "true";
  const analysis = analyzeMetrology(draft, {
    coordinateSpace: draft.coordinateSpace,
    pointMode: draft.pointMode,
    analysisMode: draft.analysisMode,
    toleranceMm: draft.toleranceMm,
    nominalSizeMm: draft.nominalSizeMm,
  });
  const controls = runtime.telemetry?.pins?.controls;
  renderProbeCalibration();
  if (!runtime.live) setIndicator(metrologyElements.probeLink, "OFFLINE");
  else if (controls?.probeDisconnected) setIndicator(metrologyElements.probeLink, "DISCONNECTED", "alarm");
  else setIndicator(metrologyElements.probeLink, "LIVE", "active");
  if (draft.captureArmed && runtime.live) setIndicator(metrologyElements.captureState, "ARMED", "active");
  else if (draft.captureArmed) setIndicator(metrologyElements.captureState, "WAIT LINK", "alarm");
  else setIndicator(metrologyElements.captureState, "HELD");
  metrologyElements.pointCount.value = analysis.excludedPointCount > 0
    ? `${analysis.pointCount} / ${metrologySession.points.length}`
    : String(metrologySession.points.length);

  if (lastMetrologyProbeEvent) {
    setIndicator(
      metrologyElements.lastProbeState,
      lastMetrologyProbeEvent.success ? "CONTACT" : "NO CONTACT",
      lastMetrologyProbeEvent.success ? "active" : "alarm",
    );
    metrologyElements.lastProbePosition.value = metrologyVector(lastMetrologyProbeEvent.position);
    metrologyElements.lastCorrectedPosition.value = metrologyVector(lastMetrologyProbePoint?.correctedMachine);
  } else {
    setIndicator(metrologyElements.lastProbeState, "NO HIT");
    metrologyElements.lastProbePosition.value = "-- / -- / --";
    metrologyElements.lastCorrectedPosition.value = "-- / -- / --";
  }
  const lastAlreadyCaptured = lastMetrologyProbePoint
    && metrologySession.points.some(({ id }) => id === lastMetrologyProbePoint.id);
  metrologyElements.addLastProbe.disabled = !lastMetrologyProbePoint || lastAlreadyCaptured;
  metrologyElements.removeLast.disabled = metrologySession.points.length === 0;
  metrologyElements.clear.disabled = metrologySession.points.length === 0;
  metrologyElements.exportButtons.forEach((button) => {
    button.disabled = analysis.pointCount === 0;
  });
  renderMetrologyResult(analysis);
  renderMetrologyPointList(draft.coordinateSpace);

  if (!toleranceValid || !nominalValid) {
    metrologyElements.validation.textContent = "TOLERANCE OR NOMINAL SIZE IS OUTSIDE THE ALLOWED RANGE";
    metrologyElements.validation.dataset.state = "alarm";
  } else if (analysis.pointCount === 0 && analysis.excludedPointCount > 0) {
    metrologyElements.validation.textContent = draft.pointMode === "corrected"
      ? `NO QUALIFIED CORRECTIONS / ${analysis.excludedPointCount} RAW POINTS PRESERVED`
      : `NO ${draft.coordinateSpace.toUpperCase()} COORDINATES / ${analysis.excludedPointCount} POINTS EXCLUDED`;
    metrologyElements.validation.dataset.state = "alarm";
  } else if (analysis.pointCount === 0) {
    metrologyElements.validation.textContent = message || "SESSION READY / CAPTURE HELD";
    metrologyElements.validation.dataset.state = "";
  } else if (!analysis.result) {
    metrologyElements.validation.textContent = `${draft.analysisMode.toUpperCase()} FIT NEEDS MORE VALID POINTS`;
    metrologyElements.validation.dataset.state = "alarm";
  } else if (analysis.withinTolerance === false) {
    metrologyElements.validation.textContent = "OUT OF TOLERANCE / REVIEW FIT AND SETUP";
    metrologyElements.validation.dataset.state = "alarm";
  } else if (analysis.quality.label === "LOW" && !["point", "distance"].includes(analysis.result.type)) {
    metrologyElements.validation.textContent = "LOW FIT CONFIDENCE / ADD WELL-SPACED POINTS";
    metrologyElements.validation.dataset.state = "alarm";
  } else if (analysis.excludedPointCount > 0) {
    metrologyElements.validation.textContent = draft.pointMode === "corrected"
      ? `${analysis.excludedPointCount} POINTS LACK A QUALIFIED DIRECTIONAL CORRECTION`
      : `${analysis.excludedPointCount} POINTS EXCLUDED FROM ${draft.coordinateSpace.toUpperCase()} FIT`;
    metrologyElements.validation.dataset.state = "alarm";
  } else {
    metrologyElements.validation.textContent = message || `${analysis.recommendedMode.toUpperCase()} FIT READY / ${analysis.quality.label} CONFIDENCE`;
    metrologyElements.validation.dataset.state = "valid";
  }
  return analysis;
}

function saveMetrologyDraft(message = "SESSION SAVED") {
  if (!metrologyElements.tolerance.checkValidity()
    || (metrologyElements.nominalSize.value && !metrologyElements.nominalSize.checkValidity())) {
    renderMetrology();
    return false;
  }
  metrologySession = saveMetrologySession(normalizeMetrologySession(collectMetrologySession()), configurationStorage);
  syncMetrologyOverlay();
  renderMetrology(message);
  return true;
}

function addPointToMetrologySession(point, message) {
  try {
    metrologySession = saveMetrologySession(addMetrologyPoint(collectMetrologySession(), point), configurationStorage);
    populateMetrologyForm(metrologySession);
    syncMetrologyOverlay();
    renderMetrology(message);
    return true;
  } catch (error) {
    metrologyElements.validation.textContent = error instanceof Error ? error.message.toUpperCase() : "POINT CAPTURE FAILED";
    metrologyElements.validation.dataset.state = "alarm";
    return false;
  }
}

function typedProbeDirection(measurement) {
  if (!["x", "y", "z"].includes(measurement?.axis)) return null;
  if (measurement.direction !== -1 && measurement.direction !== 1) return null;
  return `${measurement.direction > 0 ? "+" : "-"}${measurement.axis}`;
}

function ingestTypedProbeTransaction(transaction) {
  if (transaction?.state !== "completed"
    || transaction.intent?.type !== "touch-probe"
    || runtime.capturedProbeTransactionIds.has(transaction.id)) return;
  runtime.capturedProbeTransactionIds.add(transaction.id);
  const measurements = Array.isArray(transaction.result?.measurements)
    ? transaction.result.measurements
    : [];
  if (measurements.length === 0) return;

  const calibration = evaluateProbeCalibration(probeCalibration);
  const tipMatchesCalibration = calibration.qualified
    && Math.abs(calibration.profile.ballDiameterMm - transaction.intent.settings.tipDiameter) <= 0.001;
  const correctionProfile = tipMatchesCalibration ? probeCalibration : null;
  const capturedAt = transaction.completedAt ?? Date.now();
  const fixtureOffset = fixtureOffsetForWorkCoordinate(runtime.telemetry?.workCoordinateSystem);
  const points = measurements.map((measurement, index) => {
    const event = {
      type: "probe",
      position: measurement.rawCenter,
      success: true,
      receivedAt: capturedAt,
    };
    return createProbeMetrologyPoint(event, runtime.telemetry, {
      id: `typed-${transaction.id}-${measurement.id ?? index + 1}`,
      capturedAt,
      fixtureOffset,
      direction: typedProbeDirection(measurement),
      probeCalibration: correctionProfile,
    });
  });
  const lastMeasurement = measurements.at(-1);
  lastMetrologyProbeEvent = {
    type: "probe",
    position: { ...lastMeasurement.rawCenter },
    success: true,
    receivedAt: capturedAt,
  };
  lastMetrologyProbePoint = points.at(-1);

  if (!metrologySession.captureArmed) {
    renderMetrology(`${points.length} VERIFIED DIRECTIONAL CONTACTS READY / CAPTURE HELD`);
    return;
  }
  try {
    let nextSession = collectMetrologySession();
    if (transaction.result?.cycle === "bore-center") {
      nextSession = {
        ...nextSession,
        analysisMode: "circle",
        nominalSizeMm: transaction.intent.settings.featureDiameter,
      };
    }
    for (const point of points) nextSession = addMetrologyPoint(nextSession, point);
    metrologySession = saveMetrologySession(nextSession, configurationStorage);
    populateMetrologyForm(metrologySession);
    syncMetrologyOverlay();
    renderMetrology(`${points.length} VERIFIED DIRECTIONAL CONTACTS CAPTURED`);
  } catch (error) {
    metrologyElements.validation.textContent = error instanceof Error
      ? error.message.toUpperCase()
      : "TYPED PROBE CAPTURE FAILED";
    metrologyElements.validation.dataset.state = "alarm";
  }
}

function recordMetrologyProbeEvent(event) {
  lastMetrologyProbeEvent = event;
  lastMetrologyProbePoint = null;
  const typedCycleOwnsContact = runtime.typedProbeCycleActive
    || (runtime.transaction?.intent?.type === "touch-probe" && !transactionIsTerminal(runtime.transaction));
  if (typedCycleOwnsContact) {
    renderMetrology(event.success
      ? "TYPED PROBE CONTACT / WAITING FOR VERIFIED CYCLE RESULT"
      : "TYPED PROBE FAILED / POINT NOT RECORDED");
    return;
  }
  if (event.success) {
    try {
      metrologyProbeSequence += 1;
      lastMetrologyProbePoint = createProbeMetrologyPoint(event, runtime.telemetry, {
        id: `probe-${event.receivedAt ?? Date.now()}-${metrologyProbeSequence}`,
        capturedAt: event.receivedAt ?? Date.now(),
        fixtureOffset: fixtureOffsetForWorkCoordinate(runtime.telemetry?.workCoordinateSystem),
        direction: collectMetrologySession().captureDirection,
        probeCalibration,
      });
      if (metrologySession.captureArmed) {
        addPointToMetrologySession(lastMetrologyProbePoint, "PROBE HIT CAPTURED / FIT UPDATED");
        return;
      }
    } catch (error) {
      metrologyElements.validation.textContent = error instanceof Error ? error.message.toUpperCase() : "PROBE CAPTURE FAILED";
      metrologyElements.validation.dataset.state = "alarm";
    }
  }
  renderMetrology(event.success ? "PROBE HIT READY / CAPTURE HELD" : "PROBE FAILED / POINT NOT RECORDED");
}

function downloadMetrologyFile(format) {
  const space = selectedMetrologySpace();
  const exporters = {
    csv: { content: () => exportMetrologyCsv(metrologySession, space), type: "text/csv", extension: "csv" },
    xyz: { content: () => exportMetrologyXyz(metrologySession, space), type: "text/plain", extension: "xyz" },
    ply: { content: () => exportMetrologyPly(metrologySession, space), type: "text/plain", extension: "ply" },
    json: { content: () => exportMetrologyJson(metrologySession), type: "application/json", extension: "json" },
  };
  const exporter = exporters[format];
  if (!exporter) return;
  const safeName = metrologySession.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "mr1-metrology";
  const blob = new Blob([exporter.content()], { type: `${exporter.type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeName}-${space}.${exporter.extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  renderMetrology(`${format.toUpperCase()} EXPORT READY / ${space.toUpperCase()} COORDINATES`);
}

function setMetrologyPanel(open, restoreFocus = true) {
  if (open && elements.controllerSettingsPanel.getAttribute("aria-hidden") === "false") {
    setControllerSettingsPanel(false, false);
  }
  if (open && elements.machineDataPanel.getAttribute("aria-hidden") === "false") setMachineDataPanel(false, false);
  if (open && elements.sceneRegistrationPanel.getAttribute("aria-hidden") === "false") setSceneRegistrationPanel(false, false);
  if (open && elements.fixtureMapPanel.getAttribute("aria-hidden") === "false") setFixtureMapPanel(false, false);
  if (open && elements.cutterCompPanel.getAttribute("aria-hidden") === "false") setCutterCompPanel(false, false);
  if (open && elements.probingPanel.getAttribute("aria-hidden") === "false") setProbingPanel(false, false);
  if (open && elements.spindlePanel.getAttribute("aria-hidden") === "false") setSpindlePanel(false, false);
  if (open && elements.wiringPanel.getAttribute("aria-hidden") === "false") setWiringPanel(false, false);
  if (open && elements.jogPanel.getAttribute("aria-hidden") === "false") setJogPanel(false, false);
  elements.metrologyPanel.classList.toggle("open", open);
  elements.metrologyScrim.classList.toggle("open", open);
  elements.metrologyPanel.inert = !open;
  elements.metrologyPanel.setAttribute("aria-hidden", open ? "false" : "true");
  elements.openMetrology.setAttribute("aria-pressed", open ? "true" : "false");
  elements.metrologyScrim.tabIndex = open ? 0 : -1;
  if (open) {
    if (!runtime.live && runtime.playing) holdPreview();
    setViewMode("machine");
    populateMetrologyForm(metrologySession);
    renderMetrology();
    elements.metrologyPanel.querySelector(".metrology-scroll").scrollTop = 0;
    elements.closeMetrology.focus();
  } else if (restoreFocus) {
    elements.openMetrology.focus();
  }
}

function collectSetterSettings() {
  return {
    x: optionalInputNumber(elements.setterX),
    y: optionalInputNumber(elements.setterY),
    travelZ: optionalInputNumber(elements.setterTravelZ),
    referenceContactZ: optionalInputNumber(elements.setterReferenceContactZ),
    referenceGaugeLength: optionalInputNumber(elements.setterReferenceGaugeLength),
    currentToolNumber: optionalInputNumber(elements.setterToolNumber),
    currentGaugeLength: optionalInputNumber(elements.setterCurrentGaugeLength),
    approachClearance: inputNumber(elements.setterClearance),
    maxSearch: inputNumber(elements.setterSearch),
    retractDistance: inputNumber(elements.setterRetract),
    guardedApproachFeed: inputNumber(elements.setterGuardFeed),
    latchPullOff: inputNumber(elements.setterLatchPullOff),
    seekFeed: inputNumber(elements.setterSeekFeed),
    latchFeed: inputNumber(elements.setterLatchFeed),
    retractFeed: inputNumber(elements.setterRetractFeed),
    doubleTouch: elements.setterDoubleTouch.checked,
  };
}

function collectTouchSettings() {
  return {
    cycle: elements.touchCycle.value,
    tipDiameter: inputNumber(elements.touchTipDiameter),
    targetX: optionalInputNumber(elements.touchTargetX),
    targetY: optionalInputNumber(elements.touchTargetY),
    targetZ: optionalInputNumber(elements.touchTargetZ),
    safeZ: optionalInputNumber(elements.touchSafeZ),
    measurementZ: optionalInputNumber(elements.touchMeasurementZ),
    directionX: Number(elements.touchDirectionX.value),
    directionY: Number(elements.touchDirectionY.value),
    featureDiameter: optionalInputNumber(elements.touchFeatureDiameter),
    cornerSampleOffset: inputNumber(elements.touchCornerOffset),
    approachClearance: inputNumber(elements.touchClearance),
    maxSearch: inputNumber(elements.touchSearch),
    retractDistance: inputNumber(elements.touchRetract),
    guardedApproachFeed: inputNumber(elements.touchGuardFeed),
    latchPullOff: inputNumber(elements.touchLatchPullOff),
    seekFeed: inputNumber(elements.touchSeekFeed),
    latchFeed: inputNumber(elements.touchLatchFeed),
    retractFeed: inputNumber(elements.touchRetractFeed),
    doubleTouch: elements.touchDoubleTouch.checked,
  };
}

function markNativeValidity(form) {
  form.querySelectorAll("input[type=number]").forEach((input) => {
    input.dataset.invalid = input.value && !input.checkValidity() ? "true" : "false";
  });
}

let fixtureMapFormIssue = "";
let fixtureMapCanvasGeometry = null;

function fixtureAssignment(fixtureId = fixtureMapProfile.selectedFixtureId) {
  return WCS_FIXTURE_ASSIGNMENTS.find((assignment) => assignment.fixtureId === fixtureId);
}

function fixtureOffsetForWorkCoordinate(workOffset) {
  const assignment = WCS_FIXTURE_ASSIGNMENTS.find(({ wcs }) => wcs === workOffset);
  const candidate = assignment
    ? calculateFixtureWorkOffset(fixtureMapProfile, assignment.fixtureId)
    : null;
  return candidate?.cad && Number.isFinite(candidate.cad.x) && Number.isFinite(candidate.cad.y)
    ? { ...candidate.cad, wcs: workOffset, fixtureId: assignment.fixtureId }
    : null;
}

function selectedFixtureVise(profile = fixtureMapProfile) {
  return profile.vises.find(({ id }) => id === profile.selectedFixtureId) ?? null;
}

function selectedFixtureRotation() {
  const pressed = fixtureMapElements.rotationButtons.find(
    (button) => button.getAttribute("aria-pressed") === "true",
  );
  return Number(pressed?.dataset.fixtureRotation ?? 0);
}

function setFixtureRotationButtons(rotation, disabled = false) {
  fixtureMapElements.rotationButtons.forEach((button) => {
    button.disabled = disabled;
    button.setAttribute("aria-pressed", Number(button.dataset.fixtureRotation) === rotation ? "true" : "false");
  });
}

function setFixtureJawControls(opening, disabled = false) {
  const jaw = MR1_CONFIG.workholding.viseCad.movableJaw;
  const value = Number.isFinite(Number(opening)) ? Number(opening) : jaw.modelOpening;
  fixtureMapElements.jawOpening.disabled = disabled;
  fixtureMapElements.jawOpeningRange.disabled = disabled;
  fixtureMapElements.jawOpening.value = value.toFixed(1);
  fixtureMapElements.jawOpeningRange.value = String(value);
  fixtureMapElements.jawOpeningOutput.value = disabled ? "--" : `${value.toFixed(1)} mm`;
}

function populateSelectedFixtureControls() {
  const vise = selectedFixtureVise();
  const plateSelected = fixtureMapProfile.selectedFixtureId === "PLATE";
  fixtureMapElements.address.disabled = plateSelected;
  fixtureMapElements.address.required = !plateSelected;
  fixtureMapElements.address.placeholder = plateSelected ? "CENTER" : "D4";
  fixtureMapElements.address.value = plateSelected ? "" : vise?.address ?? "";
  setFixtureRotationButtons(vise?.rotation ?? 0, plateSelected);
  setFixtureJawControls(vise?.jawOpening, plateSelected);
}

function populateTableFrameCalibrationForm(candidate) {
  tableFrameCalibration = normalizeTableFrameCalibration(
    candidate ?? fixtureMapProfile.plateCalibration ?? DEFAULT_TABLE_FRAME_CALIBRATION,
  );
  setNumberInput(fixtureMapElements.calibrationMinimumReferences, tableFrameCalibration.quality.minimumReferences);
  setNumberInput(fixtureMapElements.calibrationMinimumCoverage, tableFrameCalibration.quality.minimumCoverageRatio * 100);
  setNumberInput(fixtureMapElements.calibrationMaximumRms, tableFrameCalibration.quality.maximumRmsErrorMm);
  setNumberInput(fixtureMapElements.calibrationMaximumPoint, tableFrameCalibration.quality.maximumPointErrorMm);
  setNumberInput(fixtureMapElements.calibrationMaximumScale, tableFrameCalibration.quality.maximumScaleErrorPpm);
  setNumberInput(fixtureMapElements.calibrationMaximumTilt, tableFrameCalibration.quality.maximumTiltDeg);
}

function collectTableFrameCalibrationDraft() {
  const quality = {
    ...tableFrameCalibration.quality,
    minimumReferences: inputNumber(fixtureMapElements.calibrationMinimumReferences),
    minimumCoverageRatio: inputNumber(fixtureMapElements.calibrationMinimumCoverage) / 100,
    maximumRmsErrorMm: inputNumber(fixtureMapElements.calibrationMaximumRms),
    maximumPointErrorMm: inputNumber(fixtureMapElements.calibrationMaximumPoint),
    maximumScaleErrorPpm: inputNumber(fixtureMapElements.calibrationMaximumScale),
    maximumTiltDeg: inputNumber(fixtureMapElements.calibrationMaximumTilt),
  };
  const qualityChanged = JSON.stringify(quality) !== JSON.stringify(tableFrameCalibration.quality);
  tableFrameCalibration = normalizeTableFrameCalibration({
    ...tableFrameCalibration,
    calibratedAt: qualityChanged ? null : tableFrameCalibration.calibratedAt,
    quality,
  });
  return tableFrameCalibration;
}

function setPlateFrameInputLock(locked) {
  [fixtureMapElements.frameX, fixtureMapElements.frameY, fixtureMapElements.frameZ, fixtureMapElements.frameRotation]
    .forEach((input) => {
      input.readOnly = locked;
      input.setAttribute("aria-readonly", locked ? "true" : "false");
    });
}

function tableFrameEvaluation() {
  const probeEvaluation = evaluateProbeCalibration(probeCalibration);
  return evaluateTableFrameCalibration(tableFrameCalibration, {
    probeQualified: probeEvaluation.qualified,
    machineHomed: fixtureMapElements.calibrationHomed.checked,
  });
}

function renderTableCalibrationReferenceList(evaluation) {
  if (!evaluation.profile.references.length) {
    const empty = document.createElement("div");
    empty.className = "scene-empty-list";
    empty.textContent = "NO TABLE CALIBRATION REFERENCES";
    fixtureMapElements.calibrationReferenceList.replaceChildren(empty);
    return;
  }
  const residualById = new Map((evaluation.xy?.residuals ?? []).map((residual) => [residual.id, residual]));
  const fragment = document.createDocumentFragment();
  evaluation.profile.references.forEach((reference) => {
    const residual = residualById.get(reference.id);
    const row = document.createElement("div");
    row.className = "table-calibration-reference-row";
    if (residual && !residual.inlier) row.dataset.state = "outlier";
    const address = document.createElement("strong");
    address.textContent = reference.address;
    const xy = document.createElement("code");
    xy.textContent = `X ${reference.machine.x.toFixed(3)} / Y ${reference.machine.y.toFixed(3)}`;
    const z = document.createElement("code");
    z.textContent = Number.isFinite(reference.topZ) ? `Z ${reference.topZ.toFixed(3)}` : "Z --";
    const error = document.createElement("output");
    error.value = Number.isFinite(residual?.errorMm)
      ? `${residual?.inlier === false ? "OUT / " : ""}${residual.errorMm.toFixed(3)}`
      : "-- mm";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${reference.address} table calibration reference`);
    remove.textContent = "×";
    remove.dataset.tableCalibrationRemove = reference.id;
    row.append(address, xy, z, error, remove);
    fragment.append(row);
  });
  fixtureMapElements.calibrationReferenceList.replaceChildren(fragment);
}

function renderTableFrameCalibration(message = "") {
  const evaluation = tableFrameEvaluation();
  const probeEvaluation = evaluateProbeCalibration(probeCalibration);
  const frameApplied = Boolean(evaluation.profile.calibratedAt)
    && tableCalibrationFrameMatches(evaluation.profile, fixtureMapProfile.plateFrame);
  const inliers = evaluation.xy?.inlierCount ?? 0;
  const outliers = evaluation.xy?.outlierCount ?? 0;
  fixtureMapElements.calibrationProbe.value = probeEvaluation.qualified ? probeEvaluation.profile.probeId : "REQUIRED";
  fixtureMapElements.calibrationProbe.dataset.state = probeEvaluation.qualified ? "active" : "alarm";
  fixtureMapElements.calibrationState.value = frameApplied ? "CALIBRATED" : evaluation.status;
  fixtureMapElements.calibrationState.dataset.state = frameApplied || evaluation.readyToApply ? "active" : "alarm";
  fixtureMapElements.calibrationConsensus.value = `${inliers} / ${outliers}`;
  fixtureMapElements.calibrationCoverage.value = Number.isFinite(evaluation.coverageRatio)
    ? `${(evaluation.coverageRatio * 100).toFixed(1)}%`
    : "--.-%";
  fixtureMapElements.calibrationXyError.value = evaluation.xy
    ? `${evaluation.xy.rmsErrorMm.toFixed(4)} / ${evaluation.xy.maximumErrorMm.toFixed(4)} mm`
    : "-- / -- mm";
  fixtureMapElements.calibrationScale.value = evaluation.xy
    ? `${evaluation.xy.scaleErrorPpm >= 0 ? "+" : ""}${evaluation.xy.scaleErrorPpm.toFixed(0)} ppm`
    : "-- ppm";
  fixtureMapElements.calibrationTopError.value = evaluation.top
    ? `${evaluation.top.rmsErrorMm.toFixed(4)} / ${evaluation.top.maximumErrorMm.toFixed(4)} mm`
    : "-- / -- mm";
  fixtureMapElements.calibrationTilt.value = evaluation.top
    ? `${evaluation.top.tiltXDeg.toFixed(4)} / ${evaluation.top.tiltYDeg.toFixed(4)} deg`
    : "-- / -- deg";
  fixtureMapElements.calibrationCenter.value = evaluation.frame
    ? `${evaluation.frame.x.toFixed(3)} / ${evaluation.frame.y.toFixed(3)} / ${evaluation.frame.z.toFixed(3)}`
    : "-- / -- / --";
  fixtureMapElements.calibrationYaw.value = evaluation.frame
    ? `${evaluation.frame.rotationDeg.toFixed(4)} deg`
    : "-- deg";
  fixtureMapElements.calibrationUseXy.disabled = !runtime.live
    || !Number.isFinite(runtime.telemetry?.position.machine?.x)
    || !Number.isFinite(runtime.telemetry?.position.machine?.y);
  fixtureMapElements.calibrationUseZ.disabled = !runtime.live
    || !Number.isFinite(runtime.telemetry?.position.machine?.z);
  fixtureMapElements.calibrationApply.disabled = frameApplied || !evaluation.readyToApply;
  fixtureMapElements.calibrationClear.disabled = evaluation.profile.references.length === 0;
  setPlateFrameInputLock(Boolean(tableFrameCalibration.calibratedAt));
  renderTableCalibrationReferenceList(evaluation);

  const validation = message
    || evaluation.errors[0]
    || (evaluation.profile.references.length < evaluation.profile.quality.minimumReferences
      ? `ADD ${evaluation.profile.quality.minimumReferences} SPREAD FIXTURE-HOLE CENTERS`
      : "")
    || evaluation.warnings[0]
    || (!probeEvaluation.qualified ? "QUALIFIED DIRECTIONAL PROBE CALIBRATION REQUIRED" : "")
    || (!fixtureMapElements.calibrationHomed.checked ? "CONFIRM MACHINE HOMED THIS SESSION" : "")
    || (frameApplied ? "TABLE FRAME CALIBRATED / RAW EVIDENCE RETAINED" : "")
    || "TABLE FRAME READY TO APPLY";
  fixtureMapElements.calibrationValidation.textContent = validation.toUpperCase();
  fixtureMapElements.calibrationValidation.dataset.state = frameApplied || evaluation.readyToApply
    ? "valid"
    : evaluation.errors.length ? "alarm" : "";
  return evaluation;
}

function populateFixtureMapForm(profile) {
  fixtureMapProfile = normalizeFixtureMapProfile(profile);
  populateTableFrameCalibrationForm(fixtureMapProfile.plateCalibration);
  fixtureMapElements.gridColumns.value = String(fixtureMapProfile.grid.columns);
  fixtureMapElements.gridRows.value = String(fixtureMapProfile.grid.rows);
  fixtureMapElements.gridPitchX.value = String(fixtureMapProfile.grid.pitchX);
  fixtureMapElements.gridPitchY.value = String(fixtureMapProfile.grid.pitchY);
  fixtureMapElements.datumReference.value = fixtureMapProfile.viseDatum.reference;
  const customDatum = fixtureMapProfile.viseDatum.reference === "custom";
  fixtureMapElements.datumX.readOnly = !customDatum;
  fixtureMapElements.datumY.readOnly = !customDatum;
  fixtureMapElements.datumX.setAttribute("aria-readonly", customDatum ? "false" : "true");
  fixtureMapElements.datumY.setAttribute("aria-readonly", customDatum ? "false" : "true");
  setNumberInput(fixtureMapElements.datumX, fixtureMapProfile.viseDatum.x);
  setNumberInput(fixtureMapElements.datumY, fixtureMapProfile.viseDatum.y);
  setNumberInput(fixtureMapElements.datumZ, fixtureMapProfile.viseDatum.z);
  setNumberInput(fixtureMapElements.frameX, fixtureMapProfile.plateFrame.x, 6);
  setNumberInput(fixtureMapElements.frameY, fixtureMapProfile.plateFrame.y, 6);
  setNumberInput(fixtureMapElements.frameZ, fixtureMapProfile.plateFrame.z, 6);
  setNumberInput(fixtureMapElements.frameRotation, fixtureMapProfile.plateFrame.rotationDeg, 6);
  setPlateFrameInputLock(Boolean(tableFrameCalibration.calibratedAt));
  fixtureMapElements.locationsVerified.checked = fixtureMapProfile.locationsVerified;
  fixtureMapElements.enabledToggles.forEach((toggle) => {
    const vise = fixtureMapProfile.vises.find(({ id }) => id === toggle.dataset.fixtureEnabled);
    toggle.checked = vise?.enabled !== false;
    const label = toggle.nextElementSibling;
    if (label) label.textContent = `${toggle.dataset.fixtureEnabled} ${toggle.checked ? "ON" : "OFF"}`;
  });
  populateSelectedFixtureControls();
}

function updateFixtureMapDraft() {
  collectTableFrameCalibrationDraft();
  const numericInputs = [
    fixtureMapElements.gridColumns,
    fixtureMapElements.gridRows,
    fixtureMapElements.gridPitchX,
    fixtureMapElements.gridPitchY,
    fixtureMapElements.jawOpening,
    fixtureMapElements.datumX,
    fixtureMapElements.datumY,
    fixtureMapElements.datumZ,
    fixtureMapElements.frameX,
    fixtureMapElements.frameY,
    fixtureMapElements.frameZ,
    fixtureMapElements.frameRotation,
  ];
  numericInputs.forEach((input) => {
    input.dataset.invalid = !input.checkValidity() ? "true" : "false";
  });
  const invalidNumber = numericInputs.find((input) => input.dataset.invalid === "true");

  const grid = {
    ...fixtureMapProfile.grid,
    columns: Number(fixtureMapElements.gridColumns.value),
    rows: Number(fixtureMapElements.gridRows.value),
    pitchX: Number(fixtureMapElements.gridPitchX.value),
    pitchY: Number(fixtureMapElements.gridPitchY.value),
  };
  const address = fixtureMapElements.address.value.trim().toUpperCase();
  const parsedAddress = parseHoleAddress(address);
  const addressValid = fixtureMapProfile.selectedFixtureId === "PLATE"
    || Boolean(parsedAddress && addressToCad(parsedAddress.address, grid));
  fixtureMapElements.address.dataset.invalid = addressValid ? "false" : "true";

  const vises = fixtureMapProfile.vises.map((vise) => {
    if (vise.id !== fixtureMapProfile.selectedFixtureId || !addressValid) return vise;
    return {
      ...vise,
      address: parsedAddress.address,
      rotation: selectedFixtureRotation(),
      jawOpening: Number(fixtureMapElements.jawOpening.value),
    };
  });

  fixtureMapProfile = normalizeFixtureMapProfile({
    ...fixtureMapProfile,
    grid,
    vises,
    plateFrame: {
      x: optionalInputNumber(fixtureMapElements.frameX),
      y: optionalInputNumber(fixtureMapElements.frameY),
      z: optionalInputNumber(fixtureMapElements.frameZ),
      rotationDeg: optionalInputNumber(fixtureMapElements.frameRotation) ?? 0,
    },
    plateCalibration: tableFrameCalibration,
    viseDatum: {
      reference: fixtureMapElements.datumReference.value,
      x: optionalInputNumber(fixtureMapElements.datumX) ?? 0,
      y: optionalInputNumber(fixtureMapElements.datumY) ?? 0,
      z: optionalInputNumber(fixtureMapElements.datumZ),
    },
    locationsVerified: fixtureMapElements.locationsVerified.checked,
  });

  fixtureMapFormIssue = invalidNumber
    ? `${invalidNumber.closest("label")?.querySelector("span")?.textContent ?? "VALUE"} IS INVALID`
    : !addressValid ? "TABLE ADDRESS IS NOT A CAD FIXTURE HOLE" : "";
  return evaluateFixtureMapProfile(fixtureMapProfile);
}

function formatFixtureAxis(value) {
  return Number.isFinite(value) ? value.toFixed(3) : "--.---";
}

function formatFixtureVector(vector) {
  if (!vector) return "-- / -- / --";
  return ["x", "y", "z"].map((axis) => formatFixtureAxis(vector[axis])).join(" / ");
}

function drawFixtureMap() {
  const canvas = fixtureMapElements.canvas;
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width < 80 || bounds.height < 80) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  const width = Math.round(bounds.width * ratio);
  const height = Math.round(bounds.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);

  const styles = getComputedStyle(document.documentElement);
  const shell = styles.getPropertyValue("--shell").trim() || "#16181b";
  const panel = styles.getPropertyValue("--panel").trim() || "#22262a";
  const line = styles.getPropertyValue("--line").trim() || "#dce1e5";
  const paper = styles.getPropertyValue("--paper").trim() || "#ffffff";
  const muted = styles.getPropertyValue("--muted").trim() || "#a0a8b0";
  const action = styles.getPropertyValue("--action").trim() || "#d71920";
  const padding = 34;
  const plate = MR1_CONFIG.fixturePlate;
  const scale = Math.min(
    (bounds.width - padding * 2) / plate.width,
    (bounds.height - padding * 2) / plate.depth,
  );
  const centerX = bounds.width / 2;
  const centerY = bounds.height / 2;
  const toCanvas = (point) => ({ x: centerX + point.x * scale, y: centerY - point.y * scale });
  fixtureMapCanvasGeometry = { centerX, centerY, scale };

  context.fillStyle = shell;
  context.fillRect(0, 0, bounds.width, bounds.height);
  context.fillStyle = panel;
  context.strokeStyle = muted;
  context.lineWidth = 1;
  context.fillRect(
    centerX - plate.width * scale / 2,
    centerY - plate.depth * scale / 2,
    plate.width * scale,
    plate.depth * scale,
  );
  context.strokeRect(
    centerX - plate.width * scale / 2,
    centerY - plate.depth * scale / 2,
    plate.width * scale,
    plate.depth * scale,
  );

  const anchorByAddress = new Map(fixtureMapProfile.vises.map((vise) => [vise.address, vise]));
  const selectedVise = selectedFixtureVise();
  const xLabelEvery = Math.max(1, Math.ceil(22 / (fixtureMapProfile.grid.pitchX * scale)));
  const yLabelEvery = Math.max(1, Math.ceil(14 / (fixtureMapProfile.grid.pitchY * scale)));
  context.font = "8px Cascadia Mono, Consolas, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";

  const spacedLabelIndices = (count, interval) => {
    const indices = [];
    for (let index = 0; index < count; index += interval) indices.push(index);
    const last = count - 1;
    if (indices.at(-1) !== last) {
      if (last - indices.at(-1) < interval) indices.pop();
      indices.push(last);
    }
    return indices;
  };
  for (const column of spacedLabelIndices(fixtureMapProfile.grid.columns, xLabelEvery)) {
    const point = gridCellToCad(column, 0, fixtureMapProfile.grid);
    context.fillStyle = line;
    context.fillText(columnLabel(column), toCanvas(point).x, padding - 11);
  }
  context.textAlign = "right";
  for (const row of spacedLabelIndices(fixtureMapProfile.grid.rows, yLabelEvery)) {
    const point = gridCellToCad(0, row, fixtureMapProfile.grid);
    context.fillStyle = line;
    context.fillText(String(row + 1), padding - 10, toCanvas(point).y);
  }
  context.textAlign = "center";

  context.fillStyle = line;
  context.font = "700 8px Cascadia Mono, Consolas, monospace";
  context.fillText("BACK / +Y", centerX, 9);
  context.fillText("FRONT / OPERATOR / -Y", centerX, bounds.height - 9);
  context.textAlign = "left";
  context.fillText("-X", 8, bounds.height - 9);
  context.textAlign = "right";
  context.fillText("+X", bounds.width - 8, bounds.height - 9);
  context.textAlign = "center";

  for (let row = 0; row < fixtureMapProfile.grid.rows; row += 1) {
    for (let column = 0; column < fixtureMapProfile.grid.columns; column += 1) {
      const address = `${columnLabel(column)}${row + 1}`;
      const point = addressToCad(address, fixtureMapProfile.grid);
      if (!point) continue;
      const screen = toCanvas(point);
      const vise = anchorByAddress.get(address);
      context.beginPath();
      context.arc(screen.x, screen.y, vise ? 3.6 : 2.15, 0, Math.PI * 2);
      context.fillStyle = vise?.id === selectedVise?.id ? action : vise ? paper : muted;
      context.fill();
    }
  }

  const layout = fixtureLayout(fixtureMapProfile);
  for (const vise of layout) {
    if (!vise.enabled) continue;
    const viseFootprint = viseFootprintForOpening(vise.jawOpening);
    const screen = toCanvas(vise.point);
    const selected = vise.id === fixtureMapProfile.selectedFixtureId;
    context.save();
    context.translate(screen.x, screen.y);
    context.rotate(-vise.rotation * Math.PI / 180);
    context.fillStyle = selected ? "rgba(215, 25, 32, 0.24)" : "rgba(216, 221, 226, 0.12)";
    context.strokeStyle = selected ? action : line;
    context.lineWidth = selected ? 2 : 1;
    context.fillRect(
      viseFootprint.minX * scale,
      -viseFootprint.maxY * scale,
      (viseFootprint.maxX - viseFootprint.minX) * scale,
      (viseFootprint.maxY - viseFootprint.minY) * scale,
    );
    context.strokeRect(
      viseFootprint.minX * scale,
      -viseFootprint.maxY * scale,
      (viseFootprint.maxX - viseFootprint.minX) * scale,
      (viseFootprint.maxY - viseFootprint.minY) * scale,
    );
    const fixedJaw = MR1_CONFIG.workholding.viseCad.fixedJaw;
    const jawLeft = fixedJaw.leftX * scale;
    const jawRight = fixedJaw.rightX * scale;
    const fixedFace = -fixedJaw.faceY * scale;
    const movableFace = -(fixedJaw.faceY + vise.jawOpening) * scale;
    context.lineWidth = selected ? 2.5 : 1.5;
    context.beginPath();
    context.moveTo(jawLeft, fixedFace);
    context.lineTo(jawRight, fixedFace);
    context.moveTo(jawLeft, movableFace);
    context.lineTo(jawRight, movableFace);
    context.stroke();
    context.beginPath();
    context.moveTo(-5, 0);
    context.lineTo(5, 0);
    context.moveTo(0, -5);
    context.lineTo(0, 5);
    context.stroke();
    const datum = fixtureMapProfile.viseDatum;
    context.strokeStyle = selected ? paper : muted;
    context.beginPath();
    context.moveTo(datum.x * scale - 5, -datum.y * scale);
    context.lineTo(datum.x * scale + 5, -datum.y * scale);
    context.moveTo(datum.x * scale, -datum.y * scale - 5);
    context.lineTo(datum.x * scale, -datum.y * scale + 5);
    context.stroke();
    context.fillStyle = selected ? paper : line;
    context.fillText(vise.wcs, 0, 18);
    context.restore();
  }

  if (fixtureMapProfile.selectedFixtureId === "PLATE") {
    context.strokeStyle = action;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(centerX - 14, centerY);
    context.lineTo(centerX + 14, centerY);
    context.moveTo(centerX, centerY - 14);
    context.lineTo(centerX, centerY + 14);
    context.stroke();
  }
}

function fixtureWorkOffsetIntent(evaluation = evaluateFixtureMapProfile(fixtureMapProfile)) {
  const assignment = fixtureAssignment(fixtureMapProfile.selectedFixtureId);
  const candidate = calculateFixtureWorkOffset(fixtureMapProfile, fixtureMapProfile.selectedFixtureId);
  if (!assignment || !candidate?.machine || !["x", "y", "z"].every((axis) => Number.isFinite(candidate.machine[axis]))) {
    return null;
  }
  return {
    type: "apply-work-offset",
    wcs: assignment.wcs,
    fixtureId: assignment.fixtureId,
    offset: candidate.machine,
    mapVersion: evaluation.profile.version,
    frameQualified: evaluation.frameCalibrated,
    locationsVerified: evaluation.profile.locationsVerified,
  };
}

function renderFixtureMap(message = "") {
  const evaluation = evaluateFixtureMapProfile(fixtureMapProfile);
  renderTableFrameCalibration();
  const selectedId = fixtureMapProfile.selectedFixtureId;
  const assignment = fixtureAssignment(selectedId);
  const vise = selectedFixtureVise();
  const selectedAddress = selectedId === "PLATE" ? "CENTER" : vise?.address ?? "--";
  const candidate = calculateFixtureWorkOffset(fixtureMapProfile, selectedId);
  const intent = fixtureWorkOffsetIntent(evaluation);
  const commandEvaluation = intent ? evaluateUiMachineIntent(intent) : null;
  const transaction = transactionMatches("apply-work-offset");
  const commandReady = evaluation.ready
    && commandEvaluation?.permitted === true
    && !runtime.commandPending;

  fixtureMapElements.activeWcs.value = runtime.live
    ? runtime.telemetry?.workCoordinateSystem ?? "WCS --"
    : "OFFLINE";
  fixtureMapElements.frameState.value = evaluation.frameCalibrated
    ? "PROBE QUALIFIED"
    : evaluation.frameDefined ? "MANUAL / HELD" : "REFERENCE REQUIRED";
  fixtureMapElements.frameState.dataset.state = evaluation.frameCalibrated ? "active" : "alarm";
  fixtureMapElements.gridSummary.value = `A1–${columnLabel(fixtureMapProfile.grid.columns - 1)}${fixtureMapProfile.grid.rows} / ${addressableCellCount(fixtureMapProfile.grid).toLocaleString()} CAD HOLES`;
  fixtureMapElements.selectionWcs.textContent = assignment?.wcs ?? "--";
  fixtureMapElements.selectionName.textContent = selectedId === "PLATE" ? "PLATE MASTER" : selectedId;
  fixtureMapElements.selectionAddress.value = selectedAddress;
  fixtureMapElements.offsetWcs.value = assignment?.wcs ?? "--";
  fixtureMapElements.offsetX.value = formatFixtureAxis(candidate?.machine.x);
  fixtureMapElements.offsetY.value = formatFixtureAxis(candidate?.machine.y);
  fixtureMapElements.offsetZ.value = formatFixtureAxis(candidate?.machine.z);

  const telemetry = runtime.telemetry;
  fixtureMapElements.liveMpos.value = formatFixtureVector(telemetry?.position.machine);
  fixtureMapElements.liveWco.value = formatFixtureVector(telemetry?.position.wco);
  fixtureMapElements.liveWpos.value = formatFixtureVector(telemetry?.position.work);

  fixtureMapElements.stationButtons.forEach((button) => {
    const fixtureId = button.dataset.fixtureId;
    const stationVise = fixtureMapProfile.vises.find(({ id }) => id === fixtureId);
    button.setAttribute("aria-selected", fixtureId === selectedId ? "true" : "false");
    button.dataset.enabled = stationVise?.enabled === false ? "false" : "true";
    const output = button.querySelector("output");
    if (output && stationVise) {
      output.value = stationVise.enabled
        ? `${stationVise.address} / ${stationVise.rotation}° / ${stationVise.jawOpening.toFixed(1)} mm`
        : "OFF";
    }
  });
  fixtureMapElements.enabledToggles.forEach((toggle) => {
    const stationVise = fixtureMapProfile.vises.find(({ id }) => id === toggle.dataset.fixtureEnabled);
    toggle.checked = stationVise?.enabled !== false;
    const label = toggle.nextElementSibling;
    if (label) label.textContent = `${toggle.dataset.fixtureEnabled} ${toggle.checked ? "ON" : "OFF"}`;
  });

  const label = message
    || fixtureMapFormIssue
    || evaluation.errors[0]
    || evaluation.blockers[0]
    || (transaction?.state === "completed" ? `${transaction.result?.wcs ?? assignment?.wcs ?? "WCS"} APPLIED / CONTROLLER WCO OBSERVED` : "")
    || (commandReady ? "MAP READY / TYPED WCS TRANSACTION ARMED" : "MAP READY / COMMAND GATED");
  fixtureMapElements.validation.textContent = label.toUpperCase();
  fixtureMapElements.validation.dataset.state = evaluation.ready
    ? "valid"
    : fixtureMapFormIssue || evaluation.errors.length ? "alarm" : "";
  fixtureMapElements.save.disabled = Boolean(fixtureMapFormIssue) || !evaluation.valid;
  fixtureMapElements.applyWorkOffset.disabled = !commandReady;
  fixtureMapElements.applyWorkOffset.dataset.tooltip = commandReady
    ? NATIVE_MODE ? `Review a protected ${assignment?.wcs ?? "WCS"} offset plan` : `Apply ${assignment?.wcs ?? "WCS"} through the typed virtual transaction engine`
    : commandEvaluation?.blockers[0]?.detail ?? evaluation.blockers[0] ?? evaluation.errors[0] ?? "WORK OFFSET BLOCKED";
  if (!runtime.live) setIndicator(fixtureMapElements.commandState, "OFFLINE", "alarm");
  else if (NATIVE_MODE) setIndicator(fixtureMapElements.commandState, nativeState?.busy ? 'NATIVE OPERATION' : commandReady ? 'REVIEW NATIVE PLAN' : 'NATIVE GATED', commandReady ? 'active' : 'alarm');
  else if (!machineCommandsEnabled()) setIndicator(fixtureMapElements.commandState, "PHYSICAL LOCKED", "alarm");
  else if (transaction && !transactionIsTerminal(transaction)) {
    setIndicator(fixtureMapElements.commandState, transactionStatusLabel(transaction), "active");
  } else if (transaction?.state === "completed") {
    setIndicator(fixtureMapElements.commandState, `${transaction.result?.wcs ?? "WCS"} OBSERVED`, "active");
  } else if (transaction?.state === "cancelled") {
    setIndicator(fixtureMapElements.commandState, "CANCELLED / WCO NOT PROVEN", "alarm");
  } else if (transaction?.state === "failed" || transaction?.state === "rejected") {
    setIndicator(fixtureMapElements.commandState, "FAILED", "alarm");
  } else {
    setIndicator(fixtureMapElements.commandState, commandReady ? "VIRTUAL READY" : "GATED", commandReady ? "active" : "alarm");
  }

  viewer?.setFixtureLayout(fixtureLayout(fixtureMapProfile), selectedId);
  drawFixtureMap();
  return evaluation;
}

function selectFixtureMapStation(fixtureId) {
  updateFixtureMapDraft();
  fixtureMapProfile = normalizeFixtureMapProfile({ ...fixtureMapProfile, selectedFixtureId: fixtureId });
  fixtureMapFormIssue = "";
  populateSelectedFixtureControls();
  renderFixtureMap();
}

function placeSelectedFixtureAtAddress(address) {
  if (fixtureMapProfile.selectedFixtureId === "PLATE") return;
  const parsed = parseHoleAddress(address);
  if (!parsed || !addressToCad(parsed.address, fixtureMapProfile.grid)) return;
  fixtureMapElements.address.value = parsed.address;
  updateFixtureMapDraft();
  renderFixtureMap();
}

function populateSceneRegistrationForm(candidate) {
  const profile = normalizeSceneRegistrationProfile(candidate, fixtureMapProfile);
  sceneRegistrationElements.cameraId.value = profile.camera.id;
  sceneRegistrationElements.cameraName.value = profile.camera.name;
  setNumberInput(sceneRegistrationElements.cameraWidth, profile.camera.width);
  setNumberInput(sceneRegistrationElements.cameraHeight, profile.camera.height);
  sceneRegistrationElements.lensProfileId.value = profile.camera.lensProfileId;
  sceneRegistrationElements.intrinsicsCalibrated.checked = profile.camera.intrinsicsCalibrated;
  setNumberInput(sceneRegistrationElements.minimumReferences, profile.quality.minimumReferences);
  setNumberInput(sceneRegistrationElements.minimumCoverage, profile.quality.minimumCoverageRatio * 100);
  setNumberInput(sceneRegistrationElements.maximumRms, profile.quality.maximumRmsErrorPx);
  setNumberInput(sceneRegistrationElements.maximumPointError, profile.quality.maximumPointErrorPx);
  setNumberInput(sceneRegistrationElements.ransacThreshold, profile.quality.ransacThresholdPx);
  setNumberInput(sceneRegistrationElements.maximumOutlierRatio, profile.quality.maximumOutlierRatio * 100);
  setNumberInput(sceneRegistrationElements.maximumAge, profile.quality.maximumAgeMinutes);
}

function collectSceneRegistrationProfile() {
  const invalid = sceneRegistrationElements.form.querySelector(":invalid");
  sceneRegistrationIssue = invalid
    ? `${invalid.closest("label")?.querySelector("span")?.textContent ?? "VALUE"} IS INVALID`
    : "";
  sceneRegistrationProfile = normalizeSceneRegistrationProfile({
    ...sceneRegistrationProfile,
    camera: {
      id: sceneRegistrationElements.cameraId.value,
      name: sceneRegistrationElements.cameraName.value,
      width: inputNumber(sceneRegistrationElements.cameraWidth),
      height: inputNumber(sceneRegistrationElements.cameraHeight),
      lensProfileId: sceneRegistrationElements.lensProfileId.value,
      intrinsicsCalibrated: sceneRegistrationElements.intrinsicsCalibrated.checked,
    },
    quality: {
      minimumReferences: inputNumber(sceneRegistrationElements.minimumReferences),
      minimumCoverageRatio: inputNumber(sceneRegistrationElements.minimumCoverage) / 100,
      maximumRmsErrorPx: inputNumber(sceneRegistrationElements.maximumRms),
      maximumPointErrorPx: inputNumber(sceneRegistrationElements.maximumPointError),
      ransacThresholdPx: inputNumber(sceneRegistrationElements.ransacThreshold),
      maximumOutlierRatio: inputNumber(sceneRegistrationElements.maximumOutlierRatio) / 100,
      maximumAgeMinutes: inputNumber(sceneRegistrationElements.maximumAge),
    },
  }, fixtureMapProfile);
  return sceneRegistrationProfile;
}

function sceneCoordinateLabel(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return "-- / --";
  return `${point.x.toFixed(2)} / ${point.y.toFixed(2)}`;
}

function sceneMachineLabel(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return "MPOS -- / --";
  return `M ${point.x.toFixed(2)} / ${point.y.toFixed(2)}`;
}

function appendSceneEmpty(container, label) {
  const empty = document.createElement("div");
  empty.className = "scene-empty-list";
  empty.textContent = label;
  container.replaceChildren(empty);
}

function sceneRemoveButton(label, dataset) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.textContent = "×";
  Object.assign(button.dataset, dataset);
  return button;
}

function renderSceneReferenceList(evaluation) {
  const references = evaluation.profile.references;
  if (!references.length) {
    appendSceneEmpty(sceneRegistrationElements.referenceList, "NO FIXTURE REFERENCES");
    return;
  }
  const residualByAddress = new Map((evaluation.solution?.residuals ?? []).map((residual) => [residual.address, residual]));
  const fragment = document.createDocumentFragment();
  references.forEach((reference) => {
    const row = document.createElement("div");
    row.className = "scene-reference-row";
    const fitResidual = residualByAddress.get(reference.address);
    if (fitResidual && !fitResidual.inlier) row.dataset.state = "outlier";
    const address = document.createElement("strong");
    address.textContent = reference.address;
    const pixel = document.createElement("code");
    pixel.textContent = `P ${reference.pixel.x.toFixed(2)} / ${reference.pixel.y.toFixed(2)}`;
    const residual = document.createElement("output");
    const error = fitResidual?.errorPx;
    residual.value = Number.isFinite(error)
      ? `${fitResidual?.inlier === false ? "OUT / " : ""}${error.toFixed(2)} px`
      : "-- px";
    row.append(address, pixel, residual, sceneRemoveButton(`Remove ${reference.address} reference`, {
      sceneReferenceRemove: reference.id,
    }));
    fragment.append(row);
  });
  sceneRegistrationElements.referenceList.replaceChildren(fragment);
}

function renderSceneFeatureList(evaluation) {
  const hypotheses = evaluation.profile.hypotheses;
  if (!hypotheses.length) {
    appendSceneEmpty(sceneRegistrationElements.featureList, "NO FEATURE HYPOTHESES");
    return;
  }
  const fragment = document.createDocumentFragment();
  hypotheses.forEach((hypothesis) => {
    const registered = evaluation.solution
      ? pixelToRegisteredPoint(hypothesis.pixel, evaluation.solution, fixtureMapProfile)
      : null;
    const row = document.createElement("div");
    row.className = "scene-feature-row";
    if (registered && !registered.insideCalibrationHull) row.dataset.state = "extrapolated";
    const label = document.createElement("strong");
    label.textContent = SCENE_FEATURE_TYPES[hypothesis.type].label;
    const pixel = document.createElement("code");
    pixel.textContent = `P ${sceneCoordinateLabel(hypothesis.pixel)}`;
    const machine = document.createElement("output");
    machine.value = registered
      ? `${registered.insideCalibrationHull ? "IN" : "OUT"} / ${sceneMachineLabel(registered.machine)}`
      : "UNSOLVED";
    row.append(label, pixel, machine, sceneRemoveButton(`Remove ${hypothesis.label}`, {
      sceneFeatureRemove: hypothesis.id,
    }));
    fragment.append(row);
  });
  sceneRegistrationElements.featureList.replaceChildren(fragment);
}

function renderSceneProbePlan(plan) {
  if (!plan.operations.length) {
    appendSceneEmpty(sceneRegistrationElements.planList, "NO GUIDED PROBE OPERATIONS");
    return;
  }
  const fragment = document.createDocumentFragment();
  plan.operations.forEach((operation) => {
    const row = document.createElement("div");
    row.className = "scene-plan-row";
    if (!operation.insideFrame || !operation.insideCalibrationHull) row.dataset.state = "held";
    const sequence = document.createElement("code");
    sequence.textContent = String(operation.sequence).padStart(2, "0");
    const label = document.createElement("strong");
    label.textContent = operation.label;
    const cycle = document.createElement("code");
    cycle.textContent = operation.cycle;
    const contacts = document.createElement("output");
    contacts.value = `${operation.contacts} HITS / ${operation.insideCalibrationHull ? "IN HULL" : "HELD"}`;
    row.append(sequence, label, cycle, contacts);
    fragment.append(row);
  });
  sceneRegistrationElements.planList.replaceChildren(fragment);
}

function drawSceneRegistrationCanvas(evaluation, visibleHoles) {
  const canvas = sceneRegistrationElements.canvas;
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width < 80 || bounds.height < 40) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  const width = Math.round(bounds.width * ratio);
  const height = Math.round(bounds.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  const live = Boolean(sceneCameraStream);
  if (sceneFrameBitmap && !live) {
    context.drawImage(sceneFrameBitmap, 0, 0, bounds.width, bounds.height);
  } else if (!live) {
    context.fillStyle = "#101214";
    context.fillRect(0, 0, bounds.width, bounds.height);
  }

  const camera = evaluation.profile.camera;
  const toCanvas = (pixel) => ({
    x: pixel.x / camera.width * bounds.width,
    y: pixel.y / camera.height * bounds.height,
  });
  const evidenceVisible = evaluation.frameMatches;
  if (evaluation.solution && evidenceVisible) {
    context.fillStyle = evaluation.activeFrameReady ? "rgba(88, 166, 255, 0.34)" : "rgba(160, 168, 176, 0.24)";
    for (const hole of visibleHoles) {
      const pixel = projectHomography(evaluation.solution.matrix, hole.cad);
      if (!pixel || pixel.x < 0 || pixel.y < 0 || pixel.x > camera.width || pixel.y > camera.height) continue;
      const screen = toCanvas(pixel);
      context.beginPath();
      context.arc(screen.x, screen.y, 1.25, 0, Math.PI * 2);
      context.fill();
    }
  }

  context.font = "700 9px Cascadia Mono, Consolas, monospace";
  context.textAlign = "left";
  context.textBaseline = "bottom";
  const residualByAddress = new Map((evaluation.solution?.residuals ?? []).map((residual) => [residual.address, residual]));
  if (evidenceVisible) evaluation.profile.references.forEach((reference) => {
    const screen = toCanvas(reference.pixel);
    const residual = residualByAddress.get(reference.address);
    const inlier = residual?.inlier !== false;
    context.strokeStyle = inlier ? "#ffffff" : "#ff343f";
    context.fillStyle = inlier ? "#ffffff" : "#ff343f";
    context.lineWidth = 1.5;
    if (residual?.projected && Number.isFinite(residual.errorPx) && residual.errorPx > 0.1) {
      const projected = toCanvas(residual.projected);
      context.beginPath();
      context.moveTo(screen.x, screen.y);
      context.lineTo(projected.x, projected.y);
      context.stroke();
    }
    context.beginPath();
    context.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
    context.stroke();
    context.fillText(`${reference.address}${inlier ? "" : " OUT"}`, screen.x + 7, screen.y - 5);
  });

  if (evidenceVisible) evaluation.profile.hypotheses.forEach((hypothesis) => {
    const screen = toCanvas(hypothesis.pixel);
    const registered = evaluation.solution
      ? pixelToRegisteredPoint(hypothesis.pixel, evaluation.solution, fixtureMapProfile)
      : null;
    context.strokeStyle = registered?.insideCalibrationHull === false ? "#ff343f" : "#c792ea";
    context.lineWidth = 1.5;
    context.strokeRect(screen.x - 5, screen.y - 5, 10, 10);
  });

  if (scenePickedPixel) {
    const screen = toCanvas(scenePickedPixel);
    context.strokeStyle = "#ff343f";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(screen.x - 8, screen.y);
    context.lineTo(screen.x + 8, screen.y);
    context.moveTo(screen.x, screen.y - 8);
    context.lineTo(screen.x, screen.y + 8);
    context.stroke();
  }
}

function renderSceneRegistration(message = "") {
  const profile = collectSceneRegistrationProfile();
  const currentFrame = sceneCameraStream ? null : sceneActiveFrame;
  const evaluation = evaluateSceneRegistrationProfile(profile, fixtureMapProfile, { activeFrame: currentFrame });
  const visibleHoles = visibleFixtureReferences(fixtureMapProfile);
  const probeEvaluation = evaluateProbeCalibration(probeCalibration);
  const plan = buildGuidedProbePlan(profile, fixtureMapProfile, {
    activeFrame: currentFrame,
    probeQualified: probeEvaluation.qualified,
  });
  const referenceCount = profile.references.length;
  const sourceState = sceneCameraStream ? "LIVE" : sceneFrameBitmap ? "FRAME" : "OFFLINE";
  const inlierCount = evaluation.solution?.inlierCount ?? 0;
  const outlierCount = evaluation.solution?.outlierCount ?? 0;
  const residualEstimates = (evaluation.solution?.residuals ?? [])
    .filter(({ inlier }) => inlier)
    .map(({ observed }) => pixelToRegisteredPoint(observed, evaluation.solution, fixtureMapProfile)?.residualEstimateMm)
    .filter(Number.isFinite);
  const residualEstimateMm = residualEstimates.length ? Math.max(...residualEstimates) : null;

  sceneRegistrationElements.frameMedia.style.aspectRatio = `${profile.camera.width} / ${profile.camera.height}`;
  sceneRegistrationElements.frameMedia.dataset.state = sceneCameraStream ? "live" : sceneFrameBitmap ? "frame" : "empty";
  sceneRegistrationElements.cameraState.value = sourceState;
  sceneRegistrationElements.cameraState.dataset.state = sourceState === "OFFLINE" ? "" : "active";
  sceneRegistrationElements.frameState.value = evaluation.frameState;
  sceneRegistrationElements.frameState.dataset.state = evaluation.frameState === "MATCH" ? "active" : "alarm";
  sceneRegistrationElements.referenceCount.value = evaluation.solution
    ? `${inlierCount} IN / ${outlierCount} OUT`
    : `${referenceCount} OF ${Math.max(4, profile.quality.minimumReferences)}`;
  sceneRegistrationElements.rmsError.value = Number.isFinite(evaluation.solution?.rmsErrorPx)
    ? `${evaluation.solution.rmsErrorPx.toFixed(2)} px`
    : "-- px";
  sceneRegistrationElements.authority.value = evaluation.status;
  sceneRegistrationElements.authority.dataset.state = evaluation.machinePlaneReady ? "active" : "alarm";
  sceneRegistrationElements.pipelineGrid.value = evaluation.solution
    ? `${inlierCount} IN / ${outlierCount} OUT`
    : `${referenceCount} / ${profile.quality.minimumReferences}`;
  sceneRegistrationElements.pipelineMask.value = `${visibleHoles.length.toLocaleString()} VISIBLE`;
  sceneRegistrationElements.pipelineFeatures.value = String(profile.hypotheses.length);
  sceneRegistrationElements.pipelinePlan.value = plan.readyForReview ? `${plan.totalContacts} HITS` : "HELD";
  sceneRegistrationElements.visibleHoleCount.value = `${visibleHoles.length.toLocaleString()} VISIBLE HOLES`;
  sceneRegistrationElements.fitCoverage.value = Number.isFinite(evaluation.solution?.coverageRatio)
    ? `${(evaluation.solution.coverageRatio * 100).toFixed(1)}%`
    : "--.-%";
  sceneRegistrationElements.fitMaximumError.value = Number.isFinite(evaluation.solution?.maximumErrorPx)
    ? `${evaluation.solution.maximumErrorPx.toFixed(2)} px`
    : "-- px";
  sceneRegistrationElements.fitConsensus.value = `${inlierCount} / ${outlierCount}`;
  sceneRegistrationElements.fitMmError.value = Number.isFinite(residualEstimateMm)
    ? `${residualEstimateMm.toFixed(4)} mm`
    : "-- mm";
  sceneRegistrationElements.fitFrame.value = evaluateFixtureMapProfile(fixtureMapProfile).frameCalibrated
    ? "MPOS READY"
    : "REQUIRED";
  sceneRegistrationElements.fitAge.value = Number.isFinite(evaluation.calibrationAgeMinutes)
    ? `${Math.max(0, evaluation.calibrationAgeMinutes).toFixed(1)} min`
    : "-- min";
  sceneRegistrationElements.fitAge.dataset.state = evaluation.registrationFresh ? "active" : "alarm";
  sceneRegistrationElements.fitState.value = evaluation.activeFrameReady
    ? "QUALIFIED XY"
    : evaluation.qualified ? "EVIDENCE HELD"
    : evaluation.mathematicallySolved ? "PROVISIONAL" : "UNSOLVED";
  sceneRegistrationElements.planOperations.value = String(plan.operations.length);
  sceneRegistrationElements.planContacts.value = String(plan.totalContacts);
  sceneRegistrationElements.planProbe.value = probeEvaluation.qualified ? "QUALIFIED" : "REQUIRED";
  sceneRegistrationElements.planProbe.dataset.state = probeEvaluation.qualified ? "active" : "alarm";
  sceneRegistrationElements.captureFrame.disabled = !sceneCameraStream;
  sceneRegistrationElements.connectCamera.querySelector("span").textContent = sceneCameraStream ? "DISCONNECT" : "CONNECT";
  sceneRegistrationElements.bindFrame.disabled = !currentFrame || evaluation.frameMatches;
  sceneRegistrationElements.bindFrame.querySelector("span").textContent = evaluation.frameMatches ? "BOUND" : "BIND / RESET";
  sceneRegistrationElements.addReference.disabled = !evaluation.frameMatches;
  sceneRegistrationElements.addFeature.disabled = !evaluation.frameMatches;
  sceneRegistrationElements.clearReferences.disabled = referenceCount === 0;
  sceneRegistrationElements.save.disabled = Boolean(sceneRegistrationIssue);

  renderSceneReferenceList(evaluation);
  renderSceneFeatureList(evaluation);
  renderSceneProbePlan(plan);
  const validation = message
    || sceneRegistrationIssue
    || evaluation.errors[0]
    || (!evaluation.frameBound ? "BIND THE CURRENT FRAME BEFORE REGISTRATION" : "")
    || (!evaluation.framePresent ? "LOAD THE FRAME BOUND TO THIS REGISTRATION" : "")
    || (!evaluation.frameMatches ? "ACTIVE FRAME MISMATCH / BIND TO RESET EVIDENCE" : "")
    || (referenceCount < 4 ? "ADD FOUR DISTRIBUTED FIXTURE REFERENCES" : "")
    || (!evaluation.registrationFresh ? "REGISTRATION EXPIRED / RE-REGISTER CURRENT FRAME" : "")
    || evaluation.warnings[0]
    || "PLATE-PLANE XY REGISTRATION QUALIFIED";
  sceneRegistrationElements.validation.textContent = validation.toUpperCase();
  sceneRegistrationElements.validation.dataset.state = evaluation.machinePlaneReady
    ? "valid"
    : sceneRegistrationIssue || evaluation.errors.length ? "alarm" : "";

  const panelOpen = elements.sceneRegistrationPanel.getAttribute("aria-hidden") === "false";
  const inlierAddresses = new Set((evaluation.solution?.residuals ?? [])
    .filter(({ inlier }) => inlier)
    .map(({ address }) => address));
  const referenceCad = profile.references
    .filter(({ address }) => inlierAddresses.has(address))
    .map(({ address }) => addressToCad(address, fixtureMapProfile.grid))
    .filter(Boolean);
  viewer?.setSceneRegistrationOverlay({
    visible: panelOpen,
    qualified: evaluation.activeFrameReady,
    references: evaluation.frameMatches ? referenceCad : [],
    footprint: evaluation.activeFrameReady ? registrationFootprint(evaluation.solution, profile.camera) : [],
  });
  drawSceneRegistrationCanvas(evaluation, visibleHoles);
  return { evaluation, plan };
}

function stopSceneCamera() {
  sceneCameraStream?.getTracks().forEach((track) => track.stop());
  sceneCameraStream = null;
  sceneRegistrationElements.video.srcObject = null;
  sceneRegistrationElements.video.hidden = true;
}

async function sceneFrameFingerprint(blob) {
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 frame identity is unavailable in this browser.");
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function stageSceneFrame(blob, sourceName, capturedAt = Date.now()) {
  const [bitmap, fingerprint] = await Promise.all([
    createImageBitmap(blob),
    sceneFrameFingerprint(blob),
  ]);
  sceneFrameBitmap?.close?.();
  sceneFrameBitmap = bitmap;
  sceneActiveFrame = {
    fingerprint,
    sourceName,
    width: bitmap.width,
    height: bitmap.height,
    capturedAt,
  };
  sceneRegistrationElements.cameraWidth.value = String(bitmap.width);
  sceneRegistrationElements.cameraHeight.value = String(bitmap.height);

  const profile = collectSceneRegistrationProfile();
  if (!profile.frame && !profile.references.length && !profile.hypotheses.length) {
    sceneRegistrationProfile = bindSceneRegistrationFrame(profile, sceneActiveFrame, fixtureMapProfile);
    populateSceneRegistrationForm(sceneRegistrationProfile);
    return true;
  }
  return false;
}

function videoFrameBlob(video) {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d", { alpha: false }).drawImage(video, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error("Camera frame encoding failed."))),
    "image/png",
  ));
}

async function toggleSceneCamera() {
  if (sceneCameraStream) {
    stopSceneCamera();
    renderSceneRegistration("CAMERA DISCONNECTED");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    renderSceneRegistration("CAMERA API UNAVAILABLE");
    return;
  }
  try {
    const profile = collectSceneRegistrationProfile();
    sceneCameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: profile.camera.width },
        height: { ideal: profile.camera.height },
      },
    });
    sceneRegistrationElements.video.srcObject = sceneCameraStream;
    sceneRegistrationElements.video.hidden = false;
    await sceneRegistrationElements.video.play();
    renderSceneRegistration("CAMERA LIVE / CAPTURE WHEN STABLE");
  } catch (error) {
    stopSceneCamera();
    renderSceneRegistration(error instanceof Error ? `CAMERA FAILED / ${error.message}` : "CAMERA FAILED");
  }
}

async function captureSceneFrame() {
  if (!sceneCameraStream || !sceneRegistrationElements.video.videoWidth) return;
  try {
    const capturedAt = Date.now();
    const sourceName = `CAMERA-${new Date(capturedAt).toISOString()}`;
    const automaticallyBound = await stageSceneFrame(
      await videoFrameBlob(sceneRegistrationElements.video),
      sourceName,
      capturedAt,
    );
    stopSceneCamera();
    renderSceneRegistration(automaticallyBound
      ? "FRAME CAPTURED AND BOUND / ADD REFERENCES"
      : "FRAME CAPTURED / VERIFY IDENTITY OR BIND TO RESET");
  } catch (error) {
    renderSceneRegistration(error instanceof Error ? `CAPTURE FAILED / ${error.message}` : "CAPTURE FAILED");
  }
}

async function loadSceneFrameFile(file) {
  if (!file) return;
  try {
    const automaticallyBound = await stageSceneFrame(file, file.name, Date.now());
    stopSceneCamera();
    renderSceneRegistration(automaticallyBound
      ? `FRAME BOUND / ${file.name}`
      : `FRAME LOADED / ${file.name} / VERIFY OR BIND`);
  } catch (error) {
    renderSceneRegistration(error instanceof Error ? `FRAME FAILED / ${error.message}` : "FRAME FAILED");
  } finally {
    sceneRegistrationElements.frameFile.value = "";
  }
}

async function loadSceneDetectionFile(file) {
  if (!file) return;
  try {
    sceneRegistrationProfile = importSceneDetections(await file.text(), collectSceneRegistrationProfile(), fixtureMapProfile);
    populateSceneRegistrationForm(sceneRegistrationProfile);
    scenePickedPixel = null;
    renderSceneRegistration(`DETECTIONS IMPORTED / ${file.name}`);
  } catch (error) {
    renderSceneRegistration(error instanceof Error ? `IMPORT FAILED / ${error.message}` : "IMPORT FAILED");
  } finally {
    sceneRegistrationElements.detectionFile.value = "";
  }
}

function setSceneRegistrationPanel(open, restoreFocus = true) {
  if (open && elements.controllerSettingsPanel.getAttribute("aria-hidden") === "false") {
    setControllerSettingsPanel(false, false);
  }
  if (open && elements.machineDataPanel.getAttribute("aria-hidden") === "false") setMachineDataPanel(false, false);
  if (open && !fissionElements.panel.hidden) setFissionSettingsPanel(false);
  if (open && elements.metrologyPanel.getAttribute("aria-hidden") === "false") setMetrologyPanel(false, false);
  if (open && elements.fixtureMapPanel.getAttribute("aria-hidden") === "false") setFixtureMapPanel(false, false);
  if (open && elements.cutterCompPanel.getAttribute("aria-hidden") === "false") setCutterCompPanel(false, false);
  if (open && elements.probingPanel.getAttribute("aria-hidden") === "false") setProbingPanel(false, false);
  if (open && elements.spindlePanel.getAttribute("aria-hidden") === "false") setSpindlePanel(false, false);
  if (open && elements.wiringPanel.getAttribute("aria-hidden") === "false") setWiringPanel(false, false);
  if (open && elements.jogPanel.getAttribute("aria-hidden") === "false") setJogPanel(false, false);
  elements.sceneRegistrationPanel.classList.toggle("open", open);
  elements.sceneRegistrationScrim.classList.toggle("open", open);
  elements.sceneRegistrationPanel.inert = !open;
  elements.sceneRegistrationPanel.setAttribute("aria-hidden", open ? "false" : "true");
  elements.openSceneRegistration.setAttribute("aria-pressed", open ? "true" : "false");
  elements.sceneRegistrationScrim.tabIndex = open ? 0 : -1;
  if (open) {
    if (!runtime.live && runtime.playing) holdPreview();
    setViewMode("machine");
    populateSceneRegistrationForm(sceneRegistrationProfile);
    renderSceneRegistration();
    elements.sceneRegistrationPanel.querySelector(".scene-registration-scroll").scrollTop = 0;
    elements.closeSceneRegistration.focus();
    requestAnimationFrame(() => {
      renderSceneRegistration();
      viewer?.setCamera("fixture");
    });
  } else {
    stopSceneCamera();
    viewer?.setSceneRegistrationOverlay({ visible: false });
    viewer?.setCamera("home");
    if (restoreFocus) elements.openSceneRegistration.focus();
  }
}

function machineCommandsEnabled() {
  return runtime.live && runtime.bridge?.machineCommands?.enabled === true;
}

function machineCommandContext() {
  const receivedAt = Date.parse(runtime.telemetry?.receivedAt);
  return {
    commandsEnabled: machineCommandsEnabled() && runtime.telemetryLinked,
    telemetry: runtime.telemetry,
    telemetryAgeMs: Number.isFinite(receivedAt) ? Math.max(0, Date.now() - receivedAt) : Number.NaN,
    observedStatusSequence: runtime.telemetry?.sequence ?? null,
  };
}

function evaluateUiMachineIntent(intent) {
  try {
    if (NATIVE_MODE && ['tool-setter', 'touch-probe', 'apply-work-offset'].includes(intent.type)) {
      const status = nativeState?.status;
      return evaluateMachineCommand(intent, { ...machineCommandContext(), telemetry: status,
        telemetryAgeMs: status ? Date.now() - Date.parse(status.receivedAt) : NaN,
        observedStatusSequence: status?.sequence,
        commandsEnabled: Boolean(nativeState?.armed && !nativeState.busy && (nativeState.motionQualified || nativeState.commissioning?.session?.capabilities.includes('workflow'))) });
    }
    return evaluateMachineCommand(intent, machineCommandContext());
  } catch (error) {
    return {
      permitted: false,
      gates: [],
      blockers: [{
        id: "intent-invalid",
        label: "COMMAND INTENT",
        passed: false,
        detail: error instanceof Error ? error.message.toUpperCase() : "COMMAND INTENT INVALID",
      }],
    };
  }
}

function transactionStatusLabel(transaction = runtime.transaction) {
  if (!transaction) return null;
  const phase = String(transaction.phase ?? transaction.state ?? "transaction").replaceAll("-", " ").toUpperCase();
  const percent = Number.isFinite(transaction.progress) ? ` / ${Math.round(transaction.progress * 100)}%` : "";
  return `${phase}${percent}`;
}

function acceptMachineTransaction(transaction) {
  if (!transaction?.id) return runtime.transaction;
  const current = runtime.transaction;
  if (
    current?.id === transaction.id
    && Number.isInteger(current.sequence)
    && Number.isInteger(transaction.sequence)
    && transaction.sequence < current.sequence
  ) return current;
  runtime.transaction = transaction;
  runtime.commandPending = !transactionIsTerminal(transaction);
  runtime.commandFeedback = transaction.error?.message ?? transactionStatusLabel(transaction);
  if (runtime.continuousJogReleasePending && transaction.intent?.type === "jog") {
    runtime.continuousJogReleasePending = false;
    if (!transactionIsTerminal(transaction) && transactionOwnedByThisUi(transaction)) {
      queueMicrotask(() => void cancelOwnedMachineTransaction("DEAD-MAN RELEASE / CANCELLING ACCEPTED JOG"));
    }
  }
  if (transaction.intent?.type === "touch-probe" && transactionIsTerminal(transaction)) {
    runtime.typedProbeCycleActive = false;
    ingestTypedProbeTransaction(transaction);
  }
  return transaction;
}

function transactionMatches(type) {
  return runtime.transaction?.intent?.type === type ? runtime.transaction : null;
}

function renderCommandPermit() {
  if (NATIVE_MODE) { renderNativeCommandState(); return; }
  if (!runtime.live) {
    elements.permitStatus.dataset.mode = "preview";
    elements.permitLabel.textContent = "READ-ONLY PREVIEW";
    return;
  }
  elements.permitStatus.dataset.mode = "live";
  if (!machineCommandsEnabled()) {
    elements.permitLabel.textContent = "TELEMETRY ONLY / PHYSICAL LOCKED";
    return;
  }
  const transaction = runtime.transaction;
  elements.permitLabel.textContent = transaction && !transactionIsTerminal(transaction)
    ? `VIRTUAL TX / ${transactionStatusLabel(transaction)}`
    : "VIRTUAL MR-1 / TYPED COMMANDS";
}

function renderMachineCommandSurfaces() {
  renderCommandPermit();
  if (elements.jogPanel.getAttribute("aria-hidden") === "false") renderJogPanel();
  if (elements.fixtureMapPanel.getAttribute("aria-hidden") === "false") renderFixtureMap();
  if (elements.probingPanel.getAttribute("aria-hidden") === "false") {
    renderSetterProfile();
    renderTouchProfile();
  }
  if (elements.machineDataPanel.getAttribute("aria-hidden") === "false") renderMachineData();
}

async function submitMachineIntent(intent, label) {
  if (NATIVE_MODE) {
    if (['tool-setter', 'touch-probe', 'apply-work-offset'].includes(intent.type)) nativeControl?.reviewWorkflow(intent);
    return null;
  }
  if (runtime.commandPending) return null;
  let submittedTransactionId = null;
  runtime.commandPending = true;
  if (intent.type === "touch-probe") runtime.typedProbeCycleActive = true;
  runtime.commandFeedback = `SUBMITTING ${label}`;
  renderMachineCommandSurfaces();
  try {
    const response = await machineCommandClient.submit(intent, {
      observedStatusSequence: runtime.telemetry?.sequence ?? null,
    });
    submittedTransactionId = response.transaction?.id ?? null;
    acceptMachineTransaction(response.transaction);
    renderMachineCommandSurfaces();
    if (transactionIsTerminal(response.transaction)) return response.transaction;
    const terminal = await machineCommandClient.waitForTerminal(response.transaction.id, {
      timeoutMs: Math.max(5_000, Number(runtime.bridge?.machineCommands?.executionTimeoutMs ?? 30_000) + 5_000),
      onUpdate: (transaction, machineCommands) => {
        if (runtime.bridge && machineCommands) runtime.bridge = { ...runtime.bridge, machineCommands };
        const currentSequence = runtime.transaction?.id === transaction.id
          ? Number(runtime.transaction.sequence ?? -1)
          : -1;
        if (Number(transaction.sequence ?? 0) <= currentSequence) return;
        acceptMachineTransaction(transaction);
        renderMachineCommandSurfaces();
      },
    });
    acceptMachineTransaction(terminal.transaction);
    if (runtime.bridge && terminal.machineCommands) {
      runtime.bridge = { ...runtime.bridge, machineCommands: terminal.machineCommands };
    }
    renderMachineCommandSurfaces();
    return terminal.transaction;
  } catch (error) {
    const transaction = error instanceof MachineCommandRequestError
      ? error.payload?.details?.transaction ?? null
      : null;
    const acceptedStateUnknown = submittedTransactionId
      && runtime.transaction?.id === submittedTransactionId
      && !transactionIsTerminal(runtime.transaction)
      && [
        "COMMAND_SERVICE_TIMEOUT",
        "COMMAND_SERVICE_UNREACHABLE",
        "TRANSACTION_RECONCILIATION_TIMEOUT",
      ].includes(error?.code);
    if (transaction) acceptMachineTransaction(transaction);
    else if (!acceptedStateUnknown) {
      runtime.commandPending = false;
      if (intent.type === "jog") runtime.continuousJogReleasePending = false;
      if (intent.type === "touch-probe") runtime.typedProbeCycleActive = false;
    }
    runtime.commandFeedback = acceptedStateUnknown
      ? `STATUS UNKNOWN / COMMANDS HELD / ${error.message}`.toUpperCase()
      : error instanceof Error ? error.message.toUpperCase() : "COMMAND REJECTED";
    renderMachineCommandSurfaces();
    return null;
  }
}

async function cancelOwnedMachineTransaction(reason = "OPERATOR CANCEL") {
  const transaction = runtime.transaction;
  if (
    !transaction
    || transactionIsTerminal(transaction)
    || !transactionOwnedByThisUi(transaction)
  ) return true;
  runtime.commandFeedback = reason;
  renderMachineCommandSurfaces();
  try {
    const response = await machineCommandClient.cancel(transaction.id);
    acceptMachineTransaction(response.transaction);
    renderMachineCommandSurfaces();
    return true;
  } catch (error) {
    runtime.commandFeedback = error instanceof Error ? error.message.toUpperCase() : "CANCEL FAILED";
    renderMachineCommandSurfaces();
    return false;
  }
}

function toolSetterIntent(settings, evaluation) {
  return {
    type: "tool-setter",
    settings,
    inputQualified: runtime.bridge?.mode === "simulate",
    profileQualified: evaluation.ready,
    expectedActiveTool: Number.isInteger(runtime.telemetry?.tool) ? runtime.telemetry.tool : null,
  };
}

function touchProbeIntent(settings, evaluation) {
  const virtualQualified = runtime.bridge?.mode === "simulate";
  const calibration = evaluateProbeCalibration(probeCalibration);
  return {
    type: "touch-probe",
    settings,
    inputQualified: virtualQualified,
    profileQualified: evaluation.ready,
    probeQualified: virtualQualified || calibration.qualified,
    probeId: virtualQualified ? "VIRTUAL-PROBE" : calibration.profile.probeId,
    qualifiedTipDiameter: virtualQualified ? settings.tipDiameter : calibration.profile.ballDiameterMm,
  };
}

function renderSetterProfile(message = "") {
  const settings = collectSetterSettings();
  const activeTool = runtime.live ? runtime.telemetry?.tool : null;
  const evaluation = evaluateToolSetter(settings, { activeTool });
  markNativeValidity(elements.setterForm);

  const computedInvalid = Number.isFinite(settings.maxSearch)
    && Number.isFinite(settings.approachClearance)
    && (settings.maxSearch - settings.approachClearance < 0.1
      || settings.maxSearch - settings.approachClearance > 1);
  if (computedInvalid) {
    elements.setterClearance.dataset.invalid = "true";
    elements.setterSearch.dataset.invalid = "true";
  }
  if (settings.latchFeed > settings.seekFeed) {
    elements.setterSeekFeed.dataset.invalid = "true";
    elements.setterLatchFeed.dataset.invalid = "true";
  }

  const pastExpected = settings.maxSearch - settings.approachClearance;
  elements.setterPastExpected.value = Number.isFinite(pastExpected)
    ? `${pastExpected.toFixed(1)} mm`
    : "--.- mm";
  elements.setterPastExpected.dataset.state = computedInvalid ? "alarm" : "";
  elements.setterExpectedContactZ.value = evaluation.envelope
    ? `${evaluation.envelope.expectedContactZ.toFixed(3)} mm`
    : "UNCALIBRATED";
  elements.setterStartZ.value = evaluation.envelope ? `${evaluation.envelope.approachZ.toFixed(3)} mm` : "UNCALIBRATED";
  elements.setterLimitZ.value = evaluation.envelope ? `${evaluation.envelope.targetZ.toFixed(3)} mm` : "UNCALIBRATED";
  if (evaluation.envelope && Number.isFinite(settings.travelZ) && settings.travelZ < evaluation.envelope.retractZ) {
    elements.setterTravelZ.dataset.invalid = "true";
  }
  if (!evaluation.toolMatches) elements.setterToolNumber.dataset.invalid = "true";
  const calibrationLabel = evaluation.ready
    ? "READY"
    : !evaluation.toolMatches ? "TOOL MISMATCH"
      : evaluation.calibrated ? "TOOL REQUIRED" : "REFERENCE REQUIRED";
  setIndicator(
    elements.setterCalibrationState,
    calibrationLabel,
    evaluation.ready ? "active" : "alarm",
  );

  let label = evaluation.errors[0]
    ?? (evaluation.ready
      ? "PROFILE READY"
      : !evaluation.toolMatches ? `TOOL NUMBER DOES NOT MATCH LIVE T${activeTool}`
        : evaluation.calibrated ? "TOOL NUMBER AND LENGTH REQUIRED" : "REFERENCE REQUIRED");
  if (message) label = `${message} / ${label}`;
  elements.setterValidation.textContent = label.toUpperCase();
  elements.setterValidation.dataset.state = evaluation.valid && evaluation.toolMatches
    ? evaluation.ready ? "valid" : ""
    : "alarm";
  elements.saveSetterProfile.disabled = !evaluation.valid;
  const commandEvaluation = evaluateUiMachineIntent(toolSetterIntent(settings, evaluation));
  const transaction = transactionMatches("tool-setter");
  const commandReady = commandEvaluation.permitted && !runtime.commandPending;
  elements.runToolSetter.disabled = !commandReady;
  elements.runToolSetter.dataset.tooltip = commandReady
    ? NATIVE_MODE ? "Review the protected tool-setter plan" : "Run protected virtual tool-setter transaction"
    : commandEvaluation.blockers[0]?.detail ?? "Tool setter command blocked";
  if (!runtime.live) setIndicator(elements.setterCommandState, "OFFLINE", "alarm");
  else if (NATIVE_MODE) setIndicator(elements.setterCommandState, nativeState?.busy ? 'NATIVE OPERATION' : commandReady ? 'REVIEW NATIVE PLAN' : 'NATIVE GATED', commandReady ? 'active' : 'alarm');
  else if (!machineCommandsEnabled()) setIndicator(elements.setterCommandState, "PHYSICAL LOCKED", "alarm");
  else if (transaction && !transactionIsTerminal(transaction)) {
    setIndicator(elements.setterCommandState, transactionStatusLabel(transaction), "active");
  } else if (transaction?.state === "completed") {
    setIndicator(elements.setterCommandState, "CONTACT + SAFE Z PROVEN", "active");
  } else if (transaction?.state === "cancelled") {
    setIndicator(elements.setterCommandState, "CANCELLED / RECOVERY REQUIRED", "alarm");
  } else if (transaction?.state === "failed" || transaction?.state === "rejected") {
    setIndicator(elements.setterCommandState, transaction.error?.message ?? "FAILED", "alarm");
  } else {
    setIndicator(elements.setterCommandState, commandReady ? "VIRTUAL READY" : "GATED", commandReady ? "active" : "alarm");
  }
  return { settings, evaluation };
}

function renderTouchProfile(message = "") {
  const draft = collectTouchSettings();
  const evaluation = evaluateTouchProbe(draft);
  const settings = evaluation.settings;
  elements.touchForm.querySelectorAll("[data-touch-cycles]").forEach((element) => {
    element.hidden = !element.dataset.touchCycles.split(" ").includes(settings.cycle);
  });
  markNativeValidity(elements.touchForm);
  if (settings.latchFeed > settings.seekFeed) {
    elements.touchSeekFeed.dataset.invalid = "true";
    elements.touchLatchFeed.dataset.invalid = "true";
  }
  if (settings.latchPullOff > settings.retractDistance) {
    elements.touchLatchPullOff.dataset.invalid = "true";
    elements.touchRetract.dataset.invalid = "true";
  }
  const firstContact = evaluation.plan?.contacts[0] ?? null;
  elements.touchPlanContacts.value = evaluation.plan
    ? `${evaluation.plan.contactCount} CONTACT${evaluation.plan.contactCount === 1 ? "" : "S"} / ${evaluation.plan.reportedTouchCount} TOUCH${evaluation.plan.reportedTouchCount === 1 ? "" : "ES"}`
    : "TARGET REQUIRED";
  elements.touchPlanStart.value = firstContact ? formatFixtureVector(firstContact.start) : "-- / -- / --";
  elements.touchPlanLimit.value = firstContact ? formatFixtureVector(firstContact.searchLimit) : "-- / -- / --";
  elements.touchPlanOvertravel.value = firstContact ? `${firstContact.pastExpected.toFixed(3)} mm` : "--";
  elements.touchPlanOvertravel.dataset.state = firstContact
    && (firstContact.pastExpected < 0.1 || firstContact.pastExpected > 1) ? "alarm" : "";
  const planLabel = evaluation.ready
    ? `PLAN READY / ${evaluation.plan.contactCount} CONTACTS / CLEARANCE RETURN VERIFIED`
    : evaluation.missing.length ? `${evaluation.missing.join(" / ")} REQUIRED` : "PLAN GATED";
  const label = message || evaluation.errors[0] || planLabel;
  elements.touchValidation.textContent = label.toUpperCase();
  elements.touchValidation.dataset.state = evaluation.ready ? "valid" : evaluation.valid ? "" : "alarm";
  elements.saveTouchProfile.disabled = !evaluation.valid;
  const commandEvaluation = evaluateUiMachineIntent(touchProbeIntent(settings, evaluation));
  const transaction = transactionMatches("touch-probe");
  const commandReady = commandEvaluation.permitted && !runtime.commandPending;
  elements.runTouchProbe.disabled = !commandReady;
  elements.runTouchProbe.dataset.tooltip = commandReady
    ? NATIVE_MODE ? `Review the protected ${settings.cycle.replaceAll("-", " ")} plan` : `Run protected virtual ${settings.cycle.replaceAll("-", " ")} transaction`
    : commandEvaluation.blockers[0]?.detail ?? "Touch-probe command blocked";
  const livePosition = runtime.telemetry?.position?.machine;
  const liveXyAvailable = Number.isFinite(livePosition?.x) && Number.isFinite(livePosition?.y);
  const liveZAvailable = Number.isFinite(livePosition?.z);
  elements.touchCaptureXy.disabled = !liveXyAvailable;
  elements.touchCaptureSafeZ.disabled = !liveZAvailable;
  if (!runtime.live) setIndicator(elements.touchCommandState, "OFFLINE", "alarm");
  else if (NATIVE_MODE) setIndicator(elements.touchCommandState, nativeState?.busy ? 'NATIVE OPERATION' : commandReady ? 'REVIEW NATIVE PLAN' : 'NATIVE GATED', commandReady ? 'active' : 'alarm');
  else if (!machineCommandsEnabled()) setIndicator(elements.touchCommandState, "PHYSICAL LOCKED", "alarm");
  else if (transaction && !transactionIsTerminal(transaction)) {
    setIndicator(elements.touchCommandState, transactionStatusLabel(transaction), "active");
  } else if (transaction?.state === "completed") {
    setIndicator(elements.touchCommandState, "CYCLE PROVEN", "active");
  } else if (transaction?.state === "cancelled") {
    setIndicator(elements.touchCommandState, "CANCELLED / RECOVERY REQUIRED", "alarm");
  } else if (transaction?.state === "failed" || transaction?.state === "rejected") {
    setIndicator(elements.touchCommandState, transaction.error?.message ?? "FAILED", "alarm");
  } else {
    setIndicator(elements.touchCommandState, commandReady ? "VIRTUAL READY" : "GATED", commandReady ? "active" : "alarm");
  }
  return { settings, evaluation };
}

function collectInputCalibrationSettings() {
  return {
    channel: elements.inputCalChannel.value,
    samplesPerFeed: inputNumber(elements.inputCalSamples),
    lowFeedMmMin: inputNumber(elements.inputCalFeedLow),
    workingFeedMmMin: inputNumber(elements.inputCalFeedWork),
    highFeedMmMin: inputNumber(elements.inputCalFeedHigh),
    maxSpreadMm: inputNumber(elements.inputCalMaxSpread),
    positionResolutionMm: 1 / MR1_CONFIG.stepsPerMm.z,
  };
}

function resetInputCalibrationResult(label = "PREVIEW OR HARDWARE RUN REQUIRED") {
  setIndicator(elements.inputCalState, "NOT RUN", "alarm");
  elements.inputCalRepeatability.value = "--.- um";
  elements.inputCalLatency.value = "NOT MEASURED";
  elements.inputCalError.value = "--.- um";
  elements.inputCalCompensation.value = "0.000 mm";
  elements.inputCalFit.value = "--";
  for (const output of [
    elements.inputCalRepeatability,
    elements.inputCalLatency,
    elements.inputCalError,
    elements.inputCalCompensation,
    elements.inputCalFit,
  ]) output.dataset.state = "";
  elements.inputCalValidation.textContent = label;
  elements.inputCalValidation.dataset.state = "";
}

function validateInputCalibrationForm({ reset = false } = {}) {
  const settings = collectInputCalibrationSettings();
  markNativeValidity(elements.inputCalForm);
  const ordered = settings.lowFeedMmMin < settings.workingFeedMmMin
    && settings.workingFeedMmMin < settings.highFeedMmMin;
  if (!ordered) {
    elements.inputCalFeedLow.dataset.invalid = "true";
    elements.inputCalFeedWork.dataset.invalid = "true";
    elements.inputCalFeedHigh.dataset.invalid = "true";
  }
  const valid = elements.inputCalForm.checkValidity() && ordered;
  elements.previewInputCal.disabled = !valid;
  elements.inputCalResolution.value = `${(settings.positionResolutionMm * 1000).toFixed(3)} um`;
  if (reset) {
    resetInputCalibrationResult(valid
      ? "SETTINGS CHANGED / RERUN PREVIEW"
      : "LOW FEED MUST BE BELOW WORK FEED AND HIGH FEED");
    elements.inputCalValidation.dataset.state = valid ? "" : "alarm";
  }
  return { settings, valid };
}

function formatLatencyBound(microseconds) {
  return microseconds >= 1000
    ? `< ${(microseconds / 1000).toFixed(2)} ms`
    : `< ${microseconds.toFixed(0)} us`;
}

function renderInputCalibrationPreview() {
  const { settings, valid } = validateInputCalibrationForm();
  if (!valid) return;
  const samples = createPreviewInputCalibration({
    channel: settings.channel,
    samplesPerFeed: settings.samplesPerFeed,
    feeds: [settings.lowFeedMmMin, settings.workingFeedMmMin, settings.highFeedMmMin],
  });
  const result = analyzeInputCalibration(samples, settings);
  if (!result.valid) {
    resetInputCalibrationResult(result.reason);
    elements.inputCalValidation.dataset.state = "alarm";
    return;
  }

  const errorUpperBoundMicrons = settings.workingFeedMmMin
    * result.detectionFloorMm / (settings.highFeedMmMin - settings.lowFeedMmMin)
    * 1000;
  elements.inputCalRepeatability.value = `${(result.repeatabilityMm * 1000).toFixed(1)} um`;
  elements.inputCalRepeatability.dataset.state = result.repeatabilityPass ? "active" : "alarm";
  elements.inputCalLatency.value = result.identifiable
    ? `${result.latencyUs.toFixed(0)} us`
    : formatLatencyBound(result.latencyUpperBoundUs);
  elements.inputCalError.value = result.identifiable
    ? `${result.effectiveErrorMicrons.toFixed(2)} um`
    : `< ${errorUpperBoundMicrons.toFixed(2)} um`;
  elements.inputCalCompensation.value = `${result.compensationMm.toFixed(3)} mm`;
  elements.inputCalFit.value = result.identifiable
    ? `RESOLVED / R2 ${result.rSquared.toFixed(3)}`
    : "BELOW MOTION RESOLUTION";
  setIndicator(
    elements.inputCalState,
    result.repeatabilityPass ? "PREVIEW PASS" : "PREVIEW FAIL",
    result.repeatabilityPass ? "active" : "alarm",
  );
  elements.inputCalValidation.textContent = result.repeatabilityPass
    ? result.identifiable
      ? "PREVIEW DATA ONLY / SPEED-DEPENDENT OFFSET RESOLVED"
      : "PREVIEW DATA ONLY / DELAY BELOW MOTION RESOLUTION / NO OFFSET APPLIED"
    : "PREVIEW DATA ONLY / REPEATABILITY EXCEEDS LIMIT";
  elements.inputCalValidation.dataset.state = result.repeatabilityPass ? "valid" : "alarm";
}

function populateProbingForms(profile) {
  const setter = profile.toolSetter;
  setNumberInput(elements.setterX, setter.x);
  setNumberInput(elements.setterY, setter.y);
  setNumberInput(elements.setterTravelZ, setter.travelZ);
  setNumberInput(elements.setterReferenceContactZ, setter.referenceContactZ);
  setNumberInput(elements.setterReferenceGaugeLength, setter.referenceGaugeLength);
  setNumberInput(elements.setterToolNumber, setter.currentToolNumber);
  setNumberInput(elements.setterCurrentGaugeLength, setter.currentGaugeLength);
  setNumberInput(elements.setterClearance, setter.approachClearance);
  setNumberInput(elements.setterSearch, setter.maxSearch);
  setNumberInput(elements.setterRetract, setter.retractDistance);
  setNumberInput(elements.setterGuardFeed, setter.guardedApproachFeed);
  setNumberInput(elements.setterLatchPullOff, setter.latchPullOff);
  setNumberInput(elements.setterSeekFeed, setter.seekFeed);
  setNumberInput(elements.setterLatchFeed, setter.latchFeed);
  setNumberInput(elements.setterRetractFeed, setter.retractFeed);
  elements.setterDoubleTouch.checked = setter.doubleTouch;

  const touch = profile.touchProbe;
  elements.touchCycle.value = touch.cycle;
  setNumberInput(elements.touchTipDiameter, touch.tipDiameter);
  setNumberInput(elements.touchTargetX, touch.targetX);
  setNumberInput(elements.touchTargetY, touch.targetY);
  setNumberInput(elements.touchTargetZ, touch.targetZ);
  setNumberInput(elements.touchSafeZ, touch.safeZ);
  setNumberInput(elements.touchMeasurementZ, touch.measurementZ);
  elements.touchDirectionX.value = String(touch.directionX);
  elements.touchDirectionY.value = String(touch.directionY);
  setNumberInput(elements.touchFeatureDiameter, touch.featureDiameter);
  setNumberInput(elements.touchCornerOffset, touch.cornerSampleOffset);
  setNumberInput(elements.touchClearance, touch.approachClearance);
  setNumberInput(elements.touchSearch, touch.maxSearch);
  setNumberInput(elements.touchRetract, touch.retractDistance);
  setNumberInput(elements.touchGuardFeed, touch.guardedApproachFeed);
  setNumberInput(elements.touchLatchPullOff, touch.latchPullOff);
  setNumberInput(elements.touchSeekFeed, touch.seekFeed);
  setNumberInput(elements.touchLatchFeed, touch.latchFeed);
  setNumberInput(elements.touchRetractFeed, touch.retractFeed);
  elements.touchDoubleTouch.checked = touch.doubleTouch;
  renderSetterProfile();
  renderTouchProfile();
}

const WIRE_COLOR_CSS = Object.freeze({
  red: "#cf3d43",
  black: "#111315",
  white: "#f2f1ed",
  gray: "#8b949d",
  yellow: "#e7c84b",
  blue: "#3c75ba",
  orange: "#d97932",
  green: "#4a9b69",
  brown: "#765141",
  violet: "#8d67ad",
  bare: "#b1a58f",
});

const TRIGGER_LABELS = Object.freeze({
  "active-low-open-collector": "ACTIVE LOW / OPEN COLLECTOR",
  "active-high-push-pull": "ACTIVE HIGH / PUSH-PULL",
  "dry-contact-no": "DRY CONTACT / NORMALLY OPEN",
  "dry-contact-nc": "DRY CONTACT / NORMALLY CLOSED",
});

function initializeWiringColorControls() {
  for (const sensor of Object.values(wiringProfileElements.sensors)) {
    for (const select of Object.values(sensor.colors)) {
      if (select.options.length) continue;
      for (const color of WIRE_COLORS) {
        const option = document.createElement("option");
        option.value = color;
        option.textContent = color.toUpperCase();
        select.append(option);
      }
    }
  }
}

function updateWiringColorSwatches() {
  document.querySelectorAll("[data-wire-swatch]").forEach((swatch) => {
    const select = document.getElementById(swatch.dataset.wireSwatch);
    swatch.style.setProperty("--wire-swatch", WIRE_COLOR_CSS[select?.value] ?? WIRE_COLOR_CSS.gray);
  });
}

function collectWiringSensor(key) {
  const sensor = wiringProfileElements.sensors[key];
  return {
    enabled: sensor.enabled.checked,
    sensorLabel: sensor.label.value,
    inputChannel: sensor.input.value,
    outputChannel: sensor.output.value,
    destination: sensor.destination.value,
    customConnector: sensor.customConnector.value,
    customGpio: sensor.customGpio.value,
    colors: Object.fromEntries(
      Object.entries(sensor.colors).map(([role, select]) => [role, select.value]),
    ),
  };
}

function collectSensorWiringProfile() {
  return {
    version: 1,
    name: wiringProfileElements.name.value,
    interface: {
      type: wiringProfileElements.interfaceType.value,
      label: wiringProfileElements.interfaceLabel.value,
      fieldVoltage: inputNumber(wiringProfileElements.fieldVoltage),
      isolatedSupply: wiringProfileElements.isolatedSupply.checked,
      trigger: wiringProfileElements.trigger.value,
      pullupOhms: inputNumber(wiringProfileElements.pullup),
    },
    touch: collectWiringSensor("touch"),
    setter: collectWiringSensor("setter"),
  };
}

function populateWiringSensor(key, profile) {
  const sensor = wiringProfileElements.sensors[key];
  sensor.enabled.checked = profile.enabled;
  sensor.label.value = profile.sensorLabel;
  sensor.input.value = profile.inputChannel;
  sensor.output.value = profile.outputChannel;
  sensor.destination.value = profile.destination;
  sensor.customConnector.value = profile.customConnector;
  sensor.customGpio.value = profile.customGpio;
  for (const [role, select] of Object.entries(sensor.colors)) select.value = profile.colors[role];
}

function updateWiringProfileFormState() {
  for (const [key, sensor] of Object.entries(wiringProfileElements.sensors)) {
    const editor = document.querySelector(`[data-sensor-editor="${key}"]`);
    editor.dataset.enabled = sensor.enabled.checked ? "true" : "false";
    editor.querySelectorAll("input, select").forEach((control) => {
      if (control === sensor.enabled) return;
      control.disabled = !sensor.enabled.checked;
    });
    const custom = sensor.enabled.checked && sensor.destination.value === "custom";
    document.querySelectorAll(`[data-custom-destination="${key}"]`).forEach((label) => {
      label.hidden = !custom;
    });
    sensor.customConnector.disabled = !custom;
    sensor.customGpio.disabled = !custom;
    sensor.customConnector.required = custom;
    sensor.customGpio.required = custom;
  }
  updateWiringColorSwatches();
}

function populateSensorWiringForm(profile) {
  wiringProfileElements.name.value = profile.name;
  wiringProfileElements.interfaceType.value = profile.interface.type;
  wiringProfileElements.interfaceLabel.value = profile.interface.label;
  setNumberInput(wiringProfileElements.fieldVoltage, profile.interface.fieldVoltage);
  setNumberInput(wiringProfileElements.pullup, profile.interface.pullupOhms);
  wiringProfileElements.trigger.value = profile.interface.trigger;
  wiringProfileElements.isolatedSupply.checked = profile.interface.isolatedSupply;
  populateWiringSensor("touch", profile.touch);
  populateWiringSensor("setter", profile.setter);
  updateWiringProfileFormState();
}

function formatVoltage(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function wireColorSummary(sensor) {
  return [sensor.colors.power, sensor.colors.signal, sensor.colors.return, sensor.colors.shield]
    .map((color) => color.toUpperCase())
    .join("-");
}

function renderWiringSensorSummary(key, sensor) {
  const prefix = key === "touch" ? "activeTouch" : "activeSetter";
  const destination = sensorDestination(sensor);
  wiringProfileElements[`${prefix}Name`].textContent = sensor.enabled ? sensor.sensorLabel.toUpperCase() : "CHANNEL DISABLED";
  wiringProfileElements[`${prefix}Field`].textContent = sensor.enabled
    ? `${sensor.inputChannel} / ${wireColorSummary(sensor)}`
    : "NO FIELD CONNECTION";
  wiringProfileElements[`${prefix}Logic`].textContent = sensor.enabled
    ? `${sensor.outputChannel} -> ${destination.connector} / ${destination.gpio}`
    : "NO CONTROLLER CONNECTION";
}

function renderSensorWiringProfile(profileCandidate, { draft = false, message = "" } = {}) {
  const evaluation = evaluateSensorWiringProfile(profileCandidate);
  const profile = evaluation.profile;
  const enabledChannels = [profile.touch, profile.setter]
    .filter((sensor) => sensor.enabled)
    .map((sensor) => sensor.inputChannel);
  const voltage = formatVoltage(profile.interface.fieldVoltage);
  wiringProfileElements.activeName.textContent = profile.name.toUpperCase();
  wiringProfileElements.activeInterface.textContent = `${profile.interface.label.toUpperCase()} / ${profile.interface.isolatedSupply ? "ISOLATED " : ""}${voltage}V`;
  wiringProfileElements.activeTrigger.textContent = TRIGGER_LABELS[profile.interface.trigger];
  renderWiringSensorSummary("touch", profile.touch);
  renderWiringSensorSummary("setter", profile.setter);
  setIndicator(
    wiringProfileElements.targetPath,
    `${profile.interface.label.toUpperCase()} / ${enabledChannels.join(" + ") || "NO CHANNEL"}`,
    evaluation.valid ? "" : "alarm",
  );
  setIndicator(
    wiringProfileElements.fieldPower,
    profile.interface.type === "direct-dry"
      ? "3.3V LOGIC"
      : `${profile.interface.isolatedSupply ? "ISOLATED " : "SHARED "}${voltage}V`,
    profile.interface.isolatedSupply || profile.interface.type === "direct-dry" ? "" : "alarm",
  );
  setIndicator(
    wiringProfileElements.firmwareState,
    evaluation.firmwareMatch ? "MATCH" : "BUILD REQUIRED",
    evaluation.firmwareMatch ? "active" : "alarm",
  );

  const stateMessage = message
    || (evaluation.errors[0]
      ? evaluation.errors[0]
      : draft
        ? `DRAFT / NOT SAVED / ${evaluation.firmwareMatch ? "FIRMWARE MATCH" : "FIRMWARE BUILD REQUIRED"}`
        : evaluation.firmwareMatch
          ? "SAVED PROFILE MATCHES THE COMPILED PF5 / PB7 ACTIVE-LOW INPUT MAP."
          : "SAVED WIRING PLAN REQUIRES A MATCHING FIRMWARE BUILD BEFORE CONNECTION.");
  wiringProfileElements.state.textContent = stateMessage.toUpperCase();
  wiringProfileElements.state.classList.toggle("alarm", !evaluation.valid || !evaluation.firmwareMatch);
  wiringProfileElements.state.title = [...evaluation.errors, ...evaluation.warnings].join("\n");

  const validationMessage = evaluation.errors[0]
    || evaluation.warnings[0]
    || (evaluation.firmwareMatch ? "PROFILE READY / FIRMWARE MATCH" : "PROFILE READY / FIRMWARE BUILD REQUIRED");
  wiringProfileElements.validation.textContent = validationMessage.toUpperCase();
  wiringProfileElements.validation.dataset.state = evaluation.valid
    ? evaluation.firmwareMatch ? "valid" : "alarm"
    : "alarm";
  wiringProfileElements.save.disabled = !evaluation.valid;
  return evaluation;
}

function previewSensorWiringProfile() {
  updateWiringProfileFormState();
  return renderSensorWiringProfile(collectSensorWiringProfile(), { draft: true });
}

function renderWiringEvidenceState() {
  const evaluation = evaluateWiringEvidence(wiringEvidence);
  wiringInstallationElements.evidenceCount.textContent = `${evaluation.passed} OF ${evaluation.total}`;
  wiringInstallationElements.evidenceCount.dataset.state = evaluation.allRecorded ? "active" : "alarm";
  wiringInstallationElements.evidenceState.textContent = `${evaluation.status} / ${WIRING_AUDIT.productionState}.`;
  wiringInstallationElements.evidenceState.classList.toggle("alarm", !evaluation.allRecorded);
  wiringInstallationElements.evidenceState.title = "Recording every item does not enable motion or replace the formal commissioning procedure.";
  return evaluation;
}

function firmwareRoleLabel(role) {
  if (role === "source-image") return "SOURCE / firmware.bin";
  if (role === "card-result") return "CARD / FIRMWARE.CUR";
  if (role === "unexpected-name") return "RENAME REQUIRED";
  return "--";
}

function renderFirmwareFlashState(message = "") {
  const elements = wiringInstallationElements.firmware;
  const preflight = runtime.bridge?.controllerPreflight ?? null;
  const evaluation = evaluateFirmwareFlashEvidence({
    verification: firmwareVerification,
    attestations: firmwareFlashAttestations,
    preflight,
    candidate: OCTOPUS_FIRMWARE_CANDIDATE,
  });

  setIndicator(elements.gates.content, evaluation.gates.exactContent ? "EXACT" : "LOCKED", evaluation.gates.exactContent ? "active" : "alarm");
  setIndicator(elements.gates.card, evaluation.gates.bootloaderResult ? "FIRMWARE.CUR" : "LOCKED", evaluation.gates.bootloaderResult ? "active" : "alarm");
  setIndicator(
    elements.gates.operator,
    `${evaluation.attestationCount} OF ${FIRMWARE_FLASH_ATTESTATIONS.length}`,
    evaluation.gates.operatorAttestations ? "active" : "alarm",
  );
  setIndicator(elements.gates.preflight, evaluation.preflight.status, evaluation.gates.physicalPreflight ? "active" : "alarm");
  setIndicator(elements.recordCount, `${evaluation.passed} OF ${evaluation.total}`, evaluation.readyToArchive ? "active" : "alarm");
  elements.recordState.textContent = (message || evaluation.status).toUpperCase();
  elements.recordState.dataset.state = evaluation.readyToArchive ? "active" : "alarm";
  elements.downloadRecord.disabled = firmwareFlashRecordBusy || !evaluation.readyToArchive;
  return evaluation;
}

function renderFirmwareVerification(message = "") {
  const elements = wiringInstallationElements.firmware;
  const verification = firmwareVerification;
  const verdict = verification?.cardResultVerified
    ? "CARD RESULT VERIFIED"
    : verification?.sourceReady
      ? "SOURCE VERIFIED"
      : verification?.contentVerified
        ? "RENAME REQUIRED"
        : verification ? "REJECTED" : "NO FILE";
  setIndicator(elements.verdict, verdict, verification?.contentVerified ? "active" : "alarm");
  setIndicator(elements.name, verification?.filename ?? "--");
  setIndicator(elements.bytes, verification ? verification.bytes.toLocaleString("en-US") : "--", verification?.byteCountMatches ? "active" : verification ? "alarm" : "");
  setIndicator(elements.role, firmwareRoleLabel(verification?.fileRole), verification?.fileRole === "unexpected-name" ? "alarm" : verification ? "active" : "");
  setIndicator(elements.content, verification?.contentVerified ? "EXACT MATCH" : verification ? "REJECTED" : "UNVERIFIED", verification?.contentVerified ? "active" : "alarm");
  elements.sha256.textContent = verification?.sha256 ?? "--";
  elements.sha256.title = verification?.sha256 ?? "No local file verified";
  elements.validation.textContent = (message
    || verification?.status
    || "SELECT THE DOWNLOADED firmware.bin BEFORE COPYING IT. AFTER FLASHING, SELECT FIRMWARE.CUR DIRECTLY FROM THE CARD.").toUpperCase();
  elements.validation.dataset.state = verification?.contentVerified ? "active" : "alarm";
  return renderFirmwareFlashState();
}

async function verifySelectedFirmwareFile() {
  const elements = wiringInstallationElements.firmware;
  const file = elements.file.files?.[0];
  if (!file) return;
  elements.choose.disabled = true;
  setIndicator(elements.verdict, "HASHING");
  elements.validation.textContent = "CALCULATING LOCAL SHA-256 / FILE NEVER LEAVES THIS BROWSER";
  elements.validation.dataset.state = "";
  try {
    firmwareVerification = await verifyFirmwareCandidateFile(file, OCTOPUS_FIRMWARE_CANDIDATE);
    renderFirmwareVerification();
  } catch (error) {
    firmwareVerification = null;
    renderFirmwareVerification(error instanceof Error ? error.message : "FIRMWARE VERIFICATION FAILED");
  } finally {
    elements.file.value = "";
    elements.choose.disabled = false;
  }
}

async function downloadFirmwareFlashRecord() {
  const elements = wiringInstallationElements.firmware;
  const preflight = runtime.bridge?.controllerPreflight ?? null;
  let finalMessage = "";
  firmwareFlashRecordBusy = true;
  renderFirmwareFlashState("SEALING FLASH EVIDENCE");
  try {
    const record = await createFirmwareFlashRecord({
      verification: firmwareVerification,
      attestations: firmwareFlashAttestations,
      preflight,
      candidate: OCTOPUS_FIRMWARE_CANDIDATE,
      machine: { id: machineIdentity.machineId, name: machineIdentity.label },
    });
    const blob = new Blob([`${JSON.stringify(record, null, 2)}\n`], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mr1-octopus-flash-${record.createdAt.replaceAll(/[:.]/g, "-")}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    finalMessage = "SEALED RECORD DOWNLOADED / ARCHIVE WITH BOARD PHOTOS + PREFLIGHT";
  } catch (error) {
    finalMessage = error instanceof Error ? error.message : "FLASH RECORD DOWNLOAD FAILED";
  } finally {
    firmwareFlashRecordBusy = false;
    renderFirmwareFlashState(finalMessage);
  }
}

function renderControllerPreflight() {
  const elements = wiringInstallationElements.preflight;
  const report = runtime.bridge?.controllerPreflight ?? null;
  elements.issues.replaceChildren();

  if (!report) {
    setIndicator(elements.state, "OFFLINE", "alarm");
    setIndicator(elements.board, "--");
    setIndicator(elements.settings, "0 / 0");
    setIndicator(elements.machine, "--");
    setIndicator(elements.inputs, "--");
    setIndicator(elements.policy, "READ ONLY");
    setIndicator(elements.fingerprint, "--");
    elements.next.textContent = "CONNECT TELEMETRY TO BEGIN";
    elements.next.dataset.state = "alarm";
    elements.download.disabled = true;
    renderFirmwareFlashState();
    return;
  }

  const counts = report.counts ?? {};
  const running = report.status === "RUNNING" || report.status === "PENDING";
  const passed = report.status === "PASS";
  const failed = report.status === "BLOCKED" || report.status === "ERROR";
  const stateLabel = running
    ? report.status
    : passed
      ? report.simulated ? "SIM CONTRACT PASS" : "CONTRACT PASS"
      : report.status ?? "BLOCKED";
  setIndicator(elements.state, stateLabel, passed ? "active" : failed ? "alarm" : "");
  setIndicator(
    elements.board,
    report.boardIdentityPresent ? report.simulated ? "SIM MATCH" : "EXACT MATCH" : "NO MATCH",
    report.boardIdentityPresent ? "active" : "alarm",
  );
  setIndicator(
    elements.settings,
    `${Number(counts.settingsPassed ?? 0)} / ${Number(counts.settingsExpected ?? 0)}`,
    Number(counts.settingsExpected) > 0 && counts.settingsPassed === counts.settingsExpected ? "active" : "alarm",
  );
  setIndicator(
    elements.machine,
    report.machineState?.toUpperCase() ?? (running ? "READING" : "--"),
    report.machineState && /^(?:Idle|Alarm)(?::.*)?$/i.test(report.machineState) ? "active" : running ? "" : "alarm",
  );
  setIndicator(elements.inputs, report.activePins || (report.machineState ? "CLEAR" : "--"), report.activePins ? "alarm" : report.machineState ? "active" : "");
  setIndicator(elements.policy, runtime.bridge?.serialWritePolicy === "status-and-read-only-preflight" ? "ALLOW-LIST" : "READ ONLY", "active");
  setIndicator(elements.fingerprint, report.transcriptSha256?.slice(0, 12) ?? "--", report.transcriptSha256 ? "active" : "");

  const visibleIssues = (report.issues ?? []).slice(0, 8);
  for (const item of visibleIssues) {
    const row = document.createElement("article");
    row.className = "controller-preflight-issue";
    row.dataset.severity = item.severity;
    const code = document.createElement("strong");
    code.textContent = item.code.replaceAll("_", " ");
    const message = document.createElement("span");
    message.textContent = item.message;
    row.append(code, message);
    elements.issues.append(row);
  }
  const totalIssues = Number(report.issueCount ?? report.issues?.length ?? 0);
  if (totalIssues > visibleIssues.length) {
    const remaining = document.createElement("small");
    remaining.textContent = `+${totalIssues - visibleIssues.length} MORE IN REPORT`;
    elements.issues.append(remaining);
  }

  if (passed && report.simulated) {
    elements.next.textContent = "SIMULATION CHECKER PROVED / RUN AGAIN WITH THE OCTOPUS CONNECTED";
  } else if (passed) {
    elements.next.textContent = "FIRMWARE CONTRACT MATCHED / CONTINUE DE-ENERGIZED I/O COMMISSIONING";
  } else if (running) {
    elements.next.textContent = "READING BOARD IDENTITY AND SETTINGS";
  } else {
    elements.next.textContent = report.issues?.find((item) => item.severity === "blocker")?.message
      ?? "CONTROLLER PREFLIGHT REQUIRES ATTENTION";
  }
  elements.next.dataset.state = passed ? "active" : "alarm";
  elements.download.disabled = report.reportAvailable !== true;
  renderFirmwareFlashState();
}

async function downloadControllerPreflight() {
  const summary = runtime.bridge?.controllerPreflight;
  if (!summary?.reportAvailable || !summary.transcriptSha256) return;
  const button = wiringInstallationElements.preflight.download;
  button.disabled = true;
  try {
    const response = await fetch(CONTROLLER_PREFLIGHT_ENDPOINT, { cache: "no-store" });
    if (!response.ok) throw new Error(`Report request failed with HTTP ${response.status}.`);
    const report = await response.json();
    if (report?.transcriptSha256 !== summary.transcriptSha256 || !Array.isArray(report?.settings)) {
      throw new Error("Controller preflight report did not match the live summary.");
    }
    const timestamp = String(report.capturedAt ?? new Date().toISOString()).replaceAll(/[:.]/g, "-");
    const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mr1-controller-preflight-${timestamp}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (error) {
    const status = wiringInstallationElements.preflight.next;
    status.textContent = error instanceof Error ? error.message.toUpperCase() : "REPORT DOWNLOAD FAILED";
    status.dataset.state = "alarm";
  } finally {
    button.disabled = false;
  }
}

function formatControllerSettingValue(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "--";
  return String(Number(value));
}

function controllerSettingsPlanEvaluation() {
  if (!controllerSettingsReport) return null;
  try {
    return evaluateControllerSettingsPlan({
      report: controllerSettingsReport,
      staged: controllerSettingsStaged,
      confirmed: controllerSettingsElements.confirm.checked,
    });
  } catch {
    return null;
  }
}

function setControllerSystemTab(tab) {
  let found = false;
  controllerSettingsElements.tabs.forEach((button) => {
    const active = button.dataset.controllerSystemTab === tab;
    found ||= active;
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
  if (!found) return;
  controllerSettingsElements.panels.forEach((panel) => {
    const active = panel.dataset.controllerSystemPanel === tab;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  elements.controllerSettingsPanel.querySelector(".controller-system-scroll").scrollTop = 0;
  if (tab === "firmware") renderControllerFirmware();
}

function controllerSettingMatchesFilter(setting) {
  const query = controllerSettingsElements.search.value.trim().toLowerCase();
  const category = controllerSettingsElements.category.value;
  const state = controllerSettingsElements.state.value;
  const staged = Object.hasOwn(controllerSettingsStaged, setting.id);
  if (category !== "all" && setting.category !== category) return false;
  if (state === "changed" && !staged) return false;
  if (state === "mismatch" && setting.status !== "MISMATCH") return false;
  if ((state === "blocker" || state === "warning") && setting.severity !== state) return false;
  if (!query) return true;
  return [
    `$${setting.id}`,
    setting.name,
    setting.category,
    setting.kind,
    setting.unit,
    setting.severity,
    setting.status,
  ].join(" ").toLowerCase().includes(query);
}

function stageControllerSetting(id, value) {
  const setting = controllerSettingsReport?.settings.find((candidate) => candidate.id === Number(id));
  if (!setting) return;
  const numeric = value === "" ? "" : Number(value);
  if (numeric !== "" && Number.isFinite(numeric) && setting.actual !== null && Math.abs(numeric - setting.actual) <= 1e-12) {
    delete controllerSettingsStaged[setting.id];
  } else {
    controllerSettingsStaged[setting.id] = numeric;
  }
  controllerSettingsElements.confirm.checked = false;
  controllerSettingsMessage = "STAGED VALUES REQUIRE REVIEW";
  controllerSettingsMessageState = "";
  renderControllerSettings();
}

function createControllerSettingEditor(setting) {
  const editor = document.createElement("label");
  editor.className = "controller-setting-editor";
  editor.setAttribute("aria-label", `New value for setting $${setting.id} ${setting.name}`);
  const hasStagedValue = Object.hasOwn(controllerSettingsStaged, setting.id);
  const value = hasStagedValue ? controllerSettingsStaged[setting.id] : setting.actual;
  let control;
  if (setting.kind === "boolean") {
    control = document.createElement("select");
    for (const [optionValue, label] of [[0, "OFF / 0"], [1, "ON / 1"]]) {
      const option = document.createElement("option");
      option.value = String(optionValue);
      option.textContent = label;
      control.append(option);
    }
    control.value = String(value);
  } else {
    control = document.createElement("input");
    control.type = "number";
    control.min = String(setting.minimum);
    control.max = String(setting.maximum);
    control.step = String(setting.step);
    control.value = value ?? "";
    control.inputMode = setting.kind === "number" ? "decimal" : "numeric";
  }
  control.dataset.controllerSettingInput = String(setting.id);
  control.disabled = setting.actual === null || controllerSettingsBusy;
  control.title = `${setting.kind.toUpperCase()} / ${setting.minimum} TO ${setting.maximum}`;
  control.addEventListener("change", () => stageControllerSetting(setting.id, control.value));
  const unit = document.createElement("small");
  unit.textContent = setting.unit || setting.kind.toUpperCase();
  unit.title = setting.unit || setting.kind;
  editor.append(control, unit);
  return editor;
}

function renderControllerSettingList() {
  const report = controllerSettingsReport;
  controllerSettingsElements.list.replaceChildren();
  if (!report) {
    controllerSettingsElements.empty.hidden = false;
    controllerSettingsElements.empty.textContent = "NO CONTROLLER SETTINGS LOADED";
    return;
  }
  const plan = controllerSettingsPlanEvaluation();
  const invalidIds = new Set((plan?.errors ?? []).flatMap((error) => {
    const match = String(error).match(/\$(\d+)/);
    return match ? [Number(match[1])] : [];
  }));
  const visible = report.settings.filter(controllerSettingMatchesFilter);
  controllerSettingsElements.empty.hidden = visible.length > 0;
  controllerSettingsElements.empty.textContent = "NO SETTINGS MATCH THIS FILTER";

  for (const setting of visible) {
    const row = document.createElement("article");
    row.className = "controller-setting-row";
    row.dataset.settingId = String(setting.id);
    row.dataset.status = setting.status;
    row.dataset.staged = Object.hasOwn(controllerSettingsStaged, setting.id) ? "true" : "false";
    row.dataset.invalid = invalidIds.has(setting.id) ? "true" : "false";

    const identity = document.createElement("div");
    identity.className = "controller-setting-identity";
    const title = document.createElement("div");
    const id = document.createElement("code");
    id.textContent = `$${setting.id}`;
    const name = document.createElement("strong");
    name.textContent = setting.name.toUpperCase();
    name.title = setting.name;
    title.append(id, name);
    const metadata = document.createElement("small");
    const category = document.createElement("b");
    category.textContent = setting.category.toUpperCase();
    metadata.append(category, ` / ${setting.severity.toUpperCase()} / ${setting.kind.toUpperCase()}`);
    identity.append(title, metadata);

    const values = document.createElement("div");
    values.className = "controller-setting-values";
    const live = document.createElement("span");
    live.className = "controller-setting-live";
    const liveLabel = document.createElement("b");
    liveLabel.textContent = "LIVE";
    const liveValue = document.createElement("output");
    liveValue.textContent = formatControllerSettingValue(setting.actual);
    live.append(liveLabel, liveValue);
    const expected = document.createElement("span");
    const expectedLabel = document.createElement("b");
    expectedLabel.textContent = "MR-1";
    const expectedValue = document.createElement("output");
    expectedValue.textContent = formatControllerSettingValue(setting.expected);
    expected.append(expectedLabel, expectedValue);
    values.append(live, expected);

    const editor = createControllerSettingEditor(setting);
    const reset = document.createElement("button");
    reset.className = "controller-setting-reset";
    reset.type = "button";
    reset.setAttribute("aria-label", `Stage MR-1 default for setting $${setting.id}`);
    reset.dataset.tooltip = "Stage MR-1 default";
    reset.disabled = setting.actual === null
      || (!Object.hasOwn(controllerSettingsStaged, setting.id) && Math.abs(setting.actual - setting.expected) <= 1e-12);
    const resetIcon = elements.restart.querySelector("svg")?.cloneNode(true);
    if (resetIcon) reset.append(resetIcon);
    else reset.textContent = "R";
    reset.addEventListener("click", () => stageControllerSetting(setting.id, setting.expected));
    row.append(identity, values, editor, reset);
    controllerSettingsElements.list.append(row);
  }
}

function renderControllerSettingsDiff(plan) {
  controllerSettingsElements.diff.replaceChildren();
  if (!plan?.changes.length) {
    const empty = document.createElement("p");
    empty.textContent = "NO STAGED CHANGES";
    controllerSettingsElements.diff.append(empty);
    return;
  }
  for (const change of plan.changes) {
    const row = document.createElement("div");
    row.className = "controller-settings-diff-row";
    const id = document.createElement("code");
    id.textContent = `$${change.id}`;
    const name = document.createElement("span");
    name.textContent = change.name.toUpperCase();
    name.title = change.name;
    const from = document.createElement("span");
    from.textContent = formatControllerSettingValue(change.from);
    const arrow = document.createElement("i");
    arrow.textContent = ">";
    const to = document.createElement("strong");
    to.textContent = `${formatControllerSettingValue(change.to)}${change.unit ? ` ${change.unit}` : ""}`;
    row.append(id, name, from, arrow, to);
    controllerSettingsElements.diff.append(row);
  }
}

function renderControllerFirmware() {
  const report = controllerSettingsReport;
  const summary = runtime.bridge?.controllerPreflight ?? report;
  controllerSettingsElements.firmwareBoard.textContent = OCTOPUS_FIRMWARE_CANDIDATE.board.replace("BIGTREETECH ", "");
  controllerSettingsElements.firmwareMcu.textContent = OCTOPUS_FIRMWARE_CANDIDATE.mcu;
  controllerSettingsElements.firmwareFilename.textContent = OCTOPUS_FIRMWARE_CANDIDATE.filename;
  controllerSettingsElements.firmwareBytes.textContent = `${OCTOPUS_FIRMWARE_CANDIDATE.bytes.toLocaleString("en-US")} BYTES`;
  controllerSettingsElements.firmwareSha.textContent = OCTOPUS_FIRMWARE_CANDIDATE.sha256;
  controllerSettingsElements.firmwareSha.title = OCTOPUS_FIRMWARE_CANDIDATE.sha256;
  controllerSettingsElements.firmwareAddress.textContent = OCTOPUS_FIRMWARE_CANDIDATE.applicationAddress;
  controllerSettingsElements.firmwareDownload.href = OCTOPUS_FIRMWARE_CANDIDATE.downloadPath;
  controllerSettingsElements.firmwareManifest.href = OCTOPUS_FIRMWARE_CANDIDATE.manifestPath;
  setIndicator(
    controllerSettingsElements.firmwareImage,
    firmwareVerification?.contentVerified
      ? firmwareVerification.cardResultVerified ? "CARD VERIFIED" : "HASH VERIFIED"
      : firmwareVerification ? "REJECTED" : "NOT CHECKED",
    firmwareVerification?.contentVerified ? "active" : "alarm",
  );
  const preflightPassed = summary?.status === "PASS";
  setIndicator(
    controllerSettingsElements.firmwarePreflight,
    preflightPassed ? summary.simulated ? "SIM PASS" : "PHYSICAL PASS" : summary?.status ?? "OFFLINE",
    preflightPassed ? "active" : "alarm",
  );
  const virtualEnabled = report?.simulated === true
    && runtime.bridge?.controllerSettings?.simulatedApplyEnabled !== false;
  setIndicator(controllerSettingsElements.firmwareSimulation, virtualEnabled ? "READY" : "OFFLINE", virtualEnabled ? "active" : "");
}

function renderControllerSettings() {
  const report = controllerSettingsReport;
  const plan = controllerSettingsPlanEvaluation();
  const stagedCount = Object.keys(controllerSettingsStaged).length;
  setIndicator(controllerSettingsElements.source, report ? report.simulated ? "SIMULATION" : "PHYSICAL" : "OFFLINE", report ? "active" : "");
  setIndicator(controllerSettingsElements.profile, report?.profile?.toUpperCase() || "UNBOUND", report?.profile ? "active" : "alarm");
  setIndicator(
    controllerSettingsElements.count,
    report ? `${report.counts.settingsPassed} OF ${report.counts.settingsExpected}` : "0 OF 0",
    report && report.counts.settingsPassed === report.counts.settingsExpected ? "active" : report ? "alarm" : "",
  );
  setIndicator(controllerSettingsElements.staged, String(stagedCount), stagedCount ? "alarm" : "");
  controllerSettingsElements.captured.textContent = report?.capturedAt
    ? `CAPTURED ${report.capturedAt.replace("T", " ").slice(0, 19)}Z / ${report.machineState.toUpperCase()}${report.activePins ? ` / PINS ${report.activePins}` : " / INPUTS CLEAR"}`
    : "NO LIVE SNAPSHOT";
  controllerSettingsElements.fingerprint.textContent = report?.transcriptSha256
    ? `SHA-256 ${report.transcriptSha256}`
    : "SHA-256 --";
  controllerSettingsElements.fingerprint.title = report?.transcriptSha256 ?? "No exact settings transcript loaded";
  controllerSettingsElements.refresh.dataset.busy = controllerSettingsBusy ? "true" : "false";
  controllerSettingsElements.refresh.disabled = controllerSettingsBusy;
  controllerSettingsElements.discard.disabled = stagedCount === 0 || controllerSettingsBusy;
  controllerSettingsElements.confirm.disabled = stagedCount === 0 || Boolean(plan?.errors.length) || controllerSettingsBusy;
  controllerSettingsElements.exportSnapshot.disabled = !report || controllerSettingsBusy;
  controllerSettingsElements.exportPlan.disabled = !plan?.changes.length || Boolean(plan?.errors.length) || !plan?.baselineBound || controllerSettingsBusy;
  controllerSettingsElements.apply.disabled = !plan?.readyToApply || controllerSettingsBusy;
  controllerSettingsElements.apply.querySelector("span").textContent = report?.simulated ? "APPLY VIRTUAL" : "PHYSICAL LOCKED";

  const virtualReady = report?.simulated === true
    && runtime.bridge?.controllerSettings?.simulatedApplyEnabled !== false;
  controllerSettingsElements.policy.textContent = virtualReady
    ? "SIMULATION-ONLY APPLY / PHYSICAL SETTING WRITES LOCKED"
    : "PHYSICAL SETTING WRITES LOCKED";
  const planStatus = controllerSettingsMessage || plan?.status || "CONNECT LOCAL SERVICE TO LOAD SETTINGS";
  controllerSettingsElements.validation.textContent = planStatus.toUpperCase();
  controllerSettingsElements.validation.dataset.state = controllerSettingsMessageState
    || (plan?.errors.length ? "alarm" : plan?.readyToApply ? "valid" : report && !report.simulated && plan?.changes.length ? "alarm" : "");
  renderControllerSettingList();
  renderControllerSettingsDiff(plan);
  renderControllerFirmware();
}

function syncControllerSettingsFromBridge() {
  if (elements.controllerSettingsPanel.getAttribute("aria-hidden") !== "false") return;
  const summary = runtime.bridge?.controllerPreflight;
  if (summary?.reportAvailable && summary.transcriptSha256 !== controllerSettingsReport?.transcriptSha256) {
    void fetchControllerSettingsReport();
    return;
  }
  renderControllerSettings();
}

async function fetchControllerSettingsReport({ preserveMessage = false } = {}) {
  if (controllerSettingsBusy) return;
  controllerSettingsBusy = true;
  if (!preserveMessage) {
    controllerSettingsMessage = "READING COMPLETE CONTROLLER PROFILE";
    controllerSettingsMessageState = "";
  }
  renderControllerSettings();
  try {
    const response = await fetch(CONTROLLER_PREFLIGHT_ENDPOINT, { cache: "no-store" });
    if (!response.ok) throw new Error(`Controller report request failed with HTTP ${response.status}.`);
    const next = normalizeControllerSettingsReport(await response.json());
    if (controllerSettingsReport?.transcriptSha256 && controllerSettingsReport.transcriptSha256 !== next.transcriptSha256) {
      controllerSettingsStaged = {};
      controllerSettingsElements.confirm.checked = false;
    }
    controllerSettingsReport = next;
    controllerSettingsMessage = `${next.settings.length} SETTINGS LOADED / EXACT SHA-256 BASELINE`;
    controllerSettingsMessageState = next.status === "PASS" ? "valid" : "alarm";
  } catch (error) {
    controllerSettingsReport = null;
    controllerSettingsStaged = {};
    controllerSettingsElements.confirm.checked = false;
    controllerSettingsMessage = error instanceof Error ? error.message : "CONTROLLER SETTINGS LOAD FAILED";
    controllerSettingsMessageState = "alarm";
  } finally {
    controllerSettingsBusy = false;
    renderControllerSettings();
  }
}

function downloadControllerSettingsArtifact(artifact, filename) {
  const blob = new Blob([`${JSON.stringify(artifact, null, 2)}\n`], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function exportControllerSettingsSnapshot() {
  if (!controllerSettingsReport) return;
  try {
    const snapshot = await createControllerSettingsSnapshot(controllerSettingsReport);
    downloadControllerSettingsArtifact(snapshot, `mr1-controller-settings-${snapshot.createdAt.replaceAll(/[:.]/g, "-")}.json`);
    controllerSettingsMessage = "SEALED 65-SETTING SNAPSHOT EXPORTED";
    controllerSettingsMessageState = "valid";
  } catch (error) {
    controllerSettingsMessage = error instanceof Error ? error.message : "SETTINGS SNAPSHOT EXPORT FAILED";
    controllerSettingsMessageState = "alarm";
  }
  renderControllerSettings();
}

async function exportControllerSettingsPlan() {
  if (!controllerSettingsReport) return;
  try {
    const plan = await createControllerSettingsPlan({
      report: controllerSettingsReport,
      staged: controllerSettingsStaged,
      confirmed: controllerSettingsElements.confirm.checked,
    });
    downloadControllerSettingsArtifact(plan, `mr1-controller-settings-plan-${plan.createdAt.replaceAll(/[:.]/g, "-")}.json`);
    controllerSettingsMessage = "SHA-256 SEALED SETTINGS PLAN EXPORTED";
    controllerSettingsMessageState = "valid";
  } catch (error) {
    controllerSettingsMessage = error instanceof Error ? error.message : "SETTINGS PLAN EXPORT FAILED";
    controllerSettingsMessageState = "alarm";
  }
  renderControllerSettings();
}

async function applyVirtualControllerSettings() {
  const plan = controllerSettingsPlanEvaluation();
  if (!plan?.readyToApply || controllerSettingsBusy) return;
  controllerSettingsBusy = true;
  controllerSettingsMessage = `APPLYING ${plan.changes.length} VIRTUAL SETTING${plan.changes.length === 1 ? "" : "S"}`;
  controllerSettingsMessageState = "";
  renderControllerSettings();
  try {
    const response = await fetch(CONTROLLER_SETTINGS_APPLY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocol: CONTROLLER_SETTINGS_PLAN_PROTOCOL,
        profile: plan.profile,
        baseTranscriptSha256: plan.baseTranscriptSha256,
        changes: plan.changes.map(({ id, to }) => ({ id, value: to })),
        confirmed: true,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? `Virtual settings request failed with HTTP ${response.status}.`);
    controllerSettingsReport = normalizeControllerSettingsReport(payload.report);
    controllerSettingsStaged = {};
    controllerSettingsElements.confirm.checked = false;
    controllerSettingsMessage = `${plan.changes.length} VIRTUAL SETTING${plan.changes.length === 1 ? "" : "S"} APPLIED / NEW BASELINE LOADED`;
    controllerSettingsMessageState = "valid";
  } catch (error) {
    controllerSettingsMessage = error instanceof Error ? error.message : "VIRTUAL SETTINGS APPLY FAILED";
    controllerSettingsMessageState = "alarm";
  } finally {
    controllerSettingsBusy = false;
    renderControllerSettings();
  }
}

function renderWiringInstallation() {
  wiringInstallationElements.steps.replaceChildren();
  for (const step of WIRING_INSTALL_STEPS) {
    const article = document.createElement("article");
    article.className = "wiring-install-step";
    article.dataset.status = step.state;
    const number = document.createElement("b");
    number.textContent = step.number;
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = step.title;
    const detail = document.createElement("p");
    detail.textContent = step.detail;
    copy.append(title, detail);
    const action = document.createElement("small");
    action.textContent = step.action;
    article.append(number, copy, action);
    wiringInstallationElements.steps.append(article);
  }

  wiringInstallationElements.evidenceList.replaceChildren();
  for (const gate of WIRING_EVIDENCE_GATES) {
    const label = document.createElement("label");
    label.className = "wiring-evidence-item";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = wiringEvidence.checked[gate.id] === true;
    input.dataset.wiringEvidence = gate.id;
    input.setAttribute("aria-label", gate.title);
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = gate.title;
    const detail = document.createElement("small");
    detail.textContent = gate.detail;
    const group = document.createElement("em");
    group.textContent = gate.group;
    copy.append(title, detail, group);
    label.append(input, copy);
    wiringInstallationElements.evidenceList.append(label);
  }

  wiringInstallationElements.pigtailList.replaceChildren();
  const stateLabels = Object.freeze({ exact: "USE / BUILD", meter: "FIT CHECK", hold: "HOLD" });
  for (const pigtail of WIRING_PIGTAIL_SCHEDULE) {
    const article = document.createElement("article");
    article.className = "wiring-pigtail-item";
    article.dataset.status = pigtail.state;

    const quantity = document.createElement("b");
    quantity.textContent = `${pigtail.quantity}x`;

    const copy = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = pigtail.item;
    const destination = document.createElement("code");
    destination.textContent = pigtail.boardEnd;
    const populate = document.createElement("span");
    populate.textContent = pigtail.populate;
    const detail = document.createElement("small");
    detail.textContent = pigtail.detail;
    copy.append(heading, destination, populate, detail);

    const state = document.createElement("em");
    state.textContent = stateLabels[pigtail.state];
    article.append(quantity, copy, state);
    wiringInstallationElements.pigtailList.append(article);
  }
  renderWiringEvidenceState();
  renderControllerPreflight();
  renderFirmwareVerification();
}

function setWiringProfileEditor(open, restoreFocus = true) {
  wiringProfileElements.form.hidden = !open;
  wiringProfileElements.edit.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    populateSensorWiringForm(sensorWiringProfile);
    renderSensorWiringProfile(sensorWiringProfile, { draft: true });
    wiringProfileElements.name.focus();
  } else if (restoreFocus) {
    wiringProfileElements.edit.focus();
  }
}

function setProbingTab(tab) {
  let found = false;
  document.querySelectorAll("[data-probing-tab]").forEach((button) => {
    const active = button.dataset.probingTab === tab;
    found ||= active;
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
  if (!found) return;
  document.querySelectorAll("[data-probing-panel]").forEach((panel) => {
    const active = panel.dataset.probingPanel === tab;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  elements.probingPanel.querySelector(".probing-panel-scroll").scrollTop = 0;
  if (tab === "setter") renderSetterProfile();
  if (tab === "touch") renderTouchProfile();
  if (tab === "input-cal") validateInputCalibrationForm();
}

function currentMachineConfiguration() {
  return {
    fixtureMap: fixtureMapProfile,
    probing: probingProfile,
    probeCalibration,
    sensorWiring: sensorWiringProfile,
    cutterCompensation: cutterCompProfile,
    sceneRegistration: sceneRegistrationProfile,
    metrology: metrologySession,
    fission: fissionImportProfile,
    wiringEvidence,
  };
}

function currentControllerBinding() {
  return runtime.bridge?.controllerPreflight ?? {};
}

function compactFingerprint(value) {
  const fingerprint = String(value ?? "").trim().toUpperCase();
  return /^[0-9A-F]{64}$/.test(fingerprint)
    ? `${fingerprint.slice(0, 10)}...${fingerprint.slice(-8)}`
    : "NOT BOUND";
}

function eventJournalExportUrl() {
  let endpoint = new URL(pairedServiceEndpoint("/journal/export"));
  try {
    const candidate = new URL(runtime.bridge?.journalExportUrl ?? endpoint);
    if (candidate.protocol === "http:" && candidate.origin === SERVICE_ORIGIN) {
      const pairingToken = endpoint.searchParams.get("pair");
      if (pairingToken && !candidate.searchParams.has("pair")) {
        candidate.searchParams.set("pair", pairingToken);
      }
      endpoint = candidate;
    }
  } catch {
    // Retain the same-host service fallback when bridge metadata is malformed.
  }
  return endpoint.href;
}

function setMachineBundleMessage(message, state = "") {
  machineBundleMessage = String(message ?? "").toUpperCase();
  machineBundleMessageState = state;
  renderMachineData();
}

function renderMachineBundleDiff() {
  machineDataElements.diff.replaceChildren();
  if (!pendingMachineBundleDiff) return;
  const visible = pendingMachineBundleDiff.changes.slice(0, 60);
  visible.forEach((change) => {
    const row = document.createElement("div");
    row.className = "machine-data-diff-row";
    row.setAttribute("role", "listitem");
    const path = document.createElement("strong");
    path.textContent = change.path.toUpperCase();
    path.title = change.path;
    const before = document.createElement("span");
    before.textContent = change.before;
    before.title = change.before;
    const arrow = document.createElement("i");
    arrow.textContent = ">";
    const after = document.createElement("span");
    after.textContent = change.after;
    after.title = change.after;
    row.append(path, before, arrow, after);
    machineDataElements.diff.append(row);
  });
  if (pendingMachineBundleDiff.total > visible.length) {
    const row = document.createElement("div");
    row.className = "machine-data-diff-row";
    row.setAttribute("role", "listitem");
    const path = document.createElement("strong");
    path.textContent = `+${pendingMachineBundleDiff.total - visible.length} MORE`;
    const detail = document.createElement("span");
    detail.textContent = "IN SEALED BUNDLE";
    row.append(path, detail);
    machineDataElements.diff.append(row);
  }
}

function renderMachineData() {
  const controller = currentControllerBinding();
  const currentFingerprint = controller.commissioningBaselineFingerprint ?? controller.configurationFingerprint ?? controller.transcriptSha256 ?? null;
  const expectedFingerprint = machineIdentity.controllerFingerprint;
  const simulated = controller.simulated === true;
  let controllerState = "UNBOUND";
  let controllerDataState = "";
  if (simulated) controllerState = "SIM / NOT BOUND";
  else if (currentFingerprint && expectedFingerprint && currentFingerprint === expectedFingerprint) {
    controllerState = "FINGERPRINT MATCH";
    controllerDataState = "active";
  } else if (currentFingerprint && expectedFingerprint) {
    controllerState = "FINGERPRINT MISMATCH";
    controllerDataState = "alarm";
  } else if (currentFingerprint) controllerState = "LIVE / UNBOUND";
  else if (expectedFingerprint) controllerState = "EXPECTED / OFFLINE";

  const transferLocked = runtime.live || runtime.commandPending;
  machineDataElements.state.value = machineIdentity.label.toUpperCase();
  machineDataElements.state.title = machineIdentity.machineId;
  machineDataElements.controller.value = controllerState;
  machineDataElements.controller.dataset.state = controllerDataState;
  machineDataElements.transfer.value = transferLocked ? "DISCONNECT LIVE" : "READY";
  machineDataElements.transfer.dataset.state = transferLocked ? "alarm" : "active";
  machineDataElements.name.value = machineIdentity.label;
  machineDataElements.id.value = machineIdentity.machineId;
  machineDataElements.id.title = machineIdentity.machineId;
  machineDataElements.fingerprint.value = compactFingerprint(expectedFingerprint);
  machineDataElements.fingerprint.title = expectedFingerprint ?? "No physical controller fingerprint is bound.";
  machineDataElements.profileCount.value = String(MACHINE_CONFIGURATION_SECTIONS.length);
  machineDataElements.pointCount.value = metrologySession.points.length.toLocaleString();
  machineDataElements.digest.value = lastMachineBundleDigest
    ? compactFingerprint(lastMachineBundleDigest)
    : "--";
  machineDataElements.digest.title = lastMachineBundleDigest ?? "No bundle exported in this session.";

  const journal = runtime.bridge?.journal ?? null;
  const journalEnabled = journal?.enabled === true;
  const journalState = journalEnabled
    ? `${journal.state ?? "ACTIVE"}${runtime.bridge?.mode === "simulate" ? " / SIM" : ""}`
    : journal?.state ?? "OFFLINE";
  machineDataElements.journalState.value = journalState;
  machineDataElements.journalState.dataset.state = journal?.state === "ERROR"
    ? "alarm"
    : journalEnabled ? "active" : "";
  machineDataElements.journalEntries.value = journalEnabled
    ? Number(journal.entries ?? 0).toLocaleString()
    : "--";
  const configurationJournal = runtime.bridge?.browserConfigurationJournal ?? null;
  const queuedConfigurationEvents = configurationJournalClient.queuedEvents().length;
  machineDataElements.configurationJournalEvents.value = configurationJournal
    ? Number(configurationJournal.sessionEvents ?? 0).toLocaleString()
    : "--";
  machineDataElements.configurationJournalLast.value = configurationJournal?.lastCategory
    ? `${configurationJournal.lastCategory} / ${configurationJournal.lastAction}`.toUpperCase()
    : "--";
  machineDataElements.configurationJournalLast.title = configurationJournal?.lastEventAt ?? "No sealed browser configuration event in this service session.";
  machineDataElements.configurationJournalQueue.value = String(queuedConfigurationEvents);
  machineDataElements.configurationJournalQueue.dataset.state = queuedConfigurationEvents > 0 ? "alarm" : journalEnabled ? "active" : "";
  machineDataElements.configurationJournalQueue.title = queuedConfigurationEvents > 0
    ? "Hash-only configuration evidence is waiting for the local service."
    : "No browser configuration evidence is waiting locally.";
  machineDataElements.journalDigest.value = compactFingerprint(journal?.lastDigest);
  machineDataElements.journalDigest.title = journal?.lastDigest ?? "No journal chain hash is available.";
  machineDataElements.downloadJournal.href = journalEnabled ? eventJournalExportUrl() : "";
  machineDataElements.downloadJournal.setAttribute("aria-disabled", journalEnabled ? "false" : "true");
  machineDataElements.downloadJournal.tabIndex = journalEnabled ? 0 : -1;
  machineDataElements.downloadJournal.dataset.tooltip = journalEnabled
    ? "Download retained append-only event evidence"
    : "Connect to a telemetry service with journaling enabled";

  const reconciliation = runtime.bridge?.restartReconciliation ?? null;
  const reconciliationState = reconciliation?.state ?? "OFFLINE";
  const reconciliationClear = reconciliation?.commandInterlock === "CLEAR";
  const reconciliationAcknowledged = reconciliation?.acknowledged === true;
  const reconciliationReviewable = reconciliation?.acknowledgeable === true;
  const previousSessionId = String(reconciliation?.previousSessionId ?? "");
  machineDataElements.reconciliationSession.value = previousSessionId
    ? `${previousSessionId.slice(0, 8)}...${previousSessionId.slice(-6)}`
    : reconciliationState === "NEW" ? "NONE" : "--";
  machineDataElements.reconciliationSession.title = previousSessionId || "No prior journal session.";
  machineDataElements.reconciliationState.value = reconciliationAcknowledged
    ? `${reconciliationState} / REVIEWED`
    : reconciliationState;
  machineDataElements.reconciliationState.dataset.state = reconciliationClear ? "active" : "alarm";
  machineDataElements.reconciliationHistory.value = reconciliation
    ? `${reconciliation.integrity ?? "--"} / ${reconciliation.history ?? "--"}`
    : "--";
  machineDataElements.reconciliationHistory.title = reconciliation
    ? `${Number(reconciliation.recordsVerified ?? 0).toLocaleString()} retained records / ${Number(reconciliation.sessionsVerified ?? 0).toLocaleString()} sessions`
    : "No restart evidence is available.";
  machineDataElements.reconciliationUnfinished.value = reconciliation
    ? String(Number(reconciliation.unfinishedCount ?? 0))
    : "--";
  machineDataElements.reconciliationUnfinished.dataset.state = Number(reconciliation?.unfinishedCount ?? 0) > 0 ? "alarm" : "active";
  machineDataElements.reconciliationInterlock.value = reconciliation?.commandInterlock ?? "HELD";
  machineDataElements.reconciliationInterlock.dataset.state = reconciliationClear ? "active" : "alarm";
  machineDataElements.reconciliationMessage.value = reconciliationRequestMessage
    || reconciliation?.message
    || "CONNECT LOCAL SERVICE";
  machineDataElements.reconciliationMessage.dataset.state = reconciliationRequestMessage
    ? reconciliationRequestMessageState
    : reconciliationClear ? "active" : "alarm";

  machineDataElements.reconciliationConfirm.disabled = !reconciliationReviewable || reconciliationRequestBusy;
  if (!reconciliationReviewable) machineDataElements.reconciliationConfirm.checked = false;
  machineDataElements.acknowledgeReconciliation.disabled = !reconciliationReviewable
    || !machineDataElements.reconciliationConfirm.checked
    || reconciliationRequestBusy;
  machineDataElements.acknowledgeReconciliation.dataset.state = reconciliationReviewable ? "alarm" : "";
  const reconciliationAction = machineDataElements.acknowledgeReconciliation.querySelector("span");
  if (reconciliationAction) {
    reconciliationAction.textContent = reconciliationRequestBusy
      ? "RECORDING REVIEW"
      : reconciliationAcknowledged
        ? "SIMULATION HOLD RELEASED"
        : reconciliationState === "CORRUPT"
          ? "ARCHIVE + INVESTIGATE"
          : reconciliationReviewable
            ? "RELEASE SIMULATION HOLD"
            : reconciliationState === "CLEAN" || reconciliationState === "NEW"
              ? "NO REVIEW REQUIRED"
              : reconciliationState === "DISABLED"
                ? "JOURNAL DISABLED"
                : "PHYSICAL RESTART LOCKED";
  }
  machineDataElements.acknowledgeReconciliation.dataset.tooltip = reconciliationReviewable
    ? "Record review of this exact restart-evidence digest and release virtual commands"
    : reconciliationState === "CORRUPT"
      ? "Corrupt evidence cannot be acknowledged away"
      : "No simulation restart hold is available to release";

  machineDataElements.validation.value = machineBundleMessage;
  machineDataElements.validation.dataset.state = machineBundleMessageState;
  machineDataElements.source.value = pendingMachineBundle
    ? `${pendingMachineBundle.machine.label} / ${pendingMachineBundle.machine.machineId.slice(-8)}`.toUpperCase()
    : "--";
  machineDataElements.source.title = pendingMachineBundle?.machine.machineId ?? "";
  machineDataElements.created.value = pendingMachineBundle
    ? pendingMachineBundle.createdAt.replace("T", " ").slice(0, 16)
    : "--";
  machineDataElements.changeCount.value = pendingMachineBundleDiff
    ? String(pendingMachineBundleDiff.total)
    : "--";
  machineDataElements.applyBundle.disabled = !pendingMachineBundle
    || !machineDataElements.confirm.checked
    || transferLocked;
  machineDataElements.applyBundle.dataset.tooltip = transferLocked
    ? "Disconnect telemetry before importing machine configuration"
    : !pendingMachineBundle ? "Choose and verify a machine bundle"
      : !machineDataElements.confirm.checked ? "Verify machine identity and configuration diff"
        : "Import the sealed bundle and reload the control screen";
  renderMachineBundleDiff();
}

function setControllerSettingsPanel(open, restoreFocus = true) {
  if (open && elements.machineDataPanel.getAttribute("aria-hidden") === "false") {
    setMachineDataPanel(false, false);
  }
  if (open && elements.sceneRegistrationPanel.getAttribute("aria-hidden") === "false") {
    setSceneRegistrationPanel(false, false);
  }
  if (open && elements.metrologyPanel.getAttribute("aria-hidden") === "false") {
    setMetrologyPanel(false, false);
  }
  if (open && elements.cutterCompPanel.getAttribute("aria-hidden") === "false") {
    setCutterCompPanel(false, false);
  }
  if (open && elements.fixtureMapPanel.getAttribute("aria-hidden") === "false") {
    setFixtureMapPanel(false, false);
  }
  if (open && elements.probingPanel.getAttribute("aria-hidden") === "false") {
    setProbingPanel(false, false);
  }
  if (open && elements.spindlePanel.getAttribute("aria-hidden") === "false") {
    setSpindlePanel(false, false);
  }
  if (open && elements.wiringPanel.getAttribute("aria-hidden") === "false") {
    setWiringPanel(false, false);
  }
  if (open && elements.jogPanel.getAttribute("aria-hidden") === "false") {
    setJogPanel(false, false);
  }
  if (open && !fissionElements.panel.hidden) setFissionSettingsPanel(false);
  elements.controllerSettingsPanel.classList.toggle("open", open);
  elements.controllerSettingsScrim.classList.toggle("open", open);
  elements.controllerSettingsPanel.inert = !open;
  elements.controllerSettingsPanel.setAttribute("aria-hidden", open ? "false" : "true");
  elements.openControllerSettings.setAttribute("aria-pressed", open ? "true" : "false");
  elements.controllerSettingsScrim.tabIndex = open ? 0 : -1;
  if (open) {
    renderControllerSettings();
    elements.controllerSettingsPanel.querySelector(".controller-system-scroll").scrollTop = 0;
    elements.closeControllerSettings.focus();
    void fetchControllerSettingsReport();
  } else if (restoreFocus) {
    elements.openControllerSettings.focus();
  }
}

function setMachineDataPanel(open, restoreFocus = true) {
  if (open && elements.controllerSettingsPanel.getAttribute("aria-hidden") === "false") {
    setControllerSettingsPanel(false, false);
  }
  if (open && elements.sceneRegistrationPanel.getAttribute("aria-hidden") === "false") {
    setSceneRegistrationPanel(false, false);
  }
  if (open && elements.metrologyPanel.getAttribute("aria-hidden") === "false") {
    setMetrologyPanel(false, false);
  }
  if (open && elements.cutterCompPanel.getAttribute("aria-hidden") === "false") {
    setCutterCompPanel(false, false);
  }
  if (open && elements.fixtureMapPanel.getAttribute("aria-hidden") === "false") {
    setFixtureMapPanel(false, false);
  }
  if (open && elements.probingPanel.getAttribute("aria-hidden") === "false") {
    setProbingPanel(false, false);
  }
  if (open && elements.spindlePanel.getAttribute("aria-hidden") === "false") {
    setSpindlePanel(false, false);
  }
  if (open && elements.wiringPanel.getAttribute("aria-hidden") === "false") {
    setWiringPanel(false, false);
  }
  if (open && elements.jogPanel.getAttribute("aria-hidden") === "false") {
    setJogPanel(false, false);
  }
  if (open && !fissionElements.panel.hidden) setFissionSettingsPanel(false);
  elements.machineDataPanel.classList.toggle("open", open);
  elements.machineDataScrim.classList.toggle("open", open);
  elements.machineDataPanel.inert = !open;
  elements.machineDataPanel.setAttribute("aria-hidden", open ? "false" : "true");
  elements.openMachineData.setAttribute("aria-pressed", open ? "true" : "false");
  elements.machineDataScrim.tabIndex = open ? 0 : -1;
  if (open) {
    renderMachineData();
    elements.machineDataPanel.querySelector(".machine-data-scroll").scrollTop = 0;
    elements.closeMachineData.focus();
  } else if (restoreFocus) elements.openMachineData.focus();
}

function downloadMachineBundle(bundle) {
  const safeLabel = bundle.machine.label.replace(/[^A-Z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "MR1";
  const date = bundle.createdAt.slice(0, 10);
  const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeLabel}-${date}.mr1-machine.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function exportMachineData() {
  try {
    machineIdentity = saveMachineIdentity({
      ...machineIdentity,
      label: machineDataElements.name.value,
    }, configurationStorage);
    const bundle = await createMachineBundle({
      identity: machineIdentity,
      controller: currentControllerBinding(),
      configuration: currentMachineConfiguration(),
    });
    lastMachineBundleDigest = bundle.integrity.digest;
    downloadMachineBundle(bundle);
    setMachineBundleMessage("SEALED BUNDLE EXPORTED", "active");
  } catch (error) {
    setMachineBundleMessage(error instanceof Error ? error.message : "BUNDLE EXPORT FAILED", "alarm");
  }
}

function eventJournalFilename(contentDisposition) {
  const fallback = `mr1-events-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
  const match = String(contentDisposition ?? "").match(/filename\s*=\s*"?([^";\r\n]+)"?/i);
  const candidate = String(match?.[1] ?? fallback)
    .replace(/[^A-Z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return candidate.toLowerCase().endsWith(".jsonl") ? candidate : fallback;
}

async function downloadEventJournal(event) {
  event?.preventDefault();
  if (machineDataElements.downloadJournal.getAttribute("aria-disabled") === "true" || journalDownloadBusy) return;

  journalDownloadBusy = true;
  setMachineBundleMessage("EVENT JOURNAL DOWNLOAD STARTED", "active");
  try {
    const endpoint = new URL(eventJournalExportUrl());
    if (endpoint.protocol !== "http:" || endpoint.origin !== SERVICE_ORIGIN) {
      throw new Error("EVENT JOURNAL ENDPOINT FAILED SAME-SERVICE VALIDATION");
    }
    const response = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) throw new Error(`EVENT JOURNAL EXPORT FAILED / HTTP ${response.status}`);

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/x-ndjson")) {
      throw new Error("EVENT JOURNAL EXPORT RETURNED AN UNEXPECTED FILE TYPE");
    }
    const declaredBytes = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_EVENT_JOURNAL_BYTES) {
      throw new Error("EVENT JOURNAL EXPORT EXCEEDS THE 24 MB DOWNLOAD LIMIT");
    }

    const blob = await response.blob();
    if (blob.size > MAX_EVENT_JOURNAL_BYTES) {
      throw new Error("EVENT JOURNAL EXPORT EXCEEDS THE 24 MB DOWNLOAD LIMIT");
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = eventJournalFilename(response.headers.get("content-disposition"));
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMachineBundleMessage("EVENT JOURNAL DOWNLOADED", "active");
  } catch (error) {
    setMachineBundleMessage(error instanceof Error ? error.message : "EVENT JOURNAL DOWNLOAD FAILED", "alarm");
  } finally {
    journalDownloadBusy = false;
  }
}

async function acknowledgeRestartReconciliation() {
  const reconciliation = runtime.bridge?.restartReconciliation;
  if (
    reconciliationRequestBusy
    || reconciliation?.acknowledgeable !== true
    || !machineDataElements.reconciliationConfirm.checked
  ) return;

  reconciliationRequestBusy = true;
  reconciliationRequestMessage = "RECORDING EXACT RESTART REVIEW";
  reconciliationRequestMessageState = "";
  renderMachineData();
  try {
    const response = await fetch(JOURNAL_RECONCILIATION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocol: JOURNAL_RECONCILIATION_ACK_PROTOCOL,
        reconciliationId: reconciliation.reconciliationId,
        confirmed: true,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? `Restart review failed with HTTP ${response.status}.`);
    runtime.bridge = {
      ...(runtime.bridge ?? {}),
      restartReconciliation: payload.restartReconciliation,
      machineCommands: payload.machineCommands,
    };
    machineDataElements.reconciliationConfirm.checked = false;
    reconciliationRequestMessage = "RESTART REVIEW SEALED / SIMULATION HOLD RELEASED";
    reconciliationRequestMessageState = "active";
  } catch (error) {
    reconciliationRequestMessage = error instanceof Error ? error.message : "RESTART REVIEW FAILED";
    reconciliationRequestMessageState = "alarm";
  } finally {
    reconciliationRequestBusy = false;
    renderMachineData();
    renderJogPanel();
    renderTouchProfile();
    renderSetterProfile();
  }
}

async function loadMachineBundleFile(file) {
  pendingMachineBundle = null;
  pendingMachineBundleDiff = null;
  machineDataElements.confirm.checked = false;
  if (!file) {
    setMachineBundleMessage("NO BUNDLE SELECTED");
    return;
  }
  setMachineBundleMessage("VERIFYING SHA-256");
  try {
    pendingMachineBundle = await parseMachineBundle(await file.text());
    pendingMachineBundleDiff = diffMachineConfigurations(
      currentMachineConfiguration(),
      pendingMachineBundle.configuration,
      { limit: 250 },
    );
    const identityChanged = pendingMachineBundle.machine.machineId !== machineIdentity.machineId;
    setMachineBundleMessage(
      `VERIFIED / ${pendingMachineBundleDiff.total} CHANGES${identityChanged ? " / MACHINE ID DIFFERS" : ""}`,
      identityChanged ? "alarm" : "active",
    );
  } catch (error) {
    pendingMachineBundle = null;
    pendingMachineBundleDiff = null;
    setMachineBundleMessage(error instanceof Error ? error.message : "BUNDLE IMPORT FAILED", "alarm");
  } finally {
    machineDataElements.file.value = "";
  }
}

function importMachineData() {
  if (!pendingMachineBundle || !machineDataElements.confirm.checked) return;
  if (runtime.live || runtime.commandPending) {
    setMachineBundleMessage("DISCONNECT TELEMETRY BEFORE IMPORT", "alarm");
    return;
  }
  try {
    applyMachineBundle(pendingMachineBundle, {
      adoptMachineIdentity: machineDataElements.adoptIdentity.checked,
      storage: configurationStorage,
    });
    machineBundleMessage = "IMPORT COMPLETE / RELOADING";
    machineBundleMessageState = "active";
    renderMachineData();
    requestAnimationFrame(() => window.location.reload());
  } catch (error) {
    setMachineBundleMessage(error instanceof Error ? error.message : "BUNDLE IMPORT FAILED", "alarm");
  }
}

function setJogPanel(open, restoreFocus = true) {
  if (open && elements.controllerSettingsPanel.getAttribute("aria-hidden") === "false") {
    setControllerSettingsPanel(false, false);
  }
  if (open && elements.machineDataPanel.getAttribute("aria-hidden") === "false") {
    setMachineDataPanel(false, false);
  }
  if (open && elements.sceneRegistrationPanel.getAttribute("aria-hidden") === "false") {
    setSceneRegistrationPanel(false, false);
  }
  if (open && elements.metrologyPanel.getAttribute("aria-hidden") === "false") {
    setMetrologyPanel(false, false);
  }
  if (open && elements.cutterCompPanel.getAttribute("aria-hidden") === "false") {
    setCutterCompPanel(false, false);
  }
  if (open && elements.fixtureMapPanel.getAttribute("aria-hidden") === "false") {
    setFixtureMapPanel(false, false);
  }
  if (open && elements.probingPanel.getAttribute("aria-hidden") === "false") {
    setProbingPanel(false, false);
  }
  if (open && elements.spindlePanel.getAttribute("aria-hidden") === "false") {
    setSpindlePanel(false, false);
  }
  if (open && elements.wiringPanel.getAttribute("aria-hidden") === "false") {
    setWiringPanel(false, false);
  }
  elements.jogPanel.classList.toggle("open", open);
  elements.jogScrim.classList.toggle("open", open);
  elements.jogPanel.inert = !open;
  elements.jogPanel.setAttribute("aria-hidden", open ? "false" : "true");
  elements.openJog.setAttribute("aria-pressed", open ? "true" : "false");
  elements.jogScrim.tabIndex = open ? 0 : -1;
  if (open) {
    if (!runtime.live && runtime.playing) holdPreview({ refreshScene: false });
    renderJogPanel();
    elements.jogPanel.querySelector(".jog-panel-scroll").scrollTop = 0;
    elements.closeJog.focus();
  } else {
    stopContinuousPreviewJog();
    if (restoreFocus) elements.openJog.focus();
  }
}

function setFixtureMapPanel(open, restoreFocus = true) {
  if (open && elements.controllerSettingsPanel.getAttribute("aria-hidden") === "false") {
    setControllerSettingsPanel(false, false);
  }
  if (open && elements.machineDataPanel.getAttribute("aria-hidden") === "false") {
    setMachineDataPanel(false, false);
  }
  if (open && elements.sceneRegistrationPanel.getAttribute("aria-hidden") === "false") {
    setSceneRegistrationPanel(false, false);
  }
  if (open && elements.metrologyPanel.getAttribute("aria-hidden") === "false") {
    setMetrologyPanel(false, false);
  }
  if (open && elements.cutterCompPanel.getAttribute("aria-hidden") === "false") {
    setCutterCompPanel(false, false);
  }
  if (open && elements.probingPanel.getAttribute("aria-hidden") === "false") {
    setProbingPanel(false, false);
  }
  if (open && elements.spindlePanel.getAttribute("aria-hidden") === "false") {
    setSpindlePanel(false, false);
  }
  if (open && elements.wiringPanel.getAttribute("aria-hidden") === "false") {
    setWiringPanel(false, false);
  }
  if (open && elements.jogPanel.getAttribute("aria-hidden") === "false") {
    setJogPanel(false, false);
  }
  elements.fixtureMapPanel.classList.toggle("open", open);
  elements.fixtureMapScrim.classList.toggle("open", open);
  elements.app.classList.toggle("fixture-editing", open);
  elements.fixtureMapPanel.inert = !open;
  elements.fixtureMapPanel.setAttribute("aria-hidden", open ? "false" : "true");
  elements.openFixtureMap.setAttribute("aria-pressed", open ? "true" : "false");
  elements.fixtureMapScrim.tabIndex = open ? 0 : -1;
  if (open) {
    if (!runtime.live && runtime.playing) holdPreview();
    setViewMode("machine");
    renderFixtureMap();
    elements.fixtureMapPanel.querySelector(".fixture-map-scroll").scrollTop = 0;
    elements.closeFixtureMap.focus();
    requestAnimationFrame(() => {
      drawFixtureMap();
      viewer?.setCamera("fixture");
    });
  } else {
    viewer?.setCamera("home");
    if (restoreFocus) elements.openFixtureMap.focus();
  }
}

function setProbingPanel(open, restoreFocus = true) {
  if (open && elements.controllerSettingsPanel.getAttribute("aria-hidden") === "false") {
    setControllerSettingsPanel(false, false);
  }
  if (open && elements.machineDataPanel.getAttribute("aria-hidden") === "false") {
    setMachineDataPanel(false, false);
  }
  if (open && elements.sceneRegistrationPanel.getAttribute("aria-hidden") === "false") {
    setSceneRegistrationPanel(false, false);
  }
  if (open && elements.metrologyPanel.getAttribute("aria-hidden") === "false") {
    setMetrologyPanel(false, false);
  }
  if (open && elements.cutterCompPanel.getAttribute("aria-hidden") === "false") {
    setCutterCompPanel(false, false);
  }
  if (open && elements.fixtureMapPanel.getAttribute("aria-hidden") === "false") {
    setFixtureMapPanel(false, false);
  }
  if (open && elements.wiringPanel.getAttribute("aria-hidden") === "false") {
    setWiringPanel(false, false);
  }
  if (open && elements.spindlePanel.getAttribute("aria-hidden") === "false") {
    setSpindlePanel(false, false);
  }
  if (open && elements.jogPanel.getAttribute("aria-hidden") === "false") {
    setJogPanel(false, false);
  }
  elements.probingPanel.classList.toggle("open", open);
  elements.probingScrim.classList.toggle("open", open);
  elements.probingPanel.inert = !open;
  elements.probingPanel.setAttribute("aria-hidden", open ? "false" : "true");
  elements.openProbing.setAttribute("aria-pressed", open ? "true" : "false");
  elements.probingScrim.tabIndex = open ? 0 : -1;
  if (open) {
    updateProbingSignals(runtime.telemetry);
    renderSetterProfile();
    renderTouchProfile();
    elements.closeProbing.focus();
  }
  else if (restoreFocus) elements.openProbing.focus();
}

function setSpindlePanel(open, restoreFocus = true, trigger = runtime.spindlePanelTrigger) {
  if (open && elements.controllerSettingsPanel.getAttribute("aria-hidden") === "false") {
    setControllerSettingsPanel(false, false);
  }
  if (open && elements.machineDataPanel.getAttribute("aria-hidden") === "false") {
    setMachineDataPanel(false, false);
  }
  if (open) runtime.spindlePanelTrigger = trigger;
  const sensorView = runtime.spindlePanelTrigger === "sensor";
  const panelLabel = sensorView ? "ESP32 sensor diagnostics" : "Spindle diagnostics";
  elements.spindlePanelTitle.textContent = sensorView ? "ESP32 SENSOR" : "SPINDLE";
  elements.spindlePanel.setAttribute("aria-label", panelLabel);
  elements.closeSpindle.setAttribute("aria-label", `Close ${panelLabel.toLowerCase()}`);
  elements.spindleScrim.setAttribute("aria-label", `Close ${panelLabel.toLowerCase()}`);
  if (open && elements.sceneRegistrationPanel.getAttribute("aria-hidden") === "false") {
    setSceneRegistrationPanel(false, false);
  }
  if (open && elements.metrologyPanel.getAttribute("aria-hidden") === "false") {
    setMetrologyPanel(false, false);
  }
  if (open && elements.cutterCompPanel.getAttribute("aria-hidden") === "false") {
    setCutterCompPanel(false, false);
  }
  if (open && elements.fixtureMapPanel.getAttribute("aria-hidden") === "false") {
    setFixtureMapPanel(false, false);
  }
  if (open && elements.probingPanel.getAttribute("aria-hidden") === "false") {
    setProbingPanel(false);
  }
  if (open && elements.wiringPanel.getAttribute("aria-hidden") === "false") {
    setWiringPanel(false, false);
  }
  if (open && elements.jogPanel.getAttribute("aria-hidden") === "false") {
    setJogPanel(false, false);
  }
  elements.spindlePanel.classList.toggle("open", open);
  elements.spindleScrim.classList.toggle("open", open);
  elements.spindlePanel.inert = !open;
  elements.spindlePanel.setAttribute("aria-hidden", open ? "false" : "true");
  elements.openSpindle.setAttribute(
    "aria-pressed",
    open && !sensorView ? "true" : "false",
  );
  elements.openSensor.setAttribute(
    "aria-pressed",
    open && sensorView ? "true" : "false",
  );
  elements.spindleScrim.tabIndex = open ? 0 : -1;
  if (open) {
    renderSpindleDiagnostics();
    elements.closeSpindle.focus();
  } else if (restoreFocus) {
    (runtime.spindlePanelTrigger === "sensor" ? elements.openSensor : elements.openSpindle).focus();
  }
}

function setBoardMapExpanded(expanded) {
  elements.wiringPanel.classList.toggle("board-map-expanded", expanded);
  wiringInstallationElements.expandBoardMap.setAttribute("aria-pressed", expanded ? "true" : "false");
  wiringInstallationElements.expandBoardMap.setAttribute("aria-label", expanded ? "Return board map to normal size" : "Expand board map");
  wiringInstallationElements.expandBoardMap.querySelector("span").textContent = expanded ? "NORMAL SIZE" : "FULL MAP";
}

function setWiringTab(tab) {
  let found = false;
  document.querySelectorAll("[data-wiring-tab]").forEach((button) => {
    const active = button.dataset.wiringTab === tab;
    found ||= active;
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
  if (!found) return;
  document.querySelectorAll("[data-wiring-panel]").forEach((panel) => {
    const active = panel.dataset.wiringPanel === tab;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  if (tab !== "start") setBoardMapExpanded(false);
  elements.wiringPanel.querySelector(".probing-panel-scroll").scrollTop = 0;
}

function setWiringPanel(open, restoreFocus = true) {
  if (open && elements.controllerSettingsPanel.getAttribute("aria-hidden") === "false") {
    setControllerSettingsPanel(false, false);
  }
  if (open && elements.machineDataPanel.getAttribute("aria-hidden") === "false") {
    setMachineDataPanel(false, false);
  }
  if (open && elements.sceneRegistrationPanel.getAttribute("aria-hidden") === "false") {
    setSceneRegistrationPanel(false, false);
  }
  if (open && elements.metrologyPanel.getAttribute("aria-hidden") === "false") {
    setMetrologyPanel(false, false);
  }
  if (open && elements.cutterCompPanel.getAttribute("aria-hidden") === "false") {
    setCutterCompPanel(false, false);
  }
  if (open && elements.fixtureMapPanel.getAttribute("aria-hidden") === "false") {
    setFixtureMapPanel(false, false);
  }
  if (open && elements.probingPanel.getAttribute("aria-hidden") === "false") {
    setProbingPanel(false);
  }
  if (open && elements.spindlePanel.getAttribute("aria-hidden") === "false") {
    setSpindlePanel(false, false);
  }
  if (open && elements.jogPanel.getAttribute("aria-hidden") === "false") {
    setJogPanel(false, false);
  }
  elements.wiringPanel.classList.toggle("open", open);
  elements.wiringScrim.classList.toggle("open", open);
  elements.wiringPanel.inert = !open;
  elements.wiringPanel.setAttribute("aria-hidden", open ? "false" : "true");
  elements.openWiring.setAttribute("aria-pressed", open ? "true" : "false");
  elements.wiringScrim.tabIndex = open ? 0 : -1;
  if (open) {
    renderWiringInstallation();
    renderSensorWiringProfile(sensorWiringProfile);
    elements.closeWiring.focus();
  } else {
    setBoardMapExpanded(false);
    if (!wiringProfileElements.form.hidden) {
      populateSensorWiringForm(sensorWiringProfile);
      renderSensorWiringProfile(sensorWiringProfile);
      setWiringProfileEditor(false, false);
    }
    if (restoreFocus) elements.openWiring.focus();
  }
}

function latencySnapshot(mark = runtime.healthHistoryMark) {
  return latencyMonitor.snapshot({
    diagnostics: telemetryClient.diagnostics,
    companion: COMPANION_MODE,
    telemetryActive: telemetryClient.active,
    telemetryConnected: telemetryClient.connected,
    telemetryLinked: runtime.telemetryLinked,
    bridgeMode: runtime.bridge?.mode ?? runtime.telemetry?.bridgeMode ?? null,
    controllerPollMs: runtime.bridge?.pollMs ?? null,
    renderQuality: viewer?.renderProfile?.quality ?? null,
    rendererName: viewer?.renderProfile?.rendererName ?? null,
  }, mark);
}

function formatLatency(value) {
  if (!Number.isFinite(value)) return "--";
  if (value >= 100) return Math.round(value).toString();
  return Number(value).toFixed(1);
}

function setLatencyMetricRow(outputs, metric) {
  const values = [metric?.current, metric?.p50, metric?.p95, metric?.p99];
  outputs.forEach((output, index) => {
    output.value = formatLatency(values[index]);
  });
}

function setHealthCounter(element, value) {
  const count = Math.max(0, Number(value) || 0);
  setIndicator(element, String(count), count > 0 ? "alarm" : "active");
}

function drawHealthChart() {
  if (elements.healthPanel.getAttribute("aria-hidden") !== "false") return;
  const canvas = healthElements.chart;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 20 || rect.height < 20) return;
  const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(rect.width * pixelRatio));
  const height = Math.max(1, Math.round(rect.height * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const chartWidth = rect.width;
  const chartHeight = rect.height;
  const padding = { top: 12, right: 10, bottom: 12, left: 10 };
  const visible = latencyMonitor.history("sourceToVisibleMs", 120).map(({ value }) => value);
  const service = latencyMonitor.history("serviceRttMs", 120).map(({ value }) => value);
  const maximumSample = Math.max(0, ...visible, ...service);
  const scaleMaximum = Math.max(100, Math.ceil(maximumSample / 50) * 50);
  healthElements.chartScale.value = `0-${scaleMaximum} MS`;

  context.fillStyle = "#121416";
  context.fillRect(0, 0, chartWidth, chartHeight);
  context.strokeStyle = "rgba(220, 225, 229, 0.12)";
  context.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + ((chartHeight - padding.top - padding.bottom) * index) / 4;
    context.beginPath();
    context.moveTo(padding.left, Math.round(y) + 0.5);
    context.lineTo(chartWidth - padding.right, Math.round(y) + 0.5);
    context.stroke();
  }

  const drawSeries = (values, color, lineWidth) => {
    if (values.length < 2) return;
    const plotWidth = chartWidth - padding.left - padding.right;
    const plotHeight = chartHeight - padding.top - padding.bottom;
    context.beginPath();
    values.forEach((value, index) => {
      const x = padding.left + (plotWidth * index) / Math.max(1, values.length - 1);
      const y = chartHeight - padding.bottom - (Math.min(scaleMaximum, value) / scaleMaximum) * plotHeight;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.stroke();
  };
  drawSeries(visible, "#ffffff", 1.5);
  drawSeries(service, "#d71920", 1.25);
}

function renderHealthPanel() {
  if (elements.healthPanel.getAttribute("aria-hidden") !== "false") return;
  const snapshot = latencySnapshot();
  const evaluation = evaluateLatencySnapshot(snapshot);
  const state = evaluation.result.toLowerCase();
  setIndicator(healthElements.state, evaluation.result, state);
  healthElements.stateLight.dataset.state = state;

  const bridgeMode = String(snapshot.context.bridgeMode ?? "OFFLINE").toUpperCase();
  setIndicator(
    healthElements.bridge,
    snapshot.context.telemetryLinked ? (snapshot.context.companion ? `${bridgeMode} / LAN` : bridgeMode) : "OFFLINE",
    snapshot.context.telemetryLinked ? "active" : "alarm",
  );
  setIndicator(
    healthElements.clock,
    snapshot.clock.synchronized ? "SYNCED" : "UNSYNC",
    snapshot.clock.synchronized ? "active" : "alarm",
  );
  setIndicator(
    healthElements.stream,
    snapshot.context.telemetryLinked ? "SSE LIVE" : snapshot.context.telemetryActive ? "CONNECTING" : "WAITING",
    snapshot.context.telemetryLinked ? "active" : "alarm",
  );
  setIndicator(healthElements.samples, String(snapshot.metrics.sourceToVisibleMs.count), "active");

  setLatencyMetricRow(healthElements.rtt, snapshot.metrics.serviceRttMs);
  setLatencyMetricRow(healthElements.visible, snapshot.metrics.sourceToVisibleMs);
  setLatencyMetricRow(healthElements.bridgeTiming, snapshot.metrics.bridgeAgeMs);
  setLatencyMetricRow(healthElements.render, snapshot.metrics.renderDelayMs);
  setHealthCounter(healthElements.gaps, snapshot.diagnostics.sequenceGapCount);
  setHealthCounter(healthElements.duplicates, snapshot.diagnostics.duplicateCount);
  setHealthCounter(healthElements.resets, snapshot.diagnostics.sequenceResetCount);
  setHealthCounter(healthElements.reconnects, snapshot.diagnostics.reconnectCount);
  setIndicator(
    healthElements.poll,
    Number.isFinite(snapshot.context.controllerPollMs) ? `${snapshot.context.controllerPollMs} MS` : "--",
    Number.isFinite(snapshot.context.controllerPollMs) ? "active" : "",
  );
  setIndicator(
    healthElements.renderProfile,
    snapshot.context.renderQuality ? snapshot.context.renderQuality.toUpperCase() : "INITIALIZING",
    snapshot.context.renderQuality ? "active" : "",
  );
  setIndicator(
    healthElements.clockOffset,
    Number.isFinite(snapshot.clock.offsetMs) ? `${snapshot.clock.offsetMs >= 0 ? "+" : ""}${snapshot.clock.offsetMs.toFixed(2)} MS` : "--",
    snapshot.clock.synchronized ? "active" : "alarm",
  );

  if (runtime.healthCheck) {
    const elapsed = performance.now() - runtime.healthCheck.startedPerformanceMs;
    const fraction = Math.max(0, Math.min(1, elapsed / runtime.healthCheck.durationMs));
    healthElements.checkProgress.value = fraction;
    setIndicator(healthElements.checkState, `OBSERVING ${Math.ceil((1 - fraction) * 10)} S`, "active");
    healthElements.checkDetail.value = "READ-ONLY STREAM + RENDER + SERVICE TIMING";
    healthElements.checkDetail.dataset.state = "";
  } else if (runtime.healthLastEvidence) {
    const result = runtime.healthLastEvidence.evaluation.result;
    const resultState = result.toLowerCase();
    healthElements.checkProgress.value = 1;
    setIndicator(healthElements.checkState, result, resultState);
    healthElements.checkDetail.value = runtime.healthLastEvidence.evaluation.reasons.length > 0
      ? runtime.healthLastEvidence.evaluation.reasons.join(" / ")
      : "UI TRANSPORT GATES PASSED / PHYSICAL TIMING UNPROVEN";
    healthElements.checkDetail.dataset.state = resultState;
  } else {
    healthElements.checkProgress.value = 0;
    setIndicator(healthElements.checkState, "NOT RUN");
    healthElements.checkDetail.value = runtime.healthLastPingError
      ? `SERVICE TIMING UNAVAILABLE / ${runtime.healthLastPingError}`
      : "READ-ONLY OBSERVATION / NO MACHINE COMMANDS";
    healthElements.checkDetail.dataset.state = runtime.healthLastPingError ? "attention" : "";
  }
  healthElements.runCheck.disabled = Boolean(runtime.healthCheck);
  healthElements.exportEvidence.disabled = !runtime.healthLastEvidence;
  drawHealthChart();
}

function requestHealthRender() {
  if (elements.healthPanel.getAttribute("aria-hidden") !== "false" || runtime.healthRenderTimer !== null) return;
  runtime.healthRenderTimer = setTimeout(() => {
    runtime.healthRenderTimer = null;
    renderHealthPanel();
  }, 200);
}

async function captureServiceLatency() {
  if (runtime.healthPingBusy) return null;
  runtime.healthPingBusy = true;
  try {
    const sample = await requestLatencySample(LATENCY_ENDPOINT, { timeoutMs: 1500 });
    const best = latencyMonitor.recordPing(sample);
    telemetryClient.setServerClockOffset(best.clockOffsetMs, best);
    runtime.healthLastPingError = null;
    requestHealthRender();
    return sample;
  } catch (error) {
    runtime.healthLastPingError = error instanceof Error ? error.message : String(error);
    requestHealthRender();
    return null;
  } finally {
    runtime.healthPingBusy = false;
  }
}

function stopHealthPingLoop() {
  clearTimeout(runtime.healthPingTimer);
  runtime.healthPingTimer = null;
}

function scheduleHealthPing(delayMs = 0) {
  stopHealthPingLoop();
  if (elements.healthPanel.getAttribute("aria-hidden") !== "false" || document.hidden) return;
  runtime.healthPingTimer = setTimeout(async () => {
    runtime.healthPingTimer = null;
    await captureServiceLatency();
    scheduleHealthPing(runtime.healthCheck ? 1000 : 2000);
  }, delayMs);
}

function stopClockMaintenance() {
  clearTimeout(runtime.clockMaintenanceTimer);
  runtime.clockMaintenanceTimer = null;
}

function scheduleClockMaintenance() {
  stopClockMaintenance();
  if (!telemetryClient.active || document.hidden) return;
  runtime.clockMaintenanceTimer = setTimeout(async () => {
    runtime.clockMaintenanceTimer = null;
    await captureServiceLatency();
    scheduleClockMaintenance();
  }, 60_000);
}

function finishPassiveHealthCheck() {
  const check = runtime.healthCheck;
  if (!check) return;
  clearInterval(check.progressTimer);
  clearTimeout(check.finishTimer);
  const snapshot = latencySnapshot(check.mark);
  const evaluation = evaluateLatencySnapshot(snapshot);
  runtime.healthLastEvidence = createLatencyEvidence(snapshot, evaluation);
  runtime.healthCheck = null;
  scheduleHealthPing(1000);
  renderHealthPanel();
}

function cancelPassiveHealthCheck() {
  const check = runtime.healthCheck;
  if (!check) return;
  clearInterval(check.progressTimer);
  clearTimeout(check.finishTimer);
  runtime.healthCheck = null;
}

async function runPassiveHealthCheck() {
  if (runtime.healthCheck) return;
  if (!telemetryClient.active) telemetryClient.connect();
  await captureServiceLatency();
  const durationMs = 10_000;
  const check = {
    mark: latencyMonitor.mark(telemetryClient.diagnostics),
    startedPerformanceMs: performance.now(),
    durationMs,
    progressTimer: null,
    finishTimer: null,
  };
  runtime.healthCheck = check;
  check.progressTimer = setInterval(renderHealthPanel, 250);
  check.finishTimer = setTimeout(finishPassiveHealthCheck, durationMs);
  scheduleHealthPing(0);
  renderHealthPanel();
}

function exportHealthEvidence() {
  if (!runtime.healthLastEvidence) return;
  const blob = new Blob([`${JSON.stringify(runtime.healthLastEvidence, null, 2)}\n`], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `mr1-latency-${runtime.healthLastEvidence.createdAt.replaceAll(/[:.]/g, "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function resetHealthHistory() {
  if (runtime.healthCheck) return;
  latencyMonitor.reset({ preserveClock: true });
  runtime.healthHistoryMark = latencyMonitor.mark(telemetryClient.diagnostics);
  runtime.healthLastEvidence = null;
  runtime.healthLastPingError = null;
  renderHealthPanel();
}

function setHealthPanel(open, restoreFocus = true) {
  if (open) {
    setCommissioningPanel(false, false);
    setFissionSettingsPanel(false);
    setControllerSettingsPanel(false, false);
    setMachineDataPanel(false, false);
    setJogPanel(false, false);
    setSceneRegistrationPanel(false, false);
    setFixtureMapPanel(false, false);
    setCutterCompPanel(false, false);
    setMetrologyPanel(false, false);
    setWiringPanel(false, false);
    setSpindlePanel(false, false);
    setProbingPanel(false, false);
  }
  elements.healthPanel.classList.toggle("open", open);
  elements.healthScrim.classList.toggle("open", open);
  elements.healthPanel.inert = !open;
  elements.healthPanel.setAttribute("aria-hidden", open ? "false" : "true");
  elements.openHealth.setAttribute("aria-pressed", open ? "true" : "false");
  elements.healthScrim.tabIndex = open ? 0 : -1;
  if (open) {
    renderHealthPanel();
    scheduleHealthPing(0);
    elements.closeHealth.focus();
  } else {
    stopHealthPingLoop();
    cancelPassiveHealthCheck();
    clearTimeout(runtime.healthRenderTimer);
    runtime.healthRenderTimer = null;
    if (restoreFocus) elements.openHealth.focus();
  }
}

function commissioningContext() {
  const controller = currentControllerBinding();
  return {
    machineId: machineIdentity.machineId,
    controllerFingerprint: controller.commissioningBaselineFingerprint ?? controller.configurationFingerprint ?? controller.transcriptSha256 ?? controller.fingerprint ?? null,
    firmwareSha256: OCTOPUS_FIRMWARE_CANDIDATE.sha256,
    controllerSimulated: controller.simulated === true,
  };
}

function latestCommissioningOperator(record = commissioningRecord) {
  return Object.values(record?.records ?? {})
    .filter((evidence) => evidence?.operator && evidence?.recordedAt)
    .sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt))[0]?.operator ?? "";
}

function setCommissioningTransferMessage(message, state = "") {
  commissioningTransferMessage = String(message ?? "").toUpperCase();
  commissioningTransferState = state;
  setIndicator(commissioningElements.transferState, commissioningTransferMessage, state);
}

function commissioningArtifactLabel() {
  if (commissioningArtifactBusy) return { name: "HASHING FILE", hash: "SHA-256 CALCULATING" };
  if (!commissioningArtifact) return { name: "NO FILE", hash: "SHA-256 --" };
  return {
    name: `${commissioningArtifact.name} / ${Number(commissioningArtifact.bytes ?? 0).toLocaleString("en-US")} BYTES`,
    hash: `SHA-256 ${commissioningArtifact.sha256}`,
  };
}

function renderCommissioningArtifact() {
  const label = commissioningArtifactLabel();
  commissioningElements.artifactName.value = label.name;
  commissioningElements.artifactName.title = label.name;
  commissioningElements.artifactHash.textContent = label.hash;
  commissioningElements.artifactHash.title = label.hash;
  commissioningElements.chooseArtifact.disabled = commissioningArtifactBusy;
}

function commissioningRequirementLabels(check) {
  const labels = [
    `${check.acceptedSources.join(" / ").toUpperCase()} PROVENANCE`,
    "MACHINE UUID",
    "OPERATOR + UTC",
  ];
  if (check.requiresArtifact) labels.push("SHA-256 ARTIFACT");
  if (check.requiresInstrument) labels.push("INSTRUMENT + ASSET ID");
  if (check.bindController) labels.push("PHYSICAL PREFLIGHT");
  if (check.bindFirmware) labels.push("FIRMWARE HASH");
  return labels;
}

function populateCommissioningEvidenceForm(check, result) {
  const evidence = result?.evidence ?? null;
  const source = evidence?.source ?? check.acceptedSources[0] ?? "physical";
  commissioningElements.result.forEach((input) => {
    input.checked = input.value === (evidence?.result ?? "pass");
  });
  commissioningElements.source.value = source;
  commissioningElements.operator.value = evidence?.operator ?? latestCommissioningOperator();
  commissioningElements.instrument.value = evidence?.instrument ?? "";
  commissioningElements.instrumentId.value = evidence?.instrumentId ?? "";
  commissioningElements.value.value = evidence?.value ?? "";
  commissioningElements.unit.value = evidence?.unit ?? "";
  commissioningElements.notes.value = evidence?.notes ?? "";
  commissioningElements.instrument.disabled = !check.requiresInstrument;
  commissioningElements.instrumentId.disabled = !check.requiresInstrument;
  commissioningArtifact = evidence?.artifact ? { ...evidence.artifact } : null;
  commissioningElements.artifactFile.value = "";
  renderCommissioningArtifact();
}

function renderCommissioningEditor(evaluation, populate = false) {
  const result = evaluation.checks[selectedCommissioningCheckId]
    ?? evaluation.stages[0]?.results[0]
    ?? null;
  if (!result) return;
  const { check, evidence, issues, complete } = result;
  selectedCommissioningCheckId = check.id;
  commissioningElements.checkMethod.textContent = check.method;
  commissioningElements.checkTitle.textContent = check.title;
  commissioningElements.checkTitle.title = check.title;
  commissioningElements.checkCriterion.textContent = check.criterion;
  const checkState = complete ? "PASS" : evidence?.result === "fail" ? "FAIL RECORDED" : evidence ? "BLOCKED" : "PENDING";
  setIndicator(commissioningElements.checkState, checkState, complete ? "active" : evidence ? "alarm" : "");
  commissioningElements.requirements.replaceChildren();
  commissioningRequirementLabels(check).forEach((label) => {
    const item = document.createElement("span");
    item.textContent = label;
    commissioningElements.requirements.append(item);
  });
  commissioningElements.remove.disabled = !evidence;
  if (complete) {
    commissioningElements.validation.value = "PASS / CURRENT MACHINE + CONTROLLER + FIRMWARE BINDINGS VERIFIED";
    commissioningElements.validation.dataset.state = "pass";
  } else if (evidence) {
    commissioningElements.validation.value = issues.join(" / ").toUpperCase();
    commissioningElements.validation.dataset.state = "attention";
  } else {
    commissioningElements.validation.value = "NO EVIDENCE RECORDED";
    commissioningElements.validation.dataset.state = "";
  }
  if (populate) populateCommissioningEvidenceForm(check, result);
}

function ensureCommissioningSelection(evaluation) {
  const selectedStage = evaluation.stages.find((stage) => stage.id === selectedCommissioningStageId);
  if (!selectedStage) {
    selectedCommissioningStageId = evaluation.nextCheck?.check.stageId ?? evaluation.stages[0].id;
  }
  const stage = evaluation.stages.find((candidate) => candidate.id === selectedCommissioningStageId) ?? evaluation.stages[0];
  if (!stage.checks.some((check) => check.id === selectedCommissioningCheckId)) {
    const stageNext = stage.results.find((result) => !result.complete);
    selectedCommissioningCheckId = stageNext?.check.id ?? stage.checks[0].id;
  }
  return stage;
}

function renderCommissioningPanel(options = {}) {
  if (elements.commissioningPanel.getAttribute("aria-hidden") !== "false") return null;
  const context = commissioningContext();
  const evaluation = evaluateCommissioningRecord(commissioningRecord, context);
  const stage = ensureCommissioningSelection(evaluation);
  const evidenceCount = Object.keys(evaluation.record.records).length;
  const machineBound = evaluation.record.machineId === context.machineId;
  const bindingMismatch = Boolean(evaluation.record.machineId && !machineBound);
  const controllerPhysical = Boolean(context.controllerFingerprint && !context.controllerSimulated);

  const releaseState = evaluation.allComplete ? "EVIDENCE COMPLETE" : evidenceCount > 0 ? "IN PROGRESS / LOCKED" : "LOCKED / NOT STARTED";
  setIndicator(commissioningElements.state, releaseState, evaluation.allComplete ? "active" : "alarm");
  setIndicator(commissioningElements.stageCount, `${evaluation.completedStages} OF ${evaluation.stages.length}`, evaluation.completedStages > 0 ? "active" : "");
  setIndicator(commissioningElements.checkCount, `${evaluation.passed} OF ${evaluation.total}`, evaluation.passed > 0 ? "active" : "");
  setIndicator(
    commissioningElements.binding,
    bindingMismatch
      ? "MACHINE MISMATCH"
      : context.controllerSimulated
        ? "MACHINE / SIM"
        : controllerPhysical
          ? "MACHINE + CTRL"
          : context.machineId ? "MACHINE ONLY" : "UNBOUND",
    machineBound && controllerPhysical ? "active" : "alarm",
  );
  setIndicator(commissioningElements.motion, "LOCKED", "alarm");
  commissioningElements.next.value = evaluation.nextCheck?.check.title ?? "FINAL INDEPENDENT RELEASE REVIEW";

  commissioningElements.machineId.value = context.machineId ?? "--";
  commissioningElements.machineId.title = context.machineId ?? "";
  const controllerLabel = context.controllerSimulated
    ? `SIM / ${compactFingerprint(context.controllerFingerprint)}`
    : compactFingerprint(context.controllerFingerprint);
  setIndicator(commissioningElements.controllerId, controllerLabel, controllerPhysical ? "active" : "alarm");
  commissioningElements.controllerId.title = context.controllerFingerprint ?? "";
  commissioningElements.firmwareId.value = compactFingerprint(context.firmwareSha256);
  commissioningElements.firmwareId.title = context.firmwareSha256 ?? "";

  commissioningElements.stageTitle.textContent = `STAGE ${stage.number} / ${stage.title}`;
  commissioningElements.stageSummary.textContent = stage.summary;
  setIndicator(commissioningElements.stageProgress, `${stage.passed} OF ${stage.total}`, stage.complete ? "active" : "");
  commissioningElements.stageList.replaceChildren();
  evaluation.stages.forEach((candidate) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "commissioning-stage-button";
    button.dataset.state = candidate.status;
    button.textContent = String(candidate.number).padStart(2, "0");
    button.title = `${candidate.title} / ${candidate.passed} OF ${candidate.total}`;
    button.setAttribute("aria-label", `Stage ${candidate.number} ${candidate.title}, ${candidate.passed} of ${candidate.total}`);
    if (candidate.id === stage.id) button.setAttribute("aria-current", "step");
    button.addEventListener("click", () => {
      selectedCommissioningStageId = candidate.id;
      selectedCommissioningCheckId = candidate.results.find((result) => !result.complete)?.check.id ?? candidate.checks[0].id;
      renderCommissioningPanel({ populate: true });
    });
    commissioningElements.stageList.append(button);
  });

  commissioningElements.checkList.replaceChildren();
  stage.results.forEach((result) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "commissioning-check-button";
    const failed = result.evidence?.result === "fail";
    button.dataset.state = result.complete ? "complete" : failed ? "failed" : "pending";
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-selected", result.check.id === selectedCommissioningCheckId ? "true" : "false");
    const marker = document.createElement("i");
    marker.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = result.check.title;
    const method = document.createElement("small");
    method.textContent = result.check.method;
    copy.append(title, method);
    const status = document.createElement("output");
    status.textContent = result.complete ? "PASS" : failed ? "FAIL" : result.evidence ? "BLOCKED" : "PENDING";
    button.append(marker, copy, status);
    button.addEventListener("click", () => {
      selectedCommissioningCheckId = result.check.id;
      renderCommissioningPanel({ populate: true });
    });
    commissioningElements.checkList.append(button);
  });

  setCommissioningTransferMessage(commissioningTransferMessage, commissioningTransferState);
  commissioningElements.export.disabled = evidenceCount === 0 || bindingMismatch;
  commissioningElements.importConfirm.disabled = !pendingCommissioningBundle;
  commissioningElements.import.disabled = !pendingCommissioningBundle || !commissioningElements.importConfirm.checked;
  commissioningElements.reset.disabled = !commissioningElements.resetConfirm.checked || evidenceCount === 0;
  renderCommissioningEditor(evaluation, options.populate === true);
  return evaluation;
}

function saveCommissioningRecord(record, checked = wiringEvidence.checked) {
  wiringEvidence = saveWiringEvidence({
    ...wiringEvidence,
    checked,
    commissioning: record,
  }, configurationStorage);
  commissioningRecord = wiringEvidence.commissioning;
  renderWiringEvidenceState();
  return commissioningRecord;
}

async function hashCommissioningArtifact(file) {
  if (!file) return;
  const maxBytes = 64 * 1024 * 1024;
  if (file.size > maxBytes) {
    commissioningElements.validation.value = "EVIDENCE FILE EXCEEDS THE 64 MB LOCAL HASH LIMIT";
    commissioningElements.validation.dataset.state = "attention";
    commissioningElements.artifactFile.value = "";
    return;
  }
  commissioningArtifactBusy = true;
  commissioningArtifact = null;
  renderCommissioningArtifact();
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    commissioningArtifact = {
      name: file.name,
      bytes: file.size,
      sha256: await sha256BytesHex(bytes),
    };
    commissioningElements.validation.value = "EVIDENCE FILE HASHED LOCALLY / FILE CONTENT NOT STORED";
    commissioningElements.validation.dataset.state = "pass";
  } catch (error) {
    commissioningArtifact = null;
    commissioningElements.validation.value = error instanceof Error ? error.message.toUpperCase() : "EVIDENCE HASH FAILED";
    commissioningElements.validation.dataset.state = "attention";
  } finally {
    commissioningArtifactBusy = false;
    commissioningElements.artifactFile.value = "";
    renderCommissioningArtifact();
  }
}

function selectedCommissioningResult() {
  return commissioningElements.result.find((input) => input.checked)?.value ?? "fail";
}

function recordCommissioningEvidence() {
  const evaluation = evaluateCommissioningRecord(commissioningRecord, commissioningContext());
  const result = evaluation.checks[selectedCommissioningCheckId];
  if (!result || commissioningArtifactBusy) return;
  const context = commissioningContext();
  try {
    const evidence = createCommissioningEvidence(result.check.id, {
      result: selectedCommissioningResult(),
      source: commissioningElements.source.value,
      operator: commissioningElements.operator.value,
      instrument: commissioningElements.instrument.value,
      instrumentId: commissioningElements.instrumentId.value,
      value: commissioningElements.value.value,
      unit: commissioningElements.unit.value,
      notes: commissioningElements.notes.value,
      artifact: commissioningArtifact,
    }, context);
    const candidate = upsertCommissioningEvidence(commissioningRecord, evidence, context);
    const candidateEvaluation = evaluateCommissioningRecord(candidate, context);
    const candidateResult = candidateEvaluation.checks[result.check.id];
    if (evidence.result === "pass" && !candidateResult.complete) {
      commissioningElements.validation.value = candidateResult.issues.join(" / ").toUpperCase();
      commissioningElements.validation.dataset.state = "attention";
      return;
    }
    const checked = { ...wiringEvidence.checked };
    if (result.check.legacyGateId) checked[result.check.legacyGateId] = candidateResult.complete;
    saveCommissioningRecord(candidate, checked);
    setCommissioningTransferMessage(
      evidence.result === "pass" ? "EVIDENCE RECORDED + BOUND" : "FAILURE EVIDENCE RECORDED",
      evidence.result === "pass" ? "active" : "alarm",
    );
    renderCommissioningPanel({ populate: true });
  } catch (error) {
    commissioningElements.validation.value = error instanceof Error ? error.message.toUpperCase() : "EVIDENCE RECORD FAILED";
    commissioningElements.validation.dataset.state = "attention";
  }
}

function deleteSelectedCommissioningEvidence() {
  const check = COMMISSIONING_CHECKS.find((candidate) => candidate.id === selectedCommissioningCheckId);
  if (!check || !commissioningRecord.records[check.id]) return;
  const checked = { ...wiringEvidence.checked };
  if (check.legacyGateId) checked[check.legacyGateId] = false;
  saveCommissioningRecord(removeCommissioningEvidence(commissioningRecord, check.id), checked);
  setCommissioningTransferMessage("LOCAL EVIDENCE RECORD REMOVED", "alarm");
  renderCommissioningPanel({ populate: true });
}

function downloadCommissioningBundle(bundle) {
  const safeLabel = machineIdentity.label.replace(/[^A-Z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "MR1";
  const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeLabel}-${bundle.createdAt.slice(0, 10)}.mr1-commissioning.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function exportCommissioningRecord() {
  try {
    const bundle = await createCommissioningBundle(commissioningRecord, commissioningContext());
    downloadCommissioningBundle(bundle);
    setCommissioningTransferMessage(`SEALED / ${compactFingerprint(bundle.integrity.digest)}`, "active");
  } catch (error) {
    setCommissioningTransferMessage(error instanceof Error ? error.message : "COMMISSIONING EXPORT FAILED", "alarm");
  }
}

async function loadCommissioningRecordFile(file) {
  pendingCommissioningBundle = null;
  commissioningElements.importConfirm.checked = false;
  commissioningElements.importConfirm.disabled = true;
  commissioningElements.import.disabled = true;
  if (!file) {
    setCommissioningTransferMessage("NO IMPORT");
    return;
  }
  setCommissioningTransferMessage("VERIFYING SHA-256");
  try {
    pendingCommissioningBundle = await parseCommissioningBundle(await file.text(), {
      expectedMachineId: machineIdentity.machineId,
    });
    commissioningElements.importConfirm.disabled = false;
    const count = Object.keys(pendingCommissioningBundle.record.records).length;
    setCommissioningTransferMessage(`VERIFIED / ${count} RECORDS / ${compactFingerprint(pendingCommissioningBundle.integrity.digest)}`, "active");
  } catch (error) {
    setCommissioningTransferMessage(error instanceof Error ? error.message : "COMMISSIONING IMPORT FAILED", "alarm");
  } finally {
    commissioningElements.importFile.value = "";
    renderCommissioningPanel();
  }
}

function importCommissioningRecord() {
  if (!pendingCommissioningBundle || !commissioningElements.importConfirm.checked) return;
  if (runtime.commandPending) {
    setCommissioningTransferMessage("WAIT FOR THE ACTIVE MACHINE TRANSACTION", "alarm");
    return;
  }
  const record = normalizeCommissioningRecord(pendingCommissioningBundle.record);
  const evaluation = evaluateCommissioningRecord(record, commissioningContext());
  const checked = { ...wiringEvidence.checked };
  COMMISSIONING_CHECKS.forEach((check) => {
    if (check.legacyGateId) checked[check.legacyGateId] = evaluation.checks[check.id].complete;
  });
  saveCommissioningRecord(record, checked);
  pendingCommissioningBundle = null;
  commissioningElements.importConfirm.checked = false;
  commissioningElements.importConfirm.disabled = true;
  selectedCommissioningStageId = evaluation.nextCheck?.check.stageId ?? COMMISSIONING_STAGES.at(-1).id;
  selectedCommissioningCheckId = evaluation.nextCheck?.check.id ?? COMMISSIONING_STAGES.at(-1).checks.at(-1).id;
  setCommissioningTransferMessage("VERIFIED RECORD IMPORTED", "active");
  renderCommissioningPanel({ populate: true });
}

function resetCommissioningRecord() {
  if (!commissioningElements.resetConfirm.checked || runtime.commandPending) return;
  const checked = { ...wiringEvidence.checked };
  COMMISSIONING_CHECKS.forEach((check) => {
    if (check.legacyGateId) checked[check.legacyGateId] = false;
  });
  saveCommissioningRecord(normalizeCommissioningRecord(), checked);
  pendingCommissioningBundle = null;
  selectedCommissioningStageId = null;
  selectedCommissioningCheckId = null;
  commissioningArtifact = null;
  commissioningElements.resetConfirm.checked = false;
  commissioningElements.importConfirm.checked = false;
  setCommissioningTransferMessage("LOCAL COMMISSIONING EVIDENCE RESET", "alarm");
  renderCommissioningPanel({ populate: true });
}

function setCommissioningPanel(open, restoreFocus = true) {
  if (open) {
    setHealthPanel(false, false);
    setFissionSettingsPanel(false);
    setControllerSettingsPanel(false, false);
    setMachineDataPanel(false, false);
    setJogPanel(false, false);
    setSceneRegistrationPanel(false, false);
    setFixtureMapPanel(false, false);
    setCutterCompPanel(false, false);
    setMetrologyPanel(false, false);
    setWiringPanel(false, false);
    setSpindlePanel(false, false);
    setProbingPanel(false, false);
  }
  elements.commissioningPanel.classList.toggle("open", open);
  elements.commissioningScrim.classList.toggle("open", open);
  elements.commissioningPanel.inert = !open;
  elements.commissioningPanel.setAttribute("aria-hidden", open ? "false" : "true");
  elements.openCommissioning.setAttribute("aria-pressed", open ? "true" : "false");
  elements.commissioningScrim.tabIndex = open ? 0 : -1;
  if (open) {
    renderCommissioningPanel({ populate: true });
    elements.commissioningPanel.querySelector(".commissioning-panel-scroll").scrollTop = 0;
    elements.closeCommissioning.focus();
  } else if (restoreFocus) {
    elements.openCommissioning.focus();
  }
}

function updateProbingSignals(telemetry = null) {
  if (!telemetry) {
    setIndicator(elements.setterInputState, "OFFLINE");
    setIndicator(elements.touchInputState, "OFFLINE");
    setIndicator(elements.activeProbeState, "--");
    return;
  }

  const controls = telemetry.pins.controls;
  const probeLabel = telemetry.activeProbe === 1
    ? "TOOL SETTER"
    : telemetry.activeProbe === 0
      ? "PRIMARY"
      : Number.isFinite(telemetry.activeProbe) ? `PROBE ${telemetry.activeProbe}` : "UNKNOWN";
  setIndicator(elements.activeProbeState, probeLabel, "active");

  const setSignal = (element, selected) => {
    if (!selected) setIndicator(element, "NOT SELECTED");
    else if (controls.probeDisconnected) setIndicator(element, "DISCONNECTED", "alarm");
    else if (controls.probeTriggered) setIndicator(element, "TRIGGERED", "active");
    else setIndicator(element, "OPEN");
  };
  setSignal(elements.setterInputState, telemetry.activeProbe === 1);
  setSignal(elements.touchInputState, telemetry.activeProbe === 0);
}

function setTelemetryLink(label, state, pressed, tooltip) {
  const pressedValue = pressed ? "true" : "false";
  if (elements.telemetrySource.textContent !== label) elements.telemetrySource.textContent = label;
  if (elements.telemetryConnect.dataset.link !== state) elements.telemetryConnect.dataset.link = state;
  if (elements.telemetryConnect.getAttribute("aria-pressed") !== pressedValue) {
    elements.telemetryConnect.setAttribute("aria-pressed", pressedValue);
  }
  if (elements.telemetryConnect.dataset.tooltip !== tooltip) elements.telemetryConnect.dataset.tooltip = tooltip;
  if (elements.telemetryConnect.getAttribute("aria-label") !== tooltip) {
    elements.telemetryConnect.setAttribute("aria-label", tooltip);
  }
  if (elements.telemetryConnect.title !== tooltip) elements.telemetryConnect.title = tooltip;
}

function liveTelemetryTooltip(action = "Disconnect telemetry") {
  const diagnostics = telemetryClient.diagnostics;
  const ageMs = runtime.telemetryMeta?.bridgeAgeMs ?? runtime.telemetryMeta?.sourceAgeMs;
  const details = [action];
  if (Number.isFinite(ageMs)) details.push(`age ${Math.round(ageMs)} ms`);
  details.push(`gaps ${diagnostics.sequenceGapCount}`);
  details.push(`retries ${diagnostics.reconnectCount}`);
  details.push(diagnostics.clockSynchronized ? "clock synced" : "clock unsynced");
  if (viewer?.renderProfile) details.push(`${viewer.renderProfile.quality} 3D`);
  return details.join(" · ");
}

function armTelemetryWatchdog() {
  clearTimeout(runtime.telemetryWatchdog);
  const staleAfter = Math.max(1200, Number(runtime.bridge?.pollMs ?? 100) * 5);
  runtime.telemetryWatchdog = setTimeout(() => {
    if (!runtime.live) return;
    runtime.telemetryLinked = false;
    setTelemetryLink("STALE", "error", true, liveTelemetryTooltip("Disconnect stale telemetry"));
    setMachineState("STALE", "stop");
    renderMachineCommandSurfaces();
  }, staleAfter);
}

function updateLiveRenderDatasets() {
  const coalesced = Math.max(0, runtime.liveRenderStats.packets - runtime.liveRenderStats.frames);
  elements.viewer.dataset.livePackets = String(runtime.liveRenderStats.packets);
  elements.viewer.dataset.liveFrames = String(runtime.liveRenderStats.frames);
  elements.viewer.dataset.liveCoalesced = String(coalesced);
  elements.telemetryConnect.dataset.sequenceGaps = String(
    telemetryClient.diagnostics.sequenceGapCount,
  );
}

function requestLiveVisualRender() {
  if (!runtime.live || document.hidden || runtime.liveRenderFrame !== null) return;
  runtime.liveRenderFrame = requestAnimationFrame((renderedAt) => {
    runtime.liveRenderFrame = null;
    const telemetryEntry = runtime.pendingTelemetry;
    const sensorEntry = runtime.pendingSensor;
    const renderSpindle = runtime.pendingSpindleRender || Boolean(telemetryEntry);
    runtime.pendingTelemetry = null;
    runtime.pendingSensor = null;
    runtime.pendingSpindleRender = false;
    if (!runtime.live) return;

    runtime.liveRenderStats.frames += 1;
    if (telemetryEntry) {
      const queuedAt = telemetryEntry.metadata?.clientReceivedPerformanceMs;
      if (Number.isFinite(queuedAt)) {
        const renderDelayMs = Math.max(0, renderedAt - queuedAt);
        elements.viewer.dataset.telemetryRenderDelayMs = renderDelayMs.toFixed(3);
        latencyMonitor.recordRender(telemetryEntry.metadata, renderDelayMs);
      }
      updateLiveReadout(telemetryEntry.packet, { renderSpindle: false });
      elements.viewer.dataset.telemetryRenderedSequence = Number.isInteger(
        telemetryEntry.metadata?.sequence,
      )
        ? String(telemetryEntry.metadata.sequence)
        : "";
      requestHealthRender();
    }
    if (sensorEntry) updateSensorReadout(sensorEntry.packet, sensorEntry.metadata);
    if (renderSpindle && elements.spindlePanel.getAttribute("aria-hidden") === "false") {
      renderSpindleDiagnostics();
    }
    updateLiveRenderDatasets();
  });
}

function queueLiveTelemetry(telemetry, metadata) {
  runtime.telemetry = telemetry;
  runtime.telemetryMeta = metadata;
  runtime.telemetryLinked = true;
  latencyMonitor.recordTelemetry(metadata);
  elements.viewer.dataset.telemetryCriticalSequence = Number.isInteger(metadata?.sequence)
    ? String(metadata.sequence)
    : "";
  runtime.pendingTelemetry = { packet: telemetry, metadata };
  runtime.liveRenderStats.packets += 1;
  elements.viewer.dataset.telemetrySequence = Number.isInteger(metadata?.sequence)
    ? String(metadata.sequence)
    : "";
  elements.viewer.dataset.telemetryAgeMs = Number.isFinite(metadata?.bridgeAgeMs)
    ? String(Math.round(metadata.bridgeAgeMs))
    : "";
  armTelemetryWatchdog();
  requestLiveVisualRender();
}

function queueLiveSensor(sensor, metadata) {
  runtime.sensor = sensor;
  runtime.sensorMeta = metadata;
  sensorSession.append(sensor, metadata, { spindleRpm: currentSensorSpindleRpm() });
  runtime.pendingSensor = { packet: sensor, metadata };
  runtime.liveRenderStats.packets += 1;
  requestLiveVisualRender();
}

function queueLiveSpindleRender() {
  if (elements.spindlePanel.getAttribute("aria-hidden") !== "false") return;
  runtime.pendingSpindleRender = true;
  runtime.liveRenderStats.packets += 1;
  requestLiveVisualRender();
}

function currentPreviewPosition() {
  if (runtime.previewJogPosition) return runtime.previewJogPosition;
  return sampleJob(job, runtime.elapsed).position;
}

function selectedJogSpeed(axis) {
  if (runtime.jogSpeed === "rapid") return MR1_CONFIG.maxRate[axis];
  return Math.min(Number(runtime.jogSpeed), MR1_CONFIG.maxRate[axis]);
}

function jogIntent(axis, direction, distance = null) {
  const movement = Number.isFinite(distance)
    ? distance
    : runtime.jogStep === "continuous"
      ? continuousJogDistance(selectedJogSpeed(axis), CONTINUOUS_JOG_INTERVAL_MS)
      : Number(runtime.jogStep);
  return {
    type: "jog",
    axis,
    direction,
    distance: movement,
    feed: selectedJogSpeed(axis),
    coordinateMode: runtime.jogCoordinateMode,
  };
}

function renderJogPanel(previewPosition = null) {
  const virtualControl = machineCommandsEnabled();
  const physicalLocked = runtime.live && !virtualControl;
  const syncHeld = virtualControl && !runtime.telemetryLinked;
  const displayedTelemetry = runtime.renderedTelemetry;
  const position = runtime.live
    ? displayedTelemetry?.position?.[runtime.jogCoordinateMode]
    : runtime.jogCoordinateMode === "work" ? previewPosition ?? currentPreviewPosition() : null;

  setIndicator(
    jogElements.commandMode,
    syncHeld ? "SYNC HOLD" : virtualControl ? "VIRTUAL CONTROL" : physicalLocked ? "HARDWARE LOCKED" : "PREVIEW ONLY",
    physicalLocked || syncHeld ? "alarm" : "active",
  );
  const leaseOwner = runtime.bridge?.machineCommands?.owner ?? null;
  setIndicator(
    jogElements.serialOwner,
    virtualControl
      ? leaseOwner ? transactionOwnedByThisUi(leaseOwner) ? "THIS UI" : "OTHER SESSION" : "AVAILABLE"
      : physicalLocked ? `${runtime.bridge?.serialPort ?? "CTRL"} / STATUS` : "NONE",
    virtualControl || physicalLocked ? "active" : "",
  );

  for (const axis of ["x", "y", "z"]) {
    jogElements.dro[axis].value = Number.isFinite(position?.[axis])
      ? position[axis].toFixed(3)
      : "---.---";
  }

  const distances = calculateLimitDistances(displayedTelemetry?.position?.machine, MR1_CONFIG.machineEnvelope);
  for (const axis of ["x", "y", "z"]) {
    for (const direction of ["negative", "positive"]) {
      const element = jogElements.limits[axis][direction];
      const value = distances?.[axis]?.[direction];
      element.value = Number.isFinite(value) ? value.toFixed(3) : "--";
      element.dataset.state = Number.isFinite(value) && (value < 0 || displayedTelemetry?.pins?.limits?.[axis])
        ? "alarm"
        : "";
    }
  }

  document.querySelectorAll("[data-jog-coordinate]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.jogCoordinate === runtime.jogCoordinateMode ? "true" : "false");
  });
  document.querySelectorAll("[data-jog-step]").forEach((button) => {
    button.setAttribute("aria-pressed", String(runtime.jogStep) === button.dataset.jogStep ? "true" : "false");
  });
  document.querySelectorAll("[data-jog-speed]").forEach((button) => {
    button.setAttribute("aria-pressed", String(runtime.jogSpeed) === button.dataset.jogSpeed ? "true" : "false");
  });

  jogElements.stepValue.value = runtime.jogStep === "continuous"
    ? "CONTINUOUS"
    : `${Number(runtime.jogStep).toFixed(3)} mm`;
  jogElements.speedValue.value = runtime.jogSpeed === "rapid"
    ? "AXIS MAX"
    : `${runtime.jogSpeed} mm/min`;
  jogElements.directionButtons.forEach((button) => {
    const intent = jogIntent(button.dataset.jogAxis, Number(button.dataset.jogDirection));
    const evaluation = evaluateUiMachineIntent(intent);
    button.disabled = runtime.live
      ? !virtualControl || runtime.commandPending || !evaluation.permitted
      : false;
    button.dataset.tooltip = runtime.live
      ? button.disabled
        ? evaluation.blockers[0]?.detail ?? "Command transaction busy"
        : `${button.getAttribute("aria-label")} through typed virtual transaction`
      : `${button.getAttribute("aria-label")} preview`;
  });
  const transaction = transactionMatches("jog");
  if (transaction && !transactionIsTerminal(transaction)) {
    jogElements.commandStatus.value = transactionStatusLabel(transaction);
    jogElements.commandStatus.dataset.state = "active";
  } else if (transaction?.state === "completed") {
    const positionValue = transaction.result?.machinePosition?.[transaction.result?.axis];
    jogElements.commandStatus.value = Number.isFinite(positionValue)
      ? `COMPLETE / ${transaction.result.axis.toUpperCase()} ${positionValue.toFixed(3)} MPOS / IDLE OBSERVED`
      : "COMPLETE / IDLE OBSERVED";
    jogElements.commandStatus.dataset.state = "active";
  } else if (transaction?.state === "cancelled") {
    jogElements.commandStatus.value = "CANCELLED / MOTION HELD";
    jogElements.commandStatus.dataset.state = "alarm";
  } else if (transaction?.state === "failed" || transaction?.state === "rejected") {
    jogElements.commandStatus.value = transaction.error?.message ?? "JOG TRANSACTION FAILED";
    jogElements.commandStatus.dataset.state = "alarm";
  } else if (syncHeld) {
    jogElements.commandStatus.value = "BLOCKED / WAITING FOR FRESH POSITION";
    jogElements.commandStatus.dataset.state = "alarm";
  } else if (virtualControl) {
    jogElements.commandStatus.value = "TYPED JOG READY / LIMIT + HOME + STATE GATED";
    jogElements.commandStatus.dataset.state = "active";
  } else if (physicalLocked) {
    jogElements.commandStatus.value = "LOCKED / OCTOPUS COMMISSIONING REQUIRED";
    jogElements.commandStatus.dataset.state = "alarm";
  } else {
    jogElements.commandStatus.value = "PREVIEW JOG READY / NO SERIAL OUTPUT";
    jogElements.commandStatus.dataset.state = "";
  }
  elements.jogPanel.dataset.mode = syncHeld ? "sync-hold" : virtualControl ? "virtual" : physicalLocked ? "locked" : "preview";
}

function stopContinuousPreviewJog() {
  const releasedLiveJog = Boolean(runtime.continuousJogButton) && runtime.live;
  const activeJog = transactionMatches("jog");
  const cancelActiveJog = releasedLiveJog && activeJog && !transactionIsTerminal(activeJog);
  const latchPendingJog = releasedLiveJog && runtime.commandPending && !cancelActiveJog;
  if (runtime.continuousJogTimer) clearInterval(runtime.continuousJogTimer);
  runtime.continuousJogTimer = null;
  runtime.continuousJogButton?.classList.remove("is-jogging");
  runtime.continuousJogButton = null;
  if (cancelActiveJog) {
    runtime.continuousJogReleasePending = false;
    void cancelOwnedMachineTransaction("DEAD-MAN RELEASE / CANCELLING JOG");
  } else if (latchPendingJog) {
    runtime.continuousJogReleasePending = true;
    runtime.commandFeedback = "DEAD-MAN RELEASE / WAITING FOR OWNED JOG";
    renderMachineCommandSurfaces();
  }
}

function clearPreviewJog() {
  stopContinuousPreviewJog();
  runtime.previewJogPosition = null;
}

function applyPreviewJog(axis, direction, distance = null) {
  if (runtime.live) return;
  const movement = Number.isFinite(distance) ? distance : Number(runtime.jogStep);
  const nextPosition = movePreviewPosition(currentPreviewPosition(), axis, direction, movement);
  if (!nextPosition) return;

  runtime.previewJogPosition = nextPosition;
  runtime.playing = false;
  runtime.stopped = false;
  elements.feedHold.disabled = true;
  setMachineState("PREVIEW JOG", "hold");
  setCycleButtonLabel("RESUME PREVIEW");

  const sample = { ...sampleJob(job, runtime.elapsed), position: nextPosition };
  viewer?.setToolSegmentPosition(sample.segment, sample.localProgress, nextPosition);
  updateReadout(sample);
}

function startContinuousPreviewJog(button) {
  if (runtime.jogStep !== "continuous" || runtime.continuousJogTimer) return;
  if (runtime.live && !machineCommandsEnabled()) return;
  const axis = button.dataset.jogAxis;
  const direction = Number(button.dataset.jogDirection);
  const distance = continuousJogDistance(selectedJogSpeed(axis), CONTINUOUS_JOG_INTERVAL_MS);
  runtime.continuousJogReleasePending = false;
  const tick = () => {
    if (runtime.live) {
      if (!runtime.commandPending) void submitMachineIntent(jogIntent(axis, direction, distance), `${axis.toUpperCase()} JOG`);
    } else {
      applyPreviewJog(axis, direction, distance);
    }
  };
  runtime.continuousJogButton = button;
  button.classList.add("is-jogging");
  tick();
  runtime.continuousJogTimer = setInterval(tick, CONTINUOUS_JOG_INTERVAL_MS);
}

function setPreviewControlsLocked(locked) {
  elements.restart.disabled = locked;
  elements.programStop.disabled = locked;
  elements.cycleStart.disabled = locked;
  elements.progress.disabled = locked;
  elements.feedHold.disabled = locked || !runtime.playing;
}

function setMachineStateFromTelemetry(state) {
  const name = state?.name ?? "Unknown";
  const label = String(state?.raw ?? name).toUpperCase();
  let style = "idle";
  if (name === "Run" || name === "Jog" || name === "Home") style = "run";
  else if (name === "Hold" || name === "Tool") style = "hold";
  else if (name === "Alarm" || name === "Door" || name === "Unknown") style = "stop";
  setMachineState(label, style);
}

function currentSensorSpindleRpm() {
  return sensorSpindleRpm({
    bridge: runtime.bridge,
    sensor: runtime.sensor,
    spindle: runtime.spindle,
    telemetry: runtime.telemetry,
  });
}

function formatSensorDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "--";
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} m ${seconds % 60} s`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} m`;
}

function setSensorBoolean(element, value, trueLabel = "HEALTHY", falseLabel = "FAULT") {
  if (value === true) setIndicator(element, trueLabel, "active");
  else if (value === false) setIndicator(element, falseLabel, "alarm");
  else setIndicator(element, "UNKNOWN");
}

function renderSensorHistory() {
  const canvas = sensorElements.historyCanvas;
  const width = Math.floor(canvas.clientWidth);
  if (width < 80) return;
  const height = 154;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  const renderWidth = Math.max(1, Math.round(width * pixelRatio));
  const renderHeight = Math.max(1, Math.round(height * pixelRatio));
  if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
    canvas.width = renderWidth;
    canvas.height = renderHeight;
  }
  const context = canvas.getContext("2d", { alpha: false });
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.fillStyle = "#121416";
  context.fillRect(0, 0, width, height);

  const inset = { left: 26, right: 8, top: 8, bottom: 16 };
  const plotWidth = Math.max(1, width - inset.left - inset.right);
  const plotHeight = Math.max(1, height - inset.top - inset.bottom);
  const yForScore = (value) => inset.top + plotHeight * (1 - Math.max(0, Math.min(100, value)) / 100);
  context.font = "8px Consolas, monospace";
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (const level of [0, 40, 70, 100]) {
    const y = yForScore(level);
    context.strokeStyle = level >= 70 ? "rgba(215,25,32,0.48)" : "rgba(220,225,229,0.14)";
    context.lineWidth = level >= 70 ? 1.2 : 1;
    context.beginPath();
    context.moveTo(inset.left, y);
    context.lineTo(width - inset.right, y);
    context.stroke();
    context.fillStyle = level >= 70 ? "#d71920" : "#737c84";
    context.fillText(String(level), inset.left - 5, y);
  }

  const samples = sensorSession.samples;
  if (samples.length < 2) {
    context.fillStyle = "#a0a8b0";
    context.textAlign = "center";
    context.fillText("WAITING FOR SENSOR HISTORY", inset.left + plotWidth / 2, inset.top + plotHeight / 2);
    return;
  }
  const series = [
    ["gyroscopeScore", "#596168", 1],
    ["accelerometerScore", "#a0a8b0", 1],
    ["microphoneScore", "#ffffff", 1],
    ["score", "#d71920", 2],
  ];
  for (const [key, color, lineWidth] of series) {
    context.beginPath();
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    let drawing = false;
    samples.forEach((sample, index) => {
      const value = sample[key];
      if (!Number.isFinite(value)) {
        drawing = false;
        return;
      }
      const x = inset.left + (index / Math.max(1, samples.length - 1)) * plotWidth;
      const y = yForScore(value);
      if (!drawing) context.moveTo(x, y);
      else context.lineTo(x, y);
      drawing = true;
    });
    context.stroke();
  }
}

function renderSensorDiagnostics() {
  const sensor = runtime.sensor;
  const metadata = runtime.sensorMeta ?? {};
  const health = evaluateSensorHealth(sensor, metadata);
  const simulated = sensorSourceIsSimulation(runtime.bridge, sensor);
  const healthLabel = simulated ? `SIM / ${health.label}` : health.label;
  setIndicator(
    sensorElements.healthState,
    healthLabel,
    health.state === "alarm" || health.state === "offline" ? "alarm" : "active",
  );
  sensorElements.healthState.title = health.issues.join(" ");
  sensorElements.section.dataset.sensorState = health.state;

  const score = sensor?.score;
  setIndicator(
    sensorElements.fusedScore,
    Number.isFinite(score) ? score.toFixed(0) : "--",
    sensor?.state === "chatter" ? "alarm" : sensor?.state === "warning" ? "active" : "",
  );
  setIndicator(sensorElements.frequency, Number.isFinite(sensor?.frequencyHz) ? sensor.frequencyHz.toFixed(0) : "--");
  setIndicator(sensorElements.vibration, Number.isFinite(sensor?.vibrationG) ? sensor.vibrationG.toFixed(4) : "--");
  setIndicator(sensorElements.rotation, Number.isFinite(sensor?.rotationDps) ? sensor.rotationDps.toFixed(2) : "--");

  for (const key of ["microphone", "accelerometer", "gyroscope"]) {
    const value = sensor?.components?.[key];
    sensorElements.componentBars[key].value = Number.isFinite(value) ? value : 0;
    sensorElements.componentScores[key].value = Number.isFinite(value) ? value.toFixed(0) : "--";
  }

  const spindleRpm = currentSensorSpindleRpm();
  const order = calculateVibrationOrder(sensor?.frequencyHz, spindleRpm);
  setIndicator(sensorElements.spindleRpm, Number.isFinite(spindleRpm) ? `${spindleRpm.toFixed(0)} rpm` : "--");
  setIndicator(
    sensorElements.rotationalFrequency,
    Number.isFinite(order?.rotationalHz) ? `${order.rotationalHz.toFixed(2)} Hz` : "--",
  );
  setIndicator(sensorElements.vibrationOrder, Number.isFinite(order?.order) ? `${order.order.toFixed(2)} x` : "--");
  setIndicator(
    sensorElements.nearestOrder,
    Number.isInteger(order?.nearestOrder)
      ? `${order.nearestOrder}x / Δ ${order.distanceFromNearest.toFixed(2)}`
      : "--",
    Number.isFinite(order?.distanceFromNearest) && order.distanceFromNearest < 0.08 ? "active" : "",
  );

  const calibration = sensor?.calibration;
  if (calibration?.active) {
    const settling = Number(calibration.settleRemainingMs) > 0;
    const progress = Number.isFinite(calibration.progress)
      ? ` ${Math.round(calibration.progress * 100)}%`
      : "";
    setIndicator(
      sensorElements.calibration,
      settling ? `SETTLING ${(calibration.settleRemainingMs / 1000).toFixed(1)}s` : `RUNNING${progress}`,
      "active",
    );
  } else if (sensor?.calibrated && calibration?.persisted === false) {
    setIndicator(sensorElements.calibration, "VOLATILE", "alarm");
  } else if (sensor?.calibrated && calibration?.persisted === true) {
    const generation = Number.isInteger(calibration?.generation) && calibration.generation > 0
      ? ` G${calibration.generation}`
      : "";
    setIndicator(sensorElements.calibration, `SAVED${generation}`, "active");
  } else if (sensor?.calibrated) {
    setIndicator(sensorElements.calibration, "QUALIFIED", "active");
  } else if (calibration?.lastResult === "rejected") {
    setIndicator(sensorElements.calibration, "REJECTED", "alarm");
  } else {
    setIndicator(sensorElements.calibration, sensor ? "REQUIRED" : "--", sensor ? "alarm" : "");
  }
  sensorElements.calibration.title = calibration
    ? `Store ${calibration.storageState ?? "unknown"}; ${calibration.validSlots ?? 0}/2 valid slots; ${calibration.lastResult ?? "none"}${calibration.lastReason && calibration.lastReason !== "none" ? ` (${calibration.lastReason})` : ""}`
    : "";
  setSensorBoolean(sensorElements.imuHealth, sensor?.health?.imu);
  setSensorBoolean(sensorElements.audioHealth, sensor?.health?.audio);
  if (sensor?.health?.externalTemperature === true) setIndicator(sensorElements.externalTempHealth, "HEALTHY", "active");
  else if (sensor?.health?.externalTemperaturePresent === true
    || (sensor?.health?.externalTemperatureFaults ?? 0) > 0) {
    setIndicator(sensorElements.externalTempHealth, "FAULT", "alarm");
  }
  else if (sensor) setIndicator(sensorElements.externalTempHealth, "NOT FITTED");
  else setIndicator(sensorElements.externalTempHealth, "--");

  setIndicator(
    sensorElements.firmware,
    sensor ? `${sensor.firmwareVersion ?? "LEGACY"} / S${sensor.schemaVersion ?? 1}` : "--",
    sensor?.schemaVersion >= 2 ? "active" : sensor ? "alarm" : "",
  );
  setIndicator(sensorElements.deviceUptime, formatSensorDuration(sensor?.deviceUptimeMs));
  setIndicator(
    sensorElements.processingTime,
    Number.isFinite(sensor?.processingMs) ? `${sensor.processingMs.toFixed(1)} ms` : "--",
    sensor?.processingMs > 150 ? "alarm" : sensor ? "active" : "",
  );
  setIndicator(
    sensorElements.sampleAge,
    Number.isFinite(sensor?.deviceSampleAgeMs) ? `${sensor.deviceSampleAgeMs} ms` : "--",
    sensor?.deviceSampleAgeMs > 250 ? "alarm" : sensor ? "active" : "",
  );
  setIndicator(
    sensorElements.packetAge,
    Number.isFinite(health.packetAgeMs) ? `${Math.round(health.packetAgeMs)} ms` : "--",
    health.packetAgeMs > 2500 ? "alarm" : sensor ? "active" : "",
  );
  setIndicator(
    sensorElements.imuSamples,
    Number.isInteger(sensor?.health?.imuSamples) ? `${sensor.health.imuSamples} @ ${sensor.dsp?.imuRateHz ?? "?"} Hz` : "--",
  );
  setIndicator(
    sensorElements.heap,
    Number.isFinite(sensor?.health?.freeHeapBytes)
      ? `${Math.round(sensor.health.freeHeapBytes / 1024)} / ${Math.round((sensor.health.minimumFreeHeapBytes ?? 0) / 1024)} KiB`
      : "--",
    Number.isFinite(sensor?.health?.freeHeapBytes) && sensor.health.freeHeapBytes < 250_000 ? "alarm" : "",
  );
  setIndicator(
    sensorElements.sequences,
    Number.isInteger(sensor?.deviceReportSequence)
      ? `${sensor.deviceReportSequence} / ${sensor.deviceSampleSequence ?? "--"}`
      : "--",
  );

  const snapshot = sensorSession.snapshot();
  setIndicator(sensorElements.gaps, `${snapshot.bridgeSequenceGaps} / ${snapshot.deviceSequenceGaps}`, snapshot.bridgeSequenceGaps + snapshot.deviceSequenceGaps > 0 ? "alarm" : sensor ? "active" : "");
  setIndicator(sensorElements.resets, String(snapshot.deviceResets), snapshot.deviceResets > 0 ? "alarm" : sensor ? "active" : "");
  setIndicator(sensorElements.baselineVibration, Number.isFinite(sensor?.calibration?.baselineVibrationG) ? `${sensor.calibration.baselineVibrationG.toFixed(4)} g` : "--");
  setIndicator(sensorElements.baselineRotation, Number.isFinite(sensor?.calibration?.baselineRotationDps) ? `${sensor.calibration.baselineRotationDps.toFixed(2)} deg/s` : "--");
  setIndicator(sensorElements.baselineMicrophone, Number.isFinite(sensor?.calibration?.baselineMicrophoneScore) ? `${sensor.calibration.baselineMicrophoneScore.toFixed(1)} %` : "--");
  sensorElements.baselineVibration.title = Number.isFinite(calibration?.vibrationStdDevG) ? `Standard deviation ${calibration.vibrationStdDevG.toFixed(4)} g` : "";
  sensorElements.baselineRotation.title = Number.isFinite(calibration?.rotationStdDevDps) ? `Standard deviation ${calibration.rotationStdDevDps.toFixed(2)} deg/s` : "";
  sensorElements.baselineMicrophone.title = Number.isFinite(calibration?.microphoneStdDevScore) ? `Standard deviation ${calibration.microphoneStdDevScore.toFixed(1)} %` : "";
  setIndicator(
    sensorElements.sessionScore,
    Number.isFinite(snapshot.meanScore) ? `${snapshot.meanScore.toFixed(1)} / ${snapshot.maximumScore.toFixed(1)} %` : "--",
  );
  setIndicator(sensorElements.sessionVibration, Number.isFinite(snapshot.maximumVibrationG) ? `${snapshot.maximumVibrationG.toFixed(4)} g` : "--");
  setIndicator(sensorElements.sessionTemperature, Number.isFinite(snapshot.maximumTemperatureC) ? `${snapshot.maximumTemperatureC.toFixed(1)} C` : "--");
  const feedback = runtime.sensorCommandFeedback?.expiresAt > performance.now()
    ? runtime.sensorCommandFeedback
    : null;
  if (!feedback && runtime.sensorCommandFeedback) runtime.sensorCommandFeedback = null;
  setIndicator(
    sensorElements.advisoryState,
    runtime.sensorCommandPending
      ? "SENDING SENSOR COMMAND"
      : feedback?.label ?? (simulated ? "SIMULATION / NO MACHINE COMMANDS" : "ADVISORY / NO MACHINE COMMANDS"),
    feedback?.error || health.state === "alarm" ? "alarm" : "active",
  );
  const calibrationTransportAvailable = runtime.bridge?.sensorCalibrationTransportAvailable === true
    && runtime.bridge?.sensorWritePolicy === "calibration-only";
  const calibrationAvailable = calibrationTransportAvailable
    && runtime.bridge?.sensorCalibrationAvailable === true
    && runtime.bridge?.sensorWritePolicy === "calibration-only";
  const calibrationBusy = runtime.sensorCommandPending || calibration?.active === true;
  sensorElements.startCalibration.disabled = !calibrationAvailable
    || calibrationBusy
    || calibration?.commandStartSupported !== true
    || sensor?.health?.imu !== true
    || sensor?.health?.audio !== true;
  sensorElements.clearCalibration.disabled = !calibrationAvailable
    || calibrationBusy
    || calibration?.commandClearSupported !== true
    || (!sensor?.calibrated && !["invalid", "error", "volatile"].includes(calibration?.storageState));
  sensorElements.startCalibration.title = !calibrationTransportAvailable
    ? "Connect the physical ESP32 through the telemetry service"
    : !calibrationAvailable || calibration?.commandStartSupported !== true
      ? "Connected sensor firmware does not advertise remote calibration"
      : "Capture and persist a quiet-machine ESP32 baseline";
  sensorElements.clearCalibration.title = !calibrationTransportAvailable
    ? "Connect the physical ESP32 through the telemetry service"
    : !calibrationAvailable || calibration?.commandClearSupported !== true
      ? "Connected sensor firmware does not advertise calibration clear"
      : "Remove both persisted ESP32 calibration slots";
  sensorElements.exportSession.disabled = snapshot.retainedSamples === 0;
  renderSensorHistory();
}

function downloadSensorSession() {
  const snapshot = sensorSession.snapshot();
  if (snapshot.retainedSamples === 0) return;
  const blob = new Blob([sensorSession.toCsv()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  link.href = url;
  link.download = `mr1-esp32-sensor-${timestamp}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function requestSensorCalibration(action) {
  if (runtime.sensorCommandPending || !["start", "clear"].includes(action)) return;
  const prompt = action === "start"
    ? "Stop the spindle and coolant, keep the mounted sensor still, then start calibration?"
    : "Clear both saved ESP32 calibration records?";
  if (!window.confirm(prompt)) return;

  runtime.sensorCommandPending = true;
  runtime.sensorCommandFeedback = null;
  renderSensorDiagnostics();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(SENSOR_CALIBRATION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
      cache: "no-store",
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
    runtime.sensorCommandFeedback = {
      label: action === "start" ? "CALIBRATION REQUESTED" : "CALIBRATION CLEARED",
      error: false,
      expiresAt: performance.now() + 3000,
    };
  } catch (error) {
    runtime.sensorCommandFeedback = {
      label: error?.name === "AbortError" ? "SENSOR COMMAND TIMEOUT" : "SENSOR COMMAND FAILED",
      error: true,
      expiresAt: performance.now() + 5000,
    };
    sensorElements.advisoryState.title = error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timeout);
    runtime.sensorCommandPending = false;
    renderSensorDiagnostics();
  }
}

function clearSensorReadout() {
  elements.chatterValue.value = "--";
  elements.chatterValue.dataset.state = "";
  elements.tempLabel.textContent = "TEMP";
  elements.tempValue.value = "--.- C";
}

function updateSensorReadout(sensor, metadata = runtime.sensorMeta) {
  runtime.sensor = sensor;
  runtime.sensorMeta = metadata;
  elements.chatterValue.value = `${Math.round(sensor.score)}%`;
  elements.chatterValue.dataset.state = sensor.state === "chatter"
    ? "alarm"
    : sensor.state === "warning" ? "active" : "";
  const hasSpindleTemperature = Number.isFinite(sensor.spindleTemperatureC);
  const hasEspTemperature = Number.isFinite(sensor.espTemperatureC);
  const temperatureC = hasSpindleTemperature
    ? sensor.spindleTemperatureC
    : hasEspTemperature ? sensor.espTemperatureC : sensor.sensorTemperatureC;
  elements.tempLabel.textContent = hasSpindleTemperature
    ? "SPINDLE TEMP"
    : hasEspTemperature ? "ESP TEMP" : "TEMP";
  elements.tempValue.value = Number.isFinite(temperatureC)
    ? `${temperatureC.toFixed(1)} C`
    : "--.- C";

  clearTimeout(runtime.sensorWatchdog);
  runtime.sensorWatchdog = setTimeout(() => {
    if (!runtime.live) return;
    runtime.sensor = null;
    runtime.sensorMeta = null;
    clearSensorReadout();
    if (elements.spindlePanel.getAttribute("aria-hidden") === "false") renderSensorDiagnostics();
  }, 2500);
  if (elements.spindlePanel.getAttribute("aria-hidden") === "false") renderSensorDiagnostics();
}

function setDiagnosticNumber(element, value, digits = 0) {
  element.value = Number.isFinite(value) ? Number(value).toFixed(digits) : "--";
  element.dataset.state = "";
}

function setSignalDiagnostic(element, value, trueLabel, falseLabel, falseIsAlarm = false) {
  if (value !== true && value !== false) {
    setIndicator(element, "--");
    return;
  }
  setIndicator(
    element,
    value ? trueLabel : falseLabel,
    value ? "active" : falseIsAlarm ? "alarm" : "",
  );
}

function formatTelemetryAge(value) {
  if (!Number.isFinite(value)) return "--";
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`;
}

function setSpindlePermit(element, reportedPermit, profileApproved, simulated) {
  const permitted = reportedPermit === true && profileApproved === true && !simulated;
  setIndicator(element, permitted ? "PERMITTED" : "LOCKED", permitted ? "active" : "alarm");
}

function renderRigidTappingDemand() {
  const plan = calculateServoAxisTapPlan({
    pitchMm: rigidTappingElements.pitch.value,
    depthMm: rigidTappingElements.depth.value,
    spindleRpm: rigidTappingElements.rpm.value,
  });
  const demandElements = [
    rigidTappingElements.feed,
    rigidTappingElements.utilization,
    rigidTappingElements.aPulse,
    rigidTappingElements.zPulse,
    rigidTappingElements.rotation,
    rigidTappingElements.inverseTime,
    rigidTappingElements.pitchError,
  ];
  if (!plan) {
    for (const element of demandElements) setIndicator(element, "--", "alarm");
    return;
  }

  setIndicator(rigidTappingElements.feed, plan.zFeedMmPerMinute.toFixed(1));
  setIndicator(
    rigidTappingElements.utilization,
    `${(plan.zFeedMmPerMinute / MR1_CONFIG.maxRate.z * 100).toFixed(1)} %`,
    plan.withinZRate ? "" : "alarm",
  );
  setIndicator(rigidTappingElements.aPulse, plan.aPulseRateHz.toFixed(1), plan.withinAPulseRate ? "" : "alarm");
  setIndicator(rigidTappingElements.zPulse, plan.zPulseRateHz.toFixed(1), plan.withinZRate ? "" : "alarm");
  setIndicator(rigidTappingElements.rotation, plan.aDegrees.toFixed(1));
  setIndicator(rigidTappingElements.inverseTime, plan.inverseTimeFeed.toFixed(3));
  setIndicator(rigidTappingElements.pitchError, plan.pitchQuantizationErrorMicrometers.toFixed(3));
  rigidTappingElements.feed.title = "Pitch multiplied by requested spindle RPM; qualification math only";
  rigidTappingElements.utilization.title = `${(MR1_CONFIG.maxRate.z - plan.zFeedMmPerMinute).toFixed(1)} mm/min configured Z-rate headroom`;
  rigidTappingElements.aPulse.title = "Provisional 1000 pulse motor command and 2:1 spindle overdrive";
  rigidTappingElements.rotation.title = `${plan.spindleTurns.toFixed(4)} spindle revolutions down, then the exact inverse up`;
}

function renderRigidTappingDiagnostics() {
  const readiness = evaluateServoAxisTappingReadiness(PENDING_SERVO_AXIS_TAPPING_EVIDENCE, false);
  setIndicator(
    rigidTappingElements.status,
    readiness.ready ? "PROVED / AUTHORIZED" : `SOURCE VALIDATED / HW ${readiness.passed} OF ${readiness.total}`,
    readiness.ready ? "active" : "alarm",
  );
  rigidTappingElements.status.title = "The source path exists; every physical drive, timing, fault, and material gate remains locked";
  setIndicator(rigidTappingElements.controller, "A + Z / G93", "active");
  setIndicator(rigidTappingElements.production, "UNCHANGED / 3 AXIS", "active");
  setIndicator(rigidTappingElements.core, "NOT USED", "active");
  rigidTappingElements.core.title = `Pinned G33.1 remains blocked at ${RIGID_TAPPING_AUDIT.pinnedCoreCommit}; this path uses ${SERVO_AXIS_TAPPING_PROFILE.qualificationFirmwareTarget}`;

  const blockedLabels = {
    octopusBoardAndMcuVerified: "NOT VERIFIED",
    fiveMotionOutputsScopeVerified: "SCOPE HOLD",
    installedServoDriveIdentified: "IDENTITY NEEDED",
    positionModeSupported: "NOT PROVED",
    isolatedInterfaceApproved: "NOT APPROVED",
    azRatioScopeVerified: "SCOPE HOLD",
    bottomReversalScopeVerified: "SCOPE HOLD",
    usbDisconnectSafeStateVerified: "NOT PROVED",
    waxTestPassed: "NOT RUN",
    aluminumTestPassed: "NOT RUN",
  };
  for (const [gate, element] of Object.entries(rigidTappingElements.gates)) {
    const passed = readiness.gates[gate];
    setIndicator(element, passed ? "PROVED" : blockedLabels[gate], passed ? "active" : "alarm");
  }
  setIndicator(
    spindleElements.rigidTappingPermit,
    readiness.ready ? "PERMITTED" : "BLOCKED",
    readiness.ready ? "active" : "alarm",
  );
  renderRigidTappingDemand();
}

function renderSpindleDiagnostics() {
  const packet = runtime.spindle;
  const telemetry = runtime.telemetry;
  const simulated = packet?.bridgeMode === "simulate";

  if (runtime.spindleProtocolError) {
    setIndicator(spindleElements.source, "REPORT REJECTED", "alarm");
  } else if (runtime.spindleStale) {
    setIndicator(spindleElements.source, "SPINDLE STALE", "alarm");
  } else if (packet) {
    setIndicator(spindleElements.source, simulated ? "SIMULATED" : "MR1SP LIVE", simulated ? "" : "active");
  } else if (runtime.live && telemetry) {
    setIndicator(spindleElements.source, "CONTROLLER ONLY");
  } else {
    setIndicator(spindleElements.source, "OFFLINE");
  }

  const commissioning = packet?.commissioning;
  if (simulated) {
    setIndicator(spindleElements.profile, "SIM / UNAPPROVED", "alarm");
    setIndicator(spindleElements.stage, `SIM STAGE ${commissioning?.stage ?? 0}`, "alarm");
  } else if (commissioning?.profileApproved) {
    setIndicator(spindleElements.profile, "APPROVED", "active");
    setIndicator(spindleElements.stage, `STAGE ${commissioning.stage} / 9`, commissioning.stage >= 7 ? "active" : "");
  } else {
    setIndicator(spindleElements.profile, "UNAPPROVED", "alarm");
    setIndicator(spindleElements.stage, `STAGE ${commissioning?.stage ?? 0} / 9`, "alarm");
  }
  spindleElements.profile.title = commissioning?.profileFingerprint ?? "No approved drive-profile fingerprint";

  setIndicator(spindleElements.targetPath, "DIGITAL / RS-485", "alarm");
  spindleElements.targetPath.title = "Selected final path; locked until the installed drive profile and write whitelist are approved";
  setIndicator(spindleElements.productionPath, "ANALOG / FWD");
  spindleElements.productionPath.title = "Current production firmware baseline and retained rollback path";
  const activePath = packet?.controlPath;
  const activePathText = activePath
    ? `${simulated ? "SIM " : ""}${controlPathLabel(activePath)}`
    : packet ? "UNREPORTED" : "--";
  setIndicator(
    spindleElements.activePath,
    activePathText,
    activePath && commissioning?.profileApproved && !simulated ? "active" : activePath ? "alarm" : "",
  );
  setIndicator(spindleElements.commandOwner, "GRBLHAL", "active");
  spindleElements.commandOwner.title = `${SPINDLE_ARCHITECTURE.currentCommandOwner}; target ${SPINDLE_ARCHITECTURE.targetCommandOwner}`;
  setIndicator(spindleElements.safetyAuthority, "HARDWIRED", "active");
  setIndicator(spindleElements.fallback, "RETAINED", "active");

  setSpindlePermit(spindleElements.modbusReadPermit, packet?.permits?.modbusRead, commissioning?.profileApproved, simulated);
  setSpindlePermit(spindleElements.modbusWritePermit, packet?.permits?.modbusWrite, commissioning?.profileApproved, simulated);
  setSpindlePermit(spindleElements.m3Permit, packet?.permits?.m3, commissioning?.profileApproved, simulated);
  setSpindlePermit(spindleElements.m4Permit, packet?.permits?.m4, commissioning?.profileApproved, simulated);
  setSpindlePermit(spindleElements.m5Permit, packet?.permits?.m5, commissioning?.profileApproved, simulated);
  setSpindlePermit(spindleElements.m19Permit, packet?.permits?.m19, commissioning?.profileApproved, simulated);

  const commandRpm = packet?.commandRpm ?? telemetry?.motion?.spindleCommand;
  setDiagnosticNumber(
    spindleElements.commandRpm,
    commandRpm,
  );
  setDiagnosticNumber(spindleElements.motorTargetRpm, nominalMotorTargetRpm(commandRpm));
  spindleElements.motorTargetRpm.title = "Nominal only: spindle RPM divided by the unverified 2.0000:1 overdrive ratio";
  setDiagnosticNumber(spindleElements.controllerRpm, telemetry?.motion?.spindleActual);
  setDiagnosticNumber(spindleElements.motorRpm, packet?.speeds?.motorRpm);
  setDiagnosticNumber(spindleElements.calculatedRpm, packet?.speeds?.calculatedSpindleRpm);
  setDiagnosticNumber(spindleElements.encoderRpm, packet?.speeds?.encoderSpindleRpm);
  setDiagnosticNumber(spindleElements.torque, packet?.load?.torquePercent, 1);
  setDiagnosticNumber(spindleElements.current, packet?.load?.currentA, 1);
  setDiagnosticNumber(spindleElements.peakCurrent, packet?.load?.peakCurrentA, 1);
  setDiagnosticNumber(spindleElements.averageLoad, packet?.load?.averagePercent, 1);
  setDiagnosticNumber(spindleElements.regenerativeLoad, packet?.load?.regenerativePercent, 1);

  const state = packet?.state?.replaceAll("_", " ").toUpperCase();
  setIndicator(
    spindleElements.driveState,
    state ?? "--",
    packet?.state === "fault" ? "alarm" : packet ? "active" : "",
  );
  setIndicator(spindleElements.mode, packet?.mode?.toUpperCase() ?? "--", packet ? "active" : "");
  setSignalDiagnostic(spindleElements.ready, packet?.signals?.ready, "READY", "NOT READY", true);
  setSignalDiagnostic(spindleElements.alarmSignal, packet?.signals?.alarmActive, "ACTIVE", "CLEAR");
  if (packet?.signals?.alarmActive) spindleElements.alarmSignal.dataset.state = "alarm";
  else if (packet) spindleElements.alarmSignal.dataset.state = "active";
  setSignalDiagnostic(spindleElements.servoOn, packet?.signals?.servoOn, "ON", "OFF");
  setSignalDiagnostic(spindleElements.atSpeed, packet?.signals?.atSpeed, "AT SPEED", "NO");
  setSignalDiagnostic(spindleElements.zeroSpeed, packet?.signals?.zeroSpeed, "ZERO", "NO");
  setSignalDiagnostic(spindleElements.inPosition, packet?.signals?.inPosition, "IN POS", "NO");
  setSignalDiagnostic(spindleElements.modeSwitched, packet?.signals?.modeSwitched, "COMPLETE", "NO");

  const ageFields = [
    [spindleElements.modbusAge, packet?.health?.modbusAgeMs, 1000],
    [spindleElements.encoderAge, packet?.health?.encoderAgeMs, 500],
    [spindleElements.indexAge, packet?.health?.spindleIndexAgeMs, 1000],
  ];
  for (const [element, value, staleAfter] of ageFields) {
    setIndicator(element, formatTelemetryAge(value), Number.isFinite(value) && value > staleAfter ? "alarm" : packet ? "active" : "");
  }
  setIndicator(
    spindleElements.ratio,
    Number.isFinite(packet?.health?.ratio) ? `${packet.health.ratio.toFixed(4)} : 1` : "--",
    packet ? "active" : "",
  );
  setIndicator(
    spindleElements.disagreement,
    Number.isFinite(packet?.health?.disagreementPercent)
      ? `${packet.health.disagreementPercent.toFixed(2)} %`
      : "--",
    packet?.health?.disagreementPercent > 2 ? "alarm" : packet ? "active" : "",
  );
  setIndicator(
    spindleElements.errors,
    Number.isFinite(packet?.health?.errorCount) ? String(packet.health.errorCount) : "--",
    packet?.health?.errorCount > 0 ? "alarm" : packet ? "active" : "",
  );

  if (packet?.signals?.alarmActive) {
    setIndicator(
      spindleElements.alarmCode,
      Number.isFinite(packet.alarmCode) ? `CODE ${packet.alarmCode}` : "ACTIVE / CODE --",
      "alarm",
    );
  } else if (packet) {
    setIndicator(spindleElements.alarmCode, "CLEAR", "active");
  } else {
    setIndicator(spindleElements.alarmCode, "--");
  }

  const freezeFrame = spindleFaultRecorder.freezeFrame;
  if (freezeFrame) {
    const captured = new Date(freezeFrame.capturedAt);
    setIndicator(
      spindleElements.freezeFrame,
      `CAPTURED ${captured.toLocaleTimeString([], { hour12: false })}`,
      "active",
    );
    const trigger = freezeFrame.trigger;
    spindleElements.freezeFrame.title = [
      `Alarm ${trigger.alarmCode ?? "--"}`,
      `Line ${trigger.controllerLine ?? "--"}`,
      `Command ${trigger.commandRpm ?? "--"} rpm`,
      `Encoder ${trigger.encoderSpindleRpm ?? "--"} rpm`,
      `Torque ${trigger.torquePercent ?? "--"} %`,
      `Current ${trigger.currentA ?? "--"} A`,
      `Feed ${trigger.feed ?? "--"}`,
      `Chatter ${trigger.chatterScore ?? "--"} %`,
      `${freezeFrame.samples.length} samples`,
    ].join(" / ");
  } else {
    setIndicator(spindleElements.freezeFrame, "NO CAPTURE");
    spindleElements.freezeFrame.title = "";
  }
  renderRigidTappingDiagnostics();
  if (elements.spindlePanel.getAttribute("aria-hidden") === "false") renderSensorDiagnostics();
}

function renderNativeCommandState(state = nativeState) {
  nativeState = state;
  const fresh = state?.connected && state.status && state.preflight?.settings.some(s => s.id === 13 && s.actual === 0 && s.status === 'PASS') && Date.now() - Date.parse(state.status.receivedAt) < 1500;
  if (!fresh) {
    for (const field of [elements.droX, elements.droY, elements.droZ, elements.spindleRpm, elements.feedRate, elements.toolNumber]) field.value = '--';
    for (const field of [elements.probeState, elements.safetyState, elements.driveState]) setIndicator(field, 'UNKNOWN');
    elements.toolDescription.textContent = 'No live controller data';
    setMachineState(state?.connected || state?.linkLost ? 'STATUS LOST' : 'DISCONNECTED', 'hold');
  }
  elements.permitLabel.textContent = state?.armed ? 'NATIVE CONTROL / ARMED' : state?.connected ? 'CONNECTED / DISARMED' : 'MACHINE DISCONNECTED / PROGRAM PREVIEW';
  elements.permitStatus.dataset.mode = state?.armed ? 'live' : 'preview';
  const held = state?.status?.state?.name === 'Hold' && state.status.state.substate === 0;
  elements.cycleStart.disabled = !fresh || !state.armed || (!held && (state.busy || state.job.state !== 'loaded'));
  setCycleButtonLabel(held ? 'RESUME MACHINE' : 'RUN REVIEWED PROGRAM');
  elements.feedHold.disabled = !state?.connected && !state?.linkLost;
  elements.programStop.disabled = !state?.connected && !state?.linkLost;
}

function updateReadout(sample) {
  if (NATIVE_MODE) { renderNativeCommandState(); return; }
  elements.droX.value = sample.position.x.toFixed(3);
  elements.droY.value = sample.position.y.toFixed(3);
  elements.droZ.value = sample.position.z.toFixed(3);

  const spindle = sample.segment.spindle ?? job.spindle ?? 0;
  const tool = sample.segment.tool ?? 1;
  elements.spindleRpm.value = runtime.playing || runtime.elapsed > 0 ? String(Math.round(spindle)) : "0";
  elements.feedRate.value = runtime.playing ? String(Math.round(sample.segment.feed)) : "0";
  elements.toolNumber.value = `T${tool}`;
  elements.toolDescription.textContent = runtime.previewToolDescription;
  const previewCoolantActive = !runtime.stopped
    && runtime.elapsed > 0
    && runtime.elapsed < job.duration;
  viewer?.setCoolant(previewCoolantActive ? sample.segment.coolant : "off");

  clearSensorReadout();
  setIndicator(elements.probeState, "OPEN");
  setIndicator(elements.safetyState, "CLEAR");
  setIndicator(elements.driveState, "CLEAR");
  renderSpindleDiagnostics();

  const lineCount = job.lineCount ?? job.segments.length;
  elements.lineStatus.textContent = `LINE ${sample.segment.sourceLine} / ${lineCount}`;
  elements.timeStatus.textContent = `${formatTime(sample.elapsed)} / ${formatTime(job.duration)}`;
  elements.progress.value = String(Math.round(sample.progress * 1000));
  elements.progressPercent.value = `${Math.round(sample.progress * 100)}%`;
  renderJogPanel(sample.position);
}

function updateLiveReadout(telemetry, { renderSpindle = true } = {}) {
  const previousTool = runtime.renderedTelemetryTool;
  runtime.renderedTelemetry = telemetry;
  updateLivePositionReadout(telemetry);

  const spindle = telemetry.motion.spindleActual ?? telemetry.motion.spindleCommand ?? 0;
  elements.spindleRpm.value = String(Math.round(spindle));
  elements.feedRate.value = String(Math.round(telemetry.motion.feed ?? 0));
  if (Number.isFinite(telemetry.tool)) elements.toolNumber.value = `T${telemetry.tool}`;
  elements.toolDescription.textContent = "LIVE";

  const controls = telemetry.pins.controls;
  if (controls.probeDisconnected) setIndicator(elements.probeState, "DISCONNECTED", "alarm");
  else if (controls.probeTriggered) setIndicator(elements.probeState, "TRIGGERED", "active");
  else setIndicator(elements.probeState, "OPEN");

  if (controls.eStop) setIndicator(elements.safetyState, "E-STOP", "alarm");
  else if (controls.safetyDoor) setIndicator(elements.safetyState, "DOOR", "alarm");
  else if (controls.reset) setIndicator(elements.safetyState, "RESET", "active");
  else setIndicator(elements.safetyState, "CLEAR");

  if (controls.motorFault) setIndicator(elements.driveState, "FAULT", "alarm");
  else if (controls.motorWarning) setIndicator(elements.driveState, "WARNING", "active");
  else setIndicator(elements.driveState, "CLEAR");
  if (renderSpindle && elements.spindlePanel.getAttribute("aria-hidden") === "false") {
    renderSpindleDiagnostics();
  }
  updateProbingSignals(telemetry);
  if (elements.probingPanel.getAttribute("aria-hidden") === "false") {
    renderSetterProfile();
    renderTouchProfile();
  } else if (telemetry.tool !== previousTool) {
    renderSetterProfile();
  }
  if (telemetry.tool !== previousTool && elements.cutterCompPanel.getAttribute("aria-hidden") === "false") {
    renderCutterCompensation();
  }

  elements.lineStatus.textContent = Number.isFinite(telemetry.line)
    ? `CTRL LINE ${telemetry.line}`
    : "CTRL LINE --";
  elements.timeStatus.textContent = `${telemetry.workCoordinateSystem ?? "WCS --"} · ${telemetry.state.raw.toUpperCase()}`;
  elements.progress.value = "0";
  elements.progressPercent.value = "LIVE";
  setMachineStateFromTelemetry(telemetry.state);

  if (telemetry.position.work) {
    viewer?.setToolPosition(
      telemetry.position.work,
      fixtureOffsetForWorkCoordinate(telemetry.workCoordinateSystem),
    );
  }
  viewer?.setCoolant(coolantAccessoryMode(telemetry.accessories));
  const bridgeLabel = runtime.bridge?.mode === "simulate"
    ? "BRIDGE SIM"
    : `${runtime.bridge?.serialPort ?? "CONTROLLER"} LIVE`;
  setTelemetryLink(bridgeLabel, "live", true, liveTelemetryTooltip());
  if (elements.jogPanel.getAttribute("aria-hidden") === "false") renderJogPanel();
  if (elements.fixtureMapPanel.getAttribute("aria-hidden") === "false") renderFixtureMap();
  if (elements.metrologyPanel.getAttribute("aria-hidden") === "false") renderMetrology();

  runtime.renderedTelemetryTool = telemetry.tool;
}

function updateLivePositionReadout(telemetry) {
  const position = runtime.coordinateMode === "work"
    ? telemetry.position.work
    : telemetry.position.machine;
  for (const [axis, element] of [["x", elements.droX], ["y", elements.droY], ["z", elements.droZ]]) {
    const value = Number.isFinite(position?.[axis]) ? position[axis].toFixed(3) : "---.---";
    if (element.value !== value) element.value = value;
  }
}

function enterLiveMode(bridge) {
  clearPreviewJog();
  if (runtime.liveRenderFrame !== null) cancelAnimationFrame(runtime.liveRenderFrame);
  runtime.live = true;
  runtime.bridge = bridge;
  runtime.renderedTelemetry = null;
  runtime.telemetryMeta = null;
  runtime.telemetryLinked = false;
  runtime.pendingTelemetry = null;
  runtime.pendingSensor = null;
  runtime.pendingSpindleRender = false;
  runtime.liveRenderFrame = null;
  runtime.liveRenderStats = { packets: 0, frames: 0 };
  runtime.renderedTelemetryTool = null;
  runtime.playing = false;
  runtime.stopped = false;
  runtime.sensor = null;
  runtime.sensorMeta = null;
  sensorSession.clear();
  runtime.spindle = null;
  runtime.spindleProtocolError = false;
  runtime.spindleStale = false;
  runtime.continuousJogReleasePending = false;
  runtime.commandPending = false;
  runtime.commandFeedback = null;
  runtime.transaction = null;
  clearTimeout(runtime.sensorWatchdog);
  clearTimeout(runtime.spindleWatchdog);
  clearSensorReadout();
  renderSensorDiagnostics();
  renderSpindleDiagnostics();
  elements.coordinateMode.disabled = false;
  setPreviewControlsLocked(true);
  renderCommandPermit();
  setCycleButtonLabel("LIVE TELEMETRY");
  setMachineState("WAITING", "hold");
  const label = bridge.mode === "simulate" ? "BRIDGE SIM" : `${bridge.serialPort ?? "CONTROLLER"} LIVE`;
  setTelemetryLink(label, "live", true, "Disconnect telemetry");
  renderJogPanel();
  if (elements.fixtureMapPanel.getAttribute("aria-hidden") === "false") renderFixtureMap();
  if (elements.metrologyPanel.getAttribute("aria-hidden") === "false") renderMetrology();
  syncControllerSettingsFromBridge();
}

function leaveLiveMode({ offline = false } = {}) {
  const wasLive = runtime.live;
  if (runtime.liveRenderFrame !== null) cancelAnimationFrame(runtime.liveRenderFrame);
  runtime.live = false;
  runtime.bridge = null;
  runtime.telemetry = null;
  runtime.renderedTelemetry = null;
  runtime.telemetryMeta = null;
  runtime.telemetryLinked = false;
  runtime.pendingTelemetry = null;
  runtime.pendingSensor = null;
  runtime.pendingSpindleRender = false;
  runtime.liveRenderFrame = null;
  runtime.liveRenderStats = { packets: 0, frames: 0 };
  runtime.renderedTelemetryTool = null;
  runtime.sensor = null;
  runtime.sensorMeta = null;
  runtime.spindle = null;
  runtime.spindleProtocolError = false;
  runtime.spindleStale = false;
  runtime.continuousJogReleasePending = false;
  runtime.commandPending = false;
  runtime.commandFeedback = null;
  runtime.transaction = null;
  clearTimeout(runtime.telemetryWatchdog);
  clearTimeout(runtime.sensorWatchdog);
  clearTimeout(runtime.spindleWatchdog);
  runtime.coordinateMode = "work";
  elements.coordinateMode.textContent = "WPOS";
  elements.coordinateMode.setAttribute("aria-pressed", "true");
  elements.coordinateMode.disabled = true;
  clearSensorReadout();
  renderSensorDiagnostics();
  renderSpindleDiagnostics();
  updateProbingSignals();
  renderSetterProfile();
  setPreviewControlsLocked(false);
  elements.permitStatus.dataset.mode = "preview";
  elements.permitLabel.textContent = "READ-ONLY PREVIEW";
  setTelemetryLink(
    "SIMULATION",
    offline ? "error" : "simulation",
    false,
    offline ? "Telemetry bridge offline; retry" : "Connect telemetry",
  );
  renderJogPanel();
  if (elements.fixtureMapPanel.getAttribute("aria-hidden") === "false") renderFixtureMap();
  if (elements.metrologyPanel.getAttribute("aria-hidden") === "false") renderMetrology();
  if (elements.wiringPanel.getAttribute("aria-hidden") === "false") renderControllerPreflight();
  syncControllerSettingsFromBridge();
  if (wasLive || offline) restartPreview(false);
}

function updateScene() {
  if (runtime.live && runtime.telemetry) {
    updateLiveReadout(runtime.telemetry);
    return runtime.telemetry;
  }
  const sampled = sampleJob(job, runtime.elapsed);
  const sample = runtime.previewJogPosition
    ? { ...sampled, position: runtime.previewJogPosition }
    : sampled;
  if (sample.index !== runtime.lastSegment) {
    viewer?.setProgress(sample.index);
    runtime.lastSegment = sample.index;
  }
  viewer?.setToolSegmentPosition(
    sample.segment,
    sample.localProgress,
    runtime.previewJogPosition,
  );
  updateReadout(sample);
  return sample;
}

function startPreview() {
  if (NATIVE_MODE) return;
  if (runtime.live) return;
  clearPreviewJog();
  if (runtime.elapsed >= job.duration) runtime.elapsed = 0;
  runtime.playing = true;
  runtime.stopped = false;
  runtime.lastFrame = performance.now();
  elements.feedHold.disabled = false;
  setMachineState("RUN", "run");
  setCycleButtonLabel("PREVIEW RUNNING");
}

function holdPreview(options = {}) {
  if (runtime.live) return;
  if (!runtime.playing) return;
  runtime.playing = false;
  elements.feedHold.disabled = true;
  setMachineState("HOLD", "hold");
  setCycleButtonLabel("RESUME PREVIEW");
  if (options?.refreshScene !== false) updateScene();
}

function stopPreview() {
  if (runtime.live) return;
  runtime.playing = false;
  runtime.stopped = true;
  elements.feedHold.disabled = true;
  setMachineState("STOPPED", "stop");
  setCycleButtonLabel("RESTART PREVIEW");
  updateScene();
}

function restartPreview(autoplay = false) {
  if (runtime.live) return;
  clearPreviewJog();
  runtime.elapsed = 0;
  runtime.lastSegment = -1;
  runtime.stopped = false;
  runtime.playing = autoplay;
  runtime.lastFrame = performance.now();
  elements.feedHold.disabled = !autoplay;
  setMachineState(autoplay ? "RUN" : "IDLE", autoplay ? "run" : "idle");
  setCycleButtonLabel(autoplay ? "PREVIEW RUNNING" : "START PREVIEW");
  updateScene();
}

function setViewMode(mode) {
  if (mode !== "machine" && mode !== "path") return;
  runtime.viewMode = mode;
  document.querySelectorAll("[data-mode]").forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  elements.viewLabel.textContent = mode === "machine" ? "MACHINE VIEW" : "TOOLPATH VIEW";
  viewer?.setMode(mode);
}

function addJobWarning(targetJob, warning) {
  targetJob.warnings = [...new Set([...(targetJob.warnings ?? []), warning])];
  return targetJob;
}

async function prepareImportedGcode(source, name, { signal = null, onProgress = null } = {}) {
  const originalJob = await parseGcodeProgramAsync(source, { name }, {
    fixtureMapProfile,
    signal,
    onProgress: (progress) => onProgress?.("parsing", progress),
  });
  throwIfGcodeImportAborted(signal);
  const personalUseFile = hasFusionPersonalNotice(source);
  const profile = evaluateFissionImportProfile(fissionImportProfile);
  const importedProgram = {
    name,
    originalSource: source,
    activeSource: source,
    rapidRestore: "original",
  };

  if (!personalUseFile || !profile.profile.enabled) return { job: originalJob, importedProgram };
  if (!profile.ready) {
    originalJob.optimization = {
      applied: false,
      held: true,
      reason: "safe-z-not-verified",
    };
    return {
      job: addJobWarning(originalJob, "Rapid restore held: verify the work-coordinate safe Z first."),
      importedProgram,
    };
  }

  onProgress?.("optimizing", { phase: "optimizing", fraction: null });
  try {
    const result = await requestFissionOptimization(source, {
      endpoint: FISSION_OPTIMIZE_ENDPOINT,
      name,
      profile: profile.profile,
      rapidSpeed: Math.min(MR1_CONFIG.maxRate.x, MR1_CONFIG.maxRate.y),
      rapidSpeedZ: MR1_CONFIG.maxRate.z,
      timeoutMs: Math.min(45_000, 8_000 + Math.ceil((new Blob([source]).size / (1024 * 1024)) * 1_500)),
      signal,
    });
    throwIfGcodeImportAborted(signal);
    const restoredCount = Number(result.stats.rapidsRestored ?? 0);
    if (!Number.isInteger(restoredCount) || restoredCount < 0) {
      throw new Error("Processor returned an invalid restored-move count.");
    }
    if (restoredCount === 0) {
      originalJob.optimization = {
        applied: false,
        held: false,
        checked: true,
        reason: "no-eligible-moves",
      };
      return { job: originalJob, importedProgram };
    }

    const optimizedJob = await parseGcodeProgramAsync(
      result.content,
      { name },
      {
        fixtureMapProfile,
        signal,
        onProgress: (progress) => onProgress?.("verifying", progress),
      },
    );
    throwIfGcodeImportAborted(signal);
    const verification = verifyFissionPreview(originalJob, optimizedJob, result.stats, {
      safeZ: profile.profile.safeZ,
    });
    if (!verification.valid) {
      throw new Error(`Independent motion check failed: ${verification.errors.join(" ")}`);
    }

    optimizedJob.optimization = {
      applied: true,
      verified: true,
      sourcePreserved: true,
      convertedSegments: verification.convertedSegments,
      retractSegments: verification.retractSegments,
      clearanceSegments: verification.clearanceSegments,
      safeZ: verification.safeZ,
      sourceSha256: result.sourceSha256,
      outputSha256: result.outputSha256,
    };
    return {
      job: optimizedJob,
      importedProgram: {
        name,
        originalSource: source,
        activeSource: result.content,
        rapidRestore: "verified",
        ...optimizedJob.optimization,
      },
    };
  } catch (error) {
    if (isGcodeImportAbort(error, signal)) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    originalJob.optimization = {
      applied: false,
      held: true,
      reason,
    };
    importedProgram.rapidRestore = "rejected";
    importedProgram.reason = reason;
    return {
      job: addJobWarning(originalJob, `Rapid restore rejected; untouched original loaded. ${reason}`),
      importedProgram,
    };
  }
}

async function applyJob(nextJob, { signal = null, onProgress = null } = {}) {
  const built = await viewer?.setJob(nextJob, { signal, onProgress });
  if (built === false) return false;

  job = nextJob;
  elements.jobName.textContent = job.name.toUpperCase();
  elements.jobName.title = job.name;
  runtime.previewToolDescription = "PROGRAM";
  elements.toolDescription.textContent = runtime.previewToolDescription;

  const statusParts = [`${job.segments.length.toLocaleString()} MOVES`];
  if (job.stats?.arcs) statusParts.push(`${job.stats.arcs.toLocaleString()} ARCS`);
  if (job.optimization?.applied) {
    statusParts.push(`${job.optimization.convertedSegments.toLocaleString()} RAPIDS VERIFIED`);
  } else if (job.optimization?.held) statusParts.push("RAPIDS HELD");
  if (job.warnings?.length) statusParts.push(`${job.warnings.length} WARN`);
  elements.followTool.setAttribute("aria-pressed", "false");
  viewer?.setFollowTool(false);
  setJobStatus(
    statusParts.join(" · "),
    job.warnings?.length ? "warning" : "",
    job.warnings?.join("\n") ?? "",
  );
  setViewMode("path");
  if (runtime.live && runtime.telemetry) updateLiveReadout(runtime.telemetry);
  else restartPreview(false);
  if (elements.cutterCompPanel.getAttribute("aria-hidden") === "false") renderCutterCompensation();
  viewer?.fitView();
  return true;
}

function updateGcodePreparationProgress(loadId, stage, progress, name) {
  if (runtime.gcodeLoad?.id !== loadId) return;
  const fraction = Number(progress?.fraction);
  if (stage === "optimizing") {
    setJobStatus("CHECKING SAFE RAPIDS", "", name);
    setGcodeLoadProgress(null);
    return;
  }
  const verifying = stage === "verifying";
  setJobStatus(verifying ? "VERIFYING RAPID RESTORE" : "PARSING + MAPPING", "", name);
  if (!Number.isFinite(fraction)) {
    setGcodeLoadProgress(null);
    return;
  }
  const start = verifying ? 0.56 : 0.18;
  const span = verifying ? 0.19 : 0.40;
  setGcodeLoadProgress(start + span * fraction);
}

function cancelGcodeImport() {
  const active = runtime.gcodeLoad;
  if (!active || active.controller.signal.aborted) return;
  elements.cancelGcodeLoad.disabled = true;
  setJobStatus("CANCELLING IMPORT", "warning", `${active.name}\nThe previous preview will be retained.`);
  setGcodeLoadProgress(null);
  active.controller.abort(createGcodeImportAbortError());
}

async function loadGcodeFile(file) {
  if (!file) return;
  if (!GCODE_EXTENSION.test(file.name)) {
    setJobStatus("UNSUPPORTED FILE", "error", "Choose an NC, NGC, GCODE, TAP, CNC, or TXT file.");
    return;
  }
  if (file.size > MAX_GCODE_BYTES) {
    setJobStatus("FILE OVER 25 MB", "error", "The local preview limit is 25 MB per file.");
    return;
  }

  if (runtime.gcodeLoad) return;
  const loadId = ++runtime.gcodeLoadSequence;
  const controller = new AbortController();
  runtime.gcodeLoad = { id: loadId, name: file.name, controller };
  setGcodeLoadUi(true);
  setJobStatus("READING FILE", "", file.name);
  setGcodeLoadProgress(0);
  const loadStartedAt = performance.now();
  try {
    const source = await readGcodeFileText(file, {
      signal: controller.signal,
      onProgress: (fraction) => {
        if (runtime.gcodeLoad?.id === loadId) setGcodeLoadProgress(0.18 * fraction);
      },
    });
    throwIfGcodeImportAborted(controller.signal);
    const readFinishedAt = performance.now();
    setJobStatus("PARSING + MAPPING", "", file.name);
    setGcodeLoadProgress(null);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const prepared = await prepareImportedGcode(source, file.name, {
      signal: controller.signal,
      onProgress: (stage, progress) => updateGcodePreparationProgress(loadId, stage, progress, file.name),
    });
    throwIfGcodeImportAborted(controller.signal);
    const parseFinishedAt = performance.now();
    setJobStatus("BUILDING PREVIEW", "", file.name);
    setGcodeLoadProgress(0.76);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const applied = await applyJob(prepared.job, {
      signal: controller.signal,
      onProgress: ({ fraction }) => {
        if (runtime.gcodeLoad?.id === loadId && Number.isFinite(fraction)) {
          setGcodeLoadProgress(0.76 + 0.24 * fraction);
        }
      },
    });
    if (!applied) throw createGcodeImportAbortError("G-code import was superseded.");
    runtime.importedProgram = prepared.importedProgram;
    const buildFinishedAt = performance.now();
    const roundMs = (value) => Math.round(value * 1000) / 1000;
    const workerRoundTripMs = parseFinishedAt - readFinishedAt;
    const workerParseMs = Number(prepared.job.workerTiming?.parseMs);
    const workerMapMs = Number(prepared.job.workerTiming?.fixtureMapMs);
    runtime.lastGcodeLoad = {
      fileName: file.name,
      sourceBytes: file.size,
      readMs: roundMs(readFinishedAt - loadStartedAt),
      workerRoundTripMs: roundMs(workerRoundTripMs),
      parseMs: roundMs(Number.isFinite(workerParseMs) ? workerParseMs : workerRoundTripMs),
      fixtureMapMs: roundMs(Number.isFinite(workerMapMs) ? workerMapMs : 0),
      previewBuildMs: roundMs(buildFinishedAt - parseFinishedAt),
      totalMs: roundMs(buildFinishedAt - loadStartedAt),
    };
    elements.viewer.dataset.gcodeLoadMs = String(runtime.lastGcodeLoad.totalMs);
    elements.viewer.dataset.gcodeParseMs = String(runtime.lastGcodeLoad.parseMs);
    elements.viewer.dataset.gcodeMapMs = String(runtime.lastGcodeLoad.fixtureMapMs);
    elements.viewer.dataset.gcodeBuildMs = String(runtime.lastGcodeLoad.previewBuildMs);
    elements.viewer.dataset.gcodeWorkerRoundTripMs = String(runtime.lastGcodeLoad.workerRoundTripMs);
    const timingDetails = [
      `Total ${runtime.lastGcodeLoad.totalMs.toFixed(1)} ms`,
      `Worker round trip ${runtime.lastGcodeLoad.workerRoundTripMs.toFixed(1)} ms`,
      `Read ${runtime.lastGcodeLoad.readMs.toFixed(1)} ms`,
      `Parse ${runtime.lastGcodeLoad.parseMs.toFixed(1)} ms`,
      `Map ${runtime.lastGcodeLoad.fixtureMapMs.toFixed(1)} ms`,
      `Build ${runtime.lastGcodeLoad.previewBuildMs.toFixed(1)} ms`,
    ].join(" · ");
    elements.jobStatus.title = elements.jobStatus.title
      ? `${elements.jobStatus.title}\n${timingDetails}`
      : timingDetails;
  } catch (error) {
    const retained = `Previous preview retained: ${job.name}.`;
    if (isGcodeImportAbort(error, controller.signal)) {
      setJobStatus("IMPORT CANCELLED", "warning", `${file.name}\n${retained}`);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      setJobStatus("LOAD FAILED", "error", `${message}\n${retained}`);
      console.warn("G-code preview rejected", error);
    }
  } finally {
    if (runtime.gcodeLoad?.id === loadId) {
      runtime.gcodeLoad = null;
      setGcodeLoadUi(false);
    }
    elements.gcodeFile.value = "";
  }
}

const telemetryClient = new TelemetryClient({
  url: (() => {
    const endpoint = new URL(pairedServiceEndpoint("/events"));
    endpoint.searchParams.set("ownerId", machineCommandClient.ownerId);
    return endpoint.href;
  })(),
  onState: ({ state, attempt = 0, delayMs = 0 }) => {
    if (state === "connecting") {
      runtime.telemetryLinked = false;
      setTelemetryLink("CONNECTING", "simulation", true, "Cancel telemetry connection");
    } else if (state === "open") {
      runtime.telemetryLinked = false;
      setTelemetryLink("LINKED", "live", true, liveTelemetryTooltip());
      if (!telemetryClient.diagnostics.clockSynchronized) void captureServiceLatency();
      scheduleClockMaintenance();
      void configurationJournalClient.flush();
    } else if (state === "reconnecting") {
      runtime.telemetryLinked = false;
      setTelemetryLink(
        `RETRY ${attempt}`,
        "error",
        true,
        `Telemetry interrupted; retry in ${delayMs} ms. Click to cancel.`,
      );
      if (runtime.live) setMachineState("TELEMETRY LOST", "stop");
    } else if (state === "invalid-data") {
      runtime.telemetryLinked = false;
      setTelemetryLink(
        "DATA RETRY",
        "error",
        true,
        `Invalid telemetry frame rejected; retry in ${delayMs} ms. Click to cancel.`,
      );
      if (runtime.live) setMachineState("DATA RETRY", "stop");
    } else if (state === "offline") {
      leaveLiveMode({ offline: true });
    } else if (state === "closed") {
      stopClockMaintenance();
      leaveLiveMode();
    }
    renderMachineCommandSurfaces();
    requestHealthRender();
  },
  onBridge: (bridge) => {
    if (bridge.connected) {
      if (runtime.live) runtime.bridge = bridge;
      else enterLiveMode(bridge);
      renderMachineCommandSurfaces();
    } else {
      if (runtime.live) leaveLiveMode({ offline: true });
      runtime.bridge = bridge;
      setTelemetryLink(
        "CTRL OFFLINE",
        "error",
        true,
        "Telemetry service is connected and waiting for the controller; click to cancel.",
      );
    }
    if (elements.wiringPanel.getAttribute("aria-hidden") === "false") renderControllerPreflight();
    syncControllerSettingsFromBridge();
    requestHealthRender();
  },
  onTelemetry: (telemetry, metadata) => {
    if (runtime.bridge?.connected === false) return;
    if (!runtime.live) enterLiveMode(runtime.bridge ?? { mode: telemetry.bridgeMode });
    queueLiveTelemetry(telemetry, metadata);
  },
  onSensor: (sensor, metadata) => {
    if (runtime.live) queueLiveSensor(sensor, metadata);
  },
  onSpindle: (spindle) => {
    if (!runtime.live) return;
    spindleFaultRecorder.record(spindle, {
      telemetry: runtime.telemetry,
      sensor: runtime.sensor,
    });
    runtime.spindle = spindle;
    runtime.spindleProtocolError = false;
    runtime.spindleStale = false;
    queueLiveSpindleRender();
    clearTimeout(runtime.spindleWatchdog);
    runtime.spindleWatchdog = setTimeout(() => {
      if (!runtime.live) return;
      runtime.spindle = null;
      runtime.spindleStale = true;
      renderSpindleDiagnostics();
    }, 2000);
  },
  onJournal: (journal) => {
    if (runtime.bridge) runtime.bridge = { ...runtime.bridge, journal };
    if (elements.machineDataPanel.getAttribute("aria-hidden") === "false") renderMachineData();
  },
  onController: (event) => {
    if (!runtime.live) return;
    if (event.type === "probe") recordMetrologyProbeEvent(event);
    if (event.type === "alarm") setMachineState(`ALARM:${event.code}`, "stop");
    if (event.type === "error") setMachineState(`ERROR:${event.code}`, "stop");
    if (event.type === "protocol-error" && event.source === "spindle") {
      runtime.spindle = null;
      runtime.spindleProtocolError = true;
      runtime.spindleStale = false;
      renderSpindleDiagnostics();
    }
  },
  onTransaction: (transaction) => {
    acceptMachineTransaction(transaction);
    renderMachineCommandSurfaces();
  },
});

elements.cycleStart.addEventListener("click", () => {
  if (NATIVE_MODE) { nativeControl?.runOrResume(); return; }
  if (runtime.playing) holdPreview();
  else if (runtime.stopped) restartPreview(true);
  else startPreview();
});

elements.feedHold.addEventListener("click", () => NATIVE_MODE ? nativeControl?.command('hold') : holdPreview());
elements.programStop.addEventListener("click", () => NATIVE_MODE ? nativeControl?.command('stop') : stopPreview());
elements.restart.addEventListener("click", () => restartPreview(false));

elements.progress.addEventListener("input", (event) => {
  if (runtime.live) return;
  clearPreviewJog();
  runtime.elapsed = (Number(event.target.value) / 1000) * job.duration;
  runtime.lastSegment = -1;
  runtime.playing = false;
  runtime.stopped = false;
  elements.feedHold.disabled = true;
  setMachineState(runtime.elapsed > 0 ? "HOLD" : "IDLE", runtime.elapsed > 0 ? "hold" : "idle");
  setCycleButtonLabel(runtime.elapsed > 0 ? "RESUME PREVIEW" : "START PREVIEW");
  updateScene();
});

elements.coordinateMode.addEventListener("click", () => {
  if (!runtime.live) return;
  runtime.coordinateMode = runtime.coordinateMode === "work" ? "machine" : "work";
  elements.coordinateMode.textContent = runtime.coordinateMode === "work" ? "WPOS" : "MPOS";
  elements.coordinateMode.setAttribute("aria-pressed", runtime.coordinateMode === "work" ? "true" : "false");
  if (runtime.telemetry) updateLiveReadout(runtime.telemetry);
});

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => setViewMode(button.dataset.mode));
});

document.querySelectorAll("[data-camera]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.camera === "fit") viewer?.fitView();
    else viewer?.setCamera(button.dataset.camera);
  });
});

elements.followTool.addEventListener("click", () => {
  const enabled = elements.followTool.getAttribute("aria-pressed") !== "true";
  elements.followTool.setAttribute("aria-pressed", enabled ? "true" : "false");
  viewer?.setFollowTool(enabled);
});

elements.openHealth.addEventListener("click", () => {
  setHealthPanel(elements.healthPanel.getAttribute("aria-hidden") === "true");
});
elements.closeHealth.addEventListener("click", () => setHealthPanel(false));
elements.healthScrim.addEventListener("click", () => setHealthPanel(false));
healthElements.runCheck.addEventListener("click", () => void runPassiveHealthCheck());
healthElements.exportEvidence.addEventListener("click", exportHealthEvidence);
healthElements.reset.addEventListener("click", resetHealthHistory);
elements.openCommissioning.addEventListener("click", () => {
  setCommissioningPanel(elements.commissioningPanel.getAttribute("aria-hidden") === "true");
});
elements.closeCommissioning.addEventListener("click", () => setCommissioningPanel(false));
elements.commissioningScrim.addEventListener("click", () => setCommissioningPanel(false));
commissioningElements.chooseArtifact.addEventListener("click", () => commissioningElements.artifactFile.click());
commissioningElements.artifactFile.addEventListener("change", () => {
  void hashCommissioningArtifact(commissioningElements.artifactFile.files?.[0] ?? null);
});
commissioningElements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  recordCommissioningEvidence();
});
commissioningElements.remove.addEventListener("click", deleteSelectedCommissioningEvidence);
commissioningElements.export.addEventListener("click", () => void exportCommissioningRecord());
commissioningElements.chooseImport.addEventListener("click", () => commissioningElements.importFile.click());
commissioningElements.importFile.addEventListener("change", () => {
  void loadCommissioningRecordFile(commissioningElements.importFile.files?.[0] ?? null);
});
commissioningElements.importConfirm.addEventListener("change", () => renderCommissioningPanel());
commissioningElements.import.addEventListener("click", importCommissioningRecord);
commissioningElements.resetConfirm.addEventListener("change", () => renderCommissioningPanel());
commissioningElements.reset.addEventListener("click", resetCommissioningRecord);

document.addEventListener("click", (event) => {
  const opener = event.target.closest?.('button[id^="open-"]');
  if (
    opener
    && opener !== elements.openHealth
    && elements.healthPanel.getAttribute("aria-hidden") === "false"
  ) {
    setHealthPanel(false, false);
  }
  if (
    opener
    && opener !== elements.openCommissioning
    && elements.commissioningPanel.getAttribute("aria-hidden") === "false"
  ) {
    setCommissioningPanel(false, false);
  }
}, true);

elements.telemetryConnect.addEventListener("click", async () => {
  if (!telemetryClient.active) {
    void captureServiceLatency();
    telemetryClient.connect();
    return;
  }
  if (!await cancelOwnedMachineTransaction("CANCELLING BEFORE DISCONNECT")) return;
  telemetryClient.disconnect();
});

elements.openMachineData.addEventListener("click", () => {
  setMachineDataPanel(elements.machineDataPanel.getAttribute("aria-hidden") === "true");
});
elements.closeMachineData.addEventListener("click", () => setMachineDataPanel(false));
elements.machineDataScrim.addEventListener("click", () => setMachineDataPanel(false));
machineDataElements.saveIdentity.addEventListener("click", () => {
  const controller = currentControllerBinding();
  try {
    machineIdentity = saveMachineIdentity({
      ...machineIdentity,
      label: machineDataElements.name.value,
      controllerFingerprint: controller.simulated
        ? machineIdentity.controllerFingerprint
        : controller.commissioningBaselineFingerprint ?? controller.configurationFingerprint ?? controller.transcriptSha256 ?? machineIdentity.controllerFingerprint,
      controllerProfile: controller.simulated
        ? machineIdentity.controllerProfile
        : controller.profile ?? machineIdentity.controllerProfile,
    }, configurationStorage);
    setMachineBundleMessage(
      controller.transcriptSha256 && !controller.simulated
        ? "IDENTITY + CONTROLLER FINGERPRINT SAVED"
        : "MACHINE IDENTITY SAVED",
      "active",
    );
  } catch (error) {
    setMachineBundleMessage(error instanceof Error ? error.message : "IDENTITY STORAGE FAILED", "alarm");
  }
});
machineDataElements.exportBundle.addEventListener("click", () => void exportMachineData());
machineDataElements.downloadJournal.addEventListener("click", (event) => void downloadEventJournal(event));
machineDataElements.reconciliationConfirm.addEventListener("change", renderMachineData);
machineDataElements.acknowledgeReconciliation.addEventListener("click", () => void acknowledgeRestartReconciliation());
machineDataElements.chooseBundle.addEventListener("click", () => machineDataElements.file.click());
machineDataElements.file.addEventListener("change", () => {
  void loadMachineBundleFile(machineDataElements.file.files?.[0]);
});
machineDataElements.confirm.addEventListener("change", renderMachineData);
machineDataElements.adoptIdentity.addEventListener("change", renderMachineData);
machineDataElements.applyBundle.addEventListener("click", importMachineData);

elements.openJog.addEventListener("click", () => {
  setJogPanel(elements.jogPanel.getAttribute("aria-hidden") === "true");
});
elements.closeJog.addEventListener("click", () => setJogPanel(false));
elements.jogScrim.addEventListener("click", () => setJogPanel(false));

document.querySelectorAll("[data-jog-coordinate]").forEach((button) => {
  button.addEventListener("click", () => {
    runtime.jogCoordinateMode = button.dataset.jogCoordinate;
    renderJogPanel();
  });
});

document.querySelectorAll("[data-jog-step]").forEach((button) => {
  button.addEventListener("click", () => {
    stopContinuousPreviewJog();
    runtime.jogStep = button.dataset.jogStep === "continuous"
      ? "continuous"
      : Number(button.dataset.jogStep);
    renderJogPanel();
  });
});

document.querySelectorAll("[data-jog-speed]").forEach((button) => {
  button.addEventListener("click", () => {
    runtime.jogSpeed = button.dataset.jogSpeed === "rapid"
      ? "rapid"
      : Number(button.dataset.jogSpeed);
    renderJogPanel();
  });
});

jogElements.directionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (runtime.jogStep === "continuous") return;
    const axis = button.dataset.jogAxis;
    const direction = Number(button.dataset.jogDirection);
    if (runtime.live) void submitMachineIntent(jogIntent(axis, direction), `${axis.toUpperCase()} JOG`);
    else applyPreviewJog(axis, direction);
  });
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || runtime.jogStep !== "continuous") return;
    event.preventDefault();
    startContinuousPreviewJog(button);
  });
  button.addEventListener("pointerup", stopContinuousPreviewJog);
  button.addEventListener("pointercancel", stopContinuousPreviewJog);
  button.addEventListener("pointerleave", stopContinuousPreviewJog);
  button.addEventListener("keydown", (event) => {
    if (runtime.jogStep !== "continuous" || event.repeat || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    startContinuousPreviewJog(button);
  });
  button.addEventListener("keyup", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    stopContinuousPreviewJog();
  });
});

window.addEventListener("pointerup", stopContinuousPreviewJog);
window.addEventListener("blur", stopContinuousPreviewJog);

elements.openSceneRegistration.addEventListener("click", () => {
  setSceneRegistrationPanel(elements.sceneRegistrationPanel.getAttribute("aria-hidden") === "true");
});
elements.closeSceneRegistration.addEventListener("click", () => setSceneRegistrationPanel(false));
elements.sceneRegistrationScrim.addEventListener("click", () => setSceneRegistrationPanel(false));
sceneRegistrationElements.form.addEventListener("input", () => renderSceneRegistration());
sceneRegistrationElements.form.addEventListener("change", () => renderSceneRegistration());
sceneRegistrationElements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  collectSceneRegistrationProfile();
  if (sceneRegistrationIssue) {
    renderSceneRegistration();
    return;
  }
  try {
    sceneRegistrationProfile = saveSceneRegistrationProfile(sceneRegistrationProfile, configurationStorage, fixtureMapProfile);
    populateSceneRegistrationForm(sceneRegistrationProfile);
    renderSceneRegistration("REGISTRATION PROFILE SAVED / MOTION LOCKED");
  } catch {
    renderSceneRegistration("REGISTRATION PROFILE STORAGE FAILED");
  }
});
sceneRegistrationElements.connectCamera.addEventListener("click", () => void toggleSceneCamera());
sceneRegistrationElements.captureFrame.addEventListener("click", () => void captureSceneFrame());
sceneRegistrationElements.openFrame.addEventListener("click", () => sceneRegistrationElements.frameFile.click());
sceneRegistrationElements.importDetections.addEventListener("click", () => sceneRegistrationElements.detectionFile.click());
sceneRegistrationElements.frameFile.addEventListener("change", () => void loadSceneFrameFile(sceneRegistrationElements.frameFile.files?.[0]));
sceneRegistrationElements.detectionFile.addEventListener("change", () => void loadSceneDetectionFile(sceneRegistrationElements.detectionFile.files?.[0]));
sceneRegistrationElements.bindFrame.addEventListener("click", () => {
  if (!sceneActiveFrame) return;
  const profile = collectSceneRegistrationProfile();
  const evidenceCount = profile.references.length + profile.hypotheses.length;
  if (evidenceCount && !window.confirm("Bind this frame and clear references and feature hypotheses from the previous frame?")) return;
  sceneRegistrationProfile = bindSceneRegistrationFrame(profile, sceneActiveFrame, fixtureMapProfile);
  scenePickedPixel = null;
  populateSceneRegistrationForm(sceneRegistrationProfile);
  renderSceneRegistration("CURRENT FRAME BOUND / PREVIOUS FRAME EVIDENCE CLEARED");
});
sceneRegistrationElements.addReference.addEventListener("click", () => {
  try {
    sceneRegistrationProfile = addSceneReference(collectSceneRegistrationProfile(), {
      id: `ref-${Date.now()}`,
      address: sceneRegistrationElements.referenceAddress.value,
      pixel: {
        x: inputNumber(sceneRegistrationElements.referenceX),
        y: inputNumber(sceneRegistrationElements.referenceY),
      },
      source: "manual",
    }, fixtureMapProfile);
    sceneRegistrationElements.referenceAddress.value = "";
    sceneRegistrationIssue = "";
    renderSceneRegistration("FIXTURE REFERENCE ADDED / FIT UPDATED");
  } catch (error) {
    sceneRegistrationIssue = error instanceof Error ? error.message : "FIXTURE REFERENCE FAILED";
    renderSceneRegistration();
  }
});
sceneRegistrationElements.referenceList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-scene-reference-remove]");
  if (!button) return;
  sceneRegistrationProfile = removeSceneReference(
    collectSceneRegistrationProfile(),
    button.dataset.sceneReferenceRemove,
    fixtureMapProfile,
  );
  renderSceneRegistration("FIXTURE REFERENCE REMOVED / FIT UPDATED");
});
sceneRegistrationElements.clearReferences.addEventListener("click", () => {
  sceneRegistrationProfile = clearSceneReferences(collectSceneRegistrationProfile(), fixtureMapProfile);
  scenePickedPixel = null;
  renderSceneRegistration("FIXTURE REFERENCES CLEARED");
});
sceneRegistrationElements.addFeature.addEventListener("click", () => {
  try {
    sceneRegistrationProfile = addSceneHypothesis(collectSceneRegistrationProfile(), {
      id: `feature-${Date.now()}`,
      type: sceneRegistrationElements.featureType.value,
      pixel: {
        x: inputNumber(sceneRegistrationElements.featureX),
        y: inputNumber(sceneRegistrationElements.featureY),
      },
      estimatedSizeMm: optionalInputNumber(sceneRegistrationElements.featureSize),
      source: "manual",
    }, fixtureMapProfile);
    sceneRegistrationIssue = "";
    renderSceneRegistration("FEATURE HYPOTHESIS ADDED / PROBE PLAN UPDATED");
  } catch (error) {
    sceneRegistrationIssue = error instanceof Error ? error.message : "FEATURE HYPOTHESIS FAILED";
    renderSceneRegistration();
  }
});
sceneRegistrationElements.featureList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-scene-feature-remove]");
  if (!button) return;
  sceneRegistrationProfile = removeSceneHypothesis(
    collectSceneRegistrationProfile(),
    button.dataset.sceneFeatureRemove,
    fixtureMapProfile,
  );
  renderSceneRegistration("FEATURE HYPOTHESIS REMOVED / PROBE PLAN UPDATED");
});
sceneRegistrationElements.canvas.addEventListener("pointerdown", (event) => {
  const bounds = sceneRegistrationElements.canvas.getBoundingClientRect();
  const profile = collectSceneRegistrationProfile();
  scenePickedPixel = {
    x: Math.max(0, Math.min(profile.camera.width, (event.clientX - bounds.left) / bounds.width * profile.camera.width)),
    y: Math.max(0, Math.min(profile.camera.height, (event.clientY - bounds.top) / bounds.height * profile.camera.height)),
  };
  sceneRegistrationElements.referenceX.value = scenePickedPixel.x.toFixed(2);
  sceneRegistrationElements.referenceY.value = scenePickedPixel.y.toFixed(2);
  sceneRegistrationElements.featureX.value = scenePickedPixel.x.toFixed(2);
  sceneRegistrationElements.featureY.value = scenePickedPixel.y.toFixed(2);
  renderSceneRegistration("IMAGE POINT SELECTED");
});

elements.openFixtureMap.addEventListener("click", () => {
  setFixtureMapPanel(elements.fixtureMapPanel.getAttribute("aria-hidden") === "true");
});
elements.closeFixtureMap.addEventListener("click", () => setFixtureMapPanel(false));
elements.fixtureMapScrim.addEventListener("click", () => setFixtureMapPanel(false));

fixtureMapElements.stationButtons.forEach((button) => {
  button.addEventListener("click", () => selectFixtureMapStation(button.dataset.fixtureId));
});

fixtureMapElements.enabledToggles.forEach((toggle) => {
  toggle.addEventListener("change", () => {
    const fixtureId = toggle.dataset.fixtureEnabled;
    fixtureMapProfile = normalizeFixtureMapProfile({
      ...fixtureMapProfile,
      vises: fixtureMapProfile.vises.map((vise) => (
        vise.id === fixtureId ? { ...vise, enabled: toggle.checked } : vise
      )),
    });
    fixtureMapFormIssue = "";
    renderFixtureMap(`${fixtureId} ${toggle.checked ? "INSTALLED" : "REMOVED"} / DRAFT`);
  });
});

fixtureMapElements.rotationButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (fixtureMapProfile.selectedFixtureId === "PLATE") return;
    setFixtureRotationButtons(Number(button.dataset.fixtureRotation));
    updateFixtureMapDraft();
    renderFixtureMap();
  });
});

fixtureMapElements.jawOpeningRange.addEventListener("input", () => {
  fixtureMapElements.jawOpening.value = fixtureMapElements.jawOpeningRange.value;
  fixtureMapElements.jawOpeningOutput.value = `${Number(fixtureMapElements.jawOpeningRange.value).toFixed(1)} mm`;
});

fixtureMapElements.jawOpening.addEventListener("input", () => {
  if (!fixtureMapElements.jawOpening.checkValidity() || fixtureMapElements.jawOpening.value === "") return;
  fixtureMapElements.jawOpeningRange.value = fixtureMapElements.jawOpening.value;
  fixtureMapElements.jawOpeningOutput.value = `${Number(fixtureMapElements.jawOpening.value).toFixed(1)} mm`;
});

fixtureMapElements.datumReference.addEventListener("change", () => {
  const preset = VISE_DATUM_PRESETS[fixtureMapElements.datumReference.value];
  const custom = !preset;
  fixtureMapElements.datumX.readOnly = !custom;
  fixtureMapElements.datumY.readOnly = !custom;
  fixtureMapElements.datumX.setAttribute("aria-readonly", custom ? "false" : "true");
  fixtureMapElements.datumY.setAttribute("aria-readonly", custom ? "false" : "true");
  if (preset) {
    setNumberInput(fixtureMapElements.datumX, preset.x);
    setNumberInput(fixtureMapElements.datumY, preset.y);
  }
  updateFixtureMapDraft();
  renderFixtureMap();
});

fixtureMapElements.calibrationUseXy.addEventListener("click", () => {
  const machine = runtime.telemetry?.position.machine;
  if (!runtime.live || !Number.isFinite(machine?.x) || !Number.isFinite(machine?.y)) return;
  fixtureMapElements.calibrationX.value = machine.x.toFixed(4);
  fixtureMapElements.calibrationY.value = machine.y.toFixed(4);
  renderTableFrameCalibration("LIVE MPOS XY CAPTURED / VERIFY PROBE CYCLE RESULT");
});

fixtureMapElements.calibrationUseZ.addEventListener("click", () => {
  const machine = runtime.telemetry?.position.machine;
  if (!runtime.live || !Number.isFinite(machine?.z)) return;
  fixtureMapElements.calibrationZ.value = machine.z.toFixed(4);
  renderTableFrameCalibration("LIVE MPOS Z CAPTURED / VERIFY PLATE-TOP CONTACT");
});

fixtureMapElements.calibrationAdd.addEventListener("click", () => {
  try {
    const address = fixtureMapElements.calibrationAddress.value.trim().toUpperCase();
    const cad = addressToCad(address, fixtureMapProfile.grid);
    if (!cad) throw new Error("Select a valid CAD fixture hole.");
    tableFrameCalibration = addTableFrameReference(tableFrameCalibration, {
      id: `plate-ref-${crypto.randomUUID?.() ?? `${Date.now()}-${performance.now().toFixed(3)}`}`,
      address,
      cad,
      machine: {
        x: optionalInputNumber(fixtureMapElements.calibrationX),
        y: optionalInputNumber(fixtureMapElements.calibrationY),
      },
      topZ: optionalInputNumber(fixtureMapElements.calibrationZ),
      source: runtime.live ? "probe" : "manual",
    });
    fixtureMapElements.calibrationAddress.value = "";
    fixtureMapElements.calibrationX.value = "";
    fixtureMapElements.calibrationY.value = "";
    fixtureMapElements.calibrationZ.value = "";
    updateFixtureMapDraft();
    renderFixtureMap();
    renderTableFrameCalibration("REFERENCE ADDED / RIGID FRAME RE-SOLVED");
  } catch (error) {
    renderTableFrameCalibration(error instanceof Error ? error.message : "TABLE REFERENCE FAILED");
  }
});

fixtureMapElements.calibrationReferenceList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-table-calibration-remove]");
  if (!button) return;
  tableFrameCalibration = removeTableFrameReference(tableFrameCalibration, button.dataset.tableCalibrationRemove);
  updateFixtureMapDraft();
  renderFixtureMap();
  renderTableFrameCalibration("REFERENCE REMOVED / CALIBRATION EVIDENCE HELD");
});

fixtureMapElements.calibrationClear.addEventListener("click", () => {
  if (tableFrameCalibration.references.length
    && !window.confirm("Clear all raw table-frame calibration references?")) return;
  tableFrameCalibration = clearTableFrameReferences(tableFrameCalibration);
  updateFixtureMapDraft();
  renderFixtureMap();
  renderTableFrameCalibration("TABLE CALIBRATION REFERENCES CLEARED");
});

fixtureMapElements.calibrationApply.addEventListener("click", () => {
  try {
    const probeEvaluation = evaluateProbeCalibration(probeCalibration);
    tableFrameCalibration = finalizeTableFrameCalibration(tableFrameCalibration, {
      probeQualified: probeEvaluation.qualified,
      probeId: probeEvaluation.profile.probeId,
      machineHomed: fixtureMapElements.calibrationHomed.checked,
    });
    const evaluation = evaluateTableFrameCalibration(tableFrameCalibration);
    if (!evaluation.frame) throw new Error("Solved table frame is unavailable.");
    fixtureMapProfile = normalizeFixtureMapProfile({
      ...fixtureMapProfile,
      plateFrame: evaluation.frame,
      plateCalibration: tableFrameCalibration,
    });
    populateFixtureMapForm(fixtureMapProfile);
    fixtureMapFormIssue = "";
    renderFixtureMap("TABLE FRAME APPLIED / SAVE MAP TO KEEP CALIBRATION");
    renderTableFrameCalibration("PROBE-QUALIFIED TABLE FRAME APPLIED");
  } catch (error) {
    renderTableFrameCalibration(error instanceof Error ? error.message : "TABLE FRAME APPLY FAILED");
  }
});

fixtureMapElements.form.addEventListener("input", () => {
  updateFixtureMapDraft();
  renderFixtureMap();
});
fixtureMapElements.form.addEventListener("change", () => {
  fixtureMapElements.address.value = fixtureMapElements.address.value.trim().toUpperCase();
  updateFixtureMapDraft();
  renderFixtureMap();
});
fixtureMapElements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const evaluation = updateFixtureMapDraft();
  if (fixtureMapFormIssue || !evaluation.valid) {
    renderFixtureMap();
    return;
  }
  try {
    fixtureMapProfile = saveFixtureMapProfile(fixtureMapProfile, configurationStorage);
    populateFixtureMapForm(fixtureMapProfile);
    fixtureMapFormIssue = "";
    if (job.source === "file") void applyJob(applyFixtureMapToJob(job, fixtureMapProfile));
    renderFixtureMap(machineCommandsEnabled() ? "MAP SAVED / APPLY WCS AVAILABLE WHEN GATES PASS" : "MAP SAVED / PHYSICAL COMMANDS LOCKED");
  } catch (error) {
    renderFixtureMap(error instanceof Error ? error.message : "MAP STORAGE FAILED");
  }
});

fixtureMapElements.applyWorkOffset.addEventListener("click", () => {
  const evaluation = updateFixtureMapDraft();
  const intent = fixtureWorkOffsetIntent(evaluation);
  if (!intent) {
    renderFixtureMap("WORK OFFSET REQUIRES A COMPLETE XYZ DATUM");
    return;
  }
  void submitMachineIntent(intent, `${intent.wcs} WORK OFFSET`);
});

fixtureMapElements.canvas.addEventListener("pointerdown", (event) => {
  if (!fixtureMapCanvasGeometry || fixtureMapProfile.selectedFixtureId === "PLATE") return;
  const bounds = fixtureMapElements.canvas.getBoundingClientRect();
  const point = {
    x: (event.clientX - bounds.left - fixtureMapCanvasGeometry.centerX) / fixtureMapCanvasGeometry.scale,
    y: (fixtureMapCanvasGeometry.centerY - (event.clientY - bounds.top)) / fixtureMapCanvasGeometry.scale,
  };
  const address = cadPointToAddress(point, fixtureMapProfile.grid);
  if (address) placeSelectedFixtureAtAddress(address);
});

fixtureMapElements.canvas.addEventListener("keydown", (event) => {
  if (!event.key.startsWith("Arrow") || fixtureMapProfile.selectedFixtureId === "PLATE") return;
  const vise = selectedFixtureVise();
  const parsed = parseHoleAddress(vise?.address);
  if (!parsed) return;
  event.preventDefault();
  const delta = {
    ArrowLeft: { column: -1, row: 0 },
    ArrowRight: { column: 1, row: 0 },
    ArrowDown: { column: 0, row: -1 },
    ArrowUp: { column: 0, row: 1 },
  }[event.key];
  const next = { column: parsed.column, row: parsed.row };
  while (true) {
    next.column += delta.column;
    next.row += delta.row;
    if (
      next.column < 0 || next.column >= fixtureMapProfile.grid.columns
      || next.row < 0 || next.row >= fixtureMapProfile.grid.rows
    ) return;
    const address = `${columnLabel(next.column)}${next.row + 1}`;
    if (!addressToCad(address, fixtureMapProfile.grid)) continue;
    placeSelectedFixtureAtAddress(address);
    return;
  }
});

const fixtureMapResizeObserver = new ResizeObserver(() => {
  if (elements.fixtureMapPanel.getAttribute("aria-hidden") === "false") drawFixtureMap();
});
fixtureMapResizeObserver.observe(fixtureMapElements.canvas);

const sceneRegistrationResizeObserver = new ResizeObserver(() => {
  if (elements.sceneRegistrationPanel.getAttribute("aria-hidden") === "false") renderSceneRegistration();
});
sceneRegistrationResizeObserver.observe(sceneRegistrationElements.canvas);
window.setInterval(() => {
  if (elements.sceneRegistrationPanel.getAttribute("aria-hidden") === "false") renderSceneRegistration();
}, 30000);

elements.openCutterComp.addEventListener("click", () => {
  setCutterCompPanel(elements.cutterCompPanel.getAttribute("aria-hidden") === "true");
});
elements.closeCutterComp.addEventListener("click", () => setCutterCompPanel(false));
elements.cutterCompScrim.addEventListener("click", () => setCutterCompPanel(false));
cutterCompElements.modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setCutterMode(button.dataset.cutterMode);
    renderCutterCompensation();
  });
});
cutterCompElements.featureButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setCutterFeatureType(button.dataset.cutterFeature);
    renderCutterCompensation();
  });
});
cutterCompElements.form.addEventListener("input", () => renderCutterCompensation());
cutterCompElements.form.addEventListener("change", () => renderCutterCompensation());
const loadSelectedCutterTool = (event) => {
  const button = event.target.closest("[data-cutter-load-tool]");
  if (!(button instanceof HTMLButtonElement)) return;
  loadCutterToolIntoForm(Number(button.dataset.cutterLoadTool));
};
cutterCompElements.jobToolList.addEventListener("click", loadSelectedCutterTool);
cutterCompElements.savedToolList.addEventListener("click", loadSelectedCutterTool);
cutterCompElements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const evaluation = renderCutterCompensation();
  if (!evaluation.valid) return;
  try {
    cutterCompProfile = upsertCutterTool(cutterCompProfile, evaluation.tool);
    cutterCompProfile = saveCutterCompensationProfile({
      ...cutterCompProfile,
      maxFeatureErrorMm: inputNumber(cutterCompElements.maxFeatureError),
    }, configurationStorage);
    populateCutterTool(cutterCompProfile.tools[String(cutterCompProfile.activeTool)]);
    renderCutterCompensation("TOOL SAVED / REPOST VALUE READY");
  } catch {
    cutterCompElements.validation.textContent = "TOOL PROFILE STORAGE FAILED";
    cutterCompElements.validation.dataset.state = "alarm";
  }
});
cutterCompElements.delete.addEventListener("click", () => {
  const toolNumber = inputNumber(cutterCompElements.toolNumber);
  try {
    cutterCompProfile = saveCutterCompensationProfile(removeCutterTool(cutterCompProfile, toolNumber), configurationStorage);
    populateCutterTool(cutterCompProfile.tools[String(cutterCompProfile.activeTool)]);
    renderCutterCompensation("TOOL REMOVED");
  } catch {
    cutterCompElements.validation.textContent = "TOOL PROFILE STORAGE FAILED";
    cutterCompElements.validation.dataset.state = "alarm";
  }
});

elements.openMetrology.addEventListener("click", () => {
  setMetrologyPanel(elements.metrologyPanel.getAttribute("aria-hidden") === "true");
});
elements.closeMetrology.addEventListener("click", () => setMetrologyPanel(false));
elements.metrologyScrim.addEventListener("click", () => setMetrologyPanel(false));
metrologyElements.spaceButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setMetrologySpace(button.dataset.metrologySpace);
    saveMetrologyDraft("COORDINATE FRAME SAVED");
  });
});
metrologyElements.pointModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setMetrologyPointMode(button.dataset.metrologyPointMode);
    saveMetrologyDraft("POINT REPRESENTATION SAVED");
  });
});
metrologyElements.form.addEventListener("submit", (event) => event.preventDefault());
metrologyElements.form.addEventListener("input", (event) => {
  if (![metrologyElements.pointX, metrologyElements.pointY, metrologyElements.pointZ].includes(event.target)) {
    renderMetrology();
  }
});
metrologyElements.form.addEventListener("change", (event) => {
  if (![metrologyElements.pointX, metrologyElements.pointY, metrologyElements.pointZ].includes(event.target)) {
    saveMetrologyDraft();
  }
});
metrologyElements.addManual.addEventListener("click", () => {
  const inputs = [metrologyElements.pointX, metrologyElements.pointY, metrologyElements.pointZ];
  const valid = inputs.every((input) => input.value.trim() !== "" && input.checkValidity());
  inputs.forEach((input) => { input.dataset.invalid = valid ? "false" : "true"; });
  if (!valid) {
    metrologyElements.validation.textContent = "MANUAL POINT REQUIRES VALID X, Y, AND Z COORDINATES";
    metrologyElements.validation.dataset.state = "alarm";
    return;
  }
  try {
    const point = createManualMetrologyPoint(
      {
        x: inputNumber(metrologyElements.pointX),
        y: inputNumber(metrologyElements.pointY),
        z: inputNumber(metrologyElements.pointZ),
      },
      selectedMetrologySpace(),
      metrologyContext(),
      {
        id: `manual-${Date.now()}-${metrologySession.points.length + 1}`,
        capturedAt: Date.now(),
        sequence: metrologySession.points.length + 1,
      },
    );
    if (addPointToMetrologySession(point, "MANUAL POINT ADDED / FIT UPDATED")) {
      inputs.forEach((input) => {
        input.value = "";
        input.dataset.invalid = "false";
      });
    }
  } catch (error) {
    metrologyElements.validation.textContent = error instanceof Error ? error.message.toUpperCase() : "MANUAL POINT FAILED";
    metrologyElements.validation.dataset.state = "alarm";
  }
});
metrologyElements.addLastProbe.addEventListener("click", () => {
  if (lastMetrologyProbePoint) addPointToMetrologySession(lastMetrologyProbePoint, "LAST PROBE HIT ADDED / FIT UPDATED");
});
metrologyElements.removeLast.addEventListener("click", () => {
  metrologySession = saveMetrologySession(removeLastMetrologyPoint(collectMetrologySession()), configurationStorage);
  populateMetrologyForm(metrologySession);
  syncMetrologyOverlay();
  renderMetrology("LAST POINT REMOVED");
});
metrologyElements.clear.addEventListener("click", () => {
  metrologySession = saveMetrologySession(clearMetrologyPoints(collectMetrologySession()), configurationStorage);
  lastMetrologyProbePoint = null;
  populateMetrologyForm(metrologySession);
  syncMetrologyOverlay();
  renderMetrology("SESSION POINTS CLEARED");
});
metrologyElements.exportButtons.forEach((button) => {
  button.addEventListener("click", () => downloadMetrologyFile(button.dataset.metrologyExport));
});
metrologyElements.saveCalibration.addEventListener("click", () => {
  try {
    probeCalibration = saveProbeCalibration(collectProbeCalibration(), configurationStorage);
    metrologySession = saveMetrologySession(recompensateMetrologyPoints(
      collectMetrologySession(),
      probeCalibration,
    ), configurationStorage);
    populateProbeCalibrationForm(probeCalibration);
    populateMetrologyForm(metrologySession);
    syncMetrologyOverlay();
    const evaluation = renderProbeCalibration(probeCalibration);
    renderMetrology(evaluation.usable
      ? `CALIBRATION SAVED / ${evaluation.readyDirections.length} DIRECTIONS RECOMPENSATED`
      : "CALIBRATION DRAFT SAVED / CORRECTION HELD");
  } catch {
    metrologyElements.calibrationValidation.textContent = "PROBE CALIBRATION STORAGE FAILED";
    metrologyElements.calibrationValidation.dataset.state = "alarm";
  }
});

elements.openSpindle.addEventListener("click", () => {
  const shouldClose = elements.spindlePanel.getAttribute("aria-hidden") === "false"
    && runtime.spindlePanelTrigger === "spindle";
  setSpindlePanel(!shouldClose, true, "spindle");
  if (!shouldClose) elements.spindlePanel.querySelector(".probing-panel-scroll").scrollTop = 0;
});
elements.openSensor.addEventListener("click", () => {
  const shouldClose = elements.spindlePanel.getAttribute("aria-hidden") === "false"
    && runtime.spindlePanelTrigger === "sensor";
  setSpindlePanel(!shouldClose, true, "sensor");
  if (!shouldClose) {
    requestAnimationFrame(() => {
      sensorElements.section.scrollIntoView({ block: "start" });
      renderSensorDiagnostics();
    });
  }
});
elements.closeSpindle.addEventListener("click", () => setSpindlePanel(false));
elements.spindleScrim.addEventListener("click", () => setSpindlePanel(false));
sensorElements.exportSession.addEventListener("click", downloadSensorSession);
sensorElements.startCalibration.addEventListener("click", () => void requestSensorCalibration("start"));
sensorElements.clearCalibration.addEventListener("click", () => void requestSensorCalibration("clear"));
rigidTappingElements.pitch.addEventListener("input", renderRigidTappingDemand);
rigidTappingElements.depth.addEventListener("input", renderRigidTappingDemand);
rigidTappingElements.rpm.addEventListener("input", renderRigidTappingDemand);

elements.openWiring.addEventListener("click", () => {
  setWiringPanel(elements.wiringPanel.getAttribute("aria-hidden") === "true");
});
elements.closeWiring.addEventListener("click", () => setWiringPanel(false));
elements.wiringScrim.addEventListener("click", () => setWiringPanel(false));
wiringInstallationElements.preflight.download.addEventListener("click", downloadControllerPreflight);
wiringInstallationElements.firmware.choose.addEventListener("click", () => wiringInstallationElements.firmware.file.click());
wiringInstallationElements.firmware.file.addEventListener("change", () => void verifySelectedFirmwareFile());
wiringInstallationElements.firmware.attestations.forEach((input) => {
  input.addEventListener("change", () => {
    firmwareFlashAttestations = {
      ...firmwareFlashAttestations,
      [input.dataset.firmwareAttestation]: input.checked,
    };
    renderFirmwareFlashState();
  });
});
wiringInstallationElements.firmware.downloadRecord.addEventListener("click", () => void downloadFirmwareFlashRecord());
wiringInstallationElements.expandBoardMap.addEventListener("click", () => {
  setBoardMapExpanded(!elements.wiringPanel.classList.contains("board-map-expanded"));
});
document.querySelectorAll("[data-board-wiring]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.boardWiring;
    setWiringTab(target);
    document.querySelector(`[data-wiring-tab="${target}"]`)?.focus();
  });
});
const recordBoardMapState = () => {
  wiringInstallationElements.boardMap.dataset.loadState = wiringInstallationElements.boardMap.naturalWidth >= 1800 ? "ready" : "error";
};
wiringInstallationElements.boardMap.addEventListener("load", recordBoardMapState);
wiringInstallationElements.boardMap.addEventListener("error", recordBoardMapState);
if (wiringInstallationElements.boardMap.complete) recordBoardMapState();
wiringInstallationElements.evidenceList.addEventListener("change", (event) => {
  const input = event.target.closest("[data-wiring-evidence]");
  if (!(input instanceof HTMLInputElement)) return;
  wiringEvidence = saveWiringEvidence({
    ...wiringEvidence,
    checked: {
      ...wiringEvidence.checked,
      [input.dataset.wiringEvidence]: input.checked,
    },
  }, configurationStorage);
  renderWiringEvidenceState();
});
wiringInstallationElements.resetEvidence.addEventListener("click", () => {
  wiringEvidence = saveWiringEvidence({}, configurationStorage);
  renderWiringInstallation();
});
wiringProfileElements.edit.addEventListener("click", () => {
  setWiringProfileEditor(wiringProfileElements.form.hidden);
});
wiringProfileElements.form.addEventListener("input", previewSensorWiringProfile);
wiringProfileElements.form.addEventListener("change", previewSensorWiringProfile);
wiringProfileElements.cancel.addEventListener("click", () => {
  populateSensorWiringForm(sensorWiringProfile);
  renderSensorWiringProfile(sensorWiringProfile);
  setWiringProfileEditor(false);
});
wiringProfileElements.reset.addEventListener("click", () => {
  populateSensorWiringForm(DEFAULT_SENSOR_WIRING_PROFILE);
  previewSensorWiringProfile();
});
wiringProfileElements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const evaluation = previewSensorWiringProfile();
  if (!evaluation.valid) return;
  try {
    sensorWiringProfile = saveSensorWiringProfile(evaluation.profile, configurationStorage);
    populateSensorWiringForm(sensorWiringProfile);
    renderSensorWiringProfile(sensorWiringProfile, { message: "PROFILE SAVED" });
    setWiringProfileEditor(false);
  } catch (error) {
    wiringProfileElements.validation.textContent = error instanceof Error ? error.message.toUpperCase() : "PROFILE STORAGE FAILED";
    wiringProfileElements.validation.dataset.state = "alarm";
  }
});
document.querySelectorAll("[data-wiring-tab]").forEach((button) => {
  button.addEventListener("click", () => setWiringTab(button.dataset.wiringTab));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll("[data-wiring-tab]")];
    const current = tabs.indexOf(button);
    const target = event.key === "Home"
      ? tabs[0]
      : event.key === "End"
        ? tabs.at(-1)
        : tabs[(current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    setWiringTab(target.dataset.wiringTab);
    target.focus();
  });
});

elements.openControllerSettings.addEventListener("click", () => {
  setControllerSettingsPanel(elements.controllerSettingsPanel.getAttribute("aria-hidden") === "true");
});
elements.closeControllerSettings.addEventListener("click", () => setControllerSettingsPanel(false));
elements.controllerSettingsScrim.addEventListener("click", () => setControllerSettingsPanel(false));
controllerSettingsElements.tabs.forEach((button) => {
  button.addEventListener("click", () => setControllerSystemTab(button.dataset.controllerSystemTab));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = controllerSettingsElements.tabs.indexOf(button);
    const target = event.key === "Home"
      ? controllerSettingsElements.tabs[0]
      : event.key === "End"
        ? controllerSettingsElements.tabs.at(-1)
        : controllerSettingsElements.tabs[(current + (event.key === "ArrowRight" ? 1 : -1) + controllerSettingsElements.tabs.length) % controllerSettingsElements.tabs.length];
    setControllerSystemTab(target.dataset.controllerSystemTab);
    target.focus();
  });
});
controllerSettingsElements.search.addEventListener("input", renderControllerSettings);
controllerSettingsElements.category.addEventListener("change", renderControllerSettings);
controllerSettingsElements.state.addEventListener("change", renderControllerSettings);
controllerSettingsElements.refresh.addEventListener("click", () => void fetchControllerSettingsReport());
controllerSettingsElements.discard.addEventListener("click", () => {
  controllerSettingsStaged = {};
  controllerSettingsElements.confirm.checked = false;
  controllerSettingsMessage = "STAGED SETTINGS DISCARDED";
  controllerSettingsMessageState = "";
  renderControllerSettings();
});
controllerSettingsElements.confirm.addEventListener("change", () => {
  controllerSettingsMessage = "";
  controllerSettingsMessageState = "";
  renderControllerSettings();
});
controllerSettingsElements.exportSnapshot.addEventListener("click", () => void exportControllerSettingsSnapshot());
controllerSettingsElements.exportPlan.addEventListener("click", () => void exportControllerSettingsPlan());
controllerSettingsElements.apply.addEventListener("click", () => void applyVirtualControllerSettings());
controllerSettingsElements.openFlashWorkflow.addEventListener("click", () => {
  setControllerSettingsPanel(false, false);
  setWiringPanel(true, false);
  setWiringTab("flash");
  document.querySelector('[data-wiring-tab="flash"]')?.focus();
});

initConversationalCamPanel({
  openButton: document.getElementById("open-conversational"),
  onOpen: () => {
    // Right-side panels are exclusive; close any other open panel through
    // its own close handler so its state bookkeeping still runs.
    for (const other of document.querySelectorAll('aside.open[aria-hidden="false"]')) {
      if (other.id === "conversational-panel") continue;
      other.querySelector('.panel-icon-button[aria-label^="Close"]')?.click();
    }
  },
  loadProgram: (gcode, name) => {
    // loadGcodeFile silently ignores a second import while one is running;
    // surface that to the panel instead of closing as if it loaded.
    if (runtime.gcodeLoad) return false;
    return loadGcodeFile(new File([gcode], name, { type: "text/plain" }));
  },
});
elements.openProbing.addEventListener("click", () => {
  setProbingPanel(elements.probingPanel.getAttribute("aria-hidden") === "true");
});
elements.closeProbing.addEventListener("click", () => setProbingPanel(false));
elements.probingScrim.addEventListener("click", () => setProbingPanel(false));
document.querySelectorAll("[data-probing-tab]").forEach((button) => {
  button.addEventListener("click", () => setProbingTab(button.dataset.probingTab));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll("[data-probing-tab]")];
    const current = tabs.indexOf(button);
    const target = event.key === "Home"
      ? tabs[0]
      : event.key === "End"
        ? tabs.at(-1)
        : tabs[(current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    setProbingTab(target.dataset.probingTab);
    target.focus();
  });
});

elements.setterForm.addEventListener("input", () => renderSetterProfile());
elements.setterForm.addEventListener("change", () => renderSetterProfile());
elements.touchForm.addEventListener("input", () => renderTouchProfile());
elements.touchForm.addEventListener("change", () => renderTouchProfile());
elements.inputCalForm.addEventListener("input", () => validateInputCalibrationForm({ reset: true }));
elements.inputCalForm.addEventListener("change", () => validateInputCalibrationForm({ reset: true }));
elements.previewInputCal.addEventListener("click", renderInputCalibrationPreview);

elements.setterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const { settings, evaluation } = renderSetterProfile();
  if (!evaluation.valid) return;
  try {
    probingProfile = saveProbingProfile({ ...probingProfile, toolSetter: settings }, configurationStorage);
    populateProbingForms(probingProfile);
    renderSetterProfile("PROFILE SAVED");
  } catch {
    elements.setterValidation.textContent = "PROFILE STORAGE FAILED";
    elements.setterValidation.dataset.state = "alarm";
  }
});

elements.runToolSetter.addEventListener("click", () => {
  const { settings, evaluation } = renderSetterProfile();
  if (!evaluation.ready) return;
  void submitMachineIntent(toolSetterIntent(settings, evaluation), `T${settings.currentToolNumber} TOOL SETTER`);
});

elements.touchCaptureXy.addEventListener("click", () => {
  const machine = runtime.telemetry?.position?.machine;
  if (!Number.isFinite(machine?.x) || !Number.isFinite(machine?.y)) return;
  setNumberInput(elements.touchTargetX, machine.x);
  setNumberInput(elements.touchTargetY, machine.y);
  renderTouchProfile("LIVE X/Y CAPTURED");
});

elements.touchCaptureSafeZ.addEventListener("click", () => {
  const z = runtime.telemetry?.position?.machine?.z;
  if (!Number.isFinite(z)) return;
  setNumberInput(elements.touchSafeZ, z);
  renderTouchProfile("LIVE SAFE Z CAPTURED");
});

elements.runTouchProbe.addEventListener("click", () => {
  const { settings, evaluation } = renderTouchProfile();
  if (!evaluation.ready) return;
  const label = settings.cycle.replaceAll("-", " ").toUpperCase();
  void submitMachineIntent(touchProbeIntent(settings, evaluation), label);
});

elements.touchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const { settings, evaluation } = renderTouchProfile();
  if (!evaluation.valid) return;
  try {
    probingProfile = saveProbingProfile({ ...probingProfile, touchProbe: settings }, configurationStorage);
    populateProbingForms(probingProfile);
    renderTouchProfile("PROFILE SAVED");
  } catch {
    elements.touchValidation.textContent = "PROFILE STORAGE FAILED";
    elements.touchValidation.dataset.state = "alarm";
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (elements.commissioningPanel.getAttribute("aria-hidden") === "false") setCommissioningPanel(false);
  else if (elements.healthPanel.getAttribute("aria-hidden") === "false") setHealthPanel(false);
  else if (!fissionElements.panel.hidden) setFissionSettingsPanel(false);
  else if (elements.controllerSettingsPanel.getAttribute("aria-hidden") === "false") setControllerSettingsPanel(false);
  else if (elements.machineDataPanel.getAttribute("aria-hidden") === "false") setMachineDataPanel(false);
  else if (elements.jogPanel.getAttribute("aria-hidden") === "false") setJogPanel(false);
  else if (elements.sceneRegistrationPanel.getAttribute("aria-hidden") === "false") setSceneRegistrationPanel(false);
  else if (elements.fixtureMapPanel.getAttribute("aria-hidden") === "false") setFixtureMapPanel(false);
  else if (elements.cutterCompPanel.getAttribute("aria-hidden") === "false") setCutterCompPanel(false);
  else if (elements.metrologyPanel.getAttribute("aria-hidden") === "false") setMetrologyPanel(false);
  else if (elements.wiringPanel.getAttribute("aria-hidden") === "false") setWiringPanel(false);
  else if (elements.spindlePanel.getAttribute("aria-hidden") === "false") setSpindlePanel(false);
  else if (elements.probingPanel.getAttribute("aria-hidden") === "false") setProbingPanel(false);
});

fissionElements.open.addEventListener("click", () => setFissionSettingsPanel(fissionElements.panel.hidden));
fissionElements.close.addEventListener("click", () => setFissionSettingsPanel(false));
fissionElements.cancel.addEventListener("click", () => {
  populateFissionImportProfile(fissionImportProfile);
  renderFissionImportProfile(fissionImportProfile);
  setFissionSettingsPanel(false);
});
fissionElements.safeZ.addEventListener("input", () => {
  if (Math.abs(Number(fissionElements.safeZ.value) - fissionImportProfile.safeZ) > 1e-9) {
    fissionElements.safeZVerified.checked = false;
  }
  renderFissionImportProfile();
});
fissionElements.form.addEventListener("input", (event) => {
  if (event.target !== fissionElements.safeZ) renderFissionImportProfile();
});
fissionElements.form.addEventListener("change", () => renderFissionImportProfile());
fissionElements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const evaluation = renderFissionImportProfile();
  if (!evaluation.valid) return;
  try {
    fissionImportProfile = saveFissionImportProfile(evaluation.profile, configurationStorage);
    populateFissionImportProfile(fissionImportProfile);
    renderFissionImportProfile(fissionImportProfile, { message: "PROFILE SAVED / RETRACT + CLEARANCE XY ONLY" });
  } catch {
    fissionElements.validation.textContent = "PROFILE STORAGE FAILED";
    fissionElements.validation.dataset.state = "alarm";
  }
});

elements.openGcode.addEventListener("click", () => elements.gcodeFile.click());
elements.gcodeFile.addEventListener("change", () => loadGcodeFile(elements.gcodeFile.files?.[0]));
elements.cancelGcodeLoad.addEventListener("click", cancelGcodeImport);

elements.viewer.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  elements.viewer.classList.add("is-file-dragging");
});

elements.viewer.addEventListener("dragover", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});

elements.viewer.addEventListener("dragleave", (event) => {
  if (event.relatedTarget && elements.viewer.contains(event.relatedTarget)) return;
  elements.viewer.classList.remove("is-file-dragging");
});

elements.viewer.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.viewer.classList.remove("is-file-dragging");
  loadGcodeFile(event.dataTransfer?.files?.[0]);
});

function updateClock() {
  elements.clock.textContent = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

updateClock();
setInterval(updateClock, 1000);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopContinuousPreviewJog();
    stopHealthPingLoop();
    stopClockMaintenance();
    cancelPassiveHealthCheck();
    return;
  }
  if (!document.hidden) {
    requestLiveVisualRender();
    if (elements.spindlePanel.getAttribute("aria-hidden") === "false") renderSensorDiagnostics();
    if (elements.healthPanel.getAttribute("aria-hidden") === "false") scheduleHealthPing(0);
    scheduleClockMaintenance();
  }
});

window.addEventListener("resize", () => {
  if (elements.spindlePanel.getAttribute("aria-hidden") === "false") renderSensorHistory();
  if (elements.healthPanel.getAttribute("aria-hidden") === "false") drawHealthChart();
});

function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden || now - runtime.lastFrame < 50) return;
  const deltaSeconds = Math.min(0.1, (now - runtime.lastFrame) / 1000);
  runtime.lastFrame = now;

  if (!runtime.live && runtime.playing) {
    runtime.elapsed += deltaSeconds * runtime.playbackRate;
    if (runtime.elapsed >= job.duration) {
      runtime.elapsed = job.duration;
      runtime.playing = false;
      elements.feedHold.disabled = true;
      setMachineState("COMPLETE", "idle");
      setCycleButtonLabel("REPLAY PREVIEW");
    }
    updateScene();
  }
}

initializeWiringColorControls();
const pwa = initializePwa({ installButton: elements.installCompanion, enabled: !import.meta.env.DEV });
void pwa.register();
renderWiringInstallation();
populateFissionImportProfile(fissionImportProfile);
renderFissionImportProfile(fissionImportProfile);
void refreshFissionProcessorStatus();
populateSensorWiringForm(sensorWiringProfile);
renderSensorWiringProfile(sensorWiringProfile);
populateProbingForms(probingProfile);
validateInputCalibrationForm();
populateFixtureMapForm(fixtureMapProfile);
populateSceneRegistrationForm(sceneRegistrationProfile);
populateCutterTool(cutterCompProfile.tools[String(cutterCompProfile.activeTool)]);
renderCutterCompensation();
populateMetrologyForm(metrologySession);
populateProbeCalibrationForm(probeCalibration);
renderMetrology();
setWiringTab("start");
setControllerSystemTab("settings");
renderControllerSettings();
renderFixtureMap();
renderSceneRegistration();
updateProbingSignals();
renderSpindleDiagnostics();
renderSensorDiagnostics();
renderJogPanel();
renderMachineData();
setJobStatus(`DEMO · ${job.segments.length.toLocaleString()} MOVES`, "", "Bundled demonstration program");
restartPreview(false);
requestAnimationFrame(frame);
if (COMPANION_MODE) {
  queueMicrotask(async () => {
    await captureServiceLatency();
    telemetryClient.connect();
  });
}

window.addEventListener("beforeunload", () => {
  stopContinuousPreviewJog();
  stopHealthPingLoop();
  stopClockMaintenance();
  cancelPassiveHealthCheck();
  clearTimeout(runtime.healthRenderTimer);
  if (runtime.liveRenderFrame !== null) cancelAnimationFrame(runtime.liveRenderFrame);
  stopSceneCamera();
  sceneFrameBitmap?.close?.();
  fixtureMapResizeObserver.disconnect();
  sceneRegistrationResizeObserver.disconnect();
  telemetryClient.disconnect();
  pwa.dispose();
  viewer?.dispose();
});

nativeControl = mountNativeControlPanel({
  onState: state => { renderNativeCommandState(state); renderMachineCommandSurfaces(); },
  getReviewedSource: () => runtime.gcodeLoad ? null : runtime.importedProgram?.activeSource,
  loadPreview: async (source, name) => {
    if (runtime.gcodeLoad) throw new Error('Wait for the current program import.');
    await loadGcodeFile(new File([source], name, { type: 'text/plain' }));
    if (runtime.importedProgram?.name !== name || runtime.importedProgram?.originalSource !== source) {
      throw new Error('Program preview did not load; hardware program was not changed.');
    }
    return runtime.importedProgram.activeSource;
  },
  connectTelemetry: () => telemetryClient.connect(),
});
