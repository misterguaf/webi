// Administració (3.5H.1, docs/decisions/ADMIN_DECISIONS.md): Usuaris, Rols i permisos, Delegacions,
// Ratificacions and Sessions, next to the existing "El meu compte" sections. The view answers "what can this
// person actually do?" and offers only what the server may accept; the server still decides every act.
import { confirmDialog, formDialog, h, toast } from '../ui.js';
import { field, openDrawer, showErrors } from './treasury/forms.js';
import {
  DELEGATION_DEFAULT_DAYS, DELEGATION_FILTERS, DELEGATION_STATE, ORIGIN, RATIFICATION, applyPackage, availableTabs, errorCopy,
  filterDelegations, isoDay, provisionRequest, validDelegationExpiry
} from './administration/model.js';

const $ = id => document.getElementById(id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = 86400000;
const day = ms => ms ? new Intl.DateTimeFormat('ca-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms)) : '—';
const badge = ({ label, tone }) => h('span', { className: `badge tone-${tone}`, text: label });
const empty = text => h('div', { className: 'empty-state' }, h('p', { className: 'empty-title', text }));
const failure = (error, retry) => h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: errorCopy(error) }),
  retry ? h('button', { className: 'btn btn-secondary', text: 'Torna-ho a intentar', attrs: { type: 'button' }, on: { click: retry } }) : null);
const busy = () => h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } }, h('span', { className: 'skeleton-line' }), h('span', { className: 'skeleton-line short' }));

export function createAdministrationView({ call, reportLoadError, routes, setPageHeader }) {
  const root = $('administrationView');
  let me = null, catalog = null, token = 0;
  const caps = () => me?.capabilities ?? {};
  const adminCaps = () => caps().administration ?? {};
  const go = (path = [], query = {}, options) => routes.go({ page: 'administracio', path, query }, options);
  const sectionName = id => catalog?.sections.find(section => section.id === id)?.name ?? '';
  const permLabel = code => catalog?.permissions.find(item => item.code === code)?.label ?? code;
  const roleLabel = code => catalog?.roles.find(item => item.code === code)?.label ?? code;
  const scopeText = scope => scope?.code ? sectionLabel(scope.code) : 'Tot el grup';
  const sectionLabel = code => catalog?.sections.find(section => section.code === code)?.name ?? code;
  async function ensureCatalog() {
    if (catalog || !Object.values(adminCaps()).some(Boolean)) return catalog;
    try { catalog = await call('/api/admin/catalog'); } catch (error) { if (error.status !== 403) throw error; }
    return catalog;
  }

  // Legacy "El meu compte" / "Les meues sessions" sections stay and are shown on their tabs.
  function legacy(tab) {
    for (const [id, tabs] of [['account', ['compte']], ['notificationPanel', ['compte']], ['sessions', ['sessions']]]) {
      const node = $(id);
      if (node) node.classList.toggle('admin-tab-hidden', !tabs.includes(tab));
    }
  }

  async function render(route) {
    const mine = ++token;
    const tabs = availableTabs(caps());
    const [segment, id] = route?.path ?? [];
    const tab = tabs.find(item => item.id === segment) ?? tabs.find(item => item.id === (adminCaps().manageUsers ? 'usuaris' : 'compte'));
    if (segment !== tab.id) { go([tab.id], {}, { replace: true }); return; }
    legacy(tab.id);
    setPageHeader({ title: 'Administració', subtitle: null });
    const content = h('div', { className: 'admin-content' });
    root.replaceChildren(h('nav', { className: 'tabs admin-tabs', attrs: { 'aria-label': 'Administració' } }, tabs.map(item => h('a', { className: 'tab', text: item.label,
      attrs: { href: `#/administracio/${item.id}`, 'aria-current': item.id === tab.id ? 'page' : false, 'aria-selected': String(item.id === tab.id) },
      on: { click: event => { event.preventDefault(); go([item.id]); } } }))), content);
    if (tab.id === 'compte') { content.replaceChildren(); return; }
    content.replaceChildren(busy());
    try {
      await ensureCatalog();
      if (mine !== token) return;
      if (tab.id === 'usuaris') await (id && UUID.test(id) ? renderUser(content, id) : renderUsers(content, route.query ?? {}));
      else if (tab.id === 'rols') renderCatalog(content);
      else if (tab.id === 'delegacions') await renderDelegations(content, route.query ?? {});
      else if (tab.id === 'ratificacions') await renderRatifications(content);
      else await renderSessions(content);
    } catch (error) {
      if (mine !== token || error.status === 401) return;
      reportLoadError(error);
      content.replaceChildren(h('div', { className: 'activity-surface' }, failure(error, () => void render(route))));
    }
  }

  // ---------------------------------------------------------------- Usuaris
  async function renderUsers(content, query) {
    const { users } = await call('/api/users?limit=200');
    const search = h('input', { attrs: { type: 'search', placeholder: 'Busca per nom', 'aria-label': 'Busca usuaris', value: query.q ?? '' } });
    const list = h('ul', { className: 'tx-list admin-list', attrs: { role: 'list' } });
    const paint = () => {
      const q = search.value.trim().toLocaleLowerCase('ca');
      const rows = users.filter(user => !q || user.display_name.toLocaleLowerCase('ca').includes(q));
      list.replaceChildren(...rows.map(user => h('li', { className: 'admin-row' },
        h('a', { className: 'tx-label', attrs: { href: `#/administracio/usuaris/${user.id}` }, on: { click: event => { event.preventDefault(); go(['usuaris', user.id]); } } },
          h('span', { className: 'tx-label-text', text: user.display_name }), h('span', { className: 'tx-sub', text: `Alta ${day(user.created_at)}` })),
        badge(user.status === 'ACTIVE' ? { label: 'Actiu', tone: 'ok' } : { label: user.status === 'DISABLED' ? 'Desactivat' : 'Suspès', tone: 'muted' }))));
      if (!rows.length) list.replaceChildren(h('li', {}, empty('Cap usuari coincideix amb la cerca.')));
    };
    search.addEventListener('input', paint);
    paint();
    content.replaceChildren(
      h('div', { className: 'toolbar-row' }, h('div', { className: 'search-field' }, search),
        adminCaps().manageUsers ? h('button', { className: 'btn btn-primary', text: 'Nou usuari', attrs: { type: 'button' }, on: { click: () => openProvision() } }) : null),
      h('div', { className: 'activity-surface' }, list));
  }

  async function renderUser(content, userId) {
    const access = await call(`/api/admin/users/${userId}/access`);
    const reload = () => renderUser(content, userId);
    const back = h('a', { className: 'back-link', attrs: { href: '#/administracio/usuaris' }, on: { click: event => { event.preventDefault(); go(['usuaris']); } } }, 'Usuaris');
    const summary = access.summary.length ? h('div', { className: 'admin-summary' }, access.summary.map(module => h('div', { className: 'admin-summary-module' },
      h('h4', { text: module.label }),
      h('ul', {}, module.permissions.map(perm => h('li', {}, h('span', { text: perm.label }),
        h('span', { className: 'tx-sub', text: perm.group ? ' · tot el grup' : ` · ${perm.sections.map(sectionName).join(', ')}` })))))))
      : empty('Encara no pot fer res a Gestió.');
    const roles = h('ul', { className: 'allocation-list' }, access.roles.map(role => h('li', { className: 'allocation-item' },
      h('span', { className: 'allocation-kind', text: role.label }),
      h('span', { className: 'allocation-target' }, role.section_code ? sectionLabel(role.section_code) : 'Tot el grup',
        role.expires_at ? h('span', { className: 'tx-sub', text: ` · fins al ${day(role.expires_at)}` }) : null, ' ',
        role.ratification_status !== 'NOT_REQUIRED' ? badge(RATIFICATION[role.ratification_status]) : null),
      adminCaps().manageRoles ? h('button', { className: 'btn btn-quiet btn-small', text: 'Retira el rol', attrs: { type: 'button' }, on: { click: async () => {
        if (!await confirmDialog({ title: `Retirar «${role.label}»?`, body: 'La persona perd a l’instant tots els permisos que venien amb aquest rol.', confirm: 'Retira', tone: 'danger' })) return;
        try { await call(`/api/users/${userId}/roles/${role.id}`, { method: 'DELETE' }); toast('Rol retirat'); await reload(); } catch (error) { toast(errorCopy(error), { tone: 'danger' }); }
      } } }) : null)));
    const rows = h('ul', { className: 'allocation-list admin-access' }, access.items.map(item => h('li', { className: 'allocation-item' },
      h('span', { className: 'allocation-kind' }, badge({ label: ORIGIN[item.origin], tone: item.origin === 'ROLE' ? 'muted' : item.origin === 'DIRECT' ? 'attention' : 'warning' })),
      h('span', { className: 'allocation-target' }, h('span', { text: permLabel(item.permission) }),
        h('span', { className: 'tx-sub', text: [item.role ? roleLabel(item.role) : null, item.scope ? scopeText(item.scope) : item.scopes?.length ? item.scopes.map(scopeText).join(', ') : 'Tot el grup',
          item.expiresAt ? `fins al ${day(item.expiresAt)}` : null, item.effective === false ? (item.origin === 'DELEGATION' ? 'pendent d’autorització' : 'sense rol que el cobrisca') : null]
          .filter(Boolean).join(' · ') }),
        item.origin !== 'ROLE' && item.ratificationStatus && item.ratificationStatus !== 'NOT_REQUIRED' ? badge(RATIFICATION[item.ratificationStatus]) : null),
      item.origin === 'DIRECT' && adminCaps().managePermissions ? h('button', { className: 'btn btn-quiet btn-small', text: 'Retira', attrs: { type: 'button' }, on: { click: async () => {
        if (!await confirmDialog({ title: 'Retirar el permís?', body: 'Deixa d’estar disponible a la següent petició de la persona.', confirm: 'Retira', tone: 'danger' })) return;
        try { await call(`/api/users/${userId}/permissions/${item.grantId}`, { method: 'DELETE' }); toast('Permís retirat'); await reload(); } catch (error) { toast(errorCopy(error), { tone: 'danger' }); }
      } } }) : null)));
    content.replaceChildren(back,
      h('header', { className: 'detail-header' }, h('h2', { className: 'detail-title', text: access.user.display_name, attrs: { tabindex: '-1' } }),
        h('div', { className: 'detail-actions' },
          adminCaps().manageRoles ? h('button', { className: 'btn btn-secondary', text: 'Afegeix rol', attrs: { type: 'button' }, on: { click: () => openRole(access, reload) } }) : null,
          adminCaps().managePermissions ? h('button', { className: 'btn btn-secondary', text: 'Concedeix permís', attrs: { type: 'button' }, on: { click: () => openGrant(access, reload) } }) : null,
          adminCaps().revokeSessions ? h('button', { className: 'btn btn-quiet', text: 'Tanca les seues sessions', attrs: { type: 'button' }, on: { click: () => revokeSessions(userId, access.user.display_name) } }) : null)),
      h('div', { className: 'activity-surface info-surface' },
        h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Què pot fer ara' }), summary),
        h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Rols' }), access.roles.length ? roles : h('p', { className: 'empty-detail', text: 'Sense rols.' })),
        h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'D’on ve cada permís' }),
          h('p', { className: 'field-hint', text: 'Els permisos «Per rol» es canvien canviant el rol. Els directes i delegats es poden retirar un a un.' }),
          access.items.length ? rows : h('p', { className: 'empty-detail', text: 'Sense permisos.' }))));
    content.querySelector('.detail-title')?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- forms
  const sectionSelect = (value = '', { optional = false } = {}) => h('select', {}, optional ? h('option', { text: 'Tot el grup', attrs: { value: '' } }) : h('option', { text: 'Tria una secció', attrs: { value: '' } }),
    catalog.sections.map(section => h('option', { text: section.name, attrs: { value: section.id, selected: section.id === value } })));
  /** Role editor: role, section when the role is per section, expiry and the permissions of its ceiling. */
  function roleEditor(state, onChange) {
    const role = catalog.roles.find(item => item.code === state.roleCode);
    const section = role.scope === 'SECTION' ? sectionSelect(state.sectionId ?? '') : null;
    section?.addEventListener('change', () => { state.sectionId = section.value || null; onChange?.(); });
    const expiry = h('input', { attrs: { type: 'date', value: state.expiresAt ?? '' } });
    expiry.addEventListener('change', () => { state.expiresAt = expiry.value; });
    const checks = role.ceiling.map(code => {
      const box = h('input', { attrs: { type: 'checkbox', checked: state.permissions.includes(code) } });
      box.addEventListener('change', () => { state.permissions = box.checked ? [...state.permissions, code] : state.permissions.filter(item => item !== code); });
      return h('label', { className: 'checkbox-row admin-check' }, box, h('span', { text: permLabel(code) }),
        role.defaults.includes(code) ? null : h('span', { className: 'tx-sub', text: ' · decisió explícita' }));
    });
    return h('div', { className: 'admin-role-editor' },
      h('div', { className: 'field-row' }, section ? field('sectionId', 'Secció', section, { required: true }) : null,
        field('expiresAt', role.expiryRequired ? 'Caducitat' : 'Caducitat (opcional)', expiry, { required: !!role.expiryRequired })),
      h('details', { className: 'admin-perms', attrs: { open: false } }, h('summary', { text: `Permisos del rol (${state.permissions.length} de ${role.ceiling.length})` }),
        h('div', { className: 'admin-check-grid' }, checks)));
  }

  function openProvision() {
    const draft = { displayName: '', email: '', roles: [], grants: [] };
    const name = h('input', { attrs: { type: 'text', maxlength: 120, autocomplete: 'off', placeholder: 'Nom i cognoms (fictici)' } });
    const email = h('input', { attrs: { type: 'email', autocomplete: 'off', placeholder: 'correu@example.test (opcional)' } });
    const packageSection = sectionSelect('', { optional: false });
    const rolesBox = h('div', { className: 'admin-roles' });
    const grantsBox = h('div', { className: 'admin-grants' });
    const review = h('div', { className: 'form-notice admin-review' });
    const paintReview = () => {
      review.replaceChildren(h('strong', { text: 'Revisió: ' }),
        draft.roles.length ? draft.roles.map(role => `${roleLabel(role.roleCode)}${role.sectionId ? ` (${sectionName(role.sectionId)})` : ''}: ${role.permissions.length} permisos`).join(' · ') : 'sense rols',
        draft.grants.length ? ` · ${draft.grants.length} permisos directes` : '',
        '. Els canvis són efectius en crear-se i queden pendents de ratificar pel Consell.');
    };
    const paintRoles = () => {
      rolesBox.replaceChildren(...draft.roles.map((role, index) => h('div', { className: 'admin-role-card' },
        h('div', { className: 'toolbar-row' }, h('strong', { text: `${roleLabel(role.roleCode)}${role.sectionId ? ` · ${sectionName(role.sectionId)}` : ''}` }),
          h('button', { className: 'btn btn-quiet btn-small', text: 'Treu', attrs: { type: 'button' }, on: { click: () => { draft.roles.splice(index, 1); paintRoles(); } } })),
        roleEditor(role, paintReview))));
      paintReview();
    };
    const roleChoice = h('select', {}, h('option', { text: 'Afig un rol…', attrs: { value: '' } }), catalog.roles.map(role => h('option', { text: role.label, attrs: { value: role.code } })));
    roleChoice.addEventListener('change', () => {
      const role = catalog.roles.find(item => item.code === roleChoice.value);
      roleChoice.value = '';
      if (!role) return;
      draft.roles.push({ key: `${role.code}|${draft.roles.length}`, roleCode: role.code, sectionId: role.scope === 'SECTION' ? packageSection.value || null : null,
        permissions: [...role.defaults], expiresAt: role.expiryRequired ? isoDay(Date.now() + DELEGATION_DEFAULT_DAYS * DAY) : '' });
      paintRoles();
    });
    const packages = h('div', { className: 'filter-chips admin-packages' }, catalog.packages.map(pkg => h('button', { className: 'filter-chip', text: pkg.label,
      attrs: { type: 'button', title: pkg.description, disabled: !!pkg.disabled }, on: { click: () => {
        const result = applyPackage(draft, pkg, { sectionId: packageSection.value || null, catalog });
        if (result.error) { toast(result.error, { tone: 'danger' }); return; }
        draft.roles = result.draft.roles; paintRoles();
      } } })));
    const grantsSelector = permissionSelector({ onAdd: grant => { draft.grants.push(grant); paintGrants(); } });
    const paintGrants = () => {
      grantsBox.replaceChildren(...draft.grants.map((grant, index) => h('div', { className: 'admin-grant-row' },
        h('span', { text: `${permLabel(grant.permissionCode)} · ${grant.sectionId ? sectionName(grant.sectionId) : 'abast del rol'}` }),
        h('button', { className: 'btn btn-quiet btn-small', text: 'Treu', attrs: { type: 'button' }, on: { click: () => { draft.grants.splice(index, 1); paintGrants(); } } }))));
      paintReview();
    };
    paintRoles();
    const content = [
      h('div', { className: 'form-section' }, h('h3', { className: 'form-section-title', text: '1. Identitat' }),
        field('displayName', 'Nom', name, { required: true }),
        field('email', 'Correu d’accés (Cloudflare Access)', email, { hint: 'S’envia una invitació per a vincular la identitat. Sense contrasenyes a Gestió.' })),
      h('div', { className: 'form-section' }, h('h3', { className: 'form-section-title', text: '2–3. Paquets d’accés i rols' }),
        h('p', { className: 'field-hint', text: 'Un paquet només preselecciona rols i permisos; el que compta és el que quede sota.' }),
        field('packageSection', 'Secció per als paquets de secció', packageSection), packages, rolesBox, roleChoice),
      h('div', { className: 'form-section' }, h('h3', { className: 'form-section-title', text: '4–6. Permisos avançats i abast' }),
        h('p', { className: 'field-hint', text: 'Només dins d’algun rol de la persona. Un abast de secció no s’amplia mai a tot el grup.' }), grantsSelector, grantsBox),
      h('div', { className: 'form-section', dataset: { field: 'roles' } }, h('h3', { className: 'form-section-title', text: '7. Revisió' }), review, h('p', { className: 'field-error', attrs: { hidden: true } }))];
    const drawer = openDrawer({ title: 'Nou usuari', content, primary: 'Crea l’usuari', onSubmit: async () => {
      draft.displayName = name.value; draft.email = email.value;
      const { errors, body } = provisionRequest(draft);
      if (!showErrors(drawer.submit.form, errors)) { drawer.showError('Revisa els camps marcats.'); return false; }
      const created = await call('/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
      if (draft.email.trim()) {
        try { await call(`/api/users/${created.id}/invitations`, { method: 'POST', body: JSON.stringify({ email: draft.email.trim().toLowerCase() }) }); }
        catch (error) { toast(`Usuari creat, però la invitació ha fallat: ${errorCopy(error)}`, { tone: 'danger', timeout: 7000 }); }
      }
      toast('Usuari creat'); go(['usuaris', created.id]); return true;
    } });
  }

  /** Advanced permission selector: grouped by module, searchable, section scope only when meaningful. */
  function permissionSelector({ onAdd, roleScopes = null }) {
    const search = h('input', { attrs: { type: 'search', placeholder: 'Busca un permís', 'aria-label': 'Busca un permís' } });
    const select = h('select', { attrs: { 'aria-label': 'Permís' } });
    const scope = sectionSelect('', { optional: true });
    const scopeField = field('grantSection', 'Abast', scope, { hint: 'Deixa «Tot el grup» per a seguir l’abast del rol.' });
    const paint = () => {
      const q = search.value.trim().toLocaleLowerCase('ca');
      select.replaceChildren(h('option', { text: 'Tria un permís…', attrs: { value: '' } }), ...catalog.modules.map(module => {
        const perms = catalog.permissions.filter(perm => perm.module === module.id && (!roleScopes || roleScopes.has(perm.code))
          && (!q || perm.label.toLocaleLowerCase('ca').includes(q)));
        return perms.length ? h('optgroup', { attrs: { label: module.label } }, perms.map(perm => h('option', { text: perm.label, attrs: { value: perm.code } }))) : null;
      }).filter(Boolean));
      syncScope();
    };
    const syncScope = () => { scopeField.hidden = catalog.permissions.find(perm => perm.code === select.value)?.kind !== 'SCOPED'; };
    search.addEventListener('input', paint); select.addEventListener('change', syncScope);
    paint();
    const add = h('button', { className: 'btn btn-secondary btn-small', text: 'Afig permís', attrs: { type: 'button' }, on: { click: () => {
      if (!select.value) return;
      onAdd({ permissionCode: select.value, sectionId: scopeField.hidden ? null : scope.value || null }); select.value = ''; syncScope();
    } } });
    return h('div', { className: 'admin-selector' }, search, select, scopeField, onAdd ? add : null);
  }

  function openRole(access, reload) {
    const choice = h('select', {}, catalog.roles.map(role => h('option', { text: role.label, attrs: { value: role.code } })));
    let state = null;
    const editor = h('div');
    const paint = () => {
      const role = catalog.roles.find(item => item.code === choice.value);
      state = { roleCode: role.code, sectionId: null, permissions: [...role.defaults], expiresAt: role.expiryRequired ? isoDay(Date.now() + DELEGATION_DEFAULT_DAYS * DAY) : '' };
      editor.replaceChildren(roleEditor(state));
    };
    choice.addEventListener('change', paint); paint();
    const drawer = openDrawer({ title: `Afegeix rol · ${access.user.display_name}`, content: [field('roleCode', 'Rol', choice), editor,
      h('p', { className: 'form-notice', text: 'Efectiu a l’instant; queda pendent de ratificar.' })], primary: 'Assigna el rol', onSubmit: async () => {
      const { errors, body } = provisionRequest({ displayName: 'xx', roles: [state], grants: [] });
      if (errors.roles) { drawer.showError(errors.roles); return false; }
      await call(`/api/users/${access.user.id}/roles`, { method: 'POST', body: JSON.stringify(body.roles[0]) });
      toast('Rol assignat'); await reload(); return true;
    } });
  }

  function openGrant(access, reload) {
    // Only permissions inside a role ceiling of the person can be granted (the server checks it too).
    const ceilings = new Set(access.roles.flatMap(role => catalog.roles.find(item => item.code === role.role_code)?.ceiling ?? []));
    let picked = null;
    const selector = permissionSelector({ roleScopes: ceilings, onAdd: grant => { picked = grant; drawer.submit.click(); } });
    const drawer = openDrawer({ title: `Concedeix permís · ${access.user.display_name}`, content: [
      ceilings.size ? selector : h('p', { className: 'form-notice', text: 'La persona no té cap rol: assigna primer un rol.' }),
      h('p', { className: 'field-hint', text: 'Només pots concedir el que tu mateix tens. Efectiu a l’instant; queda pendent de ratificar.' })],
    primary: 'Concedeix', onSubmit: async () => {
      const select = selector.querySelector('select'), scope = selector.querySelectorAll('select')[1];
      const grant = picked ?? (select?.value ? { permissionCode: select.value, sectionId: scope?.closest('[data-field]')?.hidden ? null : scope?.value || null } : null);
      picked = null;
      if (!grant) { drawer.showError('Tria un permís.'); return false; }
      await call(`/api/users/${access.user.id}/permissions`, { method: 'POST', body: JSON.stringify({ permissionCode: grant.permissionCode, ...(grant.sectionId ? { sectionId: grant.sectionId } : {}) }) });
      toast('Permís concedit'); await reload(); return true;
    } });
  }

  // ---------------------------------------------------------------- Rols i permisos
  function renderCatalog(content) {
    if (!catalog) { content.replaceChildren(empty('No tens accés al catàleg.')); return; }
    content.replaceChildren(
      h('p', { className: 'field-hint', text: 'Un rol és el conjunt base de permisos que una persona pot tindre; els permisos marcats com a «decisió explícita» no es donen en assignar el rol. El catàleg el defineix el codi: aquí s’assignen permisos existents, no se’n creen.' }),
      h('div', { className: 'admin-cards' }, catalog.roles.map(role => h('details', { className: 'activity-surface admin-card' },
        h('summary', {}, h('strong', { text: role.label }), h('span', { className: 'tx-sub', text: ` · ${role.scope === 'SECTION' ? 'per secció' : 'tot el grup'} · ${role.defaults.length} per defecte de ${role.ceiling.length}` })),
        h('ul', {}, role.ceiling.map(code => h('li', { text: `${permLabel(code)}${role.defaults.includes(code) ? '' : ' · decisió explícita'}` })))))),
      h('h3', { className: 'block-title', text: 'Paquets d’accés' }),
      h('ul', { className: 'admin-package-list' }, catalog.packages.map(pkg => h('li', {}, h('strong', { text: pkg.label }), h('span', { className: 'tx-sub', text: ` · ${pkg.description}` })))),
      h('h3', { className: 'block-title', text: 'Catàleg de permisos' }),
      h('div', { className: 'admin-cards' }, catalog.modules.map(module => h('details', { className: 'activity-surface admin-card' },
        h('summary', {}, h('strong', { text: module.label })),
        h('ul', {}, catalog.permissions.filter(perm => perm.module === module.id).map(perm => h('li', {}, perm.label,
          h('span', { className: 'tx-sub', text: [perm.kind === 'SCOPED' ? ' · per secció' : ' · tot el grup', perm.delegable ? 'delegable' : null].filter(Boolean).join(' · ') }))))))));
  }

  // ---------------------------------------------------------------- Delegacions
  async function renderDelegations(content, query) {
    const { delegations } = await call('/api/delegations?limit=200');
    const filter = DELEGATION_FILTERS.some(item => item.value === query.estat) ? query.estat : 'actives';
    const rows = filterDelegations(delegations, filter);
    content.replaceChildren(
      h('div', { className: 'toolbar-row' },
        h('div', { className: 'filter-chips' }, DELEGATION_FILTERS.map(item => h('button', { className: 'filter-chip', attrs: { type: 'button', 'aria-pressed': String(item.value === filter) },
          text: `${item.label} (${filterDelegations(delegations, item.value).length})`, on: { click: () => go(['delegacions'], { estat: item.value }, { replace: true }) } }))),
        h('button', { className: 'btn btn-primary', text: 'Nova delegació', attrs: { type: 'button' }, on: { click: () => void openDelegation(() => renderDelegations(content, query)) } })),
      h('div', { className: 'activity-surface' }, rows.length ? h('ul', { className: 'tx-list admin-list' }, rows.map(row => h('li', { className: 'admin-row' },
        h('span', { className: 'tx-label' }, h('span', { className: 'tx-label-text', text: `${row.user_name ?? 'Persona'} · ${permLabel(row.permission_code)}` }),
          h('span', { className: 'tx-sub', text: [row.section_code ? sectionLabel(row.section_code) : 'Tot el grup', `autoritza ${row.authorized_by_name ?? '—'}`,
            `tramita ${row.provisioned_by_name ?? '—'}`, `fins al ${day(row.expires_at)}`].join(' · ') })),
        badge(DELEGATION_STATE[row.state] ?? DELEGATION_STATE.ACTIVE),
        h('span', { className: 'admin-row-actions' },
          row.state === 'PENDING_AUTHORISATION' && row.authorized_by === me.user.id ? h('button', { className: 'btn btn-secondary btn-small', text: 'Confirma que ho autoritze', attrs: { type: 'button' },
            on: { click: async () => { try { await call(`/api/delegations/${row.id}/confirm`, { method: 'POST', body: '{}' }); toast('Delegació autoritzada'); await renderDelegations(content, query); } catch (error) { toast(errorCopy(error), { tone: 'danger' }); } } } }) : null,
          !['REVOKED', 'EXPIRED'].includes(row.state) ? h('button', { className: 'btn btn-quiet btn-small', text: 'Revoca', attrs: { type: 'button' }, on: { click: async () => {
            if (!await confirmDialog({ title: 'Revocar la delegació?', body: 'Deixa de ser efectiva a l’instant.', confirm: 'Revoca', tone: 'danger' })) return;
            try { await call(`/api/delegations/${row.id}/revoke`, { method: 'POST', body: '{}' }); toast('Delegació revocada'); await renderDelegations(content, query); } catch (error) { toast(errorCopy(error), { tone: 'danger' }); }
          } } }) : null)))) : empty('Cap delegació en aquesta vista.')));
  }
  async function openDelegation(reload) {
    const { users } = await call('/api/users?limit=200');
    const person = (label, name) => field(name, label, h('select', {}, h('option', { text: 'Tria…', attrs: { value: '' } }),
      users.filter(user => user.status === 'ACTIVE').map(user => h('option', { text: user.display_name, attrs: { value: user.id, selected: name === 'authorizedBy' && user.id === me.user.id } }))), { required: true });
    const beneficiary = person('Persona beneficiària', 'userId'), authoriser = person('Qui ho autoritza', 'authorizedBy');
    const permission = h('select', {}, h('option', { text: 'Tria…', attrs: { value: '' } }), catalog.permissions.filter(perm => perm.delegable)
      .map(perm => h('option', { text: perm.label, attrs: { value: perm.code } })));
    const section = sectionSelect('', { optional: true });
    const sectionField = field('sectionId', 'Abast', section);
    permission.addEventListener('change', () => { sectionField.hidden = catalog.permissions.find(perm => perm.code === permission.value)?.kind !== 'SCOPED'; });
    const expiry = h('input', { attrs: { type: 'date', value: isoDay(Date.now() + DELEGATION_DEFAULT_DAYS * DAY), max: isoDay(Date.now() + 365 * DAY) } });
    const reference = h('input', { attrs: { type: 'text', value: 'DEMO-', maxlength: 100 } });
    const drawer = openDrawer({ title: 'Nova delegació', content: [beneficiary, field('permissionCode', 'Permís', permission, { required: true }), sectionField,
      field('expiresAt', 'Caducitat', expiry, { required: true, hint: 'Per defecte 90 dies; màxim 365. Es pot revocar en qualsevol moment.' }), authoriser,
      field('reference', 'Referència de l’autorització', reference, { required: true }),
      h('p', { className: 'form-notice', text: 'Efectiva quan qui autoritza ho confirma (a l’instant si eres tu). Queda pendent de ratificar. No es pot redelegar.' })],
    primary: 'Crea la delegació', onSubmit: async () => {
      const userId = beneficiary.querySelector('select').value, authorizedBy = authoriser.querySelector('select').value;
      const expires = validDelegationExpiry(expiry.value);
      const errors = { ...(!userId ? { userId: 'Tria la persona.' } : {}), ...(!permission.value ? { permissionCode: 'Tria el permís.' } : {}),
        ...(expires.error ? { expiresAt: expires.error } : {}), ...(!authorizedBy ? { authorizedBy: 'Tria qui ho autoritza.' } : {}) };
      if (!showErrors(drawer.submit.form, errors)) { drawer.showError('Revisa els camps marcats.'); return false; }
      await call('/api/delegations', { method: 'POST', body: JSON.stringify({ userId, permissionCode: permission.value, authorizedBy,
        authorizationReference: reference.value.trim(), expiresAt: expires.value, ...(!sectionField.hidden && section.value ? { sectionId: section.value } : {}) }) });
      toast('Delegació creada'); await reload(); return true;
    } });
  }

  // ---------------------------------------------------------------- Ratificacions
  async function renderRatifications(content) {
    const { items } = await call('/api/admin/ratifications');
    const kindLabel = { role: 'Rol', grant: 'Permís directe', delegation: 'Delegació' };
    const act = (item, decision) => async () => {
      let body = null;
      if (decision === 'ratify') {
        const values = await formDialog({ title: 'Ratificar', confirm: 'Ratifica', fields: [{ name: 'reference', label: 'Referència de l’acta del Consell (DEMO-…)', value: 'DEMO-', required: true }] });
        if (!values) return;
        body = JSON.stringify({ ratificationReference: values.reference.trim() });
      } else if (!await confirmDialog({ title: 'Revocar?', body: 'La persona perd aquesta autoritat a l’instant.', confirm: 'Revoca', tone: 'danger' })) return;
      try { await call(`/api/admin/ratifications/${item.kind}/${item.id}/${decision}`, { method: 'POST', ...(body ? { body } : {}) });
        toast(decision === 'ratify' ? 'Ratificat' : 'Revocat'); await renderRatifications(content); }
      catch (error) { toast(errorCopy(error), { tone: 'danger', timeout: 6000 }); }
    };
    content.replaceChildren(
      h('p', { className: 'field-hint', text: 'Els canvis d’autoritat són efectius des que s’autoritzen. Gestió no revoca res per no haver-se ratificat: només ho marca com a endarrerit. Qui tramita o rep un canvi no el pot ratificar.' }),
      h('div', { className: 'activity-surface' }, items.length ? h('ul', { className: 'tx-list admin-list' }, items.map(item => h('li', { className: 'admin-row' },
        h('span', { className: 'tx-label' }, h('span', { className: 'tx-label-text', text: `${item.user_name} · ${item.label}` }),
          h('span', { className: 'tx-sub', text: [kindLabel[item.kind], item.section_code ? sectionLabel(item.section_code) : 'Tot el grup', `autoritza ${item.authorized_by_name ?? '—'}`,
            `des del ${day(item.granted_at)}`, item.expires_at ? `fins al ${day(item.expires_at)}` : null].filter(Boolean).join(' · ') })),
        item.overdue ? badge({ label: `Endarrerida · ${item.pendingDays} dies`, tone: 'warning' }) : badge(item.authorised ? RATIFICATION.PENDING_RATIFICATION : DELEGATION_STATE.PENDING_AUTHORISATION),
        h('span', { className: 'admin-row-actions' },
          (() => {
            const own = item.provisioned_by === me.user.id || item.user_id === me.user.id;
            return h('button', { className: 'btn btn-secondary btn-small', text: 'Ratifica', attrs: { type: 'button', disabled: !item.authorised || own,
              title: own ? 'Qui tramita o rep un canvi no el pot ratificar.' : !item.authorised ? 'Pendent que qui autoritza ho confirme.' : null }, on: { click: act(item, 'ratify') } });
          })(),
          h('button', { className: 'btn btn-quiet btn-small', text: 'Revoca', attrs: { type: 'button' }, on: { click: act(item, 'revoke') } }))))) : empty('No hi ha res pendent de ratificar.')));
  }

  // ---------------------------------------------------------------- Sessions (other people)
  async function revokeSessions(userId, name) {
    if (!await confirmDialog({ title: `Tancar les sessions de ${name}?`, body: 'Haurà de tornar a entrar. No dona accés a les seues dades.', confirm: 'Tanca-les', tone: 'danger' })) return;
    try { await call(`/api/admin/users/${userId}/sessions/revoke-all`, { method: 'POST', body: '{}' }); toast('Sessions tancades'); }
    catch (error) { toast(errorCopy(error), { tone: 'danger' }); }
  }
  async function renderSessions(content) {
    if (!adminCaps().revokeSessions) { content.replaceChildren(h('p', { className: 'field-hint', text: 'Les teues sessions estan a continuació.' })); return; }
    const { users } = await call('/api/users?limit=200');
    const pick = h('select', {}, h('option', { text: 'Tria una persona…', attrs: { value: '' } }), users.filter(user => user.id !== me.user.id)
      .map(user => h('option', { text: user.display_name, attrs: { value: user.id } })));
    const list = h('div');
    pick.addEventListener('change', async () => {
      if (!UUID.test(pick.value)) { list.replaceChildren(); return; }
      try {
        const { sessions } = await call(`/api/admin/users/${pick.value}/sessions`);
        list.replaceChildren(sessions.length ? h('ul', { className: 'allocation-list' }, sessions.map(item => h('li', { className: 'allocation-item' },
          h('span', { className: 'allocation-kind', text: `Iniciada ${day(item.created_at)}` }), h('span', { className: 'allocation-target', text: `Última activitat ${day(item.last_seen_at)}` }),
          h('span', { className: 'allocation-amount', text: `Caduca ${day(item.absolute_expires_at)}` })))) : h('p', { className: 'empty-detail', text: 'Cap sessió oberta.' }),
        sessions.length ? h('button', { className: 'btn btn-secondary', text: 'Tanca totes les sessions', attrs: { type: 'button' },
          on: { click: async () => { await revokeSessions(pick.value, pick.selectedOptions?.[0]?.textContent ?? 'aquesta persona'); pick.dispatchEvent(new Event('change')); } } }) : null);
      } catch (error) { list.replaceChildren(failure(error)); }
    });
    content.replaceChildren(h('div', { className: 'activity-surface info-surface' }, h('h3', { className: 'info-title', text: 'Sessions d’altres persones' }),
      h('p', { className: 'field-hint', text: 'Només dates d’inici, activitat i caducitat. Tancar-les no dona accés a cap dada de la persona.' }),
      field('sessionUser', 'Persona', pick), list));
  }

  return {
    id: 'administration', page: 'administracio',
    available: () => true,
    load(nextMe) { me = nextMe; root.hidden = false; },
    async enter(nextMe, route) { me = nextMe; root.hidden = false; await render(route); },
    unload() { token++; me = null; catalog = null; root.hidden = true; root.replaceChildren(); legacy('compte'); }
  };
}
