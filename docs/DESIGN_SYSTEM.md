# HomeForge AI — Design System

Subject: residential architecture for Pakistani homeowners — plots in marla/kanal, brick and
marble, drafting and site work. The visual language borrows from the tools on a building site
and a drafting table, not from SaaS dashboards.

## Color

Two signal colors, each with exactly one meaning:

| Token | Dark ("Graphite") | Light ("Vellum") | Meaning |
|---|---|---|---|
| `--bg` | `#1A1C1F` | `#ECEEF1` | Canvas surround |
| `--panel` | `#212428` | `#FFFFFF` | Panels, menus |
| `--raised` | `#2A2E33` | `#F5F6F8` | Inputs, hovered rows |
| `--line` | `#343A40` | `#D5D9DE` | Hairline borders |
| `--text` | `#E6E8EA` | `#1B1F24` | Primary text |
| `--text-2` | `#A3AAB2` | `#56606B` | Secondary text |
| `--tape` | `#F0B823` | `#D99A00` | **Measuring-tape yellow**: selected, active tool, measured, primary action |
| `--chalk` | `#4DA8DA` | `#1F7FB5` | **Chalk-line blue**: snapping, alignment guides, hover |
| `--danger` | `#E5534B` | `#C9372C` | Validation errors |
| `--ok` | `#46B37B` | `#23875A` | Valid / saved |

Plans in dark mode read as a lit drafting table (light poché on graphite); in light mode and in
every export they read as ink on paper (black poché on white).

## Type

One family, **Archivo** (variable, `wght` + `wdth`), used through its width axis:

- UI text: 13px / 1.45, `wdth 100`, weight 450. Desktop density, not web density.
- Titles (app name, wizard step titles, presentation): `wdth 112–125`, weight 600 — wide,
  even architectural lettering.
- Drawing labels (on canvas only): `wdth 80`, uppercase, tracked +4% — the drafting convention
  for room names. Uppercase never appears in app chrome.
- Numbers: `font-variant-numeric: tabular-nums` everywhere dimensions appear. No monospace.

Scale: 11 / 12 / 13 / 15 / 18 / 24 / 36.

## Layout

```
┌ ◆ HomeForge AI  Project Edit View Export   Plan Sketch 3D Materials Interior Exterior Walk Drone Present   ↶ ↷ ● ┐
├──┬──────────────────────────────────────────────────────────────────────┬──────────────┤
│T │ ┌────┐                                                              │ Inspector    │
│o │ │Roof│  ← floor stack: a vertical building section; the ground line │ (tabs)       │
│o │ │ 2  │    sits under Ground, Basement hangs below it                 │              │
│l │ │ 1  │                                                              │              │
│s │ │ G  │                  CANVAS (edge to edge)                       │              │
│  │ │▁▁▁▁│                                                              │              │
│  │ │ B  │                                                              │              │
│  │ └────┘                                                              │              │
├──┴──────────────────────────────────────────────────────────────────────┴──────────────┤
│ Master Bedroom   W 14′0″  L 16′0″  H 11′0″  Area 224 ft²  │ Snap: grid walls objects guides │ ft-in │ 100% │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

The one memorable element is the **floor stack** — the floor selector drawn as a small building
section (slabs stacked, ground line, basement below grade). Everything around it stays quiet.

## Principles

1. The drawing is the interface. Canvas runs edge to edge; chrome recedes (hairlines, low
   contrast, radius 4px on controls, 8px on dialogs, no drop shadows except floating menus).
2. Yellow means "this is selected / being measured". Blue means "this snaps / aligns".
3. Numbers are first-class: units always shown, every dimension editable in place.
4. Sentence case in chrome; uppercase only inside drawings.
5. Copy names what the user gets ("Generate designs", "Walk inside"), never the system internals.
6. One orchestrated motion moment: the home screen's slowly orbiting demo house. UI motion only
   answers actions (panels opening, floors separating in exploded view).
