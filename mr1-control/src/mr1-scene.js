import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import {
  coolantAccessoryMode,
  leadScrewRotationRadians,
  machineYToSceneZ,
  MR1_CONFIG,
} from "./machine-config.js";
import { cadFixtureHolePoints } from "./fixture-map-profile.js";

const COLORS = Object.freeze({
  shell: 0x16181b,
  panel: 0x22262a,
  control: 0x343a40,
  controlLight: 0x565e66,
  line: 0xdce1e5,
  paper: 0xffffff,
  action: 0xd71920,
  alarm: 0xff343f,
  steel: 0x929aa3,
});

const INTERACTIVE_FRAME_INTERVAL_MS = 1000 / 30;
const BALANCED_FRAME_INTERVAL_MS = 1000 / 20;
const REDUCED_FRAME_INTERVAL_MS = 1000 / 15;
const MAX_PIXEL_RATIO = 1.5;
const MAX_RENDER_PIXELS = 3_000_000;
const BALANCED_MAX_PIXEL_RATIO = 1;
const BALANCED_MAX_RENDER_PIXELS = 1_600_000;
const REDUCED_MAX_PIXEL_RATIO = 0.75;
const REDUCED_MAX_RENDER_PIXELS = 900_000;
const CONTROL_DAMPING_FRAMES = 10;
const SOFTWARE_RENDERER_PATTERN = /swiftshader|llvmpipe|lavapipe|software rasterizer|microsoft basic render/i;
const INTEGRATED_RENDERER_PATTERN = /intel.*(?:uhd|hd graphics)|radeon graphics|apple m[1-9]/i;

function throwIfBuildAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error && signal.reason.name === "AbortError") throw signal.reason;
  const error = new Error("Toolpath build cancelled.");
  error.name = "AbortError";
  throw error;
}

function reportBuildProgress(callback, fraction) {
  try {
    callback?.({ phase: "building", fraction });
  } catch {
    // Rendering progress is advisory and cannot invalidate scene geometry.
  }
}

function createWordmarkTexture({ vertical = false } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = vertical ? 320 : 1024;
  canvas.height = vertical ? 640 : 256;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#ffffff";
  context.font = vertical ? "900 220px Arial Black, Arial, sans-serif" : "900 184px Arial Black, Arial, sans-serif";
  context.letterSpacing = "0px";
  if (vertical) {
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(-Math.PI / 2);
    context.fillText("MR-1", 0, 2);
  } else {
    context.fillText("MR-1", canvas.width / 2, canvas.height / 2 - 10);
    context.fillStyle = "#d71920";
    context.fillRect(232, 220, 560, 12);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createMarbledResinMaterial() {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x76000f,
    emissive: 0x090001,
    emissiveIntensity: 0.07,
    roughness: 0.2,
    metalness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    ior: 1.5,
  });
  material.name = "MR1_DEEP_RED_MARBLED_GLITTER_RESIN";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying vec3 vResinPosition;\nvoid main() {")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvResinPosition = transformed;");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "varying vec3 vResinPosition;\nvoid main() {")
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec2 resinPlane = vResinPosition.xy;
        float resinWarp = sin(resinPlane.x * 13.0 + sin(resinPlane.y * 19.0) * 1.3)
          + sin(resinPlane.y * 17.0 - sin(resinPlane.x * 11.0) * 1.1);
        float resinWaveA = sin(resinPlane.x * 24.0 + resinPlane.y * 8.0 + resinWarp * 1.7);
        float resinWaveB = sin(resinPlane.y * 31.0 - resinPlane.x * 14.0 + resinWarp * 1.15);
        float resinCloud = 0.5 + 0.5 * sin(resinPlane.x * 7.0 + resinPlane.y * 9.0 + resinWaveB * 1.8);
        float resinVein = smoothstep(0.84, 0.985, abs(resinWaveA * 0.58 + resinWaveB * 0.42));
        vec3 resinDeep = vec3(0.025, 0.0005, 0.003);
        vec3 resinCrimson = vec3(0.26, 0.004, 0.018);
        vec3 resinRuby = vec3(0.5, 0.018, 0.048);
        vec3 resinColor = mix(resinDeep, resinCrimson, 0.18 + resinCloud * 0.5);
        resinColor = mix(resinColor, resinRuby, resinVein * 0.34);
        vec2 resinCell = floor(resinPlane * 840.0);
        float resinNoise = fract(sin(dot(resinCell, vec2(12.9898, 78.233))) * 43758.5453);
        float resinGlitter = smoothstep(0.997, 0.9997, resinNoise);
        resinColor += resinGlitter * vec3(0.36, 0.18, 0.21);
        diffuseColor.rgb = resinColor;`);
  };
  material.customProgramCacheKey = () => "mr1-deep-red-resin-v1";
  material.userData = {
    finish: "deep red marbled resin",
    glitter: "sparse pink-silver metallic",
  };
  return material;
}

function rendererIdentity(renderer) {
  try {
    const context = renderer.getContext();
    const extension = context.getExtension("WEBGL_debug_renderer_info");
    const vendor = extension
      ? context.getParameter(extension.UNMASKED_VENDOR_WEBGL)
      : context.getParameter(context.VENDOR);
    const name = extension
      ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : context.getParameter(context.RENDERER);
    return {
      vendor: String(vendor ?? "unknown"),
      name: String(name ?? "unknown"),
    };
  } catch {
    return { vendor: "unknown", name: "unknown" };
  }
}

function getRenderPixelRatio(width, height, profile) {
  const deviceRatio = Math.min(window.devicePixelRatio || 1, profile.maxPixelRatio);
  const budgetRatio = Math.sqrt(profile.maxRenderPixels / Math.max(1, width * height));
  return Math.max(0.65, Math.min(deviceRatio, budgetRatio));
}

function createMetrologyPointTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, 64, 64);
  context.beginPath();
  context.arc(32, 32, 25, 0, Math.PI * 2);
  context.fillStyle = "#ffffff";
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = "#d71920";
  context.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createCoolantDropTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(24, 22, 2, 32, 32, 29);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.3, "rgba(127,231,255,0.96)");
  gradient.addColorStop(1, "rgba(39,156,203,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function quadraticPoint(start, control, end, progress, target = new THREE.Vector3()) {
  const inverse = 1 - progress;
  return target.set(
    inverse * inverse * start.x + 2 * inverse * progress * control.x + progress * progress * end.x,
    inverse * inverse * start.y + 2 * inverse * progress * control.y + progress * progress * end.y,
    inverse * inverse * start.z + 2 * inverse * progress * control.z + progress * progress * end.z,
  );
}

function createLeadScrew(start, end, { name, leadMm, radius = 4.2, materials }) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const root = new THREE.Group();
  root.name = name;
  root.position.copy(start).add(end).multiplyScalar(0.5);
  root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());

  const spin = new THREE.Group();
  spin.name = `${name}_ROTATING`;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 16, 1, false),
    materials.steel,
  );
  shaft.name = `${name}_SHAFT`;
  spin.add(shaft);

  const turns = Math.max(1, length / leadMm);
  const samples = Math.min(900, Math.max(120, Math.ceil(turns * 6)));
  const helixPositions = new Float32Array((samples + 1) * 3);
  for (let index = 0; index <= samples; index += 1) {
    const progress = index / samples;
    const angle = progress * turns * Math.PI * 2;
    helixPositions.set([
      Math.cos(angle) * (radius + 0.62),
      -length / 2 + progress * length,
      Math.sin(angle) * (radius + 0.62),
    ], index * 3);
  }
  const helixGeometry = new THREE.BufferGeometry();
  helixGeometry.setAttribute("position", new THREE.BufferAttribute(helixPositions, 3));
  const helixMaterial = new THREE.LineBasicMaterial({ color: COLORS.line, transparent: true, opacity: 0.78 });
  const helix = new THREE.Line(helixGeometry, helixMaterial);
  helix.name = `${name}_THREAD`;
  helix.userData.disposeMaterial = true;
  spin.add(helix);

  const collarGeometry = new THREE.CylinderGeometry(radius + 2.4, radius + 2.4, 9, 18);
  for (const y of [-length / 2 + 7, length / 2 - 7]) {
    const collar = new THREE.Mesh(collarGeometry, materials.red);
    collar.position.y = y;
    spin.add(collar);
  }
  root.add(spin);
  root.userData = { leadMm, length };
  return { root, spin, length };
}

function roundedBox(width, height, depth, radius = 3, segments = 3) {
  return new RoundedBoxGeometry(width, height, depth, segments, radius);
}

function addEdges(mesh, color = COLORS.line, opacity = 0.14) {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 32),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
  edges.renderOrder = 2;
  mesh.add(edges);
  return mesh;
}

function setShadow(object, cast = true, receive = true) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = cast;
      child.receiveShadow = receive;
    }
  });
}

export class Mr1Scene {
  constructor(container, options = {}) {
    this.container = container;
    this.mode = "machine";
    this.followTool = false;
    this.activeSegment = 0;
    this.toolPosition = new THREE.Vector3();
    this.lastFollowTarget = new THREE.Vector3();
    this.pathColors = null;
    this.job = null;
    this.container.dataset.cadState = "loading";
    this.container.dataset.machineCadState = "loading";
    this.container.dataset.brandingState = "loading";
    this.container.dataset.resinState = "loading";
    this.container.dataset.leadScrewCount = "0";
    this.container.dataset.coolantMode = "off";

    const requestedQuality = ["full", "balanced", "reduced"].includes(options.renderQuality)
      ? options.renderQuality
      : "auto";
    let renderer = new THREE.WebGLRenderer({ antialias: requestedQuality !== "reduced", powerPreference: "high-performance" });
    let identity = rendererIdentity(renderer);
    const initiallySoftware = SOFTWARE_RENDERER_PATTERN.test(`${identity.vendor} ${identity.name}`);
    if (initiallySoftware && requestedQuality !== "full") {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        powerPreference: "high-performance",
        precision: "mediump",
      });
      identity = rendererIdentity(renderer);
    }
    this.renderer = renderer;
    const softwareRenderer = initiallySoftware
      || SOFTWARE_RENDERER_PATTERN.test(`${identity.vendor} ${identity.name}`);
    const integratedRenderer = INTEGRATED_RENDERER_PATTERN.test(`${identity.vendor} ${identity.name}`);
    const lowCoreCount = Number.isFinite(navigator.hardwareConcurrency)
      && navigator.hardwareConcurrency <= 4;
    const automaticQuality = softwareRenderer
      ? "reduced"
      : lowCoreCount ? "balanced" : "full";
    const quality = requestedQuality === "auto" ? automaticQuality : requestedQuality;
    const frameIntervalMs = quality === "reduced"
      ? REDUCED_FRAME_INTERVAL_MS
      : quality === "balanced" ? BALANCED_FRAME_INTERVAL_MS : INTERACTIVE_FRAME_INTERVAL_MS;
    const maxPixelRatio = quality === "reduced"
      ? REDUCED_MAX_PIXEL_RATIO
      : quality === "balanced" ? BALANCED_MAX_PIXEL_RATIO : MAX_PIXEL_RATIO;
    const maxRenderPixels = quality === "reduced"
      ? REDUCED_MAX_RENDER_PIXELS
      : quality === "balanced" ? BALANCED_MAX_RENDER_PIXELS : MAX_RENDER_PIXELS;
    this.renderProfile = Object.freeze({
      requestedQuality,
      quality,
      softwareRenderer,
      integratedRenderer,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGiB: navigator.deviceMemory ?? null,
      rendererVendor: identity.vendor,
      rendererName: identity.name,
      frameIntervalMs,
      maxPixelRatio,
      maxRenderPixels,
    });
    this.container.dataset.renderQuality = quality;
    this.container.dataset.rendererMode = softwareRenderer ? "software" : "hardware";
    this.container.dataset.renderer = identity.name.slice(0, 180);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.shell);
    this.scene.fog = quality === "reduced" ? null : new THREE.Fog(COLORS.shell, 1800, 4200);

    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 6000);
    this.camera.position.set(1750, 820, 2050);

    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = quality === "reduced" ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = quality === "reduced" ? 1 : 1.08;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.container.prepend(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = 180;
    this.controls.maxDistance = 5000;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, -180, 10);

    this.animate = this.animate.bind(this);
    this.animationFrame = null;
    this.lastRenderAt = 0;
    this.renderCount = 0;
    this.renderRequested = true;
    this.controlsActive = false;
    this.controlDampingFrames = 0;
    this.disposed = false;
    this.handleControlsStart = () => {
      this.controlsActive = true;
      this.requestRender();
    };
    this.handleControlsChange = () => this.requestRender();
    this.handleControlsEnd = () => {
      this.controlsActive = false;
      this.controlDampingFrames = CONTROL_DAMPING_FRAMES;
      this.requestRender();
    };
    this.handleVisibilityChange = () => {
      if (!document.hidden) this.requestRender();
    };
    this.controls.addEventListener("start", this.handleControlsStart);
    this.controls.addEventListener("change", this.handleControlsChange);
    this.controls.addEventListener("end", this.handleControlsEnd);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);

    this.machineRoot = new THREE.Group();
    this.machineRoot.name = "MR1_MACHINE";
    this.scene.add(this.machineRoot);

    this.pathRoot = new THREE.Group();
    this.pathRoot.name = "MR1_TOOLPATH";
    this.scene.add(this.pathRoot);

    this.metrologyRoot = new THREE.Group();
    this.metrologyRoot.name = "MR1_METROLOGY";
    this.scene.add(this.metrologyRoot);
    this.metrologyPointTexture = createMetrologyPointTexture();
    this.container.dataset.metrologyPointCount = "0";
    this.sceneRegistrationRoot = new THREE.Group();
    this.sceneRegistrationRoot.name = "MR1_SCENE_REGISTRATION";
    this.scene.add(this.sceneRegistrationRoot);
    this.container.dataset.sceneRegistrationReferences = "0";
    this.container.dataset.sceneRegistrationState = "hidden";
    this.coolantDropTexture = createCoolantDropTexture();
    this.coolantMode = "off";

    this.buildLights();
    this.buildMachine();
    this.buildPathStage();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.requestRender();
  }

  buildLights() {
    if (this.renderProfile.quality === "reduced") return;
    const hemisphere = new THREE.HemisphereLight(COLORS.paper, COLORS.shell, 1.55);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight(COLORS.paper, 3.1);
    key.position.set(480, 760, 420);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -650;
    key.shadow.camera.right = 650;
    key.shadow.camera.top = 650;
    key.shadow.camera.bottom = -650;
    key.shadow.camera.near = 80;
    key.shadow.camera.far = 1600;
    key.shadow.bias = -0.0002;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(COLORS.action, 0.42);
    rim.position.set(-520, 260, -440);
    this.scene.add(rim);

    const fill = new THREE.DirectionalLight(COLORS.line, 0.9);
    fill.position.set(-280, 340, 480);
    this.scene.add(fill);
  }

  materials() {
    if (this.renderProfile.quality === "reduced") {
      const basic = (color) => new THREE.MeshBasicMaterial({ color });
      return {
        dark: basic(COLORS.panel),
        body: basic(COLORS.control),
        steel: basic(COLORS.steel),
        bright: basic(COLORS.line),
        red: basic(COLORS.action),
        resin: basic(0x76000f),
        black: basic(COLORS.shell),
        stock: basic(0xaeb4ba),
      };
    }
    return {
      dark: new THREE.MeshStandardMaterial({ color: COLORS.panel, roughness: 0.66, metalness: 0.58 }),
      body: new THREE.MeshStandardMaterial({ color: COLORS.control, roughness: 0.52, metalness: 0.64 }),
      steel: new THREE.MeshStandardMaterial({ color: COLORS.steel, roughness: 0.26, metalness: 0.9 }),
      bright: new THREE.MeshStandardMaterial({ color: COLORS.line, roughness: 0.23, metalness: 0.86 }),
      red: new THREE.MeshStandardMaterial({ color: COLORS.action, roughness: 0.42, metalness: 0.55 }),
      resin: createMarbledResinMaterial(),
      black: new THREE.MeshStandardMaterial({ color: COLORS.shell, roughness: 0.76, metalness: 0.4 }),
      stock: new THREE.MeshStandardMaterial({ color: 0xaeb4ba, roughness: 0.31, metalness: 0.88 }),
    };
  }

  buildMachine() {
    const material = this.materials();
    const plate = MR1_CONFIG.fixturePlate;
    const plateTop = plate.thickness / 2;
    this.plateTop = plateTop;

    const floorMaterial = this.renderProfile.quality === "reduced"
      ? new THREE.MeshBasicMaterial({ color: COLORS.shell })
      : new THREE.MeshStandardMaterial({ color: COLORS.shell, roughness: 0.95, metalness: 0.08 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2200, 2200), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -92;
    floor.receiveShadow = true;
    this.machineRoot.add(floor);
    this.machineFloor = floor;

    this.machineFallback = new THREE.Group();
    this.machineFallback.name = "MR1_PRIMITIVE_LOADING_FALLBACK";
    this.machineRoot.add(this.machineFallback);

    const pedestal = addEdges(
      new THREE.Mesh(roundedBox(760, 72, 700, 6), material.dark),
      COLORS.line,
      0.1,
    );
    pedestal.position.y = -56;
    this.machineFallback.add(pedestal);

    const tray = addEdges(new THREE.Mesh(roundedBox(720, 28, 658, 4), material.black));
    tray.position.y = -18;
    this.machineFallback.add(tray);

    this.fixturePlateRoot = new THREE.Group();
    this.fixturePlateRoot.name = "FIXTURE_PLATE_REPLACEABLE";
    this.machineRoot.add(this.fixturePlateRoot);

    this.fixtureFallback = new THREE.Group();
    this.fixtureFallback.name = "FIXTURE_PLATE_LOADING_FALLBACK";
    this.fixturePlateRoot.add(this.fixtureFallback);

    const plateMesh = addEdges(
      new THREE.Mesh(roundedBox(plate.width, plate.thickness, plate.depth, 4), material.body),
      COLORS.line,
      0.22,
    );
    this.fixtureFallback.add(plateMesh);

    const holePoints = cadFixtureHolePoints();
    const holeGeometry = new THREE.CylinderGeometry(
      plate.fallbackHoleDiameter / 2,
      plate.fallbackHoleDiameter / 2,
      1.2,
      10,
    );
    const counterboreGeometry = new THREE.RingGeometry(
      plate.fallbackHoleDiameter / 2,
      plate.fallbackHoleDiameter / 2 + 2.2,
      10,
    );
    const holes = new THREE.InstancedMesh(holeGeometry, material.black, holePoints.length);
    const counterbores = new THREE.InstancedMesh(counterboreGeometry, material.steel, holePoints.length);
    const matrix = new THREE.Matrix4();
    for (const [holeIndex, point] of holePoints.entries()) {
      const z = machineYToSceneZ(point.y);
      matrix.makeTranslation(point.x, plateTop + 0.35, z);
      holes.setMatrixAt(holeIndex, matrix);
      matrix.makeRotationX(-Math.PI / 2);
      matrix.setPosition(point.x, plateTop + 1.01, z);
      counterbores.setMatrixAt(holeIndex, matrix);
    }
    holes.instanceMatrix.needsUpdate = true;
    counterbores.instanceMatrix.needsUpdate = true;
    this.fixtureFallback.add(holes, counterbores);
    this.container.dataset.fixtureHoleCount = String(holePoints.length);

    this.buildRails(material, plate);
    this.buildWorkholding(material);
    this.buildCornerDrains(material);
    this.buildGantry(material);
    setShadow(this.machineRoot);
    if (this.renderProfile.quality === "reduced") {
      this.buildCoolantVisual(material);
      this.container.dataset.cadState = "reduced";
      this.container.dataset.machineCadState = "procedural";
      this.container.dataset.fixtureCadState = "semantic";
      this.container.dataset.brandingState = "reduced";
      this.container.dataset.resinState = "reduced";
      this.cadAssetsPromise = Promise.resolve({ quality: "reduced" });
    } else {
      this.cadAssetsPromise = this.loadCadAssets(material);
    }
  }

  buildRails(material, plate) {
    const railGeometry = roundedBox(26, 14, plate.depth + 64, 2);
    const carriageGeometry = roundedBox(52, 18, 52, 2);
    for (const x of [-plate.width / 2 - 34, plate.width / 2 + 34]) {
      const rail = new THREE.Mesh(railGeometry, material.steel);
      rail.position.set(x, 23, 0);
      this.machineFallback.add(rail);

      const carriageA = new THREE.Mesh(carriageGeometry, material.body);
      carriageA.position.set(x, 34, -155);
      this.machineFallback.add(carriageA);
      const carriageB = carriageA.clone();
      carriageB.position.z = 155;
      this.machineFallback.add(carriageB);
    }
  }

  buildWorkholding(material) {
    const stock = MR1_CONFIG.stock;
    this.workholdingRoot = new THREE.Group();
    this.workholdingRoot.name = "MR1_WORKHOLDING";
    this.machineRoot.add(this.workholdingRoot);

    this.viseFallback = new THREE.Group();
    this.viseFallback.name = "SMW_VISE_LOADING_FALLBACK";
    this.workholdingRoot.add(this.viseFallback);

    const fallbackBaseGeometry = roundedBox(122, 10, 46, 2);
    const fallbackJawGeometry = roundedBox(118, 24, 18, 2);
    const makeFallbackVise = () => {
      const vise = new THREE.Group();
      for (const z of [-55, 55]) {
        const side = new THREE.Group();
        side.name = z > 0 ? "SMW_MOVABLE_SIDE_FALLBACK" : "SMW_FIXED_SIDE_FALLBACK";
        side.position.z = z;
        const base = addEdges(new THREE.Mesh(fallbackBaseGeometry, material.dark));
        base.position.set(0, 5, 0);
        side.add(base);
        const jaw = addEdges(new THREE.Mesh(fallbackJawGeometry, material.body));
        jaw.position.set(0, 17, -Math.sign(z) * 14);
        side.add(jaw);
        vise.add(side);
      }
      return vise;
    };

    for (const placement of MR1_CONFIG.workholding.vises) {
      const vise = makeFallbackVise();
      vise.name = `${placement.id}_FALLBACK`;
      vise.position.set(placement.x, this.plateTop, machineYToSceneZ(placement.z));
      vise.rotation.y = placement.rotation
        + THREE.MathUtils.degToRad(MR1_CONFIG.workholding.viseCad.modelRotationOffsetDeg);
      this.viseFallback.add(vise);
    }

    this.fixtureDatumMarker = new THREE.Group();
    this.fixtureDatumMarker.name = "SELECTED_FIXTURE_DATUM";
    const datumRing = new THREE.Mesh(
      new THREE.TorusGeometry(12, 1.7, 10, 40),
      new THREE.MeshBasicMaterial({ color: COLORS.action, depthTest: false }),
    );
    datumRing.rotation.x = Math.PI / 2;
    datumRing.renderOrder = 8;
    this.fixtureDatumMarker.add(datumRing);
    const datumCross = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-18, 0, 0),
        new THREE.Vector3(18, 0, 0),
        new THREE.Vector3(0, 0, -18),
        new THREE.Vector3(0, 0, 18),
      ]),
      new THREE.LineBasicMaterial({ color: COLORS.paper, depthTest: false }),
    );
    datumCross.renderOrder = 8;
    this.fixtureDatumMarker.add(datumCross);
    this.fixtureDatumMarker.position.y = this.plateTop + 2.4;
    this.fixtureDatumMarker.visible = false;
    this.workholdingRoot.add(this.fixtureDatumMarker);

    this.stockBottom = this.plateTop + 22;
    this.stockTop = this.stockBottom + stock.height;
    const stockMesh = addEdges(
      new THREE.Mesh(roundedBox(stock.width, stock.height, stock.depth, 2), material.stock),
      COLORS.paper,
      0.25,
    );
    stockMesh.position.set(
      stock.centerX,
      this.stockBottom + stock.height / 2,
      machineYToSceneZ(stock.centerY),
    );
    stockMesh.name = "JOB_STOCK";
    this.workholdingRoot.add(stockMesh);

    const finishedMaterial = this.renderProfile.quality === "reduced"
      ? new THREE.MeshBasicMaterial({ color: COLORS.control, transparent: true, opacity: 0.72 })
      : new THREE.MeshStandardMaterial({
          color: COLORS.control,
          roughness: 0.34,
          metalness: 0.75,
          transparent: true,
          opacity: 0.72,
        });
    const finishedPreview = new THREE.Mesh(
      roundedBox(stock.width - 16, 1.2, stock.depth - 16, 7),
      finishedMaterial,
    );
    finishedPreview.position.set(stock.centerX, this.stockTop + 0.7, machineYToSceneZ(stock.centerY));
    this.workholdingRoot.add(finishedPreview);
  }

  buildCornerDrains(material) {
    const drains = MR1_CONFIG.drains;
    this.drainRoot = new THREE.Group();
    this.drainRoot.name = "FOUR_4IN_STAINLESS_CORNER_DRAINS";
    this.machineRoot.add(this.drainRoot);

    const coverGeometry = roundedBox(drains.coverSize, 2.4, drains.coverSize, 3, 2);
    const panelGeometry = roundedBox(drains.coverSize - 10, 1.2, drains.coverSize - 10, 2, 2);
    for (const [index, center] of drains.centers.entries()) {
      const drain = new THREE.Group();
      drain.name = `CORNER_DRAIN_COVER_${index + 1}`;
      drain.position.set(center.x, drains.topY, center.z);
      drain.userData = {
        coverSizeMm: drains.coverSize,
        outletDiameterMm: drains.outletDiameter,
        sourceUrl: drains.sourceUrl,
      };
      const cover = addEdges(new THREE.Mesh(coverGeometry, material.bright), COLORS.line, 0.28);
      const inset = new THREE.Mesh(panelGeometry, material.steel);
      inset.position.y = 1.45;
      drain.add(cover, inset);
      this.drainRoot.add(drain);
    }

    const holeGeometry = new THREE.CylinderGeometry(3.1, 3.1, 1.4, 12);
    const holesPerCover = 36;
    const holes = new THREE.InstancedMesh(
      holeGeometry,
      material.black,
      drains.centers.length * holesPerCover,
    );
    holes.name = "REMOVABLE_DRAIN_GRATE_HOLES";
    const matrix = new THREE.Matrix4();
    let index = 0;
    for (const center of drains.centers) {
      for (let row = 0; row < 6; row += 1) {
        for (let column = 0; column < 6; column += 1) {
          matrix.makeTranslation(
            center.x - 31.25 + column * 12.5,
            drains.topY + 2.2,
            center.z - 31.25 + row * 12.5,
          );
          holes.setMatrixAt(index, matrix);
          index += 1;
        }
      }
    }
    holes.instanceMatrix.needsUpdate = true;
    this.drainRoot.add(holes);
  }

  normalizeCadRoot(root, { restOnY = null } = {}) {
    root.scale.setScalar(1000);
    root.rotation.x = -Math.PI / 2;
    root.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y += restOnY === null ? -center.y : restOnY - bounds.min.y;
    root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(root);
  }

  alignViseCadRoot(root) {
    root.scale.setScalar(1000);
    root.rotation.x = -Math.PI / 2;
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    root.position.y -= bounds.min.y;
    root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(root);
  }

  machineMaterial(source, material) {
    const color = source?.color;
    if (!color) return material.body;
    if (color.r > color.g * 1.55 && color.r > color.b * 1.45) return material.red;
    const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
    if (luminance > 0.55) return material.bright;
    if (luminance < 0.025) return material.black;
    if (luminance < 0.14) return material.dark;
    return material.body;
  }

  prepareMachineAssembly(machine, material) {
    const assembly = MR1_CONFIG.machineAssembly;
    machine.name = "MR1_LOWER_ASSEMBLY_V52_STEP";
    machine.scale.setScalar(1000);
    machine.rotation.x = -Math.PI / 2;
    machine.position.set(
      -assembly.alignment.plateCenterX,
      -assembly.alignment.epoxyTableTopZ - this.plateTop,
      assembly.alignment.plateCenterY,
    );

    let triangleCount = 0;
    let resinSurfaceCount = 0;
    machine.traverse((child) => {
      if (!child.isMesh) return;
      const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
      let mapped;
      if (child.name === "Spindle_Head1") mapped = sourceMaterials.map(() => material.black);
      else if (child.name === "Spindle_Motor1") mapped = sourceMaterials.map(() => material.dark);
      else if (child.name === "Epoxy_Table1") {
        mapped = sourceMaterials.map(() => material.resin);
        resinSurfaceCount += 1;
      }
      else mapped = sourceMaterials.map((source) => this.machineMaterial(source, material));
      child.material = Array.isArray(child.material) ? mapped : mapped[0];
      child.castShadow = false;
      child.receiveShadow = true;
      const count = child.geometry.index?.count ?? child.geometry.attributes.position?.count ?? 0;
      triangleCount += Math.floor(count / 3);
    });
    machine.updateMatrixWorld(true);
    if (resinSurfaceCount === 0) throw new Error("MR-1 assembly is missing the epoxy resin table surface.");

    const bounds = new THREE.Box3().setFromObject(machine);
    const size = bounds.getSize(new THREE.Vector3());
    const expected = assembly.sourceBounds;
    if (
      Math.abs(size.x - expected.width) > 8
      || Math.abs(size.y - expected.height) > 8
      || Math.abs(size.z - expected.depth) > 8
    ) {
      throw new Error(`MR-1 assembly dimensions are unexpected: ${size.toArray().join(", ")}`);
    }

    for (const name of assembly.hiddenNodes) {
      const node = machine.getObjectByName(name);
      if (!node) throw new Error(`MR-1 assembly is missing ${name}.`);
      node.visible = false;
    }

    const yNode = machine.getObjectByName("Y_axis1");
    const xNode = machine.getObjectByName("X_Axis1");
    const zNode = machine.getObjectByName("Z_Axis1");
    const spindleHead = machine.getObjectByName("Spindle_Head1");
    if (!yNode || !xNode || !zNode || !spindleHead) {
      throw new Error("MR-1 assembly is missing a named motion component.");
    }

    const spindleBounds = new THREE.Box3().setFromObject(spindleHead);
    const spindleCenter = spindleBounds.getCenter(new THREE.Vector3());
    const toolLength = 58;
    const spindleLogo = new THREE.Mesh(
      new THREE.PlaneGeometry(58, 174),
      new THREE.MeshBasicMaterial({
        map: createWordmarkTexture({ vertical: true }),
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    spindleLogo.name = "MR1_SPINDLE_COVER_WORDMARK";
    spindleLogo.position.set(spindleCenter.x, spindleCenter.y + 85, spindleBounds.max.z + 1.2);
    spindleLogo.renderOrder = 5;
    this.machineRoot.add(spindleLogo);

    const backdropLogo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: createWordmarkTexture(),
      color: COLORS.paper,
      transparent: true,
      opacity: 0.11,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    }));
    backdropLogo.name = "MR1_FLOATING_BACKDROP_WORDMARK";
    backdropLogo.position.set(0, 300, -690);
    backdropLogo.scale.set(560, 140, 1);
    this.machineRoot.add(backdropLogo);

    this.machineCadMotion = {
      yNode,
      xNode,
      zNode,
      yBase: yNode.position.clone(),
      xBase: xNode.position.clone(),
      zBase: zNode.position.clone(),
      reference: new THREE.Vector3(spindleCenter.x, spindleBounds.min.y - toolLength, spindleCenter.z),
      spindleLogo,
      spindleLogoBase: spindleLogo.position.clone(),
    };

    this.machineToolVisual = new THREE.Group();
    this.machineToolVisual.name = "MR1_CAD_ACTIVE_TOOL";
    const shank = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 38, 18), material.bright);
    shank.position.y = 39;
    const flute = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 2.7, 20, 12),
      new THREE.MeshStandardMaterial({ color: COLORS.paper, roughness: 0.2, metalness: 0.95 }),
    );
    flute.position.y = 10;
    this.machineToolVisual.add(shank, flute);
    this.machineRoot.add(this.machineToolVisual);

    this.machineCadRoot = machine;
    this.machineRoot.add(machine);
    this.buildLeadScrewVisuals(machine, material, spindleBounds);
    this.buildCoolantVisual(material);
    this.machineFallback.visible = false;
    this.machineFloor.position.y = bounds.min.y - 4;
    this.container.dataset.machineCadState = "ready";
    this.container.dataset.machineCadTriangles = String(triangleCount);
    this.container.dataset.brandingState = "ready";
    this.container.dataset.resinState = "ready";
    this.updateMachineCadMotion(this.toolPosition);
  }

  updateMachineCadMotion(world) {
    this.coolantAssembly?.position.copy(world);
    const motion = this.machineCadMotion;
    if (!motion) return;
    motion.yNode.position.y = motion.yBase.y - (world.z - motion.reference.z) / 1000;
    motion.xNode.position.x = motion.xBase.x + (world.x - motion.reference.x) / 1000;
    motion.zNode.position.z = motion.zBase.z + (world.y - motion.reference.y) / 1000;
    motion.spindleLogo.position.set(
      motion.spindleLogoBase.x + world.x - motion.reference.x,
      motion.spindleLogoBase.y + world.y - motion.reference.y,
      motion.spindleLogoBase.z + world.z - motion.reference.z,
    );
    this.machineToolVisual?.position.copy(world);
    this.updateLeadScrewMotion(world);
  }

  buildLeadScrewVisuals(machine, material, spindleBounds) {
    const nodePosition = (...names) => {
      const node = names.map((name) => machine.getObjectByName(name)).find(Boolean);
      if (!node) throw new Error(`MR-1 assembly is missing screw anchor ${names[0]}.`);
      return node.getWorldPosition(new THREE.Vector3());
    };

    this.kinematicsRoot = new THREE.Group();
    this.kinematicsRoot.name = "MR1_LEAD_SCREW_KINEMATICS";
    this.machineRoot.add(this.kinematicsRoot);

    this.xScrewCarrier = new THREE.Group();
    this.xScrewCarrier.name = "MR1_X_SCREW_CARRIER";
    this.kinematicsRoot.add(this.xScrewCarrier);
    const xScrew = createLeadScrew(
      nodePosition("X_Motor_Mount_End1"),
      nodePosition("X_Ballscrew_Mount_End2"),
      { name: "MR1_X_LEAD_SCREW", leadMm: MR1_CONFIG.screwLeadMm.x, materials: material },
    );
    this.xScrewCarrier.add(xScrew.root);

    const yLeftScrew = createLeadScrew(
      nodePosition("Y1_Motor1"),
      nodePosition("Y1_Ballscrew_Mount_End1"),
      { name: "MR1_Y_LEFT_LEAD_SCREW", leadMm: MR1_CONFIG.screwLeadMm.y, materials: material },
    );
    const yRightScrew = createLeadScrew(
      nodePosition("Y2_Motor1"),
      nodePosition("X_Ballscrew_Mount_End1"),
      { name: "MR1_Y_RIGHT_LEAD_SCREW", leadMm: MR1_CONFIG.screwLeadMm.y, materials: material },
    );
    this.kinematicsRoot.add(yLeftScrew.root, yRightScrew.root);

    this.zScrewCarrier = new THREE.Group();
    this.zScrewCarrier.name = "MR1_Z_SCREW_CARRIER";
    this.kinematicsRoot.add(this.zScrewCarrier);
    const spindleCenter = spindleBounds.getCenter(new THREE.Vector3());
    const zBottom = new THREE.Vector3(
      spindleCenter.x - 58,
      spindleBounds.min.y + 38,
      spindleCenter.z - 34,
    );
    const zTop = zBottom.clone();
    zTop.y = Math.max(zBottom.y + 235, spindleBounds.max.y + 34);
    const zScrew = createLeadScrew(
      zBottom,
      zTop,
      { name: "MR1_Z_LEAD_SCREW", leadMm: MR1_CONFIG.screwLeadMm.z, radius: 3.5, materials: material },
    );
    this.zScrewCarrier.add(zScrew.root);

    this.leadScrewMotion = {
      xSpin: xScrew.spin,
      ySpins: [yLeftScrew.spin, yRightScrew.spin],
      zSpin: zScrew.spin,
    };
    this.container.dataset.leadScrewCount = "4";
    this.updateLeadScrewMotion(this.toolPosition);
  }

  updateLeadScrewMotion(world) {
    const screws = this.leadScrewMotion;
    const reference = this.machineCadMotion?.reference;
    if (!screws || !reference) return;
    const deltaX = world.x - reference.x;
    const deltaY = -(world.z - reference.z);
    const deltaZ = world.y - reference.y;
    const wrap = (angle) => angle % (Math.PI * 2);
    screws.xSpin.rotation.y = wrap(leadScrewRotationRadians("x", deltaX));
    screws.ySpins.forEach((spin) => { spin.rotation.y = wrap(leadScrewRotationRadians("y", deltaY)); });
    screws.zSpin.rotation.y = wrap(leadScrewRotationRadians("z", deltaZ));
    this.xScrewCarrier.position.z = world.z - reference.z;
    this.zScrewCarrier.position.x = deltaX;
    this.zScrewCarrier.position.z = world.z - reference.z;
    this.container.dataset.leadScrewRotations = [
      screws.xSpin.rotation.y,
      screws.ySpins[0].rotation.y,
      screws.ySpins[1].rotation.y,
      screws.zSpin.rotation.y,
    ].map((value) => value.toFixed(5)).join(",");
  }

  buildCoolantVisual(material) {
    this.coolantAssembly = new THREE.Group();
    this.coolantAssembly.name = "MR1_MOVING_COOLANT_ASSEMBLY";
    this.coolantAssembly.position.copy(this.toolPosition);
    this.machineRoot.add(this.coolantAssembly);

    const origins = [
      new THREE.Vector3(-44, 78, 30),
      new THREE.Vector3(44, 78, 30),
      new THREE.Vector3(0, 88, -44),
    ];
    const hoseStarts = [
      new THREE.Vector3(-72, 122, 48),
      new THREE.Vector3(72, 122, 48),
      new THREE.Vector3(0, 132, -72),
    ];
    const impact = new THREE.Vector3(0, 3, 0);
    const controls = origins.map((origin) => origin.clone().multiplyScalar(0.48).add(new THREE.Vector3(0, 16, 0)));
    const fullQuality = this.renderProfile.quality === "full";
    const hoseSegments = fullQuality ? 12 : 8;
    const jetSegments = fullQuality ? 16 : 10;
    const radialSegments = fullQuality ? 8 : 5;

    const nozzleRoot = new THREE.Group();
    nozzleRoot.name = "MR1_COOLANT_NOZZLES";
    origins.forEach((origin, index) => {
      const hoseCurve = new THREE.QuadraticBezierCurve3(
        hoseStarts[index],
        hoseStarts[index].clone().lerp(origin, 0.5).add(new THREE.Vector3(0, 12, 0)),
        origin,
      );
      const hose = new THREE.Mesh(
        new THREE.TubeGeometry(hoseCurve, hoseSegments, 3.4, radialSegments, false),
        material.dark,
      );
      nozzleRoot.add(hose);
      const tipCurve = new THREE.LineCurve3(origin.clone().add(new THREE.Vector3(0, 8, 0)), origin);
      const tip = new THREE.Mesh(
        new THREE.TubeGeometry(tipCurve, 2, 4.8, radialSegments, false),
        material.red,
      );
      nozzleRoot.add(tip);
    });
    this.coolantAssembly.add(nozzleRoot);

    this.coolantJetRoot = new THREE.Group();
    this.coolantJetRoot.name = "MR1_COOLANT_FLOW";
    this.coolantJetMaterial = new THREE.MeshBasicMaterial({
      color: 0x38d9ff,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      toneMapped: false,
    });
    origins.forEach((origin, index) => {
      const jetCurve = new THREE.QuadraticBezierCurve3(origin, controls[index], impact);
      const jet = new THREE.Mesh(
        new THREE.TubeGeometry(jetCurve, jetSegments, 3.5, radialSegments, false),
        this.coolantJetMaterial,
      );
      jet.renderOrder = 7;
      this.coolantJetRoot.add(jet);
    });

    const dropsPerJet = this.renderProfile.quality === "reduced"
      ? 4
      : this.renderProfile.quality === "balanced" ? 6 : 12;
    const dropGeometry = new THREE.BufferGeometry();
    dropGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(origins.length * dropsPerJet * 3), 3));
    this.coolantDropMaterial = new THREE.PointsMaterial({
      map: this.coolantDropTexture,
      color: 0xa8efff,
      size: 20,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.92,
      alphaTest: 0.08,
      depthWrite: false,
      toneMapped: false,
    });
    this.coolantDrops = new THREE.Points(dropGeometry, this.coolantDropMaterial);
    this.coolantDrops.frustumCulled = false;
    this.coolantDrops.renderOrder = 8;
    this.coolantJetRoot.add(this.coolantDrops);

    this.coolantImpact = new THREE.Mesh(
      new THREE.TorusGeometry(21, 3, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0x65e4ff, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }),
    );
    this.coolantImpact.rotation.x = Math.PI / 2;
    this.coolantImpact.position.copy(impact);
    this.coolantImpact.renderOrder = 8;
    this.coolantJetRoot.add(this.coolantImpact);
    this.coolantJetRoot.visible = false;
    this.coolantAssembly.add(this.coolantJetRoot);
    this.coolantPaths = { origins, controls, impact, dropsPerJet };
    this.coolantScratch = new THREE.Vector3();
    this.container.dataset.coolantParticleCount = String(origins.length * dropsPerJet);
  }

  setCoolant(modeCandidate) {
    const requested = typeof modeCandidate === "string"
      ? modeCandidate.toLowerCase()
      : coolantAccessoryMode(modeCandidate);
    const mode = ["flood", "mist", "flood-mist"].includes(requested) ? requested : "off";
    this.coolantMode = mode;
    this.container.dataset.coolantMode = mode;
    if (!this.coolantJetRoot) return;
    this.coolantJetRoot.visible = mode !== "off";
    const mistOnly = mode === "mist";
    this.coolantJetMaterial.opacity = mistOnly ? 0.2 : 0.72;
    this.coolantDropMaterial.opacity = mistOnly ? 0.58 : 0.98;
    this.coolantDropMaterial.size = mistOnly ? 23 : 20;
    this.coolantImpact.material.opacity = mistOnly ? 0.3 : 0.8;
    this.requestRender();
  }

  updateCoolantAnimation(now) {
    if (this.coolantMode === "off" || !this.coolantDrops || !this.coolantPaths) return;
    const { origins, controls, impact, dropsPerJet } = this.coolantPaths;
    const positions = this.coolantDrops.geometry.attributes.position;
    const mist = this.coolantMode === "mist";
    const time = now * (mist ? 0.00055 : 0.00115);
    let pointIndex = 0;
    origins.forEach((origin, streamIndex) => {
      for (let dropIndex = 0; dropIndex < dropsPerJet; dropIndex += 1) {
        const progress = (dropIndex / dropsPerJet + time + streamIndex * 0.17) % 1;
        const point = quadraticPoint(origin, controls[streamIndex], impact, progress, this.coolantScratch);
        const spread = mist ? progress * 8 : progress * 1.8;
        positions.setXYZ(
          pointIndex,
          point.x + Math.sin((dropIndex + streamIndex * 7) * 2.13 + now * 0.004) * spread,
          point.y + Math.sin(dropIndex * 1.31 + now * 0.006) * spread * 0.25,
          point.z + Math.cos((dropIndex + streamIndex * 5) * 1.87 + now * 0.003) * spread,
        );
        pointIndex += 1;
      }
    });
    positions.needsUpdate = true;
    const pulse = 0.82 + (Math.sin(now * 0.008) + 1) * 0.13;
    this.coolantImpact.scale.setScalar(pulse);
  }

  async loadCadAssets(material) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    try {
      const loadFixtureCad = this.renderProfile.quality === "full";
      const [machineAsset, fixtureAsset, viseAsset] = await Promise.all([
        loader.loadAsync(MR1_CONFIG.machineAssembly.modelUrl),
        loadFixtureCad ? loader.loadAsync(MR1_CONFIG.fixturePlate.modelUrl) : Promise.resolve(null),
        loader.loadAsync(MR1_CONFIG.workholding.viseModelUrl),
      ]);

      this.prepareMachineAssembly(machineAsset.scene, material);

      if (fixtureAsset) {
        const fixture = fixtureAsset.scene;
        fixture.name = "CUSTOM_FIXTURE_FROM_UNTITLED_STEP";
        fixture.traverse((child) => {
          if (!child.isMesh) return;
          child.material = material.body;
          child.castShadow = false;
          child.receiveShadow = true;
        });
        const fixtureBounds = this.normalizeCadRoot(fixture);
        const fixtureSize = fixtureBounds.getSize(new THREE.Vector3());
        const configuredPlate = MR1_CONFIG.fixturePlate;
        if (
          Math.abs(fixtureSize.x - configuredPlate.width) > 2
          || Math.abs(fixtureSize.z - configuredPlate.depth) > 2
        ) {
          throw new Error(`Fixture CAD dimensions are unexpected: ${fixtureSize.toArray().join(", ")}`);
        }
        this.fixturePlateRoot.add(fixture);
        this.fixtureFallback.visible = false;
        this.container.dataset.fixtureCadState = "ready";
      } else {
        this.container.dataset.fixtureCadState = "semantic";
      }

      const viseTemplate = new THREE.Group();
      const viseModel = viseAsset.scene;
      viseModel.traverse((child) => {
        if (!child.isMesh) return;
        child.material = child.name.toLowerCase().includes("jaw")
          ? material.bright
          : material.body;
        child.castShadow = true;
        child.receiveShadow = true;
      });
      this.alignViseCadRoot(viseModel);
      viseTemplate.add(viseModel);

      this.viseCadRoot = new THREE.Group();
      this.viseCadRoot.name = "FIVE_SMW_GEN3_HOBBY_M6_VISES";
      this.workholdingRoot.add(this.viseCadRoot);
      for (const placement of MR1_CONFIG.workholding.vises) {
        const vise = viseTemplate.clone(true);
        vise.name = placement.id;
        vise.position.set(placement.x, this.plateTop, machineYToSceneZ(placement.z));
        vise.rotation.y = placement.rotation
          + THREE.MathUtils.degToRad(MR1_CONFIG.workholding.viseCad.modelRotationOffsetDeg);
        vise.userData = {
          id: placement.id,
          model: "SMW Gen3 Hobby Mod Vise M6",
          placementProvisional: true,
        };
        this.viseCadRoot.add(vise);
      }
      this.viseFallback.visible = false;
      this.applyFixtureLayout();
      this.container.dataset.cadState = "ready";
    } catch (error) {
      this.container.dataset.cadState = "fallback";
      this.container.dataset.machineCadState = "fallback";
      this.container.dataset.brandingState = "fallback";
      this.container.dataset.resinState = "fallback";
      console.error("MR-1 CAD assets failed to load", error);
    } finally {
      this.requestRender();
    }
  }

  buildGantry(material) {
    this.gantryGroup = new THREE.Group();
    this.gantryGroup.name = "Y_GANTRY";
    this.machineFallback.add(this.gantryGroup);

    const columnGeometry = roundedBox(68, 380, 92, 6);
    for (const x of [-354, 354]) {
      const column = addEdges(new THREE.Mesh(columnGeometry, material.body));
      column.position.set(x, 225, 0);
      this.gantryGroup.add(column);

      const redStripe = new THREE.Mesh(roundedBox(72, 16, 96, 2), material.red);
      redStripe.position.set(x, 102, 0);
      this.gantryGroup.add(redStripe);
    }

    const bridge = addEdges(new THREE.Mesh(roundedBox(776, 104, 104, 6), material.dark));
    bridge.position.y = 398;
    this.gantryGroup.add(bridge);

    const xRailGeometry = roundedBox(650, 18, 15, 2);
    for (const y of [374, 420]) {
      const rail = new THREE.Mesh(xRailGeometry, material.steel);
      rail.position.set(0, y, -57);
      this.gantryGroup.add(rail);
    }

    this.xCarriage = new THREE.Group();
    this.xCarriage.name = "X_CARRIAGE";
    this.gantryGroup.add(this.xCarriage);

    const carriage = addEdges(new THREE.Mesh(roundedBox(118, 174, 52, 5), material.body));
    carriage.position.set(0, 396, -77);
    this.xCarriage.add(carriage);

    const carriageStripe = new THREE.Mesh(roundedBox(122, 16, 55, 2), material.red);
    carriageStripe.position.set(0, 330, -78);
    this.xCarriage.add(carriageStripe);

    this.spindleGroup = new THREE.Group();
    this.spindleGroup.name = "Z_SPINDLE";
    this.xCarriage.add(this.spindleGroup);

    const spindleBody = new THREE.Mesh(new THREE.CylinderGeometry(48, 48, 235, 40), material.black);
    spindleBody.position.y = 172;
    this.spindleGroup.add(spindleBody);

    const spindleBand = new THREE.Mesh(new THREE.CylinderGeometry(50, 50, 25, 40), material.red);
    spindleBand.position.y = 93;
    this.spindleGroup.add(spindleBand);

    const nose = new THREE.Mesh(new THREE.CylinderGeometry(32, 25, 58, 32), material.steel);
    nose.position.y = 43;
    this.spindleGroup.add(nose);

    const collet = new THREE.Mesh(new THREE.CylinderGeometry(18, 13, 26, 24), material.bright);
    collet.position.y = 9;
    this.spindleGroup.add(collet);

    const tool = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 42, 18), material.bright);
    tool.position.y = -25;
    this.spindleGroup.add(tool);

    const flute = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 2.7, 18, 12),
      material.bright,
    );
    flute.position.y = -52;
    this.spindleGroup.add(flute);
    this.toolTipOffset = 61;
  }

  buildPathStage() {
    this.pathGrid = new THREE.GridHelper(700, 28, COLORS.controlLight, COLORS.panel);
    this.pathGrid.position.y = this.stockTop - 8.4;
    this.pathGrid.position.z = machineYToSceneZ(MR1_CONFIG.stock.centerY);
    this.pathGrid.material.transparent = true;
    this.pathGrid.material.opacity = 0.72;
    this.pathRoot.add(this.pathGrid);

    const envelopeGeometry = new THREE.BoxGeometry(
      MR1_CONFIG.travel.x,
      MR1_CONFIG.travel.z,
      MR1_CONFIG.travel.y,
    );
    const envelope = new THREE.LineSegments(
      new THREE.EdgesGeometry(envelopeGeometry),
      new THREE.LineBasicMaterial({ color: COLORS.controlLight, transparent: true, opacity: 0.17 }),
    );
    envelope.position.set(0, this.stockTop + MR1_CONFIG.travel.z / 2 - 8, 0);
    this.pathEnvelope = envelope;
    this.pathRoot.add(envelope);

    this.toolMarker = new THREE.Group();
    const markerRing = new THREE.Mesh(
      new THREE.TorusGeometry(8, 1.5, 10, 32),
      new THREE.MeshBasicMaterial({ color: COLORS.action }),
    );
    markerRing.rotation.x = Math.PI / 2;
    this.toolMarker.add(markerRing);
    const markerCore = new THREE.Mesh(
      new THREE.SphereGeometry(3.5, 18, 18),
      new THREE.MeshBasicMaterial({ color: COLORS.paper }),
    );
    this.toolMarker.add(markerCore);
    this.pathRoot.add(this.toolMarker);
  }

  toWorld(point, fixtureOffset = null) {
    const offsetX = Number.isFinite(fixtureOffset?.x) ? fixtureOffset.x : 0;
    const offsetY = Number.isFinite(fixtureOffset?.y) ? fixtureOffset.y : MR1_CONFIG.stock.centerY;
    const verticalOrigin = Number.isFinite(fixtureOffset?.z)
      ? this.plateTop + fixtureOffset.z
      : this.stockTop;
    return new THREE.Vector3(
      offsetX + point.x,
      verticalOrigin + point.z,
      machineYToSceneZ(offsetY + point.y),
    );
  }

  async setJob(job, { signal = null, onProgress = null } = {}) {
    this.jobBuildToken = (this.jobBuildToken ?? 0) + 1;
    const buildToken = this.jobBuildToken;
    throwIfBuildAborted(signal);
    reportBuildProgress(onProgress, 0);

    const positions = new Float32Array(job.segments.length * 6);
    const colors = new Float32Array(job.segments.length * 6);
    const futureCut = new THREE.Color(COLORS.line);
    const futureRapid = new THREE.Color(COLORS.controlLight);
    const writePoint = (point, fixtureOffset, index) => {
      const offsetX = Number.isFinite(fixtureOffset?.x) ? fixtureOffset.x : MR1_CONFIG.stock.centerX;
      const offsetY = Number.isFinite(fixtureOffset?.y) ? fixtureOffset.y : MR1_CONFIG.stock.centerY;
      const verticalOrigin = Number.isFinite(fixtureOffset?.z)
        ? this.plateTop + fixtureOffset.z
        : this.stockTop;
      positions[index] = offsetX + point.x;
      positions[index + 1] = verticalOrigin + point.z;
      positions[index + 2] = machineYToSceneZ(offsetY + point.y);
    };

    const chunkSize = this.renderProfile.quality === "reduced"
      ? 1_500
      : this.renderProfile.quality === "balanced" ? 3_000 : 20_000;
    for (let start = 0; start < job.segments.length; start += chunkSize) {
      throwIfBuildAborted(signal);
      if (buildToken !== this.jobBuildToken) return false;
      const end = Math.min(job.segments.length, start + chunkSize);
      for (let index = start; index < end; index += 1) {
        const segment = job.segments[index];
        const offset = index * 6;
        writePoint(segment.from, segment.fromFixtureOffset ?? segment.fixtureOffset, offset);
        writePoint(segment.to, segment.fixtureOffset, offset + 3);
        const color = segment.type === "rapid" ? futureRapid : futureCut;
        colors[offset] = color.r;
        colors[offset + 1] = color.g;
        colors[offset + 2] = color.b;
        colors[offset + 3] = color.r;
        colors[offset + 4] = color.g;
        colors[offset + 5] = color.b;
      }
      reportBuildProgress(onProgress, job.segments.length > 0 ? end / job.segments.length : 1);
      if (end < job.segments.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        throwIfBuildAborted(signal);
        if (buildToken !== this.jobBuildToken) return false;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    });
    throwIfBuildAborted(signal);
    if (buildToken !== this.jobBuildToken) {
      geometry.dispose();
      lineMaterial.dispose();
      return false;
    }

    const previousPathLines = this.pathLines;
    const nextPathLines = new THREE.LineSegments(geometry, lineMaterial);
    nextPathLines.frustumCulled = false;
    nextPathLines.renderOrder = 4;
    this.pathRoot.add(nextPathLines);
    if (previousPathLines) {
      this.pathRoot.remove(previousPathLines);
      previousPathLines.geometry.dispose();
      previousPathLines.material.dispose();
    }
    this.job = job;
    this.pathLines = nextPathLines;
    this.pathColors = colors;
    this.activeSegment = -1;
    this.setProgress(0);
    reportBuildProgress(onProgress, 1);
    return true;
  }

  setProgress(activeIndex) {
    if (!this.job || !this.pathLines || !this.pathColors) return;
    const complete = new THREE.Color(COLORS.control);
    const active = new THREE.Color(COLORS.action);
    const futureCut = new THREE.Color(COLORS.line);
    const futureRapid = new THREE.Color(COLORS.controlLight);
    const nextIndex = Math.max(0, Math.min(this.job.segments.length - 1, activeIndex));
    if (nextIndex === this.activeSegment) return;

    const setColor = (index, color) => {
      this.pathColors.set([color.r, color.g, color.b, color.r, color.g, color.b], index * 6);
    };
    const setFutureColor = (index) => {
      const segment = this.job.segments[index];
      setColor(index, segment.type === "rapid" ? futureRapid : futureCut);
    };

    if (nextIndex > this.activeSegment) {
      for (let index = Math.max(0, this.activeSegment); index < nextIndex; index += 1) {
        setColor(index, complete);
      }
    } else {
      for (let index = nextIndex + 1; index <= this.activeSegment; index += 1) {
        setFutureColor(index);
      }
    }
    setColor(nextIndex, active);
    this.activeSegment = nextIndex;
    this.pathLines.geometry.attributes.color.needsUpdate = true;
    this.requestRender();
  }

  setToolPosition(position, fixtureOffset = null) {
    this.setToolWorldPosition(this.toWorld(position, fixtureOffset), position, "point");
  }

  setToolSegmentPosition(segment, progress, positionOverride = null) {
    if (!segment) return;
    const clampedProgress = Math.max(0, Math.min(1, Number(progress) || 0));
    const from = this.toWorld(segment.from, segment.fromFixtureOffset ?? segment.fixtureOffset);
    const to = this.toWorld(segment.to, segment.fixtureOffset);
    const world = from.lerp(to, clampedProgress);
    const sampledPosition = {
      x: segment.from.x + (segment.to.x - segment.from.x) * clampedProgress,
      y: segment.from.y + (segment.to.y - segment.from.y) * clampedProgress,
      z: segment.from.z + (segment.to.z - segment.from.z) * clampedProgress,
    };
    const displayedPosition = ["x", "y", "z"].every((axis) => Number.isFinite(positionOverride?.[axis]))
      ? positionOverride
      : sampledPosition;
    if (displayedPosition !== sampledPosition) {
      world.x += displayedPosition.x - sampledPosition.x;
      world.y += displayedPosition.z - sampledPosition.z;
      world.z += machineYToSceneZ(displayedPosition.y) - machineYToSceneZ(sampledPosition.y);
    }
    this.setToolWorldPosition(
      world,
      displayedPosition,
      displayedPosition === sampledPosition ? "segment" : "jog",
    );
  }

  setToolWorldPosition(world, coordinatePosition = null, source = "world") {
    const previous = this.toolPosition.clone();
    this.toolPosition.copy(world);
    this.toolMarker.position.copy(world);
    this.container.dataset.toolWorldPosition = [world.x, world.y, world.z]
      .map((value) => value.toFixed(4))
      .join(",");
    this.container.dataset.toolCoordinatePosition = coordinatePosition
      ? [coordinatePosition.x, coordinatePosition.y, coordinatePosition.z]
        .map((value) => Number(value).toFixed(4))
        .join(",")
      : "";
    this.container.dataset.toolPositionSource = source;

    this.gantryGroup.position.z = world.z;
    this.xCarriage.position.x = world.x;
    this.spindleGroup.position.y = world.y + this.toolTipOffset;
    this.updateMachineCadMotion(world);

    if (this.followTool) {
      const delta = world.clone().sub(previous);
      if (delta.lengthSq() < 12000) {
        this.camera.position.add(delta);
        this.controls.target.add(delta);
      }
      this.lastFollowTarget.copy(world);
    }
    this.requestRender();
  }

  setMetrologyPoints(pointsCandidate) {
    if (this.metrologyPoints) {
      this.metrologyPoints.geometry.dispose();
      this.metrologyPoints.material.dispose();
      this.metrologyRoot.remove(this.metrologyPoints);
      this.metrologyPoints = null;
    }
    const points = Array.isArray(pointsCandidate)
      ? pointsCandidate.filter(({ work }) => (
        Number.isFinite(work?.x) && Number.isFinite(work?.y) && Number.isFinite(work?.z)
      )).slice(-5000)
      : [];
    this.container.dataset.metrologyPointCount = String(points.length);
    if (points.length === 0) {
      this.requestRender();
      return;
    }

    const positions = new Float32Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);
    const probeColor = new THREE.Color(COLORS.paper);
    const manualColor = new THREE.Color(COLORS.steel);
    const activeColor = new THREE.Color(COLORS.action);
    points.forEach((point, index) => {
      const world = this.toWorld(point.work, point.fixtureOffset);
      positions.set([world.x, world.y, world.z], index * 3);
      const color = index === points.length - 1
        ? activeColor
        : point.source === "probe" ? probeColor : manualColor;
      colors.set([color.r, color.g, color.b], index * 3);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    const material = new THREE.PointsMaterial({
      map: this.metrologyPointTexture,
      size: 9,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      alphaTest: 0.2,
      opacity: 0.96,
      depthWrite: false,
    });
    this.metrologyPoints = new THREE.Points(geometry, material);
    this.metrologyPoints.frustumCulled = false;
    this.metrologyPoints.renderOrder = 8;
    this.metrologyRoot.add(this.metrologyPoints);
    this.requestRender();
  }

  clearSceneRegistrationOverlay() {
    this.sceneRegistrationRoot.traverse((child) => {
      child.geometry?.dispose();
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.sceneRegistrationRoot.clear();
  }

  setSceneRegistrationOverlay(candidate = {}) {
    this.clearSceneRegistrationOverlay();
    const references = Array.isArray(candidate.references)
      ? candidate.references.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)).slice(0, 160)
      : [];
    const footprint = Array.isArray(candidate.footprint)
      ? candidate.footprint.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)).slice(0, 160)
      : [];
    const visible = candidate.visible === true;
    const qualified = candidate.qualified === true;
    this.sceneRegistrationRoot.visible = visible;
    this.container.dataset.sceneRegistrationReferences = String(references.length);
    this.container.dataset.sceneRegistrationState = visible ? (qualified ? "qualified" : "provisional") : "hidden";
    if (!visible) {
      this.requestRender();
      return;
    }

    if (footprint.length >= 3) {
      const geometry = new THREE.BufferGeometry().setFromPoints(footprint.map((point) => (
        new THREE.Vector3(point.x, this.plateTop + 4.5, machineYToSceneZ(point.y))
      )));
      const material = new THREE.LineBasicMaterial({
        color: qualified ? 0x58a6ff : COLORS.steel,
        transparent: true,
        opacity: qualified ? 0.92 : 0.58,
        depthTest: false,
      });
      const outline = new THREE.LineLoop(geometry, material);
      outline.name = "CAMERA_PLATE_PLANE_FOOTPRINT";
      outline.renderOrder = 10;
      this.sceneRegistrationRoot.add(outline);
    }

    if (references.length) {
      const geometry = new THREE.BufferGeometry().setFromPoints(references.map((point) => (
        new THREE.Vector3(point.x, this.plateTop + 5.5, machineYToSceneZ(point.y))
      )));
      const material = new THREE.PointsMaterial({
        color: qualified ? COLORS.paper : 0x58a6ff,
        size: 8,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.96,
        depthTest: false,
      });
      const points = new THREE.Points(geometry, material);
      points.name = "REGISTERED_FIXTURE_HOLES";
      points.frustumCulled = false;
      points.renderOrder = 11;
      this.sceneRegistrationRoot.add(points);
    }
    this.requestRender();
  }

  setFixtureLayout(layout, selectedFixtureId = "V1") {
    this.fixtureLayoutState = {
      layout: Array.isArray(layout) ? layout : [],
      selectedFixtureId,
    };
    this.applyFixtureLayout();
  }

  setViseJawOpening(vise, opening) {
    if (!vise) return;
    const jaw = MR1_CONFIG.workholding.viseCad.movableJaw;
    const normalized = Math.max(jaw.minOpening, Math.min(jaw.maxOpening, Number(opening) || jaw.modelOpening));
    const delta = normalized - jaw.modelOpening;
    const fallbackSide = vise.getObjectByName("SMW_MOVABLE_SIDE_FALLBACK");
    if (fallbackSide) {
      if (!Number.isFinite(fallbackSide.userData.jawBaseLocalZ)) {
        fallbackSide.userData.jawBaseLocalZ = fallbackSide.position.z;
      }
      fallbackSide.position.z = fallbackSide.userData.jawBaseLocalZ + delta;
    }
    const cadSide = vise.getObjectByName(jaw.assemblyNode);
    if (cadSide) {
      if (!Number.isFinite(cadSide.userData.jawBaseLocalY)) {
        cadSide.userData.jawBaseLocalY = cadSide.position.y;
      }
      cadSide.position.y = cadSide.userData.jawBaseLocalY - delta / 1000;
    }
    vise.userData.jawOpening = normalized;
  }

  applyFixtureLayout() {
    const state = this.fixtureLayoutState;
    if (!state) return;
    for (const placement of state.layout) {
      const fallback = this.viseFallback?.getObjectByName(`${placement.id}_FALLBACK`);
      const cad = this.viseCadRoot?.getObjectByName(placement.id);
      const visible = placement.enabled !== false;
      for (const vise of [fallback, cad]) {
        if (!vise) continue;
        vise.visible = visible;
      }
      if (!Number.isFinite(placement?.point?.x) || !Number.isFinite(placement?.point?.y)) continue;
      const rotation = THREE.MathUtils.degToRad(
        (Number(placement.rotation) || 0) + MR1_CONFIG.workholding.viseCad.modelRotationOffsetDeg,
      );
      for (const vise of [fallback, cad]) {
        if (!vise) continue;
        vise.position.set(placement.point.x, this.plateTop, machineYToSceneZ(placement.point.y));
        vise.rotation.y = rotation;
        this.setViseJawOpening(vise, placement.jawOpening);
        vise.userData = {
          ...vise.userData,
          address: placement.address,
          wcs: placement.wcs,
        };
      }
    }

    const selected = state.layout.find(({ id }) => id === state.selectedFixtureId);
    const markerPoint = state.selectedFixtureId === "PLATE"
      ? { x: 0, y: 0 }
      : selected?.enabled === false ? null : selected?.point;
    if (this.fixtureDatumMarker) {
      this.fixtureDatumMarker.visible = Number.isFinite(markerPoint?.x) && Number.isFinite(markerPoint?.y);
      if (this.fixtureDatumMarker.visible) {
        this.fixtureDatumMarker.position.x = markerPoint.x;
        this.fixtureDatumMarker.position.z = machineYToSceneZ(markerPoint.y);
      }
    }
    this.container.dataset.visibleViseCount = String(state.layout.filter(({ enabled }) => enabled !== false).length);
    this.container.dataset.fixtureLayout = state.layout.map((placement) => (
      `${placement.id}:${placement.enabled === false ? "off" : `${placement.point?.x},${placement.point?.y},worldZ=${machineYToSceneZ(placement.point?.y)},${placement.rotation},jaw=${placement.jawOpening}`}`
    )).join("|");
    this.requestRender();
  }

  setMode(mode) {
    if (mode !== "machine" && mode !== "path") return;
    this.mode = mode;
    const pathMode = mode === "path";
    this.machineRoot.visible = !pathMode;
    this.pathGrid.visible = pathMode;
    this.pathEnvelope.visible = pathMode;
    this.toolMarker.visible = pathMode;
    if (this.pathLines) this.pathLines.material.opacity = pathMode ? 1 : 0.5;
    this.setCamera(pathMode ? "path-home" : "home");
  }

  setFollowTool(enabled) {
    this.followTool = Boolean(enabled);
    this.lastFollowTarget.copy(this.toolPosition);
    this.requestRender();
  }

  setCamera(view) {
    const pathMode = this.mode === "path";
    let position;
    let target;

    if (view === "top") {
      const stockSceneZ = machineYToSceneZ(MR1_CONFIG.stock.centerY);
      position = new THREE.Vector3(0, pathMode ? 760 : 1380, stockSceneZ + 0.01);
      target = new THREE.Vector3(0, this.stockTop, stockSceneZ);
    } else if (view === "fixture") {
      position = new THREE.Vector3(0, 2150, 0.01);
      target = new THREE.Vector3(0, this.plateTop, 0);
    } else if (view === "side") {
      const stockSceneZ = machineYToSceneZ(MR1_CONFIG.stock.centerY);
      position = new THREE.Vector3(pathMode ? 720 : 1900, pathMode ? 110 : -80, stockSceneZ);
      target = new THREE.Vector3(0, pathMode ? this.stockTop : -180, stockSceneZ);
    } else if (view === "path-home") {
      position = new THREE.Vector3(420, 520, 500);
      target = new THREE.Vector3(0, this.stockTop - 5, machineYToSceneZ(MR1_CONFIG.stock.centerY));
    } else {
      position = new THREE.Vector3(1750, 820, 2050);
      target = new THREE.Vector3(0, -180, 10);
    }

    this.cameraTween = {
      started: performance.now(),
      duration: 420,
      fromPosition: this.camera.position.clone(),
      toPosition: position,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
    };
    this.requestRender();
  }

  fitView() {
    const object = this.mode === "machine" ? this.machineRoot : this.pathLines;
    if (!object) return;
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) return;
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
    const limitingFov = Math.min(verticalFov, horizontalFov);
    const distance = Math.max(220, (sphere.radius / Math.sin(limitingFov / 2)) * 1.06);
    const target = sphere.center;
    this.cameraTween = {
      started: performance.now(),
      duration: 420,
      fromPosition: this.camera.position.clone(),
      toPosition: target.clone().add(direction.multiplyScalar(distance)),
      fromTarget: this.controls.target.clone(),
      toTarget: target,
    };
    this.requestRender();
  }

  updateCameraTween(now) {
    if (!this.cameraTween) return;
    const elapsed = (now - this.cameraTween.started) / this.cameraTween.duration;
    const progress = Math.max(0, Math.min(1, elapsed));
    const eased = 1 - (1 - progress) ** 3;
    this.camera.position.lerpVectors(
      this.cameraTween.fromPosition,
      this.cameraTween.toPosition,
      eased,
    );
    this.controls.target.lerpVectors(
      this.cameraTween.fromTarget,
      this.cameraTween.toTarget,
      eased,
    );
    if (progress >= 1) this.cameraTween = null;
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const previousAspect = this.camera.aspect;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(getRenderPixelRatio(width, height, this.renderProfile));
    this.renderer.setSize(width, height, false);
    this.requestRender();

    if (
      this.mode === "path"
      && this.pathLines
      && Math.abs(previousAspect - this.camera.aspect) > 0.04
    ) {
      clearTimeout(this.resizeFitTimer);
      this.resizeFitTimer = setTimeout(() => this.fitView(), 120);
    }
  }

  requestRender() {
    this.renderRequested = true;
    if (this.disposed || document.hidden || this.animationFrame !== null) return;
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  animate(now) {
    this.animationFrame = null;
    if (this.disposed || document.hidden) return;
    if (now - this.lastRenderAt < this.renderProfile.frameIntervalMs) {
      this.requestRender();
      return;
    }

    this.lastRenderAt = now;
    this.updateCameraTween(now);
    this.updateCoolantAnimation(now);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.renderCount += 1;
    this.container.dataset.renderCount = String(this.renderCount);
    this.renderRequested = false;

    if (!this.controlsActive && !this.cameraTween && this.controlDampingFrames > 0) {
      this.controlDampingFrames -= 1;
    }
    if (
      this.controlsActive
      || this.cameraTween
      || this.controlDampingFrames > 0
      || (this.mode === "machine" && this.coolantMode !== "off")
    ) {
      this.requestRender();
    }
  }

  dispose() {
    this.disposed = true;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    clearTimeout(this.resizeFitTimer);
    this.resizeObserver.disconnect();
    this.controls.removeEventListener("start", this.handleControlsStart);
    this.controls.removeEventListener("change", this.handleControlsChange);
    this.controls.removeEventListener("end", this.handleControlsEnd);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.controls.dispose();
    this.metrologyPoints?.geometry.dispose();
    this.metrologyPoints?.material.dispose();
    this.clearSceneRegistrationOverlay();
    this.metrologyPointTexture.dispose();
    this.coolantDropTexture.dispose();
    const materials = new Set([
      this.coolantJetMaterial,
      this.coolantDropMaterial,
      this.coolantImpact?.material,
    ].filter(Boolean));
    for (const root of [this.kinematicsRoot, this.coolantAssembly]) {
      root?.traverse((child) => {
        child.geometry?.dispose();
        if (child.userData.disposeMaterial && child.material) materials.add(child.material);
      });
    }
    materials.forEach((material) => material.dispose());
    this.renderer.dispose();
  }
}
