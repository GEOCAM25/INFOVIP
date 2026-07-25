/* ============================================================
   INFOVIP · Bloqueo por dispositivo (lista de teléfonos autorizados)
   ------------------------------------------------------------
   NO hay claves ni códigos: la ÚNICA forma de que un teléfono entre es
   estar en la lista de autorizados que controla el administrador. La
   lista se edita en GitHub y SOLO el dueño del repositorio puede
   editarla (que el repo sea público no permite que otros escriban).

   Para no exponer los IDs, en la lista se guardan sus HUELLAS (hash
   SHA-256), no el ID legible.

   En Android 10+ el IMEI ya no se puede leer, así que usamos el
   identificador estable de Capacitor (Device.getId) y de él derivamos
   una huella corta y legible:  INV-XXXX-XXXX.

   Autorizado = la huella de este teléfono (o su hash) está en la lista
   incrustada o en la remota. La lista remota también REVOCA (quitar de
   "authorized" o poner en "revoked"). Además hay un PLAZO: si el
   teléfono no confirma su autorización con la lista durante muchos días,
   deja de abrir (kill-switch para teléfonos perdidos aunque queden sin
   internet). Un teléfono autorizado que se conecta con normalidad no lo
   nota nunca.
   ============================================================ */
import { device } from './native.js';
import { prefs } from './store.js';

// ¿Se exige autorización en esta compilación? true en producción.
export const LOCK_ENABLED = true;

// Días que un teléfono puede seguir abriendo SIN reconfirmar con la lista.
// Cada vez que confirma con internet, el plazo se renueva. Si se le acaba
// (p.ej. un teléfono perdido sin internet), se bloquea hasta reconfirmar.
const LEASE_DAYS = 12;

// Teléfonos autorizados de forma permanente (incrustados). Se añaden aquí
// solo al recompilar; para el día a día se usa la lista remota. Pueden ser
// huellas 'INV-XXXX-XXXX' o sus hash SHA-256 (hex).
export const AUTHORIZED_DEVICES = [
  // 'INV-XXXX-XXXX',
];

// Lista remota (la edita SOLO el administrador en GitHub). Va en main pero
// excluida del disparador de compilación: editarla NO recompila la app.
// URL fija: no se puede cambiar desde la app.
const LIST_URL = 'https://raw.githubusercontent.com/GEOCAM25/INFOVIP/main/www/data/authorized.json';

const enc = new TextEncoder();
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford (sin I,L,O,U)

function toHex(bytes) { return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''); }
function b32(bytes, len) {
  let bits = 0, val = 0, out = '';
  for (const byte of bytes) {
    val = (val << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out.slice(0, len);
}
async function sha256bytes(str) { return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(str))); }
async function sha256hex(str) { return toHex(await sha256bytes(str)); }

// Normaliza una huella (mayúsculas, sin espacios). La parte aleatoria usa un
// alfabeto sin caracteres confusos, así que no hace falta corregir O/I/L.
function normId(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, ''); }

/* ---------- Huella del dispositivo ---------- */
let _fp = null, _hash = null;
export async function getDeviceId() {
  if (_fp) return _fp;
  const raw = await device.rawId().catch(() => 'unknown');
  const code = b32(await sha256bytes('INFOVIP-fp:' + raw), 8);
  _fp = `INV-${code.slice(0, 4)}-${code.slice(4, 8)}`;
  return _fp;
}
// Hash de la huella (lo que se guarda en la lista para no exponer el ID).
export async function getDeviceHash() {
  if (_hash) return _hash;
  _hash = await sha256hex(await getDeviceId());
  return _hash;
}

// ¿La entrada de la lista corresponde a ESTE teléfono? Acepta huella legible,
// hash hex, u objeto { id | hash | name }.
async function entryMatches(entry, fp, hash) {
  let v = entry;
  if (entry && typeof entry === 'object') v = entry.hash || entry.id || entry.value || '';
  v = String(v || '').trim();
  if (!v) return false;
  return normId(v) === fp || v.toLowerCase() === hash;
}
async function listIncludes(arr, fp, hash) {
  if (!Array.isArray(arr)) return false;
  for (const e of arr) { if (await entryMatches(e, fp, hash)) return true; }
  return false;
}

async function bakedIn() {
  const fp = normId(await getDeviceId()); const hash = await getDeviceHash();
  return listIncludes(AUTHORIZED_DEVICES, fp, hash);
}

/* ---------- Estado cacheado ---------- */
export function isAuthorizedLocal() { return prefs.get('devGranted', false) === true; }
function setGranted(v) { prefs.set('devGranted', !!v); }
function setRevoked(v) { prefs.set('devRevoked', !!v); }
function isRevoked() { return prefs.get('devRevoked', false) === true; }
function renewLease() { prefs.set('devLease', Date.now() + LEASE_DAYS * 86400000); }
function leaseValid() {
  const until = prefs.get('devLease', 0);
  return until && Date.now() < until;
}
function clearLease() { prefs.remove('devLease'); }

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
  const fp = normId(await getDeviceId()); const hash = await getDeviceHash();
  if (await listIncludes(list.revoked, fp, hash)) { setRevoked(true); setGranted(false); clearLease(); return 'revoked'; }
  setRevoked(false);
  if (await listIncludes(list.authorized, fp, hash)) { setGranted(true); renewLease(); return 'authorized'; }
  // No está en la lista: se le retira la concesión (quitar de la lista revoca).
  setGranted(false); clearLease();
  return null;
}

/* ---------- Chequeo principal (arranque, rápido y offline) ---------- */
export async function checkAuthorization() {
  const deviceId = await getDeviceId();
  if (!LOCK_ENABLED) return { authorized: true, deviceId };
  if (isRevoked()) return { authorized: false, deviceId };
  if (await bakedIn()) return { authorized: true, deviceId };
  // Concedido por la lista Y con el plazo vigente (kill-switch por tiempo).
  return { authorized: isAuthorizedLocal() && leaseValid(), deviceId };
}

// Para un teléfono YA autorizado: revisa en 2º plano si fue revocado o
// retirado de la lista. Devuelve true si ahora está bloqueado.
export async function checkRevocation() {
  if (!LOCK_ENABLED || !navigator.onLine) return false;
  const before = (await checkAuthorization()).authorized;
  if (!before) return false;
  await syncRemote().catch(() => null);
  const after = (await checkAuthorization()).authorized;
  return before && !after;
}
