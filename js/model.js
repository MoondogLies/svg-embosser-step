// Modello delle matrici: posizionamento del disegno, controlli e generazione delle due mesh.
// Non usa il DOM, così può girare sia nella pagina sia nel worker.
//
// opts = { s: parametri numerici, align: 'center'|'top'|'bottom', invert: bool,
//          invertArea: 'contour'|'bounds', mirror: bool, sheet: {w,h} | null }
'use strict';
(function (E) {
  const S = E.S;
  const C = ClipperLib;
  const G = E.geometry;
  const { union, diff, intersect, rect, reflected, offset } = G;

  // Disegno scalato e posizionato in coordinate Clipper; restituisce anche se è stato tagliato al foglio.
  function artwork(source, opts) {
    const s = opts.s,
      d = source,
      sw = d.maxX - d.minX,
      sh = d.maxY - d.minY,
      k = opts.scaleMode === 'file' ? d.mmPerUnit : Math.min(s.aw / sw, s.ah > 0 ? s.ah / sh : Infinity),
      height = sh * k,
      sheet = opts.sheet || null;
    let cy = 0;
    const areaH = sheet ? sheet.h : s.h,
      margin = sheet ? 0 : 3;
    if (opts.align === 'top') cy = areaH / 2 - margin - height / 2;
    if (opts.align === 'bottom') cy = -areaH / 2 + margin + height / 2;
    const convert = (p) => ({ X: Math.round((p.x - d.minX - sw / 2) * k * S), Y: Math.round((-(p.y - d.minY - sh / 2) * k + cy) * S) });
    const regions = [];
    for (const a of d.result)
      regions.push(
        ...G.op(
          a.polys.map((poly) => poly.map(convert)),
          [],
          C.ClipType.ctUnion,
          a.rule === 'evenodd' ? C.PolyFillType.pftEvenOdd : C.PolyFillType.pftNonZero,
        ),
      );
    const filled = union(regions),
      selected = opts.invert ? G.invertArtwork(filled, opts.invertArea) : filled,
      clipped = G.clipToSheet(selected, sheet);
    if (!clipped.paths.length) throw Error('Nessuna area di rilievo rimane dentro il perimetro del foglio.');
    if (!(k > 0) || !Number.isFinite(k)) throw Error('Scala del disegno non valida.');
    clipped.size = [sw * k, sh * k];
    return clipped;
  }

  function validateSheet(s, sheet, pins, pockets) {
    if (!sheet) return;
    const region = [rect(0, 0, sheet.w, sheet.h)];
    if (s.w < sheet.w || s.h < sheet.h) throw Error('La piastra deve contenere il foglio ' + sheet.w + ' × ' + sheet.h + ' mm.');
    const innerEdge = s.w / 2 - 7 - (s.pin + 2 * s.pg) / 2;
    if (innerEdge <= sheet.w / 2)
      throw Error('Perni o fori troppo vicini al foglio: aumenta la larghezza della piastra o riduci le guide.');
    if (intersect([...pins, ...pockets], region).length) throw Error('Perni o fori entrano nel foglio.');
  }

  // Quote effettive: con altezza layer > 0 spessori e altezze diventano multipli del layer,
  // la profondità della cavità viene arrotondata per eccesso (mai meno gioco del richiesto).
  function heights(s) {
    const L = s.layer || 0;
    const snap = (x) => (L ? Math.max(L, Math.round(x / L - 1e-9) * L) : x);
    const snapUp = (x) => (L ? Math.max(L, Math.ceil(x / L - 1e-6) * L) : x);
    const fix = (x) => Math.round(x * 1e6) / 1e6;
    const b = fix(snap(s.b)),
      r = fix(snap(s.r)),
      ph = fix(snap(s.ph));
    return { L, b, r, ph, depth: fix(snapUp(r + s.paper + s.vertical)), dz: L || 0.1 };
  }

  // Parti di una regione più sottili di w (apertura morfologica), ignorando gli spigoli vivi.
  function thinParts(paths, w) {
    if (!w || !paths.length) return [];
    const opened = offset(offset(paths, -w / 2, 'round', 0.05), w / 2, 'round', 0.05);
    const minArea = 0.25 * w * w * S * S;
    return diff(paths, opened).filter((p) => Math.abs(C.Clipper.Area(p)) > minArea);
  }
  // Vuoti più stretti di w dentro una regione (chiusura morfologica).
  function narrowGaps(paths, w) {
    if (!w || !paths.length) return [];
    const closed = offset(offset(paths, w / 2, 'round', 0.05), -w / 2, 'round', 0.05);
    const minArea = 0.25 * w * w * S * S;
    return diff(closed, paths).filter((p) => Math.abs(C.Clipper.Area(p)) > minArea);
  }

  // Genera positiva e negativa come elenchi di vertici [x,y,z] (tre per triangolo).
  function build(source, opts) {
    const s = opts.s,
      H = heights(s),
      t = Math.tan(((s.draft || 0) * Math.PI) / 180),
      plate = G.plateShape(s),
      mirrored = !!opts.mirror,
      negativePlate = mirrored ? reflected(plate) : plate,
      placed = artwork(source, opts),
      art = placed.paths,
      px = s.w / 2 - 7,
      warnings = [];
    if (!((s.draft || 0) >= 0 && (s.draft || 0) < 60)) throw Error('L’inclinazione delle pareti deve essere tra 0° e 60°.');
    if (H.L && (H.L < 0.04 || H.L > 0.4)) throw Error('Altezza layer fuori intervallo: usa 0 oppure un valore tra 0,04 e 0,4 mm.');
    if (px - s.pin / 2 <= 0 || s.pin + 2 * s.pg >= s.h - 4) throw Error('Perni troppo grandi.');
    if (s.pinChamfer >= H.ph || s.pinChamfer >= s.pin / 2) throw Error('Smusso dei perni troppo grande rispetto a lato e altezza dei perni.');
    if (opts.bed && (s.w > opts.bed.w || s.h > opts.bed.h))
      throw Error('La piastra ' + s.w + ' × ' + s.h + ' mm non entra nel piano di stampa ' + opts.bed.w + ' × ' + opts.bed.h + ' mm.');
    const pins = union([-1, 1].map((v) => rect(v * px, 0, s.pin, s.pin))),
      pockets = union([-1, 1].map((v) => rect(v * px, 0, s.pin + 2 * s.pg, s.pin + 2 * s.pg))),
      flared = s.holeFlare > 0 ? offset(pockets, s.holeFlare) : pockets,
      safe = offset(plate, -2),
      negativeSafe = mirrored ? reflected(safe) : safe;
    validateSheet(s, opts.sheet, pins, flared);
    if (diff(flared, plate).length || diff(pins, negativePlate).length) throw Error('Guide fuori dalla piastra arrotondata o nella tacca.');
    if (diff(art, safe).length || intersect(art, flared).length)
      throw Error('Ridimensionare il disegno: supera margini, angoli arrotondati, tacca o guide.');
    const mirror = (paths) => (mirrored ? reflected(paths) : paths);
    const cavity = mirror(offset(art, s.lateral));
    if (diff(cavity, negativeSafe).length || intersect(cavity, pins).length)
      throw Error('Cavità oltre margini, angoli arrotondati, tacca o guide.');
    const depth = H.depth;
    if (depth >= H.b - 0.4) throw Error('Aumentare lo spessore piastra: cavità ' + depth.toFixed(2) + ' mm più almeno 0,4 mm di fondo.');

    // Positiva: base (con svasatura dei fori nei primi due layer) e rilievo, a gradini se le pareti sono inclinate.
    const positiveLayers = [];
    const flareH = Math.min(2 * H.dz, H.b / 2);
    if (s.holeFlare > 0) positiveLayers.push({ z0: 0, z1: flareH, paths: diff(plate, flared) });
    positiveLayers.push({ z0: s.holeFlare > 0 ? flareH : 0, z1: H.b, paths: diff(plate, pockets) });
    const reliefSteps = t > 0 ? Math.max(1, Math.round(H.r / H.dz)) : 1;
    for (let i = 0; i < reliefSteps; i++) {
      const z0 = H.b + (i * H.r) / reliefSteps,
        paths = i ? offset(art, -t * ((i * H.r) / reliefSteps), 'round', 0.05) : art;
      if (!paths.length) break;
      positiveLayers.push({ z0, z1: H.b + ((i + 1) * H.r) / reliefSteps, paths });
    }
    // Unisce i gradini che hanno perso l'ultimo strato in altezza.
    positiveLayers[positiveLayers.length - 1].z1 = Math.max(positiveLayers[positiveLayers.length - 1].z1, H.b + H.r);

    // Negativa: fondo, cavità (più stretta in profondità se le pareti sono inclinate), perni con punta smussata.
    const negativeLayers = [{ z0: 0, z1: H.b - depth, paths: negativePlate }];
    const cavitySteps = t > 0 ? Math.max(1, Math.round(depth / H.dz)) : 1;
    let lastDelta = null;
    for (let k = 0; k < cavitySteps; k++) {
      const z0 = H.b - depth + (k * depth) / cavitySteps,
        z1 = H.b - depth + ((k + 1) * depth) / cavitySteps,
        last = k === cavitySteps - 1,
        delta = last ? s.lateral : s.lateral - t * Math.min(H.b - z1, H.r);
      // Sotto la punta del rilievo il contorno non cambia: si allunga lo strato precedente.
      if (!last && lastDelta !== null && Math.abs(delta - lastDelta) < 1e-9) {
        negativeLayers[negativeLayers.length - 1].z1 = z1;
        continue;
      }
      lastDelta = delta;
      const hole = last ? cavity : mirror(offset(art, delta, 'round', 0.05));
      negativeLayers.push({ z0, z1, paths: diff(negativePlate, hole) });
    }
    const c = s.pinChamfer || 0,
      chamferSteps = c > 0 ? Math.max(1, Math.round(c / H.dz)) : 0;
    negativeLayers.push({ z0: H.b, z1: H.b + H.ph - c, paths: pins });
    for (let j = 1; j <= chamferSteps; j++)
      negativeLayers.push({
        z0: H.b + H.ph - c + ((j - 1) * c) / chamferSteps,
        z1: H.b + H.ph - c + (j * c) / chamferSteps,
        paths: offset(pins, (-j * c) / chamferSteps),
      });

    const positive = E.mesh.mesh(positiveLayers);
    const negative = E.mesh.mesh(negativeLayers);

    // Avvisi di stampabilità (non bloccanti).
    const thin = { positive: [], negative: [] };
    const w = s.minFeature || 0;
    if (w) {
      // Controllo alla base del rilievo: con le pareti inclinate la sommità è ancora più stretta.
      const ridges = thinParts(art, w),
        gaps = narrowGaps(art, w),
        islands = thinParts(diff(negativePlate, cavity), w);
      thin.positive.push(...ridges, ...gaps);
      thin.negative.push(...islands);
      const mm2 = (paths) => (paths.reduce((n, p) => n + Math.abs(C.Clipper.Area(p)), 0) / S / S).toFixed(1);
      if (ridges.length) warnings.push(ridges.length + ' zone del rilievo più sottili di ' + w + ' mm (' + mm2(ridges) + ' mm²): potrebbero non stamparsi o rompersi.');
      if (gaps.length) warnings.push(gaps.length + ' fessure del rilievo più strette di ' + w + ' mm (' + mm2(gaps) + ' mm²): potrebbero chiudersi in stampa.');
      if (islands.length) warnings.push(islands.length + ' isole della negativa più sottili di ' + w + ' mm (' + mm2(islands) + ' mm²).');
    }
    if (s.lateral < s.paper) warnings.push('Gioco laterale minore dello spessore carta: la carta potrebbe tagliarsi sui bordi della cavità.');
    if (H.L && Math.abs(H.r - s.r) > 1e-6) warnings.push('Altezza rilievo arrotondata a ' + H.r.toFixed(2) + ' mm (multiplo del layer).');
    if (H.L && Math.abs(H.b - s.b) > 1e-6) warnings.push('Spessore piastra arrotondato a ' + H.b.toFixed(2) + ' mm.');
    if (H.L && Math.abs(H.ph - s.ph) > 1e-6) warnings.push('Altezza perni arrotondata a ' + H.ph.toFixed(2) + ' mm.');
    return { positive, negative, depth, heights: H, art, pins, pockets, cut: placed.cut, size: placed.size, warnings, thin };
  }

  // Test geometrici e di mesh. sources: { frame, full } già interpretati dalla pagina (il parsing SVG richiede il DOM).
  function selfTest(sources) {
    const { same, oriented, invertArtwork, clipToSheet } = G;
    const check = E.mesh.check;
    const card = E.PRESETS.businessCard,
      sheet = card.sheet,
      region = [rect(0, 0, sheet.w, sheet.h)];
    const modes = { original: { invert: false }, contour: { invert: true, invertArea: 'contour' }, bounds: { invert: true, invertArea: 'bounds' } };
    const opts = (s, mode, extra) => ({ s, align: 'center', mirror: true, sheet: null, ...modes[mode], ...extra });
    let count = 0;
    const base = { ...card.values, w: 100, h: 70, aw: 60, ah: 0 };
    for (const m of Object.keys(modes))
      for (const aw of [45, 60])
        for (const lateral of [0, 0.15]) {
          const r = build(sources.frame, opts({ ...base, aw, lateral }, m));
          check(r.positive, 'Cornice positiva ' + m);
          check(r.negative, 'Cornice negativa ' + m);
          count += 2;
        }
    const ring = union([oriented(rect(0, 0, 20, 20), true), oriented(rect(1, -1, 8, 8), false)]),
      expected = union([rect(1, -1, 8, 8)]);
    for (const m of ['contour', 'bounds']) if (!same(invertArtwork(ring, m), expected)) throw Error('Centro decentrato non conservato.');
    const triangle = union([[{ X: 0, Y: 0 }, { X: 100000, Y: 0 }, { X: 0, Y: 100000 }]]);
    let rejected = false;
    try {
      invertArtwork(triangle, 'contour');
    } catch (e) {
      rejected = e.message.startsWith('Inversione senza aree');
    }
    if (!rejected || !same(invertArtwork(triangle, 'bounds'), diff([rect(5, 5, 10, 10)], triangle)))
      throw Error('Differenza contorno/rettangolo errata.');
    const wide = [rect(0, 0, 200, 80)],
      clipped = clipToSheet(wide, sheet);
    if (!clipped.cut || !same(clipped.paths, region)) throw Error('Clipping rettangolo grande errato.');
    const inside = [rect(0, 0, 20, 10)],
      unchanged = clipToSheet(inside, sheet);
    if (unchanged.cut || !same(unchanged.paths, inside) || clipToSheet([rect(200, 0, 10, 10)], sheet).paths.length)
      throw Error('Clipping interno/esterno errato.');
    let malformedRejected = false;
    try {
      intersect(wide, region[0]);
    } catch (e) {
      malformedRejected = e.message.includes('[contorno]');
    }
    if (!malformedRejected) throw Error('Input Clipper malformato non rilevato.');
    for (const m of Object.keys(modes))
      for (const aw of [85, 140])
        for (const lateral of [0, 0.15]) {
          const r = build(sources.frame, opts({ ...card.values, aw, lateral }, m, { sheet }));
          check(r.positive, 'Preset positiva ' + m);
          check(r.negative, 'Preset negativa ' + m);
          if (diff(r.art, region).length || intersect([...r.pins, ...r.pockets], region).length)
            throw Error('Rilievo o guide fuori posizione.');
          count += 2;
        }
    const full = build(sources.full, opts({ ...card.values, aw: 200, ah: 0 }, 'original', { sheet }));
    if (!same(full.art, region) || !full.cut) throw Error('Clipping SVG completo errato.');
    check(full.positive, 'SVG grande positiva');
    check(full.negative, 'SVG grande negativa');
    count += 2;
    for (const mirror of [false, true]) {
      const r = build(sources.full, opts({ ...card.values, aw: 200, ah: 0 }, 'original', { sheet, mirror }));
      check(r.positive, 'Guide R6 positiva');
      check(r.negative, 'Guide R6 negativa');
      count += 2;
      const p = G.plateShape(card.values),
        q = mirror ? reflected(p) : p;
      if (diff(region, p).length || diff(region, q).length) throw Error('Foglio interferisce con angoli o tacca.');
      if (mirror && !same(reflected(q), p)) throw Error('Riferimenti non accoppiati.');
    }
    for (const profile of [{}, E.PRINTERS.a1.values]) {
      const r = build(sources.aligned, opts({ ...card.values, aw: 80, ...profile }, 'original', { sheet }));
      check(r.positive, 'Contorni allineati positiva');
      check(r.negative, 'Contorni allineati negativa');
      count += 2;
    }
    // Profilo stampante A1: quote a layer, pareti inclinate, perni smussati, fori svasati.
    const a1 = { ...card.values, ...E.PRINTERS.a1.values },
      bed = E.PRINTERS.a1.bed;
    const H = heights(a1);
    const multiple = (x) => Math.abs(x / H.L - Math.round(x / H.L)) < 1e-6;
    if (!multiple(H.b) || !multiple(H.r) || !multiple(H.ph) || !multiple(H.depth) || H.depth < a1.r + a1.paper + a1.vertical - 1e-9)
      throw Error('Quote non allineate ai layer o cavità ridotta.');
    for (const m of ['original', 'contour']) {
      const r = build(sources.frame, opts({ ...a1, aw: 60 }, m, { sheet, bed }));
      const straight = build(sources.frame, opts({ ...a1, aw: 60, draft: 0, pinChamfer: 0, holeFlare: 0 }, m, { sheet, bed }));
      const vp = check(r.positive, 'A1 positiva ' + m),
        vn = check(r.negative, 'A1 negativa ' + m),
        sp = check(straight.positive, 'A1 positiva dritta ' + m),
        sn = check(straight.negative, 'A1 negativa dritta ' + m);
      // Pareti inclinate: meno rilievo e cavità più piccola in profondità (più materiale nella negativa).
      if (!(vp < sp) || !(vn > sn)) throw Error('Inclinazione delle pareti non applicata (' + m + ').');
      count += 4;
    }
    let bedRefused = false;
    try {
      build(sources.frame, opts({ ...a1, w: 300 }, 'original', { bed }));
    } catch (e) {
      bedRefused = /piano di stampa/.test(e.message);
    }
    if (!bedRefused) throw Error('Piastra oltre il piano non rifiutata.');
    const bar = union([rect(0, 0, 10, 0.5), rect(0, 6, 10, 10)]),
      split = union([rect(-5.2, 0, 10, 10), rect(5.2, 0, 10, 10)]);
    if (!thinParts(bar, 0.84).length || thinParts([rect(0, 0, 10, 10)], 0.84).length) throw Error('Controllo dettagli sottili errato.');
    if (!narrowGaps(split, 0.84).length || narrowGaps([rect(0, 0, 10, 10)], 0.84).length) throw Error('Controllo fessure strette errato.');
    return { count };
  }

  E.model = { artwork, build, heights, thinParts, narrowGaps, selfTest };

  // Compiti eseguibili nel worker o, in mancanza, nella pagina. I risultati sono clonabili.
  E.tasks = {
    build({ source, opts }) {
      const r = build(source, opts);
      const volumes = [E.mesh.check(r.positive, 'Positiva'), E.mesh.check(r.negative, 'Negativa')];
      const loops = (paths) => paths.map((p) => p.flatMap((q) => [q.X / S, q.Y / S]));
      return {
        positive: E.mesh.flatten(r.positive),
        negative: E.mesh.flatten(r.negative),
        depth: r.depth,
        heights: r.heights,
        volumes,
        cut: r.cut,
        size: r.size,
        warnings: r.warnings,
        thin: { positive: loops(r.thin.positive), negative: loops(r.thin.negative) },
      };
    },
    selftest: (sources) => selfTest(sources),
  };
})((self.Embosser = self.Embosser || {}));
