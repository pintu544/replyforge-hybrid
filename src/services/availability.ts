/**
 * Availability controller (DESIGN.md). Reads the Chrome Prompt API state that
 * Firebase AI Logic's hybrid mode wraps, and owns the user-gesture-only
 * device-model initialisation flow. A missing LanguageModel object means
 * "unavailable" — never an exception (SPIKE-VERDICT.md).
 */

export type DeviceAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

export interface LanguageModelProbe {
  hasApi(): boolean;
  availability(): Promise<string>;
}

interface LanguageModelGlobal {
  availability: () => Promise<string>;
}

function globalLanguageModel(): LanguageModelGlobal | null {
  const w = globalThis as unknown as { LanguageModel?: LanguageModelGlobal };
  return typeof w.LanguageModel !== 'undefined' ? w.LanguageModel : null;
}

export const browserLanguageModelProbe: LanguageModelProbe = {
  hasApi: () => globalLanguageModel() !== null,
  availability: async () => {
    const lm = globalLanguageModel();
    if (!lm) return 'unavailable';
    return lm.availability();
  },
};

export function mapAvailability(raw: string): DeviceAvailability {
  switch (raw) {
    case 'available':
      return 'available';
    case 'downloadable':
      return 'downloadable';
    case 'downloading':
      return 'downloading';
    default:
      return 'unavailable';
  }
}

export async function probeAvailability(
  probe: LanguageModelProbe = browserLanguageModelProbe,
): Promise<DeviceAvailability> {
  if (!probe.hasApi()) return 'unavailable';
  try {
    return mapAvailability(await probe.availability());
  } catch {
    return 'unavailable';
  }
}

export type DeviceInitialiser = (onProgress: (value: number) => void) => Promise<void>;

export interface AvailabilitySnapshot {
  state: DeviceAvailability;
  /** 0..1 while a download is in progress, otherwise null. */
  downloadProgress: number | null;
  error: string | null;
  checking: boolean;
}

type Listener = (snapshot: AvailabilitySnapshot) => void;

export class AvailabilityController {
  private snapshot: AvailabilitySnapshot = {
    state: 'unavailable',
    downloadProgress: null,
    error: null,
    checking: true,
  };
  private listeners = new Set<Listener>();

  private readonly probe: LanguageModelProbe;
  private readonly initialiser: DeviceInitialiser | null;

  constructor(
    probe: LanguageModelProbe = browserLanguageModelProbe,
    initialiser: DeviceInitialiser | null = null,
  ) {
    this.probe = probe;
    this.initialiser = initialiser;
  }

  getSnapshot(): AvailabilitySnapshot {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setSnapshot(patch: Partial<AvailabilitySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  async refresh(): Promise<DeviceAvailability> {
    this.setSnapshot({ checking: true });
    const state = await probeAvailability(this.probe);
    this.setSnapshot({ state, checking: false });
    return state;
  }

  /**
   * Must be called from a user gesture (button click): Chrome requires a
   * user interaction before a model download may begin. This method is only
   * ever wired to the panel's enable button — nothing calls it on load.
   */
  async enable(): Promise<void> {
    if (!this.initialiser) {
      this.setSnapshot({
        error: 'On-device initialisation is unavailable because Firebase is not configured.',
      });
      return;
    }
    this.setSnapshot({ state: 'downloading', downloadProgress: 0, error: null });
    try {
      await this.initialiser((value) => {
        this.setSnapshot({ downloadProgress: value });
      });
      const state = await probeAvailability(this.probe);
      this.setSnapshot({
        state: state === 'unavailable' ? 'available' : state,
        downloadProgress: null,
      });
    } catch (err) {
      this.setSnapshot({
        state: 'unavailable',
        downloadProgress: null,
        error:
          err instanceof Error
            ? err.message
            : 'The on-device model could not be initialised on this machine.',
      });
    }
  }
}
