# The honest caveats

Things worth knowing before you rely on this.

## The endpoint is not a published API

It is the one Claude Code's own `/usage` reads, and it can change without
notice. Its response shape is pinned by tests, and every failure degrades to a
visible status — `stale`, `needsAuth`, a rate-limit countdown — rather than to
an invented number.

## Rate limits

The endpoint returns 429 if polled too hard, with an unhelpful `Retry-After: 0`.
The back-off treats that as a floor-raiser only: 60s, doubling per consecutive
429, capped at 15 minutes. The deadline is persisted, so relaunching during a
penalty waits instead of spending an attempt on it. Polling drops to every five
minutes when nothing is running.

## Finding a session's terminal

A console program has no window of its own, so Nook works outward from the
session's process: up through its ancestors — which is how it finds Windows
Terminal, VS Code, or whatever started it — and one step down at each level,
because a classic console's window belongs to a `conhost.exe` *child* rather
than to any ancestor. The search stops at the shell: `explorer.exe` owns the
desktop window, and walking past it finds that instead and raises the file
manager.

That leaves the case where Windows Terminal is the machine's *default* console
host, and there the terminal is not in the session's process tree at all — the
shell starts, Windows hands the console off over a pseudo-console, and the
terminal attaches from outside. Walking the tree finds the shell and then the
desktop, never the terminal.

The handoff does leave a thread to pull. The process keeps a hidden
`PseudoConsoleWindow` — the stub the console APIs answer from — and that stub is
a child window of *the terminal serving it*. Its parent is the window the
session is typed into: exactly, not probably. Two sessions in two Windows
Terminal windows each resolve to their own window, even though both windows
belong to a single process.

A session whose terminal cannot be found says so. The row is not a button, and
it explains why.

## Windows Terminal tabs

Clicking a session raises the *window* its terminal is in. If that window has
several tabs, the right window comes forward but the right tab is not selected —
nothing in the terminal's public surface lets an outside process pick one.

## Logs

The app has no window to print into, so anything worth diagnosing goes to
stderr:

```sh
NOOK_LOG=nook_lib=debug pnpm start
```
