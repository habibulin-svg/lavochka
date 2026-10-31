/* Таблицы рекордов — общее для браузера, сервера и тестов (без DOM).
 * Таблица — на сочетание «игра + вариант (+ режим)»: доска `${игра}/${таблица}`. Столбцы описывает игра (`GameDef.records`
 * или аркада), первый — главный. Пошаговые игры шлют рекорд с записью партии (сид + ходы), сервер переигрывает её
 * движком def и сам считает итог; аркады (своя отрисовка, без def) — только с проверкой правдоподобности. */
import { Authority, type LogEntry } from './authority';
import type { GameDef, Options, SeatSpec } from './types';

export interface RecordColumn {
  key: string;
  label: string;
  /** asc — меньше лучше (время, ходы), desc — больше лучше (очки). */
  sort: 'asc' | 'desc';
  format: 'time' | 'score';
}

export interface RecordTable {
  id: string;
  label: string;
}

/** Итог партии для таблицы. */
export interface RecordScore {
  values: Record<string, number>;
  /** Пользовались отменой хода или подсказкой — результат идёт в отдельную таблицу «с подсказками». */
  help?: boolean;
}

/** Описание таблиц рекордов у игры (`GameDef.records`). */
export interface RecordsDef<S = any> {
  columns: RecordColumn[];
  /** Таблица для этих настроек; null — при них рекорды не ведём. */
  table(opts: Options): RecordTable | null;
  /** Все таблицы игры по порядку — для страницы игры на сайте. */
  tables(): RecordTable[];
  /** Итог законченной партии; null — не рекорд (проиграл, не дорешал). ms — время партии, actions — ходы игрока. */
  score(s: S, info: { ms: number; actions: unknown[]; opts: Options }): RecordScore | null;
  /** Меньше этого результат не бывает честно (время в мс по столбцу time) — отсекаем подделку. По умолчанию — 1 с. */
  minMs?(opts: Options): number;
  /** Отмена и подсказки бывают — у таблицы есть «с подсказками». */
  help?: boolean;
}

/** Строка таблицы. */
export interface RecordEntry {
  name: string;
  values: Record<string, number>;
  at: number;
  /** Устройство (до этапа 3 — случайная метка браузера). Наружу не отдаём. */
  device?: string;
  /** Игрок-аккаунт (этап 3). */
  player?: string;
  /** Проверено переигрыванием партии на сервере. */
  verified?: boolean;
}

export type RecordPeriod = 'all' | 'month' | 'week' | 'mine';

export const PERIODS: { id: RecordPeriod; label: string }[] = [
  { id: 'all', label: 'Всё время' },
  { id: 'month', label: 'Месяц' },
  { id: 'week', label: 'Неделя' },
  { id: 'mine', label: 'Мои' },
];

export const HELP_SUFFIX = '~help';
export const DAY = 24 * 3600 * 1000;
export const periodStart = (p: RecordPeriod, now = Date.now()) => (p === 'week' ? now - 7 * DAY : p === 'month' ? now - 30 * DAY : 0);

/** Аркады с рекордами (своя отрисовка, без def — сервер их не переигрывает): столбец «очки», таблица — игра серии. */
export const ARCADE_RECORDS = ['treasures', 'shariki', 'eggs', 'petardy'];
/** Пошаговые игры с таблицами рекордов (их def сервер загружает при старте; тест сверяет список с `def.records`). */
export const RECORD_GAMES = ['saper', 'g2048', 'pipes', 'solitaire', 'mahjong', 'puzzles', 'dvor', 'geo'];
export const SCORE_COLUMNS: RecordColumn[] = [{ key: 'score', label: 'Очки', sort: 'desc', format: 'score' }];

export const boardKey = (game: string, table: string) => `${game}/${table}`;
export const GAME_RE = /^[a-z][\w]{0,30}$/;
export const TABLE_RE = /^[\w.:,=+-]{1,60}(~help)?$/;

export function fmtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms / 100) / 10);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  // до минуты — с десятыми (в сапёре решают секунды), дальше — м:сс
  if (m === 0) return `${s.toFixed(1).replace('.', ',')} с`;
  const h = Math.floor(m / 60);
  const ss = String(Math.floor(s)).padStart(2, '0');
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export const fmtValue = (c: RecordColumn, v: number | undefined) => (v == null ? '—' : c.format === 'time' ? fmtTime(v) : v.toLocaleString('ru-RU'));

/** Сравнение строк: по столбцам по порядку, при равенстве — кто раньше. */
export function compareEntries(cols: RecordColumn[]) {
  return (a: RecordEntry, b: RecordEntry) => {
    for (const c of cols) {
      const x = a.values[c.key] ?? (c.sort === 'asc' ? Infinity : -Infinity);
      const y = b.values[c.key] ?? (c.sort === 'asc' ? Infinity : -Infinity);
      if (x !== y) return c.sort === 'asc' ? x - y : y - x;
    }
    return a.at - b.at;
  };
}

/** Кто это: игрок-аккаунт, иначе устройство, иначе (старые записи) — имя. */
export const ownerOf = (e: RecordEntry) => (e.player ? 'p:' + e.player : e.device ? 'd:' + e.device : 'n:' + e.name + ':' + e.at);

/** Таблица за период: лучший результат каждого игрока; «мои» — все свои лучшие. */
export function ranked(list: RecordEntry[], cols: RecordColumn[], period: RecordPeriod, me?: { device?: string; player?: string }, now = Date.now(), limit = 20): RecordEntry[] {
  const cmp = compareEntries(cols);
  if (period === 'mine') {
    if (!me?.device && !me?.player) return [];
    return list.filter((e) => (me.player && e.player === me.player) || (me.device && e.device === me.device)).sort(cmp).slice(0, limit);
  }
  const from = periodStart(period, now);
  const best = new Map<string, RecordEntry>();
  for (const e of list) {
    if (e.at < from) continue;
    const k = ownerOf(e);
    const b = best.get(k);
    if (!b || cmp(e, b) < 0) best.set(k, e);
  }
  return [...best.values()].sort(cmp).slice(0, limit);
}

/** Что хранить: лучшие за всё время, за месяц и свои лучшие у каждого — остальное выбрасываем. */
export function prune(list: RecordEntry[], cols: RecordColumn[], now = Date.now(), keep = 100, perOwner = 10, cap = 3000): RecordEntry[] {
  const cmp = compareEntries(cols);
  const sorted = list.slice().sort(cmp);
  const keepSet = new Set<RecordEntry>();
  for (const e of ranked(sorted, cols, 'all', undefined, now, keep)) keepSet.add(e);
  for (const e of ranked(sorted, cols, 'month', undefined, now, keep)) keepSet.add(e);
  const per = new Map<string, number>();
  for (const e of sorted) {
    const k = ownerOf(e);
    const n = per.get(k) ?? 0;
    if (n < perOwner) keepSet.add(e);
    per.set(k, n + 1);
  }
  const out = sorted.filter((e) => keepSet.has(e));
  if (out.length > cap) {
    // слишком много: свои лучшие у старых игроков уходят первыми
    const must = new Set([...ranked(sorted, cols, 'all', undefined, now, keep), ...ranked(sorted, cols, 'month', undefined, now, keep)]);
    const rest = out.filter((e) => !must.has(e)).sort((a, b) => b.at - a.at).slice(0, Math.max(0, cap - must.size));
    return [...must, ...rest].sort(cmp);
  }
  return out;
}

/** Место результата в таблице за всё время (1…), если он лучший у своего игрока; 0 — не попал. */
export function placeOf(list: RecordEntry[], cols: RecordColumn[], e: RecordEntry, period: RecordPeriod = 'all', now = Date.now()): number {
  return ranked(list, cols, period, undefined, now, 1000).indexOf(e) + 1;
}

// ------------------------------------------------------------------ запись партии и переигрывание

/** Запись партии, которую клиент шлёт вместе с рекордом. */
export interface Replay {
  seed: number;
  /** Начало часов партии. */
  t0: number;
  options: Options;
  seats: SeatSpec[];
  log: LogEntry[];
}

export interface Claim {
  game: string;
  name: string;
  device?: string;
  /** Пошаговая игра — запись партии; аркада — сразу таблица и очки. */
  replay?: Replay;
  table?: string;
  /** Подпись таблицы аркады (игра серии). */
  label?: string;
  values?: Record<string, number>;
}

/** Время партии по записи: сумма пауз между ходами. */
export const replayMs = (log: LogEntry[]) => log.reduce((a, x) => a + Math.max(0, x[2] || 0), 0);

/** Рекорды ведём только в партии одного человека без соперников. */
export const soloSeats = (seats: SeatSpec[]) => seats.length === 1 && seats[0].kind === 'human';

/** Сверить настройки с описанием игры: только известные ключи и допустимые значения. */
export function cleanOptions(def: GameDef, raw: Options): Options | null {
  const out: Options = {};
  for (const o of def.options ?? []) {
    const v = Object.hasOwn(raw, o.key) ? raw[o.key] : o.default;
    if (o.choices && !o.choices.some((c) => c.value === v)) return null;
    if (o.type === 'toggle' && typeof v !== 'boolean') return null;
    if (o.type === 'number' && (typeof v !== 'number' || (o.min != null && v < o.min) || (o.max != null && v > o.max))) return null;
    out[o.key] = v;
  }
  // скрытые настройки, которых нет в описании (сид раскладки и т. п.), — только простые значения
  for (const [k, v] of Object.entries(raw)) {
    if (Object.hasOwn(out, k)) continue;
    if (!/^\w{1,30}$/.test(k) || !['string', 'number', 'boolean'].includes(typeof v) || String(v).length > 200) return null;
    out[k] = v;
  }
  return out;
}

export interface Verdict {
  table: string;
  label: string;
  values: Record<string, number>;
}

/** Переиграть партию движком игры. null — запись не сходится (подделка, недоигранная партия, не те условия). */
export function verifyReplay(def: GameDef, rp: Replay, maxActions = 20000): Verdict | null {
  const rec = def.records;
  if (!rec || !rp || !Array.isArray(rp.log) || rp.log.length > maxActions || !Number.isInteger(rp.seed) || !Number.isFinite(rp.t0)) return null;
  if (!Array.isArray(rp.seats) || !soloSeats(rp.seats) || !rp.options || typeof rp.options !== 'object') return null;
  const opts = cleanOptions(def, rp.options);
  if (!opts) return null;
  const table = rec.table(opts);
  if (!table) return null;
  const seats: SeatSpec[] = [{ seat: Number(rp.seats[0].seat) || 0, kind: 'human', level: 0, name: '' }];
  let a: Authority;
  try {
    a = new Authority(def, seats, opts, undefined, { seed: rp.seed, t0: rp.t0 });
  } catch {
    return null;
  }
  const actions: unknown[] = [];
  for (const x of rp.log) {
    if (!Array.isArray(x) || x.length < 3 || !Number.isFinite(x[2]) || x[2] < 0 || x[2] > 10 * 60_000) return null;
    if (!a.act(Number(x[0]), x[1], x[2])) return null;
    actions.push(x[1]);
  }
  if (!a.result) return null;
  const ms = replayMs(rp.log);
  const min = rec.minMs?.(opts) ?? 1000;
  if (ms < min || ms < actions.length * 30) return null;
  let sc: RecordScore | null;
  try {
    sc = rec.score(a.state, { ms, actions, opts });
  } catch {
    return null;
  }
  if (!sc) return null;
  return { table: table.id + (sc.help ? HELP_SUFFIX : ''), label: table.label, values: sc.values };
}

/** Таблицы игры по её пресетам (порядок — как в списке вариантов), без повторов. */
export function presetTables(def: Pick<GameDef, 'options' | 'presets'>, table: (o: Options) => RecordTable | null): RecordTable[] {
  const base: Options = Object.fromEntries((def.options ?? []).map((o) => [o.key, o.default]));
  const out: RecordTable[] = [];
  for (const p of [{ options: {} }, ...(def.presets ?? [])]) {
    const t = table({ ...base, ...p.options });
    if (t && !out.some((x) => x.id === t.id)) out.push(t);
  }
  return out;
}

/** Настройки с умолчаниями (для table() по неполным настройкам). */
export const withDefaults = (def: Pick<GameDef, 'options'>, o: Options): Options => ({ ...Object.fromEntries((def.options ?? []).map((x) => [x.key, x.default])), ...o });

/** Столбцы доски: у пошаговой игры — из def, у аркады — «очки». null — такой доски не бывает. */
export function columnsFor(game: string, defs: Record<string, GameDef>): RecordColumn[] | null {
  if (ARCADE_RECORDS.includes(game)) return SCORE_COLUMNS;
  return defs[game]?.records?.columns ?? null;
}
