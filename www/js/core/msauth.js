/* ============================================================
   INFOVIP · Autenticación Microsoft (OAuth2 + PKCE)
   Login oficial de Microsoft para acceder a SharePoint vía Graph.
   - En el APK (Capacitor): abre el navegador del sistema (Custom Tab,
     no webview embebido, así Microsoft no lo bloquea) y vuelve por
     deep-link com.infovip.app://auth. El intercambio de token usa
     CapacitorHttp (sin problemas de CORS).
   - En web (pruebas): flujo redirect SPA con redirect.html.
   No se guarda ninguna contraseña ni secreto; solo tokens del usuario.
   ============================================================ */
import { prefs } from './store.js';
import { isNative } from './native.js';

const TOKEN_KEY = 'msalToken';     // { access, refresh, exp, account }
const PKCE_KEY = 'msalPkce';       // { verifier, state } durante el login

const SCOPES = ['openid', 'profile', 'offline_access', 'Sites.ReadWrite.All'];

function cfg() {
  return {
    clientId: prefs.get('msClientId', ''),
    tenant: prefs.get('msTenant', '') || 'organizations'
  };
}
export function isConfigured() { return !!cfg().clientId; }

function redirectUri() {
  return isNative() ? 'com.infovip.app://auth' : (location.origin + '/redirect.html');
}
function authorityBase() { return `https://login.microsoftonline.com/${cfg().tenant}`; }

/* ---------- Utilidades PKCE ---------- */
function b64url(bytes) {
  let s = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomStr(len = 64) {
  const a = new Uint8Array(len); crypto.getRandomValues(a);
  return b64url(a).slice(0, len);
}
async function challenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(digest);
}

function plugin(name) {
  const c = window.Capacitor;
  return c && c.Plugins ? c.Plugins[name] : undefined;
}

/* ---------- Login ---------- */
export async function signIn() {
  if (!isConfigured()) throw new Error('Falta configurar el Client ID de Microsoft');
  const verifier = randomStr(64);
  const state = randomStr(16);
  prefs.set(PKCE_KEY, { verifier, state });

  const url = `${authorityBase()}/oauth2/v2.0/authorize?` + new URLSearchParams({
    client_id: cfg().clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: SCOPES.join(' '),
    state,
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account'
  }).toString();

  if (isNative()) return signInNative(url);
  // Web: redirect de página completa; redirect.html termina el flujo.
  location.assign(url);
  return new Promise(() => {}); // no retorna: la página navega
}

async function signInNative(url) {
  const Browser = plugin('Browser');
  const App = plugin('App');
  if (!Browser || !App) throw new Error('Plugins de Capacitor no disponibles');

  return new Promise(async (resolve, reject) => {
    const sub = await App.addListener('appUrlOpen', async (data) => {
      try {
        if (!data || !data.url || !data.url.startsWith('com.infovip.app://auth')) return;
        const u = new URL(data.url);
        const code = u.searchParams.get('code');
        const err = u.searchParams.get('error_description') || u.searchParams.get('error');
        sub.remove();
        try { await Browser.close(); } catch (_) {}
        if (err) return reject(new Error(err));
        if (!code) return reject(new Error('No se recibió el código de autorización'));
        const token = await exchangeCode(code);
        resolve(token);
      } catch (e) { reject(e); }
    });
    try { await Browser.open({ url, presentationStyle: 'popover' }); }
    catch (e) { sub.remove(); reject(e); }
  });
}

/* ---------- Intercambio de código por token ---------- */
export async function exchangeCode(code) {
  const pkce = prefs.get(PKCE_KEY, {});
  const body = new URLSearchParams({
    client_id: cfg().clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: pkce.verifier || '',
    scope: SCOPES.join(' ')
  });
  const res = await fetch(`${authorityBase()}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  if (!res.ok) throw new Error('Fallo al obtener el token: ' + (await res.text()).slice(0, 200));
  const data = await res.json();
  return store(data);
}

async function refresh() {
  const t = prefs.get(TOKEN_KEY, null);
  if (!t || !t.refresh) return null;
  const body = new URLSearchParams({
    client_id: cfg().clientId,
    grant_type: 'refresh_token',
    refresh_token: t.refresh,
    scope: SCOPES.join(' ')
  });
  const res = await fetch(`${authorityBase()}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  if (!res.ok) { prefs.remove(TOKEN_KEY); return null; }
  return store(await res.json());
}

function store(data) {
  const token = {
    access: data.access_token,
    refresh: data.refresh_token || prefs.get(TOKEN_KEY, {}).refresh || null,
    exp: Date.now() + (data.expires_in ? data.expires_in * 1000 : 3600000) - 60000,
    account: parseAccount(data.id_token)
  };
  prefs.set(TOKEN_KEY, token);
  prefs.remove(PKCE_KEY);
  return token;
}

function parseAccount(idToken) {
  try {
    const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return { name: payload.name, email: payload.preferred_username };
  } catch (_) { return null; }
}

/* ---------- API pública ---------- */
export async function getAccessToken() {
  const t = prefs.get(TOKEN_KEY, null);
  if (t && t.access && Date.now() < t.exp) return t.access;
  const refreshed = await refresh();
  return refreshed ? refreshed.access : null;
}
export function account() { return prefs.get(TOKEN_KEY, {}).account || null; }
export function isSignedIn() { const t = prefs.get(TOKEN_KEY, null); return !!(t && t.refresh); }
export function signOut() { prefs.remove(TOKEN_KEY); prefs.remove(PKCE_KEY); }
