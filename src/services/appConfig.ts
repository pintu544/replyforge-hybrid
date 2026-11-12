import type { FirebaseApp } from 'firebase/app';
import { cloudModelName } from '../lib/env';
import {
  DEFAULT_DRAFT_PROMPT,
  DEFAULT_ESCALATION_PROMPT,
  DEFAULT_TRIAGE_PROMPT,
} from './prompts';

/**
 * Routing configuration (TASKS T-3.1). Escalation thresholds, model names,
 * the keyword-set version, and the three prompts are owned by Firebase
 * Remote Config (DESIGN.md); the values below are the documented in-code
 * defaults, and they are also the defaults published in
 * `remoteconfig.template.json`. If Remote Config cannot be fetched —
 * offline, unconfigured project, a test environment — the app runs on
 * these defaults and routing behaviour is unchanged.
 */

export interface RoutingConfig {
  /** Redacted-body character count above which a ticket escalates. */
  escalationLengthChars: number;
  /** Triage confidence below which a ticket escalates. */
  escalationConfidenceMin: number;
  /** Version of the refund/legal keyword set in use. */
  escalationKeywordsVersion: string;
  /** The keyword set selected by `escalationKeywordsVersion`. */
  escalationKeywords: string[];
  /** Informational: the on-device model is Gemini Nano; the SDK does not take a name for it. */
  deviceModelName: string;
  /** Cloud model used by Firebase AI Logic for in-cloud inference. */
  cloudModelName: string;
  triagePrompt: string;
  draftPrompt: string;
  escalationPrompt: string;
}

/**
 * Refund/legal keyword sets, by version. The set targets legal-escalation
 * language (chargeback, solicitor, statutory…), NOT a bare refund request:
 * fixture ticket RF-024 demands a refund in plain words and is labelled
 * negative-sentiment, so the word "refund" alone must not select this
 * trigger. Keywords are matched against the REDACTED text (routing.ts) —
 * they are not personal data and survive redaction.
 */
export const ESCALATION_KEYWORD_SETS: Record<string, string[]> = {
  v1: [
    'chargeback',
    'consumer forum',
    'solicitor',
    'lawyer',
    'legal action',
    'legal notice',
    'court',
    'statutory',
    'formal notice',
    'data protection',
    'ombudsman',
    'lawsuit',
  ],
};

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  escalationLengthChars: 400,
  escalationConfidenceMin: 0.6,
  escalationKeywordsVersion: 'v1',
  escalationKeywords: ESCALATION_KEYWORD_SETS.v1,
  deviceModelName: 'gemini-nano',
  cloudModelName,
  triagePrompt: DEFAULT_TRIAGE_PROMPT,
  draftPrompt: DEFAULT_DRAFT_PROMPT,
  escalationPrompt: DEFAULT_ESCALATION_PROMPT,
};

/** Remote Config parameter names (DESIGN.md). */
export const REMOTE_CONFIG_KEYS = {
  escalationLengthChars: 'escalation_length_chars',
  escalationConfidenceMin: 'escalation_confidence_min',
  escalationKeywordsVersion: 'escalation_keywords_version',
  deviceModelName: 'device_model_name',
  cloudModelName: 'cloud_model_name',
  triagePrompt: 'triage_prompt',
  draftPrompt: 'draft_prompt',
  escalationPrompt: 'escalation_prompt',
} as const;

/**
 * Merges raw Remote Config string values over the defaults, field by
 * field. A missing, empty, or unparsable value falls back to that field's
 * default only — one bad parameter never discards the rest, and an
 * unknown keyword-set version falls back to the default set (routing.ts
 * documents the behaviour either way).
 */
export function mergeRemoteValues(values: Record<string, string | undefined>): RoutingConfig {
  const config: RoutingConfig = { ...DEFAULT_ROUTING_CONFIG };

  const length = Number(values[REMOTE_CONFIG_KEYS.escalationLengthChars]);
  if (Number.isFinite(length) && length > 0) {
    config.escalationLengthChars = Math.round(length);
  }

  const confidence = Number(values[REMOTE_CONFIG_KEYS.escalationConfidenceMin]);
  if (
    values[REMOTE_CONFIG_KEYS.escalationConfidenceMin] !== undefined &&
    Number.isFinite(confidence) &&
    confidence > 0 &&
    confidence <= 1
  ) {
    config.escalationConfidenceMin = confidence;
  }

  const version = values[REMOTE_CONFIG_KEYS.escalationKeywordsVersion]?.trim();
  if (version && ESCALATION_KEYWORD_SETS[version]) {
    config.escalationKeywordsVersion = version;
    config.escalationKeywords = ESCALATION_KEYWORD_SETS[version];
  }

  const deviceModel = values[REMOTE_CONFIG_KEYS.deviceModelName]?.trim();
  if (deviceModel) config.deviceModelName = deviceModel;

  const cloudModel = values[REMOTE_CONFIG_KEYS.cloudModelName]?.trim();
  if (cloudModel) config.cloudModelName = cloudModel;

  const triagePrompt = values[REMOTE_CONFIG_KEYS.triagePrompt];
  if (triagePrompt && triagePrompt.trim().length > 0) config.triagePrompt = triagePrompt;
  const draftPrompt = values[REMOTE_CONFIG_KEYS.draftPrompt];
  if (draftPrompt && draftPrompt.trim().length > 0) config.draftPrompt = draftPrompt;
  const escalationPrompt = values[REMOTE_CONFIG_KEYS.escalationPrompt];
  if (escalationPrompt && escalationPrompt.trim().length > 0) {
    config.escalationPrompt = escalationPrompt;
  }

  return config;
}

/** The defaults expressed as Remote Config's string-valued default map. */
export function remoteConfigDefaults(): Record<string, string> {
  return {
    [REMOTE_CONFIG_KEYS.escalationLengthChars]: String(DEFAULT_ROUTING_CONFIG.escalationLengthChars),
    [REMOTE_CONFIG_KEYS.escalationConfidenceMin]: String(DEFAULT_ROUTING_CONFIG.escalationConfidenceMin),
    [REMOTE_CONFIG_KEYS.escalationKeywordsVersion]: DEFAULT_ROUTING_CONFIG.escalationKeywordsVersion,
    [REMOTE_CONFIG_KEYS.deviceModelName]: DEFAULT_ROUTING_CONFIG.deviceModelName,
    [REMOTE_CONFIG_KEYS.cloudModelName]: DEFAULT_ROUTING_CONFIG.cloudModelName,
    [REMOTE_CONFIG_KEYS.triagePrompt]: DEFAULT_ROUTING_CONFIG.triagePrompt,
    [REMOTE_CONFIG_KEYS.draftPrompt]: DEFAULT_ROUTING_CONFIG.draftPrompt,
    [REMOTE_CONFIG_KEYS.escalationPrompt]: DEFAULT_ROUTING_CONFIG.escalationPrompt,
  };
}

const FETCH_TIMEOUT_MS = 5_000;

/**
 * Loads the routing configuration from Firebase Remote Config. Any
 * failure — no app, SDK error, fetch timeout while offline — resolves to
 * the in-code defaults; this function never rejects, so the app can await
 * it during start-up without a failure state of its own.
 */
export async function loadAppConfig(app: FirebaseApp | null): Promise<RoutingConfig> {
  if (!app) return DEFAULT_ROUTING_CONFIG;
  try {
    const { getRemoteConfig, fetchAndActivate, getValue } = await import('firebase/remote-config');
    const remoteConfig = getRemoteConfig(app);
    remoteConfig.settings.minimumFetchIntervalMillis = 3_600_000;
    remoteConfig.defaultConfig = remoteConfigDefaults();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), FETCH_TIMEOUT_MS);
    });
    try {
      await Promise.race([fetchAndActivate(remoteConfig), expired]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const values: Record<string, string | undefined> = {};
    for (const key of Object.values(REMOTE_CONFIG_KEYS)) {
      const value = getValue(remoteConfig, key).asString();
      values[key] = value.length > 0 ? value : undefined;
    }
    return mergeRemoteValues(values);
  } catch {
    return DEFAULT_ROUTING_CONFIG;
  }
}
