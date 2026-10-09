/* Шиш-беш — боты трёх уровней сложности. */
(function () {
  const SH = (window.SH = window.SH || {});
  const E = SH.Engine;
  const { LOOP_END, HOME_START, onLoop, isCorner, toGlobal, wrap } = E;

  // 21 уникальная комбинация двух кубиков с весами (из 36).
  const OUTCOMES = [];
  for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) OUTCOMES.push([a, b, a === b ? 1 : 2]);

  // Ценность одного лишнего броска (дубль/рубка).
  const EXTRA_ROLL = 9;

  function light(state) {
    return {
      players: state.players.map((p) => ({ seat: p.seat, pieces: p.pieces.slice(), house: p.house.slice() })),
      cur: state.cur,
      dice: state.dice.slice(),
      used: state.used.slice(),
      phase: 'move',
    };
  }

  function simApply(s, m) {
    const n = light(s);
    const { captured } = E.movePiece(n, n.cur, m.piece, m.to);
    n.used[m.die] = true;
    n.captures = (s.captures || 0) + captured.length;
    return n;
  }

  // Куда фишка может попасть одним кубиком (без учёта занятости клеток — для оценки угроз).
  function reach(p, d) {
    if (p === -1) return d === 6 ? [0] : [];
    if (p >= HOME_START) return [];
    const r = [];
    if (p + d <= LOOP_END) r.push(p + d);
    if (isCorner(p)) {
      if (d === 1) r.push(wrap(p, 12), wrap(p, -12));
      if (d === 3) r.push(wrap(p, 24));
    }
    return r;
  }

  // Глобальные клетки, на которые соперник может встать этим броском (a, b).
  function hitCells(s, oi, a, b, into) {
    const op = s.players[oi];
    op.pieces.forEach((p, k) => {
      if (E.isBlocked(s, oi, k)) return;
      for (const [d1, d2] of [[a, b], [b, a]]) {
        for (const t of reach(p, d1)) {
          if (onLoop(t)) into.add(toGlobal(op.seat, t));
          for (const t2 of reach(t, d2)) if (onLoop(t2)) into.add(toGlobal(op.seat, t2));
        }
      }
    });
  }

  /** Вероятность, что фишку на клетке g срубят до нашего следующего хода. */
  function threatMap(s, meIdx, cells) {
    const safe = new Map(cells.map((g) => [g, 1]));
    s.players.forEach((op, oi) => {
      if (oi === meIdx) return;
      const hitW = new Map(cells.map((g) => [g, 0]));
      for (const [a, b, w] of OUTCOMES) {
        const set = new Set();
        hitCells(s, oi, a, b, set);
        for (const g of cells) if (set.has(g)) hitW.set(g, hitW.get(g) + w);
      }
      for (const g of cells) safe.set(g, safe.get(g) * (1 - hitW.get(g) / 36));
    });
    const res = new Map();
    for (const g of cells) res.set(g, 1 - safe.get(g));
    return res;
  }

  function pieceValue(s, pi, k) {
    const p = s.players[pi].pieces[k];
    if (p < 0) return 0;
    if (p === 0) return 9; // на старте — уже в игре и в безопасности
    if (p >= HOME_START) return 64 + (p - HOME_START) * 4;
    let v = 11 + p;
    // С угла одним прыжком можно уйти на угол у своего домика (позиция 42).
    if (isCorner(p) && p < 42) v += (42 - p) * 0.3;
    if (E.isBlocked(s, pi, k)) v -= 1.5;
    return v;
  }

  function playerValue(s, pi) {
    let v = 0;
    for (let k = 0; k < 4; k++) v += pieceValue(s, pi, k);
    return v;
  }

  function evaluate(s, meIdx, dangerW) {
    const me = s.players[meIdx];
    let mine = playerValue(s, meIdx) + (s.captures || 0) * EXTRA_ROLL;
    if (dangerW > 0) {
      const exposed = [];
      me.pieces.forEach((p, k) => {
        if (onLoop(p) && !me.house[k]) exposed.push([toGlobal(me.seat, p), pieceValue(s, meIdx, k) + 9]);
      });
      if (exposed.length) {
        const tm = threatMap(s, meIdx, exposed.map((e) => e[0]));
        for (const [g, v] of exposed) mine -= dangerW * tm.get(g) * v;
      }
    }
    const opp = [];
    s.players.forEach((op, oi) => oi !== meIdx && opp.push(playerValue(s, oi)));
    const mean = opp.reduce((a, b) => a + b, 0) / opp.length;
    return mine - (0.5 * mean + 0.5 * Math.max(...opp));
  }

  function best(moves, score) {
    let bm = moves[0];
    let bs = -Infinity;
    for (const m of moves) {
      const v = score(m);
      if (v > bs) {
        bs = v;
        bm = m;
      }
    }
    return bm;
  }

  function chooseMove(state, level) {
    const moves = E.legalMoves(state);
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];
    const s0 = light(state);
    const meIdx = state.cur;

    if (level <= 1) {
      // Лёгкий: наполовину случайный, иначе жадный без оценки опасности.
      if (Math.random() < 0.55) return moves[Math.floor(Math.random() * moves.length)];
      return best(moves, (m) => evaluate(simApply(s0, m), meIdx, 0));
    }
    if (level === 2) {
      // Средний: лучший одиночный ход с учётом угроз.
      return best(moves, (m) => evaluate(simApply(s0, m), meIdx, 0.6) + Math.random() * 1.5);
    }
    // Сложный: перебор обоих кубиков целиком.
    return best(moves, (m) => {
      const s1 = simApply(s0, m);
      const next = E.legalMoves(s1);
      if (!next.length) return evaluate(s1, meIdx, 1);
      let b = -Infinity;
      for (const m2 of next) b = Math.max(b, evaluate(simApply(s1, m2), meIdx, 1));
      return b;
    });
  }

  SH.AI = { chooseMove, LEVELS: ['', 'Лёгкий', 'Средний', 'Сложный'] };
})();
