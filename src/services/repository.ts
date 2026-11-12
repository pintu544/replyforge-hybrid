import {
  collection,
  doc,
  getDocs,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import type { Draft, RouteEvent, Ticket } from '../lib/types';

/**
 * Persistence boundary. All private records live under the signed-in user's
 * Firestore partition (DESIGN.md); the in-memory implementation exists for
 * automated tests and never holds production data.
 */
export interface TicketRepository {
  listTickets(ownerUid: string): Promise<Ticket[]>;
  saveTicket(ticket: Ticket): Promise<void>;
  listRouteEvents(ownerUid: string): Promise<RouteEvent[]>;
  addRouteEvent(ownerUid: string, event: RouteEvent): Promise<void>;
  listDrafts(ownerUid: string): Promise<Draft[]>;
  saveDraft(ownerUid: string, draft: Draft): Promise<void>;
}

/**
 * Slice 1 ticket documents predate the Slice 2 fields; normalise on read
 * so older records behave exactly like freshly created ones.
 */
export function normaliseTicket(raw: Ticket): Ticket {
  return {
    ...raw,
    redactedSummary: raw.redactedSummary ?? null,
    redactionCount: raw.redactionCount ?? 0,
    privacyMode: raw.privacyMode ?? false,
  };
}

export class FirestoreTicketRepository implements TicketRepository {
  private readonly db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  async listTickets(ownerUid: string): Promise<Ticket[]> {
    const snap = await getDocs(collection(this.db, 'users', ownerUid, 'tickets'));
    const tickets = snap.docs.map((d) => normaliseTicket(d.data() as Ticket));
    return tickets.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  async saveTicket(ticket: Ticket): Promise<void> {
    await setDoc(doc(this.db, 'users', ticket.ownerUid, 'tickets', ticket.id), ticket);
  }

  async listRouteEvents(ownerUid: string): Promise<RouteEvent[]> {
    const snap = await getDocs(collection(this.db, 'users', ownerUid, 'routeEvents'));
    const events = snap.docs.map((d) => d.data() as RouteEvent);
    return events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async addRouteEvent(ownerUid: string, event: RouteEvent): Promise<void> {
    await setDoc(doc(this.db, 'users', ownerUid, 'routeEvents', event.id), event);
  }

  async listDrafts(ownerUid: string): Promise<Draft[]> {
    const snap = await getDocs(collection(this.db, 'users', ownerUid, 'drafts'));
    const drafts = snap.docs.map((d) => d.data() as Draft);
    return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async saveDraft(ownerUid: string, draft: Draft): Promise<void> {
    await setDoc(doc(this.db, 'users', ownerUid, 'drafts', draft.id), draft);
  }
}

/** Test double with identical semantics to the Firestore implementation. */
export class MemoryTicketRepository implements TicketRepository {
  private tickets = new Map<string, Ticket>();
  private events = new Map<string, RouteEvent[]>();
  private drafts = new Map<string, Draft>();

  private key(ownerUid: string, id: string): string {
    return `${ownerUid}::${id}`;
  }

  async listTickets(ownerUid: string): Promise<Ticket[]> {
    const all = [...this.tickets.values()]
      .filter((t) => t.ownerUid === ownerUid)
      .map(normaliseTicket);
    return all.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  async saveTicket(ticket: Ticket): Promise<void> {
    this.tickets.set(this.key(ticket.ownerUid, ticket.id), structuredClone(ticket));
  }

  async listRouteEvents(ownerUid: string): Promise<RouteEvent[]> {
    return [...(this.events.get(ownerUid) ?? [])].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async addRouteEvent(ownerUid: string, event: RouteEvent): Promise<void> {
    const list = this.events.get(ownerUid) ?? [];
    list.push(structuredClone(event));
    this.events.set(ownerUid, list);
  }

  async listDrafts(ownerUid: string): Promise<Draft[]> {
    return [...this.drafts.entries()]
      .filter(([key]) => key.startsWith(`${ownerUid}::`))
      .map(([, draft]) => structuredClone(draft))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async saveDraft(ownerUid: string, draft: Draft): Promise<void> {
    this.drafts.set(this.key(ownerUid, draft.id), structuredClone(draft));
  }
}
