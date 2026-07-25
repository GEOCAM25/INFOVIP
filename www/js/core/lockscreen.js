/* ============================================================
   INFOVIP · Pantalla de ACCESO RESTRINGIDO
   A un teléfono no autorizado NO se le da ninguna pista: solo un
   rombo y el texto "ACCESO RESTRINGIDO A LA APP". La zona oculta
   (ID + código de administrador) aparece solo tras tocar el rombo
   15 veces seguidas. Al abrirse comprueba en silencio la lista; si
   ya está autorizado, entra sin mostrar nada.
   ============================================================ */
import { h, toast } from './ui.js';
import { syncRemote, checkAuthorization, authorizeByAdminCode, SECRET_TAPS } from './deviceauth.js';
import { checkGeofence } from './geofence.js';

export function showLockScreen(deviceId) {
  return new Promise((resolve) => {
    let poll = null;
    const done = () => { if (poll) clearInterval(poll); overlay.remove(); resolve(); };
    const overlay = h('div', { class: 'lock-overlay restricted' });
    document.body.appendChild(overlay);

    // Reintento automático: si vuelve a estar dentro del área (o se autoriza
    // por otra vía), cierra el bloqueo solo.
    poll = setInterval(async () => {
      await checkGeofence().catch(() => null);
      if ((await checkAuthorization()).authorized) done();
    }, 20000);

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
          if (navigator.onLine) await syncRemote().catch(() => null);
          await checkGeofence().catch(() => null);
          if ((await checkAuthorization()).authorized) { toast('✅ Autorizado'); done(); return; }
          setMsg(navigator.onLine ? 'Aún no autorizado.' : 'Sin conexión.', true);
        };
        const copyId = async () => {
          try { await navigator.clipboard.writeText(deviceId); toast('ID copiado'); } catch (_) { toast(deviceId); }
        };
        const codeInput = h('input', { class: 'input center', type: 'text', autocapitalize: 'characters', placeholder: 'Código admin', maxlength: '14' });
        const useCode = async () => {
          if (await authorizeByAdminCode(codeInput.value)) { toast('✅ Autorizado'); done(); }
          else setMsg('Código de administrador incorrecto.', true);
        };
        codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') useCode(); });
        enroll.replaceChildren(
          h('div', { class: 'lock-idlabel' }, 'ID de este teléfono'),
          h('div', { class: 'lock-id' }, deviceId),
          h('div', { class: 'btn-row', style: 'justify-content:center;margin-top:6px' },
            h('button', { class: 'btn ghost small', onClick: copyId }, '📋 Copiar ID'),
            h('button', { class: 'btn ghost small', onClick: retry }, '🔄 Reintentar')
          ),
          h('div', { class: 'lock-field', style: 'margin-top:14px' },
            h('label', { class: 'lock-idlabel' }, 'Código de administrador'),
            codeInput,
            h('button', { class: 'btn primary small', style: 'margin-top:8px;width:100%', onClick: useCode }, 'Habilitar este teléfono')
          ),
          msg
        );
      };

      diamond.addEventListener('click', () => {
        taps++; clearTimeout(tapTimer); tapTimer = setTimeout(() => (taps = 0), 3000);
        if (taps >= SECRET_TAPS) { taps = 0; if (enroll.hidden) { buildEnroll(); enroll.hidden = false; } }
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
      await checkGeofence().catch(() => null);
      if (settled) return;
      settled = true; clearTimeout(guard);
      if ((await checkAuthorization()).authorized) done();
      else showRestricted();
    })();
  });
}
