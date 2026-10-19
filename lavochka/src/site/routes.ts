/* Адреса сайта (без DOM: их читают роутер в браузере, пререндер при сборке, сервер и тесты).
 * Игры — в корне, транслитом: /nardy/, вариант со своим спросом — /nardy/dlinnye/, правила — /nardy/pravila/.
 * Сетевой стол — /stol/<код>, локальная партия — адрес игры с ?igra (оба noindex). */

export const SITE_URL = 'https://lavochka-games.ru';
export const SITE_NAME = 'Вечером на лавочке';

/** Адрес карточки каталога (id → путь без слэшей по краям). Каждая карточка каталога должна быть здесь. */
export const SLUGS: Record<string, string> = {
  // доска и кости
  shishbesh: 'shish-besh',
  nardy: 'nardy',
  chess: 'shahmaty',
  checkers: 'shashki',
  go: 'go',
  renju: 'rendzyu',
  mancala: 'mankala',
  domino: 'domino',
  mahjong: 'madzhong',
  mahjong4: 'madzhong-vchetverom',
  yahtzee: 'yahtzi',
  loto: 'loto',
  perudo: 'perudo',
  // карты
  durak: 'durak',
  thousand: 'tysyacha',
  '101': '101',
  bura: 'bura',
  preferans: 'preferans',
  bridge: 'bridzh',
  pokers: 'poker',
  holdem: 'poker/tehasskiy-holdem',
  poker: 'poker/omaha',
  drunkard: 'pyanica',
  bluff: 'verju-ne-verju',
  sunduchok: 'sunduchok',
  akulina: 'akulina',
  devyatka: 'devyatka',
  hearts: 'chervi',
  king: 'king',
  raspisnoy: 'raspisnoy-poker',
  kozel: 'kozel',
  khrap: 'hrap',
  ochko: 'ochko',
  seka: 'seka',
  govno: 'govno',
  solitaire: 'pasyans',
  // компанией
  spy: 'shpion',
  whoami: 'kto-ya',
  danetki: 'danetki',
  hat: 'shlyapa',
  crocodile: 'krokodil',
  'secret-hitler': 'taynyy-gitler',
  cah: 'karty-protiv-chelovechestva',
  mafia: 'mafiya',
  // на бумаге
  seabattle: 'morskoy-boy',
  dots: 'tochki',
  ttt: 'krestiki-noliki',
  hangman: 'viselica',
  paperball: 'futbol-na-bumage',
  balda: 'balda',
  erudit: 'erudit',
  // головоломки
  geo: 'geografiya',
  dvor: 'a-u-nas-vo-dvore',
  puzzles: 'krossvordy-i-sudoku',
  saper: 'saper',
  g2048: '2048',
  pipes: 'vodoprovodchik',
  detektiv: 'detektivy',
  // настолки
  adventures: 'priklyucheniya',
  hodilki: 'kin-dvin',
  shel: 'shel-soldat',
  star: 'zvezda-afriki',
  korona: 'korona-embera',
  magiya: 'magiya',
  djio: 'dzhio-dzhangi',
  astro: 'astronavty',
  beglye: 'beglye',
  kupi: 'kupi-prodai',
  manager: 'menedzher',
  vorona: 'belaya-vorona',
  western: 'vestern',
  akcii: 'akcionery',
  sea: 'morskie-strategii',
  zakoldovannaya: 'zakoldovannaya-strana',
  // настольный спорт
  billiards: 'bilyard',
  hockey: 'nastolnyy-hokkey',
  football: 'nastolnyy-futbol',
  basketball: 'nastolnyy-basketbol',
  zarulem: 'za-rulem',
  // электроника
  elektronika: 'elektronika',
  brick: 'brick-game',
  avtomaty: 'avtomaty',
  treasures: 'klad',
  shariki: 'shariki',
  eggs: 'yayca-dinozavrov',
  gops: 'gops',
};

/** Разделы двора — свои страницы со своим текстом (src/site/sections.ts); во дворе — кнопки над карточками. */
export const SECTION_SLUGS: Record<string, string> = {
  board: 'doska-i-kosti',
  cards: 'kartochnye-igry',
  company: 'igry-dlya-kompanii',
  paper: 'igry-na-bumage',
  puzzles: 'golovolomki',
  tabletop: 'nastolnye-igry',
  sport: 'nastolnyy-sport',
  electronics: 'elektronnye-igry',
};

/** Переехавшие адреса → новые (сервер отвечает 301). */
export const MOVED: Record<string, string> = {
  'golovolomki/pravila': 'krossvordy-i-sudoku/pravila',
};

/** Отдельная страница варианта — только там, где у него свой спрос (docs/seo/plan.md); остальные варианты — разделом на странице игры. */
export interface VariantPage {
  path: string;
  game: string;
  preset: string;
}

export const VARIANTS: VariantPage[] = [
  { path: 'nardy/dlinnye', game: 'nardy', preset: 'long' },
  { path: 'nardy/korotkie', game: 'nardy', preset: 'short' },
  { path: 'durak/perevodnoy', game: 'durak', preset: 'perevodnoy' },
  { path: 'durak/podkidnoy', game: 'durak', preset: 'podkidnoy' },
  { path: 'shashki/russkie', game: 'checkers', preset: 'russian' },
  { path: 'shashki/ugolki', game: 'checkers', preset: 'ugolki' },
  { path: 'shashki/poddavki', game: 'checkers', preset: 'giveaway' },
  { path: 'shahmaty/blic', game: 'chess', preset: 'blitz' },
  { path: 'pasyans/kosynka', game: 'solitaire', preset: 'klondike' },
  { path: 'pasyans/kosynka-po-tri', game: 'solitaire', preset: 'klondike3' },
  { path: 'pasyans/pauk', game: 'solitaire', preset: 'spider1' },
  { path: 'pasyans/soliter', game: 'solitaire', preset: 'freecell' },
  { path: 'pasyans/skorpion', game: 'solitaire', preset: 'scorpion' },
  { path: 'pasyans/piramida', game: 'solitaire', preset: 'pyramid' },
  { path: 'domino/kozel', game: 'domino', preset: 'kozel' },
  { path: 'bilyard/russkiy', game: 'billiards', preset: 'moscow' },
  { path: 'bilyard/pul', game: 'billiards', preset: 'pool8' },
  { path: 'bilyard/snuker', game: 'billiards', preset: 'snooker' },
  { path: 'bura/burkozel', game: 'bura', preset: 'burkozel' },
  { path: 'loto/vokrug-sveta', game: 'loto', preset: 'world' },
  { path: 'ochko/blekdzhek', game: 'ochko', preset: 'bj' },
  { path: 'seka/svara', game: 'seka', preset: 'svara' },
  { path: 'hrap/rams', game: 'khrap', preset: 'rams' },
  // головоломки: у каждой свой спрос — отдельные страницы в корне
  { path: 'sudoku', game: 'puzzles', preset: 'sudoku' },
  { path: 'krossvordy', game: 'puzzles', preset: 'crossword' },
  { path: 'skanvordy', game: 'puzzles', preset: 'scanword' },
  { path: 'yaponskie-krossvordy', game: 'puzzles', preset: 'picross' },
  { path: 'kalah', game: 'mancala', preset: 'kalah' },
  { path: 'gomoku', game: 'renju', preset: 'free' },
  // поля кинь-двинь — ностальгия с пустой выдачей: по странице на поле
  { path: 'kin-dvin/krugosvetnoe-puteshestvie', game: 'hodilki', preset: 'krugosvet' },
  { path: 'kin-dvin/kosmicheskoe-puteshestvie', game: 'hodilki', preset: 'kosmos' },
  { path: 'kin-dvin/puteshestvie', game: 'hodilki', preset: 'put' },
  { path: 'kin-dvin/zateryannyy-mir', game: 'hodilki', preset: 'zatmir' },
  { path: 'kin-dvin/neukrotimaya-planeta', game: 'hodilki', preset: 'planeta' },
  { path: 'kin-dvin/konnye-varvary', game: 'hodilki', preset: 'varvary' },
  { path: 'kin-dvin/podveski-korolevy', game: 'hodilki', preset: 'podveski' },
  { path: 'kin-dvin/strana-mepl-uayta', game: 'hodilki', preset: 'mepl' },
  { path: 'kin-dvin/s-utra-do-vechera', game: 'hodilki', preset: 'sutra' },
  { path: 'kin-dvin/shayba', game: 'hodilki', preset: 'shayba' },
  { path: 'kin-dvin/v-put-druzya', game: 'hodilki', preset: 'vput' },
  { path: 'kin-dvin/lukomorye', game: 'hodilki', preset: 'luk' },
  { path: 'menedzher/odessa', game: 'manager', preset: 'odessa' },
  { path: 'menedzher/biznesmen', game: 'manager', preset: 'biznesmen' },
];

/** Статьи при игре (справочные страницы с большим спросом): экран игры, под ним — текст статьи.
 * Текст — в src/games/<игра>/seo.ts, поле `articles[slug]`. */
export interface ArticlePage {
  path: string;
  game: string;
  slug: string;
}

export const ARTICLES: ArticlePage[] = [{ path: 'poker/kombinacii', game: 'holdem', slug: 'kombinacii' }];

/** Игры серии у аркад («Электроника ИМ», автоматы): своя страница на каждую, адрес открывает прибор сразу на ней. */
export interface ModePage {
  path: string;
  game: string;
  mode: string;
}

export const MODE_PAGES: ModePage[] = [
  { path: 'elektronika/nu-pogodi', game: 'elektronika', mode: 'nupogodi' },
  { path: 'elektronika/tayny-okeana', game: 'elektronika', mode: 'taynyoke' },
  { path: 'elektronika/vesyolyy-povar', game: 'elektronika', mode: 'vespovar' },
  { path: 'elektronika/kosmicheskiy-most', game: 'elektronika', mode: 'kosmicmt' },
  { path: 'elektronika/hokkey', game: 'elektronika', mode: 'ehockey' },
  { path: 'elektronika/razvedchiki-kosmosa', game: 'elektronika', mode: 'rkosmosa' },
  { path: 'elektronika/ohota', game: 'elektronika', mode: 'okhota' },
  { path: 'elektronika/biatlon', game: 'elektronika', mode: 'biathlon' },
  { path: 'elektronika/vesyolye-futbolisty', game: 'elektronika', mode: 'vfutbol' },
  { path: 'elektronika/avtoslalom', game: 'elektronika', mode: 'auslalom' },
  { path: 'elektronika/kot-rybolov', game: 'elektronika', mode: 'krybolov' },
  { path: 'elektronika/kvaka-zadavaka', game: 'elektronika', mode: 'kvakazad' },
  { path: 'elektronika/kosmicheskiy-polyot', game: 'elektronika', mode: 'kosmicpt' },
  { path: 'elektronika/ataka-asteroidov', game: 'elektronika', mode: 'atakaast' },
  { path: 'avtomaty/morskoy-boy', game: 'avtomaty', mode: 'morboy' },
  { path: 'avtomaty/magistral', game: 'avtomaty', mode: 'magistral' },
  { path: 'avtomaty/konyok-gorbunok', game: 'avtomaty', mode: 'konek' },
  { path: 'avtomaty/sos', game: 'avtomaty', mode: 'sosterm' },
  { path: 'avtomaty/snezhnaya-koroleva', game: 'avtomaty', mode: 'koroleva' },
  { path: 'avtomaty/bilyard', game: 'avtomaty', mode: 'bilyard' },
  { path: 'avtomaty/gorodki', game: 'avtomaty', mode: 'gorodki' },
  { path: 'avtomaty/kot-rybolov', game: 'avtomaty', mode: 'kot' },
  { path: 'avtomaty/tetris', game: 'avtomaty', mode: 'phtetris' },
  { path: 'avtomaty/piton', game: 'avtomaty', mode: 'phpython' },
  { path: 'avtomaty/klad', game: 'avtomaty', mode: 'phklad' },
  { path: 'avtomaty/chyornyy-korabl', game: 'avtomaty', mode: 'black' },
  { path: 'avtomaty/brodyaga', game: 'avtomaty', mode: 'brod' },
];

/** Занятые слова: разделы сайта и служебные папки — адрес игры не может начинаться с них. */
export const RESERVED = ['novosti', 'blog', 'forum', 'chat', 'lobbi', 'turniry', 'poisk', 'vhod', 'profil', 'admin', 'stol', 'pravila', 'api', 'ws', 'assets', 'thumbs', 'cards', 'tex', 'models', 'video', 'dict', 'scan', 'sitemap.xml', 'robots.txt'];

export type Route =
  | { kind: 'yard'; cat?: string }
  | { kind: 'game'; id: string; preset?: string; rules?: boolean; play?: boolean; article?: boolean; mode?: string }
  | { kind: 'table'; code: string }
  | { kind: 'search'; q: string }
  | { kind: 'missing'; path: string };

const BY_PATH = new Map<string, { id: string; preset?: string; article?: boolean; mode?: string }>();
for (const [id, p] of Object.entries(SLUGS)) BY_PATH.set(p, { id });
for (const v of VARIANTS) BY_PATH.set(v.path, { id: v.game, preset: v.preset });
for (const a of ARTICLES) BY_PATH.set(a.path, { id: a.game, article: true });
for (const m of MODE_PAGES) BY_PATH.set(m.path, { id: m.game, mode: m.mode });
const BY_SECTION = new Map(Object.entries(SECTION_SLUGS).map(([id, p]) => [p, id]));

const trim = (p: string) => p.replace(/^\/+|\/+$/g, '');

/** Разобрать адрес (pathname + search) в экран. */
export function parseRoute(pathname: string, search = ''): Route {
  let p: string;
  try {
    p = trim(decodeURI(pathname)).toLowerCase();
  } catch {
    p = trim(pathname).toLowerCase();
  }
  const q = new URLSearchParams(search);
  if (!p) return { kind: 'yard' };
  if (p.startsWith('stol/')) return { kind: 'table', code: p.slice(5).toUpperCase() };
  if (p === 'poisk') return { kind: 'search', q: q.get('q') ?? '' };
  const sec = BY_SECTION.get(p);
  if (sec) return { kind: 'yard', cat: sec };
  const rules = p.endsWith('/pravila');
  const hit = BY_PATH.get(rules ? p.slice(0, -'/pravila'.length) : p);
  if (!hit) return { kind: 'missing', path: p };
  if (rules && (hit.article || hit.mode)) return { kind: 'missing', path: p };
  return { kind: 'game', id: hit.id, preset: hit.preset, rules: rules || undefined, play: q.has('igra') || undefined, article: hit.article, mode: hit.mode };
}

/** Адрес экрана игры: у варианта со своей страницей — её адрес, иначе — адрес игры. */
export function gamePath(id: string, preset?: string | null): string {
  const v = preset ? VARIANTS.find((x) => x.game === id && x.preset === preset) : undefined;
  const p = v?.path ?? SLUGS[id];
  return p ? `/${p}/` : '/';
}

/** Адрес игры серии у аркады (без своей страницы — адрес самой аркады). */
export function modePath(id: string, mode: string): string {
  const m = MODE_PAGES.find((x) => x.game === id && x.mode === mode);
  return m ? `/${m.path}/` : gamePath(id);
}

/** Адрес раздела двора («все игры» — главная). */
export const sectionPath = (cat?: string | null) => (cat && SECTION_SLUGS[cat] ? `/${SECTION_SLUGS[cat]}/` : '/');
export const searchPath = (q: string) => `/poisk/?q=${encodeURIComponent(q)}`;
export const rulesPath = (id: string) => (SLUGS[id] ? `/${SLUGS[id]}/pravila/` : '/');
export const tablePath = (code: string) => `/stol/${code}`;
