// Export 3MF (specifica core): entrambe le piastre come oggetti separati, già disposte sul piano di stampa.
// Bambu Studio importa il file come geometria; le impostazioni di stampa restano quelle del profilo scelto nello slicer.
'use strict';
(function (E) {
  const CRC = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // Archivio ZIP senza compressione (metodo "store").
  function zip(files) {
    const enc = new TextEncoder(),
      parts = [],
      central = [];
    let offset = 0;
    for (const { name, data } of files) {
      const nameBytes = enc.encode(name),
        bytes = typeof data === 'string' ? enc.encode(data) : data,
        crc = crc32(bytes);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(8, 0, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, bytes.length, true);
      local.setUint32(22, bytes.length, true);
      local.setUint16(26, nameBytes.length, true);
      parts.push(local.buffer, nameBytes, bytes);
      const dir = new DataView(new ArrayBuffer(46));
      dir.setUint32(0, 0x02014b50, true);
      dir.setUint16(4, 20, true);
      dir.setUint16(6, 20, true);
      dir.setUint32(16, crc, true);
      dir.setUint32(20, bytes.length, true);
      dir.setUint32(24, bytes.length, true);
      dir.setUint16(28, nameBytes.length, true);
      dir.setUint32(42, offset, true);
      central.push(dir.buffer, nameBytes);
      offset += 30 + nameBytes.length + bytes.length;
    }
    const size = central.reduce((n, p) => n + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'model/3mf' });
  }

  // Float32Array di triangoli → vertici indicizzati e triangoli in XML 3MF.
  function meshXml(f) {
    const index = new Map(),
      vertices = [],
      triangles = [];
    const id = (i) => {
      const key = f[i] + ',' + f[i + 1] + ',' + f[i + 2];
      let v = index.get(key);
      if (v === undefined) {
        v = vertices.length;
        index.set(key, v);
        vertices.push('<vertex x="' + f[i] + '" y="' + f[i + 1] + '" z="' + f[i + 2] + '"/>');
      }
      return v;
    };
    for (let i = 0; i < f.length; i += 9) {
      const a = id(i),
        b = id(i + 3),
        c = id(i + 6);
      if (a !== b && b !== c && a !== c) triangles.push('<triangle v1="' + a + '" v2="' + b + '" v3="' + c + '"/>');
    }
    return '<mesh><vertices>' + vertices.join('') + '</vertices><triangles>' + triangles.join('') + '</triangles></mesh>';
  }

  // Disposizione sul piano: affiancate in X se c'è spazio, altrimenti in colonna, altrimenti affiancate fuori piano (con avviso).
  function layout(size, bed, gap = 10) {
    const [w, h] = size,
      cx = bed.w / 2,
      cy = bed.h / 2;
    if (2 * w + gap <= bed.w && h <= bed.h) return { fits: true, at: [[cx - (w + gap) / 2, cy], [cx + (w + gap) / 2, cy]] };
    if (2 * h + gap <= bed.h && w <= bed.w) return { fits: true, at: [[cx, cy + (h + gap) / 2], [cx, cy - (h + gap) / 2]] };
    return { fits: false, at: [[cx - (w + gap) / 2, cy], [cx + (w + gap) / 2, cy]] };
  }

  // parts: [{ name, vertices: Float32Array }]; size: [w, h] della piastra; bed: {w, h}.
  // assembled: un solo oggetto già composto (piastre con cerniera), centrato sul piano; size è il suo ingombro.
  function build3mf(parts, size, bed, assembled = false) {
    const place = assembled
      ? { fits: size[0] <= bed.w && size[1] <= bed.h, at: [[bed.w / 2, bed.h / 2]] }
      : layout(size, bed);
    const objects = parts
      .map((p, i) => '<object id="' + (i + 1) + '" name="' + p.name + '" type="model">' + meshXml(p.vertices) + '</object>')
      .join('');
    const items = parts
      .map((p, i) => '<item objectid="' + (i + 1) + '" transform="1 0 0 0 1 0 0 0 1 ' + place.at[i][0] + ' ' + place.at[i][1] + ' 0"/>')
      .join('');
    const model =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<model unit="millimeter" xml:lang="it-IT" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
      '<metadata name="Title">Matrici embossing</metadata><metadata name="Application">SVG → STL embosser ' + E.VERSION + '</metadata>' +
      '<resources>' + objects + '</resources><build>' + items + '</build></model>';
    const blob = zip([
      {
        name: '[Content_Types].xml',
        data:
          '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
      },
      {
        name: '_rels/.rels',
        data:
          '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      },
      { name: '3D/3dmodel.model', data: model },
    ]);
    return { blob, fits: place.fits };
  }

  E.export3mf = { build3mf, layout, crc32 };
})((self.Embosser = self.Embosser || {}));
