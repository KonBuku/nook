# The design frame

Every number in Nook's UI comes from Codenotch's design frames —
`docs/design/frame-124-hover-tooltip.png` and `frame-125-detail.png` in
[that repository](https://github.com/vinzdg/codenotch). They are not copied here:
they are someone else's artwork, and a port does not need to carry them to be
checked against them.

They are 2000 × 2000 px. Every measurement in `src/design/layout.ts` is quoted
in *those pixels* — `px(117)` is a distance that measures 117px in the frame —
which is what makes this port proportionally exact rather than eyeballed, and
what lets any measurement here be verified by opening the frame and measuring
it.

## What fixes the scale

The frame fixes only ratios. One anchor turns them into sizes, and it is stated
in `src/design/scale.ts`:

> the design spec calls the provider ring 44pt across, and it measures 117px in
> the frame

so `SCALE = 44 / 117`. Change that one line and the whole surface — notch,
ring, type, panel — resizes together, still in the frame's proportions.

## What the frame does *not* fix

Four things in Nook have no counterpart in the frame, because the frame draws a
three-provider notch on macOS and Nook draws a one-provider notch on Windows.
Each is sized against something the frame *does* fix, and each says so where it
is declared:

| | Sized against |
|---|---|
| The resting pill | Read as a deliberate handle rather than a sliver of chrome. |
| The activity arc | The gap between the glyph (46px) and the track's inside edge (86px). |
| The session chip | The body text's cap height. |
| The surface marks | Large enough that two strokes stay legible — 6px was not. |
| The spinner | Large enough that its smallest frame, a single interpunct, still reads. |

## The spinner

The mark beside a session's state is Claude Code's own working animation, not a
drawing of it. `scripts/extract-spinner.mjs` reads the six outlines out of
Segoe UI Symbol — the font Windows Terminal itself falls back to for these code
points — and writes `src/design/claudeSpinner.ts`. Re-running it is a no-op, so
the checked-in module can be verified rather than trusted.

The six are scaled by one shared factor and centred on their own ink. That is
the whole animation: the marks are genuinely different sizes, and fitting each
to the same box would flatten the pulse into a shape that merely changes how
many spokes it has. `claudeSpinner.test.ts` guards exactly that.

## What changed on purpose

The frame shows a tooltip *beside* a notch of stacked rings. Nook has one
provider, so there is no stack and nothing to point a tooltip at: the notch
opens into the panel instead of growing one beside itself. The panel keeps the
card's width, corner, padding, bar height and every gap between its rows — it
is the same object, hinged differently.

## Colours

Sampled from the frame, not from the prose that describes it. Where the two
disagree — the spec's table says 50–79% is yellow, which would make the frame's
own orange 73% ring yellow — the frame wins. See `src/design/palette.ts`.
