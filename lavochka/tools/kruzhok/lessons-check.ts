/* Проверка уроков учебника и сборка оглавления (src/games/kruzhok/lessons/index.json).
 * Запуск: npx tsx tools/kruzhok/lessons-check.ts [--sf путь к stockfish.exe] [--only 01,02,15] [--threads 1]
 * (--only — проверять только эти уроки по номеру; оглавление пишется только при полной проверке)
 * Проверяет: поля урока, законность позиций (оба короля, у ждущей стороны нет шаха), ходы play/try/reply,
 * стрелки и подсветку; с --sf — что каждый засчитываемый ход в «Твой ход» не хуже лучшего хода движка на 0,5 пешки
 * (при решающем перевесе — на четверть оценки; или тоже ставит мат). Ошибки — списком с файлом и шагом; код выхода 1, если они есть. */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { inCheck, legalMoves, play } from '../../src/games/chess/engine';
import { fromUci, position, toFen } from '../../src/games/chess/notation';
import type { Lesson } from '../../src/games/kruzhok/data';
import { THEMES } from '../../src/games/kruzhok/themes';
import { stepPositions } from '../../src/games/kruzhok/lesson-steps';

const dir = 'src/games/kruzhok/lessons';
const sfAt = process.argv.indexOf('--sf');
const exe = sfAt > 0 ? process.argv[sfAt + 1] : null;
const onlyAt = process.argv.indexOf('--only');
const only = onlyAt > 0 ? process.argv[onlyAt + 1].split(',').map((x) => x.padStart(2, '0')) : null;
const thAt = process.argv.indexOf('--threads');
const threads = thAt > 0 ? Number(process.argv[thAt + 1]) : 4;
const errors: string[] = [];
const SQ = /^[a-h][1-8]$/;
const KIND = /^(good|bad|hint|info)$/;

/** Оценка хода движком: на сколько он хуже лучшего (сантипешки, за ходящего). */
class Sf {
  private p = spawn(exe!, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  private wait: ((l: string) => void) | null = null;
  constructor() {
    createInterface({ input: this.p.stdout }).on('line', (l) => this.wait?.(l));
    this.p.stdin.write(`uci\nsetoption name Threads value ${threads}\n`);
  }
  /** Оценка позиции за ходящего: сантипешки, мат — ±(100000 − ходов). */
  score(fen: string): Promise<number> {
    return new Promise((res) => {
      let v = 0;
      this.wait = (l) => {
        const m = /score (cp|mate) (-?\d+)/.exec(l);
        if (m) v = m[1] === 'cp' ? Number(m[2]) : Math.sign(Number(m[2]) || -1) * (100000 - Math.abs(Number(m[2])));
        if (l.startsWith('bestmove')) {
          this.wait = null;
          res(l.includes('(none)') ? (inCheck(position(fen)) ? -100000 : 0) : v);
        }
      };
      this.p.stdin.write(`position fen ${fen}\ngo depth 14\n`);
    });
  }
  quit() {
    this.p.stdin.write('quit\n');
  }
}

function legal(fen: string, where: string): boolean {
  try {
    const s = position(fen);
    if (s.board.filter((p) => p === 'K').length !== 1 || s.board.filter((p) => p === 'k').length !== 1) throw new Error('нужно по одному королю');
    if (inCheck({ board: s.board, turn: (1 - s.turn) as 0 | 1 })) throw new Error('шах стороне, которая не ходит');
    if (s.board.some((p, i) => (p === 'P' || p === 'p') && (i < 8 || i >= 56))) throw new Error('пешка на крайней горизонтали');
    return true;
  } catch (e) {
    errors.push(`${where}: позиция «${fen}» — ${(e as Error).message}`);
    return false;
  }
}

async function main() {
  const sf = exe ? new Sf() : null;
  const files = readdirSync(dir).filter((f) => /^\d\d-[a-z0-9-]+\.json$/.test(f) && (!only || only.includes(f.slice(0, 2)))).sort();
  const index: Omit<Lesson, 'steps' | 'summary'>[] = [];
  const themeIds = new Set(THEMES.map((t) => t.id));
  for (const f of files) {
    let l: Lesson;
    try {
      l = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch (e) {
      errors.push(`${f}: не JSON — ${(e as Error).message}`);
      continue;
    }
    const [, nn, id] = /^(\d\d)-(.+)\.json$/.exec(f)!;
    if (l.n !== Number(nn) || l.id !== id) errors.push(`${f}: n/id не совпадают с именем файла`);
    for (const k of ['part', 'title', 'goal', 'summary'] as const) if (!l[k]?.trim()) errors.push(`${f}: пусто поле ${k}`);
    if (!Array.isArray(l.steps) || l.steps.length < 3) errors.push(`${f}: мало шагов`);
    if (l.drill) for (const t of l.drill.themes) if (!themeIds.has(t)) errors.push(`${f}: неизвестная тема закрепления ${t}`);
    // позиции шагов и ходы
    let starts: string[] = [];
    try {
      starts = stepPositions(l);
    } catch (e) {
      errors.push(`${f}: ${(e as Error).message}`);
      continue;
    }
    for (let i = 0; i < l.steps.length; i++) {
      const st = l.steps[i];
      const w = `${f} шаг ${i + 1}`;
      if (!st.text?.trim()) errors.push(`${w}: нет текста`);
      if (st.text && st.text.split(/\s+/).length > 70) errors.push(`${w}: длинный текст (${st.text.split(/\s+/).length} слов)`);
      if (!legal(starts[i], w)) continue;
      for (const a of st.arrows ?? []) {
        const [m, k] = a.split(':');
        if (!SQ.test(m.slice(0, 2)) || !SQ.test(m.slice(2, 4)) || m.length !== 4 || (k && !KIND.test(k))) errors.push(`${w}: стрелка «${a}»`);
      }
      for (const a of st.marks ?? []) {
        const [s, k] = a.split(':');
        if (!SQ.test(s) || (k && !KIND.test(k))) errors.push(`${w}: подсветка «${a}»`);
      }
      let s = position(starts[i]);
      for (const u of st.play ?? []) {
        const m = fromUci(s, u);
        if (!m) {
          errors.push(`${w}: невозможный ход play «${u}» в ${toFen(s)}`);
          break;
        }
        s = play(s, m);
      }
      if (st.try) {
        if (!st.try.good?.length) errors.push(`${w}: try без good`);
        const fen = toFen(s);
        const moves = legalMoves(s);
        if (!moves.length) errors.push(`${w}: в позиции «Твой ход» нет ходов`);
        for (const u of st.try.good ?? []) if (!fromUci(s, u)) errors.push(`${w}: невозможный ход try «${u}» в ${fen}`);
        const g = st.try.good?.[0] ? fromUci(s, st.try.good[0]) : null;
        if (g && st.try.reply && !fromUci(play(s, g), st.try.reply)) errors.push(`${w}: невозможный ответ «${st.try.reply}»`);
        if (sf && g && moves.length > 1) {
          // лучшее, что есть, — по ответам на каждый ход (сколько стоит позиция после него за ходящего)
          let best = -Infinity;
          const val = new Map<string, number>();
          for (const m of moves) {
            const after = play(s, m);
            const v = -(await sf.score(toFen(after)));
            val.set(m.from + '-' + m.to + (m.promo ?? ''), v);
            best = Math.max(best, v);
          }
          for (const u of st.try.good) {
            const m = fromUci(s, u);
            if (!m) continue;
            const v = val.get(m.from + '-' + m.to + (m.promo ?? ''))!;
            const mate = best > 90000;
            // при решающем перевесе движок «предпочитает» один из выигрывающих ходов — допуск шире (четверть оценки)
            if (mate ? v < 90000 : v < best - Math.max(50, best >= 400 ? best / 4 : 0)) errors.push(`${w}: ход ${u} слабее лучшего (${v} против ${best}) в ${fen}`);
          }
        }
      }
    }
    index.push({ id: l.id, n: l.n, part: l.part, title: l.title, goal: l.goal, ...(l.drill ? { drill: l.drill } : {}) });
  }
  sf?.quit();
  if (!only) writeFileSync(join(dir, 'index.json'), JSON.stringify(index, null, 1) + '\n');
  console.log(`уроков ${files.length}${errors.length ? `, ошибок ${errors.length}:` : ', ошибок нет'}`);
  for (const e of errors) console.log(' - ' + e);
  process.exit(errors.length ? 1 : 0);
}

void main();
