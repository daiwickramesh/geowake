/**
 * Alarm audio engine.
 *
 * The previous engine played one raw oscillator sweep per beep, which is why the
 * old presets sounded thin and harsh. This version treats each alarm as a short
 * musical pattern rendered through a small mastering chain:
 *
 *   voices -> lowpass -> soft clipper -> compressor -> [dry + delay] -> master
 *
 * That chain is what does most of the work: the lowpass tames square and
 * sawtooth waves, the soft clipper adds gentle saturation instead of digital
 * clipping, the compressor stops overlapping notes from spiking, and the
 * feedback delay adds the short "space" that makes a phone alarm sound like a
 * recording rather than a test tone.
 *
 * Notes are scheduled ahead of time on the AudioContext clock instead of via
 * `setInterval`, so timing does not drift when the main thread is busy, and
 * alarms escalate over the first few cycles the way a real phone alarm does.
 */

export type SoundId =
  // iOS-flavoured
  | "radar"
  | "chime"
  | "sunrise"
  // Android-flavoured
  | "digital"
  | "ringer"
  | "siren"
  | "ripple"
  // gentler option
  | "focus"
  | "custom";

export type SoundGroup = "iOS style" | "Android style" | "Gentle";

export const DEFAULT_SOUND: SoundId = "radar";

/**
 * Presets that used to exist, mapped to the closest replacement so a returning
 * user's saved preference is not silently discarded.
 */
const LEGACY_SOUND_IDS: Record<string, SoundId> = {
  metro: "chime",
  fahhh: "siren",
};

interface Voice {
  /** Seconds from the start of the cycle. */
  at: number;
  /** Note length in seconds. */
  dur: number;
  /** Fundamental frequency in Hz. */
  freq: number;
  /** Optional glide target, reached over `dur`. */
  glideTo?: number;
  wave?: OscillatorType;
  /** Peak level, 0-1, relative to the master bus. */
  gain?: number;
  /** Extra harmonics, e.g. a bell at 2x and 3x the fundamental. */
  partials?: { mult: number; gain: number }[];
  /** Attack time in seconds. Defaults to a percussive 8ms. */
  attack?: number;
  /** Hold the level before releasing, for tones rather than plucks. */
  sustain?: boolean;
}

interface Preset {
  id: SoundId;
  name: string;
  desc: string;
  group: SoundGroup;
  /** Notes for one cycle of the pattern. */
  notes: Voice[];
  /** Nominal length of one cycle in seconds. */
  cycleSec: number;
  /** Lowpass cutoff in Hz applied to this preset. */
  cutoff: number;
  /** How much the pattern tightens as the alarm escalates, 0-0.35. */
  tighten: number;
  /** Cycles spent fading in before full volume. */
  stages: number;
  /** Level on the first cycle and on the final cycle. */
  gainFrom: number;
  gainTo: number;
  /** Vibration pattern in ms, cycled with the audio. Unsupported browsers no-op. */
  vibrate: number[];
}

const note = (
  at: number,
  freq: number,
  dur: number,
  extra: Partial<Voice> = {},
): Voice => ({ at, freq, dur, ...extra });

/** Bell-ish harmonic stack, used by the plucked presets. */
const BELL: { mult: number; gain: number }[] = [
  { mult: 1, gain: 1 },
  { mult: 2, gain: 0.3 },
  { mult: 3.01, gain: 0.11 },
];

const PRESETS: Preset[] = [
  {
    id: "radar",
    name: "Radar",
    desc: "Soft iPhone-style triple blip",
    group: "iOS style",
    // Three rising blips: two short pips then a longer one on the beat.
    notes: [
      note(0, 1174.66, 0.16, { partials: [{ mult: 2, gain: 0.18 }] }),
      note(0.3, 1174.66, 0.16, { partials: [{ mult: 2, gain: 0.18 }] }),
      note(0.6, 1567.98, 0.34, { partials: BELL, attack: 0.01 }),
    ],
    cycleSec: 1.15,
    cutoff: 9000,
    tighten: 0.06,
    stages: 4,
    gainFrom: 0.6,
    gainTo: 1,
    vibrate: [180, 120, 180],
  },
  {
    id: "chime",
    name: "Chime",
    desc: "Warm iOS music-box melody",
    group: "iOS style",
    notes: [
      note(0, 1046.5, 0.5, { partials: BELL, gain: 0.3 }),
      note(0.3, 1318.51, 0.5, { partials: BELL, gain: 0.28 }),
      note(0.6, 1567.98, 0.5, { partials: BELL, gain: 0.26 }),
      note(0.9, 1318.51, 0.6, { partials: BELL, gain: 0.3 }),
    ],
    cycleSec: 1.55,
    cutoff: 7500,
    tighten: 0.05,
    stages: 4,
    gainFrom: 0.6,
    gainTo: 1,
    vibrate: [220, 140, 220, 140, 320],
  },
  {
    id: "sunrise",
    name: "Sunrise",
    desc: "Slow rising arpeggio, easy to wake to",
    group: "Gentle",
    notes: [
      note(0, 523.25, 0.55, { partials: BELL, gain: 0.26 }),
      note(0.24, 659.25, 0.55, { partials: BELL, gain: 0.25 }),
      note(0.48, 783.99, 0.55, { partials: BELL, gain: 0.24 }),
      note(0.72, 1046.5, 0.55, { partials: BELL, gain: 0.26 }),
      note(0.96, 1318.51, 0.9, { partials: BELL, gain: 0.28 }),
    ],
    cycleSec: 2.1,
    cutoff: 7000,
    tighten: 0.04,
    stages: 5,
    gainFrom: 0.5,
    gainTo: 1,
    vibrate: [300, 200, 300],
  },
  {
    id: "digital",
    name: "Digital Beep",
    desc: "Classic Android clock beep",
    group: "Android style",
    notes: [
      note(0, 1046.5, 0.13, { wave: "square", gain: 0.24, sustain: true }),
      note(0.26, 1046.5, 0.13, { wave: "square", gain: 0.24, sustain: true }),
      note(0.52, 784, 0.18, { wave: "square", gain: 0.24, sustain: true }),
    ],
    cycleSec: 0.9,
    // A hard lowpass on the square wave is what makes it read as a clock
    // rather than as a harsh buzz.
    cutoff: 2300,
    tighten: 0.12,
    stages: 4,
    gainFrom: 0.62,
    gainTo: 1,
    vibrate: [120, 100, 120, 100, 120],
  },
  {
    id: "ringer",
    name: "Phone Ringer",
    desc: "Landline-style ring-ring bursts",
    group: "Android style",
    notes: [
      note(0, 440, 0.36, { wave: "square", gain: 0.17, sustain: true }),
      note(0, 480, 0.36, { wave: "square", gain: 0.17, sustain: true }),
      note(0.42, 440, 0.36, { wave: "square", gain: 0.17, sustain: true }),
      note(0.42, 480, 0.36, { wave: "square", gain: 0.17, sustain: true }),
      note(1.02, 440, 0.4, { wave: "square", gain: 0.17, sustain: true }),
      note(1.02, 480, 0.4, { wave: "square", gain: 0.17, sustain: true }),
    ],
    cycleSec: 1.62,
    cutoff: 2100,
    tighten: 0.03,
    stages: 5,
    gainFrom: 0.58,
    gainTo: 1,
    vibrate: [400, 200, 400],
  },
  {
    id: "siren",
    name: "Siren",
    desc: "Rising two-tone emergency wail",
    group: "Android style",
    notes: [
      note(0, 700, 0.55, {
        wave: "sawtooth",
        glideTo: 1120,
        gain: 0.2,
        sustain: true,
        attack: 0.06,
      }),
      note(0.6, 1120, 0.55, {
        wave: "sawtooth",
        glideTo: 700,
        gain: 0.2,
        sustain: true,
        attack: 0.06,
      }),
    ],
    cycleSec: 1.25,
    cutoff: 2000,
    tighten: 0.14,
    stages: 4,
    gainFrom: 0.6,
    gainTo: 1,
    vibrate: [500, 250, 500],
  },
  {
    id: "ripple",
    name: "Ripple",
    desc: "Descending drips, like a water drop",
    group: "Gentle",
    notes: [
      note(0, 1567.98, 0.18, { partials: [{ mult: 2, gain: 0.14 }] }),
      note(0.19, 1318.51, 0.18, { partials: [{ mult: 2, gain: 0.14 }] }),
      note(0.38, 1046.5, 0.18, { partials: [{ mult: 2, gain: 0.14 }] }),
      note(0.57, 880, 0.3, { partials: [{ mult: 2, gain: 0.16 }] }),
    ],
    cycleSec: 0.92,
    cutoff: 8000,
    tighten: 0.08,
    stages: 4,
    gainFrom: 0.55,
    gainTo: 1,
    vibrate: [60, 90, 60, 90, 90],
  },
  {
    id: "focus",
    name: "Deep Focus",
    desc: "Low calm pulse for light sleepers",
    group: "Gentle",
    notes: [
      note(0, 196, 0.55, { gain: 0.3, sustain: true, attack: 0.08, partials: [{ mult: 1.5, gain: 0.2 }] }),
      note(0.6, 261.63, 0.55, { gain: 0.3, sustain: true, attack: 0.08, partials: [{ mult: 1.5, gain: 0.2 }] }),
      note(1.2, 196, 0.55, { gain: 0.3, sustain: true, attack: 0.08, partials: [{ mult: 1.5, gain: 0.2 }] }),
      note(1.8, 261.63, 0.55, { gain: 0.3, sustain: true, attack: 0.08, partials: [{ mult: 1.5, gain: 0.2 }] }),
    ],
    cycleSec: 2.45,
    cutoff: 2400,
    tighten: 0,
    stages: 6,
    gainFrom: 0.5,
    gainTo: 1,
    vibrate: [700],
  },
];

/** Synthesised presets, in the order they are shown in settings. */
export const SOUND_PRESETS: Preset[] = PRESETS;

export const SOUND_IDS: SoundId[] = [...PRESETS.map((p) => p.id), "custom"];

export const CUSTOM_SOUND: SoundId = "custom";

export const isSoundId = (value: unknown): value is SoundId =>
  typeof value === "string" && (SOUND_IDS as string[]).includes(value);

/**
 * Maps a stored preference onto a supported preset, following the legacy
 * renames, and falling back to the default for anything unrecognised.
 */
export const resolveSoundId = (value: unknown): SoundId => {
  if (isSoundId(value)) return value;
  if (typeof value === "string" && value in LEGACY_SOUND_IDS) {
    return LEGACY_SOUND_IDS[value];
  }
  return DEFAULT_SOUND;
};

const presetFor = (sound: SoundId): Preset | null =>
  PRESETS.find((preset) => preset.id === sound) ?? null;

/** How long the engine waits between scheduler ticks. */
const TICK_MS = 40;
/**
 * Notes are placed this far ahead of the clock so timing cannot glitch. It is
 * deliberately longer than a tick: browsers throttle timers on background tabs
 * to roughly once a second, so a shorter window would starve the scheduler and
 * the alarm would gap while the tab is hidden.
 */
const LOOKAHEAD_SEC = 1;
const MASTER_GAIN = 0.85;

export class AlarmEngine {
  private context: AudioContext | null = null;
  private bus: GainNode | null = null;
  private toneFilter: BiquadFilterNode | null = null;
  private preset: Preset | null = null;
  private customElement: HTMLAudioElement | null = null;
  private customUrl: string | null = null;
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  private cycleIndex = 0;
  private nextCycleAt = 0;
  private vibrationTimer: ReturnType<typeof setInterval> | null = null;
  private vibrationOn = true;
  private readonly liveNodes = new Set<AudioScheduledSourceNode>();
  private disposed = false;

  /** Browsers require a user gesture before audio can start. */
  unlock(): void {
    try {
      const context = this.ensureContext();
      if (context.state === "suspended") void context.resume();
    } catch {
      /* audio is best-effort */
    }
  }

  isRinging(): boolean {
    return this.cycleTimer !== null || this.customElement !== null;
  }

  setVibrationEnabled(enabled: boolean): void {
    this.vibrationOn = enabled;
    if (!enabled) this.cancelVibration();
  }

  /** Plays a single cycle (used by the "Test" buttons in settings). */
  preview(sound: SoundId): void {
    try {
      this.stop();
      if (this.disposed) return;
      if (sound === "custom") {
        this.playCustomOnce();
        return;
      }
      const context = this.ensureRunning();
      const preset = presetFor(sound);
      if (!context || !preset) return;
      // Preview at full level so the user hears the real alarm, not the soft
      // first cycle.
      this.scheduleCycle(preset, context.currentTime + 0.05, preset.gainTo);
      if (this.vibrationOn) this.vibrateOnce(preset);
    } catch {
      /* a failed preview must never break the settings UI */
    }
  }

  start(sound: SoundId): void {
    this.stop();
    if (this.disposed) return;

    if (sound === "custom" && this.customUrl) {
      this.startCustomLoop();
      return;
    }

    const preset = presetFor(sound === "custom" ? DEFAULT_SOUND : sound);
    const context = this.ensureRunning();
    if (!preset || !context) return;

    this.preset = preset;
    this.cycleIndex = 0;
    this.nextCycleAt = context.currentTime + 0.08;
    this.cycleTimer = setInterval(() => this.tick(), TICK_MS);
    if (this.vibrationOn) {
      this.vibrationTimer = setInterval(() => this.vibrateOnce(preset), 2000);
    }
  }

  stop(): void {
    if (this.cycleTimer !== null) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
    this.cancelVibration();

    // Notes already scheduled on the audio clock would keep ringing otherwise.
    for (const node of this.liveNodes) {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    }
    this.liveNodes.clear();

    if (this.customElement) {
      try {
        this.customElement.pause();
        this.customElement.currentTime = 0;
      } catch {
        /* ignore */
      }
      this.customElement = null;
    }
  }

  setCustomSource(dataUrl: string | null): void {
    this.customUrl = dataUrl;
  }

  /** Releases the AudioContext; the instance must not be reused afterwards. */
  dispose(): void {
    this.stop();
    this.disposed = true;
    const context = this.context;
    this.context = null;
    this.bus = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => {});
    }
  }

  private ensureContext(): AudioContext {
    if (this.context) return this.context;
    const Ctor =
      typeof window !== "undefined"
        ? window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext
        : undefined;
    if (!Ctor) throw new Error("Web Audio is unavailable in this browser.");
    this.context = new Ctor();
    this.bus = this.createBus(this.context);
    return this.context;
  }

  private ensureRunning(): AudioContext | null {
    try {
      const context = this.ensureContext();
      if (context.state === "suspended") void context.resume();
      return context;
    } catch {
      return null;
    }
  }

  /**
   * Builds the master chain. Everything is created once per context; the only
   * thing a preset changes is the lowpass cutoff.
   */
  private createBus(context: AudioContext): GainNode {
    const input = context.createGain();

    const tone = context.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 8000;
    tone.Q.value = 0.5;

    // Soft saturation: adds a little warmth and, more importantly, keeps peaks
    // from turning into the brittle digital clipping a raw stack produces.
    const shaper = context.createWaveShaper();
    shaper.curve = softClipCurve(1.7);
    shaper.oversample = "2x";

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 12;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.22;

    // A short feedback delay stands in for reverb: it is what stops the alarm
    // sounding like a dry test tone.
    const delay = context.createDelay(0.5);
    delay.delayTime.value = 0.085;
    const feedback = context.createGain();
    feedback.gain.value = 0.28;
    const delayTone = context.createBiquadFilter();
    delayTone.type = "lowpass";
    delayTone.frequency.value = 2600;
    const wet = context.createGain();
    wet.gain.value = 0.16;

    const master = context.createGain();
    master.gain.value = MASTER_GAIN;

    input.connect(tone);
    tone.connect(shaper);
    shaper.connect(compressor);

    compressor.connect(master);
    compressor.connect(delay);
    delay.connect(delayTone);
    delayTone.connect(feedback);
    feedback.connect(delay);
    delayTone.connect(wet);
    wet.connect(master);
    master.connect(context.destination);

    this.toneFilter = tone;
    return input;
  }

  /** Places any cycles that fall inside the lookahead window. */
  private tick(): void {
    const context = this.context;
    const preset = this.preset;
    if (!context || !preset) return;

    try {
      while (this.nextCycleAt < context.currentTime + LOOKAHEAD_SEC) {
        const level = this.levelForStage(preset, this.cycleIndex);
        this.scheduleCycle(preset, this.nextCycleAt, level);
        this.nextCycleAt += this.cycleDurationForStage(preset, this.cycleIndex);
        this.cycleIndex += 1;
      }
    } catch {
      /* a scheduling failure must never break the alarm UI */
    }
  }

  private levelForStage(preset: Preset, cycleIndex: number): number {
    if (preset.stages <= 0) return preset.gainTo;
    const progress = Math.min(cycleIndex, preset.stages) / preset.stages;
    return preset.gainFrom + (preset.gainTo - preset.gainFrom) * progress;
  }

  private cycleDurationForStage(preset: Preset, cycleIndex: number): number {
    const stages = Math.max(1, preset.stages);
    const progress = Math.min(cycleIndex, stages) / stages;
    return preset.cycleSec * (1 - preset.tighten * progress);
  }

  /** Renders one cycle of the pattern starting at `startTime`. */
  private scheduleCycle(preset: Preset, startTime: number, level: number): void {
    const context = this.context;
    if (!context) return;

    if (this.toneFilter) {
      this.toneFilter.frequency.setTargetAtTime(preset.cutoff, startTime, 0.05);
    }

    for (const voice of preset.notes) {
      this.scheduleVoice(voice, startTime + voice.at, level);
    }
  }

  private scheduleVoice(voice: Voice, startTime: number, level: number): void {
    const context = this.context;
    const bus = this.bus;
    if (!context || !bus) return;

    const peak = Math.max(0.0001, (voice.gain ?? 0.28) * level);
    const attack = voice.attack ?? 0.008;
    const end = startTime + voice.dur;

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, startTime);
    envelope.gain.exponentialRampToValueAtTime(peak, startTime + attack);
    if (voice.sustain) {
      // Hold the peak, then release, which suits continuous tones.
      envelope.gain.setValueAtTime(peak, Math.max(startTime + attack, end - voice.dur * 0.3));
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    } else {
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    }
    envelope.connect(bus);

    const startOscillator = (
      freq: number,
      wave: OscillatorType,
      levelScale: number,
    ) => {
      const oscillator = context.createOscillator();
      const partialGain = context.createGain();
      partialGain.gain.value = levelScale;

      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(freq, startTime);
      if (voice.glideTo !== undefined) {
        oscillator.frequency.exponentialRampToValueAtTime(voice.glideTo, end);
      }

      oscillator.connect(partialGain);
      partialGain.connect(envelope);
      oscillator.start(startTime);
      oscillator.stop(end + 0.05);
      this.liveNodes.add(oscillator);
      oscillator.addEventListener("ended", () => this.liveNodes.delete(oscillator), {
        once: true,
      });
    };

    startOscillator(voice.freq, voice.wave ?? "sine", 1);
    for (const partial of voice.partials ?? []) {
      startOscillator(voice.freq * partial.mult, "sine", partial.gain);
    }
  }

  private vibrateOnce(preset: Preset): void {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    try {
      navigator.vibrate(preset.vibrate);
    } catch {
      /* vibration is best-effort */
    }
  }

  private cancelVibration(): void {
    if (this.vibrationTimer !== null) {
      clearInterval(this.vibrationTimer);
      this.vibrationTimer = null;
    }
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      try {
        navigator.vibrate(0);
      } catch {
        /* ignore */
      }
    }
  }

  private createCustomElement(): HTMLAudioElement | null {
    if (typeof window === "undefined" || !this.customUrl) return null;
    if (!this.customElement) {
      const element = new window.Audio(this.customUrl);
      element.loop = true;
      element.preload = "auto";
      this.customElement = element;
    }
    return this.customElement;
  }

  private playCustomOnce(): void {
    const element = this.createCustomElement();
    if (!element) return;
    element.currentTime = 0;
    void element.play().catch(() => {});
  }

  private startCustomLoop(): void {
    const element = this.createCustomElement();
    if (!element) {
      // No usable upload: fall back to a preset so the alarm is still audible.
      this.start(DEFAULT_SOUND);
      return;
    }
    element.loop = true;
    void element.play().catch(() => {});
    // Browsers can pause looping media on their own, so nudge it if that
    // happens. This is the keep-alive the old tone engine provided.
    this.cycleTimer = setInterval(() => {
      if (element.paused) void element.play().catch(() => {});
    }, 1500);
  }
}

/** `tanh`-shaped transfer curve for a gentle saturator. */
function softClipCurve(drive: number): Float32Array<ArrayBuffer> {
  const samples = 1024;
  // Allocated over an explicit ArrayBuffer so the result is a plain
  // `Float32Array<ArrayBuffer>`, which is what `WaveShaper.curve` expects.
  const curve = new Float32Array(new ArrayBuffer(samples * Float32Array.BYTES_PER_ELEMENT));
  const norm = Math.tanh(drive);
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}
