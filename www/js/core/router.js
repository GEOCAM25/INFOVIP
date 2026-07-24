/* ============================================================
   INFOVIP · Router de vistas (SPA, sin recarga)
   Cada módulo registra un render(container) async. El router
   monta la vista, actualiza la tabbar y el título del header.
   ============================================================ */
import { clear } from './ui.js';
import { visibleTabs, byId } from './tabs.js';

const routes = new Map();      // id -> { render, title }
let current = null;

export function register(id, def) { routes.set(id, def); }

const viewEl = () => document.getElementById('view');
const titleEl = () => document.getElementById('header-title');
const tabbarEl = () => document.getElementById('tabbar');

export async function go(id, params = {}) {
  const route = routes.get(id);
  if (!route) return;
  current = id;
  const container = clear(viewEl());
  titleEl().textContent = route.title || (byId(id)?.name ?? 'INFOVIP');
  viewEl().scrollTo?.(0, 0);
  renderTabbar();
  try {
    await route.render(container, params);
  } catch (err) {
    container.innerHTML = `<div class="empty"><div class="em-ico">⚠️</div><p>Error al cargar el módulo.<br><small>${(err && err.message) || err}</small></p></div>`;
    console.error('[router]', err);
  }
}

export function currentId() { return current; }

export function renderTabbar() {
  const bar = clear(tabbarEl());
  for (const tab of visibleTabs()) {
    const btn = document.createElement('button');
    btn.className = 'tab' + (tab.id === current ? ' active' : '');
    const ico = tab.iconSvg ? `<span class="tab-ico tab-svg">${tab.iconSvg}</span>` : `<span class="tab-ico">${tab.icon}</span>`;
    btn.innerHTML = `${ico}<span class="tab-lbl">${tab.name}</span>`;
    btn.addEventListener('click', () => { if (tab.id !== current) go(tab.id); });
    bar.appendChild(btn);
  }
}
