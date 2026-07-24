/* ============================================================
   INFOVIP · Gestión de permisos del teléfono
   Solicita ubicación y notificaciones usando los plugins de
   Capacitor (o las Web APIs en el navegador). Se llama en el
   primer arranque (onboarding) y desde Ajustes.
   ============================================================ */
import { isNative } from './native.js';

function plugin(name) {
  const c = window.Capacitor;
  return c && c.Plugins ? c.Plugins[name] : undefined;
}

/* ---------- Ubicación ---------- */
export async function requestLocation() {
  const Geolocation = plugin('Geolocation');
  if (Geolocation && Geolocation.requestPermissions) {
    try {
      const r = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
      return r.location || r.coarseLocation || 'denied';
    } catch (_) { return 'denied'; }
  }
  // Web: pedir ubicación dispara el prompt del navegador.
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve('unavailable');
    navigator.geolocation.getCurrentPosition(
      () => resolve('granted'), () => resolve('denied'), { timeout: 10000 }
    );
  });
}

/* ---------- Notificaciones ---------- */
export async function requestNotifications() {
  const LocalNotifications = plugin('LocalNotifications');
  if (LocalNotifications && LocalNotifications.requestPermissions) {
    try { const r = await LocalNotifications.requestPermissions(); return r.display || 'denied'; }
    catch (_) { return 'denied'; }
  }
  if ('Notification' in window) {
    try { return await Notification.requestPermission(); } catch (_) { return 'denied'; }
  }
  return 'unavailable';
}

/* ---------- Estado actual (sin volver a pedir) ---------- */
export async function checkStatus() {
  const out = { location: 'unknown', notifications: 'unknown', native: isNative() };
  const Geolocation = plugin('Geolocation');
  if (Geolocation && Geolocation.checkPermissions) {
    try { const r = await Geolocation.checkPermissions(); out.location = r.location || r.coarseLocation || 'prompt'; } catch (_) {}
  } else if (navigator.permissions) {
    try { out.location = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch (_) {}
  }
  const LocalNotifications = plugin('LocalNotifications');
  if (LocalNotifications && LocalNotifications.checkPermissions) {
    try { out.notifications = (await LocalNotifications.checkPermissions()).display; } catch (_) {}
  } else if ('Notification' in window) {
    out.notifications = Notification.permission;
  }
  return out;
}

/* ---------- Pedir todo (onboarding) ---------- */
export async function requestAll() {
  const location = await requestLocation();
  const notifications = await requestNotifications();
  return { location, notifications };
}

/* ---------- Canales de notificación (Android) ----------
   Un canal por sonido (con vibración activada) + uno solo-vibración.
   El sonido y la vibración de una notificación en Android dependen del
   canal, por eso creamos uno por cada sonido integrado. */
export const BUILTIN_SOUNDS = ['bip', 'sirena', 'campana', 'alerta', 'timbre'];
let _channelsReady = false;
async function ensureChannels() {
  const LN = plugin('LocalNotifications');
  if (!LN || !LN.createChannel || _channelsReady) return;
  _channelsReady = true;
  const base = { importance: 5, visibility: 1, vibration: true, lights: true };
  try {
    await LN.createChannel({ id: 'inf_vibra', name: 'Alarmas (solo vibrar)', ...base });
    await LN.createChannel({ id: 'inf_default', name: 'Alarmas INFOVIP', ...base });
    for (const s of BUILTIN_SOUNDS) {
      await LN.createChannel({ id: `inf_${s}`, name: `Alarma · ${s}`, sound: `${s}.wav`, ...base });
    }
  } catch (_) {}
}

/* ---------- Disparar una notificación local (alarmas) ----------
   opts: { channelId, sound }  (sound = nombre de archivo en res/raw) */
let _notifId = 1;
export async function notify(title, body, opts = {}) {
  const LN = plugin('LocalNotifications');
  if (LN && LN.schedule) {
    try {
      await ensureChannels();
      const n = { id: _notifId++, title, body, schedule: { at: new Date(Date.now() + 200) } };
      if (opts.channelId) n.channelId = opts.channelId;
      if (opts.sound) n.sound = opts.sound;
      await LN.schedule({ notifications: [n] });
      return true;
    } catch (_) {}
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: './assets/icons/logo.png' }); return true; } catch (_) {}
  }
  return false;
}

// ¿La ubicación en segundo plano (pantalla apagada) está disponible?
// El plugin estándar cubre primer plano; el modo "siempre" se concede
// manualmente en los ajustes de Android. Lo indicamos honestamente.
export function backgroundLocationHint() {
  return isNative()
    ? 'Para que las alarmas por ubicación funcionen con la pantalla apagada, en Ajustes de Android elige "Permitir siempre" para la ubicación y desactiva la optimización de batería para INFOVIP.'
    : 'En el navegador la ubicación en segundo plano es limitada; instala el APK para mejor resultado.';
}
