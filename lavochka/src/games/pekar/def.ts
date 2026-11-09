/* Пекарь — описание игры: от двух до шести игроков, каждый сам за себя; пекарь — по очереди. Бросок палки и пинок —
 * действия с силой и направлением, бег за палкой, «поставить банку» и «салить» — решения игроков; исход по часам
 * розыгрыша и физике палки считает комната (engine.ts). Без DOM. */
import type { DemoScript, GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, newState, rankName, setup, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Красный', color: '#d8402e', light: '#ff8a6a', dark: '#6e1a10' },
  { name: 'Синий', color: '#2f6ad0', light: '#7aa8ff', dark: '#10306e' },
  { name: 'Зелёный', color: '#2f9a48', light: '#7ad88a', dark: '#104a1e' },
  { name: 'Жёлтый', color: '#e0a020', light: '#ffd86a', dark: '#6a4a08', ink: '#a87410' },
  { name: 'Фиолетовый', color: '#8a4ac8', light: '#c8a0f0', dark: '#3a1a60' },
  { name: 'Белый', color: '#e8e4da', light: '#ffffff', dark: '#6a665e', ink: '#6a665e' },
];

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'human', name: 'Петя', level: 0 },
  { seat: 1, kind: 'bot', name: 'Вова', level: 1 },
  { seat: 2, kind: 'bot', name: 'Серый', level: 1 },
];

const CL = { dist: 14, ranks: 'full', demote: false, target: 5 };

/** Позиция после жеребьёвки: пекарь — Серый (2), бросают Петя, потом Вова. */
function at(opts: Record<string, string | number | boolean>, patch?: (s: State) => void) {
  return (_d: GameDef, _r: Rng): State => {
    const s = newState(cfgFrom(opts, 3), [0, 1, 2]);
    s.kicks = [12, 10, 7];
    s.order = [0, 1, 2];
    s.pekar = 2;
    s.pl[2].stick = 'pekar';
    s.queue = [0, 1];
    s.phase = 'throw';
    patch?.(s);
    return s;
  };
}

/** Броски, проверенные по физике (tests/pekar.test.ts): с черты рядового на 14 м. */
const HIT = { type: 'throw', pow: 0.66, yaw: -0.022, style: 'flat' } as Action;
const SHORT = { type: 'throw', pow: 0.3, yaw: -0.02, style: 'flat' } as Action;
const LONG = { type: 'throw', pow: 0.95, yaw: 0.02, style: 'flat' } as Action;
const T = (seat: number, action: Action, caption: string, rig?: number[]) => ({ seat, action, caption, rig });

export const def: GameDef<State, Action, Event, State> = {
  id: 'pekar',
  title: 'Пекарь',
  players: { min: 2, max: 6, default: 4 },
  seats: SEATS,
  options: [
    {
      key: 'ranks',
      label: 'Звания',
      hint: 'Сбил банку — звание выше и черта ближе к банке',
      type: 'select',
      choices: [
        { value: 'full', label: 'от рядового до маршала (9)' },
        { value: 'short', label: 'короткие: рядовой — генерал (5)' },
        { value: 'none', label: 'без званий — на счёт' },
      ],
      default: 'full',
    },
    {
      key: 'dist',
      label: 'До банки',
      hint: 'От черты рядового до банки',
      type: 'select',
      choices: [
        { value: 14, label: '14 м' },
        { value: 11, label: '11 м' },
        { value: 9, label: '9 м — малышам' },
      ],
      default: 14,
    },
    {
      key: 'target',
      label: 'Без званий: до сбитых банок',
      type: 'select',
      choices: [
        { value: 3, label: '3' },
        { value: 5, label: '5' },
        { value: 7, label: '7' },
      ],
      default: 5,
    },
    { key: 'demote', label: 'Пекарь теряет звание', hint: 'Кого осалили — тот пекарь и на ступень ниже', type: 'toggle', default: false },
  ],
  presets: [
    { id: 'classic', label: 'Классика со званиями', hint: 'рядовой → маршал, 14 м до банки; сбил маршалом — победа', options: { ranks: 'full', dist: 14, demote: false, target: 5 } },
    { id: 'dvor', label: 'Дворовый короткий', hint: '5 званий, 11 м, осаленный теряет звание', options: { ranks: 'short', dist: 11, demote: true, target: 5 } },
    { id: 'schet', label: 'Без званий', hint: 'одна черта в 11 м, до пяти сбитых банок', options: { ranks: 'none', dist: 11, demote: false, target: 5 } },
  ],
  setup: (seats, opts) => setup(opts, seats.map((s) => s.seat).sort((a, b) => a - b)),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    const scores: Record<number, number> = {};
    s.seats.forEach((seat, i) => (scores[seat] = s.cfg.ranks.length > 1 ? s.pl[i].rank : s.pl[i].knocks));
    const w = s.seats.indexOf(s.winners[0]);
    const p = s.pl[w];
    return { winners: s.winners, text: s.cfg.ranks.length > 1 ? (p && p.rank >= s.cfg.ranks.length ? 'сбил банку маршалом' : `выше всех званием — ${rankName(s.cfg, p)}`) : `сбил ${p?.knocks ?? 0} банок`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe(ev, name) {
    const nm = (i: number) => `<b>${name(i)}</b>`;
    // в событиях — номера игроков; места совпадают с номерами по порядку мест (setup сортирует)
    switch (ev.k) {
      case 'kick':
        return ev.slip ? `🦶 ${nm(ev.who)}: палка сорвалась с ноги — ${ev.d.toFixed(1)} м.` : `🦶 ${nm(ev.who)} пнул палку на ${ev.d.toFixed(1)} м.`;
      case 'draw':
        return `🥫 Пекарь — ${nm(ev.pekar)}: ближе всех.`;
      case 'throw':
        return ev.hit ? `💥 ${nm(ev.who)} сбил банку!` : null;
      case 'rank':
        return null;
      case 'run':
        return ev.go ? `🏃 ${nm(ev.who)} побежал за палкой.` : null;
      case 'collect':
        return '🚶 Все промахнулись — идут за палками.';
      case 'chase':
        return ev.tag ? `✋ Пекарь осалил ${nm(ev.target!)}!` : `💨 Пекарь не догнал ${ev.target != null ? nm(ev.target) : ''}.`;
      case 'pekar':
        return `🥫 Теперь пекарь — ${nm(ev.who)}.`;
      case 'end':
        return '🏁 Партия окончена.';
      default:
        return null;
    }
  },
  rules: {
    goal: 'Сбить палкой консервную банку столько раз, чтобы дойти от рядового до маршала и сбить её маршалом. Сторожит банку пекарь: кого он осалит в поле — тот и печёт.',
    sections: [
      {
        title: 'Жеребьёвка: кто пекарь',
        html: `<p>Перед игрой каждый ставит палку на носок и <b>пинком</b> выбрасывает её вперёд. У кого палка улетела <b>ближе всех</b> — тот первый пекарь.
          Остальные бросают по дальности пинка: дальше всех — первым. Пнёшь изо всех сил — палка может сорваться с ноги.</p>`,
        demo: {
          seats: demoSeats,
          options: CL,
          steps: [T(0, { type: 'kick', pow: 0.75 }, 'Петя пинает палку…'), T(1, { type: 'kick', pow: 0.6 }, 'Вова — чуть ближе.'), T(2, { type: 'kick', pow: 0.3 }, 'У Серого ближе всех: он и пекарь.')],
        } as DemoScript<State, Action>,
      },
      {
        title: 'Банка и броски',
        html: `<p>В меловом кружке стоит <b>консервная банка</b>, рядом сторожит пекарь. Игроки по очереди кидают в неё палки из-за <b>черты</b>.
          Палка остаётся лежать там, где упала: пока её не подобрал, бросать нечем. Кидают <b>низом</b> — палка крутится плашмя и сметает широко, —
          или <b>навесом</b>, кувырком: точнее по дальности, но попасть труднее.</p>`,
        demo: {
          seats: demoSeats,
          options: CL,
          setup: at(CL),
          steps: [T(0, SHORT, 'Слабо — палка легла, не долетев.'), T(1, LONG, 'Перекинул — палка улетела за банку, к самому пекарю.')],
        } as DemoScript<State, Action>,
      },
      {
        title: 'Сбил банку — звание выше',
        html: `<p>Сбил банку — получаешь <b>звание</b>: рядовой, ефрейтор, сержант, лейтенант, капитан, майор, полковник, генерал, маршал.
          Чем выше звание, тем <b>ближе к банке</b> твоя черта. Кто сбил банку маршалом — выиграл.</p>
          <p>Пока банка лежит, пекарь салить не может: сначала он бежит за ней и ставит на место.</p>`,
        demo: {
          seats: demoSeats,
          options: CL,
          setup: at(CL),
          steps: [T(0, HIT, 'Точно в банку! Петя теперь ефрейтор — и черта у него ближе.'), T(0, { type: 'run', go: true } as Action, 'Петя бежит за палкой.'), T(2, { type: 'fix' } as Action, 'Пекарь бежит за банкой и ставит её в кружок…'), T(2, { type: 'chase', who: null } as Action, '…но Петя уже за чертой: салить некого.')],
        } as DemoScript<State, Action>,
      },
      {
        title: 'Бег за палкой и осаливание',
        html: `<p>Пока пекарь ставит банку, все, чьи палки лежат в поле, могут сбегать за ними и вернуться за свою черту. Можно и остаться — тогда
          палка лежит до следующего раза, а бросать нечем. Поставив банку, пекарь <b>салит</b> палкой того, кто ещё в поле. Осаленный становится
          пекарем, а бывший пекарь берёт палку и бросает со своей черты. Палка, упавшая у самой банки, — самая опасная: бежать за ней дальше всех.</p>`,
        demo: {
          seats: demoSeats,
          options: CL,
          setup: at(CL, (s) => {
            // палка Вовы лежит за банкой — у самого пекаря
            s.pl[1].stick = 'field';
            [s.pl[1].sx, s.pl[1].sy, s.pl[1].sa] = [0.8, 17.5, 1.2];
            s.queue = [0];
          }),
          steps: [
            T(0, HIT, 'Петя сбивает банку.'),
            T(0, { type: 'run', go: true } as Action, 'Петя бежит за своей палкой…'),
            T(1, { type: 'run', go: true } as Action, '…и Вова — за своей, а она далеко, за банкой.'),
            T(2, { type: 'fix' } as Action, 'Пекарь ставит банку…'),
            T(2, { type: 'chase', who: 1 } as Action, '…и догоняет Вову: осалил! Теперь пекарь — Вова.', [0]),
          ],
        } as DemoScript<State, Action>,
      },
      {
        title: 'Все промахнулись',
        html: `<p>Если бросили все, а банка стоит, бросать больше нечем — за палками идут <b>все разом</b>. Банка на месте, поэтому пекарь салит сразу,
          не тратя время. Тут и пригодится палка, упавшая недалеко от черты.</p>`,
        demo: {
          seats: demoSeats,
          options: CL,
          setup: at(CL),
          steps: [T(0, SHORT, 'Петя — недолёт.'), T(1, LONG, 'Вова — перелёт. Бросать больше нечем: все идут за палками.'), T(2, { type: 'chase', who: 1 } as Action, 'Пекарь рядом с палкой Вовы — салит его.', [0])],
        } as DemoScript<State, Action>,
      },
      {
        title: 'Варианты',
        html: `<p><b>Дворовый короткий</b>: званий пять — рядовой, сержант, лейтенант, капитан, генерал, до банки 11 м, а кого осалили, тот не только печёт,
          но и теряет одно звание. <b>Без званий</b>: все бросают с одной черты, побеждает тот, кто первым собьёт пять банок.</p>`,
      },
      {
        title: 'Как бросать и командовать',
        html: `<p><b>Бросок:</b> нажмите на поле и потяните вниз, как рогатку: дальше тянете — сильнее, вбок — палка уйдёт в сторону. Пунктир показывает
          полёт, кольцо — где палка ляжет. Рука чуть дрожит. Внизу выберите бросок: <b>низом</b> или <b>навесом</b>. На жеребьёвке так же — только сила.</p>
          <p><b>За палкой:</b> «Бегу!» или «Стою». <b>Пекарем:</b> коснитесь банки (или «Поставить банку»), потом — того, кого салить (над ним бирка с шансом),
          или «Не догнать».</p>`,
      },
    ],
  },
  showcase() {
    const s = newState(cfgFrom({}, 4), [0, 1, 2, 3]);
    s.kicks = [12, 10, 9, 7];
    s.order = [0, 1, 2, 3];
    s.pekar = 3;
    s.pl[3].stick = 'pekar';
    s.pl[0].rank = 3;
    s.pl[1].stick = 'field';
    [s.pl[1].sx, s.pl[1].sy, s.pl[1].sa] = [1.2, 9.5, 0.6];
    s.queue = [0, 2];
    s.phase = 'throw';
    s.shot = true;
    return s;
  },
};
