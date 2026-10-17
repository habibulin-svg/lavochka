import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { LEGS, NODES, apply, left, sailPath, lettersAt, newShv, nodeOf, numberAt, rigLetters, rigNumber, type LegId, type ShvAction, type ShvState } from '../src/games/sea/shv/engine';
import { BOOKS, known, letterOk } from '../src/games/sea/shv/words';

const rig = (...v: number[]) => {
  const r = new RiggedRng(new SeededRng(1));
  r.rig(v);
  return r;
};

const game = (humans: number[] = []): ShvState => newShv([0, 1], humans, { quiz: 'letters' }, new SeededRng(1));

function put(s: ShvState, seat: number, leg: LegId, at: string | number) {
  const sh = s.ships[seat];
  sh.leg = leg;
  sh.i = typeof at === 'number' ? at : LEGS[leg].indexOf(at);
  sh.quiz = null;
  sh.trail = [];
  for (let i = Math.max(-1, sh.i - 8); i < sh.i; i++) sh.trail.push({ leg, i });
  s.phase = s.ships[s.seats[s.turn]].quiz ? 'quiz' : 'spin';
}

const act = (s: ShvState, seat: number, a: ShvAction, ...r: number[]) => {
  const res = apply(s, seat, a, rig(...r));
  expect(res, JSON.stringify(a) + ' в фазе ' + s.phase).not.toBeNull();
  // корабль игрок ведёт сам: после компаса (развилки, побега) — действие sail
  const st = res!.state;
  if (st.phase !== 'sail' || a.type === 'sail') return st;
  const go = apply(st, st.seats[st.turn], { type: 'sail' }, rig());
  expect(go).not.toBeNull();
  return go!.state;
};

describe('Швамбрания: ход сам', () => {
  it('после компаса корабль стоит, пока игрок его не поведёт; путь подсвечивается заранее', () => {
    let s = game();
    put(s, 0, 'start', 0);
    s.phase = 'spin';
    const r = apply(s, 0, { type: 'spin' }, rig(rigNumber(4)))!.state;
    if (r.phase === 'sail') {
      expect(nodeOf(r.ships[0])).toBe(nodeOf(s.ships[0]));
      const path = sailPath(r);
      expect(path.length).toBeGreaterThan(0);
      s = apply(r, 0, { type: 'sail' }, rig())!.state;
      expect(nodeOf(s.ships[0])).not.toBe(nodeOf(r.ships[0]));
    } else expect(['fork', 'spin']).toContain(r.phase);
  });
});

describe('Швамбрания: маршрут', () => {
  it('все узлы ног пути есть на карте, лишних нет', () => {
    const used = new Set(Object.values(LEGS).flat());
    for (const n of used) expect(NODES[n], n).toBeDefined();
    expect(Object.keys(NODES).length).toBe(used.size);
  });
  it('пункты 1–20 стоят на маршруте', () => {
    for (let k = 1; k <= 20; k++) expect(Object.values(LEGS).some((l) => l.includes('N' + k)), 'пункт ' + k).toBe(true);
  });
  it('длина похода — около 130–160 узлов, как в правилах', () => {
    const len = (...legs: LegId[]) => legs.reduce((a, l) => a + LEGS[l].length, 0);
    expect(len('start', 'south', 'p8', 'coast', 'north', 'straight', 'sea')).toBeGreaterThanOrEqual(125);
    expect(len('start', 'ice', 'p8', 'coast', 'north', 'bay', 'sea')).toBeLessThanOrEqual(165);
  });
});

describe('Швамбрания: компас и вопросники', () => {
  it('12 чисел и 16 секторов букв', () => {
    for (let n = 1; n <= 12; n++) expect(numberAt((rigNumber(n) + 0.5) / 2)).toBe(n);
    expect(lettersAt((rigLetters(0) + 0.5) / 2)).toBe('А');
    expect(lettersAt((rigLetters(4) + 0.5) / 2)).toBe('ЕЖЗИ');
    expect(lettersAt((rigLetters(15) + 0.5) / 2)).toBe('ЭЮЯ');
  });
  it('словарь: буква, ё, имя с фамилией', () => {
    expect(letterOk('Ёж', 'ЕЖЗИ')).toBe(true);
    expect(letterOk('Канада', 'ГД')).toBe(false);
    expect(known('cap', 4, 'Канада')).toBe(true);
    expect(known('bot', 7, 'Берёза')).toBe(true);
    expect(known('lit', 6, 'Александр Пушкин')).toBe(true);
    expect(known('zoo', 3, 'Крокодил')).toBe(false);
  });
  it('в каждом вопроснике разделы на все номера 1–12', () => {
    for (const b of Object.values(BOOKS)) {
      const nums = b.sections.flatMap((x) => x.nums).sort((a, c) => a - c);
      expect(nums, b.title).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    }
  });
  it('экзамен на капитана: верно — сразу в поход, неверно — пропуск хода', () => {
    let s = game();
    expect(s.phase).toBe('quiz');
    s = act(s, 0, { type: 'qspin' }, rigNumber(4), rigLetters(5));
    s = act(s, 0, { type: 'answer', text: 'Канада' });
    expect(s.phase).toBe('spin');
    expect(s.ships[0].quiz).toBeNull();
    s = act(s, 0, { type: 'spin' }, rigNumber(4));
    expect(s.turn).toBe(1);
    s = act(s, 1, { type: 'qspin' }, rigNumber(4), rigLetters(5));
    s = act(s, 1, { type: 'answer', text: 'Дания' });
    expect(s.turn).toBe(0);
    expect(s.ships[1].quiz).not.toBeNull();
  });
  it('слово не из словаря судит другой живой игрок', () => {
    let s = game([0, 1]);
    s = act(s, 0, { type: 'qspin' }, rigNumber(4), rigLetters(5));
    s = act(s, 0, { type: 'answer', text: 'Кирибати' });
    expect(s.phase).toBe('judge');
    expect(apply(s, 0, { type: 'judge', ok: true }, rig())).toBeNull();
    s = act(s, 1, { type: 'judge', ok: true });
    expect(s.phase).toBe('spin');
  });
});

describe('Швамбрания: пункты', () => {
  it('марки: одна за ход, без марок — вдвое меньше', () => {
    let s = game();
    put(s, 0, 'start', 0);
    put(s, 1, 'start', 0);
    s.ships[0].marks = 0;
    s = act(s, 0, { type: 'spin' }, rigNumber(7));
    expect(s.ships[0].i).toBe(4);
    s = act(s, 1, { type: 'spin' }, rigNumber(7));
    expect(s.ships[1].i).toBe(7);
    expect(s.ships[1].marks).toBe(29);
  });
  it('пункт 2 — назад на 4; Берег Охоты — обязательная остановка с вопросником', () => {
    let s = game();
    put(s, 0, 'start', 13);
    put(s, 1, 'start', 21);
    s = act(s, 0, { type: 'spin' }, rigNumber(4));
    expect(s.ships[0].i).toBe(13);
    s = act(s, 1, { type: 'spin' }, rigNumber(9));
    expect(nodeOf(s.ships[1])).toBe('P_OHOTA');
    expect(s.ships[1].quiz?.book).toBe('zoo');
  });
  it('льды: после 7-го круга не успевшие к пункту 4 идут Южным проливом', () => {
    let s = game();
    put(s, 0, 'start', 30);
    put(s, 1, 'start', 0);
    s.round = 9;
    s.frozen = true;
    s = act(s, 0, { type: 'spin' }, rigNumber(5));
    expect(s.ships[0].leg).toBe('south');
  });
  it('пираты: откуп третью марок или плен', () => {
    let s = game();
    put(s, 0, 'south', 25);
    put(s, 1, 'p8', 4);
    s.ships[1].marks = 1;
    s = act(s, 0, { type: 'spin' }, rigNumber(4));
    expect(s.phase).toBe('pirates');
    s = act(s, 0, { type: 'pirates', pay: true });
    expect(s.ships[0].marks).toBe(29 - 9);
    s = act(s, 1, { type: 'spin' }, rigNumber(3));
    expect(s.ships[1].captive).toBe(true);
    expect(s.ships[1].leg).toBe('plen9');
  });
  it('Мыс Бурь разбивает корабль — дальше пешком; первым на рейде — победа', () => {
    let s = game();
    put(s, 0, 'straight', 3);
    put(s, 1, 'start', 0);
    s = act(s, 0, { type: 'spin' }, rigNumber(3));
    expect(s.ships[0].wrecked).toBe(true);
    s = act(s, 1, { type: 'spin' }, rigNumber(2));
    put(s, 0, 'land', 'd163');
    s = act(s, 0, { type: 'spin' }, rigNumber(5));
    expect(s.result?.winners).toEqual([0]);
  });
  it('оценка пути до рейда убывает по ходу', () => {
    const s = game();
    put(s, 0, 'start', 0);
    const a = left(s, s.ships[0]);
    put(s, 0, 'p8', 0);
    expect(left(s, s.ships[0])).toBeLessThan(a);
  });
});
