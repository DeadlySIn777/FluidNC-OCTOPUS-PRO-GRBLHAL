import assert from "node:assert/strict";
import test from "node:test";
import { Mr1Scene } from "../src/mr1-scene.js";

function program(name, count) {
  return {
    name,
    segments: Array.from({ length: count }, (_, index) => ({
      from: { x: index, y: 0, z: 1 },
      to: { x: index + 1, y: 0, z: 0 },
      type: "cut",
    })),
  };
}

function disposablePath() {
  return {
    geometry: { disposed: false, dispose() { this.disposed = true; } },
    material: { disposed: false, dispose() { this.disposed = true; } },
  };
}

function sceneHarness(oldJob, oldPath) {
  const scene = Object.create(Mr1Scene.prototype);
  const children = [oldPath];
  Object.assign(scene, {
    job: oldJob,
    jobBuildToken: 0,
    pathLines: oldPath,
    pathColors: null,
    plateTop: 0,
    renderProfile: { quality: "reduced" },
    pathRoot: {
      children,
      add(item) { children.push(item); },
      remove(item) {
        const index = children.indexOf(item);
        if (index >= 0) children.splice(index, 1);
      },
    },
    setProgress() {},
  });
  return scene;
}

test("cancelled path build retains the last committed scene", async () => {
  const oldJob = program("old.nc", 1);
  const oldPath = disposablePath();
  const scene = sceneHarness(oldJob, oldPath);
  const controller = new AbortController();

  await assert.rejects(
    scene.setJob(program("cancelled.nc", 2000), {
      signal: controller.signal,
      onProgress: ({ fraction }) => {
        if (fraction > 0 && fraction < 1) controller.abort();
      },
    }),
    (error) => error?.name === "AbortError",
  );

  assert.equal(scene.job, oldJob);
  assert.equal(scene.pathLines, oldPath);
  assert.deepEqual(scene.pathRoot.children, [oldPath]);
  assert.equal(oldPath.geometry.disposed, false);
  assert.equal(oldPath.material.disposed, false);
});

test("successful path build atomically replaces and disposes the prior scene", async () => {
  const oldJob = program("old.nc", 1);
  const oldPath = disposablePath();
  const scene = sceneHarness(oldJob, oldPath);
  const nextJob = program("next.nc", 2);

  assert.equal(await scene.setJob(nextJob), true);
  assert.equal(scene.job, nextJob);
  assert.notEqual(scene.pathLines, oldPath);
  assert.equal(scene.pathRoot.children.includes(oldPath), false);
  assert.equal(scene.pathRoot.children.includes(scene.pathLines), true);
  assert.equal(oldPath.geometry.disposed, true);
  assert.equal(oldPath.material.disposed, true);
});
