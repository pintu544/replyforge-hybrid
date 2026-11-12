/** Browser and Chrome version facts recorded on route events (SPEC FR-12). */

export interface BrowserInfo {
  browserFamily: string;
  chromeVersion: string | null;
  userAgent: string;
}

export function parseBrowserInfo(userAgent: string): BrowserInfo {
  const chrome = userAgent.match(/Chrome\/(\d+(?:\.\d+){0,3})/);
  const edge = userAgent.match(/Edg\/(\d+(?:\.\d+){0,3})/);
  if (edge) {
    return { browserFamily: 'Edge (Chromium)', chromeVersion: chrome?.[1] ?? edge[1], userAgent };
  }
  if (chrome) {
    return { browserFamily: 'Chrome', chromeVersion: chrome[1], userAgent };
  }
  if (/Firefox\//.test(userAgent)) {
    return { browserFamily: 'Firefox', chromeVersion: null, userAgent };
  }
  if (/Safari\//.test(userAgent)) {
    return { browserFamily: 'Safari', chromeVersion: null, userAgent };
  }
  return { browserFamily: 'Other', chromeVersion: null, userAgent };
}

export function currentBrowserInfo(): BrowserInfo {
  if (typeof navigator === 'undefined') {
    return { browserFamily: 'Unknown', chromeVersion: null, userAgent: '' };
  }
  return parseBrowserInfo(navigator.userAgent);
}
