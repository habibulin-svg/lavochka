/* Лапта — описание игры: две команды (место на команду), игра реального времени — комната крутит шаги, каждая сторона
 * ведёт своего пацана (переключается на любого), остальных — ИИ-напарник. Без DOM. */
import { demoApply, rtStep } from '../../core/dvorsport/demo';
import { DS_SPEED_OPTION, dsSpeed } from '../../core/dvorsport/sim';
import type { DemoScript, GameDef, SeatSpec } from '../../core/types';
import { botInput } from './ai';
import { cleanInput, idleInput, newGame, snapshot, step, TICK_MS, type Event, type In, type State } from './engine';
import type { PStatus, Style } from './field';
import { strike } from './field';


// ---------------------------------------------------------------- показ правил (core/dvorsport/demo.ts)

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'human', name: 'Петя', level: 0 },
  { seat: 1, kind: 'bot', name: 'Вова', level: 2 },
];
const CL = { n: 6, field: 50, ctrl: 10, tries: 2, candle: 'point', target: 15, minutes: 0 };
const DV = { n: 4, field: 36, ctrl: 7, tries: 2, candle: 'swap', target: 11, minutes: 0 };
/** Позиция показа: свои правила, статусы нападения (по номерам), скорость физики показа. */
function at(opts: Record<string, string | number>, st?: PStatus[]) {
  return (): State => {
    const s = newGame(opts, [0, 1], 0.6);
    s.demo = true;
    if (st) {
      s.men[0].forEach((m, i) => (m.st = st[i] ?? 'ready'));
      s.queue = st.map((x, i) => (x === 'ready' ? i : -1)).filter((i) => i >= 0);
      s.batter = s.queue[0];
    }
    return s;
  };
}
/** Ввод «Пети»: свой пацан (удар, бег); «Вова» — вся команда на ИИ. */
const P = (o: Partial<In> = {}): In => ({ mx: 0, my: 0, k: -1, ai: -1, ...o });
const V: In = { mx: 0, my: 0, k: -1, ai: 2 };
const hit = (n: number, pow: number, yaw: number, style: Style) => ({ n, pow, yaw, style });
const go = (caption: string, inp: Partial<In>, until: string, ticks = 1500, tail = 40) => ({ seat: 0, action: rtStep({ ticks, inputs: { 0: P(inp), 1: V }, until, tail }) as never, caption });
const demo = (opts: Record<string, string | number>, steps: ReturnType<typeof go>[], st?: PStatus[]): DemoScript<State, never> => ({ seats: demoSeats, options: opts, setup: at(opts, st), steps });

export const TEAM_NAMES = ['Затулинка', 'Затон'];

export const SEATS = [
  { name: TEAM_NAMES[0], color: '#d8402e', light: '#ff8a6a', dark: '#6e1a10' },
  { name: TEAM_NAMES[1], color: '#2f6ad0', light: '#7aa8ff', dark: '#10306e' },
];

export const def: GameDef<State, never, Event, State> = {
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
      default: 15,
    },
    {
      key: 'minutes',
      label: 'Время',
      hint: 'Вышло время — побеждает тот, у кого больше очков',
      type: 'select',
      choices: [
        { value: 10, label: '10 минут' },
        { value: 15, label: '15 минут' },
        { value: 20, label: '20 минут' },
        { value: 0, label: 'без времени' },
      ],
      default: 15,
    },
    DS_SPEED_OPTION,
  ],
  presets: [
    { id: 'classic', label: 'Большая лапта', hint: '6 на 6, поле 50 м, две попытки, свеча — очко, до 15 очков или 15 минут', options: { n: 6, field: 50, ctrl: 10, tries: 2, candle: 'point', onlyHitter: false, target: 15, minutes: 15 } },
    { id: 'dvor', label: 'Дворовая', hint: '4 на 4, поле 36 м, свеча — смена, до 11 или 10 минут', options: { n: 4, field: 36, ctrl: 7, tries: 2, candle: 'swap', onlyHitter: false, target: 11, minutes: 10 } },
    { id: 'malo', label: 'На мало народу', hint: '3 на 3, маленькое поле, одна попытка, бежит только ударивший, до 7', options: { n: 3, field: 26, ctrl: 5, tries: 1, candle: 'swap', onlyHitter: true, target: 7, minutes: 10 } },
  ],
  setup: (seats, opts) => {
    const ss = seats.map((x) => x.seat).sort((a, b) => a - b);
    return newGame(opts, [ss[0] ?? 0, ss[1] ?? 1], dsSpeed(opts));
  },
  toAct: (s) => (s.over ? [] : [s.seats[0], s.seats[1]]),
  apply: (s, _seat, a, rng) => demoApply(s, a, rng, { step, view: snapshot }) as never,
  view: (s) => snapshot(s),
  result(s) {
    if (!s.over) return null;
    const [a, b] = s.score;
    const scores: Record<number, number> = { [s.seats[0]]: a, [s.seats[1]]: b };
    return { winners: s.winners, text: a === b ? `ничья ${a}:${b}` : `счёт ${Math.max(a, b)}:${Math.min(a, b)}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: () => null },
  realtime: {
    tickMs: TICK_MS,
    sendEvery: 2,
    idle: idleInput,
    input: cleanInput,
    tick: (s, inputs, rng) => step(s, inputs as In[], rng),
    bot: (view, seat, level) => botInput(view, seat, level),
  },
  describe(ev, name) {
    switch (ev.k) {
      case 'hit':
        if (ev.kind === 'ok') return `🏏 ${name(ev.team)}: удар — мяч в поле!`;
        return `🏏 ${name(ev.team)}: ${ev.kind === 'miss' ? 'промах' : ev.kind === 'short' ? 'недолёт до контрольной линии' : 'аут'}${ev.left > 0 ? ' — ещё попытка' : ''}.`;
      case 'candle':
        return ev.pts ? `🕯 Свеча! ${name(ev.team)} поймали с лёта: +1.` : `🕯 Свеча! ${name(ev.team)} поймали с лёта — смена.`;
      case 'safe':
        return ev.at === 'dom' ? `✅ ${name(ev.team)}: №${ev.who + 1} — перебежка туда и обратно, <b>+2</b>.` : null;
      case 'salit':
        return `🎯 Осалили №${ev.who + 1}! ${name(ev.team)} уходят в поле.`;
      case 'swap':
        return ev.reason === 'nobat' ? `🔄 В доме не осталось бьющих — бьют ${name(ev.atk)}.` : `🔄 Смена: бьют ${name(ev.atk)}.`;
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
          Играют две команды по шесть человек: одна бьёт, другая стоит в поле. Мяч бьющему подаёт <b>свой же</b> игрок.</p>
          <p>Ты ведёшь <b>одного своего пацана</b> — того, над кем жёлтое кольцо и стрелка; остальными играет компьютер-напарник.
          Переключиться на другого можно в любой момент.</p>`,
        demo: demo(CL, [go('Свой подбрасывает — удар низом далеко в поле; полевой бежит и подбирает мяч.', { hit: hit(1, 0.8, 0.3, 'low') }, 'catch')]),
      },
      {
        title: 'Удар',
        html: `<p>Удар <b>засчитан</b>, если мяч первым касанием упал в поле <b>за контрольной линией</b> (или улетел за линию кона между боковыми).
          Недолёт, аут за боковую и промах — неудача. У бьющего <b>две попытки</b>; не вышло обе — он ждёт в доме удачного удара товарища.</p>
          <p>Бить: потяни мышью или пальцем вниз, как рогатку, и отпусти; вбок — направление. Удар бывает дальний, низом и свечой.</p>`,
        demo: demo(CL, [go('Слабо — мяч не долетел до контрольной линии: удар не засчитан, ещё попытка.', { hit: hit(1, 0.1, 0, 'low') }, 'hit', 400, 100), go('Вторая попытка — далеко в поле.', { hit: hit(2, 0.8, -0.3, 'low') }, 'catch')]),
      },
      {
        title: 'Перебежка и уклонение',
        html: `<p>Пока мяч в игре после засчитанного удара, можно бежать: ударивший и те в доме, кто уже бил, — к линии кона, а кто ждёт
          за коном — домой. Выбегаешь сам, когда решишь, и бежишь куда хочешь. Добежал до кона — жди там; вернулся домой — <b>2 очка</b>
          команде и снова право удара. Летит мяч — <b>рывок</b> в сторону, чтобы увернуться.</p>`,
        demo: demo(CL, [go('Удар — и тот, кто ждал за коном, бежит домой: +2 очка.', { hit: hit(1, 0.8, 0.3, 'low') }, 'dead', 1500, 20), go('Следующий бьёт — и сам бежит к кону, а полевые кидают мимо.', { hit: hit(2, 0.6, -0.2, 'low'), my: 1, mx: 0.3 }, 'safe', 1500, 40)], ['ready', 'kon', 'ready', 'ready', 'ready', 'ready']),
      },
      {
        title: 'Ловля и осаливание',
        html: `<p>В поле беги к мячу. Мяч с лёта ловят <b>кнопкой «Ловить» вовремя</b> — когда он подлетает к рукам; с земли мяч подбирается сам.
          С мячом в руках коснись бегущего — бросок в него с упреждением, или своего — <b>пас</b>. Попал в бегущего — <b>осалил</b>:
          команды меняются местами.</p>`,
        demo: demo(CL, [go('Удар слабоват, но бьющий бежит. Полевой подбирает мяч и кидает: осалил — команды меняются.', { hit: hit(1, 0.42, -0.1, 'low'), my: 1 }, 'swap', 1500, 90)]),
      },
      {
        title: 'Свеча',
        html: `<p>Мяч от удара, пойманный <b>с лёта</b>, — <b>свеча</b>: защите очко. Во дворе чаще играют строже: поймал свечу — и команды меняются.</p>`,
        demo: demo(CL, [go('Свечой — прямо на полевого: он ловит с лёта, защите очко.', { hit: hit(1, 0.5, -0.32, 'candle') }, 'candle', 900, 60)]),
      },
      {
        title: 'Свеча во дворе',
        html: `<p>Во дворовой лапте свеча строже: поймали мяч с лёта — бившие сразу уходят в поле.</p>`,
        demo: demo(DV, [go('Свечой под полевого — поймал с лёта, и команды меняются.', { hit: hit(1, 0.4, -0.3, 'far') }, 'swap', 900, 120)]),
      },
      {
        title: 'Смена и конец партии',
        html: `<p>Команды меняются, когда бегущего осалили, когда во дворовой игре поймали свечу и когда в доме <b>не осталось никого с правом удара</b>.
          Играют до счёта (обычно до 15 или 21) или на время — у кого больше очков.</p>
          <p><b>Дворовые варианты:</b> «Дворовая» — 4 на 4, поле поменьше, свеча — смена; «На мало народу» — 3 на 3, одна попытка,
          бежать из дома может только тот, кто сам ударил (как в ярославской лапте).</p>`,
        demo: demo(CL, [go('Бить может только он — недолёт…', { hit: hit(1, 0.1, 0, 'low') }, 'hit', 400, 100), go('…и снова недолёт. Бить больше некому — смена.', { hit: hit(2, 0.11, 0.1, 'low') }, 'swap', 400, 120)], ['ready', 'kon', 'kon', 'kon', 'used', 'used']),
      },
      {
        title: 'Управление',
        html: `<p><b>Бег:</b> <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> или стрелки; на телефоне — стик слева внизу.
          <b>Рывок:</b> <kbd>Shift</kbd>. <b>Переключиться</b> на другого своего: <kbd>Tab</kbd> или <kbd>Q</kbd> (или коснись его).
          <b>Ловить</b> с лёта: <kbd>Пробел</kbd>. <b>Бросок:</b> коснись бегущего или точки на поле; <kbd>E</kbd> — в ближнего бегущего,
          <kbd>R</kbd> — пас своему ближе к бегущему. <b>Удар:</b> потяни вниз и отпусти (или <kbd>↑</kbd><kbd>↓</kbd> сила,
          <kbd>←</kbd><kbd>→</kbd> направление, <kbd>Пробел</kbd>).</p>`,
      },
    ],
  },
  showcase() {
    const s = newGame({}, [0, 1], 0.5);
    s.score = [8, 6];
    s.phase = 'live';
    const b0 = strike(s.cfg, 0.75, 0.12, 'far');
    s.ball = { mode: 'free', b0, t0: -0.12, holder: -1, air: true, thrown: false, by: -1, px: 0, py: 0, pz: 0 };
    s.shot = true;
    return s;
  },
};
