/* ============================================================
   INFOVIP · Extracción de audio desde video (100% en el teléfono)
   Estrategia sin servidor y sin dependencias externas:
   reproduce el video en memoria, enruta su pista de audio a un
   MediaStreamDestination y la graba con MediaRecorder (Opus/WebM).
   Fallback: si el archivo ya es audio, se guarda tal cual.
   (Si el proyecto incluye ffmpeg.wasm en /vendor, se usaría ahí.)
   ============================================================ */

export async function extractAudioFromVideo(file, onProgress) {
  // Si ya es audio, no hay nada que convertir.
  if (file.type.startsWith('audio/')) return file;

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;

  await new Promise((res, rej) => {
    video.onloadedmetadata = res;
    video.onerror = () => rej(new Error('No se pudo leer el video'));
  });

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  const source = ctx.createMediaElementSource(video);
  const dest = ctx.createMediaStreamDestination();
  source.connect(dest);
  // NO conectamos a ctx.destination para no reproducir en voz alta.

  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
             : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
  const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const finished = new Promise((res) => { rec.onstop = res; });

  rec.start();
  await ctx.resume();
  await video.play();

  const total = video.duration || 0;
  const tick = setInterval(() => { if (total && onProgress) onProgress(Math.min(1, video.currentTime / total)); }, 250);

  await new Promise((res) => { video.onended = res; });
  clearInterval(tick);
  rec.stop();
  await finished;

  video.pause();
  ctx.close();
  URL.revokeObjectURL(url);

  return new Blob(chunks, { type: mime || 'audio/webm' });
}

// Graba audio directamente desde el micrófono (alternativa para crear tonos).
export async function recordFromMic(seconds = 5, onTick) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((res) => { rec.onstop = res; });
  rec.start();
  for (let i = 0; i < seconds; i++) { onTick && onTick(seconds - i); await new Promise((r) => setTimeout(r, 1000)); }
  rec.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());
  return new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
}
