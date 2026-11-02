# Pale Moon — UI spec

The game layer over VINder. Art direction: flat mid-century gouache, a moon-cursed night road.
Idea for the UI: **cut paper under moonlight.** Every surface is a flat paper shape laid on the night.
Depth comes from a solid offset "paper edge", never from glow or gradients.

## Rules
1. **Amber is the lantern.** Amber marks only the one thing to act on now (primary button, a reward, a card that just fired). If two things are amber, one is wrong.
2. **Nothing glows.** No blur shadows, no bloom, no sparkles. Shadows are solid offset shapes in a darker tone.
3. **Detail only at the focus.** The inspection photo is the focus of the battle screen and keeps most of the height. Game chrome stays quiet around it.
4. **Work first.** Every verdict looks and feels the same weight; game rewards never change what a verdict button looks like.
5. **Real text, not painted text.** All words are live text in the two typefaces below.

## Tokens
| Token | Value | Role |
|---|---|---|
| `--night` | `#1b2238` | ground |
| `--night-deep` | `#121829` | scrims, tracks, paper edges on navy |
| `--teal` | `#2f4f57` | panels, secondary buttons |
| `--teal-deep` | `#203840` | edge under teal |
| `--fog` | `#9aa3a8` | muted text, disabled, Later |
| `--bone` | `#e6dcc6` | paper surfaces, primary text on night |
| `--bone-deep` | `#bfb39a` | edge under bone |
| `--amber` | `#e0a243` | the lantern (see rule 1) |
| `--amber-deep` | `#a8741f` | edge under amber |
| `--rust` | `#b4562f` | damage, Flag |
| `--moss` | `#6f7d5a` | Yes / success |
| `--crimson` | `#9c2f3a` | boss only |

Verdict colours in game mode: right = moss, left = teal-light `#4f7a84`, up = rust, down = fog. Labels and icons come from the pack, unchanged.

## Type
- **Fraunces** (variable, SOFT 100, opsz auto): titles, foe names, numbers. 600–800 weight.
- **Figtree** (variable): everything else. 500 for text, 700 for labels.
- Japanese subtitles: system Japanese font (Noto Sans JP on Android), 500.
- Scale (px): 12 · 14 · 16 · 20 · 26 · 34. Line height 1.25 for display, 1.45 for text.

## Space and shape
- Spacing scale: 4 · 8 · 12 · 16 · 24 · 32.
- Radius: 10 for panels and cards, 999 for pills and discs.
- Paper edge: `0 3px 0 <edge colour>`; pressed = `translateY(2px)` and edge 1px. Every tappable thing has a pressed state.
- Touch targets ≥ 44 px.

## Components
- **Button / primary:** amber fill, night text, amber-deep edge. One per screen.
- **Button / secondary:** teal fill, bone text, teal-deep edge.
- **Button / quiet:** no fill, bone text, 2px bone outline.
- **Plate:** bone paper with night text (foe name, labels on scenes).
- **Life bar:** one segment per item to decide, 2px gaps; a segment drops out with a short shrink when an item is decided. Honest progress, not abstract HP.
- **Card (hand):** bone paper, illustration on top, name in Fraunces; upgraded cards get an amber `+`; rarity is a coloured corner notch (fog / teal / amber).
- **Sheet / overlay:** night-deep scrim at 85%, panel teal with a bone header band.

## Motion
- Paper moves: enter 220 ms `cubic-bezier(.2,1.2,.3,1)`, exit 160 ms ease-in.
- A hit: 60 ms hit-stop (freeze), then 6 px shake for 180 ms, and the foe blanches to bone for one frame.
- Particles are paper chips (small flat rectangles and triangles) in palette colours, falling with gravity. No sparkles.
- `prefers-reduced-motion`: no shake, no particles, fades only.

## Sound
Every action has a sound (ElevenLabs set in `assets/sfx`), mutable from the speaker button on the battle screen, with Master / Music / Effects / Narrator levels in settings.
