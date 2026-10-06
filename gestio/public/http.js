// 3.5I: one human sentence per kind of failure for screens that show `error.message` directly. Screens that know
// their domain map `error.code` to their own copy; raw codes and request ids never reach the person.
const HUMAN = {
  forbidden: 'No tens permís per fer aquesta acció.',
  not_found: 'No s’ha trobat o no és dins del teu abast.',
  fresh_session_required: 'Per seguretat, torna a iniciar la sessió i repeteix l’acció.',
  body_too_large: 'El contingut és massa gran.',
  invalid_origin: 'La sol·licitud no s’ha pogut verificar. Recarrega la pàgina.'
};
export function humanError(status, code) {
  if (code && HUMAN[code]) return HUMAN[code];
  if (status === 403) return HUMAN.forbidden;
  if (status === 404) return HUMAN.not_found;
  if (status === 409) return /stale|version|changed/.test(code ?? '') ? 'Les dades han canviat mentrestant. Torna-les a carregar.'
    : 'Aquesta acció ja no és possible en l’estat actual.';
  if (status === 429) return 'Massa intents seguits. Espera un moment i torna-ho a provar.';
  return 'No s’ha pogut completar l’acció. Revisa les dades i torna-ho a provar.';
}

// Same-origin JSON client for the Gestió API. Errors carry `status`; 401 notifies the session owner; a generic
// authorisation denial (403 `forbidden`) notifies `onForbidden`, so the shell can re-check what the session may do.
export function createClient({ onUnauthorized, onForbidden = () => {} }) {
  // 3.5I: requests belong to the session that started them. When it ends (`endSession`: logout, expiry, another
  // person), late answers are dropped — never painted into the next session's screens, never shown as errors.
  let epoch = 0;
  const dropped = new Promise(() => {});
  async function call(path, options = {}) {
    const started = epoch;
    try { const data = await request(path, options); return started === epoch ? data : dropped; }
    catch (error) { if (started !== epoch) return dropped; throw error; }
  }
  async function request(path, options) {
    let response;
    try { response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } }); }
    catch (cause) {
      console.error('Gestió request failed', path, cause);
      const error = new Error('No s’ha pogut connectar amb Gestió. Torna-ho a provar.'); error.status = 0; throw error;
    }
    let data;
    try { data = await response.json(); }
    catch (cause) {
      console.error('Gestió response could not be read', path, response.status, cause);
      const error = new Error('No s’han pogut carregar les dades. Torna-ho a provar.'); error.status = response.status || 0; throw error;
    }
    if (!response.ok) {
      if (![401, 403, 404].includes(response.status)) console.error('Gestió request rejected', { path, status: response.status, code: data.error, requestId: data.requestId });
      if (response.status === 401) {
        onUnauthorized();
        const error = new Error('La sessió ha caducat. Torna a entrar.'); error.status = 401; throw error;
      }
      const code = typeof data.error === 'string' ? data.error : null;
      const error = new Error(response.status >= 500 ? 'No s’ha pogut completar l’operació. Torna-ho a provar.' : humanError(response.status, code));
      // Stable server code (e.g. stale_activity) so screens can map it to their own copy; the request id for support.
      error.status = response.status; error.code = code; error.requestId = typeof data.requestId === 'string' ? data.requestId : null;
      if (response.status === 403 && error.code === 'forbidden') onForbidden();
      throw error;
    }
    return data;
  }
  return { call, post: path => call(path, { method: 'POST' }), endSession: () => { epoch += 1; } };
}
