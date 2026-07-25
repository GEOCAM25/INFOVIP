/* ============================================================
   INFOVIP · Módulo 2 · AUTOMATIZACIONES Y ALARMAS
   Motor If/Then con GPS + batería, salida de audio con volumen
   y vibración, bloqueo por PIN cifrado y conversor video→audio.
   ============================================================ */
import { h, clear, toast, emptyState, sheet, askPin, confirmSheet, esc, fmtTime } from '../core/ui.js';
import { register } from '../core/router.js';
import { db } from '../core/db.js';
import { geo, device } from '../core/native.js';
import { pinCrypto } from '../core/crypto.js';
import { extractAudioFromVideo } from '../core/audioTools.js';
import { startEngine, engineStatus, syncWatchers, watchingLocation, backgroundCapable, VIBRATIONS, getClimaConfig, setClimaConfig, fireClimaNow } from './engine.js';

// 5 sonidos integrados (archivos en assets/sounds y res/raw)
const SOUNDS = [
  { id: 'bip', name: '🔉 Bip' },
  { id: 'sirena', name: '🚨 Sirena' },
  { id: 'campana', name: '🔔 Campana' },
  { id: 'alerta', name: '⚠️ Alerta' },
  { id: 'timbre', name: '📣 Timbre' }
];
function previewUrl(url, volume) {
  try { const a = new Audio(url); a.volume = Math.max(0, Math.min(1, (volume ?? 100) / 100)); a.play().catch(() => {}); } catch (_) {}
}

async function render(root) {
  clear(root);
  startEngine(); // asegura que el motor está corriendo

  root.appendChild(h('div', { class: 'row between' },
    h('div', { class: 'page-title' }, 'Automatizaciones'),
    h('span', { class: `chip ${engineStatus() ? 'ok' : 'warn'}` }, engineStatus() ? '● Motor activo' : '○ Inactivo')
  ));
  root.appendChild(h('div', { class: 'page-sub' }, 'Reglas SI/ENTONCES con ubicación, batería, audio y vibración.'));

  // Estado de la vigilancia en segundo plano
  if (watchingLocation()) {
    root.appendChild(h('div', { class: 'chip ok', style: 'margin-bottom:12px' }, '📍 Vigilando ubicación en 2º plano (pantalla apagada)'));
  } else if (!backgroundCapable()) {
    root.appendChild(h('div', { class: 'chip warn', style: 'margin-bottom:12px' }, 'ℹ️ En 2º plano solo funciona bien instalando el APK'));
  }

  // Tarjeta de automatización de CLIMA
  root.appendChild(climaCard());

  const list = h('div');
  root.appendChild(list);

  const rules = await db.getAll('automatizaciones').catch(() => []);
  if (!rules.length) {
    list.appendChild(emptyState('⚡', 'Aún no tienes automatizaciones.\nCrea la primera con el botón +'));
  } else {
    for (const r of rules) list.appendChild(await ruleCard(r, root));
  }

  const fab = h('button', { class: 'fab', onClick: () => openEditor(root) }, '+');
  root.appendChild(fab);
}

async function ruleCard(rule, root) {
  const locked = !!(rule.pin && rule.pin.hash);
  const card = h('div', { class: 'card' },
    h('div', { class: 'row between' },
      h('h3', { style: 'margin:0' }, esc(rule.name || 'Sin nombre')),
      locked ? h('span', { class: 'chip lock' }, '🔒 PIN') : null
    ),
    h('div', { class: 'muted', style: 'margin:8px 0' }, describe(rule)),
    h('div', { class: 'row between', style: 'margin-top:6px' },
      toggle(rule.enabled, async (on) => {
        if (locked && !(await unlock(rule))) return false;
        rule.enabled = on; await db.put('automatizaciones', rule);
        await syncWatchers();
        toast(on ? 'Activada' : 'Desactivada'); return true;
      }),
      h('div', { class: 'btn-row', style: 'width:auto' },
        h('button', { class: 'btn ghost sm', onClick: async () => { if (locked && !(await unlock(rule))) return; openEditor(root, rule); } }, 'Editar'),
        h('button', { class: 'btn danger sm', onClick: async () => {
          if (locked && !(await unlock(rule))) return;
          if (await confirmSheet('Eliminar', `¿Borrar "${rule.name}"?`, { okText: 'Eliminar', danger: true })) {
            await db.delete('automatizaciones', rule.id); await syncWatchers(); toast('Eliminada'); render(root);
          }
        } }, '🗑')
      )
    )
  );
  return card;
}

function climaCard() {
  const c = getClimaConfig();
  const card = h('div', { class: 'card' });
  const sel = h('select', { class: 'select', style: 'width:auto' },
    ...[1, 2, 3, 6, 12].map((n) => h('option', { value: String(n) }, `cada ${n} h`)));
  sel.value = String(c.everyHours || 1);
  sel.addEventListener('change', () => { const cfg = getClimaConfig(); cfg.everyHours = Number(sel.value); setClimaConfig(cfg); toast('Frecuencia actualizada'); });
  const sw = toggle(c.enabled, (on) => { const cfg = getClimaConfig(); cfg.enabled = on; setClimaConfig(cfg); toast(on ? 'Clima activado' : 'Clima desactivado'); return true; });
  card.appendChild(h('div', { class: 'row between' },
    h('div', {}, h('h3', { style: 'margin:0' }, '🌦️ Clima por horas'), h('div', { class: 'muted' }, 'Notificación con el clima de tu ubicación.')),
    sw));
  card.appendChild(h('div', { class: 'row between', style: 'margin-top:10px' }, h('span', { class: 'muted' }, 'Frecuencia'), sel));

  // Horario de silencio (no notifica dentro de esa franja)
  const qFrom = h('input', { class: 'input', type: 'time', style: 'width:auto', value: c.quietFrom || '' });
  const qTo = h('input', { class: 'input', type: 'time', style: 'width:auto', value: c.quietTo || '' });
  const saveQuiet = () => { const cfg = getClimaConfig(); cfg.quietFrom = qFrom.value; cfg.quietTo = qTo.value; setClimaConfig(cfg); toast('Silencio actualizado'); };
  qFrom.addEventListener('change', saveQuiet); qTo.addEventListener('change', saveQuiet);
  card.appendChild(h('div', { class: 'row between', style: 'margin-top:10px' },
    h('span', { class: 'muted' }, '🔕 Silencio'),
    h('div', { class: 'row', style: 'gap:6px' }, qFrom, h('span', { class: 'muted' }, 'a'), qTo)));

  card.appendChild(h('button', { class: 'btn ghost sm', style: 'margin-top:12px', onClick: async () => { toast('Consultando clima…'); const t = await fireClimaNow(); toast(t ? '🌦️ ' + t : 'Sin señal / permiso de ubicación'); } }, '▶️ Probar ahora'));
  card.appendChild(h('div', { class: 'hint' }, 'Entre las horas de silencio no envía. Con pantalla apagada mantiene el servicio activo y usa tu ubicación.'));
  return card;
}

function describe(rule) {
  const c = rule.conditions || {}, a = rule.action || {};
  const parts = [];
  if (c.location && c.location.lat != null) parts.push(`📍 a ${c.location.radius || 100} m del punto`);
  if (c.battery && c.battery.op) parts.push(`🔋 batería ${c.battery.op === 'lt' ? '<' : c.battery.op === 'gt' ? '>' : '='} ${c.battery.value}%`);
  if (c.time && c.time.at) parts.push(`⏰ ${c.time.at}`);
  if (c.sun && c.sun.event) {
    const o = Number(c.sun.offsetMin) || 0;
    const ev = c.sun.event === 'sunset' ? 'atardecer' : 'amanecer';
    parts.push(o === 0 ? `🌅 ${ev}` : `🌅 ${Math.abs(o) >= 60 && Math.abs(o) % 60 === 0 ? Math.abs(o) / 60 + 'h' : Math.abs(o) + 'min'} ${o < 0 ? 'antes' : 'después'} del ${ev}`);
  }
  const cond = parts.length ? parts.join(` ${rule.logic === 'or' ? 'O' : 'Y'} `) : 'sin condiciones';
  const mode = a.mode || (a.audioId != null ? 'propio' : 'vibrar');
  const out = ['📳 ' + (a.vibration || 'doble')];
  if (mode === 'sonido') out.push(`🔔 ${a.sound || 'sonido'}`);
  else if (mode === 'propio') out.push('🎵 propio');
  return `SI ${cond} → ${out.join(' + ')}`;
}

async function unlock(rule) {
  const pin = await askPin('Automatización protegida', 'Ingresa el PIN para continuar.');
  if (pin == null) return false;
  const ok = await pinCrypto.verify(pin, rule.pin);
  if (!ok) { toast('PIN incorrecto'); return false; }
  return true;
}

/* ---------------- Editor ---------------- */
function openEditor(root, existing) {
  const rule = existing ? JSON.parse(JSON.stringify(existing)) : {
    name: '', enabled: true, logic: 'and',
    conditions: { location: null, battery: null },
    action: { mode: 'vibrar', sound: 'sirena', vibration: 'doble', audioId: null, audioName: '', volume: 100, loop: false },
    pin: null
  };

  sheet(existing ? 'Editar automatización' : 'Nueva automatización', (body, api) => {
    // Nombre
    const name = h('input', { class: 'input', placeholder: 'Ej: Llegada a bodega', value: rule.name || '' });
    body.appendChild(field('Nombre', name));

    // --- Condición ubicación ---
    body.appendChild(h('div', { class: 'divider' }));
    body.appendChild(h('div', { class: 'sr-title' }, '📍 Condición de ubicación'));
    const locSummary = h('div', { class: 'muted', style: 'margin:6px 0' });
    const radius = h('input', { class: 'input', type: 'number', min: '20', step: '10', value: (rule.conditions.location?.radius) || 100 });
    const updLoc = () => { locSummary.textContent = rule.conditions.location ? `Punto: ${rule.conditions.location.lat.toFixed(5)}, ${rule.conditions.location.lon.toFixed(5)}` : 'Sin punto definido'; };
    updLoc();
    body.appendChild(locSummary);
    body.appendChild(h('div', { class: 'btn-row' },
      h('button', { class: 'btn ghost sm', onClick: async () => {
        try { const p = await geo.current(); rule.conditions.location = { ...p, radius: Number(radius.value) || 100 }; updLoc(); toast('Ubicación capturada'); }
        catch (_) { toast('No se pudo obtener GPS'); }
      } }, '📡 Usar ubicación actual'),
      h('button', { class: 'btn ghost sm', onClick: () => { rule.conditions.location = null; updLoc(); } }, 'Quitar')
    ));
    body.appendChild(field('Radio (metros)', radius));

    // --- Condición batería ---
    body.appendChild(h('div', { class: 'divider' }));
    body.appendChild(h('div', { class: 'sr-title' }, '🔋 Condición de batería'));
    const batOp = h('select', { class: 'select' },
      h('option', { value: '' }, 'Sin condición'),
      h('option', { value: 'lt' }, 'menor que'),
      h('option', { value: 'gt' }, 'mayor que'),
      h('option', { value: 'eq' }, 'igual a'));
    if (rule.conditions.battery?.op) batOp.value = rule.conditions.battery.op;
    const batVal = h('input', { class: 'input', type: 'number', min: '0', max: '100', value: rule.conditions.battery?.value ?? 30 });
    body.appendChild(h('div', { class: 'row', style: 'gap:10px' },
      h('div', { style: 'flex:1' }, field('Operador', batOp)),
      h('div', { style: 'width:110px' }, field('% batería', batVal))
    ));

    // Lógica AND/OR
    const logic = h('select', { class: 'select' }, h('option', { value: 'and' }, 'Se cumplen TODAS (Y)'), h('option', { value: 'or' }, 'Cualquiera (O)'));
    logic.value = rule.logic || 'and';
    body.appendChild(field('Cómo combinar condiciones', logic));

    // --- Disparo por HORARIO ---
    body.appendChild(h('div', { class: 'divider' }));
    body.appendChild(h('div', { class: 'sr-title' }, '⏰ Horario exacto'));
    const timeIn = h('input', { class: 'input', type: 'time', value: rule.conditions.time?.at || '' });
    body.appendChild(h('div', { class: 'field' }, h('label', {}, 'Hora (opcional) — dispara a esa hora'), timeIn));

    // --- Disparo por SOL (amanecer/atardecer ± desfase) ---
    body.appendChild(h('div', { class: 'sr-title' }, '🌅 Amanecer / Atardecer'));
    const sunEvent = h('select', { class: 'select' },
      h('option', { value: '' }, 'Sin disparo por sol'),
      h('option', { value: 'sunrise' }, '🌅 Amanecer'),
      h('option', { value: 'sunset' }, '🌇 Atardecer'));
    if (rule.conditions.sun?.event) sunEvent.value = rule.conditions.sun.event;
    const off0 = rule.conditions.sun?.offsetMin || 0;
    const sunDir = h('select', { class: 'select' }, h('option', { value: 'after' }, 'después'), h('option', { value: 'before' }, 'antes'));
    sunDir.value = off0 < 0 ? 'before' : 'after';
    const sunUnit = h('select', { class: 'select' }, h('option', { value: 'min' }, 'minutos'), h('option', { value: 'hr' }, 'horas'));
    const absOff = Math.abs(off0);
    const sunAmt = h('input', { class: 'input', type: 'number', min: '0', value: absOff % 60 === 0 && absOff >= 60 ? absOff / 60 : absOff });
    if (absOff % 60 === 0 && absOff >= 60) sunUnit.value = 'hr';
    body.appendChild(field('Evento', sunEvent));
    body.appendChild(h('div', { class: 'row', style: 'gap:8px' },
      h('div', { style: 'width:90px' }, field('Desfase', sunAmt)),
      h('div', { style: 'flex:1' }, field('Unidad', sunUnit)),
      h('div', { style: 'flex:1' }, field('Antes/Después', sunDir))));
    body.appendChild(h('div', { class: 'hint', style: 'margin-top:-6px' }, 'Ej: “Atardecer · 1 · horas · antes” = suena 1 hora antes de que se oculte el sol.'));

    // --- Acción: salida ---
    body.appendChild(h('div', { class: 'divider' }));
    body.appendChild(h('div', { class: 'sr-title' }, '🔊 Salida al dispararse'));

    // Modo: solo vibrar / vibrar + sonido / sonido propio
    const mode = h('select', { class: 'select' },
      h('option', { value: 'vibrar' }, '📳 Solo vibrar'),
      h('option', { value: 'sonido' }, '🔔 Vibrar + sonido'),
      h('option', { value: 'propio' }, '🎵 Vibrar + sonido propio'));
    mode.value = rule.action.mode || (rule.action.audioId != null ? 'propio' : 'vibrar');
    body.appendChild(field('Modo', mode));

    // Selector de sonido integrado
    const sound = h('select', { class: 'select' },
      ...SOUNDS.map((s) => h('option', { value: s.id }, s.name)));
    sound.value = rule.action.sound || 'sirena';
    const soundBox = h('div', { class: 'field' }, h('label', {}, 'Sonido'),
      h('div', { class: 'row', style: 'gap:8px' },
        h('div', { style: 'flex:1' }, sound),
        h('button', { class: 'btn ghost sm', style: 'width:auto', onClick: () => previewUrl(`./assets/sounds/${sound.value}.wav`, Number(vol.value)) }, '▶️')));

    // Sonido propio (subir / convertir video)
    const audioLabel = h('div', { class: 'muted', style: 'margin:6px 0' }, rule.action.audioName ? `Audio: ${rule.action.audioName}` : 'Sin audio propio');
    const propioBox = h('div',
      audioLabel,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost sm', onClick: () => pickOrConvertAudio(rule, audioLabel) }, '🎵 Elegir / convertir'),
        h('button', { class: 'btn ghost sm', onClick: () => { if (rule.action.audioId != null) previewAudio(rule.action.audioId, Number(vol.value)); } }, '▶️ Probar')));

    body.appendChild(soundBox); body.appendChild(propioBox);

    // Tipo de vibración
    const vibType = h('select', { class: 'select' },
      h('option', { value: 'corta' }, 'Corta'),
      h('option', { value: 'larga' }, 'Larga'),
      h('option', { value: 'doble' }, 'Doble'),
      h('option', { value: 'triple' }, 'Triple'),
      h('option', { value: 'sos' }, 'SOS (S·O·S)'));
    vibType.value = rule.action.vibration || 'doble';
    body.appendChild(field('Tipo de vibración', h('div', { class: 'row', style: 'gap:8px' },
      h('div', { style: 'flex:1' }, vibType),
      h('button', { class: 'btn ghost sm', style: 'width:auto', onClick: () => { if (navigator.vibrate) navigator.vibrate(VIBRATIONS[vibType.value] || [0, 220]); } }, '📳'))));

    // Volumen + loop (para modos con sonido)
    const vol = h('input', { type: 'range', min: '0', max: '100', value: rule.action.volume ?? 100, style: 'width:100%' });
    const volLbl = h('span', { class: 'v' }, `${rule.action.volume ?? 100}%`);
    vol.addEventListener('input', () => { volLbl.textContent = `${vol.value}%`; });
    const loop = h('input', { type: 'checkbox', ...(rule.action.loop ? { checked: true } : {}) });
    const soundExtra = h('div',
      h('div', { class: 'row between', style: 'margin:14px 0 4px' }, h('span', { class: 'k muted' }, 'Volumen'), volLbl), vol,
      h('label', { class: 'row', style: 'gap:8px;margin-top:12px' }, loop, h('span', { class: 'muted' }, 'Repetir el sonido (máx 30 s)')));
    body.appendChild(soundExtra);

    const applyMode = () => {
      soundBox.hidden = mode.value !== 'sonido';
      propioBox.hidden = mode.value !== 'propio';
      soundExtra.hidden = mode.value === 'vibrar';
    };
    mode.addEventListener('change', applyMode); applyMode();

    // --- Seguridad PIN ---
    body.appendChild(h('div', { class: 'divider' }));
    const hasPin = !!(rule.pin && rule.pin.hash);
    const pinBtn = h('button', { class: 'btn ghost sm' }, hasPin ? '🔒 PIN activo — cambiar/quitar' : '🔑 Proteger con PIN');
    pinBtn.addEventListener('click', () => managePin(rule, pinBtn));
    body.appendChild(h('div', { class: 'setting-row' },
      h('div', { class: 'sr-main' }, h('div', { class: 'sr-title' }, 'Bloqueo por PIN'), h('div', { class: 'sr-desc' }, 'Nadie podrá editar, borrar ni desactivar sin el PIN.')),
    ));
    body.appendChild(pinBtn);

    // Guardar
    body.appendChild(h('div', { class: 'mt' }));
    body.appendChild(h('button', { class: 'btn primary', onClick: async () => {
      rule.name = name.value.trim() || 'Sin nombre';
      rule.logic = logic.value;
      if (rule.conditions.location) rule.conditions.location.radius = Number(radius.value) || 100;
      rule.conditions.battery = batOp.value ? { op: batOp.value, value: Number(batVal.value) } : null;
      rule.conditions.time = timeIn.value ? { at: timeIn.value } : null;
      if (sunEvent.value) {
        const amt = Number(sunAmt.value) || 0;
        const mins = amt * (sunUnit.value === 'hr' ? 60 : 1) * (sunDir.value === 'before' ? -1 : 1);
        rule.conditions.sun = { event: sunEvent.value, offsetMin: mins };
      } else rule.conditions.sun = null;
      rule.action.mode = mode.value;
      rule.action.sound = sound.value;
      rule.action.vibration = vibType.value;
      rule.action.volume = Number(vol.value);
      rule.action.loop = loop.checked;
      if (!rule.conditions.location && !rule.conditions.battery && !rule.conditions.time && !rule.conditions.sun)
        return toast('Define al menos una condición o un horario');
      if (existing) await db.put('automatizaciones', rule);
      else { delete rule.id; await db.add('automatizaciones', rule); }
      await syncWatchers();
      api.close(); toast('Guardada'); render(root);
    } }, existing ? 'Guardar cambios' : 'Crear automatización'));
  }, 'Todo se guarda cifrado/local en tu teléfono.');
}

/* ---- Selección / conversión de audio ---- */
function pickOrConvertAudio(rule, labelEl) {
  sheet('Audio de la alarma', (body, api) => {
    body.appendChild(h('p', { class: 'muted', style: 'margin:0 0 12px' }, 'Sube un audio, o un video (MP4) y extraeremos su pista de sonido aquí mismo, sin enviarla a ningún servidor.'));
    const file = h('input', { class: 'input', type: 'file', accept: 'audio/*,video/*' });
    const progress = h('div', { class: 'hint' });
    body.appendChild(h('div', { class: 'field' }, file));
    body.appendChild(progress);
    body.appendChild(h('button', { class: 'btn primary', onClick: async () => {
      const f = file.files[0];
      if (!f) return toast('Elige un archivo');
      try {
        progress.textContent = f.type.startsWith('video') ? 'Extrayendo audio del video…' : 'Guardando audio…';
        const blob = await extractAudioFromVideo(f, (p) => { progress.textContent = `Convirtiendo… ${Math.round(p * 100)}%`; });
        const name = f.name.replace(/\.[^.]+$/, '');
        const id = await db.add('audios', { name, blob, createdAt: Date.now() });
        rule.action.audioId = id; rule.action.audioName = name;
        labelEl.textContent = `Audio: ${name}`;
        api.close(); toast('🎵 Audio guardado');
      } catch (e) { progress.textContent = ''; toast('No se pudo procesar el archivo'); }
    } }, 'Procesar y guardar'));

    // Listar audios existentes para reutilizar
    db.getAll('audios').then((audios) => {
      if (!audios.length) return;
      body.appendChild(h('div', { class: 'divider' }));
      body.appendChild(h('div', { class: 'sr-title', style: 'margin-bottom:8px' }, 'Audios guardados'));
      audios.forEach((au) => body.appendChild(h('div', { class: 'list-item' },
        h('span', { class: 'li-ico' }, '🎵'),
        h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, esc(au.name)), h('div', { class: 'li-sub' }, fmtTime(au.createdAt))),
        h('button', { class: 'btn ghost sm', onClick: () => { rule.action.audioId = au.id; rule.action.audioName = au.name; labelEl.textContent = `Audio: ${au.name}`; api.close(); } }, 'Usar')
      )));
    });
  });
}

async function previewAudio(audioId, volume) {
  const au = await db.get('audios', audioId);
  if (!au) return toast('Audio no encontrado');
  const url = URL.createObjectURL(au.blob);
  const el = new Audio(url); el.volume = Math.max(0, Math.min(1, (volume ?? 100) / 100));
  el.play().catch(() => toast('Toca de nuevo para reproducir'));
  el.addEventListener('ended', () => URL.revokeObjectURL(url));
}

/* ---- Gestión del PIN ---- */
function managePin(rule, btn) {
  sheet('Bloqueo por PIN', (body, api) => {
    if (rule.pin && rule.pin.hash) {
      body.appendChild(h('p', { class: 'muted', style: 'margin:0 0 14px' }, 'Esta automatización ya tiene PIN.'));
      body.appendChild(h('button', { class: 'btn danger', onClick: async () => {
        const pin = await askPin('Confirma tu PIN', 'Para quitar la protección.');
        if (pin == null) return;
        if (!(await pinCrypto.verify(pin, rule.pin))) return toast('PIN incorrecto');
        rule.pin = null; btn.textContent = '🔑 Proteger con PIN'; api.close(); toast('PIN eliminado');
      } }, 'Quitar PIN'));
    } else {
      const p1 = h('input', { class: 'input big center', type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: 'PIN nuevo' });
      const p2 = h('input', { class: 'input big center', type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: 'Repite el PIN' });
      body.appendChild(h('div', { class: 'field' }, p1));
      body.appendChild(h('div', { class: 'field' }, p2));
      body.appendChild(h('button', { class: 'btn primary', onClick: async () => {
        if (!p1.value.trim() || p1.value.length < 4) return toast('Usa 4 a 8 dígitos');
        if (p1.value !== p2.value) return toast('Los PIN no coinciden');
        rule.pin = await pinCrypto.hash(p1.value.trim());
        btn.textContent = '🔒 PIN activo — cambiar/quitar'; api.close(); toast('🔒 Protegida con PIN');
      } }, 'Guardar PIN'));
    }
  });
}

/* ---- helpers ---- */
function field(label, el) { return h('div', { class: 'field' }, h('label', {}, label), el); }
function toggle(checked, onChange) {
  const input = h('input', { type: 'checkbox', ...(checked ? { checked: true } : {}) });
  input.addEventListener('change', async () => { const r = await onChange(input.checked); if (r === false) input.checked = !input.checked; });
  return h('label', { class: 'switch' }, input, h('span', { class: 'track' }), h('span', { class: 'thumb' }));
}

register('autos', { render, title: 'Automatizaciones' });
