import { CLAUDE_MARK_PATH } from "~/design/claudeMark";

/**
 * Claude's mark, at whatever size it is given.
 *
 * `fill-rule="evenodd"` for the same reason the Swift original fills even-odd:
 * the trace is a single contour today, but a mark with an enclosed counter
 * would otherwise come out solid.
 */
export function ClaudeMark({ size, color = "currentColor" }: { size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d={CLAUDE_MARK_PATH} fill={color} fillRule="evenodd" />
    </svg>
  );
}
