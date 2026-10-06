// Session/capability synchronisation (3.5I). Capabilities are read once at login, but access can change while
// Gestió stays open (a role revoked, a delegation expired, a session revoked elsewhere). The shell re-reads
// GET /api/me when the tab becomes visible again, on navigation (throttled) and right after a generic 403, and:
//   - another user (or none) → full reset: every screen is unloaded before anything else is shown;
//   - same user, different capabilities → screens are reloaded, the ones no longer available are unloaded, and
//     a page that is no longer available is left for Inici.
// Advisory only: the server still authorises every request; this only stops stale protected data staying visible.

/** Stable fingerprint of what the session may see (user, status, roles and capabilities). */
export const accessKey = me => me ? JSON.stringify([me.user?.id, me.user?.status, me.roles, me.capabilities]) : '';

/**
 * @param {{ fetchMe: () => Promise<any>, current: () => any, onChanged: (me: any) => Promise<void>|void,
 *   onUserChanged: () => Promise<void>|void, now?: () => number, minIntervalMs?: number }} options
 */
export function createSessionSync({ fetchMe, current, onChanged, onUserChanged, now = Date.now, minIntervalMs = 30_000 }) {
  let last = 0, running = null;
  async function check({ force = false } = {}) {
    const before = current();
    if (!before) return;
    if (running) return running;
    if (!force && now() - last < minIntervalMs) return;
    last = now();
    running = (async () => {
      let me;
      try { me = await fetchMe(); } catch { return; } // a 401 is handled by the client (session end)
      const live = current();
      if (!live) return;
      if (me?.user?.id !== live.user?.id) { await onUserChanged(); return; }
      if (accessKey(me) !== accessKey(live)) await onChanged(me);
    })().finally(() => { running = null; });
    return running;
  }
  return { check };
}
