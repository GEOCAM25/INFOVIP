/* ============================================================
   INFOVIP · Cifrado local del PIN de automatizaciones
   Deriva el PIN con PBKDF2-SHA256 + salt aleatorio. Solo se
   guarda el hash y el salt; el PIN nunca se almacena en claro.
   ============================================================ */
const enc = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomSalt(len = 16) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return toHex(a);
}

async function derive(pin, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return toHex(bits);
}

export const pinCrypto = {
  // Devuelve {salt, hash} para guardar junto a la automatización.
  async hash(pin) {
    const salt = randomSalt();
    const hash = await derive(pin, salt);
    return { salt, hash };
  },
  // Verifica un PIN contra {salt, hash} almacenados.
  async verify(pin, stored) {
    if (!stored || !stored.salt || !stored.hash) return false;
    const h = await derive(pin, stored.salt);
    // comparación en tiempo (aprox) constante
    if (h.length !== stored.hash.length) return false;
    let diff = 0;
    for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ stored.hash.charCodeAt(i);
    return diff === 0;
  }
};
