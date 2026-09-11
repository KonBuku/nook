/**
 * The words the notch puts next to a number.
 *
 * Ported from Codenotch's `ResetCopy` and `ElapsedCopy`, including the reasons
 * each rule exists — they were all learned from a reading that read wrong.
 */

/**
 * "Resets in 51 min" under an hour, "Resets Thu 12:00 AM" within the week,
 * "Resets Sep 28" beyond it.
 */
export function resetText(resetsAt: Date, now: Date = new Date()): string {
  const seconds = (resetsAt.getTime() - now.getTime()) / 1000;
  if (seconds <= 0) return "Resetting…";

  // Rounding, not truncation, so 50m40s reads as 51 rather than 50. A value
  // that rounds up to 60 falls through to the absolute form, so "Resets in
  // 60 min" never appears.
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Resets in ${Math.max(1, minutes)} min`;

  // A weekday only identifies a day inside the coming week. A window that
  // resets 26 days out written as "Resets Mon 3:55 PM" reads as *this* Monday
  // — six days away rather than nearly four weeks.
  if (daysApart(now, resetsAt) >= 7) {
    // Day and month only, matching how the vendors write it. A time that far
    // out is noise: nobody plans around 3:55 PM in four weeks.
    return `Resets ${resetsAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }

  // The weekday and AM/PM come from the locale; the separator stays a colon,
  // because both the design frame and Claude's own usage panel write "4:50 PM".
  const day = resetsAt.toLocaleDateString(undefined, { weekday: "short" });
  const time = resetsAt.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `Resets ${day} ${time}`;
}

/** "how long has it been like this" — the second half of "is Claude working?" */
export function elapsedText(since: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - since.getTime()) / 1000);
  if (seconds < 45) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** The same span, phrased as a point in the past. */
export function agoText(since: Date, now: Date = new Date()): string {
  const elapsed = elapsedText(since, now);
  return elapsed === "just now" ? elapsed : `${elapsed} ago`;
}

/**
 * Both ends of the same figure.
 *
 * Vendors do not agree on which to show — some write "87% remaining", Claude
 * writes "% used" — so a notch that picks one side leaves the reader
 * converting in their head, and "12% Used" beside "87% remaining" reads as two
 * different numbers rather than one seen from either end.
 */
export function usageSummary(usedFraction: number): string {
  const used = Math.round(usedFraction * 100);
  return `${used}% Used · ${Math.max(0, 100 - used)}% left`;
}

/**
 * A working directory, shortened to what identifies it.
 *
 * `C:\Users\you\Desktop\notes-app` is mostly a path to the user's own home, and
 * every session shares that prefix — so the part that tells two sessions apart
 * is the tail. Two segments, which is enough to distinguish `api\server` from
 * `web\server` without spending the row on a path.
 *
 * Split on each separator in turn rather than with a `[\\/]` character class.
 * That class is one dropped backslash away from matching only forward slashes
 * — which is a Windows path that never splits at all, and a row that shows the
 * whole of `C:\Users\...` where it meant to show two segments. It fails
 * silently and it looks correct. Two plain string splits cannot.
 */
export function shortPath(cwd: string): string {
  const segments = cwd
    .split("\\")
    .flatMap((part) => part.split("/"))
    .filter(Boolean);
  return segments.slice(-2).join("\\") || cwd;
}

/** Whole days between two instants, counted by calendar day. */
function daysApart(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}
