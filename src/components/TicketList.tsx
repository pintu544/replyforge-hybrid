import type { ActualSource, Ticket } from '../lib/types';

export function RouteChip({ source, latencyMs }: { source: ActualSource; latencyMs?: number }) {
  return (
    <span className={`route-chip route-chip--${source}`}>
      {source === 'on_device' ? 'On-device' : 'In cloud'}
      {latencyMs !== undefined && <span className="num"> · {latencyMs} ms</span>}
    </span>
  );
}

function formatReceived(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TicketList({
  tickets,
  query,
  onQueryChange,
  selectedId,
  onSelect,
}: {
  tickets: Ticket[];
  query: string;
  onQueryChange: (value: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const visible = tickets.filter((t) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return t.subject.toLowerCase().includes(q) || t.body.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);
  });

  return (
    <section className="panel inbox-panel" aria-label="Inbox">
      <div className="inbox-head">
        <h2>Inbox</h2>
        <span className="inbox-count num">{visible.length} of {tickets.length}</span>
      </div>
      <label className="search-label">
        Search tickets
        <input
          type="search"
          placeholder="Search subject, message, or ID"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </label>
      {visible.length === 0 ? (
        <p className="empty-note">No tickets match that search.</p>
      ) : (
        <ul className="ticket-list">
          {visible.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className={`ticket-row${t.id === selectedId ? ' ticket-row--selected' : ''}`}
                onClick={() => onSelect(t.id)}
                aria-current={t.id === selectedId ? 'true' : undefined}
              >
                <span className="ticket-row-top">
                  <span className="ticket-subject">{t.subject}</span>
                  <span className={`source-badge source-badge--${t.source}`}>
                    {t.source === 'fixture' ? 'Fixture' : 'Manual'}
                  </span>
                </span>
                <span className="ticket-row-meta">
                  <span>{t.id}</span>
                  <span>{formatReceived(t.receivedAt)}</span>
                  {t.triage ? (
                    <RouteChip source={t.triage.actualSource} />
                  ) : (
                    <span className="ticket-status">{t.status}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
