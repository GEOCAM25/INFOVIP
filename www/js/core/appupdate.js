/* ============================================================
   INFOVIP · Actualización de la app (sin Play Store)
   Consulta los Releases de GitHub. Si hay un build más nuevo que
   el instalado, ofrece "Actualizar app": descarga el APK firmado
   (misma llave) y el usuario lo instala encima, sin desinstalar.
   ============================================================ */
import { toast } from './ui.js';

const OWNER = 'GEOCAM25';
const REPO = 'INFOVIP';

let _current = null;
export async function currentBuild() {
  if (_current != null) return _current;
  try {
    const r = await fetch('./version.json', { cache: 'no-store' });
    const j = await r.json();
    _current = Number(j.build) || 0;
  } catch (_) { _current = 0; }
  return _current;
}

// Consulta con timeout para no quedar colgado si no hay respuesta.
async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// Devuelve { build, url, current, upToDate } o { error } si no se pudo.
export async function checkUpdate() {
  try {
    const res = await fetchWithTimeout(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'INFOVIP-App' },
      cache: 'no-store'
    }, 8000);
    if (!res.ok) return { error: 'HTTP ' + res.status };
    const rel = await res.json();
    const m = (rel.tag_name || '').match(/build-(\d+)/);
    const latest = m ? Number(m[1]) : 0;
    const asset = (rel.assets || []).find((a) => /\.apk$/i.test(a.name));
    const cur = await currentBuild();
    return {
      build: latest,
      url: asset ? asset.browser_download_url : null,
      current: cur,
      notes: rel.body || '',
      upToDate: latest <= cur || !asset
    };
  } catch (e) {
    return { error: (e && e.name === 'AbortError') ? 'timeout' : 'red' };
  }
}

export async function openInstall(url) {
  if (!url) return;
  toast('⬇️ Descargando… si no aparece “Instalar”, ábrelo desde Descargas.', 5000);
  const P = (window.Capacitor && window.Capacitor.Plugins) ? window.Capacitor.Plugins : {};
  // 1) Abrir en el navegador EXTERNO del sistema (Chrome) → descarga el APK
  //    correctamente y ofrece "Instalar". (El navegador interno se colgaba.)
  if (P.AppLauncher && P.AppLauncher.openUrl) {
    try { await P.AppLauncher.openUrl({ url }); return; } catch (_) {}
  }
  // 2) Respaldo: navegador interno
  if (P.Browser && P.Browser.open) {
    try { await P.Browser.open({ url }); return; } catch (_) {}
  }
  // 3) Respaldo web
  window.open(url, '_system');
}

// Muestra el banner "Actualizar app" (módulo estable, sin depender de app.js).
export function showUpdateBanner(u) {
  const toastEl = document.getElementById('update-toast');
  const btn = document.getElementById('btn-update-now');
  if (!toastEl || !btn) return;
  const span = toastEl.querySelector('span');
  if (span) span.textContent = `🔄 Nueva versión disponible (build-${u.build})`;
  toastEl.hidden = false;
  btn.textContent = 'Actualizar app';
  btn.onclick = () => { openInstall(u.url); toastEl.hidden = true; };
}
