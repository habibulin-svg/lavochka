/* Кинь-двинь: разметка полей и знаки — ветки «туда и обратно», пропуск на несколько ходов, переходы. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { BOARDS, def } from '../src/games/hodilki/def';
import { finishOf, type Board, type Event, type State } from '../src/games/hodilki/core';

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
      if (g.k === 'jump') expect(g.to >= 0 && g.to <= end && g.to !== i, `переход с ${c.label ?? i}`).toBe(true);
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
});
