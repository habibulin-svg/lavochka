/* Покер — обстановка словами для Димона (помощник на ИИ, server/dimon.ts). Без DOM.
 * Модель карты не считает и не читает коды карт: здесь всё расписано словами («туз пик»), а цифры — из расчётов
 * тренажёра (calc.ts: сила руки, шансы и ауты, шансы банка, M, Нэш, ICM, «лучший ход»; stats/hud.ts — HUD).
 * Источник — только свой вид: makeView / recFor для своего места. Чужих закрытых карт здесь нет — на всякий случай
 * история ещё раз пропускается через recFor (тест tests/dimon.test.ts гоняет партии ботов и это проверяет). */
import type { Card, Suit } from '../../cards/deck';
import { SeededRng } from '../../core/rng';
import { choose, handEquity } from './ai';
import { bestMove, tipsFor, TIP_KEYS } from './calc';
import { contenders, GAMES, potSize, recFor, toCall, type HandRecord, type View } from './engine';
import { statN, STATS, statVal, styleGuess, summaryOf, tourSummary, type HudData } from './hud';
import { frames, streetName } from './replay';
import { positions, type Counts } from './stats';
import { FMTS, type TourFmt } from './tour';

const RANK: Record<number, string> = { 2: 'двойка', 3: 'тройка', 4: 'четвёрка', 5: 'пятёрка', 6: 'шестёрка', 7: 'семёрка', 8: 'восьмёрка', 9: 'девятка', 10: 'десятка', 11: 'валет', 12: 'дама', 13: 'король', 14: 'туз' };
const SUIT: Record<Suit, string> = { S: 'пик', C: 'треф', D: 'бубен', H: 'червей' };
const STRUCT = { limit: 'лимит', pot: 'пот-лимит', nl: 'безлимит' } as const;

/** Карта словами: «туз пик». */
export const cardWord = (c: Card) => `${RANK[c.r] ?? c.r} ${SUIT[c.s]}`;
export const cardsWords = (cs: (Card | null | undefined)[]) => cs.map((c) => (c ? cardWord(c) : 'закрытая')).join(', ');

const SYM_SUIT: Record<string, Suit> = { '♠': 'S', '♣': 'C', '♦': 'D', '♥': 'H' };
const SYM_RANK: Record<string, number> = { Т: 14, К: 13, Д: 12, В: 11 };
/** Текст тренажёра (HTML, карты значками «Т♠») — в простой текст со словами. */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/(10|[2-9]|[ТКДВ])([♠♣♦♥])/g, (_, r: string, s: string) => cardWord({ r: SYM_RANK[r] ?? Number(r), s: SYM_SUIT[s] }))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const bb = (x: number, big: number) => `${(x / big).toFixed(x / big < 10 ? 1 : 0)} ББ`;
const pct = (x: number) => `${Math.round(x)}%`;

/** Позиция места словами (по истории раздачи). */
export function positionName(r: HandRecord, seat: number): string {
  const p = positions(r);
  if (GAMES[r.game].family === 'stud') return '';
  if (seat === p.button) return p.ring.length === 2 ? 'баттон (он же малый блайнд)' : 'баттон';
  if (seat === p.sb) return 'малый блайнд';
  if (seat === p.bb) return 'большой блайнд';
  if (seat === p.co) return 'катофф (перед баттоном)';
  // от большого блайнда по кругу: первая половина оставшихся — ранняя позиция, дальше — средняя
  const order: number[] = [];
  for (let x = p.next(p.bb); x !== p.co && x !== p.button && order.length < 9; x = p.next(x)) order.push(x);
  const i = order.indexOf(seat);
  return i < 0 ? '' : i < Math.ceil(order.length / 2) ? 'ранняя позиция' : 'средняя позиция';
}

/** HUD соперника одной строкой. */
function hudLine(c: Counts): string {
  const s = summaryOf(c);
  if (!s.hands) return 'статистики нет';
  const g = styleGuess(s);
  const main = (['vpip', 'pfr', 'threeBet', 'af', 'cbet', 'foldCbet', 'wtsd'] as const).map((k) => {
    const st = STATS.find((x) => x.key === k)!;
    const v = statVal(s, k);
    return `${st.short} ${v}${k === 'af' || v === '—' ? '' : '%'}`;
  });
  return `${s.hands} раздач${s.hands < 30 ? ' (мало — цифры ненадёжные)' : ''}: ${main.join(', ')}${g ? `; по цифрам похож на: ${g}` : ''}`;
}

const MAX = 5800;
const fit = (lines: string[]) => {
  const t = lines.filter(Boolean).join('\n');
  return t.length > MAX ? t.slice(0, MAX) + '…' : t;
};

export interface TableOpts {
  /** Имя места (чистый текст). */
  name: (seat: number) => string;
  /** Шансы на банк (розыгрышем); undefined — посчитать здесь, null — не считать. */
  eq?: number | null;
  /** HUD соперников по имени (loadHud().bots). */
  bots?: Record<string, Counts>;
}

/** «Что тут делать?» — стол глазами места me: свои карты, доска, ставки, ходы раздачи, подсказки тренажёра, HUD. */
export function tableFacts(v: View, me: number, o: TableOpts): string {
  const g = GAMES[v.game];
  const name = (p: number) => (p === me ? 'ты' : o.name(p));
  const L: string[] = [];
  L.push(`Игра: ${g.name}${v.hilo ? ' хай-лоу' : ''}, ${STRUCT[v.struct]}; ${g.family === 'stud' ? `анте ${v.rec?.ante ?? 0}` : `блайнды ${v.small}/${v.big}${v.rec?.ante ? `, анте ${v.rec.ante}` : ''}`}; раздача ${v.hand}.`);
  const T = v.tour;
  if (T) {
    const alive = T.players.filter((p) => p.joined && !p.out);
    const paid = T.prizes.filter((x) => x > 0).length;
    const stacks = alive.map((p) => p.chips).sort((a, b) => b - a);
    const mine = T.players.find((p) => p.human);
    const place = mine ? stacks.indexOf(mine.chips) + 1 : 0;
    L.push(`Турнир: ${FMTS[T.fmt as TourFmt]?.label ?? T.fmt}, осталось ${alive.length} из ${T.players.filter((p) => p.joined).length}, платят ${paid} мест${alive.length === paid + 1 ? ' — ПУЗЫРЬ: следующий вылетевший уходит без приза' : alive.length <= paid ? ' — все оставшиеся уже в призах' : ''}${place ? `; по фишкам ты ${place}-й` : ''}.`);
  }
  const street = v.rec ? streetName(v.rec, v.street) : '';
  if (street) L.push(`Улица: ${street.toLowerCase()}.`);
  const hole = v.hole[me] ?? [];
  const up = v.up[me] ?? [];
  L.push(`Твои карты: ${hole.map((c, i) => (c ? cardWord(c) + (g.family === 'stud' ? (up[i] ? ' (открыта)' : ' (закрыта)') : '') : 'закрытая')).join(', ') || 'нет'}.`);
  if (g.family === 'flop') L.push(`Доска: ${v.board.length ? cardsWords(v.board) : 'пока пусто'}.`);
  if (v.rec) {
    const pos = positionName(v.rec, me);
    if (pos) L.push(`Твоя позиция: ${pos}.`);
  }
  L.push(`Банк: ${potSize(v)}; тебе доставить до колла: ${toCall(v, me)}; твой стек: ${v.chips[me]} (${bb(v.chips[me], v.big)}).`);
  // соперники — только видимое всем: стек, ставка, пас/ва-банк, открытые и вскрытые карты, сколько менял
  const opp: string[] = [];
  for (const p of v.seats) {
    if (p === me) continue;
    const inHand = v.inHand.includes(p);
    if (!inHand && !v.chips[p]) continue; // выбыл
    const st = !inHand ? 'не в раздаче' : v.folded[p] ? 'спасовал' : v.allin[p] ? 'ва-банк' : 'в игре';
    let seen = '';
    if (v.shown[p]) seen = `, вскрыл: ${cardsWords(v.shown[p])}`;
    else if (g.family === 'stud') {
      const ups = (v.hole[p] ?? []).filter((c, i) => c && v.up[p]?.[i]);
      if (ups.length) seen = `, открытые карты: ${cardsWords(ups)}`;
    }
    const drew = g.family === 'draw' && v.street > 0 && inHand ? `, менял карт: ${v.drawn[p] ?? 0}` : '';
    const pos = v.rec && inHand ? positionName(v.rec, p) : '';
    opp.push(`- ${o.name(p)}${pos ? ` (${pos})` : ''}: ${st}, стек ${v.chips[p]} (${bb(v.chips[p], v.big)}), ставка на этой улице ${v.bet[p]}${seen}${drew}`);
  }
  if (opp.length) L.push('Соперники:', ...opp);
  if (v.rec) {
    const fr = frames(v.rec, name).slice(1).filter((f) => f.i !== -1 || v.rec!.winners.length);
    if (fr.length) L.push('Ходы этой раздачи:', ...fr.map((f) => '- ' + plainText(f.text)));
  }
  L.push(v.turn === me && !v.over && !v.between ? (v.phase === 'draw' ? 'Сейчас твой ход — обмен.' : v.phase === 'discard' ? 'Сейчас ты сбрасываешь одну карту.' : 'Сейчас твой ход.') : `Сейчас ходит: ${v.over || v.between ? 'никто — раздача сыграна' : name(v.turn)}.`);
  // расчёты тренажёра
  let eq = o.eq;
  if (eq === undefined && v.inHand.includes(me) && !v.folded[me] && hole.every(Boolean)) {
    try {
      eq = handEquity(v, me, 400, new SeededRng(v.hand * 31 + v.street));
    } catch {
      eq = null;
    }
  }
  const tips = tipsFor(v, me, eq ?? null, (p) => name(p));
  const calc = TIP_KEYS.filter((k) => tips[k.key]).map((k) => `- ${k.label}: ${plainText(tips[k.key]!)}`);
  if (calc.length) L.push('Посчитала программа:', ...calc);
  if (v.turn === me && !v.over && !v.between && v.phase === 'bet') {
    const a = choose(v, me, 2, new SeededRng(v.hand * 7 + v.street));
    if (a) L.push(`Как сыграл бы на твоём месте сильный бот программы (регуляр, TAG): ${actWords(a, v, me)}.`);
  }
  // HUD тех, кто ещё в раздаче
  if (o.bots) {
    const hud = contenders(v)
      .filter((p) => p !== me)
      .map((p) => `- ${o.name(p)}: ${hudLine(o.bots![o.name(p)] ?? ({} as Counts))}`);
    if (hud.length) L.push('HUD соперников в раздаче (VPIP, PFR, 3-бет, AF, C-бет, фолд на C-бет, WTSD):', ...hud);
  }
  return fit(L);
}

function actWords(a: ReturnType<typeof choose> & object, v: View, me: number): string {
  switch (a.type) {
    case 'fold':
      return 'пас';
    case 'check':
      return 'чек';
    case 'call':
      return `колл ${toCall(v, me)}`;
    case 'raise':
      return `${v.current > 0 ? 'рейз' : 'ставка'} до ${a.to}`;
    case 'allin':
      return 'ва-банк';
    case 'draw':
      return a.cards.length ? `поменять ${cardsWords(a.cards)}` : 'не менять';
    case 'discard':
      return `сбросить ${cardWord(a.card)}`;
  }
}

/** «Как я сыграл раздачу?» — история раздачи своими глазами и разбор «лучший ход». */
export function handFacts(rec0: HandRecord, me: number, names: Record<number, string>, prizes?: number[]): string {
  const r = recFor(rec0, [me]);
  const g = GAMES[r.game];
  const name = (p: number) => (p === me ? 'ты' : names[p] ?? `место ${p + 1}`);
  const L: string[] = [];
  L.push(`Игра: ${g.name}${r.hilo ? ' хай-лоу' : ''}, ${STRUCT[r.struct]}; ${g.family === 'stud' ? `анте ${r.ante}` : `блайнды ${r.small}/${r.big}${r.ante ? `, анте ${r.ante}` : ''}`}; ${prizes?.length ? 'турнир' : 'быстрая игра'}.`);
  const seat = r.seats.find((x) => x.seat === me);
  if (seat) L.push(`Твой стек на начало: ${seat.stack} (${bb(seat.stack, r.big)}).`);
  L.push(`Твои карты: ${cardsWords(r.hole[me] ?? [])}.`);
  const pos = positionName(r, me);
  if (pos) L.push(`Твоя позиция: ${pos}.`);
  L.push(`Игроков в раздаче: ${r.seats.length}: ${r.seats.map((x) => `${name(x.seat)} — ${x.stack}`).join(', ')}.`);
  L.push('Ход раздачи:', ...frames(r, name).slice(1).map((f) => '- ' + plainText(f.text)));
  const net = r.net[me] ?? 0;
  L.push(`Итог для тебя: ${net > 0 ? '+' : ''}${net} фишек (${net > 0 ? '+' : ''}${(net / r.big).toFixed(1)} ББ).`);
  const vd = bestMove(r, me, prizes, name);
  if (vd.kind !== 'none' && vd.short) L.push(`Разбор программы (${vd.kind === 'exact' ? 'точно, по Нэшу' : 'оценка по шансам'}): ${vd.short}.`, plainText(vd.html));
  else L.push('Точного разбора у программы для этой раздачи нет — оценивай по ходам и цифрам выше, без своих расчётов.');
  return fit(L);
}

/** «Что значит статистика этого игрока?» */
export function oppFacts(name: string, c: Counts): string {
  const s = summaryOf(c);
  const L: string[] = [`Соперник: ${name} (бот за столом; о нём — в третьем лице). Раздач при тебе: ${s.hands}${s.hands < 30 ? ' — мало, цифры ещё ненадёжные' : ''}.`];
  const g = styleGuess(s);
  if (g) L.push(`По цифрам похож на: ${g}.`);
  for (const st of STATS) {
    if (st.key === 'hands') continue;
    const v = statVal(s, st.key);
    const n = statN(s, st.key);
    L.push(`- ${st.name}: ${v}${st.key === 'af' || v === '—' ? '' : '%'} (случаев ${n}${st.enough && n < st.enough ? ', мало' : ''}). Что значит: ${st.what} Нормы: ${st.styles} Как пользоваться: ${st.use}`);
  }
  return fit(L);
}

/** «Кто тут опасный?» — HUD всех соперников за столом коротко. */
export function oppsFacts(list: { name: string; c: Counts }[]): string {
  return fit(['Соперники за столом (VPIP, PFR, 3-бет, AF, C-бет, фолд на C-бет, WTSD — по всем раздачам при тебе):', ...list.map((x) => `- ${x.name}: ${hudLine(x.c)}`)]);
}

/** «Разбери мою статистику» */
export function statsFacts(d: HudData, bank?: { balance: number; played: number; itm: number; roi: number }): string {
  const s = summaryOf(d.me);
  const L: string[] = [`Твои раздачи: ${s.hands}${s.hands < 100 ? ' — пока немного, выводы предварительные' : ''}.`];
  const g = styleGuess(s);
  if (g) L.push(`По цифрам твой стиль похож на: ${g}.`);
  L.push('Твои цифры (и нормы разных стилей):');
  for (const st of STATS) {
    if (st.key === 'hands') continue;
    const v = statVal(s, st.key);
    L.push(`- ${st.name}: ${v}${st.key === 'af' || v === '—' ? '' : '%'} (случаев ${statN(s, st.key)}). Нормы: ${st.styles}`);
  }
  if (d.cash.hands) L.push(`Быстрая игра: ${d.cash.hands} раздач, итог ${d.cash.bb >= 0 ? '+' : ''}${d.cash.bb.toFixed(1)} ББ, это ${((d.cash.bb / d.cash.hands) * 100).toFixed(1)} ББ на 100 раздач.`);
  const ts = tourSummary(d);
  if (ts.played) L.push(`Турниры: сыграно ${ts.played}, в призах ${pct(ts.itm * 100)}, побед ${ts.wins}, среднее место — в верхних ${pct(ts.avgPlace * 100)} поля.`);
  if (bank?.played) L.push(`Банкролл: ${bank.balance} очков, турниров на банкролл ${bank.played}, ITM ${pct(bank.itm * 100)}, ROI ${bank.roi >= 0 ? '+' : ''}${pct(bank.roi * 100)}.`);
  L.push(...verdicts(d.hist.slice(-60)));
  return fit(L);
}

/** «Разбери мой турнир» — последний сыгранный турнир и его раздачи. */
export function tourFacts(d: HudData): string {
  const t = d.tours[d.tours.length - 1];
  if (!t) return 'Сыгранных турниров ещё нет.';
  const prev = d.tours[d.tours.length - 2]?.at ?? 0;
  const L: string[] = [
    `Последний турнир: ${FMTS[t.fmt as TourFmt]?.label ?? t.fmt}${t.bank ? ' на банкролл' : ''}; место ${t.place} из ${t.field}${t.prize ? `, приз ${t.prize} (бай-ин ${t.buyin})` : ', без приза'}.`,
  ];
  const ts = tourSummary(d);
  L.push(`Всего турниров: ${ts.played}, в призах ${pct(ts.itm * 100)}, побед ${ts.wins}.`);
  const hands = d.hist.filter((x) => x.tour && x.at > prev && x.at <= t.at + 60_000);
  if (hands.length) {
    L.push(`Раздач этого турнира в истории: ${hands.length}.`);
    const big = hands
      .map((x) => ({ x, net: (x.rec.net[x.me] ?? 0) / x.rec.big }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
      .slice(0, 5);
    L.push('Самые крупные раздачи турнира:');
    for (const { x, net } of big) {
      const r = x.rec;
      const st = r.seats.find((s) => s.seat === x.me)?.stack ?? 0;
      L.push(`- раздача ${r.no}: карты ${cardsWords(r.hole[x.me] ?? [])}, стек ${bb(st, r.big)}, итог ${net >= 0 ? '+' : ''}${net.toFixed(1)} ББ${x.best ? `; разбор: ${x.best}` : ''}`);
    }
    L.push(...verdicts(hands));
  }
  return fit(L);
}

function verdicts(hist: HudData['hist']): string[] {
  const rated = hist.filter((x) => x.best);
  if (!rated.length) return [];
  const bad = rated.filter((x) => !/верно|в порядке/.test(x.best!));
  const out = [`Разбор «лучший ход» по последним раздачам: оценено ${rated.length}, сомнительных ${bad.length}.`];
  if (bad.length) out.push('Последние сомнительные решения:', ...bad.slice(-6).map((x) => `- раздача ${x.rec.no}, карты ${cardsWords(x.rec.hole[x.me] ?? [])}: ${x.best}`));
  return out;
}
