/* ============================================================
   INFOVIP · Submódulo · SUBESTACIONES (SE)
   Pestañas predefinidas. Formulario de novedades que se formatea
   y abre WhatsApp del teléfono para enviarlo al grupo de turno.
   Los borradores se guardan localmente.
   ============================================================ */
import { h, clear, toast, esc } from '../core/ui.js';
import { db } from '../core/db.js';
import { prefs } from '../core/store.js';

const SUBESTACIONES = ['PUENTE ALTO', 'PINTANA', 'BAJOS DE MENA', 'COSTANERA'];

export async function renderSE(root) {
  clear(root);
  let active = prefs.get('seActive', SUBESTACIONES[0]);

  const tabs = h('div', { class: 'row wrap', style: 'gap:8px;margin-bottom:14px' });
  const panel = h('div');
  SUBESTACIONES.forEach((se) => {
    const chip = h('button', { class: 'btn ' + (se === active ? 'primary' : 'ghost') + ' sm', style: 'width:auto' }, se);
    chip.addEventListener('click', () => { active = se; prefs.set('seActive', se); paintTabs(); paintPanel(); });
    chip._se = se; tabs.appendChild(chip);
  });
  root.appendChild(tabs);
  root.appendChild(panel);

  function paintTabs() {
    [...tabs.children].forEach((c) => { c.className = 'btn ' + (c._se === active ? 'primary' : 'ghost') + ' sm'; c.style.width = 'auto'; });
  }
  async function paintPanel() {
    clear(panel);
    const draft = (await db.get('novedades', keyFor(active)).catch(() => null)) || { id: keyFor(active), turno: '', texto: '' };

    const turno = h('input', { class: 'input', placeholder: 'Turno / operador (ej: Turno B - J. Pérez)', value: draft.turno || '' });
    const texto = h('textarea', { class: 'input', placeholder: 'Novedades de la subestación…' });
    texto.value = draft.texto || '';

    const phone = h('input', { class: 'input', type: 'tel', placeholder: 'N° o grupo (opcional, +569…)', value: prefs.get('sePhone', '') });

    panel.appendChild(h('div', { class: 'card' },
      h('h3', {}, `📡 SE ${se_(active)}`),
      h('div', { class: 'field mt' }, h('label', {}, 'Turno'), turno),
      h('div', { class: 'field' }, h('label', {}, 'Novedades'), texto),
      h('div', { class: 'field' }, h('label', {}, 'WhatsApp destino'), phone),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost sm', onClick: async () => {
          await db.put('novedades', { id: keyFor(active), turno: turno.value, texto: texto.value });
          prefs.set('sePhone', phone.value.trim()); toast('Borrador guardado');
        } }, '💾 Guardar'),
        h('button', { class: 'btn primary sm', onClick: () => sendWhatsApp(active, turno.value, texto.value, phone.value) }, '🟢 Enviar a WhatsApp')
      ),
      h('div', { class: 'hint' }, 'Se abre la app de WhatsApp del teléfono con el texto ya formateado.')
    ));
  }

  paintPanel();
}

function keyFor(se) { return 'se:' + se; }
function se_(s) { return s; }

function formatMessage(se, turno, texto) {
  const now = new Date().toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
  return `*NOVEDADES SE ${se}*\n🗓️ ${now}\n👤 ${turno || 'Turno'}\n\n${texto || '(sin novedades)'}\n\n_Enviado desde INFOVIP_`;
}

function sendWhatsApp(se, turno, texto, phone) {
  const msg = encodeURIComponent(formatMessage(se, turno, texto));
  const num = (phone || '').replace(/[^\d]/g, '');
  const url = num ? `https://wa.me/${num}?text=${msg}` : `https://wa.me/?text=${msg}`;
  // Abre WhatsApp nativo (Android intercepta el enlace wa.me / whatsapp://)
  window.open(url, '_blank');
}
