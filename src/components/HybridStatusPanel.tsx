import { useSyncExternalStore } from 'react';
import type { AvailabilityController, DeviceAvailability } from '../services/availability';
import { currentBrowserInfo } from '../lib/browserInfo';

const STATE_COPY: Record<DeviceAvailability, { label: string; explanation: string }> = {
  available: {
    label: 'On-device model available',
    explanation: 'Gemini Nano can run on this machine. Short work will prefer the device.',
  },
  downloadable: {
    label: 'On-device model downloadable',
    explanation: 'This machine can run Gemini Nano, but the model is not downloaded yet.',
  },
  downloading: {
    label: 'Downloading on-device model',
    explanation: 'The model download is in progress. Ticket work is not blocked.',
  },
  unavailable: {
    label: 'On-device model unavailable',
    explanation:
      'This machine or browser cannot run Gemini Nano. Ordinary work continues through the cloud, and every result will say so.',
  },
};

export function HybridStatusPanel({ controller }: { controller: AvailabilityController }) {
  const snapshot = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.getSnapshot(),
  );
  const browser = currentBrowserInfo();
  const copy = STATE_COPY[snapshot.state];
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;

  return (
    <section className="panel status-panel" aria-label="Hybrid inference status">
      <div className="status-head">
        <span
          className={`status-dot status-dot--${snapshot.state}`}
          aria-hidden="true"
        />
        <h2>{snapshot.checking ? 'Checking on-device model' : copy.label}</h2>
      </div>
      <p className="status-explanation">{copy.explanation}</p>

      {snapshot.state === 'downloading' && snapshot.downloadProgress !== null && (
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(snapshot.downloadProgress * 100)}
        >
          <div
            className="progress-bar"
            style={{ width: `${Math.round(snapshot.downloadProgress * 100)}%` }}
          />
        </div>
      )}

      {snapshot.error && (
        <p className="status-error" role="alert">
          {snapshot.error}
        </p>
      )}

      {(snapshot.state === 'downloadable' || snapshot.state === 'unavailable') && (
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void controller.enable()}
        >
          Enable on-device AI
        </button>
      )}

      <dl className="status-facts">
        <div>
          <dt>Browser</dt>
          <dd>
            {browser.browserFamily}
            {browser.chromeVersion ? ` ${browser.chromeVersion}` : ''}
          </dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd>{online ? 'Online' : 'Offline'}</dd>
        </div>
        <div>
          <dt>Route proof</dt>
          <dd>Read from each result, never assumed</dd>
        </div>
      </dl>
    </section>
  );
}
