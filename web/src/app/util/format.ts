/** Formatting helpers shared by the editor's panels. */

/** Upper-case hex, as many digits as the value needs. */
export function hex(value: number): string {
  return value.toString(16).toUpperCase();
}

export function hex2(value: number): string {
  return hex(value).padStart(2, '0');
}

export function hex4(value: number): string {
  return hex(value).padStart(4, '0');
}

/** `m:ss`, clamped at zero — the transport never shows negative time. */
export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
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
