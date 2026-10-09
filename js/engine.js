/* Шиш-беш — игровой движок (чистая логика, без DOM).
 *
 * Позиция фишки p хранится относительно её владельца:
 *   -1        — в парке (вне поля)
 *    0        — на стартовом поле (выступ в конце своего луча, вне круга)
 *    1..48    — на круге (1 — первая клетка своей дорожки, 48 — торец своего луча)
 *   49..52    — в домике (4 клетки своего цвета)
 * Глобальная клетка круга: g = (p - 1 + 12*seat) % 48.
 * Четверть круга — 12 клеток: 0..4 к центру, 5 — угол креста,
 * 6..10 от центра по соседнему лучу, 11 — торец соседнего луча.
 * У клеток 2 и 8 каждой четверти (3-е поле с края луча) есть «домик»-укрытие на одну фишку.
 */
(function () {
  const SH = (window.SH = window.SH || {});

  const LOOP = 48;
  const LOOP_END = 48;
  const HOME_START = 49;
  const HOME_END = 52;
  const PIECES = 4;

  const SEATS = [
    { color: '#b3322a', light: '#e0674f', dark: '#6e1a14', name: 'Красный' },
    { color: '#2f7a3e', light: '#58ad66', dark: '#18452a', name: 'Зелёный' },
    { color: '#d9a521', light: '#f3cf62', dark: '#8a6410', name: 'Жёлтый' },
    { color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a', name: 'Синий' },
  ];

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const onLoop = (p) => p >= 1 && p <= LOOP_END;
  const isCorner = (p) => onLoop(p) && (p - 1) % 12 === 5;
  const toGlobal = (seat, p) => (p - 1 + 12 * seat) % LOOP;
  const isHouseG = (g) => g % 12 === 2 || g % 12 === 8;
  const isHouse = (seat, p) => onLoop(p) && isHouseG(toGlobal(seat, p));
  const wrap = (p, delta) => ((((p - 1 + delta) % LOOP) + LOOP) % LOOP) + 1;

  /** Все фишки, стоящие на глобальной клетке g: [{pi, k, house}] */
  function piecesAt(state, g) {
    const out = [];
    state.players.forEach((pl, pi) => {
      pl.pieces.forEach((p, k) => {
        if (onLoop(p) && toGlobal(pl.seat, p) === g) out.push({ pi, k, house: !!pl.house[k] });
      });
    });
    return out;
  }

  /** Фишка сидит в домике-укрытии, а на его клетке стоит другая фишка — выйти нельзя. */
  function isBlocked(state, pi, k) {
    const pl = state.players[pi];
    if (!pl.house[k]) return false;
    const g = toGlobal(pl.seat, pl.pieces[k]);
    return piecesAt(state, g).some((o) => !o.house);
  }

  /** Можно ли фишке игрока pi встать на клетку круга t (позиция владельца). */
  function canLand(state, pi, k, t) {
    const pl = state.players[pi];
    const g = toGlobal(pl.seat, t);
    const here = piecesAt(state, g).filter((o) => !(o.pi === pi && o.k === k));
    if (isHouseG(g) && !here.some((o) => o.house)) return true; // свободный домик
    return !here.some((o) => o.pi === pi && !o.house); // на клетке своя фишка — нельзя
  }

  /** Куда может пойти фишка k игрока pi значением кубика d. */
  function pieceTargets(state, pi, k, d) {
    const pl = state.players[pi];
    const pieces = pl.pieces;
    const p = pieces[k];
    const res = [];
    const ownAt = (pos) => pieces.some((q, i) => i !== k && q === pos);
    const homeFree = (a, b) => {
      for (let s = Math.max(a, HOME_START); s <= b; s++) if (ownAt(s)) return false;
      return true;
    };

    if (p === -1) {
      if (d === 6 && !ownAt(0)) res.push({ to: 0, kind: 'enter' });
      return res;
    }
    if (p >= HOME_START) {
      const t = p + d;
      if (t <= HOME_END && homeFree(p + 1, t)) res.push({ to: t, kind: 'home' });
      return res;
    }
    if (isBlocked(state, pi, k)) return res;
    const t = p + d;
    if (t <= LOOP_END) {
      if (canLand(state, pi, k, t)) res.push({ to: t, kind: 'step' });
    } else if (t <= HOME_END && homeFree(HOME_START, t)) {
      res.push({ to: t, kind: 'home' });
    }
    if (isCorner(p)) {
      // «1» — по прямым стрелкам на соседние углы, «3» — по диагонали.
      const jumps = d === 1 ? [wrap(p, 12), wrap(p, -12)] : d === 3 ? [wrap(p, 24)] : [];
      for (const j of jumps) if (canLand(state, pi, k, j)) res.push({ to: j, kind: 'jump' });
    }
    return res;
  }

  function legalMoves(state) {
    if (state.phase !== 'move') return [];
    const pi = state.cur;
    const out = [];
    const seen = new Set();
    for (let i = 0; i < 2; i++) {
      if (state.used[i]) continue;
      const d = state.dice[i];
      for (let k = 0; k < PIECES; k++) {
        for (const tg of pieceTargets(state, pi, k, d)) {
          const key = k + ':' + tg.to + ':' + tg.kind + ':' + d;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ piece: k, die: i, value: d, from: state.players[pi].pieces[k], to: tg.to, kind: tg.kind });
        }
      }
    }
    return out;
  }

  /**
   * Переставляет фишку (мутирует s), решает вопрос с домиком и рубкой.
   * Возвращает { captured: [{seat, piece, from}], house: bool }.
   */
  function movePiece(s, pi, k, to) {
    const pl = s.players[pi];
    pl.pieces[k] = to;
    pl.house[k] = false;
    const captured = [];
    let house = false;
    if (onLoop(to)) {
      const g = toGlobal(pl.seat, to);
      const here = piecesAt(s, g).filter((o) => !(o.pi === pi && o.k === k));
      if (isHouseG(g) && !here.some((o) => o.house)) {
        pl.house[k] = true; // занимаем укрытие — из него не выбивают
        house = true;
      } else {
        for (const o of here) {
          if (o.house || o.pi === pi) continue;
          const op = s.players[o.pi];
          captured.push({ seat: op.seat, piece: o.k, from: op.pieces[o.k] });
          op.pieces[o.k] = -1;
          op.house[o.k] = false;
        }
      }
    }
    return { captured, house };
  }

  function newGame(seats) {
    const players = seats
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((s) => ({
        seat: s.seat,
        name: s.name || SEATS[s.seat].name,
        kind: s.kind, // 'human' | 'bot' | 'remote'
        level: s.level || 2,
        pieces: [-1, -1, -1, -1],
        house: [false, false, false, false],
      }));
    return {
      players,
      cur: Math.floor(Math.random() * players.length),
      phase: 'roll',
      dice: [0, 0],
      used: [true, true],
      bonus: false,
      winner: null,
      turn: 1,
    };
  }

  // Дубль или срубленная фишка — тот же игрок бросает ещё раз.
  function finishTurn(s) {
    const dbl = s.dice[0] === s.dice[1];
    const again = dbl || s.bonus;
    const reason = s.bonus ? (dbl ? 'both' : 'capture') : dbl ? 'double' : null;
    s.phase = 'roll';
    s.used = [true, true];
    s.bonus = false;
    if (!again) s.cur = (s.cur + 1) % s.players.length;
    s.turn++;
    return { again, reason, next: s.players[s.cur].seat };
  }

  function rollDice() {
    const r = () => 1 + Math.floor(Math.random() * 6);
    return [r(), r()];
  }

  function applyRoll(state, dice) {
    if (state.phase !== 'roll') return null;
    const s = clone(state);
    s.dice = dice.slice();
    s.used = [false, false];
    s.bonus = false;
    s.phase = 'move';
    const ev = { type: 'roll', seat: s.players[s.cur].seat, dice: dice.slice() };
    if (legalMoves(s).length === 0) {
      ev.noMoves = true;
      ev.turnEnd = finishTurn(s);
    }
    return { state: s, event: ev };
  }

  function applyMove(state, mv) {
    const legal = legalMoves(state).find((m) => m.piece === mv.piece && m.die === mv.die && m.to === mv.to);
    if (!legal) return null;
    const s = clone(state);
    const pl = s.players[s.cur];
    const from = pl.pieces[legal.piece];
    const { captured, house } = movePiece(s, s.cur, legal.piece, legal.to);
    s.used[legal.die] = true;
    if (captured.length) s.bonus = true;

    let path;
    if (legal.kind === 'enter') path = [0];
    else if (legal.kind === 'jump') path = [legal.to];
    else {
      path = [];
      for (let x = from + 1; x <= legal.to; x++) path.push(x);
    }

    const ev = {
      type: 'move',
      seat: pl.seat,
      piece: legal.piece,
      from,
      to: legal.to,
      kind: legal.kind,
      value: legal.value,
      path,
      captured,
      house,
    };

    if (pl.pieces.every((p) => p >= HOME_START)) {
      s.phase = 'over';
      s.winner = pl.seat;
      ev.win = true;
    } else if (s.used.every(Boolean)) {
      ev.turnEnd = finishTurn(s);
    } else if (legalMoves(s).length === 0) {
      ev.forfeit = true;
      ev.turnEnd = finishTurn(s);
    }
    return { state: s, event: ev };
  }

  SH.Engine = {
    LOOP,
    LOOP_END,
    HOME_START,
    HOME_END,
    PIECES,
    SEATS,
    clone,
    onLoop,
    isCorner,
    toGlobal,
    isHouseG,
    isHouse,
    wrap,
    piecesAt,
    isBlocked,
    pieceTargets,
    legalMoves,
    movePiece,
    newGame,
    rollDice,
    applyRoll,
    applyMove,
    playerBySeat: (state, seat) => state.players.find((p) => p.seat === seat),
  };
})();
