/* Покер — статистика игроков по истории раздач (HandRecord), как в HUD: VPIP, PFR, 3-бет, AF, продолженная ставка и
 * фолд на неё, WTSD, W$SD, кража блайндов и фолд на кражу. Одна функция на все виды: «до флопа» — первая улица торговли
 * (у стада — третья улица, принос не считается; кражи в стаде нет — там нет блайндов).
 * Счёт — только по тому, что видно всем: ходы и вскрытые карты, поэтому годится и для сетевого стола. */
import type { HandRecord } from './engine';

export interface Counts {
  hands: number;
  vpip: number;
  pfr: number;
  /** Был ровно один рейз перед ходом игрока на первой улице — и он ре-рейзнул. */
  threeOpp: number;
  three: number;
  /** После первой улицы: ставки и рейзы, коллы. */
  aggr: number;
  calls: number;
  cbetOpp: number;
  cbet: number;
  /** Соперник поставил продолженную — игрок ответил пасом. */
  fcbOpp: number;
  fcb: number;
  /** Видел вторую улицу и дошёл до вскрытия; выиграл на вскрытии. */
  saw: number;
  sd: number;
  wsd: number;
  /** Кража: до игрока на поздней позиции (CO, баттон, малый блайнд) все спасовали — и он рейзнул. */
  stealOpp: number;
  steal: number;
  /** На блайнде против кражи — пас. */
  fstOpp: number;
  fst: number;
}

export const zero = (): Counts => ({ hands: 0, vpip: 0, pfr: 0, threeOpp: 0, three: 0, aggr: 0, calls: 0, cbetOpp: 0, cbet: 0, fcbOpp: 0, fcb: 0, saw: 0, sd: 0, wsd: 0, stealOpp: 0, steal: 0, fstOpp: 0, fst: 0 });

/** Счётчики из хранилища (старые — без новых полей) — к полному виду. */
export const norm = (c: Partial<Counts> | null | undefined): Counts => {
  const z = zero();
  if (c) for (const k of Object.keys(z) as (keyof Counts)[]) if (typeof c[k] === 'number' && Number.isFinite(c[k])) z[k] = c[k]!;
  return z;
};

export function merge(a: Counts, b: Counts): Counts {
  const z = zero();
  for (const k of Object.keys(z) as (keyof Counts)[]) z[k] = a[k] + b[k];
  return z;
}

type Act = Extract<HandRecord['acts'][number], { k: 'act' }>;
const aggressive = (a: Act) => a.a === 'bet' || a.a === 'raise';

/** Позиции по истории: баттон, блайнды и катофф (место перед баттоном, если игроков больше трёх). */
export function positions(r: HandRecord) {
  const ring = r.seats.map((x) => x.seat).sort((a, b) => a - b);
  const next = (p: number) => ring.find((x) => x > p) ?? ring[0];
  const prev = (p: number) => [...ring].reverse().find((x) => x < p) ?? ring[ring.length - 1];
  const sb = ring.length === 2 ? r.button : next(r.button);
  const bb = next(sb);
  const co = ring.length > 3 ? prev(r.button) : -1;
  return { ring, sb, bb, co, button: r.button, next };
}

/** Добавить раздачу к счётчикам мест. */
export function addHand(acc: Map<number, Counts>, r: HandRecord) {
  const acts = r.acts.filter((a) => a.k === 'act') as Act[];
  const pre = acts.filter((a) => a.street === 0);
  let raises = 0;
  let lastAgg = -1;
  const per = new Map<number, { vpip: boolean; pfr: boolean; opp3: boolean; did3: boolean }>();
  for (const a of pre) {
    const p = per.get(a.seat) ?? { vpip: false, pfr: false, opp3: false, did3: false };
    const agg = aggressive(a);
    if (raises === 1 && !p.opp3) {
      p.opp3 = true;
      if (agg) p.did3 = true;
    }
    if (agg || a.a === 'call') p.vpip = true;
    if (agg) {
      p.pfr = true;
      raises++;
      lastAgg = a.seat;
    }
    per.set(a.seat, p);
  }
  const get = (seat: number) => {
    const c = acc.get(seat) ?? zero();
    acc.set(seat, c);
    return c;
  };
  const won = new Set(r.winners.filter((w) => w.amount > 0).map((w) => w.seat));
  for (const { seat } of r.seats) {
    const c = get(seat);
    c.hands++;
    const p = per.get(seat);
    if (p?.vpip) c.vpip++;
    if (p?.pfr) c.pfr++;
    if (p?.opp3) c.threeOpp++;
    if (p?.did3) c.three++;
    const post = acts.filter((a) => a.seat === seat && a.street > 0);
    for (const a of post) {
      if (aggressive(a)) c.aggr++;
      else if (a.a === 'call') c.calls++;
    }
    if (acts.some((a) => a.seat === seat && a.street === 1)) {
      c.saw++;
      if (r.showdown && r.shown[seat]) {
        c.sd++;
        if (won.has(seat)) c.wsd++;
      }
    }
  }
  // продолженная ставка: последний агрессор до флопа ходит на второй улице, и перед ним никто не ставил
  if (lastAgg >= 0) {
    const s1 = acts.filter((a) => a.street === 1);
    const i = s1.findIndex((a) => a.seat === lastAgg);
    if (i >= 0 && !s1.slice(0, i).some(aggressive)) {
      const c = get(lastAgg);
      c.cbetOpp++;
      if (aggressive(s1[i])) {
        c.cbet++;
        // ответ на продолженную: первый ход каждого после неё, пока никто не повысил
        const seen = new Set<number>();
        for (const a of s1.slice(i + 1)) {
          if (a.seat === lastAgg || seen.has(a.seat)) continue;
          seen.add(a.seat);
          const q = get(a.seat);
          q.fcbOpp++;
          if (a.a === 'fold') q.fcb++;
          if (aggressive(a)) break;
        }
      }
    }
  }
  // кража блайндов (только виды с блайндами)
  if (r.anteKind !== 'stud' && r.seats.length >= 3) {
    const pos = positions(r);
    const late = new Set([pos.co, pos.button, pos.sb].filter((x) => x >= 0 && x !== pos.bb));
    let thief = -1;
    for (let k = 0; k < pre.length; k++) {
      const a = pre[k];
      if (a.a !== 'fold') {
        if (late.has(a.seat)) {
          get(a.seat).stealOpp++;
          if (aggressive(a)) {
            get(a.seat).steal++;
            thief = k;
          }
        }
        break;
      }
      if (late.has(a.seat)) get(a.seat).stealOpp++;
    }
    if (thief >= 0) {
      const t = pre[thief].seat;
      for (const b of [pos.sb, pos.bb]) {
        if (b === t) continue;
        const k = pre.findIndex((a, j) => j > thief && a.seat === b);
        if (k < 0 || pre.slice(thief + 1, k).some(aggressive)) continue;
        get(b).fstOpp++;
        if (pre[k].a === 'fold') get(b).fst++;
      }
    }
  }
}

const pc = (a: number, b: number) => (b ? (100 * a) / b : 0);

/** Проценты и AF. Для редких цифр — и число случаев (n…), чтобы видеть, можно ли им верить. */
export function summary(c: Counts) {
  return {
    hands: c.hands,
    vpip: pc(c.vpip, c.hands),
    pfr: pc(c.pfr, c.hands),
    threeBet: pc(c.three, c.threeOpp),
    af: c.calls ? c.aggr / c.calls : c.aggr,
    cbet: pc(c.cbet, c.cbetOpp),
    foldCbet: pc(c.fcb, c.fcbOpp),
    wtsd: pc(c.sd, c.saw),
    wsd: pc(c.wsd, c.sd),
    steal: pc(c.steal, c.stealOpp),
    foldSteal: pc(c.fst, c.fstOpp),
    n: { threeBet: c.threeOpp, af: c.aggr + c.calls, cbet: c.cbetOpp, foldCbet: c.fcbOpp, wtsd: c.saw, wsd: c.sd, steal: c.stealOpp, foldSteal: c.fstOpp },
  };
}
export type Summary = ReturnType<typeof summary>;
