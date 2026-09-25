# MR-1 Operator Interface Style

Use a restrained industrial palette for every MR-1 dashboard, pendant, setup
screen, and operator utility.

## Palette

| Token | Color | Use |
| --- | --- | --- |
| `shell` | `#0B0D0F` | Main application background |
| `panel` | `#171A1E` | Toolbars and secondary surfaces |
| `control` | `#292E34` | Inputs, buttons, and inactive controls |
| `muted` | `#929AA3` | Secondary labels and disabled information |
| `line` | `#D8DDE2` | Borders, dividers, and high-visibility outlines |
| `paper` | `#FFFFFF` | Primary text, DRO values, and light surfaces |
| `action` | `#D71920` | Primary actions and active machine states |
| `alarm` | `#FF343F` | Alarms, faults, and emergency indications |
| `alarm-muted` | `#3A1114` | Alarm detail backgrounds |

## Rules

- Keep black and charcoal dominant, with white used for legibility and red used
  deliberately. Do not flood normal operating screens with red.
- Reserve solid red for the most important action on a screen, an active hazard,
  or a machine fault. Emergency-stop controls must remain unmistakable.
- Show state with text and an icon as well as color. Never make red versus grey
  the operator's only way to distinguish a condition.
- Use large white numerals for DRO values. Use red only for an alarmed axis,
  an active limit, or a value requiring operator attention.
- Prefer square, compact controls with 4-6 px corner radii, clear dividers, and
  familiar icons. Avoid gradients, decorative effects, and floating cards.
- Normal, ready, and completed states remain white or grey. This keeps the
  four-color scheme intact and prevents a noncritical status color from competing
  with alarms.
- Maintain WCAG AA text contrast and make touch targets at least 44 by 44 px on
  pendant or touchscreen layouts.

