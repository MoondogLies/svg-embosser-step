// Worker di calcolo: costruisce e verifica le mesh fuori dal thread dell'interfaccia.
// Le versioni delle dipendenze devono coincidere con quelle in index.html (verificato dai test).
'use strict';
importScripts(
  'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js',
  'https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js',
  'config.js',
  'geometry.js',
  'mesh.js',
  'hinge.js',
  'model.js',
);

self.onmessage = (event) => {
  const { id, type, payload } = event.data;
  try {
    const task = self.Embosser.tasks[type];
    if (!task) throw Error('Compito sconosciuto: ' + type);
    const result = task(payload);
    const transfer = [];
    for (const key of ['positive', 'negative']) if (result && result[key] instanceof Float32Array) transfer.push(result[key].buffer);
    self.postMessage({ id, result }, transfer);
  } catch (e) {
    self.postMessage({ id, error: (e && e.message) || String(e) });
  }
};
self.postMessage({ ready: true });
