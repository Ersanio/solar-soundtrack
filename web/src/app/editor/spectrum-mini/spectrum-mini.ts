import { Component, inject } from '@angular/core';

import { EditorRequests } from '../../state/editor-requests';
import { Spectrum } from '../spectrum/spectrum';

/**
 * The top bar's spectrum: the song's fourteen bands as it plays, beside the ARAM meter as FL keeps
 * its small meters together. A click opens the Song Inspector, which has the full one.
 */
@Component({
  selector: 'amk-spectrum-mini',
  imports: [Spectrum],
  templateUrl: './spectrum-mini.html',
})
export class SpectrumMini {
  protected readonly requests = inject(EditorRequests);
}
