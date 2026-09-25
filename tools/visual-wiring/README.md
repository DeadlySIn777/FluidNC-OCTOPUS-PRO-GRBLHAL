# MR1 visual wiring source

This guide follows the corrected 56-cable schedule in `docs/wiring/mr1/cable-schedule.csv`. It records unpowered identification, matching labels and route planning. It does not record completed electrical acceptance or grant machine motion.

The public page is `docs/wiring/visual/index.html`. Cable tables, cabinet photograph and preparation notes work offline. The unchanged official Octopus board reference image requires internet; if it cannot load, the board's terminal table remains usable and an official-source link is shown. Image regions locate component groups, never connector cavities.

## Build and test

Use Python 3.10 or newer and Node.js 24. Python uses only its standard library; this guide has no npm dependencies. From the repository root:

```text
python tools/visual-wiring/cable-data.py
python tools/visual-wiring/cable-data.py --test
python tools/visual-wiring/cable-data.py --check
node --test tools/visual-wiring/model.test.mjs
python tools/visual-wiring/build.py
```

The generator preserves the CSV's original fields and derives presentation metadata. Regenerate after changing any referenced wiring document. Source paths and file hashes are repository-relative. The builder checks those inputs, HTML IDs, label targets, cable/group mappings, image-region bounds and absence of controller network APIs. These build checks do not replace the separate test suites, browser inspection or hardware qualification.

The build writes `index.html`, `BUILD-MANIFEST.json` and `SHA256.txt` in `docs/wiring/visual`. Given unchanged inputs and build mode, these files are deterministic. No old guide, vendor PDF, Node runtime or previous package is needed. The builder does not start a server, open a browser or access hardware.

## Board image and private offline builds

The public build references BIGTREETECH's exact commit-pinned original image. It does not include the manufacturer's image bytes, and it does not claim that a runtime-loaded image was hash-verified. See [asset provenance](ASSET-PROVENANCE.md).

For a private offline build, supply your own local copy of that exact official image:

```text
python tools/visual-wiring/build.py --board-image "path/to/official-pinout.jpg" --output "path/to/private-output"
```

The builder rejects a different image before generating output. The private output embeds the image and is not the default public artifact; do not publish it without resolving the image's redistribution terms. Its manifest identifies the embedded-private mode and the build-time hash check. No image, firmware or physical connection becomes approved through this option.

Project-provided cabinet imagery and component placement are reference material. Planned axis identities, actual terminals, interfaces, supplies, protection and physical measurements remain unverified. Manufacturer documents are referenced through official links rather than copied here.

The one-time migration scripts and old generated artifacts were intentionally not included. Make changes in the maintained source files, run the commands above, and review the generated diff before publishing.
