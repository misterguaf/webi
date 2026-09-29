// Same-origin JSON client for the Gestió API. Errors carry `status`; 401 notifies the session owner.
export function createClient({ onUnauthorized }) {
  async function call(path, options = {}) {
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
      const error = new Error(response.status >= 500 ? 'No s’ha pogut completar l’operació. Torna-ho a provar.' : `${data.error || 'error'} · ${data.requestId || ''}`);
      error.status = response.status; throw error;
    }
    return data;
  }
  return { call, post: path => call(path, { method: 'POST' }) };
}
