/* ============================================================
   INFOVIP · Registro y personalización de pestañas
   - Orden configurable (drag & drop)
   - Ocultar pestañas
   - Elegir pestaña de inicio
   Todo persistido en localStorage por dispositivo.
   ============================================================ */
import { prefs, KEYS } from './store.js';

// Registro canónico de módulos. 'id' es estable; el orden por defecto
// es el de este array. El módulo 'config' no aparece en la tabbar.
export const REGISTRY = [
  { id: 'inicio',    name: 'Inicio',    icon: '🏠', fixedHome: false },
  { id: 'sellos',    name: 'Sellos',    icon: '🔖' },
  { id: 'rendir',    name: 'Rendir',    icon: '📤' },
  { id: 'autos',     name: 'Alarmas',   icon: '⚡' },
  { id: 'planos',    name: 'Planos',    icon: '📐' },
  { id: 'clima',     name: 'Clima/SE',  icon: '🌦️' }
];

export function byId(id) { return REGISTRY.find((t) => t.id === id); }

// Orden efectivo (respetando preferencia guardada + módulos nuevos al final)
export function getOrder() {
  const saved = prefs.get(KEYS.TAB_ORDER, null);
  const ids = REGISTRY.map((t) => t.id);
  if (!Array.isArray(saved)) return ids;
  const valid = saved.filter((id) => ids.includes(id));
  const missing = ids.filter((id) => !valid.includes(id)); // módulos añadidos en updates
  return [...valid, ...missing];
}
export function setOrder(ids) { prefs.set(KEYS.TAB_ORDER, ids); }

export function getHidden() { return new Set(prefs.get(KEYS.TAB_HIDDEN, [])); }
export function setHidden(set) { prefs.set(KEYS.TAB_HIDDEN, [...set]); }

// Pestañas visibles y ordenadas para pintar la tabbar
export function visibleTabs() {
  const hidden = getHidden();
  return getOrder().map(byId).filter((t) => t && !hidden.has(t.id));
}

// Pestaña de inicio (default: primera visible)
export function getHome() {
  const home = prefs.get(KEYS.HOME_TAB, null);
  const vis = visibleTabs();
  if (home && vis.some((t) => t.id === home)) return home;
  return vis[0] ? vis[0].id : 'inicio';
}
export function setHome(id) { prefs.set(KEYS.HOME_TAB, id); }
