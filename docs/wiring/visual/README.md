# MR1 visual wiring guide

Open [index.html](index.html) in your browser. Choose a system, cable and connection to see both named endpoints and print matching cable labels.

Use **Drive plugs & colors** for the P1–P5 connector tables. [Encoder](index.html#encoder) shows six DB15 pin/color mappings plus the separate shield; [motor](index.html#motor) shows numbered GX16 phases and both published color variants. Neither motor variant is assumed installed. [Home switches](index.html#endstops) explains the reported factory shared Y2/Z circuit and the four independent signals required by this build. Pin references also appear beside the selected cable's trace.

Earlier preparation notes remain preserved when the schedule changes. **Export earlier notes** downloads the older record without transferring its checks to the new schedule.

**The board reference image requires internet; wire tables, the cabinet photograph and preparation notes work offline.** An official-source link remains available if the board image cannot load. Component regions locate groups, never connector cavities.

Preparation checks mean identified, labelled and route checked. They do not approve electrical connections, energization or machine motion. Reserved/rollback circuits are hidden by default and remain explicitly identified when shown.

Maintained source, build instructions and test commands are in [tools/visual-wiring](../../../tools/visual-wiring/README.md). See [asset provenance](../../../tools/visual-wiring/ASSET-PROVENANCE.md) for the project-provided cabinet photo and the externally referenced manufacturer image.

`BUILD-MANIFEST.json` identifies source hashes, generated file hashes and build-time structural checks. It does not assert that test suites, browser inspection or hardware commissioning were performed by the builder.
