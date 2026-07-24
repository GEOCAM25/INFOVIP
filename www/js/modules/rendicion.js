/* ============================================================
   INFOVIP · Módulo · RENDICIÓN DE SELLOS (escribe en SharePoint)
   Llenas lo mínimo (sello + ROL + datos) y la app localiza el
   Excel correcto en la carpeta de SharePoint, encuentra la fila
   del sello y la escribe vía Microsoft Graph. Medidor y dirección
   se autocompletan por la fórmula del Excel.
   Incluye MODO SIMULACIÓN para probar sin credenciales.
   ============================================================ */
import { h, clear, toast, sheet, esc } from '../core/ui.js';
import { register } from '../core/router.js';
import { prefs } from '../core/store.js';
import { isConfigured, isSignedIn, account, signIn, signOut } from '../core/msauth.js';
import { rendirSello, parseRange } from '../core/graph.js';
import { openSettings } from './config.js';

// Listas tomadas de la hoja "bdd" del Excel (editables a futuro).
const COLORES = ['AMARILLO','AZUL','BLANCO','CAFÉ','GRIS','METAL AZUL','METAL PLATA','METAL ROJO','NARANJO','ROJO','SIN SELLO','TRANSPARENTE','VERDE','OTRO'];
const CONDICIONES = ['INSTALADO','EXTRAVIADO','APOYO LECTURAS','NULO','PRUEBA DE CALIDAD'];
const POSICIONES = ['1','2','3'];

async function render(root) {
  clear(root);
  root.appendChild(h('div', { class: 'page-title' }, 'Rendición de Sellos'));
  root.appendChild(h('div', { class: 'page-sub' }, 'Llena lo mínimo y la app lo escribe en el Excel correcto de SharePoint.'));

  // Estado de conexión
  root.appendChild(connectionCard(root));

  // Formulario
  const f = {};
  const form = h('div', { class: 'card' });

  form.appendChild(field('N° de sello', f.seal = h('input', { class: 'input big', type: 'number', inputmode: 'numeric', placeholder: 'Ej: 15823' })));
  form.appendChild(field('ROL', f.rol = h('input', { class: 'input', inputmode: 'numeric', placeholder: 'ROL del cliente' })));
  form.appendChild(field('Color', f.color = select(COLORES)));
  form.appendChild(field('Cargo (quién rinde)', f.cargo = h('input', { class: 'input', placeholder: 'Nombre', value: prefs.get('rendCargo', '') })));
  form.appendChild(field('Condición', f.condicion = select(CONDICIONES)));
  form.appendChild(field('Posición', f.posicion = select(POSICIONES, true)));

  // Retiro (opcional, plegable)
  const retiro = h('div', { hidden: true });
  retiro.appendChild(field('N° sello retirado', f.retiroNum = h('input', { class: 'input', type: 'number', inputmode: 'numeric' })));
  retiro.appendChild(field('Color retirado', f.retiroColor = select(COLORES, true)));
  retiro.appendChild(field('OTC', f.otc = h('input', { class: 'input' })));
  retiro.appendChild(field('Motivo', f.motivo = h('input', { class: 'input', placeholder: 'Motivo del cambio' })));
  const toggleRetiro = h('button', { class: 'btn ghost sm', onClick: () => { retiro.hidden = !retiro.hidden; toggleRetiro.textContent = retiro.hidden ? '➕ Agregar retiro de sello' : '➖ Ocultar retiro'; } }, '➕ Agregar retiro de sello');
  form.appendChild(toggleRetiro);
  form.appendChild(retiro);

  root.appendChild(form);

  root.appendChild(h('button', { class: 'btn primary', onClick: () => submit(f, root) }, '📤  Rendir sello'));
  root.appendChild(h('div', { class: 'hint' }, simulating()
    ? '🧪 Modo simulación activo: valida y muestra dónde escribiría, sin tocar SharePoint. Se desactiva solo al conectar Microsoft.'
    : 'Escribe directo en SharePoint. Se guarda solo y sale a tu nombre.'));
}

function simulating() {
  if (prefs.get('spSimulate', false)) return true;
  return !(isConfigured() && isSignedIn());
}

function connectionCard(root) {
  const card = h('div', { class: 'card' });
  if (!isConfigured()) {
    card.appendChild(h('div', { class: 'row between' },
      h('div', {}, h('h3', { style: 'margin:0' }, '⚙️ Falta configurar'), h('div', { class: 'muted' }, 'Pega el Client ID de Microsoft para conectar.')),
      h('button', { class: 'btn sm', onClick: () => openSettings() }, 'Configurar')
    ));
    card.appendChild(h('span', { class: 'chip warn mt' }, '🧪 Simulación'));
    return card;
  }
  if (!isSignedIn()) {
    card.appendChild(h('div', { class: 'row between' },
      h('div', {}, h('h3', { style: 'margin:0' }, '🔐 No conectado'), h('div', { class: 'muted' }, 'Inicia sesión con tu cuenta de empresa.')),
      h('button', { class: 'btn primary sm', onClick: async () => {
        try { await signIn(); toast('Conectado'); render(root); }
        catch (e) { toast('No se pudo conectar'); console.error(e); }
      } }, 'Conectar Microsoft')
    ));
    return card;
  }
  const acc = account();
  card.appendChild(h('div', { class: 'row between' },
    h('div', {}, h('h3', { style: 'margin:0' }, '✅ Conectado'), h('div', { class: 'muted' }, esc(acc?.email || acc?.name || 'Cuenta Microsoft'))),
    h('button', { class: 'btn ghost sm', onClick: () => { signOut(); toast('Sesión cerrada'); render(root); } }, 'Salir')
  ));
  return card;
}

async function submit(f, root) {
  const data = {
    seal: f.seal.value.trim(), rol: f.rol.value.trim(), color: f.color.value,
    cargo: f.cargo.value.trim(), condicion: f.condicion.value, posicion: f.posicion.value,
    retiroNum: f.retiroNum.value.trim(), retiroColor: f.retiroColor.value,
    otc: f.otc.value.trim(), motivo: f.motivo.value.trim(),
    fecha: (f.retiroNum.value.trim() || f.motivo.value.trim()) ? new Date().toLocaleDateString('es-CL') : ''
  };
  if (!data.seal) return toast('Ingresa el N° de sello');
  if (!data.rol && !data.condicion) return toast('Ingresa al menos ROL o condición');
  if (data.cargo) prefs.set('rendCargo', data.cargo);

  if (simulating()) return simulate(data);

  const progress = sheet('Rindiendo sello ' + data.seal, (body) => {
    body.appendChild(h('div', { class: 'center', style: 'padding:10px 0' },
      h('div', { class: 'splash-bar', style: 'margin:0 auto 16px' }, h('span')),
      h('div', { id: 'rend-step', class: 'muted' }, 'Iniciando…')
    ));
  });
  const setStep = (m) => { const el = document.getElementById('rend-step'); if (el) el.textContent = m; };

  try {
    const res = await rendirSello(data, setStep);
    progress.close();
    toast(`✅ Escrito en ${res.file} (fila ${res.row})`);
    // Limpiar campos del sello para el siguiente
    f.seal.value = ''; f.rol.value = '';
  } catch (e) {
    progress.close();
    if (e.code === 'NO_AUTH' || e.status === 401) {
      toast('Sesión expirada, vuelve a conectar');
      signOut(); render(root);
    } else {
      toast('Error: ' + (e.message || e).slice(0, 80));
      console.error(e);
    }
  }
}

function simulate(data) {
  sheet('🧪 Simulación · sello ' + data.seal, (body, api) => {
    // Estima el archivo por patrón de rango de 50 en 50 (referencial).
    const n = parseInt(String(data.seal).replace(/\D/g, ''), 10);
    const base = Math.floor((n - 1) / 50) * 50 + 1;
    const guess = `${base}_al_${base + 49}.xlsx`;
    body.appendChild(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Archivo estimado'), h('span', { class: 'v' }, guess)));
    body.appendChild(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'ROL'), h('span', { class: 'v' }, data.rol || '—')));
    body.appendChild(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Color'), h('span', { class: 'v' }, data.color || '—')));
    body.appendChild(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Cargo'), h('span', { class: 'v' }, data.cargo || '—')));
    body.appendChild(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Condición'), h('span', { class: 'v' }, data.condicion || '—')));
    body.appendChild(h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Posición'), h('span', { class: 'v' }, data.posicion || '—')));
    body.appendChild(h('div', { class: 'hint mt' }, 'Esto es una simulación local. Al conectar Microsoft, escribirá de verdad en SharePoint (medidor y dirección se autocompletan por la fórmula del Excel).'));
    body.appendChild(h('button', { class: 'btn primary mt', onClick: () => api.close() }, 'Entendido'));
  }, 'Sin tocar SharePoint');
}

/* ---- helpers ---- */
function field(label, el) { return h('div', { class: 'field' }, h('label', {}, label), el); }
function select(options, blank) {
  const s = h('select', { class: 'select' });
  if (blank) s.appendChild(h('option', { value: '' }, '—'));
  options.forEach((o) => s.appendChild(h('option', { value: o }, o)));
  return s;
}

export { render as renderRendir };
register('rendir', { render, title: 'Rendición de Sellos' });
