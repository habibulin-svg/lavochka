/* Старинные и восточные шахматы: ходы фарзина, фила, кхона; превращения; пат и голый король; счёт макрука;
 * марсельские (два хода), сентередж («верера»), ситтуйин (расстановка), шатар (мат конём); боты доигрывают. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/chess/ai';
import { apply, cfgFrom, fromFen, legalMoves, newGame, play, sq, type Action, type State, type Variant } from '../src/games/chess/engine';

const cfg = (variant: Variant) => cfgFrom({ variant });
const at = (s: State, from: string) => legalMoves(s).filter((m) => m.from === sq(from)).map((m) => 'abcdefgh'[m.to & 7] + ((m.to >> 3) + 1)).sort();
const mv = (s: State, from: string, to: string) => {
  const r = apply(s, s.turn, { type: 'move', from: sq(from), to: sq(to) } as Action, 0);
  expect(r, `${from}-${to}`).not.toBeNull();
  return r!;
};
function perft(s: State, d: number): number {
  const ms = legalMoves(s);
  if (d === 1) return ms.length;
  return ms.reduce((n, m) => n + perft(play(s, m), d - 1), 0);
}

describe('старинные шахматы', () => {
  it('шатрандж: фил прыгает, фарзин — на шаг, пешка без двойного хода', () => {
    const s = newGame(cfg('shatranj'));
    expect(at(s, 'c1')).toEqual(['a3', 'e3']);
    expect(at(s, 'e1')).toEqual([]);
    expect(at(s, 'e2')).toEqual(['e3']);
    expect(legalMoves(s).length).toBe(16);
  });

  it('макрук: перфт и кхон', () => {
    const s = newGame(cfg('makruk'));
    expect([1, 2].map((d) => perft(s, d))).toEqual([23, 529]);
    expect(at(s, 'c1')).toEqual(['b2', 'c2', 'd2']);
  });

  it('макрук: пешка превращается в мета на шестой', () => {
    const s = fromFen('4k3/8/8/2P5/8/8/8/4K3 w - - 0 1', cfg('makruk'));
    const r = mv(s, 'c5', 'c6');
    expect(r.state.board[sq('c6')]).toBe('Q');
  });

  it('шатрандж: голый король проигрывает, если не оголит соперника в ответ', () => {
    const r = mv(fromFen('k7/8/8/8/8/8/1r6/RK6 w - - 0 1', cfg('shatranj')), 'b1', 'b2');
    expect(r.state.reason).toBe('bare');
    expect(r.state.winner).toBe(0);
    // фарзин берёт последнюю ладью, но король тут же берёт фарзина — играем дальше, потом ничья
    const s = mv(fromFen('k7/1r6/Q7/8/8/8/8/7K w - - 0 1', cfg('shatranj')), 'a6', 'b7');
    expect(s.state.phase).toBe('play');
    const d = mv(s.state, 'a8', 'b7');
    expect(d.state.reason).toBe('material');
  });

  it('пат в шатрандже — победа ставящего', () => {
    // чёрный король a8, белые: король c7, фарзин b6 → после Фb6 у чёрных нет ходов и нет шаха
    const s = fromFen('k7/2K5/8/2Q5/8/8/8/8 w - - 0 1', cfg('shatranj'));
    const r = mv(s, 'c5', 'b6');
    expect(r.state.reason).toBe('stalemate');
    expect(r.state.winner).toBe(0);
    const c = fromFen('k7/2K5/8/2Q5/8/8/8/8 w - - 0 1', cfg('makruk'));
    expect(mv(c, 'c5', 'b6').state.winner).toBe(null);
  });

  it('макрук: счёт голому королю', () => {
    const s = fromFen('k7/8/8/8/8/8/8/R3K2R w - - 0 1', cfg('makruk'));
    const r = mv(s, 'e1', 'e2');
    expect(r.state.count).toBe(8 - 4);
  });

  it('марсельские: два хода, шах первым — очередь переходит', () => {
    let s = newGame(cfg('marseillais'));
    s = mv(s, 'e2', 'e4').state; // у белых в первую очередь — один ход
    expect(s.turn).toBe(1);
    s = mv(s, 'e7', 'e5').state;
    expect(s.turn).toBe(1);
    s = mv(s, 'd7', 'd5').state;
    expect(s.turn).toBe(0);
    s = mv(s, 'f1', 'b5').state; // шах первым ходом
    expect(s.turn).toBe(1);
  });

  it('сентередж: до первого взятия ходят подряд и передают ход', () => {
    let s = newGame(cfg('senterej'));
    s = mv(s, 'e2', 'e3').state;
    s = mv(s, 'd2', 'd3').state;
    expect(s.turn).toBe(0);
    const p = apply(s, 0, { type: 'pass' }, 0)!;
    expect(p.state.turn).toBe(1);
    expect(apply(newGame(cfg('senterej')), 0, { type: 'pass' }, 0)).toBeNull();
  });

  it('ситтуйин: расстановка, ладьи — только на последнюю горизонталь', () => {
    let s = newGame(cfg('sittuyin'));
    const rook = legalMoves(s).filter((m) => m.drop === 'R');
    expect(rook.every((m) => m.to < 8)).toBe(true);
    for (const [k, to] of [['K', 'e2'], ['Q', 'd2'], ['R', 'a1'], ['R', 'h1'], ['B', 'c2'], ['B', 'f2'], ['N', 'b2'], ['N', 'g2']] as const) {
      const r = apply(s, 0, { type: 'drop', piece: k, to: sq(to) }, 0);
      expect(r, `${k}@${to}`).not.toBeNull();
      s = r!.state;
    }
    expect(s.turn).toBe(1);
    expect(s.reserve![0]).toEqual([]);
  });

  it('шатар: мат конём не ставят, голый король — ничья', () => {
    // мат конём: чёрный король h8 зажат своими пешками, белый конь f6→… g6 даёт шах? берём классический «спёртый мат»
    const s = fromFen('6rk/6pp/8/6N1/8/8/8/K7 w - - 0 1', cfg('shatar'));
    expect(legalMoves(s).some((m) => m.from === sq('g5') && m.to === sq('f7'))).toBe(false);
    const c = fromFen('6rk/6pp/8/6N1/8/8/8/K7 w - - 0 1', cfg('classic'));
    expect(legalMoves(c).some((m) => m.from === sq('g5') && m.to === sq('f7'))).toBe(true);
    const r = mv(fromFen('k7/8/8/8/8/8/1r6/RK6 w - - 0 1', cfg('shatar')), 'b1', 'b2');
    expect(r.state.reason).toBe('bare');
    expect(r.state.winner).toBe(null);
  });

  it('боты доигрывают все варианты', () => {
    for (const v of ['shatranj', 'chaturanga', 'makruk', 'sittuyin', 'senterej', 'marseillais', 'shatar'] as Variant[]) {
      const rng = new SeededRng(5);
      let s = newGame(cfg(v));
      let i = 0;
      for (; i < 3000 && s.phase !== 'over'; i++) {
        const seat = s.turn;
        const a = choose(s, seat, i % 3, rng);
        expect(a, `${v}: ход ${i}`).not.toBeNull();
        const r = apply(s, seat, a!, 0);
        expect(r, `${v}: ${JSON.stringify(a)}`).not.toBeNull();
        s = r!.state;
      }
      expect(s.phase, `${v} за ${i}`).toBe('over');
    }
  }, 300000);
});
