import { Service, computed, effect, inject, signal } from '@angular/core';

import { EMPTY_SAMPLE_NAME } from '@compilers/addmusick/tables';
import {
  type BrrSample,
  blockCount,
  decodeBrr,
  emptySample,
  parseBrr,
  peaks,
  validateBrr,
  validateName,
} from '@spc/brr';
import { clear, del, loadAll, put, storageFailure } from '../util/idb';
import { DriverStore } from './driver-store';

/** Envelope resolution. Wide enough to read, small enough to keep in a signal. */
const WAVEFORM_BUCKETS = 160;

export interface SampleFile {
  name: string;
  /** The raw `.brr` file, loop header included. */
  bytes: Uint8Array;
  /**
   * `stock` — as shipped in `public/driver/samples/`.
   * `override` — a stock name whose bytes the user replaced; revertable.
   * `user` — a name that does not exist in the bundle; deletable.
   */
  source: 'stock' | 'override' | 'user';
  /** Why the file is unusable, or `null`. Invalid files are listed, not dropped. */
  error: string | null;
  blocks: number;
  loopOffset: number;
  frames: number;
  /** `WAVEFORM_BUCKETS * 2` min/max pairs in -1..1, for drawing. */
  envelope: Float32Array;
}

/**
 * The sample library: the bundled `.brr` files plus whatever the user has
 * uploaded over or alongside them.
 *
 * The bundle in `public/driver/` is never written to. A stock name the user
 * replaces gets an *override* stored in IndexedDB, and reverting drops the
 * override rather than restoring anything — so the shipped files stay the
 * source of truth and `spctest` can keep asserting on them.
 *
 * The bundled twenty keep their order and membership no matter what, because
 * `INSTRUMENT_TO_SAMPLE` (`compilers/addmusick/tables.ts`) hardcodes that
 * `@0`-`@29` mean specific SRCNs. Replacing a file's *bytes* changes what `@0`
 * sounds like, which is the point; changing the *list* is `#samples`'s job.
 */
@Service()
export class SampleStore {
  private readonly drivers = inject(DriverStore);

  /** User bytes by filename. Empty until IndexedDB has been read. */
  private readonly overrides = signal<Map<string, Uint8Array>>(new Map());

  /** Set once the initial read finishes, so the persisting effect can't race it. */
  private readonly hydrated = signal(false);

  /** Why samples will not survive a reload, or `null`. */
  readonly storageError = signal<string | null>(null);

  /** The bundled samples, in manifest order. */
  private readonly stock = computed<readonly BrrSample[]>(() => this.drivers.driver()?.samples ?? []);

  /** Named sample groups from the driver manifest — `#default` and friends. */
  readonly groups = computed<Readonly<Record<string, readonly string[]>>>(
    () => this.drivers.driver()?.manifest.sampleGroups ?? {},
  );

  /** The `#default` group's names, in SRCN order. */
  readonly defaultGroup = computed<readonly string[]>(() => this.groups()['default'] ?? []);

  /**
   * Every file in the library, sorted with the bundled set first in its own
   * order and user uploads after, alphabetically.
   */
  readonly files = computed<SampleFile[]>(() => {
    const stock = this.stock();
    const overrides = this.overrides();
    const stockNames = new Set(stock.map((sample) => sample.sampleName));

    const out: SampleFile[] = [];

    for (const sample of stock) {
      const override = overrides.get(sample.sampleName);
      out.push(
        override
          ? this.describe(sample.sampleName, override, 'override')
          : this.describeParsed(sample.sampleName, rebuild(sample), sample, 'stock'),
      );
    }

    const extra = [...overrides.keys()].filter((name) => !stockNames.has(name)).sort();
    for (const name of extra) out.push(this.describe(name, overrides.get(name)!, 'user'));

    return out;
  });

  /** Filenames that are safe to reference from MML, in library order. */
  readonly names = computed(() => this.files().filter((file) => file.error === null).map((file) => file.name));

  readonly totalBytes = computed(() =>
    this.files().reduce((sum, file) => (file.error === null ? sum + file.bytes.length - 2 : sum), 0),
  );

  readonly overrideCount = computed(() => this.files().filter((file) => file.source !== 'stock').length);

  /**
   * Name → sample, rebuilt only when a file actually changes.
   *
   * The identity of these objects is load-bearing: `computeSpcLayout` and
   * `buildSpc` both deduplicate by reference, so a name listed twice must
   * resolve to the *same* object or its bytes get written into ARAM twice and
   * the budget over-counts. Holding them in a `computed` gives that for free.
   */
  private readonly byName = computed<ReadonlyMap<string, BrrSample>>(() => {
    const map = new Map<string, BrrSample>();
    const overrides = this.overrides();

    for (const sample of this.stock()) {
      if (!overrides.has(sample.sampleName)) map.set(sample.sampleName, sample);
    }
    for (const [name, bytes] of overrides) {
      if (validateBrr(bytes) === null) map.set(name, parseBrr(name, bytes));
    }

    // The compiler names this for every slot its optimisation pass emptied. It is
    // not a library file and never appears in `files()`; one shared instance
    // means `buildSpc` stores its zero bytes once however many slots point at it.
    map.set(EMPTY_SAMPLE_NAME, emptySample(EMPTY_SAMPLE_NAME));
    return map;
  });

  /**
   * Resolves names to samples, in the order given — that order is the SRCN
   * assignment. Unknown or invalid names are skipped; the compiler is what
   * reports them, since only it knows where in the source they came from.
   */
  resolve(names: readonly string[]): BrrSample[] {
    const map = this.byName();
    const out: BrrSample[] = [];
    for (const name of names) {
      // An unresolvable name must still occupy its slot. Skipping it would shift
      // every later SRCN down by one and silently rewire the whole directory —
      // the song would play the wrong samples rather than miss one. The compiler
      // is what reports the name; here it just has to not corrupt the indexing.
      out.push(map.get(name) ?? this.placeholder(name));
    }
    return out;
  }

  /**
   * A zero-length stand-in for a name the library cannot resolve.
   *
   * Memoised for the same reason the real samples are: `buildSpc` deduplicates
   * by object identity, so one instance per name keeps repeated slots cheap.
   */
  private readonly placeholders = new Map<string, BrrSample>();

  private placeholder(name: string): BrrSample {
    let sample = this.placeholders.get(name);
    if (!sample) {
      sample = emptySample(name);
      this.placeholders.set(name, sample);
    }
    return sample;
  }

  constructor() {
    void this.hydrate();

    // Sanctioned effect: mirroring signal state into external storage, as
    // `editor-store.ts` does for the draft. Gated on `hydrated` so the initial
    // empty map is never written back over a populated database.
    effect(() => {
      const overrides = this.overrides();
      if (!this.hydrated()) return;
      void this.persist(overrides);
    });
  }

  private async hydrate(): Promise<void> {
    const stored = await loadAll();
    if (stored.size > 0) this.overrides.set(stored);
    this.hydrated.set(true);
    this.storageError.set(storageFailure());
  }

  private async persist(overrides: ReadonlyMap<string, Uint8Array>): Promise<void> {
    await clear();
    for (const [name, bytes] of overrides) await put(name, bytes);
    this.storageError.set(storageFailure());
  }

  /**
   * Adds or replaces files. Rejected names are reported; bad *contents* are
   * kept so the browser can show why, since "I uploaded it and it vanished" is
   * worse than a row with an error on it.
   */
  async upload(files: readonly File[]): Promise<string[]> {
    const rejected: string[] = [];
    const next = new Map(this.overrides());

    for (const file of files) {
      const problem = validateName(file.name);
      if (problem) {
        rejected.push(problem);
        continue;
      }
      next.set(file.name, new Uint8Array(await file.arrayBuffer()));
    }

    this.overrides.set(next);
    return rejected;
  }

  /** Drops an override, restoring the bundled file. No-op for user files. */
  revert(name: string): void {
    if (!this.stock().some((sample) => sample.sampleName === name)) return;
    this.drop(name);
  }

  /** Removes a user-uploaded file. No-op for bundled names — use `revert`. */
  remove(name: string): void {
    if (this.stock().some((sample) => sample.sampleName === name)) return;
    this.drop(name);
  }

  private drop(name: string): void {
    const next = new Map(this.overrides());
    if (!next.delete(name)) return;
    this.overrides.set(next);
    void del(name);
  }

  /** Restores the bundled library exactly. */
  resetAll(): void {
    this.overrides.set(new Map());
  }

  private describe(name: string, bytes: Uint8Array, source: SampleFile['source']): SampleFile {
    const error = validateBrr(bytes);
    if (error) {
      return { name, bytes, source, error, blocks: 0, loopOffset: 0, frames: 0, envelope: new Float32Array(0) };
    }
    return this.describeParsed(name, bytes, parseBrr(name, bytes), source);
  }

  private describeParsed(
    name: string,
    bytes: Uint8Array,
    sample: BrrSample,
    source: SampleFile['source'],
  ): SampleFile {
    const pcm = decodeBrr(sample);
    return {
      name,
      bytes,
      source,
      error: null,
      blocks: blockCount(sample),
      loopOffset: sample.loopOffset,
      frames: pcm.length,
      envelope: peaks(pcm, WAVEFORM_BUCKETS),
    };
  }

  /** Decoded PCM for auditioning. Not cached — it is one click, not a render loop. */
  pcm(name: string): Int16Array | null {
    const sample = this.byName().get(name);
    return sample ? decodeBrr(sample) : null;
  }
}

/**
 * Reassembles the `.brr` file a bundled sample came from.
 *
 * `loadDriver` throws the raw bytes away and keeps only the parsed form, but
 * the browser wants one uniform "here are the bytes" shape for every row, and
 * the file is just the 2-byte loop header followed by the block data.
 */
function rebuild(sample: BrrSample): Uint8Array {
  const raw = new Uint8Array(sample.data.length + 2);
  raw[0] = sample.loopOffset & 0xff;
  raw[1] = (sample.loopOffset >> 8) & 0xff;
  raw.set(sample.data, 2);
  return raw;
}
