/* ============================================================
   INFOVIP · Bloqueo por dispositivo (lista de teléfonos autorizados)
   ------------------------------------------------------------
   La ÚNICA forma de que un teléfono entre es estar autorizado. Se
   autoriza de dos maneras:
     A) LISTA en GitHub (authorized.json) que SOLO el dueño edita. Que
        el repo sea público no permite que otros escriban.
     B) CÓDIGO DE ADMINISTRADOR: se escribe en la zona oculta (15 toques)
        y habilita ese teléfono al instante, sin internet ni GitHub.

   Para no exponer los IDs, en la lista se guardan sus HUELLAS (hash
   SHA-256), no el ID legible.

   KILL-SWITCH: todo teléfono debe reconfirmar por internet cada pocas
   horas; si pasa más de 6 h sin poder confirmar (p.ej. teléfono
   perdido/robado), la app se bloquea sola. Un teléfono con señal normal
   renueva el plazo constantemente y nunca lo nota.

   REVOCAR: quitar la huella de "authorized" o ponerla en "revoked"
   bloquea el teléfono en cuanto vuelva a tener internet.
   ============================================================ */
import { device } from './native.js';
import { prefs } from './store.js';

// ¿Se exige autorización en esta compilación? true en producción.
export const LOCK_ENABLED = true;

// Horas que un teléfono puede seguir abriendo SIN reconfirmar por internet.
// Si se agota (teléfono sin señal / perdido), se bloquea hasta reconfirmar.
const LEASE_HOURS = 6;

// Toques sobre el rombo para revelar la zona oculta (ID + código admin).
export const SECRET_TAPS = 15;

// Semilla para derivar el código de administrador (va incrustada; queda
// tras 15 toques, no a la vista). Es una llave de conveniencia para
// habilitar un teléfono en el momento sin GitHub.
const SECRET = 'INFOVIP-admin-9f3c7a1e-EEPA-2026-v2';

// Teléfonos autorizados de forma permanente (incrustados). Se añaden aquí
// solo al recompilar. Pueden ser huellas 'INV-XXXX-XXXX' o sus hash.
export const AUTHORIZED_DEVICES = [
  // 'INV-XXXX-XXXX',
];

// Lista remota (la edita SOLO el administrador en GitHub). Va en main pero
// excluida del disparador de compilación: editarla NO recompila la app.
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
async function hmacBytes(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

function normId(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, ''); }
function normCode(s) { return String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, ''); }

/* ---------- Huella del dispositivo ---------- */
let _fp = null, _hash = null;
export async function getDeviceId() {
  if (_fp) return _fp;
  const raw = await device.rawId().catch(() => 'unknown');
  const code = b32(await sha256bytes('INFOVIP-fp:' + raw), 8);
  _fp = `INV-${code.slice(0, 4)}-${code.slice(4, 8)}`;
  return _fp;
}
export async function getDeviceHash() {
  if (_hash) return _hash;
  _hash = await sha256hex(await getDeviceId());
  return _hash;
}

/* ---------- Código de administrador ---------- */
export async function adminCode() {
  const sig = await hmacBytes(SECRET, 'admin:v2');
  const c = b32(sig, 10);
  return `${c.slice(0, 5)}-${c.slice(5, 10)}`;
}
export async function verifyAdminCode(input) {
  const typed = normCode(input);
  if (!typed) return false;
  return typed === normCode(await adminCode());
}

/* ---------- Coincidencia con entradas de la lista ---------- */
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
// devGranted: autorizado (por lista o código). devSource: 'list' | 'admin'.
// devRevoked: revocado por la lista (pegajoso). devLease: hasta cuándo vale
// sin reconfirmar por internet.
export function isAuthorizedLocal() { return prefs.get('devGranted', false) === true; }
function setGranted(v) { prefs.set('devGranted', !!v); }
function setSource(s) { prefs.set('devSource', s); }
function getSource() { return prefs.get('devSource', ''); }
function setRevoked(v) { prefs.set('devRevoked', !!v); }
function isRevoked() { return prefs.get('devRevoked', false) === true; }
function renewLease() { prefs.set('devLease', Date.now() + LEASE_HOURS * 3600000); }
function leaseValid() { const u = prefs.get('devLease', 0); return u && Date.now() < u; }
function clearLease() { prefs.remove('devLease'); }

// Habilita este teléfono con el código de administrador (offline).
export async function authorizeByAdminCode(input) {
  if (!(await verifyAdminCode(input))) return false;
  setRevoked(false); setGranted(true); setSource('admin'); renewLease();
  return true;
}

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
  if (!list) return null; // sin conexión: no renueva el plazo (kill-switch)
  const fp = normId(await getDeviceId()); const hash = await getDeviceHash();
  if (await listIncludes(list.revoked, fp, hash)) { setRevoked(true); setGranted(false); setSource(''); clearLease(); return 'revoked'; }
  setRevoked(false);
  if (await listIncludes(list.authorized, fp, hash)) { setGranted(true); setSource('list'); renewLease(); return 'authorized'; }
  // No está en la lista pero no está revocado:
  if (getSource() === 'admin' && isAuthorizedLocal()) { renewLease(); return 'authorized'; } // habilitado por código: se mantiene
  setGranted(false); setSource(''); clearLease(); // quitado de la lista → revoca
  return null;
}

/* ---------- Chequeo principal (arranque, rápido y offline) ---------- */
export async function checkAuthorization() {
  const deviceId = await getDeviceId();
  if (!LOCK_ENABLED) return { authorized: true, deviceId };
  if (await bakedIn()) return { authorized: true, deviceId }; // incrustado: permanente
  if (isRevoked()) return { authorized: false, deviceId };
  return { authorized: isAuthorizedLocal() && leaseValid(), deviceId };
}

// Para un teléfono YA autorizado: revisa en 2º plano si fue revocado o si
// se le acabó el plazo. Devuelve true si ahora está bloqueado.
export async function checkRevocation() {
  if (!LOCK_ENABLED || !navigator.onLine) return false;
  const before = (await checkAuthorization()).authorized;
  if (!before) return false;
  await syncRemote().catch(() => null);
  const after = (await checkAuthorization()).authorized;
  return before && !after;
}
