/* ============================================================
   INFOVIP · Motor de reglas de automatizaciones (If / Then)
   Evalúa condiciones de GPS (radio en metros) + batería y, al
   cumplirse, reproduce el audio configurado con su volumen y
   dispara la vibración. Vigila incluso con pantalla apagada
   apoyándose en los watchers nativos de Capacitor.
   ============================================================ */
import { db } from '../core/db.js';
import { device, haptics, distanceMeters } from '../core/native.js';
import { toast } from '../core/ui.js';
import { prefs } from '../core/store.js';
import { notify } from '../core/permissions.js';
import { getCurrentWeather, summarize, getSunTimes } from '../core/weather.js';
import * as bggeo from '../core/bggeo.js';

let batteryTimer = null;
let climaTimer = null;
let lastPos = null;
let running = false;
let watching = false;    // ¿servicio de ubicación en 2º plano activo?
const firedCooldown = new Map(); // id -> timestamp del último disparo
const firedToday = new Map();    // id -> 'YYYY-MM-DD' (reglas por horario/sol)
const matchState = new Map();    // id -> bool (para disparar por BORDE: falso→verdadero)

const COOLDOWN_MS = 60 * 1000; // no re-disparar la misma regla dentro de 1 min

export async function startEngine() {
  if (running) return;
  running = true;
  batteryTimer = setInterval(() => evaluateAll('battery'), 20000);
  climaTimer = setInterval(() => { climaCheck(); scheduledCheck(); }, 60000);
  await syncWatchers();
  evaluateAll('init');
  climaCheck();
  scheduledCheck();
}

export function stopEngine() {
  running = false;
  if (batteryTimer) { clearInterval(batteryTimer); batteryTimer = null; }
  if (climaTimer) { clearInterval(climaTimer); climaTimer = null; }
  bggeo.stop(); watching = false;
}

/* ---------- Automatización de clima ---------- */
export function getClimaConfig() { return prefs.get('climaAuto', { enabled: false, everyHours: 1, quietFrom: '', quietTo: '' }); }
export function setClimaConfig(cfg) {
  prefs.set('climaAuto', cfg);
  if (cfg.enabled) prefs.set('climaLast', 0); // fuerza un envío pronto
  syncWatchers();
}
// ¿La hora actual cae en la franja de silencio [from,to]? (soporta cruzar medianoche)
function inQuiet(from, to) {
  if (!from || !to) return false;
  const now = new Date(); const n = now.getHours() * 60 + now.getMinutes();
  const [fh, fm] = from.split(':').map(Number); const [th, tm] = to.split(':').map(Number);
  const a = fh * 60 + fm, b = th * 60 + tm;
  return a <= b ? (n >= a && n < b) : (n >= a || n < b); // b<a → cruza medianoche
}
export async function climaCheck() {
  const c = getClimaConfig();
  if (!c.enabled) return;
  if (inQuiet(c.quietFrom, c.quietTo)) return; // en silencio: no notificar
  const last = prefs.get('climaLast', 0);
  if (Date.now() - last < (c.everyHours || 1) * 3600000) return;
  prefs.set('climaLast', Date.now());
  try {
    const s = summarize(await getCurrentWeather());
    notify('🌦️ Clima', s.text, { channelId: 'inf_default' });
  } catch (_) { /* sin señal: se reintenta al próximo tick */ }
}
export function climaInQuiet() { const c = getClimaConfig(); return inQuiet(c.quietFrom, c.quietTo); }

/* ---------- Reglas por HORARIO / SOL (amanecer/atardecer) ---------- */
async function scheduledCheck() {
  let rules = [];
  try { rules = await db.getAll('automatizaciones'); } catch (_) { return; }
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = now.toISOString().slice(0, 10);
  let sun = null;
  for (const r of rules) {
    if (!r.enabled) continue;
    const c = r.conditions || {};
    let target = null;
    if (c.time && c.time.at) {
      const [hh, mm] = c.time.at.split(':').map(Number); target = hh * 60 + mm;
    } else if (c.sun && c.sun.event) {
      if (!sun) { try { sun = await getSunTimes(); } catch (_) { continue; } }
      const t = c.sun.event === 'sunset' ? sun.sunset : sun.sunrise;
      target = t.getHours() * 60 + t.getMinutes() + (Number(c.sun.offsetMin) || 0);
    }
    if (target == null) continue;
    if (nowMin === target && firedToday.get(r.id) !== today) {
      firedToday.set(r.id, today);
      fire(r);
    }
  }
}
// Envía el clima ahora mismo (para el botón "Probar").
export async function fireClimaNow() {
  try { const s = summarize(await getCurrentWeather()); notify('🌦️ Clima', s.text, { channelId: 'inf_default' }); return s.text; }
  catch (_) { return null; }
}

// Enciende el servicio de ubicación en 2º plano solo si hay alguna
// automatización activa con condición de ubicación (evita la notificación
// persistente cuando no hace falta). Llamar tras crear/editar reglas.
export async function syncWatchers() {
  let rules = [];
  try { rules = await db.getAll('automatizaciones'); } catch (_) {}
  const needsLocation = rules.some((r) => r.enabled && r.conditions && r.conditions.location && r.conditions.location.lat != null);
  const needsScheduled = rules.some((r) => r.enabled && r.conditions && ((r.conditions.time && r.conditions.time.at) || (r.conditions.sun && r.conditions.sun.event)));
  // Clima y reglas por horario/sol también necesitan mantener la app viva.
  const needsAlive = needsLocation || needsScheduled || getClimaConfig().enabled;

  if (needsAlive && !watching) {
    watching = true;
    try {
      await bggeo.start(
        (pos) => { lastPos = pos; evaluateAll('geo'); },
        (err) => console.warn('[bggeo]', err)
      );
    } catch (e) { watching = false; console.warn('[engine] no se pudo iniciar bg geo', e); }
  } else if (!needsAlive && watching) {
    await bggeo.stop(); watching = false;
  }
}

async function evaluateAll(source) {
  let rules;
  try { rules = await db.getAll('automatizaciones'); } catch (_) { return; }
  const enabled = rules.filter((r) => r.enabled);
  if (!enabled.length) return;

  const bat = await device.battery().catch(() => ({ level: null, charging: null }));

  for (const rule of enabled) {
    const isMatch = await matches(rule, bat);
    const was = matchState.get(rule.id) || false;
    matchState.set(rule.id, isMatch);
    // Disparo por BORDE: solo cuando pasa de "no se cumple" a "se cumple".
    // (Evita re-sonar mientras la condición sigue verdadera, p.ej. al recargar.)
    if (isMatch && !was) {
      const last = firedCooldown.get(rule.id) || 0;
      if (Date.now() - last < COOLDOWN_MS) continue;
      firedCooldown.set(rule.id, Date.now());
      fire(rule);
    }
  }
}

async function matches(rule, bat) {
  const c = rule.conditions || {};
  const checks = [];

  if (c.location && c.location.lat != null) {
    if (!lastPos) return false;
    const d = distanceMeters(lastPos, c.location);
    checks.push(d <= (c.location.radius || 100));
  }
  if (c.battery && c.battery.op) {
    if (bat.level == null) return false;
    const v = bat.level, t = Number(c.battery.value);
    const cond = c.battery.op === 'lt' ? v < t : c.battery.op === 'gt' ? v > t : v === t;
    // Dirección de carga: avisos "bajos" (< o =) solo al DESCARGAR;
    // "altos" (>) solo al CARGAR. Así el aviso de "carga el teléfono" no
    // suena cuando ya lo estás cargando y sube de vuelta a 30%.
    let dirOk = true;
    if (bat.charging === true) dirOk = (c.battery.op === 'gt');
    else if (bat.charging === false) dirOk = (c.battery.op !== 'gt');
    checks.push(cond && dirOk);
  }
  if (!checks.length) return false;
  // Lógica AND (todas deben cumplirse). 'match' guarda modo por si se amplía.
  return rule.logic === 'or' ? checks.some(Boolean) : checks.every(Boolean);
}

// Patrones de vibración (ms) para navigator.vibrate en primer plano.
export const VIBRATIONS = {
  corta: [0, 250],
  larga: [0, 700],
  doble: [0, 220, 150, 220],
  triple: [0, 150, 120, 150, 120, 150],
  sos:   [0, 150, 100, 150, 100, 150, 300, 420, 120, 420, 120, 420, 300, 150, 100, 150, 100, 150]
};

async function fire(rule) {
  const act = rule.action || {};
  const mode = act.mode || (act.audioId != null ? 'propio' : 'vibrar');

  // 1) Vibración (patrón elegido). En primer plano vibra por patrón;
  //    en segundo plano vibra el canal de la notificación.
  const pattern = VIBRATIONS[act.vibration || 'doble'] || VIBRATIONS.doble;
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (_) {} }
  else haptics.vibrate(600);

  // 2) Sonido
  let channelId = 'inf_vibra', soundFile = null;
  if (mode === 'sonido' && act.sound) {
    channelId = `inf_${act.sound}`; soundFile = `${act.sound}.wav`;
    playUrl(`./assets/sounds/${act.sound}.wav`, act.volume, act.loop);
  } else if (mode === 'propio' && act.audioId != null) {
    channelId = 'inf_default';
    try {
      const audio = await db.get('audios', act.audioId);
      if (audio && audio.blob) playUrl(URL.createObjectURL(audio.blob), act.volume, act.loop, true);
    } catch (_) {}
  }

  // 3) Notificación (llega en segundo plano; su canal aporta sonido/vibración)
  const cc = rule.conditions || {};
  const emoji = cc.time && cc.time.at ? '⏰'
    : cc.sun && cc.sun.event ? (cc.sun.event === 'sunset' ? '🌇' : '🌅')
    : cc.location && cc.location.lat != null ? '📍'
    : cc.battery && cc.battery.op ? '🔋' : '⚡';
  notify(`${emoji} ${rule.name || 'Automatización'}`, describeFire(rule), { channelId, sound: soundFile });
  toast(`${emoji} ${rule.name}`);
}

function playUrl(url, volume, loop, revoke) {
  try {
    const el = new Audio(url);
    el.volume = Math.max(0, Math.min(1, (volume ?? 100) / 100));
    el.loop = !!loop;
    el.play().catch(() => {});
    const done = () => { if (revoke) URL.revokeObjectURL(url); };
    el.addEventListener('ended', done);
    if (loop) setTimeout(() => { el.pause(); done(); }, 30000);
  } catch (_) {}
}

function describeFire(rule) {
  const c = rule.conditions || {};
  const parts = [];
  if (c.location) parts.push('llegaste a la ubicación');
  if (c.battery) parts.push(`batería ${c.battery.op === 'lt' ? '<' : '>'} ${c.battery.value}%`);
  return 'Se cumplió: ' + (parts.join(' y ') || 'condición');
}

export function engineStatus() { return running; }
export function watchingLocation() { return watching; }
export function backgroundCapable() { return bggeo.hasBackground(); }
