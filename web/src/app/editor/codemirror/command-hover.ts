import type { Extension } from '@codemirror/state';
import { hoverTooltip } from '@codemirror/view';

import { type Command, type NoteLengthSegment, commandAt } from '@amk/tokens';
import { TICKS_PER_WHOLE } from '@amk/core/hardcoded-tables';
import { hex2 } from '../../util/format';

/** One line of the tooltip, styled by the classes the theme defines. */
function line(className: string, text: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return element;
}

/** `, dotted` / `, double-dotted` — how `letter-params.ts` would say it, extended past two. */
function dotsLabel(dots: number): string {
  switch (dots) {
    case 0:
      return '';
    case 1:
      return $localize`:@@source.hover.dotted:, dotted`;
    case 2:
      return $localize`:@@source.hover.double-dotted:, double-dotted`;
    default:
      return $localize`:@@source.hover.dotted-2:, ${dots}:dots:× dotted`;
  }
}

/** `192/ticks` as `1/N`, when it divides evenly — `null` for a length no whole-note fraction lands on exactly. */
function wholeNoteFraction(ticks: number): string | null {
  return ticks > 0 && TICKS_PER_WHOLE % ticks === 0 ? `1/${TICKS_PER_WHOLE / ticks}` : null;
}

/** Everything between the written length and the played one, in the order the parser applies it. */
function modifiersLabel(segment: NoteLengthSegment): string {
  return `${dotsLabel(segment.dots)}${segment.triplet ? ', triplet' : ''}`;
}

/** One note or rest length segment, in the same "written form (ticks)" vocabulary `letter-params.ts` uses for `l`. */
function segmentLabel(segment: NoteLengthSegment): string {
  const modifiers = modifiersLabel(segment);

  if (segment.implicit) {
    // `l8 c.` dots the standing length, so the fraction stops describing it.
    const fraction = modifiers === '' ? wholeNoteFraction(segment.ticks) : null;
    return fraction
      ? $localize`:@@source.hover.default-length-fraction:default length (${fraction}:fraction:)${modifiers}:modifiers: — ${segment.ticks}:ticks: ticks`
      : $localize`:@@source.hover.default-length:default length${modifiers}:modifiers: — ${segment.ticks}:ticks: ticks`;
  }

  if (segment.exact) {
    return modifiers === ''
      ? $localize`:@@source.hover.ticks-exactly:${segment.written}:written: ticks exactly`
      : $localize`:@@source.hover.ticks-exactly-ticks:${segment.written}:written: ticks exactly${modifiers}:modifiers: (${segment.ticks}:ticks: ticks)`;
  }

  return $localize`:@@source.hover.1-ticks:1/${segment.written}:written:${modifiers}:modifiers: (${segment.ticks}:ticks: ticks)`;
}

/**
 * A note or rest's full duration, ties included — `accumulateTiedLength`
 * (`parser.ts`) plays every segment as one continuous note, which is why
 * a `^`'s tooltip has to say more than "tie".
 */
function noteLengthLine(segments: readonly NoteLengthSegment[]): string {
  if (segments.length === 1) {
    return segmentLabel(segments[0]);
  }

  const total = segments.reduce((sum, segment) => sum + segment.ticks, 0);
  const joined = segments.map(segmentLabel).join(` ${$localize`:@@source.hover.tied-to:tied to`} `);
  return $localize`:@@source.hover.ticks-total:${joined}:segments: — ${total}:total: ticks total`;
}

function renderCommand(command: Command): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cm-amk-hover';

  const label = command.vcmd !== undefined ? `$${hex2(command.vcmd)}` : command.kind;
  const via =
    command.replacement !== undefined
      ? $localize`:@@source.hover.via:via ${command.replacement}:replacement:`
      : '';
  dom.appendChild(
    line('cm-amk-hover-name', [label, command.name, via].filter((part) => part !== '').join(' ')),
  );

  if (command.noteLength) {
    dom.appendChild(line('cm-amk-hover-args', noteLengthLine(command.noteLength)));
    return dom;
  }

  if (command.args.length > 0) {
    // Capped like the generic view: an #am4 `$ED $82` upload can carry a
    // 16-bit count of data bytes, and a tooltip is a glance, not a dump.
    const shown = command.args.slice(0, 16);
    const args =
      command.vcmd !== undefined
        ? shown.map((arg) => `$${hex2(arg.value & 0xff)}`).join(' ')
        : shown.map((arg) => arg.value).join(', ');
    const more = command.args.length - shown.length;
    dom.appendChild(
      line(
        'cm-amk-hover-args',
        more > 0 ? $localize`:@@source.hover.more:${args}:args: … ${more}:more: more` : args,
      ),
    );
  }

  if (!command.complete) {
    dom.appendChild(
      line(
        'cm-amk-hover-incomplete',
        $localize`:@@source.hover.incomplete-expects-more-arguments:incomplete — expects more arguments`,
      ),
    );
  }

  return dom;
}

/**
 * A tooltip naming the command under the pointer, from the same scan the
 * command inspector reads — hover is the quick glance, the panel the full
 * story, and the panel (following the caret) is the keyboard-reachable
 * equivalent of this pointer-only affordance.
 *
 * `commands` is a thunk so each hover reads the current scan; the computed
 * behind it is cached, so this costs a lookup, not a re-tokenize.
 */
export function commandHover(commands: () => Command[]): Extension {
  return hoverTooltip((_view, pos) => {
    const command = commandAt(commands(), pos);
    if (!command) {
      return null;
    }

    return {
      pos: command.span.start,
      end: command.span.end,
      above: true,
      create: () => ({ dom: renderCommand(command) }),
    };
  });
}
