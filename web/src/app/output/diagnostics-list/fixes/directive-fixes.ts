/**
 * Fixes to the song's directives: a redundant one deleted, a misplaced one moved above the
 * channels, the target marker written or switched, `#pad` grown and `#spc` text cut to length.
 */

import { VCMD } from '@amk/core/hardcoded-tables';
import { hex } from '@amk/core/hex';
import type { Token } from '@amk/tokens';
import { insertAt, spliceRange } from '@amk/tokens/edits';
import type { CompiledSong, Fix, FixRequest } from './fixes';
import {
  blockAfter,
  directives,
  eolOf,
  firstChannelMarker,
  insertLineBefore,
  makeFix,
  quoted,
  removeLine,
  restOfLine,
  textOf,
  tokenBefore,
} from './fix-text';

/** ID666's field width, `AddmusicKParser.TAG_LIMIT` (`parser.ts:1512`). */
const TAG_LIMIT = 32;

/** The `#spc` fields `truncateTag` cuts (`parser.ts:1512`). */
const TAG_FIELDS = new Set(['#title', '#game', '#author', '#comment']);

/** The marker AddmusicK asks for, and the one the scanner already assumes (`DEFAULT_TARGET`). */
const CURRENT_TARGET = '#amk 4';

/** What each dialect's non-native warning suggests instead (`amk.0205.transpose`, `amk.0207.*`). */
const SUGGESTED_TARGET: Readonly<Record<string, string>> = { '#am4': '#amm', '#amm': '#amk 1' };

function removeDirective(song: CompiledSong, start: number, end: number): Fix {
  const removed = song.text.slice(start, end).replace(/\s+/g, ' ').trim();
  return makeFix(
    song.text,
    $localize`:@@output.fix.remove-directive:output.fix.remove-directive ${removed}:directive:`,
    [removeLine(song.text, { start, end, line: 0 })],
  );
}

/** An `#option smwvtable` above `offset`, which makes a later N-SPC request mean something. */
function smwTableBefore(song: CompiledSong, offset: number): boolean {
  return directives(song.index, song.text, 'smwvtable').some((token) => token.start < offset);
}

/** The `#option` whose argument the diagnostic's span covers (`parser.ts:963`). */
function optionAt(song: CompiledSong, offset: number): Token | null {
  const token = tokenBefore(song.index, offset, 'directive');
  return token !== null && token.end === offset && textOf(song.text, token) === '#option'
    ? token
    : null;
}

/** AMK0202, AMK0203, AMK0214: the `#option` and its argument. AMK0204: `#louder`. */
function redundant({ diagnostic, context }: FixRequest): Fix[] {
  const song = context.compiled;
  if (song === null) {
    return [];
  }

  const { span } = diagnostic;
  if (diagnostic.code === 'AMK0204') {
    if (textOf(song.text, span) !== '#louder' || smwTableBefore(song, span.start)) {
      return [];
    }

    return [removeDirective(song, span.start, span.end)];
  }

  const option = optionAt(song, span.start);
  if (option === null || (diagnostic.code === 'AMK0202' && smwTableBefore(song, option.start))) {
    return [];
  }

  return [removeDirective(song, option.start, span.end)];
}

/** AMK0040, AMK0041: the directive moved onto its own line above the first channel. */
function misplaced({ diagnostic, context }: FixRequest): Fix[] {
  const song = context.compiled;
  const directive = song && tokenBefore(song.index, diagnostic.span.start, 'directive');
  const marker = song && firstChannelMarker(song.index, song.text);
  if (!song || !directive || !marker || directive.start < marker.start) {
    return [];
  }

  const word = textOf(song.text, directive);
  if (word !== (diagnostic.code === 'AMK0040' ? '#halvetempo' : '#option')) {
    return [];
  }

  let end = directive.end;
  if (word === '#option') {
    for (const token of restOfLine(song.index, directive)) {
      if (token.kind !== 'directive' && token.kind !== 'number' && token.kind !== 'hexArg') {
        break;
      }

      end = token.end;
    }
  }

  const moved = song.text.slice(directive.start, end);
  return [
    makeFix(
      song.text,
      $localize`:@@output.fix.move-directive:output.fix.move-directive ${moved}:directive:`,
      [
        insertLineBefore(song.text, marker.start, moved),
        removeLine(song.text, { start: directive.start, end, line: 0 }),
      ],
    ),
  ];
}

/** AMK0002: `#amk 4` on a line of its own at the top, after a byte-order mark. */
function missingTarget({ context }: FixRequest): Fix[] {
  const song = context.compiled;
  if (song === null) {
    return [];
  }

  const at = song.text.startsWith('﻿') ? 1 : 0;
  return [
    makeFix(
      song.text,
      $localize`:@@output.fix.insert-target:output.fix.insert-target ${CURRENT_TARGET}:marker:`,
      [insertAt(at, `${CURRENT_TARGET}${eolOf(song.text)}`)],
    ),
  ];
}

/** Every `#amk`, `#am4` and `#amm` in the song. */
function targetMarkers(song: CompiledSong): Token[] {
  return song.index.tokens.filter(
    (token) =>
      token.kind === 'directive' && ['#amk', '#am4', '#amm'].includes(textOf(song.text, token)),
  );
}

/** AMK0205 (`h` under `#am4`), AMK0207: the one target marker switched to the one suggested. */
function switchTarget(song: CompiledSong, wanted: string | null): Fix[] {
  const markers = targetMarkers(song);
  if (markers.length !== 1) {
    return [];
  }

  const [marker] = markers;
  const from = textOf(song.text, marker);
  const to = SUGGESTED_TARGET[from] as string | undefined;
  if (to === undefined || (wanted !== null && from !== wanted)) {
    return [];
  }

  // AddmusicM's `$FA` is refused outright (AMK0156, `parser.ts:2988`), so `#amm` cannot be what
  // a song holding one meant.
  if (to === '#amm' && song.index.commands.some((command) => command.vcmd === VCMD.Settings)) {
    return [];
  }

  return [
    makeFix(
      song.text,
      $localize`:@@output.fix.switch-target:output.fix.switch-target ${from}:from: ${to}:to:`,
      [spliceRange(song.text, marker, to)],
    ),
  ];
}

/**
 * A `#spc` string's value cut to {@link TAG_LIMIT} characters, or `null` where it fits or holds a
 * `\"`. The parser reads that as one character (`parser.ts:getQuotedString`), but `preprocess`
 * reads every `"` as a delimiter (`preprocess.ts:145`), so a cut keeping an odd number of them
 * would leave a string AddmusicK never closes.
 */
function truncated(raw: string): string | null {
  return raw.includes('\\"') || raw.length <= TAG_LIMIT ? null : raw.slice(0, TAG_LIMIT);
}

/** AMK0205 (truncated): every over-long text in the `#spc` block the span covers. */
function longTags(song: CompiledSong, spc: Token): Fix[] {
  const block = blockAfter(song.index, song.text, spc);
  if (block === null) {
    return [];
  }

  const inside = song.index.tokens.filter(
    (token) => token.start > block.open.start && token.end <= block.close.start,
  );
  const edits = inside.flatMap((token, i) => {
    const value = inside[i + 1];
    if (!TAG_FIELDS.has(textOf(song.text, token)) || value?.kind !== 'string') {
      return [];
    }

    const cut = truncated(quoted(song.text, value));
    return cut === null ? [] : [spliceRange(song.text, value, `"${cut}"`)];
  });

  return [
    makeFix(song.text, $localize`:@@output.fix.truncate-tags:output.fix.truncate-tags`, edits),
  ];
}

/** AMK0205 is two findings under one code: a `#spc` text cut short, or `h` under `#am4`. */
function amk0205({ diagnostic, context }: FixRequest): Fix[] {
  const song = context.compiled;
  if (song === null) {
    return [];
  }

  const spc = tokenBefore(song.index, diagnostic.span.start, 'directive');
  if (spc !== null && spc.end === diagnostic.span.start && textOf(song.text, spc) === '#spc') {
    return longTags(song, spc);
  }

  return switchTarget(song, '#am4');
}

/** AMK0213: `#pad`'s size raised to the song's, in as many digits as it was written with. */
function growPad({ context }: FixRequest): Fix[] {
  const song = context.compiled;
  const size = song?.result.stats?.totalSize;
  if (!song || size === undefined) {
    return [];
  }

  const pad = directives(song.index, song.text, '#pad');
  const value = pad.length === 1 ? restOfLine(song.index, pad[0])[0] : undefined;
  if (value?.kind !== 'hexArg') {
    return [];
  }

  const written = textOf(song.text, value);
  const text = `$${hex(size).padStart(written.length - 1, '0')}`;
  return [
    makeFix(song.text, $localize`:@@output.fix.grow-pad:output.fix.grow-pad ${text}:size:`, [
      spliceRange(song.text, value, text),
    ]),
  ];
}

export const directiveFixes = {
  codes: new Set([
    'AMK0002',
    'AMK0040',
    'AMK0041',
    'AMK0202',
    'AMK0203',
    'AMK0204',
    'AMK0205',
    'AMK0207',
    'AMK0213',
    'AMK0214',
  ]),
  fixes(request: FixRequest): readonly Fix[] {
    switch (request.diagnostic.code) {
      case 'AMK0002':
        return missingTarget(request);
      case 'AMK0040':
      case 'AMK0041':
        return misplaced(request);
      case 'AMK0205':
        return amk0205(request);
      case 'AMK0207':
        return request.context.compiled ? switchTarget(request.context.compiled, null) : [];
      case 'AMK0213':
        return growPad(request);
      default:
        return redundant(request);
    }
  },
};
