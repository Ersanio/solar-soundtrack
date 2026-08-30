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
    date: '30 August 2026',
    items: [
      'Playing a note in the piano roll plays the rest of the song under it, for as long as the note lasts',
      'The mixer decides which channels are heard under a played note',
      'A note is played under the instrument, volume and pan written in front of it',
    ],
  },
  {
    date: '30 August 2026',
    items: ['A replacement that expands into itself is reported instead of freezing the editor'],
  },
  {
    date: '29 August 2026',
    items: [
      'Command $DD pitch bend now accepts a note as its final argument',
      'Clicking or dragging a note in the piano roll plays its pitch bend',
      'A pitch bend is now drawn on the note that plays it, instead of the note after',
      'Normalize writes legacy "&"-pitch bends out as $DD, so the piano roll can edit those songs',
      'Shift + drag locks a note to the axis you drag along. Sideways keeps its pitch, up and down keeps its place',
      'Add a command to a selected note in the piano roll, through the command inspector',
      "Editing a command's parameters in the piano roll plays the selected note for immediate feedback",
      'The piano roll can start a song from scratch',
    ],
  },
  {
    date: '27 August 2026',
    items: [
      'A command timeline under the piano roll, showing what takes effect where',
      'The command timeline shows every command in the song, on the tick it runs',
      'The command timeline puts the channel you are editing in its top rows',
      'Drag the line above the command timeline to make it taller',
      'The command timeline no longer hides a crowded tick behind three dots',
      'The command you are inspecting is outlined in the command timeline',
      'Inspecting a command from the note panel no longer jumps to the MML',
      'Muting a channel hides its own commands in the timeline, keeping the song-wide ones',
      'Right-click a command in the timeline to delete it',
      'Drag a command in the timeline to move it to another note or rest',
      'Overwriting a note completely also clears the commands written for it',
      'Normalize unrolls subloops written as $E6, so the piano roll can edit that channel',
      'Normalize gives every note its own length instead of leaving it to l',
      'Normalize no longer refuses songs whose remote code sets an octave, length or quantization',
      'The vibrato graph says whether it is drawing a pitch swing or a volume one',
    ],
  },
  {
    date: '23 August 2026',
    items: [
      'The piano roll & note inspector shows which note a command takes effect at, and which notes are inheriting one',
      '#path is ignored, since samples here are one flat folder',
      'Solar Soundtrack-specific errors are now prefeixed with SST instead of AMK',
      'The playhead no longer drifts out of sync on songs with one-tick notes',
      'The piano roll says why a gesture was refused instead of quietly doing nothing',
      'The piano roll does not error on songs with remote commands anymore',
      'The overview bar above the piano roll colours its notes by channel, like the roll itself',
    ],
  },
  {
    date: '22 August 2026',
    items: [
      'Editable piano roll: draw, drag, stretch and delete notes, and the MML updates accordingly',
      "Piano roll mouse controls follow FL Studio's, down to middle-drag to pan and Alt for tick precision",
      'Dragging a note moves it by a snap step instead of pulling it onto the grid',
      'Dragging a note past another one no longer shifts the rest of the channel along',
      'Piano roll Overwrite mode: a note you place takes the ticks from whatever was under it',
      'A readme will soon follow with all the possible gestures and shortcuts',
      'A timeline over the piano roll, with bar numbers and a marker you drag to move the playhead',
      'The bar above it now scrolls the roll through the song instead of seeking',
      'A muted channel cannot be interacted with',
      'Piano roll channel buttons show what is muted and soloed; Ctrl+click one to solo it',
      'Escape clears the selection, then steps out of the channel',
    ],
  },
  {
    date: '21 August 2026',
    items: [
      'Undo and redo buttons in the piano roll toolbar',
      'Click a key on the roll to hear it',
      'Mutes and solos apply when you preview a note',
      'A note bar says when it has more commands than it can show',
      'Normalize one channel instead of the whole song',
      'The piano roll playhead keeps marking the song with Follow playback off',
    ],
  },
  {
    date: '20 August 2026',
    items: [
      'Normalize a song for editing: loops unrolled, replacements inlined, channel defaults written out',
      'Undo and redo buttons in the Source toolbar',
      'Piano roll channel picker',
      'Click a note or its command in the roll to edit that channel',
      'Command palette uses substitute hex commands on the older AddmusicK targets',
      'Command palette warns about commands that crash the driver',
    ],
  },
  {
    date: '19 August 2026',
    items: [
      'Piano roll grid follows a time signature you can set',
      'Piano roll bars can be zoomed in even further',
      'Muted channels cannot be interacted with in the piano roll',
      'Fix echo buffer allocation messing with the song tempo estimation',
    ],
  },
  {
    date: '18 August 2026',
    items: [
      'Piano roll that scrolls along with the song',
      'Volume slider shows its level while dragging',
      'Click a note or command in the roll to inspect it, double-click to jump to the MML',
      'Song length and the playback timer match what you actually hear',
      'A warning when the driver cannot keep up with the tempo',
    ],
  },
  {
    date: '13 August 2026',
    items: [
      'Songs always compile as you type, the manual controls are gone',
      'Command palette above the editor, with a button for every MML command',
    ],
  },
  {
    date: '11 August 2026',
    items: [
      'Signed values (such as pan left/right) get a mixer-style control',
      'Arpeggio notes name the interval they make',
      'FIR coefficients are changed to sliders',
      'Adjusting echo feedback auto-stops playback when a runaway echo is detected',
      '"q" reads the correct velocity table when a song switches it with various commands',
      '"y" added the missing surround L/R speaker options',
      'Anything that sets the tempo, also shows the ticks per second',
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
