/* Царская игра Ура по Скирюку: ввод, звёзды, пустые и меченые, столбики, B7, ход назад, переворот, выход, подъём в столбике. */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { schoose } from '../src/games/ur/skyruk-ai';
import { cellId, cellOf, DEPOT, EXIT, newSkyruk, PIECES, sapply, skyrukCfg, slegal, sToAct, type SState } from '../src/games/ur/skyruk';

function sk(pl: [number, number, boolean?, number?][], value: number, cur = 0, opts: Record<string, unknown> = {}): SState {
  const s = newSkyruk(skyrukCfg(opts as never));
  s.phase = 'move';
  s.value = value;
  s.cur = cur;
  const k = [0, 0];
  for (const [side, p, m, loop] of pl) {
    const id = side * PIECES + k[side]++;
    const x = s.pieces[id];
    x.p = p;
    x.marked = !!m || (p >= 14 && p < EXIT);
    x.loop = p >= 12 && p < EXIT ? (loop ?? (side === 0 ? 2 : 0)) : null;
    if (p > 0 && p < EXIT) s.cells[cellOf(side, p, x.loop)].push(id);
  }
  return s;
}
const mv = (s: SState, a: Parameters<typeof sapply>[2]) => sapply(s, s.seats[s.cur], a, new SeededRng(1));

describe('Ур по Скирюку', () => {
  it('начинает тот, кто первым выбросил единицу, — ею и ходит', () => {
    let s = newSkyruk(skyrukCfg({}));
    const rng = new RiggedRng(new SeededRng(1));
    rng.rig([1, 1, 0]);
    s = sapply(s, 0, { type: 'roll' }, rng)!.state;
    expect(s.cur).toBe(1);
    expect(s.phase).toBe('start');
    rng.rig([1, 0, 0]);
    s = sapply(s, 1, { type: 'roll' }, rng)!.state;
    expect(s.phase).toBe('move');
    expect(s.value).toBe(1);
  });

  it('ни одной отмеченной вершины — 4: ввод сразу на «звезду» и ещё бросок', () => {
    const s = sk([], 4);
    const r = mv(s, { type: 'move', id: 0 })!.state;
    expect(r.pieces[0].p).toBe(4);
    expect(r.cur).toBe(0);
  });

  it('пустая не рубит меченую и не встаёт на неё; одного вида — рубит', () => {
    const s = sk([[0, 6], [1, 8, true]], 2);
    expect(slegal(s).some((m) => m.a.type === 'move' && m.a.id === 0)).toBe(false);
    const t = sk([[0, 6], [1, 8]], 2);
    const r = mv(t, { type: 'move', id: 0 })!.state;
    expect(r.pieces[PIECES].p).toBe(0);
  });

  it('безопасная клетка: столбик, ходит только верхняя', () => {
    const s = sk([[0, 6], [1, 7]], 1);
    const r = mv(s, { type: 'move', id: 0 })!.state;
    expect(r.cells[cellId(2, 1)]).toEqual([PIECES, 0]);
    r.cur = 1;
    r.phase = 'move';
    r.value = 1;
    expect(slegal(r).some((m) => m.a.type === 'move' && m.a.id === PIECES)).toBe(false);
  });

  it('B7 принадлежит занявшему первым: соперник не встаёт, свои — столбиком', () => {
    const s = sk([[0, 11], [0, 9], [1, 10]], 1, 1);
    expect(slegal(s).some((m) => m.toCell === DEPOT)).toBe(false);
    s.cur = 0;
    s.value = 2;
    const r = mv(s, { type: 'move', id: 1 })!.state;
    expect(r.cells[DEPOT].length).toBe(2);
  });

  it('вход в малый блок — на выбор слева или справа; на B8 фишка переворачивается', () => {
    const s = sk([[0, 11]], 1);
    const loops = slegal(s).filter((m) => m.a.type === 'move' && m.a.id === 0).map((m) => (m.a.type === 'move' ? m.a.loop : null));
    expect(loops.sort()).toEqual([0, 2]);
    const t = sk([[0, 13, false, 0]], 1);
    const r = mv(t, { type: 'move', id: 0 })!.state;
    expect(r.pieces[0].marked).toBe(true);
  });

  it('ход назад — только чтобы срубить', () => {
    const s = sk([[0, 9], [1, 6]], 3);
    const back = slegal(s).filter((m) => m.a.type === 'move' && m.a.back);
    expect(back.length).toBe(1);
    const t = sk([[0, 9]], 3);
    expect(slegal(t).some((m) => m.a.type === 'move' && m.a.back)).toBe(false);
  });

  it('выход точным броском; на финиш с пустой меченой не встать', () => {
    const s = sk([[0, 21]], 3);
    expect(mv(s, { type: 'move', id: 0 })!.state.pieces[0].p).toBe(EXIT);
    const t = sk([[0, 21]], 4);
    expect(slegal(t).some((m) => m.a.type === 'move' && m.a.id === 0)).toBe(false);
    const u = sk([[0, 21, true], [1, 5]], 2);
    expect(slegal(u).some((m) => m.a.type === 'move' && m.a.id === 0)).toBe(false);
  });

  it('подъём в столбике: 3 очка — третья сверху наверх', () => {
    const s = sk([[0, 7], [1, 7], [1, 7]], 3, 0, { raise: true });
    // столбик на B3: белая снизу, две чёрные сверху
    const r = mv(s, { type: 'raise', cell: cellId(2, 1), k: 3 })!.state;
    expect(r.cells[cellId(2, 1)][2]).toBe(0);
  });

  it('боты доигрывают все варианты', () => {
    for (const opts of [{}, { raise: true, finishStack: true }, { flip: 'wave', backStar: 'return' }, { back: false }]) {
      const rng = new SeededRng(9);
      let s = newSkyruk(skyrukCfg(opts as never));
      let n = 0;
      while (s.phase !== 'over' && n < 8000) {
        const a = schoose(s, n % 3, rng)!;
        const r = sapply(s, sToAct(s)[0], a, rng);
        expect(r, JSON.stringify(a)).not.toBeNull();
        s = r!.state;
        n++;
      }
      expect(s.phase).toBe('over');
    }
  });
});
