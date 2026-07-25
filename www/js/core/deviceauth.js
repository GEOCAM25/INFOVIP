/* ============================================================
   INFOVIP · Bloqueo por dispositivo ("solo teléfonos autorizados")
   ------------------------------------------------------------
   En Android 10+ el IMEI ya no se puede leer, así que usamos el
   identificador estable que entrega Capacitor (Device.getId) y de él
   derivamos una "huella" corta y legible:  INV-XXXX-XXXX.

   Un teléfono queda autorizado por cualquiera de estas vías:
     1) CÓDIGO DE ACTIVACIÓN (offline): un código atado a ESA huella.
        El admin lo genera desde su propio teléfono (Ajustes) y se lo
        pasa por WhatsApp. Sirve sin internet y no se puede compartir
        entre teléfonos (cada código solo vale para su huella).
     2) LISTA REMOTA (GitHub): un archivo authorized.json en el repo con
        las huellas permitidas. Se consulta al abrir (si hay internet) y
        queda cacheada. Permite AÑADIR o REVOCAR teléfonos de forma
        central sin generar códigos.

   Una vez autorizado, el estado queda guardado y la app abre siempre,
   aunque no haya señal. La revocación remota (si hay internet) puede
   volver a bloquearlo.
   ============================================================ */
import { device } from './native.js';
import { prefs } from './store.js';

// ¿Se exige autorización en esta compilación? true en producción.
export const LOCK_ENABLED = true;

// Semilla secreta para derivar los códigos de activación. Va incrustada
// en la app (es un tornillo, no una caja fuerte): impide que alguien que
// instale el APK lo abra sin un código, que es justo lo que se busca.
const SECRET = 'INFOVIP-9f3c7a1e-Guardia-EEPA-2026-lock-v1';

// URL de la lista remota de huellas autorizadas (editable en GitHub).
// Si no se puede leer (sin internet o repo privado), se ignora sin romper.
const DEFAULT_LIST_URL =
  'https://raw.githubusercontent.com/geocam25/infovip/main/www/data/authorized.json';

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

async function hmac256(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return new Uint8Array(sig);
}

// Normaliza un código escrito por el usuario (mayúsculas, sin guiones/espacios,
// corrige confusiones típicas O→0, I/L→1).
function normCode(s) {
  return String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1');
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

/* ---------- Código de activación atado a una huella ---------- */
// Genera el código para una huella dada (lo usa el admin desde Ajustes).
export async function codeForId(deviceId) {
  const sig = await hmac256(SECRET, 'activate:' + normCode(deviceId));
  const code = b32(sig, 8);
  return `${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

// Código MAESTRO: autoriza cualquier teléfono. Sirve para "arrancar" el
// primer teléfono del admin (que aún no está en ninguna lista) y desde ahí
// generar los códigos del resto. Guárdalo en privado.
export async function masterCode() {
  const sig = await hmac256(SECRET, 'master:INFOVIP');
  const code = b32(sig, 10);
  return `${code.slice(0, 5)}-${code.slice(5, 10)}`;
}

// Verifica un código escrito contra la huella de ESTE teléfono (o el maestro).
export async function verifyCode(input) {
  const typed = normCode(input);
  if (!typed) return false;
  const id = await getDeviceId();
  const expected = normCode(await codeForId(id));
  const master = normCode(await masterCode());
  return typed === expected || typed === master;
}

/* ---------- Persistencia del estado autorizado ---------- */
function markAuthorized(via) {
  prefs.set('devAuth', { ok: true, via, at: Date.now() });
}
export function isAuthorizedLocal() {
  return !!(prefs.get('devAuth', null) || {}).ok;
}
export function clearAuthorization() { prefs.remove('devAuth'); }

// Guarda el código y marca autorizado si es válido.
export async function activateWithCode(input) {
  if (await verifyCode(input)) { markAuthorized('codigo'); return true; }
  return false;
}

/* ---------- Lista remota (GitHub) ---------- */
export function getListUrl() { return prefs.get('devListUrl', DEFAULT_LIST_URL); }
export function setListUrl(u) { prefs.set('devListUrl', u || DEFAULT_LIST_URL); }

// Descarga la lista: { authorized: ["INV-..."], revoked: ["INV-..."] }.
// Usa CapacitorHttp si está disponible (evita CORS); si no, fetch normal.
async function fetchList() {
  const url = getListUrl();
  if (!url) return null;
  const bust = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
  try {
    const CapHttp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
    if (CapHttp && CapHttp.get) {
      const r = await CapHttp.get({ url: bust, headers: { Accept: 'application/json' }, connectTimeout: 8000, readTimeout: 8000 });
      const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      return data;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(bust, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch (_) { return null; }
}

// Consulta la lista remota y actualiza el estado local:
//  - si la huella está en "revoked" → se bloquea (borra autorización).
//  - si está en "authorized" → se autoriza.
// Devuelve 'authorized' | 'revoked' | null (sin cambios / sin conexión).
export async function syncRemote() {
  const list = await fetchList();
  if (!list) return null;
  const id = normCode(await getDeviceId());
  const norm = (arr) => (Array.isArray(arr) ? arr.map(normCode) : []);
  const revoked = norm(list.revoked);
  const allowed = norm(list.authorized);
  if (revoked.includes(id)) { clearAuthorization(); prefs.set('devListSeen', Date.now()); return 'revoked'; }
  if (allowed.includes(id)) { markAuthorized('lista'); prefs.set('devListSeen', Date.now()); return 'authorized'; }
  prefs.set('devListSeen', Date.now());
  return null;
}

/* ---------- Chequeo principal (lo llama el arranque) ---------- */
// Rápido y offline-first: resuelve con el estado LOCAL sin esperar a la red,
// para que el arranque no se quede colgado. La comprobación remota (autorizar
// nuevos teléfonos o revocar) la hacen la pantalla de bloqueo y el chequeo en
// segundo plano. Resuelve { authorized, deviceId }.
export async function checkAuthorization() {
  const deviceId = await getDeviceId();
  if (!LOCK_ENABLED) return { authorized: true, deviceId };
  return { authorized: isAuthorizedLocal(), deviceId };
}

// Revisa la lista remota en 2º plano para un teléfono YA autorizado: si fue
// revocado, devuelve true (el arranque decide qué hacer). No bloquea el uso.
export async function checkRevocation() {
  if (!LOCK_ENABLED || !isAuthorizedLocal() || !navigator.onLine) return false;
  const r = await syncRemote().catch(() => null);
  return r === 'revoked';
}
