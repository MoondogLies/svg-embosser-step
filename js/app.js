// Interfaccia: campi, preset, profilo stampante, generazione tramite il motore di calcolo, anteprima ed export.
'use strict';
(function (E) {
  const $ = (id) => document.getElementById(id);
  const V = E.VERSION;
  const STORE = 'embosser-settings-v1';
  const CHECKS = ['invert', 'mirror', 'strokes'];
  const SELECTS = ['preset', 'printer', 'scaleMode', 'align', 'invertArea', 'stops'];

  let source = null,
    sourceText = null,
    models = [],
    lastBuild = null,
    fitted = false,
    viewer = null,
    engine = null,
    sheetModel = null,
    sheetViewer = null,
    staleBuild = false; // un calcolo è stato annullato da un test e l'anteprima va rigenerata

  const activeSheet = () => {
    const p = E.PRESETS[$('preset').value];
    return (p && p.sheet) || null;
  };
  // Battute solo se il preset definisce un foglio.
  const activeStops = () => (activeSheet() ? $('stops').value : 'none');
  const activePrinter = () => E.PRINTERS[$('printer').value] || E.PRINTERS.none;
  const fieldName = (id) => {
    const d = E.PARAMS.find((x) => x[0] === id);
    return d ? '«' + d[1] + '»' : id;
  };
  const status = (text) => ($('status').textContent = text);
  const setWarnings = (list) => {
    $('warnings').replaceChildren(...list.map((w) => Object.assign(document.createElement('li'), { textContent: w })));
  };
  const setExports = (enabled) => {
    for (const id of ['male', 'female', 'both']) $(id).disabled = !enabled;
  };
  const setBusy = (busy) => {
    $('view').setAttribute('aria-busy', busy ? 'true' : 'false');
    $('test').disabled = busy;
  };
  const mm = (x) => x.toFixed(2).replace(/\.?0+$/, '');

  // Impostazioni salvate nel browser (localStorage può mancare: modalità privata, file://, blocchi).
  function save() {
    try {
      const data = { values: {}, checks: {}, selects: {} };
      for (const [id] of E.PARAMS) data.values[id] = $(id).value;
      for (const id of CHECKS) data.checks[id] = $(id).checked;
      for (const id of SELECTS) data.selects[id] = $(id).value;
      localStorage.setItem(STORE, JSON.stringify(data));
    } catch (ignore) {}
  }
  function restore() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(STORE) || 'null');
    } catch (ignore) {}
    if (!data || !data.values) return false;
    for (const [id] of E.PARAMS) if (data.values[id] !== undefined) $(id).value = data.values[id];
    for (const id of CHECKS) if (typeof (data.checks || {})[id] === 'boolean') $(id).checked = data.checks[id];
    for (const id of SELECTS) {
      const v = (data.selects || {})[id];
      if (v !== undefined && [...$(id).options].some((o) => o.value === v)) $(id).value = v;
    }
    return true;
  }

  function invalid(id, message) {
    const el = $(id);
    if (el) el.setAttribute('aria-invalid', 'true');
    return Error(message);
  }

  function settings() {
    const s = {};
    for (const [id] of E.PARAMS) $(id).removeAttribute('aria-invalid');
    for (const [id, , , , , flags] of E.PARAMS) {
      const raw = $(id).value.trim();
      s[id] = Number(raw);
      if (raw === '' || !Number.isFinite(s[id])) throw invalid(id, 'Valore mancante o non numerico in ' + fieldName(id) + '.');
      if (s[id] < 0 && !(flags && flags.negative)) throw invalid(id, 'Il valore di ' + fieldName(id) + ' non può essere negativo.');
    }
    for (const id of ['w', 'h', 'b', 'r', 'aw', 'pin', 'ph'])
      if (s[id] <= 0) throw invalid(id, 'Il valore di ' + fieldName(id) + ' deve essere maggiore di zero.');
    if (s.w < 24) throw invalid('w', 'Piastra troppo piccola: ' + fieldName('w') + ' deve essere almeno 24 mm.');
    if (s.h < 16) throw invalid('h', 'Piastra troppo piccola: ' + fieldName('h') + ' deve essere almeno 16 mm.');
    if (s.layer && (s.layer < 0.04 || s.layer > 0.4)) throw invalid('layer', fieldName('layer') + ': usa 0 oppure un valore tra 0,04 e 0,4 mm.');
    if (s.draft >= 60) throw invalid('draft', fieldName('draft') + ' deve essere minore di 60°.');
    return s;
  }

  const options = (s) => ({
    s,
    align: $('align').value,
    invert: $('invert').checked,
    invertArea: $('invertArea').value,
    mirror: $('mirror').checked,
    sheet: activeSheet(),
    bed: activePrinter().bed || null,
    scaleMode: $('scaleMode').value,
    stops: activeStops(),
  });

  // Pianta della sola piastra (senza disegno) oppure vuota se i parametri non sono validi.
  function showPlatePlan() {
    try {
      const s = settings();
      E.renderPlan($('plan'), { s, sheet: activeSheet(), plan: E.platePlan(s, $('mirror').checked, activeSheet(), activeStops()) });
    } catch (ignore) {
      E.renderPlan($('plan'), null);
    }
  }

  // Foglio goffrato: anteprima con luce radente e pulsante per la finestra 3D.
  function updateSheet(relief, s, sheet) {
    let m = null;
    try {
      m = relief || sheet ? E.sheet.model(relief || [], s, sheet) : null;
    } catch (e) {
      console.error(e);
    }
    sheetModel = m;
    $('sheetPreview').hidden = !m;
    $('sheet3d').disabled = !m;
    if (!m) {
      $('sheetNote').textContent = source
        ? 'Foglio non disponibile: correggi l’errore indicato sopra per generare le matrici.'
        : 'Carica un SVG per vedere il foglio goffrato.';
      return;
    }
    E.sheet.drawPreview($('sheetPreview'), m);
    $('sheetNote').textContent =
      (sheet ? 'Foglio ' + mm(m.w) + ' × ' + mm(m.h) + ' mm del preset' : 'Foglio ' + mm(m.w) + ' × ' + mm(m.h) + ' mm (ingombro del disegno più 5 mm per lato)') +
      ', visto dal lato del rilievo; carta ' + mm(m.thickness) + ' mm, rilievo ' + mm(m.relief) + ' mm. ' +
      (m.embossed ? 'Anteprima con luce radente e pendenze esagerate per leggibilità; simulazione indicativa.' : 'Nessun rilievo: carica un SVG.');
  }

  function openSheet() {
    if (!sheetModel) return;
    const dialog = $('sheetDialog');
    $('sheetTitle').textContent = 'Foglio goffrato ' + mm(sheetModel.w) + ' × ' + mm(sheetModel.h) + ' mm';
    if (!dialog.open) dialog.showModal();
    if (sheetViewer) sheetViewer.close();
    sheetViewer = E.sheet.openViewer(dialog, $('sheetView'), sheetModel, { exaggeration: Number($('sheetExaggeration').value) });
  }

  function closeSheet() {
    if (sheetViewer) sheetViewer.close();
    sheetViewer = null;
    if ($('sheetDialog').open) $('sheetDialog').close();
  }

  function fail(e) {
    setExports(false);
    models = [];
    lastBuild = null;
    setWarnings(source ? source.warnings || [] : []);
    if (viewer) {
      viewer.clear();
      try {
        viewer.sheet(settings(), activeSheet());
      } catch (ignore) {}
    }
    showPlatePlan();
    try {
      updateSheet(null, settings(), activeSheet());
    } catch (ignore) {
      updateSheet(null, {}, null);
    }
    status('Errore: ' + e.message);
    console.error(e);
  }

  function syncControls() {
    $('invertArea').disabled = !$('invert').checked;
    const sheet = !!activeSheet();
    $('stops').disabled = !sheet;
    const stopFields = sheet && $('stops').value !== 'none';
    for (const [id, , , , group] of E.PARAMS) if (group === 'stops') $(id).disabled = !stopFields;
    const file = $('scaleMode').value === 'file';
    $('aw').disabled = $('ah').disabled = file;
  }

  async function generate() {
    syncControls();
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
      setWarnings([]);
      showPlatePlan();
      updateSheet(null, s, activeSheet());
      status(V + ': carica un SVG. Il perimetro rosso indica il foglio e non viene esportato.');
      return;
    }
    const opts = options(s);
    if (opts.scaleMode === 'file' && !source.sizeKnown)
      return fail(Error('Il file SVG non indica dimensioni in mm, cm, in, pt o pc: usa «Da larghezza/altezza disegno».'));
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
    lastBuild = { s, bed: opts.bed };
    const H = r.heights;
    viewer.show(r.positive, 0xd4d8df, -s.w / 2 - 8);
    viewer.show(r.negative, 0x93bad8, s.w / 2 + 8);
    viewer.sheet(s, opts.sheet);
    viewer.thin(r.thin.positive, -s.w / 2 - 8, H.b + H.r + 0.06);
    viewer.thin(r.thin.negative, s.w / 2 + 8, H.b + 0.06);
    E.renderPlan($('plan'), { s, sheet: opts.sheet, plan: r.plan, thin: r.thin });
    updateSheet(r.plan.positive.relief, { ...s, r: H.r }, opts.sheet);
    if (sheetViewer) openSheet(); // la finestra aperta segue le modifiche
    if (!fitted) {
      viewer.fit();
      fitted = true;
    }
    setExports(true);
    const warnings = [...(source.warnings || []), ...r.warnings];
    if (opts.bed) {
      const place = E.export3mf.layout([s.w, s.h], opts.bed);
      if (!place.fits) warnings.push('Le due piastre non entrano insieme sul piano ' + opts.bed.w + ' × ' + opts.bed.h + ' mm: stampale separatamente.');
    }
    setWarnings(warnings);
    status(
      V + ': entrambe le mesh superano il controllo degli spigoli. Disegno ' + mm(r.size[0]) + ' × ' + mm(r.size[1]) + ' mm. ' +
        'Quote: piastra ' + mm(H.b) + ', rilievo ' + mm(H.r) + ', cavità ' + mm(r.depth) + ', perni ' + mm(H.ph) + ' mm' +
        (H.L ? ' (multipli del layer ' + mm(H.L) + ' mm)' : '') + '. Volumi ' + r.volumes[0].toFixed(1) + ' / ' + r.volumes[1].toFixed(1) +
        ' mm³. Rilievo: ' + (opts.invert ? 'vuoti, ' + $('invertArea').selectedOptions[0].textContent : 'pieni SVG') + '.' +
        (r.cut ? ' Disegno tagliato al perimetro del foglio.' : '') +
        (s.draft ? ' Pareti inclinate di ' + s.draft + '°.' : '') +
        ' Fori guida ' + (s.pin + 2 * s.pg).toFixed(2) + ' mm' + (s.holeFlare ? ', svasati di ' + s.holeFlare + ' mm alla base' : '') +
        (s.pinChamfer ? '; perni smussati di ' + s.pinChamfer + ' mm' : '') + '.' +
        (H.stopH ? ' Battute di riscontro ' + ({ bottom: 'agli angoli inferiori', corners: 'ai quattro angoli' }[opts.stops] || '') + ', alte ' + mm(H.stopH) + ' mm, sedi sulla negativa profonde ' + mm(H.recessDepth) + ' mm.' : ''),
    );
  }

  function saveFile(blob, name) {
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function download(n) {
    if (!models[n]) return;
    try {
      saveFile(new Blob([E.mesh.stl(models[n])], { type: 'model/stl' }), n ? 'embosser_negativo.stl' : 'embosser_positivo.stl');
    } catch (e) {
      fail(e);
    }
  }

  function download3mf() {
    if (!models.length || !lastBuild) return;
    try {
      const bed = lastBuild.bed || E.PRINTERS.a1.bed;
      const { blob } = E.export3mf.build3mf(
        [
          { name: 'Positiva', vertices: models[0] },
          { name: 'Negativa', vertices: models[1] },
        ],
        [lastBuild.s.w, lastBuild.s.h],
        bed,
      );
      saveFile(blob, 'embosser_matrici.3mf');
    } catch (e) {
      fail(e);
    }
  }

  function applyPrinterValues() {
    const printer = activePrinter();
    $('printerNote').textContent = printer.note || '';
    if (printer.values) for (const [id, value] of Object.entries(printer.values)) $(id).value = value;
    // I valori del materiale del preset (es. cartoncino della J card) prevalgono sul profilo stampante.
    const preset = E.PRESETS[$('preset').value] || {};
    if (preset.material) for (const [id, value] of Object.entries(preset.material)) $(id).value = value;
  }

  function applyPreset() {
    const p = E.PRESETS[$('preset').value];
    if (!p) return;
    $('presetNote').textContent = p.note || '';
    if (p.values) {
      for (const [id, value] of Object.entries(p.values)) $(id).value = value;
      if (p.align) $('align').value = p.align;
    }
    if (p.stops) $('stops').value = p.stops;
    applyPrinterValues(); // il profilo stampante ha la precedenza sui valori del preset
    fitted = false;
    save();
    generate();
  }

  function applyPrinter() {
    // Senza profilo: i valori impostati dal profilo A1 tornano a quelli del preset (o iniziali).
    if (!activePrinter().values) {
      const preset = E.PRESETS[$('preset').value].values || {};
      for (const [id, , value] of E.PARAMS) if (id in E.PRINTERS.a1.values) $(id).value = preset[id] ?? value;
    }
    applyPrinterValues();
    save();
    generate();
  }

  function resetDefaults() {
    try {
      localStorage.removeItem(STORE);
    } catch (ignore) {}
    for (const [id, , value] of E.PARAMS) $(id).value = value;
    $('printer').value = 'a1';
    $('scaleMode').value = 'fit';
    $('strokes').checked = $('mirror').checked = true;
    $('invert').checked = false;
    applyPreset();
  }

  async function loadFile(file) {
    if (!file) return;
    try {
      source = null;
      fitted = false;
      sourceText = await file.text();
      source = E.svg.parse(sourceText, { strokes: $('strokes').checked });
      generate();
    } catch (err) {
      fail(err);
    }
  }

  function reparse() {
    save();
    if (!sourceText) return generate();
    try {
      source = null;
      source = E.svg.parse(sourceText, { strokes: $('strokes').checked });
      generate();
    } catch (err) {
      fail(err);
    }
  }

  // Test integrato: interpretazione SVG nella pagina, geometria e mesh nel motore di calcolo.
  // Non modifica il disegno caricato né gli STL generati.
  async function regression() {
    status('Test integrato in corso…');
    setBusy(true);
    try {
      E.sheet.selfTest();
      const sources = E.svg.selfTest();
      const { count } = await engine.run('selftest', sources);
      status(
        'Test superato: ' + count + ' mesh controllate. Verificati fill-rule, stili CSS, stroke, dimensioni reali, defs inutilizzati, clipping, ' +
          'input Clipper, inversioni, centro decentrato, piastre R6, tacca specchiata, guide esterne, quote a layer, pareti inclinate, ' +
          'piano di stampa, dettagli sottili, battute di riscontro e simulazione del foglio. Disegno e parametri utente conservati.',
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
    const groups = { main: 'params', print: 'printParams', plate: 'plateParams', stops: 'stopParams' };
    for (const [id, title, value, step, group, flags] of E.PARAMS) {
      const label = document.createElement('label'),
        input = document.createElement('input');
      label.textContent = title;
      Object.assign(input, { type: 'number', id, value, step: String(step) });
      if (!(flags && flags.negative)) input.min = '0';
      label.append(input);
      $(groups[group]).append(label);
    }
    for (const [id, printer] of Object.entries(E.PRINTERS)) $('printer').append(new Option(printer.name, id));
    $('printer').value = 'a1';
    if (!window.ClipperLib || !window.THREE || !THREE.SVGLoader || !THREE.OrbitControls)
      throw Error('Dipendenza CDN non caricata: verificare connessione Internet o blocchi del browser verso cdn.jsdelivr.net.');
    viewer = E.createViewer($('view'));
    engine = E.createEngine('js/worker.js');
    window.embosser = { engine }; // diagnostica e test

    $('file').onchange = (e) => loadFile(e.target.files[0]);
    const drop = $('drop');
    for (const target of [drop, $('view')]) {
      target.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.classList.add('over');
      });
      target.addEventListener('dragleave', () => drop.classList.remove('over'));
      target.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('over');
        loadFile(e.dataTransfer.files[0]);
      });
    }
    const changed = () => {
      save();
      generate();
    };
    for (const [id] of E.PARAMS) $(id).onchange = changed;
    for (const id of ['align', 'mirror', 'invert', 'invertArea', 'scaleMode', 'stops']) $(id).onchange = changed;
    $('strokes').onchange = reparse;
    $('preset').onchange = applyPreset;
    $('printer').onchange = applyPrinter;
    $('reset').onclick = resetDefaults;
    $('fit').onclick = () => viewer.fit();
    $('test').onclick = regression;
    $('male').onclick = () => download(0);
    $('female').onclick = () => download(1);
    $('both').onclick = download3mf;
    $('sheet3d').onclick = openSheet;
    $('sheetClose').onclick = closeSheet;
    $('sheetDialog').addEventListener('close', () => {
      if (sheetViewer) sheetViewer.close();
      sheetViewer = null;
    });
    $('sheetFlip').onclick = () => sheetViewer && sheetViewer.flip();
    $('sheetFrame').onclick = () => sheetViewer && sheetViewer.frame();
    $('sheetExaggeration').onchange = () => sheetViewer && sheetViewer.exaggerate(Number($('sheetExaggeration').value));
    if (restore()) {
      $('presetNote').textContent = (E.PRESETS[$('preset').value] || {}).note || '';
      $('printerNote').textContent = activePrinter().note || '';
      generate();
    } else applyPreset();
  }

  try {
    start();
  } catch (e) {
    status('Avvio fallito: ' + e.message);
    console.error(e);
  }
})((self.Embosser = self.Embosser || {}));
