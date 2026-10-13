/* «Чудовище Джио-Джанги» — карточка игры: правила, боты, показ. Без DOM. */
import type { GameDef, Rng } from '../../core/types';
import { SEATS } from '../hodilki/core';
import {
  CELLS, IDX, LAIR_OF, NEIGH, apply, describe, has, hasHorse, newState, scoreOf, toAct, view,
  type Action, type Event, type State,
} from './engine';
import { START_MONEY, itemOf, type ItemId } from './rules';

export const SEATS_LOCAL = SEATS.slice(0, 5);

const HOUSE = 5;

/** Коротчайший путь по клеткам (BFS от цели). */
function distTo(target: number): number[] {
  const d = CELLS.map(() => -1);
  d[target] = 0;
  const q = [target];
  while (q.length) {
    const cur = q.shift()!;
    for (const n of NEIGH[cur]) if (d[n] < 0) {
      d[n] = d[cur] + 1;
      q.push(n);
    }
  }
  return d;
}
const toHouse = distTo(HOUSE);
/** Ближайшее чудовище: расстояния до каждой красной клетки. */
const lairDist = CELLS.map((_, i) => (LAIR_OF[i] ? distTo(i) : null));

const seatList = (s: State) => s.seats;

/** Что бот считает полезным покупать по порядку. */
const WISH: ItemId[] = ['horse', 'photo', 'revolver', 'helmet', 'suit', 'aid', 'presents', 'smoke', 'cine', 'gun', 'video', 'winchester', 'carbine', 'boat'];

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.winner != null) return null;
  if (s.phase === 'buy') {
    const wish = level > 0 ? WISH : WISH.slice().sort(() => rng.int(3) - 1);
    for (const id of wish) {
      const it = itemOf(id);
      if (s.money[seat] < it.price) continue;
      const taken = seatList(s).reduce((n, x) => n + s.items[x].filter((i) => i === id).length, 0);
      if (taken >= it.count) continue;
      // лошадь — одна на игрока, аппаратура — по одной каждого вида
      if (id === 'horse' && hasHorse(s, seat)) continue;
      if (['photo', 'cine', 'video'].includes(id) && has(s, seat, id)) continue;
      return { type: 'buy', item: id };
    }
    // покупать больше нечего — выходим в путь
    return { type: 'ready' };
  }
  if (s.phase === 'card') return { type: 'ok' };
  if (s.phase === 'choice') {
    if (!s.ask) return null;
    const opt = s.ask.options[0];
    return { type: 'pick', pick: opt };
  }
  if (s.phase === 'shoot') return { type: 'shoot' };
  if (s.phase === 'stop') return { type: 'stop' };
  if (s.phase === 'roll') return { type: 'roll' };
  if (s.phase === 'move') {
    const here = s.pos[seat];
    const ns = NEIGH[here];
    if (!ns.length) return { type: 'stop' };
    // идём к ближайшему чудовищу, а как побывали там — домой (правила: деньги считают после возвращения)
    const home = !!s.far[seat] && s.moves > 6;
    const score = (n: number) => {
      if (home) return toHouse[n] < 0 ? 999 : toHouse[n];
      let best = 999;
      for (const d of lairDist) if (d && d[n] >= 0) best = Math.min(best, d[n]);
      return best === 999 ? (toHouse[n] < 0 ? 999 : toHouse[n]) : best;
    };
    let pick = ns[0];
    let bd = Infinity;
    for (const n of ns) {
      const d = score(n) + (level > 0 ? 0 : rng.int(2));
      if (d < bd) {
        bd = d;
        pick = n;
      }
    }
    return { type: 'step', to: pick };
  }
  if (s.phase === 'wait') return { type: 'roll' };
  return { type: 'roll' };
}

/** Сколько денег у каждого — для строки счёта. */
export const money = (n: number) => `${n.toLocaleString('ru-RU')} $`;

export const def: GameDef<State, Action, Event, State> = {
  id: 'djio',
  title: 'Чудовище Джио-Джанги',
  players: { min: 2, max: 5, default: 3 },
  seats: SEATS_LOCAL,
  options: [
    {
      key: 'speed',
      label: 'Сборы',
      type: 'select',
      choices: [
        { value: 'long', label: 'по правилам — по одному предмету за ход' },
        { value: 'short', label: 'быстрые сборы — по три предмета сразу' },
      ],
      default: 'long',
    },
  ],
  presets: [{ id: 'classic', label: 'Экспедиция по правилам', options: { speed: 'long' } }],
  setup: (seats, opts, rng) => {
    const ids = seats.map((x) => x.seat).sort((a, b) => a - b);
    const s = newState(ids, rng);
    if (String(opts.speed ?? 'long') === 'short') s.buys = Math.max(0, ids.length * 2 - ids.length);
    return s;
  },
  apply,
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,
  toAct,
  view,
  result: (s) => {
    if (s.winner == null) return null;
    const rows = s.seats
      .slice()
      .sort((a, b) => scoreOf(s, b) - scoreOf(s, a))
      .map((x) => `${SEATS_LOCAL[x]?.name ?? x}: ${money(scoreOf(s, x))}`);
    return {
      winners: [s.winner],
      text: `${SEATS_LOCAL[s.winner]?.name ?? s.winner} вернулся домой первым — экспедиция окончена. Итог: ${rows.join('; ')}.`,
      scores: Object.fromEntries(s.seats.map((x) => [x, scoreOf(s, x)])),
    };
  },
  showcase: () => {
    const s = newState([0, 1, 2], { int: (n: number) => n - 1 } as Rng);
    s.money = [START_MONEY, START_MONEY - 40000, START_MONEY - 20000];
    s.items[0] = ['horse', 'photo', 'revolver', 'helmet'];
    s.items[1] = ['photo', 'suit'];
    s.items[2] = ['gun'];
    s.pos[0] = IDX[5];
    s.pos[1] = IDX[CELLS[40]?.n ?? 5];
    s.pos[2] = IDX[CELLS[90]?.n ?? 5];
    s.phase = 'roll';
    return s;
  },
  rules: {
    goal: 'Собрать экспедицию в страну Джио-Джанга, отснять чудовищ, уцелеть и вернуться домой с деньгами: побеждает тот, у кого в конце больше всего денег, шкур и снаряжения.',
    sections: [
      {
        title: 'Сборы и деньги',
        html: `<p>Каждый получает <b>${START_MONEY.toLocaleString('ru-RU')} $</b> кредита и тратит его на снаряжение: по правилам
          за один ход покупают <b>один предмет</b> — вещей немного, и кому-то не хватит. В набор входят аптечка, спецодежда,
          пробковый шлем, дымовые шашки, подарки для туземцев, надувная лодка, аппаратура (фотоаппарат, кинокамера, видеокамера),
          оружие (револьвер, ружьё, винчестер, карабин) и лошадь. Деньги в конце считают вместе со шкурами и снаряжением.</p>`,
      },
      {
        title: 'Ход и лента',
        html: `<p>Бросают кубик и идут по ленте <b>в любую сторону</b>, сами выбирая дорогу на развилках. У ленты пять цветов точек:
          <b>жёлтые</b> — карточки ситуаций, <b>зелёные</b> — болота, <b>красные</b> — опасные приключения и охота,
          <b>синие</b> — переправа через реку. У домиков, монастыря, хижин и костров останавливаются обязательно.</p>
          <p>Лошадь прибавляет к броску <b>шесть</b>, но её можно вести на поводу — тогда прибавки нет.</p>`,
      },
      {
        title: 'Съёмка, охота и шкуры',
        html: `<p>На красной клетке бросают кубик: <b>1–3</b> — зверь далеко и спокоен, можно снимать; за каждый ход съёмки платят
          по аппаратуре (фото 50 000, кино 70 000, видео 100 000), а редкость зверя умножает цену. <b>4–6</b> — зверь нападает,
          придётся отстреливаться: у каждого зверя своё число попаданий (крокодил и змея — 2, птеродактиль и эйпа — 3,
          чудовище — 5), а потом зверь бьёт в ответ по числу своих атак.</p>
          <p>Убитого зверя продают шкурой: крокодил и змея — 150 000, птеродактиль и эйпа — 250 000, чудовище — 500 000.</p>`,
      },
      {
        title: 'Переправы, болота и туземцы',
        html: `<p>Переправа: через пороги (1–2 — гибель), на лодке местных (1–2 — одна вещь тонет), на плоту (1 — плот развалился),
          на своей надувной лодке (1–2 — две вещи). Болото: москиты требуют спецодежды или аптечки, а в трясине спасают
          по порядку лошадь, потом всё, кроме оружия, потом верёвка. Туземцы-людоеды отпускают за подарки, 10 000, вещь,
          лошадь или дымовые шашки.</p>`,
      },
    ],
  },
};
