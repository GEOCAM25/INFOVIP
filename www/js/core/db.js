/* ============================================================
   INFOVIP · Capa de datos IndexedDB (100% local, por dispositivo)
   Wrapper minimalista basado en promesas. Sin dependencias.
   Cada "store" es una tabla independiente. Nada sale del teléfono.
   ============================================================ */
const DB_NAME = 'infovip';
const DB_VERSION = 1;

// Definición de object stores. keyPath 'id' autoincremental salvo indicado.
const STORES = {
  sellos:          { keyPath: 'rol' },                    // planilla de sellos (ROL como clave)
  automatizaciones:{ keyPath: 'id', autoIncrement: true },
  audios:          { keyPath: 'id', autoIncrement: true },// audios extraídos (blobs)
  planos:          { keyPath: 'id', autoIncrement: true },// PDFs guardados (blobs)
  novedades:       { keyPath: 'id', autoIncrement: true },// borradores subestaciones
  cache:           { keyPath: 'key' }                     // caché genérico (clima, etc.)
};

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, opts] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, opts);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(store, mode = 'readonly') {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}
function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const db = {
  async get(store, key)      { return done((await tx(store)).get(key)); },
  async getAll(store)        { return done((await tx(store, 'readonly')).getAll()); },
  async put(store, value)    { return done((await tx(store, 'readwrite')).put(value)); },
  async add(store, value)    { return done((await tx(store, 'readwrite')).add(value)); },
  async delete(store, key)   { return done((await tx(store, 'readwrite')).delete(key)); },
  async clear(store)         { return done((await tx(store, 'readwrite')).clear()); },
  async count(store)         { return done((await tx(store, 'readonly')).count()); },

  // Inserta muchos registros en una sola transacción (para importar la planilla).
  async bulkPut(store, values) {
    const os = await tx(store, 'readwrite');
    await Promise.all(values.map((v) => done(os.put(v))));
    return values.length;
  }
};

export const CACHE_STORE = 'cache';
