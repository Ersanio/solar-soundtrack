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
    date: '24 November 2026',
    items: [
      'Import MIDI files as a new song, with channel picking, instrument matching and a preview',
      'Name the stock instruments and drums in the instrument picker',
    ],
  },
  {
    date: '19 November 2026',
    items: [
      'Add Song Inspector: channel and sample levels, loudness, clipping, echo and a spectrogram, over the whole song',
      'Add Audio Visualization: a live spectrum, oscilloscopes and a stereo vectorscope',
      'Moved build statistics to the Song Inspector',
      'New theme: Praise The (Happy) Sun',
      'Add support for light themes; Certain UI elements automatically change colors to match the theme',
      'Allow changing the piano keys and the sheen on buttons in the theme editor',
      'Add extra checks and warnings for the arpeggio command',
    ],
  },
  {
    date: '18 November 2026',
    items: [
      'Fix chained or tied pitch bends falsely reporting an SST0507 error',
      'Fix audio lag for note previews late in the song in the piano roll, when the song is rather long',
      'Fix muted channels leaking through to the audio output every now and then',
      'Add option to suppress certain warnings',
      'Add option to auto-fix certain warnings and errors',
      'Notes with vibrato acting on them, show the peak and dip octave in the note inspector',
      'Warn when a note is pitched higher than its instrument can play',
      "Warn when a note with vibrato swings past the instrument's playable pitch range",
      'Allow restoring a song that has frozen Solar Soundtrack, so that progress is not lost',
      'Solar Soundtrack now supports MIDI keyboard input',
      'Solar Soundtrack now supports your computer keyboard input. o4: Z-M for the naturals, S D G H J Q for the sharps. The rows above for o5',
      'Add MIDI keyboard recording function in the piano roll',
      'Hardcode drum lane in the piano roll to @21-29 at all times',
      'Restyle buttons and toggles to be more distinguishable',
      'New theme: Juicy Loops Studio, which has colors similar to a certain program',
      'Allow directly editing the hex values of the colors in the theme editor',
      'Change some colors of the default theme',
      'Shift around buttons and toggles in the UI',
    ],
  },
  {
    date: '2 November 2026',
    items: [
      "Warnings when the tempo or any other setting carries over into the song's repeat",
      'Piano roll edits keep commands, the intro marker and the song length where they were',
      'Deleting a note in the piano roll leaves a rest',
      'A command inspector for remote code calls and resets: the type, the wait in ticks, and the commands the call runs',
    ],
  },
  {
    date: '26 October 2026',
    items: [
      'A pitch bend given more time with ties after it, is no longer wrongly warned as cut off',
      'A note shows how many of its ticks really sound under its quantization, and the piano roll draws notes that long',
      'Turning remote code off with (!0, 0), no longer asks for a (!0) to be defined',
      'Add a warning for a remote code call with no remote code to run',
      'The pitch bend graph starts from the note before the bend; it does not default to o4 c anymore',
    ],
  },
  {
    date: '3 September 2026',
    items: [
      'A new default look and layout: blue-grey chrome and an orange playhead. The old theme is the Midnight preset',
      'A theme picker: five presets, or set any colour yourself',
      'Clicking the time in the playback controls switches between m:ss and ticks',
      'A status bar showing the note count, tempo and tick rate',
      'Channel mixer at the bottom carries the same colors as the channels in the piano roll',
      'Escape deselects the command you are inspecting',
      'Changing a command picked in the command lane previews the note it acts on',
      'The Normalize button is gone: the piano roll mostly edits a song as it is written',
      'The Stop button stops a note or selection being previewed, not just the song',
      'Pick a different instrument from the command inspector',
      'Space starts and stops the song in the piano roll',
      'Delete or Backspace removes the command you are inspecting',
      'The command you are inspecting is outlined on the note bars as well as in the command lane',
      'Loops are drawn in the piano roll: a dashed box around the written loop, a dotted one around every repeat, tinted in the channel colour',
      'Make a loop from the command palette: one Loop button that wraps the notes you have selected, and numbers itself',
      'A loop inspector, naming the loop the cursor is in and putting its repeat count one field away',
      'Warnings for commands that compile fine and then break the song: write byte, and a pitch bend the driver cannot reach',
      'The write byte button is gone from the command palette: this driver never implemented it, so there is nothing it could do',
    ],
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
