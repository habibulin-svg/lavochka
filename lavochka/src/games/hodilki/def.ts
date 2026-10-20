/* Кинь-двинь — одна игра на нескольких оригинальных советских полях; поле выбирается настройкой и лежит в состоянии партии.
 * «Шайба» — то же поле-карточка, но с гонкой: у каждой дорожки свои ворота, финиш = гол (см. Race в core.ts). */
import type { GameDef, SeatSpec } from '../../core/types';
import { esc } from '../../core/util';
import { answerMatches, diffForLevel, randomRiddle, ANSWER_CHANCE } from '../../words/riddles';
import { canPack, finishOf, itemName, loopMove, mapOf, pathFor, SEATS, signText, skipsOf, trackOf, unpack, walkFor, type Action, type Board, type CardId, type Event, type NeedTo, type RiddleState, type Sign, type State } from './core';
import { board as kosmos } from './kosmos';
import { board as krugosvet } from './krugosvet';
import { board as put } from './put';
import { NASTOLKI } from './nastolki';
import { shelBoard } from './shel';
import { shaybaBoard } from './shayba';
import { vputBoard } from './vput';
import { LUKOMORIE } from './luk';
import { alternate } from '../../core/teams';

export const BOARDS: Board[] = [krugosvet, kosmos, put, ...NASTOLKI, shelBoard, shaybaBoard, vputBoard, ...LUKOMORIE];
export const boardOf = (map: string) => BOARDS.find((b) => b.id === map) ?? BOARDS[0];

const next = (s: State, seat: number) => s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length];

export const ANSWER_CHANCES = ANSWER_CHANCE;

/** Копия «мешочков» состояния (боны, предметы, лишние ходы) нужной длины. */
const bags = (s0: State, n: number) => ({
  coins: (s0.coins ?? Array(n).fill(0)).slice(),
  extra: (s0.extra ?? Array(n).fill(0)).slice(),
});

/** Победа места: и состояние, и событие. */
const winNow = (s: State, ev: Event[], seat: number) => {
  s.winner = seat;
  ev.push({ type: 'win', seat });
  return { state: s, events: ev };
};

/** Доступен ли вариант выбора («Шёл солдат»): есть предмет, Конь-огонь или нужный флаг. */
function optionOk(b: Board, s: State, seat: number, o: { need?: CardId; needHorse?: boolean; needIfFlag?: string }): boolean {
  void b;
  if (o.needHorse && !(s.flags?.[seat] ?? []).includes('конь')) return false;
  if (o.needIfFlag && !(s.flags?.[seat] ?? []).includes(o.needIfFlag)) return false;
  if (o.need && !(s.cards?.[seat] ?? []).includes(o.need)) return false;
  return true;
}

/** Номер клетки-ярмарки в разметке (поле) → индекс клетки в пути. */
function marketIdx(b: Board): number[] {
  return (b.deck?.market ?? []).map((x) => x - 1);
}

/** Конец хода: лишние ходы тратятся сразу, иначе ход переходит дальше (кто не пропускает). */
function endTurn(s: State, seat: number, ev: Event[], board?: Board) {
  // «Шёл солдат»: после препятствия пуговица может встать на ярмарку — тогда ход ждёт торговли
  if (board?.deck) {
    const to = s.pos[seat];
    if (marketIdx(board).includes(to)) {
      s.market = { seat, took: 0, bought: 0 };
      s.phase = 'market';
      const g = board.cells[to].sign;
      if (g) ev.push({ type: 'sign', seat, sign: g, to });
      return { state: s, events: ev };
    }
    const keep = board.deck.keep?.[to + 1];
    if (keep?.length) for (const c of keep) if ((s.cards?.[seat] ?? []).includes(c)) unpack(s.cards![seat]!, s.stock!, c);
  }
  if (s.extra?.[seat]) {
    s.extra[seat] = (s.extra[seat] ?? 0) - 1;
    return { state: s, events: ev };
  }
  let t = next(s, seat);
  for (let i = 0; i < 4 * s.seats.length && skipsOf(s, t) > 0; i++) {
    s.skip[t] = skipsOf(s, t) - 1;
    ev.push({ type: 'skip', seat: t });
    t = next(s, t);
  }
  s.turn = t;
  s.map = mapOf(s, t);
  return { state: s, events: ev };
}

/** Счёт гонки с голами: «2 : 1» по дорожкам. */
export const scoreText = (s: State, b: Board) => (s.goals ?? b.race?.tracks.map(() => 0) ?? []).join(' : ');

/** Кубик «Шайбы»: грани 1–4 — очки, 5 — красная клюшка (назад), 6 — зелёная (вперёд). Клюшка тянет квадратик с 1–3 очками. */
function rollRace(s0: State, b: Board, seat: number, rng: { int(n: number): number }): { state: State; events: Event[] } {
  const { pips, stick } = b.race!.die;
  const die = rng.int(6) + 1;
  if (die <= pips) {
    return { state: { ...s0, last: die, kind: 'pips', card: null, phase: 'move' }, events: [{ type: 'roll', seat, die, kind: 'pips' }] };
  }
  // квадратик: 15 штук — по пять с одной, двумя и тремя точками
  const slot = rng.int(15);
  const card = 1 + Math.floor(slot / 5);
  const kind = die === stick ? ('red' as const) : ('green' as const);
  const last = kind === 'red' ? -card : card;
  return { state: { ...s0, last, kind, card, cardSlot: slot, phase: 'move' }, events: [{ type: 'roll', seat, die, kind, card, slot }] };
}

/** Ход в гонке с голами: шайба идёт по своей дорожке; дошла до ворот — гол и возврат в центр. */
function moveRace(s0: State, b: Board, seat: number): { state: State; events: Event[] } {
  const race = b.race!;
  const track = trackOf(b, seat);
  const trail = race.tracks[track];
  const s: State = { ...s0, pos: s0.pos.slice(), goals: (s0.goals ?? race.tracks.map(() => 0)).slice(), phase: 'roll', kind: null, card: null, cardSlot: null };
  const mates = s.seats.filter((x) => trackOf(b, x) === track);
  const path = pathFor(s0, b, seat);
  const to = path.length ? path[path.length - 1] : s.pos[seat];
  const ev: Event[] = [];
  s.pos[seat] = to;
  ev.push({ type: 'move', seat, path });
  if (path.length && to === trail[trail.length - 1] && (s0.last ?? 0) > 0) {
    const goals = s.goals!;
    goals[track] = (goals[track] ?? 0) + 1;
    for (const x of mates) s.pos[x] = trail[0];
    const target = s.target ?? race.target;
    ev.push({ type: 'goal', seat, track, goals: goals[track], target });
    if (goals[track] >= target) {
      s.winner = seat;
      ev.push({ type: 'win', seat });
      return { state: s, events: ev };
    }
  } else {
    // у команды одна шайба: у напарников она там же
    for (const x of mates) if (x !== seat) s.pos[x] = to;
  }
  s.turn = next(s, seat);
  return { state: s, events: ev };
}

/** Ход в два действия: бросок кубика, потом игрок сам переставляет пуговицу (как фишку в нардах). */
function apply(s0: State, seat: number, a: Action, rng: { int(n: number): number }): { state: State; events: Event[] } | null {
  if (s0.winner != null || seat !== s0.turn) return null;
  const phase = s0.phase ?? 'roll';
  const board = boardOf(mapOf(s0, seat));
  if (a?.type === 'roll') {
    if (phase !== 'roll') return null;
    if (board.race) return rollRace(s0, board, seat, rng);
    const die = rng.int(6) + 1;
    return { state: { ...s0, last: die, phase: 'move' }, events: [{ type: 'roll', seat, die }] };
  }
  // ответ на загадку: пуговица идёт на деление, которое назвал игрок
  if (a?.type === 'pick') {
    if (phase !== 'pick') return null;
    const sign = board.cells[s0.pos[seat]]?.sign;
    if (sign?.k !== 'pick') return null;
    const i = Math.max(0, Math.min(sign.options.length - 1, Math.floor(a.pick) || 0));
    const finish = finishOf(board);
    const s: State = { ...s0, pos: s0.pos.slice(), phase: 'roll' };
    const dest = Math.max(0, Math.min(board.cells.length - 1, sign.to[i] ?? s0.pos[seat]));
    const ev: Event[] = [{ type: 'sign', seat, sign: { ...sign, text: `${sign.text}: ${sign.options[i]}` }, to: dest }];
    // ответ переносит пуговицу: остаток дороги-ветки за ней не тянется
    if (dest !== s0.pos[seat]) {
      if (s.route) s.route[seat] = null;
      if (s.routeFor) s.routeFor[seat] = null;
    }
    s.pos[seat] = dest;
    if (dest === finish && !board.winBySign) return winNow(s, ev, seat);
    s.turn = next(s, seat);
    s.map = mapOf(s, s.turn);
    return { state: s, events: ev };
  }
  // «Лукоморье», поле 4: загадка остальным. Загадавший выбирает загадку (свою или из базы вопросов),
  // остальные по очереди отвечают, потом он решает, отгадали ли. Никто не отгадал — награда.
  if (a?.type === 'ask') {
    if (phase !== 'ask' || !s0.riddle || s0.riddle.by !== seat) return null;
    const text = String(a.text ?? '').trim().slice(0, 300);
    if (!text) return null;
    const answer = String(a.answer ?? '').trim().slice(0, 120);
    const r: RiddleState = {
      ...s0.riddle,
      text,
      answer: answer || null,
      solved: [],
      replies: [],
      waiting: s0.seats.filter((x) => x !== seat),
    };
    const s: State = { ...s0, pos: s0.pos.slice(), skip: s0.skip.slice(), riddle: r, phase: r.waiting.length ? 'answer' : 'judge' };
    s.turn = r.waiting[0] ?? seat;
    s.map = mapOf(s, s.turn);
    return { state: s, events: [{ type: 'ask', seat, text }] };
  }
  if (a?.type === 'answer') {
    if (phase !== 'answer' || !s0.riddle || !s0.riddle.waiting.includes(seat)) return null;
    const text = String(a.text ?? '').trim().slice(0, 120);
    // бот называет свою удачу, человек печатает ответ — сверяем с ответом загадки, если он известен
    const solved = a.correct === true || (!!text && !!s0.riddle.answer && answerMatches(text, s0.riddle.answer));
    const r: RiddleState = {
      ...s0.riddle,
      solved: solved ? [...s0.riddle.solved, seat] : s0.riddle.solved.slice(),
      replies: !solved && text ? [...s0.riddle.replies, { seat, text }] : s0.riddle.replies.slice(),
      waiting: s0.riddle.waiting.filter((x) => x !== seat),
    };
    const s: State = { ...s0, pos: s0.pos.slice(), skip: s0.skip.slice(), riddle: r, phase: r.waiting.length ? 'answer' : 'judge' };
    const i = s0.seats.indexOf(seat);
    const after = s0.seats.slice(i + 1).concat(s0.seats.slice(0, i));
    s.turn = after.find((x) => r.waiting.includes(x)) ?? r.by;
    s.map = mapOf(s, s.turn);
    return { state: s, events: [{ type: 'answer', seat, solved, ...(text ? { text } : {}) }] };
  }
  if (a?.type === 'judge') {
    if (phase !== 'judge' || !s0.riddle || s0.riddle.by !== seat) return null;
    const r = s0.riddle;
    const solved = !!a.ok || r.solved.length > 0;
    const s: State = { ...s0, pos: s0.pos.slice(), skip: s0.skip.slice(), riddle: null, phase: 'roll', ...bags(s0, s0.pos.length) };
    const ev: Event[] = [{ type: 'riddle', seat, solved, ...(solved ? {} : { extra: r.extra, coins: r.coins }) }];
    if (!solved && r.extra) {
      s.extra![seat] = (s.extra![seat] ?? 0) + r.extra;
      ev.push({ type: 'reward', seat, extra: r.extra });
    }
    if (!solved && r.coins) {
      s.coins = (s.coins ?? s0.pos.map(() => 0)).slice();
      s.coins[seat] = (s.coins[seat] ?? 0) + r.coins;
      ev.push({ type: 'coins', seat, delta: r.coins, total: s.coins[seat] });
    }
    return endTurn(s, seat, ev);
  }
  // Ярмарка чудес («Шёл солдат»): берут волшебные предметы, покупают хлеб и огниво, закрывают ярмарку
  if (a?.type === 'market') {
    if (phase !== 'market' || !board.deck || !s0.market || s0.market.seat !== seat) return null;
    if (a.do === 'done') {
      const s: State = { ...s0, pos: s0.pos.slice(), skip: s0.skip.slice(), market: null, phase: 'roll', ...bags(s0, 10) };
      return endTurn(s, seat, [{ type: 'market', seat, do: 'done' }]);
    }
    const card = a.card as CardId;
    const kind = board.deck.cards.find((c) => c.id === card)?.kind;
    const visit = a.do === 'take' ? s0.market.took : s0.market.bought;
    if (!kind || kind === 'coins' || visit >= 2) return null;
    if (!canPack(board, s0, seat, card)) return null;
    const cards = (s0.cards?.[seat] ?? []).slice();
    const stock = { ...(s0.stock ?? {}) };
    if (a.do === 'buy') {
      // покупка простого предмета за золотой: монета уходит в общий запас
      if (kind !== 'simple' || !cards.includes('coins')) return null;
      cards.splice(cards.indexOf('coins'), 1);
      stock['coins'] = (stock['coins'] ?? 0) + 1;
    }
    cards.push(card);
    stock[card] = (stock[card] ?? 1) - 1;
    const s: State = {
      ...s0,
      pos: s0.pos.slice(),
      skip: s0.skip.slice(),
      cards: (s0.cards ?? []).map((c, i) => (i === seat ? cards : c)),
      stock,
      market: { seat, took: s0.market.took + (a.do === 'take' ? 1 : 0), bought: s0.market.bought + (a.do === 'buy' ? 1 : 0) },
    };
    return { state: s, events: [{ type: 'market', seat, do: a.do, card, stock }] };
  }
  // Выбор на клетке-препятствии («Шёл солдат»)
  if (a?.type === 'choose') {
    if (phase !== 'choose' || !board.deck || s0.choose?.seat !== seat) return null;
    const cur = s0.choose;
    const i = Math.max(0, Math.min(cur.options.length - 1, Math.floor(a.pick) || 0));
    const opt = cur.options[i];
    if (!opt || !optionOk(board, s0, seat, opt)) return null;
    const clone = <T,>(list: T[] | undefined, fill: T) => (list ?? s0.pos.map(() => fill)).slice();
    const s: State = { ...s0, pos: s0.pos.slice(), skip: s0.skip.slice(), route: clone(s0.route, null), routeFor: clone(s0.routeFor, null), choose: null, phase: 'roll' };
    s.cards = (s0.cards ?? []).map((c) => (c ? c.slice() : c));
    s.stock = { ...(s0.stock ?? {}) };
    s.flags = (s0.flags ?? []).map((f) => (f ? f.slice() : f));
    const hand = s.cards[seat] ?? [];
    const ev: Event[] = [{ type: 'choose', seat, text: cur.text, option: opt.text, ...(opt.skip ? { skip: opt.skip } : {}), ...(opt.to != null ? { to: opt.to } : {}) }];
    for (const c of opt.pay ?? []) {
      unpack(hand, s.stock!, c);
      ev.push({ type: 'card', seat, card: c, lost: true, left: s.stock![c] });
    }
    s.cards[seat] = hand;
    const missed: string[] = [];
    for (const c of opt.get ?? []) {
      // из общего запаса и только если влезает в котомку; не влезло — игрок должен увидеть почему
      if (!canPack(board, s, seat, c)) {
        const name = board.deck?.cards.find((x) => x.id === c)?.name ?? c;
        missed.push((s.stock?.[c] ?? 0) > 0 ? `«${name}» не влез — котомка полна` : `«${name}» уже разобран — в запасе нет`);
        continue;
      }
      s.stock![c] -= 1;
      hand.push(c);
      ev.push({ type: 'card', seat, card: c, left: s.stock![c] });
    }
    if (opt.flag && !(s.flags[seat] ?? []).includes(opt.flag)) s.flags[seat] = [...(s.flags[seat] ?? []), opt.flag];
    if (opt.unflag) s.flags[seat] = (s.flags[seat] ?? []).filter((f) => f !== opt.unflag);
    if (opt.skip) {
      s.skip[seat] = opt.skip;
      ev.push({ type: 'skip', seat });
    }
    if (opt.route != null) {
      // дорога безномерных клеток: у клетки свой список дорог (обход Огненной реки и т. п.)
      // дорога кончается клеткой ленты — оттуда ход продолжается по номерам (лишние очки не пропадают)
      const road = board.cells[s0.pos[seat]]?.roads?.[opt.route];
      s.route![seat] = road ? road.slice() : null;
      s.routeFor![seat] = road ? true : null;
    }
    if (opt.toCell != null && board.cells[opt.toCell]) {
      // безномерный кружок (вход в круги Лешего): пуговица переходит туда
      s.pos[seat] = opt.toCell;
      s.route![seat] = null;
      s.routeFor![seat] = null;
    }
    if (opt.to != null) {
      // в разметке поля «to» — номер клетки с поля (1…140), а позиция — индекс
      s.pos[seat] = Math.max(0, Math.min(finishOf(board), opt.to - 1));
      s.route![seat] = null;
      s.routeFor![seat] = null;
    }
    if (opt.text2) ev.push({ type: 'sign', seat, sign: { k: 'choice', options: opt.gained && !missed.length ? [{ text: '', gained: true }] : [], text: opt.text2, self: true }, to: s.pos[seat] });
    if (missed.length) ev.push({ type: 'sign', seat, sign: { k: 'choice', options: [], text: `Но ${missed.join(', ')}.`, self: true }, to: s.pos[seat] });
    // безномерные кружки лежат в списке после финиша — победа только на самой клетке финиша
    if (s.pos[seat] === finishOf(board) && !board.winBySign) return winNow(s, ev, seat);
    return endTurn(s, seat, ev, board);
  }
  if (a?.type !== 'move' || phase !== 'move' || !s0.last) return null;
  if (board.race) return moveRace(s0, board, seat);
  const finish = finishOf(board);
  const many = <T,>(list: T[] | undefined, fill: T) => (list ?? s0.pos.map(() => fill)).slice();
  const s: State = {
    ...s0,
    pos: s0.pos.slice(),
    skip: s0.skip.slice(),
    route: many(s0.route, null),
    routeFor: many(s0.routeFor, null),
    maps: many(s0.maps, s0.map),
    ...(board.coins || s0.coins ? { coins: many(s0.coins, 0) } : {}),
    ...(s0.items ? { items: s0.items.slice() } : {}),
    ...(s0.extra ? { extra: s0.extra.slice() } : {}),
    ...(s0.cards ? { cards: s0.cards.map((c) => (c ? c.slice() : c)), stock: { ...(s0.stock ?? {}) }, flags: (s0.flags ?? []).map((f) => (f ? f.slice() : f)) } : {}),
    phase: 'roll',
  };
  const ev: Event[] = [];
  /** Пуговицу перенесло (прыжок, переход, условие, загадка) — остаток дороги-ветки больше не её:
   * иначе после перехода она пойдёт по номерам чужого поля. */
  const dropRoute = () => {
    if (s.route) s.route[seat] = null;
    if (s.routeFor) s.routeFor[seat] = null;
  };
  /** Условие выполнено, а боны по нему отдаются (клубок у Бабы Яги, перелёт на Орле). */
  const payNeed = (g: Sign & { k: 'need' }) => {
    if (!g.pay || !g.coins) return;
    s.coins = many(s.coins, 0);
    s.coins[seat] = Math.max(0, (s.coins[seat] ?? 0) - g.coins);
    ev.push({ type: 'coins', seat, delta: -g.coins, total: s.coins[seat] });
  };
  /** Исход условия: победа, клетка этого поля или переход на другую часть серии. */
  const goNeed = (target: NeedTo) => {
    if (target === 'win') return winNow(s, ev, seat);
    if (typeof target === 'object') {
      const other = boardOf(target.map);
      s.maps = (s.maps ?? s0.pos.map(() => s.map)).slice();
      s.maps[seat] = other.id;
      s.pos[seat] = Math.max(0, Math.min(other.cells.length - 1, target.to));
      dropRoute();
      s.route = s.route ? s.route.map(() => null) : s.route;
      s.routeFor = s.routeFor ? s.routeFor.map(() => null) : s.routeFor;
      ev.push({ type: 'sign', seat, sign: { k: 'field', map: other.id, to: s.pos[seat], text: `переход в «${other.title}»` }, to: s.pos[seat] });
      return endTurn(s, seat, ev);
    }
    s.pos[seat] = Math.max(0, Math.min(board.cells.length - 1, target));
    dropRoute();
    if (s.pos[seat] === finish && !board.winBySign) return winNow(s, ev, seat);
    return endTurn(s, seat, ev);
  };
  // «выход только нужной гранью»: пока не выпадет нужное, пуговица стоит на месте
  const stand = board.cells[s.pos[seat]]?.sign;
  if (stand?.k === 'wait' && (s0.last ?? 0) !== stand.die) {
    ev.push({ type: 'sign', seat, sign: stand, to: s.pos[seat] });
    s.turn = next(s, seat);
    s.map = mapOf(s, s.turn);
    return { state: s, events: ev };
  }
  // Пуговица стоит на последней клетке ленты, а её знак не срабатывал: так бывает, если сюда перенесла
  // загадка или переход (у знака клетки назначения правило не повторяется). Идти дальше некуда — спрашиваем
  // условие, иначе игрок застревает: «Баба Яга» на (13) требует 20 бон, а без них отправляет к Дубу.
  if (stand?.k === 'need' && s.pos[seat] >= finish) {
    const hasItem = stand.item ? (s.items?.[seat] ?? []).includes(stand.item) : true;
    const hasCoins = stand.coins != null ? (s.coins?.[seat] ?? 0) >= stand.coins : true;
    ev.push({ type: 'sign', seat, sign: stand, to: s.pos[seat], ...(board.cells[s.pos[seat]].text ? { text: board.cells[s.pos[seat]].text } : {}) });
    if (hasItem && hasCoins) payNeed(stand);
    return goNeed(hasItem && hasCoins ? stand.yes : stand.no);
  }
  // клетка «выход только нужной гранью — и сразу на клетку»: не та грань — стоит, та — переносит (знак там срабатывает)
  const hold = board.cells[s.pos[seat]]?.hold;
  if (hold && !hold.free && (s0.last ?? 0) !== hold.die) {
    ev.push({ type: 'sign', seat, sign: { k: 'wait', die: hold.die, text: 'ждёт нужной грани' }, to: s.pos[seat] });
    s.turn = next(s, seat);
    s.map = mapOf(s, s.turn);
    return { state: s, events: ev };
  }
  const holdWalk = hold?.to != null && (s0.last ?? 0) === hold.die ? { path: [hold.to], route: null, routeFor: false, forks: [] } : null;
  const walk = holdWalk ?? loopMove(s0, board, seat, s0.last) ?? walkFor(s0, board, seat);
  const path = walk.path;
  // знаки срабатывают на делениях ленты; на клетке, куда вернулась ветка, — уже нет.
  // На клетках дорог («В путь, друзья!») знаки работают и по ветке: зелёный кружок — ещё бросок, оранжевый — пропуск хода.
  const onRoute = !!s0.route?.[seat]?.length || walk.forks.length > 0;
  const to = path.length ? path[path.length - 1] : s.pos[seat];
  s.route![seat] = walk.route;
  s.routeFor![seat] = walk.routeFor ? true : null;
  s.pos[seat] = to;
  ev.push({ type: 'move', seat, path });
  const win = () => {
    s.winner = seat;
    ev.push({ type: 'win', seat });
    return { state: s, events: ev };
  };
  // развилки, пройденные по дороге: пишем в журнал, какой путь выбрала разница очков
  for (const f of walk.forks) {
    const g = board.cells[f.cell].sign as Sign & { k: 'fork' };
    const road = g.roads?.[f.branch];
    ev.push({
      type: 'sign',
      seat,
      sign: g,
      to: f.cell,
      text: `${g.text}${road ? ` (разница ${f.diff} — ${road})` : ` (разница ${f.diff})`}`,
    });
    // лабиринт «Лукоморья-4»: каждый переход с кружка на кружок даёт (или отнимает) боны
    if (g.step && g.coins && g.branches[f.branch]?.length) {
      s.coins = many(s.coins, 0);
      s.coins[seat] = Math.max(0, (s.coins[seat] ?? 0) + g.coins);
      ev.push({ type: 'coins', seat, delta: g.coins, total: s.coins[seat] });
    }
  }
  if (to === finish && !board.winBySign) return win();
  // Ярмарка чудес («Шёл солдат»): встал — торгуешься, ход не переходит, пока не закроешь ярмарку
  if (board.deck && marketIdx(board).includes(to)) {
    // на 48 расстаются с Конём-огнём, на 88 — с волшебным клубком (карточки уходят в общий запас)
    for (const c of board.deck.keep?.[to + 1] ?? []) {
      const hand = s.cards?.[seat] ?? [];
      if (!hand.includes(c)) continue;
      unpack(hand, s.stock!, c);
      ev.push({ type: 'card', seat, card: c, lost: true, left: s.stock![c] });
    }
    // а с ним и прибавка к броску: Конь-огонь остался на ярмарке
    const drop = board.deck.dropFlags?.[to + 1] ?? [];
    if (drop.length && s.flags) s.flags[seat] = (s.flags[seat] ?? []).filter((f) => !drop.includes(f));
    s.market = { seat, took: 0, bought: 0 };
    s.phase = 'market';
    const g = board.cells[to].sign;
    if (g) ev.push({ type: 'sign', seat, sign: g, to });
    return { state: s, events: ev };
  }
  // Препятствие («Шёл солдат»): чем пройти — выбирает игрок (в списке видно, чем мог бы пройти)
  if (board.deck) {
    const g = board.cells[to].sign;
    // «поле 48» в разметке — это индекс 47: сдаём Коня-огонь и клубок на ярмарках
    const keep = board.deck.keep?.[to + 1];
    if (keep?.length) {      for (const c of keep) {
        const hand = s.cards?.[seat] ?? [];
        if (hand.includes(c)) {
          unpack(hand, s.stock!, c);
          ev.push({ type: 'card', seat, card: c, lost: true, left: s.stock![c] });
        }
      }
    }
    // Конь-огонь: берег Огненной реки перескакивает с ходу (по правилам останавливаться не обязательно)
    if (g?.k === 'choice' && (s.flags?.[seat] ?? []).includes('конь') && g.options.some((o) => o.needHorse)) {
      s.pos[seat] = to + 1;
      ev.push({ type: 'sign', seat, sign: g, to: s.pos[seat], text: 'Конь-огонь перенёс через Огненную реку.' });
      return endTurn(s, seat, ev, board);
    }
    // круги (Пастух): встал на клетку-вход — пуговица уходит на первый кружок и кружит, пока не выйдет броском
    if (g?.k === 'loop') {
      const first = g.cells[0] ?? to;
      s.pos[seat] = first;
      s.route![seat] = null;
      s.routeFor![seat] = null;
      ev.push({ type: 'sign', seat, sign: g, to: first });
      return endTurn(s, seat, ev, board);
    }
    if (g?.k === 'choice') {
      s.pos[seat] = to;
      s.choose = { seat, title: g.title, text: g.text, options: g.options };
      s.phase = 'choose';
      ev.push({ type: 'sign', seat, sign: { ...g, text: 'решает, как быть' }, to, text: g.title ? `${g.title}. ${g.text}` : g.text });
      return { state: s, events: ev };
    }
  }
  let again = false;
  // знак срабатывает на клетке, куда пуговица встала. Исключение — клетка, куда вернулась ветка-тупик
  // («туда и обратно»): там знак не повторяется. Дорога развилки — не тупик, её номерные пункты
  // (клады, выход из болота) работают как обычно, поэтому у развилок знаки не гасим.
  const viaFork = (s0.routeFor?.[seat] ?? false) || walk.forks.length > 0;
  const sign = onRoute && !viaFork && !board.cells[to].off ? null : board.cells[to].sign;
  if (sign) {
    let dest = to;
    /** Сколько бон даёт знак: число или сумму бросков («кубик можно бросать три раза»). */
    const diceSum = (times: number) => {
      let sum = 0;
      for (let i = 0; i < Math.max(1, times); i++) sum += rng.int(6) + 1;
      return sum;
    };
    if (sign.k === 'skip') s.skip[seat] = sign.n ?? 1;
    else if (sign.k === 'again') again = true;
    else if (sign.k === 'start') dest = 0;
    else if (sign.k === 'route') s.route![seat] = sign.cells.slice();
    else if (sign.k === 'coins') {
      // «разница» (Лукоморье): не число, а остаток очков — сколько не истрачено, пока пуговица дошла до пункта
      const n = sign.diff ? Math.max(0, (s0.last ?? 0) - path.length) : (sign.n ?? diceSum(sign.dice ?? 1));
      const delta = sign.loss ? -n : n;
      s.coins = many(s.coins, 0);
      s.coins[seat] = Math.max(0, (s.coins[seat] ?? 0) + delta);
      if (sign.skip) s.skip[seat] = sign.skip;
      ev.push({ type: 'coins', seat, delta, total: s.coins[seat] });
      if (sign.to != null) dest = Math.max(0, Math.min(board.cells.length - 1, sign.to));
    } else if (sign.k === 'field') {
      // серия «Лукоморья»: часть 1–4 — разные поля одной карточки, переход переносит пуговицу на другое поле
      const other = boardOf(sign.map);
      const fromText = board.cells[to].text;
      s.maps = (s.maps ?? s0.pos.map(() => s.map)).slice();
      s.maps[seat] = other.id;
      if (s.route) s.route[seat] = null;
      if (s.routeFor) s.routeFor[seat] = null;
      dest = Math.max(0, Math.min(other.cells.length - 1, sign.to));
      ev.push({ type: 'sign', seat, sign, to: dest, ...(fromText ? { text: fromText } : {}) });
      s.pos[seat] = dest;
      return { state: s, events: ev };
    } else if (sign.k === 'item') {
      s.items = many(s.items, null);
      s.items[seat] = [...(s.items[seat] ?? []), sign.item];
      ev.push({ type: 'item', seat, item: sign.item });
      if (sign.to != null) dest = Math.max(0, Math.min(board.cells.length - 1, sign.to));
    } else if (sign.k === 'takeItem') {
      s.items = many(s.items, null);
      s.items[seat] = (s.items[seat] ?? []).filter((x) => x !== sign.item);
      ev.push({ type: 'item', seat, item: sign.item, lost: true });
    } else if (sign.k === 'wait') {
      // на эту клетку пуговица встала — дальше её держит бросок (проверяется в начале хода)
      dest = to;
    } else if (sign.k === 'riddle') {
      // загадка остальным: игрок загадывает, остальные отвечают, он судит; никто не отгадал — награда
      s.riddle = {
        by: seat,
        text: '',
        answer: null,
        solved: [],
        replies: [],
        waiting: s.seats.filter((x) => x !== seat),
        extra: sign.extra,
        coins: sign.coins,
      };
      ev.push({ type: 'sign', seat, sign, to, ...(board.cells[to].text ? { text: board.cells[to].text } : {}) });
      s.pos[seat] = to;
      s.phase = 'ask';
      return { state: s, events: ev };
    } else if (sign.k === 'extra') {
      const n = sign.n ?? diceSum(sign.dice ?? 1);
      s.extra = many(s.extra, 0);
      s.extra[seat] = (s.extra[seat] ?? 0) + n;
      ev.push({ type: 'extra', seat, n });
    } else if (sign.k === 'need') {
      const hasItem = sign.item ? (s.items?.[seat] ?? []).includes(sign.item) : true;
      const hasCoins = sign.coins != null ? (s.coins?.[seat] ?? 0) >= sign.coins : true;
      ev.push({ type: 'sign', seat, sign, to, ...(board.cells[to].text ? { text: board.cells[to].text } : {}) });
      if (hasItem && hasCoins) payNeed(sign);
      return goNeed(hasItem && hasCoins ? sign.yes : sign.no);
    } else if (sign.k === 'pick') {
      // загадка: ход прерывается, пока игрок не назовёт ответ
      ev.push({ type: 'sign', seat, sign, to, ...(board.cells[to].text ? { text: board.cells[to].text } : {}) });
      s.pos[seat] = to;
      s.phase = 'pick';
      return { state: s, events: ev };
    } else if (sign.k === 'fork') {
      // дорога выбирается по остатку очков: сразу, если они ещё есть, иначе — на следующем ходу
      dest = to;
      // кружок облачной лотереи с предметом (ключ, игла): встал — берёшь
      if (sign.item && !(s.items?.[seat] ?? []).includes(sign.item)) {
        s.items = many(s.items, null);
        s.items[seat] = [...(s.items[seat] ?? []), sign.item];
        ev.push({ type: 'item', seat, item: sign.item });
      }
    } else if (sign.k === 'jump') {
      dest = Math.max(0, Math.min(board.cells.length - 1, sign.to));
      if (sign.skip) s.skip[seat] = sign.skip;
    } else {
      // прочие знаки (ярмарка, петля, боны, предмет, условие) клетку не переносят:
      // фишка остаётся там, куда пришла, а сам знак разбирается выше
      dest = to;
    }
    ev.push({ type: 'sign', seat, sign, to: dest, ...(board.cells[to].text ? { text: board.cells[to].text } : {}) });
    s.pos[seat] = dest;
    if (dest !== to) dropRoute();
    if (dest === finish && !board.winBySign) return win();
  }
  if (!again && s.extra?.[seat]) {
    // накопленные дополнительные ходы: игрок бросает ещё раз, ход остаётся у него
    s.extra[seat] = (s.extra[seat] ?? 0) - 1;
    return { state: s, events: ev };
  }
  if (!again) {
    // следующий, кто не пропускает
    let t = next(s, seat);
    for (let i = 0; i < 4 * s.seats.length && skipsOf(s, t) > 0; i++) {
      s.skip[t] = skipsOf(s, t) - 1;
      ev.push({ type: 'skip', seat: t });
      t = next(s, t);
    }
    s.turn = t;
    s.map = mapOf(s, t);
  }
  return { state: s, events: ev };
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

/** Запас карточек на партию: по числу игроков (2, 3, 4 и больше). */
function stockFor(b: Board, n: number): Record<string, number> {
  const deck = b.deck!;
  const i = Math.max(0, Math.min(deck.counts.length - 1, n - 2));
  const stock: Record<string, number> = {};
  for (const [card, counts] of Object.entries(deck.stock)) stock[card] = counts[i] ?? counts[counts.length - 1];
  return stock;
}

/** Поля для настройки: у серии («Лукоморье», 4 части) в списке стоит только первая часть —
 * партия всё равно идёт по всем частям, а с какой начать, решает настройка «Начать с части». */
export const PICK_BOARDS = BOARDS.filter((b) => !b.series || b.series.part === 1);
export const boardLabel = (b: Board) => b.series?.label ?? b.title;

/** Части серии по её id («luk»): [часть 1, часть 2, …]. */
export const seriesParts = (id: string) => BOARDS.filter((b) => b.series?.id === id).sort((a, b) => a.series!.part - b.series!.part);

/** С какого поля начинать партию: у серии — выбранная часть («начать с части»). */
export function startBoard(opts: { [k: string]: unknown }): Board {
  const first = boardOf(String(opts.map ?? BOARDS[0].id));
  const id = first.series?.id;
  if (!id) return first;
  // в списке полей у серии стоит только первая часть; если же выбрана конкретная часть — начинаем с неё
  if (first.series!.part !== 1) return first;
  const parts = seriesParts(id);
  const n = Math.max(1, Math.min(parts.length, Number(opts.lukStart ?? 1) || 1));
  return parts[n - 1] ?? first;
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'hodilki',
  title: 'Кинь-двинь',
  players: { min: 2, max: 10, default: 3 },
  teams: (o, seats) => (boardOf(String(o.map ?? BOARDS[0].id)).race && seats.length >= 4 ? alternate(seats) : null),
  /** «Шайба» — игра на двоих или командами: 2 (дуэль), 4 (2 на 2) или 6 (3 на 3); остальные поля — 2–10. */
  countsFor: (opts) => {
    if (boardOf(String(opts.map ?? BOARDS[0].id)).race) return [2, 4, 6];
    const out: number[] = [];
    for (let n = 2; n <= 10; n++) out.push(n);
    return out;
  },
  countsHint: (opts) => (boardOf(String(opts.map ?? BOARDS[0].id)).race ? 'вдвоём или командами: 2 на 2 или 3 на 3, у команды одна шайба' : undefined),
  seats: SEATS,
  options: [
    { key: 'map', label: 'Поле', type: 'select', choices: PICK_BOARDS.map((b) => ({ value: b.id, label: boardLabel(b) })), default: BOARDS[0].id },
    // Серия «Лукоморье»: одна игра, но начинать можно с любой части — дальше партия идёт по всем частям до конца.
    {
      key: 'lukStart',
      label: 'Начать с части',
      hint: '«Лукоморье» — серия из четырёх частей: можно начать с любой, а игра всё равно пойдёт до замка Кощея.',
      type: 'select',
      choices: [1, 2, 3, 4].map((n) => ({ value: String(n), label: `часть ${n}` })),
      default: '1',
      showIf: (opts) => !!boardOf(String(opts.map ?? BOARDS[0].id)).series,
    },
    // Настройка только для «Шайбы»: у остальных полей финиш, а не счёт по голам.
    {
      key: 'goals',
      label: 'Голов до победы',
      hint: 'Только для «Шайбы»: партия идёт до этого числа заброшенных шайб.',
      type: 'select',
      choices: [1, 3, 5, 7].map((n) => ({ value: String(n), label: n === 1 ? 'один гол' : `до ${n} голов` })),
      default: '3',
      showIf: (opts) => !!boardOf(String(opts.map ?? BOARDS[0].id)).race,
    },
  ],
  presets: PICK_BOARDS.map((b) => ({ id: b.series?.id ?? b.id, label: boardLabel(b), options: { map: b.id } })),
  setup: (seats, opts, rng) => {
    const ids = seats.map((x) => x.seat).sort((a, b) => a - b);
    const board = startBoard(opts);
    const race = board.race;
    // «Лукоморье»: перед игрой каждый берёт из банка бон по сумме трёх бросков, первым ходит богатейший
    const coins = Array(10).fill(0);
    if (board.startCoins) {
      for (const s of ids) {
        let sum = 0;
        for (let i = 0; i < board.startCoins; i++) sum += rng.int(6) + 1;
        coins[s] = sum;
      }
    }
    const first = board.startCoins ? ids.reduce((best, s) => (coins[s] > coins[best] ? s : best), ids[0]) : ids[0];
    // «Шёл солдат»: общий запас карточек, ярмарки и котомка у каждого
    const stock = board.deck ? stockFor(board, ids.length) : null;
    const cards: (CardId[] | null)[] = Array(10).fill(null);
    if (board.deck) {
      for (const s of ids) {
        const hand: CardId[] = [];
        for (const st of board.deck.startCards) for (let i = 0; i < (st.n ?? 1); i++) hand.push(st.card);
        cards[s] = hand;
      }
    }
    return {
      map: board.id,
      maps: Array(10).fill(board.id),
      seats: ids,
      pos: Array(10).fill(0),
      skip: Array(10).fill(0),
      route: Array(10).fill(null),
      turn: first,
      phase: 'roll',
      last: null,
      winner: null,
      ...(race ? { goals: race.tracks.map(() => 0), target: Math.max(1, Number(opts.goals ?? race.target) || race.target), kind: null, card: null, cardSlot: null } : {}),
      // «Лукоморье»: боны, предметы и дополнительные ходы
      ...(board.coins ? { coins, items: Array(10).fill(null), extra: Array(10).fill(0) } : {}),
      // «Шёл солдат»: карточки в руке, общий запас, флаги и выбор на клетке
      ...(board.deck && stock ? { cards, stock, flags: Array(10).fill(null), market: null, choose: null } : {}),
    };
  },
  showcase: () => ({ map: 'krugosvet', seats: [0, 1, 2, 3], pos: [4, 36, 45, 104, 0, 0, 0, 0, 0, 0], skip: Array(10).fill(false), turn: 1, phase: 'roll', last: 4, winner: null }),
  toAct: (s) => (s.winner != null ? [] : [s.turn]),
  apply,
  // ответ на загадку видит только загадавший: остальным он не нужен и не должен попадаться на глаза
  view: (s, seats) => {
    const r = s.riddle;
    if (!r?.answer) return s;
    const mine = seats === 'all' ? null : seats;
    if (!mine || mine.includes(r.by)) return s;
    return { ...s, riddle: { ...r, answer: null } };
  },
  result: (s) => {
    if (s.winner == null) return null;
    const b = boardOf(mapOf(s, s.winner));
    if (b.race) {
      const track = trackOf(b, s.winner);
      return {
        winners: s.seats.filter((x) => trackOf(b, x) === track),
        text: `${b.winText} — ${scoreText(s, b)}`,
        scores: Object.fromEntries((s.goals ?? []).map((g, i) => [i, g])),
      };
    }
    return { winners: [s.winner], text: b.winText };
  },
  bot: {
    levels: ['Лёгкий', 'Средний', 'Сложный'],
    choose: (v, seat, level, rng) => {
      const phase = v.phase ?? 'roll';
      // загадка остальным: загадываем по своей сложности — лёгкий спрашивает простое, сложный трудное
      if (phase === 'ask') {
        const r = randomRiddle(diffForLevel(level), rng);
        return { type: 'ask', text: r.q, answer: r.a };
      }
      // отвечаем со своей удачей: лёгкий 30 %, средний 60 %, сложный 80 %
      if (phase === 'answer') {
        const chance = ANSWER_CHANCE[Math.max(0, Math.min(2, Math.round(level) || 0))];
        return { type: 'answer', correct: rng.int(100) < chance };
      }
      // загадавший-бот: отгадали — значит, награды нет
      if (phase === 'judge') return { type: 'judge', ok: (v.riddle?.solved.length ?? 0) > 0 };
      // загадка: бот называет ответ по кругу (правильного варианта в правилах нет — выбирает игрок)
      if (phase === 'pick') {
        const g = boardOf(mapOf(v, v.turn)).cells[v.pos[v.turn]]?.sign;
        const n = g?.k === 'pick' ? g.options.length : 1;
        return { type: 'pick', pick: v.pos[v.turn] % Math.max(1, n) };
      }
      // «Шёл солдат»: ярмарка — берём нужное из запаса, потом закрываем
      if (phase === 'market') {
        const b = boardOf(mapOf(v, seat));
        const hand = v.cards?.[seat] ?? [];
        const market = v.market;
        if (market && market.took < 2) {
          // чего не хватает: сначала «лекарство от нечисти», потом хлеб, огниво, монеты
          const want: CardId[] = ['sword', 'cross', 'cap', 'towel', 'ball', 'bread', 'flint'];
          for (const c of want) {
            if (hand.includes(c)) continue;
            if (!canPack(b, v, seat, c)) continue;
            if ((v.stock?.[c] ?? 0) <= 0) continue;
            return { type: 'market', do: 'take', card: c };
          }
        }
        if (market && market.bought < 2 && !hand.includes('bread') && hand.includes('coins') && (v.stock?.['bread'] ?? 0) > 0) {
          return { type: 'market', do: 'buy', card: 'bread' };
        }
        return { type: 'market', do: 'done' };
      }
      // «Шёл солдат»: выбор на препятствии — берём первый доступный вариант
      if (phase === 'choose') {
        const cur = v.choose;
        const i = (cur?.options ?? []).findIndex((o) => optionOk(boardOf(mapOf(v, seat)), v, seat, o));
        return { type: 'choose', pick: i < 0 ? 0 : i };
      }
      return { type: phase === 'roll' ? 'roll' : 'move' };
    },
  },
  describe(ev, name) {
    switch (ev.type) {
      case 'roll':
        if (ev.kind === 'red') return `${name(ev.seat)} бросает: 🔴 красная клюшка, квадратик на <b>${ev.card}</b> — шайба назад.`;
        if (ev.kind === 'green') return `${name(ev.seat)} бросает: 🟢 зелёная клюшка, квадратик на <b>${ev.card}</b> — шайба вперёд.`;
        return `${name(ev.seat)} бросает: <b>${ev.die}</b>`;
      case 'sign':
        // итог выбора на препятствии («Шёл солдат») — готовая фраза, без имени впереди
        if (ev.sign.k === 'choice' && ev.sign.self && !ev.text) return `<i>${esc(ev.sign.text)}</i>`;
        return `${ev.text ? `<i>${esc(ev.text)}</i> ` : ''}${name(ev.seat)} ${signText(ev.sign)}.`;
      case 'skip':
        return `${name(ev.seat)} пропускает ход.`;
      case 'coins':
        return ev.delta >= 0
          ? `💰 ${name(ev.seat)} берёт <b>${ev.delta}</b> бон (всего ${ev.total}).`
          : `💸 ${name(ev.seat)} отдаёт <b>${-ev.delta}</b> бон (осталось ${ev.total}).`;
      case 'item':
        return ev.lost
          ? `😱 ${name(ev.seat)} теряет <b>${itemName(ev.item)}</b>.`
          : `🎁 ${name(ev.seat)} берёт <b>${itemName(ev.item)}</b>.`;
      case 'extra':
        return `⏩ ${name(ev.seat)} получает <b>${ev.n}</b> дополнительных хода.`;
      case 'card': {
        const d = BOARDS.map((b) => b.deck).find(Boolean);
        const nm = d?.cards.find((c) => c.id === ev.card)?.name ?? ev.card;
        return ev.lost
          ? `🎴 ${name(ev.seat)} отдаёт <b>${esc(nm)}</b>${ev.left != null ? ` (в запасе ${ev.left})` : ''}.`
          : `🎴 ${name(ev.seat)} берёт <b>${esc(nm)}</b>${ev.left != null ? ` (в запасе ${ev.left})` : ''}.`;
      }
      case 'market': {
        if (ev.do === 'done') return `🛖 ${name(ev.seat)} уходит с ярмарки.`;
        const d = BOARDS.map((b) => b.deck).find(Boolean);
        const nm = d?.cards.find((c) => c.id === ev.card)?.name ?? ev.card;
        return ev.do === 'buy'
          ? `🛖 ${name(ev.seat)} покупает <b>${esc(nm)}</b> за золотой.`
          : `🛖 ${name(ev.seat)} берёт на ярмарке <b>${esc(nm)}</b>${ev.stock?.[ev.card!] != null ? ` (осталось ${ev.stock[ev.card!]})` : ''}.`;
      }
      case 'choose':
        return `🎭 ${name(ev.seat)}: ${esc(ev.option)}.${ev.skip ? ` Пропуск ${ev.skip} ${ev.skip === 1 ? 'хода' : 'ходов'}.` : ''}`;
      case 'goal':
        return `🥅 ${name(ev.seat)} забивает ${ev.goals}-ю шайбу (до ${ev.target}).`;
      case 'ask':
        return `🧩 ${name(ev.seat)} загадывает загадку: «${esc(ev.text)}»`;
      case 'answer':
        return ev.solved
          ? `✅ ${name(ev.seat)} отгадывает загадку!`
          : ev.text
            ? `❔ ${name(ev.seat)} отвечает «${esc(ev.text)}» — не то.`
            : `🤔 ${name(ev.seat)} не знает ответа.`;
      case 'riddle':
        if (ev.solved) return `🧩 Загадку отгадали — ${name(ev.seat)} остаётся ни с чем.`;
        return `🧩 Загадку никто не отгадал: ${name(ev.seat)} получает${ev.extra ? ` ${ev.extra} лишних хода` : ''}${ev.extra && ev.coins ? ' и' : ''}${ev.coins ? ` ${ev.coins} бон` : ''}!`;
      case 'reward':
        return `⏩ ${name(ev.seat)} получает ${ev.extra} лишних хода за неотгаданную загадку.`;
      case 'win':
        return `🏁 ${name(ev.seat)} — победа!`;
    }
    return null;
  },
  rules: {
    goal: 'Бросать кубик, шагать пуговицей по полю и первым дойти до финиша. Знаки на поле ускоряют или откидывают назад.',
    sections: BOARDS.map((b) => ({
      title: b.title,
      html: `<p><i>${b.goal}</i></p>${b.rules}${b.credit ? `<p><small>${b.credit}</small></p>` : ''}`,
      demo: b.demo ? { seats: demoSeats, options: { map: b.id }, steps: b.demo.flatMap((d, i) => {
            const seat = d.seat ?? i % 2;
            // не бросок, а действие на ярмарке или выбор на препятствии
            if (d.act) return [{ seat, action: d.act, caption: d.caption }];
            return [
              { seat, action: { type: 'roll' } as Action, rig: Array.isArray(d.rig) ? d.rig : [d.rig ?? 0], caption: `${SEATS[seat].name} бросает кубик…` },
              { seat, action: { type: 'move' } as Action, caption: d.caption },
            ];
          }) } : undefined,
    })),
  },
};
