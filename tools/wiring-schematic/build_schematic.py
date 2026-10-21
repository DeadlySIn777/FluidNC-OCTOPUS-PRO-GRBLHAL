"""Build the one-page MR1 wiring schematic: docs/wiring/MR1-SCHEMATIC.svg.

The page is built around BIGTREETECH's official Octopus Pro V1.1 pin drawing.
Every connector this build uses is outlined on the board, and a routed line
runs from it to a card that says what lands on each pin. The image is linked
from BIGTREETECH's pinned repository URL, not copied into this repository. It
shows when a local copy of the SVG is opened in a browser. GitHub's file view,
inline preview and raw link cannot load it; there the same outlines and routes
are drawn over a plain board shape.

Pin assignments come from docs/wiring/mr1/io-manifest.json; the build fails if
any GPIO drawn here no longer matches it. Connector locations are measured on
the same image (tools/visual-wiring/board-regions.json holds the coarser
group areas used by the visual guide). Circuit details follow
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
REGIONS = REPOSITORY / 'tools' / 'visual-wiring' / 'board-regions.json'
OUTPUT = REPOSITORY / 'docs' / 'wiring' / 'MR1-SCHEMATIC.svg'

BOARD_IMAGE_URL = ('https://raw.githubusercontent.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro/'
                   '60a01f412959b62c349ba00da15b45232b7d90c5/Hardware/'
                   'BIGTREETECH%20Octopus%20Pro%20V1.1-Pin.jpg')
IMAGE_W, IMAGE_H = 1912, 1534

# Landscape page. Print on A3 or 11x17; on Letter/A4 body text is about 5 pt.
W, H = 1650, 1275
X0, Y0, S = 340, 294, 0.48  # where the board image sits on the page, and its scale

C = {
    'motion': '#c62828',   # 36 V motion bus
    'control': '#c25e00',  # 24 V control
    'cmd': '#1565c0',      # +5_MOTION command domain
    'logic': '#2e7d32',    # Octopus 3.3 V logic and GND
    'alarm': '#7b1fa2',    # isolated 23 V alarm field
    'field': '#00838f',    # isolated 5 V field, analog spindle
    'mains': '#37474f',    # mains and hardwired safety
    'empty': '#d32f2f',    # leave empty / remove
    'ink': '#1b1f24',
    'muted': '#5b6470',
    'paper': '#ffffff',
    'panel': '#f6f8fa',
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

# Connector locations on the BTT image, in image pixels [x, y, w, h]. Each
# locates a header or terminal body, never a mating-plug cavity. Sockets are
# 150 px apart; MOTOR0 is the one nearest the power terminals per BTT's manual
# (the drawing prints no socket numbers). Confirm on the actual board.
SOCKET_RECT = lambda n: [313 + 150 * n, 267, 149, 193]
STEP_PIN = lambda n: (327 + 150 * n, 424)   # left row, second hole from the bottom
DIR_PIN = lambda n: (327 + 150 * n, 447)    # left row, bottom hole
VCC_PIN = (452, 425)                         # DRIVER0 right row, second from the bottom
GND_PIN = lambda n: (452 + 150 * n, 447)    # right row, bottom hole
PHASE_RECT = [355, 186, 1131, 45]
VOLT_RECT = [335, 250, 1128, 47]
MODE_RECTS = [[343, 388, 92, 72], [492, 388, 97, 72], [644, 388, 95, 72], [791, 388, 98, 72],
              [940, 388, 103, 72], [1098, 388, 95, 72], [1244, 388, 101, 72], [1403, 388, 98, 72]]
DIAG_RECT = [1229, 840, 190, 46]
I2C_RECT = [1509, 214, 40, 106]
TB_RECT = [1115, 738, 184, 74]
DOOR_RECT = [1067, 832, 98, 39]
TOOL_RECT = [1077, 895, 116, 25]
STOP03_RECT = [1213, 906, 229, 94]
STOP47_RECT = [1213, 1004, 229, 103]
COOLANT_RECT = [332, 988, 180, 112]   # HE0 and HE1 only; HE2 starts at the next screw
# BTT's printed pin-name tables for the used connectors stay undimmed.
TABLE_LIT = [[728, 1118, 62, 127], [966, 1118, 62, 127], [1200, 1118, 265, 407], [860, 1365, 330, 75],
             [860, 1258, 170, 102], [1045, 5, 157, 125], [1410, 0, 170, 157], [5, 1150, 242, 118],
             [1670, 870, 235, 490], [8, 493, 135, 182]]

FONT = "Inter, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "'JetBrains Mono', Consolas, 'DejaVu Sans Mono', monospace"

out = []


def el(s):
    out.append(s)


def P(ix, iy):
    """Image pixel to page coordinate."""
    return X0 + ix * S, Y0 + iy * S


def R(rect):
    x, y = P(rect[0], rect[1])
    return x, y, rect[2] * S, rect[3] * S


def text(x, y, s, size=11, color=None, weight=400, anchor='start', mono=False, italic=False):
    family = MONO if mono else FONT
    style = ' font-style="italic"' if italic else ''
    el(f'<text x="{x:g}" y="{y:g}" font-family="{family}" font-size="{size}" '
       f'font-weight="{weight}" fill="{color or C["ink"]}" text-anchor="{anchor}"{style}>{escape(s)}</text>')


def rect(x, y, w, h, stroke=None, fill=None, dash=False, r=6, width=1.4):
    d = ' stroke-dasharray="6 4"' if dash else ''
    el(f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="{r}" fill="{fill or C["paper"]}" '
       f'stroke="{stroke or C["ink"]}" stroke-width="{width}"{d}/>')


def leader(points, color, dash=False, dot=True, hops=()):
    """A routed wire with a thin white halo so it stays readable over the photo.

    hops: x positions on the first horizontal segment where the wire bridges an
    outline it does not connect to.
    """
    d = ' stroke-dasharray="7 5"' if dash else ''
    if hops:
        (x1, y1), (x2, _) = points[0], points[1]
        step = -1 if x2 < x1 else 1
        path = f'M{x1:g},{y1:g}'
        for hx in sorted(hops, reverse=step < 0):
            path += f' H{hx - 6 * step:g} a6,6 0 0 {1 if step > 0 else 0} {12 * step:g},0'
        path += ''.join(f' L{x:g},{y:g}' for x, y in points[1:])
    else:
        path = 'M' + ' L'.join(f'{x:g},{y:g}' for x, y in points)
    el(f'<path d="{path}" fill="none" stroke="#ffffff" stroke-width="5" stroke-opacity="0.9" '
       f'stroke-linejoin="round" stroke-linecap="round"/>')
    el(f'<path d="{path}" fill="none" stroke="{color}" stroke-width="2.4" '
       f'stroke-linejoin="round" stroke-linecap="round"{d}/>')
    if dot:
        x, y = points[0]
        el(f'<circle cx="{x:g}" cy="{y:g}" r="4" fill="{color}" stroke="#ffffff" stroke-width="1.5"/>')


def outline(r, color, dash=False):
    x, y, w, h = R(r)
    d = ' stroke-dasharray="5 3"' if dash else ''
    el(f'<rect x="{x - 2:g}" y="{y - 2:g}" width="{w + 4:g}" height="{h + 4:g}" rx="3" fill="none" '
       f'stroke="#ffffff" stroke-width="6" stroke-opacity="0.85"/>')
    el(f'<rect x="{x - 2:g}" y="{y - 2:g}" width="{w + 4:g}" height="{h + 4:g}" rx="3" fill="none" '
       f'stroke="{color}" stroke-width="3"{d}/>')


def pill(cx, cy, s, color):
    w = len(s) * 6.4 + 12
    el(f'<rect x="{cx - w / 2:g}" y="{cy - 8:g}" width="{w:g}" height="16" rx="8" fill="{color}"/>')
    text(cx, cy + 4, s, 9.5, C['paper'], 700, 'middle')


def pin_mark(p, kind):
    """kind: 'ring' for a signal contact, 'gnd' for logic GND, 'vcc' for +5 V."""
    x, y = P(*p)
    if kind == 'ring':
        el(f'<circle cx="{x:g}" cy="{y:g}" r="4.2" fill="#ffffff" stroke="{C["cmd"]}" stroke-width="2.4"/>')
    elif kind == 'gnd':
        el(f'<circle cx="{x:g}" cy="{y:g}" r="4" fill="{C["ink"]}" stroke="#ffffff" stroke-width="2"/>')
    else:
        el(f'<circle cx="{x:g}" cy="{y:g}" r="4.5" fill="{C["cmd"]}" stroke="#ffffff" stroke-width="1.5"/>')


def badge(x, y):
    el(f'<rect x="{x:g}" y="{y:g}" width="34" height="14" rx="3" fill="{C["control"]}"/>')
    text(x + 17, y + 10.5, 'HOLD', 8.5, C['paper'], 700, 'middle')


def card(x, y, w, h, title, rows, color, hold=False, title_size=11.5):
    """rows: list of (text, colour, mono). An empty text leaves a blank row."""
    rect(x, y, w, h, color, C['hold'] if hold else C['paper'], dash=hold, width=1.6)
    el(f'<rect x="{x:g}" y="{y:g}" width="5" height="{h:g}" rx="2" fill="{color}"/>')
    text(x + 13, y + 17, title, title_size, color, 800)
    if hold:
        badge(x + w - 40, y + 6)
    yy = y + 33
    for s, col, mono in rows:
        if s:
            text(x + 13, yy, s, 10 if mono else 10.5, col, 600 if mono else 400, mono=mono)
        yy += 14.5


def contact(x, y, color, label=None):
    """Normally-open contact, 34 px long, drawn left to right."""
    el(f'<path d="M{x},{y} h9 M{x + 9},{y} l15,-8 M{x + 25},{y} h9" stroke="{color}" '
       f'stroke-width="2" fill="none" stroke-linecap="round"/>')
    for cx in (x + 9, x + 25):
        el(f'<circle cx="{cx}" cy="{y}" r="2.6" fill="{color}"/>')
    if label:
        text(x + 17, y + 14, label, 8.5, C['muted'], anchor='middle', mono=True)


def ground(x, y, color):
    el(f'<path d="M{x},{y} v7 M{x - 8},{y + 7} h16 M{x - 5},{y + 11} h10 M{x - 2},{y + 15} h4" '
       f'stroke="{color}" stroke-width="1.6" fill="none"/>')


def row(s, color='ink', mono=False):
    return (s, C[color], mono)


def draw(regions):
    el(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
       f'viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-labelledby="t d">')
    el('<title id="t">MR-1 wiring schematic on the Octopus Pro v1.1 board</title>')
    el('<desc id="d">The official BIGTREETECH Octopus Pro V1.1 pin drawing with every connector used by the '
       'MR-1 build outlined and routed to what it connects to: four CL57T drives, alarm relays, homes, probe, '
       'operator inputs, spindle, coolant and power. Planning drawing; dashed HOLD items are not designed or '
       'qualified.</desc>')
    rect(0, 0, W, H, C['paper'], C['paper'], r=0)

    # ---------------------------------------------------------------- title
    el(f'<text x="20" y="36" font-family="{FONT}" fill="{C["ink"]}">'
       f'<tspan font-size="26" font-weight="800">MR-1 WIRING SCHEMATIC</tspan>'
       f'<tspan dx="14" font-size="14" font-weight="500" fill="{C["muted"]}">Octopus Pro v1.1 → 4 × CL57T '
       f'V4.1 closed loop · every used connector, routed</tspan></text>')
    text(W - 20, 26, 'One page · print A3 / 11×17 landscape · 2026-10-20', 11, C['muted'], 600, 'end')
    text(W - 20, 41, 'Pins checked against io-manifest.json', 11, C['muted'], 400, 'end')
    el(f'<rect x="20" y="50" width="{W - 40}" height="22" rx="4" fill="{C["hold"]}" stroke="{C["control"]}"/>')
    text(W / 2, 65, 'PLANNING DRAWING — NOT APPROVAL TO ENERGIZE OR MOVE. Dashed = HOLD (not yet designed or '
         'qualified). Printed names on the real board and parts win over this page.', 11, '#8a4b00', 700, 'middle')

    # ---------------------------------------------------------------- board
    bx, by, bw, bh = X0, Y0, IMAGE_W * S, IMAGE_H * S
    # Shown only where the linked image cannot load; the opaque photo covers it.
    rect(bx, by, bw, bh, '#c9d1d9', '#f3f5f7', r=8, width=1)
    ox, oy = P(190, 195)
    rect(ox, oy, (1655 - 190) * S, (1100 - 195) * S, '#8c959f', '#e6e9ed', r=14, width=1.5)
    for i, s in enumerate(['No board photo here? GitHub cannot load', 'the linked BIGTREETECH image. Open a',
                           'downloaded copy of this file in a browser.']):
        text(bx + 8, by + 16 + i * 13, s, 10, C['muted'], 600)
    el(f'<image href="{BOARD_IMAGE_URL}" xlink:href="{BOARD_IMAGE_URL}" x="{bx:g}" y="{by:g}" '
       f'width="{bw:g}" height="{bh:g}" preserveAspectRatio="xMidYMid meet"/>')

    used = ([SOCKET_RECT(n) for n in range(4)] +
            [I2C_RECT, regions['main-power'], regions['usb-c'], regions['exp-pair'], TB_RECT, DOOR_RECT,
             TOOL_RECT, STOP03_RECT, STOP47_RECT, regions['fan0'], regions['fan4'], COOLANT_RECT])
    el('<mask id="lit"><rect x="0" y="0" width="100%" height="100%" fill="#fff"/>')
    for r in used + TABLE_LIT:
        x, y, w, h = R(r)
        el(f'<rect x="{x - 3:g}" y="{y - 3:g}" width="{w + 6:g}" height="{h + 6:g}" fill="#000"/>')
    el('</mask>')
    el(f'<rect x="{bx:g}" y="{by:g}" width="{bw:g}" height="{bh:g}" fill="#ffffff" fill-opacity="0.38" '
       f'mask="url(#lit)"/>')

    # leave-empty / remove groups
    for r in [PHASE_RECT, VOLT_RECT, DIAG_RECT] + MODE_RECTS:
        outline(r, C['empty'], dash=True)
    pb, mp = regions['power-block'], regions['main-power']
    motor_power = [pb[0], pb[1], pb[2], mp[1] - pb[1] - 6]
    bed = [pb[0], mp[1] + mp[3] + 6, pb[2], pb[1] + pb[3] - mp[1] - mp[3] - 6]
    outline(motor_power, C['empty'], dash=True)
    outline(bed, C['empty'], dash=True)

    # used connectors
    for n in range(4):
        outline(SOCKET_RECT(n), C['cmd'])
    outline(I2C_RECT, C['logic'])
    outline(mp, C['control'])
    outline(regions['usb-c'], C['ink'])
    outline(regions['exp-pair'], C['logic'])
    outline(TB_RECT, C['logic'])
    outline(DOOR_RECT, C['logic'])
    outline(TOOL_RECT, C['field'])
    outline(STOP03_RECT, C['field'])
    outline(STOP47_RECT, C['alarm'])
    outline(regions['fan0'], C['field'])
    outline(regions['fan4'], C['control'])
    outline(COOLANT_RECT, C['control'])

    # socket names and the contacts each socket uses
    for n in range(4):
        x, y, w, h = R(SOCKET_RECT(n))
        pill(x + w / 2 + 6, y + h - 50, f'M{n}', C['cmd'])
        pin_mark(DIR_PIN(n), 'ring')
        pin_mark(GND_PIN(n), 'gnd')
    pin_mark(VCC_PIN, 'vcc')

    # ---------------------------------------------------------------- top band: drives
    axes = [
        ('X', 'MOTOR0', 'PF13', 'PF12', 'K-X', 'F-X', 276),
        ('Y-LEFT', 'MOTOR1', 'PG0', 'PG1', 'K-YL', 'F-YL', 266),
        ('Z', 'MOTOR2', 'PF11', 'PG3', 'K-Z', 'F-Z', 276),
        ('Y-RIGHT', 'MOTOR3', 'PG4', 'PC1', 'K-YR', 'F-YR', 286),
    ]
    cw, gap, top, ch = 317, 10, 84, 174
    for n, (axis, socket, step, dirn, relay, fuse, level) in enumerate(axes):
        cx = 340 + n * (cw + gap)
        start = P(*STEP_PIN(n))
        mid = cx + cw / 2
        leader([start, (start[0], level), (mid, level), (mid, top + ch)], C['cmd'])
        pin_mark(STEP_PIN(n), 'ring')
        card(cx, top, cw, ch, f'{axis} DRIVE · CL57T V4.1', [
            row(f'{socket}: STEP {step} (7) · DIR {dirn} (8) · GND (9)', 'cmd', True),
            row('→ 2 × 2N7002 sinks → P1 PUL−, DIR−', 'cmd'),
            row('   P1 PUL+, DIR+ ← +5_MOTION', 'cmd'),
            row(f'P1 ALM → relay {relay} A2 · COM− → ALM 0V', 'alarm'),
            row('P2 ← encoder DB15, 6 wires; braid NOT on P2', 'ink'),
            row('   thin black = EA+; P2 VCC is a drive output', 'muted'),
            row('P3 → motor GX16: A+ A− B+ B− (pins 1–4)'),
            row(f'P4 ← 36 V {fuse}: +VDC / GND, POLARIZED, ≤ 50 V', 'motion'),
            row('ENA, BRK open. STEP/DIR float in MCU reset:', 'empty'),
            row('   36 V OFF to reset or flash. Motor + encoder on.', 'empty'),
        ], C['cmd'])

    # ---------------------------------------------------------------- left column
    lx, lw = 20, 300
    card(lx, 84, lw, 174, 'DRIVER AREA: LEAVE EMPTY / REMOVE', [
        row('A1 A2 B2 B1 motor-output plugs: EMPTY (all 8)', 'empty'),
        row('HV / VM / VIN jumper caps: REMOVE (all 8)', 'empty'),
        row('Mode / SPI jumper caps: REMOVE (all 8)', 'empty'),
        row('M0–M7 DIAG caps: REMOVE (they sit on the', 'empty'),
        row('   PG6–PG15 home and alarm nets)', 'empty'),
        row('No plug-in driver or socket adapter fitted.', 'muted'),
        row('Per socket: 7 STEP, 8 DIR (rings), 9 GND (dot)', 'muted'),
        row('DRIVER0 10 VCC_IO (blue dot): +5 V branch', 'muted'),
        row('EN 1 reserved, not connected.', 'muted'),
    ], C['empty'])

    card(lx, 266, lw, 146, 'MAINS · E-STOP · 36 V MOTION', [
        row('Dual-channel E-stop → safety relay. On stop:', 'mains'),
        row(' · contactor opens 36 V: Z brake / support', 'mains'),
        row(' · spindle-servo energy removed (not SON)', 'mains'),
        row(' · coolant pump and air supply cut', 'mains'),
        row(' · 24 V control stays ON so PF3 / PB1 report', 'control'),
        row('36 V S-360-36 → 4 star branches, fused at PSU', 'motion'),
        row('   → each CL57T P4. 50 V hard max. Never Octopus.', 'motion'),
        row('Monitor contact → TB · PF3 (right).', 'logic'),
    ], C['mains'], hold=True)

    vx, vy = P(*VCC_PIN)
    card(lx, 420, lw, 132, 'COMMAND SUPPLY · DRIVER0 socket', [
        row('VCC_IO +5 V (blue dot) → F_CMD 0.5 A fast', 'cmd'),
        row('   → +5_MOTION → all 8 PUL+ / DIR+', 'cmd'),
        row('Logic GND (black dot) → CTRL_0V', 'cmd'),
        row('   = Octopus GND → all 8 2N7002 sources', 'cmd'),
        row('One takeoff only. Remove J68 (USB power).', 'muted'),
        row('Reset / bootloader protection unfinished.', 'empty'),
    ], C['cmd'], hold=True)
    # Down the gap beside DRIVER0's right row and under the socket, so the line
    # crosses no contact; it bridges the empty MOTOR-POWER terminal.
    mpx, mpy, mpw, mph = R(motor_power)
    jx, jy = vx + 5, P(0, 482)[1]
    leader([(jx, jy), (lx + lw, jy)], C['cmd'], dot=False, hops=(mpx - 2, mpx + mpw + 2), dash=True)
    leader([(vx, vy), (jx, vy + 5), (jx, jy)], C['cmd'])
    pin_mark(GND_PIN(0), 'gnd')

    x, y, w, h = R(mp)
    card(lx, 560, lw, 82, '24 V CONTROL PSU → MAIN POWER', [
        row('+24 V → +VIN · 0 V → GND (read the board marks)', 'control'),
        row('24 V only, 28 V max. 36 V kills the board.', 'empty'),
        row('Also feeds PS-ALM and the interposing relays.', 'muted'),
    ], C['control'])
    leader([(x, y + h / 2), (lx + lw, y + h / 2)], C['control'])

    card(lx, 650, lw, 62, 'MOTOR-POWER · BED-POWER · BED-OUT', [
        row('All EMPTY. Drive power never touches the board.', 'empty'),
    ], C['empty'])
    bx_, by_ = P(bed[0], 800)
    leader([(bx_, by_), (lx + lw, by_)], C['empty'], dash=True)

    hx, hy, hw, hh = R(COOLANT_RECT)
    card(lx, 720, lw, 104, 'HE0 · HE1 → COOLANT RELAYS', [
        row('HE0 · PA0 → flood-pump relay coil', 'control', True),
        row('HE1 · PA3 → mist / air relay coil', 'control', True),
        row('Coil across HE+ (fused VIN) and switched HE−.', 'muted'),
        row('HE− never to GND. Supplies in the stop chain.', 'empty'),
    ], C['control'], hold=True)
    cy = P(0, 1080)[1]
    leader([(hx, cy), (lx + lw, cy)], C['control'], dash=True)

    card(lx, 832, lw, 140, 'GROUNDING · KEEP THESE RETURNS APART', [
        row('Octopus GND = DRIVER0 GND = CTRL_0V: one net', 'logic'),
        row('   logic, pull-ups, contacts, 2N7002 sources', 'cmd'),
        row('ALM 0V: PS-ALM −Vo → all CL57T COM−, floating', 'alarm'),
        row('EGND: each CL57T P2 → its own encoder only', 'ink'),
        row('Probe ISO 0V ≠ home ISO 0V; floating, never HGND', 'field'),
        row('ANALOG_COM: converter OUT− → DB44 10 only', 'field'),
        row('Never join these because they say GND.', 'muted'),
    ], C['ink'])
    card(lx, 980, lw, 64, 'PROTECTIVE EARTH', [
        row('Bond backplate, frame, rail, spindle, drives.'),
        row('Octopus on nylon standoffs. PE is never a return.', 'muted'),
    ], C['mains'])

    # ---------------------------------------------------------------- right column
    rx, rw = 1340, 300

    def right(anchor, jog, cy, y, h, title, rows, color, hold=False, dash=False, via=()):
        card(rx, y, rw, h, title, rows, color, hold=hold)
        leader([anchor, *via, (jog, (via[-1] if via else anchor)[1]), (jog, cy), (rx, cy)], color, dash=dash)

    right(P(I2C_RECT[0] + I2C_RECT[2], 240), 1272, 338, 300, 76, 'I2C header → 3.3 V logic supply', [
        row('3.3 V → TB-C3: five 2.2 kΩ alarm pull-ups', 'logic'),
        row('3.3 V + GND → HW-399 HVCC / HGND (HOLD)', 'field'),
        row('PB8, PB9 empty. HGND never to field GND.', 'muted'),
    ], C['logic'])

    usb = regions['usb-c']
    right(P(usb[0] + usb[2], 385), 1290, 408, 384, 48, 'USB-C → WINDOWS PC', [
        row('Data only. Remove J68 for cabinet use.'),
    ], C['ink'])

    exp = regions['exp-pair']
    right(P(exp[0] + exp[2], 600), 1308, 515, 440, 146, 'EXP2 (find it by its board marking)', [
        row('PB1 ← alarm-relay chain, 11–14 in series', 'logic', True),
        row('    + cabinet/spindle OKs · the ONLY drive-fault stop', 'logic'),
        row('PB2 ← cycle-start button, NO, guarded', 'logic', True),
        row('    + series R, TVS, 3.3 V pull-up, RC', 'muted'),
        row('    onboard SW2 (BOOT1) shares PB2: guard it', 'muted'),
        row('GND → TB-C0, relay-contact + RC return', 'logic', True),
        row('RST is also on EXP2: keyed IDC only.', 'empty'),
        row('EXP1 beside it stays empty.', 'muted'),
    ], C['logic'])

    right(P(TB_RECT[0] + TB_RECT[2], TB_RECT[1]), 1326, 614, 594, 100, 'TB · T0 · T1 thermistor headers', [
        row('TB  PF3 ← E-stop relay monitor (HOLD)', 'logic', True),
        row('    NO contact: closed = relay energized', 'muted'),
        row('T0  PF4 ← feed-hold button, NC', 'logic', True),
        row('T1  PF5 ← probe, HW-399 OUT1 (HOLD)', 'field', True),
        row('Other pin = GND return. TB, T0: + series R, TVS'),
    ], C['logic'], via=(P(1606, 684), P(1634, 654)))

    # legend, settings and the destructive mistakes
    ly = 700
    rect(rx, ly, rw, 150, C['ink'], C['panel'], r=6, width=1)
    text(rx + 12, ly + 18, 'CIRCUIT COLOURS', 11, C['ink'], 800)
    legend = [(C['motion'], False, '36 V motion'), (C['control'], False, '24 V control'),
              (C['cmd'], False, '+5 V command'), (C['logic'], False, '3.3 V logic / GND'),
              (C['alarm'], False, 'Isolated 23 V alarm'), (C['field'], False, 'Iso. field / analog'),
              (C['mains'], False, 'Mains / E-stop'), (C['ink'], False, 'USB data'),
              (C['empty'], True, 'Leave empty / remove')]
    for i, (col, dash, s) in enumerate(legend):
        x = rx + 12 + (i % 2) * 146
        y = ly + 38 + (i // 2) * 20
        d = ' stroke-dasharray="6 4"' if dash else ''
        el(f'<line x1="{x}" y1="{y - 4}" x2="{x + 26}" y2="{y - 4}" stroke="{col}" stroke-width="3"{d}/>')
        text(x + 32, y, s, 9.5, C['ink'])
    hy2 = ly + 137
    rect(rx + 12, hy2 - 11, 26, 13, C['muted'], C['hold'], dash=True, r=2, width=1.2)
    badge(rx + 44, hy2 - 11)
    text(rx + 84, hy2, 'Dashed card or line: not yet designed', 9.5, C['ink'])

    sy = 856
    rect(rx, sy, rw, 72, C['ink'], C['panel'], r=6, width=1)
    text(rx + 12, sy + 18, 'ALL FOUR CL57T: SET WITH POWER OFF', 11, C['ink'], 800)
    for i, (k, val) in enumerate([('S1', '4'), ('SW1', 'on'), ('SW2', 'off'), ('SW3', 'on'), ('SW4', 'on'),
                                  ('SW5–8', 'off'), ('S3', '5V')]):
        x = rx + 10 + i * 40.5
        rect(x, sy + 27, 38, 40, C['ink'], C['paper'], r=4, width=1)
        text(x + 19, sy + 41, k, 8.5, C['muted'], 600, 'middle', mono=True)
        text(x + 19, sy + 59, val, 13, C['ink'], 800, 'middle', mono=True)

    ny = 932
    rect(rx, ny, rw, 102, C['empty'], '#fff5f5', r=6, width=1.4)
    text(rx + 12, ny + 18, 'THE SIX THAT BREAK THINGS', 11, C['empty'], 800)
    for i, s in enumerate(['P4 reversed: kills the drive', '36 V into MAIN POWER: kills the board',
                           'S3 on 5V with 24 V signals: kills the input',
                           'Raw ALM, stock 5 V or 24 V on any GPIO',
                           'Hot-plugging P3 motor or P4 power',
                           'Over 50 V on the motion bus: kills drives']):
        text(rx + 12, ny + 33 + i * 13, f'{i + 1}. {s}', 10.5, C['ink'])

    # ---------------------------------------------------------------- bottom band
    bt, bh2 = 1078, 176

    def drop(anchor, x, level, entry, color, dash=False, via=()):
        """Down from a connector to a routing level under the board, then into a card."""
        leader([anchor, *via, (x, (via[-1] if via else anchor)[1]), (x, level), (entry, level), (entry, bt)],
               color, dash=dash)

    card(20, bt, 310, bh2, 'HOW TO READ THIS PAGE', [
        row('Each outlined connector has one line to a'),
        row('card listing what lands on each of its pins.'),
        row('Top: the four driver sockets → CL57T drives.'),
        row('Red dashed: leave empty or remove.', 'empty'),
        row('Dashed card + line: HOLD, not yet designed.', 'muted'),
        row('Outlines follow BTT’s V1.1 drawing; it prints', 'muted'),
        row('no socket numbers: M0–M3 = MOTOR0–3 per BTT.', 'muted'),
        row('Confirm socket names, STOP rows and pin 1', 'muted'),
        row('on the real board before crimping.', 'muted'),
    ], C['ink'])

    f0, f4 = regions['fan0'], regions['fan4']
    card(340, bt, 280, bh2, 'FAN0 · FAN4 → SPINDLE SERVO', [
        row('FAN0  PA8 → PWM → isolated 0–5 V', 'field', True),
        row('      converter → DB44 26 (+), 10 (−)', 'field', True),
        row('FAN4  PD14 → enable relay coil', 'control', True),
        row('      contact: DB44 16 SON ↔ 23 (I/O 0 V)', 'control', True),
        row('Converter / coil across FAN+ and switched', 'muted'),
        row('FAN−. FAN− never to GND.', 'empty'),
        row('Read each FAN rail jumper (5 / 12 V / VIN).', 'muted'),
        row('DB44 map is community-sourced: meter it.', 'muted'),
        row('Never land Octopus pins on the DB44.', 'empty'),
        row('Enable contact in series with safety permit.', 'muted'),
    ], C['field'], hold=True)
    a = P(f0[0], f0[1] + f0[3])
    drop(a, a[0], 1040, 440, C['field'], dash=True)
    a = P(f4[0] + 2, f4[1] + f4[3])
    drop(a, P(849, 0)[0], 1052, 540, C['control'], dash=True, via=(P(963, 1250),))

    card(630, bt, 140, bh2, 'PWR-DET → DOOR', [
        row('PC0 ← door', 'logic', True),
        row('interlock switch, NC', 'logic'),
        row('closed = healthy', 'muted'),
        row('+ series R, TVS', 'logic'),
        row('GND = return', 'logic', True),
        row('3.3 V pin: EMPTY', 'empty'),
    ], C['logic'])
    drop(P(DOOR_RECT[0], DOOR_RECT[1] + DOOR_RECT[3] / 2), P(1043, 0)[0], 1064, 700, C['logic'])

    card(780, bt, 180, bh2, 'J43 → TOOL SETTER', [
        row('PB7 ← tool setter,', 'field', True),
        row('via HW-399 OUT2', 'field'),
        row('+ series R, TVS, 3.3 V', 'field'),
        row('pull-up + RC (none onboard)', 'field'),
        row('GND next to PB7 = return', 'logic', True),
        row('far GND, 5 V, PB6: EMPTY', 'empty'),
        row('BTT drawing: "Probe";', 'muted'),
        row('silk: BLTouch (none fitted)', 'muted'),
        row('Touch probe → T1 PF5', 'empty'),
        row('DC·GND·PC5 port: EMPTY', 'empty'),
    ], C['field'], hold=True)
    drop(P(TOOL_RECT[0], TOOL_RECT[1] + TOOL_RECT[3]), P(1197, 0)[0], 1064, 870, C['field'], dash=True,
         via=(P(TOOL_RECT[0], 957), P(1141, 957), P(1141, 1250)))

    card(970, bt, 340, bh2, 'STOP4–7 → ALARM RELAYS (one per drive)', [
        row('K-X  K-YL  K-Z  K-YR  Weidmüller 2618530000', 'alarm'),
        row('A1 ← PS-ALM 23.0 V (≤ 24.0) · F-ALM 0.25 A', 'alarm'),
        row('A2 → that drive’s ALM · COM− → PS-ALM −Vo', 'alarm'),
        row('ALM must conduct when healthy: prove each.', 'empty'),
        row('21–24 → PG12 X · PG13 YL · PG14 Z · PG15 YR', 'logic', True),
        row('STOP4–7 SIG pins only; return via EXP2 GND', 'muted'),
        row('11–14 in series + cabinet/spindle OKs, PB1 to GND:', 'logic'),
        row(''), row(''),
        row('2.2 kΩ to 3.3 V + 100 nF to GND on all 5 inputs', 'muted'),
    ], C['alarm'], hold=True)
    cx0, cy0 = 984, bt + 135
    text(cx0, cy0 + 4, 'PB1', 9.5, C['logic'], 700, mono=True)
    for i, k in enumerate(['K-X', 'K-YL', 'K-Z', 'K-YR']):
        x = cx0 + 26 + i * 56
        el(f'<line x1="{x - 4}" y1="{cy0}" x2="{x}" y2="{cy0}" stroke="{C["logic"]}" stroke-width="2"/>')
        contact(x, cy0, C['logic'], k)
        el(f'<line x1="{x + 34}" y1="{cy0}" x2="{x + 52}" y2="{cy0}" stroke="{C["logic"]}" stroke-width="2"/>')
    gx = cx0 + 26 + 4 * 56 - 4
    el(f'<line x1="{gx}" y1="{cy0}" x2="{gx + 30}" y2="{cy0}" stroke="{C["logic"]}" stroke-width="2" '
       f'stroke-dasharray="3 3"/>')
    text(gx + 15, cy0 - 5, 'cab/spdl OK', 8, C['muted'], anchor='middle')
    ground(gx + 30, cy0, C['logic'])
    s47 = P(1327, STOP47_RECT[1] + STOP47_RECT[3])  # on BTT's Stop1/Stop2 column divider
    drop(s47, s47[0], 1056, 1140, C['alarm'], dash=True)

    card(1320, bt, 310, bh2, 'STOP0–3 → HOME SWITCHES', [
        row('STOP0  PG6   X home', 'field', True),
        row('STOP1  PG9   Y-left home', 'field', True),
        row('STOP2  PG10  Z home', 'field', True),
        row('STOP3  PG11  Y-right home', 'field', True),
        row('SIG + GND each; every STOP 5 V pin EMPTY.', 'empty'),
        row('Via an isolated conditioner (TLP281 module', 'muted'),
        row('not approved), or direct only for verified', 'muted'),
        row('bare NC contacts. Split the stock shared', 'muted'),
        row('Y2/Z circuit into four channels first.', 'muted'),
        row('Direct still needs series R + TVS per input.', 'muted'),
    ], C['field'], hold=True)
    s03 = P(STOP03_RECT[0] + STOP03_RECT[2], STOP03_RECT[1] + STOP03_RECT[3] / 2)
    drop(s03, P(1470, 0)[0], 1040, 1475, C['field'], dash=True)

    text(20, H - 7, 'Board image: BIGTREETECH Octopus Pro V1.1-Pin (2023-11-02), linked from '
         'github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro (pinned commit 60a01f4); shows only when a local copy of '
         'this SVG is opened in a browser. Generated by tools/wiring-schematic/build_schematic.py.', 9, C['muted'])
    el('</svg>')


def check_manifest():
    signals = {s['macro']: s['gpio'] for s in json.loads(MANIFEST.read_text(encoding='utf-8'))['signals']}
    wrong = {m: (g, signals.get(m)) for m, g in DRAWN_GPIO.items() if signals.get(m) != g}
    if wrong:
        for macro, (drawn, actual) in sorted(wrong.items()):
            print(f'{macro}: drawn {drawn}, io-manifest.json says {actual}', file=sys.stderr)
        sys.exit(1)


def load_regions():
    data = json.loads(REGIONS.read_text(encoding='utf-8'))
    if (data['imageWidth'], data['imageHeight']) != (IMAGE_W, IMAGE_H):
        sys.exit('board-regions.json describes a different image size')
    return {r['id']: r['rect'] for r in data['regions']}


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--check', action='store_true', help='fail if the committed SVG is out of date')
    args = parser.parse_args()
    check_manifest()
    draw(load_regions())
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
