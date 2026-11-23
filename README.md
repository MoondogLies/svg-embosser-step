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
- Piastre con angoli arrotondati e tacca triangolare di orientamento sul bordo superiore (specchiata sulla negativa quando è attiva la specchiatura); raggio, tacca, posizione dei perni e margine sono regolabili.
- Preset **J card per musicassetta** (pannello frontale 101,6 × 63,5 mm) con valori per cartoncino.
- **Battute di riscontro** a «L» sulla positiva, con sedi sulla negativa, per posizionare la carta in modo ripetibile.
- Anteprima del **foglio goffrato** sul formato del preset (o sull’ingombro del disegno), sempre visibile, e finestra con il foglio in 3D orbitabile.
- Pianta 2D di positiva e negativa viste dall’alto, con rilievo, cavità, perni, fori, svasatura, margine, foglio e zone troppo sottili; visibile anche prima di caricare il disegno.
- Preset con formato del foglio, ad esempio biglietto da visita 85 × 55 mm, con ritaglio del disegno al perimetro del foglio.
- Inversione pieni/vuoti, con area di inversione a scelta tra contorno esterno e rettangolo d’ingombro.
- Rispetto di `fill-rule` (`nonzero`/`evenodd`) e degli stili CSS interni all’SVG.
- Conversione degli stroke (contorni) in aree piene, con spessore, estremità e raccordi dell’SVG.
- Scala dal campo «Larghezza disegno» oppure dalle dimensioni reali del file SVG (mm, cm, in, pt, pc).
- **Scelta del materiale** (grammatura): spessore carta, giochi, altezza del rilievo e inclinazione calcolati per il risultato migliore, con avviso se il rilievo è troppo profondo per la carta.
- **Preset personali**: salva, carica, elimina, esporta e importa tutte le impostazioni con un nome.
- Profilo **Bambu Lab A1** con ugello selezionabile (0,2 / 0,4 / 0,6 / 0,8 mm): quote multiple del layer, pareti del rilievo inclinate, perni smussati, fori guida svasati contro l’elephant foot, avvisi sui dettagli troppo sottili, controllo del piano 256 × 256 mm.
- Export 3MF con entrambe le piastre già disposte sul piano di stampa, oltre ai due STL.
- Impostazioni salvate nel browser, trascinamento del file SVG sulla pagina, layout adatto al telefono.
- Correzione delle giunzioni a T tramite suddivisione degli spigoli.
- Controllo degli spigoli e del volume prima di abilitare l’export.
- Calcolo delle mesh in un Web Worker, senza bloccare l’interfaccia.
- Test integrato richiamabile dall’interfaccia e test automatici in GitHub Actions.

La versione attuale esporta STL, non STEP, e non utilizza OpenCascade o WebAssembly. Il nome della repository conserva il riferimento storico a STEP.

## Utilizzo

1. Apri l’app e seleziona un file `.svg`.
2. Scegli un preset oppure **Personalizzato**, poi imposta dimensioni delle piastre e del disegno.
3. Regola rilievo, spessore carta, giochi e perni.
4. Controlla entrambe le matrici nell’anteprima: trascina per ruotare e usa la rotella per lo zoom. Il pulsante **Inquadra** ripristina un’inquadratura complessiva.
5. Controlla la **Pianta** sotto l’anteprima 3D e gli avvisi sotto lo stato: le zone troppo sottili per l’ugello sono evidenziate in arancione in entrambe le viste.
6. Dopo il superamento dei controlli, usa **Esporta 3MF (entrambe sul piano)** oppure **Esporta positiva STL** ed **Esporta negativa STL**.
7. Importa i file nello slicer e verifica dimensioni, orientamento, cavità e anteprima dei layer prima della stampa. Le coordinate dell’app sono espresse in millimetri; se lo slicer chiede l’unità, scegli mm.

## Foglio goffrato

Sotto la pianta, l’anteprima **Foglio goffrato** mostra come dovrebbe apparire la carta dopo la pressatura, aggiornata a ogni modifica:

- con un preset il foglio ha il suo formato (per il biglietto da visita 85 × 55 mm) e il disegno è nella stessa posizione e con lo stesso ritaglio delle matrici; con **Personalizzato** il foglio è l’ingombro del disegno più 5 mm per lato;
- il foglio è visto dal lato del rilievo, con la stessa orientazione della positiva; inversione pieni/vuoti, stroke e scala sono già applicati;
- la carta sale dell’altezza del rilievo; la larghezza della piega sul bordo è gioco laterale + spessore carta + l’effetto dell’inclinazione delle pareti, con un raccordo morbido;
- l’anteprima usa luce radente e pendenze esagerate per leggibilità.

**Apri il foglio in 3D** apre una finestra con il foglio orbitabile (spessore della carta compreso): **Gira il foglio** mostra il retro, cioè l’impronta incavata; **Rilievo** permette di esagerare l’altezza ×2 o ×4; **Inquadra** ripristina la vista. Se la finestra resta aperta, segue le modifiche ai parametri. Senza disegno, con un preset, la finestra mostra il foglio piatto.

È una simulazione indicativa: la piega reale dipende da carta, grammatura, fibre, umidità e pressione.

Le impostazioni restano salvate nel browser; **Valori predefiniti** le azzera e riapplica preset e profilo A1.

## Materiale

Il menu **Materiale** calcola i valori di partenza per carta e matrici; tutti restano modificabili. Ordine di applicazione: preset → profilo stampante (ugello) → materiale.

| Materiale | Spessore | Rilievo massimo |
| --- | --- | --- |
| Carta 80–100 g/m² | ≈ 0,10 mm | 2 × spessore |
| Carta 120 g/m² | ≈ 0,14 mm | 2 × |
| Cartoncino 160 g/m² | ≈ 0,19 mm | 1,9 × |
| Cartoncino 200 g/m² | ≈ 0,24 mm | 1,8 × |
| Cartoncino 250 g/m² | ≈ 0,29 mm | 1,7 × |
| Cartoncino 300 g/m² (predefinito) | ≈ 0,34 mm | 1,6 × |
| Cartoncino 350 g/m² | ≈ 0,40 mm | 1,5 × |
| Carta cotone / acquerello 300 g/m² | ≈ 0,45 mm, morbida | 1,8 × |
| Spessore misurato | il valore di «Spessore carta» | 1,7 × |

Dal materiale l’app ricava:

- **spessore carta**: quello tipico (gli spessori reali variano: misura con il calibro e, se diverso, usa «Spessore misurato»);
- **gioco laterale** = spessore + 0,1 mm + tolleranza dell’ugello (0 per 0,2–0,4; 0,05 per 0,6; 0,1 per 0,8);
- **altezza rilievo** = spessore × rapporto, tra 0,3 e 0,8 mm, arrotondata **per difetto** a multipli del layer (almeno un layer): un rilievo troppo profondo costringe la carta a tirarsi dai lati e forma grinze intorno al rilievo;
- **inclinazione pareti**: 15° sotto 0,2 mm, 20° fino a 0,3 mm, 25° oltre;
- **gioco verticale** 0,1 mm.

Con «Spessore misurato», modificando lo spessore carta i valori consigliati vengono ricalcolati. Se il rilievo supera 2,2 volte lo spessore della carta compare un avviso.

Se compaiono grinze intorno al rilievo: verifica lo spessore reale della carta, riduci il rilievo, aumenta il gioco laterale e l’inclinazione, premi in modo uniforme (meglio una macchina a rulli) e prova a inumidire appena la carta.

## Stampa con Bambu Lab A1

Il profilo stampante **Bambu Lab A1** è selezionato per impostazione predefinita; il menu **Ugello** (0,4 mm predefinito) adatta i valori:

| Parametro | Ugello 0,2 | 0,4 | 0,6 | 0,8 | Perché |
| --- | --- | --- | --- | --- | --- |
| Altezza layer | 0,08 | 0,16 | 0,24 | 0,24 | Spessore piastra, rilievo, perni e battute diventano multipli del layer; la profondità di cavità e sedi viene arrotondata **per eccesso**. In Bambu Studio scegli un profilo con quell’altezza layer per il tuo ugello, o impostala a mano. |
| Inclinazione pareti | 15° | 15° | 15° | 15° | Poi sostituita da quella del materiale. Pareti a gradini di un layer. |
| Smusso punta perni | 0,24 | 0,48 | 0,48 | 0,48 | Due o tre gradini in cima ai perni per inserirli facilmente. |
| Svasatura base fori guida | 0,2 | 0,2 | 0,25 | 0,3 | Compensa l’elephant foot nei primi due layer. |
| Dettaglio minimo stampabile | 0,42 | 0,84 | 1,26 | 1,68 | Due linee d’estrusione: parti più sottili, fessure più strette e isole sottili vengono segnalate in arancione. |
| Gioco per lato perni | 0,2 | 0,2 | 0,23 | 0,25 | Più gioco con ugelli meno precisi. |

Con l’ugello 0,8 la stampa è più rapida e robusta, ma i dettagli fini del rilievo si perdono: usa tratti spessi (almeno 1,7 mm) e controlla gli avvisi.

Il profilo controlla anche che la piastra entri nel piano di 256 × 256 mm. L’export 3MF affianca positiva e negativa sul piano (in colonna se non entrano affiancate); se non entrano nemmeno così, un avviso suggerisce di stamparle separatamente.

In Bambu Studio:

- importa il 3MF: Bambu Studio può avvisare che il file non proviene da Bambu Lab e caricare solo la geometria, che è quello che serve;
- scegli l’ugello montato e un profilo di processo con l’altezza layer indicata, e il filamento (PLA o PETG);
- lascia attiva la compensazione dell’elephant foot del profilo: la svasatura dei fori agisce in aggiunta, solo dove serve;
- le piastre si stampano a faccia in su, così come sono esportate, senza supporti;
- per superfici di rilievo più nitide puoi attivare lo stiratura («ironing») sulle superfici superiori.

Scegliendo **Nessuna (valori manuali)** i parametri di stampa tornano ai valori del preset e le quote non vengono arrotondate.

## Preset personali

Nel riquadro **I miei preset**:

- **Salva impostazioni attuali** memorizza con il nome indicato tutto lo stato: preset, stampante, ugello, materiale, tutti i parametri, battute e opzioni (non il disegno). Con un nome già esistente il preset viene aggiornato;
- **Carica** riapplica un preset salvato, **Elimina** lo cancella;
- **Esporta file** scarica `embosser_preset.json` con tutti i preset; **Importa file** li aggiunge (stessi nomi sovrascritti; i file non validi vengono rifiutati).

I preset restano in questo browser: esportali per conservarli o usarli su un altro computer. Combinati con il preset **Personalizzato** e i campi **Larghezza/Altezza foglio** permettono di definire formati propri (cartoline, inviti, etichette) con ritaglio al foglio, battute e anteprima del foglio.

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
| Scala del disegno | **Da larghezza/altezza disegno**: usa i due campi. **Dimensioni reali del file SVG**: usa `width`/`height` in mm, cm, in, pt o pc e il `viewBox`; i due campi vengono disattivati. |
| Converti gli stroke in rilievi | Trasforma i contorni visibili in aree piene dello spessore indicato nell’SVG. Disattivandolo, gli stroke vengono ignorati. |
| Altezza layer | Con un valore tra 0,04 e 0,4 mm le quote diventano multipli del layer; con 0 restano libere. |
| Inclinazione pareti rilievo | Angolo rispetto alla verticale (0–60°); 0 = pareti dritte. |
| Smusso punta perni | Riduzione della punta dei perni, a gradini di un layer. |
| Svasatura base fori guida | Allargamento per lato dei fori della positiva nei primi due layer. |
| Dettaglio minimo stampabile | Larghezza sotto la quale parti e fessure vengono segnalate; 0 disattiva il controllo. |
| Inverti pieni/vuoti | Mette in rilievo i vuoti del disegno invece dei pieni. |
| Area di inversione | **Contorno esterno**: rilievo nei vuoti interni delle sagome. **Rettangolo d’ingombro**: rilievo in tutti i vuoti entro l’ingombro del disegno. |

Valori iniziali (preset Personalizzato, senza profilo stampante): piastra 100 × 70 × 2 mm, rilievo 0,8 mm, carta 0,12 mm, gioco verticale 0,1 mm, gioco laterale 0,15 mm, disegno largo 60 mm, perni 5 × 2 mm con gioco 0,30 mm per lato, nessun foglio, parametri di stampa a 0. Il profilo A1 e il materiale (cartoncino 300 g/m²), attivi per impostazione predefinita, sostituiscono i valori indicati nelle sezioni dedicate. Lo spessore piastra predefinito è 2 mm (con layer 0,16 diventa 1,92 mm); i perni sono alti quanto la piastra, altrimenti sporgerebbero dal retro della positiva a matrici chiuse (c’è un avviso). La piastra deve misurare almeno 24 × 16 mm.

### Piastra e guide

| Parametro | Predefinito | Effetto |
| --- | --- | --- |
| Raggio angoli piastra | 6 mm | 0 = angoli vivi; massimo metà del lato corto. |
| Margine di sicurezza dal bordo | 2 mm | Distanza minima di disegno e cavità dal bordo della piastra. Senza foglio, con posizione in alto o in basso il disegno resta a margine + 1 mm dal bordo. |
| Distanza centro perni dal bordo laterale | 7 mm | Posizione orizzontale dei due perni (simmetrici). |
| Spostamento verticale perni | 0 mm | Sposta entrambi i perni in alto (+) o in basso (−); unico parametro che accetta valori negativi. |
| Posizione tacca dal bordo sinistro | 12 mm | Centro della tacca di orientamento sul lato superiore della positiva. |
| Larghezza tacca sul bordo | 4 mm | Larghezza dell’intaglio sul bordo superiore. |
| Profondità tacca | 2 mm | 0 = senza tacca. La tacca deve stare sul tratto dritto del bordo, fuori dagli angoli arrotondati. |

I valori predefiniti riproducono esattamente la piastra delle versioni precedenti (verificato dal test integrato). L’app rifiuta raggi troppo grandi, tacche sugli angoli, perni che escono dalla piastra o che si sovrappongono al foglio, al disegno o alla tacca.

## Preset

| Preset | Piastra | Foglio | Note |
| --- | --- | --- | --- |
| Personalizzato | libera | dai campi Larghezza/Altezza foglio (0 = nessuno) | Senza foglio nessun ritaglio; disegno posizionato a margine + 1 mm in alto/basso. Con un foglio: ritaglio, battute e anteprima del foglio come nei preset. |
| Biglietto da visita | 130 × 70 × 2 mm, cartoncino 300 g/m² | 85 × 55 mm, centrato | Il perimetro rosso del foglio è solo una guida di anteprima e non viene esportato. Le parti del disegno oltre il foglio vengono tagliate senza deformazione; perni e fori devono restare fuori dal foglio. La cavità conserva il gioco laterale anche al bordo del foglio. |

Scegliere un preset imposta i suoi valori iniziali, che restano modificabili.

La profondità della cavità è calcolata come:

```text
profondità = altezza rilievo + spessore carta + gioco verticale
```

L’app blocca la generazione se questa profondità è maggiore o uguale allo spessore della piastra meno 0,4 mm. Controlla anche che il disegno e la cavità non superino i margini o interferiscano con le guide. Questi controlli non garantiscono la resistenza meccanica o la compatibilità con ogni pressa.


### J card per musicassetta

Il preset **J card musicassetta** goffra solo il **pannello frontale** di 101,6 × 63,5 mm (4" × 2,5"), con il dorso sul lato superiore. Le misure sono quelle standard: verificale sul template del tuo stampatore e, se diverse, modifica il preset in `js/config.js`.

- Piastra 130 × 80 mm: dorso e aletta escono liberi oltre il bordo superiore della piastra. Sulla A1 le due piastre vanno in colonna nel 3MF.
- Materiale iniziale: cartoncino 250 g/m² (circa 0,29 mm; misuralo e scegli il materiale corretto). Con ugello 0,4: rilievo 0,48 mm, gioco laterale 0,39 mm, pareti a 20°.
- Battute di riscontro agli **angoli inferiori**, così il dorso non incontra ostacoli.
- Avviso se il disegno arriva a meno di 3 mm dal bordo o dalla piega del dorso.
- Ordine consigliato: stampa → goffratura → cordonatura e piega.
- Prima di stampare le matrici definitive, prova che la custodia si chiuda con la J card goffrata: tra fronte e coperchio lo spazio è poco.

## Battute di riscontro

Con un preset che definisce il foglio, le battute sono piccoli rilievi a «L» sulla positiva, appena fuori dagli angoli del foglio: la carta si appoggia contro di esse, così la goffratura cade sempre nello stesso punto (indispensabile se deve combaciare con una grafica stampata). Sulla negativa ci sono le sedi corrispondenti, allargate del gioco e profonde quanto basta perché le matrici si chiudano.

| Parametro | Predefinito | Effetto |
| --- | --- | --- |
| Battute | J card: angoli inferiori; altri preset: nessuna | **Angoli inferiori**: due L in basso; **Quattro angoli**: quattro L. Non disponibili senza foglio. |
| Lunghezza bracci | 10 mm | Lunghezza di ciascun braccio lungo il bordo del foglio. |
| Spessore battute | 2 mm | Larghezza dei bracci. |
| Altezza battute | 1,2 mm | Arrotondata a multipli del layer (con la A1: 1,12 mm); deve superare lo spessore della carta. |
| Distanza dal foglio | 0,2 mm | Gioco tra carta e battuta. |
| Gioco sedi sulla negativa | 0,3 mm | Allargamento delle sedi; profondità = altezza battute + gioco verticale, arrotondata per eccesso al layer. |

L’app rifiuta battute fuori dalla piastra o nella tacca, sovrapposte ai fori guida o con sedi sopra i perni, e avvisa se con la J card scegli i quattro angoli (il dorso urterebbe le battute superiori). Battute e sedi compaiono nella pianta, nell’anteprima 3D e nei file esportati.

## Preparare l’SVG

- Usa forme vettoriali riempite. Un’area riempita diventa un rilievo sulla positiva e una cavità sulla negativa.
- I fori del disegno restano vuoti nel rilievo e corrispondono a isole nella negativa. Una cornice, ad esempio, deve produrre un rilievo e una cavità ad anello.
- Converti i testi in tracciati.
- Gli stroke visibili vengono convertiti in aree piene (spessore, estremità `stroke-linecap` e raccordi `stroke-linejoin`); i tratteggi vengono ignorati e convertiti come linee continue, con un avviso.
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

Le coordinate vengono uniformate su una griglia di 0,0001 mm. Le giunzioni a T rilevate vengono suddivise prima della verifica: ogni spigolo viene diviso in una volta in tutti i punti che giacciono su di esso. Se restano difetti, l’export viene bloccato e il messaggio distingue **Positiva** e **Negativa**, mostrando fino a quattro spigoli problematici con coordinate e conteggio delle facce. La console contiene l’elenco completo rilevato.

Il superamento del controllo non è una certificazione completa: non rileva ogni possibile auto-intersezione, errore di interpretazione dell’SVG o problema di stampa. Verifica comunque gli STL nello slicer.

### Test integrato

Il pulsante **Test integrato** esegue nel browser una serie di controlli, senza sostituire il disegno caricato né modificare gli STL già generati:

- interpretazione dell’SVG: `fill-rule`, stili CSS, forme nascoste o senza riempimento, definizioni inutilizzate accettate ed elementi non supportati rifiutati;
- stroke chiusi, aperti e scalati da trasformazioni; lettura delle dimensioni reali dell’SVG;
- cornice quadrata con foro, in modalità originale e con le due inversioni, a varie larghezze e giochi laterali;
- molti contorni con il fondo allineato sulla stessa retta, senza e con profilo A1;
- profilo A1: quote multiple del layer, effetto dell’inclinazione sui volumi, rifiuto di piastre oltre il piano, rilevamento di parti sottili e fessure strette;
- preset biglietto da visita: ritaglio al foglio, guide fuori dal foglio, angoli R6, tacca e specchiatura;
- preset J card con battute agli angoli inferiori e ai quattro angoli, posizione delle battute, sedi, quote a layer, rifiuto delle battute sovrapposte ai fori e avvisi su piega e dorso;
- simulazione del foglio: altezze al centro e agli angoli, piega sul bordo, fori del rilievo piatti, foglio senza preset;
- piastra e guide personalizzate (angoli vivi, senza tacca, perni spostati), rifiuto delle geometrie non valide e coincidenza dei valori predefiniti con la piastra storica;
- controllo di spigoli e volume su tutte le mesh generate.

L’esito atteso inizia con:

```text
Test superato: 74 mesh controllate.
```

Se dopo un deploy compare ancora la vecchia interfaccia, forza il ricaricamento del browser. La versione attuale mostra `materiali-1` nel messaggio di stato.

## File esportati

- `embosser_positivo.stl`: piastra con rilievo e fori guida passanti.
- `embosser_negativo.stl`: piastra con cavità, eventuali isole e perni di registrazione.
- `embosser_matrici.3mf`: le due piastre come oggetti separati «Positiva» e «Negativa», disposte sul piano di stampa del profilo (256 × 256 mm per la A1).

## Struttura e dipendenze

Non richiede una fase di build: `index.html` carica script classici (non moduli ES), che funzionano anche da `file://`. Ogni file aggiunge il proprio modulo al namespace globale `Embosser`.

| File | Contenuto | Dove gira |
| --- | --- | --- |
| `js/config.js` | Revisione, parametri con valori iniziali, preset, profili stampante | pagina e worker |
| `js/geometry.js` | Operazioni 2D con Clipper: unione, differenza, offset, piastra con angoli e tacca configurabili, inversione, ritaglio al foglio | pagina e worker |
| `js/mesh.js` | Mesh a strati, triangolazione dei tappi, riparazione delle giunzioni a T, verifica, scrittura STL binario | pagina e worker |
| `js/model.js` | Posizionamento del disegno, controlli su guide e margini, generazione delle due matrici, test geometrici; nessun accesso al DOM | pagina e worker |
| `js/svg.js` | Lettura dell’SVG: stili CSS, `fill-rule`, stroke, dimensioni reali, elementi non supportati, test di interpretazione | solo pagina (serve `DOMParser`) |
| `js/export3mf.js` | Archivio 3MF (ZIP senza compressione) con le due piastre disposte sul piano | pagina |
| `js/engine.js` | Invio dei calcoli al worker, annullamento del calcolo superato da una modifica più recente, ripiego nella pagina | pagina |
| `js/worker.js` | Web Worker che esegue generazione e test geometrici | worker |
| `js/viewer.js` | Anteprima 3D Three.js | pagina |
| `js/sheet.js` | Simulazione del foglio goffrato (mappa di altezze con trasformata di distanza), anteprima con luce radente, finestra 3D | pagina |
| `js/plan.js` | Pianta 2D in SVG inline; pianta della sola piastra quando non c’è un disegno | pagina |
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

Vengono verificati l’avvio senza errori, l’uso effettivo del worker e il ripiego da `file://`, il test integrato in entrambe le modalità, l’export di STL binari validi, l’export 3MF (struttura dell’archivio, due oggetti chiusi, posizione sul piano), il profilo A1, la conversione degli stroke, gli avvisi sui dettagli sottili, il salvataggio delle impostazioni, il trascinamento del file, la pianta 2D e i parametri di piastra e guide, l’anteprima e la finestra 3D del foglio, il preset J card e le battute di riscontro, materiale e ugello, i preset personali con esportazione e importazione, la propagazione degli errori dal worker, l’annullamento dei calcoli superati e i messaggi d’errore dei parametri. Il workflow `.github/workflows/test.yml` esegue gli stessi test a ogni push e pull request.

## GitHub Pages

Per pubblicare direttamente l’app dalla repository (`index.html` e cartella `js/`), configura **Settings → Pages → Deploy from a branch**, selezionando `main` e `/ (root)`. `index.html` è la pagina iniziale.

## Licenza

MIT. Le dipendenze di terze parti mantengono le rispettive licenze.
