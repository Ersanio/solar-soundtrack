import { StateEffect } from '@codemirror/state';

import type { Span } from '@amk/core/types';
import { spanMarkField } from './span-marks';

/** Replaces the playhead marks wholesale; the field below renders them. */
export const setPlayhead = StateEffect.define<readonly Span[]>();

/**
 * The notes being sounded, as decorations — up to one per voice, pushed in at
 * 10 Hz from the driver's own read pointers. Between effects a document change
 * just maps the marks along; the staleness guard upstream clears them on the
 * next tick anyway, since edited text no longer matches what is playing.
 */
export const playheadField = spanMarkField(setPlayhead, 'cm-amk-playhead');
