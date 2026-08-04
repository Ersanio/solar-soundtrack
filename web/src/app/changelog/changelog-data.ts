/**
 * What the changelog popup in the top bar shows.
 *
 * **To add an entry:** put a new block at the *top* of `CHANGELOG`, newest
 * first. If today's date already has a block, add a string to its `items`
 * rather than a second block for the same date.
 *
 * **The audience is music porters, not developers.** Name the feature in a short
 * phrase — "Sample browser & importer", not a sentence about how it works. How
 * it is implemented never belongs here, however interesting: nobody writing MML
 * needs to know that the playhead follows the driver rather than estimating it.
 * Refactors, internal work and small fixes do not belong here at all.
 *
 * `date` is a display string and is printed verbatim, so it does not have to
 * parse.
 *
 * Hand-written on purpose: generating this from commit subjects would put
 * "Optimize user interface" in front of a user, and would be one more thing to
 * keep in sync.
 */
export interface ChangelogEntry {
  readonly date: string;
  readonly items: readonly string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  // ─── newest first; add new blocks here ──────────────────────────────────
  {
    date: '4 August 2026',
    items: [
      'Syntax highlighting, with line numbers',
      'Errors and warnings underlined in the source',
    ],
  },
  {
    date: '3 August 2026',
    items: [
      'Runaway echo filters are now flagged in Diagnostics',
      'Draggable divider between the editor and output panes',
      "SPC-700's main.bin now carries the default global songs",
      'Removed uploading main.bin, for simplicity',
    ],
  },
  {
    date: '2 August 2026',
    items: ['This changelog'],
  },
  {
    date: '1 August 2026',
    items: [
      'Command inspector, explaining whatever the cursor sits on',
      'Echo FIR filter designer, with presets and a response plot',
      'ADSR & GAIN inspector',
      'Instrument inspector, with ADSR envelope graphs',
    ],
  },
  {
    date: '31 July 2026',
    items: ['Per-channel mute and solo', 'Installable as an app, and usable offline'],
  },
  {
    date: '30 July 2026',
    items: [
      'Sample browser & importer',
      'Sample optimization toggle',
      'Full support for AddmusicK 1.0.11 commands',
      'ARAM budget viewer',
    ],
  },
  {
    date: '29 July 2026',
    items: ['First working version'],
  },
];
