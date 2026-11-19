/** Formatting helpers shared by the editor's panels. */

/** Hex lives in `@amk/core`, where the compiler and the scanner also read it from. */
export { dollarHex, hex, hex2, hex4, hexBytes } from '@amk/core/hex';

/**
 * A short duration, in whichever unit reads better. `∞` for a rate of 0, which
 * in an SNES envelope means the level never advances.
 */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return '∞';
  }

  return seconds >= 1 ? `${seconds.toFixed(2)} s` : `${(seconds * 1000).toFixed(0)} ms`;
}

/**
 * `m:ss`, clamped at zero — the transport never shows negative time. The minutes
 * are zero-padded to `width` digits, so a position can match its duration's width.
 */
export function formatTime(seconds: number, width = 1): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = String(Math.floor(whole / 60)).padStart(width, '0');
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

/** How many digits {@link formatTime} writes for the minutes of `seconds`. */
export function minuteDigits(seconds: number): number {
  return String(Math.floor(Math.max(0, Math.floor(seconds)) / 60)).length;
}

/** Line/column of a caret offset, 1-based, for the editor's position readout. */
export function caretPosition(text: string, offset: number): { line: number; column: number } {
  const upTo = text.slice(0, offset);
  return {
    line: upTo.split('\n').length,
    column: offset - (upTo.lastIndexOf('\n') + 1) + 1,
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function downloadBlob(filename: string, data: Uint8Array): void {
  const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
