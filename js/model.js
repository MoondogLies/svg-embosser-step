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
      margin = sheet ? 0 : G.plateGeometry(s).margin + 1;
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
    const innerEdge = s.w / 2 - G.plateGeometry(s).pinInset - (s.pin + 2 * s.pg) / 2 - (s.holeFlare || 0);
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

  // Battute di riscontro a «L» appena fuori dagli angoli del foglio.
  // mode: 'bottom' (due angoli inferiori) o 'corners' (quattro angoli); ogni L ha un braccio lungo ciascun lato.
  function stopShapes(sheet, s, mode) {
    if (!sheet || !mode || mode === 'none') return [];
    const g = s.stopGap ?? 0.2,
      W = s.stopW ?? 2,
      L = s.stopLen ?? 10,
      hw = sheet.w / 2,
      hh = sheet.h / 2;
    if (!(W > 0) || !(L > 0)) throw Error('Battute: lunghezza e spessore devono essere maggiori di zero.');
    if (L > Math.min(hw, hh)) throw Error('Battute: bracci più lunghi di metà del lato corto del foglio.');
    const box = (x1, y1, x2, y2) => rect((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1), Math.abs(y2 - y1));
    const corners = mode === 'corners' ? [[-1, -1], [1, -1], [-1, 1], [1, 1]] : [[-1, -1], [1, -1]];
    const out = [];
    for (const [sx, sy] of corners) {
      const xOut = sx * (hw + g + W),
        yOut = sy * (hh + g + W);
      out.push(box(xOut, sy * (hh + g), sx * (hw - L), yOut)); // braccio lungo il lato orizzontale
      out.push(box(sx * (hw + g), yOut, xOut, sy * (hh - L))); // braccio lungo il lato verticale
    }
    return union(out);
  }

  // Strati non sovrapposti da elementi che occupano intervalli di quota diversi (rilievo a gradini, battute…).
  function stack(features) {
    const q = (z) => Math.round(z * 1e6) / 1e6;
    features = features.map((f) => ({ ...f, z0: q(f.z0), z1: q(f.z1) }));
    const zs = [...new Set(features.flatMap((f) => [f.z0, f.z1]))].sort((a, b) => a - b),
      out = [];
    for (let i = 0; i + 1 < zs.length; i++) {
      const za = zs[i],
        zb = zs[i + 1],
        inside = features.filter((f) => f.z0 <= za + 1e-9 && f.z1 >= zb - 1e-9);
      if (!inside.length) continue;
      out.push({ z0: za, z1: zb, paths: inside.length === 1 ? inside[0].paths : union(inside.flatMap((f) => f.paths)) });
    }
    return out;
  }

  // Toglie region dagli strati tra zCut e la superficie (gli strati sopra zTop restano intatti).
  function carve(layers, zCut, zTop, region) {
    if (!region.length) return layers;
    const out = [];
    for (const l of layers) {
      if (l.z1 <= zCut + 1e-9 || l.z0 >= zTop - 1e-9) {
        out.push(l);
        continue;
      }
      if (l.z0 < zCut - 1e-9) out.push({ ...l, z1: zCut });
      out.push({ z0: Math.max(l.z0, zCut), z1: l.z1, paths: diff(l.paths, region) });
    }
    return out;
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
      geo = G.plateGeometry(s),
      px = s.w / 2 - geo.pinInset,
      py = geo.pinY,
      warnings = [];
    if (!((s.draft || 0) >= 0 && (s.draft || 0) < 60)) throw Error('L’inclinazione delle pareti deve essere tra 0° e 60°.');
    if (H.L && (H.L < 0.04 || H.L > 0.4)) throw Error('Altezza layer fuori intervallo: usa 0 oppure un valore tra 0,04 e 0,4 mm.');
    if (!(geo.cornerR >= 0) || geo.cornerR > Math.min(s.w, s.h) / 2) throw Error('Raggio degli angoli troppo grande: massimo metà del lato corto della piastra.');
    if (geo.notchD > 0 && geo.notchW > 0) {
      const left = geo.notchX - ((geo.notchW / 2) * (geo.notchD + 1)) / geo.notchD,
        right = geo.notchX + ((geo.notchW / 2) * (geo.notchD + 1)) / geo.notchD;
      if (left < geo.cornerR || right > s.w - geo.cornerR) throw Error('La tacca deve stare sul lato dritto superiore, fuori dagli angoli arrotondati.');
      if (geo.notchD >= s.h / 2) throw Error('Tacca troppo profonda.');
    }
    if (px - s.pin / 2 - s.pg <= 0) throw Error('Perni troppo vicini al centro: riduci la distanza dei perni dal bordo o allarga la piastra.');
    if (Math.abs(py) + s.pin / 2 + s.pg >= s.h / 2) throw Error('Perni troppo grandi o troppo spostati in verticale.');
    if (s.pinChamfer >= H.ph || s.pinChamfer >= s.pin / 2) throw Error('Smusso dei perni troppo grande rispetto a lato e altezza dei perni.');
    if (opts.bed && (s.w > opts.bed.w || s.h > opts.bed.h))
      throw Error('La piastra ' + s.w + ' × ' + s.h + ' mm non entra nel piano di stampa ' + opts.bed.w + ' × ' + opts.bed.h + ' mm.');
    const pins = union([-1, 1].map((v) => rect(v * px, py, s.pin, s.pin))),
      pockets = union([-1, 1].map((v) => rect(v * px, py, s.pin + 2 * s.pg, s.pin + 2 * s.pg))),
      flared = s.holeFlare > 0 ? offset(pockets, s.holeFlare) : pockets,
      safe = offset(plate, -geo.margin),
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

    // Battute di riscontro sulla positiva e sedi corrispondenti (con gioco) sulla negativa.
    const stops = stopShapes(opts.sheet, s, opts.stops);
    let stopH = 0,
      recess = [],
      recessDepth = 0;
    if (stops.length) {
      const snap = (x) => (H.L ? Math.max(H.L, Math.round(x / H.L - 1e-9) * H.L) : x);
      stopH = Math.round(snap(s.stopH ?? 1.2) * 1e6) / 1e6;
      if (!(stopH > 0)) throw Error('Battute: l’altezza deve essere maggiore di zero.');
      if (stopH <= s.paper) warnings.push('Battute più basse dello spessore carta: il foglio potrebbe scavalcarle.');
      if (diff(stops, offset(plate, -1)).length) throw Error('Battute fuori dalla piastra o nella tacca: allarga la piastra o riduci le battute.');
      if (intersect(stops, offset(flared, 0.5)).length) throw Error('Battute sovrapposte ai fori guida: riduci spessore o lunghezza delle battute, o sposta i perni.');
      recess = mirror(offset(stops, s.stopClear ?? 0.3, 'miter'));
      const snapUp = (x) => (H.L ? Math.ceil(x / H.L - 1e-6) * H.L : x);
      recessDepth = Math.round(snapUp(stopH + (s.vertical || 0.1)) * 1e6) / 1e6;
      if (recessDepth >= H.b - 0.4) throw Error('Battute troppo alte: le sedi sulla negativa lascerebbero meno di 0,4 mm di fondo.');
      if (diff(recess, offset(negativePlate, -0.8)).length) throw Error('Sedi delle battute troppo vicine al bordo della negativa.');
      if (intersect(recess, offset(pins, 0.5)).length) throw Error('Sedi delle battute sovrapposte ai perni.');
      if (opts.sheet.overhang === 'top' && opts.stops === 'corners')
        warnings.push('Con le battute ai quattro angoli il dorso della J card urta le battute superiori: usa «Angoli inferiori».');
    }

    // Positiva: base (con svasatura dei fori nei primi due layer) e rilievo, a gradini se le pareti sono inclinate.
    const positiveLayers = [];
    const flareH = Math.min(2 * H.dz, H.b / 2);
    if (s.holeFlare > 0) positiveLayers.push({ z0: 0, z1: flareH, paths: diff(plate, flared) });
    positiveLayers.push({ z0: s.holeFlare > 0 ? flareH : 0, z1: H.b, paths: diff(plate, pockets) });
    const reliefSteps = t > 0 ? Math.max(1, Math.round(H.r / H.dz)) : 1,
      upper = [];
    for (let i = 0; i < reliefSteps; i++) {
      const z0 = H.b + (i * H.r) / reliefSteps,
        paths = i ? offset(art, -t * ((i * H.r) / reliefSteps), 'round', 0.05) : art;
      if (!paths.length) break;
      upper.push({ z0, z1: H.b + ((i + 1) * H.r) / reliefSteps, paths });
    }
    // Unisce i gradini che hanno perso l'ultimo strato in altezza.
    upper[upper.length - 1].z1 = Math.max(upper[upper.length - 1].z1, H.b + H.r);
    if (stops.length) upper.push({ z0: H.b, z1: H.b + stopH, paths: stops });
    positiveLayers.push(...stack(upper));

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
    const negative = E.mesh.mesh(recess.length ? carve(negativeLayers, H.b - recessDepth, H.b, recess) : negativeLayers);

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
    if (opts.sheet && opts.sheet.inset > 0) {
      const i = opts.sheet.inset;
      if (diff(art, [rect(0, 0, opts.sheet.w - 2 * i, opts.sheet.h - 2 * i)]).length)
        warnings.push('Il disegno arriva a meno di ' + i + ' mm dal bordo del foglio' + (opts.sheet.overhang ? ' o dalla piega del dorso' : '') + ': rischi di deformare la piega o il bordo.');
    }
    if (s.paper > 0 && H.r > 2.2 * s.paper + 1e-9)
      warnings.push(
        'Rilievo ' + (H.r / s.paper).toFixed(1).replace('.', ',') + ' volte lo spessore della carta: rischio di grinze intorno al rilievo e di strappi. ' +
          'Consigliato al massimo 2 volte (scegli il materiale per i valori di partenza).',
      );
    if (H.ph > H.b + (s.paper || 0) + 1e-9)
      warnings.push('Perni più alti dello spessore piastra: sporgono di ' + (H.ph - H.b - (s.paper || 0)).toFixed(2) + ' mm dal retro della positiva a matrici chiuse.');
    if (s.lateral < s.paper) warnings.push('Gioco laterale minore dello spessore carta: la carta potrebbe tagliarsi sui bordi della cavità.');
    if (H.L && Math.abs(H.r - s.r) > 1e-6) warnings.push('Altezza rilievo arrotondata a ' + H.r.toFixed(2) + ' mm (multiplo del layer).');
    if (H.L && Math.abs(H.b - s.b) > 1e-6) warnings.push('Spessore piastra arrotondato a ' + H.b.toFixed(2) + ' mm.');
    if (H.L && Math.abs(H.ph - s.ph) > 1e-6) warnings.push('Altezza perni arrotondata a ' + H.ph.toFixed(2) + ' mm.');
    // Contorni 2D per l'anteprima in pianta (negativa vista dall'alto, già specchiata se richiesto).
    const plan = {
      positive: { plate, safe, relief: art, holes: pockets, flare: s.holeFlare > 0 ? flared : [], stops },
      negative: { plate: negativePlate, safe: negativeSafe, cavity, pins, recess },
    };
    return {
      positive, negative, depth, heights: { ...H, stopH, recessDepth }, art, pins, pockets, stops, recess,
      cut: placed.cut, size: placed.size, warnings, thin, plan,
    };
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
    // Piastra e guide configurabili.
    {
      const custom = { ...card.values, cornerR: 0, notchD: 0, pinInset: 10, pinY: 12, margin: 3 };
      const r = build(sources.full, opts({ ...custom, aw: 80 }, 'original', { sheet }));
      check(r.positive, 'Piastra personalizzata positiva');
      check(r.negative, 'Piastra personalizzata negativa');
      count += 2;
      const plateArea = G.area(G.plateShape(custom));
      if (Math.abs(plateArea - custom.w * custom.h) > 1e-6) throw Error('Piastra senza raggio e senza tacca errata: area ' + plateArea);
      const ys = r.pins.flat().map((q) => q.Y / S),
        xs = r.pins.flat().map((q) => q.X / S);
      if (Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - 12) > 1e-6 || Math.abs(Math.max(...xs) - (custom.w / 2 - 10 + custom.pin / 2)) > 1e-6)
        throw Error('Posizione dei perni non applicata.');
      for (const [bad, pattern] of [
        [{ notchX: 3 }, /lato dritto/],
        [{ cornerR: 40 }, /Raggio degli angoli/],
        [{ pinY: 34 }, /spostati in verticale/],
        [{ pinInset: 70 }, /troppo vicini al centro/],
      ]) {
        let refused = false;
        try {
          build(sources.full, opts({ ...card.values, aw: 80, ...bad }, 'original', { sheet }));
        } catch (e) {
          refused = pattern.test(e.message);
        }
        if (!refused) throw Error('Geometria non valida accettata: ' + JSON.stringify(bad));
      }
      // I valori predefiniti riproducono la piastra storica (R6, tacca a 12 mm larga 4 mm sul bordo e profonda 2 mm).
      const x = -card.values.w / 2 + 12,
        y = card.values.h / 2,
        historic = diff(union([G.roundedRect(card.values.w, card.values.h, 6)]), [
          [{ X: Math.round((x - 3) * S), Y: Math.round((y + 1) * S) }, { X: Math.round((x + 3) * S), Y: Math.round((y + 1) * S) }, { X: Math.round(x * S), Y: Math.round((y - 2) * S) }],
        ]);
      if (!same(G.plateShape(card.values), historic)) throw Error('Piastra predefinita diversa da quella storica.');
    }
    // Preset J card con battute di riscontro.
    {
      const jc = E.PRESETS.jCard,
        values = { ...jc.values, ...E.PRINTERS.a1.values, ...E.materialValues(jc.defaultMaterial, 0, E.PRINTERS.a1.values.layer, 0.4) },
        hw = jc.sheet.w / 2,
        hh = jc.sheet.h / 2;
      let withStops = null;
      for (const mode of ['none', 'bottom', 'corners']) {
        const r = build(sources.frame, opts({ ...values, aw: 95.6 }, 'original', { sheet: jc.sheet, stops: mode, bed: E.PRINTERS.a1.bed }));
        const vp = check(r.positive, 'J card positiva ' + mode);
        check(r.negative, 'J card negativa ' + mode);
        count += 2;
        if (mode === 'none') {
          if (r.stops.length) throw Error('Battute presenti senza richiesta.');
          withStops = vp;
          continue;
        }
        // Battute fuori dal foglio, alla distanza richiesta, mai sul lato del dorso con «Angoli inferiori».
        const pts = r.stops.flat().map((q) => [q.X / S, q.Y / S]);
        const minY = Math.min(...pts.map((p) => p[1])),
          maxY = Math.max(...pts.map((p) => p[1]));
        if (Math.abs(minY - -(hh + values.stopGap + values.stopW)) > 1e-3 && Math.abs(minY - -(hh + 0.2 + 2)) > 1e-3)
          throw Error('Battute inferiori in posizione errata: ' + minY);
        if (mode === 'bottom' && maxY > -hh + 10 + 1e-3) throw Error('Battute inferiori oltre la lunghezza dei bracci.');
        if (mode === 'corners' && maxY < hh) throw Error('Battute superiori mancanti.');
        if (intersect(r.stops, [rect(0, 0, jc.sheet.w + 0.39, jc.sheet.h + 0.39)]).length) throw Error('Battute dentro il foglio.');
        if (!r.recess.length || !(vp > withStops)) throw Error('Battute o sedi non generate.');
        const L = E.PRINTERS.a1.values.layer;
        if (Math.abs(r.heights.stopH / L - Math.round(r.heights.stopH / L)) > 1e-6) throw Error('Altezza battute non multipla del layer.');
        if (mode === 'corners' && !r.warnings.some((w) => /dorso della J card/.test(w))) throw Error('Manca l’avviso sulle battute superiori della J card.');
      }
      let overlap = false;
      try {
        build(sources.frame, opts({ ...values, aw: 60, stopW: 4, pinY: -25 }, 'original', { sheet: jc.sheet, stops: 'bottom' }));
      } catch (e) {
        overlap = /fori guida/.test(e.message);
      }
      if (!overlap) throw Error('Battute sovrapposte ai fori guida non rifiutate.');
      const near = build(sources.full, opts({ ...values, aw: 200 }, 'original', { sheet: jc.sheet, stops: 'bottom' }));
      if (!near.warnings.some((w) => /meno di 3 mm dal bordo del foglio o dalla piega/.test(w))) throw Error('Manca l’avviso sul margine dalla piega.');
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

  E.model = { artwork, build, stopShapes, stack, carve, heights, thinParts, narrowGaps, selfTest };

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
        plan: Object.fromEntries(
          Object.entries(r.plan).map(([side, layers]) => [side, Object.fromEntries(Object.entries(layers).map(([k, paths]) => [k, loops(paths)]))]),
        ),
      };
    },
    selftest: (sources) => selfTest(sources),
  };
})((self.Embosser = self.Embosser || {}));
