/* Справки для вычитки уроков: на каждом шаге — что на самом деле стоит на доске и что происходит, словами
 * (расстановка, стрелки, подсветка, ходы показа и «Твой ход»). По ним проверяют, что текст шага совпадает с доской.
 * Запуск: npx tsx tools/kruzhok/lessons-brief.ts [D:/temp/kruzhok/lbrief] → <dir>/<файл урока>.txt */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { play } from '../../src/games/chess/engine';
import { boardFacts, moveWords } from '../../src/games/chess/facts';
import { fromUci, position, ruSan, toFen } from '../../src/games/chess/notation';
import type { Lesson } from '../../src/games/kruzhok/data';
import { stepPositions } from '../../src/games/kruzhok/lesson-steps';

const out = process.argv[2] ?? 'D:/temp/kruzhok/lbrief';
const dir = 'src/games/kruzhok/lessons';
mkdirSync(out, { recursive: true });

/** Ходы по очереди: «Кf3 (белый конь с g1 идёт на f3)». */
function moves(fen: string, list: string[]): { text: string; fen: string } {
  let s = position(fen);
  const t: string[] = [];
  for (const u of list) {
    const m = fromUci(s, u);
    if (!m) {
      t.push(`${u} — НЕВОЗМОЖЕН`);
      break;
    }
    t.push(`${ruSan(s, m)} (${moveWords(s, m)})`);
    s = play(s, m);
  }
  return { text: t.join('; '), fen: toFen(s) };
}

for (const f of readdirSync(dir).filter((x) => /^\d\d-.*\.json$/.test(x))) {
  const l = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Lesson;
  const starts = stepPositions(l);
  const rows: string[] = [`Урок ${l.n}. ${l.title} (${l.part}) — ${l.goal}`, ''];
  l.steps.forEach((st, i) => {
    rows.push(`ШАГ ${i + 1}${st.fen ? ' (новая позиция)' : ' (позиция после прошлого шага)'}`);
    rows.push(`  ТЕКСТ: ${st.text}`);
    for (const b of boardFacts(starts[i])) rows.push(`  доска: ${b}`);
    if (st.arrows?.length) rows.push(`  стрелки: ${st.arrows.join(', ')}`);
    if (st.marks?.length) rows.push(`  подсветка: ${st.marks.join(', ')}`);
    let fen = starts[i];
    if (st.play?.length) {
      const p = moves(fen, st.play);
      rows.push(`  показ ходов: ${p.text}`);
      fen = p.fen;
    }
    if (st.try) {
      const s = position(fen);
      rows.push(`  ТВОЙ ХОД (за ${s.turn === 0 ? 'белых' : 'чёрных'}), засчитываются: ${st.try.good.map((u) => moves(fen, [u]).text).join(' | ')}`);
      if (st.try.hint) rows.push(`  подсказка: ${st.try.hint}`);
      if (st.try.say) rows.push(`  после верного: ${st.try.say}`);
      if (st.try.reply) rows.push(`  ответ соперника: ${moves(moves(fen, [st.try.good[0]]).fen, [st.try.reply]).text}`);
    }
    rows.push('');
  });
  rows.push(`ЗАПОМНИ: ${l.summary}`);
  writeFileSync(join(out, f.replace('.json', '.txt')), rows.join('\n') + '\n');
}
console.log('готово', out);
