// Configurazione condivisa tra pagina e worker: revisione, parametri e preset.
'use strict';
(function (E) {
  E.VERSION = 'print-1';
  // Fattore di scala mm → interi per Clipper (risoluzione 0,0001 mm).
  E.S = 10000;

  // [id, etichetta, valore iniziale, passo, gruppo]
  E.PARAMS = [
    ['w', 'Larghezza piastra [mm]', 100, 0.5, 'main'],
    ['h', 'Altezza piastra [mm]', 70, 0.5, 'main'],
    ['b', 'Spessore piastra [mm]', 4, 0.1, 'main'],
    ['r', 'Altezza rilievo [mm]', 0.8, 0.04, 'main'],
    ['paper', 'Spessore carta [mm]', 0.12, 0.01, 'main'],
    ['vertical', 'Gioco verticale [mm]', 0.1, 0.01, 'main'],
    ['lateral', 'Gioco laterale [mm]', 0.15, 0.01, 'main'],
    ['aw', 'Larghezza disegno [mm]', 60, 0.5, 'main'],
    ['ah', 'Altezza disegno [mm], 0 = auto', 0, 0.5, 'main'],
    ['pin', 'Lato perni [mm]', 5, 0.1, 'main'],
    ['ph', 'Altezza perni [mm]', 4, 0.1, 'main'],
    ['pg', 'Gioco per lato perni [mm]', 0.3, 0.01, 'main'],
    ['layer', 'Altezza layer [mm], 0 = quote libere', 0, 0.02, 'print'],
    ['draft', 'Inclinazione pareti rilievo [°]', 0, 1, 'print'],
    ['pinChamfer', 'Smusso punta perni [mm]', 0, 0.04, 'print'],
    ['holeFlare', 'Svasatura base fori guida [mm]', 0, 0.05, 'print'],
    ['minFeature', 'Dettaglio minimo stampabile [mm], 0 = nessun controllo', 0, 0.02, 'print'],
  ];

  // Profili stampante: valori consigliati applicati sopra al preset e dimensioni del piano.
  E.PRINTERS = {
    none: { name: 'Nessuna (valori manuali)', note: 'Nessun profilo: quote libere, nessun controllo del piano di stampa.' },
    a1: {
      name: 'Bambu Lab A1 – ugello 0,4 mm',
      bed: { w: 256, h: 256 },
      note:
        'Pensato per il profilo Bambu Studio «0.16mm Optimal @BBL A1», PLA o PETG, piastre stampate a faccia in su. ' +
        'Quote arrotondate a multipli di 0,16 mm, pareti del rilievo inclinate di 15°, perni smussati, fori svasati alla base contro l’elephant foot, ' +
        'avviso sui dettagli più sottili di due linee d’estrusione (0,84 mm). Piano 256 × 256 mm.',
      values: { layer: 0.16, draft: 15, pinChamfer: 0.48, holeFlare: 0.2, minFeature: 0.84, lateral: 0.25, pg: 0.2 },
    },
  };

  E.PRESETS = {
    custom: { note: 'Modifica liberamente tutti i parametri. Nessun ritaglio al foglio.' },
    businessCard: {
      note:
        'Piastra 130 × 70 mm con angoli R6 e tacca di orientamento. Foglio centrato 85 × 55 mm: perimetro rosso solo in anteprima. ' +
        'Le parti del disegno oltre il foglio vengono tagliate, senza deformazione. Altezza disegno 0 permette di ingrandire dalla larghezza. ' +
        'Perni e fori devono restare fuori dal foglio. Carta e giochi sono valori iniziali da adattare al materiale.',
      values: { w: 130, h: 70, b: 4, r: 0.8, paper: 0.12, vertical: 0.1, lateral: 0.15, aw: 85, ah: 0, pin: 5, ph: 4, pg: 0.3 },
      align: 'center',
      sheet: { w: 85, h: 55 },
    },
  };
})((self.Embosser = self.Embosser || {}));
