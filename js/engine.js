// Esegue i compiti di calcolo in un Web Worker; se il worker non è disponibile
// (ad esempio pagina aperta da file://) li esegue nella pagina.
// Una nuova richiesta annulla quella in corso: il worker viene terminato e ricreato.
'use strict';
(function (E) {
  E.createEngine = function (workerUrl) {
    let worker = null,
      usable = typeof Worker !== 'undefined',
      pending = null,
      seq = 0;

    const engine = {
      // 'worker' quando il calcolo avviene nel worker, 'local' nella pagina.
      get mode() {
        return usable ? 'worker' : 'local';
      },
      run,
    };

    function settle(job, fn, value) {
      if (pending !== job) return;
      pending = null;
      fn(value);
    }

    function runLocal(job) {
      // Rimanda di un frame così l'interfaccia può mostrare lo stato "in corso".
      setTimeout(() => {
        if (pending !== job) return;
        try {
          settle(job, job.resolve, E.tasks[job.type](job.payload));
        } catch (e) {
          settle(job, job.reject, e);
        }
      }, 20);
    }

    function fallBack(reason) {
      if (usable) console.warn('Web Worker non disponibile, calcolo nella pagina:', reason);
      usable = false;
      if (worker) worker.terminate();
      worker = null;
      if (pending) runLocal(pending);
    }

    function spawn() {
      try {
        worker = new Worker(workerUrl);
      } catch (e) {
        // Errore sincrono (es. file://): run() passerà direttamente al calcolo nella pagina.
        console.warn('Web Worker non disponibile, calcolo nella pagina:', e && e.message);
        usable = false;
        worker = null;
        return null;
      }
      worker.onmessage = (event) => {
        const m = event.data;
        if (m.ready || !pending || m.id !== pending.id) return;
        if (m.error) settle(pending, pending.reject, Error(m.error));
        else settle(pending, pending.resolve, m.result);
      };
      // Errore di caricamento del worker (script o dipendenze): si passa al calcolo nella pagina.
      worker.onerror = (event) => {
        event.preventDefault();
        fallBack(event.message || 'errore di caricamento');
      };
      return worker;
    }

    function run(type, payload) {
      if (pending) {
        const old = pending;
        pending = null;
        if (worker) {
          worker.terminate();
          worker = null;
        }
        old.reject(Object.assign(Error('Calcolo annullato.'), { cancelled: true }));
      }
      return new Promise((resolve, reject) => {
        const job = { id: ++seq, type, payload, resolve, reject };
        pending = job;
        if (usable && (worker || spawn())) worker.postMessage({ id: job.id, type, payload });
        else runLocal(job);
      });
    }

    return engine;
  };
})((self.Embosser = self.Embosser || {}));
