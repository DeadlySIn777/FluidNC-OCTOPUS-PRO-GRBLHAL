import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getBounds, NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const modelPath = fileURLToPath(new URL("../public/models/mr1-lower-assembly.glb", import.meta.url));
const viseModelPath = fileURLToPath(new URL("../public/models/smw-gen3-hobby-m6.glb", import.meta.url));

test("optimized MR-1 CAD keeps its motion hierarchy inside the transfer budget", { skip: !existsSync(modelPath) && "Optional local MR1 CAD not imported." }, async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const [document, file] = await Promise.all([io.read(modelPath), stat(modelPath)]);
  const root = document.getRoot();
  const names = new Set(root.listNodes().map((node) => node.getName()));
  const requiredNames = [
    "Base Plate:1",
    "Langmuir Low Profile Vise v7:1",
    "Epoxy Table:1",
    "Y axis:1",
    "X Axis:1",
    "Z Axis:1",
    "Spindle Head:1",
    "MR-1 Tool Setter:1",
  ];
  requiredNames.forEach((name) => assert.ok(names.has(name), `missing ${name}`));

  let triangles = 0;
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute("POSITION")?.getCount() ?? 0;
      triangles += Math.floor((primitive.getIndices()?.getCount() ?? positions) / 3);
    }
  }

  assert.equal(root.listNodes().length, 171);
  assert.equal(triangles, 117082);
  assert.ok(file.size < 900000, `MR-1 CAD is ${file.size.toLocaleString()} bytes`);
});

test("SMW CAD preserves separate fixed and adjustable jaw assemblies", { skip: !existsSync(viseModelPath) && "Optional local SMW CAD not imported." }, async () => {
  const document = await new NodeIO().read(viseModelPath);
  const nodes = document.getRoot().listNodes();
  const names = new Set(nodes.map((node) => node.getName()));
  assert.ok(names.has("Fixed Side Assembly:1"));
  assert.ok(names.has("Adjustable Side Assembly:1"));
  assert.ok(names.has("Top Jaw:1"));
  assert.ok(names.has("Top Jaw:2"));

  const fixed = nodes.find((node) => node.getName() === "Fixed Side Assembly:1");
  const adjustable = nodes.find((node) => node.getName() === "Adjustable Side Assembly:1");
  const fixedBounds = getBounds(fixed);
  const adjustableBounds = getBounds(adjustable);
  assert.ok(
    adjustableBounds.max[1] < fixedBounds.min[1],
    "source vise facing no longer matches the 180 degree runtime correction",
  );
});
