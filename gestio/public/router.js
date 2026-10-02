// Lightweight hash router (3.5D, ACTIVITIES.md §4.1). No framework and no server change: the Gestió
// Worker has no SPA fallback, and the fragment never reaches the server or its logs.
//
//   #/<page>[/<segment>...][?key=value&...]
//
// - push: list ⇄ detail ⇄ tab changes are history entries;
// - replace: filter changes replace the current entry;
// - back/forward and manual hash edits arrive through popstate/hashchange;
// - the hash is left untouched while signed out, so the requested route is restored after login.
// Only non-personal identifiers belong in a route: page names, activity UUIDs, section codes and
// filter keywords. Views never put names, emails or participant ids in it.

export const PAGES = Object.freeze(['inici', 'activitats', 'inscripcions', 'quotes', 'tresoreria', 'participants', 'incidencies', 'administracio']);
export const DEFAULT_PAGE = 'inici';
const SEGMENT = /^[a-z0-9-]{1,64}$/i;

/**
 * @typedef {{page: string, path: string[], query: Record<string, string>}} Route
 */

/** @param {string} hash @returns {Route} */
export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const page = PAGES.includes(segments[0]) ? segments[0] : DEFAULT_PAGE;
  const path = page === segments[0] ? segments.slice(1).filter(segment => SEGMENT.test(segment)).map(segment => segment.toLowerCase()) : [];
  /** @type {Record<string, string>} */
  const query = {};
  for (const pair of queryPart.split('&')) {
    if (!pair) continue;
    const [key, value = ''] = pair.split('=');
    try {
      const name = decodeURIComponent(key), decoded = decodeURIComponent(value.replace(/\+/g, ' '));
      if (/^[a-z]{1,20}$/.test(name) && decoded.length <= 120) query[name] = decoded;
    } catch { /* malformed escapes are ignored like unknown keys */ }
  }
  return { page, path, query };
}

/** @param {Partial<Route>} route */
export function formatHash({ page = DEFAULT_PAGE, path = [], query = {} }) {
  const params = Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return `#/${[page, ...path].join('/')}${params.length ? `?${params.join('&')}` : ''}`;
}

export const sameRoute = (a, b) => formatHash(a) === formatHash(b);

/**
 * @param {{win?: any, onChange: (route: Route, info: {source: 'push'|'replace'|'history'|'start'}) => void}} options
 */
export function createRouter({ win = globalThis.window, onChange }) {
  const location = win?.location, history = win?.history;
  let current = parseHash(location?.hash);
  let handled = location?.hash ?? '';
  // Each entry this router pushes records its depth, so the UI knows whether "back" stays in Gestió.
  let depth = typeof history?.state?.gestioDepth === 'number' ? history.state.gestioDepth : 0;
  if (history && 'scrollRestoration' in history) history.scrollRestoration = 'manual';

  function fromLocation(source) {
    const hash = location?.hash ?? '';
    if (hash === handled) return;
    handled = hash;
    depth = typeof history?.state?.gestioDepth === 'number' ? history.state.gestioDepth : 0;
    current = parseHash(hash);
    onChange(current, { source });
  }
  win?.addEventListener?.('popstate', () => fromLocation('history'));
  win?.addEventListener?.('hashchange', () => fromLocation('history'));

  return {
    current: () => current,
    /** True when the previous history entry was pushed by this router (a real in-app "back"). */
    canGoBack: () => depth > 0,
    back: () => history?.back(),
    /**
     * @param {Partial<Route>} route
     * @param {{replace?: boolean, force?: boolean}} [options]
     */
    go(route, { replace = false, force = false } = {}) {
      const next = parseHash(formatHash(route));
      const hash = formatHash(next);
      if (hash === handled && !force) return;
      handled = hash;
      current = next;
      if (history?.pushState) {
        if (replace) history.replaceState({ gestioDepth: depth }, '', hash);
        else history.pushState({ gestioDepth: ++depth }, '', hash);
      } else if (location) location.hash = hash;
      onChange(current, { source: replace ? 'replace' : 'push' });
    },
    /** Re-announce the current route (session start, login restore). */
    start() { current = parseHash(location?.hash); handled = location?.hash ?? ''; onChange(current, { source: 'start' }); }
  };
}
