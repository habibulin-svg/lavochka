/* Лапта — описание игры: две команды (по месту на команду), удар — действие с силой и направлением, перебежки, ловля
 * и осаливание — решения игроков; исход по часам розыгрыша и физике мяча считает комната (engine.ts). Без DOM. */
import type { DemoScript, GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, flight, formation, intercept, newState, setup, strike, TEAM_NAMES, toAct, type Action, type Event, type State, type Style } from './engine';

export const SEATS = [
  { name: TEAM_NAMES[0], color: '#d8402e', light: '#ff8a6a', dark: '#6e1a10' },
  { name: TEAM_NAMES[1], color: '#2f6ad0', light: '#7aa8ff', dark: '#10306e' },
];

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'human', name: 'Петя', level: 0 },
  { seat: 1, kind: 'bot', name: 'Вова', level: 1 },
];

/** Позиция для показа: свои правила и правка. */
function at(opts: Record<string, string | number | boolean>, patch?: (s: State) => void) {
  return (_d: GameDef, _r: Rng): State => {
    const s = newState(cfgFrom(opts), [0, 1]);
    patch?.(s);
    return s;
  };
}

const CL = { n: 6, field: 50, ctrl: 10, tries: 2, candle: 'point', target: 21 };
const H = (pow: number, yaw: number, style: Style, caption: string) => ({ seat: 0, action: { type: 'hit', pow, yaw, style } as Action, caption });
const R = (who: number[], caption: string) => ({ seat: 0, action: { type: 'run', who } as Action, caption });
/** Кто из полевых раньше всех успеет к мячу этого удара. */
function catcher(pow: number, yaw: number, style: Style, opts = CL): number {
  const c = cfgFrom(opts);
  const b0 = strike(c, pow, yaw, style);
  void flight(b0);
  const f = formation(c);
  let best = 0;
  let bt = Infinity;
  f.forEach((p, i) => {
    const ic = intercept(b0, p);
    if (ic.t < bt) (bt = ic.t), (best = i);
  });
  return best;
}
const C = (who: number, caption: string, rig?: number[]) => ({ seat: 1, action: { type: 'catch', who } as Action, caption, rig });

const ATK = (st: State['teams'][0]['st']) => (s: State) => {
  const t = s.teams[0];
  t.st = st.slice();
  t.queue = st.map((x, i) => (x === 'ready' ? i : -1)).filter((i) => i >= 0);
  s.batter = t.queue[0];
};

export const def: GameDef<State, Action, Event, State> = {
  id: 'lapta',
  title: 'Лапта',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'n',
      label: 'Игроков в команде',
      type: 'select',
      choices: [
        { value: 6, label: '6 — как в большой лапте' },
        { value: 5, label: '5' },
        { value: 4, label: '4 — дворовая' },
        { value: 3, label: '3 — на мало народу' },
      ],
      default: 6,
    },
    {
      key: 'field',
      label: 'Поле',
      hint: 'Длина от линии дома до линии кона; ширина — 3/5 длины',
      type: 'select',
      choices: [
        { value: 50, label: '50 м — большое' },
        { value: 36, label: '36 м — дворовое' },
        { value: 26, label: '26 м — маленькое' },
      ],
      default: 50,
    },
    {
      key: 'ctrl',
      label: 'Контрольная линия',
      hint: 'Мяч должен упасть дальше неё — иначе удар не засчитан',
      type: 'select',
      choices: [
        { value: 10, label: '10 м' },
        { value: 7, label: '7 м' },
        { value: 5, label: '5 м' },
      ],
      default: 10,
    },
    {
      key: 'tries',
      label: 'Попыток удара',
      type: 'select',
      choices: [
        { value: 2, label: 'две' },
        { value: 1, label: 'одна' },
      ],
      default: 2,
    },
    {
      key: 'candle',
      label: 'Свеча (мяч пойман с лёта)',
      type: 'select',
      choices: [
        { value: 'point', label: 'очко защите' },
        { value: 'swap', label: 'команды меняются' },
      ],
      default: 'point',
    },
    { key: 'onlyHitter', label: 'Из дома бежит только ударивший', hint: 'Как в ярославской лапте', type: 'toggle', default: false },
    {
      key: 'target',
      label: 'Игра до',
      type: 'select',
      choices: [
        { value: 21, label: '21 очка' },
        { value: 15, label: '15 очков' },
        { value: 11, label: '11 очков' },
        { value: 7, label: '7 очков' },
      ],
      default: 21,
    },
  ],
  presets: [
    { id: 'classic', label: 'Большая лапта', hint: '6 на 6, поле 50 м, две попытки, свеча — очко, до 21', options: { n: 6, field: 50, ctrl: 10, tries: 2, candle: 'point', onlyHitter: false, target: 21 } },
    { id: 'dvor', label: 'Дворовая', hint: '4 на 4, поле 36 м, свеча — смена, до 15', options: { n: 4, field: 36, ctrl: 7, tries: 2, candle: 'swap', onlyHitter: false, target: 15 } },
    { id: 'malo', label: 'На мало народу', hint: '3 на 3, маленькое поле, одна попытка, бежит только ударивший, до 11', options: { n: 3, field: 26, ctrl: 5, tries: 1, candle: 'swap', onlyHitter: true, target: 11 } },
  ],
  setup: (seats, opts) => setup(opts, seats.map((s) => s.seat).sort((a, b) => a - b)),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    const [a, b] = s.teams;
    const scores: Record<number, number> = { [s.seats[0]]: a.score, [s.seats[1]]: b.score };
    return { winners: s.winners, text: a.score === b.score ? `ничья ${a.score}:${b.score}` : `счёт ${Math.max(a.score, b.score)}:${Math.min(a.score, b.score)}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe(ev, name) {
    const tn = (t: number) => name(t);
    switch (ev.k) {
      case 'hit':
        if (ev.kind === 'ok') return `🏏 ${tn(ev.team)}: удар — мяч за контрольной линией (${Math.round(ev.land?.y ?? 0)} м).`;
        return `🏏 ${tn(ev.team)}: ${ev.kind === 'miss' ? 'промах' : ev.kind === 'short' ? 'недолёт до контрольной линии' : 'аут'}${ev.left > 0 ? ' — ещё попытка' : ''}.`;
      case 'run':
        return `🏃 ${tn(ev.team)}: ${ev.who.length === 1 ? 'побежал' : `побежали ${ev.who.length}`}.`;
      case 'candle':
        return ev.pts ? `🕯 Свеча! ${tn(ev.team)} поймали с лёта: +1.` : `🕯 Свеча! ${tn(ev.team)} поймали с лёта — смена.`;
      case 'safe':
        return ev.at === 'dom' ? `✅ ${tn(ev.team)}: перебежка туда и обратно, <b>+2</b>.` : null;
      case 'salit':
        return `🎯 Осалили! ${tn(ev.team)} уходят в поле.`;
      case 'swap':
        return ev.reason === 'nobat' ? `🔄 В доме не осталось бьющих — ${tn(ev.atk)} бьют.` : `🔄 Смена: бьют ${tn(ev.atk)}.`;
      case 'end':
        return '🏁 Партия окончена.';
      default:
        return null;
    }
  },
  rules: {
    goal: 'Набрать больше очков: отбить мяч битой подальше, перебежать до линии кона и вернуться в дом так, чтобы полевые не «осалили» — не попали в тебя мячом.',
    sections: [
      {
        title: 'Поле и команды',
        html: `<p>Поле — прямоугольник: с одной стороны <b>линия дома</b>, где стоит нападение с битой, с другой — <b>линия кона</b>
          (в большой лапте до неё 40–55 м, во дворе — сколько позволяет пустырь). В 10 м от дома — <b>контрольная линия</b>.
          Играют две команды, на поле — по шесть человек: одна бьёт, другая стоит в поле.</p>
          <p>Мяч бьющему подаёт <b>свой же</b> игрок — подбрасывает перед домом, бьющий отбивает его <b>лаптой</b> — круглой битой.</p>`,
        demo: {
          seats: demoSeats,
          options: CL,
          setup: at(CL),
          steps: [H(0.72, 0.18, 'far', 'Подача — и удар: мяч улетает далеко в поле, за контрольную линию.')],
        } as DemoScript<State, Action>,
      },
      {
        title: 'Удар и попытки',
        html: `<p>Удар <b>засчитан</b>, если мяч первым касанием упал в поле <b>за контрольной линией</b> (или улетел за линию кона между боковыми).
          Недолёт до контрольной, аут за боковую и промах — неудача. У бьющего <b>две попытки</b>; не вышло обе — права бежать по своему удару нет,
          он ждёт в доме удачного удара товарища.</p>`,
        demo: {
          seats: demoSeats,
          options: CL,
          setup: at(CL),
          steps: [H(0.12, 0, 'low', 'Первая попытка: мяч не долетел до контрольной линии — не засчитано.'), H(0.68, -0.2, 'far', 'Вторая попытка — далеко в поле.')],
        } as DemoScript<State, Action>,
      },
      {
        title: 'Перебежка',
        html: `<p>После засчитанного удара можно бежать: ударивший — из дома за линию кона, а кто уже ждёт за коном — обратно домой.
          Бегут <b>в одну сторону</b> за раз: добежал до кона — жди там следующего удара. Вернулся домой — <b>2 очка</b> команде
          и снова право удара. Бежать могут и те в доме, кто уже бил, но ещё не бегал.</p>
          <p>Решаете вы: кому бежать и когда — сразу после удара или когда мяч у полевого далеко.</p>`,
        demo: {
          seats: demoSeats,
          options: CL,
          setup: at(CL, ATK(['ready', 'kon', 'ready', 'ready', 'ready', 'ready'])),
          steps: [
            H(0.8, 0.25, 'low', 'Удар низом, далеко вбок…'),
            R([0, 1], '…бьющий бежит к кону, а тот, кто ждал за коном, — домой.'),
            C(catcher(0.8, 0.25, 'low'), 'Полевой бежит за мячом.'),
            { seat: 1, action: { type: 'hold' } as Action, caption: 'Не догнать — мяч не бросают. Вернувшийся домой принёс команде 2 очка.' },
          ],
        } as DemoScript<State, Action>,
      },
      {
        title: 'Осаливание',
        html: `<p>Полевые ловят мяч и кидают его в бегущего. <b>Попал — осалил</b>: команды меняются местами, бившие уходят в поле.
          Можно и перекинуть мяч товарищу, который стоит ближе к бегущему, — пас быстрее любого бега.
          Решаете вы: кто ловит, в кого кидать или кому дать пас.</p>`,
        demo: {
          seats: demoSeats,
          options: CL,
          setup: at(CL),
          steps: [
            H(0.42, -0.12, 'low', 'Удар слабоват…'),
            R([0], '…но бьющий всё равно бежит.'),
            C(catcher(0.42, -0.12, 'low'), 'Полевой подбирает мяч…'),
            { seat: 1, action: { type: 'throw', at: 0 } as Action, caption: '…и кидает в бегущего: осалил! Команды меняются.', rig: [0] },
          ],
        } as DemoScript<State, Action>,
      },
      {
        title: 'Свеча',
        html: `<p>Мяч, пойманный полевым <b>с лёта</b>, не коснувшись земли, — <b>свеча</b>: защите очко. Во дворе чаще играют строже:
          поймал свечу — и команды меняются. Поэтому высоко «в небо» бьют, только если там никого нет.</p>`,
        demo: {
          seats: demoSeats,
          options: CL,
          setup: at(CL),
          steps: [H(0.5, -0.32, 'candle', 'Свеча — мяч высоко в небо…'), R([], 'Бьющий не бежит: может, поймают.'), C(catcher(0.5, -0.32, 'candle'), '…полевой подбегает и ловит с лёта: очко защите.', [0])],
        } as DemoScript<State, Action>,
      },
      {
        title: 'Смена и конец партии',
        html: `<p>Команды меняются, когда бегущего осалили, когда во дворовой игре поймали свечу и когда в доме <b>не осталось никого с правом удара</b>
          (все отбили, а домой никто не вернулся). Играют до заданного счёта — обычно до 21 очка, во дворе — до 15 или 11.</p>`,
        demo: {
          seats: demoSeats,
          options: CL,
          setup: at(CL, ATK(['ready', 'kon', 'kon', 'kon', 'used', 'used'])),
          steps: [H(0.1, 0, 'low', 'Последний с правом удара — недолёт…'), H(0.11, 0.1, 'low', '…и снова недолёт. Бить больше некому — смена.')],
        } as DemoScript<State, Action>,
      },
      {
        title: 'Дворовые варианты',
        html: `<p><b>Дворовая</b>: четверо на четверо, поле поменьше, свеча — смена, до 15. <b>На мало народу</b>: трое на трое на маленьком поле,
          одна попытка, бежать из дома может только тот, кто сам ударил (как в ярославской лапте), до 11.</p>`,
      },
      {
        title: 'Как бить и командовать',
        html: `<p><b>Удар:</b> нажмите на поле и потяните вниз, как рогатку: дальше тянете — сильнее удар, вбок — мяч уйдёт в сторону.
          Кольцо на земле показывает, куда упадёт мяч. Внизу выберите удар: <b>дальний</b>, <b>низом</b> (быстро, катится) или <b>свечой</b>.
          Слишком сильно — можно промахнуться.</p>
          <p><b>Перебежка:</b> отметьте бегущих касанием (над головой — стрелка) и нажмите «Беги!», или «Стоим» — никто не бежит.
          <b>В поле:</b> коснитесь полевого, который ловит; с мячом в руках — коснитесь бегущего, в кого кинуть, или товарища для паса.</p>`,
      },
    ],
  },
  showcase() {
    const s = newState(cfgFrom({}), [0, 1]);
    s.teams[0].score = 8;
    s.teams[1].score = 6;
    s.shot = true;
    return s;
  },
};
