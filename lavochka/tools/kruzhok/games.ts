/* Классические партии для кружка: отбор, разметка Stockfish на ПК и сборка public/kruzhok/games*.
 * Запуск: npx tsx tools/kruzhok/games.ts [D:/temp/kruzhok] [путь к stockfish.exe]
 *  1) партии ищутся в D:/temp/kruzhok/all.json (индекс PGN Mentor: игроки, год, ECO, результат, ходы) по списку
 *     tools/kruzhok/games-list.json: [id, «White|Black|год|ECO|результат», белые, чёрные, название, место];
 *  2) каждая позиция считается движком (MultiPV 4) — кэш в <dir>/marked/<id>.json, повторно не считается;
 *  3) из разметки — оценки после каждого хода, пометки (!, !!, ?, ??) и остановки «А как сходил бы ты?»
 *     (ход, который сильнее всех остальных: найти его — и есть задача); хорошие ответы — ходы в пределах 40 сп от лучшего;
 *  4) тексты (вступление, комментарии к ходам, итог) — tools/kruzhok/comments/<id>.json (пишутся по данным движка).
 * Выход: public/kruzhok/games.json (список) и public/kruzhok/games/<id>.json (партия). */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { inCheck } from '../../src/games/chess/engine';
import { fromUci, lineRu, parseLine, position, ruSan } from '../../src/games/chess/notation';

const dir = process.argv[2] ?? 'D:/temp/kruzhok';
const exe = process.argv[3] ?? join(dir, 'sf/stockfish/stockfish-windows-x86-64-avx2.exe');
const DEPTH = 16;
const MULTIPV = 4;
const MATE = 10000;

interface Raw {
  White: string;
  Black: string;
  Date?: string;
  Site?: string;
  Event?: string;
  Result: string;
  ECO?: string;
  moves: string;
}
interface Pv {
  /** Оценка за белых: сантипешки, мат — ±(MATE − ходов). */
  s: number;
  pv: string[];
}
type Marked = { fens: string[]; uci: string[]; ru: string[]; lines: Pv[][] };

// ── движок ──
class Sf {
  private p = spawn(exe, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  private wait: ((l: string) => void) | null = null;
  constructor() {
    createInterface({ input: this.p.stdout }).on('line', (l) => this.wait?.(l));
  }
  private send(c: string) {
    this.p.stdin.write(c + '\n');
  }
  private until(pred: (l: string) => boolean, each?: (l: string) => void) {
    return new Promise<string>((res) => {
      this.wait = (l) => {
        each?.(l);
        if (pred(l)) {
          this.wait = null;
          res(l);
        }
      };
    });
  }
  async init() {
    this.send('uci');
    await this.until((l) => l === 'uciok');
    for (const [k, v] of [['Threads', (await import('node:os')).cpus().length], ['Hash', 512], ['MultiPV', MULTIPV]]) this.send(`setoption name ${k} value ${v}`);
    this.send('isready');
    await this.until((l) => l === 'readyok');
  }
  async analyse(fen: string): Promise<Pv[]> {
    const white = fen.split(' ')[1] === 'w';
    const out: Pv[] = [];
    this.send(`position fen ${fen}`);
    this.send(`go depth ${DEPTH}`);
    await this.until(
      (l) => l.startsWith('bestmove'),
      (l) => {
        const m = /^info .*?depth (\d+) .*?multipv (\d+) score (cp|mate) (-?\d+).*? pv (.+)$/.exec(l);
        if (!m || Number(m[1]) < DEPTH - 1) return;
        const v = Number(m[4]);
        let s = m[3] === 'cp' ? v : Math.sign(v) * (MATE - Math.abs(v));
        if (m[3] === 'mate' && v === 0) s = -MATE;
        out[Number(m[2]) - 1] = { s: white ? s : -s, pv: m[5].split(' ').slice(0, 12) };
      },
    );
    return out.filter(Boolean);
  }
  quit() {
    this.send('quit');
  }
}

// ── отбор ──
/** [id, поиск, белые, чёрные, название, место, ключевые ходы — всегда вопрос: «30. Сa3», «21... Кf4»]. */
type ListRow = [string, string, string, string, string, string, string[]?];
const list = JSON.parse(readFileSync('tools/kruzhok/games-list.json', 'utf8')) as ListRow[];
// партии, которых нет в индексе (Бессмертная — только в сборниках), — из tools/kruzhok/games-extra.json; они первыми
const all = [...(JSON.parse(readFileSync('tools/kruzhok/games-extra.json', 'utf8')) as Raw[]), ...(JSON.parse(readFileSync(join(dir, 'all.json'), 'utf8')) as Raw[])];

function find(q: string): Raw {
  const [w, b, y, eco, res] = q.split('|').map((x) => x.toLowerCase());
  const hits = all.filter(
    (g) => g.White.toLowerCase().includes(w) && g.Black.toLowerCase().includes(b) && (g.Date ?? '').startsWith(y) && (g.ECO ?? '').toLowerCase() === eco && g.Result === res,
  );
  if (!hits.length) throw new Error(`нет партии ${q}`);
  return hits[0];
}

// ── оценка с точки зрения ходящего ──
const cap = (s: number) => Math.max(-2000, Math.min(2000, s));
const pov = (s: number, white: boolean) => (white ? s : -s);

async function main() {
  mkdirSync(join(dir, 'marked'), { recursive: true });
  mkdirSync('public/kruzhok/games', { recursive: true });
  let sf: Sf | null = null;
  const index: unknown[] = [];
  // справочник дебютов: самая длинная линия, с которой совпадает начало партии
  const openings = (JSON.parse(readFileSync('public/kruzhok/openings.json', 'utf8')) as { o: [string, string, string, string, string][] }).o.map(([, , uci, , ru]) => ({ uci: uci.split(' '), ru }));
  const openingOf = (moves: string[]) => {
    let best: { uci: string[]; ru: string } | null = null;
    for (const o of openings) if (o.uci.length <= moves.length && o.uci.every((u, i) => u === moves[i]) && (!best || o.uci.length > best.uci.length)) best = o;
    return best ? { ru: best.ru, family: best.ru.split(', ')[0] } : undefined;
  };
  for (const [id, q, white, black, title, place, must = []] of list) {
    const raw = find(q);
    const line = parseLine(raw.moves);
    const cache = join(dir, 'marked', `${id}.json`);
    let mk: Marked;
    if (existsSync(cache)) mk = JSON.parse(readFileSync(cache, 'utf8'));
    else {
      if (!sf) {
        sf = new Sf();
        await sf.init();
      }
      const lines: Pv[][] = [];
      for (const fen of line.fens) {
        lines.push(await sf.analyse(fen));
        if (process.env.SF_DEBUG) console.log(lines.length, fen);
      }
      mk = { fens: line.fens, uci: line.uci, ru: line.ru, lines };
      writeFileSync(cache, JSON.stringify(mk));
      console.log('размечено', id, line.uci.length, 'полуходов');
    }
    const game = build(id, raw, mk, { white, black, title, place }, must);
    const text = join('tools/kruzhok/comments', `${id}.json`);
    if (existsSync(text)) Object.assign(game, JSON.parse(readFileSync(text, 'utf8')));
    (game as { opening?: unknown }).opening = openingOf(mk.uci);
    writeFileSync(join('public/kruzhok/games', `${id}.json`), JSON.stringify(game));
    index.push({ id, white, black, title, place, year: Number(raw.Date?.slice(0, 4)), result: raw.Result, eco: raw.ECO, plies: mk.uci.length, stops: game.stops.length });
  }
  sf?.quit();
  writeFileSync('public/kruzhok/games.json', JSON.stringify({ src: 'Ходы — PGN Mentor (pgnmentor.com); разметка — Stockfish', g: index }));
  console.log('партий', index.length);
}

export interface Stop {
  /** Номер полухода (0 — первый ход белых), который надо найти. */
  ply: number;
  /** Ходы UCI, которые засчитываются (сыгранный и равные ему по оценке). */
  good: string[];
  /** Насколько сыгранный ход лучше следующего по силе, сантипешки (для подачи: «единственный ход»). */
  gap: number;
}

function build(id: string, raw: Raw, mk: Marked, meta: { white: string; black: string; title: string; place: string }, must: string[] = []) {
  // ключевые ходы из списка: «30. Сa3» → номер полухода (с проверкой, что так и сыграно)
  const forced = must.map((t) => {
    const m = /^(\d+)\.(\.\.)?\s*(\S+)$/.exec(t.trim());
    if (!m) throw new Error(`${id}: ключевой ход «${t}» — не «30. Сa3»`);
    const ply = (Number(m[1]) - 1) * 2 + (m[2] ? 1 : 0);
    const s = position(mk.fens[ply]);
    const mv = fromUci(s, mk.uci[ply] ?? '');
    const played = mv ? ruSan(s, mv) : '?';
    if (played.replace(/[+#]/g, '') !== m[3].replace(/[+#!?]/g, '')) throw new Error(`${id}: ключевой ход «${t}», а в партии ${played}`);
    return ply;
  });
  const n = mk.uci.length;
  // оценка после каждого полухода (за белых): лучшая линия следующей позиции; после мата — ±MATE
  const ev: number[] = [];
  for (let i = 1; i <= n; i++) {
    const l = mk.lines[i]?.[0];
    ev.push(l ? l.s : i % 2 ? MATE : -MATE);
  }
  const marks: Record<number, string> = {};
  const cands: { ply: number; score: number; good: string[]; gap: number }[] = [];
  const winner = raw.Result === '1-0' ? 0 : raw.Result === '0-1' ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const w = i % 2 === 0;
    const L = mk.lines[i];
    if (!L?.length) continue;
    const best = cap(pov(L[0].s, w));
    const after = cap(pov(ev[i], w));
    // сыгран лучший ход движка — не ошибка, даже если оценка следующей позиции чуть «уплыла» (разная глубина счёта)
    const loss = L[0].pv[0] === mk.uci[i] ? 0 : best - after;
    const key = forced.includes(i);
    // «?» — только если ход что-то меняет: при перевесе больше пяти пешек неточность не ошибка
    if (!key && after < 500) {
      if (loss >= 300) marks[i] = '??';
      else if (loss >= 120) marks[i] = '?';
    }
    if (key) {
      marks[i] = '!!';
      const good = [mk.uci[i], ...L.filter((x) => cap(pov(x.s, w)) >= after - 40).map((x) => x.pv[0])];
      cands.push({ ply: i, score: 10000, good: [...new Set(good)], gap: L.length > 1 ? best - cap(pov(L[1].s, w)) : 0 });
      continue;
    }
    if (loss > 30 || L.length < 2) continue;
    // мат в 1, когда матует только этот ход, — тоже находка (обрезанные оценки матов равны)
    const gap = pov(L[0].s, w) === MATE - 1 && pov(L[1].s, w) < MATE - 1 ? 400 : best - cap(pov(L[1].s, w));
    // взятие в ответ на взятие на том же поле — не находка
    const prev = mk.uci[i - 1];
    const recapture = !!prev && prev.slice(2, 4) === mk.uci[i].slice(2, 4) && isCapture(mk, i - 1) && isCapture(mk, i);
    // «!» — находка, а не вынужденный ход: не взятие в ответ, не уход от шаха, не у стороны, которая уже проигрывает
    const check = inCheck(position(mk.fens[i]));
    const loser = winner >= 0 && i % 2 !== winner;
    if (!recapture && !check && !loser && best > -150) {
      if (gap >= 300) marks[i] = '!!';
      else if (gap >= 150) marks[i] = '!';
    }
    if (i < 10 || recapture || check || gap < 90) continue;
    const good = [mk.uci[i], ...L.filter((x) => cap(pov(x.s, w)) >= best - 40).map((x) => x.pv[0])];
    cands.push({ ply: i, score: Math.min(gap, 700) + (i % 2 === winner ? 150 : 0), good: [...new Set(good)], gap });
  }
  cands.sort((a, b) => b.score - a.score);
  const stops: Stop[] = [];
  // подряд можно: в комбинации каждый следующий ход — своя задача
  for (const c of cands) {
    if (stops.length >= 6) break;
    stops.push({ ply: c.ply, good: c.good, gap: c.gap });
  }
  stops.sort((a, b) => a.ply - b.ply);
  // лучшая линия в позиции остановки и после ошибок — для комментариев и Михалыча
  const best: Record<number, string> = {};
  for (const i of [...stops.map((s) => s.ply), ...Object.keys(marks).map(Number).filter((k) => marks[k].includes('?'))])
    best[i] = lineRu(mk.fens[i], mk.lines[i][0].pv, 8);
  return {
    id,
    ...meta,
    year: Number(raw.Date?.slice(0, 4)),
    event: raw.Event ?? '',
    result: raw.Result,
    eco: raw.ECO ?? '',
    uci: mk.uci,
    ev,
    marks,
    stops,
    best,
    intro: '',
    notes: {} as Record<string, string>,
    outro: '',
  };
}

function isCapture(mk: Marked, i: number): boolean {
  const count = (fen: string) => fen.split(' ')[0].replace(/[^a-zA-Z]/g, '').length;
  return count(mk.fens[i + 1]) < count(mk.fens[i]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
