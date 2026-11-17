/** The top bar: the transport, the ARAM meter, the exports, the theme picker, the changelog and the commit link. */

import { Component, inject } from '@angular/core';

import { Changelog } from '../../changelog/changelog';
import { GIT_COMMIT_SHA } from '../../git-info.generated';
import { Button } from '../../shared/button/button';
import { IconDownload } from '../../shared/icons/icon-download';
import { IconGithub } from '../../shared/icons/icon-github';
import { EditorStore } from '../../state/editor-store';
import { ThemePicker } from '../../theme/theme-picker/theme-picker';
import { AramMeter } from '../aram-meter/aram-meter';
import { TransportControls } from '../transport-controls/transport-controls';

const REPO_URL = 'https://github.com/Ersanio/solar-soundtrack';

/**
 * One row at `lg` and above; between 768 and 1023 the items may wrap onto a
 * second. The transport is the one item that gives, its seek slider taking the
 * slack, so everything else keeps its width.
 *
 * The slider stops giving at its least width, so on a short row labels give
 * way first, each where the row stops holding it: the exports' below `2xl`, the ARAM meter's free figure below 106rem, and below
 * `xl` the Loop label and the ARAM word, with the volume slider a step
 * narrower. Without them the transport overflows its box at 1024–1279px and
 * 1536–1695px, and its volume slider lies over the ARAM meter.
 */
@Component({
  selector: 'amk-top-bar',
  imports: [AramMeter, Button, Changelog, IconDownload, IconGithub, ThemePicker, TransportControls],
  templateUrl: './top-bar.html',
  /*
   * A step darker than the other toolbars — the inset over the raised grey —
   * so the row the song is played from is set apart and its plates stand off it.
   */
  host: {
    class:
      'border-edge bg-[color-mix(in_srgb,var(--color-inset)_50%,var(--color-raised))] flex items-center gap-2 border-b px-3 lg:h-12 lg:flex-nowrap max-lg:flex-wrap max-lg:py-1.5',
  },
})
export class TopBar {
  protected readonly store = inject(EditorStore);

  protected readonly commitUrl = `${REPO_URL}/commit/${GIT_COMMIT_SHA}`;
  protected readonly commitShort = GIT_COMMIT_SHA.slice(0, 7);
}
