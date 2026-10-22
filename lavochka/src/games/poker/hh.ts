/* Покер — выгрузка истории раздач в текстовом формате, который понимают популярные покерные трекеры (формат истории
 * раздач крупнейшего рума; в интерфейсе — просто «формат для трекеров»). Игра на очки — как «игровые фишки» (без валюты).
 * Выгружаются флоп-игры: холдем (безлимит, пот-лимит, лимит) и Омаха (4 и 5 карт, хай и хай-лоу); остальное трекеры
 * разбирают плохо — пропускаем. Без DOM. */
import type { Card } from '../../cards/deck';
import type { HandRecord } from './engine';
import type { Saved } from './hud';
import { startBoard } from './replay';

const RK: Record<number, string> = { 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
export const cardEn = (c: Card) => `${RK[c.r] ?? c.r}${c.s.toLowerCase()}`;
const cards = (cs: (Card | null)[]) => `[${cs.filter((c): c is Card => !!c).map(cardEn).join(' ')}]`;

const STRUCT = { nl: 'No Limit', pot: 'Pot Limit', limit: 'Limit' } as const;

/** Название игры в шапке; null — вид не выгружается. */
export function hhGame(r: Pick<HandRecord, 'game' | 'hilo' | 'struct'>): string | null {
  const st = STRUCT[r.struct];
  if (r.game === 'holdem') return `Hold'em ${st}`;
  if (r.game === 'omaha4') return r.hilo ? `Omaha Hi/Lo ${st}` : `Omaha ${st}`;
  if (r.game === 'omaha5') return r.hilo ? `5 Card Omaha Hi/Lo ${st}` : `5 Card Omaha ${st}`;
  return null;
}

const two = (n: number) => String(n).padStart(2, '0');
const dateOf = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}/${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};
/** Имена без двоеточий и скобок (по ним трекер режет строки). */
const safe = (s: string) => s.replace(/[:[\]()]/g, '').trim() || 'Player';

type Act = Extract<HandRecord['acts'][number], { k: 'act' }>;

/** Одна раздача текстом. id — номер раздачи в выгрузке. */
export function handText(h: Saved, id: number): string | null {
  const r = h.rec;
  const game = hhGame(r);
  if (!game) return null;
  const nm = (p: number) => safe(h.names[p] ?? `Seat${p + 1}`);
  const ring = r.seats.map((x) => x.seat).sort((a, b) => a - b);
  const L: string[] = [];
  L.push(`PokerStars Hand #${id}: ${game} (${r.small}/${r.big}) - ${dateOf(h.at)} ET`);
  L.push(`Table 'Lavochka ${h.tour ? 'T' : 'C'}' ${Math.max(2, ring.length)}-max Seat #${r.button + 1} is the button`);
  for (const p of ring) L.push(`Seat ${p + 1}: ${nm(p)} (${r.seats.find((x) => x.seat === p)!.stack} in chips)`);
  const put: Record<number, number> = {};
  for (const p of ring) put[p] = 0;
  const posts = r.acts.filter((a) => a.k === 'post');
  for (const a of posts) {
    if (a.k !== 'post') continue;
    put[a.seat] += a.amount;
    L.push(a.what === 'sb' ? `${nm(a.seat)}: posts small blind ${a.amount}` : a.what === 'bb' ? `${nm(a.seat)}: posts big blind ${a.amount}` : `${nm(a.seat)}: posts the ante ${a.amount}`);
  }
  L.push('*** HOLE CARDS ***');
  const mine = r.hole[h.me];
  if (mine?.every((c) => c)) L.push(`Dealt to ${nm(h.me)} ${cards(mine)}`);
  let board = startBoard(r);
  const STREET = ['', 'FLOP', 'TURN', 'RIVER'];
  // ставка круга: кто сколько уже поставил на этой улице (блайнды — на первой)
  let bets: Record<number, number> = {};
  for (const a of posts) if (a.k === 'post' && a.what !== 'ante') bets[a.seat] = (bets[a.seat] ?? 0) + a.amount;
  let top = Math.max(0, ...Object.values(bets));
  for (const a of r.acts) {
    if (a.k === 'board') {
      const prev = board.slice();
      board = [...board, ...a.cards];
      L.push(a.street === 1 ? `*** FLOP *** ${cards(board)}` : `*** ${STREET[a.street] ?? 'RIVER'} *** ${cards(prev)} ${cards(a.cards)}`);
      bets = {};
      top = 0;
      continue;
    }
    if (a.k !== 'act') continue;
    const x = a as Act;
    const allin = x.allin ? ' and is all-in' : '';
    put[x.seat] += x.amount;
    const had = bets[x.seat] ?? 0;
    bets[x.seat] = had + x.amount;
    if (x.a === 'fold') L.push(`${nm(x.seat)}: folds`);
    else if (x.a === 'check') L.push(`${nm(x.seat)}: checks`);
    else if (x.a === 'call') L.push(`${nm(x.seat)}: calls ${x.amount}${allin}`);
    else if (x.a === 'bet') {
      L.push(`${nm(x.seat)}: bets ${x.amount}${allin}`);
      top = bets[x.seat];
    } else {
      L.push(`${nm(x.seat)}: raises ${bets[x.seat] - top} to ${bets[x.seat]}${allin}`);
      top = bets[x.seat];
    }
  }
  // невостребованная ставка: тот, кто поставил больше всех, получает разницу со вторым
  const sorted = ring.slice().sort((a, b) => put[b] - put[a]);
  const uncalled = sorted.length > 1 ? put[sorted[0]] - put[sorted[1]] : 0;
  if (uncalled > 0) L.push(`Uncalled bet (${uncalled}) returned to ${nm(sorted[0])}`);
  const back = (p: number) => (uncalled > 0 && p === sorted[0] ? uncalled : 0);
  if (r.showdown) {
    L.push('*** SHOW DOWN ***');
    for (const [p, cs] of Object.entries(r.shown)) L.push(`${nm(Number(p))}: shows ${cards(cs)}`);
  }
  // кто сколько забрал (без возвращённой ставки)
  const got: Record<number, number> = {};
  for (const w of r.winners) got[w.seat] = (got[w.seat] ?? 0) + w.amount;
  let left = uncalled;
  for (const p of Object.keys(got).map(Number)) {
    const b = Math.min(left, back(p), got[p]);
    got[p] -= b;
    left -= b;
  }
  for (const [p, v] of Object.entries(got)) if (v > 0) L.push(`${nm(Number(p))} collected ${v} from pot`);
  const total = Object.values(put).reduce((a, b) => a + b, 0) - uncalled;
  L.push('*** SUMMARY ***');
  L.push(`Total pot ${total} | Rake 0`);
  if (board.length) L.push(`Board ${cards(board)}`);
  const folded = new Map<number, number>();
  for (const a of r.acts) if (a.k === 'act' && a.a === 'fold' && !folded.has(a.seat)) folded.set(a.seat, a.street);
  const FOLD_AT = ['before Flop', 'on the Flop', 'on the Turn', 'on the River'];
  for (const p of ring) {
    const role = p === r.button ? ' (button)' : '';
    const st = folded.get(p);
    const won = got[p] ?? 0;
    const shown = r.shown[p];
    let tail: string;
    if (st != null) tail = `folded ${FOLD_AT[st] ?? 'on the River'}`;
    else if (shown) tail = `showed ${cards(shown)} and ${won > 0 ? `won (${won})` : 'lost'}`;
    else tail = won > 0 ? `collected (${won})` : 'mucked';
    L.push(`Seat ${p + 1}: ${nm(p)}${role} ${tail}`);
  }
  return L.join('\n');
}

/** Вся история: раздачи через две пустые строки (как в файлах рума). Возвращает текст и сколько пропущено. */
export function exportHistory(hist: Saved[]): { text: string; skipped: number; count: number } {
  const out: string[] = [];
  let skipped = 0;
  hist.forEach((h, i) => {
    const id = Math.floor(h.at / 1000) * 100 + (i % 100);
    const t = handText(h, id);
    if (t) out.push(t);
    else skipped++;
  });
  return { text: out.join('\n\n\n') + (out.length ? '\n' : ''), skipped, count: out.length };
}
