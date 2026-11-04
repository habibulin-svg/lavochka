/* «Вкладыши» — дворовая коллекционная карточная игра на настоящих вкладышах от жвачек 90-х: Turbo, BomBibom, Final, Love is, Lazer.
 * Механика жанра Hearthstone попроще: копейки, лавочка на 5 мест, «терпение». Дизайн — docs/vkladyshi/DESIGN.md. */
import type { DemoScript, GameDef, GameResult, Options, Rng, SeatSpec } from '../../core/types';
import { choose } from './bot';
import { CARDS, COLL_NAME, STARTERS, card, fxText, KW_NAME, starterDeck } from './cards';
import { apply, newState, redact, toAct, view, HERO_HP, SECOND_BONUS, type Action, type Event, type State, type Unit, type View } from './engine';

export const SEATS = [
  { name: 'Я', color: '#c8302a', light: '#f2a8a0', dark: '#7a1a14' },
  { name: 'Соперник', color: '#2a5ac8', light: '#a0b8f2', dark: '#142c7a' },
];

const deckChoices = [...STARTERS.map((s) => ({ value: s.id, label: s.label })), { value: 'rand', label: 'Случайная стартовая' }];

/** Колоды из опций: «rand» — по броску; иначе как есть (стартовая или «c:…» из своей коллекции). */
function decksOf(o: Options, rng: Rng): string[] {
  return [o.deck0, o.deck1].map((d, i) => {
    const v = String(d ?? (i ? 'team' : 'garage'));
    return v === 'rand' ? STARTERS[rng.int(STARTERS.length)].id : v;
  });
}

// ---------------------------------------------------------------- показ правил
const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
/** Первая карта, подходящая под условие, — сначала из своих коллекций по порядку; нет такой — ошибка (показ правил не должен молча врать). */
function pick(colls: string[], pred: (c: (typeof CARDS)[number]) => boolean = () => true): string {
  for (const coll of colls) {
    const c = CARDS.find((x) => x.coll === coll && pred(x));
    if (c) return c.id;
  }
  const any = CARDS.find(pred);
  if (!any) throw new Error('показ правил: нет подходящего вкладыша');
  return any.id;
}
function unit(uid: number, id: string, patch: Partial<Unit> = {}): Unit {
  const c = card(id);
  return { uid, id, atk: c.atk, hp: c.hp, maxHp: c.hp, kw: c.kw.slice(), sleep: false, done: false, armor: c.kw.includes('armor'), stun: false, ...patch };
}
function demo(patch: (s: State, rng: Rng) => void, steps: DemoScript<State, Action>['steps'], intro?: string): DemoScript<State, Action> {
  return {
    seats: demoSeats,
    intro,
    setup: (_def, rng) => {
      const s = newState([0, 1], ['garage', 'team'], rng);
      s.players.forEach((p) => {
        p.board = [];
        p.maxMana = p.mana = 5;
      });
      s.uid = 100;
      patch(s, rng);
      return s;
    },
    steps,
  };
}

const RUSH = pick(['turbo', 'bomb'], (c) => !c.spell && c.kw.includes('rush') && c.cost <= 5);
const WALL = pick(['turbo', 'lazer', 'final'], (c) => !c.spell && c.kw.includes('wall'));
const SMALL = pick(['turbo', 'bomb'], (c) => !c.spell && c.cost <= 3 && !c.kw.length && !c.play);
const PAIR_A = CARDS.find((c) => c.coll === 'final' && c.kw.includes('pair') && c.cost <= 3);
const PAIR_B = PAIR_A && CARDS.find((c) => c.coll === 'final' && c.team === PAIR_A.team && c.id !== PAIR_A.id && c.cost <= 3 && !c.spell);
const LOVE_HEAL = pick(['love'], (c) => c.play?.k === 'heal' && c.play.to === 'none');
const LOVE_BUFF = pick(['love'], (c) => c.spell && c.play?.k === 'buff');

const RULES = [
  {
    title: 'Стол и ход',
    html: `<p>У каждого — <b>терпение</b> (${HERO_HP}), колода из 20 вкладышей и <b>лавочка</b> на пять мест. В начале хода прибавляется
      <b>копейка</b> (до десяти) и берётся вкладыш. На копейки выкладывают вкладыши: цена — в кружке слева вверху.
      Выложенный вкладыш ждёт до следующего хода, а потом бьёт вкладыш соперника или его самого — по портрету, это отнимает терпение. Терпение кончилось — проиграл.</p>
      <p>Атака — в левом нижнем углу, здоровье — в правом. Вкладыши бьют друг друга одновременно: оба получают урон, у кого здоровье
      кончилось — уходит с лавочки. Колода кончилась — каждый пустой добор отнимает всё больше терпения.</p>
      <p>Кто ходит первым, тот в первый ход не берёт вкладыш; второй начинает с лишним вкладышем и ${SECOND_BONUS} очками терпения сверху.</p>`,
    demo: demo(
      (s) => {
        s.players[0].hand = [SMALL, RUSH];
        s.players[0].board = [unit(101, SMALL), unit(103, SMALL)];
        s.players[1].board = [unit(102, SMALL)];
      },
      [
        { seat: 0, action: { t: 'attack', uid: 101, tgt: { p: 1, uid: 102 } }, caption: 'Свой вкладыш бьёт чужой — оба получают урон.' },
        { seat: 0, action: { t: 'attack', uid: 103, tgt: { p: 1 } }, caption: 'А можно бить самого соперника: щёлкнуть по его портрету — минус терпение.' },
        { seat: 0, action: { t: 'play', i: 0 }, caption: 'Выкладываем вкладыш на лавочку: он ударит только в следующий ход.' },
        { seat: 0, action: { t: 'end' }, caption: 'Ход окончен — копейки и добор у соперника.' },
      ]
    ),
  },
  {
    title: 'Коллекции',
    html: `<p>Вкладыши — настоящие, и характеристики берутся с них. <b>Turbo</b> и <b>BomBibom</b>: мощность (л.с.) — это атака, объём
      двигателя — здоровье, а быстрые машины выходят с <b>Рывком</b>. BomBibom дешевле и злее, Turbo крепче.
      <b>Final</b> — футболисты: рядом с игроком той же сборной бьют сильнее («Пара»), фото команды усиливает всю сборную.
      <b>Love is…</b> — приёмы: вернуть терпение, усилить своего, взять вкладыши, заставить чужого заглядеться.
      <b>Lazer</b> — военная техника: дорого, но корабли — броня и стенка, вертолёты бьют при выходе, ракеты — залп.</p>
      <p>Редкость тоже с двора: Turbo с 1-го по 10-й и с 31-го по 40-й попадались реже, а 109-й и 110-й не видел никто.</p>`,
  },
  {
    title: 'Рывок, Стенка, Броня, Пара',
    html: `<p><b>${KW_NAME.rush}</b> — бьёт в тот же ход, как вышел. <b>${KW_NAME.wall}</b> — пока стоит, бить можно только его: ни соседей, ни хозяина.
      <b>${KW_NAME.armor}</b> — первый удар по нему не наносит урона. <b>${KW_NAME.pair}</b> — +1 к атаке за каждого соседа той же сборной.</p>`,
    demo: demo(
      (s) => {
        s.players[0].hand = [RUSH];
        s.players[0].maxMana = s.players[0].mana = card(RUSH).cost;
        s.players[1].board = [unit(102, WALL), unit(103, SMALL)];
      },
      [
        { seat: 0, action: { t: 'play', i: 0 }, caption: `${card(RUSH).name} — быстрая, выходит с Рывком.` },
        { seat: 0, action: { t: 'attack', uid: 100, tgt: { p: 1, uid: 102 } }, caption: 'Бить сразу можно, но только Стенку: она прикрывает остальных и хозяина.' },
      ]
    ),
  },
  ...(PAIR_A && PAIR_B
    ? [
        {
          title: 'Сборная',
          html: `<p>Футболисты одной сборной, стоящие рядом, бьют сильнее: +1 к атаке за каждого соседа. Расставляйте их плечом к плечу —
            место на лавочке выбирается, когда выкладываете вкладыш.</p>`,
          demo: demo(
            (s) => {
              s.players[0].hand = [PAIR_B.id];
              s.players[0].board = [unit(101, PAIR_A.id)];
            },
            [
              { seat: 0, action: { t: 'play', i: 0, slot: 1 }, caption: `${PAIR_B.name} встаёт рядом с ${PAIR_A.name} — оба из сборной «${PAIR_A.team}».` },
              { seat: 0, action: { t: 'attack', uid: 101, tgt: { p: 1 } }, caption: `${PAIR_A.name} бьёт на единицу сильнее — рядом свой.` },
            ]
          ),
        },
      ]
    : []),
  {
    title: 'Приёмы Love is',
    html: `<p>Love is… не выходит на лавочку: это приём, он срабатывает сразу. Подпись на вкладыше — настоящая, из 90-х.</p>`,
    demo: demo(
      (s) => {
        s.players[0].hero = 11;
        s.players[0].hand = [LOVE_HEAL, LOVE_BUFF];
        s.players[0].board = [unit(101, SMALL)];
      },
      [
        { seat: 0, action: { t: 'play', i: 0 }, caption: `«Любовь это ${card(LOVE_HEAL).name}» — ${fxText(card(LOVE_HEAL).play!)}.` },
        { seat: 0, action: { t: 'play', i: 0, tgt: { p: 0, uid: 101 } }, caption: `«Любовь это ${card(LOVE_BUFF).name}» — ${fxText(card(LOVE_BUFF).play!)}.` },
      ]
    ),
  },
  {
    title: 'Жвачки, альбом, колода',
    html: `<p>Под кнопкой «Новая партия» — ваша коллекция. За партии с ботами платят монетами, на монеты в ларьке покупаются жвачки:
      в каждой — три вкладыша своей серии, шансы редких написаны на витрине, а редкий гарантирован не позже чем через десять жвачек.
      Повторы можно сдать в «обменный фонд» за монеты. Колоду из 20 вкладышей (не больше двух одинаковых) собирают из своего альбома.</p>`,
  },
];

function showcase(): State {
  const rng = { s: 7, next() { this.s = (this.s * 16807) % 2147483647; return this.s / 2147483647; }, int(n: number) { return Math.floor(this.next() * n); }, getState() { return this.s; } };
  const s = newState([0, 1], ['garage', 'team'], rng);
  const g = starterDeck('garage').filter((id) => !card(id).spell);
  const t = starterDeck('team').filter((id) => !card(id).spell);
  s.players[0].board = [unit(201, g[12]), unit(202, g[15]), unit(203, g[7])];
  s.players[1].board = [unit(204, t[8]), unit(205, t[11])];
  s.players[0].hand = [g[3], g[9], g[13], t[2]];
  s.players[0].maxMana = s.players[0].mana = 6;
  s.players[1].maxMana = 6;
  s.players[0].hero = 14;
  s.players[1].hero = 9;
  s.turnNo = 11;
  s.uid = 300;
  return s;
}

function result(s: State): GameResult | null {
  if (!s.over) return null;
  const scores: Record<number, number> = {};
  for (const p of s.players) scores[p.seat] = p.hero;
  if (s.winner === null || s.winner < 0) return { winners: [], text: 'ничья — терпение кончилось у обоих', scores };
  const w = s.players[s.winner];
  const l = s.players[1 - s.winner];
  return { winners: [w.seat], text: l.hero <= 0 ? 'у соперника кончилось терпение' : `по терпению после ${s.turnNo} ходов`, scores };
}

export const def: GameDef<State, Action, Event, View> = {
  id: 'vkladyshi',
  title: 'Вкладыши',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    { key: 'deck0', label: 'Колода первого', type: 'select', choices: deckChoices, default: 'garage' },
    { key: 'deck1', label: 'Колода второго', type: 'select', choices: deckChoices, default: 'team' },
    {
      key: 'hero',
      label: 'Терпение',
      hint: 'сколько ударов выдержит игрок',
      type: 'select',
      choices: [
        { value: 20, label: '20 — быстрая партия' },
        { value: 30, label: '30 — обычная' },
        { value: 40, label: '40 — долгая' },
      ],
      default: 30,
    },
  ],
  presets: [
    { id: 'turbo', label: 'Turbo', hint: 'Гараж против Гонки', options: { deck0: 'garage', deck1: 'race', hero: 30 } },
    { id: 'final', label: 'Final', hint: 'Сборная против Гаража', options: { deck0: 'team', deck1: 'garage', hero: 30 } },
    { id: 'love', label: 'Love is', hint: 'Любовь против Техники', options: { deck0: 'love', deck1: 'army', hero: 30 } },
    { id: 'quick', label: 'Быстрая', hint: 'случайные колоды, терпение 20', options: { deck0: 'rand', deck1: 'rand', hero: 20 } },
  ],
  setup: (seats, o, rng) => {
    const ids = seats.map((x) => x.seat).sort((a, b) => a - b);
    return newState(ids, decksOf(o, rng), rng, Number(o.hero ?? HERO_HP) || HERO_HP);
  },
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => view(s, seats),
  redact: (e, seats) => redact(e, seats),
  result,
  showcase,
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, level, rng) => choose(v, seat, level, rng) },
  describe: (ev, name) => describe(ev, name),
  rules: {
    goal: 'Выложить на лавочку настоящие вкладыши 90-х — Turbo, BomBibom, Final, Love is, Lazer — и довести соперника до того, что у него кончится терпение.',
    sections: RULES,
  },
};

const cname = (id: string) => {
  const c = card(id);
  return c.coll === 'love' ? `«Love is ${c.name}»` : `«${c.name}» (${COLL_NAME[c.coll]} №${c.n})`;
};

export function describe(ev: Event, name: (seat: number) => string): string | null {
  const who = (p: number) => name(p); // p — индекс игрока; при двух местах совпадает с номером места
  switch (ev.t) {
    case 'turn':
      return null;
    case 'play':
      return `${who(ev.p)} выкладывает ${cname(ev.id)}`;
    case 'attack':
      return null;
    case 'die':
      return `${cname(ev.id)} уходит с лавочки`;
    case 'fatigue':
      return `${who(ev.p)}: колода кончилась, −${ev.n} терпения`;
    case 'draw':
      return ev.burn && ev.id ? `${who(ev.p)}: рука полна, ${cname(ev.id)} сгорает` : null;
    case 'over':
      return ev.winner === null ? '🏁 Ничья' : `🏁 ${who(ev.winner)} — победа`;
  }
  return null;
}
