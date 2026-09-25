#!/usr/bin/env node

import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const source = process.argv[2] ?? "public/models/mr1-custom-fixture.glb";
const summaryOnly = process.argv.includes("--summary");
const includeOccupancy = process.argv.includes("--occupancy");
const mapSpecOnly = process.argv.includes("--map-spec");
const BIN_MM = 0.5;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

await MeshoptDecoder.ready;
const document = await io.read(source);
const root = document.getRoot();
const bins = new Set();

for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const matrix = node.getWorldMatrix();
  for (const primitive of mesh.listPrimitives()) {
    const positions = primitive.getAttribute("POSITION");
    const normals = primitive.getAttribute("NORMAL");
    if (!positions || !normals) continue;
    const position = [];
    const normal = [];
    for (let index = 0; index < positions.getCount(); index += 1) {
      positions.getElement(index, position);
      normals.getElement(index, normal);
      if (Math.abs(normal[2]) > 0.72) continue;
      const x = (matrix[0] * position[0] + matrix[4] * position[1] + matrix[8] * position[2] + matrix[12]) * 1000;
      const y = (matrix[1] * position[0] + matrix[5] * position[1] + matrix[9] * position[2] + matrix[13]) * 1000;
      if (Math.abs(x) > 280 || Math.abs(y) > 280) continue;
      bins.add(`${Math.round(x / BIN_MM)},${Math.round(y / BIN_MM)}`);
    }
  }
}

const points = new Set(bins);
const components = [];
const neighbors = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => [dx, dy]));
while (points.size) {
  const seed = points.values().next().value;
  points.delete(seed);
  const queue = [seed];
  const component = [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const key = queue[cursor];
    const [x, y] = key.split(",").map(Number);
    component.push([x, y]);
    for (const [dx, dy] of neighbors) {
      if (dx === 0 && dy === 0) continue;
      const neighbor = `${x + dx},${y + dy}`;
      if (!points.delete(neighbor)) continue;
      queue.push(neighbor);
    }
  }
  components.push(component);
}

const candidates = [];
for (const component of components) {
  if (component.length < 8) continue;
  const xs = component.map(([x]) => x * BIN_MM);
  const ys = component.map(([, y]) => y * BIN_MM);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const depth = maxY - minY;
  if (width < 3 || depth < 3 || width > 18 || depth > 18) continue;
  if (Math.max(width, depth) / Math.min(width, depth) > 1.7) continue;
  candidates.push({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, width, depth });
}

const unique = [];
for (const candidate of candidates) {
  const duplicate = unique.find((point) => Math.hypot(point.x - candidate.x, point.y - candidate.y) < 1.2);
  if (duplicate) continue;
  unique.push(candidate);
}

function axisClusters(values, tolerance = 0.8) {
  const clusters = [];
  for (const value of [...values].sort((a, b) => a - b)) {
    const cluster = clusters.at(-1);
    if (!cluster || Math.abs(value - cluster.mean) > tolerance) {
      clusters.push({ values: [value], mean: value });
    } else {
      cluster.values.push(value);
      cluster.mean = cluster.values.reduce((sum, item) => sum + item, 0) / cluster.values.length;
    }
  }
  return clusters;
}

const xLines = axisClusters(unique.map(({ x }) => x)).filter(({ values }) => values.length >= 5);
const yLines = axisClusters(unique.map(({ y }) => y)).filter(({ values }) => values.length >= 5);
const nearestLine = (value, lines) => lines.reduce((best, line, index) => {
  const distance = Math.abs(value - line.mean);
  return distance < best.distance ? { index, distance } : best;
}, { index: -1, distance: Infinity });
const occupied = [];
for (const candidate of unique) {
  const column = nearestLine(candidate.x, xLines);
  const row = nearestLine(candidate.y, yLines);
  if (column.distance > 1 || row.distance > 1) continue;
  occupied.push({ column: column.index, row: row.index });
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const spacing = (lines) => lines.slice(1).map((line, index) => line.mean - lines[index].mean);
const occupancy = new Set(occupied.map(({ column, row }) => `${column},${row}`));
const axisLatticeIndex = (index, count) => {
  const half = count / 2;
  return index < half ? index - half : index - half + 1;
};
const columnLabel = (index) => {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
};
const cellAddress = (column, row) => `${columnLabel(column)}${row + 1}`;
const expectedOccupancy = new Set();
for (let row = 0; row < yLines.length; row += 1) {
  for (let column = 0; column < xLines.length; column += 1) {
    const latticeX = axisLatticeIndex(column, xLines.length);
    const latticeY = axisLatticeIndex(row, yLines.length);
    if ((latticeX + latticeY) % 2 === 0) expectedOccupancy.add(`${column},${row}`);
  }
}
const excludedAddresses = [...expectedOccupancy]
  .filter((key) => !occupancy.has(key))
  .map((key) => {
    const [column, row] = key.split(",").map(Number);
    return cellAddress(column, row);
  });
const unexpectedAddresses = [...occupancy]
  .filter((key) => !expectedOccupancy.has(key))
  .map((key) => {
    const [column, row] = key.split(",").map(Number);
    return cellAddress(column, row);
  });
const parity = occupied.reduce((counts, cell) => {
  counts[(cell.column + cell.row) % 2] += 1;
  return counts;
}, [0, 0]);
const report = {
  source,
  wallBins: bins.size,
  components: components.length,
  circularCandidates: unique.length,
  summary: {
    columnCount: xLines.length,
    rowCount: yLines.length,
    medianPitchX: Number(median(spacing(xLines))?.toFixed(3)),
    medianPitchY: Number(median(spacing(yLines))?.toFixed(3)),
    minimumX: Number(xLines[0]?.mean.toFixed(3)),
    maximumX: Number(xLines.at(-1)?.mean.toFixed(3)),
    minimumY: Number(yLines[0]?.mean.toFixed(3)),
    maximumY: Number(yLines.at(-1)?.mean.toFixed(3)),
    occupiedCells: occupancy.size,
    parity,
    expectedPatternCells: expectedOccupancy.size,
    excludedCells: excludedAddresses.length,
    unexpectedCells: unexpectedAddresses.length,
  },
  columns: xLines.map(({ mean, values }) => ({ position: Number(mean.toFixed(3)), holes: values.length })),
  rows: yLines.map(({ mean, values }) => ({ position: Number(mean.toFixed(3)), holes: values.length })),
  occupancy: includeOccupancy
    ? yLines.map((_, row) => xLines.map((__, column) => (
        occupancy.has(`${column},${row}`) ? "#" : "."
      )).join(""))
    : undefined,
  holeMap: includeOccupancy ? { excludedAddresses, unexpectedAddresses } : undefined,
};

console.log(JSON.stringify(
  mapSpecOnly ? { summary: report.summary, holeMap: { excludedAddresses, unexpectedAddresses } }
    : summaryOnly ? report.summary
      : report,
  null,
  2,
));
