# Local firmware and reference assets

The public source contains the application, firmware source, candidate manifest
and project wiring data. Seven reference files remain local imports until their
redistribution terms are recorded. Exact sizes and hashes are in
[`local-asset-manifest.json`](../local-asset-manifest.json).

The importer copies from an existing MR1 application source folder or native
portable package. It never downloads, flashes or connects a controller. It
refuses changed files and never replaces a mismatched destination.

At the repository root, using Node.js 24:

```powershell
node tools/import-local-assets.mjs --from "D:\Your existing MR1 package" --only firmware
node tools/import-local-assets.mjs --verify --only firmware
cd mr1-control
npm run build
npm run controller
```

Use your actual local folder. The public repository does not provide that
prebuilt package. Omit `--only firmware` to import any of the seven exact files
available locally. `--verify` reports absent files as missing;
`--verify --only firmware` also fails when the required image is absent.
File verification is not on-device flash verification or permission to machine.

| ID | Purpose | Required for native startup? |
| --- | --- | --- |
| `firmware` | Exact F429 candidate, 221,304 bytes; SHA-256 `F4AB32BD2CB7D0985A07915CF1C4349A3A7FD8546C765265B23EB98B904E5E9D` | Yes |
| `mr1-model` | Manufacturer machine CAD reference | No |
| `fixture-model` | Existing custom fixture CAD reference | No |
| `vise-model` | SMW vise CAD reference | No |
| `fusion-post` | Existing Autodesk-derived CPS | No |
| `board-pinout` | Offline BIGTREETECH board reference | No |
| `usb-power-image` | Offline BIGTREETECH USB-power reference | No |

For a new firmware build, start with
[`grblHAL-STM32F4`](../grblHAL-STM32F4/). Keep its documented F429 environment,
toolchain and component revisions. Compare resulting bytes to the candidate hash.
From the repository root, a matching local build can be imported with
`node tools/import-local-assets.mjs --from grblHAL-STM32F4 --only firmware`.
A different hash is a different candidate: the native verifier will reject it.
Do not edit the manifest to bypass that check. The source export is not a claim
of an independently reproduced binary or completed electrical acceptance.

Imported files are ignored by Git. Packaging them locally does not establish
permission for a public binary distribution. See [distribution notes](DISTRIBUTION.md).
