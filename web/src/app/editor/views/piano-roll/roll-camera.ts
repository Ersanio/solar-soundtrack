import { signal } from '@angular/core';

/**
 * The camera's own fractions, and where it is left between visits.
 *
 * The roll is built and thrown away on every tab switch, so a position held in
 * the component is a position lost. These outlive it, and the component aliases
 * them, so a camera write stays an ordinary `set` on an ordinary signal.
 *
 * A module record rather than a service: `state/` holds the song, the compile
 * and the transport in one-way order, and the camera is none of the three. It
 * lasts as long as the page does — a reload opens on the song's start, as a
 * roll nobody has scrolled does.
 */

/** Where the playhead sits across the roll: a fifth in, so you see what is coming. */
export const PLAYHEAD_AT = 0.2;
/**
 * Where the song's last tick sits once the scroll has run as far right as it
 * goes — a little past the playhead, so the end of the song can be read with
 * some room after it rather than pinned under the line.
 */
export const SCROLL_END_AT = 0.1;
/** How far across the pane a paged playhead runs before the roll turns over. */
export const PAGE_TURN_AT = 0.9;
/**
 * How much of a pane a turn moves.
 *
 * Less than {@link PAGE_TURN_AT}, so the playhead lands a tenth in rather than
 * hard against the key column: the bar that has just played stays on screen,
 * which is what makes the new page read as a continuation of the old one.
 */
export const PAGE_STEP = 0.8;
/** The margin a turn leaves, and so the one every page opens on. */
export const PAGE_LEAD_IN = PAGE_TURN_AT - PAGE_STEP;
/**
 * How much of a pane a scrub held off the end of the bar crosses in a second.
 *
 * A fraction of a pane rather than a count of pixels or ticks, so the pull reads
 * the same at every zoom and every pane width: what the eye is measuring is how
 * fast the music on screen is being replaced.
 */
export const PULL_PANES_PER_SEC = 0.8;

export const rollCamera = {
  /** Where the view is parked when it is not following the song. */
  panTick: signal(0),

  /**
   * How far across the pane the playhead sits while the view is parked.
   *
   * A paged playhead is anywhere between the lead-in and the turn, and coming
   * off the song must not move the music under it: parking keeps the fraction
   * the playhead had, so the picture stays where the eye left it. A roll that
   * scrolls its notes has only one answer, which is {@link PLAYHEAD_AT}.
   */
  panLead: signal(PLAYHEAD_AT),

  /**
   * The tick the page grid is measured from, which a scroll moves.
   *
   * Zero is the song's own start, and a song nobody has scrolled keeps it: the
   * first page opens on the lead-in and every turn falls a stride after the last.
   * A scroll re-anchors it on the view it leaves behind, so returning to the song
   * carries on from what is on screen rather than from where the seeked tick
   * happens to sit in a grid measured from the beginning.
   */
  pageOrigin: signal(0),

  /**
   * The row at the top of the viewport, which is where the vertical scroller is.
   *
   * Rows and not pixels because a row stretches to the height going, so the same
   * offset in pixels is a different note in a taller pane. Not a signal: nothing
   * draws from it, and a write per scroll event would schedule a change-detection
   * pass each time for a number only the restore reads.
   */
  topRow: 0,
};
