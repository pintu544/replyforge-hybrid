import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTING_CONFIG } from './appConfig';
import { decideRoute, type RoutingInput } from './routing';

const base: RoutingInput = {
  sentiment: 'neutral',
  confidence: 0.95,
  issueCount: 1,
  language: 'en',
  redactedText: 'Hello, my order has not arrived yet and I would like an update.',
  redactedBodyChars: 120,
};

const config = DEFAULT_ROUTING_CONFIG;

describe('routing engine (T-3.2)', () => {
  it('keeps a ticket with no trigger on the simple path', () => {
    const decision = decideRoute(base, config);
    expect(decision.route).toBe('simple');
    expect(decision.trigger).toBeNull();
  });

  it('escalates an unsupported on-device language', () => {
    const decision = decideRoute({ ...base, language: 'hi' }, config);
    expect(decision.route).toBe('escalate');
    expect(decision.trigger).toBe('unsupported-language');
  });

  it('escalates refund/legal intent from keywords in the redacted text', () => {
    const chargeback = decideRoute(
      { ...base, redactedText: 'I will raise a chargeback with my bank.' },
      config,
    );
    expect(chargeback.trigger).toBe('refund-legal-intent');
    const solicitor = decideRoute(
      { ...base, redactedText: 'My solicitor will take this up directly.' },
      config,
    );
    expect(solicitor.trigger).toBe('refund-legal-intent');
  });

  it('does not treat a bare refund request as refund/legal intent', () => {
    // Fixture RF-024 demands a refund in plain words and is labelled
    // negative-sentiment: the word "refund" alone is not in the set.
    const decision = decideRoute(
      { ...base, redactedText: 'I DEMAND a refund today. Refund it today.' },
      config,
    );
    expect(decision.trigger).not.toBe('refund-legal-intent');
    expect(decision.route).toBe('simple');
  });

  it('escalates over the length threshold, and not at it', () => {
    const over = decideRoute(
      { ...base, redactedBodyChars: config.escalationLengthChars + 1 },
      config,
    );
    expect(over.trigger).toBe('length-complexity');
    const at = decideRoute({ ...base, redactedBodyChars: config.escalationLengthChars }, config);
    expect(at.route).toBe('simple');
  });

  it('escalates multiple issues', () => {
    const decision = decideRoute({ ...base, issueCount: 2 }, config);
    expect(decision.trigger).toBe('multiple-issues');
  });

  it('escalates an angry customer as negative sentiment; a merely negative one stays simple', () => {
    const angry = decideRoute({ ...base, sentiment: 'angry' }, config);
    expect(angry.trigger).toBe('negative-sentiment');
    const negative = decideRoute({ ...base, sentiment: 'negative' }, config);
    expect(negative.route).toBe('simple');
  });

  it('escalates low confidence below the minimum, and not at it', () => {
    const low = decideRoute(
      { ...base, confidence: config.escalationConfidenceMin - 0.01 },
      config,
    );
    expect(low.trigger).toBe('low-confidence');
    const at = decideRoute({ ...base, confidence: config.escalationConfidenceMin }, config);
    expect(at.route).toBe('simple');
  });

  it('applies the documented priority when triggers conflict', () => {
    // Language outranks everything: the device route cannot serve it.
    expect(
      decideRoute({ ...base, language: 'bn', redactedText: 'chargeback' }, config).trigger,
    ).toBe('unsupported-language');
    // Refund/legal outranks sentiment (both are present in fixture RF-020).
    expect(
      decideRoute({ ...base, sentiment: 'angry', redactedText: 'chargeback' }, config).trigger,
    ).toBe('refund-legal-intent');
    // Length outranks multiple issues (fixture RF-021 carries both; its
    // gold label names multiple-issues — the route agrees either way).
    expect(decideRoute({ ...base, redactedBodyChars: 900, issueCount: 3 }, config).trigger).toBe(
      'length-complexity',
    );
    // Sentiment outranks low confidence (fixture RF-030 carries both).
    expect(decideRoute({ ...base, sentiment: 'angry', confidence: 0.3 }, config).trigger).toBe(
      'negative-sentiment',
    );
  });
});
