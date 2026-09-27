# Alarm and command-supply update — 27 September 2026

The visual guide now identifies the single DRIVER0 VCC_IO +5 V takeoff and the
separate ALM/COM− field circuit. See [command supply](mr1/COMMAND_SUPPLY.md),
[alarm assembly](mr1/ALARM_INTERFACE.md), and the
[57-row terminal schedule](mr1/alarm-interface-wires.csv).

Four selected Weidmüller 2618530000 relays provide the PB1 series aggregate and
separate PG12–PG15 diagnostic contacts. A selected Mean Well DDR-15G-24 provides
the isolated alarm supply. These are required new parts, not an inventory claim.
The installed drive's healthy-conducting output setting and power-loss response
still require verification. All physical acceptance flags remain false.

The source candidate adds read-only `MR1F:1,mask` raw input snapshots. The app
reports four axis input levels only from a fresh supported report; missing,
malformed, duplicate and older reports produce UNKNOWN. Snapshots can miss
short events. PB1 remains the protective drive-fault path. An integration test
confirms that PB1 disarms and aborts streaming even when all diagnostic bits
are low.

Validation completed:

- Actual firmware C-module host tests: all 16 masks, callback chaining,
  production and servo-lab mappings, and compile-time disabled configuration.
- Production ARM build and binary-vector checks passed. Candidate SHA-256:
  `8e9318d9395fc43a7ee0674b55252d387327609f0ee7c4bb0101ad48af108d37`.
- Application regression: 232 tests, 226 passed, six explicit optional/platform
  skips, zero failures on Node 24.20.0 for Windows.
- Visual-guide checks: 49 model and eight cable-data tests passed. Generated
  JavaScript syntax, reference hashes, HTML IDs and labels passed.
- Production web build and the 763-file source-export integrity check passed.

Node 24.19.0 on Windows aborts during the existing shutdown test after sending
the required stop/reset bytes. The failure also reproduces on the unchanged
baseline; both pass on 24.20.0. Use the corrected runtime for Windows testing and
packaging. The official [Node 24.20 release notes](https://nodejs.org/en/blog/release/v24.20.0)
include the matching shutdown fix. This update does not replace an installed
Windows runtime or restart a running controller service.

No browser visual inspection was completed: earlier local-preview access was
blocked and no workaround was used. The firmware candidate has not been flashed;
the pinned deployment image remains unchanged. No machine hardware was accessed,
energized or qualified. Reset/enable protection, cabinet safety, spindle and
the remaining commissioning work are still required before machining.
