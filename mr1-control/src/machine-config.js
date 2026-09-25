const configuredTravel = Object.freeze({ x: 566.42, y: 546.1, z: 154.94 });
const homingPullOff = 2;

function createAxisEnvelope(travel) {
  return Object.freeze({
    min: -(travel - homingPullOff),
    max: -homingPullOff,
    span: travel - homingPullOff * 2,
  });
}

export const MR1_CONFIG = Object.freeze({
  configuredTravel,
  travel: Object.freeze({
    x: configuredTravel.x,
    y: configuredTravel.y,
    z: configuredTravel.z,
  }),
  homingPullOff,
  machineEnvelope: Object.freeze({
    x: createAxisEnvelope(configuredTravel.x),
    y: createAxisEnvelope(configuredTravel.y),
    z: createAxisEnvelope(configuredTravel.z),
  }),
  usableTravel: Object.freeze({
    x: configuredTravel.x - homingPullOff * 2,
    y: configuredTravel.y - homingPullOff * 2,
    z: configuredTravel.z - homingPullOff * 2,
  }),
  stepsPerMm: Object.freeze({ x: 320, y: 320, z: 533.333333 }),
  screwLeadMm: Object.freeze({ x: 5, y: 5, z: 3 }),
  maxRate: Object.freeze({ x: 2540, y: 2540, z: 1016 }),
  machineAssembly: Object.freeze({
    modelUrl: "/models/mr1-lower-assembly.glb",
    sourceFile: "MR1 Lower Assembly v52.step",
    sourceSha256: "B1763D7728BFC59397F0001E571DC13A423E9A5BEBDB9890AAFD3488D1042213",
    sourceBounds: Object.freeze({ width: 1117.606, depth: 1143.006, height: 1560.887 }),
    alignment: Object.freeze({
      plateCenterX: 540.408692,
      plateCenterY: -761.469541,
      epoxyTableTopZ: 250.67976,
    }),
    hiddenNodes: Object.freeze(["Base_Plate1", "Langmuir_Low_Profile_Vise_v71"]),
    expectedRuntimeTriangles: 117082,
  }),
  fixturePlate: Object.freeze({
    width: 579.121342,
    depth: 579.121342,
    thickness: 11.786961,
    modelUrl: "/models/mr1-custom-fixture.glb",
    fallbackHolePitch: 25.4,
    fallbackHoleDiameter: 6,
  }),
  workholding: Object.freeze({
    viseModelUrl: "/models/smw-gen3-hobby-m6.glb",
    viseFootprint: Object.freeze({ width: 133.729, depth: 175.824, height: 27.064 }),
    viseCad: Object.freeze({
      footprint: Object.freeze({ minX: -66.858, maxX: 66.858, minY: -24.917, maxY: 150.893 }),
      modelRotationOffsetDeg: 180,
      fixedJaw: Object.freeze({ leftX: -47.752, centerX: 0, rightX: 47.752, faceY: 39.326 }),
      movableJaw: Object.freeze({
        assemblyNode: "Adjustable Side Assembly:1",
        modelOpening: 52.405,
        minOpening: 5,
        maxOpening: 300,
        step: 0.1,
      }),
      builtInParallelZ: 25.4,
      jawTopZ: 27.051,
    }),
    vises: Object.freeze([
      Object.freeze({ id: "V1", x: -155, z: -100, rotation: 0 }),
      Object.freeze({ id: "V2", x: 0, z: -100, rotation: 0 }),
      Object.freeze({ id: "V3", x: 155, z: -100, rotation: 0 }),
      Object.freeze({ id: "V4", x: -77.5, z: 110, rotation: 0 }),
      Object.freeze({ id: "V5", x: 77.5, z: 110, rotation: 0 }),
    ]),
  }),
  drains: Object.freeze({
    coverSize: 101.6,
    outletDiameter: 50.8,
    topY: -4.1,
    sourceUrl: "https://www.amazon.com/dp/B0D5QW5ZXN",
    centers: Object.freeze([
      Object.freeze({ x: -418.686, z: 369.967, assembly: "Drain Assembly:1" }),
      Object.freeze({ x: 423.942, z: 369.967, assembly: "Drain Assembly:2" }),
      Object.freeze({ x: -317.086, z: -386.936, assembly: "Drain Assembly:4" }),
      Object.freeze({ x: 322.342, z: -386.936, assembly: "Drain Assembly:3" }),
    ]),
  }),
  stock: Object.freeze({
    width: 210,
    depth: 150,
    height: 24,
    centerX: 0,
    centerY: 20,
  }),
});

export function machineYToSceneZ(machineY) {
  const value = Number(machineY);
  if (!Number.isFinite(value)) return Number.NaN;
  return value === 0 ? 0 : -value;
}

export function leadScrewRotationRadians(axis, displacementMm) {
  const lead = MR1_CONFIG.screwLeadMm[axis];
  const displacement = Number(displacementMm);
  if (!Number.isFinite(lead) || lead <= 0 || !Number.isFinite(displacement)) return Number.NaN;
  return (displacement / lead) * Math.PI * 2;
}

export function coolantAccessoryMode(accessories = {}) {
  const flood = accessories.flood === true;
  const mist = accessories.mist === true;
  if (flood && mist) return "flood-mist";
  if (flood) return "flood";
  if (mist) return "mist";
  return "off";
}

export function coordinatedRapidFeed(from, to) {
  const deltas = Object.fromEntries(
    ["x", "y", "z"].map((axis) => [axis, Number(to?.[axis] ?? 0) - Number(from?.[axis] ?? 0)]),
  );
  const distance = Math.hypot(deltas.x, deltas.y, deltas.z);
  if (!Number.isFinite(distance) || distance <= 1e-9) return 0;

  let pathFeed = Infinity;
  for (const axis of ["x", "y", "z"]) {
    const axisDistance = Math.abs(deltas[axis]);
    if (axisDistance <= 1e-9) continue;
    pathFeed = Math.min(pathFeed, MR1_CONFIG.maxRate[axis] * distance / axisDistance);
  }
  return Number.isFinite(pathFeed) ? pathFeed : 0;
}
