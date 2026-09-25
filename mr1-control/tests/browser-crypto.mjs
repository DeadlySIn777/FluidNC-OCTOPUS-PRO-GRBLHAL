import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import { secureUuidV4, sha256TextHex } from "../src/browser-crypto.js";
import { createMachineId } from "../src/machine-identity.js";

test("SHA-256 fallback matches standard empty and abc vectors without SubtleCrypto", async () => {
  const insecureContextCrypto = {
    getRandomValues: (bytes) => webcrypto.getRandomValues(bytes),
  };
  assert.equal(
    await sha256TextHex("", insecureContextCrypto),
    "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
  );
  assert.equal(
    await sha256TextHex("abc", insecureContextCrypto),
    "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD",
  );
});

test("SHA-256 native and fallback paths agree on a multi-block value", async () => {
  const value = "MR-1 companion evidence / ".repeat(20);
  assert.equal(
    await sha256TextHex(value, webcrypto),
    await sha256TextHex(value, { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }),
  );
});

test("secure UUID fallback uses random bytes and sets RFC 4122 version and variant", () => {
  const cryptoProvider = {
    getRandomValues(bytes) {
      bytes.forEach((_, index) => { bytes[index] = index; });
      return bytes;
    },
  };
  const uuid = secureUuidV4({ cryptoProvider });
  assert.equal(uuid, "00010203-0405-4607-8809-0a0b0c0d0e0f");
  assert.equal(createMachineId(undefined, cryptoProvider), `MR1-${uuid.toUpperCase()}`);
});
