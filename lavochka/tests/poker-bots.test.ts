/* Покер: боты «как живые» — стили дают свои VPIP/PFR (меряем по HandRecord, как HUD), сложный обыгрывает лёгкого,
 * ход бота укладывается во время, ICM считается верно, таблицы пуш/фолда согласованы.
 * Обычный прогон — короткий; длинный: SIM_GAMES=40 npm test -- poker-bots (раздач — 150 × SIM_GAMES). */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose, tune } from '../src/games/poker/ai';
import { apply, cfgFrom, deal, makeView, newState, type Event, type HandRecord, type State } from '../src/games/poker/engine';
import { PROFILES, SEAT_PROFILE } from '../src/games/poker/profiles';
import { addHand, summary, type Counts } from '../src/games/poker/stats';
import { bubbleFactor, icm, icmCallEquity } from '../src/games/poker/icm';
import { PREFLOP } from '../src/games/poker/ranges';
import { classIdx, fastHigh, fastLow8, fastLow8Omaha, fastOmaha } from '../src/games/poker/eval';
import { allCards, high, highSD, low8, omahaHigh } from '../src/games/poker/hands';

const SIM = Number(process.env.SIM_GAMES || 0);

/** Сыграть hands отдельных раздач (стеки каждый раз заново — как кэш-стол), вернуть истории.
 * Время от времени отпускает поток, чтобы vitest успевал общаться с воркером на длинных прогонах. */
async function play(opts: Record<string, string | number | boolean>, seats: number[], levels: number[], hands: number, seed: number): Promise<HandRecord[]> {
  const rng = new SeededRng(seed);
  const cfg = { ...cfgFrom({ every: 0, ...opts }), hands: 1 };
  const recs: HandRecord[] = [];
  for (let h = 0; h < hands; h++) {
    if (h % 20 === 19) await pause();
    const s0 = newState(cfg, seats);
    s0.button = seats[h % seats.length];
    let s: State = deal(s0, rng).state;
    for (let guard = 0; guard < 400 && !s.over; guard++) {
      const seat = s.turn;
      const a = choose(makeView(s, [seat]), seat, levels[seats.indexOf(seat)], rng);
      const r = a && apply(s, seat, a, rng);
      if (!r) throw new Error(`ход отклонён: ${JSON.stringify(a)}`);
      const ev = r.events.find((e): e is Extract<Event, { type: 'hand' }> => e.type === 'hand');
      if (ev) recs.push(ev.rec);
      s = r.state;
    }
  }
  return recs;
}

/** Отпустить поток: на длинных синхронных прогонах воркер vitest иначе не успевает отчитаться. */
const pause = () => new Promise((r) => setTimeout(r, 0));
const fmt = (x: number) => x.toFixed(1).padStart(5);

describe('стили ботов', () => {
  it('VPIP и PFR каждого стиля — в своих пределах (6 игроков, холдем, 100 ББ)', async () => {
    const seats = [0, 1, 2, 3, 4, 5];
    const hands = SIM ? 150 * SIM : 900;
    const acc = new Map<number, Counts>();
    for (const lv of [0, 1, 2]) for (const r of await play({ mode: 'holdem', stack: 2000 }, seats, seats.map(() => lv), hands / 3, 11 + lv)) addHand(acc, r);
    const rows = seats.map((p) => ({ p, pr: PROFILES[SEAT_PROFILE[p]], s: summary(acc.get(p)!) }));
    console.log(
      `Стили ботов, ${hands} раздач:\n` +
        'стиль                       VPIP   PFR  3-бет   AF  C-бет  WTSD\n' +
        rows.map(({ pr, s }) => `${pr.name.padEnd(26)} ${fmt(s.vpip)} ${fmt(s.pfr)} ${fmt(s.threeBet)} ${s.af.toFixed(2).padStart(5)} ${fmt(s.cbet)} ${fmt(s.wtsd)}`).join('\n'),
    );
    for (const { pr, s } of rows) {
      expect(s.vpip, `${pr.name}: VPIP`).toBeGreaterThanOrEqual(pr.target.vpip[0]);
      expect(s.vpip, `${pr.name}: VPIP`).toBeLessThanOrEqual(pr.target.vpip[1]);
      expect(s.pfr, `${pr.name}: PFR`).toBeGreaterThanOrEqual(pr.target.pfr[0]);
      expect(s.pfr, `${pr.name}: PFR`).toBeLessThanOrEqual(pr.target.pfr[1]);
      if (SIM) {
        expect(s.af, `${pr.name}: AF`).toBeGreaterThanOrEqual(pr.target.af[0]);
        expect(s.af, `${pr.name}: AF`).toBeLessThanOrEqual(pr.target.af[1]);
      }
    }
    // узнаваемость: маньяк агрессивнее всех, нит — уже всех
    const by = (id: string) => rows.find((r) => r.pr.id === id)!.s;
    expect(by('maniac').pfr).toBeGreaterThan(by('lag').pfr);
    expect(by('lag').vpip).toBeGreaterThan(by('tag').vpip);
    expect(by('tag').vpip).toBeGreaterThan(by('nit').vpip);
    expect(by('station').vpip - by('station').pfr).toBeGreaterThan(by('tag').vpip - by('tag').pfr);
  }, 300_000);

  it('другие виды и полный стол: стили различимы (Омаха, Short Deck, стад, холдем на 9)', async () => {
    const cases: [string, Record<string, string | number | boolean>, number][] = [
      ['Омаха', { mode: 'omaha4', stack: 2000 }, 6],
      ['Short Deck', { mode: 'shortdeck', stack: 2000, ante: 'all' }, 6],
      ['Стад-7', { mode: 'stud7', stack: 2000 }, 6],
      ['Холдем на 9', { mode: 'holdem', stack: 2000 }, 9],
    ];
    const lines: string[] = [];
    for (const [name, opts, n] of cases) {
      const seats = Array.from({ length: n }, (_, i) => i);
      const acc = new Map<number, Counts>();
      for (const r of await play(opts, seats, seats.map(() => 1), SIM ? 40 * SIM : 240, 7)) addHand(acc, r);
      const s = (p: number) => summary(acc.get(p)!);
      lines.push(`${name.padEnd(12)} ` + seats.slice(0, 6).map((p) => `${PROFILES[SEAT_PROFILE[p]].id} ${s(p).vpip.toFixed(0)}/${s(p).pfr.toFixed(0)}`).join('  '));
      // маньяк входит чаще нита и рейзит чаще колл-станции
      expect(s(4).vpip, name).toBeGreaterThan(s(2).vpip);
      expect(s(4).pfr, name).toBeGreaterThan(s(3).pfr);
    }
    console.log(`VPIP/PFR по видам (средний уровень):\n${lines.join('\n')}`);
  }, 300_000);

  it('сложный обыгрывает лёгкого на дистанции (стили поровну с обеих сторон)', async () => {
    const seats = [0, 1, 2, 3, 4, 5];
    const hands = SIM ? 100 * SIM : 240;
    let hard = 0;
    let easy = 0;
    for (const flip of [0, 1]) {
      const levels = seats.map((_, i) => ((i + flip) % 2 ? 0 : 2));
      for (const r of await play({ mode: 'holdem', stack: 2000 }, seats, levels, hands / 2, 50 + flip))
        for (const [p, v] of Object.entries(r.net)) {
          if (levels[seats.indexOf(Number(p))] === 2) hard += v;
          else easy += v;
        }
    }
    const bb100 = (x: number) => (x / 20 / (hands * 3)) * 100;
    console.log(`Сложный против лёгкого, ${hands} раздач: сложные ${bb100(hard).toFixed(1)} ББ/100 на место, лёгкие ${bb100(easy).toFixed(1)}`);
    expect(hard + easy).toBe(0);
    if (SIM) expect(hard).toBeGreaterThan(0);
  }, 600_000);

  it('ход бота быстрый: холдем и Омаха на 6 мест, полный режим', async () => {
    const was = tune.fast;
    tune.fast = false;
    try {
      for (const o of [{ mode: 'holdem' }, { mode: 'omaha4' }, { mode: 'omaha5' }, { mode: 'omaha4', hilo: true, struct: 'limit' }] as Record<string, string | boolean>[]) {
        const rng = new SeededRng(3);
        const seats = [0, 1, 2, 3, 4, 5];
        let worst = 0;
        let total = 0;
        let n = 0;
        let s: State = deal(newState(cfgFrom({ ...o, every: 0, stack: 2000 }), seats), rng).state;
        for (let i = 0; i < 160 && !s.over; i++) {
          if (i % 20 === 19) await pause();
          const t = performance.now();
          const a = choose(makeView(s, [s.turn]), s.turn, 2, rng);
          const dt = performance.now() - t;
          if (i > 3) {
            worst = Math.max(worst, dt);
            total += dt;
            n++;
          }
          s = apply(s, s.turn, a!, rng)!.state;
        }
        console.log(`${JSON.stringify(o)}: ход сложного бота — в среднем ${(total / n).toFixed(1)} мс, худший ${worst.toFixed(1)} мс`);
        // на телефоне в 3–5 раз медленнее: ~60 мс здесь — до ~300 мс там
        expect(total / n).toBeLessThan(40);
        expect(worst).toBeLessThan(150);
      }
    } finally {
      tune.fast = was;
    }
  }, 120_000);
});

describe('быстрая оценка рук', () => {
  it('совпадает с точной (холдем, Short Deck, Омаха, лоу «8 или лучше»)', async () => {
    const rng = new SeededRng(99);
    const deal = (sd: boolean, n: number) => {
      const d = allCards(sd);
      for (let i = d.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [d[i], d[j]] = [d[j], d[i]];
      }
      return d.slice(0, n);
    };
    for (let k = 0; k < 4000; k++) {
      if (k % 500 === 499) await pause();
      const sd = k % 3 === 0;
      const cs = deal(sd, 5 + (k % 3));
      expect(fastHigh(cs, sd)).toBe(sd ? highSD(cs) : high(cs));
      const o = deal(false, 9);
      expect(fastOmaha(o.slice(0, 4), o.slice(4))).toBe(omahaHigh(o.slice(0, 4), o.slice(4)));
      expect(fastLow8Omaha(o.slice(0, 4), o.slice(4))).toBe(low8([], { hole: o.slice(0, 4), board: o.slice(4) }));
      expect(fastLow8(o.slice(0, 7))).toBe(low8(o.slice(0, 7)));
    }
  });
});

describe('ICM и пуш/фолд', () => {
  it('Малмут–Харвилл: известный пример 50/30/20 с выплатами 50/30/20', () => {
    const eq = icm([5000, 3000, 2000], [50, 30, 20]);
    expect(eq.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    expect(eq[0]).toBeCloseTo(38.393, 2);
    expect(eq[2]).toBeGreaterThan(20 * 1.0);
    // лидер получает меньше доли фишек, короткий — больше
    expect(eq[0]).toBeLessThan(50);
    expect(eq[2]).toBeGreaterThan(20);
    // равные стеки — поровну; вдвоём — ровно по доле фишек
    for (const x of icm([10, 10, 10, 10], [5, 3, 2])) expect(x).toBeCloseTo(2.5, 9);
    const two = icm([3000, 1000], [70, 30]);
    expect(two[0]).toBeCloseTo(30 + 40 * 0.75, 9);
    // вылетевший занимает последнее место
    expect(icm([5000, 5000, 0], [50, 30, 20])[2]).toBe(20);
  });
  it('на пузыре колл дороже: нужно больше шансов, чем в кэше; фактор пузыря > 1', () => {
    const st = [4000, 3000, 2000, 1000];
    const pr = [50, 30, 20];
    expect(bubbleFactor(st, pr, 1, 0, 1000)).toBeGreaterThan(1.2);
    const need = icmCallEquity(st, pr, 1, 0, 3000, 0);
    expect(need).toBeGreaterThan(0.5);
    // без призов за места (победитель забирает всё) — почти как фишки
    expect(bubbleFactor([5000, 5000], [100], 0, 1, 1000)).toBeCloseTo(1, 6);
  });
  it('короткий стек: сложный идёт ва-банк с AA и сбрасывает 72o с первой позиции; ICM на пузыре не ломает ход', () => {
    const C = (r: number, su: 'S' | 'H' | 'D' | 'C') => ({ r, s: su });
    for (const prizes of [undefined, [50, 30, 20]]) {
      const rng = new SeededRng(4);
      const seats = [0, 1, 2, 3, 4, 5];
      const cfg = { ...cfgFrom({ mode: 'holdem', every: 0, stack: 1000 }), ...(prizes ? { prizes } : {}) };
      const s0 = newState(cfg, seats);
      for (const p of seats) s0.chips[p] = 160;
      const s = deal(s0, rng).state;
      const me = s.turn;
      s.hole[me] = [C(14, 'S'), C(14, 'H')];
      expect(choose(makeView(s, [me]), me, 2, rng)).toEqual({ type: 'allin' });
      s.hole[me] = [C(7, 'S'), C(2, 'H')];
      expect(choose(makeView(s, [me]), me, 2, rng)).toEqual({ type: 'fold' });
      // ва-банк перед нами — с AA колл, с 72o пас
      const r = apply(s, me, { type: 'allin' }, rng)!.state;
      const next = r.turn;
      r.hole[next] = [C(14, 'D'), C(14, 'C')];
      expect(choose(makeView(r, [next]), next, 2, rng)!.type).toMatch(/call|allin/);
      r.hole[next] = [C(7, 'D'), C(2, 'C')];
      expect(choose(makeView(r, [next]), next, 2, rng)).toEqual({ type: 'fold' });
    }
  });
  it('таблицы Нэша: тузы — всегда, 72o — только совсем коротким; позже позиция — шире', () => {
    const AA = classIdx('AA');
    const s72 = classIdx('72o');
    const K9 = classIdx('K9o');
    for (let k = 1; k <= 8; k++) expect(PREFLOP.push[k][AA]).toBe(20);
    expect(PREFLOP.push[8][s72]).toBeLessThanOrEqual(1);
    expect(PREFLOP.push[1][K9]).toBeGreaterThan(PREFLOP.push[5][K9]);
    const width = (k: number, S: number) => PREFLOP.push[k].reduce((a, v, i) => a + (v >= S ? (PREFLOP.classes[i].length === 2 ? 6 : PREFLOP.classes[i][2] === 's' ? 4 : 12) : 0), 0) / 13.26;
    // хедз-ап, 10 ББ: малый блайнд идёт ва-банк примерно с 55–65% рук
    expect(width(1, 10)).toBeGreaterThan(50);
    expect(width(1, 10)).toBeLessThan(70);
    for (let k = 2; k <= 8; k++) expect(width(k, 10)).toBeLessThanOrEqual(width(k - 1, 10) + 0.5);
  });
});
