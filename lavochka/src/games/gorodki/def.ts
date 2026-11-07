/* Городки — описание игры: 1–4 игрока, каждый выбивает свои фигуры, бросок — действие с параметрами (где стоит, куда, сила,
 * вращение); физику броска считает комната, экран её переигрывает. Без DOM. */
import type { DemoScript, GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, FIG_SETS, figName, layout, newState, setup, toAct, type Action, type Event, type State } from './engine';
import { figure, FIGURES, type Figure } from './figures';
import { RH, RR } from './physics';

export const SEATS = [
  { name: 'Красный', color: '#d8402e', light: '#ff8a6a', dark: '#6e1a10' },
  { name: 'Синий', color: '#2f6ad0', light: '#7aa8ff', dark: '#10306e' },
  { name: 'Зелёный', color: '#2f9a48', light: '#7ad88a', dark: '#104a1e' },
  { name: 'Жёлтый', color: '#e0a020', light: '#ffd86a', dark: '#6a4a08', ink: '#a87410' },
];

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'human', name: 'Петя', level: 0 },
  { seat: 1, kind: 'bot', name: 'Вова', level: 1 },
];

/** Позиция для показа: фигура fig у первого игрока. */
function at(fig: string, patch?: (s: State) => void) {
  return (_d: GameDef, _r: Rng): State => {
    const s = newState(cfgFrom({}), [0, 1]);
    const k = s.cfg.figs.indexOf(fig);
    s.p[0].fig = k;
    s.p[0].rods = layout(fig);
    s.p[1].fig = k;
    s.p[1].rods = layout(fig);
    patch?.(s);
    return s;
  };
}

const T = (x: number, ang: number, pow: number, spin: number, caption: string, seat = 0) => ({
  seat,
  action: { type: 'throw', x, ang, pow, spin } as Action,
  caption,
});

/** Схема фигуры сверху (SVG): лицевая линия внизу, бросающий — снизу. */
export function figSvg(f: Figure, size = 120): string {
  const pts = f.pieces.flatMap((p) => [p.x - RH, p.x + RH]);
  const ys = f.pieces.flatMap((p) => [p.y - RH, p.y + RH]);
  const wide = f.id === 'pismo';
  const x0 = wide ? -1.08 : Math.min(-0.36, ...pts) - 0.05;
  const x1 = wide ? 1.08 : Math.max(0.36, ...pts) + 0.05;
  const y0 = wide ? -0.08 : -0.08;
  const y1 = wide ? 2.08 : Math.max(0.55, ...ys) + 0.05;
  const span = Math.max(x1 - x0, y1 - y0);
  const k = size / span;
  const X = (x: number) => ((x - (x0 + x1) / 2) * k + size / 2).toFixed(1);
  const Y = (y: number) => (size - ((y - y0) * k + (size - (y1 - y0) * k) / 2)).toFixed(1);
  const parts: string[] = [];
  // город: лицевая линия, у «Письма» — весь квадрат и марка
  if (wide) {
    parts.push(`<rect x="${X(-1)}" y="${Y(2)}" width="${(2 * k).toFixed(1)}" height="${(2 * k).toFixed(1)}" fill="none" stroke="#fff" stroke-width="1.5"/>`);
    parts.push(`<line x1="${X(-0.1)}" y1="${Y(0.9)}" x2="${X(0.1)}" y2="${Y(1.1)}" stroke="#fff" stroke-width="1"/><line x1="${X(-0.1)}" y1="${Y(1.1)}" x2="${X(0.1)}" y2="${Y(0.9)}" stroke="#fff" stroke-width="1"/>`);
  } else parts.push(`<line x1="0" y1="${Y(0)}" x2="${size}" y2="${Y(0)}" stroke="#fff" stroke-width="2"/>`);
  for (const p of f.pieces) {
    if (p.stand) {
      parts.push(`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${(RR * k + 0.6).toFixed(1)}" fill="#f4d9a0" stroke="#7a4a1a" stroke-width="1.2"/>`);
      parts.push(`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${(RR * k * 0.45).toFixed(1)}" fill="#c8954a"/>`);
    } else {
      const w = (2 * RH * k).toFixed(1);
      const hgt = (2 * RR * k).toFixed(1);
      const deg = ((-p.a * 180) / Math.PI).toFixed(1);
      parts.push(
        `<rect x="${(-RH * k).toFixed(1)}" y="${(-RR * k).toFixed(1)}" width="${w}" height="${hgt}" rx="${(RR * k * 0.4).toFixed(1)}" fill="${p.mark ? '#e8c060' : '#e6c088'}" stroke="#7a4a1a" stroke-width="1" transform="translate(${X(p.x)} ${Y(p.y)}) rotate(${deg})"/>`
      );
    }
  }
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="background:#9a7a52;border-radius:8px">${parts.join('')}</svg>`;
}

const figGrid = () =>
  `<div class="gk-figs">${FIGURES.map((f, i) => `<figure>${figSvg(f)}<figcaption><b>${i + 1}. ${f.name}</b><br><small>${f.hint}</small></figcaption></figure>`).join('')}</div>`;

const P = { kon: 13, polukon: 6.5 };

export const def: GameDef<State, Action, Event, State> = {
  id: 'gorodki',
  title: 'Городки',
  players: { min: 1, max: 4, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'figs',
      label: 'Фигуры',
      type: 'select',
      choices: [
        { value: 'all', label: 'все 15 фигур' },
        { value: 'ten', label: '10 фигур (соревнования)' },
        { value: 'five', label: '5 фигур (быстро)' },
      ],
      default: 'all',
    },
    {
      key: 'kon',
      label: 'Кон',
      hint: 'Откуда бросают первую биту по фигуре; полукон — вдвое ближе',
      type: 'select',
      choices: [
        { value: 13, label: '13 м — как у взрослых' },
        { value: 10, label: '10 м — дворовый' },
        { value: 8, label: '8 м — детский' },
      ],
      default: 13,
    },
  ],
  presets: [
    { id: 'classic', label: 'Классика: 15 фигур', hint: 'Все фигуры от «Пушки» до «Письма», кон 13 м', options: { figs: 'all', kon: 13 } },
    { id: 'ten', label: 'Партия из 10 фигур', hint: 'Как на соревнованиях: Пушка, Вилка, Колодец … Тир, Письмо', options: { figs: 'ten', kon: 13 } },
    { id: 'short', label: 'Короткая: 5 фигур', hint: 'Пушка, Звезда, Колодец, Самолёт, Письмо', options: { figs: 'five', kon: 13 } },
    { id: 'dvor', label: 'Дворовая', hint: 'Все 15 фигур, кон 10 м, полукон 5 м', options: { figs: 'all', kon: 10 } },
  ],
  setup: (seats, opts) => setup(opts, seats.map((s) => s.seat).sort((a, b) => a - b)),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    const scores: Record<number, number> = {};
    s.seats.forEach((seat, k) => (scores[seat] = s.p[k].throws));
    const w = s.winners;
    const p = s.p[s.seats.indexOf(w[0])];
    const n = s.cfg.figs.length;
    const text = !p
      ? 'Партия окончена'
      : p.done
        ? `${n} ${n === 5 ? 'фигур' : 'фигур'} за ${p.throws} ${bits(p.throws)}${w.length > 1 ? ' — поровну' : ''}`
        : `больше всех выбил: ${p.fig} из ${n} фигур`;
    return { winners: w, text, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe(ev, name) {
    if (ev.k === 'throw') {
      if (ev.lost) return `🚫 ${name(ev.seat)}: бита упала перед штрафной линией — бросок потерян, городки на место.`;
      const n = ev.out.length;
      const tail = ev.markBack ? ' Марка задела соседей — вернули на место.' : '';
      const mv = ev.moved.length ? ` Из пригорода — на отметку: ${ev.moved.length}.` : '';
      return `🪵 ${name(ev.seat)} — «${figName(ev.fig)}», ${ev.line <= -10 ? 'с кона' : ev.line <= -6 ? 'с полукона' : 'с полукона'}: ${n ? `выбито <b>${n}</b>` : 'мимо'}.${tail}${mv}`;
    }
    if (ev.k === 'figure') return `✅ ${name(ev.seat)} выбил «${figName(ev.fig)}»${ev.next ? `, дальше — «${figName(ev.next)}»` : ''} (бит: ${ev.throws}).`;
    if (ev.k === 'finish') return `🏆 ${name(ev.seat)} выбил все фигуры за <b>${ev.throws}</b> ${bits(ev.throws)}!`;
    if (ev.k === 'end') return '🏁 Партия окончена.';
    return null;
  },
  rules: {
    goal: 'Битой выбить из своего «города» все фигуры по порядку — от «Пушки» до «Письма» — за меньшее число бросков, чем соперники.',
    sections: [
      {
        title: 'Площадка',
        html: `<p><b>Город</b> — квадрат 2 × 2 м, расчерченный на земле. Его передняя сторона — <b>лицевая линия</b>. Перед городом — <b>пригород</b>:
          полоса глубиной 1 м, боковины которой продолжают диагонали города, так что к бросающему она расширяется до 4 м. Пригород кончается
          <b>штрафной линией</b>. Бросают с <b>кона</b> — линии в ${P.kon} м от лицевой, или с <b>полукона</b> — в ${P.polukon} м
          (во дворе часто кон 10 м и полукон 5 м, у детей — 8 и 4).</p>
          <p><b>Бита</b> — палка до метра длиной, <b>городки</b> (рюхи, чушки) — берёзовые чурки 20 см длиной и 5 см толщиной.</p>`,
        demo: {
          seats: demoSeats,
          setup: at('pushka'),
          steps: [T(0, 0, 0.7676, 0.6, 'С кона, с 13 метров: бита летит плашмя, вращаясь, и сносит «Пушку».')],
        } as DemoScript<State, Action>,
      },
      {
        title: 'Все 15 фигур',
        html: `<p>Фигуры строят от середины лицевой линии, вглубь города; «Письмо» — по углам города. Выбивают строго по порядку: пока
          не выбита вся фигура, следующую не ставят.</p>${figGrid()}
          <p>На соревнованиях играют и партию из 10 фигур: Пушка, Вилка, Колодец, Стрела, Артиллерия, Серп, Пулемётное гнездо, Самолёт,
          Тир, Письмо. Во дворе фигуры звали по-своему: «Пулемётное гнездо» — «баба в окошке», вместо «Вилки» ставили «Стрелку», вместо «Часовых» — «Слона».</p>`,
      },
      {
        title: 'Кон и полукон',
        html: `<p>Каждую фигуру начинают с <b>кона</b>. Как только из неё выбит хоть один городок, остальные добивают с <b>полукона</b> — вдвое ближе.
          Новая фигура — снова с кона. «Письмо» выбивают только с кона.</p>`,
        demo: {
          seats: demoSeats,
          setup: at('kolodec'),
          steps: [T(0.4, -0.0308, 0.8237, 0.6, 'Первая бита — с кона: из «Колодца» вылетело несколько городков…'), T(0, 0, 0.2272, 0.6, '…и вторая бита — уже с полукона.')],
        } as DemoScript<State, Action>,
      },
      {
        title: 'Когда городок выбит',
        html: `<p>Городок <b>выбит</b>, если целиком вылетел из города и пригорода — за боковые, заднюю или штрафную линию. Лёг на линию хоть краем — ещё в игре.
          Городок, который вылетел и прикатился обратно, всё равно выбит.</p>
          <p>Остался в <b>пригороде</b> — его добивают оттуда. Но если он лёг ближе 20 см к штрафной линии (так выбить слишком легко), его ставят
          поперёк на отметку в 20 см от штрафной линии, а если из фигуры ещё ничего не выбито — на отметку 40 см.</p>`,
        demo: {
          seats: demoSeats,
          setup: at('artilleriya'),
          steps: [T(0, 0, 0.7676, -0.6, 'Удар по «Артиллерии»: что вылетело за линии — выбито, что осталось — добивают.')],
        } as DemoScript<State, Action>,
      },
      {
        title: 'Штрафы: потерянный бросок',
        html: `<p>Бита должна долететь: если она <b>коснулась штрафной линии или земли перед ней</b>, бросок потерян — все сбитые городки ставят
          на прежние места, а бита всё равно засчитана. Бить «с налёта» прямо в фигуру можно, и приземлиться в пригороде, чтобы бита
          проехала по городкам, — тоже.</p>
          <p>Заступать за линию кона или полукона нельзя — в игре за этим следит сама черта: бросающий стоит за ней.</p>`,
        demo: {
          seats: demoSeats,
          setup: at('zvezda'),
          steps: [T(0, 0, 0.688, 0.6, 'Недолёт: бита ударилась о землю перед штрафной линией. Что бы она ни сбила — всё вернут на место.')],
        } as DemoScript<State, Action>,
      },
      {
        title: '«Письмо» и марка',
        html: `<p>Последняя фигура — <b>«Письмо»</b>: четыре городка наискось по углам города и пятый, <b>марка</b>, — в самой середине.
          Бьют его только с кона. Марка считается выбитой, только если ни она, ни бита в этом броске <b>не задели другие городки</b> —
          иначе её возвращают в центр. Поэтому марку обычно выбивают отдельным точным броском.</p>`,
        demo: {
          seats: demoSeats,
          setup: at('pismo'),
          steps: [T(0, 0, 0.7817, 0.6, 'Бросок прямо в центр — по марке.')],
        } as DemoScript<State, Action>,
      },
      {
        title: 'Подход и партия',
        html: `<p>Ходят по очереди, у каждого в подходе <b>две биты</b> — «кон из двух рук»: бросил обе — очередь следующего. Выбил фигуру первой битой —
          вторую бросаешь уже по следующей фигуре. Каждый бьёт по своему городу и считает свои биты.</p>
          <p>Побеждает тот, кто выбьет все фигуры <b>меньшим числом бит</b>; поровну — у кого больше выбитых городков. Если соперник уже закончил,
          а у тебя столько же бит, а фигуры ещё стоят, — догнать его нельзя, партия для тебя окончена.</p>`,
        demo: {
          seats: demoSeats,
          setup: at('samolet'),
          steps: [T(0, 0, 0.7676, 0, 'Первая бита Пети…'), T(0.4, -0.0615, 0.2284, 0.6, '…вторая бита — и очередь переходит к Вове.')],
        } as DemoScript<State, Action>,
      },
      {
        title: 'Как бросать',
        html: `<p>Нажмите на поле и <b>потяните назад</b>, как рогатку: чем дальше тянете — тем сильнее бросок, вбок — тем круче поворот.
          Отпустите — бита полетит. Пунктир показывает, куда она упадёт (прицел чуть «дышит» — отпускайте вовремя).</p>
          <p>Кнопками внизу можно отойти вдоль черты влево-вправо и выбрать бросок: <b>плашмя с вращением</b> (бита идёт широким фронтом,
          как пропеллер) или <b>торцом</b> («копьём» — точно в одну точку). Хороший бросок падает в пригород у самой лицевой линии
          или прямо в фигуру.</p>`,
      },
    ],
  },
  showcase() {
    const s = newState(cfgFrom({}), [0, 1]);
    s.p[0].fig = 8;
    s.p[0].rods = layout(FIG_SETS.all[8]);
    s.p[0].throws = 11;
    s.p[0].knocked = 40;
    s.p[1].fig = 7;
    s.p[1].throws = 12;
    s.shot = true;
    return s;
  },
};

function bits(n: number) {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return 'биту';
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'биты';
  return 'бит';
}

export { figure };
