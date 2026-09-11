import { motion } from "motion/react";

import { Layout, Type, bodyLine } from "~/design/layout";
import { row as rowMotion } from "~/design/motion";
import { elapsedText, shortPath } from "~/features/copy";
import type { Session } from "~/ipc/types";
import { ClaudeSpinner } from "~/features/ClaudeSpinner";
import { SurfaceIcon } from "./SurfaceIcon";
import { stateColor, stateWord } from "./activity";

/**
 * One session: what it is called and what it is doing, then where it lives and
 * for how long it has been doing it.
 *
 * The whole row is the button. Clicking it brings that session's terminal to
 * the front — which is the reason to look at this list at all, so it should not
 * be a target you have to aim at.
 */
export function SessionRow({
  session,
  justFinished,
  now,
  spacing,
  onOpen,
}: {
  session: Session;
  justFinished: boolean;
  /** Passed in rather than read here, so every row in a render agrees. */
  now: number;
  /** Clear space above this row. Zero for the first one. */
  spacing: number;
  onOpen: (session: Session) => void;
}) {
  const color = stateColor(session.state, justFinished);
  const word = stateWord(session.state, justFinished);

  // While blocked, what it is blocked on matters more than where it lives.
  const detail =
    session.state === "waiting" && session.waitingFor?.trim()
      ? session.waitingFor
      : shortPath(session.cwd);

  return (
    <motion.button
      type="button"
      layout="position"
      className={`session-row${session.focusable ? " clickable" : ""}`}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={rowMotion}
      style={{ fontSize: Type.body, gap: Layout.sessionRowGap, marginTop: spacing }}
      disabled={!session.focusable}
      onClick={() => onOpen(session)}
    >
      <span className="split-row">
        <span className="session-name">{session.name}</span>
        <span className="spacer" />
        <span className="trailing" style={{ gap: Layout.markGap, color }}>
          <ClaudeSpinner
            state={session.state}
            size={Layout.spinner}
            color={color}
            justFinished={justFinished}
          />
          {word}
        </span>
      </span>

      <span className="split-row session-detail" style={{ height: bodyLine }}>
        <span
          className="trailing"
          style={{ gap: Layout.markGap, color: "inherit", flex: "0 1 auto", minWidth: 0 }}
        >
          <SurfaceIcon surface={session.surface} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{detail}</span>
        </span>
        <span className="spacer" />
        <span className="trailing">{elapsedText(new Date(session.since), new Date(now))}</span>
      </span>
    </motion.button>
  );
}
