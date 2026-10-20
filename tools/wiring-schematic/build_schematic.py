"""Build the one-page MR1 wiring schematic: docs/wiring/MR1-SCHEMATIC.svg.

The page is built around BIGTREETECH's official Octopus Pro V1.1 pin drawing.
Every connector this build uses is outlined on the board, and a routed line
runs from it to a card that says what lands on each pin. The image is loaded
from BIGTREETECH's pinned repository URL when the SVG is opened in a browser;
it is not copied into this repository. Where the image cannot load (for
example GitHub's inline preview), an outline of the board and the same
connector outlines remain.

Pin assignments come from docs/wiring/mr1/io-manifest.json; the build fails if
any GPIO drawn here no longer matches it. Connector locations come from
tools/visual-wiring/board-regions.json plus the per-socket and per-row
positions below, measured on the same image. Circuit details follow
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

W, H = 1650, 1275  # US Letter / A4 landscape proportions
X0, Y0, S = 340, 300, 0.5  # where the board image sits on the page, and its scale

C = {
    'motion': '#c62828',   # 36 V motion bus
    'control': '#c25e00',  # 24 V control
    'cmd': '#1565c0',      # +5_MOTION command domain
    'logic': '#2e7d32',    # Octopus 3.3 V logic and GND
    'alarm': '#7b1fa2',    # isolated 23 V alarm field
    'field': '#00838f',    # isolated 5 V field / analog spindle
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

# Extra locations on the same image, in image pixels [x, y, w, h]. Measured from
# the socket pitch (150 px) and header outlines; they locate a group, never a
# single contact cavity. Socket order follows BTT's silkscreen, MOTOR0 nearest
# the power terminals: confirm it on the actual board.
SOCKET_RECT = lambda n: [313 + 150 * n, 267, 149, 193]
I2C_RECT = [1505, 214, 44, 106]

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


def rect(x, y, w, h, stroke=None, fill=None, dash=False, r=6, width=1.4, opacity=None):
    d = ' stroke-dasharray="6 4"' if dash else ''
    o = f' fill-opacity="{opacity}"' if opacity is not None else ''
    el(f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="{r}" fill="{fill or C["paper"]}"{o} '
       f'stroke="{stroke or C["ink"]}" stroke-width="{width}"{d}/>')


def leader(points, color, dash=False):
    """A routed wire with a white halo so it stays readable over the photo."""
    p = ' '.join(f'{x:g},{y:g}' for x, y in points)
    d = ' stroke-dasharray="7 5"' if dash else ''
    el(f'<polyline points="{p}" fill="none" stroke="#ffffff" stroke-width="6" stroke-opacity="0.9" '
       f'stroke-linejoin="round" stroke-linecap="round"/>')
    el(f'<polyline points="{p}" fill="none" stroke="{color}" stroke-width="2.4" '
       f'stroke-linejoin="round" stroke-linecap="round"{d}/>')
    x, y = points[0]
    el(f'<circle cx="{x:g}" cy="{y:g}" r="4" fill="{color}" stroke="#ffffff" stroke-width="1.5"/>')


def outline(r, color, dash=False, label=None, label_pos='above'):
    x, y, w, h = R(r)
    d = ' stroke-dasharray="5 3"' if dash else ''
    el(f'<rect x="{x - 2:g}" y="{y - 2:g}" width="{w + 4:g}" height="{h + 4:g}" rx="3" fill="none" '
       f'stroke="#ffffff" stroke-width="6" stroke-opacity="0.85"/>')
    el(f'<rect x="{x - 2:g}" y="{y - 2:g}" width="{w + 4:g}" height="{h + 4:g}" rx="3" fill="none" '
       f'stroke="{color}" stroke-width="3"{d}/>')
    if label:
        pill(x + w / 2, y - 12 if label_pos == 'above' else y + h + 14, label, color)


def pill(cx, cy, s, color):
    w = len(s) * 6.4 + 12
    el(f'<rect x="{cx - w / 2:g}" y="{cy - 8:g}" width="{w:g}" height="16" rx="8" fill="{color}"/>')
    text(cx, cy + 4, s, 9.5, C['paper'], 700, 'middle')


def card(x, y, w, h, title, rows, color, hold=False, title_size=11.5):
    """rows: list of (text, colour, mono) or plain strings."""
    rect(x, y, w, h, color, C['hold'] if hold else C['paper'], dash=hold, width=1.6)
    el(f'<rect x="{x:g}" y="{y:g}" width="5" height="{h:g}" rx="2" fill="{color}"/>')
    text(x + 13, y + 17, title, title_size, color, 800)
    if hold:
        el(f'<rect x="{x + w - 40:g}" y="{y + 6:g}" width="34" height="14" rx="3" fill="{C["control"]}"/>')
        text(x + w - 23, y + 16.5, 'HOLD', 8.5, C['paper'], 700, 'middle')
    yy = y + 33
    for row in rows:
        if isinstance(row, str):
            row = (row, C['ink'], False)
        s, col, mono = row
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
    text(20, 36, 'MR-1 WIRING SCHEMATIC', 26, C['ink'], 800)
    text(362, 36, 'Octopus Pro v1.1 → 4 × CL57T V4.1 closed loop · every used connector, routed',
         14, C['muted'], 500)
    text(W - 20, 26, 'One page · 2026-10-20', 11, C['muted'], 600, 'end')
    text(W - 20, 41, 'Pins checked against io-manifest.json', 11, C['muted'], 400, 'end')
    el(f'<rect x="20" y="50" width="{W - 40}" height="22" rx="4" fill="{C["hold"]}" stroke="{C["control"]}"/>')
    text(W / 2, 65, 'PLANNING DRAWING — NOT APPROVAL TO ENERGIZE OR MOVE. Dashed = HOLD (not yet designed or '
         'qualified). Printed names on the real board and parts win over this page.', 11, '#8a4b00', 700, 'middle')

    # ---------------------------------------------------------------- board
    bx, by, bw, bh = X0, Y0, IMAGE_W * S, IMAGE_H * S
    # fallback shown only when the official image cannot load
    rect(bx, by, bw, bh, '#c9d1d9', '#f3f5f7', r=8, width=1)
    ox, oy = P(190, 195)
    rect(ox, oy, (1655 - 190) * S, (1100 - 195) * S, '#8c959f', '#e6e9ed', r=14, width=1.5)
    text(bx + bw / 2, by + bh - 70, 'Octopus Pro V1.1 board photo loads from BIGTREETECH when this file is opened',
         12, C['muted'], 600, 'middle')
    text(bx + bw / 2, by + bh - 52, 'in a browser. The outlines below are at the same positions.', 12,
         C['muted'], 600, 'middle')
    el(f'<image href="{BOARD_IMAGE_URL}" xlink:href="{BOARD_IMAGE_URL}" x="{bx:g}" y="{by:g}" '
       f'width="{bw:g}" height="{bh:g}" preserveAspectRatio="xMidYMid meet"/>')

    used = [SOCKET_RECT(n) for n in range(4)] + [I2C_RECT] + [regions[k] for k in (
        'main-power', 'tb-t0-t1', 'tool-setter', 'exp-pair', 'door', 'fan0', 'fan4', 'coolant', 'usb-c',
        'stop-bank')]
    el('<mask id="lit"><rect x="0" y="0" width="100%" height="100%" fill="#fff"/>')
    for r in used:
        x, y, w, h = R(r)
        el(f'<rect x="{x - 3:g}" y="{y - 3:g}" width="{w + 6:g}" height="{h + 6:g}" fill="#000"/>')
    el('</mask>')
    el(f'<rect x="{bx:g}" y="{by:g}" width="{bw:g}" height="{bh:g}" fill="#ffffff" fill-opacity="0.38" '
       f'mask="url(#lit)"/>')

    # leave-empty / remove groups
    outline(regions['phase-plugs'], C['empty'], dash=True)
    outline(regions['voltage-links'], C['empty'], dash=True)
    outline(regions['mode-links'], C['empty'], dash=True)
    outline(regions['diag-links'], C['empty'], dash=True)
    pb = regions['power-block']
    outline([pb[0], pb[1], pb[2], regions['main-power'][1] - pb[1] - 6], C['empty'], dash=True)
    mp = regions['main-power']
    outline([pb[0], mp[1] + mp[3] + 6, pb[2], pb[1] + pb[3] - mp[1] - mp[3] - 6], C['empty'], dash=True)

    # used connectors
    for n in range(4):
        outline(SOCKET_RECT(n), C['cmd'])
    outline(I2C_RECT, C['logic'])
    outline(regions['main-power'], C['control'])
    outline(regions['usb-c'], C['ink'])
    outline(regions['exp-pair'], C['logic'])
    outline(regions['tb-t0-t1'], C['logic'])
    outline(regions['door'], C['logic'])
    outline(regions['tool-setter'], C['field'])
    sb = regions['stop-bank']
    outline([sb[0], sb[1], sb[2], sb[3] / 2 - 2], C['field'])
    outline([sb[0], sb[1] + sb[3] / 2 + 2, sb[2], sb[3] / 2 - 2], C['alarm'])
    outline(regions['fan0'], C['field'])
    outline(regions['fan4'], C['control'])
    outline(regions['coolant'], C['control'])

    # socket names and DRIVER0 command-supply contacts
    for n in range(4):
        x, y, w, h = R(SOCKET_RECT(n))
        pill(x + w / 2, y + h - 52, f'M{n}', C['cmd'])
    vcc, gnd = P(452, 425), P(452, 447)
    for (px, py), col in ((vcc, C['control']), (gnd, C['cmd'])):
        el(f'<circle cx="{px:g}" cy="{py:g}" r="4.5" fill="{col}" stroke="#fff" stroke-width="1.5"/>')

    # ---------------------------------------------------------------- top band: drives
    axes = [
        ('X', 'MOTOR0', 'PF13', 'PF12', 'K-X', 'F-X', 280),
        ('Y-LEFT', 'MOTOR1', 'PG0', 'PG1', 'K-YL', 'F-YL', 268),
        ('Z', 'MOTOR2', 'PF11', 'PG3', 'K-Z', 'F-Z', 280),
        ('Y-RIGHT', 'MOTOR3', 'PG4', 'PC1', 'K-YR', 'F-YR', 292),
    ]
    cw, gap, top, ch = 317, 10, 84, 170
    for n, (axis, socket, step, dirn, relay, fuse, level) in enumerate(axes):
        cx = 340 + n * (cw + gap)
        sx, sy, sw, _ = R(SOCKET_RECT(n))
        start = (sx + sw / 2, sy)
        mid = cx + cw / 2
        leader([start, (start[0], level), (mid, level), (mid, top + ch)], C['cmd'])
        card(cx, top, cw, ch, f'{axis} DRIVE · CL57T V4.1', [
            (f'{socket} socket: STEP {step} · DIR {dirn} · GND', C['cmd'], True),
            ('→ 2 × 2N7002 sinks → P1 PUL−, DIR−', C['cmd'], False),
            ('   P1 PUL+, DIR+ ← +5_MOTION', C['cmd'], False),
            (f'P1 ALM → relay {relay} A2 · COM− → ALM 0V', C['alarm'], False),
            ('P2 ← encoder, DB15: 6 wires + separate shield', C['field'], False),
            ('P3 → motor, GX16: A+ A− B+ B− (pins 1–4)', C['ink'], False),
            (f'P4 ← 36 V branch {fuse}: +VDC / GND, POLARIZED', C['motion'], False),
            ('ENA and BRK: leave open', C['muted'], False),
        ], C['cmd'])

    # ---------------------------------------------------------------- left column
    lx, lw = 20, 300
    # driver jumper area
    card(lx, 84, lw, 170, 'DRIVER AREA: LEAVE EMPTY / REMOVE', [
        ('A1 A2 B2 B1 motor-output plugs: EMPTY (all 8)', C['empty'], False),
        ('HV / VM / VIN jumper caps: REMOVE (all 8)', C['empty'], False),
        ('Mode / SPI jumper caps: REMOVE (all 8)', C['empty'], False),
        ('M0–M7 DIAG caps: REMOVE (they sit on the', C['empty'], False),
        ('   PG6–PG15 home and alarm nets)', C['empty'], False),
        ('EN contact 1: reserved, not connected', C['muted'], False),
        ('Nothing plugs into a socket; the control', C['muted'], False),
        ('   cable lands on STEP, DIR, GND only.', C['muted'], False),
    ], C['empty'])
    vl = regions['voltage-links']
    a = P(vl[0], vl[1] + vl[3] / 2)
    leader([a, (335, a[1]), (335, 170), (lx + lw, 170)], C['empty'], dash=True)

    card(lx, 264, lw, 150, 'MAINS · E-STOP · 36 V MOTION', [
        ('Dual-channel E-stop → safety relay. On stop:', C['mains'], False),
        (' · motion contactor opens 36 V (plan Z drop)', C['mains'], False),
        (' · spindle-servo energy removed (not SON)', C['mains'], False),
        (' · coolant pump and air supply cut', C['mains'], False),
        ('36 V PSU S-360-36 → fused F-X F-YL F-Z F-YR', C['motion'], False),
        ('   → each CL57T P4. Never to the Octopus.', C['motion'], False),
        ('Monitor contact → TB · PF3 (right).', C['logic'], False),
    ], C['mains'], hold=True)

    v = P(452, 425)
    card(lx, 424, lw, 132, 'COMMAND SUPPLY · DRIVER0 socket', [
        ('VCC_IO +5 V (orange dot) → F_CMD 0.5 A fast', C['control'], False),
        ('   → +5_MOTION → all 8 PUL+ / DIR+', C['cmd'], False),
        ('Logic GND (blue dot) → CTRL_0V', C['cmd'], False),
        ('   → all 8 2N7002 sources', C['cmd'], False),
        ('One takeoff only; other sockets’ VCC_IO unused.', C['muted'], False),
        ('Remove J68 (USB power) for cabinet use.', C['muted'], False),
    ], C['cmd'])
    leader([v, (lx + lw, v[1])], C['control'])

    mpx, mpy, _, mph = R(regions['main-power'])
    card(lx, 566, lw, 90, '24 V CONTROL PSU → MAIN POWER', [
        ('+24 V → +VIN · 0 V → GND (read the board marks)', C['control'], False),
        ('24 V only, 28 V max. 36 V kills the board.', C['empty'], False),
        ('Also feeds PS-ALM and the interposing relays.', C['muted'], False),
    ], C['control'])
    leader([(mpx, mpy + mph / 2), (lx + lw, mpy + mph / 2)], C['control'])

    pbx, pby, _, _ = R(pb)
    card(lx, 666, lw, 62, 'MOTOR-POWER · BED-POWER · BED-OUT', [
        ('All EMPTY. Drive power never touches the board.', C['empty'], False),
    ], C['empty'])
    bed = (pbx, Y0 + (mp[1] + mp[3] + 80) * S)
    leader([bed, (lx + lw, bed[1])], C['empty'], dash=True)

    hx, hy, hw, hh = R(regions['coolant'])
    card(lx, 738, lw, 104, 'HE0 · HE1 → COOLANT RELAYS', [
        ('HE0 · PA0 → flood-pump relay coil', C['control'], True),
        ('HE1 · PA3 → mist / air relay coil', C['control'], True),
        ('Coil across HE+ (fused VIN) and HE−.', C['muted'], False),
        ('Pump and air supply in the stop chain.', C['muted'], False),
    ], C['control'], hold=True)
    leader([(hx, hy + 22), (lx + lw, hy + 22)], C['control'], dash=True)

    card(lx, 852, lw, 104, 'GROUNDING · THREE SEPARATE RETURNS', [
        ('Octopus GND: logic, pull-ups, contacts', C['logic'], False),
        ('CTRL_0V: DRIVER0 GND, command sinks', C['cmd'], False),
        ('ALM 0V: PS-ALM −Vo, all CL57T COM−', C['alarm'], False),
        ('Never join them because they say GND.', C['muted'], False),
    ], C['ink'])
    card(lx, 966, lw, 100, 'PROTECTIVE EARTH', [
        ('Bond backplate, frame, DIN rail, spindle', C['ink'], False),
        ('   chassis and each drive chassis to PE.', C['ink'], False),
        ('Octopus on insulating standoffs.', C['muted'], False),
        ('Never use PE or a shield as a return.', C['muted'], False),
    ], C['mains'])

    # ---------------------------------------------------------------- right column
    rx, rw = 1310, 320
    turn = 1192

    def right(anchor, cy, y, h, title, rows, color, hold=False, dash=False):
        card(rx, y, rw, h, title, rows, color, hold=hold)
        leader([anchor, (turn, anchor[1]), (rx, cy)], color, dash=dash)

    ix, iy, iw, ih = R(I2C_RECT)
    right((ix + iw, iy + ih / 2), 300, 262, 76, 'I2C header → pull-up supply', [
        ('3.3 V → TB-C3: five 2.2 kΩ pull-ups', C['logic'], False),
        ('GND → spare. PB8, PB9 empty.', C['muted'], False),
    ], C['logic'])

    ux, uy, uw, uh = R(regions['usb-c'])
    right((ux + uw, uy + uh / 2), 370, 346, 60, 'USB-C → WINDOWS PC', [
        ('Data only. J68 removed for the cabinet.', C['ink'], False),
    ], C['ink'])

    ex, ey, ew, eh = R(regions['exp-pair'])
    right((ex + ew, ey + eh / 2), 470, 414, 132, 'EXP2 (find it by its board marking)', [
        ('PB1 ← alarm-relay chain, 11–14 in series', C['logic'], True),
        ('    the ONLY drive-fault stop', C['logic'], False),
        ('PB2 ← cycle-start button, NO, guarded', C['logic'], True),
        ('    onboard SW2 shares PB2: guard it', C['muted'], False),
        ('GND → TB-C0, relay-contact + RC return', C['logic'], True),
        ('EXP1 beside it stays empty.', C['muted'], False),
    ], C['logic'])

    tx, ty, tw, th = R(regions['tb-t0-t1'])
    right((tx + tw, ty + th / 2), 600, 554, 106, 'TB · T0 · T1 thermistor headers', [
        ('TB  PF3 ← E-stop relay monitor contact', C['logic'], True),
        ('          closed = relay energized', C['muted'], False),
        ('T0  PF4 ← feed-hold button, NC', C['logic'], True),
        ('T1  PF5 ← touch probe, HW-399 OUT1', C['field'], True),
    ], C['logic'])

    # legend, settings and the destructive mistakes
    ly = 670
    rect(rx, ly, rw, 154, C['ink'], C['panel'], r=6, width=1)
    text(rx + 12, ly + 18, 'WIRE COLOURS', 11, C['ink'], 800)
    legend = [(C['motion'], False, '36 V motion'), (C['control'], False, '24 V control'),
              (C['cmd'], False, '+5 V command'), (C['logic'], False, '3.3 V logic / GND'),
              (C['alarm'], False, 'Isolated 23 V alarm'), (C['field'], False, 'Isolated 5 V field'),
              (C['empty'], True, 'Leave empty / remove'), (C['muted'], True, 'Dashed card = HOLD')]
    for i, (col, dash, s) in enumerate(legend):
        x = rx + 12 + (i % 2) * 154
        y = ly + 38 + (i // 2) * 28
        d = ' stroke-dasharray="6 4"' if dash else ''
        el(f'<line x1="{x}" y1="{y - 4}" x2="{x + 26}" y2="{y - 4}" stroke="{col}" stroke-width="3"{d}/>')
        text(x + 32, y, s, 9.5, C['ink'])

    sy = 834
    rect(rx, sy, rw, 76, C['ink'], C['panel'], r=6, width=1)
    text(rx + 12, sy + 18, 'ALL FOUR CL57T: SET WITH POWER OFF', 11, C['ink'], 800)
    for i, (k, val) in enumerate([('S1', '4'), ('SW1', 'on'), ('SW2', 'off'), ('SW3', 'on'), ('SW4', 'on'),
                                  ('SW5–8', 'off'), ('S3', '5V')]):
        x = rx + 10 + i * 43.5
        rect(x, sy + 28, 40, 40, C['ink'], C['paper'], r=4, width=1)
        text(x + 20, sy + 42, k, 8.5, C['muted'], 600, 'middle', mono=True)
        text(x + 20, sy + 60, val, 13, C['ink'], 800, 'middle', mono=True)

    ny = 920
    rect(rx, ny, rw, 146, C['empty'], '#fff5f5', r=6, width=1.4)
    text(rx + 12, ny + 18, 'THE SIX THAT BREAK THINGS', 11, C['empty'], 800)
    for i, s in enumerate(['P4 reversed: kills the drive', '36 V into MAIN POWER: kills the board',
                           'S3 on 5V with 24 V signals: kills the input',
                           'Raw ALM, stock 5 V or 24 V on any GPIO',
                           'Hot-plugging P3 motor or P4 power',
                           'Powering a drive without motor + encoder']):
        text(rx + 12, ny + 38 + i * 18, f'{i + 1}. {s}', 10.5, C['ink'])

    # ---------------------------------------------------------------- bottom band
    bt, bh2, level = 1076, 178, 1056

    def bottom(anchor, x, w, title, rows, color, hold=False, dash=False, into=None, via=None):
        card(x, bt, w, bh2, title, rows, color, hold=hold)
        path = [anchor] + (via or []) + [(anchor[0] if not via else via[-1][0], level),
                                          (into if into is not None else x + w / 2, bt)]
        leader(path, color, dash=dash)

    f0x, f0y, f0w, f0h = R(regions['fan0'])
    f4x, f4y, f4w, f4h = R(regions['fan4'])
    card(340, bt, 280, bh2, 'FAN0 · FAN4 → STOCK SPINDLE SERVO', [
        ('FAN0  PA8 → PWM → isolated 0–5 V', C['field'], True),
        ('      converter → DB44 26 (+), 10 (−)', C['field'], False),
        ('FAN4  PD14 → spindle-enable relay', C['control'], True),
        ('      contact → DB44 16 SON', C['control'], False),
        ('Set FAN0/FAN4 rail jumpers and verify', C['muted'], False),
        ('them first. DB44 map is community-', C['muted'], False),
        ('sourced: meter the real cable.', C['muted'], False),
        ('Never land Octopus pins on the DB44.', C['empty'], False),
        ('E-stop must block enable in hardware.', C['muted'], False),
        ('', C['muted'], False),
    ], C['field'], hold=True)
    leader([(f0x + f0w / 2, f0y + f0h), (f0x + f0w / 2, level), (440, bt)], C['field'], dash=True)
    leader([(f4x + f4w / 2, f4y + f4h), (f4x + f4w / 2, level - 8), (540, bt)], C['control'], dash=True)

    dx, dy, dw, dh = R(regions['door'])
    door_x = dx - 12
    card(630, bt, 140, bh2, 'PWR-DET → DOOR', [
        ('PC0 ← door', C['logic'], True),
        ('interlock switch', C['logic'], False),
        ('NC, closed =', C['muted'], False),
        ('healthy', C['muted'], False),
        ('GND = return', C['logic'], True),
        ('3.3 V pin: EMPTY', C['empty'], False),
    ], C['logic'])
    leader([(dx, dy + dh / 2), (door_x, dy + dh / 2), (door_x, level), (700, bt)], C['logic'])

    sx_, sy_, sw_, sh_ = R(regions['tool-setter'])
    card(780, bt, 180, bh2, 'J43 → TOOL SETTER', [
        ('PB7 ← tool setter,', C['field'], True),
        ('via HW-399 OUT2', C['field'], False),
        ('GND = return', C['logic'], True),
        ('5 V, PB6: EMPTY', C['empty'], False),
        ('5-pin header silked', C['muted'], False),
        ('BLTouch; no BLTouch.', C['muted'], False),
    ], C['field'], hold=True)
    leader([(sx_ + 24, sy_ + sh_), (sx_ + 24, level), (870, bt)], C['field'], dash=True)

    stx, sty, stw, sth = R(sb)
    card(970, bt, 340, bh2, 'STOP4–7 → ALARM RELAYS (one per drive)', [
        ('K-X  K-YL  K-Z  K-YR  Weidmüller 2618530000', C['alarm'], False),
        ('A1 ← +23 V: PS-ALM DDR-15G-24, F-ALM 0.25 A', C['alarm'], False),
        ('A2 → that drive’s ALM · COM− → PS-ALM −Vo', C['alarm'], False),
        ('21–24 → STOP4 PG12 X · STOP5 PG13 YL', C['logic'], True),
        ('        STOP6 PG14 Z · STOP7 PG15 YR', C['logic'], True),
        ('        SIG pin only; return via EXP2 GND', C['muted'], False),
        ('11–14 in series, PB1 (EXP2) to GND:', C['logic'], False),
        ('', C['logic'], False),
        ('', C['logic'], False),
        ('2.2 kΩ to 3.3 V + 100 nF to GND on all 5 inputs', C['muted'], False),
    ], C['alarm'], hold=True)
    cx0, cy0 = 984, bt + 131
    text(cx0, cy0 + 4, 'PB1', 9.5, C['logic'], 700, mono=True)
    for i, k in enumerate(['K-X', 'K-YL', 'K-Z', 'K-YR']):
        x = cx0 + 26 + i * 56
        el(f'<line x1="{x - 4}" y1="{cy0}" x2="{x}" y2="{cy0}" stroke="{C["logic"]}" stroke-width="2"/>')
        contact(x, cy0, C['logic'], k)
        el(f'<line x1="{x + 34}" y1="{cy0}" x2="{x + 52}" y2="{cy0}" stroke="{C["logic"]}" stroke-width="2"/>')
    ground(cx0 + 26 + 4 * 56 - 4, cy0, C['logic'])
    leader([(stx + stw / 2, sty + sth), (stx + stw / 2, level), (1140, bt)], C['alarm'])

    card(1320, bt, 310, bh2, 'STOP0–3 → HOME SWITCHES', [
        ('STOP0  PG6   X home', C['field'], True),
        ('STOP1  PG9   Y-left home', C['field'], True),
        ('STOP2  PG10  Z home', C['field'], True),
        ('STOP3  PG11  Y-right home', C['field'], True),
        ('SIG + GND each; every STOP 5 V pin EMPTY.', C['empty'], False),
        ('Via an isolated conditioner (TLP281 module', C['muted'], False),
        ('not approved), or direct only for verified', C['muted'], False),
        ('bare NC contacts. Split the stock shared', C['muted'], False),
        ('Y2/Z circuit into four channels first.', C['muted'], False),
    ], C['field'], hold=True)
    hx2 = stx + stw + 14
    leader([(stx + stw, sty + sth / 4), (hx2, sty + sth / 4), (hx2, level), (1475, bt)], C['field'], dash=True)

    card(20, bt, 310, bh2, 'HOW TO READ THIS PAGE', [
        ('Each outlined connector on the board has', C['ink'], False),
        ('one line to a card. The card lists what', C['ink'], False),
        ('lands on each of its pins.', C['ink'], False),
        ('Top: the four drive sockets → CL57T drives.', C['ink'], False),
        ('Red dashed: leave empty or remove.', C['empty'], False),
        ('Positions follow BTT’s V1.1 drawing. Confirm', C['muted'], False),
        ('silkscreen names, STOP rows and pin 1 on', C['muted'], False),
        ('the real board before crimping anything.', C['muted'], False),
        ('Details: docs/wiring/mr1/WIRING_SIMPLE.md', C['muted'], False),
    ], C['ink'])

    text(20, H - 7, 'Board image: BIGTREETECH Octopus Pro V1.1-Pin (2023-11-02), loaded at view time from '
         'github.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro (pinned commit 60a01f4), not stored in this repository. '
         'Generated by tools/wiring-schematic/build_schematic.py.', 9, C['muted'])
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
