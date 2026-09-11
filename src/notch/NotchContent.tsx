import { AnimatePresence, motion } from "motion/react";

import { Layout, Type, bodyLine, titleLine } from "~/design/layout";
import { crossfade } from "~/design/motion";
import { ClaudeSpinner } from "~/features/ClaudeSpinner";
import { SessionList } from "~/features/sessions/SessionList";
import { activityAsState, activityColor, activityOf } from "~/features/sessions/activity";
import { LimitWindowRow } from "~/features/usage/LimitWindowRow";
import { headlineOf, readingNote, statusMessage } from "~/features/usage/status";
import type { Session, UsageSnapshot } from "~/ipc/types";

export interface ContentProps {
  usage: UsageSnapshot;
  sessions: Session[];
  justFinished: ReadonlySet<string>;
  now: number;
  isRefreshing: boolean;
  /** What the session list has left after the header and the limit rows. */
  sessionListHeight: number;
  onRefresh: () => void;
  onOpenSession: (session: Session) => void;
}

/**
 * The closed notch: the ring, the percent under it, and — only when something
 * is running — a count of what.
 */
export function ClosedContent({ usage, sessions }: ContentProps) {
  const fraction = headlineOf(usage)?.usedFraction ?? null;
  const activity = activityOf(sessions);

  return (
    <div className="content closed">
      {/* The ring itself lives in `RingSlot`, above both layouts, so it can
          travel between them instead of being cross-faded from one place to
          another. What stands here is the room it occupies. */}
      <div style={{ height: Layout.padTop + Layout.ringDiameter, flex: "none" }} />

      {/* A dash, not "0%": nothing read is not the same as nothing used. */}
      <div
        className="percent"
        style={{ fontSize: Type.percent, marginTop: Layout.ringLabelGap }}
      >
        {fraction === null ? "—" : `${Math.round(fraction * 100)}%`}
      </div>

      <AnimatePresence>
        {sessions.length > 0 && (
          <motion.div
            className="chip"
            style={{ fontSize: Type.chip, color: activityColor(activity) }}
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: Layout.chipHeight, marginTop: Layout.chipGap }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={crossfade}
          >
            <ClaudeSpinner
              state={activityAsState(activity)}
              size={Layout.spinner}
              color={activityColor(activity)}
            />
            {sessions.length}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The open panel: the same ring, now beside a title, then every limit window,
 * then every live session under a rule that separates them — they answer
 * different questions.
 */
export function OpenContent({
  usage,
  sessions,
  justFinished,
  now,
  sessionListHeight,
  onRefresh,
  onOpenSession,
}: ContentProps) {
  const message = statusMessage(usage, now);
  const note = readingNote(usage, now);

  return (
    <div className="content panel" style={{ padding: Layout.panelPadding }}>
      <header className="panel-header" style={{ gap: Layout.headerGap }}>
        {/* The ring's place. It is drawn by `RingSlot`, which owns the one ring
            both layouts share. */}
        <div style={{ width: Layout.ringDiameter, height: Layout.ringDiameter, flex: "none" }} />
        <div className="panel-title" onClick={onRefresh} style={{ cursor: "pointer" }}>
          <h1 style={{ fontSize: Type.title, height: titleLine }}>Claude</h1>
          {note && (
            <span className="panel-note" style={{ fontSize: Type.body, height: bodyLine }}>
              {note}
            </span>
          )}
        </div>
      </header>

      {message ? (
        <p
          className="status-message"
          style={{ fontSize: Type.body, marginTop: Layout.headerToBlock }}
        >
          {message}
        </p>
      ) : (
        usage.windows.map((limit, index) => (
          <div
            key={limit.id}
            style={{ marginTop: index === 0 ? Layout.headerToBlock : Layout.blockSpacing }}
          >
            <LimitWindowRow window={limit} now={now} />
          </div>
        ))
      )}

      {sessions.length > 0 && (
        <>
          <div
            className="hairline"
            style={{
              height: Layout.hairline,
              marginTop: Layout.blockSpacing,
              marginBottom: Layout.blockSpacing,
            }}
          />
          <SessionList
            sessions={sessions}
            justFinished={justFinished}
            now={now}
            maxHeight={sessionListHeight}
            onOpen={onOpenSession}
          />
        </>
      )}
    </div>
  );
}
