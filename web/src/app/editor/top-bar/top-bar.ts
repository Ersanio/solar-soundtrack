/** The top bar: the transport, the ARAM meter, the suppressed warnings, the MIDI keyboard switch, the Export menu and the import, the theme picker, the changelog and the commit link. */

import { Component, computed, inject, viewChild } from '@angular/core';

import { detectFormat } from '@amk/import/format';
import { Changelog } from '../../changelog/changelog';
import { GIT_COMMIT_SHA } from '../../git-info.generated';
import { Button, buttonClass } from '../../shared/button/button';
import { IconFileExport } from '../../shared/icons/icon-file-export';
import { IconFileImport } from '../../shared/icons/icon-file-import';
import { IconLoop } from '../../shared/icons/icon-loop';
import { IconGithub } from '../../shared/icons/icon-github';
import { IconRoll } from '../../shared/icons/icon-roll';
import { Menu } from '../../shared/menu/menu';
import { Toggle } from '../../shared/toggle/toggle';
import { Audition } from '../../state/audition';
import { EditorStore } from '../../state/editor-store';
import { MidiInput } from '../../state/midi-input';
import { WavExport } from '../../state/wav-export';
import { ThemePicker } from '../../theme/theme-picker/theme-picker';
import { AramMeter } from '../aram-meter/aram-meter';
import { FinalizeDialog } from '../finalize-dialog/finalize-dialog';
import { ImportDialog } from '../import-dialog/import-dialog';
import { ModImportDialog } from '../mod-import-dialog/mod-import-dialog';
import { ScopeMini } from '../scope-mini/scope-mini';
import { SuppressionsButton } from './suppressions-button/suppressions-button';
import { TransportControls } from '../transport-controls/transport-controls';

const REPO_URL = 'https://github.com/Ersanio/solar-soundtrack';

/**
 * One row at `lg` and above; between 768 and 1023 the items may wrap onto a
 * second. The transport is the one item that gives, its seek slider taking the
 * slack, so everything else keeps its width.
 *
 * The slider stops giving at its least width, so on a short row labels give
 * way first, each where the row stops holding it: the Export menu's and the import's below `2xl`, the
 * MIDI switch's below 98rem, the ARAM meter's free figure below 107rem, and below
 * `xl` the Loop label and the ARAM word, with the volume slider a step
 * narrower. Below 67rem the suppressed warnings' button goes too, the Problems
 * list's count opening its list instead. The spectrum beside the ARAM meter
 * shows from `xl` up, the Song Inspector tab being the way in below that. Without them the transport overflows its box at 1024–1279px and
 * 1536–1711px, and its volume slider lies over the ARAM meter.
 */
@Component({
  selector: 'amk-top-bar',
  imports: [
    AramMeter,
    Button,
    Changelog,
    FinalizeDialog,
    IconFileExport,
    IconFileImport,
    IconGithub,
    IconLoop,
    IconRoll,
    ImportDialog,
    Menu,
    ModImportDialog,
    ScopeMini,
    SuppressionsButton,
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
  protected readonly wav = inject(WavExport);
  private readonly audition = inject(Audition);

  private readonly importer = viewChild.required(ImportDialog);
  private readonly modImporter = viewChild.required(ModImportDialog);

  protected readonly importClass = `${buttonClass('dark', 'md')} cursor-pointer`;

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
      case 'on':
        return null;
    }
  });

  /** Opens the Import dialog for the picked file's format, and lets the same file be picked again. */
  protected async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const format = detectFormat(bytes);
      if (format !== null && format !== 'midi') {
        this.modImporter().openWith(file.name, bytes);
      } else {
        this.importer().openWith(file.name, bytes);
      }
    }
  }

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
