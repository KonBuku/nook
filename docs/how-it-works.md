# How it works

## What it reads

| | Source | How |
|---|---|---|
| **Usage** | Claude Code's own | The OAuth token Claude Code saves in `%USERPROFILE%\.claude\.credentials.json`, against the same endpoint Claude Code's `/usage` uses. |
| **Sessions** | Claude Code's own | `%USERPROFILE%\.claude\sessions\<pid>.json` — the registry every running Claude Code writes and rewrites as its state changes. |

Nook never signs in anywhere and never writes anything Claude Code owns. Every
reading is borrowed from a credential a tool on your machine already holds: run
`claude` once and the ring fills in.

`CLAUDE_CONFIG_DIR` is honoured, so a work login kept apart with
`CLAUDE_CONFIG_DIR=~/.claude-work claude` reports on that account instead.

## Layout

```
src-tauri/src/
  claude/     reads what Claude Code already knows — credential, usage, sessions
  sys/        the Win32 surface: process liveness, window focus, the working area
  notch/      the window — placement, the pointer hot zone, the tray icon
  app.rs      the state, and the two loops that keep it current
  commands.rs the short list of things the webview may ask for

src/
  design/     the frame's proportions, ported: scale, layout, palette, motion
  notch/      the silhouette and the two layouts inside it
  features/   the ring, the limit rows, the session list
```

The page draws and nothing else. It reads no files, holds no credentials and
makes no network requests — everything arrives as the answer to a command or as
an event, which is why the window's capability list is four lines long.

## One number sets every size

Everything visual is derived from one anchor. The design frame Nook is ported
from fixes only *ratios*, so `design/scale.ts` turns them into sizes with a
single measurement — the ring is 44pt across, and it measures 117px in the
frame — and every other distance is quoted in frame pixels through `px()`.
Change the anchor and the whole surface resizes together, still in the frame's
proportions. [`docs/design`](design/README.md) has the full account.

## The silhouette is generated, not authored

Morphing between two hand-drawn paths means interpolating point by point, which
only works if both have the same points in the same order. Solving the geometry
from width and height instead means the flares keep their radius at every size,
and the pill's corners do not collapse the way clamped-by-subtraction ones do.

## The window is only where the notch is

The window covers a slab of the screen edge; the notch is a sliver of it.
Everywhere else has to let clicks through.

The obvious answer — `WS_EX_TRANSPARENT`, which is what Tauri's
`set_ignore_cursor_events` sets — does not work behind a WebView2. WebView2
hosts its content in a child window belonging to `msedgewebview2.exe`, a
different process; clearing the style on our own top-level window leaves that
child's alone, and the click lands on the child. Tauri's call returns `Ok` and
the window simply stays opaque to clicks.

A **window region** does work, because the window manager enforces it above all
of that: the region clips the window and every child of it, in painting *and*
in hit-testing, regardless of which process owns which handle. The region is a
rectangle a little larger than the chrome rather than the notch's own outline —
a region has hard edges, and clipping to the silhouette would saw the
anti-aliasing off the curves that are the whole point of the shape.

Opening is a poll, not a hook. The notch has to open as the pointer
*approaches*, and from outside the region there are no events to hear — so the
cursor is sampled at 30 Hz and tested against the same rectangle. A low-level
`WH_MOUSE_LL` hook would put this process in the input path of every mouse
message on the desktop, where one slow frame stutters the whole system's
cursor. `GetCursorPos` cannot affect anything else.

The way in is a narrower margin than the way out. The screen edge is somewhere
people put the pointer for reasons that have nothing to do with the notch — a
maximised window's sidebar, a scroll bar — so arriving takes reaching the shape
itself, while leaving takes crossing a wider line. One margin doing both jobs
has to be the wide one, and that opens the notch at things nobody was reaching
for.

## Staying in front

`alwaysOnTop` claims `WS_EX_TOPMOST` once, when the window is created, and
Windows ranks topmost windows among themselves by who claimed the band last.
At login everything else that starts with the session claims it after Nook
does, because Nook is up before the desktop is. So the claim is re-made: when
the window is placed, on a two-second heartbeat, and on the way into the hot
zone — so the panel never unfolds underneath something. With one exception,
which is the next section.

## Getting out of the way of a full-screen application

Everything above assumes the desktop is being used as a desktop. A game is the
case where it is not, and both halves of the notch are wrong there in their own
way.

The heartbeat evicts it. `SetWindowPos(HWND_TOPMOST)` from any process
re-orders the whole always-on-top band, and a window arriving above a display
an exclusive full-screen swap chain owns is exactly the event that makes
Windows take that display back off it: the game drops to windowed or minimises,
then re-acquires a moment later. Every two seconds. It is not the notch being
*drawn* that does it — it is the claim being re-made.

And the cursor is not the pointer. A game that captures the mouse reads raw
input and leaves the system cursor parked wherever Windows last put it, often
against a screen edge, because that is where a clipped cursor ends up.
`GetCursorPos` reports that as happily as a real position, so aiming in-game
reads as a pointer sitting on the notch: the panel unfolds over the game, and
the region under it swallows the next click instead of letting the game shoot
with it.

So the same 30 Hz poll asks first who owns the screen. Two things are checked,
because neither is enough alone. The foreground window's bounds against its
monitor's *full* bounds, which is most of what separates a full-screen window
from a merely maximised one: a maximised window stops at the taskbar, and even
an auto-hidden taskbar keeps a sliver of the display to be revealed from. And
whether that window still has a title bar, because a display with no taskbar on
it — any second monitor with "show taskbar on all displays" switched off —
leaves no sliver, and a maximised browser there covers the monitor exactly.
Going full-screen means giving the frame up, so a window still wearing its
caption has not asked for the display however large somebody has dragged it.

When the answer is not "nobody", the notch stands down: the hot zone
stops existing, which takes the region and the hover test with it in one move,
and the heartbeat is skipped. A full-screen window on *another* display stops
the heartbeat too — the band it re-orders is the desktop's, not one monitor's —
but leaves the notch on this one reachable.

The moment the game gives the screen back, the next tick raises and re-cuts the
region, so coming out of a game is not a notch that stays missing.

## The window never takes focus

`WS_EX_NOACTIVATE`, applied *after* Tauri's own size and position calls, which
rewrite the extended style and would otherwise drop it.

Two things go wrong without it, and both look like a lost click. A window that
can be activated *is* activated by the click that lands on it, and Chromium
spends that first click on the activation rather than delivering it to the
page. And the click that reaches a session row asks Windows to raise that
session's terminal, which cannot win against the notch having just taken the
foreground itself.

The cost is that the page never receives the keyboard, so there is no
Escape-to-close. The global chord is the way out instead.
