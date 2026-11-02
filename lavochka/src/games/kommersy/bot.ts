/* «Коммерсы»: боты. Лёгкий берёт что дают, Средний считает окупаемость и часы, Сложный знает историю
 * (готовится к датам, выходит из МММ и ГКО вовремя) и бережёт хвост для лондонских юристов. Бот видит только свой view. */
import type { Rng } from '../../core/types';
import { CLUB_PRICE, SCALE, dealById, mm, type Fx, type Stat } from './data';
import { bookSum, type Action, type AskChoice, type View } from './engine';

const W: Record<Stat, number> = { health: 0.3, mood: 0.2, stress: -0.2, name: 0.6, avt: 0.25, svyazi: 0.7, heat: -0.6, blizkie: 0.3, sovest: 0.15 };

function fxScore(fx: Fx | undefined, v: View, level: number): number {
  if (!fx) return 0;
  const me = v.players.find((p) => p.seat === v.me)!;
  // Сложный с середины пути тянет то, чего не хватает для Лондона
  const lack = new Set(level >= 2 && me.tier >= 3 ? (v.my?.club ?? []).filter((c) => !c.ok).map((c) => c.id) : []);
  // связи забываются — держать запас над порогом клуба, а не ловить его в последний момент
  if (level >= 2 && me.tier >= 3 && (me.stats.svyazi ?? 0) < 65) lack.add('svyazi');
  const boost = (k: string) => (lack.has(k) ? (k === 'english' ? 4 : k === 'svyazi' ? 4 : 3) : 1);
  const scale = SCALE[me.tier] * 100;
  let s = 0;
  s += ((fx.cash ?? 0) / scale) * 10 + (fx.cashT ?? 0) * 10 + (fx.cashPct ?? 0) * 30;
  for (const [k, n] of Object.entries(fx.stats ?? {})) s += W[k as Stat] * (k === 'heat' && level >= 2 ? 2 : 1) * boost(k) * n!;
  for (const [k, n] of Object.entries(fx.skills ?? {})) s += (k === 'english' ? (me.tier >= 3 ? 10 : 4) * boost('english') : 6) * n! * (me.skills[k as keyof typeof me.skills] >= 4 ? 0.2 : 1);
  if (fx.prep) s += level >= 1 ? 15 : 3;
  if (fx.hoursBonus) s += fx.hoursBonus * 0.4;
  if (fx.upkeepT) s -= fx.upkeepT * 25;
  if (fx.incomeBoost) s += (fx.incomeBoost - 1) * 80;
  if (fx.dream) s += 10;
  if (fx.insurance) s += 4;
  if (fx.advisor) s += me.tier >= 4 && me.skills.english < 3 ? 40 : -10;
  if (fx.enemy) s -= 8 * fx.enemy;
  if (fx.jail) s -= 100;
  if (fx.hosp) s -= 15 * fx.hosp;
  if (fx.away) s -= 3 * fx.away;
  if (fx.krysha) s += fx.krysha === 'own' ? 6 : fx.krysha === 'bandit' ? (v.m > mm(2000, 1) ? -10 : 5) : 3;
  if (fx.asset) s += { good: 5, bad: -5, grow: 14, sell: level >= 2 ? 2 : 4, fire: -5 }[fx.asset];
  return s;
}

function choiceScore(c: AskChoice, v: View, level: number): number {
  if (c.buy === 'club') return 1e9;
  let s = fxScore(c.fx, v, level);
  if (c.risk) {
    const me = v.players.find((p) => p.seat === v.me)!;
    const sk = c.risk.skill ? me.skills[c.risk.skill] : 0;
    s += Math.max(0.05, c.risk.p - 0.08 * sk) * fxScore(c.risk.fx, v, level);
  }
  if (c.dark) s -= level === 0 ? 0 : level === 1 ? 3 : 8;
  return s;
}

function dealPick(v: View, level: number, rng: Rng): number {
  const ask = v.ask!;
  const pass = ask.choices.findIndex((c) => c.buy === 'pass');
  const ok = ask.choices.map((c, i) => (c.ok && c.buy === 'deal' ? i : -1)).filter((i) => i >= 0);
  if (!ok.length) return pass;
  if (level === 0) return rng.next() < 0.6 ? ok[rng.int(ok.length)] : pass;
  let best = pass;
  let bestScore = 0;
  for (const i of ok) {
    const o = ask.deals![ask.choices[i].di!];
    const t = dealById(o.id);
    let score: number;
    if (o.kind === 'paper') {
      if (level < 2 || !t || (t.dies && t.dies - v.m < 4) || (t.id === 'mmm' && v.m > mm(1994, 5))) continue;
      score = 40;
    } else {
      const payback = (o.price + (o.fee ?? 0)) / Math.max(1, o.income * (o.mgr ? 0.76 : 1));
      const limit = o.loan > 0 ? (level >= 2 ? 16 : 10) : 30;
      if (payback > limit) continue;
      score = (o.income * 12) / Math.max(1, o.price) * Math.log10(10 + o.income);
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  // не по карману — выставить право на торги: наценка достанется даром, если кто-то купит
  const auc = ask.choices.findIndex((c) => c.buy === 'auction');
  if (best === pass && auc >= 0 && (level >= 1 || rng.next() < 0.3)) return auc;
  return best;
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.phase === 'over') return null;
  if (v.phase === 'buh') {
    const b = v.books.find((x) => x.seat === seat && x.ans == null);
    if (!b || !v.booksWait.includes(seat)) return null;
    const sum = bookSum(b);
    // Лёгкий путается в разноске, Средний — изредка, Сложный считает точно
    const slip = rng.next() < [0.3, 0.08, 0][level] ? 1.3 : 1;
    return { type: 'buh', sum: Math.round(sum * slip + (slip > 1 ? 50 : 0)) };
  }
  if (v.phase === 'choose' && v.ask && v.ask.seat === seat) {
    if (v.ask.deals) return { type: 'choose', i: dealPick(v, level, rng) };
    const okIdx = v.ask.choices.map((c, i) => (c.ok ? i : -1)).filter((i) => i >= 0);
    if (level === 0 && rng.next() < 0.3) return { type: 'choose', i: okIdx[rng.int(okIdx.length)] };
    let best = okIdx[0];
    for (const i of okIdx) if (choiceScore(v.ask.choices[i], v, level) > choiceScore(v.ask.choices[best], v, level)) best = i;
    return { type: 'choose', i: best };
  }
  if (v.turn !== seat) return null;
  if (v.phase === 'move') return { type: 'move' };
  const me = v.players.find((p) => p.seat === seat)!;
  const my = v.my!;
  const bizIncome = my.income - (my.job?.salary ?? 0);
  if (my.job && level >= 1 && bizIncome > my.job.salary * 2.5) return { type: 'quit' };
  if (level >= 1 && my.hours.used > my.hours.avail) {
    const a = me.assets.filter((x) => x.kind === 'biz' && !x.manager).sort((x, y) => y.hours - x.hours)[0];
    if (a) return { type: 'manager', uid: a.uid, on: true };
  }
  if (level >= 2) {
    // всё готово, кроме денег, а капитала хватает — продавать дела и копить наличные
    const rest = my.club.filter((c) => !c.ok).map((c) => c.id);
    if (rest.length === 1 && rest[0] === 'cash' && me.worth > CLUB_PRICE * 1.15) {
      const a = [...me.assets].sort((x, y) => y.value - x.value)[0];
      if (a) return { type: 'sell', uid: a.uid };
    }
    if (me.krysha === 'bandit' && v.m >= mm(2000, 1)) {
      if ((me.stats.svyazi ?? 0) >= 30) return { type: 'krysha', to: 'police' };
      if (me.tier >= 3) return { type: 'krysha', to: 'own' };
    }
    const dark = me.tier >= 3 && me.assets.find((a) => dealById(a.id)?.heat);
    if (dark) return { type: 'sell', uid: dark.uid };
    if (me.tier >= 4 && my.hours.avail - my.hours.used < 70) {
      const small = me.assets.filter((a) => a.kind === 'biz').sort((x, y) => x.income - y.income)[0];
      if (small && small.income * 50 < my.income) return { type: 'sell', uid: small.uid };
    }
    const dying = me.assets.find((a) => a.kind === 'paper' && dealById(a.id)?.dies != null && dealById(a.id)!.dies! - v.m <= 3);
    if (dying) return { type: 'sell', uid: dying.uid };
    if (me.debt > 0 && me.cash > me.debt * 1.5) return { type: 'repay' };
  }
  return { type: 'roll' };
}
