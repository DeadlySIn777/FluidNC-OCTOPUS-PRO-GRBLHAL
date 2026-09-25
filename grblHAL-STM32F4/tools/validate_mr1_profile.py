#!/usr/bin/env python3
"""Audit the MR-1 board map, machine constants, and interrupt allocation."""

from __future__ import annotations

import json
import math
import re
import struct
import sys
from pathlib import Path

from validate_mr1_macros import MacroAuditError, audit_macros


ROOT = Path(__file__).resolve().parents[1]
MAP_PATH = ROOT / "boards" / "btt_octopus_pro_mr1_map.h"
CONFIG_PATH = ROOT / "Inc" / "mr1_octopus_config.h"
SERVO_AXIS_CONFIG_PATH = ROOT / "Inc" / "mr1_servo_axis_lab_config.h"
MANIFEST_PATH = ROOT / "mr1" / "io-manifest.json"
EXPECTED_SETTINGS_PATH = ROOT / "mr1" / "expected-settings.json"
SERVO_PROFILE_PATH = ROOT / "mr1" / "servo-profile.pending.json"
SERVO_AXIS_PROFILE_PATH = ROOT / "mr1" / "servo-axis-tapping.pending.json"
PLATFORMIO_PATH = ROOT / "platformio.ini"
F429_BOARD_PATH = ROOT / "boards" / "genericSTM32F429ZG.json"
F429_ZGT6_BOARD_PATH = ROOT / "boards" / "genericSTM32F429ZGT6.json"
DRIVER_PATH = ROOT / "Inc" / "driver.h"
DRIVER_SOURCE_PATH = ROOT / "Src" / "driver.c"
MAIN_SOURCE_PATH = ROOT / "Src" / "main.c"
CORE_GCODE_PATH = ROOT / "grbl" / "gcode.c"
CORE_MOTION_PATH = ROOT / "grbl" / "motion_control.c"
CORE_PLANNER_PATH = ROOT / "grbl" / "planner.c"
CORE_STEPPER_PATH = ROOT / "grbl" / "stepper.c"
CORE_CONFIG_PATH = ROOT / "grbl" / "config.h"
CORE_CONSTANTS_PATH = ROOT / "grbl" / "nuts_bolts.h"
LINKER_PATH = ROOT / "STM32F429ZGTX_BL32K_I2C_FLASH.ld"
FIRMWARE_PATH = ROOT / ".pio" / "build" / "btt_octopus_pro_f429_mr1" / "firmware.bin"
SERVO_AXIS_FIRMWARE_PATH = (
    ROOT / ".pio" / "build" / "btt_octopus_pro_f429_mr1_servo_axis_lab" / "firmware.bin"
)

DEFINE_RE = re.compile(r"^\s*#define\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+?)\s*(?:/\*.*)?$")
GPIO_RE = re.compile(r"GPIO([A-K])$")
PIN_RE = re.compile(r"P([A-K])(\d{1,2})$")


class AuditError(RuntimeError):
    pass


def parse_defines(path: Path) -> dict[str, str]:
    defines: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = DEFINE_RE.match(line)
        if match:
            value = match.group(2).split("//", 1)[0].strip()
            defines[match.group(1)] = value
    return defines


def resolve(defines: dict[str, str], name: str) -> str:
    seen: set[str] = set()
    value = name
    while value in defines:
        if value in seen:
            raise AuditError(f"cyclic macro alias at {name}")
        seen.add(value)
        value = defines[value].strip()
    return value


def parse_number(value: str) -> float:
    cleaned = value.strip().rstrip("fF")
    if not re.fullmatch(r"[-+]?\d+(?:\.\d+)?", cleaned):
        raise AuditError(f"expected a literal number, got {value!r}")
    return float(cleaned)


def macro_gpio(defines: dict[str, str], base: str) -> str:
    port_name = f"{base}_PORT"
    pin_name = f"{base}_PIN"
    if port_name not in defines or pin_name not in defines:
        raise AuditError(f"missing {port_name} or {pin_name}")
    port = resolve(defines, defines[port_name])
    pin = int(parse_number(resolve(defines, defines[pin_name])))
    match = GPIO_RE.fullmatch(port)
    if not match or not 0 <= pin <= 15:
        raise AuditError(f"invalid GPIO for {base}: {port}/{pin}")
    return f"P{match.group(1)}{pin}"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AuditError(message)


def ini_section(contents: str, name: str) -> str:
    marker = f"[env:{name}]"
    require(marker in contents, f"PlatformIO environment {name} is missing")
    section = contents.split(marker, 1)[1]
    return section.split("\n[env:", 1)[0]


def audit() -> list[str]:
    board_source = MAP_PATH.read_text(encoding="utf-8")
    board = parse_defines(MAP_PATH)
    config = parse_defines(CONFIG_PATH)
    servo_axis_config_source = SERVO_AXIS_CONFIG_PATH.read_text(encoding="utf-8")
    servo_axis_config = parse_defines(SERVO_AXIS_CONFIG_PATH)
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    expected_settings = json.loads(EXPECTED_SETTINGS_PATH.read_text(encoding="utf-8"))
    servo_profile = json.loads(SERVO_PROFILE_PATH.read_text(encoding="utf-8"))
    servo_axis_profile = json.loads(SERVO_AXIS_PROFILE_PATH.read_text(encoding="utf-8"))
    f429_board = json.loads(F429_BOARD_PATH.read_text(encoding="utf-8"))
    f429_zgt6_board = json.loads(F429_ZGT6_BOARD_PATH.read_text(encoding="utf-8"))
    platformio = PLATFORMIO_PATH.read_text(encoding="utf-8")
    driver = DRIVER_PATH.read_text(encoding="utf-8")
    driver_source = DRIVER_SOURCE_PATH.read_text(encoding="utf-8")
    main_source = MAIN_SOURCE_PATH.read_text(encoding="utf-8")
    core_gcode = CORE_GCODE_PATH.read_text(encoding="utf-8")
    core_motion = CORE_MOTION_PATH.read_text(encoding="utf-8")
    core_planner = CORE_PLANNER_PATH.read_text(encoding="utf-8")
    core_stepper = CORE_STEPPER_PATH.read_text(encoding="utf-8")
    core_config = CORE_CONFIG_PATH.read_text(encoding="utf-8")
    linker = LINKER_PATH.read_text(encoding="utf-8")
    notes: list[str] = []

    require(manifest["profile"] == "btt_octopus_pro_f429_mr1", "wrong manifest profile")
    require("default_envs = btt_octopus_pro_f429_mr1" in platformio, "MR-1 target is not default")
    mr1_environment = ini_section(platformio, "btt_octopus_pro_f429_mr1")
    require("-include Inc/mr1_octopus_config.h" in mr1_environment,
            "MR-1 machine configuration is not force-included")
    require("board = genericSTM32F429ZG" in mr1_environment and
            "board_build.mcu = stm32f429zgt6" in mr1_environment,
            "MR-1 target does not use the official F429ZG device variant")
    require(f429_board["build"]["f_cpu"] == "168000000L" and
            f429_zgt6_board["build"]["f_cpu"] == "168000000L",
            "F429 board metadata does not match the configured 168 MHz PLL")
    notes.append("F429 build metadata and runtime PLL agree at 168 MHz")
    require("-D HSE_VALUE=8000000" in mr1_environment,
            "MR-1 target does not use the official F429 8 MHz crystal value")
    require("BOARD_BTT_OCTOPUS_PRO_MR1" in driver, "MR-1 map is not selected by driver.h")
    require("HSE_VALUE != 8000000" in board_source,
            "MR-1 board map no longer rejects a non-8 MHz F429 build")
    require(parse_number(config["MR1_PRODUCTION_PROFILE"]) == 1.0,
            "MR-1 production command exclusions are not enabled")
    require("#if !defined(MR1_PRODUCTION_PROFILE)" in driver_source,
            "driver diagnostic commands are not gated for the production profile")
    require("board_build.ldscript = STM32F429ZGTX_BL32K_I2C_FLASH.ld" in mr1_environment,
            "MR-1 target is not using its 32 KiB bootloader linker script")
    require("-D HAS_BOOTLOADER" in mr1_environment and "-D VECT_TAB_OFFSET=0x8000" in mr1_environment,
            "MR-1 target does not relocate the interrupt vector table")
    require("upload_protocol = custom" in mr1_environment,
            "MR-1 build must emit a raw SD-bootloader image, not a DFU-suffixed image")
    for required_library in (
        "grbl",
        "spindle",
        "eeprom",
        "Middlewares/ST/STM32_USB_Device_Library/Core",
        "Middlewares/ST/STM32_USB_Device_Library/Class",
        "USB_DEVICE/App",
        "USB_DEVICE/Target",
    ):
        require(re.search(rf"^\s+{re.escape(required_library)}\s*$", mr1_environment, re.MULTILINE),
                f"MR-1 target is missing required library {required_library}")
    for legacy_library in ("bluetooth", "keypad", "laser", "trinamic", "embroidery", "sdcard"):
        require(not re.search(rf"^\s+{legacy_library}\s*$", mr1_environment, re.MULTILINE),
                f"MR-1 target still links unused legacy library {legacy_library}")
    require("LEGACY TARGETS BELOW - NOT APPROVED FOR THE MR-1" in platformio,
            "legacy PlatformIO targets are not visibly separated from the MR-1 target")
    require(platformio.index("LEGACY TARGETS BELOW") > platformio.index("[env:btt_octopus_pro_f429_mr1]"),
            "legacy-target warning must follow the canonical MR-1 environment")
    notes.append("canonical PlatformIO environment isolated from legacy targets and plugins")

    servo_axis_environment = ini_section(
        platformio, "btt_octopus_pro_f429_mr1_servo_axis_lab"
    )
    require("-include Inc/mr1_servo_axis_lab_config.h" in servo_axis_environment,
            "servo-axis lab configuration is not force-included")
    require("board = genericSTM32F429ZG" in servo_axis_environment and
            "board_build.mcu = stm32f429zgt6" in servo_axis_environment,
            "servo-axis lab target does not use the verified F429ZG device definition")
    require("-D HSE_VALUE=8000000" in servo_axis_environment,
            "servo-axis lab target does not use the official F429 8 MHz crystal value")
    require("board_build.ldscript = STM32F429ZGTX_BL32K_I2C_FLASH.ld" in servo_axis_environment,
            "servo-axis lab target does not preserve the 32 KiB BTT bootloader")
    require("-D HAS_BOOTLOADER" in servo_axis_environment and
            "-D VECT_TAB_OFFSET=0x8000" in servo_axis_environment,
            "servo-axis lab target does not relocate its vector table")
    require("upload_protocol = custom" in servo_axis_environment,
            "servo-axis lab target must remain an explicit raw-image build")
    require(platformio.index("LEGACY TARGETS BELOW") > platformio.index(
        "[env:btt_octopus_pro_f429_mr1_servo_axis_lab]"
    ), "servo-axis qualification target was placed among unapproved legacy targets")
    require("default_envs = btt_octopus_pro_f429_mr1_servo_axis_lab" not in platformio,
            "servo-axis lab target must never be the default environment")
    notes.append("production and lab targets use the official F429ZG/8 MHz hardware variant")
    notes.append("servo-axis qualification is a separate, non-default F429 bootloader target")

    f429_marker = "#elif defined(STM32F429xx)"
    f411_marker = "#elif defined(STM32F411xE)"
    require(f429_marker in main_source and f411_marker in main_source,
            "STM32F429 clock configuration block is missing")
    f429_clock = main_source.split(f429_marker, 1)[1].split(f411_marker, 1)[0]
    require("BOARD_BTT_OCTOPUS_PRO_MR1" in f429_clock,
            "MR-1 board is missing F429 bootloader clock cleanup")
    require("__HAL_RCC_PLL_DISABLE" not in f429_clock,
            "F429 boot cleanup disables a running PLL before switching SYSCLK to HSI")
    require(f429_clock.index("HAL_RCC_ClockConfig") < f429_clock.index("RCC_OscInitTypeDef RCC_OscInitStruct"),
            "F429 boot cleanup must switch SYSCLK to HSI before PLL reconfiguration")
    notes.append("F429 bootloader handoff switches SYSCLK to HSI before PLL reconfiguration")

    required_profile = {
        "USB_SERIAL_CDC": 1,
        "EEPROM_ENABLE": 32,
        "ODOMETER_ENABLE": 0,
        "SDCARD_ENABLE": 0,
        "ETHERNET_ENABLE": 0,
        "WEBUI_ENABLE": 0,
        "MODBUS_ENABLE": 0,
        "Y_AUTO_SQUARE": 1,
        "TRINAMIC_ENABLE": 0,
        "TRINAMIC_UART_ENABLE": 0,
        "TRINAMIC_SPI_ENABLE": 0,
        "PROBE_ENABLE": 1,
        "PROBE2_ENABLE": 0,
        "TOOLSETTER_ENABLE": 1,
        "BLTOUCH_ENABLE": 0,
        "ESTOP_ENABLE": 1,
        "CONTROL_ENABLE": 70,
        "SAFETY_DOOR_ENABLE": 1,
        "MOTOR_FAULT_ENABLE": 1,
        "N_SPINDLE": 1,
        "COOLANT_ENABLE": 3,
    }
    for name, expected in required_profile.items():
        require(name in config, f"missing profile feature {name}")
        require(parse_number(config[name]) == expected,
                f"{name}: expected {expected}, got {config[name]}")
    require(manifest["machine"]["logical_axes"] == 3, "MR-1 must expose three logical axes")
    require(manifest["machine"]["physical_motors"] == 4, "MR-1 must use four physical motors")
    notes.append("USB-only production profile; network, WebUI, Modbus, and runtime SD disabled")

    require(servo_profile["schemaVersion"] == 1, "unsupported pending servo-profile schema")
    require(servo_profile["profile"] == "mr1-stock-servo-pending",
            "pending profile name must not assume an unverified T3 drive identity")
    require(servo_profile["status"] == "identity-required",
            "pending servo profile must remain identity-required")
    require(servo_profile["commissioningStage"] == 0,
            "pending servo profile cannot advance without physical evidence")
    require(servo_profile["profileFingerprint"] is None,
            "pending servo profile cannot claim an approved fingerprint")
    require(servo_profile["architecture"] == {
        "decision": "digital-first-with-analog-fallback",
        "targetCommandPath": "isolated-rs485-modbus-rtu",
        "commissioningBaselinePath": "isolated-0-5v-analog-forward-only",
        "targetCommandOwner": "grblhal-custom-servo-plugin",
        "currentCommandOwner": "grblhal-pwm-spindle",
        "browserCommandAuthority": False,
        "hardwiredSafetyAuthority": True,
        "dualCommandAuthorityAllowed": False,
    }, "pending servo architecture no longer matches the reviewed digital-first decision")
    expected_servo_permits = {
        "readOnlyModbus",
        "modbusWrite",
        "servoEnable",
        "reverse",
        "positionMode",
        "orientation",
        "rigidTapping",
        "automaticAdaptiveFeed",
    }
    permits = servo_profile["permits"]
    require(set(permits) == expected_servo_permits,
            "pending servo permit set changed without validator review")
    require(all(value is False for value in permits.values()),
            "every pending servo capability must remain locked")

    servo_controller = servo_profile["controller"]
    require(servo_controller["firmwareTarget"] == manifest["profile"],
            "pending servo profile targets the wrong firmware")
    require(servo_controller["physicalBoardVerified"] is False,
            "board identity cannot be promoted in a pending profile")
    require(servo_controller["physicalMcuMarking"] is None,
            "MCU identity needs a photographed approval record")
    candidate_uart = servo_controller["candidateServoUart"]
    require(candidate_uart == {
        "peripheral": "USART2",
        "tx": "PD5",
        "rx": "PD6",
        "approved": False,
    }, "pending servo UART must stay the unapproved PD5/PD6 candidate")
    require(parse_number(board["SERIAL1_PORT"]) == 21.0,
            "board map no longer exposes the candidate USART2 mapping")

    drive_identity = servo_profile["drive"]
    for field in (
        "externalModel",
        "hiddenModel",
        "motorModel",
        "softwareVersion",
        "parameterArchiveSha256",
        "cn1ContinuityArchiveSha256",
    ):
        require(drive_identity[field] is None,
                f"pending servo identity field {field} must remain blank")
    require(drive_identity["genericReferenceApprovedForInstalledDrive"] is False,
            "generic T3 documentation cannot identify the installed drive")

    mechanics = servo_profile["mechanics"]
    require(mechanics["nominalSpindlePerMotorRatio"] == 2.0,
            "pending profile lost the official nominal 2:1 spindle/motor ratio")
    require(mechanics["ratioVerified"] is False and mechanics["reverseMechanicalReviewComplete"] is False,
            "pending profile cannot claim verified ratio or reverse mechanics")

    rigid_tapping = servo_profile["rigidTappingProof"]
    require(rigid_tapping["status"] == "blocked-current-controller",
            "rigid tapping must remain blocked on the current controller")
    require(rigid_tapping["gcode"] == "G33.1",
            "unexpected rigid-tapping G-code contract")
    require(rigid_tapping["controllerDecision"] == "unselected",
            "a production rigid-tapping controller needs a separate reviewed decision")
    require(rigid_tapping["pinnedCoreCommit"] == "779d41b8d86e3042f13df326d92dd34ae1825e24",
            "pinned core identity changed without a rigid-tapping re-audit")
    require(rigid_tapping["pinnedCoreParserSupport"] is False and
            rigid_tapping["pinnedCoreMotionImplementation"] is False,
            "pending profile cannot claim G33.1 support")
    upstream_audit = rigid_tapping["latestUpstreamAudit"]
    require(upstream_audit == {
        "auditedAt": "2026-08-23",
        "coreCommit": "f80fc34d503bd62391a23b197b3e0ee66ce00cb7",
        "stm32f4Commit": "b7bcf17e7500be5bb71daa403add3fc461b9bc41",
        "parserHookPresent": True,
        "motionImplementationPresent": False,
        "stm32f4OverridePresent": False,
    }, "upstream rigid-tapping audit record changed without validator review")
    rigid_gates = rigid_tapping["gates"]
    expected_rigid_gates = {
        "productionControllerSelected",
        "directSpindleEncoderInstalled",
        "singleIndexPerSpindleRevolutionVerified",
        "bidirectionalPhaseFeedbackVerified",
        "m4ReverseVerified",
        "atSpeedInterlockVerified",
        "encoderLossFaultVerified",
        "zAxisTrackingVerified",
        "reversalOvershootCharacterized",
        "waxTestPassed",
        "aluminumTestPassed",
    }
    require(set(rigid_gates) == expected_rigid_gates,
            "rigid-tapping gate set changed without validator review")
    require(all(value is False for value in rigid_gates.values()),
            "pending rigid-tapping proof cannot contain a passed physical gate")
    require(all(value is None for value in rigid_tapping["evidence"].values()),
            "pending rigid-tapping profile cannot claim evidence archives")
    require(rigid_tapping["productionAuthorized"] is False,
            "pending rigid tapping can never be production-authorized")

    require("FAIL(Status_GcodeUnsupportedCommand); // [G33.1 not yet supported]" in core_gcode,
            "pinned core no longer explicitly rejects G33.1; perform a full controller re-audit")
    require("mc_rigid_tapping" not in core_motion,
            "a rigid-tapping motion hook appeared without an implementation review")
    require("SPINDLE_SYNC_ENABLE" not in config and "SPINDLE_ENCODER_ENABLE" not in config,
            "spindle synchronization or encoder input was enabled before commissioning")
    for macro in ("SPINDLE_PULSE_PORT", "SPINDLE_PULSE_PIN", "SPINDLE_INDEX_PORT", "SPINDLE_INDEX_PIN"):
        require(macro not in board,
                f"{macro} was assigned before the isolated encoder interface and controller path were approved")
    notes.append(
        f"rigid tapping NO-GO: G33.1 rejected, no motion implementation, "
        f"{len(rigid_gates)} physical proof gates locked"
    )

    # The alternate Octopus path does not claim G33.1. It treats the digital
    # spindle servo as rotary A and coordinates A and Z in the normal planner.
    require(servo_axis_profile["schemaVersion"] == 1,
            "unsupported servo-axis tapping profile schema")
    require(servo_axis_profile["profile"] == "mr1-octopus-servo-axis-tapping-pending",
            "unexpected servo-axis tapping profile name")
    require(servo_axis_profile["status"] == "source-feasible-hardware-unverified",
            "servo-axis tapping status must distinguish source proof from hardware proof")
    require(servo_axis_profile["method"] == "coordinated-rotary-axis",
            "servo-axis tapping method changed without review")
    require(servo_axis_profile["productionFirmwareTarget"] == manifest["profile"],
            "servo-axis profile points at the wrong production target")
    require(
        servo_axis_profile["qualificationFirmwareTarget"]
        == "btt_octopus_pro_f429_mr1_servo_axis_lab",
        "servo-axis profile points at the wrong qualification target",
    )
    require(servo_axis_profile["productionAuthorized"] is False,
            "pending servo-axis tapping can never be production-authorized")

    controller_model = servo_axis_profile["controllerModel"]
    require(controller_model == {
        "logicalAxes": 4,
        "physicalMotionOutputs": 5,
        "axes": ["X", "Y", "Z", "A"],
        "gangedAxis": "Y",
        "spindleCommandAxis": "A",
        "requiresG33_1": False,
        "requiresSpindleEncoderFollower": False,
        "plannerMode": "G93 inverse time",
        "distanceMode": "G91 incremental",
        "rotaryPlannerFixRequired": True,
        "pwmSpeedCommandDisabled": True,
        "browserCommandAuthority": False,
    }, "servo-axis controller model changed without validator review")

    require('#include "mr1_octopus_config.h"' in servo_axis_config_source,
            "servo-axis lab no longer inherits the reviewed MR-1 production baseline")
    expected_lab_defines = {
        "MR1_SERVO_AXIS_LAB": 1,
        "N_AXIS": 4,
        "SPINDLE0_ENABLE": 0,
        "ROTARY_FIX": 1,
        "DEFAULT_AXIS_ROTATIONAL_MASK": 8,
        "DEFAULT_AXIS_ROTARY_WRAP_MASK": 0,
        "DEFAULT_HARD_LIMITS_DISABLE_FOR_ROTARY": 1,
        "DEFAULT_HOMING_CYCLE_3": 0,
    }
    for name, expected in expected_lab_defines.items():
        require(name in servo_axis_config, f"servo-axis lab is missing {name}")
        require(parse_number(servo_axis_config[name]) == expected,
                f"servo-axis lab {name} does not equal {expected}")
    require("MR1 SERVO AXIS LAB - DO NOT USE IN PRODUCTION" in
            servo_axis_config["BUILD_INFO"],
            "servo-axis lab binary lost its unmistakable non-production identity")
    require("N_AXIS" not in config,
            "production profile must retain the core's three-axis default")
    require(parse_number(config["SPINDLE0_ENABLE"]) == 12,
            "production profile no longer retains forward-only PWM spindle control")

    gearing = servo_axis_profile["provisionalElectronicGearing"]
    require(gearing["approvedForHardware"] is False,
            "provisional servo gearing cannot be marked hardware-approved")
    pulses_per_motor_rev = float(gearing["commandPulsesPerMotorRevolution"])
    spindle_per_motor = float(gearing["spindleRevolutionsPerMotorRevolution"])
    pulses_per_spindle_rev = pulses_per_motor_rev / spindle_per_motor
    pulses_per_degree = pulses_per_spindle_rev / 360.0
    require(math.isclose(pulses_per_spindle_rev,
                         gearing["commandPulsesPerSpindleRevolution"],
                         rel_tol=0.0, abs_tol=1e-9),
            "provisional pulse count per spindle revolution is inconsistent")
    require(math.isclose(pulses_per_degree,
                         gearing["commandPulsesPerSpindleDegree"],
                         rel_tol=0.0, abs_tol=1e-9),
            "provisional A-axis scale is inconsistent")
    require(math.isclose(parse_number(servo_axis_config["DEFAULT_A_STEPS_PER_MM"]),
                         pulses_per_degree, rel_tol=0.0, abs_tol=1e-9),
            "lab A-axis scale does not match the pending electronic gearing")
    maximum_spindle_rpm = float(gearing["configuredMaximumSpindleRpm"])
    expected_a_rate = maximum_spindle_rpm * 360.0
    expected_a_pulse_hz = maximum_spindle_rpm * pulses_per_spindle_rev / 60.0
    require(math.isclose(parse_number(servo_axis_config["DEFAULT_A_MAX_RATE"]),
                         expected_a_rate, rel_tol=0.0, abs_tol=1e-6),
            "lab A-axis maximum rate does not represent the configured spindle RPM")
    require(math.isclose(expected_a_rate,
                         gearing["configuredAMaxRateDegreesPerMinute"],
                         rel_tol=0.0, abs_tol=1e-6),
            "pending A-axis maximum rate math is inconsistent")
    require(math.isclose(expected_a_pulse_hz, gearing["maximumAPulseRateHz"],
                         rel_tol=0.0, abs_tol=1e-6),
            "pending A-axis pulse-rate math is inconsistent")
    require(math.isclose(gearing["zStepsPerMillimeter"],
                         manifest["motion"]["steps_per_mm"]["z"],
                         rel_tol=0.0, abs_tol=1e-9),
            "servo-axis tapping profile lost the production Z scale")
    require(math.isclose(gearing["stepPulseWidthMicroseconds"],
                         parse_number(config["DEFAULT_STEP_PULSE_MICROSECONDS"]),
                         rel_tol=0.0, abs_tol=1e-9),
            "servo-axis tapping profile lost the production pulse width")
    require(math.isclose(gearing["stepDirectionSetupMicroseconds"],
                         parse_number(config["DEFAULT_STEP_PULSE_DELAY"]),
                         rel_tol=0.0, abs_tol=1e-9),
            "servo-axis tapping profile lost the production direction setup")

    # The lab branch maps logical A/M3 to physical MOTOR4 and logical Y2/M4
    # back to physical MOTOR3, so the production cabinet pinout does not move.
    required_map_fragments = (
        r"#if defined\(MR1_SERVO_AXIS_LAB\).*?"
        r"#define M3_STEP_PORT\s+MR1_MOTOR4_STEP_PORT.*?"
        r"#define M4_STEP_PORT\s+MR1_MOTOR3_STEP_PORT",
        r"#if defined\(MR1_SERVO_AXIS_LAB\).*?"
        r"#define M4_LIMIT_PORT\s+GPIOG\s+"
        r"#define M4_LIMIT_PIN\s+11",
        r"#if defined\(MR1_SERVO_AXIS_LAB\).*?"
        r"#define M4_MOTOR_FAULT_PORT\s+GPIOG\s+"
        r"#define M4_MOTOR_FAULT_PIN\s+15",
    )
    for pattern in required_map_fragments:
        require(re.search(pattern, board_source, re.DOTALL) is not None,
                "servo-axis lab board-map branch is incomplete")

    production_y2 = {
        "step": macro_gpio(board, "M3_STEP"),
        "direction": macro_gpio(board, "M3_DIRECTION"),
        "enable": macro_gpio(board, "M3_ENABLE"),
    }
    require(production_y2 == {"step": "PG4", "direction": "PC1", "enable": "PA2"},
            "production MOTOR3/Y-right pinout changed")
    lab_a = {
        "step": macro_gpio(board, "MR1_MOTOR4_STEP"),
        "direction": macro_gpio(board, "MR1_MOTOR4_DIRECTION"),
        "enable": macro_gpio(board, "MR1_MOTOR4_ENABLE"),
    }
    lab_y2 = {
        "step": macro_gpio(board, "M4_STEP"),
        "direction": macro_gpio(board, "M4_DIRECTION"),
        "enable": macro_gpio(board, "M4_ENABLE"),
    }
    require(lab_a == {"step": "PF9", "direction": "PF10", "enable": "PG2"},
            "servo-axis A output is not physical MOTOR4")
    require(lab_y2 == production_y2,
            "servo-axis lab moved the existing Y-right cabinet wiring")
    require(macro_gpio(board, "M4_LIMIT") == "PG11" and
            macro_gpio(board, "M4_MOTOR_FAULT") == "PG15",
            "servo-axis lab did not preserve Y-right home/fault inputs")
    lab_motion_gpio = []
    for base in ("X", "Y", "Z"):
        for suffix in ("STEP", "DIRECTION", "ENABLE"):
            lab_motion_gpio.append(macro_gpio(board, f"{base}_{suffix}"))
    lab_motion_gpio.extend(lab_a.values())
    lab_motion_gpio.extend(lab_y2.values())
    require(len(lab_motion_gpio) == 15 and len(set(lab_motion_gpio)) == 15,
            "five lab motion outputs are not 15 collision-free GPIO signals")

    source_claims = servo_axis_profile["sourceClaims"]
    require(source_claims and all(value is True for value in source_claims.values()),
            "servo-axis source claims must be explicit booleans")
    require("#define ROTARY_FIX                           1" in servo_axis_config_source,
            "mixed rotary/linear planner path is not enabled in the lab config")
    require("if (junction_cos_theta > 0.999999f)" in core_planner and
            "MINIMUM_JUNCTION_SPEED * MINIMUM_JUNCTION_SPEED" in core_planner and
            "#define MINIMUM_JUNCTION_SPEED 0.0f" in core_config,
            "exact A/Z reversal no longer commands a zero-speed junction")
    require("bresenham line tracer algorithm controls all stepper outputs" in core_stepper,
            "coordinated axes no longer share the reviewed stepper stream")

    # F429 clocks at 168 MHz, TIM5 receives 84 MHz and the driver divides by
    # four. Pulse period is bounded by pulse width plus the enforced off time.
    require("#define STEPPER_TIMER_DIV 4" in driver_source and
            "hal.f_step_timer = HAL_RCC_GetPCLK1Freq() * 2 / STEPPER_TIMER_DIV" in driver_source,
            "step-timer clock derivation changed without a rate re-audit")
    require(".PLL.PLLN = 336" in main_source and
            "#define APB1CLKDIV RCC_HCLK_DIV4" in main_source,
            "F429/APB1 clock setup changed without a rate re-audit")
    step_timer_hz = 21_000_000.0
    enforced_off_us = 2.0
    maximum_period_limited_hz = 1_000_000.0 / (
        gearing["stepPulseWidthMicroseconds"] + enforced_off_us
    )
    require(expected_a_pulse_hz < maximum_period_limited_hz,
            "maximum A pulse rate exceeds the configured pulse-period limit")
    require(step_timer_hz / expected_a_pulse_hz >= 300.0,
            "maximum A pulse rate leaves fewer than 300 step-timer ticks")

    physical_gates = servo_axis_profile["physicalGates"]
    require(len(physical_gates) == 23,
            "servo-axis physical gate set changed without validator review")
    require(all(value is False for value in physical_gates.values()),
            "pending servo-axis profile cannot contain a passed physical gate")
    require(all(value is None for value in servo_axis_profile["evidence"].values()),
            "pending servo-axis profile cannot claim physical evidence archives")
    notes.append(
        "servo-axis tapping source path: 4 logical axes, 5 collision-free motion outputs, "
        f"A max {expected_a_pulse_hz:.1f} Hz < {maximum_period_limited_hz:.1f} Hz pulse ceiling"
    )
    notes.append(
        f"servo-axis hardware proof remains locked: 0 of {len(physical_gates)} gates passed"
    )

    command_contract = servo_profile["commandContract"]
    require(command_contract["spindleRpmRange"] == [0, 8000],
            "pending spindle command range changed without review")
    require(command_contract["nominalMotorRpmRange"] == [-4000, 4000],
            "pending motor command range changed without review")
    require(command_contract["motorSignForM3"] is None and command_contract["motorSignForM4"] is None,
            "M3/M4 motor signs cannot be assigned before physical direction proof")
    require(command_contract["atSpeedRequiredBeforeCuttingFeed"] is True,
            "future digital spindle must gate cutting feed on at-speed proof")
    require(command_contract["normalStopSequence"] == [
        "command-zero",
        "confirm-zero-speed",
        "remove-normal-servo-permission",
    ], "future digital spindle normal-stop sequence changed without review")
    require(command_contract["speedMonitorRegisterIsWriteAuthority"] is False,
            "a generic speed-monitor register cannot become an implicit write target")

    communications = servo_profile["communications"]
    require(communications["enabledInProductionFirmware"] is False,
            "pending servo profile cannot claim active Modbus")
    require(communications["approved"] is False,
            "pending servo communications cannot be approved")
    require(parse_number(config["MODBUS_ENABLE"]) == 0.0,
            "production firmware enabled Modbus before servo-profile approval")
    require(servo_profile["writes"]["registerWhitelist"] == [],
            "pending servo write whitelist must be empty")
    for name, value in servo_profile["writes"].items():
        if name != "registerWhitelist":
            require(value is False, f"pending servo write permit {name} must be false")
    registers = servo_profile["monitoring"]["registers"]
    register_addresses = [register["address"] for register in registers]
    require(len(register_addresses) == len(set(register_addresses)),
            "duplicate pending servo monitoring register")
    require(all(register["approved"] is False for register in registers),
            "generic servo register became approved without a drive fingerprint")
    require(servo_profile["hardware"]["directOctopusToServoConnectionAllowed"] is False,
            "direct Octopus-to-servo wiring must remain forbidden")
    require(servo_profile["hardware"]["analogFallbackRequired"] is True,
            "reversible analog spindle fallback must remain in the pending design")
    require(servo_profile["architecture"]["dualCommandAuthorityAllowed"] is False,
            "analog and digital speed authorities must never be active together")
    notes.append(
        f"pending spindle supervision profile: {len(expected_servo_permits)} permits locked, "
        f"{len(registers)} reference registers unapproved"
    )

    require("ORIGIN = 0x08008000" in linker, "application is not linked at 0x08008000")
    require("_FLASH_VectorTable = ORIGIN(FLASH)" in linker, "vector-table linker symbol missing")
    vector_section = linker.split(".isr_vector", 1)[1].split(".text", 1)[0]
    require(">FLASH" in vector_section, "interrupt vector table is not in application flash")
    notes.append("32 KiB BTT bootloader preserved; application origin 0x08008000")

    occupied: dict[str, str] = {}
    exti: dict[int, str] = {}
    for signal in manifest["signals"]:
        base = signal["macro"]
        actual = macro_gpio(board, base)
        expected = signal["gpio"]
        require(actual == expected, f"{base}: map has {actual}, manifest expects {expected}")
        require(actual not in occupied, f"GPIO collision: {base} and {occupied.get(actual)} both use {actual}")
        occupied[actual] = base

        if signal.get("interrupt"):
            pin_match = PIN_RE.fullmatch(actual)
            assert pin_match is not None
            line = int(pin_match.group(2))
            require(line not in exti, f"EXTI{line} collision: {base} and {exti.get(line)}")
            exti[line] = base

    expected_exti = {0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15}
    require(set(exti) == expected_exti, f"unexpected EXTI allocation: {sorted(exti)}")
    irq_inputs = sum(not name.endswith("_MOTOR_FAULT") for name in exti.values())
    notes.append(
        f"{len(occupied)} unique GPIO assignments; {len(exti)} inputs reserved on distinct EXTI "
        "line numbers; the PG12-PG15 per-axis drive-fault inputs get no IRQ and are not read, "
        f"so at most {irq_inputs} EXTI lines are used"
    )

    expected_config = {
        "DEFAULT_X_STEPS_PER_MM": manifest["motion"]["steps_per_mm"]["x"],
        "DEFAULT_Y_STEPS_PER_MM": manifest["motion"]["steps_per_mm"]["y"],
        "DEFAULT_Z_STEPS_PER_MM": manifest["motion"]["steps_per_mm"]["z"],
        "DEFAULT_X_MAX_RATE": manifest["machine"]["max_rate_mm_min"]["x"],
        "DEFAULT_Y_MAX_RATE": manifest["machine"]["max_rate_mm_min"]["y"],
        "DEFAULT_Z_MAX_RATE": manifest["machine"]["max_rate_mm_min"]["z"],
        "DEFAULT_X_MAX_TRAVEL": manifest["machine"]["travel_mm"]["initial_soft_limit"]["x"],
        "DEFAULT_Y_MAX_TRAVEL": manifest["machine"]["travel_mm"]["initial_soft_limit"]["y"],
        "DEFAULT_Z_MAX_TRAVEL": manifest["machine"]["travel_mm"]["initial_soft_limit"]["z"],
        "DEFAULT_STEP_PULSE_MICROSECONDS": manifest["motion"]["pulse_width_us"],
        "DEFAULT_STEP_PULSE_DELAY": manifest["motion"]["direction_setup_us"],
        "DEFAULT_STEPPER_ENABLE_DELAY": manifest["motion"]["enable_delay_ms"]
    }
    for name, expected in expected_config.items():
        require(name in config, f"missing machine setting {name}")
        actual = parse_number(config[name])
        require(math.isclose(actual, expected, rel_tol=0.0, abs_tol=1e-5),
                f"{name}: config has {actual}, manifest expects {expected}")

    ppr = manifest["motion"]["pulses_per_revolution"]
    for axis in ("x", "y", "z"):
        calculated = ppr / manifest["motion"]["screw_lead_mm"][axis]
        declared = manifest["motion"]["steps_per_mm"][axis]
        require(math.isclose(calculated, declared, rel_tol=0.0, abs_tol=1e-5),
                f"{axis.upper()} step scale does not match pulse count and screw lead")

        step_hz = declared * manifest["machine"]["max_rate_mm_min"][axis] / 60.0
        require(step_hz < 200000.0,
                f"{axis.upper()} exceeds the DM860T V3 200 kHz input limit")
        notes.append(f"{axis.upper()} maximum command rate: {step_hz:.1f} steps/s")

    require(parse_number(config["DEFAULT_STEP_PULSE_MICROSECONDS"]) >= 2.5,
            "DM860T V3 pulse width is below its 2.5 us minimum")
    require(parse_number(config["DEFAULT_STEP_PULSE_DELAY"]) >= 5.0,
            "DM860T V3 direction setup is below its 5 us minimum")
    require(parse_number(config["DEFAULT_STEPPER_ENABLE_DELAY"]) >= 200.0,
            "DM860T V3 enable delay is below its 200 ms requirement")
    require(parse_number(config["DEFAULT_HOMING_ENABLE"]) == 1.0,
            "homing enable must be boolean in this grblHAL checkout")
    require(parse_number(config["DEFAULT_MOTOR_FAULT_SIGNALS_ENABLE"]) == 7.0,
            "all logical axes must monitor driver faults")

    require(expected_settings["schemaVersion"] == 1, "unsupported expected-settings schema")
    require(expected_settings["profile"] == manifest["profile"],
            "expected-settings profile does not match the I/O manifest")
    require(expected_settings["readOnlyQueries"] == ["?", "$I+", "$$", "$G", "$#", "$N", "?"],
            "preflight query policy contains a command that is not approved read-only traffic")
    setting_ids: set[int] = set()
    fixed_firmware_values = {9: 3.0, 32: 0.0}
    for setting in expected_settings["settings"]:
        setting_id = setting["id"]
        require(isinstance(setting_id, int) and setting_id >= 0,
                f"invalid expected setting id {setting_id!r}")
        require(setting_id not in setting_ids, f"duplicate expected setting ${setting_id}")
        setting_ids.add(setting_id)
        require(setting["severity"] in {"blocker", "warning"},
                f"${setting_id}: invalid severity {setting['severity']!r}")
        expected = float(setting["expected"])
        tolerance = float(setting["tolerance"])
        require(tolerance >= 0.0, f"${setting_id}: tolerance cannot be negative")

        source = setting.get("source")
        if source is None:
            require(setting_id in fixed_firmware_values,
                    f"${setting_id}: expected setting has no config source")
            actual = fixed_firmware_values[setting_id]
        elif "macro" in source:
            macro = source["macro"]
            require(macro in config, f"${setting_id}: missing config macro {macro}")
            actual = parse_number(resolve(config, config[macro])) * float(source.get("scale", 1.0))
            if source.get("invertBoolean", False):
                actual = 0.0 if actual else 1.0
        elif "coreMacro" in source:
            # Inspect an inherited core default without inventing a profile override.
            # Force-included machine configuration takes precedence over core defaults.
            # Off/On are resolved from the core's real definitions, not assumed here.
            macro = source["coreMacro"]
            core_defaults = parse_defines(CORE_CONFIG_PATH)
            require(macro in core_defaults, f"${setting_id}: missing core default {macro}")
            inherited = {**parse_defines(CORE_CONSTANTS_PATH), **core_defaults, **config}
            actual = parse_number(resolve(inherited, macro)) * float(source.get("scale", 1.0))
            if source.get("invertBoolean", False):
                actual = 0.0 if actual else 1.0
        else:
            bit_macros = source.get("bitMacros")
            require(isinstance(bit_macros, list) and bit_macros,
                    f"${setting_id}: invalid bitMacros source")
            actual = 0.0
            used_bits: set[int] = set()
            for bit_macro in bit_macros:
                macro = bit_macro["macro"]
                bit_number = bit_macro["bit"]
                require(macro in config, f"${setting_id}: missing config macro {macro}")
                require(isinstance(bit_number, int) and 0 <= bit_number < 32,
                        f"${setting_id}: invalid bit {bit_number!r}")
                require(bit_number not in used_bits,
                        f"${setting_id}: duplicate bit {bit_number}")
                used_bits.add(bit_number)
                if parse_number(resolve(config, config[macro])) != 0.0:
                    actual += float(1 << bit_number)

        require(math.isclose(actual, expected, rel_tol=0.0, abs_tol=tolerance),
                f"${setting_id} {setting['name']}: profile produces {actual}, expected {expected}")
    notes.append(f"{len(setting_ids)} startup settings cross-checked against the firmware profile")
    notes.append("Windows preflight policy contains read-only status and report queries only")

    fail_percent = parse_number(config["DEFAULT_DUAL_AXIS_HOMING_FAIL_AXIS_LENGTH_PERCENT"])
    fail_min = parse_number(config["DEFAULT_DUAL_AXIS_HOMING_FAIL_DISTANCE_MIN"])
    fail_max = parse_number(config["DEFAULT_DUAL_AXIS_HOMING_FAIL_DISTANCE_MAX"])
    y_travel = parse_number(config["DEFAULT_Y_MAX_TRAVEL"])
    require(0.0 < fail_percent <= 2.0, "dual-Y failure percentage must be in (0, 2]")
    require(0.0 < fail_min <= fail_max <= 10.0, "dual-Y failure clamp must stay within 0-10 mm")
    fail_distance = min(max(y_travel * fail_percent / 100.0, fail_min), fail_max)
    require(fail_distance <= 8.0, "dual-Y homing can rack more than 8 mm before abort")
    notes.append(f"dual-Y homing abort distance: {fail_distance:.3f} mm at initial travel")

    notes.extend(audit_macros())

    require(macro_gpio(board, "M3_ENABLE") == "PA2",
            "MOTOR3 enable is not the Octopus Pro v1.1 pin PA2")
    notes.append("Octopus Pro v1.1 MOTOR3 enable revision check: PA2")
    require(macro_gpio(board, "AUXOUTPUT2") == "PE15",
            "reserved future spindle-direction output is not PE15 (EXP1-8)")
    require(macro_gpio(board, "AUXINPUT2") == "PB7",
            "fixed tool-setter input is not PB7")
    require(manifest["board"].get("bltouch_hardware_installed") is False,
            "MR-1 manifest must prohibit BLTouch hardware")
    require(manifest["board"].get("bltouch_plugin_enabled") is False,
            "MR-1 manifest must prohibit the BLTouch firmware plugin")
    reserved_reasons = {
        entry["gpio"]: entry["reason"]
        for entry in manifest["reserved"]
        if "gpio" in entry
    }
    require("PD5/PD6" in reserved_reasons and "Future isolated servo Modbus" in reserved_reasons["PD5/PD6"],
            "candidate servo USART2 pins are not held in the manifest")
    require("PE15" in reserved_reasons and "spindle direction" in reserved_reasons["PE15"],
            "future spindle direction pin is not held in the manifest")
    notes.append("servo candidates held: PD5/PD6 isolated Modbus, PE15 direction; PB7 is tool setter and BLTouch is disabled")

    if FIRMWARE_PATH.exists():
        image = FIRMWARE_PATH.read_bytes()
        require(len(image) >= 8, "compiled firmware image is too short")
        initial_sp, reset_vector = struct.unpack_from("<II", image)
        reset_address = reset_vector & ~1
        require(0x20000000 <= initial_sp <= 0x20030000,
                f"firmware initial stack pointer is invalid: 0x{initial_sp:08X}")
        require(reset_vector & 1, f"firmware reset vector is not Thumb code: 0x{reset_vector:08X}")
        require(0x08008000 <= reset_address < 0x08100000,
                f"firmware reset handler is outside application flash: 0x{reset_address:08X}")
        require(len(image) < 8 or image[-8:-5] != b"UFD",
                "firmware.bin has a DFU suffix; the BTT SD image must be raw")
        forbidden_commands = (
            b"[STEP TEST]",
            b"step pulse test",
            b"enter DFU bootloader",
            b"$ODOMETERS",
        )
        for marker in forbidden_commands:
            require(marker not in image,
                    f"production firmware contains forbidden command marker {marker!r}")
        require(b"MR1 SERVO AXIS LAB" not in image,
                "production firmware contains the servo-axis lab identity marker")
        notes.append("production image excludes $TST, $ODOMETERS, and runtime bootloader-entry commands")
        notes.append(
            f"compiled image: {len(image)} bytes; SP 0x{initial_sp:08X}; reset 0x{reset_vector:08X}"
        )
    else:
        notes.append("compiled image not present; binary-vector audit deferred until after build")

    if SERVO_AXIS_FIRMWARE_PATH.exists():
        lab_image = SERVO_AXIS_FIRMWARE_PATH.read_bytes()
        require(len(lab_image) >= 8, "compiled servo-axis lab image is too short")
        lab_sp, lab_reset_vector = struct.unpack_from("<II", lab_image)
        lab_reset_address = lab_reset_vector & ~1
        require(0x20000000 <= lab_sp <= 0x20030000,
                f"servo-axis lab initial stack pointer is invalid: 0x{lab_sp:08X}")
        require(lab_reset_vector & 1,
                f"servo-axis lab reset vector is not Thumb code: 0x{lab_reset_vector:08X}")
        require(0x08008000 <= lab_reset_address < 0x08100000,
                f"servo-axis lab reset handler is outside application flash: 0x{lab_reset_address:08X}")
        require(len(lab_image) < 8 or lab_image[-8:-5] != b"UFD",
                "servo-axis lab image has a DFU suffix; BTT SD images must be raw")
        require(b"MR1 SERVO AXIS LAB - DO NOT USE IN PRODUCTION" in lab_image,
                "compiled servo-axis image is missing its non-production identity marker")
        if FIRMWARE_PATH.exists():
            require(lab_image != FIRMWARE_PATH.read_bytes(),
                    "production and servo-axis lab images are unexpectedly identical")
        notes.append(
            f"servo-axis lab image: {len(lab_image)} bytes; SP 0x{lab_sp:08X}; "
            f"reset 0x{lab_reset_vector:08X}; non-production marker present"
        )
    else:
        notes.append("servo-axis lab image not present; binary-vector audit deferred until after build")
    return notes


def main() -> int:
    try:
        notes = audit()
    except (AuditError, MacroAuditError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"MR-1 profile audit: FAIL\n{exc}", file=sys.stderr)
        return 1

    print("MR-1 profile audit: PASS")
    for note in notes:
        print(f"- {note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
