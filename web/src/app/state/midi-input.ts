import { DestroyRef, Service, inject, signal } from '@angular/core';

import { readStored, writeStored } from '../util/storage';

const STORAGE_KEY = 'solar-soundtrack.midi';

/** Status bytes' high nibbles; the low one is the MIDI channel, which is ignored. */
const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;

/** A key going down or coming up, on any connected input. */
export interface MidiKey {
  down: boolean;
  /** The MIDI note number, 0 to 127, whatever keyboard it came from. */
  key: number;
  /** When it happened, on `performance.now()`'s clock. */
  at: number;
}

/**
 * `off` until the porter asks; `denied` when the browser or the porter refuses;
 * `unsupported` where the browser has no Web MIDI at all.
 */
export type MidiStatus = 'unsupported' | 'off' | 'asking' | 'on' | 'denied';

/**
 * The connected MIDI keyboards, as a stream of keys.
 *
 * Every input the browser offers is listened to, so a keyboard plugged in later
 * is picked up and how many keys it has is nobody's business here. What a key
 * means is the one listener's — the piano roll takes the slot while it is open,
 * and with no listener a key does nothing.
 */
@Service()
export class MidiInput {
  readonly status = signal<MidiStatus>(
    typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator ? 'off' : 'unsupported',
  );
  /** The names of the inputs being listened to. */
  readonly devices = signal<readonly string[]>([]);

  private access: MIDIAccess | null = null;
  private listener: ((key: MidiKey) => void) | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.detach());

    // A choice made on an earlier visit is taken up again only where the browser
    // still grants it, since asking needs a press to answer to.
    if (this.status() === 'off' && readStored(STORAGE_KEY) === 'on') {
      void this.resume();
    }
  }

  /** Takes the listener slot, or gives it up with `null`. */
  listen(listener: ((key: MidiKey) => void) | null): void {
    this.listener = listener;
  }

  /** Asks the browser for its MIDI inputs, which is where it asks the porter. */
  async enable(): Promise<void> {
    if (this.status() === 'unsupported' || this.status() === 'asking' || this.status() === 'on') {
      return;
    }

    this.status.set('asking');
    try {
      this.access = await navigator.requestMIDIAccess();
    } catch {
      this.status.set('denied');
      return;
    }

    this.access.onstatechange = () => this.attach();
    this.attach();
    this.status.set('on');
    writeStored(STORAGE_KEY, 'on');
  }

  disable(): void {
    this.detach();
    if (this.status() !== 'unsupported') {
      this.status.set('off');
    }

    writeStored(STORAGE_KEY, 'off');
  }

  private async resume(): Promise<void> {
    try {
      const permission = await navigator.permissions.query({ name: 'midi' });
      if (permission.state === 'granted') {
        await this.enable();
      }
    } catch {
      // No permissions API, or no `midi` name in it: the button still asks.
    }
  }

  /** Listens to every input there is now; an input that has gone is simply not in the list. */
  private attach(): void {
    const names: string[] = [];
    this.access?.inputs.forEach((input) => {
      input.onmidimessage = (event) => this.read(event);
      names.push(input.name ?? input.id);
    });
    this.devices.set(names);
  }

  private detach(): void {
    this.access?.inputs.forEach((input) => (input.onmidimessage = null));
    if (this.access) {
      this.access.onstatechange = null;
    }

    this.access = null;
    this.devices.set([]);
  }

  private read(event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data || data.length < 3) {
      return;
    }

    const kind = data[0] & 0xf0;
    if (kind !== NOTE_ON && kind !== NOTE_OFF) {
      return;
    }

    // A note-on at velocity 0 is a note-off, which is how most keyboards send one.
    this.listener?.({
      down: kind === NOTE_ON && data[2] > 0,
      key: data[1] & 0x7f,
      at: event.timeStamp > 0 ? event.timeStamp : performance.now(),
    });
  }
}
