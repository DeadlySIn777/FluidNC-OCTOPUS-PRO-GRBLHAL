MR-1 CONTROL - PORTABLE WINDOWS TEST
====================================

This package is a deterministic virtual MR-1 control test.
Fixture WCS, bounded jog, protected tool-setter and touch-probe transactions,
plus the exact controller preflight contract are enabled against the virtual
controller only.
It cannot connect to the Octopus, ESP32, spindle, or machine hardware.

TO RUN ON THE OTHER PC

1. Copy the ZIP to the Windows PC.
2. Right-click the ZIP and choose Extract All.
3. Open the extracted folder.
4. Double-click START-MR1-CONTROL.cmd.
5. Keep the black launcher window open while testing.

The control screen opens at http://127.0.0.1:5173/ in the default browser.
Close the launcher window or press Ctrl+C to stop the test.

PAIRED PHONE / TABLET TEST

1. Connect the Windows PC and phone to the same trusted private Wi-Fi network.
2. Double-click START-MR1-CONTROL-PHONE-TEST.cmd instead of the normal launcher.
3. If Windows Firewall asks, allow access only on Private networks.
4. The black window prints a unique pairing link for each active LAN address.
5. Type or send that complete link to the phone. Do not share or reuse it.
6. Keep the launcher window open. Closing it invalidates that launch's token.

The pairing credential is generated randomly for each launch, stored by that
browser profile, and removed from browser history immediately. The service also
requires the exact originating web address. Use only a network you trust.

The phone layout uses the reduced 3D scene and direct local-network telemetry.
It can exercise typed WCS, jog, tool-setter, and touch-probe controls against the
virtual MR-1 only. It cannot connect to serial hardware or command the physical
machine. The desktop and phone share one virtual transaction owner; a second
browser cannot silently take over an active command.

Most phone browsers can save the page as a home-screen shortcut. Full PWA
installation and offline service-worker caching normally require trusted HTTPS;
the portable LAN test intentionally uses plain local HTTP and makes no offline
phone claim.

SYSTEM HEALTH AND LATENCY

Use the heart icon to open System Health. It shows current and p50/p95/p99
service round-trip, source-to-visible, bridge-arrival, and render-queue timing,
plus sequence gaps, duplicates, resets, reconnects, controller poll interval,
and render profile. Phone timestamps are corrected from paired read-only timing
samples so phone/Windows clock skew does not look like stale telemetry.

RUN 10 S CHECK observes only telemetry, browser rendering, and the local timing
endpoint. It sends no G-code and no machine transaction. Its JSON export is UI
transport evidence only; it does not prove Octopus interrupt timing, step pulses,
EMI immunity, or physical motion.

COMMISSIONING RECORD

Use the shield-check icon to open the 13-stage, 58-check Commissioning Record.
It identifies the next dependency blocker and stores check-specific operator,
instrument, measurement, notes, and locally SHA-256-hashed artifact metadata.
Physical checks require the current machine UUID, a real controller-preflight
fingerprint, and the exact firmware SHA-256. Simulator results cannot satisfy
those checks. Stale, edited, and cross-machine records fail closed.

The record has its own sealed .mr1-commissioning.json export and also travels in
the normal machine backup. Even a complete record cannot enable physical motion;
this portable package contains no physical command transport.

MACHINE BACKUP AND EVENT JOURNAL

Use the disk icon in the top bar to export or restore the nine machine setup
sections. Imports are SHA-256 checked, reviewed as a diff, and blocked while the
virtual controller is connected. The same panel downloads the append-only event
journal. Hash-only evidence for changes to the ten tracked browser configuration
keys queues locally while offline and is sealed after the bridge connects; raw
setting values and the pairing token are never copied into those records. Journal
files are retained under %LOCALAPPDATA%\MR1-Control\journal.
Keep exported machine bundles somewhere outside browser data before moving PCs.

Every launch verifies the retained journal before virtual commands are enabled.
A clean prior stop clears automatically. An unclean stop or unfinished virtual
transaction shows a restart-review hold and requires the exact displayed digest.
Journal corruption cannot be bypassed. Restart review never permits physical
machine commands; this package has no physical command transport.

CONTROLLER FIRMWARE AND SETTINGS

Use the sliders icon for the deep controller workspace. The SETTINGS tab exposes
all 65 pinned MR-1 values with search, filters, live/profile comparison, typed
validation, staged review, and SHA-256-sealed snapshot and change-plan downloads.
This portable simulator can apply a confirmed settings plan to the virtual
controller and read it back. It cannot write settings or raw G-code to a physical
Octopus.

The FIRMWARE tab shows the exact board, MCU, image size, SHA-256, application
address, and preflight state, then opens the full Wiring > FLASH procedure. The
browser does not perform direct DFU or one-click physical flashing. Simulation
is useful for learning the workflow but is rejected as physical flash evidence.

OFFLINE WIRING DOCUMENTS

The wiring-docs folder contains the audited stock-to-Octopus conversion set.
Start with PIGTAIL_SCHEDULE.md. Items marked HOLD still require a physical
connector fit, harness trace, or meter test before purchase or termination.

OCTOPUS USB-ONLY FIRMWARE CANDIDATE

The controller-firmware folder contains the exact Octopus Pro V1.1 / F429
candidate, its manifest, SHA256SUMS.txt, and instructions. You do not need a
24 V supply to flash it. Use the control screen's Wiring > FLASH tab and follow
the bare-board sequence exactly: all machine wiring and other power physically
absent, BTT MCU USB-power jumper fitted only while USB is disconnected, FAT32
microSD firmware.bin, require FIRMWARE.CUR, archive the read-only preflight, then
remove the temporary jumper before any later 24 V MAIN connection.

Select the actual local firmware.bin in the FLASH verifier before copying it,
then select the card-produced FIRMWARE.CUR after flashing. The verifier checks
the exact bytes locally and uploads nothing. Its sealed record remains locked
until exact content, the card result, four operator attestations, and an exact
physical read-only preflight all agree; simulator evidence is rejected.
That preflight must be a direct serial report from the pinned MR-1 F429 profile
within 15 minutes, with all 65 settings exact, no warning/blocker, clear inputs,
and an Idle or Alarm machine state. Cached and wrong-profile reports are rejected.

The candidate is source-validated but has not been physically flashed to this
Octopus. It grants no machine-motion permission.

CAM POST PROCESSORS

The post-processors folder contains the Fusion 360 CPS, SolidCAM GPPL source,
version-native SolidCAM VMID installer, shared contract, acceptance evidence,
and full instructions. These are safety-gated development posts, not permission
to run an uncommissioned machine.

Validate a posted file from this extracted folder:

  runtime\node.exe tools\validate-post-output.mjs "C:\path\to\program.nc"

PASS means the file matches the qualified NC subset. It does not replace visual
review, controller check mode, air cutting, or physical commissioning.

REQUIREMENTS

- Windows 10 or Windows 11, 64-bit
- A current Chrome, Edge, or Firefox browser
- No install, administrator account, internet connection, or Node.js setup

TROUBLESHOOTING

- Extract the ZIP first. Do not launch the CMD file from inside the ZIP.
- If it says another copy is running, close every older MR-1 Control launcher.
- The normal launcher keeps ports 5173 and 8787 on 127.0.0.1 only.
- The phone-test launcher exposes those ports to the trusted private LAN for
  that virtual, token-paired session only.
- Windows may show a security prompt because this local test package is not signed.
