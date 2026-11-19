/**
 * One pass of the song, played silently and read voice by voice: what the Song Inspector's
 * timelines, spectrogram, tiles and sample table draw.
 *
 * Played rather than predicted for the reason the clock measurement is (`measure-clock.ts`): what
 * a voice sounds like is the sample, the envelope, the volume and the echo together, and only the
 * DSP knows the product. It is rendered a frame at a time so each voice's `VxOUTX` can be read as
 * a signal, which `audiotest` pins as the same bytes a block render makes. The mixer's mask is
 * applied in the DSP as the transport applies it, so a muted channel is silent here as it is heard,
 * and the mix, the loudness and the echo are those of what is left — none of which can be got by
 * subtracting a channel afterwards, the echo having fed back on it.
 *
 * The time axis is the driver's own ticks, counted as `measure-clock.ts` counts them, and the pass
 * is cut into at most {@link MAX_BUCKETS} buckets of whole ticks.
 */

import {
  POLL_BLOCK_FRAMES,
  createTickPhase,
  sawTick,
  seedTickPhase,
  tickVoice,
} from '@amk/spc/driver-state';
import { DspReg, SPC_SAMPLE_RATE, type SpcCore } from '@amk/spc/wasm-host';
import { PowerSpectrum } from './fft';
import { LoudnessMeter } from './loudness';
import { heardGain } from './scope';
import { HANN, bandLevels, levelFraction, logRows } from './spectrum-bands';

const VOICES = 8;

/** Buckets across the pass, bounding what crosses back from the worker. */
export const MAX_BUCKETS = 4096;

/** The sample lane a voice playing noise is counted on, being no SRCN at all. */
export const NOISE_SAMPLE = 256;

/** A bucket quieter than this, in dBFS, is a voice or sample not sounding. */
export const SOUNDING_DB = -60;

/** What a silent bucket reads, in place of `-Infinity`, which a structured clone keeps but a chart cannot draw. */
export const SILENT_DB = -120;

/** The spectrogram's window and hop, in DSP frames: 64 ms windows every 32 ms. */
const SPECTRUM_SIZE = 2048;
const SPECTRUM_HOP = 1024;

/** Rows of the spectrogram, to the octave. */
export const SPECTROGRAM_ROWS_PER_OCTAVE = 12;

/** How far the analysis will play before giving up, as `measure-clock.ts` does. */
const MAX_SECONDS = 999;

/** How often, in emulated frames, to report progress. */
const PROGRESS_FRAMES = SPC_SAMPLE_RATE / 4;

export interface SampleLane {
  /** The SRCN, or {@link NOISE_SAMPLE}. */
  id: number;
  /** dBFS per bucket. */
  level: Float32Array;
  /** Buckets it sounds in, above {@link SOUNDING_DB}. */
  sounding: number;
  /** Its loudest bucket, dBFS. */
  peakDb: number;
}

export interface Spectrogram {
  rows: number;
  columns: number;
  /** Column-major, `columns × rows`, 0 the floor and 255 the ceiling of `spectrum-bands.ts`. */
  levels: Uint8Array;
  /** The tick each column was taken at. */
  ticks: Float32Array;
}

export interface SongAnalysis {
  /** The pass asked for, and how far the analysis got. */
  passTicks: number;
  ticks: number;
  /** Ticks per bucket, and how many buckets there are. */
  bucketTicks: number;
  buckets: number;

  /** Each voice as heard, RMS dBFS, voice-major: voice `v`'s bucket `b` is at `v × buckets + b`. */
  voiceLevel: Float32Array;
  /** Each voice's loudest bucket, dBFS. */
  voicePeak: Float32Array;
  /** The share of buckets each voice sounds in, 0 to 1. */
  voiceActive: Float32Array;
  /** `EON` in each bucket: the voices sending to the echo. */
  echoSends: Uint8Array;
  /** The samples heard, by SRCN, in that order. */
  samples: SampleLane[];

  /** Momentary loudness at the end of each bucket, LUFS. */
  loudness: Float32Array;
  /** The loudest sample in each bucket, dBFS. */
  peak: Float32Array;
  /** Samples in each bucket the DSP clamped to full scale. */
  clips: Uint32Array;
  /** Left against right in each bucket, -1 to 1. */
  correlation: Float32Array;

  /** RMS of the whole echo buffer at the end of each bucket, dBFS. */
  echoEnergy: Float32Array;
  /** `EVOL` left and right per bucket, interleaved; `EFB` per bucket; whether the DSP writes the buffer. */
  echoVolume: Int8Array;
  echoFeedback: Int8Array;
  echoWrites: Uint8Array;

  spectrogram: Spectrogram;

  integratedLufs: number;
  peakDb: number;
  clipCount: number;
  /** The most voices sounding in any one bucket. */
  maxPolyphony: number;
  /** The share of buckets in which the echo is heard — written, with a volume and a voice sending to it. */
  echoShare: number;
  /** Emulated seconds the pass took, lead-in included. */
  seconds: number;
  /** The pass was not reached, and everything describes as far as it got. */
  truncated: boolean;
}

const db = (power: number): number =>
  power > 0 ? Math.max(SILENT_DB, 10 * Math.log10(power)) : SILENT_DB;

/** The echo buffer's RMS, dBFS: every sixteenth frame of `ESA × $100` for `EDL × 2 KiB`. */
function echoRms(aram: Uint8Array, regs: Uint8Array): number {
  const start = regs[DspReg.EchoStart] << 8;
  const delay = regs[DspReg.EchoDelay] & 0x0f;
  const bytes = delay === 0 ? 4 : delay * 2048;
  let sum = 0;
  let count = 0;
  for (let at = 0; at < bytes; at += 64) {
    const lo = (start + at) & 0xffff;
    const word = aram[lo] | (aram[(lo + 1) & 0xffff] << 8);
    const sample = (word << 16) >> 16;
    sum += (sample / 32768) ** 2;
    count++;
  }

  return db(sum / Math.max(1, count));
}

/**
 * Plays `spc` for one pass of `passTicks` with the voices in `mask` muted, and reads it.
 * `progress` is told how far through the pass it is, 0 to 1, a few times a second.
 */
export function analyseSong(
  core: SpcCore,
  spc: Uint8Array,
  passTicks: number,
  mask: number,
  progress: (fraction: number) => void = () => {},
): SongAnalysis {
  const pass = Math.max(1, passTicks);
  const bucketTicks = Math.max(1, Math.ceil(pass / MAX_BUCKETS));
  const buckets = Math.ceil(pass / bucketTicks);

  const voicePower = new Float64Array(VOICES * buckets);
  const bucketFrames = new Float64Array(buckets);
  const sampleBuckets = new Map<number, Float64Array>();
  const echoSends = new Uint8Array(buckets);
  const loudness = new Float32Array(buckets).fill(SILENT_DB);
  const peakLinear = new Float32Array(buckets);
  const clips = new Uint32Array(buckets);
  const lr = new Float64Array(buckets);
  const ll = new Float64Array(buckets);
  const rr = new Float64Array(buckets);
  const echoEnergy = new Float32Array(buckets).fill(SILENT_DB);
  const echoVolume = new Int8Array(buckets * 2);
  const echoFeedback = new Int8Array(buckets);
  const echoWrites = new Uint8Array(buckets);

  const rows = logRows(SPECTROGRAM_ROWS_PER_OCTAVE);
  const fft = new PowerSpectrum(SPECTRUM_SIZE);
  const leftWindow = new Float32Array(SPECTRUM_SIZE);
  const rightWindow = new Float32Array(SPECTRUM_SIZE);
  const leftPower = new Float32Array(fft.bins);
  const rightPower = new Float32Array(fft.bins);
  const bandOut = new Float32Array(rows.length);
  const columns: Uint8Array[] = [];
  const columnTicks: number[] = [];
  const binHz = SPC_SAMPLE_RATE / SPECTRUM_SIZE;
  const fftScale = (SPECTRUM_SIZE / 2) ** 2;
  let windowFill = 0;

  const meter = new LoudnessMeter(SPC_SAMPLE_RATE);
  const outx = new Int8Array(POLL_BLOCK_FRAMES * VOICES);
  const volumes = new Int8Array(VOICES * 2 + 2);
  const gains = new Float64Array(VOICES);
  const blockPower = new Float64Array(VOICES);

  core.loadSpc(spc);
  core.muteVoices(mask);

  const tick = createTickPhase();
  let voice = -1;
  let ticks = 0;
  let rendered = 0;
  let reported = 0;
  let bucket = 0;
  let clipCount = 0;
  let peakAll = 0;
  const cap = MAX_SECONDS * SPC_SAMPLE_RATE;

  const closeBucket = (at: number): void => {
    const regs = core.dspRegisters();
    echoEnergy[at] = echoRms(core.aram(), regs);
    echoVolume[at * 2] = (regs[DspReg.EchoVolumeL] << 24) >> 24;
    echoVolume[at * 2 + 1] = (regs[DspReg.EchoVolumeR] << 24) >> 24;
    echoFeedback[at] = (regs[DspReg.EchoFeedback] << 24) >> 24;
    echoWrites[at] = regs[DspReg.Flags] & 0x20 ? 0 : 1;
    loudness[at] = Math.max(SILENT_DB, meter.momentary());
  };

  while (ticks < pass && rendered < cap) {
    const mix = core.renderVoices(POLL_BLOCK_FRAMES, outx, 0);
    rendered += POLL_BLOCK_FRAMES;

    const regs = core.dspRegisters();
    core.voiceVolumes(volumes);
    volumes[16] = (regs[DspReg.MainVolumeL] << 24) >> 24;
    volumes[17] = (regs[DspReg.MainVolumeR] << 24) >> 24;
    for (let v = 0; v < VOICES; v++) {
      gains[v] = heardGain(volumes, v);
      blockPower[v] = 0;
    }

    for (let frame = 0; frame < POLL_BLOCK_FRAMES; frame++) {
      for (let v = 0; v < VOICES; v++) {
        const amplitude = outx[frame * VOICES + v] * gains[v];
        blockPower[v] += amplitude * amplitude;
      }

      const rawL = mix[frame * 2];
      const rawR = mix[frame * 2 + 1];
      const l = rawL / 32768;
      const r = rawR / 32768;
      meter.push(l, r);

      const loudest = Math.max(Math.abs(l), Math.abs(r));
      if (loudest > peakAll) {
        peakAll = loudest;
      }

      if (loudest > peakLinear[bucket]) {
        peakLinear[bucket] = loudest;
      }

      if (rawL >= 32767 || rawL <= -32768 || rawR >= 32767 || rawR <= -32768) {
        clips[bucket]++;
        clipCount++;
      }

      lr[bucket] += l * r;
      ll[bucket] += l * l;
      rr[bucket] += r * r;

      leftWindow[windowFill] = l;
      rightWindow[windowFill] = r;
      if (++windowFill === SPECTRUM_SIZE) {
        fft.power(leftWindow, 0, leftPower);
        fft.power(rightWindow, 0, rightPower);
        for (let k = 0; k < fft.bins; k++) {
          leftPower[k] = (leftPower[k] + rightPower[k]) / 2;
        }

        bandLevels(leftPower, binHz, rows, HANN, fftScale, bandOut);
        const column = new Uint8Array(rows.length);
        for (let row = 0; row < rows.length; row++) {
          column[row] = Math.round(levelFraction(bandOut[row]) * 255);
        }

        columns.push(column);
        columnTicks.push(ticks);
        leftWindow.copyWithin(0, SPECTRUM_HOP);
        rightWindow.copyWithin(0, SPECTRUM_HOP);
        windowFill = SPECTRUM_SIZE - SPECTRUM_HOP;
      }
    }

    const noise = regs[DspReg.Noise];
    for (let v = 0; v < VOICES; v++) {
      voicePower[v * buckets + bucket] += blockPower[v];
      if (blockPower[v] <= 0) {
        continue;
      }

      const id = noise & (1 << v) ? NOISE_SAMPLE : regs[v * 0x10 + DspReg.Srcn];
      let lane = sampleBuckets.get(id);
      if (!lane) {
        lane = new Float64Array(buckets);
        sampleBuckets.set(id, lane);
      }

      lane[bucket] += blockPower[v];
    }

    echoSends[bucket] |= regs[DspReg.EchoOn];
    bucketFrames[bucket] += POLL_BLOCK_FRAMES;

    const aram = core.aram();
    if (voice < 0) {
      voice = tickVoice(aram);
      seedTickPhase(tick, aram);
    } else {
      ticks += sawTick(tick, aram);
    }

    const next = Math.min(buckets - 1, Math.floor(ticks / bucketTicks));
    if (next !== bucket) {
      closeBucket(bucket);
      bucket = next;
    }

    if (rendered - reported >= PROGRESS_FRAMES) {
      reported = rendered;
      progress(Math.min(1, ticks / pass));
    }
  }

  closeBucket(bucket);

  const reached = Math.min(buckets, bucket + 1);
  const voiceLevel = new Float32Array(VOICES * buckets).fill(SILENT_DB);
  const voicePeak = new Float32Array(VOICES).fill(SILENT_DB);
  const voiceActive = new Float32Array(VOICES);
  const correlation = new Float32Array(buckets);
  const peak = new Float32Array(buckets).fill(SILENT_DB);
  let maxPolyphony = 0;
  let echoHeard = 0;

  for (let b = 0; b < reached; b++) {
    const frames = bucketFrames[b] || 1;
    let sounding = 0;
    for (let v = 0; v < VOICES; v++) {
      const level = db(voicePower[v * buckets + b] / frames);
      voiceLevel[v * buckets + b] = level;
      voicePeak[v] = Math.max(voicePeak[v], level);
      if (level > SOUNDING_DB) {
        voiceActive[v]++;
        sounding++;
      }
    }

    maxPolyphony = Math.max(maxPolyphony, sounding);
    peak[b] = peakLinear[b] > 0 ? 20 * Math.log10(peakLinear[b]) : SILENT_DB;

    const norm = Math.sqrt(ll[b] * rr[b]);
    correlation[b] = norm > 0 ? lr[b] / norm : 0;

    const heard =
      echoWrites[b] &&
      (echoVolume[b * 2] !== 0 || echoVolume[b * 2 + 1] !== 0) &&
      echoSends[b] !== 0;
    if (heard) {
      echoHeard++;
    }
  }

  for (let v = 0; v < VOICES; v++) {
    voiceActive[v] /= reached;
  }

  const samples: SampleLane[] = [...sampleBuckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([id, power]) => {
      const level = new Float32Array(buckets).fill(SILENT_DB);
      let sounding = 0;
      let peakDb = SILENT_DB;
      for (let b = 0; b < reached; b++) {
        level[b] = db(power[b] / (bucketFrames[b] || 1));
        peakDb = Math.max(peakDb, level[b]);
        if (level[b] > SOUNDING_DB) {
          sounding++;
        }
      }

      return { id, level, sounding, peakDb };
    })
    .filter((lane) => lane.sounding > 0);

  const levels = new Uint8Array(columns.length * rows.length);
  columns.forEach((column, n) => levels.set(column, n * rows.length));

  progress(1);
  return {
    passTicks: pass,
    ticks,
    bucketTicks,
    buckets,
    voiceLevel,
    voicePeak,
    voiceActive,
    echoSends,
    samples,
    loudness,
    peak,
    clips,
    correlation,
    echoEnergy,
    echoVolume,
    echoFeedback,
    echoWrites,
    spectrogram: {
      rows: rows.length,
      columns: columns.length,
      levels,
      ticks: Float32Array.from(columnTicks),
    },
    integratedLufs: Math.max(SILENT_DB, meter.integrated()),
    peakDb: peakAll > 0 ? 20 * Math.log10(peakAll) : SILENT_DB,
    clipCount,
    maxPolyphony,
    echoShare: echoHeard / reached,
    seconds: rendered / SPC_SAMPLE_RATE,
    truncated: ticks < pass,
  };
}

/** Every buffer an analysis holds, to transfer rather than copy it across from the worker. */
export function analysisBuffers(analysis: SongAnalysis): ArrayBuffer[] {
  const arrays: ArrayBufferView[] = [
    analysis.voiceLevel,
    analysis.voicePeak,
    analysis.voiceActive,
    analysis.echoSends,
    analysis.loudness,
    analysis.peak,
    analysis.clips,
    analysis.correlation,
    analysis.echoEnergy,
    analysis.echoVolume,
    analysis.echoFeedback,
    analysis.echoWrites,
    analysis.spectrogram.levels,
    analysis.spectrogram.ticks,
    ...analysis.samples.map((lane) => lane.level),
  ];

  return arrays.map((array) => array.buffer as ArrayBuffer);
}
