/* ============================================================
   INFOVIP · Pantalla "No autorizado"
   Sin códigos: la única forma de entrar es que el administrador
   añada el ID de este teléfono a la lista. La pantalla muestra el
   ID (para copiarlo y enviárselo al admin) y un botón "Reintentar"
   que vuelve a leer la lista de GitHub. Al abrirse, comprueba sola
   la lista y se cierra si el teléfono ya quedó autorizado.
   ============================================================ */
import { h, toast } from './ui.js';
import { syncRemote, checkAuthorization } from './deviceauth.js';

// Muestra el bloqueo y resuelve cuando el teléfono queda autorizado.
export function showLockScreen(deviceId) {
  return new Promise((resolve) => {
    const done = () => { overlay.remove(); resolve(); };

    // Estado inicial: comprobando en silencio contra la lista remota.
    const checking = h('div', { class: 'lock-card' },
      h('img', { src: './assets/icons/logo.png', alt: 'INFOVIP', class: 'lock-logo' }),
      h('div', { class: 'lock-title' }, 'Comprobando…'),
      h('p', { class: 'lock-sub' }, 'Verificando autorización de este teléfono.')
    );
    const overlay = h('div', { class: 'lock-overlay' }, checking);
    document.body.appendChild(overlay);

    const buildCard = () => {
      const msg = h('div', { class: 'lock-msg' }, '');
      const setMsg = (t, bad) => { msg.textContent = t; msg.classList.toggle('bad', !!bad); };

      const retry = async () => {
        setMsg('Comprobando…', false);
        if (!navigator.onLine) { setMsg('Sin conexión. Conéctate a internet para que se habilite.', true); return; }
        await syncRemote().catch(() => null);
        if ((await checkAuthorization()).authorized) { toast('✅ Teléfono autorizado'); done(); return; }
        setMsg('Aún no está habilitado. Pídele al administrador que agregue tu ID.', true);
      };
      const copyId = async () => {
        try { await navigator.clipboard.writeText(deviceId); toast('ID copiado'); } catch (_) { toast(deviceId); }
      };

      const card = h('div', { class: 'lock-card' },
        h('img', { src: './assets/icons/logo.png', alt: 'INFOVIP', class: 'lock-logo' }),
        h('div', { class: 'lock-title' }, 'Teléfono no autorizado'),
        h('p', { class: 'lock-sub' }, 'Esta app solo funciona en teléfonos autorizados. Copia tu ID y envíaselo al administrador para que habilite este teléfono.'),
        h('div', { class: 'lock-idbox' },
          h('div', { class: 'lock-idlabel' }, 'ID de este teléfono'),
          h('div', { class: 'lock-id' }, deviceId),
          h('button', { class: 'btn ghost small', onClick: copyId }, '📋 Copiar ID')
        ),
        msg,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn primary', onClick: retry }, '🔄 Ya me habilitaron · Reintentar')
        )
      );
      overlay.replaceChildren(card);
    };

    // Comprobación remota silenciosa (con tope de tiempo para no colgarse).
    (async () => {
      let settled = false;
      const guard = setTimeout(() => { if (!settled) { settled = true; buildCard(); } }, 4500);
      if (navigator.onLine) await syncRemote().catch(() => null);
      if (settled) return;
      settled = true; clearTimeout(guard);
      if ((await checkAuthorization()).authorized) done();
      else buildCard();
    })();
  });
}
