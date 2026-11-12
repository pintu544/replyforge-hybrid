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

export interface InferenceAdapter {
  generateStructured(prompt: string): Promise<StructuredResult>;
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

/**
 * Device-preferred hybrid model: short, single-turn work prefers Gemini Nano
 * on-device and falls back to the cloud model inside Firebase AI Logic.
 * Structured output is requested on both routes (responseConstraint for the
 * Prompt API, responseSchema for the cloud).
 */
export class FirebaseDevicePreferredAdapter implements InferenceAdapter {
  private model: GenerativeModel | null = null;
  private readonly ai: AI;

  constructor(ai: AI) {
    this.ai = ai;
  }

  private getModel(): GenerativeModel {
    if (!this.model) {
      this.model = getGenerativeModel(this.ai, {
        mode: InferenceMode.PREFER_ON_DEVICE,
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
    return this.model;
  }

  async generateStructured(prompt: string): Promise<StructuredResult> {
    const result = await this.getModel().generateContent(prompt);
    const source = result.response.inferenceSource;
    return {
      text: result.response.text(),
      inferenceSource: source === 'on_device' || source === 'in_cloud' ? source : null,
    };
  }

  async initialiseDeviceModel(onProgress: (value: number) => void): Promise<void> {
    await this.getModel().initializeDeviceModel(onProgress);
  }
}

/** Test double: returns a fixed structured response on a fixed route. */
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

  async initialiseDeviceModel(): Promise<void> {
    throw new Error(this.message);
  }
}
