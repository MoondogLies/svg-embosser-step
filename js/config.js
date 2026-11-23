// Configurazione condivisa tra pagina e worker: revisione, parametri e preset.
'use strict';
(function (E) {
  E.VERSION = 'materiali-1';
  // Fattore di scala mm → interi per Clipper (risoluzione 0,0001 mm).
  E.S = 10000;

  // [id, etichetta, valore iniziale, passo, gruppo, { negative: ammette valori negativi }]
  E.PARAMS = [
    ['w', 'Larghezza piastra [mm]', 100, 0.5, 'main'],
    ['h', 'Altezza piastra [mm]', 70, 0.5, 'main'],
    ['b', 'Spessore piastra [mm]', 2, 0.1, 'main'],
    ['r', 'Altezza rilievo [mm]', 0.8, 0.04, 'main'],
    ['paper', 'Spessore carta [mm]', 0.12, 0.01, 'main'],
    ['vertical', 'Gioco verticale [mm]', 0.1, 0.01, 'main'],
    ['lateral', 'Gioco laterale [mm]', 0.15, 0.01, 'main'],
    ['aw', 'Larghezza disegno [mm]', 60, 0.5, 'main'],
    ['ah', 'Altezza disegno [mm], 0 = auto', 0, 0.5, 'main'],
    ['pin', 'Lato perni [mm]', 5, 0.1, 'main'],
    ['ph', 'Altezza perni [mm]', 2, 0.1, 'main'],
    ['pg', 'Gioco per lato perni [mm]', 0.3, 0.01, 'main'],
    ['sheetW', 'Larghezza foglio [mm] (solo Personalizzato, 0 = nessuno)', 0, 0.5, 'main'],
    ['sheetH', 'Altezza foglio [mm] (solo Personalizzato, 0 = nessuno)', 0, 0.5, 'main'],
    ['cornerR', 'Raggio angoli piastra [mm]', 6, 0.5, 'plate'],
    ['margin', 'Margine di sicurezza dal bordo [mm]', 2, 0.5, 'plate'],
    ['pinInset', 'Distanza centro perni dal bordo laterale [mm]', 7, 0.5, 'plate'],
    ['pinY', 'Spostamento verticale perni [mm] (+ in alto)', 0, 0.5, 'plate', { negative: true }],
    ['notchX', 'Posizione tacca dal bordo sinistro [mm]', 12, 0.5, 'plate'],
    ['notchW', 'Larghezza tacca sul bordo [mm]', 4, 0.5, 'plate'],
    ['notchD', 'Profondità tacca [mm], 0 = senza tacca', 2, 0.5, 'plate'],
    ['stopLen', 'Lunghezza bracci battute [mm]', 10, 0.5, 'stops'],
    ['stopW', 'Spessore battute [mm]', 2, 0.1, 'stops'],
    ['stopH', 'Altezza battute [mm]', 1.2, 0.04, 'stops'],
    ['stopGap', 'Distanza battute dal foglio [mm]', 0.2, 0.05, 'stops'],
    ['stopClear', 'Gioco sedi battute sulla negativa [mm]', 0.3, 0.05, 'stops'],
    ['layer', 'Altezza layer [mm], 0 = quote libere', 0, 0.02, 'print'],
    ['draft', 'Inclinazione pareti rilievo [°]', 0, 1, 'print'],
    ['pinChamfer', 'Smusso punta perni [mm]', 0, 0.04, 'print'],
    ['holeFlare', 'Svasatura base fori guida [mm]', 0, 0.05, 'print'],
    ['minFeature', 'Dettaglio minimo stampabile [mm], 0 = nessun controllo', 0, 0.02, 'print'],
  ];

  // Ugelli: altezza layer consigliata per i dettagli del rilievo e tolleranza XY aggiuntiva.
  E.NOZZLES = {
    0.2: { layer: 0.08, tol: 0 },
    0.4: { layer: 0.16, tol: 0 },
    0.6: { layer: 0.24, tol: 0.05 },
    0.8: { layer: 0.24, tol: 0.1 },
  };
  const r2 = (x) => Math.round(x * 100) / 100;

  // Valori del profilo A1 per un ugello: layer, smussi, svasatura contro l'elephant foot, dettaglio minimo (due linee).
  function a1Values(nozzle) {
    const n = E.NOZZLES[nozzle] || E.NOZZLES[0.4],
      layer = n.layer;
    return {
      layer,
      draft: 15,
      pinChamfer: r2(Math.min(3, Math.max(2, Math.round(0.48 / layer))) * layer),
      holeFlare: r2(0.2 + n.tol),
      minFeature: r2(2 * 1.05 * nozzle),
      lateral: r2(0.25 + n.tol),
      pg: r2(0.2 + n.tol / 2),
    };
  }

  // Profili stampante: valori consigliati applicati sopra al preset e dimensioni del piano.
  E.PRINTERS = {
    none: { name: 'Nessuna (valori manuali)', note: () => 'Nessun profilo: quote libere, nessun controllo del piano di stampa.' },
    a1: {
      name: 'Bambu Lab A1',
      bed: { w: 256, h: 256 },
      nozzles: [0.2, 0.4, 0.6, 0.8],
      valuesFor: a1Values,
      note: (nozzleValue) => {
        const raw = a1Values(nozzleValue),
          it = (x) => String(x).replace('.', ','),
          v = Object.fromEntries(Object.entries(raw).map(([k, x]) => [k, it(x)])),
          nozzle = it(nozzleValue);
        return (
          'Ugello ' + nozzle + ' mm: in Bambu Studio scegli il profilo dell’ugello ' + nozzle + ' con altezza layer ' + v.layer + ' mm ' +
          '(o imposta il layer a mano), PLA o PETG, piastre stampate a faccia in su. Quote arrotondate a multipli di ' + v.layer + ' mm, ' +
          'pareti inclinate, perni smussati di ' + v.pinChamfer + ' mm, fori svasati di ' + v.holeFlare + ' mm alla base contro l’elephant foot, ' +
          'avviso sui dettagli più sottili di ' + v.minFeature + ' mm (due linee d’estrusione). Piano 256 × 256 mm.' +
          (nozzleValue >= 0.6 ? ' Con ugelli grandi i dettagli fini del rilievo si perdono: preferisci tratti spessi.' : '')
        );
      },
    },
  };
  // Compatibilità: valori A1 con ugello 0,4.
  E.PRINTERS.a1.values = a1Values(0.4);

  // Materiali: spessore tipico e rapporto profondità/spessore sopportato dalla carta.
  E.MATERIALS = {
    measured: { name: 'Spessore misurato (usa «Spessore carta»)' },
    paper100: { name: 'Carta 80–100 g/m² (≈ 0,10 mm)', paper: 0.1, ratio: 2 },
    paper120: { name: 'Carta 120 g/m² (≈ 0,14 mm)', paper: 0.14, ratio: 2 },
    card160: { name: 'Cartoncino 160 g/m² (≈ 0,19 mm)', paper: 0.19, ratio: 1.9 },
    card200: { name: 'Cartoncino 200 g/m² (≈ 0,24 mm)', paper: 0.24, ratio: 1.8 },
    card250: { name: 'Cartoncino 250 g/m² (≈ 0,29 mm)', paper: 0.29, ratio: 1.7 },
    card300: { name: 'Cartoncino 300 g/m² (≈ 0,34 mm)', paper: 0.34, ratio: 1.6 },
    card350: { name: 'Cartoncino 350 g/m² (≈ 0,40 mm)', paper: 0.4, ratio: 1.5 },
    cotton300: { name: 'Carta cotone / acquerello 300 g/m² (≈ 0,45 mm, morbida)', paper: 0.45, ratio: 1.8 },
  };

  // Valori di partenza per carta e stampa: gioco laterale = carta + 0,1 + tolleranza dell'ugello,
  // rilievo ≤ rapporto × carta (per difetto a multipli del layer), pareti più inclinate con carte spesse.
  E.materialValues = function (id, paperValue, layer, nozzle) {
    const m = E.MATERIALS[id];
    if (!m) return {};
    const t = m.paper || paperValue;
    if (!(t > 0)) return {};
    const ratio = m.ratio || 1.7,
      tol = (E.NOZZLES[nozzle] || { tol: 0 }).tol,
      target = Math.min(0.8, Math.max(0.3, ratio * t));
    const r = layer ? Math.max(layer, Math.floor(target / layer + 1e-9) * layer) : target;
    return {
      paper: r2(t),
      lateral: r2(t + 0.1 + tol),
      r: r2(r),
      vertical: 0.1,
      draft: t >= 0.3 ? 25 : t >= 0.2 ? 20 : 15,
    };
  };

  E.PRESETS = {
    custom: {
      note: 'Modifica liberamente tutti i parametri. Con larghezza e altezza del foglio maggiori di zero il disegno viene tagliato al foglio e puoi usare le battute.',
    },
    businessCard: {
      note:
        'Piastra 130 × 70 mm con angoli R6 e tacca di orientamento. Foglio centrato 85 × 55 mm: perimetro rosso solo in anteprima. ' +
        'Le parti del disegno oltre il foglio vengono tagliate, senza deformazione. Altezza disegno 0 permette di ingrandire dalla larghezza. ' +
        'Perni e fori devono restare fuori dal foglio. Carta e giochi sono valori iniziali da adattare al materiale.',
      values: { w: 130, h: 70, b: 2, r: 0.8, paper: 0.12, vertical: 0.1, lateral: 0.15, aw: 85, ah: 0, pin: 5, ph: 2, pg: 0.3 },
      defaultMaterial: 'card300',
      align: 'center',
      sheet: { w: 85, h: 55 },
    },
    jCard: {
      note:
        'J card per musicassetta: si goffra solo il pannello frontale 101,6 × 63,5 mm (4" × 2,5"), con il dorso sul lato superiore. ' +
        'Piastra 130 × 80 mm; dorso e aletta escono liberi oltre il bordo superiore, quindi le battute sono solo agli angoli inferiori. ' +
        'Materiale iniziale: cartoncino 250 g/m² (circa 0,3 mm: misuralo e scegli il materiale giusto). ' +
        'Tieni il disegno ad almeno 3 mm da bordi e piega; goffra prima di cordonare e piegare. Verifica le misure sul template del tuo stampatore.',
      values: { w: 130, h: 80, b: 2, r: 0.64, paper: 0.3, vertical: 0.1, lateral: 0.4, aw: 95.6, ah: 0, pin: 5, ph: 2, pg: 0.3 },
      defaultMaterial: 'card250',
      align: 'center',
      stops: 'bottom',
      sheet: { w: 101.6, h: 63.5, inset: 3, overhang: 'top' },
    },
  };
})((self.Embosser = self.Embosser || {}));
