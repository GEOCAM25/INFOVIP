/* ============================================================
   INFOVIP · Arranque de la aplicación
   Registra módulos, inicializa el Service Worker, cablea el
   header y lanza la pestaña de inicio configurada por el usuario.
   ============================================================ */
import { go } from './core/router.js';
import { getHome } from './core/tabs.js';
import { initServiceWorker } from './core/update.js';
import { openSettings } from './modules/config.js';

// Importar los módulos registra sus rutas (efecto de carga).
import './modules/inicio.js';
import './modules/sellos.js';
import './modules/rendicion.js';
import './modules/automatizaciones.js';
import './modules/planos.js';
import './modules/clima.js';

function wireHeader() {
  document.getElementById('btn-settings').addEventListener('click', openSettings);

  const netDot = document.getElementById('net-status');
  const paintNet = () => netDot.classList.toggle('off', !navigator.onLine);
  window.addEventListener('online', paintNet);
  window.addEventListener('offline', paintNet);
  paintNet();
}

function showApp() {
  document.getElementById('app-header').hidden = false;
  document.getElementById('view').hidden = false;
  document.getElementById('tabbar').hidden = false;
  const splash = document.getElementById('splash');
  splash.classList.add('hide');
  setTimeout(() => (splash.hidden = true), 480);
}

async function boot() {
  initServiceWorker();
  wireHeader();

  // Arrancar el motor de automatizaciones en segundo plano (no bloquea UI).
  import('./modules/engine.js').then((m) => m.startEngine()).catch(() => {});

  // Si volvemos de un login de Microsoft (redirect.html → #rendir), abrir esa pestaña.
  const startTab = location.hash === '#rendir' ? 'rendir' : getHome();
  if (location.hash) history.replaceState(null, '', location.pathname);
  await go(startTab);

  // Pequeño respiro para que se pinte la primera vista antes de ocultar splash.
  setTimeout(showApp, 500);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
