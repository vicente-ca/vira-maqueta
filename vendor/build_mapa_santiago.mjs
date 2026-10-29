// Arma vendor/mapa_santiago.js: estilo positron + teselas vectoriales de un sector de Santiago
// + tipografías + sprite, todo embebido para que el mapa funcione sin internet y con doble clic (file://).
import fs from 'node:fs';
import zlib from 'node:zlib';

const OUT = process.argv[2];
const BBOX = { w: -70.676, e: -70.590, s: -33.470, n: -33.430 }; // cubre los tres trayectos con margen
const ZOOMS = [12, 13, 14]; // el mapa no se aleja más allá de z12; sobre z14 MapLibre agranda las de z14
const FONTS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];
const RANGES = ['0-255', '256-511', '8192-8447'];

const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
const get = async (url, kind = 'buf') => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url);
    if (r.ok) return kind === 'json' ? r.json() : Buffer.from(await r.arrayBuffer());
    if (r.status === 404) return null;
    await new Promise(res => setTimeout(res, 800));
  }
  throw new Error('fallo ' + url);
};

const style = await get('https://tiles.openfreemap.org/styles/positron', 'json');
const tj = await get(style.sources.openmaptiles.url, 'json');
const tileTpl = tj.tiles[0];
const GLYPHS = style.glyphs, SPRITE = style.sprite;

// Una tesela vectorial es una lista de capas (campo 3 del protobuf). Se quedan solo las que el estilo dibuja:
// poi, housenumber y mountain_peak pesan casi la mitad y positron no las usa.
const USED = new Set(style.layers.map(l => l['source-layer']).filter(Boolean));
const varint = (b, i) => { let r = 0, s = 0, c; do { c = b[i++]; r += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80); return [r, i]; };
function keepUsedLayers(b) {
  const parts = [];
  let i = 0;
  while (i < b.length) {
    const start = i; let tag, len;
    [tag, i] = varint(b, i); [len, i] = varint(b, i);
    const layer = b.subarray(i, i + len); i += len;
    let j = 0, name = '';
    while (j < layer.length && !name) {
      let t; [t, j] = varint(layer, j);
      if ((t & 7) === 2) { let l; [l, j] = varint(layer, j); if (t >> 3 === 1) name = layer.subarray(j, j + l).toString(); j += l; }
      else [, j] = varint(layer, j);
    }
    if (USED.has(name)) parts.push(b.subarray(start, i));
  }
  return Buffer.concat(parts);
}

const tiles = {};
let bytes = 0;
for (const z of ZOOMS) {
  const [x0, x1, y0, y1] = [lon2x(BBOX.w, z), lon2x(BBOX.e, z), lat2y(BBOX.n, z), lat2y(BBOX.s, z)];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const b = await get(tileTpl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    if (b) { const gz = zlib.gzipSync(keepUsedLayers(b), { level: 9 }); tiles[`${z}/${x}/${y}`] = gz.toString('base64'); bytes += gz.length; }
  }
  console.error(`z${z}: ${(x1 - x0 + 1) * (y1 - y0 + 1)} teselas`);
}

const fonts = {};
for (const f of FONTS) for (const r of RANGES) {
  const b = await get(style.glyphs.replace('{fontstack}', encodeURIComponent(f)).replace('{range}', r));
  if (b) fonts[`${f}/${r}`] = zlib.gzipSync(b, { level: 9 }).toString('base64');
}

const sprite = {};
for (const s of ['', '@2x']) {
  sprite[`ofm${s}.json`] = await get(`${style.sprite}${s}.json`, 'json');
  sprite[`ofm${s}.png`] = (await get(`${style.sprite}${s}.png`)).toString('base64');
}

// Fuentes del estilo apuntando al protocolo vira:// (lo atiende index.html)
delete style.sources.ne2_shaded;
style.layers = style.layers.filter(l => l.source !== 'ne2_shaded');
style.sources.openmaptiles = { type: 'vector', tiles: ['vira://t/{z}/{x}/{y}'], minzoom: 0, maxzoom: tj.maxzoom, attribution: tj.attribution };
style.glyphs = 'vira://fonts/{fontstack}/{range}';
style.sprite = 'vira://sprite/ofm';

const bundle = {
  gzip: true, creado: new Date().toISOString().slice(0, 10), bbox: BBOX, zooms: ZOOMS,
  remoto: { tiles: tileTpl, glyphs: GLYPHS, sprite: SPRITE },
  style, tiles, fonts, sprite,
};
fs.writeFileSync(OUT, '/* Mapa base de un sector de Santiago para la maqueta Vira. Datos © OpenStreetMap, teselas © OpenMapTiles vía OpenFreeMap. Generado por build_mapa_santiago.mjs */\nwindow.VIRA_MAPA=' + JSON.stringify(bundle) + ';\n');
console.error(`teselas: ${Object.keys(tiles).length} (${(bytes / 1e6).toFixed(2)} MB) · tipografías: ${Object.keys(fonts).length} · archivo: ${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB`);
