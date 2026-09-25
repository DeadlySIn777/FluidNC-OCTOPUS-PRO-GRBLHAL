"""Normalize the corrected MR1 cable schedule for a reference-only visual map.

Python standard library only. No hardware access and no physical acceptance data.
Usage: python cable-data.py       # regenerate adjacent cable-data.json
       python cable-data.py --check  # assert provenance, content and invariants
       python cable-data.py --test   # run focused positive and negative checks
"""
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import unittest


HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parents[1]
REFERENCE = REPOSITORY / "docs" / "wiring"
SOURCE_FIELDS = (
    "cable_id", "from_device", "from_terminal", "to_device", "to_terminal",
    "cable_class", "shield_termination", "state", "notes",
)
AXES = ("X", "YL", "Z", "YR", "shared")
FAMILIES = ("command", "motor", "encoder", "power", "home", "fault", "probe", "controls", "spindle", "other")
DISPOSITIONS = ("trace-only", "hold", "reserved", "rollback")
AXIS_NAMES = {"X": "X", "YL": "Y-left", "Z": "Z", "YR": "Y-right", "shared": "shared"}
RESERVED = {
    "SP-RS485-LOGIC": "Future digital spindle path; MODBUS_ENABLE=0 and no approved MCU/drive profile.",
    "SP-RS485-FIELD": "Future digital spindle path; no approved installed-drive connector/profile.",
    "SP-STATUS": "Future spindle supervision; installed output assignments and polarity are unproved.",
    "SP-CONTROL": "Future spindle supervision; SON permission is unproved and CMODE/ACLR remain locked.",
    "SP-ENCODER": "Future spindle feedback; no approved STM32 timer/pin or receiver map.",
    "SP-INDEX": "Future spindle index; sensor is unselected and mounting unqualified.",
    "SP-ORIENT": "Future M19/position-control path; board pins and electronic gearing are unapproved.",
    "TEMP-SPINDLE": "Future temperature circuit; actual sensor and pinout are unidentified.",
}


def source_record(path: Path) -> dict:
    data = path.read_bytes()
    return {"path": path.resolve().relative_to(REPOSITORY).as_posix(), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def read_source(reference: Path) -> tuple[list[dict], dict]:
    path = reference / "mr1" / "cable-schedule.csv"
    text = path.read_text(encoding="utf-8-sig")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    if tuple(reader.fieldnames or ()) != SOURCE_FIELDS:
        raise ValueError("Corrected cable-schedule.csv schema changed; review it before regeneration.")
    rows = list(reader)
    if len(rows) != 56 or len({row["cable_id"] for row in rows}) != 56:
        raise ValueError("The reviewed schedule must retain all 56 unique cable IDs.")
    if any(set(row) != set(SOURCE_FIELDS) or any(value is None for value in row.values()) for row in rows):
        raise ValueError("Malformed source CSV record.")
    return rows, {
        "csv": source_record(path),
        "readiness": source_record(reference / "MR1-wiring-readiness.md"),
        "second_pass": source_record(reference / "MR1-wiring-second-pass.md"),
        "spindle_supervision": source_record(reference / "mr1" / "SPINDLE_SUPERVISION.md"),
    }


def axis_for(cable_id: str) -> str:
    match = re.search(r"(?:^|-)(YL|YR|X|Z)(?:-|$)", cable_id)
    return match.group(1) if match else "shared"


def family_for(cable_id: str) -> str:
    for prefix, family in (("CMD-", "command"), ("MOT-", "motor"), ("ENC-", "encoder"),
                           ("PWR-", "power"), ("HOME-", "home"), ("ALM-", "fault"),
                           ("SP-", "spindle")):
        if cable_id.startswith(prefix):
            return family
    if cable_id == "FAULT-AGG":
        return "fault"
    if cable_id in ("PROBE-01", "TOOL-01"):
        return "probe"
    if cable_id in ("SAFE-MON", "DOOR-MON", "HOLD-01", "START-01", "FLOOD-CTL", "MIST-CTL"):
        return "controls"
    return "other"


def endpoint_status(device: str, terminal: str) -> str:
    if any(word in terminal.upper() for word in ("UNRESOLVED", "UNASSIGNED", "UNSELECTED", "UNVERIFIED")):
        return "unresolved"
    if "community" in terminal.lower():
        return "community-reference"
    if device == "MR1 interface" or "candidate" in device.lower() or "supervision interface" in device.lower() or device == "Fault conditioner":
        return "planned-interface"
    return "reference-only"


def tasks_and_evidence(row: dict, axis: str) -> tuple[str, list[str]]:
    cable_id = row["cable_id"]
    name = AXIS_NAMES[axis]
    if row["state"] == "ROLLBACK-ONLY":
        return (
            f"Identify and preserve the stock {name} DM860T cable as a separate rollback item; do not include it in the CL57T route.",
            [f"Photographed identity of the stock {name} DM860T and its original harness.",
             "Original unpowered continuity and connector-orientation record for restoration.",
             "Clear physical segregation from polarized CL57T P4 power wiring."],
        )
    if cable_id == "PWR-24-01":
        return (
            "Identify the control PSU pair and Octopus MAIN POWER markings; record the isolated route and both endpoint views.",
            ["Actual PSU identity, output polarity and board MAIN POWER terminal orientation.",
             "Reviewed conductor and branch-protection selection; MAIN is distinct from MOTOR/BED POWER.",
             "Recorded PSU/logic/USB/protective-earth return topology."],
        )
    if cable_id.startswith("PWR-36-"):
        return (
            f"Trace the proposed {name} star branch to that drive's marked P4 +VDC/GND pair; record polarity from markings, not wire color.",
            [f"Actual {name} drive identity and photographed polarized P4 mating view.",
             f"Unpowered end-to-end continuity, route length and reviewed protection for the {name} branch.",
             "Reviewed supply/load design and measured ripple/regeneration peak; no higher-voltage upgrade is qualified."],
        )
    if cable_id == "PWR-5I-HOME":
        return (
            "Locate the proposed home-field supply route; leave its module connections undefined until the actual home circuits are traced.",
            ["Actual stock home supply voltage/current and return arrangement.",
             "Actual isolated supply and conditioner schematic, terminal map and supply-domain separation.",
             "All four home-channel combinations and either-side-unpowered behavior; no generic floating-VCC recipe."],
        )
    if cable_id.startswith("CMD-"):
        return (
            f"Identify the {name} PUL/DIR route and drive P1 markings; locate the planned interface endpoint without assigning it a physical cavity.",
            [f"Actual {name} socket/adapter fit, mating view and signal continuity; schematic contact IDs are not a physical pin-counting view.",
             f"Released interface terminal map for {row['from_terminal']}; the J-name is a planned interface name.",
             f"Photographed {name} S3 command-level selection and loaded PUL/DIR current, pulse and direction-setup captures.",
             "Confirmed ENA left unconnected and separate hardware stop; no enable safety function is credited."],
        )
    if cable_id.startswith("MOT-"):
        return (
            f"Match the {name} motor lead to the same-axis drive P3; trace the isolated factory cable without treating colors as phase identities.",
            [f"Matching {name} motor/drive labels and actual P3/GX16 connector views.",
             "Unpowered phase-pair continuity and terminal-to-terminal mapping; no assumed GX16 cavities.",
             "Measured route length, flex/strain relief and shield plan; preserve moulded ends.",
             "Verified motor/encoder pairing, secure mechanical restraint and supported gravity-loaded Z before any separate bench qualification."],
        )
    if cable_id.startswith("ENC-"):
        return (
            f"Trace the matched {name} encoder harness back to the same drive; keep its route distinct from the motor-phase cable.",
            [f"Matched {name} kit/harness identity and actual connector orientation/continuity.",
             "Verified EA/EB pair and VCC/EGND identities; P2 VCC is drive-supplied, not an external field-power input.",
             "Measured route length and qualified extension/shield arrangement; no color or DB9 assumption."],
        )
    if cable_id.startswith("ALM-"):
        return (
            f"Trace only the {name} ALM/COMO pair to its own planned isolated conditioner; identify {row['to_terminal']} as an interface name, not a proved pinout.",
            [f"Actual {name} alarm-output configuration and healthy/alarm/power-loss/open-cable truth table.",
             "Released per-channel current-limited isolation circuit and real terminal map.",
             "Proved conditioned healthy-output supervision into PB1, with separate diagnostic indication; no series chain of raw alarm terminals."],
        )
    if cable_id.startswith("HOME-FIELD-"):
        return (
            f"Identify and preserve the stock {name} home harness; trace supply, return and independent signal before assigning any candidate-module terminal.",
            [f"Actual {name} switch/sensor type and isolated conductor continuity map.",
             "Measured stock supply and signal behavior; conductor color/count is not proof.",
             "Traced candidate conditioner circuit, part values and supply domains; independent Y-left/Y-right signals."],
        )
    if cable_id.startswith("HOME-LOGIC-"):
        return (
            f"Locate the intended {row['to_terminal']} signal/return by reference and board continuity; leave the candidate conditioner output unresolved.",
            ["Actual board revision, keying and mating-side continuity; STOP 5V cavity remains empty.",
             f"Released conditioner output/return map for the {name} channel.",
             "Healthy-low and trigger/open/power-loss-high behavior, all 16 input combinations and either side unpowered."],
        )
    if cable_id in ("PROBE-01", "TOOL-01"):
        target = "touch probe / PF5" if cable_id == "PROBE-01" else "tool setter / PB7"
        return (
            f"Identify the actual {target} sensor harness and planned interface endpoint; trace the unpowered cable before assigning V+/SIG/0V.",
            ["Actual sensor label, voltage/type, connector orientation and conductor continuity.",
             "Actual interface-module circuit/terminal map and separate field/controller supply domains.",
             "Independent trigger/open-cable/power-loss truth table and isolation evidence.",
             "Verified destination signal/return: PB7 uses adjacent proved GND, with PB6 and 5V unpopulated." if cable_id == "TOOL-01" else "Verified destination signal/return at T1 PF5; no field voltage on the GPIO."],
        )
    control_evidence = {
        "SAFE-MON": ["Selected safety-relay contact that is closed while the relay is energized and open on E-stop/trip (a spare NO safety output or NO auxiliary, not an NC auxiliary); relay and terminal still unselected.", "Verified TB PF3/GND orientation and monitor-only separation from safety channels; E-stop pressed and monitor wire unplugged each read E-stop (Pn:E), and $14 is never inverted to suit a wrong contact.", "Independent reviewed energy-removal/restart-prevention design; monitor continuity is not a safety-system test."],
        "DOOR-MON": ["Actual door-monitor NC contact and open/closed continuity.", "Verified PWR-DET PC0/GND mating view; adjacent 3V3 left unconnected.", "Documented separation of monitor behavior from the physical guard/safety design."],
        "HOLD-01": ["Actual feed-hold NC contact and button continuity.", "Verified T0 PF4/GND orientation and return path.", "Recorded software-hold behavior; this button is not credited as hazardous-energy isolation."],
        "START-01": ["Actual guarded cycle-start NO contact and button continuity.", "Verified EXP2 PB2/GND mating view and independent return path.", "Documented prevention of unintended starts and manual restart after faults."],
    }
    if cable_id in control_evidence:
        return (f"Trace the isolated {row['from_device']} contact pair to the intended {row['to_terminal']} reference; verify contact identity before termination.", control_evidence[cable_id])
    if cable_id == "FAULT-AGG":
        return (
            "Locate the planned supervised aggregate and intended EXP2 PB1/GND route; keep every raw field alarm off that GPIO pair.",
            ["Released aggregate circuit and actual connector orientation/return continuity.",
             "All four independently conditioned drive healthy channels plus required cabinet/spindle fault sources.",
             "Measured healthy-low / fault-open-powerloss-high behavior; healthy-open outputs require added supervision.",
             "Physical PB1 stopping proof; PG12-PG15 indication alone is not stop protection."],
        )
    if cable_id == "SP-PWM":
        return (
            "Identify both FAN0 conductors as positive and PA8 switched negative; trace the planned converter pair without grounding its switched return.",
            ["Actual FAN0 voltage-selection jumper and measured rail; 24V is not assumed.",
             "Qualified converter input circuit/load rating, isolation and off/PWM/startup behavior.",
             "Installed servo identity, actual DB44 mapping and unresolved command-voltage/RPM scaling."],
        )
    if cable_id == "SP-ANALOG":
        return (
            "Identify the candidate analog pair and archive the stock DB44 harness; treat community pins 26/10 only as references pending continuity.",
            ["Installed servo model, motor label and complete parameter archive.",
             "Actual DB44 connector viewing side, keying and end-to-end mapping; community pins are not installed-drive proof.",
             "Resolved 0-5V versus servo full-scale gain, verified analog common/isolation and measured RPM."],
        )
    if cable_id == "SP-ENABLE":
        return (
            "Identify the proposed dry-contact route and preserve the stock servo harness; leave community pin 16/return unassigned pending the actual map.",
            ["Installed servo enable function, exact return and DB44 continuity/orientation.",
             "Qualified contact interface and hardwired spindle-permit design.",
             "Verified startup, loss-of-power, stop and restart behavior; no software-only permit."],
        )
    if cable_id == "SP-ALARM":
        return (
            "Trace the preserved servo harness for the candidate alarm pair without treating community pin 5 as confirmed.",
            ["Installed servo alarm assignment, polarity and exact return from its parameter archive.",
             "Actual DB44 orientation/continuity and measured healthy/fault/open/power-loss states.",
             "Qualified isolated conditioner and reviewed aggregate-fault inclusion."],
        )
    reserved_evidence = {
        "SP-RS485-LOGIC": ["Approved MCU pin/alternate-function conflict audit and production plugin/profile.", "Actual isolated UART interface terminal map and supply-domain qualification."],
        "SP-RS485-FIELD": ["Installed drive connector/pin continuity, model/software and parameter archive.", "Approved isolated link polarity/termination and drive-specific read/write whitelist."],
        "SP-STATUS": ["Installed SRDY/ALM/ASP/ZSP/COIN-PtoS assignments and polarity from archived parameters.", "Qualified isolated input circuits and every operating/loss-of-power state."],
        "SP-CONTROL": ["Installed SON/CMODE/ACLR assignments, polarity and parameter archive.", "Reviewed hardware permission/watchdog and command interlocks; CMODE/ACLR remain locked."],
        "SP-ENCODER": ["Installed differential encoder connector, signal levels and receiver/isolation circuit.", "Approved MCU timer/pin map and measured counts; no direct GPIO landing."],
        "SP-INDEX": ["Selected sensor identity, actual pinout, one-pulse-per-spindle-turn relationship and qualified conditioner.", "Rigid mounting, coolant protection and repeatability evidence."],
        "SP-ORIENT": ["Approved physical command source, interface, installed position-mode parameters and electronic gearing.", "Separate orientation/mechanical safety qualification; production M19 remains unapproved."],
        "TEMP-SPINDLE": ["Exact ordered sensor identity and actual pinout; no conditional DS18B20 mapping assumed.", "Approved interface voltage, connector map, placement and cable route."],
    }
    if cable_id in RESERVED:
        return ("Inventory and label this future circuit only; keep it outside the active wiring sequence until its design and endpoints are approved.", reserved_evidence[cable_id])
    if cable_id in ("FLOOD-CTL", "MIST-CTL"):
        return (
            f"Identify the {row['from_terminal']} pair and planned relay input; preserve the switched negative instead of bonding it to logic ground.",
            ["Actual fused VIN voltage and physical output connector orientation.",
             "Qualified relay/load input rating and suppression circuit.",
             "Measured startup/off behavior and verified return/isolation topology; no guessed coil or component rating."],
        )
    if cable_id == "USB-01":
        return (
            "Identify the Windows-PC to Octopus USB cable and routing; record connector/shield paths without treating USB as power isolation.",
            ["Actual port/cable identity and mechanical retention.",
             "Recorded USB shield/logic-ground/protective-earth path within the complete cabinet.",
             "Actual read-only firmware/configuration identity and disconnection behavior during separately authorized commissioning."],
        )
    raise ValueError(f"No reviewed cable-specific task/evidence mapping for {cable_id}")


def build_dataset(reference: Path = REFERENCE) -> dict:
    source_rows, sources = read_source(reference)
    cables = []
    for index, row in enumerate(source_rows, 1):
        cable = dict(row)  # Preserve every original field and value verbatim.
        cable_id = row["cable_id"]
        axis = axis_for(cable_id)
        if row["state"] == "ROLLBACK-ONLY":
            disposition, reason = "rollback", "Original DM860T preservation record; excluded from the active CL57T wiring list."
        elif cable_id in RESERVED:
            disposition, reason = "reserved", RESERVED[cable_id]
        elif row["state"] == "HOLD":
            disposition, reason = "hold", "Source schedule is HOLD; trace and label references only, with physical termination/qualification unresolved."
        elif row["state"] == "TBD":
            disposition, reason = "trace-only", "Source schedule is TBD; deenergized identification, routing and labels only. No physical acceptance is recorded."
        else:
            raise ValueError(f"Unreviewed source state: {row['state']}")
        task, evidence = tasks_and_evidence(row, axis)
        planned = [row[f"{end}_terminal"] for end in ("from", "to") if row[f"{end}_device"] == "MR1 interface"]
        cable.update({
            "source_record": index,
            "axis": axis,
            "family": family_for(cable_id),
            "disposition": disposition,
            "disposition_reason": reason,
            "active_by_default": disposition not in ("reserved", "rollback"),
            "endpoint_labels": {"from": cable_id, "to": cable_id},
            "endpoint_status": {end: endpoint_status(row[f"{end}_device"], row[f"{end}_terminal"]) for end in ("from", "to")},
            "planned_interface_names": planned,
            "trace_task": task,
            "missing_evidence": evidence,
            "evidence_status": "unverified",
            "may_energize": False,
        })
        cables.append(cable)
    result = {
        "schema_version": 1,
        "protocol": "mr1-visual-cable-reference-v1",
        "generator": {"name": "cable-data.py", "version": 1},
        "source": sources,
        "source_fields": list(SOURCE_FIELDS),
        "scope": "Deenergized cable identification, route planning and matching labels. No completed continuity, termination, electrical or motion evidence.",
        "endpoint_notice": "Device and terminal text is preserved from the reference schedule, not a verified physical cavity map. JX/JYL/JZ/JYR, JF names, JP/JT and interface function labels are planned names.",
        "safety_status": {"physical_evidence": "unverified", "may_energize": False, "may_machine": False},
        "default_filter": {"exclude_dispositions": ["reserved", "rollback"]},
        "counts": {
            "total": len(cables),
            "active": sum(c["active_by_default"] for c in cables),
            "by_disposition": {key: sum(c["disposition"] == key for c in cables) for key in DISPOSITIONS},
            "by_axis": {key: sum(c["axis"] == key for c in cables) for key in AXES},
            "by_family": {key: sum(c["family"] == key for c in cables) for key in FAMILIES},
        },
        "active_ids": [c["cable_id"] for c in cables if c["active_by_default"]],
        "cables": cables,
    }
    validate_dataset(result, source_rows)
    return result


def validate_dataset(data: dict, source_rows: list[dict]) -> None:
    cables = data["cables"]
    assert len(cables) == len(source_rows) == 56
    assert len({c["cable_id"] for c in cables}) == 56
    assert data["source_fields"] == list(SOURCE_FIELDS)
    assert data["safety_status"] == {"physical_evidence": "unverified", "may_energize": False, "may_machine": False}
    assert data["default_filter"]["exclude_dispositions"] == ["reserved", "rollback"]
    for index, (cable, source) in enumerate(zip(cables, source_rows), 1):
        assert {key: cable[key] for key in SOURCE_FIELDS} == source, "Original source field changed."
        assert cable["source_record"] == index
        assert cable["axis"] in AXES and cable["family"] in FAMILIES
        assert cable["disposition"] in DISPOSITIONS
        assert cable["evidence_status"] == "unverified" and cable["may_energize"] is False
        assert cable["active_by_default"] == (cable["disposition"] not in ("reserved", "rollback"))
        assert cable["endpoint_labels"] == {"from": source["cable_id"], "to": source["cable_id"]}
        assert isinstance(cable["trace_task"], str) and len(cable["trace_task"]) > 30
        assert len(cable["missing_evidence"]) >= 2 and all(len(value) > 20 for value in cable["missing_evidence"])
        assert source["state"] != "ROLLBACK-ONLY" or cable["disposition"] == "rollback"
        for end in ("from", "to"):
            assert cable["endpoint_status"][end] == endpoint_status(source[f"{end}_device"], source[f"{end}_terminal"])
            if source[f"{end}_device"] == "MR1 interface":
                assert source[f"{end}_terminal"] in cable["planned_interface_names"]
    assert data["active_ids"] == [c["cable_id"] for c in cables if c["active_by_default"]]
    assert data["counts"]["total"] == 56 and data["counts"]["active"] == 44
    assert data["counts"]["by_disposition"] == {"trace-only": 22, "hold": 22, "reserved": 8, "rollback": 4}
    for name, keys, field in (("by_axis", AXES, "axis"), ("by_family", FAMILIES, "family"), ("by_disposition", DISPOSITIONS, "disposition")):
        assert data["counts"][name] == {key: sum(c[field] == key for c in cables) for key in keys}


class CableDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = build_dataset()
        cls.rows, cls.sources = read_source(REFERENCE)

    def test_exact_source_fields_and_all_ids_preserved(self):
        validate_dataset(self.data, self.rows)
        self.assertEqual(self.data["source"], self.sources)

    def test_counts_and_default_active_list(self):
        self.assertEqual(len(self.data["active_ids"]), 44)
        self.assertEqual(self.data["counts"]["by_axis"], {"X": 8, "YL": 8, "Z": 8, "YR": 8, "shared": 24})
        self.assertTrue(set(RESERVED).isdisjoint(self.data["active_ids"]))

    def test_axis_pairs_and_fault_aggregate_classification(self):
        cables = {c["cable_id"]: c for c in self.data["cables"]}
        for axis in AXES[:-1]:
            for prefix in ("CMD", "MOT", "ENC", "ALM", "HOME-FIELD", "HOME-LOGIC"):
                self.assertEqual(cables[f"{prefix}-{axis}"]["axis"], axis)
        self.assertEqual(cables["FAULT-AGG"]["family"], "fault")
        self.assertEqual(cables["FAULT-AGG"]["to_terminal"], "EXP2 PB1/GND")

    def test_identical_labels_and_planned_interface_names(self):
        for cable in self.data["cables"]:
            self.assertEqual(cable["endpoint_labels"]["from"], cable["endpoint_labels"]["to"])
        command = next(c for c in self.data["cables"] if c["cable_id"] == "CMD-X")
        self.assertEqual(command["planned_interface_names"], ["JX"])
        self.assertEqual(command["endpoint_status"]["from"], "planned-interface")

    def test_rejects_mutated_source_terminal(self):
        bad = copy.deepcopy(self.data)
        bad["cables"][0]["to_terminal"] = "INVENTED PIN 1"
        with self.assertRaises(AssertionError):
            validate_dataset(bad, self.rows)

    def test_rejects_ready_state_or_fabricated_evidence(self):
        for field, value in (("disposition", "ready-to-power"), ("evidence_status", "verified"), ("may_energize", True)):
            bad = copy.deepcopy(self.data)
            bad["cables"][0][field] = value
            with self.assertRaises(AssertionError):
                validate_dataset(bad, self.rows)

    def test_rejects_reserved_or_rollback_in_default_active_sequence(self):
        for disposition in ("reserved", "rollback"):
            bad = copy.deepcopy(self.data)
            next(c for c in bad["cables"] if c["disposition"] == disposition)["active_by_default"] = True
            with self.assertRaises(AssertionError):
                validate_dataset(bad, self.rows)

    def test_rejects_mismatched_labels_and_duplicate_ids(self):
        for mutation in ("label", "id"):
            bad = copy.deepcopy(self.data)
            if mutation == "label":
                bad["cables"][0]["endpoint_labels"]["to"] = "DIFFERENT-ID"
            else:
                bad["cables"][1]["cable_id"] = bad["cables"][0]["cable_id"]
            with self.assertRaises(AssertionError):
                validate_dataset(bad, self.rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="check the adjacent JSON without rewriting it")
    parser.add_argument("--test", action="store_true", help="run focused standard-library tests")
    args = parser.parse_args()
    if args.test:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(CableDataTests)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        raise SystemExit(0 if result.wasSuccessful() else 1)
    data = build_dataset()
    output = HERE / "cable-data.json"
    encoded = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if output.read_text(encoding="utf-8") != encoded:
            raise SystemExit("cable-data.json does not match the corrected source and generator.")
    else:
        output.write_text(encoded, encoding="utf-8", newline="\n")
    print(json.dumps({"file": output.relative_to(REPOSITORY).as_posix(), "checked": args.check, **data["counts"]}))


if __name__ == "__main__":
    main()
