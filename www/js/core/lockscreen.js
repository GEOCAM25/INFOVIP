/* ============================================================
   INFOVIP · Pantalla de ACCESO RESTRINGIDO
   A un teléfono no autorizado NO se le da ninguna pista: solo un
   rombo y el texto "ACCESO RESTRINGIDO A LA APP". El ID del equipo
   (para que el administrador lo habilite) queda oculto y solo aparece
   con un gesto secreto: tocar el rombo 5 veces seguidas.
   Al abrirse comprueba en silencio la lista; si ya está autorizado,
   entra sin mostrar nada.
   ============================================================ */
import { h, toast } from './ui.js';
import { syncRemote, checkAuthorization } from './deviceauth.js';

export function showLockScreen(deviceId) {
  return new Promise((resolve) => {
    const done = () => { overlay.remove(); resolve(); };
    const overlay = h('div', { class: 'lock-overlay restricted' });
    document.body.appendChild(overlay);

    const showRestricted = () => {
      let taps = 0, tapTimer = null;
      const diamond = h('div', { class: 'lock-diamond', role: 'img', 'aria-label': 'Acceso restringido' });
      const enroll = h('div', { class: 'lock-enroll' });
      enroll.hidden = true;

      const buildEnroll = () => {
        const msg = h('div', { class: 'lock-msg' }, '');
        const setMsg = (t, bad) => { msg.textContent = t; msg.classList.toggle('bad', !!bad); };
        const retry = async () => {
          setMsg('Comprobando…', false);
          if (!navigator.onLine) { setMsg('Sin conexión.', true); return; }
          await syncRemote().catch(() => null);
          if ((await checkAuthorization()).authorized) { toast('✅ Autorizado'); done(); return; }
          setMsg('Aún no autorizado.', true);
        };
        const copyId = async () => {
          try { await navigator.clipboard.writeText(deviceId); toast('ID copiado'); } catch (_) { toast(deviceId); }
        };
        enroll.replaceChildren(
          h('div', { class: 'lock-idlabel' }, 'ID de este teléfono'),
          h('div', { class: 'lock-id' }, deviceId),
          h('div', { class: 'btn-row', style: 'justify-content:center;margin-top:6px' },
            h('button', { class: 'btn ghost small', onClick: copyId }, '📋 Copiar ID'),
            h('button', { class: 'btn primary small', onClick: retry }, '🔄 Reintentar')
          ),
          msg
        );
      };

      diamond.addEventListener('click', () => {
        taps++; clearTimeout(tapTimer); tapTimer = setTimeout(() => (taps = 0), 2500);
        if (taps >= 5) { taps = 0; if (enroll.hidden) { buildEnroll(); enroll.hidden = false; } }
      });

      overlay.replaceChildren(h('div', { class: 'lock-restricted' },
        diamond,
        h('div', { class: 'lock-restricted-txt' }, 'ACCESO RESTRINGIDO A LA APP'),
        enroll
      ));
    };

    // Comprobación remota silenciosa (con tope de tiempo para no colgarse).
    (async () => {
      let settled = false;
      const guard = setTimeout(() => { if (!settled) { settled = true; showRestricted(); } }, 4500);
      if (navigator.onLine) await syncRemote().catch(() => null);
      if (settled) return;
      settled = true; clearTimeout(guard);
      if ((await checkAuthorization()).authorized) done();
      else showRestricted();
    })();
  });
}
