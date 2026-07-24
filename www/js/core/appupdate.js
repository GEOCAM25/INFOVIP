/* ============================================================
   INFOVIP · Actualización de la app (sin Play Store)
   Consulta los Releases de GitHub. Si hay un build más nuevo que
   el instalado, ofrece "Actualizar app": descarga el APK firmado
   (misma llave) y el usuario lo instala encima, sin desinstalar.
   Nota: el APK de Capacitor carga sus archivos localmente, por eso
   la actualización real va por el APK (native + web juntos).
   ============================================================ */
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

// Devuelve { build, url, current, upToDate } o null si no se pudo consultar.
export async function checkUpdate() {
  try {
    const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!res.ok) return null;
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
  } catch (_) { return null; }
}

export async function openInstall(url) {
  if (!url) return;
  const Browser = window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins.Browser : null;
  if (Browser) { try { await Browser.open({ url }); return; } catch (_) {} }
  window.open(url, '_blank');
}
