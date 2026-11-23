// Configurazione condivisa tra pagina e worker: revisione, parametri e preset.
'use strict';
(function (E) {
  E.VERSION = 'sheet-6';
  // Fattore di scala mm → interi per Clipper (risoluzione 0,0001 mm).
  E.S = 10000;

  // [id, etichetta, valore iniziale]
  E.PARAMS = [
    ['w', 'Larghezza piastra [mm]', 100],
    ['h', 'Altezza piastra [mm]', 70],
    ['b', 'Spessore piastra [mm]', 4],
    ['r', 'Altezza rilievo [mm]', 0.8],
    ['paper', 'Spessore carta [mm]', 0.12],
    ['vertical', 'Gioco verticale [mm]', 0.1],
    ['lateral', 'Gioco laterale [mm]', 0.15],
    ['aw', 'Larghezza disegno [mm]', 60],
    ['ah', 'Altezza disegno [mm], 0 = auto', 0],
    ['pin', 'Lato perni [mm]', 5],
    ['ph', 'Altezza perni [mm]', 4],
    ['pg', 'Gioco per lato perni [mm]', 0.3],
  ];

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
