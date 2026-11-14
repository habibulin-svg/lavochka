/* «Коммерсы»: боты. Лёгкий берёт что дают, Средний считает окупаемость и часы, Сложный знает историю
 * (готовится к датам, выходит из МММ и ГКО вовремя) и бережёт хвост для лондонских юристов. Бот видит только свой view. */
import type { Rng } from '../../core/types';
import { CLUB_PRICE, type Fx, type Stat } from './data';
import { season } from './season';
import { bookSum, type Action, type AskChoice, type Rival, type View } from './engine';
import { CRASH_FROM, IT_FROM, m2, hype, type Sector } from './s2data';
import { tyndexPrice } from './s2logic';

const W: Record<Stat, number> = { health: 0.3, mood: 0.2, stress: -0.2, name: 0.6, avt: 0.25, svyazi: 0.7, heat: -0.6, blizkie: 0.3, sovest: 0.15 };

function fxScore(fx: Fx | undefined, v: View, level: number): number {
  if (!fx) return 0;
  const me = v.players.find((p) => p.seat === v.me)!;
  // Сложный с середины пути тянет то, чего не хватает для Лондона
  // во втором сезоне к «Тындексу» тянется и Средний — с «Долины»
  const lack = new Set((level >= 2 && me.tier >= 3) || (level === 1 && v.season === 2 && me.tier >= 4) ? (v.my?.club ?? []).filter((c) => !c.ok).map((c) => c.id) : []);
  // связи забываются — держать запас над порогом клуба, а не ловить его в последний момент
  if (level >= 2 && me.tier >= 3 && (me.stats.svyazi ?? 0) < 75) lack.add('svyazi');
  const boost = (k: string) => (lack.has(k) ? (k === 'english' ? 4 : k === 'svyazi' ? 4 : 3) : 1);
  const s2 = v.season === 2;
  // второй сезон: единица карточек — сама шкала уровня; в акте клуба деньги всё равно сгорят в 2008-м — Сложный их не жалеет
  const scale = s2 ? Math.max(season(2).scale[me.tier], v.m < CRASH_FROM ? me.worth / (level >= 2 ? 10 : 25) : 0) : season(v.season).scale[me.tier] * 100;
  let s = 0;
  if (s2) s += s2Score(fx, v, level);
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
  if (fx.fixer) s += me.tier >= 4 && (me.stats.svyazi ?? 0) < 60 ? 40 : -10;
  if (fx.enemy) s -= 8 * fx.enemy;
  if (fx.jail) s -= 100;
  if (fx.hosp) s -= 15 * fx.hosp;
  if (fx.away) s -= 3 * fx.away;
  if (fx.krysha) s += fx.krysha === 'own' ? 6 : fx.krysha === 'bandit' ? (v.m > season(v.season).mm(2000, 1) ? -10 : 5) : 3;
  if (fx.asset) s += { good: 5, bad: -5, grow: 14, sell: level >= 2 ? 2 : 4, fire: -5 }[fx.asset];
  return s;
}

/** Второй сезон: клуб, запас здоровья, техдиректор, стартапы, биткоины, крах. */
function s2Score(fx: Fx, v: View, level: number): number {
  const me = v.players.find((p) => p.seat === v.me)!;
  const x = v.my?.s2;
  let s = 0;
  const c = fx.club ?? {};
  s += (c.sostav ?? 0) * 2 + (c.duh ?? 0) * 0.6 + (c.fans ?? 0) * 0.5 + (c.slava ?? 0) + (c.trener ?? 0) * 8 - (c.wages ?? 0) / 1e5;
  // здоровье: Средний держит его выше 40, Сложный ещё и копит запас к 2021-му
  const hp = me.stats.health ?? 50;
  // Сложный с пятидесяти лет (2017-й) бережёт себя к ковиду — держит здоровье выше 60
  const keep = level >= 2 && v.m >= m2(2017, 1) ? 60 : 40;
  if (level >= 1 && fx.stats?.health) s += fx.stats.health * (hp < keep ? 1.5 : 0.4);
  // Лёгкий жмёт наугад, но красную шкалу здоровья замечает и он
  else if (fx.stats?.health && hp < 40) s += fx.stats.health * 1.5;
  if (fx.zapas) s += fx.zapas * (level >= 2 ? 4 : level === 1 ? 0 : 0.2);
  if (fx.cto) s += !x?.cto && (me.skills.cifra ?? 0) < 3 ? (level >= 1 ? 30 : 5) : -10;
  if (fx.skills?.cifra && level >= 2 && (me.skills.cifra ?? 0) < 3 && !x?.cto) s += 15;
  if (fx.venture) s += level === 0 ? 2 : me.cash > 4e5 ? 3 : -5;
  if (fx.btc) s += level >= 2 ? 25 : level === 1 ? 2 : 1;
  if (fx.loan) s += level >= 2 && v.m < CRASH_FROM ? 10 : -3;
  if (fx.crash) s += fx.crash * 80;
  if (fx.btcLose) s -= 20;
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
    const t = season(v.season).deal(o.id);
    let score: number;
    if (o.kind === 'paper') {
      if (level < 2 || !t || (t.dies && t.dies - v.m < 4) || (t.id === 'mmm' && v.m > season(v.season).mm(1994, 5))) continue;
      score = 40;
    } else {
      const payback = (o.price + (o.fee ?? 0)) / Math.max(1, o.income * (o.mgr ? 0.76 : 1));
      // второй сезон: IT-дела окупаются дольше — Средний тоже берёт их в кредит (порог 15 мес.)
      const limit = o.loan > 0 ? (level >= 2 ? 16 : v.season === 2 ? 15 : 10) : 30;
      if (payback > limit) continue;
      score = (o.income * 12) / Math.max(1, o.price) * Math.log10(10 + o.income);
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  // второй сезон: доля в стартапе и биткоины рядом с делами
  if (v.season === 2) {
    const me = v.players.find((p) => p.seat === v.me)!;
    ask.choices.forEach((c, i) => {
      if (!c.ok || (c.buy !== 'venture' && c.buy !== 'btc')) return;
      const sum = c.sum ?? 0;
      let score = 0;
      if (level === 0) score = rng.next() < 0.3 ? 99 : 0;
      else if (c.buy === 'venture') score = me.cash > sum * (level >= 2 ? 2 : 6) ? (level >= 2 ? 9 : 4) + (me.skills.chuyka ?? 0) : 0;
      // Сложный читает открытую историю цены: берёт до взлётов, не берёт на пиках
      else if (level >= 2) score = btcCheap(v.m) ? 30 : 0;
      else score = me.cash > sum * 5 ? 2 : 0;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
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
    if (v.season === 2 && v.ask.cell === 'hype') return { type: 'choose', i: hypePick(v, level, rng) };
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
  if (v.season === 2) {
    const a = s2Act(v, level, rng);
    if (a) return a;
  }
  const bizIncome = my.income - (my.job?.salary ?? 0);
  if (my.job && level >= 1 && bizIncome > my.job.salary * 2.5) return { type: 'quit' };
  // во втором сезоне перегрузка бьёт по здоровью — красную шкалу часов замечает и Лёгкий (через раз)
  if ((level >= 1 || (v.season === 2 && rng.next() < 0.5)) && my.hours.used > my.hours.avail) {
    const a = me.assets.filter((x) => x.kind === 'biz' && !x.manager).sort((x, y) => y.hours - x.hours)[0];
    if (a) return { type: 'manager', uid: a.uid, on: true };
  }
  // расширить дело: своё идёт в зачёт — берём, если прибавка дохода окупает доплату быстро
  if (level >= 1) {
    for (const a of me.assets) {
      const g = a.grow;
      const n = g && !g.why ? season(v.season).deal(g.id) : undefined;
      if (!g || !n) continue;
      const gain = n.income * (a.manager ? 0.88 : 1) - a.now;
      if (gain > 0 && g.cost / gain < (level >= 2 ? 14 : 10) && me.cash - g.cost > my.expenses * 2) return { type: 'grow', uid: a.uid };
    }
  }
  if (v.season === 2 && level >= 1 && me.tier >= 4) {
    // «Тындекс»: не хватает только денег — продавать дела; часов — продать мелкое
    const rest = my.club.filter((c) => !c.ok && c.id !== 'date').map((c) => c.id);
    // продажа дела освобождает и часы — «деньги + часы» решаются тем же
    if (level === 1 && rest.includes('cash') && rest.every((k) => k === 'cash' || k === 'hours') && me.worth > tyndexPrice(v.diff) * 1.15) {
      const a = [...me.assets].sort((x, y) => y.value - x.value)[0];
      if (a) return { type: 'sell', uid: a.uid };
    }
    if (rest.includes('hours')) {
      const small = me.assets.filter((a) => a.kind === 'biz' && !a.manager).sort((x, y) => x.now - y.now)[0];
      if (small) return { type: 'manager', uid: small.uid, on: true };
    }
  }
  if (level >= 2) {
    // всё готово, кроме денег, а капитала хватает — продавать дела и копить наличные
    const rest = my.club.filter((c) => !c.ok).map((c) => c.id);
    if (rest.length === 1 && rest[0] === 'cash' && me.worth > (v.season === 2 ? tyndexPrice(v.diff) : CLUB_PRICE) * 1.15) {
      const a = [...me.assets].sort((x, y) => y.value - x.value)[0];
      if (a) return { type: 'sell', uid: a.uid };
    }
    if (me.krysha === 'bandit' && v.m >= season(v.season).mm(2000, 1)) {
      const unit = Math.max(30, 0.7 * my.income);
      if ((me.stats.svyazi ?? 0) >= 30 && me.cash >= unit) return { type: 'krysha', to: 'police' };
      if (me.tier >= 3 && me.cash >= 3 * unit) return { type: 'krysha', to: 'own' };
    }
    const dark = me.tier >= 3 && me.assets.find((a) => season(v.season).deal(a.id)?.heat);
    if (dark) return { type: 'sell', uid: dark.uid };
    if (me.tier >= 4 && my.hours.avail - my.hours.used < 70) {
      const small = me.assets.filter((a) => a.kind === 'biz').sort((x, y) => x.income - y.income)[0];
      if (small && small.income * 50 < my.income) return { type: 'sell', uid: small.uid };
    }
    const dying = me.assets.find((a) => a.kind === 'paper' && season(v.season).deal(a.id)?.dies != null && season(v.season).deal(a.id)!.dies! - v.m <= 3);
    if (dying) return { type: 'sell', uid: dying.uid };
    if (me.debt > 0 && me.cash > me.debt * 1.5) return { type: 'repay' };
  }
  return rivalPick(v, level, rng) ?? { type: 'roll' };
}

/** Дёшево ли сейчас биткоин по открытой истории: до 2017-го, зима 2018–2019, весна 2020-го. */
const btcCheap = (m: number) => m < m2(2017, 6) || (m >= m2(2018, 11) && m <= m2(2019, 3)) || (m >= m2(2020, 3) && m <= m2(2020, 10));
/** Пики, известные всем: декабрь 2017-го, весна и ноябрь 2021-го. */
const btcPeak = (m: number) => (m >= m2(2017, 11) && m <= m2(2017, 12)) || (m >= m2(2021, 3) && m <= m2(2021, 4)) || (m >= m2(2021, 10) && m <= m2(2021, 11));

/** Хайп: Лёгкий — наугад, Средний — по тренду, Сложный читает открытую историю моды. */
function hypePick(v: View, level: number, rng: Rng): number {
  const ch = v.ask!.choices;
  const iIn = ch.findIndex((c) => c.buy === 'hype');
  const iOut = ch.findIndex((c) => c.buy === 'hypeOut');
  const wait = ch.length - 1;
  const sec = ch[iIn]?.sector as Sector | undefined;
  if (!sec) return wait;
  const now = hype(sec, v.m);
  const me = v.players.find((p) => p.seat === v.me)!;
  if (level === 0) {
    const ok = [iIn, iOut, wait].filter((i) => ch[i]?.ok);
    return ok[rng.int(ok.length)];
  }
  const later = level >= 2 ? hype(sec, v.m + 3) : now + (now - hype(sec, v.m - 3));
  if (ch[iOut]?.ok && later < now * 0.9) return iOut;
  if (ch[iIn]?.ok && later > now * 1.15 && me.cash > (ch[iIn].sum ?? 0) * (level >= 2 ? 2 : 4)) return iIn;
  return wait;
}

/** Кнопки второго сезона до броска: включить деньги, слетать домой, биткоины. */
function s2Act(v: View, level: number, rng: Rng): Action | null {
  const me = v.players.find((p) => p.seat === v.me)!;
  const x = v.my?.s2;
  // включить деньги: Лёгкий — когда вздумается, Средний — при аудитории 60, Сложный — при 70
  for (const a of me.assets) {
    if (a.aud == null || a.monet) continue;
    if (level === 0 ? a.aud > 30 && rng.next() < 0.3 : a.aud >= (level >= 2 ? 70 : 60)) return { type: 'monet', uid: a.uid };
  }
  if (level >= 1 && x?.home && v.m < CRASH_FROM) {
    const a = me.assets.find((q) => season(2).deal(q.id)?.home && q.now > 0 && q.niche >= 0);
    const worst = me.assets.filter((q) => season(2).deal(q.id)?.home && q.kind === 'biz').sort((p, q) => p.mul - q.mul)[0];
    if (a && worst && worst.mul < 0.85 && (level >= 2 || rng.next() < 0.5)) return { type: 'home', uid: worst.uid };
  }
  const b = x?.btc;
  if (b && b.amount > 0) {
    // Сложный уносит монеты с биржи до взлома 2014-го и продаёт на известных пиках
    if (level >= 2 && b.where === 'exchange' && v.m >= IT_FROM && v.m < m2(2014, 2)) return { type: 'btc', op: 'flash' };
    if (level >= 2 && btcPeak(v.m)) return { type: 'btc', op: 'sell' };
    if (level === 1 && b.price >= 15000 && rng.next() < 0.5) return { type: 'btc', op: 'sell' };
    if (level === 0 && rng.next() < 0.03) return { type: 'btc', op: 'sell' };
  }
  return null;
}

/** Соперник побогаче:
 Средний сбивает цены в общей нише, Сложный ещё и переманивает людей и до 1998-го наезжает на тех, кто без крыши;
 * Лёгкий иногда стучит. Раз за отрезок — это держит движок. */
function rivalPick(v: View, level: number, rng: Rng): Action | null {
  const me = v.players.find((p) => p.seat === v.me)!;
  const lead = v.players.filter((p) => p.seat !== me.seat).sort((a, b) => b.worth - a.worth)[0];
  if (!lead || lead.worth < me.worth * 0.8) return null;
  const acts = v.my!.rivals.find((r) => r.seat === lead.seat)?.acts ?? [];
  const can = (k: Rival) => acts.some((a) => a.kind === k && a.why === null);
  const go = (kind: Rival): Action => ({ type: 'rival', kind, target: lead.seat });
  if (level === 0) return can('donos') && rng.next() < 0.03 ? go('donos') : null;
  if (can('demping') && rng.next() < 0.15) return go('demping');
  if (level >= 2 && can('naezd') && v.m < season(v.season).mm(1998, 1) && lead.krysha === 'none' && rng.next() < 0.4) return go('naezd');
  if (level >= 2 && can('peremanit') && rng.next() < 0.1) return go('peremanit');
  return null;
}
