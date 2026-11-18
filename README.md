# SVG → STL Embosser

Applicazione web per generare una coppia di matrici per embossing su carta a partire da un SVG con forme riempite. Mostra la matrice positiva e quella negativa in 3D ed esporta due file STL binari.

## Apri l’app

[Avvia su GitHub Pages](https://moondoglies.github.io/svg-embosser-step/)

Non servono installazioni, un backend o un server locale. Il file di ingresso è `index.html`; può essere aperto anche direttamente nel browser. Serve una connessione Internet per caricare le librerie dai CDN.

Il disegno viene letto e le mesh vengono generate nel browser: il codice dell’app non carica l’SVG su un server.

## Funzionalità

- Anteprima 3D orbitabile: positiva a sinistra, negativa a destra.
- Anteprima ed export ricavati dagli stessi triangoli.
- Ridimensionamento di piastre e disegno, con proporzioni del disegno conservate.
- Gestione delle aree riempite e dei fori SVG tramite SVGLoader.
- Unione e differenza delle regioni poligonali tramite Clipper.
- Gioco laterale applicato ai contorni della cavità tramite offset.
- Perni sulla negativa e fori guida passanti sulla positiva.
- Opzione per specchiare la negativa per l’accoppiamento faccia a faccia.
- Correzione delle giunzioni a T tramite suddivisione degli spigoli.
- Controllo degli spigoli e del volume prima di abilitare l’export.
- Test integrato della cornice SVG.

La versione attuale esporta STL, non STEP, e non utilizza OpenCascade o WebAssembly. Il nome della repository conserva il riferimento storico a STEP.

## Utilizzo

1. Apri l’app e seleziona un file `.svg`.
2. Imposta dimensioni delle piastre e del disegno.
3. Regola rilievo, spessore carta, giochi e perni.
4. Controlla entrambe le matrici nell’anteprima: trascina per ruotare e usa la rotella per lo zoom. Il pulsante **Inquadra** ripristina un’inquadratura complessiva.
5. Dopo il superamento dei controlli, usa **Esporta positiva STL** ed **Esporta negativa STL**.
6. Importa i file nello slicer e verifica dimensioni, orientamento, cavità e anteprima dei layer prima della stampa. Le coordinate dell’app sono espresse in millimetri; se lo slicer chiede l’unità, scegli mm.

I parametri aggiornano le mesh quando confermi la modifica del campo.

## Parametri

| Parametro | Effetto |
| --- | --- |
| Larghezza / altezza piastra | Ingombro di entrambe le piastre, in mm. |
| Spessore piastra | Spessore del corpo delle matrici. |
| Altezza rilievo | Altezza dell’area in rilievo sulla positiva. |
| Spessore carta | Contributo alla profondità della cavità negativa. |
| Gioco verticale | Ulteriore profondità della cavità. |
| Gioco laterale | Offset verso l’esterno delle aree della cavità; può ridurre o eliminare isole molto piccole. |
| Larghezza disegno | Larghezza massima del disegno. |
| Altezza disegno | Con `0`, altezza automatica dalla larghezza; con un valore positivo, ulteriore limite d’ingombro. Le proporzioni restano invariate. |
| Lato / altezza perni | Dimensioni dei perni quadrati sulla negativa. |
| Gioco per lato perni | Aumento del foro su ciascun lato: lato foro = lato perno + 2 × gioco. |
| Posizione | Disegno centrato, in alto o in basso. |
| Specchia la negativa | Riflette il disegno della negativa lungo X per il ribaltamento faccia a faccia. |

La profondità della cavità è calcolata come:

```text
profondità = altezza rilievo + spessore carta + gioco verticale
```

L’app blocca la generazione se questa profondità è maggiore o uguale allo spessore della piastra meno 0,4 mm. Controlla anche che il disegno e la cavità non superino i margini o interferiscano con le guide. Questi controlli non garantiscono la resistenza meccanica o la compatibilità con ogni pressa.

## Preparare l’SVG

- Usa forme vettoriali riempite. Un’area riempita diventa un rilievo sulla positiva e una cavità sulla negativa.
- I fori del disegno restano vuoti nel rilievo e corrispondono a isole nella negativa. Una cornice, ad esempio, deve produrre un rilievo e una cavità ad anello.
- Converti i testi in tracciati.
- Converti gli stroke in contorni riempiti: le sole linee non vengono convertite in rilievi.
- Espandi gli elementi `use` e rimuovi o risolvi immagini raster, `foreignObject`, maschere e clipping: questi elementi non sono supportati e vengono rifiutati in importazione.
- Gli SVG vengono interpretati come regioni piene/vuote, non come mappe di altezza: colori e gradienti non definiscono quote di rilievo diverse.
- Le curve vengono campionate in segmenti; l’STL non conserva curve CAD esatte.

## Verifica delle mesh e diagnostica

Prima dell’export l’app controlla che:

- la mesh non sia vuota e i vertici siano finiti;
- i triangoli non abbiano vertici coincidenti secondo la tolleranza di verifica;
- ogni spigolo sia condiviso da esattamente due facce, con orientamento coerente;
- il volume orientato totale sia positivo.

Le coordinate vengono uniformate su una griglia di 0,0001 mm. Le giunzioni a T rilevate vengono suddivise prima della verifica. Se restano difetti, l’export viene bloccato e il messaggio distingue **Positiva** e **Negativa**, mostrando fino a quattro spigoli problematici con coordinate e conteggio delle facce. La console contiene l’elenco completo rilevato.

Il superamento del controllo non è una certificazione completa: non rileva ogni possibile auto-intersezione, errore di interpretazione dell’SVG o problema di stampa. Verifica comunque gli STL nello slicer.

### Test cornice SVG

Il pulsante **Test cornice SVG** esegue un test integrato su una cornice quadrata con foro quadrato, usando larghezze di 45 e 60 mm e giochi laterali di 0 e 0,1 mm. Vengono controllate otto mesh: quattro positive e quattro negative.

L’esito atteso è:

```text
Test cornice superato: 8 mesh controllate.
```

Il test non sostituisce il disegno caricato né modifica gli STL già generati. Usa la posizione e l’opzione di specchiatura correntemente selezionate.

Se dopo un deploy compare ancora la vecchia interfaccia, forza il ricaricamento del browser. La versione con questa correzione mostra `mesh-2` nel messaggio iniziale.

## File esportati

- `embosser_positivo.stl`: piastra con rilievo e fori guida passanti.
- `embosser_negativo.stl`: piastra con cavità, eventuali isole e perni di registrazione.

## Struttura e dipendenze

L’applicazione è contenuta in `index.html`. Non richiede una fase di build.

Dipendenze caricate da CDN:

- Three.js 0.128.0, inclusi OrbitControls e SVGLoader.
- clipper-lib 6.4.2.

Non è una distribuzione completamente offline: per usarla senza rete occorre includere localmente le dipendenze e adattare i riferimenti agli script.

## GitHub Pages

Per pubblicare direttamente il file dalla repository, configura **Settings → Pages → Deploy from a branch**, selezionando `main` e `/ (root)`. `index.html` è la pagina iniziale.

## Licenza

MIT. Le dipendenze di terze parti mantengono le rispettive licenze.
