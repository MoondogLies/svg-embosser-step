// Interfaccia: campi, preset, profilo stampante, generazione tramite il motore di calcolo, anteprima ed export.
'use strict';
(function (E) {
  const $ = (id) => document.getElementById(id);
  const V = E.VERSION;
  const STORE = 'embosser-settings-v1';
  const USER_PRESETS = 'embosser-user-presets-v1';
  const CHECKS = ['invert', 'mirror', 'strokes'];
  const SELECTS = ['preset', 'printer', 'nozzle', 'material', 'scaleMode', 'align', 'invertArea', 'stops', 'hinge'];
  const PIN_FIELDS = ['pin', 'ph', 'pg', 'pinInset', 'pinY', 'pinChamfer', 'holeFlare'];

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

  // Foglio del preset; con «Personalizzato» quello indicato nei campi larghezza/altezza foglio (se entrambi > 0).
  const activeSheet = () => {
    const id = $('preset').value,
      p = E.PRESETS[id];
    if (id === 'custom') {
      const w = Number($('sheetW').value),
        h = Number($('sheetH').value);
      return w > 0 && h > 0 ? { w, h } : null;
    }
    return (p && p.sheet) || null;
  };
  const activeNozzle = () => Number($('nozzle').value) || 0.4;
  // Battute solo se il preset definisce un foglio.
  const activeStops = () => (activeSheet() ? $('stops').value : 'none');
  const activePrinter = () => E.PRINTERS[$('printer').value] || E.PRINTERS.none;
  // Lato della cerniera print-in-place, oppure null con le piastre separate.
  const activeHinge = () => ($('hinge').value === 'right' || $('hinge').value === 'bottom' ? $('hinge').value : null);
  // Disposizione della cerniera per l'anteprima senza disegno (null se i parametri non la permettono).
  const hingePreview = (s) => {
    const side = activeHinge();
    if (!side) return null;
    try {
      return E.hinge.layout(s, E.model.heights(s).b, side);
    } catch (ignore) {
      return null;
    }
  };
  const fieldName = (id) => {
    const d = E.PARAMS.find((x) => x[0] === id);
    return d ? '«' + d[1] + '»' : id;
  };
  const status = (text) => ($('status').textContent = text);
  const setWarnings = (list) => {
    $('warnings').replaceChildren(...list.map((w) => Object.assign(document.createElement('li'), { textContent: w })));
  };
  const setExports = (enabled) => {
    for (const id of ['male', 'female', 'both', 'hingeStl']) $(id).disabled = !enabled;
  };
  const setBusy = (busy) => {
    $('view').setAttribute('aria-busy', busy ? 'true' : 'false');
    $('test').disabled = busy;
  };
  const mm = (x) => x.toFixed(2).replace(/\.?0+$/, '');

  // Istantanea di tutte le impostazioni (per il salvataggio automatico e per i preset personali).
  function snapshot() {
    const data = { values: {}, checks: {}, selects: {} };
    for (const [id] of E.PARAMS) data.values[id] = $(id).value;
    for (const id of CHECKS) data.checks[id] = $(id).checked;
    for (const id of SELECTS) data.selects[id] = $(id).value;
    return data;
  }
  // Applica un'istantanea ignorando campi sconosciuti o valori non numerici.
  function applySnapshot(data) {
    if (!data || typeof data !== 'object' || !data.values || typeof data.values !== 'object') return false;
    for (const [id] of E.PARAMS) {
      const v = data.values[id];
      if (v !== undefined && v !== null && String(v).trim() !== '' && Number.isFinite(Number(v))) $(id).value = String(Number(v));
    }
    for (const id of CHECKS) if (typeof (data.checks || {})[id] === 'boolean') $(id).checked = data.checks[id];
    for (const id of SELECTS) {
      const v = (data.selects || {})[id];
      if (typeof v === 'string' && [...$(id).options].some((o) => o.value === v)) $(id).value = v;
    }
    refreshNotes();
    return true;
  }
  // Impostazioni salvate nel browser (localStorage può mancare: modalità privata, file://, blocchi).
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(snapshot()));
    } catch (ignore) {}
  }
  function restore() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(STORE) || 'null');
    } catch (ignore) {}
    return applySnapshot(data);
  }

  function refreshNotes() {
    $('presetNote').textContent = (E.PRESETS[$('preset').value] || {}).note || '';
    const printer = activePrinter();
    $('printerNote').textContent = printer.note ? printer.note(activeNozzle()) : '';
  }

  // ---- Preset personali: salvati nel browser, esportabili e importabili come file JSON. ----
  function userPresets() {
    try {
      const data = JSON.parse(localStorage.getItem(USER_PRESETS) || '{}');
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (ignore) {
      return {};
    }
  }
  function storeUserPresets(all) {
    try {
      localStorage.setItem(USER_PRESETS, JSON.stringify(all));
      return true;
    } catch (ignore) {
      return false;
    }
  }
  function listUserPresets(selected) {
    const names = Object.keys(userPresets()).sort((a, b) => a.localeCompare(b, 'it'));
    $('myPresets').replaceChildren(...names.map((n) => new Option(n, n)));
    if (selected && names.includes(selected)) $('myPresets').value = selected;
    for (const id of ['loadPreset', 'deletePreset']) $(id).disabled = !names.length;
    $('exportPresets').disabled = !names.length;
  }
  function presetMessage(text) {
    $('myPresetsNote').textContent = text;
  }
  function saveUserPreset() {
    const name = $('myPresetName').value.trim().slice(0, 60);
    if (!name) return presetMessage('Scrivi un nome per il preset.');
    const all = userPresets(),
      existed = name in all;
    all[name] = snapshot();
    if (!storeUserPresets(all)) return presetMessage('Impossibile salvare: il browser blocca l’archiviazione locale.');
    listUserPresets(name);
    presetMessage((existed ? 'Preset «' + name + '» aggiornato' : 'Preset «' + name + '» salvato') + ' in questo browser.');
  }
  function loadUserPreset() {
    const name = $('myPresets').value,
      data = userPresets()[name];
    if (!data || !applySnapshot(data)) return presetMessage('Preset non valido.');
    $('myPresetName').value = name;
    fitted = false;
    save();
    presetMessage('Preset «' + name + '» caricato.');
    if (sourceText) reparse();
    else generate();
  }
  function deleteUserPreset() {
    const name = $('myPresets').value,
      all = userPresets();
    if (!(name in all)) return;
    delete all[name];
    storeUserPresets(all);
    listUserPresets();
    presetMessage('Preset «' + name + '» eliminato.');
  }
  function exportUserPresets() {
    const all = userPresets();
    saveFile(new Blob([JSON.stringify({ app: 'svg-embosser', version: 1, presets: all }, null, 2)], { type: 'application/json' }), 'embosser_preset.json');
  }
  async function importUserPresets(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()),
        incoming = data && data.presets;
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw Error('formato non riconosciuto');
      const all = userPresets();
      let count = 0;
      for (const [name, preset] of Object.entries(incoming))
        if (preset && typeof preset === 'object' && preset.values && typeof preset.values === 'object') {
          all[String(name).slice(0, 60)] = preset;
          count++;
        }
      if (!count) throw Error('nessun preset valido');
      storeUserPresets(all);
      listUserPresets();
      presetMessage(count + ' preset importati.');
    } catch (e) {
      presetMessage('Importazione non riuscita: ' + e.message + '.');
    } finally {
      $('importPresets').value = '';
    }
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
    hinge: activeHinge(),
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
        const s = settings();
        viewer.setLayout(s, hingePreview(s));
        viewer.sheet(s, activeSheet());
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
    $('nozzle').disabled = !activePrinter().valuesFor;
    $('sheetW').disabled = $('sheetH').disabled = $('preset').value !== 'custom';
    const sheet = !!activeSheet();
    $('stops').disabled = !sheet;
    const stopFields = sheet && $('stops').value !== 'none';
    for (const [id, , , , group] of E.PARAMS) if (group === 'stops') $(id).disabled = !stopFields;
    const file = $('scaleMode').value === 'file';
    $('aw').disabled = $('ah').disabled = file;
    // Cerniera: niente perni, negativa sempre specchiata, un unico file da esportare.
    const hinge = !!activeHinge();
    for (const id of PIN_FIELDS) $(id).disabled = hinge;
    for (const [id, , , , group] of E.PARAMS) if (group === 'hinge') $(id).disabled = !hinge;
    if (hinge) $('mirror').checked = true;
    $('mirror').disabled = hinge;
    $('male').hidden = $('female').hidden = hinge;
    $('hingeStl').hidden = $('foldBox').hidden = !hinge;
    $('both').textContent = hinge ? 'Esporta 3MF (piastre con cerniera)' : 'Esporta 3MF (entrambe sul piano)';
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
      viewer.setLayout(s, hingePreview(s));
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
    lastBuild = { s, bed: opts.bed, hinge: r.hinge };
    const H = r.heights;
    viewer.setLayout(s, r.hinge);
    viewer.show(r.positive, 0xd4d8df, 'positive');
    viewer.show(r.negative, 0x93bad8, 'negative');
    viewer.sheet(s, opts.sheet);
    viewer.thin(r.thin.positive, 'positive', H.b + H.r + 0.06);
    viewer.thin(r.thin.negative, 'negative', H.b + 0.06);
    E.renderPlan($('plan'), { s, sheet: opts.sheet, plan: r.plan, thin: r.thin });
    updateSheet(r.plan.positive.relief, { ...s, r: H.r }, opts.sheet);
    if (sheetViewer) openSheet(); // la finestra aperta segue le modifiche
    if (!fitted) {
      viewer.fit();
      fitted = true;
    }
    setExports(true);
    const warnings = [...(source.warnings || []), ...r.warnings];
    if (opts.bed && !r.hinge) {
      const place = E.export3mf.layout([s.w, s.h], opts.bed);
      if (!place.fits) warnings.push('Le due piastre non entrano insieme sul piano ' + opts.bed.w + ' × ' + opts.bed.h + ' mm: stampale separatamente.');
    }
    setWarnings(warnings);
    const hi = r.hinge,
      comma = (x) => mm(x).replace('.', ',');
    status(
      V + ': entrambe le mesh superano il controllo degli spigoli.' +
        (hi
          ? ' Piastre unite da cerniera print-in-place sul lato ' + (hi.side === 'bottom' ? 'inferiore' : 'destro') + ': ' + hi.n + ' nodi da ' + comma(hi.seg) +
            ' mm, asse a ' + comma(hi.zh) + ' mm dal piano, nodi Ø ' + comma(hi.knuckleD) + ' mm, perno Ø ' + comma(hi.pinD) + ' mm in foro Ø ' + comma(hi.boreD) +
            ' mm; nessuna interferenza da 0° a 180°. Ingombro ' + comma(hi.footprint[0]) + ' × ' + comma(hi.footprint[1]) + ' mm. ' +
            'Stampa così com’è, senza supporti, poi sblocca la cerniera ruotandola con delicatezza. A cerniera chiusa le facce restano distanti quanto lo spessore carta.'
          : '') +
        ' Materiale: Materiale: ' + $('material').selectedOptions[0].textContent +
        (activePrinter().valuesFor ? '; ugello ' + String(activeNozzle()).replace('.', ',') + ' mm' : '') + '. Disegno ' + mm(r.size[0]) + ' × ' + mm(r.size[1]) + ' mm. ' +
        'Quote: piastra ' + mm(H.b) + ', rilievo ' + mm(H.r) + ', cavità ' + mm(r.depth) + ', perni ' + mm(H.ph) + ' mm' +
        (H.L ? ' (multipli del layer ' + mm(H.L) + ' mm)' : '') + '. Volumi ' + r.volumes[0].toFixed(1) + ' / ' + r.volumes[1].toFixed(1) +
        ' mm³. Rilievo: ' + (opts.invert ? 'vuoti, ' + $('invertArea').selectedOptions[0].textContent : 'pieni SVG') + '.' +
        (r.cut ? ' Disegno tagliato al perimetro del foglio.' : '') +
        (s.draft ? ' Pareti inclinate di ' + s.draft + '°.' : '') +
        (hi
          ? ''
          : ' Fori guida ' + (s.pin + 2 * s.pg).toFixed(2) + ' mm' + (s.holeFlare ? ', svasati di ' + s.holeFlare + ' mm alla base' : '') +
            (s.pinChamfer ? '; perni smussati di ' + s.pinChamfer + ' mm' : '') + '.') +
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

  // Positiva e negativa con la cerniera: un unico STL con due corpi chiusi, già incastrati.
  const joined = () => {
    const out = new Float32Array(models[0].length + models[1].length);
    out.set(models[0]);
    out.set(models[1], models[0].length);
    return out;
  };
  function downloadHinge() {
    if (models.length < 2 || !lastBuild || !lastBuild.hinge) return;
    try {
      saveFile(new Blob([E.mesh.stl(joined())], { type: 'model/stl' }), 'embosser_cerniera.stl');
    } catch (e) {
      fail(e);
    }
  }

  function download3mf() {
    if (!models.length || !lastBuild) return;
    try {
      const bed = lastBuild.bed || E.PRINTERS.a1.bed;
      if (lastBuild.hinge) {
        const { blob } = E.export3mf.build3mf([{ name: 'Piastre con cerniera', vertices: joined() }], lastBuild.hinge.footprint, bed, true);
        saveFile(blob, 'embosser_cerniera.3mf');
        return;
      }
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

  // Valori consigliati per carta e stampa (rilievo, giochi, inclinazione) dal materiale scelto.
  function applyMaterialValues() {
    const layer = activePrinter().valuesFor ? Number($('layer').value) || 0 : 0;
    const values = E.materialValues($('material').value, Number($('paper').value), layer, activeNozzle());
    for (const [id, value] of Object.entries(values)) $(id).value = value;
  }

  // Ordine di precedenza: preset → profilo stampante (ugello) → materiale.
  function applyPrinterValues() {
    const printer = activePrinter();
    if (printer.valuesFor) for (const [id, value] of Object.entries(printer.valuesFor(activeNozzle()))) $(id).value = value;
    applyMaterialValues();
    refreshNotes();
  }

  function applyPreset() {
    const p = E.PRESETS[$('preset').value];
    if (!p) return;
    if (p.values) {
      for (const [id, value] of Object.entries(p.values)) $(id).value = value;
      if (p.align) $('align').value = p.align;
    }
    if (p.stops) $('stops').value = p.stops;
    if (p.defaultMaterial) $('material').value = p.defaultMaterial;
    applyPrinterValues();
    fitted = false;
    save();
    generate();
  }

  function applyPrinter() {
    // Senza profilo: i valori di stampa tornano a quelli del preset (o iniziali).
    if (!activePrinter().valuesFor) {
      const preset = E.PRESETS[$('preset').value].values || {};
      for (const [id, , value] of E.PARAMS) if (id in E.PRINTERS.a1.values) $(id).value = preset[id] ?? value;
    }
    applyPrinterValues();
    save();
    generate();
  }

  function applyMaterial() {
    applyMaterialValues();
    save();
    generate();
  }

  function resetDefaults() {
    try {
      localStorage.removeItem(STORE);
    } catch (ignore) {}
    for (const [id, , value] of E.PARAMS) $(id).value = value;
    $('printer').value = 'a1';
    $('nozzle').value = '0.4';
    $('material').value = 'card300';
    $('scaleMode').value = 'fit';
    $('hinge').value = 'pins';
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
          'piano di stampa, dettagli sottili, battute di riscontro, zone tangenti, cerniera print-in-place e simulazione del foglio. Disegno e parametri utente conservati.',
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
    const groups = { main: 'params', print: 'printParams', plate: 'plateParams', stops: 'stopParams', hinge: 'hingeParams' };
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
    for (const n of E.PRINTERS.a1.nozzles) $('nozzle').append(new Option(String(n).replace('.', ',') + ' mm', String(n)));
    $('nozzle').value = '0.4';
    for (const [id, m] of Object.entries(E.MATERIALS)) $('material').append(new Option(m.name, id));
    $('material').value = 'card300';
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
    // Con «Spessore misurato» i valori consigliati seguono lo spessore inserito.
    $('paper').onchange = () => {
      if ($('material').value === 'measured') applyMaterialValues();
      changed();
    };
    $('nozzle').onchange = applyPrinter;
    $('material').onchange = applyMaterial;
    $('savePreset').onclick = saveUserPreset;
    $('loadPreset').onclick = loadUserPreset;
    $('deletePreset').onclick = deleteUserPreset;
    $('exportPresets').onclick = exportUserPresets;
    $('importPresets').onchange = (e) => importUserPresets(e.target.files[0]);
    listUserPresets();
    for (const id of ['align', 'mirror', 'invert', 'invertArea', 'scaleMode', 'stops']) $(id).onchange = changed;
    $('hinge').onchange = () => {
      fitted = false;
      changed();
    };
    $('fold').oninput = () => {
      $('foldValue').textContent = $('fold').value + '°';
      viewer.fold(Number($('fold').value));
    };
    $('hingeStl').onclick = downloadHinge;
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
    if (restore()) generate();
    else applyPreset();
  }

  try {
    start();
  } catch (e) {
    status('Avvio fallito: ' + e.message);
    console.error(e);
  }
})((self.Embosser = self.Embosser || {}));
