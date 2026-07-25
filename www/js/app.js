/* ============================================================
   INFOVIP · Arranque de la aplicación
   Registra módulos, inicializa el Service Worker, cablea el
   header y lanza la pestaña de inicio configurada por el usuario.
   ============================================================ */
import { go } from './core/router.js';
import { getHome } from './core/tabs.js';
import { initServiceWorker } from './core/update.js';
import { openSettings } from './modules/config.js';
import { prefs, KEYS } from './core/store.js';
import { h, sheet, toast, closeTopOverlay } from './core/ui.js';
import { currentId, canGoBack, goBack } from './core/router.js';
import { requestAll, backgroundLocationHint } from './core/permissions.js';
import { checkUpdate, showUpdateBanner } from './core/appupdate.js';
import { checkAuthorization, checkRevocation } from './core/deviceauth.js';
import { showLockScreen } from './core/lockscreen.js';

// Importar los módulos registra sus rutas (efecto de carga).
import './modules/inicio.js';
import './modules/sellos.js';
import './modules/rendicion.js';
import './modules/automatizaciones.js';
import './modules/planos.js';
import './modules/se.js';

function wireHeader() {
  document.getElementById('btn-settings').addEventListener('click', openSettings);

  const netDot = document.getElementById('net-status');
  const paintNet = () => netDot.classList.toggle('off', !navigator.onLine);
  window.addEventListener('online', paintNet);
  window.addEventListener('offline', paintNet);
  paintNet();
}

function wireBackButton() {
  // Android: botón físico "atrás". Cierra hoja/visor; si no hay, va a Inicio; si ya está, sale.
  const App = window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins.App : null;
  const onBack = (canExit) => {
    if (closeTopOverlay()) return;      // 1) cerrar hoja/visor abierto
    if (canGoBack()) { goBack(); return; } // 2) volver a la pantalla anterior
    const home = getHome();
    if (currentId() !== home) { go(home); return; } // 3) ir a Inicio
    if (canExit && App && App.exitApp) App.exitApp(); // 4) salir
  };
  if (App && App.addListener) App.addListener('backButton', () => onBack(true));
  // Web / pruebas: tecla Escape cierra la hoja superior.
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') onBack(false); });
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

  // Puerta de acceso: solo teléfonos autorizados abren la app.
  try {
    const auth = await checkAuthorization();
    if (!auth.authorized) {
      const splash = document.getElementById('splash');
      if (splash) { splash.classList.add('hide'); setTimeout(() => (splash.hidden = true), 300); }
      await showLockScreen(auth.deviceId); // se resuelve al activarse
    } else {
      // Ya autorizado: comprobar en 2º plano si fue revocado desde GitHub.
      checkRevocation().then((revoked) => {
        if (revoked) { toast('⛔ Este teléfono fue desautorizado'); setTimeout(() => location.reload(), 1500); }
      }).catch(() => {});
    }
  } catch (_) { /* si el chequeo falla, no dejamos fuera al usuario */ }

  wireHeader();
  wireBackButton();

  // Arrancar el motor de automatizaciones en segundo plano (no bloquea UI).
  import('./modules/engine.js').then((m) => m.startEngine()).catch(() => {});

  // Si volvemos de un login de Microsoft (redirect.html → #rendir), abrir Sellos en Rendir.
  if (location.hash === '#rendir') {
    if (location.hash) history.replaceState(null, '', location.pathname);
    await go('sellos', { seg: 'rendir' });
  } else {
    if (location.hash) history.replaceState(null, '', location.pathname);
    await go(getHome());
  }

  // Pequeño respiro para que se pinte la primera vista antes de ocultar splash.
  setTimeout(showApp, 500);

  // Primer arranque: pedir permisos con una explicación clara.
  if (!prefs.get(KEYS.ONBOARDED, false)) setTimeout(onboarding, 1100);

  // Buscar actualización de la app (release nuevo en GitHub).
  if (navigator.onLine) setTimeout(async () => {
    const u = await checkUpdate();
    if (u && !u.error && !u.upToDate && u.url) showUpdateBanner(u);
  }, 2500);
}

function onboarding() {
  sheet('Bienvenido a INFOVIP', (body, api) => {
    body.appendChild(h('p', { class: 'muted', style: 'margin:0 0 8px' }, 'Para que las automatizaciones y alarmas funcionen, INFOVIP necesita tu permiso para:'));
    body.appendChild(h('div', { class: 'setting-row' }, h('div', { class: 'sr-main' }, h('div', { class: 'sr-title' }, '📍 Ubicación'), h('div', { class: 'sr-desc' }, 'Disparar alarmas al llegar a un punto (radio en metros).'))));
    body.appendChild(h('div', { class: 'setting-row' }, h('div', { class: 'sr-main' }, h('div', { class: 'sr-title' }, '🔔 Notificaciones'), h('div', { class: 'sr-desc' }, 'Avisarte aunque la app esté cerrada o en segundo plano.'))));
    body.appendChild(h('div', { class: 'hint', style: 'margin:10px 0 16px' }, backgroundLocationHint()));
    body.appendChild(h('div', { class: 'btn-row' },
      h('button', { class: 'btn ghost', onClick: () => { prefs.set(KEYS.ONBOARDED, true); api.close(); } }, 'Ahora no'),
      h('button', { class: 'btn primary', onClick: async () => {
        const r = await requestAll();
        prefs.set(KEYS.ONBOARDED, true);
        api.close();
        toast(r.location === 'granted' ? '✅ Permisos concedidos' : 'Puedes activarlos luego en Ajustes');
      } }, 'Conceder permisos')
    ));
  }, 'Todo se guarda solo en tu teléfono.');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
