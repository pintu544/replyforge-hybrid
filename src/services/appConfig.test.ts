import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fixtureFileJson from '../../fixtures/tickets.json';
import type { FixtureFile } from '../lib/types';
import {
  DEFAULT_ROUTING_CONFIG,
  loadAppConfig,
  mergeRemoteValues,
  remoteConfigDefaults,
  REMOTE_CONFIG_KEYS,
} from './appConfig';
import { produceRedactedArtefact } from './redaction';
import { decideRoute } from './routing';
import { buildTriagePrompt } from './triage';
import { buildDraftPrompt } from './drafts';
import type { Ticket } from '../lib/types';

const fixtureFile = fixtureFileJson as FixtureFile;

describe('app config (T-3.1)', () => {
  it('resolves to the documented defaults when Remote Config is unavailable', async () => {
    await expect(loadAppConfig(null)).resolves.toEqual(DEFAULT_ROUTING_CONFIG);
    expect(mergeRemoteValues({})).toEqual(DEFAULT_ROUTING_CONFIG);
  });

  it('merges valid remote values and falls back per-field on bad ones', () => {
    const merged = mergeRemoteValues({
      [REMOTE_CONFIG_KEYS.escalationLengthChars]: '250',
      [REMOTE_CONFIG_KEYS.escalationConfidenceMin]: '0.75',
      [REMOTE_CONFIG_KEYS.cloudModelName]: 'some-other-model',
      [REMOTE_CONFIG_KEYS.triagePrompt]: 'Custom triage {{subject}} {{body}}',
    });
    expect(merged.escalationLengthChars).toBe(250);
    expect(merged.escalationConfidenceMin).toBe(0.75);
    expect(merged.cloudModelName).toBe('some-other-model');
    expect(merged.triagePrompt).toBe('Custom triage {{subject}} {{body}}');

    const bad = mergeRemoteValues({
      [REMOTE_CONFIG_KEYS.escalationLengthChars]: 'not-a-number',
      [REMOTE_CONFIG_KEYS.escalationConfidenceMin]: '7',
      [REMOTE_CONFIG_KEYS.escalationKeywordsVersion]: 'v99-unknown',
      [REMOTE_CONFIG_KEYS.cloudModelName]: '   ',
      [REMOTE_CONFIG_KEYS.draftPrompt]: '',
    });
    expect(bad.escalationLengthChars).toBe(DEFAULT_ROUTING_CONFIG.escalationLengthChars);
    expect(bad.escalationConfidenceMin).toBe(DEFAULT_ROUTING_CONFIG.escalationConfidenceMin);
    expect(bad.escalationKeywordsVersion).toBe(DEFAULT_ROUTING_CONFIG.escalationKeywordsVersion);
    expect(bad.cloudModelName).toBe(DEFAULT_ROUTING_CONFIG.cloudModelName);
    expect(bad.draftPrompt).toBe(DEFAULT_ROUTING_CONFIG.draftPrompt);
  });

  it('remoteconfig.template.json carries exactly the in-code defaults', () => {
    const template = JSON.parse(
      readFileSync('remoteconfig.template.json', 'utf8'),
    ) as { parameters: Record<string, { defaultValue: { value: string } }> };
    const defaults = remoteConfigDefaults();
    expect(Object.keys(template.parameters).sort()).toEqual(Object.keys(defaults).sort());
    for (const [key, value] of Object.entries(defaults)) {
      expect(template.parameters[key].defaultValue.value).toBe(value);
    }
  });

  it('the defaults reproduce the pre-Slice-3 prompts byte for byte', () => {
    const ticket = {
      id: 'T-1',
      subject: 'Where is my order?',
      body: 'Hello, I placed an order four days ago.',
    } as Ticket;
    expect(buildTriagePrompt(ticket)).toBe(
      [
        'You are the triage step of a customer-support inbox.',
        'Classify the ticket below and reply with JSON only, matching the schema exactly.',
        'category: billing, delivery, account, product, returns, technical, or other.',
        'urgency: low, normal, high, or urgent.',
        'sentiment: positive, neutral, negative, or angry.',
        'confidence: your confidence in this classification, from 0 to 1.',
        'issueCount: the number of distinct problems the customer raises (at least 1).',
        'personalDataCount: how many items of personal data appear (names, e-mail addresses, telephone numbers, postal addresses, order identifiers, payment references). Count items, not types.',
        '',
        'Subject: Where is my order?',
        'Message:',
        'Hello, I placed an order four days ago.',
      ].join('\n'),
    );
    const artefact = produceRedactedArtefact(ticket);
    expect(buildDraftPrompt(artefact, { ...ticket, triage: null })).toContain(
      'Triage has not been run for this ticket.',
    );
    // A Remote Config template is honoured when supplied.
    expect(buildTriagePrompt(ticket, 'RC TEMPLATE {{subject}}')).toBe(
      'RC TEMPLATE Where is my order?',
    );
  });

  it('defaults produce the labelled routing on fixture spot checks (all 30)', () => {
    // Inputs are the fixture's own gold triage fields plus the redacted
    // artefact — the deterministic half of the pipeline. Gold carries no
    // confidence, so low-confidence-labelled tickets are spot-checked
    // with a low confidence input, the rest with a high one.
    for (const record of fixtureFile.tickets) {
      const artefact = produceRedactedArtefact(record);
      const decision = decideRoute(
        {
          sentiment: record.sentiment,
          confidence: record.escalationTrigger === 'low-confidence' ? 0.4 : 0.95,
          issueCount: record.issueCount,
          language: record.language,
          redactedText: `${artefact.redactedSubject}\n${artefact.redactedBody}`,
          redactedBodyChars: artefact.redactedBody.length,
        },
        DEFAULT_ROUTING_CONFIG,
      );
      expect(decision.route, record.id).toBe(
        record.expectedRoute === 'cloud' ? 'escalate' : 'simple',
      );
      if (record.expectedRoute === 'cloud') {
        // Two gold labels name the second matching trigger under the
        // engine's documented priority (RF-021 length before multiple
        // issues; RF-030 sentiment before low confidence). The route —
        // the figure the evaluation scores — agrees on all 30.
        const expectedTrigger =
          record.id === 'RF-021'
            ? 'length-complexity'
            : record.id === 'RF-030'
              ? 'negative-sentiment'
              : record.escalationTrigger;
        expect(decision.trigger, record.id).toBe(expectedTrigger);
      }
    }
  });
});
