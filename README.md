# SVG → STL Embosser

Applicazione web per generare una coppia di matrici per embossing su carta a partire da un SVG con forme riempite. Mostra la matrice positiva e quella negativa in 3D ed esporta due file STL binari.

## Apri l’app

[Avvia su GitHub Pages](https://moondoglies.github.io/svg-embosser-step/)

Non servono installazioni, un backend o un server locale. Il file di ingresso è `index.html`; può essere aperto anche direttamente nel browser (doppio clic, `file://`), purché la cartella `js/` resti accanto. Aperta da `file://` l’app calcola le mesh nella pagina invece che nel Web Worker, quindi con disegni complessi l’interfaccia può bloccarsi per qualche secondo durante il calcolo. Serve una connessione Internet per caricare le librerie dai CDN.

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
- Piastre con angoli arrotondati R6 e tacca triangolare di orientamento sul bordo superiore (specchiata sulla negativa quando è attiva la specchiatura).
- Preset con formato del foglio, ad esempio biglietto da visita 85 × 55 mm, con ritaglio del disegno al perimetro del foglio.
- Inversione pieni/vuoti, con area di inversione a scelta tra contorno esterno e rettangolo d’ingombro.
- Rispetto di `fill-rule` (`nonzero`/`evenodd`) e degli stili CSS interni all’SVG.
- Correzione delle giunzioni a T tramite suddivisione degli spigoli.
- Controllo degli spigoli e del volume prima di abilitare l’export.
- Test integrato richiamabile dall’interfaccia e test automatici in GitHub Actions.

La versione attuale esporta STL, non STEP, e non utilizza OpenCascade o WebAssembly. Il nome della repository conserva il riferimento storico a STEP.

## Utilizzo

1. Apri l’app e seleziona un file `.svg`.
2. Scegli un preset oppure **Personalizzato**, poi imposta dimensioni delle piastre e del disegno.
3. Regola rilievo, spessore carta, giochi e perni.
4. Controlla entrambe le matrici nell’anteprima: trascina per ruotare e usa la rotella per lo zoom. Il pulsante **Inquadra** ripristina un’inquadratura complessiva.
5. Dopo il superamento dei controlli, usa **Esporta positiva STL** ed **Esporta negativa STL**.
6. Importa i file nello slicer e verifica dimensioni, orientamento, cavità e anteprima dei layer prima della stampa. Le coordinate dell’app sono espresse in millimetri; se lo slicer chiede l’unità, scegli mm.

I parametri aggiornano le mesh quando confermi la modifica del campo. Se un valore non è valido, il campo viene evidenziato in rosso e il messaggio indica il nome del parametro.

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
| Inverti pieni/vuoti | Mette in rilievo i vuoti del disegno invece dei pieni. |
| Area di inversione | **Contorno esterno**: rilievo nei vuoti interni delle sagome. **Rettangolo d’ingombro**: rilievo in tutti i vuoti entro l’ingombro del disegno. |

Valori iniziali (preset Personalizzato): piastra 100 × 70 × 4 mm, rilievo 0,8 mm, carta 0,12 mm, gioco verticale 0,1 mm, gioco laterale 0,15 mm, disegno largo 60 mm, perni 5 × 4 mm con gioco 0,30 mm per lato. La piastra deve misurare almeno 24 × 16 mm.

Forma fissa delle piastre: angoli R6 mm, tacca di orientamento a 12 mm dal bordo sinistro sul lato superiore, perni centrati in altezza, con il centro a 7 mm dai bordi laterali, margine di sicurezza di 2 mm dal bordo per disegno e cavità.

## Preset

| Preset | Piastra | Foglio | Note |
| --- | --- | --- | --- |
| Personalizzato | libera | nessuno | Nessun ritaglio; disegno posizionato con 3 mm di margine in alto/basso. |
| Biglietto da visita | 130 × 70 mm | 85 × 55 mm, centrato | Il perimetro rosso del foglio è solo una guida di anteprima e non viene esportato. Le parti del disegno oltre il foglio vengono tagliate senza deformazione; perni e fori devono restare fuori dal foglio. La cavità conserva il gioco laterale anche al bordo del foglio. |

Scegliere un preset imposta i suoi valori iniziali, che restano modificabili.

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
- Espandi gli elementi `use` e rimuovi o applica immagini raster, `foreignObject`, maschere e clipping usati nel disegno: vengono rifiutati in importazione. Le definizioni non usate (ad esempio un `clipPath` in `<defs>` mai referenziato) e gli elementi nascosti sono ignorati.
- `fill-rule` è rispettato (`nonzero` ed `evenodd`), sia come attributo sia come stile inline, regola CSS o valore ereditato da un gruppo.
- Gli stili CSS interni (`<style>` con selettori di classe, id e tipo) sono applicati per `fill`, `fill-opacity`, `fill-rule`, `opacity`, `display` e `visibility`: le forme con `fill: none`, trasparenti o nascoste non diventano rilievi.
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

### Test integrato

Il pulsante **Test integrato** esegue nel browser una serie di controlli, senza sostituire il disegno caricato né modificare gli STL già generati:

- interpretazione dell’SVG: `fill-rule`, stili CSS, forme nascoste o senza riempimento, definizioni inutilizzate accettate ed elementi non supportati rifiutati;
- cornice quadrata con foro, in modalità originale e con le due inversioni, a varie larghezze e giochi laterali;
- preset biglietto da visita: ritaglio al foglio, guide fuori dal foglio, angoli R6, tacca e specchiatura;
- controllo di spigoli e volume su tutte le mesh generate.

L’esito atteso inizia con:

```text
Test superato: 54 mesh controllate.
```

Se dopo un deploy compare ancora la vecchia interfaccia, forza il ricaricamento del browser. La versione attuale mostra `sheet-6` nel messaggio di stato.

## File esportati

- `embosser_positivo.stl`: piastra con rilievo e fori guida passanti.
- `embosser_negativo.stl`: piastra con cavità, eventuali isole e perni di registrazione.

## Struttura e dipendenze

Non richiede una fase di build: `index.html` carica script classici (non moduli ES), che funzionano anche da `file://`. Ogni file aggiunge il proprio modulo al namespace globale `Embosser`.

| File | Contenuto | Dove gira |
| --- | --- | --- |
| `js/config.js` | Revisione, parametri con valori iniziali, preset | pagina e worker |
| `js/geometry.js` | Operazioni 2D con Clipper: unione, differenza, offset, piastra R6 con tacca, inversione, ritaglio al foglio | pagina e worker |
| `js/mesh.js` | Mesh a strati, triangolazione dei tappi, riparazione delle giunzioni a T, verifica, scrittura STL binario | pagina e worker |
| `js/model.js` | Posizionamento del disegno, controlli su guide e margini, generazione delle due matrici, test geometrici; nessun accesso al DOM | pagina e worker |
| `js/svg.js` | Lettura dell’SVG: stili CSS, `fill-rule`, elementi non supportati, test di interpretazione | solo pagina (serve `DOMParser`) |
| `js/engine.js` | Invio dei calcoli al worker, annullamento del calcolo superato da una modifica più recente, ripiego nella pagina | pagina |
| `js/worker.js` | Web Worker che esegue generazione e test geometrici | worker |
| `js/viewer.js` | Anteprima 3D Three.js | pagina |
| `js/app.js` | Interfaccia: campi, preset, stato, export | pagina |

Flusso: la pagina legge l’SVG in dati semplici, il worker genera e verifica le mesh e le restituisce come `Float32Array` trasferiti senza copia; anteprima ed export usano gli stessi triangoli. Se si modifica un parametro mentre un calcolo è in corso, il worker viene terminato e il calcolo riparte con i valori nuovi.

Dipendenze caricate da CDN:

- Three.js 0.128.0, inclusi OrbitControls e SVGLoader.
- clipper-lib 6.4.2.

Non è una distribuzione completamente offline: per usarla senza rete occorre includere localmente le dipendenze e adattare i riferimenti agli script, sia in `index.html` sia in `js/worker.js` (le due liste devono coincidere; i test lo verificano).

## Sviluppo e test

I test end-to-end aprono l’app in Chromium tramite Playwright, sia da un piccolo server HTTP locale (calcolo nel Web Worker) sia da `file://` (calcolo nella pagina). Durante i test le dipendenze CDN vengono servite da `node_modules`, con le stesse versioni esatte usate dall’app (il test fallisce se le versioni divergono), quindi non serve la rete dopo l’installazione.

```bash
npm ci
npx playwright install chromium
npm test
```

Vengono verificati l’avvio senza errori, l’uso effettivo del worker e il ripiego da `file://`, il test integrato in entrambe le modalità, l’export di STL binari validi, il blocco dell’export per SVG senza aree riempite, la propagazione degli errori dal worker, l’annullamento dei calcoli superati e i messaggi d’errore dei parametri. Il workflow `.github/workflows/test.yml` esegue gli stessi test a ogni push e pull request.

## GitHub Pages

Per pubblicare direttamente l’app dalla repository (`index.html` e cartella `js/`), configura **Settings → Pages → Deploy from a branch**, selezionando `main` e `/ (root)`. `index.html` è la pagina iniziale.

## Licenza

MIT. Le dipendenze di terze parti mantengono le rispettive licenze.
