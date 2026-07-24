/* ============================================================
   INFOVIP · Módulo · RENDICIÓN DE SELLOS (escribe en SharePoint)
   Flujo real EEPA:
   1) N° de sello INSTALADO → localiza la fila en el Excel (no lo crea).
   2) ROL → muestra la DIRECCIÓN de la base local para verificar.
   3) Color = siempre CAFÉ (no se pregunta; se escribe si falta).
   4) Cargo = autocompletado del listado (o el ya escrito en la fila).
   5) Condición = INSTALADO por defecto (editable).
   6) Posición.
   7) Sello retirado (obligatorio): N°, color, OTC, motivo.
   8) "+ Agregar sello": otra fila en la misma dirección; copia ROL,
      condición, cargo, OTC, motivo, fecha; cambia posición y retiro.
   Incluye MODO SIMULACIÓN para probar sin credenciales.
   ============================================================ */
import { h, clear, toast, sheet, esc } from '../core/ui.js';
import { register } from '../core/router.js';
import { db } from '../core/db.js';
import { prefs } from '../core/store.js';
import { isConfigured, isSignedIn, account, signIn, signOut } from '../core/msauth.js';
import { rendir, readCargo, parseRange, buildFileUrl, folderUrl } from '../core/graph.js';
import { openSettings } from './config.js';

// Lista local de archivos de la carpeta (para saber archivo y fila sin sesión).
function getFileList() { return prefs.get('sealFiles', []); }
function matchFileLocal(seal) {
  const n = parseInt(String(seal).replace(/\D/g, ''), 10);
  for (const f of getFileList()) if (n >= f.start && n <= f.end) return { name: f.name, row: 6 + (n - f.start) };
  return null;
}

const CARGOS = ['ALEXIS CONTRERAS','BRANDON ESPINOZA','CHRISTIAN ESTAY','CLAUDIO CEA','CRISTÓBAL GARCÉS','EDGARD MURILLO','ELÍAS FLORES','FABIÁN ÁLVAREZ','FELIPE TELLO','FERNANDO FLORES','GONZALO ULLOA','GUILLERMO JAÑA','HEIN VALDEBENITO','JOHANNES FLORES','JOSÉ HERNÁNDEZ','JOSÉ PASTENES','JOSÉ SILVA','JUAN GÓMEZ','MATÍAS CARRASCO','MATÍAS ESCOBAR','MIGUEL JARA','NICOLÁS GÓMEZ','NICOLÁS SEVERINO','RICARDO JIMÉNEZ','RICARDO SOTO','RICHARD ARAVENA','RICHARD MONTESINOS','RUBÉN DÍAZ','RUBÉN MUÑOZ','SERGIO MARTÍNEZ'];
const CONDICIONES = ['INSTALADO','EXTRAVIADO','APOYO LECTURAS','NULO','PRUEBA DE CALIDAD'];
const COLORES = ['SIN SELLO','CAFÉ','AMARILLO','AZUL','BLANCO','GRIS','METAL AZUL','METAL PLATA','METAL ROJO','NARANJO','ROJO','TRANSPARENTE','VERDE','OTRO'];
const POSICIONES = ['1','2','3'];

// Sellos adicionales de esta rendición (además del principal)
let extras = [];

async function render(root) {
  clear(root);
  extras = [];
  root.appendChild(h('div', { class: 'page-title' }, 'Rendición de Sellos'));
  root.appendChild(h('div', { class: 'page-sub' }, 'Ingresa el sello instalado; la app te dice el archivo, la fila y los datos, y abre el Excel en SharePoint.'));
  root.appendChild(connectionCard(root));
  // Botón para cargar la lista de archivos de la carpeta (modo asistido)
  root.appendChild(h('button', { class: 'btn ghost sm', style: 'margin-bottom:14px', onClick: () => openFileList(root) },
    `📁 Archivos de la carpeta (${getFileList().length})`));

  const f = {};
  const card = h('div', { class: 'card' });

  // 1) N° de sello instalado
  card.appendChild(field('N° de sello (instalado)', f.seal = h('input', { class: 'input big', type: 'number', inputmode: 'numeric', placeholder: 'Ej: 9705' })));

  // 2) ROL + dirección de verificación
  f.rol = h('input', { class: 'input', inputmode: 'numeric', placeholder: 'Ej: 6129' });
  const dirLine = h('div', { class: 'hint', style: 'margin:-6px 0 12px' }, 'Escribe el ROL para ver la dirección.');
  card.appendChild(field('ROL', f.rol));
  card.appendChild(dirLine);
  let lookupT;
  f.rol.addEventListener('input', () => { clearTimeout(lookupT); lookupT = setTimeout(() => showDireccion(f.rol.value, dirLine), 250); });

  // 4) Cargo (autocompletado). Se intenta prellenar con el ya escrito en la fila.
  f.cargo = h('input', { class: 'input', list: 'cargos-list', placeholder: 'Nombre (autocompleta)', value: prefs.get('rendCargo', '') });
  const dl = h('datalist', { id: 'cargos-list' }, ...CARGOS.map((c) => h('option', { value: c })));
  card.appendChild(field('Cargo (quién rinde)', h('div', {}, f.cargo, dl)));
  // Al salir del N° de sello, si hay sesión, autocompletar cargo desde la fila
  f.seal.addEventListener('blur', async () => {
    if (!f.seal.value.trim() || simulating()) return;
    try { const { cargo } = await readCargo(f.seal.value.trim()); if (cargo) { f.cargo.value = cargo; toast('Cargo tomado de la planilla'); } } catch (_) {}
  });

  // 5) Condición (default INSTALADO)
  f.condicion = select(CONDICIONES); f.condicion.value = 'INSTALADO';
  card.appendChild(field('Condición', f.condicion));

  // 6) Posición
  f.posicion = select(POSICIONES, true);
  card.appendChild(field('Posición', f.posicion));

  // 7) Sello retirado (obligatorio)
  card.appendChild(h('div', { class: 'divider' }));
  card.appendChild(h('div', { class: 'sr-title', style: 'margin-bottom:8px' }, '↩️ Sello retirado'));
  f.retiroNum = h('input', { class: 'input', placeholder: 'N° retirado (o SS si no hay)' });
  f.retiroColor = select(COLORES); f.retiroColor.value = 'SIN SELLO';
  f.otc = h('input', { class: 'input', placeholder: 'OTC' });
  f.motivo = h('input', { class: 'input', placeholder: 'Motivo del cambio' });
  card.appendChild(field('N° sello retirado', f.retiroNum));
  card.appendChild(field('Color', f.retiroColor));
  card.appendChild(field('OTC', f.otc));
  card.appendChild(field('Motivo', f.motivo));

  root.appendChild(card);

  // Sellos adicionales (misma dirección)
  const extrasWrap = h('div', { id: 'extras-wrap' });
  root.appendChild(extrasWrap);
  const renderExtras = () => paintExtras(extrasWrap);
  root.appendChild(h('button', { class: 'btn ghost', onClick: () => { extras.push({ seal: '', posicion: '', retiroNum: '', retiroColor: 'SIN SELLO' }); renderExtras(); } }, '➕  Agregar sello (misma dirección)'));

  root.appendChild(h('button', { class: 'btn primary mt', onClick: () => submit(f, root) }, simulating() ? '📋  Preparar datos' : '📤  Rendir sello(s)'));
  root.appendChild(h('div', { class: 'hint' }, simulating()
    ? 'Modo asistido: la app te da archivo, fila y datos, y abre el Excel en SharePoint para que los escribas (gratis, sin IT).'
    : 'Escribe directo en SharePoint. Medidor y dirección se autocompletan por la fórmula del Excel.'));
}

function paintExtras(wrap) {
  clear(wrap);
  extras.forEach((e, i) => {
    const card = h('div', { class: 'card' },
      h('div', { class: 'row between' },
        h('h3', { style: 'margin:0' }, `Sello adicional ${i + 1}`),
        h('button', { class: 'btn danger sm', style: 'width:auto', onClick: () => { extras.splice(i, 1); paintExtras(wrap); } }, '✕')
      )
    );
    const seal = h('input', { class: 'input', type: 'number', inputmode: 'numeric', placeholder: 'N° sello instalado', value: e.seal });
    seal.addEventListener('input', () => e.seal = seal.value.trim());
    const pos = select(POSICIONES, true); pos.value = e.posicion; pos.addEventListener('change', () => e.posicion = pos.value);
    const rNum = h('input', { class: 'input', placeholder: 'N° retirado (o SS)', value: e.retiroNum });
    rNum.addEventListener('input', () => e.retiroNum = rNum.value.trim());
    const rCol = select(COLORES); rCol.value = e.retiroColor; rCol.addEventListener('change', () => e.retiroColor = rCol.value);
    card.appendChild(field('N° sello instalado', seal));
    card.appendChild(field('Posición', pos));
    card.appendChild(field('N° sello retirado', rNum));
    card.appendChild(field('Color', rCol));
    wrap.appendChild(card);
  });
}

async function showDireccion(rol, lineEl) {
  const q = String(rol || '').trim();
  if (!q) { lineEl.textContent = 'Escribe el ROL para ver la dirección.'; lineEl.className = 'hint'; return; }
  let rec = await db.get('sellos', q).catch(() => null);
  if (!rec) {
    // búsqueda tolerante por dígitos
    const all = await db.getAll('sellos').catch(() => []);
    const norm = q.replace(/\D/g, '');
    rec = all.find((r) => String(r.rol).replace(/\D/g, '') === norm);
  }
  if (rec) { lineEl.innerHTML = `📍 <b>${esc(rec.direccion || '—')}</b>` + (rec.medidor ? ` · medidor ${esc(rec.medidor)}` : ''); lineEl.className = 'hint'; lineEl.style.color = 'var(--ok)'; }
  else { lineEl.textContent = '⚠️ ROL no está en la base local (impórtala en Sellos → Importar).'; lineEl.style.color = 'var(--warn)'; }
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
      h('button', { class: 'btn sm', style: 'width:auto', onClick: () => openSettings() }, 'Configurar')));
    card.appendChild(h('span', { class: 'chip mt' }, '📋 Modo asistido (sin IT)'));
    return card;
  }
  if (!isSignedIn()) {
    card.appendChild(h('div', { class: 'row between' },
      h('div', {}, h('h3', { style: 'margin:0' }, '🔐 No conectado'), h('div', { class: 'muted' }, 'Inicia sesión con tu cuenta de empresa.')),
      h('button', { class: 'btn primary sm', style: 'width:auto', onClick: async () => { try { await signIn(); toast('Conectado'); render(root); } catch (e) { toast('No se pudo conectar'); } } }, 'Conectar')));
    return card;
  }
  const acc = account();
  card.appendChild(h('div', { class: 'row between' },
    h('div', {}, h('h3', { style: 'margin:0' }, '✅ Conectado'), h('div', { class: 'muted' }, esc(acc?.email || acc?.name || 'Cuenta Microsoft'))),
    h('button', { class: 'btn ghost sm', style: 'width:auto', onClick: () => { signOut(); toast('Sesión cerrada'); render(root); } }, 'Salir')));
  return card;
}

async function submit(f, root) {
  const base = {
    rol: f.rol.value.trim(), cargo: f.cargo.value.trim(), condicion: f.condicion.value,
    otc: f.otc.value.trim(), motivo: f.motivo.value.trim(),
    fecha: new Date().toLocaleDateString('es-CL')
  };
  const main = { seal: f.seal.value.trim(), posicion: f.posicion.value, retiroNum: f.retiroNum.value.trim() || 'SS', retiroColor: f.retiroColor.value };
  if (!main.seal) return toast('Ingresa el N° de sello');
  if (!base.rol) return toast('Ingresa el ROL');
  if (extras.some((e) => !e.seal)) return toast('Falta el N° en un sello adicional');
  prefs.set('rendCargo', base.cargo);

  const entries = [main, ...extras.map((e) => ({ seal: e.seal, posicion: e.posicion, retiroNum: e.retiroNum || 'SS', retiroColor: e.retiroColor }))];

  if (simulating()) return assisted(base, entries);

  const progress = sheet('Rindiendo…', (body) => {
    body.appendChild(h('div', { class: 'center', style: 'padding:10px 0' },
      h('div', { class: 'splash-bar', style: 'margin:0 auto 16px' }, h('span')),
      h('div', { id: 'rend-step', class: 'muted' }, 'Iniciando…')));
  });
  const setStep = (m) => { const el = document.getElementById('rend-step'); if (el) el.textContent = m; };
  try {
    const done = await rendir(base, entries, setStep);
    progress.close();
    toast(`✅ ${done.length} sello(s) escritos en SharePoint`);
    render(root);
  } catch (e) {
    progress.close();
    if (e.code === 'NO_AUTH' || e.status === 401) { toast('Sesión expirada, reconecta'); signOut(); render(root); }
    else { toast('Error: ' + (e.message || e).slice(0, 90)); console.error(e); }
  }
}

// MODO ASISTIDO: muestra archivo + fila + valores, abre el Excel y copia.
function assisted(base, entries) {
  sheet('📋 Datos para rendir', (body, api) => {
    let firstFile = null;
    entries.forEach((e, i) => {
      const m = matchFileLocal(e.seal);
      if (i === 0 && m) firstFile = m.name;
      const fila = m ? `fila ${m.row}` : '—';
      const archivo = m ? m.name : '⚠️ carga la lista de archivos';
      body.appendChild(h('div', { class: 'card', style: 'margin:0 0 10px' },
        h('div', { class: 'row between' },
          h('div', { class: 'chip' }, `Sello ${esc(e.seal)}${i === 0 ? ' (principal)' : ''}`),
          m ? h('span', { class: 'chip ok' }, fila) : null),
        h('div', { class: 'kv', style: 'margin-top:8px' }, h('span', { class: 'k' }, 'Archivo'), h('span', { class: 'v', style: 'text-align:right;max-width:60%' }, archivo)),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'ROL (col F)'), h('span', { class: 'v' }, base.rol || '—')),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Color (col C)'), h('span', { class: 'v' }, 'CAFÉ')),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Cargo (col D)'), h('span', { class: 'v' }, base.cargo || '—')),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Condición (E)'), h('span', { class: 'v' }, base.condicion)),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Posición (I)'), h('span', { class: 'v' }, e.posicion || '—')),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Retirado (J/K)'), h('span', { class: 'v' }, `${e.retiroNum} · ${e.retiroColor}`)),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'OTC (L) / Motivo (N)'), h('span', { class: 'v', style: 'text-align:right;max-width:60%' }, `${base.otc || '—'} · ${base.motivo || '—'}`)),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Fecha (M)'), h('span', { class: 'v' }, base.fecha))
      ));
    });

    body.appendChild(h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', onClick: () => window.open(firstFile ? buildFileUrl(firstFile) : folderUrl(), '_blank') },
        firstFile ? '📂 Abrir Excel' : '📂 Abrir carpeta'),
      h('button', { class: 'btn ghost', onClick: async () => {
        const txt = buildCopyText(base, entries);
        try { await navigator.clipboard.writeText(txt); toast('Copiado'); } catch (_) { toast('No se pudo copiar'); }
      } }, '📋 Copiar')));
    body.appendChild(h('div', { class: 'hint', style: 'margin-top:10px' }, 'Abre el Excel (ya estás con tu cuenta), ve a la fila indicada y escribe estos datos. Medidor y dirección se autocompletan por la fórmula.'));
    body.appendChild(h('button', { class: 'btn ghost mt', onClick: () => api.close() }, 'Listo'));
  }, `${entries.length} sello(s) · modo asistido`);
}

function buildCopyText(base, entries) {
  const lines = [`RENDICIÓN — ${base.fecha}`, `ROL ${base.rol} · Cargo ${base.cargo} · ${base.condicion} · OTC ${base.otc} · ${base.motivo}`];
  entries.forEach((e) => {
    const m = matchFileLocal(e.seal);
    lines.push(`Sello ${e.seal}${m ? ` → ${m.name} fila ${m.row}` : ''} · pos ${e.posicion} · retirado ${e.retiroNum}/${e.retiroColor}`);
  });
  return lines.join('\n');
}

// Editor de la lista de archivos de la carpeta (pegar nombres).
function openFileList(root) {
  sheet('Archivos de la carpeta', (body, api) => {
    body.appendChild(h('p', { class: 'muted', style: 'margin:0 0 10px' }, 'Pega aquí los nombres de los Excel de la carpeta (uno por línea). Así la app sabe el archivo y la fila exactos. Ej: "10951 al 11000".'));
    const ta = h('textarea', { class: 'input', style: 'min-height:160px', placeholder: '10301 al 10350\n10951 al 11000\n11351 al 11410' });
    ta.value = getFileList().map((f) => f.name.replace(/\.xlsx?$/i, '')).join('\n');
    body.appendChild(h('div', { class: 'field' }, ta));
    body.appendChild(h('button', { class: 'btn primary', onClick: () => {
      const list = [];
      ta.value.split(/\r?\n/).forEach((line) => {
        const t = line.trim(); if (!t) return;
        const r = parseRange(t);
        if (r) list.push({ name: /\.xlsx?$/i.test(t) ? t : t + '.xlsx', start: r.start, end: r.end });
      });
      prefs.set('sealFiles', list);
      api.close(); toast(`${list.length} archivos guardados`); render(root);
    } }, 'Guardar lista'));
    body.appendChild(h('div', { class: 'hint' }, 'Solo se guardan los nombres (rangos), no el contenido. Todo local en tu teléfono.'));
  }, `${getFileList().length} cargados`);
}

function field(label, el) { return h('div', { class: 'field' }, h('label', {}, label), el); }
function select(options, blank) {
  const s = h('select', { class: 'select' });
  if (blank) s.appendChild(h('option', { value: '' }, '—'));
  options.forEach((o) => s.appendChild(h('option', { value: o }, o)));
  return s;
}

export { render as renderRendir };
register('rendir', { render, title: 'Rendición de Sellos' });
