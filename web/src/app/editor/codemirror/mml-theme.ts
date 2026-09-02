import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

/**
 * The editor's look, entirely in terms of the theme variables in `styles.css`
 * so it cannot drift from the rest of the app: 13px mono at `leading-relaxed`,
 * `p-3` padding, `bg-surface`/`text-ink`, no wrapping, and no focus outline of
 * its own — the caret carries focus. The global `:focus-visible` rule is
 * untouched.
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
 * One entry per tag named in `TOKEN_TAGS`, and every one of them on a
 * `--color-syn-*` token of its own.
 *
 * Shared with nothing, deliberately: the source's colouring is the one thing a
 * porter looks at for hours, and while these were the app's own palette a
 * change to the notes moved the body text with them and a change to the loop
 * brackets moved every severe warning. `styles.css` carries the defaults, which
 * are what the shared tokens used to give here, so the source reads as it did
 * until somebody sets one.
 *
 * The structure above is not part of this. A gutter, a tooltip and a
 * diagnostic's underline are the editor's chrome and the app's own findings,
 * not MML, so they stay on the tokens the rest of the app uses.
 */
const highlight = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--color-syn-comment)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--color-syn-directive)' },
  { tag: tags.labelName, color: 'var(--color-syn-channel)', fontWeight: '600' },
  { tag: tags.literal, color: 'var(--color-syn-note)' },
  { tag: tags.variableName, color: 'var(--color-syn-command)' },
  { tag: tags.bracket, color: 'var(--color-syn-loop)' },
  { tag: tags.operator, color: 'var(--color-syn-operator)' },
  { tag: tags.string, color: 'var(--color-syn-string)' },
  { tag: tags.keyword, color: 'var(--color-syn-hex)' },
  { tag: tags.number, color: 'var(--color-syn-number)' },
  { tag: tags.integer, color: 'var(--color-syn-hex-arg)' },
  { tag: tags.invalid, color: 'var(--color-syn-invalid)' },
]);

export const mmlTheme: Extension = [structure, syntaxHighlighting(highlight)];
