/* Покер — статистика игроков по истории раздач (HandRecord), как в HUD: VPIP, PFR, 3-бет, AF, продолженная ставка,
 * WTSD. Одна функция на все виды: «до флопа» — первая улица торговли (у стада — третья улица, принос не считается). */
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
  /** Видел вторую улицу и дошёл до вскрытия. */
  saw: number;
  sd: number;
}

const zero = (): Counts => ({ hands: 0, vpip: 0, pfr: 0, threeOpp: 0, three: 0, aggr: 0, calls: 0, cbetOpp: 0, cbet: 0, saw: 0, sd: 0 });

/** Добавить раздачу к счётчикам мест. */
export function addHand(acc: Map<number, Counts>, r: HandRecord) {
  const acts = r.acts.filter((a) => a.k === 'act') as Extract<HandRecord['acts'][number], { k: 'act' }>[];
  const pre = acts.filter((a) => a.street === 0);
  let raises = 0;
  let lastAgg = -1;
  const per = new Map<number, { vpip: boolean; pfr: boolean; opp3: boolean; did3: boolean }>();
  for (const a of pre) {
    const p = per.get(a.seat) ?? { vpip: false, pfr: false, opp3: false, did3: false };
    const agg = a.a === 'bet' || a.a === 'raise';
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
  for (const { seat } of r.seats) {
    const c = acc.get(seat) ?? zero();
    acc.set(seat, c);
    c.hands++;
    const p = per.get(seat);
    if (p?.vpip) c.vpip++;
    if (p?.pfr) c.pfr++;
    if (p?.opp3) c.threeOpp++;
    if (p?.did3) c.three++;
    const post = acts.filter((a) => a.seat === seat && a.street > 0);
    for (const a of post) {
      if (a.a === 'bet' || a.a === 'raise') c.aggr++;
      else if (a.a === 'call') c.calls++;
    }
    if (acts.some((a) => a.seat === seat && a.street === 1)) {
      c.saw++;
      if (r.showdown && r.shown[seat]) c.sd++;
    }
  }
  // продолженная ставка: последний агрессор до флопа ходит на второй улице, и перед ним никто не ставил
  if (lastAgg >= 0) {
    const s1 = acts.filter((a) => a.street === 1);
    const i = s1.findIndex((a) => a.seat === lastAgg);
    if (i >= 0 && !s1.slice(0, i).some((a) => a.a === 'bet' || a.a === 'raise')) {
      const c = acc.get(lastAgg)!;
      c.cbetOpp++;
      if (s1[i].a === 'bet' || s1[i].a === 'raise') c.cbet++;
    }
  }
}

const pc = (a: number, b: number) => (b ? (100 * a) / b : 0);

/** Проценты и AF. */
export function summary(c: Counts) {
  return {
    hands: c.hands,
    vpip: pc(c.vpip, c.hands),
    pfr: pc(c.pfr, c.hands),
    threeBet: pc(c.three, c.threeOpp),
    af: c.calls ? c.aggr / c.calls : c.aggr,
    cbet: pc(c.cbet, c.cbetOpp),
    wtsd: pc(c.sd, c.saw),
  };
}
