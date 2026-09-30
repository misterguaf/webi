import { createRouter } from './router.js';

const $ = id => document.getElementById(id);
const pages = [
  {id:'inici',label:'Inici',icon:'home'},
  {id:'activitats',label:'Activitats',icon:'calendar'},
  {id:'inscripcions',label:'Inscripcions',icon:'clipboard'},
  {id:'quotes',label:'Quotes',icon:'wallet'},
  {id:'participants',label:'Participants',icon:'people'},
  {id:'incidencies',label:'Incidències',icon:'alert'},
  {id:'administracio',label:'Administració',icon:'settings'}
];
const mobilePrimary = new Set(['inici','activitats','quotes','participants']);
const icon = name => `<svg aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
const navButton = (page, className) => {
  const button=document.createElement('button');
  button.type='button';button.className=className;button.dataset.route=page.id;
  button.title=page.label;button.setAttribute('aria-label',page.label);
  button.innerHTML=`${icon(page.icon)}<span class="nav-label">${page.label}</span>`;
  button.addEventListener('click',()=>navigateTo(page.id));
  return button;
};
let currentPage='inici';
let lastTrigger=null;
let profileReturnFocus=null;
let sessionActive=false;
let canCreateActivity=false;
let contextActionAllowed=true;
function syncContextAction(){
  $('newActivity').hidden=!(sessionActive && canCreateActivity && contextActionAllowed && currentPage==='activitats' && !$('activitiesView').hidden);
}
// A screen may suppress the shell's contextual action (e.g. the activity detail has its own actions).
export function setContextAction(enabled){contextActionAllowed=!!enabled;syncContextAction()}
let themePreference='system';
const compact=window.matchMedia('(min-width:768px) and (max-width:1179px)');
const systemDark=window.matchMedia('(prefers-color-scheme: dark)');
const stored=(key)=>{try{return localStorage.getItem(key)}catch{return null}};
const save=(key,value)=>{try{localStorage.setItem(key,value)}catch{/* preference remains in this session */}};
const sidebarLinks=$('sidebarNav');
for(const page of pages)sidebarLinks.append(navButton(page,'nav-link'));
const mobileNav=$('mobileNav');
for(const page of pages.filter(page=>mobilePrimary.has(page.id))){
  const button=navButton(page,'mobile-link');
  button.querySelector('.nav-label').className='mobile-label';
  mobileNav.append(button);
}
const moreButton=document.createElement('button');
moreButton.type='button';moreButton.id='moreButton';moreButton.title='Més';moreButton.setAttribute('aria-label','Més opcions');moreButton.setAttribute('aria-expanded','false');
moreButton.innerHTML=`${icon('more')}<span>Més</span>`;mobileNav.append(moreButton);
for(const page of pages.filter(page=>!mobilePrimary.has(page.id))){
  const button=navButton(page,'more-link');button.querySelector('.nav-label').className='more-label';$('moreSheetLinks').append(button);
}
function applyTheme(){
  document.documentElement.dataset.theme=themePreference==='system'?(systemDark.matches?'dark':'light'):themePreference;
  for(const button of document.querySelectorAll('[data-theme-choice]'))button.setAttribute('aria-pressed',String(button.dataset.themeChoice===themePreference));
}
function chooseTheme(choice){
  if(!['system','light','dark'].includes(choice))return;
  themePreference=choice;save('gestio-theme',choice);applyTheme();closeProfile();
}
themePreference=['system','light','dark'].includes(stored('gestio-theme'))?stored('gestio-theme'):'system';
applyTheme();systemDark.addEventListener('change',()=>{if(themePreference==='system')applyTheme()});
for(const button of document.querySelectorAll('[data-theme-choice]'))button.addEventListener('click',()=>chooseTheme(button.dataset.themeChoice));
function applySidebarPreference(){
  const preference=stored('gestio-sidebar');
  const collapsed=preference===null?compact.matches:preference==='collapsed';
  document.body.classList.toggle('sidebar-collapsed',collapsed);
  $('collapseButton').setAttribute('aria-label',collapsed?'Expandeix la barra lateral':'Redueix la barra lateral');
  $('collapseButton').title=collapsed?'Expandeix la barra lateral':'Redueix la barra lateral';
}
applySidebarPreference();compact.addEventListener('change',()=>{if(stored('gestio-sidebar')===null)applySidebarPreference()});
$('collapseButton').addEventListener('click',()=>{
  const collapsed=!document.body.classList.contains('sidebar-collapsed');
  save('gestio-sidebar',collapsed?'collapsed':'expanded');applySidebarPreference();
});
function closeProfile({restoreFocus=false}={}){
  if($('profilePopover').hidden)return;
  $('profilePopover').hidden=true;$('profileTrigger').setAttribute('aria-expanded','false');
  if(restoreFocus)(profileReturnFocus?.getClientRects().length?profileReturnFocus:$('moreButton')).focus();
}
function closeMore({restoreFocus=false}={}){
  if($('moreSheet').hidden)return;
  $('moreSheet').hidden=true;moreButton.setAttribute('aria-expanded','false');
  if(restoreFocus)moreButton.focus();
}
function closeSearch({restoreFocus=true}={}){
  if($('searchLayer').hidden)return;
  $('searchLayer').hidden=true;$('searchInput').value='';
  document.body.classList.remove('search-open');
  if(restoreFocus && lastTrigger?.isConnected && !lastTrigger.hidden)lastTrigger.focus();
  lastTrigger=null;
}
function openSearch(trigger=document.activeElement){
  if(!sessionActive)return;
  closeProfile();closeMore();lastTrigger=trigger===$('moreSearch')?moreButton:trigger;
  $('searchLayer').hidden=false;document.body.classList.add('search-open');
  renderSearchResults();$('searchInput').focus();
}
function renderSearchResults(){
  const query=$('searchInput').value.trim().toLocaleLowerCase('ca');
  const results=pages.filter(page=>page.label.toLocaleLowerCase('ca').includes(query));
  const container=$('searchResults');container.replaceChildren();
  for(const page of results){
    const button=document.createElement('button');button.type='button';button.innerHTML=`${icon(page.icon)}<span>${page.label}</span>`;
    button.addEventListener('click',()=>{closeSearch({restoreFocus:false});navigateTo(page.id);$('pageTitle').focus()});
    container.append(button);
  }
  if(!results.length){const p=document.createElement('p');p.className='search-no-results';p.textContent='No s’han trobat seccions.';container.append(p)}
}
$('searchInput').addEventListener('input',renderSearchResults);
$('searchInput').addEventListener('keydown',event=>{
  if(event.key==='Enter'){$('searchResults').querySelector('button')?.click();event.preventDefault()}
  if(event.key==='ArrowDown'){$('searchResults').querySelector('button')?.focus();event.preventDefault()}
});
$('searchLayer').addEventListener('click',event=>{if(event.target===$('searchLayer'))closeSearch()});
$('closeSearch').addEventListener('click',()=>closeSearch());
for(const button of [$('sidebarSearch'),$('mobileSearch'),$('moreSearch')])button.addEventListener('click',()=>openSearch(button));
function toggleProfile(returnFocus){
  closeMore();profileReturnFocus=returnFocus;const opening=$('profilePopover').hidden;
  $('profilePopover').hidden=!opening;$('profileTrigger').setAttribute('aria-expanded',String(opening));
  if(opening)$('profileAccount').focus();
}
$('profileTrigger').addEventListener('click',()=>toggleProfile($('profileTrigger')));
moreButton.addEventListener('click',()=>{
  closeProfile();const opening=$('moreSheet').hidden;
  $('moreSheet').hidden=!opening;moreButton.setAttribute('aria-expanded',String(opening));
  if(opening)$('moreSheet').querySelector('button')?.focus();
});
$('profileAccount').addEventListener('click',()=>{closeProfile();navigateTo('administracio');$('account').querySelector('h2')?.focus()});
$('profileSessions').addEventListener('click',()=>{closeProfile();navigateTo('administracio');$('sessions').querySelector('h2')?.focus()});
$('moreSearch').addEventListener('click',()=>closeMore());
$('moreProfile').addEventListener('click',()=>{closeMore();toggleProfile(moreButton)});
document.addEventListener('pointerdown',event=>{
  if(!$('profilePopover').hidden && !$('profilePopover').contains(event.target) && !$('profileTrigger').contains(event.target))closeProfile();
  if(!$('moreSheet').hidden && !$('moreSheet').contains(event.target) && !moreButton.contains(event.target))closeMore();
});
document.addEventListener('keydown',event=>{
  if((event.metaKey||event.ctrlKey) && event.key.toLowerCase()==='k'){event.preventDefault();$('searchLayer').hidden?openSearch():closeSearch();return}
  if(event.key==='Escape'){
    if(!$('searchLayer').hidden){closeSearch();return}
    if(!$('profilePopover').hidden){closeProfile({restoreFocus:true});return}
    if(!$('moreSheet').hidden)closeMore({restoreFocus:true});
  }
  if(event.key==='Tab' && !$('searchLayer').hidden){
    const controls=[$('searchInput'),$('closeSearch'),...$('searchResults').querySelectorAll('button')];
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus()}
  }
});
// Navigation goes through the hash router (router.js): buttons and views call navigateTo(), the router
// records history, and every route change — including back/forward — is shown by showRoute().
let currentRoute=null;
const router=createRouter({onChange:route=>{if(sessionActive)showRoute(route)}});
export const routes=router;
export function navigateTo(id,{path=[],query={},replace=false}={}){
  if(!pages.some(item=>item.id===id) || !sessionActive)return;
  router.go({page:id,path,query},{replace});
}
function showRoute(route){
  const samePage=currentRoute?.page===route.page && document.body.dataset.page===route.page;
  currentRoute=route;
  if(!samePage)showPage(route.page);
  for(const listener of navigationListeners)listener(route.page,route);
}
function showPage(id){
  const page=pages.find(item=>item.id===id);if(!page || !sessionActive)return;
  currentPage=id;document.body.dataset.page=id;contextActionAllowed=true;
  for(const section of document.querySelectorAll('.page-main>[data-page]'))section.dataset.active=String(section.dataset.page===id);
  for(const button of document.querySelectorAll('[data-route]')){
    if(button.dataset.route===id)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  }
  if(mobilePrimary.has(id))moreButton.removeAttribute('aria-current');else moreButton.setAttribute('aria-current','page');
  $('pageTitle').textContent=page.label;
  $('pageSubtitle').hidden=true;
  $('pageHeader').hidden=false;
  document.title=`${page.label} · Gestió`;
  syncContextAction();
  closeMore();closeProfile();
  window.scrollTo({top:0,behavior:'instant'});
  $('pageMain').classList.remove('page-shift');void $('pageMain').offsetWidth;$('pageMain').classList.add('page-shift');
  $('pageHeader').classList.remove('context-shift');void $('pageHeader').offsetWidth;$('pageHeader').classList.add('context-shift');
}
// Screens with their own header (the activity detail) hide the shell heading or set its subtitle.
export function setPageHeader({hidden=false,title=null,subtitle=null}={}){
  $('pageHeader').hidden=hidden;
  if(title!==null)$('pageTitle').textContent=title;
  $('pageSubtitle').hidden=!subtitle;$('pageSubtitle').textContent=subtitle||'';
}
const navigationListeners=new Set();
export function onNavigate(listener){navigationListeners.add(listener);return ()=>navigationListeners.delete(listener)}
export function setShellSession(me){
  sessionActive=!!me;
  const activities=me?.capabilities?.activities;
  canCreateActivity=!!(activities?.manage || activities?.manageGeneral);
  syncContextAction();
  document.body.classList.toggle('shell-authenticated',sessionActive);
  $('sidebarNav').hidden=!sessionActive;$('sidebarBottom').hidden=!sessionActive;$('mobileNav').hidden=!sessionActive;$('mobileSearch').hidden=!sessionActive;
  if(!sessionActive){closeSearch({restoreFocus:false});closeProfile();closeMore();currentPage='inici';currentRoute=null;document.body.dataset.page='login';$('pageTitle').textContent='Accés a Gestió';$('pageHeader').hidden=false;$('pageSubtitle').hidden=true;document.title='Gestió · Parpalló';return}
  const name=me.user.displayName||'Usuari';
  $('profileName').textContent=name;
  const roleLabels={GROUP_COORDINATOR:'Coordinació general',SECTION_COORDINATOR:'Coordinació de secció',SECTION_DELEGATE:'Delegació de secció',TREASURY:'Tresoreria',SECRETARY:'Secretaria',CRM_MANAGER:'CRM',TECH_ADMIN:'Administració tècnica'};
  $('profileRole').textContent=roleLabels[me.roles[0]?.role_code]||'Compte';
  $('profileAvatar').textContent=name.replace(/\s*\([^)]*\)/g,'').trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toLocaleUpperCase('ca');
  $('profileTrigger').setAttribute('aria-label',`Perfil de ${name}`);
  // The hash survives the login screen, so a deep link requested while signed out is restored here.
  showRoute(router.current());
}

$('brandLink').addEventListener('click',event=>{event.preventDefault();navigateTo('inici')});
export function currentRouteOf(){return currentRoute}
$('openFeeIssues').addEventListener('click',()=>{if($('feePanel').hidden)return;navigateTo('quotes');$('feeIssues').scrollIntoView({block:'start',behavior:'instant'})});

const emptyGroups={activitats:['activitiesView'],inscripcions:['paymentPanel'],quotes:['feePanel','feeStatusPanel'],participants:['participantsView']};
function syncEmptyStates(){
  for(const [page,ids] of Object.entries(emptyGroups)){
    const empty=document.querySelector(`[data-shell-empty-for="${page}"]`);
    empty.hidden=ids.some(id=>!$(id).hidden);
  }
  const feeAvailable=!$('feePanel').hidden;
  $('openFeeIssues').hidden=!feeAvailable;
  $('feeIssuesDescription').textContent=feeAvailable
    ?'Les incidències de quota es consulten i es resolen en Quotes en esta versió.'
    :'Les incidències de quota no estan disponibles en esta sessió.';
}
for(const ids of Object.values(emptyGroups))for(const id of ids)new MutationObserver(()=>{syncEmptyStates();syncContextAction()}).observe($(id),{attributes:true,attributeFilter:['hidden']});
syncEmptyStates();
