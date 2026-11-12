import {
  getGenerativeModel,
  InferenceMode,
  Schema,
  type AI,
  type GenerativeModel,
} from 'firebase/ai';
import { cloudModelName } from '../lib/env';
import type { ActualSource } from '../lib/types';

/**
 * Inference boundary (SPEC NFR-1): every AI call in the app passes through
 * Firebase AI Logic. This module is the only place a model is constructed.
 */

export interface StructuredResult {
  text: string;
  /** Actual route from the inference result. Null means it could not be established. */
  inferenceSource: ActualSource | null;
}

/** Plain-text generation returns the same shape: text plus the actual route. */
export type TextResult = StructuredResult;

export interface InferenceAdapter {
  generateStructured(prompt: string): Promise<StructuredResult>;
  generateText(prompt: string): Promise<TextResult>;
  initialiseDeviceModel(onProgress: (value: number) => void): Promise<void>;
}

export const TRIAGE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    category: {
      type: 'string',
      enum: ['billing', 'delivery', 'account', 'product', 'returns', 'technical', 'other'],
    },
    urgency: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative', 'angry'] },
    confidence: { type: 'number' },
    issueCount: { type: 'integer' },
    personalDataCount: { type: 'integer' },
  },
  required: ['category', 'urgency', 'sentiment', 'confidence', 'issueCount', 'personalDataCount'],
  additionalProperties: false,
} as const;

function triageResponseSchema() {
  return Schema.object({
    properties: {
      category: Schema.enumString({
        enum: ['billing', 'delivery', 'account', 'product', 'returns', 'technical', 'other'],
      }),
      urgency: Schema.enumString({ enum: ['low', 'normal', 'high', 'urgent'] }),
      sentiment: Schema.enumString({ enum: ['positive', 'neutral', 'negative', 'angry'] }),
      confidence: Schema.number(),
      issueCount: Schema.integer(),
      personalDataCount: Schema.integer(),
    },
    optionalProperties: [],
  });
}

function mapSource(source: string | undefined): ActualSource | null {
  return source === 'on_device' || source === 'in_cloud' ? source : null;
}

/**
 * A Firebase AI Logic model handle bound to one InferenceMode (DESIGN.md:
 * two standing handles plus the Privacy Mode device-only handle). Structured
 * output uses the route-appropriate configuration from the Firebase hybrid
 * documentation; text generation uses the same mode without a schema.
 */
export abstract class FirebaseHybridAdapter implements InferenceAdapter {
  private structuredModel: GenerativeModel | null = null;
  private textModel: GenerativeModel | null = null;
  private readonly ai: AI;
  private readonly mode: InferenceMode;

  protected constructor(ai: AI, mode: InferenceMode) {
    this.ai = ai;
    this.mode = mode;
  }

  private getStructuredModel(): GenerativeModel {
    if (!this.structuredModel) {
      this.structuredModel = getGenerativeModel(this.ai, {
        mode: this.mode,
        onDeviceParams: {
          promptOptions: { responseConstraint: TRIAGE_JSON_SCHEMA },
        },
        inCloudParams: {
          model: cloudModelName,
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: triageResponseSchema(),
          },
        },
      });
    }
    return this.structuredModel;
  }

  private getTextModel(): GenerativeModel {
    if (!this.textModel) {
      this.textModel = getGenerativeModel(this.ai, {
        mode: this.mode,
        inCloudParams: { model: cloudModelName },
      });
    }
    return this.textModel;
  }

  async generateStructured(prompt: string): Promise<StructuredResult> {
    const result = await this.getStructuredModel().generateContent(prompt);
    return {
      text: result.response.text(),
      inferenceSource: mapSource(result.response.inferenceSource),
    };
  }

  async generateText(prompt: string): Promise<TextResult> {
    const result = await this.getTextModel().generateContent(prompt);
    return {
      text: result.response.text(),
      inferenceSource: mapSource(result.response.inferenceSource),
    };
  }

  async initialiseDeviceModel(onProgress: (value: number) => void): Promise<void> {
    await this.getStructuredModel().initializeDeviceModel(onProgress);
  }
}

/**
 * Device-preferred hybrid model: short, single-turn work prefers Gemini Nano
 * on-device and falls back to the cloud model inside Firebase AI Logic.
 */
export class FirebaseDevicePreferredAdapter extends FirebaseHybridAdapter {
  constructor(ai: AI) {
    super(ai, InferenceMode.PREFER_ON_DEVICE);
  }
}

/**
 * Device-only handle for Privacy Mode (SPEC FR-8): Firebase is asked to run
 * on-device only, so a cloud route is never a valid result from this handle.
 */
export class FirebaseDeviceOnlyAdapter extends FirebaseHybridAdapter {
  constructor(ai: AI) {
    super(ai, InferenceMode.ONLY_ON_DEVICE);
  }
}

/** Cloud-preferred handle; the escalation path consumes it in Slice 3. */
export class FirebaseCloudPreferredAdapter extends FirebaseHybridAdapter {
  constructor(ai: AI) {
    super(ai, InferenceMode.PREFER_IN_CLOUD);
  }
}

/** Test double: returns a fixed response on a fixed route, for both shapes. */
export class StaticAdapter implements InferenceAdapter {
  private readonly text: string;
  private readonly source: ActualSource | null;

  constructor(text: string, source: ActualSource | null) {
    this.text = text;
    this.source = source;
  }

  async generateStructured(): Promise<StructuredResult> {
    return { text: this.text, inferenceSource: this.source };
  }

  async generateText(): Promise<TextResult> {
    return { text: this.text, inferenceSource: this.source };
  }

  async initialiseDeviceModel(): Promise<void> {}
}

/** Test double: every call fails, to prove the visible failed state. */
export class FailingAdapter implements InferenceAdapter {
  private readonly message: string;

  constructor(message = 'Simulated inference failure.') {
    this.message = message;
  }

  async generateStructured(): Promise<StructuredResult> {
    throw new Error(this.message);
  }

  async generateText(): Promise<TextResult> {
    throw new Error(this.message);
  }

  async initialiseDeviceModel(): Promise<void> {
    throw new Error(this.message);
  }
}

/**
 * Test double: wraps another adapter and counts calls per method, so tests
 * can prove a handle was never invoked (Privacy Mode's zero-cloud-call
 * guarantee, T-2.6).
 */
export class CountingAdapter implements InferenceAdapter {
  readonly counts = { structured: 0, text: 0, initialise: 0 };
  private readonly inner: InferenceAdapter;

  constructor(inner: InferenceAdapter) {
    this.inner = inner;
  }

  async generateStructured(prompt: string): Promise<StructuredResult> {
    this.counts.structured += 1;
    return this.inner.generateStructured(prompt);
  }

  async generateText(prompt: string): Promise<TextResult> {
    this.counts.text += 1;
    return this.inner.generateText(prompt);
  }

  async initialiseDeviceModel(onProgress: (value: number) => void): Promise<void> {
    this.counts.initialise += 1;
    return this.inner.initialiseDeviceModel(onProgress);
  }
}
