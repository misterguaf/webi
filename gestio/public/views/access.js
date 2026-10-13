// Access screen (docs/design/screens/LOGIN.md): card note, local identity selector and the sign-in
// action. The animated scene is ../login-scene.js and is independent of this module.
import { ROLE_LABELS } from '../labels.js';

const $ = id => document.getElementById(id);
const signedOut = () => !document.body.classList.contains('shell-authenticated');

export function createAccessScreen({ call, message, refresh }) {
  // Local development offers the synthetic identity selector; production sign-in goes through Cloudflare Access.
  let devLogin = false;

  // While signed out the shell is covered by the access screen, so its note repeats the shell messages.
  function note(text, tone = 'neutral') {
    if (!signedOut()) return;
    const element = $('loginNote');
    element.textContent = text; element.dataset.tone = tone; element.hidden = !text;
  }

  async function loadDevIdentities(reportLoadError) {
    try {
      const data = await call('/api/dev/identities');
      devLogin = true;
      $('demoIndicator').hidden = false; $('localDataNotice').hidden = false; $('loginLocal').hidden = false;
      $('loginCard').dataset.mode = 'local';
      // Gestió proves (gestioproves) is a STAGING deployment behind Cloudflare Access: same selector, its own words.
      const staging = data.environment === 'STAGING';
      $('demoIndicator').textContent = staging ? 'Entorn de proves · dades de demostració' : 'Entorn local · dades de demostració';
      $('loginLead').textContent = staging ? 'Entorn de proves: tria una identitat de demostració.' : 'Entorn local: tria una identitat de prova.';
      $('loginButtonLabel').textContent = 'Entra';
      $('identity').replaceChildren(...data.identities.map(identity => {
        const option = document.createElement('option'); option.value = identity.subject; option.textContent = [identity.display_name, ROLE_LABELS[identity.role_code]].filter(Boolean).join(' · '); return option;
      }));
    } catch (error) {
      // 404: production. The button sends the browser back through Cloudflare Access.
      devLogin = false;
      if (error.status !== 404) reportLoadError(error);
    }
  }

  // Lets the scene play its «into the light» exit before the shell appears.
  function leave() {
    document.dispatchEvent(new CustomEvent('gestio:login-leave'));
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    return new Promise(resolve => { setTimeout(resolve, reduced ? 150 : 900); });
  }

  $('loginButton').addEventListener('click', async () => {
    const button = $('loginButton');
    if (button.getAttribute('aria-busy') === 'true') return;
    button.setAttribute('aria-busy', 'true');
    // Production: reloading makes Cloudflare Access authenticate again; the hash route survives.
    if (!devLogin) { await leave(); location.reload(); return; }
    try {
      await call('/api/dev/login', { method: 'POST', body: JSON.stringify({ subject: $('identity').value }) });
      await leave();
      note('');
      await refresh();
      message('Sessió iniciada.');
    } catch (error) { message(error.message, 'error'); }
    finally { button.removeAttribute('aria-busy'); }
  });

  return { note, loadDevIdentities };
}
