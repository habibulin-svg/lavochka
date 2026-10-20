/* «Детективы» — дела из сборников детективных задач. Прочитай дело, найди улику и выбери верную версию из четырёх
 * (или ответь своими словами и сверь с разгадкой). Наводки — за очки. Одному или компанией: каждый сам, бригадой,
 * наперегонки. Без DOM. */
import type { DemoScript, GameDef, SeatSpec } from '../../core/types';
import { SeededRng } from '../../core/rng';
import { esc } from '../../core/util';
import { apply, BOOKS, cfgOf, free, keyOf, KEYS, newState, PAR, redact, result, SHARED, toAct, view, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#c0281e', light: '#e86a5a', dark: '#7a140e' },
  { name: 'Ленка', color: '#23408f', light: '#5a78c8', dark: '#122450' },
  { name: 'Серёга', color: '#2a7a3a', light: '#5aaa6a', dark: '#164a20' },
  { name: 'Танька', color: '#8a5a10', light: '#c8964a', dark: '#4a3008' },
  { name: 'Димка', color: '#6a2a8a', light: '#9a6ab8', dark: '#3a1250' },
  { name: 'Оля', color: '#127a7a', light: '#4ab0b0', dark: '#0a4a4a' },
];

export const fmtSec = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'open':
      return null;
    case 'hint':
      return `${name(ev.seat)} берёт наводку`;
    case 'wrong':
      return `${name(ev.seat)}: версия ${'АБВГ'[ev.k]} не подтвердилась`;
    case 'free':
      return `${name(ev.seat)} записал версию: «${esc(ev.text.slice(0, 120))}${ev.text.length > 120 ? '…' : ''}»`;
    case 'solved': {
      const m = ev.mark;
      return `✔ ${name(ev.seat)} раскрывает дело ${ev.i + 1} за ${fmtSec(m.sec)} — <b>+${m.pts}</b>${m.par ? ' (в срок)' : ''}`;
    }
    case 'skip':
      return `${name(ev.seat)}: дело ${ev.i + 1} не раскрыто`;
    case 'finish':
      return `🏁 Дела закрыты: ${ev.score} очков`;
    case 'swap':
      return ev.seat != null ? `🔄 ${name(ev.seat)} уже читал дело ${ev.i + 1} — взяли другое` : `🔄 Дела, которые за столом уже читали, заменены на новые (${ev.n ?? 1})`;
  }
  return null;
}

// ---------------------------------------------------------------- бот

/** Бот «читает» дело норматив × множитель уровня (разброс ±40 %), потом раскрывает его с вероятностью по уровню,
 * иначе ошибается версией. Текста бот не понимает — верность берёт из ключа по уровню («детектив такого-то класса»).
 * Когда ходы идут без пауз (тесты, «пропустить»), отвечает через 40 ходов «думаю». */
const SKILL = [0.5, 0.72, 0.9];
function botChoose(v: View, seat: number, level: number, rng: { next(): number; int(n: number): number }): Action {
  const b = v.boards[v.shared ? SHARED : seat];
  if (!b || b.i >= v.total) return { t: 'think' };
  if (b.phase === 'done') return (b.ready ?? []).includes(seat) && v.cfg.mode === 'race' ? { t: 'think' } : { t: 'next' };
  const cur = b.cur;
  if (!cur) return { t: 'think' };
  if (b.phase === 'check') {
    // свой свободный ответ бот оценивает честно; в бригаде чужой — ждёт
    if (b.by !== seat && v.cfg.mode === 'team') return { t: 'think' };
    return { t: 'self', v: b.text && b.text !== 'Не знаю' ? 2 : 0 };
  }
  if ((b.out ?? []).includes(seat)) return { t: 'think' };
  const u = (((seat + 1) * 2654435761 + b.i * 40503 + b.t0) >>> 0) / 4294967296;
  const target = PAR[cur.lv as 1 | 2 | 3] * [1.3, 0.9, 0.6][level] * (0.6 + 0.8 * u) * 1000;
  const elapsed = Date.now() - b.t0;
  const thinks = b.thinks ?? 0;
  // в живой игре «думаю» приходит раз в секунду-другую; быстрее 0,3 с на ход — значит, время не идёт (тесты, «пропустить»)
  const ready = elapsed >= target || (thinks >= 40 && elapsed < thinks * 300);
  if (level === 0 && b.hints < 1 && elapsed >= target * 0.5 && rng.next() < 0.05) return { t: 'hint' };
  if (!ready) return { t: 'think' };
  const k = keyOf(cur.id);
  const knows = rng.next() < SKILL[level] + 0.1 * b.hints;
  if (v.cfg.answer === 'free') return { t: 'free', text: knows ? k.short : 'Не знаю' };
  if (knows) return { t: 'pick', k: k.ok };
  const wrong = [0, 1, 2, 3].filter((x) => x !== k.ok && !b.wrongs.includes(x));
  return wrong.length ? { t: 'pick', k: wrong[rng.int(wrong.length)] } : { t: 'pick', k: k.ok };
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [{ seat: 0, kind: 'bot', name: SEATS[0].name, level: 1 }];

/** Короткое детское дело для показа: первое лёгкое из «Загадок» (или любое лёгкое). */
function demoCase(): number {
  return (KEYS.find((k) => k.book === 'zagadki' && k.lv === 1 && !k.pic) ?? KEYS.find((k) => k.lv === 1) ?? KEYS[0]).id;
}

function demo(answer: 'choice' | 'free', intro: string, steps: { action: Action; caption: string }[] | ((ok: number) => { action: Action; caption: string }[])): DemoScript<State, Action> {
  let base: State | null = null;
  const options = { mode: 'solo', answer, count: 1, lvl: 1 };
  const get = () => {
    if (!base) {
      const s = newState(cfgOf(options), [0], new SeededRng(1));
      base = { ...s, list: [demoCase()] };
    }
    return base;
  };
  return {
    seats: demoSeats,
    options,
    setup: () => get(),
    intro,
    get steps() {
      const list = typeof steps === 'function' ? steps(keyOf(demoCase()).ok) : steps;
      return list.map((x) => ({ seat: 0, ...x }));
    },
  };
}

const BOOK_CHOICES = [{ value: '', label: 'все сыщики' }, ...BOOKS.map((b) => ({ value: b.id, label: b.title }))];

export const def: GameDef<State, Action, Event, View> = {
  id: 'detektiv',
  title: 'Детективы',
  players: { min: 1, max: 6, default: 1 },
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Как играем',
      type: 'select',
      choices: [
        { value: 'solo', label: 'Сыщик — каждый сам' },
        { value: 'team', label: 'Следственная бригада — вместе' },
        { value: 'race', label: 'Кто быстрее' },
      ],
      default: 'solo',
    },
    {
      key: 'answer',
      label: 'Ответ',
      type: 'select',
      choices: [
        { value: 'choice', label: 'выбрать версию из четырёх' },
        { value: 'free', label: 'своими словами и сверить' },
      ],
      default: 'choice',
      showIf: (o) => o.mode !== 'race',
    },
    {
      key: 'count',
      label: 'Дел',
      type: 'select',
      choices: [
        { value: 3, label: '3' },
        { value: 5, label: '5' },
        { value: 10, label: '10' },
        { value: 20, label: '20' },
      ],
      default: 5,
    },
    {
      key: 'lvl',
      label: 'Трудность',
      type: 'select',
      choices: [
        { value: -1, label: 'растёт к концу' },
        { value: 0, label: 'любые' },
        { value: 1, label: 'лёгкие' },
        { value: 2, label: 'средние' },
        { value: 3, label: 'трудные' },
      ],
      default: -1,
    },
    { key: 'book', label: 'Чьи дела', type: 'select', choices: BOOK_CHOICES, default: '' },
  ],
  presets: [
    { id: 'syshchik', label: 'Сыщик', hint: 'пять дел от лёгких к трудным, звание по очкам', options: { mode: 'solo', answer: 'choice', count: 5, lvl: -1, book: '' } },
    { id: 'svoimi', label: 'Своими словами', hint: 'ответ пишешь сам и сверяешь с разгадкой', options: { mode: 'solo', answer: 'free', count: 5, lvl: -1, book: '' } },
    { id: 'brigada', label: 'Следственная бригада', hint: 'одно дело на всех, очки общие', options: { mode: 'team', answer: 'choice', count: 5, lvl: -1, book: '' } },
    { id: 'bystree', label: 'Кто быстрее', hint: 'одно дело на всех: очки первому, ошибся — выбыл', options: { mode: 'race', answer: 'choice', count: 10, lvl: 0, book: '' } },
    { id: 'korotkie', label: 'Короткие загадки', hint: 'лёгкие загадки на пару абзацев', options: { mode: 'solo', answer: 'choice', count: 5, lvl: 1, book: 'zagadki' } },
  ],
  setup: (seats, opts, rng) => newState(cfgOf(opts), seats.map((s) => s.seat), rng),
  toAct,
  free,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view,
  redact,
  result,
  describe,
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: botChoose },
  showcase() {
    // дело с открытой наводкой
    let s = newState(cfgOf({ mode: 'solo', count: 3, lvl: 2, book: 'varnike' }), [0], new SeededRng(2026));
    s = apply(s, 0, { t: 'hint' }, new SeededRng(1), s.boards[0].t0 + 61000)?.state ?? s;
    return s;
  },
  rules: {
    goal: 'Вы — сыщик. Прочитайте дело внимательно: где-то в рассказе спрятана улика — оговорка, растаявший лёд, не та погода. Найдите её и назовите, кто виноват и почему. Раскрывайте дела, набирайте очки и получайте звание — от стажёра до комиссара.',
    sections: [
      {
        title: 'Версии',
        html: `<p>Под делом — <b>четыре версии</b>. Верна одна. Выбрали неверную — она зачёркивается, а дело стоит на 2 очка меньше. Отбросили три — дело закрыто без очков.</p>`,
        demo: demo('choice', 'Короткое дело и четыре версии.', (ok) => [
          { action: { t: 'pick', k: (ok + 1) % 4 }, caption: 'Неверная версия зачёркивается — минус два очка.' },
          { action: { t: 'pick', k: ok }, caption: 'Верная версия — дело раскрыто, ниже разгадка.' },
        ]),
      },
      {
        title: 'Наводки и очки',
        html: `<p>За дело — очки по трудности: лёгкое 3, среднее 4, трудное 5. <b>Наводка</b> стоит очко; их две — первая подсказывает, куда смотреть, вторая почти называет улику.
          Раскрыли в срок (2, 4 или 7 минут по трудности) — +1. Раскрытое дело приносит хотя бы одно очко. «Сдаться» — показать разгадку без очков.</p>
          <p>В конце — <b>звание</b> по доле набранного от возможного: стажёр, младший сыщик, сыщик, инспектор, старший инспектор, комиссар.</p>`,
        demo: demo('choice', 'Не видно улики? Возьмите наводку.', (ok) => [
          { action: { t: 'hint' }, caption: 'Первая наводка — на что обратить внимание.' },
          { action: { t: 'hint' }, caption: 'Вторая — почти сама улика.' },
          { action: { t: 'pick', k: ok }, caption: 'Раскрыто: очков меньше, зато наверняка.' },
        ]),
      },
      {
        title: 'Своими словами',
        html: `<p>Можно играть без версий: напишите, кто виноват и почему, — откроется разгадка автора. Сравните сами и честно оцените: <b>угадал</b> (все очки), <b>частично</b> (половина), <b>нет</b>.</p>`,
        demo: demo('free', 'Ответ пишем сами.', [
          { action: { t: 'free', text: 'Виноват тот, кто проговорился о том, чего не мог знать.' }, caption: 'Версия записана — открывается разгадка.' },
          { action: { t: 'self', v: 2 }, caption: 'Сверили: угадал — очки наши.' },
        ]),
      },
      {
        title: 'Компанией',
        html: `<p><b>Сыщик</b> — каждый раскрывает те же дела в своём темпе, в конце сравнивают очки. <b>Следственная бригада</b> — одно дело на всех: обсуждайте в чате или голосом, отвечает любой, очки общие.
          <b>Кто быстрее</b> — одно дело на всех: очки тому, кто первым назовёт верную версию, а ошибся — выбыл из этого дела.</p>`,
      },
      {
        title: 'Откуда дела',
        html: `<p>Дела взяты из известных сборников детективных задач, что десятилетиями ходят по журналам, газетам и сайтам: инспектор Варнике, Людовик (дела в картинках), сыщик Анискин,
          инспекторы Вернер, Меридит и Борг, Квик, майор Сейтимбетов, загадки про Шерлока Холмса. Тексты вычитаны, версии и наводки написаны для игры.</p>`,
      },
    ],
  },
};
