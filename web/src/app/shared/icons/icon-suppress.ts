import { Component } from '@angular/core';

let nextId = 0;

/**
 * An eye with a warning sign at its corner, for warnings kept out of sight.
 *
 * ```html
 * <amk-icon-suppress />
 * ```
 */
@Component({
  selector: 'amk-icon-suppress',
  templateUrl: './icon-suppress.html',
})
export class IconSuppress {
  private readonly id = nextId++;

  // A mask is found by its document-wide id, so each instance names its own.
  protected readonly eyeId = `icon-suppress-eye-${this.id}`;
  protected readonly signId = `icon-suppress-sign-${this.id}`;
  protected readonly eyeMask = `url(#${this.eyeId})`;
  protected readonly signMask = `url(#${this.signId})`;
}
