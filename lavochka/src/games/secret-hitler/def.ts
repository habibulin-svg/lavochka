/* Тайный Гитлер — описание игры для сборника: роли, выборы, законы, полномочия, вето; боты; правила с показом. Без DOM.
 * Secret Hitler — Goat, Wolf & Cabbage (Max Temkin, Mike Boxleiter, Tommy Maranges), иллюстрации Mackenzie Schubert; CC BY-NC-SA 4.0. */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cardsText, makeView, POWER_NAME, ROLE_LOW, setup, toAct, type Action, type Event, type Party, type Role, type State, type View } from './engine';

export const SEATS = [
  ['Вовка', '#b3322a'], ['Ленка', '#2b5c9e'], ['Серёга', '#2f7a3e'], ['Танька', '#c48a12'], ['Димон', '#6a3d8f'],
  ['Светка', '#c2185b'], ['Жека', '#0f7a7a'], ['Михалыч', '#8a5a2a'], ['Олька', '#7a3aa0'], ['Колян', '#5a5a5a'],
].map(([name, color]) => ({ name, color, light: color, dark: color }));

const P = (p: Party) => (p === 'L' ? '<b class="sh-l">либеральный</b>' : '<b class="sh-f">фашистский</b>');

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'round':
      return `<b>Раунд ${ev.round}</b>. Кандидат в президенты — ${name(ev.pres)}${ev.special ? ' (внеочередные выборы)' : ''}.`;
    case 'nominate':
      return `${name(ev.pres)} выдвигает в канцлеры ${name(ev.chanc)}. Голосуем!`;
    case 'votes': {
      const ja = Object.entries(ev.votes).filter(([, v]) => v).map(([x]) => name(+x));
      const nein = Object.entries(ev.votes).filter(([, v]) => !v).map(([x]) => name(+x));
      return `${ev.passed ? '✅ Правительство избрано' : `❌ Не избрано (провалов подряд: ${ev.tracker})`}. Ja!: ${ja.join(', ') || '—'}; Nein: ${nein.join(', ') || '—'}.`;
    }
    case 'notHitler':
      return `${name(ev.seat)} — не Гитлер.`;
    case 'draw':
      return `${name(ev.pres)} тянет три закона…`;
    case 'pass':
      return `${name(ev.pres)} сбрасывает один и передаёт два канцлеру ${name(ev.chanc)}.`;
    case 'enact':
      return ev.chaos ? `🌀 Хаос! Принят верхний закон — ${P(ev.policy)}.` : `Принят ${P(ev.policy)} закон (Л ${ev.lib} · Ф ${ev.fas}).`;
    case 'vetoAsk':
      return `${name(ev.chanc)}: «Я хочу наложить вето».`;
    case 'vetoAnswer':
      return ev.yes ? `${name(ev.pres)}: «Согласен» — оба закона сброшены.` : `${name(ev.pres)} против вето — канцлер принимает закон.`;
    case 'shuffle':
      return `Сброс замешан в колоду (${ev.deck}).`;
    case 'power':
      return `Президент ${name(ev.pres)} получает полномочие: ${POWER_NAME[ev.power]}.`;
    case 'investigate':
      return `🔍 ${name(ev.pres)} проверяет партию ${name(ev.target)}.`;
    case 'special':
      return `🎩 ${name(ev.pres)} назначает внеочередные выборы: кандидат — ${name(ev.target)}.`;
    case 'peek':
      return `👁 ${name(ev.pres)} смотрит три верхних закона.`;
    case 'kill':
      return `💀 ${name(ev.pres)}: «Именем президента приговариваю ${name(ev.target)} к казни».`;
    case 'claim': {
      const c = ev.claim;
      if (c.silent) return `${name(ev.seat)} промолчал.`;
      if (ev.as === 'pres') return `${name(ev.seat)} (президент): «Пришло ${cardsText(c.drew!, 3)}, передал ${cardsText(c.passed!, 2)}».`;
      if (ev.as === 'chanc') return `${name(ev.seat)} (канцлер): «Мне пришло ${cardsText(c.got!, 2)}».`;
      if (c.party) return `${name(ev.seat)}: «Проверил — ${c.party === 'L' ? 'либерал' : 'фашист'}».`;
      return `${name(ev.seat)}: «Сверху ${cardsText(c.fas!, 3)}».`;
    }
    case 'over': {
      const roles = Object.entries(ev.roles)
        .filter(([, r]) => r !== 'liberal')
        .map(([x, r]) => `${name(+x)} — ${ROLE_LOW[r as Role]}`)
        .join(', ');
      return `🏁 ${ev.winner === 'L' ? 'Победа либералов' : 'Победа фашистов'}: ${ev.reason}. ${roles}.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats = (n: number): SeatSpec[] => Array.from({ length: n }, (_, seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const fixedRng: Rng = { next: () => 0, int: () => 0, getState: () => 0 };

/** Позиция для показа: роли и колода заданы, ночь позади, раунд у президента pres. */
function pos(n: number, roles: Role[], deck: string, pres: number, extra: Partial<State> = {}): State {
  const s = setup(Array.from({ length: n }, (_, i) => i), {}, fixedRng);
  s.roles = Object.fromEntries(roles.map((r, i) => [i, r]));
  s.art = Object.fromEntries(roles.map((_, i) => [i, i % 3]));
  s.deck = deck.split('') as Party[];
  s.phase = 'nominate';
  s.round = 1;
  s.rot = pres;
  s.pres = pres;
  Object.assign(s, extra);
  return s;
}
const R5: Role[] = ['liberal', 'fascist', 'liberal', 'hitler', 'liberal'];
const R7: Role[] = ['liberal', 'fascist', 'liberal', 'hitler', 'liberal', 'fascist', 'liberal'];
const act = (seat: number, action: Action, caption?: string) => ({ seat, action, caption });
const votes = (n: number, ja: number[], caption?: string) =>
  Array.from({ length: n }, (_, x) => act(x, { type: 'vote', ja: ja.includes(x) }, x === n - 1 ? caption : undefined));

export const def: GameDef<State, Action, Event, View> = {
  id: 'secret-hitler',
  title: 'Тайный Гитлер',
  players: { min: 5, max: 10, default: 7 },
  seats: SEATS,
  options: [
    {
      key: 'rebalance',
      label: 'Перебалансировка',
      hint: 'поправка авторов: вшестером один фашистский закон уже принят, всемером фашистских карт 10, вдевятером 9',
      type: 'toggle',
      default: false,
    },
  ],
  presets: [
    { id: 'classic', label: 'Классика', hint: 'По правилам Secret Hitler: 5–10 игроков, поле фашистов по размеру стола', options: { rebalance: false } },
    { id: 'rebalanced', label: 'Перебалансировка', hint: 'Поправка авторов для 6, 7 и 9 игроков — там фашистам легче', options: { rebalance: true } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng, seats.filter((x) => x.kind !== 'bot').map((x) => x.seat)),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  result(s) {
    if (s.phase !== 'over' || !s.winner) return null;
    const winners = s.seats.filter((x) => (s.roles[x] === 'liberal') === (s.winner === 'L'));
    return { winners, text: `${s.winner === 'L' ? 'победа либералов' : 'победа фашистов'}: ${s.reason}` };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos(7, R7, 'FFLFLFFLF', 4, { lib: 2, fas: 3, tracker: 1, round: 7, lastPres: 3, lastChanc: 0, notHitler: [0] });
    s.discard = ['F', 'L', 'F', 'F'] as Party[];
    s.govs = [
      { round: 5, pres: 2, chanc: 6, votes: { 0: true, 1: true, 2: true, 3: false, 4: true, 5: true, 6: true }, passed: true, policy: 'L', presClaim: { drew: 1, passed: 0 }, chancClaim: { got: 0 } },
      { round: 6, pres: 3, chanc: 0, votes: { 0: true, 1: true, 2: false, 3: true, 4: true, 5: false, 6: true }, passed: true, policy: 'F', power: 'special', target: 4, presClaim: { drew: 3, passed: 2 }, chancClaim: { got: 2 } },
      { round: 7, pres: 4, chanc: 1, special: true },
    ];
    s.chanc = 1;
    s.phase = 'vote';
    s.votes = { 0: true, 2: false, 5: true };
    return s;
  },

  rules: {
    goal: '1932 год, Германия. Либералы (их больше) не знают друг друга; фашисты знают своих и прикрывают тайного Гитлера. Либералам — принять 5 либеральных законов или казнить Гитлера; фашистам — 6 фашистских или избрать Гитлера канцлером, когда уже приняты три фашистских.',
    sections: [
      {
        title: 'Роли',
        html: `<p>Каждый втайне получает роль (и карту партии): <b>либерал</b>, <b>фашист</b> или <b>Гитлер</b> — он в команде фашистов.</p>
          <table class="sh-tab"><tr><th>Игроков</th><td>5</td><td>6</td><td>7</td><td>8</td><td>9</td><td>10</td></tr>
          <tr><th>Либералов</th><td>3</td><td>4</td><td>4</td><td>5</td><td>5</td><td>6</td></tr>
          <tr><th>Фашистов</th><td>1+Г</td><td>1+Г</td><td>2+Г</td><td>2+Г</td><td>3+Г</td><td>3+Г</td></tr></table>
          <p>«Ночью» фашисты узнают друг друга и Гитлера. Гитлер своих знает только при 5–6 игроках, при 7–10 — не знает никого.
          Здесь это делает стол: карта роли показывает, кого вы знаете. В хот-сите каждый смотрит свою карту за занавеской.</p>
          <p>Врать можно всегда и обо всём — кроме одного: Гитлер не скрывает себя, когда его казнят или избирают канцлером после трёх фашистских законов (стол открывает это сам).</p>`,
      },
      {
        title: 'Выборы',
        html: `<p>Табличка президента идёт по кругу. Кандидат в президенты выдвигает канцлера — любого живого, кроме последних избранных президента и канцлера
          (когда в живых пять игроков или меньше — нельзя только экс-канцлера). Затем голосуют <b>все разом</b>, включая кандидатов: «Ja!» или «Nein».
          Большинство «Ja!» — правительство избрано; ничья или больше «Nein» — провал, табличка уходит дальше, а жетон «Хода выборов» сдвигается.</p>
          <p>Когда приняты три фашистских закона, избранный канцлер должен сказать, не Гитлер ли он: если Гитлер — фашисты победили, если нет — все теперь знают, что он не Гитлер.</p>`,
        demo: {
          seats: demoSeats(5),
          setup: () => pos(5, R5, 'LFFFLFFLF', 0),
          intro: 'Президент — Вовка. Канцлера выбирает он сам, остальные потом голосуют.',
          steps: [act(0, { type: 'nominate', target: 2 }, 'Вовка выдвигает Серёгу в канцлеры.'), ...votes(5, [0, 1, 2, 4], 'Карты голосования открываются разом: 4 «Ja!» против 1 — правительство избрано.')],
        },
      },
      {
        title: 'Законодательная сессия',
        html: `<p>Президент тянет три верхних закона, втайне сбрасывает один и передаёт два канцлеру; канцлер сбрасывает один и принимает оставшийся — кладёт на своё поле.
          Во время сессии президент и канцлер <b>не разговаривают</b> и не показывают карты. Сброшенное никто не видит.</p>
          <p>Потом оба <b>заявляют</b>, что им пришло, — кнопками («мне пришло ЛЛФ, передал ЛФ»), а ещё в чате и голосом. Заявления могут быть ложью:
          фашист свалит всё на колоду или на напарника. В колоде 6 либеральных и 11 фашистских — бывает, что и честному президенту приходит «ФФФ».</p>
          <p>Если в колоде меньше трёх карт — сброс замешивают обратно.</p>`,
        demo: {
          seats: demoSeats(5),
          setup: () => {
            const s = pos(5, R5, 'LFFFLFFLF', 0);
            s.chanc = 2;
            s.lastPres = 0;
            s.lastChanc = 2;
            s.phase = 'pres';
            s.hand = s.deck.splice(0, 3);
            s.govs = [{ round: 1, pres: 0, chanc: 2, passed: true, votes: { 0: true, 1: true, 2: true, 3: false, 4: true }, drew: s.hand.slice() }];
            return s;
          },
          intro: 'Президенту Вовке пришло Л, Ф, Ф. Он либерал — сбрасывает фашистский.',
          steps: [
            act(0, { type: 'discard', index: 1 }, 'Серёге уходят Л и Ф.'),
            act(2, { type: 'enact', index: 0 }, 'Серёга принимает либеральный закон.'),
            act(0, { type: 'claim', drew: 2, passed: 1 }, 'Вовка: «Пришло ЛФФ, передал ЛФ».'),
            act(2, { type: 'claim', got: 1 }, 'Серёга: «Мне пришло ЛФ». Всё сходится.'),
          ],
        },
      },
      {
        title: 'Ход выборов и хаос',
        html: `<p>Три провала голосования подряд — страна погружается в хаос: сразу принимается верхний закон колоды, его полномочие не действует,
          а ограничение сроков снимается — канцлером в следующем раунде может стать любой. Любой принятый закон обнуляет «Ход выборов».</p>`,
        demo: {
          seats: demoSeats(5),
          setup: () => pos(5, R5, 'FLFFLFFLF', 1, { tracker: 2 }),
          intro: 'Уже два провала подряд. Ещё один — и хаос.',
          steps: [act(1, { type: 'nominate', target: 3 }, 'Ленка выдвигает Таньку.'), ...votes(5, [1, 3], 'Только 2 «Ja!» — третий провал. Хаос: принят верхний закон, фашистский.')],
        },
      },
      {
        title: 'Полномочия президента',
        html: `<p>Фашистский закон на клетке с полномочием — президент обязан его применить. Какие клетки — зависит от числа игроков:</p>
          <ul><li><b>5–6:</b> 3-й закон — просмотр трёх верхних законов; 4-й и 5-й — казнь.</li>
          <li><b>7–8:</b> 2-й — проверка партии; 3-й — внеочередные выборы; 4-й и 5-й — казнь.</li>
          <li><b>9–10:</b> 1-й и 2-й — проверка партии; 3-й — внеочередные выборы; 4-й и 5-й — казнь.</li></ul>
          <p><b>Проверка партии</b> — президент втайне видит карту партии игрока (не роль: Гитлер покажется просто фашистом); одного дважды не проверяют. Рассказать можно что угодно.
          <b>Внеочередные выборы</b> — президент сам выбирает следующего кандидата в президенты, потом круг идёт как шёл.
          <b>Казнь</b> — игрок выбывает и молчит; если это Гитлер — либералы победили, иначе роль казнённого не открывают.</p>`,
        demo: {
          seats: demoSeats(7),
          setup: () => {
            const s = pos(7, R7, 'FLFFLFFLF', 2, { fas: 1, lastPres: 2, lastChanc: 4 });
            s.chanc = 4;
            s.phase = 'chanc';
            s.hand = ['F', 'F'];
            s.discard = ['L'];
            s.govs = [{ round: 1, pres: 2, chanc: 4, passed: true, votes: { 0: true, 1: true, 2: true, 3: true, 4: true, 5: false, 6: false }, drew: ['L', 'F', 'F'], gave: ['F', 'F'] }];
            return s;
          },
          intro: 'Семеро за столом. Канцлеру Димону пришло два фашистских — второй фашистский закон даёт президенту проверку.',
          steps: [
            act(4, { type: 'enact', index: 0 }, 'Принят второй фашистский закон.'),
            act(2, { type: 'claim', drew: 2, passed: 2 }, 'Серёга: «Пришло ЛФФ… передал ФФ» — значит, сам сбросил либеральный!'),
            act(4, { type: 'claim', got: 2 }),
            act(2, { type: 'investigate', target: 1 }, 'Президент Серёга проверяет Ленку.'),
            act(2, { type: 'claim', party: 'F' }, '«Ленка — фашист!» Правда это или нет — знает только Серёга.'),
          ],
        },
      },
      {
        title: 'Вето',
        html: `<p>После пятого фашистского закона у правительства есть право вето. Канцлер вместо принятия говорит: «Я хочу наложить вето».
          Если президент согласен — оба закона сброшены, «Ход выборов» сдвигается. Если нет — канцлер обязан принять один из двух.</p>`,
        demo: {
          seats: demoSeats(5),
          setup: () => {
            const s = pos(5, R5, 'LFFFLFFLF', 4, { fas: 5, lib: 3, lastPres: 4, lastChanc: 0 });
            s.chanc = 0;
            s.phase = 'chanc';
            s.hand = ['F', 'F'];
            s.discard = ['L'];
            s.govs = [{ round: 1, pres: 4, chanc: 0, passed: true, drew: ['F', 'L', 'F'], gave: ['F', 'F'] }];
            return s;
          },
          intro: 'Пять фашистских законов. Канцлеру Вовке пришло ФФ — шестой фашистский закон значит победу фашистов.',
          steps: [
            act(0, { type: 'veto' }, 'Вовка: «Я хочу наложить вето».'),
            act(4, { type: 'vetoAnswer', yes: true }, 'Президент Димон согласен — оба закона в сброс.'),
          ],
        },
      },
      {
        title: 'Перебалансировка',
        html: `<p>При 6, 7 и 9 игроках фашистам легче. Авторы предлагают поправку (пресет «Перебалансировка»): <b>вшестером</b> игра начинается
          с одного уже принятого фашистского закона; <b>всемером</b> в колоде 10 фашистских законов вместо 11; <b>вдевятером</b> — 9.</p>`,
      },
      {
        title: 'Подсказки',
        html: `<p>Либералам выгодно не спешить и обсуждать: кто голосовал за правительство, принявшее фашистский закон, чьи заявления не сходятся.
          Фашистам выгодна спешка и неразбериха. Гитлеру — быть самым образцовым либералом, а когда приняты три фашистских закона, — стать канцлером.</p>`,
      },
      {
        title: 'Авторы и лицензия',
        html: `<p><b>Secret Hitler</b> — игра Goat, Wolf &amp; Cabbage: Max Temkin, Mike Boxleiter, Tommy Maranges; иллюстрации Mackenzie Schubert.
          Русский цветной print-and-play и перевод правил — любительские (переводчики не указаны; правила отпечатаны в мастерской REDDICE).</p>
          <p>Игра и оформление распространяются по лицензии <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.ru" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>:
          только некоммерческое использование, с указанием авторов. Эта электронная версия — производная работа, распространяется по той же лицензии.
          <a href="/secret-hitler/credits.html" target="_blank">Подробнее</a>.</p>`,
      },
    ],
  },
};
