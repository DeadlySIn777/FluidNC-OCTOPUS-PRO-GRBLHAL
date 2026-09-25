# Distribution scope

This update publishes **engineering source**, retaining the existing FluidCNC MIT
attribution for project-authored application code. It is not a commissioned
machine release or prebuilt public firmware release.

The firmware driver/core carry GPL-3.0-or-later notices. Vendor components retain
their own notices; root MIT does not relicense them. Source revisions are recorded
in `grblHAL-STM32F4/SOURCE-REVISION.json`. Component license texts remain in their
source directories and `mr1-control/THIRD-PARTY-NOTICES.md`.

The combined local firmware uses ST USB middleware whose supplied SLA0044 terms
need reconciliation with the firmware GPL terms before a public combined binary
release. This update preserves source notices and omits the compiled image.
It makes no new compatibility or relicensing claim.

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

