/**
 * The text of every `SST` diagnostic: findings this tool makes that AddmusicK does not.
 *
 * Keyed by code, then by variant where one code says several things. Each entry is a function so
 * nothing runs `$localize` at import.
 */
export const SST = {
	"0301": (address: string) =>
		$localize`:@@sst.0301:ARAM address 0x${address}:address: is outside the 64 KiB address space.`,
	"0500": (feedback: string) =>
		$localize`:@@sst.0500:The echo feedback at $${feedback}:feedback: and this filter make the echo grow instead of fade, so the song will get loud and distorted. Lower the feedback, or this filter's gain.`,
	"0501": (feedback: string, filter: number) =>
		$localize`:@@sst.0501:The echo feedback at $${feedback}:feedback: and filter ${filter}:filter: make the echo grow instead of fade, so the song will get loud and distorted. Lower the feedback.`,
	"0501.filter-zero": (feedback: string) =>
		$localize`:@@sst.0501.filter-zero:The echo feedback at $${feedback}:feedback: and filter 0 make the echo grow instead of fade, so the song will get loud and distorted. Lower the feedback, or select filter 1.`,
	"0502.one": (channel: string, shortest: number, ticks: number) =>
		$localize`:@@sst.0502.one:${channel}:channel: is longer than the song. It lasts as long as its shortest channel, #${shortest}:shortest: at ${ticks}:ticks: ticks, and everything past that is never played.`,
	"0502.other": (channels: string, shortest: number, ticks: number) =>
		$localize`:@@sst.0502.other:${channels}:channels: are longer than the song. It lasts as long as its shortest channel, #${shortest}:shortest: at ${ticks}:ticks: ticks, and everything past that is never played.`,
	"0503": (percent: number) =>
		$localize`:@@sst.0503:The driver cannot keep up with this song's tempo: it plays about ${percent}:percent:% slower than written. Lower the tempo, or give the busiest channels less to do.`,
	"0504": () =>
		$localize`:@@sst.0504:#path does nothing here, as Solar Soundtrack's sample library is one flat folder. AddmusicK itself still accepts this directive.`,
	"0505": (name: string) =>
		$localize`:@@sst.0505:Replacement "${name}:name:" is expanding without end. A replacement whose value contains its own name, directly or through another replacement, grows the song faster than it is read; AddmusicK does not stop either.`,
	"0506": () =>
		$localize`:@@sst.0506:$F7 was never implemented in this driver: its dispatch slot is $0000, so the SPC jumps to address zero and the song stops. Remove the command.`,
	"0507.nothing": () =>
		$localize`:@@sst.0507.nothing:No note plays before this $DD on the channel, so the $DD runs as a command, jumps to address zero and the song stops. Write it directly after a note of two ticks or more.`,
	"0507.blocked": (command: string) =>
		$localize`:@@sst.0507.blocked:The ${command}:command: written between this $DD and the note before it is what the driver reads instead — the read-ahead only ever looks at the very next byte — so the $DD runs as a command, jumps to address zero and the song stops. Move it to directly after the note.`,
	"0507.note-pieces": (ticks: number) =>
		$localize`:@@sst.0507.note-pieces:The note before this $DD is ${ticks}:ticks: ticks, which the compiler writes in pieces of 96 with one tick left over at the end, and the read-ahead cannot run on the tick a piece begins, so the $DD runs as a command, jumps to address zero and the song stops. Make that note a tick longer or shorter.`,
	"0507.tie-pieces": (ticks: number) =>
		$localize`:@@sst.0507.tie-pieces:The tie before this $DD is ${ticks}:ticks: ticks, which the compiler writes in pieces of 96 with one tick left over at the end, and the read-ahead cannot run on the tick a piece begins, so the $DD runs as a command, jumps to address zero and the song stops. Make that tie a tick longer or shorter.`,
	"0507.note-one-tick": () =>
		$localize`:@@sst.0507.note-one-tick:The note before this $DD lasts one tick, and the read-ahead cannot run on the tick a note begins, so the $DD runs as a command, jumps to address zero and the song stops. Give that note two ticks or more.`,
	"0507.tie-one-tick": () =>
		$localize`:@@sst.0507.tie-one-tick:The tie before this $DD lasts one tick, and the read-ahead cannot run on the tick a tie begins, so the $DD runs as a command, jumps to address zero and the song stops. Give that tie two ticks or more.`,
	"0508": () =>
		$localize`:@@sst.0508:Under #am4, the compiler adds one to this transpose, so it lands a semitone above what is written. Double check to write one less than you want.`,
	"0509": (label: number) =>
		$localize`:@@sst.0509:No remote code (!${label}:label:) is defined above the first channel, so this event runs nothing. AddmusicK compiles it without a word.`,
	"0509.zero": () =>
		$localize`:@@sst.0509.zero:Remote code (!0) can never be called: AddmusicK only records the address of a remote body numbered from 1, so this event runs nothing. Number the body from 1.`,
};
