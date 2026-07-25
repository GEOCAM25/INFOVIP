/* ============================================================
   INFOVIP · Bloqueo por dispositivo (lista de teléfonos autorizados)
   ------------------------------------------------------------
   NO hay claves ni códigos: la ÚNICA forma de que un teléfono entre es
   estar en la lista de autorizados que controla el administrador. Así,
   aunque alguien lea el código de la app, no puede autorizarse solo.

   En Android 10+ el IMEI ya no se puede leer, así que usamos el
   identificador estable de Capacitor (Device.getId) y de él derivamos
   una "huella" corta y legible:  INV-XXXX-XXXX.

   Un teléfono queda autorizado si su huella está en:
     1) la LISTA INCRUSTADA en la app (AUTHORIZED_DEVICES), o
     2) la LISTA REMOTA en GitHub (authorized.json), que el admin edita
        sin recompilar la app.
   La lista remota también puede REVOCAR un teléfono (ponerlo en "revoked"),
   lo que lo bloquea aunque estuviera incrustado. Una vez autorizado, el
   permiso queda cacheado y la app abre sin señal.
   ============================================================ */
import { device } from './native.js';
import { prefs } from './store.js';

// ¿Se exige autorización en esta compilación? true en producción.
export const LOCK_ENABLED = true;

// Teléfonos autorizados de forma permanente (incrustados en la app).
// Se añaden aquí solo al recompilar. Para el día a día se usa la lista
// remota, que no necesita recompilar. Formato: 'INV-XXXX-XXXX'.
export const AUTHORIZED_DEVICES = [
  // 'INV-XXXX-XXXX',
];

// Lista remota de huellas autorizadas (la edita SOLO el administrador en
// GitHub). Va en la rama main pero excluida del disparador de compilación,
// así editarla NO recompila la app. URL fija (no se puede cambiar desde la
// app, para que nadie pueda apuntar a otra lista).
const LIST_URL = 'https://raw.githubusercontent.com/GEOCAM25/INFOVIP/main/www/data/authorized.json';

const enc = new TextEncoder();
// Alfabeto Crockford base32 sin caracteres confusos (sin I, L, O, U).
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function b32(bytes, len) {
  let bits = 0, val = 0, out = '';
  for (const byte of bytes) {
    val = (val << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out.slice(0, len);
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return new Uint8Array(buf);
}

// Normaliza una huella para comparar (mayúsculas, corrige O→0, I/L→1).
function normId(s) {
  return String(s || '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z-]/g, '');
}

/* ---------- Huella del dispositivo (INV-XXXX-XXXX) ---------- */
let _fp = null;
export async function getDeviceId() {
  if (_fp) return _fp;
  const raw = await device.rawId().catch(() => 'unknown');
  const digest = await sha256('INFOVIP-fp:' + raw);
  const code = b32(digest, 8); // 8 caracteres base32
  _fp = `INV-${code.slice(0, 4)}-${code.slice(4, 8)}`;
  return _fp;
}

function bakedIn(id) {
  const n = normId(id);
  return AUTHORIZED_DEVICES.map(normId).includes(n);
}

/* ---------- Estado cacheado ---------- */
// devGranted: autorizado por la lista remota (cacheado para uso offline).
// devRevoked: revocado por la lista remota (pegajoso hasta re-autorizar).
export function isAuthorizedLocal() { return prefs.get('devGranted', false) === true; }
function setGranted(v) { prefs.set('devGranted', !!v); }
function setRevoked(v) { prefs.set('devRevoked', !!v); }
function isRevoked() { return prefs.get('devRevoked', false) === true; }

/* ---------- Lista remota (GitHub) ---------- */
export function getListUrl() { return LIST_URL; }

async function fetchList() {
  const bust = LIST_URL + (LIST_URL.includes('?') ? '&' : '?') + 't=' + Date.now();
  try {
    const CapHttp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
    if (CapHttp && CapHttp.get) {
      const r = await CapHttp.get({ url: bust, headers: { Accept: 'application/json' }, connectTimeout: 8000, readTimeout: 8000 });
      return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(bust, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch (_) { return null; }
}

// Consulta la lista remota y actualiza el estado cacheado.
// Devuelve 'authorized' | 'revoked' | null.
export async function syncRemote() {
  const list = await fetchList();
  if (!list) return null;
  const id = normId(await getDeviceId());
  const norm = (arr) => (Array.isArray(arr) ? arr.map(normId) : []);
  const revoked = norm(list.revoked);
  const allowed = norm(list.authorized);
  if (revoked.includes(id)) { setRevoked(true); setGranted(false); return 'revoked'; }
  setRevoked(false);
  if (allowed.includes(id)) { setGranted(true); return 'authorized'; }
  // No está en la lista: si antes se le había concedido por remoto, se le
  // retira (así quitar un teléfono de la lista también lo revoca).
  setGranted(false);
  return null;
}

/* ---------- Chequeo principal (arranque, rápido y offline) ---------- */
// Resuelve con el estado LOCAL sin esperar a la red. La comprobación remota
// la hacen la pantalla de bloqueo y el chequeo en 2º plano.
export async function checkAuthorization() {
  const deviceId = await getDeviceId();
  if (!LOCK_ENABLED) return { authorized: true, deviceId };
  if (isRevoked()) return { authorized: false, deviceId };
  return { authorized: bakedIn(deviceId) || isAuthorizedLocal(), deviceId };
}

// Para un teléfono YA autorizado: revisa en 2º plano si fue revocado o
// retirado de la lista. Devuelve true si ahora está bloqueado.
export async function checkRevocation() {
  if (!LOCK_ENABLED || !navigator.onLine) return false;
  const before = (await checkAuthorization()).authorized;
  if (!before) return false;
  const r = await syncRemote().catch(() => null);
  if (r === 'revoked') return true;
  // Si perdió la concesión remota y tampoco está incrustado, queda fuera.
  const after = (await checkAuthorization()).authorized;
  return before && !after;
}
