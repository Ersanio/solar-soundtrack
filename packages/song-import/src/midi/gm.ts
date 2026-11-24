/**
 * General MIDI's programs and drum keys, matched to the instruments the driver ships.
 *
 * The stock set is `@0`-`@18` and the drums `@21`-`@29` (`@amk/spc/instruments`), so each GM
 * program goes to the stock instrument nearest in kind, and each GM drum key (35-81, channel 10) to
 * the stock drum nearest in sound. Toms and hand drums have no stock drum of their own and are
 * played on `@12`, the bongo, at a pitch.
 */

/** The sixteen GM families of eight programs each, in program order. */
export const GM_FAMILIES = [
	"piano",
	"chromatic-percussion",
	"organ",
	"guitar",
	"bass",
	"strings",
	"ensemble",
	"brass",
	"reed",
	"pipe",
	"synth-lead",
	"synth-pad",
	"synth-effects",
	"ethnic",
	"percussive",
	"sound-effects",
] as const;

export type GmFamily = (typeof GM_FAMILIES)[number];

/** The family of a GM program, 0-127. */
export function familyOf(program: number): GmFamily {
	return GM_FAMILIES[Math.min(15, Math.max(0, program >> 3))];
}

/** The stock instrument for each GM program, 0-127. */
// prettier-ignore
export const GM_PROGRAMS: readonly number[] = [
	// Piano: acoustic grand, bright, electric grand, honky-tonk, EP 1, EP 2, harpsichord, clavinet
	9, 9, 9, 9, 13, 13, 5, 13,
	// Chromatic percussion: celesta, glockenspiel, music box, vibraphone, marimba, xylophone, tubular bells, dulcimer
	2, 2, 2, 13, 3, 3, 2, 16,
	// Organ: drawbar, percussive, rock, church, reed, accordion, harmonica, tango accordion
	0, 0, 0, 1, 0, 6, 0, 6,
	// Guitar: nylon, steel, jazz, clean, muted, overdriven, distortion, harmonics
	5, 5, 5, 5, 5, 17, 17, 2,
	// Bass: acoustic, finger, pick, fretless, slap 1, slap 2, synth 1, synth 2
	8, 8, 8, 8, 14, 14, 14, 14,
	// Strings: violin, viola, cello, contrabass, tremolo, pizzicato, harp, timpani
	1, 1, 4, 4, 11, 16, 16, 4,
	// Ensemble: strings 1, strings 2, synth strings 1, synth strings 2, choir aahs, voice oohs, synth voice, orchestra hit
	1, 11, 18, 18, 0, 0, 0, 15,
	// Brass: trumpet, trombone, tuba, muted trumpet, French horn, brass section, synth brass 1, synth brass 2
	6, 6, 6, 6, 6, 6, 6, 6,
	// Reed: soprano, alto, tenor, baritone sax, oboe, English horn, bassoon, clarinet
	6, 6, 6, 6, 0, 0, 4, 0,
	// Pipe: piccolo, flute, recorder, pan flute, blown bottle, shakuhachi, whistle, ocarina
	0, 0, 0, 0, 0, 0, 0, 0,
	// Synth lead: square, sawtooth, calliope, chiff, charang, voice, fifths, bass + lead
	0, 6, 0, 0, 17, 0, 6, 6,
	// Synth pad: new age, warm, polysynth, choir, bowed, metallic, halo, sweep
	13, 1, 1, 1, 1, 13, 1, 1,
	// Synth effects: rain, soundtrack, crystal, atmosphere, brightness, goblins, echoes, sci-fi
	2, 1, 2, 13, 2, 1, 13, 1,
	// Ethnic: sitar, banjo, shamisen, koto, kalimba, bagpipe, fiddle, shanai
	5, 5, 5, 16, 3, 0, 1, 6,
	// Percussive: tinkle bell, agogo, steel drums, woodblock, taiko, melodic tom, synth drum, reverse cymbal
	2, 25, 7, 24, 21, 12, 12, 22,
	// Sound effects: guitar fret noise, breath, seashore, bird tweet, telephone, helicopter, applause, gunshot
	5, 0, 22, 0, 2, 22, 22, 27,
];

/** A drum kit's pieces, split so that hits struck together land on separate channels. */
export type DrumFamily = "kick-snare" | "cymbals" | "percussion";

export interface DrumMatch {
	/** `@21`-`@29`, or `12` for a hand drum played on the bongo at {@link key}. */
	instrument: number;
	family: DrumFamily;
	/** The key the bongo is played at; absent for a stock drum, whose pitch is its own. */
	key?: number;
}

/** What a drum key is played on: a stock drum, or any other instrument at {@link DrumMatch.key}. */
export type DrumSound = Pick<DrumMatch, "instrument" | "key">;

const kick = (instrument: number): DrumMatch => ({ instrument, family: "kick-snare" });
const cymbal = (instrument: number): DrumMatch => ({ instrument, family: "cymbals" });
const perc = (instrument: number): DrumMatch => ({ instrument, family: "percussion" });
const bongo = (key: number): DrumMatch => ({ instrument: 12, family: "percussion", key });

/**
 * GM drum keys to stock drums. GM level 1 names keys 35-81; 27-34 and 82-87 are the GS and GM2
 * additions most files also use. A key with no entry is dropped and counted.
 */
export const GM_DRUMS: ReadonlyMap<number, DrumMatch> = new Map([
	[27, perc(25)], // high Q
	[28, kick(28)], // slap
	[31, perc(25)], // sticks
	[32, perc(25)], // square click
	[33, perc(24)], // metronome click
	[34, cymbal(22)], // metronome bell
	[35, kick(21)], // acoustic bass drum
	[36, kick(21)], // bass drum 1
	[37, kick(28)], // side stick
	[38, kick(27)], // acoustic snare
	[39, kick(28)], // hand clap
	[40, kick(27)], // electric snare
	[41, bongo(43)], // low floor tom
	[42, cymbal(23)], // closed hi-hat
	[43, bongo(46)], // high floor tom
	[44, cymbal(23)], // pedal hi-hat
	[45, bongo(48)], // low tom
	[46, cymbal(22)], // open hi-hat
	[47, bongo(51)], // low-mid tom
	[48, bongo(53)], // hi-mid tom
	[49, cymbal(22)], // crash cymbal 1
	[50, bongo(55)], // high tom
	[51, cymbal(22)], // ride cymbal 1
	[52, cymbal(22)], // Chinese cymbal
	[53, cymbal(22)], // ride bell
	[54, perc(23)], // tambourine
	[55, cymbal(22)], // splash cymbal
	[56, perc(25)], // cowbell
	[57, cymbal(22)], // crash cymbal 2
	[58, perc(23)], // vibraslap
	[59, cymbal(22)], // ride cymbal 2
	[60, bongo(67)], // high bongo
	[61, bongo(62)], // low bongo
	[62, bongo(64)], // mute high conga
	[63, bongo(60)], // open high conga
	[64, bongo(55)], // low conga
	[65, bongo(65)], // high timbale
	[66, bongo(58)], // low timbale
	[67, perc(25)], // high agogo
	[68, perc(24)], // low agogo
	[69, perc(23)], // cabasa
	[70, perc(23)], // maracas
	[73, perc(23)], // short guiro
	[74, perc(23)], // long guiro
	[75, perc(25)], // claves
	[76, perc(25)], // high wood block
	[77, perc(24)], // low wood block
	[78, bongo(70)], // mute cuica
	[79, bongo(63)], // open cuica
	[80, cymbal(22)], // mute triangle
	[81, cymbal(22)], // open triangle
	[82, perc(23)], // shaker
	[83, cymbal(22)], // jingle bell
	[85, perc(25)], // castanets
	[86, bongo(50)], // mute surdo
	[87, bongo(45)], // open surdo
]);
