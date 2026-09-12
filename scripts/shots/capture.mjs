/**
 * Take the README's screenshots.
 *
 *   pnpm dev          # in one terminal — the page is served from there
 *   pnpm shots        # in another
 *
 * Headless Chrome, at a fixed device scale factor, against `fixtures.ts`. Every
 * run produces the same bytes, so re-taking a screenshot after a UI change is a
 * reviewable diff rather than a new photograph.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../docs/images");

const ORIGIN = process.env.SHOTS_ORIGIN ?? "http://localhost:5173";

/** 2x, so the images stay sharp on the displays README readers actually have. */
const SCALE = 2;

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((path) => existsSync(path));

if (!CHROME) {
  console.error("No Chrome or Edge found to render with.");
  process.exit(1);
}

/**
 * Each scene, and the box it is captured in, in CSS pixels.
 *
 * Written down rather than measured at runtime: a screenshot whose dimensions
 * drift with its content cannot be diffed against the last one.
 *
 * None is narrower than `MIN_WIDTH`, and that is not a design choice. Chrome
 * refuses to lay a window out below about 500px wide — but it will happily
 * *screenshot* whatever width you asked for, so a narrower frame is composed
 * against 500px and then cropped to the number you gave, which silently cuts
 * the right-hand side off every centred scene.
 */
const MIN_WIDTH = 500;

const scenes = [
  { name: "banner", width: 560, height: 220 },
  { name: "panel", width: 500, height: 520 },
  { name: "closed", width: 500, height: 360 },
  { name: "pill", width: 500, height: 360 },
  { name: "states", width: 520, height: 330 },
];

const tooNarrow = scenes.filter((scene) => scene.width < MIN_WIDTH);
if (tooNarrow.length > 0) {
  console.error(
    `Scenes narrower than ${MIN_WIDTH}px get cropped, not composed: ` +
      tooNarrow.map((scene) => scene.name).join(", "),
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const profile = join(process.env.TEMP ?? "/tmp", `nook-shots-${process.pid}`);

for (const scene of scenes) {
  const out = join(outDir, `${scene.name}.png`);
  execFileSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      // Transparent where the page is transparent, so a scene that does not
      // paint its own backdrop does not get an opaque white one.
      "--default-background-color=00000000",
      `--force-device-scale-factor=${SCALE}`,
      `--window-size=${scene.width},${scene.height}`,
      // Let the page settle before the shutter. React mounts, Motion runs its
      // enter transitions, and a screenshot taken in the same frame catches
      // rows still fading in — which is how the first run of this produced a
      // panel that looked greyed out.
      "--virtual-time-budget=4000",
      `--user-data-dir=${profile}`,
      `--screenshot=${out}`,
      `${ORIGIN}/shots.html?scene=${scene.name}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  console.log(`${scene.name}.png  ${scene.width * SCALE}x${scene.height * SCALE}`);
}

// Chrome keeps a handle or two open for a moment after it exits, and a failure
// to delete a temp directory is not a failure to take the screenshots.
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  /* the OS will get to it */
}
