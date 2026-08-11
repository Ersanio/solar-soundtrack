/**
 * What the changelog popup in the top bar shows.
 */
export interface ChangelogEntry {
  readonly date: string;
  readonly items: readonly string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  // ─── newest first; add new blocks here ──────────────────────────────────
  {
    date: '11 August 2026',
    items: [
      'Pan and every ±value get a mixer-style control',
      'Arpeggio notes name the interval they make',
      'FIR coefficients are changed to sliders',
      'Playback stops on a runaway echo from the feedback slider too, not just the filter',
      '"q" reads the right velocity table when a song switches it with hex',
      '"y" added the missing surround L/R speaker options',
    ],
  },
  {
    date: '5 August 2026',
    items: [
      'Every command is now editable from the inspector',
      'Command arguments are named and shown in real units',
      'Envelope tuner for ADSR and GAIN, with six presets',
      'Echo channels, feedback and filter set from the panel',
      'Instrument definitions are editable, sample and all',
      'Vibrato, tremolo and pitch bends are drawn as shapes',
      'Delays and fades read in note lengths and seconds',
      'Note picker for pitch bends, sample picker for $F3',
      'Arpeggio loop points can be set from the note list',
      'Fixed the noise clock control writing the wrong value',
    ],
  },
  {
    date: '4 August 2026',
    items: [
      'Rich, interactive editor with syntax highlighting',
      'Current notes being played are highlighted',
      'Correct highlighting and command info for all Addmusic dialects',
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
