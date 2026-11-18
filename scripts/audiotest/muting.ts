/**
 * `audiotest`: muting happens in the DSP and nowhere else — the driver never sees
 * it, nothing the song writes undoes it, and the mix, the song's speed, a ringing
 * note and unmuting all behave.
 */

import "../localize";
import { compiler } from "@amk/compiler";
import { SPC_CHANNELS, SPC_SAMPLE_RATE } from "@amk/spc/wasm-host";
import { createTickPhase, readDriverState, sawTick, seedTickPhase, tickVoice } from "@amk/spc/driver-state";
import { check, section } from "../harness";
import { peak, rms, driver, OPTIONS, compileToSpc, BLOCK, renderMuted, emu } from "./support";

section("muting leaves the driver alone");
{
	// The driver's whole state is APU RAM, so a mute it cannot see leaves every
	// byte of it as an unmuted run does: `$5E`, which a song can set through
	// `$F4 $06`, every track volume and velocity, every pointer and counter. No
	// echo here, since the echo buffer is the one thing in APU RAM the DSP writes.
	const spc = compileToSpc(`#amk 4
#0 t60 o4 v220 q7F @0 l8 [c d e f g4 e4]4
#1 o3 v200 q7D @1 l4 $E8 $C0 $40 [c e g e]4
`);
	const after = (mask: number): Uint8Array => {
		renderMuted(spc, 0, 64000, () => mask);
		return emu.aram().slice();
	};

	const open = after(0);
	for (const [label, mask] of [
		["one channel", 0b10],
		["both", 0b11],
	] as const) {
		const muted = after(mask);
		const differs = muted.findIndex((value, at) => value !== open[at]);
		check(
			`muting ${label} leaves APU RAM byte for byte as unmuted`,
			differs < 0,
			`$${differs.toString(16)}: ${muted[differs]} muted vs ${open[differs]} open`,
		);
	}
}

section("nothing the song writes undoes a mute");
{
	// A channel the driver rewrites the volume of on every tick: an `$E8` fade
	// over the whole pass, and a `v` and a `q` at the head of each one. Muting
	// that from the driver's side loses to it — the fade steps the very register a
	// mute would hold at zero, and wraps it round to nearly full — so the mute has
	// to be where the driver cannot reach.
	const spc = compileToSpc(`#amk 4
#option amk109hotpatch

t20
#0 @0 y8 v160
o4
(31)[v140 $e8 $18 $18 l192 q7f [[o3b>c+<b>c+dedeo3b>c+<b>c+]]2]4
`);
	const open = renderMuted(spc, 32000, 96000, () => 0);
	const muted = renderMuted(spc, 32000, 96000, () => 1);
	check("the channel is audible to begin with", peak(open) > 0.02, `peak ${peak(open).toFixed(4)}`);
	check("and muted it is silent, fade and all", peak(muted) < 0.002, `peak ${peak(muted).toFixed(4)}`);

	// The fade runs on underneath exactly as it does unmuted, so lifting the mute
	// part way through one comes back at the level the song has there.
	const lifted = renderMuted(spc, 32000, 96000, (frame) => (frame < 64000 ? 1 : 0));
	const tail = (samples: Int16Array) => samples.subarray(32000 * SPC_CHANNELS);
	check(
		"and lifting it mid-fade comes back at the song's own level",
		Math.abs(rms(tail(lifted)) - rms(tail(open))) < rms(tail(open)) * 0.01,
		`${rms(tail(lifted)).toFixed(5)} vs ${rms(tail(open)).toFixed(5)}`,
	);
}

section("muting a channel takes it out of the mix");
{
	// Two clearly different parts, so muting either one is audible in the level
	// rather than just in the bytes.
	const source = `#amk 4
#0 t40 o4 v220 q7F @0 l8 c d e f g4 e4 c4 r4
#1 o3 v200 q7D @1 l4 [c e g e]4
`;
	const spc = compileToSpc(source);
	const render = (mask: number): Int16Array => renderMuted(spc, 4000, 32000, () => mask);

	const both = render(0b00);
	const noSecond = render(0b10);
	const noFirst = render(0b01);
	const neither = render(0b11);

	check(
		"muting one channel lowers the level",
		rms(noSecond) < rms(both),
		`${rms(noSecond).toFixed(5)} vs ${rms(both).toFixed(5)}`,
	);
	check(
		"muting the other channel also lowers it",
		rms(noFirst) < rms(both),
		`${rms(noFirst).toFixed(5)} vs ${rms(both).toFixed(5)}`,
	);
	check(
		"each channel is still audible alone",
		peak(noSecond) > 0.01 && peak(noFirst) > 0.01,
		`${peak(noSecond).toFixed(3)} / ${peak(noFirst).toFixed(3)}`,
	);
	check("muting either leaves a different mix", rms(noFirst).toFixed(6) !== rms(noSecond).toFixed(6));
	check("muting every used channel is silent", peak(neither) < 0.01, `peak ${peak(neither).toFixed(4)}`);

	// Muting must not disturb the song it was derived from.
	check("an unmuted render is unchanged", rms(render(0b00)).toFixed(6) === rms(both).toFixed(6));
}

section("a muted channel goes on carrying the song");
{
	// The whole point of muting in the DSP rather than by blanking the channel's
	// pointer. Everything song-global here lives in `#0`: the tempo, and the `/`
	// that says where the intro ends. `#0` is also the shortest channel, and the
	// driver turns the song over when its *first* channel runs out of data — so a
	// `#0` that stopped being read would move the loop point as well as losing the
	// tempo.
	const source = `#amk 4
#0 t192 v200 @0 o4 q7F a1 / g1
#1 v180 @1 o3 q7F c1 d1 e1
`;
	const stats = compiler.compile({ source, aramAddress: driver.manifest.localPos, options: OPTIONS }).stats!;
	const spc = compileToSpc(source);
	// Every pass after the first is the loop on its own — the intro is played
	// once — so that is the gap between turnovers.
	const expected = stats.loopTicks;

	/** Ticks counted and loop turnovers seen over `seconds`, with `mask` held. */
	function follow(mask: number, seconds: number) {
		emu.loadSpc(spc);
		emu.muteVoices(mask);

		// Let the song key on, so the count runs at the song's own tempo.
		for (let done = 0; done < SPC_SAMPLE_RATE / 20; done += BLOCK) {
			emu.renderView(BLOCK);
		}

		const tick = createTickPhase();
		seedTickPhase(tick, emu.aram());
		let pointer = readDriverState(emu.aram()).trackPointers[0];
		let ticks = 0;
		const passes: number[] = [];
		let pending = -1;
		let before = 0;

		for (let frame = 0; frame < SPC_SAMPLE_RATE * seconds; frame += BLOCK) {
			emu.renderView(BLOCK);
			const aram = emu.aram();

			ticks += sawTick(tick, aram);

			// A 16-bit pointer read from outside the emulator can be caught
			// half-written; a real jump is still there on the next look.
			const next = readDriverState(aram).trackPointers[0];
			if (pending >= 0) {
				if (next < before) {
					passes.push(pending);
				}

				pending = -1;
			} else if (next < pointer) {
				pending = ticks;
				before = pointer;
			}

			pointer = next;
		}

		return { ticks, passes };
	}

	const seconds = 24;
	const open = follow(0b00, seconds);
	const muted = follow(0b01, seconds);
	const gaps = (passes: number[]) => passes.slice(1).map((v, i) => v - passes[i]);
	const median = (values: number[]): number => [...values].sort((a, b) => a - b)[values.length >> 1];

	const openGap = median(gaps(open.passes));
	const mutedGap = median(gaps(muted.passes));

	check(
		`the song turns over every ${expected} ticks, as the compiler says`,
		gaps(open.passes).length >= 2 && Math.abs(openGap - expected) <= 1,
		`${gaps(open.passes).length} passes, median ${openGap}`,
	);
	check(
		"and muting the channel that carries the `/` does not move that",
		gaps(muted.passes).length >= 2 && mutedGap === openGap,
		`${mutedGap} muted vs ${openGap} open`,
	);
	// If `t192` had gone with the channel the driver would fall back to its own
	// tempo and the count would be out by a factor. It is not out at all: the
	// driver never sees the mute, so the song runs at exactly the rate it does
	// unmuted.
	check(
		"and it still sets the tempo it declares",
		muted.ticks === open.ticks,
		`${muted.ticks} ticks muted vs ${open.ticks} open, over ${seconds}s`,
	);
	// The channel really was silent for all of that.
	check(
		"while making no sound",
		peak(renderMuted(spc, 4000, 32000, () => 0b11)) < 0.01,
		`peak ${peak(renderMuted(spc, 4000, 32000, () => 0b11)).toFixed(4)}`,
	);
}

section("muting does not change how fast the song plays");
{
	// The reason the mixer leaves `$5E` alone. The driver's main loop handles at
	// most one music tick per pass, so a song already at that ceiling gets *more*
	// ticks a second the less work each one costs — and disabling a channel is
	// exactly that. Writing `$5E` made this song play 29% fast with every voice
	// muted, which is a monitoring aid lying about the music.
	//
	// Eight busy channels at t254, which asks for 498 ticks a second and gets
	// around 230. An easy song shows none of this, so it has to be a hard one.
	const source =
		"#amk 4\n" +
		[0, 1, 2, 3, 4, 5, 6, 7].map((ch) => `#${ch} ${ch === 0 ? "t254 " : ""}@6 o4 [c16d16e16f16]40\n`).join("");
	const spc = compileToSpc(source);

	/** Ticks the driver manages over `seconds`, with `mask` held throughout. */
	function rate(mask: number, seconds: number): number {
		emu.loadSpc(spc);
		emu.muteVoices(mask);
		let voice = -1;
		const tick = createTickPhase();
		let ticks = 0;

		for (let done = 0; done < SPC_SAMPLE_RATE * seconds; done += BLOCK) {
			emu.renderView(BLOCK);
			const aram = emu.aram();

			if (voice < 0) {
				voice = tickVoice(aram);
				seedTickPhase(tick, aram);
				continue;
			}

			ticks += sawTick(tick, aram);
		}

		return ticks / seconds;
	}

	const seconds = 6;
	const open = rate(0b0000_0000, seconds);
	check("the song is one the driver cannot keep up with", open < 400, `${open.toFixed(1)} ticks/s of 498`);

	for (const [label, mask] of [
		["one channel", 0b1000_0000],
		["half of them", 0b0000_1111],
		["all eight", 0b1111_1111],
	] as const) {
		const muted = rate(mask, seconds);
		check(
			`muting ${label} leaves the rate alone`,
			Math.abs(muted / open - 1) < 0.01,
			`${muted.toFixed(1)} vs ${open.toFixed(1)} ticks/s`,
		);
	}
}

section("muting cuts a note that is already ringing");
{
	// `$5E` alone only stops the *next* note. One very long note, muted a third
	// of the way in, so anything still audible afterwards is the ringing note the
	// mute failed to cut.
	const source = "#amk 4\n#0 t20 v220 @0 o4 q7F c1\n";
	const spc = compileToSpc(source);

	const warmup = 32000; // 1s in, well inside the note
	const frames = 32000;
	const cutAt = warmup + 3200; // 100 ms into the measured window

	const open = renderMuted(spc, warmup, frames, () => 0);
	const cut = renderMuted(spc, warmup, frames, (frame) => (frame >= cutAt ? 0b1 : 0));

	// Measured from 100 ms past the cut, which the mask lands after the block of.
	const after = (samples: Int16Array) => samples.subarray((3200 + 3200) * SPC_CHANNELS);

	check("the note is ringing to begin with", peak(after(open)) > 0.02, `peak ${peak(after(open)).toFixed(4)}`);
	check("and the mute silences it", peak(after(cut)) < 0.002, `peak ${peak(after(cut)).toFixed(4)}`);
	check(
		"without touching what came before",
		rms(cut.subarray(0, 3200 * SPC_CHANNELS)) === rms(open.subarray(0, 3200 * SPC_CHANNELS)),
	);

	// Lifted again while the note still has seconds to run: the DSP kept its
	// envelope going under the mute, so it comes back mid-note, at the level the
	// unmuted note has there, with no key-on to bring it.
	const lift = cutAt + 9600;
	const back = renderMuted(spc, warmup, frames, (frame) => (frame >= cutAt && frame < lift ? 0b1 : 0));
	const tail = (samples: Int16Array) => samples.subarray((lift - warmup + 3200) * SPC_CHANNELS);
	check("lifted mid-note, the note comes back", peak(tail(back)) > 0.02, `peak ${peak(tail(back)).toFixed(4)}`);
	check(
		"at the level it has unmuted",
		Math.abs(rms(tail(back)) - rms(tail(open))) < rms(tail(open)) * 0.01,
		`${rms(tail(back)).toFixed(5)} vs ${rms(tail(open)).toFixed(5)}`,
	);
}

section("unmuting gives the channel its volume back");
{
	const source = "#amk 4\n#0 t60 v220 @0 o4 q7D l8 [c d e f]8\n";
	const spc = compileToSpc(source);

	const warmup = 32000;
	const frames = 96000;
	const lift = warmup + 32000;

	const open = renderMuted(spc, warmup, frames, () => 0);
	const restored = renderMuted(spc, warmup, frames, (frame) => (frame < lift ? 0b1 : 0));
	// The emulator is left where the last render finished, so the register can be
	// read straight out of it.
	const volume = emu.aram()[0x0241];

	const tail = (samples: Int16Array) => samples.subarray(64000 * SPC_CHANNELS);

	check("the song's own track volume was never taken", volume === 220, `$0241 = ${volume}`);
	check("the channel is audible again", peak(tail(restored)) > 0.02, `peak ${peak(tail(restored)).toFixed(4)}`);
	check(
		"and at the level it had",
		Math.abs(rms(tail(restored)) - rms(tail(open))) < rms(tail(open)) * 0.1,
		`${rms(tail(restored)).toFixed(5)} vs ${rms(tail(open)).toFixed(5)}`,
	);
}
