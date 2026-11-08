/* Дартс — описание игры: 1–4 игрока по очереди, подход из трёх дротиков. Бросок — действие с параметрами (прицел, сила,
 * увод кисти); полёт и попадание считает комната (physics.ts), экран переигрывает тот же полёт. Без DOM. */
import type { DemoScript, GameDef, Options, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { aimFor, label, ORDER, R } from './board';
import { apply, cfgFrom, CRICKET, modeName, newState, setup, targetName, toAct, type Action, type Event, type State } from './engine';
import { V0 } from './physics';

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

const PRESETS: Record<string, Options> = {
  d501: { mode: 'x01', start: 501, din: false, dout: true, legs: 1 },
  d301: { mode: 'x01', start: 301, din: true, dout: true, legs: 1 },
  dvor: { mode: 'x01', start: 301, din: false, dout: false, legs: 1 },
  clock: { mode: 'clock', skip: false, bull: true },
  cricket: { mode: 'cricket', cut: false },
  cut: { mode: 'cricket', cut: true },
  shanghai: { mode: 'shanghai', rounds: 7 },
  killer: { mode: 'killer', lives: 3 },
};

/** Позиция для показа: игра o, правка patch. */
function at(o: Options, patch?: (s: State) => void) {
  return (_d: GameDef, rng: Rng): State => {
    const s = setup(o, [0, 1], rng);
    patch?.(s);
    s.turnStart = s.p[s.cur].score;
    return s;
  };
}

/** Бросок «как надо» точно в поле (n, m) или в точку. */
const T = (n: number, m: number, caption: string, extra: Partial<Action> = {}, seat = 0) => {
  const a = aimFor(n, m);
  return { seat, action: { type: 'throw', x: a.x, y: a.y, v: V0, side: 0, ...extra } as Action, caption };
};
const P = (x: number, y: number, caption: string, extra: Partial<Action> = {}, rig?: number[], seat = 0) => ({
  seat,
  action: { type: 'throw', x, y, v: V0, side: 0, ...extra } as Action,
  caption,
  rig,
});

const demo = (o: Options, steps: ReturnType<typeof T>[], patch?: (s: State) => void): DemoScript<State, Action> => ({ seats: demoSeats, options: o, setup: at(o, patch), steps });

const plural = (n: number, a: string, b: string, c: string) => {
  const x = n % 10;
  const y = n % 100;
  return x === 1 && y !== 11 ? a : x >= 2 && x <= 4 && (y < 12 || y > 14) ? b : c;
};

export const def: GameDef<State, Action, Event, State> = {
  id: 'darts',
  title: 'Дартс',
  players: { min: 1, max: 4, default: 2 },
  countsFor: (o) => (o.mode === 'killer' ? [2, 3, 4] : [1, 2, 3, 4]),
  countsHint: (o) => (o.mode === 'killer' ? 'в «Убийцу» — от двоих' : undefined),
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'x01', label: '501 / 301 — на вычитание' },
        { value: 'clock', label: 'Вокруг света — сектора по порядку' },
        { value: 'cricket', label: 'Крикет — 15…20 и бык' },
        { value: 'shanghai', label: 'Шанхай — раунд за сектором' },
        { value: 'killer', label: 'Убийца — на жизни' },
      ],
      default: 'x01',
    },
    {
      key: 'start',
      label: 'Счёт',
      type: 'select',
      choices: [
        { value: 301, label: '301' },
        { value: 501, label: '501' },
        { value: 701, label: '701' },
      ],
      default: 501,
      showIf: (o) => (o.mode ?? 'x01') === 'x01',
    },
    { key: 'din', label: 'Открывать удвоением (double in)', type: 'toggle', default: false, showIf: (o) => (o.mode ?? 'x01') === 'x01' },
    { key: 'dout', label: 'Закрывать удвоением (double out)', type: 'toggle', default: true, showIf: (o) => (o.mode ?? 'x01') === 'x01' },
    {
      key: 'legs',
      label: 'Легов до победы',
      type: 'select',
      choices: [
        { value: 1, label: 'один лег' },
        { value: 2, label: 'до двух побед' },
        { value: 3, label: 'до трёх побед' },
      ],
      default: 1,
      showIf: (o) => (o.mode ?? 'x01') === 'x01',
    },
    { key: 'skip', label: 'Удвоение — через сектор, утроение — через два', type: 'toggle', default: false, showIf: (o) => o.mode === 'clock' },
    { key: 'bull', label: 'В конце — «яблочко»', type: 'toggle', default: true, showIf: (o) => o.mode === 'clock' },
    { key: 'cut', label: '«Головорез»: очки — соперникам, меньше — лучше', type: 'toggle', default: false, showIf: (o) => o.mode === 'cricket' },
    {
      key: 'rounds',
      label: 'Раундов',
      type: 'select',
      choices: [
        { value: 7, label: '7 (сектора 1–7)' },
        { value: 20, label: '20 (весь круг)' },
      ],
      default: 7,
      showIf: (o) => o.mode === 'shanghai',
    },
    {
      key: 'lives',
      label: 'Жизней',
      type: 'select',
      choices: [
        { value: 3, label: '3' },
        { value: 5, label: '5' },
      ],
      default: 3,
      showIf: (o) => o.mode === 'killer',
    },
  ],
  presets: [
    { id: 'd501', label: '501, закрытие удвоением', hint: 'Как в телевизоре: с 501 до нуля, последний дротик — в удвоение', options: PRESETS.d501 },
    { id: 'd301', label: '301, double in / double out', hint: 'Счёт открывают и закрывают удвоением', options: PRESETS.d301 },
    { id: 'dvor', label: 'Дворовый 301', hint: 'Без удвоений: просто дойти ровно до нуля', options: PRESETS.dvor },
    { id: 'clock', label: 'Вокруг света', hint: 'Сектора от 1 до 20 по порядку и «яблочко»', options: PRESETS.clock },
    { id: 'cricket', label: 'Крикет', hint: 'Закрыть 15…20 и быка, по открытым — набирать очки', options: PRESETS.cricket },
    { id: 'cut', label: 'Крикет «головорез»', hint: 'Очки уходят соперникам, побеждает меньший счёт', options: PRESETS.cut },
    { id: 'shanghai', label: 'Шанхай', hint: 'Раунд за сектором; одиночное + удвоение + утроение — сразу победа', options: PRESETS.shanghai },
    { id: 'killer', label: 'Убийца', hint: 'Своё число, стань убийцей — снимай жизни соперникам', options: PRESETS.killer },
  ],
  summary: (o, base) => `${modeName(cfgFrom(o))} · ${base}`,
  setup: (seats, opts, rng) =>
    setup(
      opts,
      seats.map((s) => s.seat).sort((a, b) => a - b),
      rng
    ),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    const scores: Record<number, number> = {};
    const c = s.cfg;
    s.seats.forEach((seat, k) => {
      const p = s.p[k];
      scores[seat] = c.mode === 'x01' ? p.legs : c.mode === 'clock' ? p.target : c.mode === 'killer' ? p.lives : p.score;
    });
    const w = s.winners;
    const wi = s.seats.indexOf(w[0]);
    const p = s.p[wi];
    let text = 'Партия окончена';
    if (p) {
      if (c.mode === 'x01') text = c.legs > 1 ? `${p.legs} ${plural(p.legs, 'лег', 'лега', 'легов')} — победа` : p.score === 0 ? `закрыл ${c.start} за ${p.legDarts} ${plural(p.legDarts, 'дротик', 'дротика', 'дротиков')}` : `меньший остаток: ${p.score}`;
      else if (c.mode === 'clock') text = p.target > 25 ? `круг за ${p.darts} ${plural(p.darts, 'дротик', 'дротика', 'дротиков')}` : `дальше всех по кругу: до ${targetName(p.target)}`;
      else if (c.mode === 'cricket') text = `всё закрыто, очков: ${p.score}`;
      else if (c.mode === 'shanghai') text = s.round <= c.rounds ? `«Шанхай» в секторе ${s.round}!` : `больше всех очков: ${p.score}`;
      else text = w.length > 1 ? 'поровну жизней' : `последний выживший — жизней: ${p.lives}`;
    }
    return { winners: w, text: w.length > 1 && c.mode !== 'killer' ? `${text} — поровну` : text, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe(ev, name) {
    if (ev.k === 'throw') return `🎯 ${name(ev.seat)}: ${ev.note}${ev.pts && !ev.note.includes('+') ? ` (${ev.pts})` : ''}.`;
    if (ev.k === 'bust') return `💥 ${name(ev.seat)}: перебор — ${ev.why}; счёт снова ${ev.back}.`;
    if (ev.k === 'open') return `🔓 ${name(ev.seat)} открыл счёт удвоением.`;
    if (ev.k === 'close') return `✅ ${name(ev.seat)} закрыл ${ev.n === 25 ? 'быка' : ev.n}.`;
    if (ev.k === 'killer') return `🔪 ${name(ev.seat)} — теперь убийца!`;
    if (ev.k === 'life') return `🩸 ${name(ev.seat)} снял жизнь у ${name(ev.victim)}: осталось ${ev.lives}.`;
    if (ev.k === 'dead') return `☠️ ${name(ev.seat)} выбыл.`;
    if (ev.k === 'shanghai') return `🐉 ${name(ev.seat)} — «Шанхай» в секторе ${ev.n}!`;
    if (ev.k === 'leg') return `🏁 ${name(ev.seat)} выиграл лег (${ev.darts} ${plural(ev.darts, 'дротик', 'дротика', 'дротиков')}).`;
    if (ev.k === 'turn') return null;
    if (ev.k === 'end') return '🏆 Партия окончена.';
    return null;
  },
  rules: {
    goal: 'Дротиками попадать в нужные поля мишени: на «501» — первым свести счёт ровно к нулю, в крикете — закрыть числа и набрать очки, в «Вокруг света» — первым пройти все сектора.',
    sections: [
      {
        title: 'Мишень',
        html: `<p>Мишень — круг диаметром 45 см из прессованного сизаля, разделённый проволокой на <b>20 секторов</b>. Сверху — «20», дальше по часовой
          стрелке: ${ORDER.join(' · ')}. Узкое внешнее кольцо — <b>удвоение</b>, узкое среднее — <b>утроение</b>, в центре — <b>бык</b>:
          зелёное кольцо «25» и красное «яблочко» — 50 очков. Самый дорогой бросок — утроение двадцатки, 60 очков; за подход из трёх дротиков — не больше 180.</p>
          <p>Мишень висит в шкафчике со створками: центр — на высоте 1,73 м, бросают из-за черты в 2,37 м.</p>`,
        demo: demo(PRESETS.d501, [T(20, 3, 'Утроение двадцатки — 60 очков.'), T(16, 2, 'Удвоение шестнадцати — 32.'), T(25, 2, '«Яблочко» — 50. За подход — 142.')]),
      },
      {
        title: 'Как бросать',
        html: `<p>Нажмите на мишень и ведите палец или мышь — по мишени поплывёт <b>прицел</b>. Рука чуть дрожит, и чем дольше держите — тем сильнее.
          Наведя, <b>смахните вверх</b> и отпустите — дротик полетит. Скорость взмаха — сила броска: «как надо» — и дротик придёт ровно в прицел;
          слабее — провалится ниже, сильнее — уйдёт выше. Увели взмах вбок — уйдёт вбок.</p>
          <p>Можно и <b>«рогаткой»</b>: прицелившись, потяните вниз и отпустите — чем дальше потянули, тем сильнее бросок. С клавиатуры: стрелки — прицел, пробел — держать и отпустить
          на шкале силы.</p>
          <p>Дротик летит по дуге: тяжесть тянет его вниз, поэтому бросают чуть выше цели — игра сама учитывает это для броска «как надо».</p>`,
        demo: demo(PRESETS.d501, [T(20, 3, 'Бросок «как надо» — точно в прицел, утроение 20.'), T(20, 3, 'Та же рука, но слабее — дротик проваливается ниже, в 20 одиночную.', { v: V0 - 0.3 }), T(20, 3, 'Сильнее — уходит выше, в удвоение.', { v: V0 + 0.45 })]),
      },
      {
        title: 'Отскок и промах',
        html: `<p>Дротик, попавший в <b>проволоку</b>, может отскочить и упасть — бросок пропал, очков нет; а может соскользнуть в соседнее поле.
          В <b>торчащий дротик</b> тоже можно попасть: отскочит или воткнётся рядом. Мимо мишени — в дерево шкафчика, на пол. Очень слабый бросок не долетает
          или приходит так круто, что не втыкается.</p>
          <p>Засчитывается только дротик, оставшийся в мишени. Дротики торчат до конца подхода — по ним видно, куда легла рука.</p>`,
        demo: demo(PRESETS.d501, [P(0, R.doubleOut, 'Прямо в проволоку над удвоением 20 — отскок, дротик падает.', {}, [0]), T(20, 3, 'Второй — в утроение…'), P(aimFor(20, 3).x, aimFor(20, 3).y, '…и третий прямо в торчащий: отскок от дротика.', {}, [0])]),
      },
      {
        title: '501: на вычитание, закрытие удвоением',
        html: `<p>У каждого 501 очко; выбитое за подход отнимается. Закончить надо <b>ровно в ноль</b>, и последним дротиком — в <b>удвоение</b> или «яблочко» (double out).
          Осталось 40 — нужно удвоение 20; осталось 32 — удвоение 16.</p>
          <p><b>Перебор:</b> выбили больше, чем осталось, оставили 1 (её удвоением не закрыть) или пришли в ноль не удвоением — весь подход не в счёт,
          счёт возвращается к тому, что был до подхода. Обычно закрывают по таблице: 170 — T20 T20 Бык, 100 — T20 D20, 61 — 25 D18.</p>`,
        demo: demo(PRESETS.d501, [T(20, 1, 'Осталось 60: одиночная 20 — остаётся 40…'), T(20, 2, '…и удвоение 20 — лег закрыт!')], (s) => (s.p[0].score = 60)),
      },
      {
        title: 'Перебор',
        html: `<p>Осталось 32, а дротик ушёл в утроение 20 — это больше остатка. Перебор: подход окончен, счёт снова 32. Поэтому на закрытии бьют спокойно —
          одиночными и в нужное удвоение.</p>`,
        demo: demo(PRESETS.d501, [T(8, 1, 'Осталось 40: одиночная 8 — 32…'), T(20, 3, '…а теперь T20 — больше, чем осталось: перебор, снова 40.')], (s) => (s.p[0].score = 40)),
      },
      {
        title: '301: открытие удвоением',
        html: `<p>В «301» с <b>double in</b> счёт начинают только с удвоения: пока игрок не попал в удвоение, его дротики не считаются.
          Попал — это удвоение уже идёт в счёт, дальше всё как в «501». В дворовом «301» удвоений не нужно ни в начале, ни в конце — просто дойти до нуля.</p>`,
        demo: demo(PRESETS.d301, [T(20, 3, 'Утроение 20 не в счёт — счёт ещё не открыт.'), T(20, 2, 'Удвоение 20 — открылся: 301 − 40 = 261.'), T(20, 3, 'Теперь T20 считается: 201.')]),
      },
      {
        title: 'Вокруг света',
        html: `<p>Нужно попасть в сектора <b>по порядку: 1, 2, 3 … 20</b>, а в конце — в «яблочко» (или любой бык). Засчитывается любое поле нужного сектора.
          Попал — следующим дротиком бьёшь уже в следующий. С «прыжками» удвоение переводит на два сектора вперёд, утроение — на три.
          Кто первым прошёл круг — победил.</p>`,
        demo: demo(PRESETS.clock, [T(1, 1, 'Первым нужен сектор 1.'), T(2, 1, 'Теперь 2…'), T(3, 3, '…утроение 3 тоже годится — дальше 4.')]),
      },
      {
        title: 'Крикет',
        html: `<p>В игре только <b>${CRICKET.slice(0, 6).join(', ')} и бык</b>. Попадание ставит метки: одиночное — одну, удвоение — две, утроение — три;
          «25» — одна метка быка, «яблочко» — две. <b>Три метки — число закрыто.</b> Дальше по закрытому числу идут очки, пока его не закроют все соперники.</p>
          <p>Побеждает тот, кто закрыл всё и у кого очков не меньше, чем у любого соперника. В «головорезе» очки, наоборот, достаются соперникам,
          у которых число ещё открыто, и выигрывает закрывший всё с наименьшим счётом.</p>`,
        demo: demo(PRESETS.cricket, [T(20, 3, 'Утроение 20 — сразу три метки: двадцатка закрыта.'), T(20, 3, 'Ещё T20: у Вовы 20 открыта — Пете 60 очков.'), T(19, 2, 'Удвоение 19 — две метки на 19.')]),
      },
      {
        title: 'Шанхай',
        html: `<p>Раунд 1 — бьют только в сектор 1, раунд 2 — в 2, и так до 7 (или до 20). Очки — число сектора на множитель: в раунде 5 утроение даёт 15.
          Попасть за один подход в <b>одиночное, удвоение и утроение</b> сектора раунда — это «Шанхай»: мгновенная победа. Иначе после последнего раунда
          побеждает больший счёт.</p>`,
        demo: demo(PRESETS.shanghai, [T(3, 1, 'Раунд 3: одиночная 3…'), T(3, 2, '…удвоение 3…'), T(3, 3, '…и утроение 3 — «Шанхай»! Партия окончена.')], (s) => (s.round = 3)),
      },
      {
        title: 'Убийца',
        html: `<p>Каждому по жребию достаётся <b>своё число</b> и три жизни. Сначала надо попасть в удвоение своего числа — стать <b>убийцей</b>.
          Убийца удвоением чужого числа снимает у того жизнь; попал в своё — теряет свою. Остался один — победил.</p>`,
        demo: demo(
          PRESETS.killer,
          [T(16, 2, 'У Пети число 16: удвоение 16 — Петя стал убийцей.'), T(5, 2, 'Удвоение 5 — числа Вовы: у Вовы минус жизнь.')],
          (s) => {
            s.p[0].num = 16;
            s.p[1].num = 5;
          }
        ),
      },
      {
        title: 'Подход и партия',
        html: `<p>Бросают по очереди, в подходе <b>три дротика</b>; потом их вынимают и бросает следующий. На «501» партия — один лег или до двух-трёх побед,
          лег начинает следующий по кругу. Чтобы партия не тянулась вечно, есть предел раундов (на «501» — 20): кончились — побеждает меньший остаток
          (в крикете и шанхае — больше очков).</p>`,
      },
    ],
  },
  showcase() {
    const s = newState(cfgFrom(PRESETS.d501), [0, 1]);
    s.p[0].score = 141;
    s.p[1].score = 180;
    s.turnStart = 201;
    s.dart = 2;
    s.round = 6;
    const a = aimFor(20, 3);
    s.stuck = [
      { x: a.x - 0.008, y: a.y + 0.001, inc: 0.2, lat: 0.03, seat: 0 },
      { x: a.x + 0.007, y: a.y - 0.002, inc: 0.22, lat: -0.02, seat: 0 },
    ];
    s.hits = [
      { n: 20, m: 3 },
      { n: 20, m: 3 },
    ];
    s.shot = true;
    return s;
  },
};

export { label };
