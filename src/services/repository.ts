import {
  collection,
  doc,
  getDocs,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import type { RouteEvent, Ticket } from '../lib/types';

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
}

export class FirestoreTicketRepository implements TicketRepository {
  private readonly db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  async listTickets(ownerUid: string): Promise<Ticket[]> {
    const snap = await getDocs(collection(this.db, 'users', ownerUid, 'tickets'));
    const tickets = snap.docs.map((d) => d.data() as Ticket);
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
}

/** Test double with identical semantics to the Firestore implementation. */
export class MemoryTicketRepository implements TicketRepository {
  private tickets = new Map<string, Ticket>();
  private events = new Map<string, RouteEvent[]>();

  private key(ownerUid: string, id: string): string {
    return `${ownerUid}::${id}`;
  }

  async listTickets(ownerUid: string): Promise<Ticket[]> {
    const all = [...this.tickets.values()].filter((t) => t.ownerUid === ownerUid);
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
}
