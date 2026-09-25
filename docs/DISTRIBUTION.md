# Distribution scope

This update publishes **engineering source**, retaining the existing FluidCNC MIT
attribution for project-authored application code. It is not a commissioned
machine release or prebuilt public firmware release.

The firmware driver/core carry GPL-3.0-or-later notices. Vendor components retain
their own notices; root MIT does not relicense them. Source revisions are recorded
in `grblHAL-STM32F4/SOURCE-REVISION.json`. Component license texts remain in their
source directories and `mr1-control/THIRD-PARTY-NOTICES.md`.

The combined local firmware links ST code under SLA0044 terms, which need
reconciliation with the firmware GPL terms before a public combined binary
release:

- the USB device middleware in
  `grblHAL-STM32F4/Middlewares/ST/STM32_USB_Device_Library/`, whose supplied
  `LICENSE.txt` is SLA0044 Rev5;
- the CubeMX-generated `Src/stm32f4xx_it.c`, `Src/stm32f4xx_hal_msp.c`,
  `Inc/main.h` and `Inc/stm32f4xx_it.h` (all under `grblHAL-STM32F4/`), whose
  headers state they are licensed under SLA0044 (`www.st.com/SLA0044`). These are
  compiled into every image, including the MR1 production build.

The ST files in `grblHAL-STM32F4/USB_DEVICE/App/` and `USB_DEVICE/Target/` (also
linked into the MR1 image) say their terms are in a LICENSE file in the
component's root directory, but no LICENSE file is present there; their
applicable terms are therefore unresolved as well. The STM32F4 HAL
(BSD-3-Clause) and CMSIS (Apache-2.0) keep their own `LICENSE.txt` files.

This update preserves source notices and omits the compiled image. It makes no
new compatibility or relicensing claim.

These integrations remain in the app, with the reference files excluded until
redistribution terms are recorded:

- Manufacturer MR1/SMW CAD and the locally supplied custom fixture CAD.
- Autodesk-derived Fusion CPS and vendor benchmark output captures.
- Copies of BIGTREETECH images and manufacturer manuals. The public guide links
  the original publisher and loads its board image from there. The user's cabinet
  photograph remains a project-supplied reference without manufacturer endorsement.

Exact local artifact hashes and import instructions are in
[LOCAL-ASSETS.md](LOCAL-ASSETS.md). Availability, attribution and a hash do not
themselves establish a redistribution grant.

Earlier public history and archived code remain intact; this review is not a
complete legal audit of historical material. No credentials, machine acceptance
journals, installed runtime or node_modules are included in this source update.

