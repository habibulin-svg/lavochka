/* Партизаны — описание игры для сборника: роли, группы, голосование, операции, проверка, разведчик и снайпер; боты; правила с показом. Без DOM. */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, failsNeeded, makeView, ROLE_LOW, setup, SIDE_NAME, teamSize, toAct, traitorsFor, type Action, type Event, type Role, type State, type View } from './engine';

export const SEATS = [
  ['Вовка', '#b3322a'], ['Ленка', '#2b5c9e'], ['Серёга', '#2f7a3e'], ['Танька', '#c48a12'], ['Димон', '#6a3d8f'],
  ['Светка', '#c2185b'], ['Жека', '#0f7a7a'], ['Михалыч', '#8a5a2a'], ['Олька', '#7a3aa0'], ['Колян', '#5a5a5a'],
].map(([name, color]) => ({ name, color, light: color, dark: color }));

const names = (xs: number[], name: (seat: number) => string) => xs.map(name).join(', ');

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'op':
      return `<b>Операция ${ev.op + 1}</b>: группа из ${ev.size}${ev.need > 1 ? `, проваливают ${ev.need} срыва` : ''}.`;
    case 'leader':
      return ev.tryNo > 1 ? `Командир — ${name(ev.leader)} (попытка ${ev.tryNo} из 5).` : `Командир — ${name(ev.leader)}.`;
    case 'team':
      return `${name(ev.leader)} берёт в группу: ${names(ev.team, name)}. Голосуем!`;
    case 'votes': {
      const yes = Object.entries(ev.votes).filter(([, y]) => y).map(([x]) => name(+x));
      const no = Object.entries(ev.votes).filter(([, y]) => !y).map(([x]) => name(+x));
      return `${ev.passed ? '✅ Группа утверждена' : `❌ Не утверждена (отказов подряд: ${ev.rejects})`}. За: ${yes.join(', ') || '—'}; против: ${no.join(', ') || '—'}.`;
    }
    case 'result':
      return ev.ok
        ? `🌲 Операция удалась${ev.fails ? ` (срывов: ${ev.fails}, но нужно больше)` : ''}. Счёт ${ev.done}:${ev.failed}.`
        : `💥 Операция сорвана: срывов — ${ev.fails}. Счёт ${ev.done}:${ev.failed}.`;
    case 'checked':
      return `🔍 ${name(ev.by)} проверяет ${name(ev.target)}.`;
    case 'claim':
      return ev.side ? `${name(ev.by)}: «${name(ev.target)} — ${SIDE_NAME[ev.side]}».` : `${name(ev.by)} промолчал о проверке.`;
    case 'hunt':
      return '🎯 Три операции удались — но снайпер ещё может найти разведчика.';
    case 'shoot':
      return `🎯 ${name(ev.sniper)} стреляет в ${name(ev.target)} — ${ev.hit ? 'это был разведчик!' : 'мимо, это не разведчик.'}`;
    case 'over': {
      const roles = Object.entries(ev.roles)
        .filter(([, r]) => r !== 'partisan')
        .map(([x, r]) => `${name(+x)} — ${ROLE_LOW[r as Role]}`)
        .join(', ');
      return `🏁 ${ev.winner === 'P' ? 'Победа партизан' : 'Победа предателей'}: ${ev.reason}. ${roles}.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats = (n: number): SeatSpec[] => Array.from({ length: n }, (_, seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const fixedRng: Rng = { next: () => 0, int: () => 0, getState: () => 0 };

/** Позиция для показа: роли заданы, ночь позади, операция op, командир leader. */
function pos(roles: Role[], leader: number, extra: Partial<State> = {}, opts: Record<string, boolean> = {}): State {
  const n = roles.length;
  const s = setup(Array.from({ length: n }, (_, i) => i), opts, fixedRng);
  s.roles = Object.fromEntries(roles.map((r, i) => [i, r]));
  s.phase = 'propose';
  s.leader = leader;
  Object.assign(s, extra);
  return s;
}
const R5: Role[] = ['partisan', 'traitor', 'partisan', 'traitor', 'partisan'];
const R7S: Role[] = ['partisan', 'traitor', 'scout', 'sniper', 'partisan', 'traitor', 'partisan'];
const act = (seat: number, action: Action, caption?: string) => ({ seat, action, caption });
const votes = (n: number, yes: number[], caption?: string) =>
  Array.from({ length: n }, (_, x) => act(x, { type: 'vote', yes: yes.includes(x) }, x === n - 1 ? caption : undefined));
const op = (n: number, k: number, extra: object = {}) => ({ size: teamSize(n, k), need: failsNeeded(n, k), tries: [], ...extra });

export const def: GameDef<State, Action, Event, View> = {
  id: 'partizany',
  title: 'Партизаны',
  players: { min: 5, max: 10, default: 7 },
  seats: SEATS,
  options: [
    { key: 'scout', label: 'Разведчик и снайпер', hint: 'разведчик знает предателей; после трёх удач снайпер может его застрелить и победить', type: 'toggle', default: false },
    { key: 'check', label: 'Проверка', hint: 'после 2-й, 3-й и 4-й операции хозяин жетона узнаёт сторону игрока и передаёт ему жетон', type: 'toggle', default: false },
  ],
  presets: [
    { id: 'classic', label: 'Обычная', hint: 'Партизаны и предатели, пять операций', options: { scout: false, check: false } },
    { id: 'scout', label: 'С разведчиком', hint: 'Разведчик знает предателей, но должен не выдать себя снайперу', options: { scout: true, check: false } },
    { id: 'check', label: 'С проверкой', hint: 'Жетон проверки ходит по столу после 2-й, 3-й и 4-й операции', options: { scout: false, check: true } },
    { id: 'full', label: 'Всё вместе', hint: 'Разведчик, снайпер и проверка', options: { scout: true, check: true } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng, seats.filter((x) => x.kind !== 'bot').map((x) => x.seat)),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  result(s) {
    if (s.phase !== 'over' || !s.winner) return null;
    const winners = s.seats.filter((x) => (s.roles[x] === 'partisan' || s.roles[x] === 'scout') === (s.winner === 'P'));
    return { winners, text: `${s.winner === 'P' ? 'победа партизан' : 'победа предателей'}: ${s.reason}` };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos(R7S, 4, { op: 3 }, { scout: true });
    s.ops = [
      op(7, 0, { tries: [{ leader: 1, team: [1, 2], passed: true, votes: { 0: true, 1: true, 2: true, 3: true, 4: false, 5: true, 6: true } }], fails: 0, ok: true }),
      op(7, 1, { tries: [{ leader: 2, team: [0, 2, 3], passed: true, votes: { 0: true, 1: false, 2: true, 3: true, 4: true, 5: true, 6: false } }], fails: 1, ok: false }),
      op(7, 2, { tries: [{ leader: 3, team: [3, 5, 6], passed: false, votes: { 0: false, 1: true, 2: false, 3: true, 4: false, 5: true, 6: false } }, { leader: 4, team: [0, 2, 4], passed: true, votes: { 0: true, 1: false, 2: true, 3: false, 4: true, 5: true, 6: true } }], fails: 0, ok: true }),
      op(7, 3, { tries: [{ leader: 4, team: [0, 2, 4, 6] }] }),
    ];
    s.team = [0, 2, 4, 6];
    s.phase = 'vote';
    s.votes = { 0: true, 2: true, 5: false };
    return s;
  },

  rules: {
    goal: 'В отряде партизан затесались предатели — они знают друг друга, партизаны не знают никого. Партизанам — провести три удачные операции из пяти, предателям — сорвать три или добиться, чтобы пять групп подряд не утвердили.',
    sections: [
      {
        title: 'Роли',
        html: `<p>Каждый втайне получает роль: <b>партизан</b> или <b>предатель</b>. Предатели в начале узнают друг друга (это делает стол — на карте роли видно своих).</p>
          <table class="pz-tab"><tr><th>Игроков</th><td>5</td><td>6</td><td>7</td><td>8</td><td>9</td><td>10</td></tr>
          <tr><th>Партизан</th><td>3</td><td>4</td><td>4</td><td>5</td><td>6</td><td>6</td></tr>
          <tr><th>Предателей</th><td>2</td><td>2</td><td>3</td><td>3</td><td>3</td><td>4</td></tr></table>
          <p>Говорить можно что угодно — в чате и голосом. Карты ролей до конца игры не показывают.</p>`,
      },
      {
        title: 'Группа и голосование',
        html: `<p>Командир (по кругу) набирает группу на операцию — себя брать не обязательно. Сколько человек в группе, зависит от операции и числа игроков:</p>
          <table class="pz-tab"><tr><th>Игроков</th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th></tr>
          <tr><td>5</td><td>2</td><td>3</td><td>2</td><td>3</td><td>3</td></tr>
          <tr><td>6</td><td>2</td><td>3</td><td>4</td><td>3</td><td>4</td></tr>
          <tr><td>7</td><td>2</td><td>3</td><td>3</td><td>4*</td><td>4</td></tr>
          <tr><td>8–10</td><td>3</td><td>4</td><td>4</td><td>5*</td><td>5</td></tr></table>
          <p>Потом голосуют <b>все разом</b>: «за» или «против». Больше половины «за» — группа идёт на операцию. Иначе командирство переходит к следующему,
          и он набирает свою группу. <b>Пять отказов подряд</b> на одной операции — победа предателей.</p>`,
        demo: {
          seats: demoSeats(5),
          setup: () => pos(R5, 0),
          intro: 'Командир — Вовка. На первую операцию нужна группа из двух.',
          steps: [act(0, { type: 'team', members: [0, 2] }, 'Вовка берёт себя и Серёгу.'), ...votes(5, [0, 2, 3, 4], 'Голоса открываются разом: 4 «за», 1 «против» — группа утверждена.')],
        },
      },
      {
        title: 'Операция',
        html: `<p>Каждый в группе втайне кладёт карту: <b>«успех»</b> или <b>«срыв»</b>. Партизан может положить только «успех», предатель — любую.
          Карты перемешивают и открывают: видно, сколько срывов, но не чьи. Хотя бы один срыв — операция провалена.
          <b>*</b> На 4-й операции при 7 и больше игроках нужно два срыва.</p>
          <p>Предателю не всегда выгодно срывать: в маленькой группе срыв сразу бросает на него тень.</p>`,
        demo: {
          seats: demoSeats(5),
          setup: () => {
            const s = pos(R5, 2, { op: 1 });
            s.ops = [op(5, 0, { tries: [{ leader: 0, team: [0, 2], passed: true }], fails: 0, ok: true }), op(5, 1, { tries: [{ leader: 2, team: [1, 2, 4], passed: true }] })];
            s.team = [1, 2, 4];
            s.phase = 'mission';
            return s;
          },
          intro: 'Вторая операция: в группе Ленка, Серёга и Димон. Ленка — предатель.',
          steps: [act(1, { type: 'card', fail: true }), act(2, { type: 'card', fail: false }), act(4, { type: 'card', fail: false }, 'Открыли: один срыв. Операция сорвана — кто-то из троих предатель.')],
        },
      },
      {
        title: 'Разведчик и снайпер',
        html: `<p>По желанию (пресет «С разведчиком»). Один партизан — <b>разведчик</b>: он знает всех предателей. Один предатель — <b>снайпер</b>.
          Если партизаны провели три операции, снайпер (посоветовавшись со своими) стреляет в одного игрока: попал в разведчика — победа предателей.
          Разведчику нужно направлять отряд, не выдавая себя.</p>`,
        demo: {
          seats: demoSeats(7),
          options: { scout: true },
          setup: () => {
            const s = pos(R7S, 0, { op: 3, phase: 'hunt' }, { scout: true });
            s.ops = [0, 1, 2].map((k) => op(7, k, { fails: k === 1 ? 1 : 0, ok: k !== 1 }));
            s.ops[3] = op(7, 3, { fails: 0, ok: true });
            return s;
          },
          intro: 'Три операции удались. Ход снайпера Таньки.',
          steps: [act(3, { type: 'shoot', target: 2 }, 'Танька стреляет в Серёгу — он и был разведчиком. Предатели победили.')],
        },
      },
      {
        title: 'Проверка',
        html: `<p>По желанию (пресет «С проверкой»). Жетон проверки в начале получает игрок, сидящий перед первым командиром.
          После 2-й, 3-й и 4-й операции хозяин жетона втайне узнаёт, на чьей стороне один игрок, и объявляет это — можно соврать.
          Жетон переходит к проверенному. Того, кто уже держал жетон, проверять нельзя.</p>`,
        demo: {
          seats: demoSeats(5),
          options: { check: true },
          setup: () => {
            const s = pos(R5, 2, { op: 1, phase: 'check', holder: 4, held: [4] }, { check: true });
            s.ops = [op(5, 0, { fails: 0, ok: true }), op(5, 1, { fails: 1, ok: false })];
            return s;
          },
          intro: 'После второй операции жетон у Димона.',
          steps: [act(4, { type: 'check', target: 1 }, 'Димон проверяет Ленку и видит: предатель.'), act(4, { type: 'claim', side: 'T' }, '«Ленка — предатель». Жетон теперь у Ленки.')],
        },
      },
      {
        title: 'Подсказки',
        html: `<p>Партизанам — следить, кто был в сорванных группах и кто голосовал за них. Чистая группа — та, где все прошли удачные операции.
          Предателям — голосовать как партизаны, срывать в больших группах и вовремя, а под конец — сеять споры, чтобы группы не утверждали.
          Число предателей: ${[5, 6, 7, 8, 9, 10].map((n) => `${n} — ${traitorsFor(n)}`).join(', ')}.</p>`,
      },
    ],
  },
};
