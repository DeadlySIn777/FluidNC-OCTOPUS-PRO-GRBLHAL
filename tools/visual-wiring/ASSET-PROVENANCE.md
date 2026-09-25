# Visual reference provenance

This file distinguishes source provenance from physical acceptance and redistribution permission. The repository's application license does not assign rights to manufacturer materials.

## Project cabinet photograph

- Included file: `tools/visual-wiring/assets/cabinet.jpg`.
- Original project location: `mr1/wiring-map/assets/cabinet.jpg` in the user's existing MR1 project.
- SHA-256: `81e2fe6d38b6fa4cf4b828ce97f92e4a800627b87dbb24f9f4254f2b3baf0ef4`.
- Dimensions: 1152 × 1536. Exact byte copy; no crop, retouching or invented wiring.
- Supplied as part of the user's project and retained for the requested source update. Photographer and capture date are not separately recorded; no additional third-party license is asserted.
- No EXIF, XMP or IPTC signatures were detected in the copied JPEG during the source audit. This is not a guarantee about all possible metadata.

Component placement was recovered from the existing project's `mr1/wiring-map/genoverlay.py` and `overlay.json`; the historical hashes and expressions are retained in `asset-layout.json`. Those legacy generators are not build dependencies and are not distributed here. The current source contains only component positions, with physical terminal positions and installed axis identities explicitly unverified.

## Official Octopus Pro v1.1 pinout

- Publisher: BIGTREETECH.
- Official file: [BIGTREETECH Octopus Pro V1.1-Pin.jpg](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro/blob/60a01f412959b62c349ba00da15b45232b7d90c5/Hardware/BIGTREETECH%20Octopus%20Pro%20V1.1-Pin.jpg).
- Raw source: [commit-pinned original image](https://raw.githubusercontent.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro/60a01f412959b62c349ba00da15b45232b7d90c5/Hardware/BIGTREETECH%20Octopus%20Pro%20V1.1-Pin.jpg).
- Upstream commit: `60a01f412959b62c349ba00da15b45232b7d90c5`.
- SHA-256: `d360491ad8e1f738b1e784bfd62cc2c0f2b4c396d6cd069b9743d62aab0ee285`.
- Dimensions: 1912 × 1534; 1,325,852 bytes; diagram date 2023-11-02.
- Checked 2026-09-25: the upstream GitHub API returned no detected repository license, and its complete tree contained no LICENSE/COPYING file. No image redistribution grant was inferred from the repository's description as open-source material.

Accordingly, the public source and default generated page do not embed or copy the board JPG. They reference the pinned official URL. The builder never fetches it. The independently retrieved source bytes matched the existing reviewed image hash during provenance inspection; the browser does not automatically verify the downloaded bytes or any physical hardware.

An optional local-image argument can produce a private offline copy after an exact SHA-256 check. That does not establish permission to redistribute the embedded image. If the official reference is unavailable, the guide shows an explicit fallback link and retains the textual terminal table; it does not manufacture a replacement pinout.

The component rectangles in `board-regions.json` are approximate locations, not individual contact or mating-plug cavity maps. The EXP highlight deliberately includes both EXP housings.

## Linked manufacturer documents

The CL57T V4.1 manual is linked at [STEPPERONLINE's official download](https://www.omc-stepperonline.com/download/CL57T-V41_user_manual.pdf). Board schematic references point to [BIGTREETECH's pinned Hardware directory](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro/tree/60a01f412959b62c349ba00da15b45232b7d90c5/Hardware). Vendor PDF bytes are not part of this visual source directory or its generated page.
