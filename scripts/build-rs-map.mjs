// Builds src/lib/maps/rs-municipios.json, the outline of each Rio Grande do Sul
// municipality as an SVG path, for the map in Indicadores.
//
// Source: IBGE municipal mesh via github.com/tbrugz/geodata-br (geojs-43-mun.json).
//   npx mapshaper geojs-43-mun.json -simplify 25% keep-shapes \
//     -o format=geojson precision=0.0001 rs-simplified.json
//   node scripts/build-rs-map.mjs rs-simplified.json
import { readFileSync, writeFileSync } from "node:fs";

const source = JSON.parse(readFileSync(process.argv[2], "utf8"));
const WIDTH = 1000;
const rings = (geometry) =>
  geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();

let minX = Infinity,
  maxX = -Infinity,
  minY = Infinity,
  maxY = -Infinity;
for (const f of source.features)
  for (const ring of rings(f.geometry))
    for (const [lon, lat] of ring) {
      minX = Math.min(minX, lon);
      maxX = Math.max(maxX, lon);
      minY = Math.min(minY, lat);
      maxY = Math.max(maxY, lat);
    }
// Equirectangular, corrected for the state's mean latitude.
const k = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
const scale = WIDTH / ((maxX - minX) * k);
const height = Math.ceil((maxY - minY) * scale);
const point = ([lon, lat]) =>
  `${((lon - minX) * k * scale).toFixed(1)} ${((maxY - lat) * scale).toFixed(1)}`;

const cities = source.features
  .map((f) => ({
    id: f.properties.id,
    name: f.properties.name,
    d: rings(f.geometry)
      .map((ring) => `M${ring.slice(0, -1).map(point).join("L")}Z`)
      .join(""),
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
writeFileSync(
  new URL("../src/lib/maps/rs-municipios.json", import.meta.url),
  JSON.stringify({ width: WIDTH, height, cities }),
);
console.log(`${cities.length} municípios, ${WIDTH}x${height}`);
