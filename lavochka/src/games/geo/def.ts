/* «География» — викторина: найти на карте или выбрать из четырёх. Флаги, гербы, столицы, контуры; страны, регионы РФ, штаты США,
 * регионы крупных стран, непризнанные и зависимые территории. Отвечают все сразу; вопрос закрывается, когда ответили все.
 * Без DOM: карта рисуется в view.ts по контурам из public/geo. */
import type { DemoScript, GameDef, Options, Rng, SeatSpec } from '../../core/types';
import { BY_ID, ent, type Entity, type Face, FACE_LABEL, fullName, hasFace, members, OFF_MAP, REGION_COUNTRIES, SETS, setTitle } from './data';

export const SEATS = [
  { name: 'Вовка', color: '#c0281e', light: '#e86a5a', dark: '#7a140e' },
  { name: 'Ленка', color: '#23408f', light: '#5a78c8', dark: '#122450' },
  { name: 'Серёга', color: '#2a7a3a', light: '#5aaa6a', dark: '#164a20' },
  { name: 'Танька', color: '#8a5a10', light: '#c8964a', dark: '#4a3008' },
  { name: 'Димка', color: '#6a2a8a', light: '#9a6ab8', dark: '#3a1250' },
  { name: 'Оля', color: '#127a7a', light: '#4ab0b0', dark: '#0a4a4a' },
];

export type Mode = 'map' | 'quiz';

export interface Opts {
  mode: Mode;
  set: string;
  country: string;
  hard: boolean;
  ask: Face;
  pick: Face;
  count: number;
  /** На скорость: кто первым ответил верно — +2, вторым — +1. */
  fast: boolean;
  /** Секунд на вопрос (0 — без ограничения); время считает экран каждого игрока и сам жмёт «Не знаю». */
  time: number;
}

export interface Question {
  /** Загаданный объект. */
  e: string;
  /** Викторина: варианты (id объектов; для «чья страна» — id стран). */
  opts?: string[];
}

export interface State {
  o: Opts;
  seats: number[];
  qs: Question[];
  i: number;
  /** Что место уже нажимало в текущем вопросе. */
  tries: Record<number, string[]>;
  /** Место закончило текущий вопрос (угадало или кончились попытки). */
  fin: Record<number, boolean>;
  score: Record<number, number>;
  right: Record<number, number>;
  /** Очки за текущий вопрос. */
  got: Record<number, number>;
  /** Сколько уже ответили верно в текущем вопросе (для бонуса за скорость). */
  order: number;
  /** Очки по вопросам: log[k][seat]. */
  log: Record<number, number>[];
  over: boolean;
}

export type Action = { type: 'pick'; id: string } | { type: 'skip' };

export type Event =
  | { type: 'try'; seat: number; id: string; ok: boolean; pts: number; fin: boolean }
  | { type: 'reveal'; i: number; e: string; answer: string }
  | { type: 'over' };

/** Попыток на карте; в викторине — одна. */
export const MAP_TRIES = 3;
const PTS = [3, 2, 1];

export const tries = (s: State) => (s.o.mode === 'map' ? MAP_TRIES : 1);

/** Правильный ответ на вопрос: id объекта (или страны — для «чей регион»). */
export const answerOf = (s: State, q: Question) => (s.o.mode === 'quiz' && s.o.pick === 'parent' ? BY_ID[q.e].p! : q.e);

const WORLD_SETS = ['world', 'eu', 'as', 'af', 'na', 'sa', 'oc'];

/** Настройки из опций с запасными вариантами. */
export function optsOf(o: Options): Opts {
  const mode: Mode = o.mode === 'quiz' ? 'quiz' : 'map';
  const set = SETS.some((x) => x.id === o.set) ? String(o.set) : 'world';
  let ask = String(mode === 'map' ? o.mapAsk ?? 'name' : o.ask ?? 'flag') as Face;
  let pick = String(o.pick ?? 'name') as Face;
  if (mode === 'quiz' && ask === pick) pick = ask === 'name' ? 'capital' : 'name';
  if (mode === 'quiz' && pick === 'parent' && ask === 'outline' && set !== 'reg') ask = 'name';
  return {
    mode,
    set,
    country: set === 'reg' ? String(o.country ?? 'all') : 'all',
    hard: WORLD_SETS.includes(set) && !!o.hard,
    ask,
    pick,
    count: Number(o.count ?? 20),
    fast: !!o.fast,
    time: Number(o.time ?? 0),
  };
}

/** Что можно нажать на карте, когда загадан e (регионы стран — только регионы той же страны). */
export function targets(o: Opts, e: Entity): Entity[] {
  return members(o).filter((x) => !OFF_MAP.has(x.id) && (o.set !== 'reg' || x.p === e.p));
}

/** Из кого загадывают. */
export function pool(o: Opts): Entity[] {
  return members(o).filter((e) => hasFace(e, o.ask) && (o.mode === 'map' ? !OFF_MAP.has(e.id) : hasFace(e, o.pick)));
}

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Как вариант выглядит на экране — чтобы среди четырёх не было двух одинаковых. */
function shown(e: Entity, f: Face): string {
  if (f === 'capital') return e.cap ?? '';
  if (f === 'name') return e.n;
  if (f === 'parent') return e.p ?? '';
  return e.id;
}

/** Три неверных варианта: сначала соседи по континенту/стране, затем остальные. */
function options(o: Opts, e: Entity, rng: Rng): string[] {
  if (o.pick === 'parent') {
    const right = e.p!;
    const parents = [...new Set(members(o).map((x) => x.p).filter((p): p is string => !!p && p !== right && !!BY_ID[p]))];
    const extra = REGION_COUNTRIES.map((c) => c.id).filter((p) => p !== right && !parents.includes(p));
    const wrong = [...shuffle(parents, rng), ...shuffle(extra, rng)].slice(0, 3);
    return shuffle([right, ...wrong], rng);
  }
  const all = members(o).filter((x) => x.id !== e.id && hasFace(x, o.pick));
  const near = all.filter((x) => (x.c && e.c ? x.c.some((c) => e.c!.includes(c)) : x.p === e.p));
  const seen = new Set([shown(e, o.pick)]);
  const out = [e.id];
  for (const x of [...shuffle(near, rng), ...shuffle(all, rng)]) {
    if (out.length >= 4) break;
    const v = shown(x, o.pick);
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(x.id);
  }
  return shuffle(out, rng);
}

export function newState(seats: number[], o: Opts, rng: Rng, ids?: string[]): State {
  let p = pool(o);
  // нечего спрашивать (например, «чья страна» по странам мира или гербы непризнанных) — запасные варианты
  for (const alt of [{ ask: 'flag', pick: 'name' }, { ask: 'outline', pick: 'name' }] as const) {
    if (p.length >= 4 || ids) break;
    o = o.mode === 'quiz' ? { ...o, ...alt } : { ...o, ask: 'name' };
    p = pool(o);
  }
  const chosen = ids ? ids.map(ent) : shuffle(p.slice(), rng).slice(0, o.count > 0 ? o.count : p.length);
  const qs: Question[] = chosen.map((e) => (o.mode === 'quiz' ? { e: e.id, opts: options(o, e, rng) } : { e: e.id }));
  const zero = () => Object.fromEntries(seats.map((x) => [x, 0]));
  return { o, seats, qs, i: 0, tries: Object.fromEntries(seats.map((x) => [x, []])), fin: Object.fromEntries(seats.map((x) => [x, false])), score: zero(), right: zero(), got: zero(), order: 0, log: [], over: qs.length === 0 };
}

export function toAct(s: State): number[] {
  return s.over ? [] : s.seats.filter((x) => !s.fin[x]);
}

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s0.over || !s0.seats.includes(seat) || s0.fin[seat]) return null;
  const q = s0.qs[s0.i];
  const right = answerOf(s0, q);
  const mine = s0.tries[seat];
  let ok = false;
  let id = '';
  if (a.type === 'pick') {
    id = String(a.id);
    if (!BY_ID[id] || mine.includes(id)) return null;
    if (s0.o.mode === 'quiz' && !q.opts!.includes(id)) return null;
    ok = id === right;
  } else if (a.type !== 'skip') return null;
  const s: State = { ...s0, tries: { ...s0.tries, [seat]: id ? [...mine, id] : mine }, fin: { ...s0.fin }, score: { ...s0.score }, right: { ...s0.right }, got: { ...s0.got } };
  const used = s.tries[seat].length;
  const bonus = ok && s.o.fast && s.seats.length > 1 ? Math.max(0, 2 - s.order) : 0;
  const pts = ok ? PTS[Math.min(used - 1, PTS.length - 1)] + bonus : 0;
  if (ok) s.order++;
  s.got[seat] = pts;
  const fin = ok || a.type === 'skip' || used >= tries(s);
  s.fin[seat] = fin;
  if (ok) {
    s.score[seat] += pts;
    s.right[seat]++;
  }
  const events: Event[] = [{ type: 'try', seat, id, ok, pts, fin }];
  if (s.seats.every((x) => s.fin[x])) {
    s.log = [...s.log, s.got];
    events.push({ type: 'reveal', i: s.i, e: q.e, answer: right });
    s.i++;
    s.tries = Object.fromEntries(s.seats.map((x) => [x, []]));
    s.fin = Object.fromEntries(s.seats.map((x) => [x, false]));
    s.got = Object.fromEntries(s.seats.map((x) => [x, 0]));
    s.order = 0;
    if (s.i >= s.qs.length) {
      s.over = true;
      events.push({ type: 'over' });
    }
  }
  return { state: s, events };
}

// ---------------------------------------------------------------- боты

/** Насколько объект на слуху: крупные и известные угадываются чаще. */
function fame(e: Entity): number {
  const pop = e.pop ?? 1e5;
  return Math.min(1, Math.max(0, (Math.log10(pop) - 4.5) / 4));
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.fin[seat]) return null;
  const q = s.qs[s.i];
  const e = ent(q.e);
  const right = answerOf(s, q);
  const base = [0.3, 0.55, 0.8][level] ?? 0.55;
  const p = Math.min(0.97, base + 0.25 * fame(e) - 0.1);
  const mine = s.tries[seat];
  if (rng.next() < p + mine.length * 0.15) return { type: 'pick', id: right };
  if (s.o.mode === 'quiz') {
    const wrong = q.opts!.filter((x) => x !== right);
    return wrong.length ? { type: 'pick', id: wrong[rng.int(wrong.length)] } : { type: 'pick', id: right };
  }
  // на карте промахиваются по соседям: тот же континент или та же страна
  const t = targets(s.o, e).filter((x) => x.id !== right && !mine.includes(x.id));
  const near = t.filter((x) => (x.c && e.c ? x.c.some((c) => e.c!.includes(c)) : true));
  const from = near.length ? near : t;
  return from.length ? { type: 'pick', id: from[rng.int(from.length)].id } : { type: 'skip' };
}

// ---------------------------------------------------------------- описание

export function title(o: Opts): string {
  const what = o.mode === 'map' ? `Где на карте${o.ask === 'name' ? '' : ` по ${o.ask === 'flag' ? 'флагу' : o.ask === 'arms' ? 'гербу' : 'столице'}`}` : `${cap(FACE_LABEL[o.ask])} → ${FACE_LABEL[o.pick]}`;
  return `${what} · ${setTitle(o)}${o.hard ? ' +' : ''}`;
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'try') {
    if (ev.ok) return `${name(ev.seat)}: верно, +${ev.pts}`;
    return ev.fin ? `${name(ev.seat)}: ${ev.id ? 'мимо' : 'не знает'}` : null;
  }
  if (ev.type === 'reveal') {
    const e = ent(ev.e);
    return `Ответ: <b>${fullName(e)}</b>${ev.answer !== ev.e ? ` — ${ent(ev.answer).n}` : e.cap ? `, столица ${e.cap}` : ''}`;
  }
  return '🏁 Вопросы кончились';
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [{ seat: 0, kind: 'bot', name: SEATS[0].name, level: 1 }];

function demo(opt: Options, ids: string[], steps: (s: State) => { seat: number; action: Action; caption?: string }[], intro: string): DemoScript<State, Action> {
  let base: State | null = null;
  const get = (rng: Rng) => (base ??= newState([0], optsOf(opt), rng, ids));
  return {
    seats: demoSeats,
    options: opt,
    setup: (_d, rng) => get(rng),
    intro,
    get steps() {
      return steps(base ?? get({ next: () => 0.5, int: (n: number) => Math.floor(n / 2), getState: () => 0 }));
    },
  };
}

const wrongOpt = (s: State, k: number) => s.qs[k].opts!.find((x) => x !== answerOf(s, s.qs[k]))!;

export const def: GameDef<State, Action, Event, State> = {
  id: 'geo',
  title: 'География',
  players: { min: 1, max: 6, default: 1 },
  seats: SEATS,
  options: [
    { key: 'mode', label: 'Игра', type: 'select', choices: [{ value: 'map', label: 'Найти на карте' }, { value: 'quiz', label: 'Выбрать из четырёх' }], default: 'map' },
    { key: 'set', label: 'Что', type: 'select', choices: SETS.map((x) => ({ value: x.id, label: x.title })), default: 'world' },
    { key: 'country', label: 'Страна', type: 'select', choices: [{ value: 'all', label: 'Все сразу' }, ...REGION_COUNTRIES.map((c) => ({ value: c.id, label: `${c.title} — ${c.unit}` }))], default: 'all', showIf: (o) => o.set === 'reg' },
    { key: 'hard', label: 'Повышенная сложность', hint: '+ непризнанные государства, колонии и зависимые территории (Гренландия, Фареры, Аланды, Пуэрто-Рико…)', type: 'toggle', default: false, showIf: (o) => WORLD_SETS.includes(String(o.set)) },
    {
      key: 'mapAsk',
      label: 'Подсказка',
      hint: 'что показывают вместо вопроса «где это?»',
      type: 'select',
      choices: [
        { value: 'name', label: 'название' },
        { value: 'flag', label: 'флаг' },
        { value: 'arms', label: 'герб' },
        { value: 'capital', label: 'столица' },
      ],
      default: 'name',
      showIf: (o) => o.mode !== 'quiz',
    },
    {
      key: 'ask',
      label: 'Вопрос',
      type: 'select',
      choices: (['flag', 'arms', 'outline', 'name', 'capital'] as Face[]).map((f) => ({ value: f, label: FACE_LABEL[f] })),
      default: 'flag',
      showIf: (o) => o.mode === 'quiz',
    },
    {
      key: 'pick',
      label: 'Ответ',
      hint: '«страна» — чей это регион или территория',
      type: 'select',
      choices: (['name', 'flag', 'arms', 'capital', 'outline', 'parent'] as Face[]).map((f) => ({ value: f, label: FACE_LABEL[f] })),
      default: 'name',
      showIf: (o) => o.mode === 'quiz',
    },
    { key: 'count', label: 'Раундов', hint: 'сколько вопросов в партии', type: 'select', choices: [5, 10, 15, 20, 30, 50].map((n) => ({ value: n, label: String(n) })).concat([{ value: 0, label: 'все' }]), default: 20 },
    { key: 'fast', label: 'На скорость', hint: 'кто первым ответил верно — +2 очка, вторым — +1 (когда игроков больше одного)', type: 'toggle', default: false },
    { key: 'time', label: 'Время на вопрос', hint: 'не успел — вопрос засчитан как «не знаю»', type: 'select', choices: [{ value: 0, label: 'без ограничения' }, { value: 10, label: '10 секунд' }, { value: 15, label: '15 секунд' }, { value: 20, label: '20 секунд' }, { value: 30, label: '30 секунд' }], default: 0 },
  ],
  presets: [
    { id: 'map', label: 'Где на карте', hint: 'Найти страну или регион на карте — масштаб колёсиком или двумя пальцами', options: { mode: 'map', mapAsk: 'name', fast: false, time: 0 } },
    { id: 'mapflag', label: 'Флаг на карте', hint: 'Показывают флаг — найдите, чей он, на карте', options: { mode: 'map', mapAsk: 'flag', fast: false, time: 0 } },
    { id: 'flags', label: 'Флаги', hint: 'Флаг → одно из четырёх названий', options: { mode: 'quiz', ask: 'flag', pick: 'name', fast: false, time: 0 } },
    { id: 'arms', label: 'Гербы', hint: 'Герб → одно из четырёх названий', options: { mode: 'quiz', ask: 'arms', pick: 'name', fast: false, time: 0 } },
    { id: 'outline', label: 'Контуры', hint: 'Узнать по очертаниям', options: { mode: 'quiz', ask: 'outline', pick: 'name', fast: false, time: 0 } },
    { id: 'capitals', label: 'Столицы', hint: 'Страна → столица', options: { mode: 'quiz', ask: 'name', pick: 'capital', fast: false, time: 0 } },
    { id: 'race', label: 'На скорость', hint: 'Компанией по сети: 10 раундов, 15 секунд на вопрос, кто быстрее — тому бонус', options: { mode: 'quiz', ask: 'flag', pick: 'name', count: 10, fast: true, time: 15 } },
    { id: 'whose', label: 'Чей регион', hint: 'Флаг региона → в какой он стране', options: { mode: 'quiz', set: 'reg', country: 'all', ask: 'flag', pick: 'parent', fast: false, time: 0 } },
  ],

  setup: (seats, opts, rng) =>
    newState(
      seats.map((x) => x.seat).sort((a, b) => a - b),
      optsOf(opts),
      rng,
    ),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    const best = Math.max(...s.seats.map((x) => s.score[x]));
    const winners = s.seats.filter((x) => s.score[x] === best);
    const n = s.qs.length;
    const text = s.seats.length === 1 ? `Верно ${s.right[s.seats[0]]} из ${n}, очков ${best} из ${n * 3}` : `Больше всех очков — ${best}`;
    return { winners, text, scores: { ...s.score } };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  // превью: Европа, флаг на карте, двое уже промахнулись
  showcase: () => {
    const rng = { next: () => 0.3, int: (n: number) => Math.floor(n * 0.3), getState: () => 0 };
    const s = newState([0, 1], optsOf({ mode: 'map', set: 'eu', mapAsk: 'flag' }), rng, ['CHE', 'FRA', 'ITA']);
    s.tries = { 0: ['AUT'], 1: [] };
    s.score = { 0: 7, 1: 9 };
    s.got = { 0: 0, 1: 0 };
    return s;
  },

  rules: {
    goal: 'Ответить верно на как можно больше вопросов о странах и регионах: где они, какой у них флаг, герб и столица.',
    sections: [
      {
        title: 'Найти на карте',
        html: `<p>Сверху — что искать: название, флаг, герб или столица. Нажмите на карте нужную страну или регион.
          Три попытки: с первой — <b>3 очка</b>, со второй — 2, с третьей — 1. Промах подсвечивается красным, после вопроса — где было правильно.</p>
          <p>Карту можно приближать колёсиком мыши, двумя пальцами или кнопками «+» и «−», двигать — перетаскиванием.
          Совсем маленькие страны (Ватикан, Монако, острова) отмечены кружками.</p>`,
        demo: demo({ mode: 'map', set: 'eu', mapAsk: 'name' }, ['AUT', 'PRT'], () => [
          { seat: 0, action: { type: 'pick', id: 'CHE' }, caption: 'Ищем Австрию. Вовка жмёт на Швейцарию — мимо, осталось две попытки.' },
          { seat: 0, action: { type: 'pick', id: 'AUT' }, caption: 'Со второй попытки — Австрия: 2 очка.' },
          { seat: 0, action: { type: 'pick', id: 'PRT' }, caption: 'Португалия — сразу, 3 очка.' },
        ], 'Европа на карте.'),
      },
      {
        title: 'Флаг или герб на карте',
        html: `<p>Тот же поиск, но вместо названия — флаг, герб или столица. Где эта страна — решайте сами.</p>`,
        demo: demo({ mode: 'map', set: 'eu', mapAsk: 'flag' }, ['FIN'], () => [{ seat: 0, action: { type: 'pick', id: 'FIN' }, caption: 'Белый флаг с синим крестом — Финляндия.' }], 'Флаг на карте.'),
      },
      {
        title: 'Выбрать из четырёх',
        html: `<p>Показывают флаг, герб, контур, название или столицу — выберите ответ из четырёх вариантов. Одна попытка, верно — <b>3 очка</b>.
          Что спрашивать и чем отвечать, выбирается в настройках: флаг → название, страна → столица, название → флаг…</p>
          <p><b>Чей регион</b> — показывают флаг или герб региона (Бавария, Каталония, Квебек…) или зависимой территории, а выбрать надо страну.</p>`,
        demo: demo({ mode: 'quiz', set: 'eu', ask: 'flag', pick: 'name' }, ['SWE', 'ITA'], (s) => [
          { seat: 0, action: { type: 'pick', id: wrongOpt(s, 0) }, caption: 'Флаг Швеции — а Вовка ошибся.' },
          { seat: 0, action: { type: 'pick', id: 'ITA' }, caption: 'Италия — верно, 3 очка.' },
        ], 'Флаги Европы.'),
      },
      {
        title: 'Наборы и сложность',
        html: `<p>Весь мир или один континент, <b>регионы России</b>, <b>штаты США</b> и <b>регионы стран</b>: земли Германии и Австрии, регионы Франции,
          области Италии, автономные сообщества Испании, части Великобритании, кантоны Швейцарии, провинции Канады, штаты Австралии, Бразилии и Мексики.</p>
          <p><b>Повышенная сложность</b> добавляет к странам непризнанные государства (Абхазия, Приднестровье, Сомалиленд, Северный Кипр…)
          и зависимые территории: Гренландию, Фареры, Аланды, Гибралтар, Бермуды, Пуэрто-Рико, Гуам, Новую Каледонию и другие.</p>`,
      },
      {
        title: 'Вместе и справочник',
        html: `<p>За столом отвечают все сразу, каждый сам за себя; вопрос закрывается, когда ответили все. Больше очков — победа.
          Боты отвечают по силам: лёгкий часто путается, сложный знает почти всё, но и он хуже узнаёт малоизвестное.</p>
          <p><b>На скорость</b> — кто первым ответил верно, получает ещё 2 очка, вторым — 1. <b>Время на вопрос</b> — не успел, значит «не знаю».
          Число раундов — сколько вопросов в партии.</p>
          <p><b>Справочник</b> на экране игры — все страны и регионы с флагами, гербами, столицами и местом на карте.</p>`,
      },
    ],
  },
};
