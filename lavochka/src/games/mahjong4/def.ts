/* «Маджонг вчетвером» — описание игры для сборника. Без DOM.
 * Пресеты — разновидности из статьи Википедии: гонконгский, японский риичи, китайский классический, тайваньский (16 костей),
 * сычуаньский («кровавая битва») и упрощённый для начинающих. */
import { SeededRng } from '../../core/rng';
import type { DemoScript, GameDef, Options, Rng, SeatSpec } from '../../core/types';
import { kindName, kindOf, kindShort, TILE_CREDITS, WIND_NAMES } from '../mahjong/tiles';
import { choose } from './ai';
import { apply, newGame, toAct, type Action, type Cfg, type Event, type State } from './engine';
import type { Style } from './score';
import { makeView, type View } from './view-model';

export const SEATS = [
  { name: 'Вовка', color: '#c0281e', light: '#e86a5a', dark: '#7a140e' },
  { name: 'Ленка', color: '#23408f', light: '#5a78c8', dark: '#122450' },
  { name: 'Серёга', color: '#2a7a3a', light: '#5aaa6a', dark: '#164a20' },
  { name: 'Танька', color: '#b07a10', light: '#e0b04a', dark: '#5a3c06', ink: '#8a5a08' },
];

export const STYLE_LABEL: Record<string, string> = {
  hk: 'Гонконгский',
  riichi: 'Японский риичи',
  classic: 'Китайский классический',
  tw: 'Тайваньский',
  sc: 'Сычуаньский',
  easy: 'Для начинающих',
};

const BASE: Record<string, Cfg> = {
  hk: { style: 'hk', flowers: true, honors: true, hand: 13, chow: true, min: 3, aka: false, kuitan: false, seven: true, thirteen: true, rounds: 1, start: 0, limit: 13, multiRon: false, sichuan: false, hints: true },
  riichi: { style: 'riichi', flowers: false, honors: true, hand: 13, chow: true, min: 1, aka: true, kuitan: true, seven: true, thirteen: true, rounds: 1, start: 25000, limit: 13, multiRon: true, sichuan: false, hints: true },
  classic: { style: 'classic', flowers: false, honors: true, hand: 13, chow: true, min: 0, aka: false, kuitan: false, seven: false, thirteen: true, rounds: 1, start: 2000, limit: 1000, multiRon: false, sichuan: false, hints: true },
  tw: { style: 'tw', flowers: true, honors: true, hand: 16, chow: true, min: 0, aka: false, kuitan: false, seven: false, thirteen: false, rounds: 1, start: 0, limit: 99, multiRon: true, sichuan: false, hints: true },
  sc: { style: 'sc', flowers: false, honors: false, hand: 13, chow: false, min: 0, aka: false, kuitan: false, seven: true, thirteen: false, rounds: 1, start: 0, limit: 4, multiRon: true, sichuan: true, hints: true },
  easy: { style: 'hk', flowers: false, honors: true, hand: 13, chow: true, min: 0, aka: false, kuitan: false, seven: true, thirteen: true, rounds: 1, start: 0, limit: 13, multiRon: false, sichuan: false, hints: true },
};

export function cfgOf(o: Options): Cfg {
  const key = String(o.style ?? 'hk');
  const c: Cfg = { ...(BASE[key] ?? BASE.hk) };
  if ([1, 2, 4].includes(Number(o.rounds))) c.rounds = Number(o.rounds);
  if (c.style === 'hk' && key === 'hk') {
    if ([0, 1, 3].includes(Number(o.min))) c.min = Number(o.min);
    if (typeof o.flowers === 'boolean') c.flowers = o.flowers;
  }
  if (c.style === 'riichi' && typeof o.aka === 'boolean') c.aka = o.aka;
  if (typeof o.hints === 'boolean') c.hints = o.hints;
  return c;
}

export const styleKey = (c: Cfg) => (c.style === 'hk' && c.min === 0 && !c.flowers ? 'easy' : c.style);

// ---------------------------------------------------------------- журнал

const tn = (id: number) => `<b>${kindShort(kindOf(id))}</b>`;
const MELD_NAME = { chi: 'чи', pon: 'пон', kan: 'конг' };
const SUIT_GEN = ['медяков', 'бамбуков', 'тем'];
/** «2-3-4 бамбуков», «красный дракон», «7 тем». */
export function meldText(t: 'chi' | 'pon' | 'kan', k: number): string {
  if (t === 'chi') return `<b>${(k % 9) + 1}-${(k % 9) + 2}-${(k % 9) + 3} ${SUIT_GEN[Math.floor(k / 9)]}</b>`;
  return `<b>${kindName(k).toLowerCase()}</b>`;
}

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Раздача: круг ${WIND_NAMES[ev.round % 4]}, дилер — ${name(ev.dealer)}${ev.honba ? `, повтор ${ev.honba}` : ''}.`;
    case 'missing':
      return `${name(ev.seat)} отказывается от масти: ${['медяки', 'бамбуки', 'тьмы'][ev.suit]}.`;
    case 'flower':
      return `${name(ev.seat)} открывает ${kindName(kindOf(ev.id)).toLowerCase()}.`;
    case 'discard':
      return ev.riichi ? `${name(ev.seat)} объявляет <b>риичи</b>, сброс ${tn(ev.id)}.` : null;
    case 'call':
      return `${name(ev.seat)}: ${MELD_NAME[ev.t]}! ${meldText(ev.meld.t, ev.meld.k)}`;
    case 'kan':
      return `${name(ev.seat)}: ${ev.added ? 'добавленный' : 'закрытый'} конг — ${meldText('kan', ev.meld.k)}.`;
    case 'dora':
      return `Новый указатель доры: ${tn(ev.id)}.`;
    case 'win':
      return `🀄 ${name(ev.rec.seat)} — маджонг! ${ev.rec.from < 0 ? 'Взял сам' : `на сбросе ${name(ev.rec.from)}`} (${ev.rec.label}), +${ev.rec.gain}.`;
    case 'pay':
      return ev.why === 'выигрыш' ? null : `Плата за ${ev.why}: ${ev.deltas.map((d, i) => (d ? `${name(i)} ${d > 0 ? '+' : ''}${d}` : '')).filter(Boolean).join(', ')}.`;
    case 'end':
      return ev.result.kind === 'draw' ? 'Ничья: стена кончилась.' : null;
    case 'over':
      return '🏁 Партия окончена.';
  }
  return null;
}

function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands.map((h, i) => (seats.includes(i) ? h : h.map(() => -1))) };
  if (ev.type === 'draw' && !seats.includes(ev.seat)) return { ...ev, id: -1 };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

/** Вид по записи: 1m…9m (медяки), 1b (бамбуки), 1t (тьмы), E S W N (ветра), Wh Gr Rd (драконы). */
function K(t: string): number {
  const m = /^(\d)([mbt])$/.exec(t);
  if (m) return { m: 0, b: 9, t: 18 }[m[2] as 'm' | 'b' | 't'] + Number(m[1]) - 1;
  return { E: 27, S: 28, W: 29, N: 30, Wh: 31, Gr: 32, Rd: 33 }[t as 'E'] ?? 0;
}

/** Позиция для показа: руки задаются видами, стена — порядком следующих костей. */
function pos(style: string, hands: string[], wall: string[], extra: (s: State) => void = () => {}): State {
  const s = newGame(cfgOf({ style }), new SeededRng(5));
  const used = new Map<number, number>();
  const id = (t: string) => {
    const k = K(t);
    const n = used.get(k) ?? 0;
    used.set(k, n + 1);
    return k * 4 + ((n + 1) % 4); // красную (номер ×4) не трогаем в показе
  };
  s.p.forEach((p, i) => {
    p.hand = hands[i].split(/\s+/).filter(Boolean).map(id);
    p.flowers = [];
  });
  s.live = wall.map(id);
  // добить стену костями, которых нет на руках
  const taken = new Set([...s.p.flatMap((p) => p.hand), ...s.live]);
  for (let x = 0; x < 136 && s.live.length < 60; x++) if (!taken.has(x) && (s.cfg.honors || x < 108)) s.live.push(x);
  s.dealer = 0;
  s.turn = 0;
  s.phase = 'turn';
  s.drawn = s.p[0].hand[s.p[0].hand.length - 1];
  extra(s);
  return s;
}

let demoState: State | null = null;
/** Номер кости вида t в руке места (по текущей позиции показа). */
function idIn(_s: (() => State) | undefined, seat: number, t: string): number {
  const st = demoState!;
  const k = K(t);
  return st.p[seat].hand.find((x) => kindOf(x) === k) ?? -1;
}

/** Показ с пошаговым состоянием: шаги строятся по ходу, чтобы номера костей сходились. */
function script(style: string, intro: string, start: () => State, plan: ((s: State) => { seat: number; action: Action; caption: string })[]): DemoScript<State, Action> {
  let steps: DemoScript<State, Action>['steps'] | null = null;
  return {
    seats: demoSeats,
    options: { style },
    setup: () => start(),
    intro,
    get steps() {
      if (steps) return steps;
      steps = [];
      let s = start();
      for (const f of plan) {
        demoState = s;
        const st = f(s);
        const r = apply(s, st.seat, st.action, new SeededRng(9));
        if (!r) break;
        steps.push(st);
        s = r.state;
      }
      return steps;
    },
  };
}

// Заявки: Вовка (дилер) ждёт 6 или 9 тем; Серёга берёт поном зелёного дракона; Танька сбрасывает 9 тем — рон.
const demoClaim = () =>
  pos(
    'easy',
    ['1m 2m 3m 4b 5b 6b 7t 8t Rd Rd Wh Wh Wh N', '1b 1b 9m 9b E S W 4m 5m 6m 3t 2t 2b', 'Gr Gr 3m 4m 5m 6t 6t 7b 8b 9b 2m E S', '1t 1t 5t 5t 7m 8m 3b 3b 4t 6b 9m 2m S'],
    ['Gr', '9t']
  );

// Риичи: Вовка ждёт 6 или 9 тем, объявляет риичи; через круг тянет 9 тем сам — цумо с иппацу.
const demoRiichi = () =>
  pos(
    'riichi',
    ['2m 3m 4m 5b 6b 7b 3t 4t 5t 7t 8t N N W', '1b 1b 9m 9b E S Gr 4m 6m 6m 3t 2t 2b', '9b 9b 3m 4m 6t 6t 7b 8b Wh 2m S Rd 1t', '1t 2t 5t 5t 7m 8m S N 3b 3b 4t 7m 1m'],
    ['E', 'Wh', '9m', '9t']
  );

export const def: GameDef<State, Action, Event, View> = {
  id: 'mahjong4',
  title: 'Маджонг вчетвером',
  players: { min: 4, max: 4, default: 4 },
  seats: SEATS,
  options: [
    { key: 'style', label: 'Правила', type: 'select', choices: Object.entries(STYLE_LABEL).map(([value, label]) => ({ value, label })), default: 'hk' },
    { key: 'min', label: 'Порог выигрыша', hint: 'сколько фаней нужно, чтобы объявить маджонг', type: 'select', choices: [{ value: 3, label: '3 фаня — как в Гонконге' }, { value: 1, label: '1 фань' }, { value: 0, label: 'без порога' }], default: 3, showIf: (o) => (o.style ?? 'hk') === 'hk' },
    { key: 'flowers', label: 'Цветы и сезоны', hint: 'восемь бонусных костей: выкладываются сразу, взамен берётся кость', type: 'toggle', default: true, showIf: (o) => (o.style ?? 'hk') === 'hk' },
    { key: 'aka', label: 'Красные пятёрки', hint: 'по одной красной пятёрке каждой масти — лишняя дора', type: 'toggle', default: true, showIf: (o) => o.style === 'riichi' },
    { key: 'rounds', label: 'Длина партии', type: 'select', choices: [{ value: 1, label: 'восточный круг — 4 раздачи и повторы' }, { value: 2, label: 'восток и юг — 8 раздач' }, { value: 4, label: 'все четыре ветра' }], default: 1 },
    { key: 'hints', label: 'Подсказки', hint: 'показывать, каких костей ждёт готовая рука, и советовать сброс', type: 'toggle', default: true },
  ],
  presets: [
    { id: 'hk', label: 'Гонконгский', hint: 'Цветы, фани, порог 3', options: { style: 'hk', min: 3, flowers: true } },
    { id: 'riichi', label: 'Японский риичи', hint: 'Риичи, дора, яку, хан и фу', options: { style: 'riichi', aka: true } },
    { id: 'classic', label: 'Китайский классический', hint: 'Очки за сеты и удвоения', options: { style: 'classic' } },
    { id: 'tw', label: 'Тайваньский', hint: '16 костей, таи', options: { style: 'tw' } },
    { id: 'sc', label: 'Сычуаньский', hint: 'Без чи и чести, кровавая битва', options: { style: 'sc' } },
    { id: 'easy', label: 'Для начинающих', hint: 'Любая собранная рука', options: { style: 'easy' } },
  ],

  setup: (_seats, o, rng: Rng) => newGame(cfgOf(o), rng),
  toAct,
  apply,
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.phase !== 'over') return null;
    const best = Math.max(...s.scores);
    const scores: Record<number, number> = {};
    s.scores.forEach((x, i) => (scores[i] = x));
    return { winners: [0, 1, 2, 3].filter((x) => s.scores[x] === best), text: 'больше всех очков', scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase() {
    let s = newGame(cfgOf({ style: 'riichi' }), new SeededRng(31));
    const rng = new SeededRng(32);
    for (let k = 0; k < 400 && s.phase !== 'end' && s.phase !== 'over'; k++) {
      const seat = toAct(s)[0];
      const a = choose(makeView(s, [seat]), seat, 1, rng);
      if (!a) break;
      const r = apply(s, seat, a, rng);
      if (!r) break;
      if (r.state.phase === 'end') break;
      s = r.state;
      if (s.live.length < 40 && s.phase === 'turn' && s.turn === 0) break;
    }
    return s;
  },

  rules: {
    goal: 'Первым собрать <b>маджонг</b> — 14 костей: четыре сета (ряд или три одинаковых) и пару. Сколько стоит рука и что можно, а что нельзя, — по выбранным правилам. За партию — больше всех очков.',
    sections: [
      {
        title: 'Кости и стена',
        html: `<p>136 костей: три масти — <b>медяки</b>, <b>бамбуки</b>, <b>тьмы</b> от 1 до 9, четыре <b>ветра</b> и три <b>дракона</b>, всего по четыре.
          В гонконгских и тайваньских правилах ещё восемь бонусных — <b>цветы</b> и <b>сезоны</b>: их сразу выкладывают и берут кость взамен,
          а «свой» цветок (по ветру места) добавляет очков. Сычуаньский маджонг играет только мастями — 108 костей.</p>
          <p>Кости перемешивают и строят стену. Каждому — по 13 (в тайваньском по 16). Дилер — <b>Восток</b>, дальше по ходу Юг, Запад, Север.</p>`,
      },
      {
        title: 'Ход и заявки',
        html: `<p>В свой ход берёшь кость со стены и сбрасываешь одну. Чужой сброс можно забрать:</p>
          <ul><li><b>Пон</b> — к двум своим одинаковым, любой игрок;</li>
          <li><b>Конг</b> — к трём своим, взамен берёшь лишнюю кость с хвоста стены;</li>
          <li><b>Чи</b> — ряд из трёх подряд одной масти, только у соседа слева (в Сычуани чи нет);</li>
          <li><b>Рон</b> — сброс собирает твою руку: маджонг.</li></ul>
          <p>Рон важнее пона и конга, пон — важнее чи. Забранный сет выкладывается открыто, после этого — сброс. Четыре одинаковых на руке
          можно объявить <b>закрытым конгом</b>, а к своему открытому пону добавить четвёртую — но её могут «ограбить» выигрышем.</p>`,
        demo: script('easy', 'Вовка — дилер, ему не хватает 6 или 9 тем.', demoClaim, [
          () => ({ seat: 0, action: { t: 'discard', id: idIn(undefined, 0, 'N') }, caption: 'Вовка сбрасывает ненужный Север.' }),
          (s) => ({ seat: 1, action: { t: 'discard', id: s.drawn }, caption: 'Ленка взяла со стены зелёного дракона и сбрасывает его.' }),
          () => ({ seat: 2, action: { t: 'pon' }, caption: 'У Серёги два зелёных дракона — пон! Забирает сброс, выкладывает сет открыто и ходит сам, без взятия.' }),
          () => ({ seat: 2, action: { t: 'discard', id: idIn(undefined, 2, 'E') }, caption: 'Серёга сбрасывает Восток.' }),
          (s) => ({ seat: 3, action: { t: 'discard', id: s.drawn }, caption: 'Танька взяла 9 тем и сбрасывает. Вовка мог бы взять её и как чи (7-8-9), но…' }),
          () => ({ seat: 0, action: { t: 'ron' }, caption: '…рон! 1-2-3 медяков, 4-5-6 бамбуков, 7-8-9 тем, пон белых драконов и пара красных — маджонг.' }),
        ]),
      },
      {
        title: 'Маджонг и цена руки',
        html: `<p>Собранная рука — <b>четыре сета и пара</b> (в тайваньском — пять сетов и пара). Особые руки: <b>семь пар</b> и <b>тринадцать сирот</b>
          (по одной каждой крайней и чести плюс пара). Выиграть можно на чужом сбросе или <b>взяв кость сам</b> — так дороже.</p>
          <p>Дальше — по правилам: в <b>гонконгском</b> руку считают в фанях (взял сам — 1, пон дракона — 1, одни поны — 3, масть с честью — 3,
          чистая масть — 7…), нужно не меньше трёх; сбросивший платит полную цену, остальные — половину, а если взял сам — платят все.
          В <b>китайском классическом</b> — очки за сеты (закрытые дороже, крайние и честь дороже), потом удвоения; платят все, дилер — вдвое.
          В <b>тайваньском</b> — таи: 100 очков плюс по 20 за тай, платит сбросивший. В <b>сычуаньском</b> — фани по степеням двойки.</p>`,
      },
      {
        title: 'Японский риичи',
        html: `<p>Нужно хотя бы одно <b>яку</b> — особое условие руки (только простые, якухай-пон, пинфу, риичи и др.); дора яку не считается.
          <b>Риичи</b>: закрытая рука, которой не хватает одной кости, — ставишь 1000 очков и дальше только сбрасываешь взятое;
          риичи само по себе яку, а выигравшему с ним открывают ещё и ура-дору.</p>
          <p><b>Дора</b> — кость, следующая за указателем на мёртвой стене: каждая на руке — лишний хан. <b>Фуритэн</b>: если среди твоих
          сбросов есть кость, которой ты ждёшь, выиграть на чужом сбросе нельзя — только взяв самому. Очки — по хан и фу: 30 фу 1 хан — 1000,
          манган — 8000, якуман — 32 000 (дилеру в полтора раза больше). Начинают с 25 000; ушёл в минус — партия окончена.</p>`,
        demo: script('riichi', 'У Вовки закрытая рука — не хватает одной кости.', demoRiichi, [
          () => ({ seat: 0, action: { t: 'discard', id: idIn(undefined, 0, 'W'), riichi: true }, caption: 'Сброс Запада боком — риичи: ставка 1000, Вовка ждёт 6 или 9 тем и дальше только сбрасывает взятое.' }),
          (s) => ({ seat: 1, action: { t: 'discard', id: s.drawn }, caption: 'Ленка сбрасывает взятый Восток.' }),
          (s) => ({ seat: 2, action: { t: 'discard', id: s.drawn }, caption: 'Серёга — белого дракона.' }),
          (s) => ({ seat: 3, action: { t: 'discard', id: s.drawn }, caption: 'Танька — 9 медяков. Никто ничего не забирал…' }),
          () => ({ seat: 0, action: { t: 'tsumo' }, caption: '…и Вовка тянет 9 тем — цумо! Дабл риичи (риичи на самом первом сбросе), иппацу (выиграл в первый же круг после риичи), мэндзэн цумо и пинфу — манган.' }),
        ]),
      },
      {
        title: 'Сычуаньский: кровавая битва',
        html: `<p>Только масти, чи нет. В начале каждый объявляет <b>отсутствующую масть</b> — пока на руке есть её кости, сбрасывать
          можно только их, а выиграть нельзя. Выигравший выходит из раздачи, остальные <b>доигрывают</b>, пока не выиграют трое
          или не кончится стена. За конги платят сразу: открытый — сбросивший 2, закрытый — каждый по 2.
          Цена — 2 в степени фаней (одни поны, чистая масть, семь пар, «корни» — четыре одинаковые кости).</p>`,
      },
      {
        title: 'Дилер, круги и конец',
        html: `<p>Дилер выиграл (или ничья) — он сдаёт снова, иначе дилером становится следующий. Когда дилером побывали все — новый круг
          (ветер круга сменяется: Восток, Юг…). Партия — один круг, два или все четыре. Побеждает тот, у кого больше очков.</p>
          <p>Взятие кости со стены — без выбора, поэтому стол берёт её сам; сбросы и заявки — ваши. Подсказки показывают ожидания готовой руки.</p>`,
      },
      { title: 'Рисунок костей', html: TILE_CREDITS },
    ],
  },
};

export type { Style };
