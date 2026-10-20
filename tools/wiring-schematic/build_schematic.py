"""Build the one-page MR1 wiring schematic: docs/wiring/MR1-SCHEMATIC.svg.

Pin assignments come from docs/wiring/mr1/io-manifest.json; the build fails if
any GPIO drawn here no longer matches it. Circuit details follow
ALARM_INTERFACE.md, COMMAND_SUPPLY.md, CL57T_QUICK_WIRING.md, INTERFACE_BOARD.md
and WIRING.md. The drawing is an overview, not an approval to energize.

    python tools/wiring-schematic/build_schematic.py
    python tools/wiring-schematic/build_schematic.py --check
"""
from pathlib import Path
from xml.sax.saxutils import escape
import argparse
import json
import sys

REPOSITORY = Path(__file__).resolve().parent.parent.parent
MANIFEST = REPOSITORY / 'docs' / 'wiring' / 'mr1' / 'io-manifest.json'
OUTPUT = REPOSITORY / 'docs' / 'wiring' / 'MR1-SCHEMATIC.svg'

W, H = 1650, 1275  # US Letter / A4 landscape proportions

C = {
    'motion': '#c62828',   # 36 V motion bus
    'control': '#d97706',  # 24 V control
    'cmd': '#1565c0',      # +5_MOTION command domain
    'logic': '#2e7d32',    # Octopus 3.3 V logic and GND
    'alarm': '#7b1fa2',    # isolated 23 V alarm field
    'field': '#00838f',    # isolated 5 V field / analog spindle
    'mains': '#37474f',    # mains and hardwired safety
    'ink': '#1b1f24',
    'muted': '#5b6470',
    'paper': '#ffffff',
    'panel': '#f6f8fa',
    'board': '#eef4ee',
    'hold': '#fff4e5',
}

# GPIOs drawn on the page, checked against io-manifest.json.
DRAWN_GPIO = {
    'X_STEP': 'PF13', 'X_DIRECTION': 'PF12',
    'Y_STEP': 'PG0', 'Y_DIRECTION': 'PG1',
    'Z_STEP': 'PF11', 'Z_DIRECTION': 'PG3',
    'M3_STEP': 'PG4', 'M3_DIRECTION': 'PC1',
    'X_LIMIT': 'PG6', 'Y_LIMIT': 'PG9', 'Z_LIMIT': 'PG10', 'M3_LIMIT': 'PG11',
    'X_MOTOR_FAULT': 'PG12', 'Y_MOTOR_FAULT': 'PG13',
    'Z_MOTOR_FAULT': 'PG14', 'M3_MOTOR_FAULT': 'PG15',
    'MOTOR_FAULT': 'PB1', 'SAFETY_DOOR': 'PC0', 'PROBE': 'PF5',
    'TOOLSETTER': 'PB7', 'RESET': 'PF3', 'FEED_HOLD': 'PF4',
    'CYCLE_START': 'PB2', 'SPINDLE_PWM': 'PA8', 'SPINDLE_ENABLE': 'PD14',
    'COOLANT_FLOOD': 'PA0', 'COOLANT_MIST': 'PA3',
}

FONT = "Inter, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "'JetBrains Mono', Consolas, 'DejaVu Sans Mono', monospace"

out = []


def el(s):
    out.append(s)


def text(x, y, s, size=11, color=None, weight=400, anchor='start', mono=False, italic=False):
    family = MONO if mono else FONT
    style = ' font-style="italic"' if italic else ''
    el(f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" '
       f'font-weight="{weight}" fill="{color or C["ink"]}" text-anchor="{anchor}"{style}>{escape(s)}</text>')


def rect(x, y, w, h, stroke=None, fill=None, dash=False, r=6, width=1.4):
    d = ' stroke-dasharray="6 4"' if dash else ''
    el(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill or C["paper"]}" '
       f'stroke="{stroke or C["ink"]}" stroke-width="{width}"{d}/>')


def wire(points, color, dash=False, width=2.2):
    d = ' stroke-dasharray="7 5"' if dash else ''
    p = ' '.join(f'{x},{y}' for x, y in points)
    el(f'<polyline points="{p}" fill="none" stroke="{color}" stroke-width="{width}" '
       f'stroke-linejoin="round" stroke-linecap="round"{d}/>')


def dot(x, y, color):
    el(f'<circle cx="{x}" cy="{y}" r="3.4" fill="{color}"/>')


def pin(x, y, color):
    el(f'<rect x="{x - 4}" y="{y - 4}" width="8" height="8" fill="{C["paper"]}" stroke="{color}" stroke-width="1.6"/>')


def ground(x, y, color):
    el(f'<path d="M{x},{y} v7 M{x - 8},{y + 7} h16 M{x - 5},{y + 11} h10 M{x - 2},{y + 15} h4" '
       f'stroke="{color}" stroke-width="1.6" fill="none"/>')


def contact(x, y, color, label=None):
    """Normally-open contact, 34 px long, drawn left to right."""
    el(f'<path d="M{x},{y} h9 M{x + 9},{y} l15,-8 M{x + 25},{y} h9" stroke="{color}" '
       f'stroke-width="2" fill="none" stroke-linecap="round"/>')
    dot(x + 9, y, color)
    dot(x + 25, y, color)
    if label:
        text(x + 17, y + 15, label, 8.5, C['muted'], anchor='middle', mono=True)


def fuse(x, y, color, label):
    el(f'<rect x="{x}" y="{y - 5}" width="26" height="10" rx="2" fill="{C["paper"]}" stroke="{color}" stroke-width="1.6"/>')
    el(f'<line x1="{x}" y1="{y}" x2="{x + 26}" y2="{y}" stroke="{color}" stroke-width="1"/>')
    text(x + 13, y - 9, label, 8.5, color, 600, 'middle')


def tag(x, y, s, color, w=None, pointing='right'):
    """Off-sheet style connector: a named net continues at the matching tag."""
    w = w or (len(s) * 6.3 + 22)
    h = 18
    if pointing == 'right':
        d = f'M{x},{y - h / 2} h{w - 9} l9,{h / 2} l-9,{h / 2} h{-(w - 9)} z'
        tx = x + (w - 9) / 2
    else:
        d = f'M{x},{y} l9,{-h / 2} h{w - 9} v{h} h{-(w - 9)} z'
        tx = x + 9 + (w - 9) / 2
    el(f'<path d="{d}" fill="{C["paper"]}" stroke="{color}" stroke-width="1.6"/>')
    text(tx, y + 4, s, 9.5, color, 700, 'middle')
    return w


def block(x, y, w, h, title, lines=(), stroke=None, hold=False, fill=None, title_color=None, size=10):
    rect(x, y, w, h, stroke, fill or (C['hold'] if hold else C['paper']), dash=hold)
    text(x + 8, y + 15, title, 10.5, title_color or stroke or C['ink'], 700)
    for i, line in enumerate(lines):
        text(x + 8, y + 29 + i * 13, line, size, C['muted'])
    if hold:
        el(f'<rect x="{x + w - 38}" y="{y + h - 18}" width="32" height="13" rx="3" fill="{C["control"]}"/>')
        text(x + w - 22, y + h - 8, 'HOLD', 8.5, C['paper'], 700, 'middle')


# ---------------------------------------------------------------- layout
OCT_X, OCT_W = 420, 400
OCT_R = OCT_X + OCT_W
PANEL_X, PANEL_W = 880, 260
PANEL_R = PANEL_X + PANEL_W
DRV_X, DRV_W = 1200, 200
MOT_X, MOT_W = 1460, 160

AXES = [
    # name, socket, step, dir, stop, fault gpio, slice top
    ('X', 'MOTOR0', 'PF13', 'PF12', 'STOP4', 'PG12', 220),
    ('Y-left', 'MOTOR1', 'PG0', 'PG1', 'STOP5', 'PG13', 375),
    ('Z', 'MOTOR2', 'PF11', 'PG3', 'STOP6', 'PG14', 530),
    ('Y-right', 'MOTOR3', 'PG4', 'PC1', 'STOP7', 'PG15', 685),
]
RELAY = {'X': 'K-X', 'Y-left': 'K-YL', 'Z': 'K-Z', 'Y-right': 'K-YR'}
FUSE = {'X': 'F-X', 'Y-left': 'F-YL', 'Z': 'F-Z', 'Y-right': 'F-YR'}


def left_pin(y, label, color):
    pin(OCT_X, y, color)
    text(OCT_X + 10, y + 4, label, 10.5, C['ink'], mono=True)


def right_pin(y, label, color):
    pin(OCT_R, y, color)
    text(OCT_R - 10, y + 4, label, 10.5, C['ink'], anchor='end', mono=True)


def draw():
    el(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
       f'role="img" aria-labelledby="t d">')
    el('<title id="t">MR-1 wiring schematic: Octopus Pro v1.1, four CL57T V4.1 drives</title>')
    el('<desc id="d">One-page overview of power, command, alarm, home, probe, operator, spindle and '
       'coolant wiring. Planning drawing; dashed HOLD items are not designed or qualified.</desc>')
    rect(0, 0, W, H, C['paper'], C['paper'], r=0)

    # Title band
    text(30, 46, 'MR-1 WIRING SCHEMATIC', 26, C['ink'], 800)
    text(372, 46, 'BTT Octopus Pro v1.1 (STM32F429, grblHAL)  ·  4 × CL57T V4.1 closed loop  ·  stock spindle servo',
         14, C['muted'], 500)
    text(W - 30, 34, 'One-page overview  ·  2026-10-20', 11, C['muted'], 600, 'end')
    text(W - 30, 50, 'Pins: docs/wiring/mr1/io-manifest.json', 11, C['muted'], 400, 'end')
    el(f'<rect x="30" y="62" width="{W - 60}" height="22" rx="4" fill="{C["hold"]}" stroke="{C["control"]}"/>')
    text(W / 2, 77, 'PLANNING DRAWING. NOT APPROVAL TO ENERGIZE OR MOVE. Dashed = HOLD (not designed or not '
         'qualified). Printed terminal names on the real parts win over this page.', 11, '#8a4b00', 700, 'middle')

    # Column headings
    for x, s in ((30, 'FIELD DEVICES & POWER'), (OCT_X, 'CONTROLLER'), (PANEL_X, 'MR1 INTERFACE PANEL'),
                 (DRV_X, 'DRIVES'), (MOT_X, 'MOTORS')):
        text(x, 104, s, 10, C['muted'], 700)

    # ------------------------------------------------------------ Octopus
    rect(OCT_X, 112, OCT_W, 923, C['logic'], C['board'], r=10, width=2)

    # ------------------------------------------------------------ left side: inputs
    lx = 30
    # 24 V supply -> MAIN POWER
    block(lx, 116, 250, 44, '24 V CONTROL PSU', ['always on · feeds Octopus, PS-ALM, relays'], C['control'])
    wire([(280, 138), (OCT_X, 138)], C['control'], width=3)
    text(300, 132, '+24 V / 0 V', 9.5, C['control'], 700)
    left_pin(138, 'MAIN POWER +VIN/GND  24 V', C['control'])
    text(OCT_X + 10, 152, '24 V only · 28 V abs max · never 36 V', 9, '#b42318', 600)

    block(lx, 172, 250, 36, 'WINDOWS PC', ['grblHAL sender over USB (data only)'], C['ink'])
    wire([(280, 190), (OCT_X, 190)], C['ink'])
    text(300, 184, 'USB', 9.5, C['ink'], 700)
    left_pin(190, 'USB-C  (J68 removed)', C['ink'])

    # operator / safety monitor inputs (dry contacts, Octopus GND return)
    ops = [
        (264, 'E-stop safety-relay monitor', 'closed while relay energized', 'TB      PF3  E-STOP', True),
        (300, 'Door interlock switch', 'NC, closed = healthy', 'PWR-DET PC0  DOOR', False),
        (336, 'Feed-hold button', 'NC, closed = healthy', 'T0      PF4  FEED HOLD', False),
        (372, 'Cycle-start button', 'NO, guarded; add protection', 'EXP2    PB2  CYCLE START', False),
    ]
    block(lx, 230, 250, 186, 'OPERATOR & SAFETY MONITORS', [], C['logic'])
    for y, name, sub, label, hold in ops:
        text(lx + 10, y, name, 10.5, C['ink'], 600)
        text(lx + 10, y + 12, sub, 9, C['muted'])
        ground(lx + 186, y + 2, C['logic'])
        wire([(lx + 186, y + 2), (lx + 200, y + 2)], C['logic'])
        contact(lx + 200, y + 2, C['logic'])
        wire([(lx + 234, y + 2), (OCT_X, y + 2)], C['logic'], dash=hold)
        left_pin(y + 2, label, C['logic'])
    text(lx + 10, 400, 'Dry contacts to Octopus GND.', 9, C['muted'], italic=True)
    text(lx + 10, 411, 'PF3 contact is part of the HOLD stop design.', 9, C['muted'], italic=True)

    # home switches through conditioner
    homes = [('X', 'STOP0   PG6   X HOME', 452), ('Y-left', 'STOP1   PG9   Y-LEFT HOME', 484),
             ('Z', 'STOP2   PG10  Z HOME', 516), ('Y-right', 'STOP3   PG11  Y-RIGHT HOME', 548)]
    block(lx, 432, 120, 132, 'HOME SWITCHES', ['stock harness:', 'trace it, split the', 'shared Y2/Z circuit', 'into 4 channels'], C['field'])
    block(lx + 135, 432, 115, 132, 'CONDITIONER', ['isolated, 4 ch', 'TLP281 module', 'not approved', ''], C['field'], hold=True)
    for axis, label, y in homes:
        wire([(lx + 120, y + 18), (lx + 135, y + 18)], C['field'], dash=True)
        wire([(lx + 250, y + 18), (OCT_X, y + 18)], C['logic'], dash=True)
        left_pin(y + 18, label, C['logic'])
    text(lx, 578, 'Healthy = low. Fully verified bare NC contacts may go direct to GND.', 9, C['muted'], italic=True)

    # probe and tool setter via HW-399
    block(lx, 606, 120, 84, 'PROBE & SETTER', ['3D touch probe', 'fixed tool setter', 'ISO 5 V field'], C['field'])
    block(lx + 135, 606, 115, 84, 'HW-399', ['opto isolator', 'field GND ≠ HGND', ''], C['field'], hold=True)
    for y, label in ((636, 'T1      PF5   PROBE'), (668, 'J43     PB7   TOOL SETTER')):
        wire([(lx + 120, y), (lx + 135, y)], C['field'], dash=True)
        wire([(lx + 250, y), (OCT_X, y)], C['logic'], dash=True)
        left_pin(y, label, C['logic'])
    text(OCT_X + 10, 684, '(5-pin header silked BLTouch: PB7 + GND only; PC5 PROBE port unused)', 9, C['muted'])

    # mains / safety / 36 V
    block(lx, 716, 310, 92, 'E-STOP + SAFETY RELAY  (needs a reviewed design)',
          ['Dual-channel E-stop and interlocks. On stop it must:', ' · open the motion contactor (36 V off, Z-drop plan)',
           ' · remove spindle-servo energy (contactor / STO, not SON)', ' · cut coolant pump and air-solenoid supply'],
          C['mains'], hold=True)
    block(lx, 826, 140, 50, 'MAINS', ['120 VAC machine loads', '240 VAC spindle servo'], C['mains'])
    block(lx + 170, 826, 140, 50, 'MOTION CONTACTOR', ['opened by safety relay', ''], C['mains'], hold=True)
    wire([(lx + 140, 851), (lx + 170, 851)], C['mains'], width=2.6)
    wire([(lx + 240, 808), (lx + 240, 826)], C['mains'], dash=True)
    block(lx + 170, 896, 140, 50, '36 V MOTION PSU', ['S-360-36 · 36 V / 10 A', 'CL57T bus ≤ 50 V abs'], C['motion'])
    wire([(lx + 240, 876), (lx + 240, 896)], C['mains'], width=2.6)
    wire([(lx + 240, 946), (lx + 240, 971)], C['motion'], width=3)
    tag(lx + 150, 980, '36 V → F-X · F-YL · F-Z · F-YR', C['motion'], w=210)
    wire([(lx + 55, 876), (lx + 55, 971)], C['mains'], width=2.6)
    tag(lx, 980, 'to 24 V PSU', C['mains'], w=100)
    text(lx, 1008, 'One fused star branch per drive (no daisy chain). Never 36 V to the Octopus.', 9, C['motion'], 600)
    text(lx, 1024, 'PE: bond backplate, frame, DIN rail and each drive chassis directly.', 9, C['muted'], 600)

    # ------------------------------------------------------------ Octopus centre notes
    text(OCT_X + 14, 722, 'BTT OCTOPUS PRO v1.1', 17, C['logic'], 800)
    text(OCT_X + 14, 740, 'STM32F429ZGT6 · grblHAL MR1 profile', 11, C['muted'], 600)
    text(OCT_X + 14, 754, 'All GPIO 3.3 V. No field 5 V or 24 V on any pin.', 10, '#b42318', 600)
    rect(OCT_X + 14, 768, 210, 160, C['muted'], C['paper'], r=6, width=1)
    text(OCT_X + 24, 785, 'LEAVE EMPTY / REMOVE', 10, C['ink'], 700)
    for i, s in enumerate(['A1 A2 B1 B2 motor outputs, all 8', 'Driver EN contact 1 (reserved)',
                           'VM/VIN/HV, mode and DIAG jumpers', 'Every STOP 5 V cavity',
                           'MOTOR-POWER, BED-POWER, BED-OUT', 'J68 USB-power jumper',
                           'SW2 "BOOT1" shares PB2: guard it', 'microSD (disabled)']):
        text(OCT_X + 24, 802 + i * 15, '· ' + s, 9.5, C['muted'])

    # ------------------------------------------------------------ right side: command + alarm
    rect(PANEL_X, 112, PANEL_W, 723, C['cmd'], C['panel'], r=10, width=1.6)

    # supplies into panel
    right_pin(124, 'DRIVER0 10  VCC_IO +5 V', C['cmd'])
    wire([(OCT_R, 124), (PANEL_X + 14, 124)], C['cmd'], width=2.6)
    fuse(PANEL_X + 14, 124, C['cmd'], '')
    wire([(PANEL_X + 40, 124), (PANEL_X + 50, 124)], C['cmd'], width=2.6)
    text(PANEL_X + 54, 128, 'F_CMD 0.5 A fast → +5_MOTION', 9.5, C['cmd'], 700)

    right_pin(146, 'DRIVER0  9  GND (CTRL_0V)', C['cmd'])
    wire([(OCT_R, 146), (PANEL_X + 50, 146)], C['cmd'], width=2.6)
    text(PANEL_X + 54, 150, 'CTRL_0V → 8 sink sources', 9.5, C['cmd'], 700)

    right_pin(168, 'I2C 3.3 V  (TB-C3)', C['logic'])
    wire([(OCT_R, 168), (PANEL_X + 50, 168)], C['logic'])
    text(PANEL_X + 54, 172, '2.2 kΩ pull-ups on PB1, PG12–15', 9.5, C['logic'], 700)

    # PB1 aggregate stop chain
    right_pin(204, 'EXP2 PB1  DRIVE-FAULT STOP', C['logic'])
    wire([(OCT_R, 204), (PANEL_X + 10, 204)], C['logic'])
    cx = PANEL_X + 10
    for i, k in enumerate(['K-X', 'K-YL', 'K-Z', 'K-YR']):
        contact(cx + i * 52, 204, C['logic'], k)
        wire([(cx + i * 52 + 34, 204), (cx + (i + 1) * 52, 204)], C['logic'])
    ground(cx + 4 * 52, 204, C['logic'])
    text(PANEL_X + 10, 190, 'relay contacts 11–14 in series · 100 nF on each input', 8.5, C['muted'])

    for axis, socket, step, dirn, stop, fgpio, top in AXES:
        r1, r2 = top + 35, top + 95
        k = RELAY[axis]
        # Octopus pins
        right_pin(r1, f'{socket}  {step} STEP · {dirn} DIR', C['cmd'])
        right_pin(r2, f'{stop}  {fgpio}  {axis.upper()} ALARM', C['logic'])
        text(OCT_R - 10, r2 + 15, 'snapshot only (MR1F:1)', 8.5, C['muted'], anchor='end')
        # command sinks
        wire([(OCT_R, r1), (PANEL_X + 14, r1)], C['cmd'], width=2.6)
        rect(PANEL_X + 14, r1 - 17, 110, 34, C['cmd'], C['paper'], r=4)
        text(PANEL_X + 69, r1 - 3, '2 × 2N7002 sink', 9.5, C['cmd'], 700, 'middle')
        text(PANEL_X + 69, r1 + 10, 'drains to PUL−, DIR−', 8.5, C['muted'], anchor='middle')
        wire([(PANEL_X + 124, r1), (DRV_X, r1)], C['cmd'], width=2.6)
        text(PANEL_R + 4, r1 - 6, f'CMD-{axis[0] if axis in ("X", "Z") else "Y" + axis[2].upper()}', 9, C['cmd'], 700)
        # relay
        wire([(OCT_R, r2), (PANEL_X + 14, r2)], C['logic'])
        rect(PANEL_X + 14, r2 - 26, 232, 52, C['alarm'], C['paper'], r=4)
        text(PANEL_X + 22, r2 - 13, k, 10, C['alarm'], 800)
        text(PANEL_X + 58, r2 - 13, 'Weidmüller 2618530000', 8.5, C['muted'])
        wire([(PANEL_X + 14, r2), (PANEL_X + 24, r2)], C['logic'])
        contact(PANEL_X + 24, r2, C['logic'], '21–24')
        wire([(PANEL_X + 58, r2), (PANEL_X + 68, r2)], C['logic'])
        ground(PANEL_X + 68, r2, C['logic'])
        text(PANEL_X + 84, r2 + 4, '11–14 → PB1 chain', 8.5, C['muted'])
        # coil: A1 from +23 V, A2 to the drive's ALM output
        cx0 = PANEL_X + 190
        el(f'<rect x="{cx0}" y="{r2 - 8}" width="30" height="16" fill="{C["paper"]}" stroke="{C["alarm"]}" stroke-width="1.8"/>')
        el(f'<line x1="{cx0}" y1="{r2 + 8}" x2="{cx0 + 30}" y2="{r2 - 8}" stroke="{C["alarm"]}" stroke-width="1"/>')
        text(cx0 + 2, r2 + 19, 'A1', 8, C['alarm'], 700)
        text(cx0 + 28, r2 + 19, 'A2', 8, C['alarm'], 700, 'end')
        wire([(cx0, r2), (cx0 - 10, r2), (cx0 - 10, r2 + 18)], C['alarm'], width=1.6)
        text(cx0 - 14, r2 + 20, '+23 V', 8, C['alarm'], 700, 'end')
        wire([(cx0 + 30, r2), (DRV_X, r2)], C['alarm'], width=2.2)
        text(PANEL_R + 4, r2 - 6, f'ALM-{axis[0] if axis in ("X", "Z") else "Y" + axis[2].upper()}', 9, C['alarm'], 700)

        # drive
        rect(DRV_X, top, DRV_W, 140, C['ink'], C['paper'], r=6, width=1.6)
        text(DRV_X + 12, top + 18, f'CL57T  {axis.upper()}', 13, C['ink'], 800)
        text(DRV_X + 12, top + 39, 'P1  PUL+ PUL− DIR+ DIR−', 9.5, C['cmd'], 600, mono=True)
        text(DRV_X + 12, top + 99, 'P1  ALM → A2 · COM− → ALM 0V', 9, C['alarm'], 600, mono=True)
        text(DRV_X + 12, top + 69, 'ENA, BRK: leave open', 9, C['muted'])
        pin(DRV_X, r1, C['cmd'])
        pin(DRV_X, r2, C['alarm'])
        # motor + encoder
        for y, col, lab in ((top + 30, C['ink'], 'P3 GX16'), (top + 62, C['field'], 'P2 DB15')):
            pin(DRV_X + DRV_W, y, col)
            wire([(DRV_X + DRV_W, y), (MOT_X, y)], col, width=2.2)
            text(DRV_X + DRV_W - 8, y + 4, lab.split()[0], 9.5, col, 700, 'end', mono=True)
            text(DRV_X + DRV_W + 6, y - 5, lab.split()[1], 8.5, col, 600)
        rect(MOT_X, top + 14, MOT_W, 66, C['ink'], C['panel'], r=6)
        text(MOT_X + 10, top + 31, f'{axis.upper()} MOTOR', 10.5, C['ink'], 800)
        text(MOT_X + 10, top + 46, 'A+ A− B+ B− (pins 1–4)', 9, C['muted'])
        text(MOT_X + 10, top + 60, 'encoder: 6 wires + shield', 9, C['muted'])
        text(MOT_X + 10, top + 73, '23HS45-4204D-E1000', 8.5, C['muted'])
        # 36 V branch
        pin(DRV_X + DRV_W, top + 112, C['motion'])
        text(DRV_X + DRV_W - 8, top + 116, 'P4', 9.5, C['motion'], 700, 'end', mono=True)
        wire([(DRV_X + DRV_W, top + 112), (MOT_X, top + 112)], C['motion'], width=3)
        tag(MOT_X, top + 112, f'36 V · {FUSE[axis]}', C['motion'], w=MOT_W)
        text(DRV_X + DRV_W + 6, top + 106, '+VDC/GND', 8.5, C['motion'], 600)

    # alarm supply + return
    rect(PANEL_X + 14, 810, 232, 22, C['alarm'], C['paper'], r=4)
    text(PANEL_X + 22, 825, 'PS-ALM DDR-15G-24 → 23.0 V · F-ALM 0.25 A', 9, C['alarm'], 700)
    text(PANEL_X, 850, 'PS-ALM +Vo → F-ALM → every relay A1 (+23 V).', 9, C['alarm'], 600)
    text(PANEL_X, 863, 'PS-ALM −Vo → every CL57T COM− (ALM 0V): floating.', 9, C['alarm'], 600)
    text(PANEL_X, 876, 'Input from 24 V PSU via its own fuse. Relay 12/22 empty.', 9, C['muted'])
    right_pin(830, 'EXP2 GND  (TB-C0)', C['logic'])
    wire([(OCT_R, 830), (PANEL_X - 22, 830)], C['logic'])
    ground(PANEL_X - 22, 830, C['logic'])
    text(OCT_R - 10, 845, 'relay-contact + RC return', 8.5, C['muted'], anchor='end')

    # ------------------------------------------------------------ spindle & coolant
    outs = [
        (915, 'FAN0  PA8   SPINDLE PWM', 'PWM → isolated 0–5 V', C['field']),
        (948, 'FAN4  PD14  SPINDLE ENABLE', 'Spindle-enable relay', C['control']),
        (981, 'HE0   PA0   FLOOD', 'Flood relay', C['control']),
        (1014, 'HE1   PA3   MIST / AIR', 'Mist / air relay', C['control']),
    ]
    text(PANEL_X, 900, 'SPINDLE & COOLANT', 10, C['muted'], 700)
    text(DRV_X, 900, 'LOADS', 10, C['muted'], 700)
    for y, label, iface, col in outs:
        right_pin(y, label, C['logic'])
        wire([(OCT_R, y), (PANEL_X, y)], C['logic'], dash=True)
        rect(PANEL_X, y - 13, PANEL_W, 26, col, C['hold'], r=4, dash=True)
        text(PANEL_X + 8, y + 4, iface, 10, col, 700)
    text(OCT_R - 10, 1030, 'low-side outputs: verify rail jumpers first', 8.5, C['muted'], anchor='end')
    # loads
    rect(DRV_X, 902, 420, 59, C['field'], C['hold'], r=4, dash=True)
    text(DRV_X + 8, 918, 'STOCK SPINDLE SERVO  (DB44, community map: meter first)', 10, C['field'], 700)
    text(DRV_X + 8, 933, '26 = 0–5 V speed · 10 = analog return', 9.5, C['muted'], mono=True)
    text(DRV_X + 8, 948, '16 = SON via dry contact to 24 V I/O 0 V', 9.5, C['muted'], mono=True)
    wire([(PANEL_R, 915), (DRV_X, 915)], C['field'], dash=True)
    wire([(PANEL_R, 948), (DRV_X, 948)], C['control'], dash=True)
    rect(DRV_X, 968, 420, 26, C['control'], C['hold'], r=4, dash=True)
    text(DRV_X + 8, 985, 'FLOOD PUMP  (supply in hardwired stop chain)', 10, C['control'], 700)
    wire([(PANEL_R, 981), (DRV_X, 981)], C['control'], dash=True)
    rect(DRV_X, 1001, 420, 26, C['control'], C['hold'], r=4, dash=True)
    text(DRV_X + 8, 1018, 'MIST / AIR SOLENOID  (supply in hardwired stop chain)', 10, C['control'], 700)
    wire([(PANEL_R, 1014), (DRV_X, 1014)], C['control'], dash=True)

    # ------------------------------------------------------------ footer: legend, settings, never
    fy = 1052
    el(f'<line x1="30" y1="{fy}" x2="{W - 30}" y2="{fy}" stroke="#d0d7de" stroke-width="1"/>')
    text(30, fy + 22, 'WIRE COLOURS', 11, C['ink'], 800)
    legend = [
        (C['motion'], False, '36 V motion bus (CL57T P4)'),
        (C['control'], False, '24 V control'),
        (C['cmd'], False, '+5_MOTION command domain'),
        (C['logic'], False, 'Octopus 3.3 V logic / GND'),
        (C['alarm'], False, 'Isolated 23 V alarm field'),
        (C['field'], False, 'Isolated 5 V field, encoder, analog'),
        (C['mains'], False, 'Mains / hardwired safety'),
        (C['ink'], True, 'Dashed: HOLD, not approved'),
    ]
    for i, (col, dash, s) in enumerate(legend):
        x = 30 + (i // 4) * 235
        y = fy + 42 + (i % 4) * 20
        wire([(x, y - 4), (x + 34, y - 4)], col, dash=dash, width=3)
        text(x + 42, y, s, 10.5, C['ink'])
    text(30, fy + 132, 'Three separate returns: Octopus GND · CTRL_0V (DRIVER0 GND) · ALM 0V (PS-ALM −Vo).',
         10, C['ink'], 600)
    text(30, fy + 147, 'Never join them because they are all called GND.', 10, C['muted'])

    sx = 545
    text(sx, fy + 22, 'ALL FOUR CL57T — SET WITH POWER OFF', 11, C['ink'], 800)
    settings = [('S1', '4'), ('SW1', 'on'), ('SW2', 'off'), ('SW3', 'on'), ('SW4', 'on'),
                ('SW5–8', 'off'), ('S3', '5V')]
    for i, (k, v) in enumerate(settings):
        x = sx + i * 66
        rect(x, fy + 32, 60, 40, C['ink'], C['panel'], r=5, width=1)
        text(x + 30, fy + 48, k, 10, C['muted'], 600, 'middle', mono=True)
        text(x + 30, fy + 66, v, 14, C['ink'], 800, 'middle', mono=True)
    text(sx, fy + 92, 'Socket STEP 7 · DIR 8 · GND 9 · VCC_IO 10 (DRIVER0 only) are schematic', 10, C['ink'])
    text(sx, fy + 106, 'contact IDs, not a pin count. Find pin 1 on the real board first.', 10, C['ink'])
    text(sx, fy + 124, 'PB1 is the only drive-fault stop. PG12–PG15 only report which axis.', 10, C['ink'], 700)
    text(sx, fy + 138, 'Never energize a drive without its motor and encoder connected.', 10, C['ink'])

    nx = 1090
    rect(nx, fy + 10, W - 30 - nx, 150, '#b42318', '#fff5f5', r=8, width=1.4)
    text(nx + 14, fy + 30, 'THE SIX THAT BREAK THINGS', 11, '#b42318', 800)
    never = ['P4 reversed: kills the drive (P4 is polarized)',
             '36 V into Octopus MAIN POWER: kills the board',
             'S3 on 5V with 24 V signals: destroys the input',
             'Raw ALM, stock 5 V or 24 V on any Octopus GPIO',
             'Hot-plugging P3 motor or P4 power',
             'Driver jumpers or DIAG links left on the sockets']
    for i, s in enumerate(never):
        text(nx + 14, fy + 50 + i * 18, f'{i + 1}.  {s}', 10.5, C['ink'])

    text(30, H - 12, 'Generated by tools/wiring-schematic/build_schematic.py. Details: docs/wiring/mr1/WIRING_SIMPLE.md · '
         'ALARM_INTERFACE.md · COMMAND_SUPPLY.md · CL57T_QUICK_WIRING.md · INTERFACE_BOARD.md',
         9.5, C['muted'])
    el('</svg>')


def check_manifest():
    signals = {s['macro']: s['gpio'] for s in json.loads(MANIFEST.read_text(encoding='utf-8'))['signals']}
    wrong = {m: (g, signals.get(m)) for m, g in DRAWN_GPIO.items() if signals.get(m) != g}
    if wrong:
        for macro, (drawn, actual) in sorted(wrong.items()):
            print(f'{macro}: drawn {drawn}, io-manifest.json says {actual}', file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--check', action='store_true', help='fail if the committed SVG is out of date')
    args = parser.parse_args()
    check_manifest()
    draw()
    svg = '\n'.join(out) + '\n'
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding='utf-8') != svg:
            print(f'{OUTPUT.relative_to(REPOSITORY)} is out of date; rerun build_schematic.py', file=sys.stderr)
            sys.exit(1)
        print('schematic up to date')
        return
    OUTPUT.write_text(svg, encoding='utf-8', newline='\n')
    print(f'wrote {OUTPUT.relative_to(REPOSITORY)}')


if __name__ == '__main__':
    main()
