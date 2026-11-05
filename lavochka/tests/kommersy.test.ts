/* «Коммерсы»: календарь и дорога, сделки и часы, исторические даты, падения, покупка клуба; партии ботов и прикидка баланса. */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { CARDS, CLUB_PRICE, LAST, SEG_CELLS, dateText, mm, segMonths } from '../src/games/kommersy/data';
import { def } from '../src/games/kommersy/def';
import { choose } from '../src/games/kommersy/bot';
import { applyFx, apply, availableDeals, bookSum, cardOk, clubCheck, clubReady, fxHint, newState, view, worth, type Action, type State } from '../src/games/kommersy/engine';
import { botSeats, simulate } from './harness';

function act(s: State, seat: number, a: Action, rig?: number[]): State {
  const r = new RiggedRng(new SeededRng(7));
  r.rig(rig);
  const res = apply(s, seat, a, r);
  expect(res, JSON.stringify(a)).not.toBeNull();
  return res!.state;
}

describe('Коммерсы: календарь', () => {
  it('май 1988 → июль 2003, кризисы помесячно', () => {
    expect(dateText(0)).toBe('май 1988');
    expect(dateText(LAST)).toBe('июль 2003');
    expect(segMonths(0)).toBe(3);
    expect(segMonths(mm(1998, 8))).toBe(1);
    expect(segMonths(mm(1990, 11))).toBe(2); // отрезок не залезает в кризис января 1991
  });
});

describe('Коммерсы: ход', () => {
  it('бросок → игрок ставит фишку сам → клетка задаёт вопрос', () => {
    let s = newState([0, 1]);
    s = act(s, 0, { type: 'roll' }, [0]);
    expect(s.phase).toBe('move');
    s = act(s, 0, { type: 'move' }, [0, 15, 15]);
    expect(s.players[0].pos).toBe(1);
    expect(s.ask?.deals?.[0].id).toBe('deficit');
    expect(s.ask!.choices.at(-1)!.buy).toBe('pass');
    s = act(s, 0, { type: 'choose', i: 0 });
    expect(s.players[0].assets[0].name).toBe('Перепродажа дефицита');
    expect(s.players[0].cash).toBeLessThan(300);
    expect(s.turn).toBe(1);
  });

  it('дальше конца отрезка не уйти; дошли все — новый квартал, доходы и новая дорога', () => {
    let s = newState([0, 1]);
    s.players[0].pos = SEG_CELLS;
    s.players[1].pos = SEG_CELLS + 1;
    const cash = s.players[0].cash;
    s = act(s, 0, { type: 'roll' }, [5]);
    s = act(s, 0, { type: 'move' });
    expect(s.m).toBe(3);
    expect(s.players.every((p) => p.pos === 0)).toBe(true);
    expect(s.players[0].cash).not.toBe(cash);
  });

  it('лишние очки кубика переходят в новый отрезок: первым ходом фишка досходит их без броска', () => {
    let s = newState([0]);
    s.players[0].pos = SEG_CELLS - 1; // до конца две клетки, выпало 5 — три переходят
    s = act(s, 0, { type: 'roll' }, [4]);
    s = act(s, 0, { type: 'move' });
    expect(s.m).toBe(3);
    expect(s.phase).toBe('move');
    expect(s.roll).toBeNull();
    expect(s.target).toBe(3);
    s = act(s, 0, { type: 'move' }, [0, 0, 0, 0]);
    expect(s.players[0].pos).toBe(3);
    expect(s.players[0].carry).toBe(0);
  });

  it('с управляющим доход дела в виде — уже за вычетом его доли', () => {
    const s = newState([0], { start: mm(1994, 1) });
    const p = s.players[0];
    p.assets = [{ uid: 1, id: 'larek', name: 'Ларёк', kind: 'biz', value: 3000, income: 1000, hours: 60, manager: false, mul: 1 }];
    expect(view(s, [0]).players[0].assets[0].now).toBe(1000);
    p.assets[0].manager = true;
    expect(view(s, [0]).players[0].assets[0].now).toBe(880);
  });

  it('нет часов на своё дело — берётся с управляющим', () => {
    let s = newState([0]);
    s.players[0].job = { name: 'две работы', salary: 100, hours: 210 };
    s = act(s, 0, { type: 'roll' }, [0]);
    s = act(s, 0, { type: 'move' }, [0, 15, 15]);
    expect(s.ask!.deals![0].mgr).toBe(true);
    expect(s.ask!.choices[0].label).toContain('управляющ');
    s = act(s, 0, { type: 'choose', i: 0 });
    expect(s.players[0].assets[0].manager).toBe(true);
  });
});

describe('Коммерсы: что предлагают клетки', () => {
  const card = (id: string) => CARDS.find((c) => c.id === id)!;

  it('женат и с квартирой матери — такие карточки больше не выпадают; разовые покупки тоже', () => {
    const s = newState([0], { start: mm(1996, 1) });
    const p = s.players[0];
    p.cash = 1e6;
    for (const id of ['w-svadba', 'w-mama', 'w-mers', 'n-mobila', 'n-voditel', 'n-strah']) expect(cardOk(s, p, card(id)), id).toBe(true);
    for (const id of ['w-svadba', 'w-mama', 'w-mers', 'n-mobila', 'n-voditel', 'n-strah']) applyFx(s, p, card(id).choices[0].fx, new SeededRng(1), []);
    for (const id of ['w-svadba', 'w-mama', 'w-mers', 'n-mobila', 'n-voditel', 'n-strah']) expect(cardOk(s, p, card(id)), id).toBe(false);
  });

  it('уже под ментами — их охранное агентство не предлагают', () => {
    const s = newState([0], { start: mm(1996, 1) });
    const p = s.players[0];
    p.cash = 1e6;
    expect(cardOk(s, p, card('n-krysha'))).toBe(true);
    p.krysha = 'police';
    expect(cardOk(s, p, card('n-krysha'))).toBe(false);
  });

  it('«Расширяться?» приходит, только если есть что и на что расширять', () => {
    const s = newState([0], { start: mm(1994, 1) });
    const p = s.players[0];
    const asset = (id: string) => ({ uid: 1, id, name: id, kind: 'biz' as const, value: 3000, income: 900, hours: 60, manager: false, mul: 1 });
    p.cash = 1e6;
    p.assets = [asset('obmennik')]; // обменнику расти некуда
    expect(cardOk(s, p, card('n-grow'))).toBe(false);
    p.assets = [asset('larek')];
    expect(cardOk(s, p, card('n-grow'))).toBe(true);
    expect(fxHint(s, p, card('n-grow').choices[0].fx).join()).toContain('Сеть ларьков');
    p.cash = 100; // есть куда, но не на что
    expect(cardOk(s, p, card('n-grow'))).toBe(false);
  });

  it('«Крыша просит» — только тому, у кого крыша; «Отравление» — только хозяину водочного цеха, и цех закрывается', () => {
    const s = newState([0], { start: mm(1995, 1) });
    const p = s.players[0];
    p.cash = 1e6;
    p.assets = [{ uid: 1, id: 'larek', name: 'Ларёк', kind: 'biz', value: 3000, income: 900, hours: 60, manager: false, mul: 1 }];
    expect(cardOk(s, p, card('k-krysha-dan'))).toBe(false);
    p.krysha = 'bandit';
    expect(cardOk(s, p, card('k-krysha-dan'))).toBe(true);
    expect(cardOk(s, p, card('c-palenka'))).toBe(false);
    p.assets.push({ uid: 2, id: 'palenka', name: 'Водочный цех', kind: 'biz', value: 40000, income: 15000, hours: 50, manager: false, mul: 1 });
    expect(cardOk(s, p, card('c-palenka'))).toBe(true);
    applyFx(s, p, card('c-palenka').choices[1].fx, new SeededRng(1), []);
    expect(p.assets.map((a) => a.id)).toEqual(['larek']);
  });

  it('расширить дело можно и самому, кнопкой: своё в зачёт, доплата 80 % разницы', () => {
    let s = newState([0], { start: mm(1994, 1) });
    const p = s.players[0];
    p.cash = 30000;
    p.assets = [{ uid: 1, id: 'larek', name: 'Ларёк', kind: 'biz', value: 3000, income: 900, hours: 60, manager: false, mul: 0.7 }];
    const g = view(s, [0]).players[0].assets[0].grow!;
    expect(g.name).toBe('Сеть ларьков');
    expect(g.cost).toBe(21600);
    expect(g.why).toBeNull();
    s = act(s, 0, { type: 'grow', uid: 1 });
    expect(s.players[0].assets[0]).toMatchObject({ id: 'set-larkov', value: 30000, mul: 1 });
    expect(s.players[0].cash).toBe(30000 - 21600);
    s.players[0].cash = 0;
    s.players[0].assets[0] = { ...s.players[0].assets[0], id: 'larek', value: 3000 };
    expect(apply(s, 0, { type: 'grow', uid: 1 }, new SeededRng(1))).toBeNull(); // не на что
  });

  it('клетка «Сделка» всегда с делами, как бы капитал ни обогнал время', () => {
    for (let m = 0; m <= LAST; m++)
      for (const cash of [0, 5e3, 5e4, 5e5, 5e6, 5e7, 2e8, 1e9]) {
        const s = newState([0]);
        s.m = m;
        s.players[0].cash = cash;
        expect(availableDeals(s, s.players[0]).length, `${dateText(m)}, ${cash}`).toBeGreaterThan(0);
      }
  });
});

describe('Коммерсы: одно дело каждого вида', () => {
  it('своё дело второй раз не предлагают, недвижимость и бумаги — можно', () => {
    const s = newState([0], { start: mm(1996, 1) });
    const p = s.players[0];
    p.cash = 1e6;
    const asset = (id: string, kind: 'biz' | 'estate') => ({ uid: s.uid++, id, name: id, kind, value: 1000, income: 100, hours: 1, manager: false, mul: 1 });
    expect(availableDeals(s, p).some((d) => d.id === 'dolya-zavoda')).toBe(true);
    p.assets = [asset('dolya-zavoda', 'biz'), asset('ofis', 'estate')];
    const ids = availableDeals(s, p).map((d) => d.id);
    expect(ids).not.toContain('dolya-zavoda');
    expect(ids).toContain('ofis');
  });

  it('расширить дело в то, что уже есть, нельзя', () => {
    const s = newState([0], { start: mm(1996, 1) });
    const p = s.players[0];
    p.cash = 1e7;
    const asset = (id: string) => ({ uid: s.uid++, id, name: id, kind: 'biz' as const, value: 1000, income: 100, hours: 1, manager: false, mul: 1 });
    p.assets = [asset('magazin')];
    expect(cardOk(s, p, CARDS.find((c) => c.id === 'n-grow')!)).toBe(true);
    p.assets.push(asset('set-magazinov'));
    expect(cardOk(s, p, CARDS.find((c) => c.id === 'n-grow')!)).toBe(false);
  });
});

describe('Коммерсы: тюрьма', () => {
  // второй игрок сидит, первый доводит отрезок до «Нового квартала»
  const jailed = (out: number, heat: number) => {
    const s = newState([0, 1], { start: mm(1996, 1) });
    s.players[0].pos = SEG_CELLS;
    Object.assign(s.players[1], { pos: SEG_CELLS + 1, out, outKind: 'jail' });
    s.players[1].stats.heat = heat;
    return s;
  };
  const quarter = (s: State) => act(act(s, 0, { type: 'roll' }, [5]), 0, { type: 'move' });

  it('вышел с любым вниманием органов — обратно сразу не забирают, внимание падает', () => {
    const p = quarter(jailed(1, 100)).players[1];
    expect(p.out).toBe(0);
    expect(p.falls).toHaveLength(0);
    expect(p.stats.heat).toBeLessThanOrEqual(30);
  });

  it('за решёткой водочный цех внимания не добавляет', () => {
    const s = jailed(9, 40);
    s.players[1].assets = [1, 2, 3].map((uid) => ({ uid, id: 'palenka', name: 'Водочный цех', kind: 'biz' as const, value: 40000, income: 15000, hours: 50, manager: true, mul: 1 }));
    const p = quarter(s).players[1];
    expect(p.outKind).toBe('jail');
    expect(p.stats.heat).toBeLessThanOrEqual(40);
  });
});

describe('Коммерсы: эпоха и падения', () => {
  it('павловская реформа: неподготовленный теряет треть наличных, подготовленный — нет', () => {
    let s = newState([0, 1]);
    s.m = mm(1990, 10);
    s.len = 3;
    for (const p of s.players) {
      p.cash = 10000;
      p.job = null;
      p.pos = SEG_CELLS + 1;
    }
    s.players[1].prep.push('pavlov');
    s.players[0].pos = SEG_CELLS;
    s = act(s, 0, { type: 'roll' }, [5]);
    s = act(s, 0, { type: 'move' });
    expect(s.fired).toContain('pavlov');
    expect(s.players[0].cash).toBeLessThan(s.players[1].cash * 0.8);
  });

  it('долги больше имущества — разорение и «Падал, но поднимался»: игра продолжается', () => {
    let s = newState([0]);
    s.players[0].cash = -50000;
    s.players[0].stats.name = 0;
    s.players[0].pos = SEG_CELLS;
    s = act(s, 0, { type: 'roll' }, [0]);
    s = act(s, 0, { type: 'move' });
    expect(s.players[0].falls.map((f) => f.kind)).toContain('razor');
    expect(s.players[0].cash).toBeGreaterThan(0);
    expect(s.phase).toBe('roll');
  });

  it('клуб: все условия — покупка на «Выходном» и конец партии', () => {
    let s = newState([0]);
    const p = s.players[0];
    Object.assign(p, { cash: CLUB_PRICE + 1e6, job: null, advisor: true });
    Object.assign(p.stats, { name: 80, svyazi: 80, heat: 0 });
    expect(clubReady(s, p)).toBe(true);
    s.cells[0] = 'rest';
    s = act(s, 0, { type: 'roll' }, [0]);
    s = act(s, 0, { type: 'move' }, [0]);
    expect(s.ask!.choices[0].buy).toBe('club');
    s = act(s, 0, { type: 'choose', i: 0 });
    expect(s.phase).toBe('over');
    expect(def.result(s)!.text).toContain('Лондон Юнайтед');
  });

  it('клуб: всё готово — купить можно и в конце квартала; «Ещё не время» — квартал идёт дальше', () => {
    const ready = () => {
      const s = newState([0]);
      Object.assign(s.players[0], { cash: CLUB_PRICE + 1e6, job: null, advisor: true, pos: SEG_CELLS });
      Object.assign(s.players[0].stats, { name: 80, svyazi: 80, heat: 0 });
      return act(act(s, 0, { type: 'roll' }, [0]), 0, { type: 'move' });
    };
    let s = ready();
    expect(s.ask!.cell).toBe('period');
    expect(s.ask!.choices[0].buy).toBe('club');
    s = act(s, 0, { type: 'choose', i: 0 });
    expect(s.phase).toBe('over');
    const m = ready().m;
    s = act(ready(), 0, { type: 'choose', i: 1 });
    expect(s.phase).toBe('roll');
    expect(s.m).toBeGreaterThan(m);
  });

  it('совесть и внимание органов соперникам не видны', () => {
    const s = newState([0, 1]);
    const v = view(s, [0]);
    expect(v.players[1].stats.heat).toBeUndefined();
    expect(v.players[1].stats.sovest).toBeUndefined();
    expect(v.my!.heatHint).toBeTruthy();
  });
});

describe('Коммерсы: торги и «Бухгалтерия»', () => {
  it('не по карману — право на торги: купивший платит наценку продавцу; никто — сделка уходит', () => {
    let s = newState([0, 1, 2]);
    s.players[0].cash = 0;
    s.players[0].stats.name = 0;
    s.players[1].cash = 0;
    s.players[1].stats.name = 0;
    s.players[2].cash = 5000;
    s = act(s, 0, { type: 'roll' }, [0]);
    s = act(s, 0, { type: 'move' }, [0, 15, 15]);
    const auc = s.ask!.choices.findIndex((c) => c.buy === 'auction');
    expect(auc).toBeGreaterThan(-1);
    const price = s.ask!.deals![s.ask!.choices[auc].di!].price;
    s = act(s, 0, { type: 'choose', i: auc });
    // Серёге не по карману — право сразу у третьего
    expect(s.ask?.auction?.seller).toBe(0);
    expect(s.ask!.seat).toBe(2);
    s = act(s, 2, { type: 'choose', i: 0 });
    const fee = Math.round(price * 0.1);
    expect(s.players[0].cash).toBe(fee);
    expect(s.players[2].assets).toHaveLength(1);
    expect(s.players[2].cash).toBe(5000 - price - fee);
    expect(s.turn).toBe(1);
  });

  it('один — торгов нет', () => {
    let s = newState([0]);
    s.players[0].cash = 0;
    s.players[0].stats.name = 0;
    s = act(s, 0, { type: 'roll' }, [0]);
    s = act(s, 0, { type: 'move' }, [0, 15, 15]);
    expect(s.ask!.choices.some((c) => c.buy === 'auction')).toBe(false);
  });

  it('конец отрезка ждёт разноски всех; сошлось — органы спокойнее, нет — внимание растёт', () => {
    let s = newState([0, 1], { buh: true });
    s.players[0].pos = SEG_CELLS;
    s.players[1].pos = SEG_CELLS + 1;
    s.players[0].stats.heat = 20;
    s.players[1].stats.heat = 20;
    s = act(s, 0, { type: 'roll' }, [0]);
    s = act(s, 0, { type: 'move' });
    expect(s.phase).toBe('buh');
    expect(def.toAct(s).sort()).toEqual([0, 1]);
    const v = view(s, [0]);
    expect(v.books.map((b) => b.seat)).toEqual([0]);
    const right = bookSum(v.books[0]);
    expect(right).toBe(3 * (55 - 32));
    s = act(s, 1, { type: 'buh', sum: -999 });
    expect(s.phase).toBe('buh');
    expect(def.toAct(s)).toEqual([0]);
    const m = s.m;
    s = act(s, 0, { type: 'buh', sum: right });
    expect(s.phase).toBe('roll');
    expect(s.m).toBe(m + 3);
    expect(s.players[0].stats.heat).toBeLessThan(s.players[1].stats.heat);
  });

  it('соперники: демпинг бьёт по общей нише, донос — по органам соперника и совести стукача; раз за отрезок', () => {
    let s = newState([0, 1]);
    const biz = (uid: number) => ({ uid, id: 'larek', name: 'Ларёк', kind: 'biz' as const, value: 3000, income: 900, hours: 60, manager: false, mul: 1 });
    s.players[0].assets = [biz(1)];
    s.players[1].assets = [biz(2)];
    s.players[0].cash = s.players[1].cash = 5000;
    s = act(s, 0, { type: 'rival', kind: 'demping', target: 1 });
    expect(s.players[1].assets[0].mul).toBeCloseTo(0.8);
    expect(s.players[0].assets[0].mul).toBeCloseTo(0.95);
    expect(apply(s, 0, { type: 'rival', kind: 'donos', target: 1 }, new SeededRng(1))).toBeNull();
    expect(view(s, [0]).my!.rivals[0].acts.find((x) => x.kind === 'donos')!.why).toBe('уже было в этом отрезке');
    // наезд — только с братвой
    let t = newState([0, 1]);
    expect(apply(t, 0, { type: 'rival', kind: 'naezd', target: 1 }, new SeededRng(1))).toBeNull();
    const heat = t.players[1].stats.heat;
    const sov = t.players[0].stats.sovest;
    t = act(t, 0, { type: 'rival', kind: 'donos', target: 1 });
    expect(t.players[1].stats.heat).toBe(heat + 15);
    expect(t.players[0].stats.sovest).toBe(sov - 10);
  });

  it('партии ботов с «Бухгалтерией» доходят до конца', async () => {
    const r = await simulate(def, botSeats(def, 3, [0, 1, 2]), { start: mm(1998, 9), diff: 1, chance: 0, buh: true }, 5, 60000);
    expect(r.error).toBeUndefined();
    expect(r.finished).toBe(true);
  }, 60000);
});

describe('Коммерсы: партии ботов', () => {
  it('одиночные и сетевые партии доходят до июля 2003 или до клуба', async () => {
    for (const [n, seed] of [[1, 1], [3, 2], [6, 3]]) {
      const r = await simulate(def, botSeats(def, n, [0, 1, 2]), { start: 0, diff: 1, chance: 0 }, seed, 60000);
      expect(r.error).toBeUndefined();
      expect(r.finished).toBe(true);
    }
  }, 120000);

  it('прикидка баланса: Сложный один, 12 партий', () => {
    const rows: string[] = [];
    let clubs = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const rng = new SeededRng(seed);
      const bot = new SeededRng(seed * 31);
      let s = newState([0], { diff: 1 }, ['kolyan'], rng);
      for (let i = 0; i < 20000 && s.phase !== 'over'; i++) {
        const a = choose(view(s, [0]), 0, 2, bot)!;
        s = apply(s, 0, a, rng)!.state;
      }
      const p = s.players[0];
      if (p.club) clubs++;
      const miss = p.club ? '' : ' нет: ' + clubCheck(s, p).filter((c) => !c.ok).map((c) => c.id).join(',');
      rows.push(`${seed}: ${dateText(Math.min(s.m, LAST))} ${p.ending} капитал ${Math.round(worth(p)).toLocaleString('ru')} падений ${p.falls.length} имя ${p.stats.name} связи ${p.stats.svyazi} англ ${p.skills.english}${miss}`);
    }
    console.log(`клуб в ${clubs}/12\n` + rows.join('\n'));
    expect(rows.length).toBe(12);
  }, 120000);
});
