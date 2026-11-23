// Interfaccia: campi, preset, generazione tramite il motore di calcolo, anteprima ed export.
'use strict';
(function (E) {
  const $ = (id) => document.getElementById(id);
  const V = E.VERSION;

  let source = null,
    models = [],
    fitted = false,
    viewer = null,
    engine = null,
    staleBuild = false; // un calcolo è stato annullato da un test e l'anteprima va rigenerata

  const activeSheet = () => {
    const p = E.PRESETS[$('preset').value];
    return (p && p.sheet) || null;
  };
  const fieldName = (id) => {
    const d = E.PARAMS.find((x) => x[0] === id);
    return d ? '«' + d[1] + '»' : id;
  };
  const status = (text) => ($('status').textContent = text);
  const setExports = (enabled) => ($('male').disabled = $('female').disabled = !enabled);
  const setBusy = (busy) => {
    $('view').setAttribute('aria-busy', busy ? 'true' : 'false');
    $('test').disabled = busy;
  };

  function invalid(id, message) {
    const el = $(id);
    if (el) el.setAttribute('aria-invalid', 'true');
    return Error(message);
  }

  function settings() {
    const s = {};
    for (const [id] of E.PARAMS) $(id).removeAttribute('aria-invalid');
    for (const [id] of E.PARAMS) {
      const raw = $(id).value.trim();
      s[id] = Number(raw);
      if (raw === '' || !Number.isFinite(s[id])) throw invalid(id, 'Valore mancante o non numerico in ' + fieldName(id) + '.');
      if (s[id] < 0) throw invalid(id, 'Il valore di ' + fieldName(id) + ' non può essere negativo.');
    }
    for (const id of ['w', 'h', 'b', 'r', 'aw', 'pin', 'ph'])
      if (s[id] <= 0) throw invalid(id, 'Il valore di ' + fieldName(id) + ' deve essere maggiore di zero.');
    if (s.w < 24) throw invalid('w', 'Piastra troppo piccola: ' + fieldName('w') + ' deve essere almeno 24 mm.');
    if (s.h < 16) throw invalid('h', 'Piastra troppo piccola: ' + fieldName('h') + ' deve essere almeno 16 mm.');
    return s;
  }

  const options = (s) => ({
    s,
    align: $('align').value,
    invert: $('invert').checked,
    invertArea: $('invertArea').value,
    mirror: $('mirror').checked,
    sheet: activeSheet(),
  });

  function fail(e) {
    setExports(false);
    models = [];
    if (viewer) {
      viewer.clear();
      try {
        viewer.sheet(settings(), activeSheet());
      } catch (ignore) {}
    }
    status('Errore: ' + e.message);
    console.error(e);
  }

  async function generate() {
    let s;
    try {
      s = settings();
    } catch (e) {
      return fail(e);
    }
    setExports(false);
    if (!source) {
      models = [];
      viewer.clear();
      viewer.sheet(s, activeSheet());
      if (viewer.count) viewer.fit();
      status(V + ': carica un SVG. Il perimetro rosso indica il foglio e non viene esportato.');
      return;
    }
    const opts = options(s);
    status(V + ': calcolo delle mesh in corso…');
    setBusy(true);
    let r;
    try {
      r = await engine.run('build', { source, opts });
    } catch (e) {
      if (e && e.cancelled) {
        staleBuild = true; // superato da una richiesta più recente
        return;
      }
      staleBuild = false;
      setBusy(false);
      return fail(e);
    }
    staleBuild = false;
    setBusy(false);
    viewer.clear();
    models = [r.positive, r.negative];
    viewer.show(r.positive, 0xd4d8df, -s.w / 2 - 8);
    viewer.show(r.negative, 0x93bad8, s.w / 2 + 8);
    viewer.sheet(s, opts.sheet);
    if (!fitted) {
      viewer.fit();
      fitted = true;
    }
    setExports(true);
    status(
      V + ': entrambe le mesh superano il controllo degli spigoli. Cavità ' + r.depth.toFixed(2) + ' mm. Volumi ' +
        r.volumes[0].toFixed(1) + ' / ' + r.volumes[1].toFixed(1) + ' mm³. Anteprima e STL condividono i triangoli. Rilievo: ' +
        (opts.invert ? 'vuoti, ' + $('invertArea').selectedOptions[0].textContent : 'pieni SVG') + '.' +
        (r.cut ? ' Disegno tagliato al perimetro del foglio.' : '') +
        ' La cavità conserva il gioco laterale anche al bordo del foglio. Piastre R6, tacca di orientamento superiore; fori guida ' +
        (s.pin + 2 * s.pg).toFixed(2) + ' mm.',
    );
  }

  function download(n) {
    if (!models[n]) return;
    try {
      const url = URL.createObjectURL(new Blob([E.mesh.stl(models[n])], { type: 'model/stl' })),
        link = document.createElement('a');
      link.href = url;
      link.download = n ? 'embosser_negativo.stl' : 'embosser_positivo.stl';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      fail(e);
    }
  }

  function applyPreset() {
    const p = E.PRESETS[$('preset').value];
    if (!p) return;
    $('presetNote').textContent = p.note || '';
    if (p.values) {
      for (const [id, value] of Object.entries(p.values)) $(id).value = value;
      if (p.align) $('align').value = p.align;
    }
    fitted = false;
    generate();
  }

  // Test integrato: interpretazione SVG nella pagina, geometria e mesh nel motore di calcolo.
  // Non modifica il disegno caricato né gli STL generati.
  async function regression() {
    status('Test integrato in corso…');
    setBusy(true);
    try {
      const sources = E.svg.selfTest();
      const { count } = await engine.run('selftest', sources);
      status(
        'Test superato: ' + count + ' mesh controllate. Verificati fill-rule, stili CSS, defs inutilizzati, clipping, input Clipper, ' +
          'inversioni, centro decentrato, piastre R6, tacca specchiata e guide esterne. Disegno e parametri utente conservati.',
      );
    } catch (e) {
      if (e && e.cancelled) return;
      status('Test fallito: ' + e.message);
      console.error(e);
    } finally {
      setBusy(false);
      // Il test annulla un eventuale calcolo in corso: rigenera per non lasciare l'anteprima incompleta.
      if (staleBuild) generate();
    }
  }

  function start() {
    for (const [id, title, value] of E.PARAMS) {
      const label = document.createElement('label'),
        input = document.createElement('input');
      label.textContent = title;
      Object.assign(input, { type: 'number', id, value, step: '0.05', min: '0' });
      label.append(input);
      $('params').append(label);
    }
    if (!window.ClipperLib || !window.THREE || !THREE.SVGLoader || !THREE.OrbitControls)
      throw Error('Dipendenza CDN non caricata: verificare connessione Internet o blocchi del browser verso cdn.jsdelivr.net.');
    viewer = E.createViewer($('view'));
    engine = E.createEngine('js/worker.js');
    window.embosser = { engine }; // diagnostica e test
    $('file').onchange = async (e) => {
      try {
        const f = e.target.files[0];
        if (!f) return;
        source = null;
        fitted = false;
        source = E.svg.parse(await f.text());
        generate();
      } catch (err) {
        fail(err);
      }
    };
    for (const [id] of E.PARAMS) $(id).onchange = generate;
    $('align').onchange = generate;
    $('mirror').onchange = generate;
    $('invert').onchange = () => {
      $('invertArea').disabled = !$('invert').checked;
      generate();
    };
    $('invertArea').onchange = generate;
    $('preset').onchange = applyPreset;
    $('fit').onclick = () => viewer.fit();
    $('test').onclick = regression;
    $('male').onclick = () => download(0);
    $('female').onclick = () => download(1);
    applyPreset();
  }

  try {
    start();
  } catch (e) {
    status('Avvio fallito: ' + e.message);
    console.error(e);
  }
})((self.Embosser = self.Embosser || {}));
