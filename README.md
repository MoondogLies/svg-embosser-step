# SVG → STEP Embosser

Generatore web per creare una coppia di matrici 3D — positiva e negativa — a partire da un file SVG, destinate all'embossing su carta.

## Caratteristiche

- Anteprima 3D interattiva delle due matrici
- Importazione SVG con forme riempite
- Generazione B-Rep tramite OpenCascade.js
- Esportazione STEP della matrice positiva e negativa
- Perni di registrazione automatici
- Regolazione di dimensioni, rilievo, gioco e spessore carta

## Avvio locale

```bash
python3 -m http.server 8000
```

Aprire poi:

```text
http://localhost:8000/embosser-step.html
```

## File generati

- `embosser_positivo.step`: matrice con rilievo e tasche di registrazione
- `embosser_negativo.step`: matrice con cavità e perni di registrazione

## Licenza

MIT