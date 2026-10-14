/* «Шёл солдат со службы»: поле, предметы, ярмарка чудес, котомка, петли и выбор на препятствиях. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import board from '../src/games/hodilki/data/shel.json';
import branches from '../src/games/hodilki/data/shel-branches.json';
import items from '../src/games/shel/items.json';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { bagOf, canPack, type Event, type State } from '../src/games/hodilki/core';
import { boardOf, def } from '../src/games/hodilki/def';
import { BARS, shelBoard } from '../src/games/hodilki/shel';
import { signOf } from '../src/games/hodilki/nastolki';
import { simulate } from './harness';

const seats = [0, 1].map((seat) => ({ seat, kind: 'human' as const, name: 'x', level: 0 }));
const b = boardOf('shel');

/** Номер клетки по подписи с поля (1…140). */
const at = (n: number) => n - 1;

/** Бросок с заданным кубиком и ход. */
function turn(s: State, seat: number, die: number, rng: RiggedRng) {
  rng.rig([die - 1]);
  const r1 = def.apply(s, seat, { type: 'roll' }, rng)!;
  expect(r1, 'бросок').not.toBeNull();
  const r2 = def.apply(r1.state, seat, { type: 'move' }, rng)!;
  expect(r2, 'ход').not.toBeNull();
  if (process.env.SHEL_DBG) console.log('DBG turn', 'from', s.pos[seat], 'die', die, 'last', r1.state.last, 'pos', r2.state.pos[0], 'phase', r2.state.phase);
  return r2;
}

/** Начало партии с пуговицей на клетке `cell`, ход Вовки. */
function stand(cell: number, opts: { cards?: string[]; flags?: string[]; stock?: Record<string, number> } = {}) {
  const rng = new RiggedRng(new SeededRng(5));
  const s = def.setup(seats, { map: 'shel' }, rng) as State;
  return {
    ...s,
    pos: s.pos.map((_, i) => (i === 0 ? cell : 0)),
    turn: 0,
    cards: [opts.cards ?? [], null] as unknown as State['cards'],
    flags: [opts.flags ?? [], null],
    stock: opts.stock ?? { ...s.stock },
  } as State;
}

describe('Шёл солдат: поле', () => {
  it('сто сорок пронумерованных клеток по порядку плюс безномерные участки', () => {
    expect(board.cells.length).toBe(140);
    expect(board.end).toBe(board.cells.length - 1);
    expect(board.w).toBe(2435);
    expect(board.h).toBe(3094);
    // лента + три дороги Распутья (по 6) + обход реки (7) + круги Лешего (11) + круги Пастуха (7)
    expect(shelBoard.cells.length).toBe(140 + 18 + 7 + 11 + 7);
    expect(shelBoard.end).toBe(139);
    shelBoard.cells.forEach((c, i) => {
      expect(Number.isFinite(c.x) && Number.isFinite(c.y), `клетка ${i}`).toBe(true);
      expect(c.x >= 0 && c.x <= shelBoard.img.w && c.y >= 0 && c.y <= shelBoard.img.h, `клетка ${i} внутри поля`).toBe(true);
    });
    // у каждой пронумерованной клетки есть подпись с номером
    expect(shelBoard.cells.slice(0, 140).map((c) => c.label)).toEqual(Array.from({ length: 140 }, (_, i) => String(i + 1)));
  });

  it('безномерные клетки помечены как ветки и лежат после ленты', () => {
    const off = shelBoard.cells.filter((c) => c.off);
    expect(off.length).toBe(43);
    const taken = Object.values(branches.parts).flat();
    expect(taken.length).toBe(43);
    for (const p of taken) expect(shelBoard.cells.some((c) => c.x === p.x && c.y === p.y && c.off)).toBe(true);
  });

  it('смысловые знаки сохранены, известные переведены в коды движка', () => {
    const withSign = board.cells.filter((c) => (c as { q?: string }).q);
    expect(withSign.length).toBe(140);
    expect(board.cells.filter((c) => (c as { s?: string }).s === 'skip').length, 'привалы').toBe(8);
    expect(board.cells.filter((c) => (c as { s?: string }).s === 'start').length, 'старт').toBe(1);
    const fairs = board.cells.map((c, i) => ({ i: i + 1, q: (c as { q?: string }).q })).filter((c) => c.q === 'fair').map((c) => c.i);
    expect(fairs).toEqual([9, 48, 88]);
    const beggars = board.cells.map((c, i) => ({ i: i + 1, q: (c as { q?: string }).q })).filter((c) => c.q === 'beggar').map((c) => c.i);
    expect(beggars).toEqual([15, 17, 19]);
    const witch = board.cells.map((c, i) => ({ i: i + 1, q: (c as { q?: string }).q })).filter((c) => c.q === 'witch').map((c) => c.i);
    expect(witch).toEqual([21]);
    // ярмарки разбираются как market, привалы — как skip
    for (const f of fairs) expect(signOf((board.cells[f - 1] as { s?: string }).s, f, undefined, undefined)?.k).toBe('market');
    expect(signOf('loop:64,65', 64, undefined, undefined)?.k).toBe('loop');
  });

  it('на клетках стоят знаки движка: ярмарки, выбор на препятствиях, петли', () => {
    for (const m of b.deck!.market) expect(b.cells[at(m)].sign?.k, `ярмарка ${m}`).toBe('market');
    for (const bar of BARS) for (const n of bar.at) expect(b.cells[at(n)].sign?.k, `${n} (${bar.title})`).toBe('choice');
    expect(b.cells[at(133)].sign?.k, 'Пастух').toBe('loop');
    expect(b.cells[at(4)].sign?.k).toBe('choice');
    expect(b.cells[at(37)].sign?.k).toBe('choice');
    // привалы — выбор (хлеб или два хода), мосты через реку и яма — пропуск хода
    for (const n of [6, 13, 24, 54, 68, 91, 110, 111]) expect(b.cells[at(n)].sign?.k, `привал ${n}`).toBe('choice');
    for (const n of [76, 85, 118]) expect(b.cells[at(n)].sign?.k, `пропуск ${n}`).toBe('skip');
    // у берега Огненной реки есть дорога обхода: семь кружков и выход на 38
    expect(b.cells[at(37)].roads?.[0]).toHaveLength(8);
    expect(b.cells[at(37)].roads?.[0]?.at(-1)).toBe(at(38));
    // у Распутья — три дороги по шесть кружков, все выходят на 5
    expect(b.cells[at(4)].roads?.map((r) => r.length)).toEqual([7, 7, 7]);
    for (const r of b.cells[at(4)].roads ?? []) expect(r.at(-1)).toBe(at(5));
    // соседние кружки дорог и кругов лежат рядом (не прыгают через поле)
    const near = (i: number, j: number) => Math.hypot(b.cells[i].x - b.cells[j].x, b.cells[i].y - b.cells[j].y);
    for (const r of [...(b.cells[at(4)].roads ?? []), ...(b.cells[at(37)].roads ?? [])]) {
      for (let k = 1; k < r.length; k++) expect(near(r[k - 1], r[k]), `шаг ${r[k - 1]}→${r[k]}`).toBeLessThan(160);
    }
    for (const lp of b.loops ?? []) lp.cells.forEach((c, k) => expect(near(c, lp.cells[(k + 1) % lp.cells.length]), `круг ${c}`).toBeLessThan(220));
  });
});

describe('Шёл солдат: предметы', () => {
  it('шестнадцать предметов с названиями, текстами и картинками', () => {
    const list = items.items as { file: string; kind: string; text: string }[];
    expect(list.length).toBe(16);
    for (const it of list) {
      expect(it.file, 'файл картинки').toMatch(/^cards\/item-\d\d\.webp$/);
      expect(it.text.length, 'текст предмета ' + it.file).toBeGreaterThan(2);
      expect(existsSync(join(process.cwd(), 'public', 'shel', it.file)), it.file).toBe(true);
    }
    const names = list.map((i) => i.text).join(' | ');
    for (const must of ['Хлеб', 'Огниво', 'Полотенце', 'Конь-огонь', 'Шапка-невидимка']) expect(names, 'предмет ' + must).toContain(must);
    // у каждой карточки движка есть своя картинка из нарезанных
    for (const c of b.deck!.cards) expect(existsSync(join(process.cwd(), 'public', 'shel', 'cards', b.deck!.cardImg(c))), c.id).toBe(true);
  });
});

describe('Шёл солдат: котомка', () => {
  it('стартовый набор: краюха, огниво и три золотых', () => {
    const rng = new RiggedRng(new SeededRng(3));
    const s = def.setup(seats, { map: 'shel' }, rng) as State;
    expect(s.cards![0]).toEqual(['bread', 'flint', 'coins', 'coins', 'coins']);
    expect(bagOf(b, s, 0)).toEqual({ simple: 2, magic: 0, coins: 3 });
  });

  it('лимиты: два простых, два волшебных, три монеты', () => {
    const s0 = stand(0, { cards: [] });
    expect(canPack(b, s0, 0, 'bread')).toBe(true);
    const s1: State = { ...s0, cards: [['bread', 'flint'], null] };
    expect(canPack(b, s1, 0, 'bread'), 'третий простой').toBe(false);
    expect(canPack(b, s1, 0, 'sword'), 'волшебный ещё можно').toBe(true);
    const s2: State = { ...s1, cards: [['bread', 'flint', 'sword', 'cap'], null] };
    expect(canPack(b, s2, 0, 'towel'), 'третий волшебный').toBe(false);
    const s3: State = { ...s0, cards: [['coins', 'coins', 'coins'], null] };
    expect(canPack(b, s3, 0, 'coins'), 'четвёртая монета').toBe(false);
  });

  it('в запасе на двоих меньше карточек, чем на четверых', () => {
    expect(b.deck!.stock.bread).toEqual([4, 6, 8, 8]);
    expect(b.deck!.stock.horse).toEqual([1, 1, 1, 1]);
    const rng = new RiggedRng(new SeededRng(4));
    const two = def.setup(seats, { map: 'shel' }, rng) as State;
    expect(two.stock!.bread).toBe(4);
    expect(two.stock!.horse).toBe(1);
    const four = def.setup(
      [0, 1, 2, 3].map((seat) => ({ seat, kind: 'human' as const, name: 'x', level: 0 })),
      { map: 'shel' },
      rng
    ) as State;
    expect(four.stock!.bread).toBe(8);
    expect(four.stock!.towel).toBe(3);
  });
});

describe('Шёл солдат: ярмарка чудес', () => {
  it('на ярмарку встают обязательно, даже если очков до неё не хватает', () => {
    const rng = new RiggedRng(new SeededRng(6));
    // с 46 при броске 5 фишка должна встать на ярмарке 48, а не пройти мимо на 51 (в правилах тот же пример)
    const r = turn(stand(at(46)), 0, 5, rng);
    expect(r.state.pos[0]).toBe(at(48));
    expect(r.state.phase).toBe('market');
    expect(r.state.turn).toBe(0);
    expect(r.state.market).toEqual({ seat: 0, took: 0, bought: 0 });
  });

  it('берут до двух волшебных бесплатно, запас общий и уменьшается', () => {
    const rng = new RiggedRng(new SeededRng(7));
    const s = turn(stand(at(46)), 0, 5, rng).state;
    const s1 = def.apply(s, 0, { type: 'market', do: 'take', card: 'sword' }, rng)!.state;
    expect(s1.cards![0]).toContain('sword');
    expect(s1.stock!.sword).toBe(b.deck!.stock.sword[0] - 1);
    const s2 = def.apply(s1, 0, { type: 'market', do: 'take', card: 'cap' }, rng)!.state;
    expect(s2.cards![0]).toContain('cap');
    expect(s2.market!.took).toBe(2);
    // третьего за посещение не дают
    expect(def.apply(s2, 0, { type: 'market', do: 'take', card: 'towel' }, rng)).toBeNull();
    // закрыли ярмарку — ход перешёл дальше
    const done = def.apply(s2, 0, { type: 'market', do: 'done' }, rng)!;
    expect(done.state.phase).toBe('roll');
    expect(done.state.turn).toBe(1);
    expect(done.events.some((e) => e.type === 'market' && e.do === 'done')).toBe(true);
  });

  it('хлеб и огниво покупают за золотой, без монеты не дают', () => {
    const rng = new RiggedRng(new SeededRng(8));
    const s = turn(stand(at(46)), 0, 5, rng).state;
    const poor: State = { ...s, cards: [[], null] };
    expect(def.apply(poor, 0, { type: 'market', do: 'buy', card: 'bread' }, rng), 'без монеты').toBeNull();
    const rich: State = { ...s, cards: [['coins', 'coins'], null] };
    const r = def.apply(rich, 0, { type: 'market', do: 'buy', card: 'bread' }, rng)!;
    expect(r.state.cards![0]).toEqual(['coins', 'bread']);
    expect(r.state.stock!.bread).toBe(b.deck!.stock.bread[0] - 1);
    expect(r.state.stock!.coins).toBe(b.deck!.stock.coins[0] + 1);
    // волшебный предмет за монету не продают
    expect(def.apply(rich, 0, { type: 'market', do: 'buy', card: 'sword' }, rng)).toBeNull();
  });

  it('на 48 Конь-огонь возвращается в запас, на 88 — волшебный клубок', () => {
    const rng = new RiggedRng(new SeededRng(9));
    const s48 = turn(stand(at(46), { cards: ['horse', 'bread'] }), 0, 5, rng).state;
    expect(s48.cards![0]).not.toContain('horse');
    expect(s48.stock!.horse).toBe(b.deck!.stock.horse[0] + 1);
    const s88 = turn(stand(at(87), { cards: ['ball', 'bread'] }), 0, 1, rng).state;
    expect(s88.phase).toBe('market');
    expect(s88.cards![0]).not.toContain('ball');
  });
});

describe('Шёл солдат: препятствия и выбор', () => {
  it('с предметом проходят сразу, без предмета спрашивают игрока', () => {
    const rng = new RiggedRng(new SeededRng(10));
    // разбойники (41): с мечом игрок выбирает «использовать меч»
    const withSword = turn(stand(at(40), { cards: ['sword'] }), 0, 1, rng);
    expect(withSword.state.pos[0]).toBe(at(41));
    expect(withSword.state.phase).toBe('choose');
    const use = withSword.state.choose!.options.findIndex((o) => o.need === 'sword');
    expect(use).toBeGreaterThanOrEqual(0);
    const r = def.apply(withSword.state, 0, { type: 'choose', pick: use }, rng)!;
    expect(r.state.cards![0]).not.toContain('sword');
    expect(r.state.stock!.sword).toBe(b.deck!.stock.sword[0] + 1);
    expect(r.state.turn).toBe(1);
    // без меча — выбор, но пройти нечем: доступен только «потерять ходы»
    const bare = turn(stand(at(40), { cards: [] }), 0, 1, rng);
    expect(bare.state.pos[0]).toBe(at(41));
    expect(bare.state.phase).toBe('choose');
    expect(bare.state.choose?.title).toBe('Разбойники');
    // варианты с мечом показаны, но недоступны: apply их отклоняет
    const swordOpt = bare.state.choose!.options.findIndex((o) => o.need === 'sword');
    expect(swordOpt).toBeGreaterThanOrEqual(0);
    expect(def.apply(bare.state, 0, { type: 'choose', pick: swordOpt }, rng)).toBeNull();
    const loss = bare.state.choose!.options.findIndex((o) => !o.need);
    const picked = def.apply(bare.state, 0, { type: 'choose', pick: loss }, rng)!;
    expect(picked.state.skip[0]).toBe(2);
    expect(picked.state.turn).toBe(1);
  });

  it('Нищенке можно подать хлеб — это запоминается до Ведьмы', () => {
    const rng = new RiggedRng(new SeededRng(11));
    const s = turn(stand(at(14), { cards: ['bread'] }), 0, 1, rng).state;
    expect(s.phase).toBe('choose');
    const give = s.choose!.options.findIndex((o) => o.text.includes('хлеб'));
    expect(give).toBeGreaterThanOrEqual(0);
    const r = def.apply(s, 0, { type: 'choose', pick: give }, rng)!;
    expect(r.state.flags![0]).toContain('подал');
    expect(r.state.cards![0]).not.toContain('bread');
  });

  it('Ведьма даёт Коня-огня тому, кто подавал, и возвращает на 5 того, кто нет', () => {
    const rng = new RiggedRng(new SeededRng(12));
    const rich = turn(stand(at(20), { cards: ['bread'], flags: ['подал'] }), 0, 1, rng);
    expect(rich.state.pos[0]).toBe(at(21));
    expect(rich.state.phase).toBe('choose');
    // первый вариант — Конь-огонь (он доступен тому, кто подавал)
    const take = def.apply(rich.state, 0, { type: 'choose', pick: 0 }, rng)!;
    expect(take.state.cards![0]).toContain('horse');
    expect(take.state.flags![0]).toContain('конь');
    expect(take.state.turn).toBe(1);
    const poor = turn(stand(at(20), { cards: ['bread'], flags: [] }), 0, 1, rng);
    expect(poor.state.phase).toBe('choose');
    // «назад на поле 5» — это номер клетки с поля, а не индекс
    const back = poor.state.choose!.options.findIndex((o) => o.to === 5);
    expect(back).toBeGreaterThanOrEqual(0);
    const r = def.apply(poor.state, 0, { type: 'choose', pick: back }, rng)!;
    expect(r.state.pos[0]).toBe(at(5));
  });

  it('Конь-огонь прибавляет два поля к каждому ходу и перескакивает Огненную реку', () => {
    const rng = new RiggedRng(new SeededRng(13));
    // без Коня бросок 1 — шаг на одно поле
    expect(turn(stand(at(30)), 0, 1, rng).state.pos[0]).toBe(at(31));
    // с Конём — на три
    expect(turn(stand(at(30), { flags: ['конь'] }), 0, 1, rng).state.pos[0]).toBe(at(33));
    // на берегу Огненной реки (37) Конь переносит через неё
    const s = turn(stand(at(35), { flags: ['конь'] }), 0, 1, rng).state;
    expect(s.pos[0]).toBe(at(38));
  });

  it('у Огненной реки без Коня останавливаются, а обходят по скалам и выходят на 38', () => {
    const rng = new RiggedRng(new SeededRng(14));
    // с 35 бросок 6 — дальше берега (37) с ходу не пройти
    const s = turn(stand(at(35)), 0, 6, rng).state;
    expect(s.pos[0]).toBe(at(37));
    expect(s.phase).toBe('choose');
    const bypass = s.choose!.options.findIndex((o) => o.route != null);
    expect(bypass).toBeGreaterThanOrEqual(0);
    const r = def.apply(s, 0, { type: 'choose', pick: bypass }, rng)!;
    expect(r.state.route?.[0]).toHaveLength(8);
    // бросок 3 — по кружкам обхода
    let st = turn({ ...r.state, turn: 0 }, 0, 3, rng).state;
    expect(b.cells[st.pos[0]].off, 'на кружке обхода').toBe(true);
    // бросок 6 — дошёл до конца обхода (4 кружка и 38), остаток очков — дальше по ленте
    st = turn({ ...st, turn: 0 }, 0, 6, rng).state;
    expect(st.pos[0]).toBe(at(39));
    expect(st.route?.[0] ?? null).toBeNull();
  });

  it('с Конём-огнём реку проходят с ходу, на 48 Конь уходит вместе с прибавкой', () => {
    const rng = new RiggedRng(new SeededRng(19));
    // с 35 бросок 4 + 2 за Коня — мимо берега на 41 (Разбойники)
    const s = turn(stand(at(35), { flags: ['конь'], cards: ['horse'] }), 0, 4, rng).state;
    expect(s.pos[0]).toBe(at(41));
    const m = turn(stand(at(44), { flags: ['конь'], cards: ['horse'] }), 0, 1, rng).state;
    expect(m.pos[0]).toBe(at(47));
    const m2 = turn(stand(at(45), { flags: ['конь'], cards: ['horse'] }), 0, 1, rng).state;
    expect(m2.pos[0]).toBe(at(48));
    expect(m2.cards![0]).not.toContain('horse');
    expect(m2.flags![0]).not.toContain('конь');
  });

  it('привал: хлеб съеден и ход пропущен, без хлеба — два хода', () => {
    const rng = new RiggedRng(new SeededRng(20));
    const s = turn(stand(at(5), { cards: ['bread'] }), 0, 1, rng).state;
    expect(s.pos[0]).toBe(at(6));
    expect(s.choose?.title).toBe('Привал');
    const eat = def.apply(s, 0, { type: 'choose', pick: 0 }, rng)!.state;
    expect(eat.cards![0]).not.toContain('bread');
    expect(eat.skip[0]).toBe(1);
    const hungry = turn(stand(at(5), { cards: [] }), 0, 1, rng).state;
    const last = hungry.choose!.options.length - 1;
    expect(def.apply(hungry, 0, { type: 'choose', pick: 0 }, rng), 'без хлеба не съешь').toBeNull();
    expect(def.apply(hungry, 0, { type: 'choose', pick: last }, rng)!.state.skip[0]).toBe(2);
  });
});

describe('Шёл солдат: петли и развилка', () => {
  it('Леший: без хлеба кружат по кружкам, выходят чётным броском на 66', () => {
    const rng = new RiggedRng(new SeededRng(15));
    const s = turn(stand(at(63), { cards: [] }), 0, 1, rng).state;
    expect(s.pos[0]).toBe(at(64));
    expect(s.choose?.title).toBe('Леший чудесит');
    const circle = s.choose!.options.findIndex((o) => o.toCell != null);
    const lp = b.loops![0];
    let st = def.apply(s, 0, { type: 'choose', pick: circle }, rng)!.state;
    expect(st.pos[0]).toBe(lp.cells[0]);
    // нечётный бросок кружит по кругу: 4 раза по 3 — двенадцать шагов, второй круг
    for (let i = 0; i < 4; i++) st = turn({ ...st, turn: 0 }, 0, 3, rng).state;
    expect(st.pos[0]).toBe(lp.cells[12 % lp.cells.length]);
    // чётный выпускает: 66 и дальше по ленте
    st = turn({ ...st, turn: 0 }, 0, 2, rng).state;
    expect(st.pos[0]).toBe(at(67));
  });

  it('Леший: с хлебом проходят мимо', () => {
    const rng = new RiggedRng(new SeededRng(21));
    const s = turn(stand(at(63), { cards: ['bread'] }), 0, 1, rng).state;
    const r = def.apply(s, 0, { type: 'choose', pick: 0 }, rng)!.state;
    expect(r.pos[0]).toBe(at(64));
    expect(r.cards![0]).not.toContain('bread');
    expect(turn({ ...r, turn: 0 }, 0, 3, rng).state.pos[0]).toBe(at(67));
  });

  it('Пастух кружит, пока не выйдешь нечётным броском', () => {
    const rng = new RiggedRng(new SeededRng(16));
    const s = turn(stand(at(132)), 0, 1, rng).state;
    const lp = b.loops![1];
    expect(s.pos[0]).toBe(lp.cells[0]);
    const sp = turn({ ...s, turn: 0 }, 0, 2, rng).state;
    expect(sp.pos[0]).toBe(lp.cells[2]);
    const out = turn({ ...sp, turn: 0 }, 0, 1, rng).state;
    expect(out.pos[0]).toBe(at(134));
  });

  it('Распутье: встал на 4 — выбираешь дорогу и идёшь по кружкам до 5', () => {
    const rng = new RiggedRng(new SeededRng(17));
    const s = turn(stand(at(1)), 0, 3, rng).state;
    expect(s.pos[0]).toBe(at(4));
    expect(s.choose?.title).toBe('Распутье');
    expect(s.choose!.options).toHaveLength(3);
    for (let road = 0; road < 3; road++) {
      let st = def.apply(s, 0, { type: 'choose', pick: road }, rng)!.state;
      st = turn({ ...st, turn: 0 }, 0, 5, rng).state;
      expect(b.cells[st.pos[0]].off, 'на кружке дороги').toBe(true);
      expect(st.pos[0]).toBe(b.cells[at(4)].roads![road][4]);
      // ещё 3: последний кружок, 5, 6 (привал) — лишние очки идут дальше по ленте
      st = turn({ ...st, turn: 0 }, 0, 3, rng).state;
      expect(st.pos[0]).toBe(at(6));
      expect(st.choose?.title).toBe('Привал');
    }
  });

  it('проскочил Распутье с хода — идёшь дальше по номерам', () => {
    const rng = new RiggedRng(new SeededRng(18));
    const s = turn(stand(at(1)), 0, 6, rng).state;
    expect(s.pos[0]).toBe(at(7));
  });
});

describe('Шёл солдат: боты доигрывают партию', () => {
  it('партия на двоих заканчивается победой', async () => {
    const bots = [0, 1].map((seat) => ({ seat, kind: 'bot' as const, name: def.seats[seat].name, level: 2 }));
    const r = await simulate(def, bots, { map: 'shel' }, 11, 4000);
    expect(r.error, r.error ?? '').toBeUndefined();
    expect(r.finished, `шагов ${r.steps}`).toBe(true);
    expect(r.winners.length).toBe(1);
    const res = def.result({ map: 'shel', seats: [0, 1], pos: [at(140), 0], skip: [0, 0], turn: 0, last: null, winner: r.winners[0] } as State);
    expect(res?.text).toContain('домой');
  });

  it('партия вчетвером тоже заканчивается', async () => {
    const bots = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'bot' as const, name: def.seats[seat].name, level: 2 }));
    const r = await simulate(def, bots, { map: 'shel' }, 12, 6000);
    expect(r.error, r.error ?? '').toBeUndefined();
    expect(r.finished).toBe(true);
  });

  it('события партии описываются для журнала', () => {
    const ev: Event = { type: 'market', seat: 0, do: 'take', card: 'sword', stock: { sword: 1 } };
    expect(def.describe!(ev, () => 'Вовка')).toContain('Меч-саморуб');
    const ch: Event = { type: 'choose', seat: 0, text: 'Разбойники', option: 'Потерять 2 хода', skip: 2 };
    expect(def.describe!(ch, () => 'Вовка')).toContain('Потерять 2 хода');
    const card: Event = { type: 'card', seat: 0, card: 'bread', lost: true, left: 3 };
    expect(def.describe!(card, () => 'Вовка')).toContain('Хлеб');
  });
});

describe('Шёл солдат: показ правил', () => {
  it('в правилах есть раздел поля, показ и подкрученный кубик', () => {
    const sec = def.rules.sections.find((x) => x.title === 'Шёл солдат со службы')!;
    expect(sec).toBeTruthy();
    expect(sec.html).toContain('ярмарк');
    expect(sec.demo!.steps.length).toBeGreaterThanOrEqual(2);
    // подкручен кубик у бросков: у каждого броска есть свои значения
    const rigs = sec.demo!.steps.map((st) => st.rig);
    expect(rigs.filter((r) => r && r.length).length, 'броски с подкрученным кубиком').toBeGreaterThanOrEqual(2);
    // в показе есть выбор на клетке (Распутье, привал) и ярмарка чудес
    const acts = sec.demo!.steps.map((st) => (st.action as { type: string }).type);
    expect(acts).toContain('choose');
    expect(acts).toContain('market');
    const kinds = def.rules.sections.map((x) => x.title);
    expect(kinds).toContain('Шёл солдат со службы');
  });
});

describe('Шёл солдат: разметка безномерных клеток', () => {
  it('участки поля: три дороги Распутья по шесть кружков, семь кружков обхода и два круга', () => {
    expect(branches.parts.forkLow.length).toBe(6);
    expect(branches.parts.forkMid.length).toBe(6);
    expect(branches.parts.forkUp.length).toBe(6);
    expect(branches.parts.river.length).toBe(7);
    expect(branches.parts.leshiy.length).toBe(11);
    expect(branches.parts.pastukh.length).toBe(7);
    // кружки не повторяются и не совпадают с клетками ленты
    const all = [...board.cells, ...Object.values(branches.parts).flat()];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) expect(Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y), `кружки ${i} и ${j}`).toBeGreaterThan(40);
  });
});
