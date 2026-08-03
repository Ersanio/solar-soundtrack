import type { Command } from '@compiler/tokens';
import type { Diagnostic } from '@core/types';
import { FIR_PRESETS, FIR_TAPS, type FirTaps, echoStability, toSigned } from '@spc/fir';
import { hex2 } from './format';

/**
 * Diagnostics for an echo that compounds instead of decaying.
 *
 * The FIR sits inside the echo's feedback loop, so repeat *k* comes back at `(EFB/128 · |H(f)|)^k`
 * — and once that reaches 1 the echo builds on itself for as long as the song plays. `spc/fir.ts`
 * has known how to spot this for a while, but only the FIR designer asked it, and only about the
 * `$F5` under the caret. A song that was pasted in whole, restored from the last session, or is
 * simply being edited somewhere else said nothing at all.
 *
 * So the same verdict is computed here over the whole document and reported as a diagnostic. Two
 * things follow from that, and both are deliberate:
 *
 * - It runs on {@link Command}s from `tokens.ts`, not on compiler output. `$F5` is invisible to
 *   this compiler and to AddmusicK — `Music.cpp` has no `$F5` code at all, only the length table
 *   entry at `Music.cpp:63`, so every instance is copied through verbatim and nothing upstream has
 *   an opinion to report.
 * - It therefore has no AddmusicK counterpart, which is why these carry their own `AMK05xx` range
 *   rather than extending the parser's.
 */

/** Runaway echo through custom `$F5` coefficients. */
const CODE_FIR = 'AMK0500';

/** Runaway echo through one of `$F1`'s two built-in tables. */
const CODE_BUILT_IN = 'AMK0501';

/**
 * The coefficients `$F1`'s third argument loads, or `null` for anything else.
 *
 * `main.asm:3507` — filter 0 is Super Mario World's low-pass, filter 1 is flat, and they are the
 * only two that exist. A higher ID reads past the end of the table, so there is no honest answer
 * for it; the parser already reports that as `AMK0158`/`AMK0212` and nothing here should guess.
 */
export function builtInTaps(which: number): FirTaps | null {
  if (which !== 0 && which !== 1) {
    return null;
  }

  return (
    FIR_PRESETS.find((preset) => preset.name === (which === 0 ? 'Classic' : 'Flat'))?.taps ?? null
  );
}

/**
 * The echo feedback in effect where `command` sits — the nearest preceding `$F1`'s second argument.
 *
 * `0` when there is none, which is also the answer that disables every runaway check below: no
 * feedback, no loop, nothing to compound. Same channel only, for the reason given on
 * {@link echoHazards}.
 */
export function feedbackBefore(command: Command, commands: readonly Command[]): number {
  let found = 0;
  for (const other of commands) {
    if (other.span.start >= command.span.start) {
      break;
    }

    if (other.channel !== command.channel) {
      continue;
    }

    if (other.vcmd === 0xf1 && other.args.length >= 2) {
      found = other.args[1].value;
    }
  }

  return found;
}

/** What the echo is running on at some point in a channel. */
interface EchoState {
  taps: FirTaps | null;
  feedback: number;
}

/**
 * Every runaway echo in the document, one diagnostic per command that causes one.
 *
 * The walk carries `{ taps, feedback }` per channel and judges each command as it applies it, which
 * is what makes repeats come out right without a special case for them: a second `$F5` is measured
 * against the feedback *its* channel is running at by then, and a `$F1` is measured against the
 * built-in table it reloads. A `$F5` that a later `$F1` overrides is still reported — it really
 * does run until that `$F1` executes. AddmusicK emits all of them in order and says nothing about
 * any of it.
 *
 * **Per channel, because source order is only execution order within one.** Across channels the
 * driver interleaves by time, so "later in the file" would mean nothing — the same rule
 * `fir-override.ts` states and enforces. The cost is real: the DSP has a single echo unit, so a
 * `$F1` in `#0` and a `$F5` in `#1` do interact, and that pairing is missed here. Reaching across
 * channels would be guesswork, and a diagnostic that contradicted the FIR designer sitting next to
 * it would be worse than the gap.
 *
 * Not modelled, equally deliberately: `$EF`'s echo volume, `$F0` and `$F2`. Whether the loop
 * diverges is a property of the loop, not of how loudly it is being monitored, and
 * `echoStability()` is defined on exactly the two values tracked here.
 */
export function echoHazards(commands: readonly Command[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const states = new Map<number, EchoState>();

  for (const command of commands) {
    // Half-typed is not yet wrong: judging a `$F5` on the three bytes written so far would flash a
    // warning through the middle of writing a perfectly good one.
    if (!command.complete) {
      continue;
    }

    if (command.vcmd !== 0xf1 && command.vcmd !== 0xf5) {
      continue;
    }

    const key = command.channel ?? -1;
    const state = states.get(key) ?? { taps: null, feedback: 0 };
    states.set(key, state);

    if (command.vcmd === 0xf1) {
      state.feedback = command.args[1].value;
      state.taps = builtInTaps(command.args[2].value);
    } else {
      state.taps = Array.from({ length: FIR_TAPS }, (_, i) => toSigned(command.args[i].value));
    }

    if (!state.taps || !echoStability(state.taps, state.feedback).runaway) {
      continue;
    }

    diagnostics.push({
      severity: 'severe',
      code: command.vcmd === 0xf1 ? CODE_BUILT_IN : CODE_FIR,
      message: describe(command, state.feedback),
      span: { ...command.span },
    });
  }

  return diagnostics;
}

/**
 * Cause, effect, and the way out, in one line.
 *
 * Says what the song will do and nothing more. There is no reason to describe how bad it can get,
 * and every reason not to make it sound worth hearing.
 */
function describe(command: Command, feedback: number): string {
  const effect = `make the echo grow instead of fade, so the song will get loud and distorted.`;

  if (command.vcmd === 0xf1) {
    const which = command.args[2].value;
    // Filter 1 is flat and peaks below unity, so it cannot be the one at fault; only filter 0 ever
    // reaches here, and swapping to the other one is a fix on its own.
    const fix = which === 0 ? ' Lower the feedback, or select filter 1.' : ' Lower the feedback.';
    return `The echo feedback at $${hex2(feedback)} and filter ${which} ${effect}${fix}`;
  }

  return (
    `The echo feedback at $${hex2(feedback)} and this filter ${effect}` +
    ` Lower the feedback, or this filter's gain.`
  );
}
