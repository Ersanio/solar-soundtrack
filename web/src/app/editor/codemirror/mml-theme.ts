import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

/**
 * The editor's look, entirely in terms of the theme variables in `styles.css`
 * so it cannot drift from the rest of the app. Structurally it reproduces the
 * `<textarea>` it replaced: 13px mono at `leading-relaxed`, `p-3` padding,
 * `bg-surface`/`text-ink`, no wrapping, and no focus outline of its own — the
 * caret carries focus, exactly as `focus:outline-none` did. The global
 * `:focus-visible` rule is untouched.
 */
const structure = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-ink)',
      fontSize: '13px',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.625',
      overflow: 'auto',
    },
    '.cm-content': {
      padding: '0.75rem 0',
      caretColor: 'var(--color-accent)',
    },
    '.cm-line': { padding: '0 0.75rem' },
    '&.cm-focused': { outline: 'none' },
    '.cm-gutters': {
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-ink-muted)',
      borderRight: '1px solid var(--color-edge)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--color-raised)',
      border: '1px solid var(--color-edge)',
      color: 'var(--color-ink)',
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
    },
    '.cm-diagnostic-error': { borderLeftColor: 'var(--color-danger)' },
    '.cm-diagnostic-warning': { borderLeftColor: 'var(--color-warn)' },
    '.cm-diagnostic-info': { borderLeftColor: 'var(--color-ink-muted)' },
    // The wavy underline colours restate the diagnostics list's severity
    // palette; the list still spells the severity out in words, so colour is
    // never the only channel.
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--color-danger)',
    },
    '.cm-lintRange-warning': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--color-warn)',
    },
    '.cm-lintRange-warning.cm-amk-severe': { textDecorationColor: 'var(--color-severe)' },
    '.cm-lintRange-info': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--color-ink-muted)',
    },
    '.cm-amk-hover': { padding: '0.375rem 0.5rem', maxWidth: '28rem' },
    '.cm-amk-hover-name': { fontWeight: '600' },
    '.cm-amk-hover-args': { color: 'var(--color-ink-muted)' },
    '.cm-amk-hover-incomplete': { color: 'var(--color-warn)' },
    '.cm-amk-playhead': {
      backgroundColor: 'color-mix(in srgb, var(--color-accent) 24%, transparent)',
      borderRadius: '2px',
    },
    '.cm-amk-unreachable': {
      textDecoration: 'underline wavy var(--color-severe)',
      textDecorationSkipInk: 'none',
      textUnderlineOffset: '3px',
    },
  },
  { dark: true },
);

/**
 * One entry per tag named in `TOKEN_TAGS`. Notes and plain numbers stay primary
 * ink on purpose — the melody is the text, and everything else is annotation
 * around it.
 *
 * A hex command's argument bytes are the one tag that carries a colour of its
 * own rather than one already spent elsewhere. They are not `--color-accent`:
 * repeating the command byte's colour would flatten `$E7 $02` into one
 * undifferentiated blue run, and leaving them on `tags.number` — which is where
 * they were — made them indistinguishable from notes and body text.
 */
const highlight = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--color-ink-muted)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--color-accent)' },
  { tag: tags.labelName, color: 'var(--color-accent)', fontWeight: '600' },
  { tag: tags.literal, color: 'var(--color-ink)' },
  { tag: tags.variableName, color: 'var(--color-good)' },
  { tag: tags.bracket, color: 'var(--color-severe)' },
  { tag: tags.operator, color: 'var(--color-ink-muted)' },
  { tag: tags.string, color: 'var(--color-warn)' },
  { tag: tags.keyword, color: 'var(--color-accent)' },
  { tag: tags.number, color: 'var(--color-ink)' },
  { tag: tags.integer, color: 'var(--color-accent-soft)' },
  { tag: tags.invalid, color: 'var(--color-danger)' },
]);

export const mmlTheme: Extension = [structure, syntaxHighlighting(highlight)];
