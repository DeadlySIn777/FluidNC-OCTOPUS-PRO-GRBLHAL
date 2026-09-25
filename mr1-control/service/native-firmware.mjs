import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { OCTOPUS_FIRMWARE_CANDIDATE as candidate } from '../src/wiring-installation.js';

// Verifies the distributed files, not the flash contents of a connected board.
export async function verifyNativeFirmware(webRoot) {
  const root = resolve(webRoot, 'firmware/octopus-pro-v1.1-f429-mr1');
  const manifestPath = resolve(root, 'firmware-manifest.json');
  const manifestInfo = await stat(manifestPath);
  if (!manifestInfo.isFile() || manifestInfo.size > 65536) throw new Error('Bundled firmware manifest is invalid or oversized.');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.schema !== 'mr1-controller-firmware-v1' || manifest.candidateId !== candidate.candidateId
    || manifest.artifact?.filename !== candidate.filename || manifest.artifact?.bytes !== candidate.bytes
    || manifest.artifact?.sha256 !== candidate.sha256
    || manifest.boardIdentity?.manufacturer !== 'BIGTREETECH' || manifest.boardIdentity?.model !== 'Octopus Pro'
    || manifest.boardIdentity?.revision !== 'V1.1' || manifest.boardIdentity?.mcu !== candidate.mcu
    || manifest.boardIdentity?.crystalHz !== candidate.crystalHz
    || manifest.bootloader?.reservedBytes !== candidate.bootloaderBytes
    || manifest.bootloader?.applicationAddress !== candidate.applicationAddress
    || manifest.bootloader?.requiredFilename !== candidate.filename
    || manifest.preflight?.protocol !== candidate.preflightProtocol || manifest.preflight?.profile !== candidate.preflightProfile
    || manifest.preflight?.simulationAccepted !== false || manifest.validation?.physicalMotionPermitted !== false) {
    throw new Error('Bundled firmware manifest does not match the pinned MR1 production candidate.');
  }
  const path = resolve(root, candidate.filename); // Never use a manifest-controlled path.
  const info = await stat(path);
  if (!info.isFile() || info.size !== candidate.bytes) throw new Error('Bundled firmware byte count does not match the production candidate.');
  const bytes = await readFile(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex').toUpperCase();
  if (bytes.length !== candidate.bytes || sha256 !== candidate.sha256) throw new Error('Bundled firmware SHA-256 does not match the production candidate.');
  return Object.freeze({ candidateId: candidate.candidateId, bytes: bytes.length, sha256,
    verifiedAt: new Date().toISOString(), verificationScope: 'bundled-file-only', onDeviceFlashVerified: false });
}
