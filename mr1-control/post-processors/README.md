# MR-1 CAM Post Processors

This folder contains safety-gated three-axis posts for the converted Langmuir
MR-1. Both posts target the same contract in `contract.json`; every generated
file must also pass the bundled NC validator before preview, check mode, or any
future machine use.

## Current Proof Level

| Post | Evidence on 2026-08-26 | Remaining proof |
| --- | --- | --- |
| Fusion `MR1_grblHAL.cps` | Interrogated and executed by Autodesk post engine 5.318.0 with warnings treated as errors. Autodesk face, two-tool, deep-drilling, and thread-milling benchmarks post and validate. Tapping, probing, 3+2, and controller-compensation benchmarks fail closed. | Import into the operator's Fusion library, post the real MR-1 jobs, preview, then complete controller check mode, single-block air cuts, and physical commissioning. |
| SolidCAM `MR1_grblHAL.gpp` | GPPL structure, fail-closed paths, and the version-native VMID installer are regression-tested. The installer rejects rotary templates and DTD-bearing XML. | SolidCAM is not installed on this development PC, so GPPL compilation/import and real SolidCAM toolpath output are **not yet proven**. Complete the acceptance matrix in the target SolidCAM version before machine use. |

Neither post is permission to run the unfinished machine. Physical motion,
spindle, tool-setter, probe, and sender commissioning gates still apply.

## Qualified Contract

- Three linear axes only: X, Y, Z.
- `G54` through `G59`; no extended offsets or coordinate rotation.
- Absolute `G90`, feed-per-minute `G94`, and `G20` or `G21`.
- Linear and IJK circular motion: `G0`, `G1`, `G2`, `G3` in `G17`/`G18`/`G19`.
- Helical thread milling is supported as ordinary `G2`/`G3` motion.
- Drilling cycles are expanded into explicit moves; canned `G73`-`G89` are not allowed in final NC.
- Clockwise spindle only: `M3`, 1-8000 RPM. `M4` is blocked.
- Flood coolant only: `M8`/`M9`. `M7` is blocked.
- Cutting feed ceiling: 2540 mm/min. Pure-Z feed ceiling: 1016 mm/min.
- Fixed safe retract: `G90 G53 G0 Z-2.000` mm or `Z-0.0787` inch. No machine X/Y moves.
- No work motion before the first qualified `G53` retract.
- After every `G53` retract and every `G54`-`G59` change the work Z is unknown:
  the next moves must place X and Y at the retract height (`G0 X.. Y..`) before
  any Z word. A combined `G0 X.. Y.. Z..` approach is blocked.
- Comments close on their own line and never nest: grblHAL ends a comment at
  its first `)`, so a `(` inside a comment is blocked.
- Plain ASCII only. `!`, `?`, `~`, control bytes and non-ASCII characters are
  blocked even inside comments (grblHAL acts on realtime bytes immediately);
  TAB is allowed. Executable text after comments are removed is limited to
  120 bytes per line, and the whole file to 5 MB, matching the controller
  loader.
- Manual change only: `G49`, `Tn`, `M0`; no `M6`.
- Cutter compensation must be calculated in CAM. Posted NC remains `G40`; `G41`/`G42` are blocked.
- Rigid tapping, CAM probing, rotary motion, transforms, macros, pass-through NC, and subprograms are blocked.

`G49` in the file deliberately clears the previous tool-length offset before a
new tool. A future qualified protected setter may apply runtime `G43.1` after
the `M0`; the post does not write guessed length offsets into the file.

## Fusion 360

1. Open Fusion's **Manufacture** workspace and its **Post Library**.
2. Import `fusion/MR1_grblHAL.cps` into **My Posts**, or add this `fusion`
   directory as a linked post folder.
3. In the NC Program, select **MR-1 grblHAL - Octopus Pro**.
4. Use a three-axis setup whose orientation matches the physical machine and
   choose only G54-G59. A work offset translates the origin; it does not rotate
   a vise or toolpath.
5. Set contour compensation to **In Computer**. Use Fusion's thread-milling
   operation for threads; do not select tapping.
6. Post, then run the validator before loading the file:

```powershell
npm run post:validate -- "C:\path\to\program.nc"
```

Run the Autodesk acceptance suite after every CPS change:

```powershell
npm run post:test:fusion
```

That command locates the installed Fusion `post.exe` and Autodesk Post Processor
Utility benchmark files. Override discovery with `MR1_FUSION_POST_ENGINE` and
`MR1_FUSION_BENCHMARK_ROOT` when needed.

## SolidCAM

SolidCAM pairs a GPPL `.gpp` post with a version-specific `.vmid` machine file.
The installer therefore clones a genuine three-axis VMID from the installed
SolidCAM version, leaves the source untouched, and patches only the MR-1 name,
controller, 8000 RPM spindle ceiling, and X/Y/Z limits/rates/acceleration.
It preserves the template's schema and graphics; it does **not** import the MR-1
STEP assembly or establish collision-proof machine simulation. Configure and
validate SolidCAM machine graphics as a separate project before relying on them.

List detected templates:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\post-processors\solidcam\install-mr1-solidcam-post.ps1 -ListCandidates
```

Install from the selected version-native template:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\post-processors\solidcam\install-mr1-solidcam-post.ps1 `
  -BaseVmid "C:\Users\Public\Documents\SolidCAM\SolidCAM20XX\Gpptool\THREE_AXIS_TEMPLATE.vmid"
```

Use `-SolidCamRoot` for a nonstandard `Gpptool` folder. Use `-OutputDirectory`
only for an intentional staging install. Existing MR-1 files are never replaced
unless `-Force` is supplied. The installer writes
`MR1_grblHAL.install.json` with source/output hashes and the applied contract.

Restart SolidCAM, select `MR1_grblHAL` as the CAM-Part Machine ID, and compile or
post these acceptance jobs:

| Job | Required result |
| --- | --- |
| Face with one tool | Posts; validator passes |
| Two tools | Each tool gets safe G53 Z, G49, Tn, M0; the first move after each is XY-only |
| Deep/peck drilling | Explicit G0/G1 moves; no G81-G89 |
| Internal thread mill | Helical G2/G3; validator passes |
| Right-hand tapping | Post refuses with `MR1 POST BLOCKED` |
| Control compensation | Post refuses G41/G42 |
| 4-axis/indexed job | Post refuses rotary motion |
| CCW spindle or mist | Post refuses M4/M7 |

Do not edit a refused NC file into submission. Record the SolidCAM version and
GPPL diagnostic, fix the source post, rerun all acceptance jobs, and retain the
new evidence.

## Tool-Change Workflow

Every program begins and ends with the qualified machine-Z retract. At each
tool:

1. The post stops coolant and spindle, retracts to machine Z -2 mm, and clears
   the previous length offset with `G49`.
2. It emits `Tn` and pauses with `M0`.
3. The operator changes the tool and runs the commissioned protected tool-setter
   workflow through the one process that owns the controller port.
4. Resume only after the setter reports success, returns to safe travel Z, and
   the displayed tool number/offset are independently checked.

The custom UI's physical setter path is still locked today. Until Stage 8
commissioning proves this exact pause/set/resume sequence on hardware, these
posts are for CAM, validator, preview, and bench acceptance only.

## Release Gate

For every real job: post from a frozen CAM revision, validate, load into MR-1
Control for visual review, compare stock/fixture/WCS/tool data, run controller
check mode, dry-run above stock, single-block first use, and inspect the result.
Archive the CAM file, post hash, NC hash, validator result, tool list, WCS, and
machine/firmware identity together.

## Primary Documentation

- [Autodesk: Post processing overview](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-POST-PROCESSING-OVERVIEW.htm)
- [Autodesk: Importing personal posts](https://help.autodesk.com/view/fusion360/ENU/?caas=caas%2Fsfdcarticles%2Fsfdcarticles%2FHow-to-add-a-Post-Processor-to-your-Personal-Posts-in-Fusion-360.html)
- [Autodesk: Post Library selection and linked folders](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-REF-NC-PROGRAM-POST-SELECTION.htm)
- [Autodesk CAM post API reference](https://cam.autodesk.com/posts/reference/index.html)
- [Autodesk: Testing post processors](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/GUID-3F1D198D-F647-48A4-BAB3-D4FD4813B0F8.htm)
- [SolidCAM: postprocessor and GPPL/VMID overview](https://solidcam.com/subscription/postprocessors/)
- [SolidCAM documentation portal](https://us.solidcam.com/documentation/)
