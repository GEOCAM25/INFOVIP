/* ============================================================
   INFOVIP · Motor de reglas de automatizaciones (If / Then)
   Evalúa condiciones de GPS (radio en metros) + batería y, al
   cumplirse, reproduce el audio configurado con su volumen y
   dispara la vibración. Vigila incluso con pantalla apagada
   apoyándose en los watchers nativos de Capacitor.
   ============================================================ */
import { db } from '../core/db.js';
import { geo, device, haptics, distanceMeters } from '../core/native.js';
import { toast } from '../core/ui.js';
import { notify } from '../core/permissions.js';

let stopGeo = null;
let batteryTimer = null;
let lastPos = null;
let running = false;
const firedCooldown = new Map(); // id -> timestamp del último disparo

const COOLDOWN_MS = 60 * 1000; // no re-disparar la misma regla dentro de 1 min

export async function startEngine() {
  if (running) return;
  running = true;
  try {
    stopGeo = await geo.watch((pos) => { lastPos = pos; evaluateAll('geo'); });
  } catch (_) {}
  batteryTimer = setInterval(() => evaluateAll('battery'), 20000);
  evaluateAll('init');
}

export function stopEngine() {
  running = false;
  if (stopGeo) { stopGeo(); stopGeo = null; }
  if (batteryTimer) { clearInterval(batteryTimer); batteryTimer = null; }
}

async function evaluateAll(source) {
  let rules;
  try { rules = await db.getAll('automatizaciones'); } catch (_) { return; }
  const enabled = rules.filter((r) => r.enabled);
  if (!enabled.length) return;

  const bat = await device.battery().catch(() => ({ level: null, charging: null }));

  for (const rule of enabled) {
    if (await matches(rule, bat)) {
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
    checks.push(c.battery.op === 'lt' ? v < t : c.battery.op === 'gt' ? v > t : v === t);
  }
  if (!checks.length) return false;
  // Lógica AND (todas deben cumplirse). 'match' guarda modo por si se amplía.
  return rule.logic === 'or' ? checks.some(Boolean) : checks.every(Boolean);
}

async function fire(rule) {
  const act = rule.action || {};
  // Vibración
  if (act.vibrate) haptics.vibrate(act.vibrateMs || 600);

  // Audio
  if (act.audioId != null) {
    try {
      const audio = await db.get('audios', act.audioId);
      if (audio && audio.blob) {
        const url = URL.createObjectURL(audio.blob);
        const el = new Audio(url);
        el.volume = Math.max(0, Math.min(1, (act.volume ?? 100) / 100));
        el.loop = !!act.loop;
        el.play().catch(() => {});
        el.addEventListener('ended', () => URL.revokeObjectURL(url));
        // Detener loop tras 30s de seguridad
        if (act.loop) setTimeout(() => { el.pause(); URL.revokeObjectURL(url); }, 30000);
      }
    } catch (_) {}
  }
  // Notificación local: llega aunque la app esté en segundo plano.
  notify('⚡ ' + (rule.name || 'Automatización'), describeFire(rule));
  toast(`⚡ ${rule.name}`);
}

function describeFire(rule) {
  const c = rule.conditions || {};
  const parts = [];
  if (c.location) parts.push('llegaste a la ubicación');
  if (c.battery) parts.push(`batería ${c.battery.op === 'lt' ? '<' : '>'} ${c.battery.value}%`);
  return 'Se cumplió: ' + (parts.join(' y ') || 'condición');
}

export function engineStatus() { return running; }
