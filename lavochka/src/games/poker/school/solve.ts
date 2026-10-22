/* Школа покера — решение задач расчётом. Ответ ученика сверяется не с текстом урока, а с тем, что посчитано здесь:
 * вскрытие — движком (values/handName), ауты — calc.outs, шансы против диапазона — розыгрышем с фиксированным зерном,
 * пуш/фолд — calc.solvePF по таблицам Нэша (с ICM, если есть выплаты), ICM — icm.ts, M — calc.zoneOf, открытие —
 * ranges.openWidth, стиль — hud.styleGuess. Без DOM: тот же код гоняют тест и tools/poker/school-check.ts. */
import type { Card } from '../../../cards/deck';
import { SeededRng } from '../../../core/rng';
import { antesOf, eqVsRange, findPF, solvePF, zoneOf, outs as outsOf } from '../calc';
import { SEATS } from '../def';
import { contenders, handName, hiValue, potSize, toCall, values, type HandRecord, type State } from '../engine';
import { classOf, CLASSES, fastHigh } from '../eval';
import { allCards, highCat, HIGH_NAMES } from '../hands';
import { styleGuess } from '../hud';
import { bubbleFactor, icm } from '../icm';
import { holdemPct, openWidth } from '../ranges';
import type { Summary } from '../stats';
import { buildScene, positionNames, positionOf, preflopOrder } from './scene';
import type { Task } from './types';

export interface Solved {
  /** Верный ответ — значение из вариантов. */
  answer: string;
  /** Посчитанная величина (для «ближайшего варианта»), если есть. */
  value?: number;
  /** Насколько уверен расчёт: запас до границы решения (тест требует, чтобы ответ не висел на волоске). */
  margin?: number;
  /** Расчёт словами (HTML) — показывается после ответа. */
  facts: string;
  /** Варианты: из задачи или по виду. */
  options: [string, string][];
  error?: string;
}

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const RN: Record<number, string> = { 14: 'Т', 13: 'К', 12: 'Д', 11: 'В' };
const SS: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const cardRu = (c: Card) => `${RN[c.r] ?? c.r}${SS[c.s]}`;
/** Имя места в уроке: герой — «Ты». */
export const seatName = (p: number, hero: number) => (p === hero ? 'Ты' : SEATS[p]?.name ?? `место ${p + 1}`);

export const ZONES = ['зелёная', 'жёлтая', 'оранжевая', 'красная', 'мёртвая'];
export const STYLES = ['нит', 'регуляр (TAG)', 'лузово-агрессивный (LAG)', 'колл-станция', 'маньяк', 'новичок (много коллирует)'];

// ---------------------------------------------------------------- диапазоны

const RANKS = '23456789TJQKA';
const ri = (ch: string) => RANKS.indexOf(ch.toUpperCase());

/** Классы рук из записи диапазона: «QQ+», «77», «AKs», «AQo», «AJ» (обе), «ATs+», «KTo+», «A5s-A2s». */
export function parseRange(txt: string): Set<string> {
  const out = new Set<string>();
  for (const raw of txt.split(/[\s,]+/).filter(Boolean)) {
    const t = raw.replace(/10/g, 'T');
    const m = /^([2-9TJQKA])([2-9TJQKA])([so]?)(\+?)(?:-([2-9TJQKA])([2-9TJQKA])([so]?))?$/i.exec(t);
    if (!m) throw new Error(`не понял диапазон «${raw}»`);
    const [, a, b, suf, plus, , b2] = m;
    const hi = ri(a);
    const lo = ri(b);
    const add = (x: number, y: number, s: string) => {
      const [h, l] = x >= y ? [x, y] : [y, x];
      if (h === l) out.add(RANKS[h] + RANKS[l]);
      else if (s) out.add(RANKS[h] + RANKS[l] + s.toLowerCase());
      else {
        out.add(RANKS[h] + RANKS[l] + 's');
        out.add(RANKS[h] + RANKS[l] + 'o');
      }
    };
    if (hi === lo) {
      const end = plus ? 12 : b2 ? ri(b2) : hi;
      for (let r = Math.min(hi, end); r <= Math.max(hi, end); r++) add(r, r, '');
    } else if (plus) for (let r = lo; r < hi; r++) add(hi, r, suf);
    else if (b2) for (let r = Math.min(lo, ri(b2)); r <= Math.max(lo, ri(b2)); r++) add(hi, r, suf);
    else add(hi, lo, suf);
  }
  for (const c of out) if (!CLASSES.includes(c)) throw new Error(`нет класса «${c}»`);
  return out;
}

/** Сочетания из диапазона без известных карт. */
export function rangeOf(txt: string, dead: Card[], short = false): { c: [Card, Card]; w: number }[] {
  const cls = parseRange(txt);
  const ks = new Set(dead.map((c) => c.s + c.r));
  const pool = allCards(short).filter((c) => !ks.has(c.s + c.r));
  const out: { c: [Card, Card]; w: number }[] = [];
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) if (cls.has(classOf(pool[i], pool[j]))) out.push({ c: [pool[i], pool[j]], w: 1 });
  return out;
}

// ---------------------------------------------------------------- варианты по умолчанию

const YN = {
  call: [
    ['call', 'Колл'],
    ['fold', 'Пас'],
  ],
  push: [
    ['push', 'Ва-банк'],
    ['fold', 'Пас'],
  ],
  open: [
    ['raise', 'Рейз'],
    ['fold', 'Пас'],
  ],
  bluff: [
    ['bet', 'Ставить'],
    ['check', 'Чек'],
  ],
} as Record<string, [string, string][]>;

/** Ближайший к value вариант (значения вариантов — числа) и запас до следующего. */
function nearest(options: [string, string][], value: number): { answer: string; margin: number } {
  const xs = options.map(([v]) => ({ v, d: Math.abs(Number(v) - value) })).sort((a, b) => a.d - b.d);
  return { answer: xs[0]?.v ?? '', margin: xs.length > 1 ? xs[1].d - xs[0].d : Infinity };
}

// ---------------------------------------------------------------- решение

export function solve(t: Task): Solved {
  const b = t.scene ? buildScene(t.scene) : null;
  const s = b?.s ?? null;
  const hero = b?.hero ?? 0;
  const res = (r: Omit<Solved, 'options'> & { options?: [string, string][] }): Solved => ({ ...r, options: t.options ?? r.options ?? [], error: b?.error ?? r.error });
  const need = (what: string): Solved => res({ answer: '', facts: '', error: `задаче «${t.kind}» нужен ${what}` });
  const name = (p: number) => seatName(p, hero);
  try {
    switch (t.kind) {
      case 'combo': {
        if (!s) return need('стол');
        const v = hiValue(s, hero);
        return res({ answer: HIGH_NAMES[highCat(v)], facts: `Лучшая пятёрка: <b>${handName(s, hero)}</b>.`, options: HIGH_NAMES.map((x) => [x, x]) });
      }
      case 'winner':
      case 'winlow': {
        if (!s) return need('стол');
        const alive = contenders(s);
        const vals = new Map(alive.map((p) => [p, values(s, p)]));
        const lines = alive.map((p) => `${name(p)} — ${handName(s, p)}`).join('; ');
        const opts: [string, string][] = [...alive.map((p) => [String(p), name(p)] as [string, string]), ['split', 'Делёж']];
        if (t.kind === 'winner') {
          const top = Math.max(...alive.map((p) => vals.get(p)!.hi));
          const w = alive.filter((p) => vals.get(p)!.hi === top);
          return res({ answer: w.length > 1 ? 'split' : String(w[0]), facts: `${lines}.`, options: opts });
        }
        const los = alive.filter((p) => vals.get(p)!.lo != null);
        if (!los.length) return res({ answer: 'none', facts: `${lines}. Низкой руки (пять разных до восьмёрки) нет ни у кого — весь банк берёт старшая.`, options: [...opts.slice(0, -1), ['none', 'Никто'], ['split', 'Делёж']] });
        const top = Math.max(...los.map((p) => vals.get(p)!.lo!));
        const w = los.filter((p) => vals.get(p)!.lo === top);
        return res({ answer: w.length > 1 ? 'split' : String(w[0]), facts: `${lines}. Низкая есть у: ${los.map(name).join(', ')}.`, options: [...opts.slice(0, -1), ['none', 'Никто'], ['split', 'Делёж']] });
      }
      case 'outs': {
        if (!s) return need('стол');
        let o = outsOf(s.hole[hero], s.board);
        if (!o) return res({ answer: '', facts: '', error: 'ауты считаются на флопе и тёрне холдема' });
        // против известной руки: карты, после которых герой впереди (а сейчас — нет)
        if (t.villain != null) {
          const v = t.villain;
          const known = new Set([...s.hole[hero], ...s.hole[v], ...s.board].map((c) => c.s + c.r));
          const ahead = (b: Card[]) => fastHigh([...s.hole[hero], ...b]) > fastHigh([...s.hole[v], ...b]);
          if (ahead(s.board)) return res({ answer: '', facts: '', error: 'герой уже впереди — ауты против руки не считаются' });
          const hits = allCards().filter((c) => !known.has(c.s + c.r) && ahead([...s.board, c]));
          o = { n: hits.length, groups: [{ name: `против руки соперника (${name(v)}): ${hits.map(cardRu).join(' ')}`, n: hits.length }] };
        }
        const unseen = 52 - 2 - s.board.length - (t.villain != null ? 2 : 0);
        const left = 5 - s.board.length;
        const hit = left === 2 ? 1 - ((unseen - o.n) * (unseen - o.n - 1)) / (unseen * (unseen - 1)) : o.n / unseen;
        const nr = nearest(t.options ?? [], o.n);
        return res({
          answer: t.options ? nr.answer : String(o.n),
          value: o.n,
          margin: t.options ? nr.margin : Infinity,
          facts: `Аутов: <b>${o.n}</b> (${o.groups.map((g) => `${g.name} — ${g.n}`).join(', ')}). Собрать ${left === 2 ? 'до ривера' : 'на ривере'}: ${pct(hit)}; правило «×${left === 2 ? 4 : 2}» даёт ≈${o.n * (left === 2 ? 4 : 2)}%.`,
        });
      }
      case 'potodds':
      case 'callfold': {
        const call = s ? toCall(s, hero) : t.call;
        const pot = s ? potSize(s) : t.pot;
        if (call == null || pot == null || !call) return need('колл и банк (стол, где герою нужно доплатить, или call/pot)');
        const needEq = call / (pot + call);
        const head = `Доплатить ${call} в банк ${pot}: нужно ${call} / (${pot} + ${call}) = <b>${pct(needEq, 1)}</b> шансов.`;
        if (t.kind === 'potodds') {
          const nr = nearest(t.options ?? [], needEq * 100);
          return res({ answer: nr.answer, value: needEq * 100, margin: nr.margin, facts: head });
        }
        if (!s || !t.vs) return need('стол и диапазон vs');
        const range = rangeOf(t.vs, [...s.hole[hero], ...s.board]);
        const eq = eqVsRange(s.hole[hero], s.board, range, 6000, new SeededRng(5));
        return res({
          answer: eq > needEq ? 'call' : 'fold',
          value: eq,
          margin: Math.abs(eq - needEq),
          facts: `${head} Против диапазона «${t.vs}» (${range.length} сочетаний) у тебя ≈<b>${pct(eq)}</b> — ${eq > needEq ? 'больше нужного: колл в плюс' : 'меньше нужного: колл в минус'}.`,
          options: YN.call,
        });
      }
      case 'position': {
        if (!s) return need('стол');
        return res({ answer: positionOf(s, hero), facts: `Баттон — ${name(s.button)}; ты — <b>${positionOf(s, hero)}</b>.`, options: positionNames(s.inHand.length).map((x) => [x, x]) });
      }
      case 'open': {
        if (!s) return need('стол');
        const order = preflopOrder(s);
        const behind = order.length - 1 - order.indexOf(hero);
        const p = holdemPct(s.hole[hero][0], s.hole[hero][1]);
        const w = openWidth(behind, s.inHand.length);
        const cls = classOf(s.hole[hero][0], s.hole[hero][1]);
        return res({
          answer: p < w ? 'raise' : 'fold',
          value: p,
          margin: Math.abs(p - w),
          facts: `${s.hole[hero].map(cardRu).join(' ')} (${cls}): сильнее — ${pct(p)} всех рук. Позади тебя ${behind} — открываться стоит примерно с лучшими <b>${pct(w)}</b>, поэтому ${p < w ? '<b>рейз</b>' : '<b>пас</b>'}.`,
          options: YN.open,
        });
      }
      case 'zone': {
        if (!s?.rec) return need('стол');
        const stack = s.rec.seats.find((x) => x.seat === hero)!.stack;
        const antes = t.antes ?? antesOf(s.rec);
        const z = zoneOf(stack, s.small, s.big, antes);
        return res({ answer: z.name, value: z.m, facts: `M = ${stack} / (${s.small} + ${s.big}${antes ? ` + ${antes}` : ''}) = <b>${z.m.toFixed(1)}</b> — ${z.name} зона: ${z.advice}.`, options: ZONES.map((x) => [x, x]) });
      }
      case 'pushfold': {
        if (!s?.rec) return need('стол');
        const r: HandRecord = { ...s.rec, acts: [...s.rec.acts, { k: 'act', street: 0, seat: hero, a: 'fold', amount: 0, to: 0 }] };
        const f = findPF(r, hero, t.prizes);
        if (!f) return res({ answer: '', facts: '', error: 'не пуш/фолд-спот (холдем, безлимит, до 20 ББ; до героя все спасовали или один ва-банк)' });
        const pf = solvePF(f.spot);
        const pool = t.prizes?.reduce((a, x) => a + x, 0) ?? 0;
        const act = pf.kind === 'push' ? 'ва-банк' : 'колл';
        const lines = [
          `Эффективный стек — ${pf.eff.toFixed(1)} ББ. По таблице Нэша с этой рукой ${act} верен ${pf.nash >= 20 ? 'при любом стеке до 20 ББ' : pf.nash > 0 ? `до ${pf.nash.toFixed(1)} ББ` : 'никогда'}.`,
          pf.kind === 'push' ? `Отвечают ва-банком ≈${pct(pf.callP ?? 0)} раз, тогда у тебя ≈${pct(pf.eq)}.` : `Против диапазона ва-банка у тебя ≈${pct(pf.eq)}, нужно ${pct(pf.need ?? 0)}${pf.needIcm != null ? `, а по ICM — ${pct(pf.needIcm)}` : ''}.`,
          `${act[0].toUpperCase() + act.slice(1)} против паса: ${pf.evBB >= 0 ? '+' : '−'}${Math.abs(pf.evBB).toFixed(2)} ББ.`,
        ];
        if (pool) lines.push(`По ICM: ${act} — ${pct(pf.icmAct!, 2)} призовых, пас — ${pct(pf.icmFold!, 2)}.`);
        return res({
          answer: pf.best,
          value: pool ? pf.icmAct! - pf.icmFold! : pf.evBB,
          margin: pool ? Math.abs(pf.icmAct! - pf.icmFold!) * 100 : Math.abs(pf.evBB),
          facts: lines.join(' '),
          options: pf.kind === 'push' ? YN.push : YN.call,
        });
      }
      case 'icm':
      case 'bubble': {
        const stacks = t.stacks ?? (s ? s.inHand.map((p) => s.chips[p] + s.total[p]) : null);
        if (!stacks || !t.prizes) return need('stacks и prizes');
        const pool = t.prizes.reduce((a, x) => a + x, 0);
        const eq = icm(stacks, t.prizes);
        const list = stacks.map((x, i) => `${name(i)}: ${x} фишек — ${pct(eq[i] / pool, 1)}`).join('; ');
        if (t.kind === 'bubble') {
          const v = t.villain ?? 1;
          const bf = bubbleFactor(stacks, t.prizes, hero, v, Math.min(stacks[hero], stacks[v]));
          const nr = nearest(t.options ?? [], bf);
          return res({ answer: nr.answer, value: bf, margin: nr.margin, facts: `Фактор пузыря в споре с соперником (${name(v)}) — <b>${bf.toFixed(2)}</b>: проигранная фишка дороже выигранной в ${bf.toFixed(2)} раза. ${list}.` });
        }
        if (t.ask === 'value') {
          const v = (eq[hero] / pool) * 100;
          const nr = nearest(t.options ?? [], v);
          return res({ answer: nr.answer, value: v, margin: nr.margin, facts: `${list}. Доля фишек — ${pct(stacks[hero] / stacks.reduce((a, x) => a + x, 0), 1)}, а призовых — <b>${v.toFixed(1)}%</b>.` });
        }
        const order = eq.map((x, i) => ({ x, i })).sort((a, b) => (t.ask === 'min' ? a.x - b.x : b.x - a.x));
        const gap = order.length > 1 ? Math.abs(order[0].x - order[1].x) / pool : Infinity;
        return res({ answer: String(order[0].i), value: order[0].x, margin: gap * 100, facts: `${list}.`, options: stacks.map((_, i) => [String(i), name(i)]) });
      }
      case 'betodds': {
        const bet = t.bet;
        const pot = t.pot ?? (s ? potSize(s) : undefined);
        if (bet == null || pot == null) return need('bet и pot');
        const v = (bet / (pot + 2 * bet)) * 100;
        const nr = nearest(t.options ?? [], v);
        return res({ answer: nr.answer, value: v, margin: nr.margin, facts: `Ставка ${bet} в банк ${pot}: сопернику доплачивать ${bet} в банк ${pot + bet} — нужно ${bet} / ${pot + 2 * bet} = <b>${v.toFixed(1)}%</b> шансов.` });
      }
      case 'bluff': {
        const bet = t.bet;
        const pot = t.pot ?? (s ? potSize(s) : undefined);
        if (bet == null || pot == null || t.fold == null) return need('bet, pot и fold');
        const be = bet / (pot + bet);
        return res({
          answer: t.fold > be ? 'bet' : 'check',
          value: t.fold,
          margin: Math.abs(t.fold - be),
          facts: `Блеф ${bet} в банк ${pot} окупается, если соперник пасует чаще ${bet} / (${pot} + ${bet}) = <b>${pct(be)}</b>; он пасует ${pct(t.fold)} — ${t.fold > be ? 'ставка в плюс' : 'ставка в минус'}.`,
          options: YN.bluff,
        });
      }
      case 'style': {
        if (!t.hud) return need('hud');
        const g = styleGuess({ ...t.hud, n: {} } as unknown as Summary);
        if (!g) return res({ answer: '', facts: '', error: 'по этим цифрам стиль не определяется (мало раздач или середина)' });
        return res({ answer: g, facts: `VPIP ${t.hud.vpip}, PFR ${t.hud.pfr} (разрыв ${t.hud.vpip - t.hud.pfr}), AF ${t.hud.af} — это <b>${g}</b>.`, options: STYLES.map((x) => [x, x]) });
      }
    }
  } catch (e) {
    return res({ answer: '', facts: '', error: (e as Error).message });
  }
  return res({ answer: '', facts: '', error: `неизвестный вид задачи «${t.kind}»` });
}

/** Что видно игроку в задаче: стол уже собран (для показа). */
export const sceneState = (t: Task): State | null => (t.scene ? buildScene(t.scene).s : null);
