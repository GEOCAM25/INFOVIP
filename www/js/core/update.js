/* ============================================================
   INFOVIP · Registro del Service Worker + auto-actualización
   Detecta nuevas versiones publicadas en GitHub (via SW),
   descarga en segundo plano y ofrece aplicar sin Play Store.
   ============================================================ */
export function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./service-worker.js');

      // ¿Hay un SW en espera ya? (update descargada offline)
      if (reg.waiting) showUpdate(reg.waiting);

      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdate(nw); // nueva versión lista, controller activo => es update
          }
        });
      });

      // Buscar updates periódicamente (cada 30 min) y al volver a foreground.
      const check = () => reg.update().catch(() => {});
      setInterval(check, 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    } catch (e) {
      console.warn('[sw] registro falló', e);
    }
  });

  // Cuando el nuevo SW toma control, recargar una sola vez.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

function showUpdate(worker) {
  const toast = document.getElementById('update-toast');
  const btn = document.getElementById('btn-update-now');
  if (!toast || !btn) return;
  toast.hidden = false;
  btn.onclick = () => {
    worker.postMessage({ type: 'SKIP_WAITING' });
    toast.hidden = true;
  };
}
