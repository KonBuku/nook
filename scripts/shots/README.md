# The screenshots

`docs/images/*.png` — the README's banner included — are generated, not
photographed. Re-take them with:

```sh
pnpm dev      # in one terminal
pnpm shots    # in another
```

Each image is written straight over its old self, so a UI change shows up as a
diff on a PNG rather than as a new picture nobody can compare to the last one.
(Two of them are not byte-stable — see the end of this file.)

## What is being photographed

`shots.html` is a second Vite entry — the production build has one entry,
`index.html`, and never sees it. It renders the **real** components:
`NotchShell`, `OpenContent`, `ClosedContent`, `SessionList`, and the real
`useShapes`, at the real `WINDOW_HEIGHT`. The banner is the same closed notch
at the same size with a wordmark beside it, rather than a logo drawn separately
— so the thing at the top of the README cannot come to show something the app
does not. Only two things are substituted:

- **`fixtures.ts`** — the readings and sessions. Invented, so no screenshot puts
  whoever took it on display: their projects, their folder names, how much of
  their limit they had spent that afternoon, frozen into an image that then
  never changes again. The fixtures are also chosen to show every state the UI
  has at once, which no real machine obliges with.
- **`shots.css`** — the backdrop. On a real screen that is the wallpaper; here
  it is a mid grey, because the notch is pure `#000000` and a dark backdrop
  keeps only its shadow while a white one turns every capture into a contrast
  test.

Everything else — layout, type, colour, geometry, the spinner's marks — is what
ships.

## Why they come out the same every time

Everything here animates, and a screenshot of an animation mid-flight is a
different picture every run. `main.tsx` holds all of it still three ways:

```tsx
MotionGlobalConfig.skipAnimations = true;
<MotionConfig reducedMotion="always" transition={{ duration: 0 }}>
```

`MotionConfig`'s transition is only a *default*, and a component that names its
own keeps it — the ring's progress arc does, and a spring still settling when
the shutter opened is what first made two runs produce two different rings. The
global flag catches those. `reducedMotion` is the switch the components already
have for "hold a mark rather than play one", so the spinner rests where the app
would rest it for someone who asked the system for less motion. And
`--virtual-time-budget` in `capture.mjs` gives the page its mount and layout
before the shutter.

**They are not byte-identical, though.** The two scenes containing the session
list — `panel` and `states` — land a sub-pixel apart from run to run, because
Motion's layout projection measures the rows each time. The pictures are the
same; the PNGs are not. So a `git diff` on those two will show a change even
when nothing about the UI moved. `banner`, `closed` and `pill` are stable.

## Frame widths

Chrome will not lay a window out below about **500px** wide, but it *will*
screenshot whatever width you ask for — so a 340px frame is composed against
500px and then cropped to 340, silently cutting the right-hand side off
anything centred. Every scene is therefore at least 500px, and `capture.mjs`
refuses to run if one is not.

Captures are at `--force-device-scale-factor=2`, so a 500px frame lands as a
1000px PNG and stays sharp on the displays README readers actually have.
