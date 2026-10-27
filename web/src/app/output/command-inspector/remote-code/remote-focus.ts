import type { Span } from '@amk/core/types';
import { TICKS_PER_WHOLE } from '@amk/core/hardcoded-tables';
import type { TokenIndex } from '@amk/tokens';
import type { LoopReading, LoopSpan } from '@amk/tokens/commands/loops';
import type { EnumOption } from '@amk/tokens/commands/param';
import {
  REMOTE_EVENTS,
  type RemoteCall,
  type RemoteConstruct,
  type RemoteEvent,
  type RemoteReset,
  UNKNOWN_EVENT_NOTE,
  bodyCommands,
  remoteBody,
  runsCode,
  takesWait,
} from '@amk/tokens/commands/remote';
import { tempoAt } from '@amk/tokens/dialect';
import { type Edit, spliceRange } from '@amk/tokens/edits';
import type { CommandGlyph } from '../../../editor/command-palette/command-icon';
import { glyphOf } from '../../../editor/command-palette/glyph-of';
import { hex2 } from '../../../util/format';

/** One command the body runs, drawn as the note inspector draws one. */
export interface RemoteChip {
  key: string;
  icon: CommandGlyph;
  label: string;
  blurb: string;
  span: Span;
}

export interface RemoteCallView {
  kind: 'call';
  /** `(!1)`, for the heading. */
  name: string;
  type: number;
  types: readonly EnumOption[];
  /** What the chosen type does. */
  typeNote: string;
  /** What a type no option names reads as. */
  unknownType: string;
  /** Types 1 and 2 only; the tempo is for the readout's seconds. */
  wait: { ticks: number; tempo: number | null } | null;
  chips: readonly RemoteChip[];
  /** Said in place of the chips where nothing is run. */
  runsNothing: string | null;
  construct: RemoteCall;
}

export interface RemoteResetView {
  kind: 'reset';
  name: string;
  which: number;
  options: readonly EnumOption[];
  note: string;
  construct: RemoteReset;
}

export type RemoteView = RemoteCallView | RemoteResetView;

export interface RemoteViewRequest {
  index: TokenIndex;
  loops: LoopReading;
  construct: RemoteConstruct;
}

/** What switching to a type that waits writes, in hex because hex is the exact-ticks spelling. */
export const DEFAULT_WAIT = 24;

const TYPES: readonly EnumOption[] = REMOTE_EVENTS.map((event) => ({
  value: event.type,
  label: `${event.type} — ${event.name}`,
}));

export function remoteView(request: RemoteViewRequest): RemoteView {
  const { construct } = request;
  return construct.kind === 'call' ? callView(request, construct) : resetView(construct);
}

function callView(request: RemoteViewRequest, call: RemoteCall): RemoteCallView {
  const { index, loops } = request;
  // By the byte, which is what `cmdFC` compares: a written 255 is a -1.
  const event = eventFor(call.type);
  const body = remoteBody(loops, call);
  const chips = body === null ? [] : bodyChips(index, body);

  return {
    kind: 'call',
    name: `(!${call.label})`,
    type: call.type,
    types: TYPES,
    typeNote: event?.note ?? UNKNOWN_EVENT_NOTE,
    unknownType: event
      ? `${call.type} — the same byte as ${event.type}, ${event.name}`
      : `${call.type} — no such type`,
    wait: call.wait ? { ticks: call.wait.ticks, tempo: tempoAt(call.from, index.commands) } : null,
    chips,
    runsNothing: runsNothing(call, body !== null, chips.length),
    construct: call,
  };
}

function runsNothing(call: RemoteCall, found: boolean, chips: number): string | null {
  if (!runsCode(call.type)) {
    return `Type ${call.type} runs no code, so the (!${call.label}) it names is not used.`;
  }

  // SST0509's own two sentences (`parser.ts:2509-2518`).
  if (!found) {
    return call.label === 0
      ? 'Remote code (!0) can never be called: AddmusicK only records a remote body numbered from 1, so this runs nothing. Number the body from 1.'
      : `No remote code (!${call.label}) is defined above the first channel, so this runs nothing.`;
  }

  return chips === 0 ? `(!${call.label}) has no commands in it.` : null;
}

function bodyChips(index: TokenIndex, body: LoopSpan): RemoteChip[] {
  return bodyCommands(index, body).flatMap((command, at) => {
    const entry = glyphOf(command);
    return entry === null
      ? []
      : [
          {
            // By position too: every command one replacement expands to shares its span.
            key: `${at}:${command.span.start}`,
            icon: entry.icon,
            label: entry.label,
            blurb: entry.blurb,
            span: command.span,
          },
        ];
  });
}

/**
 * `(!!n)` writes type 0 for 0, 8 for -1 and 7 for anything else
 * (`parser.ts:2393-2398`), so its three choices are those three events.
 */
function resetView(reset: RemoteReset): RemoteResetView {
  const other = reset.which === 0 || reset.which === -1 ? 1 : reset.which;
  const named = (which: number, type: number): EnumOption => ({
    value: which,
    label: `${which} — ${eventFor(type)?.name ?? ''}`,
  });

  return {
    kind: 'reset',
    name: `(!!${reset.which})`,
    which: reset.which,
    options: [named(0, 0), named(-1, 8), named(other, 7)],
    note: eventFor(resetType(reset.which))?.note ?? '',
    construct: reset,
  };
}

function resetType(which: number): number {
  return which === 0 ? 0 : which === -1 ? 8 : 7;
}

function eventFor(type: number): RemoteEvent | undefined {
  return REMOTE_EVENTS.find((event) => (event.type & 0xff) === (type & 0xff));
}

/**
 * A call moved to another type.
 *
 * Only types 1 and 2 read a wait (Music.cpp:1085), so a move onto one of them
 * writes one and a move off takes it out, which would otherwise be AMK0146 or
 * AMK0149. A wait added goes after the same spacing the type was written with.
 */
export function remoteTypeEdit(source: string, call: RemoteCall, type: number): Edit | null {
  if (type === call.type) {
    return null;
  }

  const span = { start: call.typeAt.start, end: call.typeAt.end, line: 1 };
  if (takesWait(type) && call.wait === null) {
    return spliceRange(source, span, `${type},${call.separator}$${hex2(DEFAULT_WAIT)}`);
  }

  if (!takesWait(type) && call.wait !== null) {
    return spliceRange(source, { ...span, end: call.wait.at.end }, String(type));
  }

  return spliceRange(source, span, String(type));
}

/**
 * A call's wait, in the spelling it was written in: `$hh` stays hex, with 256 as
 * `$00`; a length stays a length, as a denominator where one is exact and as an
 * `=` count where none is.
 */
export function remoteWaitEdit(source: string, call: RemoteCall, ticks: number): Edit | null {
  const wait = call.wait;
  const clamped = Math.min(0x100, Math.max(1, Math.round(ticks)));
  if (wait === null || clamped === wait.ticks) {
    return null;
  }

  const text = wait.hex
    ? `$${hex2(clamped & 0xff)}`
    : TICKS_PER_WHOLE % clamped === 0
      ? String(TICKS_PER_WHOLE / clamped)
      : `=${clamped}`;

  return spliceRange(source, { start: wait.at.start, end: wait.at.end, line: 1 }, text);
}

export function remoteResetEdit(source: string, reset: RemoteReset, which: number): Edit | null {
  return spliceRange(
    source,
    { start: reset.whichAt.start, end: reset.whichAt.end, line: 1 },
    String(which),
  );
}
