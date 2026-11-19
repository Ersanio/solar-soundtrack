/** `fixtest`: an arpeggio's count written as the notes there are, which clears AddmusicK's own errors with it, and left alone where no one count fits. */

import { check, section } from "../harness";
import { codes, expectFix, expectNoFix } from "./support";

/** The errors AddmusicK raises on the same song, which the fix has to clear as well. */
const REFUSED = ["AMK0151", "AMK0152", "AMK0155"];

function expectCounted(name: string, written: string, fixed: string): void {
	const song = (body: string): string => `#amk 4\n#0 @0 o4 ${body} d4`;
	const after = expectFix(name, song(written), "SST0518", song(fixed));
	if (after !== null) {
		const left = codes(after).filter((code) => REFUSED.includes(code));
		check(`${name}: AddmusicK's errors are gone`, left.length === 0, left.join(", "));
	}
}

section("an $FB count is rewritten to the notes written after it");
expectCounted("one note short", "$FB $03 $06 $00 $04 c4", "$FB $02 $06 $00 $04 c4");
expectCounted("one note short, then a bar line", "$FB $03 $06 $00 $04 | c4", "$FB $02 $06 $00 $04 | c4");
expectCounted("one note over", "$FB $02 $06 $00 $04 $07 c4", "$FB $03 $06 $00 $04 $07 c4");
expectCounted("two notes over", "$FB $02 $06 $00 $04 $07 $0C c4", "$FB $04 $06 $00 $04 $07 $0C c4");
expectCounted("an $FF over", "$FB $02 $06 $00 $04 $FF c4", "$FB $03 $06 $00 $04 $FF c4");

section("an $FB count is left alone where no one count fits, or it is not written in the text");
// Count 1 and a tempo, or count 3 with a step of -25: both readings are there to be had.
expectNoFix("a counted $E7 the byte over completes", "#amk 4\n#0 @0 o4 $FB $02 $06 $00 $E7 $80 c4", "SST0518");
// A count of 0 is Off.
expectNoFix("no notes written", "#amk 4\n#0 @0 o4 $FB $02 $06 c4", "SST0518");
// A loop point in the last slot sends the driver past the end of the sequence.
expectNoFix("counting the notes ends on a loop point", "#amk 4\n#0 @0 o4 $FB $02 $06 $00 $04 $80 c4", "SST0518");
expectNoFix("through a replacement", '#amk 4\n"arp=$FB $02"\n#0 @0 o4 arp $06 $00 $04 $07 c4', "SST0518");
