/* ============================================================
   INFOVIP · Preferencias locales (localStorage)
   Configuración ligera del usuario: tema, orden/visibilidad de
   pestañas, pestaña de inicio, etc. Todo por dispositivo.
   ============================================================ */
const NS = 'infovip:';

export const prefs = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(NS + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch (_) {}
  },
  remove(key) { localStorage.removeItem(NS + key); },
  all() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(NS)) out[k.slice(NS.length)] = this.get(k.slice(NS.length));
    }
    return out;
  }
};

// Claves de configuración conocidas
export const KEYS = {
  TAB_ORDER: 'tabOrder',
  TAB_HIDDEN: 'tabHidden',
  HOME_TAB: 'homeTab',
  ONBOARDED: 'onboarded'
};
