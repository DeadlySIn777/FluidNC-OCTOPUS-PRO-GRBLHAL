#!/usr/bin/env python3
"""Compile and run the real MR1 diagnostic module against mocked GPIO/streams.

Requires a host C compiler. Example: python tools/test_mr1_alarm.py --cc "zig cc"
No serial ports or controller hardware are opened.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import shlex
import subprocess
import tempfile


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cc", default=os.environ.get("CC", "cc"))
    args = parser.parse_args()
    fixture = Path(__file__).resolve().parent / "tests" / "mr1_alarm"
    compiler = shlex.split(args.cc, posix=os.name != "nt")
    compiler = [part.strip('"') for part in compiler]
    with tempfile.TemporaryDirectory(prefix="mr1-alarm-test-") as temporary:
        for variant, flags in (
            ("production", []),
            ("servo-axis-lab", ["-DMR1_SERVO_AXIS_LAB=1"]),
            ("disabled", ["-DMR1_ALARM_DIAGNOSTICS_ENABLE=0"]),
        ):
            executable = Path(temporary) / (variant + (".exe" if os.name == "nt" else ""))
            subprocess.run(compiler + ["-std=c11", "-Wall", "-Wextra", "-Werror"]
                           + flags + ["-I", str(fixture), str(fixture / "test_mr1_alarm.c"),
                                      "-o", str(executable)], check=True)
            subprocess.run([str(executable)], check=True)
            if variant != "disabled":
                subprocess.run([str(executable), "chain-existing-callbacks"], check=True)
            print(f"PASS: {variant}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
