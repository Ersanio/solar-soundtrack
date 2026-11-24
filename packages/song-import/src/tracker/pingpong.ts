/**
 * A ping-pong loop laid out as a forward one: the loop, then the loop backwards, since a BRR loop only
 * runs forward. The turn's end frames are not doubled, as a tracker plays each once.
 */

/** `pcm` with its ping-pong loop laid out forward, and the loop that now runs to its end. */
export function unrollPingPong(
	pcm: Int16Array,
	loopStart: number,
	loopLength: number,
): { pcm: Int16Array; loopStart: number; loopLength: number } {
	if (loopLength < 3) {
		return { pcm: pcm.slice(0, loopStart + loopLength), loopStart, loopLength };
	}

	const end = loopStart + loopLength;
	const back = pcm.slice(loopStart + 1, end - 1).reverse();
	const out = new Int16Array(end + back.length);
	out.set(pcm.subarray(0, end));
	out.set(back, end);
	return { pcm: out, loopStart, loopLength: loopLength * 2 - 2 };
}
