import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { isOutsideDirectory } from "../tools/path-containment.mjs";

test("Windows: accepts package destinations outside the app, including other drives", () => {
  const app = "C:\\src\\repo\\mr1-control";
  assert.equal(isOutsideDirectory(app, "D:\\mr1-package", path.win32), true);
  assert.equal(isOutsideDirectory(app, "\\\\server\\share\\mr1-package", path.win32), true);
  assert.equal(isOutsideDirectory(app, "C:\\src\\repo\\mr1-package", path.win32), true);
  assert.equal(isOutsideDirectory(app, "C:\\src\\repo", path.win32), true);
  assert.equal(isOutsideDirectory(app, "C:\\src\\repo\\mr1-control-package", path.win32), true);
});

test("Windows: rejects the app itself and anything inside it", () => {
  const app = "C:\\src\\repo\\mr1-control";
  assert.equal(isOutsideDirectory(app, app, path.win32), false);
  assert.equal(isOutsideDirectory(app, "c:\\SRC\\repo\\MR1-control", path.win32), false);
  assert.equal(isOutsideDirectory(app, "C:\\src\\repo\\mr1-control\\", path.win32), false);
  assert.equal(isOutsideDirectory(app, "C:\\src\\repo\\mr1-control\\dist\\package", path.win32), false);
  assert.equal(isOutsideDirectory(app, "C:\\src\\repo\\mr1-control\\..package", path.win32), false);
});

test("POSIX: distinguishes outside destinations from nested ones", () => {
  const app = "/home/user/repo/mr1-control";
  assert.equal(isOutsideDirectory(app, "/tmp/mr1-package", path.posix), true);
  assert.equal(isOutsideDirectory(app, "/home/user/repo/mr1-package", path.posix), true);
  assert.equal(isOutsideDirectory(app, "/", path.posix), true);
  assert.equal(isOutsideDirectory(app, app, path.posix), false);
  assert.equal(isOutsideDirectory(app, `${app}/`, path.posix), false);
  assert.equal(isOutsideDirectory(app, `${app}/out`, path.posix), false);
  assert.equal(isOutsideDirectory(app, `${app}/..out`, path.posix), false);
  assert.equal(isOutsideDirectory(app, `${app}/out/../..`, path.posix), true);
});
