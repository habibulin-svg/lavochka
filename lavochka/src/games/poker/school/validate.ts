/* Школа покера — проверка урока: поля, столы (карты есть и не повторяются, ходы `pre` и показа подходят движку),
 * задачи (расчёт без ошибок, заявленный ответ совпадает с посчитанным, ответ не висит на волоске, герой правда ходит).
 * Гоняют тест tests/poker-school.test.ts и tools/poker/school-check.ts. */
import { buildScene, playAct } from './scene';
import { solve } from './solve';
import type { Lesson, Task } from './types';

/** Минимальный запас до границы решения — чтобы ответ не менялся от округления или зерна. */
const MARGIN: Partial<Record<Task['kind'], number>> = {
  callfold: 0.03,
  open: 0.015,
  pushfold: 0.25,
  potodds: 2,
  betodds: 2,
  outs: 1,
  bubble: 0.08,
  icm: 0.4,
  bluff: 0.03,
};
/** Задачи-решения: на столе должен ходить герой. */
const DECIDE = new Set<Task['kind']>(['callfold', 'pushfold', 'open', 'potodds']);

export function checkLesson(l: Lesson): string[] {
  const err: string[] = [];
  const at = (w: string) => (m: string) => err.push(`${l.id} ${w}: ${m}`);
  if (!l.id || !l.title || !l.goal || !l.n) at('урок')('нет id/n/title/goal');
  if (!l.steps?.length) at('урок')('нет шагов');
  if (!l.remember?.length) at('урок')('нет «Запомни»');
  if (!l.tasks || l.tasks.length < 5 || l.tasks.length > 10) at('урок')(`задач ${l.tasks?.length ?? 0} — нужно 5–10`);
  if (!l.game?.bots?.length || !l.game.text) at('урок')('нет игры-закрепления');
  // шаги: первый — со столом, ходы показа подходят
  let cur = null as ReturnType<typeof buildScene>['s'] | null;
  (l.steps ?? []).forEach((st, i) => {
    const e = at(`шаг ${i + 1}`);
    if (!st.text) e('нет текста');
    if (st.scene) {
      const b = buildScene(st.scene);
      if (b.error) e(b.error);
      cur = b.s;
    } else if (i === 0) e('первому шагу нужен стол');
    for (const [k, p] of (st.play ?? []).entries()) {
      if (!cur) break;
      const nx = playAct(cur, p.act);
      if (!nx) {
        e(`ход показа ${k + 1} (${p.act.join(' ')}) не подошёл: ходит место ${cur.turn}`);
        break;
      }
      cur = nx;
    }
  });
  const ids = new Set<string>();
  for (const t of l.tasks ?? []) {
    const e = at(`задача ${t.id}`);
    if (ids.has(t.id)) e('повтор id');
    ids.add(t.id);
    if (!t.q || !t.why) e('нет вопроса или объяснения');
    const r = solve(t);
    if (r.error) {
      e(r.error);
      continue;
    }
    if (!r.options.some(([v]) => v === t.answer)) e(`ответа «${t.answer}» нет среди вариантов`);
    if (r.answer !== t.answer) e(`заявлен «${t.answer}», а расчёт даёт «${r.answer}» (${r.facts.replace(/<[^>]+>/g, '')})`);
    const need = MARGIN[t.kind];
    if (need != null && r.margin != null && r.margin < need) e(`ответ на волоске: запас ${r.margin.toFixed(3)} < ${need}`);
    if (t.scene && DECIDE.has(t.kind)) {
      const b = buildScene(t.scene);
      if (b.s.over || b.s.turn !== b.hero) e(`на столе ходит не герой (место ${b.s.turn})`);
    }
  }
  return err;
}
