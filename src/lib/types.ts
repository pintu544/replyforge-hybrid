/**
 * Core domain types for ReplyForge Hybrid.
 * Shapes follow spec/DESIGN.md (Data Model). Route events deliberately have
 * no text fields: no ticket text, prompt text, or unmasked personal data may
 * ever be added here (SPEC NFR-3).
 */

export type TicketSource = 'fixture' | 'manual';

export type TicketStatus =
  | 'inbox'
  | 'triaged'
  | 'draft-ready'
  | 'escalated'
  | 'sent-simulated'
  | 'queued'
  | 'blocked'
  | 'failed';

export type ExpectedRoute = 'device' | 'cloud';

export type Category =
  | 'billing'
  | 'delivery'
  | 'account'
  | 'product'
  | 'returns'
  | 'technical'
  | 'other';

export type Urgency = 'low' | 'normal' | 'high' | 'urgent';
export type Sentiment = 'positive' | 'neutral' | 'negative' | 'angry';

/** Gold labels carried by fixture tickets. Hidden from the normal workflow. */
export interface FixtureGold {
  fixtureVersion: number;
  category: Category;
  urgency: Urgency;
  sentiment: Sentiment;
  issueCount: number;
  language: string;
  expectedRoute: ExpectedRoute;
  escalationTrigger: string | null;
  personalData: { type: string; count: number }[];
}

export interface TriageResult {
  category: Category;
  urgency: Urgency;
  sentiment: Sentiment;
  /** 0..1 */
  confidence: number;
  issueCount: number;
  personalDataCount: number;
  /** Actual route reported by the inference result — never the requested mode. */
  actualSource: ActualSource;
  latencyMs: number;
  completedAt: string;
}

export interface Ticket {
  id: string;
  ownerUid: string;
  source: TicketSource;
  subject: string;
  body: string;
  /** ISO timestamp. Fixture tickets derive this from the fixture reference time plus an offset. */
  receivedAt: string;
  status: TicketStatus;
  language: string;
  triage: TriageResult | null;
  fixture: FixtureGold | null;
  /** Redacted summary produced on-device (Slice 2); null until redaction runs. */
  redactedSummary: string | null;
  /** Number of distinct personal-data items redacted from this ticket. */
  redactionCount: number;
  /** Whether the last AI task on this ticket ran under Privacy Mode. */
  privacyMode: boolean;
}

/** Personal-data pattern types the deterministic checks cover (Slice 2). */
export type PersonalDataType =
  | 'email'
  | 'phone'
  | 'order-id'
  | 'payment-reference'
  | 'postal-address'
  | 'name';

/**
 * One distinct personal-data item found by the deterministic checks.
 * Only the masked value is kept — the raw value is never duplicated into
 * an entity, a log, or a route event (SPEC NFR-3, DESIGN.md data model).
 */
export interface PersonalDataEntity {
  type: PersonalDataType;
  maskedValue: string;
  /** Occurrences of this distinct value in the ticket (subject + body). */
  count: number;
}

export const REDACTED_ARTEFACT_BRAND: unique symbol = Symbol('RedactedArtefact');

/**
 * The redacted artefact: the ONLY bridge from a raw ticket to a cloud
 * payload (DESIGN.md). It can be produced solely by
 * `produceRedactedArtefact` in services/redaction.ts — the brand makes it
 * a compile-time error to hand the payload builder anything else, and the
 * builder re-checks the brand at runtime.
 */
export interface RedactedArtefact {
  readonly [REDACTED_ARTEFACT_BRAND]: true;
  sourceTicketId: string;
  redactedSubject: string;
  redactedBody: string;
  redactedSummary: string;
  entities: PersonalDataEntity[];
  /** Distinct personal-data items redacted (sum of distinct values per type). */
  redactionCount: number;
}

/**
 * The complete cloud escalation payload contract (DESIGN.md). A raw-body
 * field does not exist on this type by design.
 */
export interface RedactedEscalation {
  redactedSummary: string;
  category: Category;
  urgency: Urgency;
  sentiment: Sentiment;
  /** Assigned by the routing engine (Slice 3); null on the simple path. */
  escalationTrigger: string | null;
  issueCount: number;
  bodyCharacterCount: number;
  redactionCount: number;
}

export type PayloadGateStatus = 'minimised' | 'held-for-review' | 'blocked';

/** Outcome of the cloud-payload safety gate (SPEC FR-7, TASKS T-2.3). */
export interface PayloadGate {
  status: PayloadGateStatus;
  /** Labelled pattern types that survived into the payload (blocked only). */
  survivingTypes: PersonalDataType[];
  /** Human-readable explanation for the operator. */
  note: string;
}

export type DraftState = 'draft' | 'edited' | 'sent-simulated';

/**
 * A reply draft (DESIGN.md). For a manually written draft there was no AI
 * task, so requestedMode/actualSource/latencyMs are null — the record must
 * not invent a route for work the model never did.
 */
export interface Draft {
  id: string;
  ticketId: string;
  text: string;
  requestedMode: RequestedMode | null;
  actualSource: ActualSource | null;
  latencyMs: number | null;
  escalationReason: string | null;
  state: DraftState;
  updatedAt: string;
}

export type TaskType = 'triage' | 'redaction' | 'simple-draft' | 'escalation-draft' | 'evaluation';

export type RequestedMode = 'prefer_on_device' | 'only_on_device' | 'prefer_in_cloud' | 'only_in_cloud';

/** Values of Firebase AI Logic's InferenceSource, plus null for a failed attempt. */
export type ActualSource = 'on_device' | 'in_cloud';

export type RouteOutcome = 'success' | 'fallback' | 'blocked' | 'failed';

export interface RouteEvent {
  id: string;
  ticketId: string;
  taskType: TaskType;
  requestedMode: RequestedMode;
  actualSource: ActualSource | null;
  latencyMs: number;
  outcome: RouteOutcome;
  escalationTrigger: string | null;
  redactionCount: number;
  online: boolean;
  browserFamily: string;
  chromeVersion: string | null;
  createdAt: string;
}

/**
 * One ticket's outcome inside an EvaluationRun (Slice 3, TASKS T-3.4).
 * Labels, counts, and decisions only — no ticket text (NFR-3 applies to
 * evaluation records exactly as it does to route events).
 */
export interface EvaluationTicketResult {
  ticketId: string;
  expectedRoute: ExpectedRoute;
  /** The path the routing engine selected; null when triage failed. */
  selectedRoute: 'simple' | 'escalate' | null;
  trigger: string | null;
  correct: boolean;
  /** Actual route of the evaluation triage, from its inference result. */
  triageActualSource: ActualSource | null;
  redactionCount: number;
  /** Labelled personal-data items for this ticket (gold). */
  labelledCount: number;
  /** Labelled patterns found surviving in the built payload. */
  survivingPatterns: number;
}

/**
 * A repeatable run of the routing pipeline over the whole fixture set
 * (DESIGN.md data model, extended with the measured route split and the
 * per-ticket results so comparisons stay reproducible).
 */
export interface EvaluationRun {
  id: string;
  fixtureVersion: number;
  ticketCount: number;
  correctRoutes: number;
  /** correctRoutes / ticketCount, 0..1. */
  accuracy: number;
  labelledRedactions: number;
  survivingLabelledPatterns: number;
  /** Measured triage routes during the run — actuals, never labels. */
  onDeviceCount: number;
  inCloudCount: number;
  failedCount: number;
  deviceDescription: string;
  chromeVersion: string | null;
  createdAt: string;
  results: EvaluationTicketResult[];
}

/** The raw fixture record shape in fixtures/tickets.json. */
export interface FixtureTicketRecord {
  id: string;
  subject: string;
  body: string;
  receivedOffsetMinutes: number;
  category: Category;
  urgency: Urgency;
  sentiment: Sentiment;
  issueCount: number;
  language: string;
  expectedRoute: ExpectedRoute;
  escalationTrigger: string | null;
  personalData: { type: string; count: number }[];
}

export interface FixtureFile {
  fixtureVersion: number;
  referenceTime: string;
  tickets: FixtureTicketRecord[];
}
