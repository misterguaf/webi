// Gestió view convention (audit M8). No framework: each screen module exports a factory returning
//
//   {
//     id,                 stable name ('activities', 'fees', ...)
//     page,               shell route that shows it ('activitats', 'quotes', ...)
//     available(caps),    from GET /api/me capabilities; advisory only, the server authorises every call
//     load(me),           fetch and render when the session starts or is refreshed
//     unload(),           hide the view and clear any data it rendered (logout, expiry, lost capability)
//     enter?(me),         optional: refresh when the user navigates to its page
//   }
//
// The registry owns the lifecycle; app.js only composes views. New screens (3.5D Activitats onwards)
// are added as view modules instead of growing app.js.

/** @typedef {{id: string, page: string, available: (caps: any) => boolean, load: (me: any) => Promise<void>|void,
 *   unload: () => void, enter?: (me: any) => Promise<void>|void}} GestioView */

const signedIn = () => document.body.classList.contains('shell-authenticated');

/** @param {GestioView[]} views */
export function createViewRegistry(views) {
  const ids = new Set();
  for (const view of views) {
    if (ids.has(view.id)) throw new Error(`Duplicate view ${view.id}`);
    ids.add(view.id);
  }
  return {
    views,
    /** Load every available view in order; stop if the session ends midway (e.g. a 401). */
    async loadAll(me) {
      for (const view of views) {
        if (!signedIn()) return;
        if (view.available(me.capabilities)) await view.load(me);
        else view.unload();
      }
    },
    unloadAll() { for (const view of views) view.unload(); },
    /** Navigation hook: let views on the entered page refresh themselves. */
    enter(page, me) {
      if (!me) return;
      for (const view of views)
        if (view.page === page && view.enter && view.available(me.capabilities)) void view.enter(me);
    }
  };
}
