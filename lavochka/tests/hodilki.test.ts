/* Кинь-двинь: разметка полей и знаки — ветки «туда и обратно», пропуск на несколько ходов, переходы. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { BOARDS, boardOf, def, PICK_BOARDS, seriesParts, startBoard } from '../src/games/hodilki/def';
import { finishOf, nextOf, type Board, type Event, type ItemId, type Sign, type State } from '../src/games/hodilki/core';
import { riddlesOf } from '../src/words/riddles';

const seats = [0, 1].map((seat) => ({ seat, kind: 'human' as const, name: 'x', level: 0 }));

/** Знак, сработавший в событиях хода («route», «again», … — что именно). */
function signKind(events: Event[]) {
  const ev = events.find((e) => e.type === 'sign');
  return ev && ev.type === 'sign' ? ev.sign.k : null;
}

/** Текст сработавшего знака (в событиях он свой: у ветвей, переходов и развилок). */
function signText(events: Event[]) {
  const ev = events.find((e) => e.type === 'sign');
  if (!ev || ev.type !== 'sign') return '';
  return ev.text ?? ('text' in ev.sign ? ev.sign.text : '');
}

/** Бросок с заданным значением кубика и ход. */
function turn(s: State, seat: number, die: number, rng: RiggedRng) {
  rng.rig([die - 1]);
  const r1 = def.apply(s, seat, { type: 'roll' }, rng)!;
  expect(r1, 'бросок').not.toBeNull();
  const r2 = def.apply(r1.state, seat, { type: 'move' }, rng)!;
  expect(r2, 'ход').not.toBeNull();
  return r2;
}

describe('кинь-двинь: поля', () => {
  it.each(BOARDS.map((b) => b.id))('%s: знаки ведут на существующие клетки', (id) => {
    const b = BOARDS.find((x) => x.id === id)!;
    const end = finishOf(b);
    b.cells.forEach((c, i) => {
      expect(Number.isFinite(c.x) && Number.isFinite(c.y), `клетка ${i}`).toBe(true);
      expect(c.x >= 0 && c.x <= b.img.w && c.y >= 0 && c.y <= b.img.h, `клетка ${i} внутри поля`).toBe(true);
      const g = c.sign;
      if (!g) return;
      // знаки стоят на делениях ленты или на клетках дороги («В путь, друзья!»)
      expect(i <= end || c.off, `знак на клетке ветки ${i}`).toBe(true);
      // у поля-графа («Лукоморье») стрелки ведут и на кружки боковых дорог
      const graph = b.cells.some((x) => x.next != null);
      if (g.k === 'jump') expect(g.to >= 0 && (g.to <= end || (graph && g.to < b.cells.length)) && g.to !== i, `переход с ${c.label ?? i}`).toBe(true);
      if (g.k === 'route') {
        expect(g.cells.length).toBeGreaterThan(1);
        for (const k of g.cells.slice(0, -1)) expect(b.cells[k]?.off, `ветка с ${c.label}: клетка ${k}`).toBe(true);
        const last = g.cells[g.cells.length - 1];
        expect(last <= end && !b.cells[last].off, `ветка с ${c.label} выходит на путь`).toBe(true);
      }
    });
  });
});

describe('кинь-двинь: ветка «туда и обратно»', () => {
  it('Подвески: с 8 — в Крей и обратно на 8, потом дальше', () => {
    const rng = new RiggedRng(new SeededRng(1));
    let s = def.setup(seats, { map: 'podveski' }, rng) as State;
    const b = BOARDS.find((x) => x.id === 'podveski')!;
    const i8 = b.cells.findIndex((c) => c.label === '8');
    // Вовка: 6 + 2 = 8 (клетка 6 — переход на 10; поэтому 2, потом 6)
    let r = turn(s, 0, 2, rng);
    s = r.state;
    r = turn(s, 1, 1, rng);
    s = r.state;
    r = turn(s, 0, 6, rng);
    s = r.state;
    expect(s.pos[0]).toBe(i8);
    expect(r.events.some((e) => e.type === 'sign' && e.sign.k === 'route')).toBe(true);
    const route = s.route![0]!;
    expect(route[route.length - 1]).toBe(i8);
    // идём по ветке, пока не вернёмся на 8
    for (let k = 0; k < 40 && s.route?.[0]; k++) s = turn(s, s.turn, s.turn === 0 ? 6 : 1, rng).state;
    expect(s.route?.[0] ?? null).toBeNull();
    expect(s.pos[0]).toBe(i8);
    // дальше — по основному пути
    for (let k = 0; k < 5 && s.turn !== 0; k++) s = turn(s, s.turn, 1, rng).state;
    s = turn(s, 0, 1, rng).state;
    expect(s.pos[0]).toBe(i8 + 1);
  });

  it('Затерянный мир: пропуск двух ходов на 64', () => {
    const rng = new RiggedRng(new SeededRng(2));
    const s0 = def.setup(seats, { map: 'zatmir' }, rng) as State;
    const b = BOARDS.find((x) => x.id === 'zatmir')!;
    const i64 = b.cells.findIndex((c) => c.label === '64');
    const s: State = { ...s0, pos: s0.pos.map((p, i) => (i === 0 ? i64 - 1 : p)) };
    let r = turn(s, 0, 1, rng);
    expect(r.state.skip[0]).toBe(2);
    // Ленка ходит три раза подряд, пока Вовка пропускает
    let st = r.state;
    let lenka = 0;
    for (let k = 0; k < 3; k++) {
      expect(st.turn).toBe(1);
      st = turn(st, 1, 1, rng).state;
      lenka++;
    }
    expect(lenka).toBe(3);
    expect(st.turn).toBe(0);
  });
});

/* «Шайба»: гонка двух шайб по двум трекам, кубик с клюшками и квадратики, финиш = гол. */
describe('кинь-двинь: «Шайба»', () => {
  const race = BOARDS.find((b) => b.id === 'shayba')!;
  const two = [0, 1].map((seat) => ({ seat, kind: 'human' as const, name: 'x', level: 0 }));

  it('два трека по 30 клеток со своими стартом и воротами', () => {
    const tracks = race.race!.tracks;
    expect(tracks.length).toBe(2);
    for (const t of tracks) {
      expect(t.length).toBe(30);
      expect(race.cells[t[0]].label).toBe('1');
      expect(race.cells[t[29]].label).toBe('30');
    }
    // дорожки не пересекаются
    expect(tracks[0].every((i) => !tracks[1].includes(i))).toBe(true);
  });

  it('играют вдвоём или командами: допустимы только 2, 4 и 6 игроков; на других полях — как раньше', () => {
    expect(def.countsFor!({ map: 'shayba' })).toEqual([2, 4, 6]);
    expect(def.countsFor!({ map: 'krugosvet' })).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(def.countsHint!({ map: 'shayba' })).toContain('2 на 2');
    expect(def.countsHint!({ map: 'krugosvet' })).toBeUndefined();
  });

  it('настройка «Голов до победы» показывается только у «Шайбы» (по умолчанию 3, можно 1, 5, 7)', () => {
    const o = def.options!.find((x) => x.key === 'goals')!;
    expect(o.showIf!({ map: 'shayba' })).toBe(true);
    expect(o.showIf!({ map: 'krugosvet' })).toBe(false);
    expect(o.default).toBe('3');
    expect(o.choices!.map((c) => c.value)).toEqual(['1', '3', '5', '7']);
  });

  it('в командах напарники через одного ходят одной шайбой', () => {
    const rng = new RiggedRng(new SeededRng(11));
    const four = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'human' as const, name: 'x', level: 0 }));
    const s0 = def.setup(four, { map: 'shayba' }, rng) as State;
    const track = race.race!.tracks[0];
    rng.rig([2]); // Вовка (место 0) — грань 3
    let r = def.apply(s0, 0, { type: 'roll' }, rng)!;
    r = def.apply(r.state, 0, { type: 'move' }, rng)!;
    // шайба дорожки 0 сдвинулась, и у напарника (место 2) она там же
    expect(r.state.pos[0]).toBe(track[3]);
    expect(r.state.pos[2]).toBe(track[3]);
    expect(r.state.turn).toBe(1);
    // Ленка, потом напарник Вовки — он бросает той же шайбой
    rng.rig([0]);
    r = def.apply(r.state, 1, { type: 'roll' }, rng)!;
    r = def.apply(r.state, 1, { type: 'move' }, rng)!;
    expect(r.state.turn).toBe(2);
    rng.rig([0]);
    r = def.apply(r.state, 2, { type: 'roll' }, rng)!;
    r = def.apply(r.state, 2, { type: 'move' }, rng)!;
    expect(r.state.pos[0]).toBe(track[4]);
    expect(r.state.pos[2]).toBe(track[4]);
  });

  it('очки ведут вперёд по своей дорожке, красная клюшка — назад, зелёная — вперёд', () => {
    const rng = new RiggedRng(new SeededRng(3));
    let s = def.setup(two, { map: 'shayba' }, rng) as State;
    const track = race.race!.tracks[0];
    // грань 3
    rng.rig([2]);
    let r = def.apply(s, 0, { type: 'roll' }, rng)!;
    expect(r.events[0]).toMatchObject({ type: 'roll', die: 3, kind: 'pips' });
    r = def.apply(r.state, 0, { type: 'move' }, rng)!;
    s = r.state;
    expect(s.pos[0]).toBe(track[3]);
    expect(s.turn).toBe(1);
    // зелёная клюшка: грань 6 и квадратик с двумя точками
    rng.rig([5, 8]);
    r = def.apply(s, 1, { type: 'roll' }, rng)!;
    expect(r.events[0]).toMatchObject({ die: 6, kind: 'green', card: 2, slot: 8 });
    r = def.apply(r.state, 1, { type: 'move' }, rng)!;
    s = r.state;
    expect(s.pos[1]).toBe(race.race!.tracks[1][2]);
    // красная клюшка: грань 5 и квадратик с тремя точками — назад
    rng.rig([4, 14]);
    r = def.apply(s, 0, { type: 'roll' }, rng)!;
    expect(r.events[0]).toMatchObject({ die: 5, kind: 'red', card: 3 });
    expect(r.state.last).toBe(-3);
    r = def.apply(r.state, 0, { type: 'move' }, rng)!;
    expect(r.state.pos[0]).toBe(track[0]);
  });

  it('назад дальше центра шайба не уходит', () => {
    const rng = new RiggedRng(new SeededRng(4));
    let s = def.setup(two, { map: 'shayba' }, rng) as State;
    const track = race.race!.tracks[0];
    s = { ...s, pos: s.pos.map((p, i) => (i === 0 ? track[1] : p)) };
    rng.rig([4, 14]); // красная клюшка, квадратик на 3
    let r = def.apply(s, 0, { type: 'roll' }, rng)!;
    r = def.apply(r.state, 0, { type: 'move' }, rng)!;
    expect(r.state.pos[0]).toBe(track[0]);
  });

  it('клетка 30 — гол: шайба в центр, счёт растёт, лишние очки пропадают', () => {
    const rng = new RiggedRng(new SeededRng(5));
    let s = def.setup(two, { map: 'shayba' }, rng) as State;
    const track = race.race!.tracks[0];
    s = { ...s, pos: s.pos.map((p, i) => (i === 0 ? track[28] : p)) };
    rng.rig([5]); // грань 6 — очков больше, чем осталось
    let r = def.apply(s, 0, { type: 'roll' }, rng)!;
    r = def.apply(r.state, 0, { type: 'move' }, rng)!;
    expect(r.events.some((e) => e.type === 'goal' && e.track === 0 && e.goals === 1)).toBe(true);
    expect(r.state.pos[0]).toBe(track[0]);
    expect(r.state.goals![0]).toBe(1);
    expect(r.state.turn).toBe(1);
  });

  it('партия кончается по числу голов; в команде побеждают все, кто на дорожке', () => {
    const rng = new RiggedRng(new SeededRng(6));
    const four = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'human' as const, name: 'x', level: 0 }));
    let s = def.setup(four, { map: 'shayba', goals: '2' }, rng) as State;
    expect(s.target).toBe(2);
    const track = race.race!.tracks[0];
    s = { ...s, goals: [1, 0], pos: s.pos.map((p, i) => (i === 0 ? track[28] : p)) };
    rng.rig([0]); // грань 1 — как раз в ворота
    let r = def.apply(s, 0, { type: 'roll' }, rng)!;
    r = def.apply(r.state, 0, { type: 'move' }, rng)!;
    expect(r.state.winner).toBe(0);
    const res = def.result(r.state)!;
    expect(res.winners).toEqual([0, 2]);
    expect(res.text).toContain('2 : 0');
  });

  it('показ правил «Шайбы» включает клюшку с квадратиком', () => {
    const section = def.rules.sections.find((x) => x.title === 'Шайба')!;
    expect(section).toBeTruthy();
    const kinds = section.demo!.steps.filter((st) => st.rig && st.rig.length > 1);
    expect(kinds.length).toBeGreaterThan(0);
  });
});

describe('кинь-двинь: «В путь, друзья!»', () => {
  const board = BOARDS.find((x) => x.id === 'vput')!;
  const at = (label: string) => board.cells.findIndex((c) => c.label === label);
  /** Пуговица встаёт на нужное деление ленты: один ход с деления перед ним. */
  const landOn = (label: string, rng: RiggedRng) => {
    const s = def.setup(seats, { map: 'vput' }, rng) as State;
    s.pos[0] = at(label) - 1;
    s.turn = 0;
    return turn(s, 0, 1, rng);
  };
  /** Идти по ветке, пока она не кончится (знаки на дороге при этом срабатывают). */
  const walkRoute = (s0: State, rng: RiggedRng) => {
    let s = s0;
    for (let k = 0; k < 60 && s.route?.[0]; k++) {
      s.turn = 0;
      s = turn(s, 0, 6, rng).state;
    }
    return s;
  };

  it('поле — лента 135 делений с серыми дорогами, красными полосками и треугольниками', () => {
    expect(board.cells.slice(0, 135).map((c) => c.label)).toEqual(Array.from({ length: 135 }, (_, i) => String(i + 1)));
    expect(def.rules.sections.some((x) => x.title === 'В путь, друзья!')).toBe(true);
    const grey = board.cells.slice(0, 135).filter((c) => c.sign?.k === 'route').map((c) => c.label);
    expect(grey).toEqual(['8', '13', '33', '41', '45', '53', '57', '79', '87', '92', '97', '115', '130']);
  });

  it('серая дорога уводит вперёд: с 8 пуговица выходит на 30', () => {
    const rng = new RiggedRng(new SeededRng(11));
    const r = landOn('8', rng);
    expect(r.events.some((e) => e.type === 'sign' && e.sign.k === 'route')).toBe(true);
    expect(r.state.route![0]!.length).toBeGreaterThan(4);
    const s = walkRoute(r.state, rng);
    expect(s.pos[0]).toBe(at('30'));
    expect(s.route?.[0] ?? null).toBeNull();
    // дальше — обычный ход по ленте
    s.turn = 0;
    expect(turn(s, 0, 1, rng).state.pos[0]).toBe(at('31'));
  });

  it('серая дорога возвращает назад: с 45 пуговица уходит на 26', () => {
    const rng = new RiggedRng(new SeededRng(12));
    const s = walkRoute(landOn('45', rng).state, rng);
    expect(s.pos[0]).toBe(at('26'));
  });

  it('на серой дороге знаки работают: зелёный кружок — ещё бросок, оранжевый квадрат — пропуск хода', () => {
    const rng = new RiggedRng(new SeededRng(13));
    // дорога от 33: четвёртое деление — зелёный кружок
    const s = landOn('33', rng).state;
    s.turn = 0;
    const r = turn(s, 0, 4, rng);
    expect(r.events.some((e) => e.type === 'sign' && e.sign.k === 'again')).toBe(true);
    expect(r.state.turn).toBe(0); // бросает ещё раз
    // дорога от 79: третье деление — оранжевый квадрат (пропуск хода)
    const rng2 = new RiggedRng(new SeededRng(14));
    const s2 = landOn('79', rng2).state;
    s2.turn = 0;
    const r2 = turn(s2, 0, 3, rng2);
    expect(r2.events.some((e) => e.type === 'sign' && e.sign.k === 'skip')).toBe(true);
    expect(r2.state.skip[0]).toBeTruthy();
  });

  it('красная полоска 13 уводит в спираль и возвращает на 13, а не дальше', () => {
    const rng = new RiggedRng(new SeededRng(15));
    const r = landOn('13', rng);
    expect(signKind(r.events)).toBe('route');
    expect(signText(r.events)).toContain('спирал');
    expect(r.state.route![0]!.length).toBeGreaterThan(8);
    const s = walkRoute(r.state, rng);
    expect(s.pos[0]).toBe(at('13'));
    expect(s.route?.[0] ?? null).toBeNull(); // знак на 13 не срабатывает второй раз
    s.turn = 0;
    expect(turn(s, 0, 1, rng).state.pos[0]).toBe(at('14'));
  });

  it('красная полоска на серой дороге (97) уводит в петлю и выводит на 113', () => {
    const rng = new RiggedRng(new SeededRng(16));
    // 96 — зелёный кружок: пуговица встаёт на него, бросает ещё раз и попадает на серое 97
    const s96 = def.setup(seats, { map: 'vput' }, rng) as State;
    s96.pos[0] = at('96') - 1;
    s96.turn = 0;
    let s = turn(s96, 0, 1, rng).state;
    s.turn = 0;
    const onRoad = turn(s, 0, 1, rng);
    expect(onRoad.state.pos[0]).toBe(at('97'));
    expect(onRoad.state.route![0]!.length).toBeGreaterThan(8);
    // шесть делений дороги, потом ещё три — третье и есть красная полоска
    s = onRoad.state;
    s.turn = 0;
    s = turn(s, 0, 6, rng).state;
    s.turn = 0;
    const r = turn(s, 0, 3, rng);
    expect(signKind(r.events)).toBe('route');
    expect(signText(r.events)).toContain('петл');
    expect(r.state.route![0]!.length).toBeGreaterThan(10); // петля и остаток дороги
    expect(walkRoute(r.state, rng).pos[0]).toBe(at('113'));
  });
});

/* Движковые механики для «Лукоморья» (боны, предметы, развилки, условия, дополнительные ходы)
 * проверяются на служебном поле: оно подкладывается в список полей только на время этих тестов. */
describe('кинь-двинь: «Лукоморье-1»', () => {
  const board = BOARDS.find((x) => x.id === 'luk1')!;
  const at = (label: string) => board.cells.findIndex((c) => c.label === label);
  const seats2 = [0, 1].map((seat) => ({ seat, kind: 'human' as const, name: 'x', level: 0 }));
  const start = (rng: RiggedRng) => {
    const s = def.setup(seats2, { map: 'luk1' }, rng) as State;
    s.turn = 0;
    s.coins = [0, 0];
    return s;
  };

  it('поле: «старт» в начале, избушка 13 в конце, у камня развилка из трёх дорог', () => {
    const end = board.end ?? board.cells.length - 1;
    expect(board.cells[0].label).toBe('старт');
    expect(board.cells[end].label).toBe('13');
    const fork = board.cells[at('2')].sign;
    expect(fork?.k).toBe('fork');
    if (fork?.k !== 'fork') return;
    expect(fork.roads).toEqual(['прямо', 'вверх', 'вниз']);
    // поле-граф: ветка — первый кружок дороги, дальше пуговица идёт по дорогам кружков
    const road = (from: number) => {
      const seen: string[] = [];
      for (let k: number | undefined = from, n = 0; k != null && n < 200; k = nextOf(board, k), n++) {
        if (board.cells[k].label) seen.push(board.cells[k].label!);
        if (board.cells[k].sign?.k === 'fork' && k !== from) break;
      }
      return seen;
    };
    expect(road(fork.branches[0][0])).toContain('3'); // прямо — к Дубу
    expect(road(fork.branches[1][0])).toEqual(expect.arrayContaining(['8', '9а', '7а'])); // верхняя дорога
    expect(road(fork.branches[2][0])).toEqual(expect.arrayContaining(['4', '5'])); // нижняя: клад 4 и болото
  });

  it('развилка: остаток очков выбирает дорогу, и клад на дороге работает', () => {
    const rng = new RiggedRng(new SeededRng(31));
    let s = start(rng);
    s = turn(s, 0, 6, rng).state; // старт → шестой кружок
    const r = turn({ ...s, turn: 0 }, 0, 6, rng); // до камня один кружок, разница 5 — дорога «вниз»
    expect(signText(r.events)).toContain('вниз');
    expect(board.cells[r.state.pos[0]].off).toBe(true); // пуговица на дороге
    // девятое деление дороги — клад (4): кубик бросают два раза и берут столько бон
    const before = board.cells.findIndex((c) => c.label === '4');
    const onRoad = { ...r.state, pos: [before - 1, 0], turn: 0, route: [[before], null] as State['route'], coins: [0, 0] };
    const r2 = turn(onRoad, 0, 1, rng);
    expect(r2.state.pos[0]).toBe(before);
    expect(r2.state.coins![0]).toBeGreaterThanOrEqual(2);
    expect(r2.events.some((e) => e.type === 'coins' && e.delta > 0)).toBe(true);
  });

  it('Баба Яга: с 20 бонами даёт клубок и ведёт во вторую часть, без них — назад к Дубу', () => {
    const rng = new RiggedRng(new SeededRng(32));
    const last = (board.end ?? board.cells.length - 1) - 1;
    const poor = { ...start(rng), pos: [last, 0], turn: 0, coins: [19, 0] };
    const r = turn(poor, 0, 1, rng);
    expect(r.state.winner).toBeNull();
    expect(r.state.pos[0]).toBe(at('3'));
    const rich = { ...start(rng), pos: [last, 0], turn: 0, coins: [20, 0] };
    const r2 = turn(rich, 0, 1, rng);
    expect(r2.state.maps?.[0]).toBe('luk2'); // клубок выкуплен — серия продолжается второй частью
    expect(r2.state.pos[0]).toBe(0);
    expect(def.result(r2.state)).toBeNull();
  });

  it('загадка 12 спрашивает про репку и ведёт на названный пункт', () => {
    const rng = new RiggedRng(new SeededRng(33));
    const s = { ...start(rng), pos: [at('12') - 1, 0], turn: 0 };
    const r = turn(s, 0, 1, rng);
    expect(r.state.phase).toBe('pick');
    const sign = board.cells[r.state.pos[0]].sign;
    expect(sign?.k === 'pick' ? sign.question : '').toContain('репке');
    const pick = def.apply(r.state, 0, { type: 'pick', pick: 0 }, rng)!;
    expect(pick.state.pos[0]).toBe(at('5')); // первый ответ «5» — пункт 5
  });
});

describe('кинь-двинь: боны, предметы и развилки', () => {
  const testBoard: Board = {
    id: 'tests',
    title: 'Служебное поле',
    img: { w: 100, h: 100, dir: '', src: [100, 100], levels: 0 },
    token: 0.05,
    goal: '',
    rules: '',
    winText: 'прошёл служебное поле',
    coins: 'бон',
    cells: [
      { x: 0, y: 0, sign: { k: 'start' }, label: '1' },
      { x: 10, y: 0, sign: { k: 'coins', n: 7, text: 'берёт 7 бон' }, label: '2' },
      { x: 20, y: 0, sign: { k: 'fork', byDiff: [0, 0, 1, 1, 2, 2], branches: [[11, 3], [12, 13, 3], [14, 15, 3]], roads: ['прямо', 'вверх', 'вниз'], text: 'развилка' }, label: '3' },
      { x: 30, y: 0, sign: null, label: '4' },
      { x: 40, y: 0, sign: { k: 'extra', n: 2, text: 'лишние ходы' }, label: '5' },
      { x: 50, y: 0, sign: { k: 'coins', dice: 2, text: 'берёт бон по двум броскам' }, label: '6' },
      { x: 60, y: 0, sign: { k: 'item', item: 'cap', text: 'берёт шапку-невидимку' }, label: '7' },
      { x: 70, y: 0, sign: { k: 'need', item: 'cap', yes: 'win', no: 0, text: 'в шапке проходит дальше, без неё — назад' }, label: '8' },
      { x: 80, y: 0, sign: { k: 'need', coins: 20, yes: 'win', no: 0, text: 'за 20 бон выкупает клубок' }, label: '9' },
      { x: 90, y: 0, sign: { k: 'coins', n: 3, loss: true, text: 'отдаёт 3 боны' }, label: '10' },
      { x: 95, y: 0, sign: null, label: '11' },
      // клетки дорог развилки
      { x: 0, y: 10, sign: null, off: true },
      { x: 0, y: 20, sign: null, off: true },
      { x: 0, y: 30, sign: null, off: true },
      { x: 0, y: 40, sign: null, off: true },
      { x: 0, y: 50, sign: null, off: true },
    ],
    end: 10,
  };
  const seats2 = [0, 1].map((seat) => ({ seat, kind: 'human' as const, name: 'x', level: 0 }));
  const start = (rng: RiggedRng, pos = 0) => {
    const s = def.setup(seats2, { map: 'tests' }, rng) as State;
    s.pos[0] = pos;
    s.turn = 0;
    return s;
  };

  beforeAll(() => BOARDS.push(testBoard));
  afterAll(() => {
    const i = BOARDS.indexOf(testBoard);
    if (i >= 0) BOARDS.splice(i, 1);
  });

  it('боны: берёт числом и суммой бросков, отдаёт и не уходит в минус', () => {
    const rng = new RiggedRng(new SeededRng(21));
    let s = turn(start(rng, 0), 0, 1, rng).state;
    expect(s.coins![0]).toBe(7);
    // «бросьте кубик два раза»: сумма двух бросков
    const s2 = start(rng, 4);
    rng.rig([0, 0, 0]);
    let r = def.apply(s2, 0, { type: 'roll' }, rng)!;
    r = def.apply(r.state, 0, { type: 'move' }, rng)!;
    expect(r.events.some((e) => e.type === 'coins' && e.delta === 2)).toBe(true);
    expect(r.state.coins![0]).toBe(2);
    // отдаёт больше, чем есть — остаётся ноль
    const poor = { ...start(rng, 8), coins: [1, 0], turn: 0 };
    rng.rig([0]);
    let r2 = def.apply(poor, 0, { type: 'roll' }, rng)!;
    r2 = def.apply(r2.state, 0, { type: 'move' }, rng)!;
    expect(r2.events.some((e) => e.type === 'coins' && e.delta === -3)).toBe(true);
    expect(r2.state.coins![0]).toBe(0);
  });

  it('развилка: дорогу выбирает разница «очки на кубике − кружки до развилки»', () => {
    const rng = new RiggedRng(new SeededRng(22));
    // с клетки 2 бросок 2: до развилки один шаг, разница 1 — дорога «прямо»
    let r = turn(start(rng, 1), 0, 2, rng);
    expect(signKind(r.events)).toBe('fork');
    expect(signText(r.events)).toContain('прямо');
    expect(r.state.pos[0]).toBe(11); // первая клетка дороги «прямо»
    expect(r.state.route![0]).toEqual([3]); // остаток ветки — выход на 4
    expect(r.state.routeFor![0]).toBe(true); // лишние очки пойдут дальше по пути
    // второй бросок доигрывает ветку и идёт дальше по ленте
    r = turn({ ...r.state, turn: 0 }, 0, 2, rng);
    expect(r.state.pos[0]).toBe(4); // 3 → 4
    // фишка стоит на развилке — дорогу выбирает цифра на кубике (разница 3 — «вверх»)
    const onFork = { ...start(rng, 2), last: 3, phase: 'move' as const };
    const r3 = def.apply(onFork, 0, { type: 'move' }, rng)!;
    expect(signText(r3.events)).toContain('вверх');
    expect(r3.state.pos[0]).toBe(3); // дорога «вверх»: 12, 13 и выход на 4
  });

  it('предметы и условия: без шапки возвращает назад, в шапке — победа', () => {
    const rng = new RiggedRng(new SeededRng(23));
    // без шапки: с клетки 7 попадаем на 8 — условия нет, назад на 1
    const r = turn(start(rng, 6), 0, 1, rng);
    expect(r.state.pos[0]).toBe(0);
    expect(r.state.winner).toBeNull();
    // берём шапку (клетка 7) и снова идём на 8 — победа
    let s = turn(start(rng, 5), 0, 1, rng).state;
    expect(s.items![0]).toEqual(['cap']);
    s.turn = 0;
    const r2 = turn(s, 0, 1, rng);
    expect(r2.state.winner).toBe(0);
    expect(def.result(r2.state)!.text).toContain('служебное поле');
  });

  it('условие по бонам: 20 бон выкупают клубок, без них — назад', () => {
    const rng = new RiggedRng(new SeededRng(24));
    const poor = { ...start(rng, 7), coins: [3, 0], turn: 0 };
    rng.rig([0]); // ровно один шаг — на клетку условия
    let r = def.apply(poor, 0, { type: 'roll' }, rng)!;
    r = def.apply({ ...r.state, turn: 0 }, 0, { type: 'move' }, rng)!;
    expect(r.state.winner).toBeNull();
    expect(r.state.pos[0]).toBe(0);
    const rich = { ...start(rng, 7), coins: [20, 0], turn: 0 };
    rng.rig([0]);
    let r2 = def.apply(rich, 0, { type: 'roll' }, rng)!;
    r2 = def.apply({ ...r2.state, turn: 0 }, 0, { type: 'move' }, rng)!;
    expect(r2.state.winner).toBe(0);
  });

  it('дополнительные ходы: игрок бросает ещё раз, ход остаётся у него', () => {
    const rng = new RiggedRng(new SeededRng(25));
    // клетка 5 даёт два дополнительных хода: первый бросок засчитан сразу, остаётся один
    let s = turn(start(rng, 3), 0, 1, rng).state;
    expect(s.extra![0]).toBe(1);
    expect(s.turn).toBe(0); // ход не перешёл
    s.turn = 0;
    s = turn(s, 0, 1, rng).state;
    expect(s.extra![0]).toBe(0);
    expect(s.turn).toBe(0); // и это был ещё один лишний ход
    s.turn = 0;
    s = turn(s, 0, 1, rng).state;
    expect(s.extra![0]).toBe(0);
    expect(s.turn).toBe(1); // лишние кончились — ход перешёл
  });

  it('загадка: ход ждёт ответа, пуговица идёт на названное деление', () => {
    const rng = new RiggedRng(new SeededRng(27));
    const quiz: Board = {
      ...testBoard,
      id: 'tests4',
      title: 'Поле с загадкой',
      end: 4,
      cells: [
        { x: 0, y: 0, sign: { k: 'start' }, label: '1' },
        { x: 10, y: 0, sign: { k: 'pick', question: 'Сколько действующих лиц в сказке о репке?', options: ['4', '5', '6'], to: [2, 3, 4], text: 'загадка о репке' }, label: '2' },
        { x: 20, y: 0, sign: null, label: '3' },
        { x: 30, y: 0, sign: { k: 'coins', n: 5, text: 'берёт 5 бон' }, label: '4' },
        { x: 40, y: 0, sign: null, label: '5' },
      ],
    };
    BOARDS.push(quiz);
    try {
      const s = def.setup(seats2, { map: 'tests4' }, rng) as State;
      s.turn = 0;
      const r = turn(s, 0, 1, rng); // 1 → 2: загадка
      expect(r.state.phase).toBe('pick');
      expect(r.state.turn).toBe(0); // ход ждёт ответа
      expect(signKind(r.events)).toBe('pick');
      const botPick = def.bot.choose(r.state, 0, 1, rng) as unknown as { type: string };
      expect(botPick.type).toBe('pick');
      // назвали «5» — пуговица идёт на деление 4 и берёт боны
      const r2 = def.apply(r.state, 0, { type: 'pick', pick: 1 }, rng)!;
      expect(r2.state.pos[0]).toBe(3);
      expect(r2.state.phase).toBe('roll');
      expect(signText(r2.events)).toContain('5');
      // назвали «6» — пуговица идёт на последнее деление и побеждает
      const r3 = def.apply({ ...r.state, turn: 0 }, 0, { type: 'pick', pick: 2 }, rng)!;
      expect(r3.state.winner).toBe(0);
    } finally {
      BOARDS.splice(BOARDS.indexOf(quiz), 1);
    }
  });

  it('«выход только нужной гранью» и отбор предмета', () => {
    const rng = new RiggedRng(new SeededRng(28));
    const gate: Board = {
      ...testBoard,
      id: 'tests5',
      title: 'Поле с задержкой',
      end: 6,
      cells: [
        { x: 0, y: 0, sign: { k: 'start' }, label: '1' },
        { x: 10, y: 0, sign: { k: 'wait', die: 6, text: 'выход только шестёркой' }, label: '2' },
        { x: 20, y: 0, sign: null, label: '3' },
        { x: 30, y: 0, sign: { k: 'takeItem', item: 'flower', text: 'кикиморы отбирают цветочек' }, label: '4' },
        { x: 40, y: 0, sign: null, label: '5' },
        { x: 50, y: 0, sign: null, label: '6' },
        { x: 60, y: 0, sign: null, label: '7' },
      ],
    };
    BOARDS.push(gate);
    try {
      // пуговица стоит на 2: с любым броском, кроме шестёрки, ход пропадает
      const s = { ...(def.setup(seats2, { map: 'tests5' }, rng) as State), pos: [1, 0], turn: 0 };
      const stay = turn(s, 0, 3, rng);
      expect(signKind(stay.events)).toBe('wait');
      expect(stay.state.pos[0]).toBe(1);
      expect(stay.state.turn).toBe(1); // ход перешёл
      // шестёрка выпускает дальше — и пуговица доходит до конца поля
      const go = turn({ ...s, turn: 0 }, 0, 6, rng);
      expect(go.state.winner).toBe(0);
      // на 4 отбирают аленький цветочек, если он есть
      const withFlower = { ...s, pos: [2, 0], turn: 0, items: [['flower'], null] as State['items'] };
      const r2 = turn(withFlower, 0, 1, rng);
      expect(r2.state.items![0]).toEqual([]);
      expect(r2.events.some((e) => e.type === 'item' && e.lost)).toBe(true);
    } finally {
      BOARDS.splice(BOARDS.indexOf(gate), 1);
    }
  });

  it('боны «по разнице»: пуговица останавливается на пункте и берёт неистраченные очки', () => {
    const rng = new RiggedRng(new SeededRng(29));
    const diffBoard: Board = {
      ...testBoard,
      id: 'tests6',
      title: 'Поле с разницей',
      end: 5,
      cells: [
        { x: 0, y: 0, sign: { k: 'start' }, label: '1' },
        { x: 10, y: 0, sign: null, label: '2' },
        { x: 20, y: 0, sign: null, label: '3' },
        { x: 30, y: 0, sign: { k: 'coins', diff: true, text: 'берёт боны по разнице' }, label: '4' },
        { x: 40, y: 0, sign: null, label: '5' },
        { x: 50, y: 0, sign: null, label: '6' },
      ],
    };
    BOARDS.push(diffBoard);
    try {
      const s = def.setup(seats2, { map: 'tests6' }, rng) as State;
      s.turn = 0;
      // бросок 5: до пункта «4» три кружка, пуговица встаёт на него и берёт разницу 2
      const r = turn(s, 0, 5, rng);
      expect(r.state.pos[0]).toBe(3);
      expect(r.events.some((e) => e.type === 'coins' && e.delta === 2)).toBe(true);
      // ровно на пункт: разница нулевая
      const s2 = { ...s, pos: [1, 0], turn: 0 };
      const r2 = turn(s2, 0, 2, rng);
      expect(r2.state.pos[0]).toBe(3);
      expect(r2.events.some((e) => e.type === 'coins' && e.delta === 0)).toBe(true);
    } finally {
      BOARDS.splice(BOARDS.indexOf(diffBoard), 1);
    }
  });

  it('дорога развилки: знак на номерном пункте по дороге работает', () => {
    const rng = new RiggedRng(new SeededRng(30));
    const forkBoard: Board = {
      ...testBoard,
      id: 'tests7',
      title: 'Поле с дорогой',
      end: 4,
      cells: [
        { x: 0, y: 0, sign: { k: 'start' }, label: '1' },
        { x: 10, y: 0, sign: { k: 'fork', byDiff: [0, 1], branches: [[], [5, 3]], roads: ['прямо', 'вниз'], text: 'развилка' }, label: '2' },
        { x: 20, y: 0, sign: { k: 'coins', n: 6, text: 'клад' }, label: '3' },
        { x: 30, y: 0, sign: null, label: '4' },
        { x: 40, y: 0, sign: null, label: '5' },
        { x: 0, y: 10, sign: null, off: true },
      ],
    };
    BOARDS.push(forkBoard);
    try {
      // бросок 2: развилка решается разницей 1 — дорога «прямо», лишнее очко идёт дальше на «3» с кладом
      const s = def.setup(seats2, { map: 'tests7' }, rng) as State;
      s.turn = 0;
      const r = turn(s, 0, 2, rng);
      expect(r.state.pos[0]).toBe(2);
      expect(r.state.coins![0]).toBe(6);
      // бросок 3: разница 2 — дорога «вниз», клад на другой дороге (по дороге фишка идёт через клетку 5)
      const s2 = { ...s, pos: [0, 0], turn: 0, coins: [0, 0] };
      const r2 = turn(s2, 0, 3, rng);
      expect(r2.state.pos[0]).toBe(3);
      expect(r2.state.coins![0]).toBe(0);
      expect(r2.state.route?.[0] ?? null).toBeNull();
    } finally {
      BOARDS.splice(BOARDS.indexOf(forkBoard), 1);
    }
  });

  it('переход на другое поле (серия «Лукоморья») переносит пуговицу в его клетку', () => {
    const rng = new RiggedRng(new SeededRng(26));
    const other: Board = {
      ...testBoard,
      id: 'tests2',
      title: 'Второе служебное поле',
      end: 2,
      cells: [
        { x: 0, y: 0, sign: null, label: '1' },
        { x: 10, y: 0, sign: null, label: '2' },
        { x: 20, y: 0, sign: null, label: '3' },
      ],
    };
    const hop: Board = {
      ...testBoard,
      id: 'tests3',
      title: 'Поле с переходом',
      end: 2,
      cells: [
        { x: 0, y: 0, sign: { k: 'start' }, label: '1' },
        { x: 10, y: 0, sign: { k: 'field', map: 'tests2', to: 2, text: 'уносит на другое поле' }, label: '2' },
        { x: 20, y: 0, sign: null, label: '3' },
      ],
    };
    BOARDS.push(other, hop);
    try {
      let s = def.setup(seats2, { map: 'tests3' }, rng) as State;
      s.turn = 0;
      const r = turn(s, 0, 1, rng);
      expect(r.state.maps?.[0]).toBe('tests2');
      expect(r.state.pos[0]).toBe(2);
      expect(r.state.winner).toBeNull();
    } finally {
      BOARDS.splice(BOARDS.indexOf(other), 1);
      BOARDS.splice(BOARDS.indexOf(hop), 1);
    }
  });
});

describe('кинь-двинь: у знаков всех полей числа конечные', () => {
  it.each(BOARDS.map((b) => b.id))('%s', (id) => {
    const b = BOARDS.find((x) => x.id === id)!;
    const num = (v: unknown, what: string) => expect(Number.isFinite(v as number), `${b.id}: ${what}`).toBe(true);
    b.cells.forEach((c, i) => {
      const g = c.sign;
      if (!g) return;
      const where = `${b.id} клетка ${c.label ?? i} (${g.k})`;
      if (g.k === 'skip' && g.n != null) num(g.n, where);
      if (g.k === 'jump') num(g.to, where);
      if (g.k === 'coins') {
        if (g.n != null) num(g.n, where);
        if (g.dice != null) num(g.dice, where);
        if (g.skip != null) num(g.skip, where);
      }
      if (g.k === 'extra') {
        if (g.n != null) num(g.n, where);
        if (g.dice != null) num(g.dice, where);
      }
      if (g.k === 'wait') num(g.die, where);
      if (g.k === 'need') {
        if (g.coins != null) num(g.coins, where);
        for (const [k, v] of [['yes', g.yes], ['no', g.no]] as const) {
          if (typeof v === 'number') num(v, `${where}, ${k}`);
          if (typeof v === 'object') {
            expect(BOARDS.some((x) => x.id === v.map), `${where}: поле ${v.map}`).toBe(true);
            num(v.to, `${where}, ${k}`);
          }
        }
      }
      if (g.k === 'fork') {
        num(g.byDiff.length, where);
        for (const d of g.byDiff) num(d, where);
        for (const br of g.branches) for (const x of br) num(x, where);
      }
      if (g.k === 'pick') for (const x of g.to) num(x, where);
    });
  });
});

describe('кинь-двинь: «Лукоморье», части 2–4', () => {
  const luk = (id: string) => BOARDS.find((b) => b.id === id)!;
  /** Номер клетки по подписи с поля ((15), (24а), А…). */
  const at = (id: string, label: string) => {
    const i = luk(id).cells.findIndex((c) => c.label === label);
    expect(i, `клетка «${label}» на ${id}`).toBeGreaterThanOrEqual(0);
    return i;
  };
  /** Номер клетки по знаку (для клеток, которые на поле цифрой не подписаны). */
  const bySign = (id: string, pred: (c: { sign: Sign | null }) => boolean) => {
    const i = luk(id).cells.findIndex((c) => pred(c));
    expect(i, `клетка по знаку на ${id}`).toBeGreaterThanOrEqual(0);
    return i;
  };
  /** Партия на поле, пуговица Вовки стоит на клетке `cell`. */
  const stand = (id: string, cell: number, opts: { coins?: number; items?: ItemId[] } = {}) => {
    const rng = new RiggedRng(new SeededRng(9));
    const s = def.setup(seats, { map: id }, rng) as State;
    return {
      ...s,
      pos: s.pos.map((_, i) => (i === 0 ? cell : 0)),
      turn: 0,
      coins: [opts.coins ?? 50, opts.coins ?? 50],
      items: [(opts.items ?? []) as never, null],
      extra: [0, 0],
    } as State;
  };
  const forkAt = (id: string, re: RegExp) => {
    const i = bySign(id, (c) => c.sign?.k === 'fork' && re.test(c.sign.text ?? ''));
    return { i, g: luk(id).cells[i].sign as Extract<Sign, { k: 'fork' }> };
  };

  it('четыре части серии на месте: боны, победа по знаку, стартовые броски', () => {
    for (const id of ['luk1', 'luk2', 'luk3', 'luk4']) {
      const b = luk(id);
      expect(b.coins, id).toBe('бон');
      expect(b.winBySign, id).toBe(true);
      expect(b.startCoins, id).toBe(3);
      expect(b.cells.length, id).toBeGreaterThan(30);
      expect(finishOf(b), id).toBeGreaterThan(15);
    }
  });

  it('переходы между частями ведут на существующие поля и клетки', () => {
    for (const b of BOARDS) {
      for (const c of b.cells) {
        if (c.sign?.k !== 'field') continue;
        const g = c.sign as Extract<Sign, { k: 'field' }>;
        const target = BOARDS.find((x) => x.id === g.map);
        expect(target, `поле ${g.map} из ${b.id}`).toBeDefined();
        expect(g.to >= 0 && g.to < target!.cells.length, `клетка ${g.to} на ${g.map}`).toBe(true);
        expect(target!.cells[g.to].off, `переход только на клетку пути (${g.map}:${g.to})`).toBeFalsy();
      }
    }
  });

  it('поле 2: Морской царь (21) отправляет к Рыбе, пиратам и сундуку', () => {
    const { g } = forkAt('luk2', /Морской царь/);
    const b = luk('luk2');
    // ветка — первый кружок дороги; по дороге пуговица доходит до своего пункта
    const reach = (from: number, label: string) => {
      for (let k: number | undefined = from, n = 0; k != null && n < 50; k = nextOf(b, k), n++) if (b.cells[k].label === label) return true;
      return false;
    };
    expect(g.roads).toEqual(['вверх', 'прямо', 'вниз']);
    expect(reach(g.branches[0][0], '27')).toBe(true);
    expect(reach(g.branches[1][0], '26')).toBe(true);
    expect(reach(g.branches[2][0], '24б')).toBe(true);
  });

  it('поле 2: у Корабля-призрака шесть входов, каждый выводит на свою дорогу', () => {
    const { i, g } = forkAt('luk2', /Корабль-призрак/);
    expect(g.branches.length).toBe(6);
    const cells = luk('luk2').cells;
    for (const br of g.branches) {
      expect(br.length).toBe(1);
      expect(br[0] !== i && br[0] >= 0 && br[0] < cells.length, `выход лабиринта ${br[0]}`).toBe(true);
    }
  });

  it('поле 2: терем (32) — с цветочком дальше в третью часть, без него назад на развилку (15)', () => {
    const rng = new RiggedRng(new SeededRng(11));
    const before = at('luk2', '32') - 1;
    let a = turn(stand('luk2', before), 0, 1, rng);
    expect(a.state.pos[0]).toBe(at('luk2', '15'));
    expect(a.state.winner).toBeNull();
    a = turn(stand('luk2', before, { items: ['flower'] }), 0, 1, rng);
    expect(a.state.maps?.[0]).toBe('luk3');
    expect(a.state.pos[0]).toBe(at('luk3', '33'));
    expect(a.state.winner).toBeNull();
  });

  it('поле 3: Заоблачная даль (56) переносит в замок Кощея (поле 4)', () => {
    const rng = new RiggedRng(new SeededRng(13));
    // перед (56) — Облако (55): выход только шестёркой
    const a = turn(stand('luk3', at('luk3', '56') - 1), 0, 6, rng);
    expect(a.state.maps?.[0]).toBe('luk4');
    expect(a.state.pos[0]).toBe(at('luk4', '57'));
  });

  it('поле 4: тронный зал — без иглы назад к Медведю, с иглой победа', () => {
    const rng = new RiggedRng(new SeededRng(17));
    const throne = at('luk4', '62');
    const before = throne - 1;
    let a = turn(stand('luk4', before), 0, 1, rng);
    expect(a.state.pos[0]).toBe(throne);
    // развилка в тронном зале решается следующим броском (ход после входа переходит дальше)
    a = turn({ ...a.state, turn: 0 }, 0, 6, rng);
    expect(a.state.winner).toBeNull();
    expect(a.state.pos[0]).toBe(at('luk4', '59'));
    let b = turn(stand('luk4', before, { items: ['needle'] }), 0, 1, rng);
    b = turn({ ...b.state, turn: 0 }, 0, 6, rng);
    expect(b.state.winner).toBe(0);
  });

  it('поле 4: кружок «?» — загадка остальным, лишние ходы только за неотгаданную', () => {
    const rng = new RiggedRng(new SeededRng(19));
    const q = bySign('luk4', (c) => c.sign?.k === 'riddle');
    // встали на «?» — игрок должен загадать загадку
    let a = turn(stand('luk4', q - 1), 0, 1, rng);
    expect(a.state.phase).toBe('ask');
    expect(a.state.riddle?.by).toBe(0);
    expect(a.state.riddle?.extra).toBe(3);
    // загадываем свою загадку с ответом
    a = def.apply(a.state, 0, { type: 'ask', text: 'Без рук, без ног, а деревья гнёт', answer: 'ветер' }, rng)!;
    expect(a.state.phase).toBe('answer');
    expect(a.state.turn).toBe(1);
    // Ленка отвечает мимо — ответ уходит загадавшему на суд
    a = def.apply(a.state, 1, { type: 'answer', text: 'дождь' }, rng)!;
    expect(a.state.riddle?.replies).toEqual([{ seat: 1, text: 'дождь' }]);
    expect(a.state.phase).toBe('judge');
    expect(a.state.turn).toBe(0);
    let b = def.apply(a.state, 0, { type: 'judge', ok: false }, rng)!;
    expect(b.events.some((e) => e.type === 'reward')).toBe(true);
    expect(b.state.extra?.[0]).toBe(2); // три лишних хода, один уже пошёл в дело
    expect(b.state.turn).toBe(0);
    expect(b.state.riddle).toBeNull();
    // теперь Ленка называет верный ответ — движок сверяет сам, награды нет
    let c = turn(stand('luk4', q - 1), 0, 1, rng);
    c = def.apply(c.state, 0, { type: 'ask', text: 'Без рук, без ног, а деревья гнёт', answer: 'ветер' }, rng)!;
    c = def.apply(c.state, 1, { type: 'answer', text: 'ВЕТЕР' }, rng)!;
    expect(c.state.riddle?.solved).toEqual([1]);
    c = def.apply(c.state, 0, { type: 'judge', ok: false }, rng)!;
    expect(c.state.extra?.[0] ?? 0).toBe(0);
    expect(c.state.turn).toBe(1);
    // бот называет свою удачу сам
    let d = turn(stand('luk4', q - 1), 0, 1, rng);
    d = def.apply(d.state, 0, { type: 'ask', text: 'загадка', answer: 'ветер' }, rng)!;
    d = def.apply(d.state, 1, { type: 'answer', correct: true }, rng)!;
    expect(d.state.riddle?.solved).toEqual([1]);
  });

  it('поле 4: ответ на загадку виден только загадавшему', () => {
    const rng = new RiggedRng(new SeededRng(23));
    const q = bySign('luk4', (c) => c.sign?.k === 'riddle');
    let s = turn(stand('luk4', q - 1), 0, 1, rng).state;
    s = def.apply(s, 0, { type: 'ask', text: 'загадка', answer: 'ветер' }, rng)!.state;
    expect((def.view(s, [1]) as State).riddle?.answer).toBeNull();
    expect((def.view(s, [0]) as State).riddle?.answer).toBe('ветер');
  });

  it('поле 4: бот загадывает по своей сложности и отвечает со своей удачей', () => {
    const rng = new RiggedRng(new SeededRng(29));
    const q = bySign('luk4', (c) => c.sign?.k === 'riddle');
    let s = turn(stand('luk4', q - 1), 0, 1, rng).state;
    // лёгкий бот спрашивает простую загадку, сложный — трудную
    const easy = def.bot.choose(s, 0, 0, rng) as { type: string; text?: string };
    expect(easy.type).toBe('ask');
    expect(riddlesOf(1).map((r) => r.q)).toContain(easy.text);
    const hard = def.bot.choose(s, 0, 2, rng) as { type: string; text?: string };
    expect(riddlesOf(3).map((r) => r.q)).toContain(hard.text);
    // удача: лёгкий отвечает в 30 % случаев, сложный — в 80 %
    s = def.apply(s, 0, { type: 'ask', text: 'загадка', answer: 'ветер' }, rng)!.state;
    rng.rig([29]);
    expect((def.bot.choose(s, 1, 0, rng) as { correct?: boolean }).correct).toBe(true);
    rng.rig([30]);
    expect((def.bot.choose(s, 1, 0, rng) as { correct?: boolean }).correct).toBe(false);
    rng.rig([79]);
    expect((def.bot.choose(s, 1, 2, rng) as { correct?: boolean }).correct).toBe(true);
  });

  it('поле 1: у Бабы Яги условие спрашивают и когда пуговица тут уже стоит', () => {
    // так бывает, если игрока перенесла сюда загадка (12): знак клетки назначения не срабатывает
    const rng = new RiggedRng(new SeededRng(31));
    const baba = at('luk1', '13');
    let a = turn(stand('luk1', baba, { coins: 0 }), 0, 1, rng);
    expect(a.state.pos[0]).toBe(at('luk1', '3')); // без 20 бон — назад к Дубу, а не «ни идти, ни пропустить»
    expect(a.state.turn).toBe(1);
    a = turn(stand('luk1', baba, { coins: 40 }), 0, 1, rng);
    // с бонами клубок выкуплен — и пуговица идёт во вторую часть серии
    expect(a.state.maps?.[0]).toBe('luk2');
    expect(a.state.pos[0]).toBe(at('luk2', '14'));
    expect(a.state.winner).toBeNull();
  });

  it('серия «Лукоморье» — одна игра из четырёх частей, начиная с любой', () => {
    // в списке полей у серии стоит только первая часть, а начинать можно с любой
    const first = BOARDS.find((b) => b.id === 'luk1')!;
    expect(first.series).toEqual({ id: 'luk', label: 'Лукоморье. Приключенческий сериал (4 части)', part: 1, count: 4 });
    expect(seriesParts('luk').map((b) => b.id)).toEqual(['luk1', 'luk2', 'luk3', 'luk4']);
    expect(PICK_BOARDS.filter((b) => b.series?.id === 'luk').map((b) => b.id)).toEqual(['luk1']);
    const rng = new RiggedRng(new SeededRng(37));
    for (const n of [1, 2, 3, 4]) {
      const b = startBoard({ map: 'luk1', lukStart: String(n) });
      expect(b.id, `начало с части ${n}`).toBe(`luk${n}`);
    }
    // выбрана конкретная часть напрямую — начинаем с неё, настройка «начать с части» не мешает
    expect(startBoard({ map: 'luk3', lukStart: '1' }).id).toBe('luk3');
    // у поля не из серии — как было
    expect(startBoard({ map: 'krugosvet', lukStart: '3' }).id).toBe('krugosvet');
    expect(def.setup(seats, { map: 'luk1', lukStart: '4' }, rng).map).toBe('luk4');
  });

  it('серия: игроки бывают на разных картах — каждый ходит по своей', () => {
    const rng = new RiggedRng(new SeededRng(41));
    // Вовка в первой части, Ленка — во второй (так бывает после «птицы» и «провала»)
    let s = def.setup(seats, { map: 'luk1' }, rng) as State;
    s = { ...s, maps: s.maps!.map((m, i) => (i === 1 ? 'luk2' : m)), pos: s.pos.map((p, i) => (i === 1 ? 0 : p)) };
    const a = def.apply(s, 0, { type: 'roll' }, rng)!;
    expect(a.state.map).toBe('luk1'); // Вовка ходит по первой части
    const b = def.apply(a.state, 0, { type: 'move' }, rng)!;
    expect(b.state.pos[0]).toBeGreaterThan(0);
    expect(b.state.turn).toBe(1);
    expect(b.state.map).toBe('luk2'); // ход перешёл — и поле состояния стало Ленкиным
    const c = def.apply(b.state, 1, { type: 'roll' }, rng)!;
    const d = def.apply(c.state, 1, { type: 'move' }, rng)!;
    expect(d.state.pos[1]).toBeGreaterThan(0);
    expect(d.state.pos[1]).toBeLessThan(boardOf('luk2').cells.length); // её клетки — по второй карте
    expect(d.state.pos[0]).toBe(b.state.pos[0]); // Вовка остался там же
  });

  it('перенос на другую часть не тащит за собой остаток дороги', () => {
    // так было у пользователя: фишку перенесло «верхней дорогой» на другую карту, а маршрут-ветка
    // остался от прежнего поля — и дальше движок вёл её по номерам чужой карты
    const rng = new RiggedRng(new SeededRng(43));
    const baba = at('luk1', '13');
    let s = def.setup(seats, { map: 'luk1' }, rng) as State;
    s = {
      ...s,
      pos: s.pos.map((p, i) => (i === 0 ? baba : p)), // стоим на (13): так бывает после переноса
      route: (s.route ?? Array(10).fill(null)).map((r, i) => (i === 0 ? [100, 101, 102] : r)),
      routeFor: (s.routeFor ?? Array(10).fill(null)).map((r, i) => (i === 0 ? true : r)),
      coins: [20, 0],
      turn: 0,
    };
    const a = turn(s, 0, 1, rng); // бросок: условие спрашивают, клубок выкуплен — и переход во вторую часть
    expect(a.state.maps?.[0]).toBe('luk2');
    expect(a.state.route?.[0] ?? null).toBeNull();
    expect(a.state.routeFor?.[0] ?? null).toBeNull();
    // следующий ход идёт по второй части, а не по чужим номерам
    const b = turn({ ...a.state, turn: 0 }, 0, 3, rng);
    expect(b.state.pos[0]).toBeGreaterThan(0);
    expect(b.state.pos[0]).toBeLessThan(boardOf('luk2').cells.length);
  });
});
