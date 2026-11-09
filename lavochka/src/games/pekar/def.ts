/* Пекарь — описание игры: от двух до шести игроков, каждый сам за себя; пекарь — по очереди. Игра реального времени:
 * комната крутит шаги, каждый ведёт своего пацана (бег, рывок), бросает палку «рогаткой», пекарь несёт банку и салит
 * (engine.ts). Без DOM. */
import { gameSpeed, SPEED_OPTION } from '../../core/realtime';
import type { GameDef } from '../../core/types';
import { botInput } from './ai';
import { cleanInput, idleInput, newGame, rankName, snapshot, step, TICK_MS, type Event, type In, type State } from './engine';

export const SEATS = [
  { name: 'Красный', color: '#d8402e', light: '#ff8a6a', dark: '#6e1a10' },
  { name: 'Синий', color: '#2f6ad0', light: '#7aa8ff', dark: '#10306e' },
  { name: 'Зелёный', color: '#2f9a48', light: '#7ad88a', dark: '#104a1e' },
  { name: 'Жёлтый', color: '#e0a020', light: '#ffd86a', dark: '#6a4a08', ink: '#a87410' },
  { name: 'Фиолетовый', color: '#8a4ac8', light: '#c8a0f0', dark: '#3a1a60' },
  { name: 'Белый', color: '#e8e4da', light: '#ffffff', dark: '#6a665e', ink: '#6a665e' },
];

export const def: GameDef<State, never, Event, State> = {
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
    SPEED_OPTION,
  ],
  presets: [
    { id: 'classic', label: 'Классика со званиями', hint: 'рядовой → маршал, 14 м до банки; сбил маршалом — победа', options: { ranks: 'full', dist: 14, demote: false, target: 5 } },
    { id: 'dvor', label: 'Дворовый короткий', hint: '5 званий, 11 м, осаленный теряет звание', options: { ranks: 'short', dist: 11, demote: true, target: 5 } },
    { id: 'schet', label: 'Без званий', hint: 'одна черта в 11 м, до пяти сбитых банок', options: { ranks: 'none', dist: 11, demote: false, target: 5 } },
  ],
  setup: (seats, opts) => newGame(opts, seats.map((s) => s.seat).sort((a, b) => a - b), gameSpeed(opts)),
  toAct: (s) => (s.over ? [] : s.seats.slice()),
  apply: () => null,
  view: (s) => snapshot(s),
  result(s) {
    if (!s.over) return null;
    const scores: Record<number, number> = {};
    s.seats.forEach((seat, i) => (scores[seat] = s.cfg.ranks.length > 1 ? s.men[i].rank : s.men[i].knocks));
    const m = s.men[s.seats.indexOf(s.winners[0])];
    return {
      winners: s.winners,
      text: s.cfg.ranks.length > 1 ? (m && m.rank >= s.cfg.ranks.length ? 'сбил банку маршалом' : `выше всех званием — ${m ? rankName(s.cfg, m) : ''}`) : `сбил ${m?.knocks ?? 0} банок`,
      scores,
    };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: () => null },
  realtime: {
    tickMs: TICK_MS,
    sendEvery: 2,
    idle: idleInput,
    input: cleanInput,
    tick: (s, inputs, rng) => step(s, inputs as In[], rng),
    bot: (view, seat, level, mem, rng) => botInput(view, seat, level, mem, rng),
  },
  describe(ev, name) {
    // в событиях — номера игроков; места идут подряд с 0 (setup сортирует), номер = место
    const nm = (i: number) => `<b>${name(i)}</b>`;
    switch (ev.k) {
      case 'kick':
        return ev.slip ? `🦶 ${nm(ev.who)}: палка сорвалась с ноги — ${ev.d.toFixed(1)} м.` : `🦶 ${nm(ev.who)} пнул палку на ${ev.d.toFixed(1)} м.`;
      case 'draw':
        return `🥫 Пекарь — ${nm(ev.pekar)}: ближе всех.`;
      case 'knock':
        return `💥 ${nm(ev.who)} сбил банку!`;
      case 'tag':
        return `✋ Пекарь осалил ${nm(ev.who)}!`;
      case 'pekar':
        return `🥫 Теперь пекарь — ${nm(ev.who)}.`;
      case 'skip':
        return `⏳ ${nm(ev.who)} не бросил — ход дальше.`;
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
      },
      {
        title: 'Банка и броски',
        html: `<p>В меловом кружке стоит <b>консервная банка</b>, рядом сторожит пекарь. Игроки по очереди кидают в неё палки из-за <b>своей черты</b>.
          Палка остаётся лежать там, где упала: пока её не подобрал, бросать нечем. Кидают <b>низом</b> — палка крутится плашмя и сметает широко, —
          или <b>навесом</b>, кувырком.</p>`,
      },
      {
        title: 'Звания',
        html: `<p>Сбил банку — получаешь <b>звание</b>: рядовой, ефрейтор, сержант, лейтенант, капитан, майор, полковник, генерал, маршал.
          Чем выше звание, тем <b>ближе к банке</b> твоя черта. Кто сбил банку маршалом — выиграл.</p>`,
      },
      {
        title: 'За палкой — и назад за черту',
        html: `<p>За своей палкой бегаешь сам, когда хочешь. Подобрал — беги обратно <b>за свою черту</b>: там тебя не осалить.
          Удобнее всего бежать, пока банка лежит: пекарь сначала должен сбегать за ней, подобрать и <b>поставить в кружок</b>, а до тех пор салить нельзя.
          Палка, упавшая у самой банки, — самая опасная.</p>`,
      },
      {
        title: 'Пекарь салит',
        html: `<p>Когда банка стоит, пекарь гоняется за теми, кто в поле, и <b>салит палкой</b>: догнал и коснулся — или замахнулся рядом.
          Осаленный становится пекарем, а бывший пекарь берёт палку и встаёт за свою черту. Уворачивайтесь рывком.</p>
          <p>Если бросить уже некому — все палки в поле, — идти за ними придётся всё равно: пекарь осалит кого-то одного, остальные успеют.</p>`,
      },
      {
        title: 'Варианты',
        html: `<p><b>Дворовый короткий</b>: званий пять — рядовой, сержант, лейтенант, капитан, генерал, до банки 11 м, а кого осалили, тот не только печёт,
          но и теряет одно звание. <b>Без званий</b>: все бросают с одной черты, побеждает тот, кто первым собьёт пять банок.
          «Скорость игры» замедляет всё движение — успеваешь и прицелиться, и увернуться.</p>`,
      },
      {
        title: 'Управление',
        html: `<p><b>Бег:</b> WASD или стрелки (на телефоне — стик слева внизу), <b>рывок</b> — Shift (кнопка «Рывок»). Палку подбираете, просто добежав до неё.</p>
          <p><b>Бросок</b> (когда ваш ход и вы за чертой): нажмите на поле и потяните вниз, как рогатку, — дальше тянете, сильнее; вбок — в сторону.
          Пунктир — полёт, кольцо — где ляжет палка. Рука чуть дрожит. Внизу — <b>низом</b> или <b>навесом</b>. На жеребьёвке так же — пинок.</p>
          <p><b>Пекарем:</b> добегите до банки — подберёте, донесите до кружка — поставите. Потом догоняйте и <b>«Салить!»</b> (пробел) рядом с бегущим.</p>`,
      },
    ],
  },
  showcase() {
    const s = newGame({}, [0, 1, 2, 3]);
    s.phase = 'play';
    s.kicks = [12, 10, 9, 7];
    s.order = [0, 1, 2, 3];
    s.pekar = 3;
    s.sticks[3].at = 'pekar';
    s.men[3].x = 1.3;
    s.men[3].y = s.cfg.dist + 1.1;
    s.men[0].rank = 3;
    s.men[0].x = 0.2;
    s.men[0].y = 3 * s.cfg.step - 0.3;
    s.sticks[1] = { at: 'ground', x: 1.2, y: 9.5, a: 0.6 };
    s.men[1].x = 0.9;
    s.men[1].y = 7.5;
    s.shot = true;
    return s;
  },
};
