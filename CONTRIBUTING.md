# Contributing to Nook

## Getting set up

You need [Node](https://nodejs.org) 20+, [pnpm](https://pnpm.io), and a
[Rust](https://rustup.rs) toolchain with the MSVC target — which means the
Visual Studio Build Tools with the "Desktop development with C++" workload.
WebView2 is already on any current Windows 11 or 10.

```sh
pnpm install
pnpm start                       # run it
NOOK_LOG=nook_lib=debug pnpm start   # …with the backend talking
```

```sh
pnpm check                       # typecheck + frontend tests
cd src-tauri && cargo test       # backend tests
cargo clippy --all-targets -- -D warnings
pnpm release                     # an installer
```

Both test suites are fast and neither needs a network or a signed-in Claude
Code, so run them before every push.

Those four lines are what CI runs, on `windows-latest` — half of what is being
checked is Win32, and none of it means anything on a Linux runner. Clippy is a
gate there, so a warning fails the build; `cargo fmt` is deliberately **not**
one, because this codebase is hand-laid-out and rustfmt breaks several comments
across lines that read worse.

## How the code is arranged

The split is by *what a thing knows*, not by what layer it is in.

**`src-tauri/src/claude/`** reads what Claude Code already knows. It never
writes anything Claude Code owns and never signs in — Nook borrows a token and
a session registry, and both belong to the other program.

**`src-tauri/src/sys/`** is the Win32 surface. Every `unsafe` block in the
project is in these two files, each with a `// SAFETY:` note saying why it
holds. Adding a Win32 call means adding it here, not calling it from wherever
it happened to be needed.

**`src-tauri/src/notch/`** owns the window: where it goes, how the pointer
reaches it, the tray icon.

**`src/design/`** is the design frame, ported. Nothing else in the frontend may
contain a magic number — if a measurement is not `px(n)` of something the frame
fixes, it needs a comment saying where it came from and why the frame does not
answer it.

**`src/features/`** and **`src/notch/`** draw. They read no files, hold no
credentials and make no network requests; everything arrives from a command or
an event. If a change needs the page to do more than that, it belongs in Rust.

## Conventions

**Comments say *why*, never *what*.** Most of the ones already here record a
reading that was once wrong, or a simpler version that broke. That is what
makes them worth their space, and it is the standard for new ones. A comment
that restates the line under it should be deleted.

**Budget heights, don't measure them.** The panel animates to a height, and a
height that arrives from a `ResizeObserver` one frame later makes the notch
lurch. Everything above the session list is a known number of line boxes, and
`design/layout.ts` is the only place that arithmetic lives. If you add
something to the panel, add it to the budget *and* to `layout.test.ts` — a row
whose padding is in the stylesheet but not in the budget is a row that gets
clipped, and it will look like a rendering bug rather than a missing number.

**Every failure gets a visible status.** No adapter may invent a percentage.
`UsageStatus` has a case for each thing that can go wrong because each of them
needs a different answer from the reader — a stale reading wants nothing, an
expired token wants Claude Code run once, a rate limit wants patience.

**Test the thing that was wrong.** Each test here names the defect it guards.
`copy.test.ts` has a case for a path that never split; `layout.test.ts` has one
for the flares that were counted as usable space. Please keep that up: a test
called `it works` teaches nobody what it is for.

## Changing the look

The proportions come from Codenotch's design frame, and every measurement is
quoted in that frame's pixels through `px()`. Changing the scale means changing
one number in `design/scale.ts` — the anchor, currently "the ring is 44pt
across, and it measures 117px in the frame". Everything resizes with it.

If you need a measurement the frame does not fix — the resting pill, the
session chip, the activity arc — say so in a comment, along with what you sized
it against. The three that already exist each name the gap they were fitted
into.

## Reporting something

The two things most likely to break are outside this repository: the usage
endpoint's response shape, and the session registry's fields. Both are pinned
by tests with real fixtures, so if either changes, the failing test name should
say which. Please include the output of:

```sh
NOOK_LOG=nook_lib=debug pnpm start
```

with anything that looks like a credential removed.
