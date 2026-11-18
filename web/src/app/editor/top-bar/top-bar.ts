/** The top bar: the transport, the ARAM meter, the MIDI keyboard switch, the exports, the theme picker, the changelog and the commit link. */

import { Component, computed, inject } from '@angular/core';

import { Changelog } from '../../changelog/changelog';
import { GIT_COMMIT_SHA } from '../../git-info.generated';
import { Button } from '../../shared/button/button';
import { IconDownload } from '../../shared/icons/icon-download';
import { IconGithub } from '../../shared/icons/icon-github';
import { IconRoll } from '../../shared/icons/icon-roll';
import { Toggle } from '../../shared/toggle/toggle';
import { Audition } from '../../state/audition';
import { EditorStore } from '../../state/editor-store';
import { MidiInput } from '../../state/midi-input';
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
 * way first, each where the row stops holding it: the exports' below `2xl`, the
 * MIDI switch's below 98rem, the ARAM meter's free figure below 107rem, and below
 * `xl` the Loop label and the ARAM word, with the volume slider a step
 * narrower. Without them the transport overflows its box at 1024–1279px and
 * 1536–1711px, and its volume slider lies over the ARAM meter.
 */
@Component({
  selector: 'amk-top-bar',
  imports: [
    AramMeter,
    Button,
    Changelog,
    IconDownload,
    IconGithub,
    IconRoll,
    ThemePicker,
    Toggle,
    TransportControls,
  ],
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
  protected readonly midi = inject(MidiInput);
  private readonly audition = inject(Audition);

  protected readonly commitUrl = `${REPO_URL}/commit/${GIT_COMMIT_SHA}`;
  protected readonly commitShort = GIT_COMMIT_SHA.slice(0, 7);

  /** Whether a keyboard is being listened to, which follows one being plugged in or out. */
  protected readonly midiLabel = computed(() => {
    if (this.midi.status() !== 'on') {
      return $localize`:@@topbar.midi.connect:topbar.midi.connect`;
    }

    return this.midi.devices().length > 0
      ? $localize`:@@topbar.midi.connected:topbar.midi.connected`
      : $localize`:@@topbar.midi.not-detected:topbar.midi.not-detected`;
  });

  protected readonly midiTitle = computed(() => {
    switch (this.midi.status()) {
      case 'unsupported':
        return $localize`:@@topbar.midi.unsupported.title:topbar.midi.unsupported.title`;
      case 'asking':
        return $localize`:@@topbar.midi.asking.title:topbar.midi.asking.title`;
      case 'denied':
        return $localize`:@@topbar.midi.denied.title:topbar.midi.denied.title`;
      case 'off':
        return $localize`:@@topbar.midi.off.title:topbar.midi.off.title`;
      case 'on': {
        const devices = this.midi.devices().join(', ');
        return devices === ''
          ? $localize`:@@topbar.midi.no-keyboard.title:topbar.midi.no-keyboard.title`
          : $localize`:@@topbar.midi.on.title:topbar.midi.on.title ${devices}:devices:`;
      }
    }
  });

  /**
   * The press is what the browser's permission prompt answers to, and what lets
   * the previewer open its audio ahead of the first key.
   */
  protected toggleMidi(): void {
    if (this.midi.status() === 'on') {
      this.midi.disable();
      return;
    }

    this.audition.warm();
    void this.midi.enable();
  }
}
