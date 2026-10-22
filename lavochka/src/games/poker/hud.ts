/* Покер — тренажёр: хранилище статистики (localStorage «poker.hud», при входе — ещё и профиль на сервере, poker/cloud.ts)
 * и пояснения к цифрам HUD. Без DOM.
 *   bots — счётчики соперников по имени: у бота стиль закреплён за именем, поэтому цифры копятся между сессиями,
 *          как по живому регуляру; сетевые соперники — тоже по имени, только по тому, что видно всем;
 *   me   — свои счётчики, cash — выигрыш в быстрой игре (в больших блайндах — для bb/100) и его кривая;
 *   hist — последние раздачи (своими глазами: чужие закрытые карты уже скрыты) — для реплеера и выгрузки;
 *   tours — сыгранные турниры (место, поле, приз). */
import { store } from '../../core/settings';
import type { HandRecord } from './engine';
import { addHand, merge, norm, summary, zero, type Counts, type Summary } from './stats';

export interface Saved {
  at: number;
  /** Моё место в раздаче. */
  me: number;
  names: Record<number, string>;
  rec: HandRecord;
  tour?: boolean;
  /** Выплаты турнира на момент раздачи (для ICM в разборе). */
  prizes?: number[];
  /** Разбор «лучший ход» (короткий вывод). */
  best?: string;
}

export interface TourRec {
  id: string;
  fmt: string;
  place: number;
  field: number;
  prize: number;
  buyin: number;
  bank: boolean;
  at: number;
}

export interface HudData {
  v: 1;
  at: number;
  bots: Record<string, Counts>;
  me: Counts;
  cash: { hands: number; bb: number; curve: number[] };
  hist: Saved[];
  tours: TourRec[];
  /** Уже учтённые раздачи (повторный показ тех же событий не считается дважды). */
  keys: string[];
}

export const HUD_KEY = 'poker.hud';
const HIST_MAX = 200;
const CURVE_MAX = 600;

export const emptyHud = (): HudData => ({ v: 1, at: 0, bots: {}, me: zero(), cash: { hands: 0, bb: 0, curve: [] }, hist: [], tours: [], keys: [] });

/** Привести к полному виду (старые и чужие данные). */
export function normHud(d: Partial<HudData> | null | undefined): HudData {
  const e = emptyHud();
  if (!d || typeof d !== 'object') return e;
  const bots: Record<string, Counts> = {};
  for (const [k, c] of Object.entries(d.bots ?? {})) bots[k] = norm(c);
  return {
    v: 1,
    at: Number(d.at) || 0,
    bots,
    me: norm(d.me),
    cash: { hands: Number(d.cash?.hands) || 0, bb: Number(d.cash?.bb) || 0, curve: Array.isArray(d.cash?.curve) ? d.cash!.curve.filter((x) => Number.isFinite(x)) : [] },
    hist: Array.isArray(d.hist) ? d.hist.filter((x) => x && x.rec && x.rec.v === 1) : [],
    tours: Array.isArray(d.tours) ? d.tours : [],
    keys: Array.isArray(d.keys) ? d.keys.slice(-400) : [],
  };
}

let cache: HudData | null = null;
const listeners = new Set<() => void>();

export function loadHud(): HudData {
  if (!cache) cache = normHud(store.get<Partial<HudData> | null>(HUD_KEY, null));
  return cache;
}

export function saveHud(d: HudData, touch = true) {
  if (touch) d.at = Date.now();
  cache = d;
  store.set(HUD_KEY, d);
  for (const f of listeners) f();
}

/** Подписка на изменения (облако отправляет с задержкой). */
export function onHud(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Заменить целиком (пришло из профиля). */
export function replaceHud(d: Partial<HudData>) {
  cache = normHud(d);
  store.set(HUD_KEY, cache);
}

/** Имя без пометок «(бот)», «(Сложный)» и разметки. */
export const cleanName = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/\s*\(.*\)\s*$/, '')
    .trim();

const keyOf = (r: HandRecord, me: number) => `${r.no}:${r.button}:${r.seats.map((x) => x.stack).join(',')}:${(r.hole[me] ?? []).map((c) => (c ? c.s + c.r : '-')).join('')}:${r.board.map((c) => c.s + c.r).join('')}`;

/** Учесть раздачу. me — моё место (-1 — я не за столом: копим только соперников). Возвращает false, если уже была. */
export function recordHand(d: HudData, rec: HandRecord, me: number, names: Record<number, string>, extra: { tour?: boolean; prizes?: number[]; best?: string } = {}): boolean {
  const key = keyOf(rec, me);
  if (d.keys.includes(key)) return false;
  d.keys.push(key);
  if (d.keys.length > 400) d.keys = d.keys.slice(-400);
  const acc = new Map<number, Counts>();
  addHand(acc, rec);
  for (const [seat, c] of acc) {
    if (seat === me) d.me = merge(d.me, c);
    else {
      const n = names[seat];
      if (n) d.bots[n] = merge(d.bots[n] ?? zero(), c);
    }
  }
  if (me >= 0 && rec.seats.some((x) => x.seat === me)) {
    if (!extra.tour) {
      d.cash.hands++;
      d.cash.bb += (rec.net[me] ?? 0) / rec.big;
      d.cash.curve.push(Math.round(d.cash.bb * 10) / 10);
      // кривая не растёт бесконечно: прореживаем вдвое
      if (d.cash.curve.length > CURVE_MAX) d.cash.curve = d.cash.curve.filter((_, i) => i % 2 === 1);
    }
    d.hist.push({ at: Date.now(), me, names, rec, ...(extra.tour ? { tour: true } : {}), ...(extra.prizes?.length ? { prizes: extra.prizes } : {}), ...(extra.best ? { best: extra.best } : {}) });
    if (d.hist.length > HIST_MAX) d.hist = d.hist.slice(-HIST_MAX);
  }
  return true;
}

/** Учесть законченный турнир (повторы не пишутся). */
export function recordTour(d: HudData, t: TourRec): boolean {
  if (d.tours.some((x) => x.id === t.id)) return false;
  d.tours.push(t);
  if (d.tours.length > 300) d.tours = d.tours.slice(-300);
  return true;
}

export function tourSummary(d: HudData) {
  const t = d.tours;
  const itm = t.filter((x) => x.prize > 0).length;
  const bank = t.filter((x) => x.bank);
  const cost = bank.reduce((a, x) => a + x.buyin, 0);
  const won = bank.reduce((a, x) => a + x.prize, 0);
  return {
    played: t.length,
    itm: t.length ? itm / t.length : 0,
    wins: t.filter((x) => x.place === 1).length,
    avgPlace: t.length ? t.reduce((a, x) => a + x.place / Math.max(1, x.field), 0) / t.length : 0,
    roi: cost ? (won - cost) / cost : null,
  };
}

// ---------------------------------------------------------------- пояснения

export type StatKey = 'hands' | 'vpip' | 'pfr' | 'threeBet' | 'af' | 'cbet' | 'foldCbet' | 'wtsd' | 'wsd' | 'steal' | 'foldSteal';

export interface StatInfo {
  key: StatKey;
  short: string;
  name: string;
  what: string;
  /** Какие значения у какого стиля. */
  styles: string;
  /** Как этим пользоваться. */
  use: string;
  /** С какого числа случаев цифре можно верить. */
  enough: number;
}

export const STATS: StatInfo[] = [
  { key: 'hands', short: 'Р', name: 'Раздач', what: 'Сколько раздач игрок сыграл при вас — на этом посчитаны все цифры.', styles: '—', use: 'Меньше 30 раздач — цифры почти случайны; от 100 — VPIP и PFR уже говорят о стиле; редким цифрам (3-бет, C-бет) нужно несколько сотен.', enough: 0 },
  { key: 'vpip', short: 'VPIP', name: 'VPIP — вход в банк', what: 'Доля раздач, где игрок добровольно положил фишки до флопа (колл или рейз; блайнд без доплаты не считается).', styles: 'нит — до 14%, регуляр (TAG) — 16–25%, LAG — 26–38%, новичок и колл-станция — 35–55%, маньяк — 50% и выше.', use: 'Высокий VPIP — слабые руки в банке: ставьте на вэлью шире. Низкий — его вход значит сильную руку: без хорошей карты не лезьте.', enough: 30 },
  { key: 'pfr', short: 'PFR', name: 'PFR — рейз до флопа', what: 'Доля раздач, где игрок рейзил до флопа.', styles: 'нит — 5–11%, TAG — 13–20%, LAG — 20–30%, маньяк — 35%+; колл-станция и новичок — меньше 10%.', use: 'Смотрите разрыв с VPIP: большой разрыв (35/5) — много коллирует и лимпит, играет пассивно; близкие цифры (22/19) — почти всё рейзом, агрессивный.', enough: 30 },
  { key: 'threeBet', short: '3Б', name: '3-бет', what: 'Как часто игрок ре-рейзит, когда до него был ровно один рейз.', styles: 'нит — 1–4%, TAG — 4–9%, LAG — 8–15%, маньяк — 15%+.', use: 'Против низкого 3-бета (до 4%) его ре-рейз — почти всегда сильная рука: пасуйте средние. Против высокого (10%+) открывайтесь сильнее и отвечайте 4-бетом.', enough: 40 },
  { key: 'af', short: 'AF', name: 'AF — агрессия после флопа', what: '(ставки + рейзы) / коллы на флопе, тёрне и ривере.', styles: 'колл-станция — меньше 1, новичок — около 1, TAG — 2–4, LAG — 3–5, маньяк — 5+.', use: 'Низкий AF — пассивный: его ставка или рейз значат сильную руку, а колл — что угодно. Высокий AF — ставит часто: ловите его блефы коллом.', enough: 30 },
  { key: 'cbet', short: 'CB', name: 'C-бет — продолженная ставка', what: 'Как часто игрок, рейзивший до флопа, ставит на флопе первым.', styles: 'нит и новичок — 40–60%, TAG — 60–75%, LAG и маньяк — 75–95%.', use: 'Высокий C-бет — ставит и без попадания: отвечайте рейзом или коллом шире. Низкий — его ставка на флопе честная.', enough: 20 },
  { key: 'foldCbet', short: 'FCB', name: 'Фолд на C-бет', what: 'Как часто игрок пасует на продолженную ставку соперника.', styles: 'нит — 60–75%, TAG — 45–55%, колл-станция — меньше 30%.', use: 'Высокий фолд на C-бет — ставьте на флопе почти всегда, даже без попадания. Низкий — не блефуйте, ставьте только на вэлью.', enough: 20 },
  { key: 'wtsd', short: 'WTSD', name: 'WTSD — до вскрытия', what: 'Из раздач, где игрок видел флоп, — сколько дошёл до вскрытия.', styles: 'обычно 25–32%; меньше 23% — сдаётся под давлением, больше 35% — «колл до конца» (станция).', use: 'Высокий WTSD — не блефуйте на ривере, ставьте средней рукой на вэлью. Низкий — дожимайте ставками на тёрне и ривере.', enough: 30 },
  { key: 'wsd', short: 'W$SD', name: 'W$SD — выигрыш на вскрытии', what: 'Из раздач, дошедших до вскрытия, — сколько игрок выиграл.', styles: 'около 50% — норма; больше 55% с низким WTSD — доходит только с сильным; меньше 45% — коллирует до конца со слабым.', use: 'Вместе с WTSD: высокий WTSD и низкий W$SD — платит лишнее, выжимайте вэлью. Низкий WTSD и высокий W$SD — его колл на ривере значит сильную руку.', enough: 30 },
  { key: 'steal', short: 'ST', name: 'Кража блайндов', what: 'Как часто игрок рейзит с поздней позиции (CO, баттон, малый блайнд), когда до него все спасовали.', styles: 'нит — 15–25%, TAG — 30–45%, LAG и маньяк — 50%+.', use: 'Высокая кража — его рейз с баттона широкий: защищайте блайнды шире и 3-бетьте. Низкая — уважайте рейз, пасуйте слабое.', enough: 20 },
  { key: 'foldSteal', short: 'FST', name: 'Фолд на кражу', what: 'Как часто игрок на блайнде пасует против рейза с поздней позиции.', styles: 'нит — 80%+, TAG — 60–75%, станция и маньяк — меньше 50%.', use: 'Высокий фолд на кражу — крадите у него с любыми двумя картами с баттона. Низкий — крадите только с хорошими руками.', enough: 20 },
];

export const statInfo = (k: StatKey) => STATS.find((s) => s.key === k)!;

/** Значение цифры строкой: AF — дробь, остальное — проценты. */
export function statVal(s: Summary, k: StatKey): string {
  if (k === 'hands') return String(s.hands);
  if (k === 'af') return s.n.af ? s.af.toFixed(1) : '—';
  const n = (s.n as Record<string, number>)[k];
  if (n === 0 || (k !== 'vpip' && k !== 'pfr' && n == null) || !s.hands) return '—';
  return Math.round(s[k] as number).toString();
}

/** Сколько случаев за цифрой. */
export function statN(s: Summary, k: StatKey): number {
  if (k === 'hands' || k === 'vpip' || k === 'pfr') return s.hands;
  return (s.n as Record<string, number>)[k] ?? 0;
}

/** Грубый портрет по цифрам (от 30 раздач): как в румах «на глаз» по VPIP/PFR/AF. */
export function styleGuess(s: Summary): string | null {
  if (s.hands < 30) return null;
  const gap = s.vpip - s.pfr;
  if (s.vpip >= 48 && s.pfr >= 30) return 'маньяк';
  if (s.vpip >= 34 && s.pfr < 11 && s.af < 1.3) return 'колл-станция';
  if (s.vpip >= 28 && gap > 18) return 'новичок (много коллирует)';
  if (s.vpip < 15) return 'нит';
  if (s.vpip <= 26 && s.pfr >= 12) return 'регуляр (TAG)';
  if (s.vpip > 26 && s.pfr >= 18) return 'лузово-агрессивный (LAG)';
  return null;
}

export const summaryOf = (c: Counts) => summary(c);
