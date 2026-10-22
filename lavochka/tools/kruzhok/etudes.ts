/* Этюды кружка: проверка Stockfish и сборка public/kruzhok/etudes.json.
 * Запуск: npx tsx tools/kruzhok/etudes.ts [исходник=tools/kruzhok/etudes-src.json] [--sf путь к stockfish.exe] [--out]
 * Исходник — массив этюдов (формат — EtudeSrc ниже; подборка — со ссылками на источник). Проверяет: законность позиции
 * и главного варианта, что каждый ход решающей стороны держит результат (выигрыш — оценка ≥ +3 или мат; ничья — не хуже
 * −0,8; мат — мат не дальше заданного), и что в конце варианта результат ясен. Пишет отчёт: ошибки — этюд выбывает,
 * пометки (защита не лучшая, есть второй решающий ход) — для вычитки. С --out — пишет public/kruzhok/etudes.json
 * из прошедших проверку. */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { inCheck, legalMoves } from '../../src/games/chess/engine';
import { parseLine, position, toFen } from '../../src/games/chess/notation';
import type { Etude } from '../../src/games/kruzhok/data';

interface EtudeSrc extends Omit<Etude, 'line'> {
  /** Главный вариант — SAN с номерами ходов. */
  solution: string;
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const src = args[0] && !args[0].startsWith('--') ? args[0] : 'tools/kruzhok/etudes-src.json';
const exe = flag('--sf') ?? 'D:/temp/kruzhok/sf/stockfish/stockfish-windows-x86-64-avx2.exe';
const MATE = 100000;

/** Stockfish: оценка за ходящего (мат — ±(MATE − ходов до мата)) и вторая линия. */
class Sf {
  private p = spawn(exe, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  private wait: ((l: string) => void) | null = null;
  constructor() {
    createInterface({ input: this.p.stdout }).on('line', (l) => this.wait?.(l));
    this.p.stdin.write('uci\nsetoption name Threads value 4\nsetoption name Hash value 256\n');
  }
  lines(fen: string, multi = 1, depth = 22): Promise<{ v: number; move: string }[]> {
    return new Promise((res) => {
      const out: { v: number; move: string }[] = [];
      this.wait = (l) => {
        const m = /multipv (\d+) score (cp|mate) (-?\d+).* pv (\S+)/.exec(l);
        if (m) {
          const n = Number(m[3]);
          out[Number(m[1]) - 1] = { v: m[2] === 'cp' ? n : Math.sign(n || -1) * (MATE - Math.abs(n)), move: m[4] };
        }
        if (l.startsWith('bestmove')) {
          this.wait = null;
          if (l.includes('(none)')) return res([{ v: inCheck(position(fen)) ? -MATE : 0, move: '' }]);
          res(out.filter(Boolean));
        }
      };
      this.p.stdin.write(`setoption name MultiPV value ${multi}\nposition fen ${fen}\ngo depth ${depth}\n`);
    });
  }
  quit() {
    this.p.stdin.write('quit\n');
  }
}

/** Держит ли оценка (за решающую сторону) цель этюда. */
function holds(e: EtudeSrc, v: number, movesLeft: number): boolean {
  if (e.goal === 'win') return v >= 300 || v >= MATE - 200;
  if (e.goal === 'draw') return v >= -80;
  return v >= MATE - movesLeft; // мат не дальше заданного
}

async function main() {
  const list: EtudeSrc[] = JSON.parse(readFileSync(src, 'utf8'));
  const sf = new Sf();
  const ok: Etude[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    const errs: string[] = [];
    const notes: string[] = [];
    if (!/^[a-z0-9-]+$/.test(e.id) || seen.has(e.id)) errs.push('id');
    seen.add(e.id);
    let line;
    try {
      const s = position(e.fen);
      if (s.board.filter((p) => p === 'K').length !== 1 || s.board.filter((p) => p === 'k').length !== 1) throw new Error('нужно по одному королю');
      if (inCheck({ board: s.board, turn: (1 - s.turn) as 0 | 1 })) throw new Error('шах стороне, которая не ходит');
      line = parseLine(e.solution, e.fen);
      if (line.uci.length < 1) throw new Error('пустое решение');
    } catch (x) {
      errs.push((x as Error).message);
    }
    if (line && !errs.length) {
      // ходы решающей стороны — чётные полуходы
      for (let i = 0; i < line.uci.length; i++) {
        const fen = line.fens[i];
        const mine = i % 2 === 0;
        const left = e.goal === 'mate' ? (e.mateIn ?? 99) - i / 2 : 0;
        const top = await sf.lines(fen, mine ? 2 : 1);
        const best = top[0]?.v ?? 0;
        const after = await sf.lines(line.fens[i + 1], 1, 20);
        const v = -(after[0]?.v ?? 0); // оценка после хода — за того, кто ходил
        if (mine) {
          if (!holds(e, v, left)) errs.push(`${i / 2 + 1}-й ход ${line.ru[i]}: результат не держится (оценка ${v})`);
          else if (top[1] && top[1].move !== line.uci[i] && holds(e, top[1].v, left)) notes.push(`${i / 2 + 1}-й ход ${line.ru[i]}: решает и ${top[1].move}`);
        } else if (v < best - 60 && !(Math.abs(best) >= MATE - 200)) notes.push(`защита ${line.ru[i]} не лучшая (${v} при ${best})`);
      }
      const end = position(line.fens[line.fens.length - 1]);
      if (!legalMoves(end).length && !inCheck(end) && e.goal !== 'draw') errs.push('в конце пат, а цель — выигрыш');
    }
    console.log(`${errs.length ? '✗' : notes.length ? '·' : '✓'} ${e.id} — ${e.title}${errs.length ? '\n    ' + errs.join('\n    ') : ''}${notes.length ? '\n    ~ ' + notes.join('\n    ~ ') : ''}`);
    if (!errs.length && line) {
      const { solution: _s, ...rest } = e;
      ok.push({ ...rest, fen: toFen(position(e.fen)), line: line.uci });
    }
  }
  sf.quit();
  console.log(`\nпрошли ${ok.length} из ${list.length}`);
  if (args.includes('--out')) {
    ok.sort((a, b) => a.level - b.level || a.year - b.year);
    writeFileSync('public/kruzhok/etudes.json', JSON.stringify({ src: 'Позиции — классические этюды (источники в tools/kruzhok/etudes-src.json); проверка — Stockfish', e: ok }));
    console.log('записано public/kruzhok/etudes.json');
  }
}

void main();
