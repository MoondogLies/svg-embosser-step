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
      k = Math.min(s.aw / sw, s.ah > 0 ? s.ah / sh : Infinity),
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

  // Genera positiva e negativa come elenchi di vertici [x,y,z] (tre per triangolo).
  function build(source, opts) {
    const s = opts.s,
      plate = G.plateShape(s),
      mirrored = !!opts.mirror,
      negativePlate = mirrored ? reflected(plate) : plate,
      placed = artwork(source, opts),
      art = placed.paths,
      px = s.w / 2 - 7;
    if (px - s.pin / 2 <= 0 || s.pin + 2 * s.pg >= s.h - 4) throw Error('Perni troppo grandi.');
    const pins = union([-1, 1].map((v) => rect(v * px, 0, s.pin, s.pin))),
      pockets = union([-1, 1].map((v) => rect(v * px, 0, s.pin + 2 * s.pg, s.pin + 2 * s.pg))),
      safe = offset(plate, -2),
      negativeSafe = mirrored ? reflected(safe) : safe;
    validateSheet(s, opts.sheet, pins, pockets);
    if (diff(pockets, plate).length || diff(pins, negativePlate).length) throw Error('Guide fuori dalla piastra arrotondata o nella tacca.');
    if (diff(art, safe).length || intersect(art, pockets).length)
      throw Error('Ridimensionare il disegno: supera margini, angoli arrotondati, tacca o guide.');
    let cavity = offset(art, s.lateral);
    if (mirrored) cavity = reflected(cavity);
    if (diff(cavity, negativeSafe).length || intersect(cavity, pins).length)
      throw Error('Cavità oltre margini, angoli arrotondati, tacca o guide.');
    const depth = s.r + s.paper + s.vertical;
    if (depth >= s.b - 0.4) throw Error('Aumentare lo spessore piastra: cavità ' + depth.toFixed(2) + ' mm più almeno 0,4 mm di fondo.');
    const positive = E.mesh.mesh([
      { z0: 0, z1: s.b, paths: diff(plate, pockets) },
      { z0: s.b, z1: s.b + s.r, paths: art },
    ]);
    const negative = E.mesh.mesh([
      { z0: 0, z1: s.b - depth, paths: negativePlate },
      { z0: s.b - depth, z1: s.b, paths: diff(negativePlate, cavity) },
      { z0: s.b, z1: s.b + s.ph, paths: pins },
    ]);
    return { positive, negative, depth, art, pins, pockets, cut: placed.cut };
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
    return { count };
  }

  E.model = { artwork, build, selfTest };

  // Compiti eseguibili nel worker o, in mancanza, nella pagina. I risultati sono clonabili.
  E.tasks = {
    build({ source, opts }) {
      const r = build(source, opts);
      const volumes = [E.mesh.check(r.positive, 'Positiva'), E.mesh.check(r.negative, 'Negativa')];
      return { positive: E.mesh.flatten(r.positive), negative: E.mesh.flatten(r.negative), depth: r.depth, volumes, cut: r.cut };
    },
    selftest: (sources) => selfTest(sources),
  };
})((self.Embosser = self.Embosser || {}));
