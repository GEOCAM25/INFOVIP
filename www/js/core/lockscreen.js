/* ============================================================
   INFOVIP · Pantalla "No autorizado" + activación por código
   Al montarse hace una comprobación silenciosa contra la lista
   remota (por si el admin ya añadió el teléfono en GitHub). Si
   sigue sin autorizarse, muestra la huella del dispositivo (para
   que el guardia se la mande al admin) y un campo para el código
   de activación offline. "Reintentar" vuelve a leer la lista.
   ============================================================ */
import { h, toast } from './ui.js';
import { getDeviceId, activateWithCode, syncRemote, isAuthorizedLocal } from './deviceauth.js';

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

    // Tarjeta completa de "No autorizado".
    const buildCard = () => {
      const idEl = h('div', { class: 'lock-id' }, deviceId);
      const input = h('input', {
        class: 'input big center', type: 'text', inputmode: 'text',
        autocapitalize: 'characters', placeholder: 'XXXX-XXXX', maxlength: '12'
      });
      const msg = h('div', { class: 'lock-msg' }, '');
      const setMsg = (t, bad) => { msg.textContent = t; msg.classList.toggle('bad', !!bad); };

      const tryCode = async () => {
        const v = input.value.trim();
        if (!v) { setMsg('Escribe el código de activación.', true); return; }
        if (await activateWithCode(v)) { toast('✅ Teléfono autorizado'); done(); }
        else setMsg('Código incorrecto para este teléfono.', true);
      };
      const retry = async () => {
        setMsg('Comprobando…', false);
        const r = await syncRemote().catch(() => null);
        if (r === 'authorized' || isAuthorizedLocal()) { toast('✅ Teléfono autorizado'); done(); return; }
        setMsg(navigator.onLine ? 'Aún no está autorizado. Pídele al admin que añada tu ID.' : 'Sin conexión. Usa un código de activación.', true);
      };
      const copyId = async () => {
        try { await navigator.clipboard.writeText(deviceId); toast('ID copiado'); } catch (_) { toast(deviceId); }
      };

      const card = h('div', { class: 'lock-card' },
        h('img', { src: './assets/icons/logo.png', alt: 'INFOVIP', class: 'lock-logo' }),
        h('div', { class: 'lock-title' }, 'Teléfono no autorizado'),
        h('p', { class: 'lock-sub' }, 'Esta app solo funciona en teléfonos autorizados. Envíale tu ID al administrador para que te habilite.'),
        h('div', { class: 'lock-idbox' },
          h('div', { class: 'lock-idlabel' }, 'ID de este teléfono'),
          idEl,
          h('button', { class: 'btn ghost small', onClick: copyId }, '📋 Copiar ID')
        ),
        h('div', { class: 'lock-field' },
          h('label', { class: 'lock-idlabel' }, 'Código de activación'),
          input
        ),
        msg,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn ghost', onClick: retry }, '🔄 Reintentar'),
          h('button', { class: 'btn primary', onClick: tryCode }, 'Activar')
        )
      );
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryCode(); });
      overlay.replaceChildren(card);
      setTimeout(() => input.focus(), 150);
    };

    // Comprobación remota silenciosa (con tope de tiempo para no colgarse).
    (async () => {
      let settled = false;
      const guard = setTimeout(() => { if (!settled) { settled = true; buildCard(); } }, 4500);
      const r = navigator.onLine ? await syncRemote().catch(() => null) : null;
      if (settled) return;
      settled = true; clearTimeout(guard);
      if (r === 'authorized' || isAuthorizedLocal()) done();
      else buildCard();
    })();
  });
}
