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
