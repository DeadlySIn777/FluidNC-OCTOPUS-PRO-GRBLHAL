#!/usr/bin/env python3
"""Regression tests for the MR-1 operator workflow safety policy."""

from __future__ import annotations

import unittest

from validate_mr1_macros import MacroAuditError, normalized_commands


class MacroPolicyTests(unittest.TestCase):
    def test_approved_probe_selection_is_accepted(self) -> None:
        text = "M5\nM9\nG65 P5 Q1\n"
        self.assertEqual(normalized_commands(text), ["M5", "M9", "G65P5Q1"])

    def test_comments_cannot_hide_extra_words(self) -> None:
        text = "M5 (stop spindle)\nM9 ; stop coolant\nG65P5Q0\n"
        self.assertEqual(normalized_commands(text), ["M5", "M9", "G65P5Q0"])

    def test_motion_and_probe_cycles_are_rejected(self) -> None:
        unsafe = ("G0Z0", "G1X1F10", "G38.2Z-1F10", "$H", "$X")
        for command in unsafe:
            with self.subTest(command=command):
                with self.assertRaises(MacroAuditError):
                    normalized_commands(command)

    def test_spindle_coolant_and_setting_changes_are_rejected(self) -> None:
        unsafe = ("M3S500", "M4S500", "M7", "M8", "$341=3", "$RST=*")
        for command in unsafe:
            with self.subTest(command=command):
                with self.assertRaises(MacroAuditError):
                    normalized_commands(command)

    def test_concatenated_command_is_rejected(self) -> None:
        with self.assertRaises(MacroAuditError):
            normalized_commands("G65P5Q0M3S8000")

    def test_unbalanced_comments_are_rejected(self) -> None:
        with self.assertRaises(MacroAuditError):
            normalized_commands("M5 (unterminated")


if __name__ == "__main__":
    unittest.main()
