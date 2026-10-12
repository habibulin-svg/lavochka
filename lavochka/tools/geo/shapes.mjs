// Контуры для «Географии»: Natural Earth 1:10m → упрощённый TopoJSON в public/geo/ + список объектов data/raw.json для wiki.py.
// Запуск (из lavochka/): node tools/geo/shapes.mjs   — исходники Natural Earth качает сам в tools/geo/data (не в git).
// Слои: world (страны, зависимые территории, непризнанные), ru (субъекты РФ), us (штаты), regions (регионы крупных стран — объект на страну).
// id объекта: страна — ADM0_A3 из Natural Earth (RUS, FRA…), регион — ISO 3166-2 (RU-TA, US-CA, DE-BY) или свой код для слитых областей.
// Кусочки без своего объекта (ледники, банки, буферные зоны) идут с id «_…» — рисуются фоном.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
const OUT = path.join(HERE, '../../public/geo');
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

function load(name) {
  const file = path.join(DATA, name + '.geojson');
  if (!fs.existsSync(file) || fs.statSync(file).size < 1000) execFileSync('curl', ['-sSL', '-o', file, NE + name + '.geojson'], { stdio: 'inherit' });
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const countries = load('ne_10m_admin_0_countries');
const disputed = load('ne_10m_admin_0_disputed_areas');
const admin1 = load('ne_10m_admin_1_states_provinces');

/** Объекты для wiki.py: id, qid, слой, русское имя из NE (запасное), континент NE, суверен. */
const raw = [];
const feat = (id, geometry) => ({ type: 'Feature', properties: { id }, geometry });

// ---------------------------------------------------------------- мир

// фон: не страны и не территории со своим флагом
const JUNK = new Set(['USG', 'BRI', 'CNM', 'KAS', 'KAB', 'SPI', 'BRT', 'ATA', 'PGA', 'BJN', 'SER', 'SCR', 'CSI', 'ATC', 'UMI', 'ESB', 'WSB', 'CLP', 'HMD']);
const SOV = { GB1: 'GBR', FR1: 'FRA', US1: 'USA', AU1: 'AUS', NZ1: 'NZL', DN1: 'DNK', FI1: 'FIN', NL1: 'NLD', CH1: 'CHN', IS1: 'ISR', KA1: 'KAZ', CU1: 'CUB' };
const world = [];
const ovl = [];
for (const f of countries.features) {
  const p = f.properties;
  const id = p.ADM0_A3;
  if (JUNK.has(id) || !p.WIKIDATAID) {
    world.push(feat('_' + id, f.geometry));
    continue;
  }
  // Россия и Украина на карте мира собираются из регионов (ниже) — по Конституции РФ
  if (id !== 'RUS' && id !== 'UKR') world.push(feat(id, f.geometry));
  raw.push({ id, qid: p.WIKIDATAID, layer: 'world', ne: p.NAME_RU, en: p.NAME_EN, cont: p.CONTINENT, sub: p.SUBREGION, sov: SOV[p.SOV_A3] ?? p.SOV_A3, type: p.TYPE });
}
// непризнанные внутри других стран — отдельными накладками поверх
const OVERLAY = { Abkhazia: 'ABH', 'South Ossetia': 'OSS', Transnistria: 'PMR' };
for (const f of disputed.features) {
  const p = f.properties;
  const id = OVERLAY[p.BRK_NAME];
  if (!id) continue;
  ovl.push(feat(id, f.geometry));
  raw.push({ id, qid: p.WIKIDATAID, layer: 'world', ne: p.NAME_RU, en: p.BRK_NAME, cont: id === 'PMR' ? 'Europe' : 'Asia', sov: p.SOV_A3, type: 'Breakaway', overlay: true });
}

// ---------------------------------------------------------------- регионы

const A1 = {};
for (const f of admin1.features) (A1[f.properties.adm0_a3] ??= []).push(f);

/** Регионы страны как есть (по ISO-коду); кусочки без кода и Викиданных — фон. Дубли кода (острова) сливаются. */
function direct(cc, fix = {}) {
  const out = [];
  const seen = new Set();
  for (const f of A1[cc]) {
    const p = f.properties;
    let id = p.iso_3166_2;
    let qid = p.wikidataid;
    if (fix[id]) ({ id, qid } = { id, ...fix[id] });
    if (!id || id.includes('~') || !qid) {
      out.push(feat('_' + (id || cc), f.geometry));
      continue;
    }
    out.push(feat(id, f.geometry));
    if (!seen.has(id)) raw.push({ id, qid, layer: cc, ne: p.name_ru, en: p.name_en || p.name, cont: '', sov: cc, type: p.type_en });
    seen.add(id);
  }
  return out;
}

/** Регионы, собранные из более мелких частей (департаменты → регионы): по полю NE; qid ищется по enwiki-статье. */
function merged(cc, field, table) {
  const out = [];
  for (const f of A1[cc]) {
    const t = table[f.properties[field]];
    out.push(feat(t ? t[0] : '_' + cc, f.geometry));
  }
  for (const [ne, [id, enwiki]] of Object.entries(table)) raw.push({ id, enwiki, layer: cc, ne, en: ne, cont: '', sov: cc, type: 'region' });
  return out;
}

const FR = {
  'Hauts-de-France': ['FR-HDF', 'Hauts-de-France'],
  'Grand Est': ['FR-GES', 'Grand Est'],
  "Provence-Alpes-Côte-d'Azur": ['FR-PAC', "Provence-Alpes-Côte d'Azur"],
  'Auvergne-Rhône-Alpes': ['FR-ARA', 'Auvergne-Rhône-Alpes'],
  'Nouvelle-Aquitaine': ['FR-NAQ', 'Nouvelle-Aquitaine'],
  Occitanie: ['FR-OCC', 'Occitania (administrative region)'],
  'Bourgogne-Franche-Comté': ['FR-BFC', 'Bourgogne-Franche-Comté'],
  'Pays de la Loire': ['FR-PDL', 'Pays de la Loire'],
  Bretagne: ['FR-BRE', 'Brittany (administrative region)'],
  Normandie: ['FR-NOR', 'Normandy (administrative region)'],
  Corse: ['FR-COR', 'Corsica'],
  'Centre-Val de Loire': ['FR-CVL', 'Centre-Val de Loire'],
  'Île-de-France': ['FR-IDF', 'Île-de-France'],
  'Guyane française': ['FR-GF', 'French Guiana'],
  Martinique: ['FR-MQ', 'Martinique'],
  Guadeloupe: ['FR-GP', 'Guadeloupe'],
  Réunion: ['FR-RE', 'Réunion'],
  Mayotte: ['FR-YT', 'Mayotte'],
};
const IT = {
  "Valle d'Aosta": ['IT-23', 'Aosta Valley'],
  Piemonte: ['IT-21', 'Piedmont'],
  Lombardia: ['IT-25', 'Lombardy'],
  'Trentino-Alto Adige': ['IT-32', 'Trentino-Alto Adige/Südtirol'],
  Liguria: ['IT-42', 'Liguria'],
  'Emilia-Romagna': ['IT-45', 'Emilia-Romagna'],
  Marche: ['IT-57', 'Marche'],
  Veneto: ['IT-34', 'Veneto'],
  'Friuli-Venezia Giulia': ['IT-36', 'Friuli-Venezia Giulia'],
  Abruzzo: ['IT-65', 'Abruzzo'],
  Molise: ['IT-67', 'Molise'],
  Apulia: ['IT-75', 'Apulia'],
  Basilicata: ['IT-77', 'Basilicata'],
  Calabria: ['IT-78', 'Calabria'],
  Campania: ['IT-72', 'Campania'],
  Lazio: ['IT-62', 'Lazio'],
  Toscana: ['IT-52', 'Tuscany'],
  Sicily: ['IT-82', 'Sicily'],
  Sardegna: ['IT-88', 'Sardinia'],
  Umbria: ['IT-55', 'Umbria'],
};
const ES = {
  Ceuta: ['ES-CE', 'Ceuta'],
  Melilla: ['ES-ML', 'Melilla'],
  'Foral de Navarra': ['ES-NC', 'Navarre'],
  'País Vasco': ['ES-PV', 'Basque Country (autonomous community)'],
  Aragón: ['ES-AR', 'Aragon'],
  Cataluña: ['ES-CT', 'Catalonia'],
  Extremadura: ['ES-EX', 'Extremadura'],
  Andalucía: ['ES-AN', 'Andalusia'],
  Galicia: ['ES-GA', 'Galicia (Spain)'],
  'Castilla y León': ['ES-CL', 'Castile and León'],
  Valenciana: ['ES-VC', 'Valencian Community'],
  Murcia: ['ES-MC', 'Region of Murcia'],
  Asturias: ['ES-AS', 'Asturias'],
  Cantabria: ['ES-CB', 'Cantabria'],
  'Canary Is.': ['ES-CN', 'Canary Islands'],
  'Islas Baleares': ['ES-IB', 'Balearic Islands'],
  'La Rioja': ['ES-RI', 'La Rioja'],
  'Castilla-La Mancha': ['ES-CM', 'Castilla–La Mancha'],
  Madrid: ['ES-MD', 'Community of Madrid'],
};
const GB = {
  England: ['GB-ENG', 'England'],
  Scotland: ['GB-SCT', 'Scotland'],
  Wales: ['GB-WLS', 'Wales'],
  'Northern Ireland': ['GB-NIR', 'Northern Ireland'],
};

// РФ: Крым и Севастополь в NE у RUS под украинскими кодами; Алтайский край подписан как Республика Алтай
const ru = direct('RUS', { 'UA-43': { id: 'RU-CR', qid: 'Q15966495' }, 'UA-40': { id: 'RU-SEV', qid: 'Q7525' }, 'RU-ALT': { id: 'RU-ALT', qid: 'Q5942' } });
// субъекты РФ по Конституции (2022): области целиком — из украинского admin-1 Natural Earth
const NEW_RU = { 'UA-14': ['RU-DPR', 'Q16150196'], 'UA-09': ['RU-LPR', 'Q16746854'], 'UA-23': ['RU-ZAP', 'Q111710700'], 'UA-65': ['RU-KHE', 'Q111686059'] };
for (const f of A1.UKR) {
  const n = NEW_RU[f.properties.iso_3166_2];
  if (!n) continue;
  ru.push(feat(n[0], f.geometry));
  raw.push({ id: n[0], qid: n[1], layer: 'RUS', ne: f.properties.name_ru, en: f.properties.name_en, cont: '', sov: 'RUS', type: 'region' });
}
// мир: Россия — все её субъекты, Украина — остальные области (одинаковые id сливает dissolve2)
for (const f of A1.RUS) world.push(feat('RUS', f.geometry));
for (const f of A1.UKR) world.push(feat(NEW_RU[f.properties.iso_3166_2] ? 'RUS' : 'UKR', f.geometry));
const us = direct('USA');
const regions = {
  de: direct('DEU'),
  fr: merged('FRA', 'region', FR),
  it: merged('ITA', 'region', IT),
  es: merged('ESP', 'region', ES),
  gb: merged('GBR', 'geonunit', GB),
  ch: direct('CHE'),
  at: direct('AUT'),
  ca: direct('CAN'),
  au: direct('AUS'),
  br: direct('BRA'),
  mx: direct('MEX', { 'MX-DIF': { id: 'MX-CMX', qid: 'Q1489' }, 'MX-MEX': { id: 'MX-MEX', qid: 'Q82112' } }),
};

// ---------------------------------------------------------------- mapshaper

const ms = (args) => execFileSync('npx', ['-y', '-p', 'mapshaper@0.6', 'mapshaper', ...args], { stdio: 'inherit', shell: true });

function build(name, layers, simplify) {
  const inputs = [];
  for (const [lname, feats] of Object.entries(layers)) {
    const f = path.join(DATA, `in-${lname}.geojson`);
    fs.writeFileSync(f, JSON.stringify({ type: 'FeatureCollection', features: feats }));
    inputs.push(f);
  }
  const out = path.join(OUT, name + '.json');
  // каждый слой — отдельный объект TopoJSON с общими дугами; одинаковые id сливаются (острова одного региона)
  ms(['-i', ...inputs, 'combine-files', '-dissolve2', 'id', 'copy-fields=id', 'target=*', '-simplify', simplify, 'weighted', 'keep-shapes', 'target=*', '-clean', 'target=*', '-o', out, 'format=topojson', 'quantization=100000', 'id-field=id', 'target=*']);
  console.log(name, (fs.statSync(out).size / 1024).toFixed(0), 'KB');
}

build('world', { world, ovl }, '6%');

// мелочь (острова, карлики, кантоны) в общих слоях упрощается до треугольников — для контуров и крупного масштаба отдельный подробный слой
function span(g) {
  let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
  const walk = (c) => (typeof c[0] === 'number' ? ((x0 = Math.min(x0, c[0])), (x1 = Math.max(x1, c[0])), (y0 = Math.min(y0, c[1])), (y1 = Math.max(y1, c[1]))) : c.forEach(walk));
  walk(g.coordinates);
  return Math.max(x1 - x0, y1 - y0);
}
const detail = [world, ovl, ru, us, ...Object.values(regions)].flat().filter((f) => !f.properties.id.startsWith('_') && span(f.geometry) < 4);
build('detail', { detail }, '35%');
build('ru', { ru }, '10%');
build('us', { us }, '10%');
build('regions', regions, '8%');

fs.writeFileSync(path.join(DATA, 'raw.json'), JSON.stringify(raw, null, 1));
console.log('объектов:', raw.length);
