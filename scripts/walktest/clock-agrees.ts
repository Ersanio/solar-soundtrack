/** `walktest`: the clock and the compiler agree about the songs the compiler can time. */

import "../localize";
import { songClock } from "../../web/src/app/state/song-clock";
import { check } from "../harness";
import { build } from "./support";
import { CORPUS } from "./song-length";

// ---------------------------------------------------------------------------
console.log("\nthe clock and the compiler agree about the songs the compiler can time");
// ---------------------------------------------------------------------------
{
	// The clock is the only thing that can time a faded song, so nothing can
	// check it against the compiler there. What *can* be checked is that it
	// retimes no ordinary song relative to `stats.playback` — and where it does,
	// that the size of the difference is named rather than discovered later.
	//
	// This needs the compiler for `stats`, the walk for the ticks and the app for
	// the arithmetic that makes them comparable, which is why it is here: no
	// package can reach all three, and `charttest` has no compiler.
	for (const song of CORPUS) {
		const { result, timeline } = build(song.source);
		const played = result.stats?.playback;
		const clock = songClock(timeline);
		if (!played || !clock) {
			check(`${song.name}: has both a length and a clock`, false);
			continue;
		}

		const stated = played.introSeconds + played.mainSeconds;
		const setsTempo = timeline.tempoChanges.some((change) => change.tick === 0 && change.fadeTicks === 0);
		if (setsTempo) {
			check(
				`${song.name}: the clock reads exactly what the compiler does`,
				Math.abs(clock.seconds - stated) < 1e-9,
				`clock ${clock.seconds.toFixed(6)}, stats ${stated.toFixed(6)}`,
			);
			continue;
		}

		// A song with no `t` differs by exactly 55/54, and the ratio is the
		// assertion. `estimateSeconds` unshifts `[0, 0x36]` (`parser.ts:3508`) and
		// reads `0x36` as an MML byte, adding one to get driver 55; `main.asm:177`
		// puts `#$36` into `$51` itself, which is driver 54, and that is what
		// `DEFAULT_TEMPO` says. The clock reads ~1.85% longer and is right —
		// commit a512e25 already ruled on this. Pinning the ratio means the next
		// person to touch either side sees the divergence rather than finding a
		// retimed editor.
		check(
			`${song.name}: with no t of its own it is the driver's t53, not AddmusicK's t54`,
			Math.abs(clock.seconds / stated - 55 / 54) < 1e-9,
			`clock ${clock.seconds.toFixed(6)}, stats ${stated.toFixed(6)}`,
		);
	}
}
