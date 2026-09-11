import { Layout } from "~/design/layout";
import type { SessionSurface } from "~/ipc/types";

/**
 * Where a session is running, as a mark rather than a word.
 *
 * The detail row has one line to say both where a session lives and what it is
 * working on, and "Terminal · worki" spends a third of it on something a glyph
 * says at a glance.
 *
 * Drawn as the bare symbol with no frame around it. The first version put each
 * mark inside a rounded rectangle, and at the ten pixels this actually renders
 * at the frame swallowed the symbol — all four came out as the same small grey
 * blob. At this size a mark gets two strokes and no border.
 */
export function SurfaceIcon({ surface }: { surface: SessionSurface }) {
  const shared = {
    width: Layout.surfaceIcon,
    height: Layout.surfaceIcon,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style: { display: "block", flex: "none" as const },
    "aria-hidden": true,
  };

  switch (surface) {
    // A prompt: the chevron and the line you type on.
    case "terminal":
      return (
        <svg {...shared}>
          <path d="M2.6 4.2 6.4 8l-3.8 3.8" />
          <path d="M8.6 12.1h4.8" />
        </svg>
      );
    // Angle brackets: an editor, without borrowing anyone's logo.
    case "vscode":
      return (
        <svg {...shared}>
          <path d="M5.6 4.4 2.2 8l3.4 3.6" />
          <path d="M10.4 4.4 13.8 8l-3.4 3.6" />
        </svg>
      );
    // A window with its title bar.
    case "desktop":
      return (
        <svg {...shared}>
          <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="2" />
          <path d="M2.2 6.4h11.6" />
        </svg>
      );
    // A node with what it reaches: a session nothing is typing into.
    case "agent":
      return (
        <svg {...shared}>
          <circle cx="8" cy="8" r="2.6" />
          <path d="M8 1.6v2.2M8 12.2v2.2M1.6 8h2.2M12.2 8h2.2" />
        </svg>
      );
  }
}
