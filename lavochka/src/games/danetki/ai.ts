/* Данетки — боты. Ведущий-бот за столом отвечает по сценарию и проверяет вариант разгадки.
 * Игрок-бот спрашивает готовые вопросы (сложный чаще «попадает» в нужные — как человек, нащупавший версию), а «догадывается»,
 * когда выяснил достаточно: чем больше фактов и подсказок, тем вернее он выбирает правильный вариант. */
import type { Rng } from '../../core/types';
import { danetka } from './data';
import type { Action, View } from './engine';

const pick = <T>(a: T[], rng: Rng): T => a[rng.int(a.length)];

export function choose(v: View, me: number, level: number, rng: Rng): Action | null {
  if (v.phase === 'reveal') return { type: 'next' };
  if (v.phase !== 'play') return null;
  const d = danetka(v.id);
  if (!d) return null;

  // ведущий за столом
  if (v.pending != null && me === v.host) {
    const e = v.log[v.pending];
    if (e.guess) return { type: 'judge', right: e.opt != null && v.options[e.opt] === d.options[0] };
    return { type: 'answer', a: e.q != null ? d.questions[e.q].a : 'i' };
  }
  if (me !== v.turn || v.pending != null) return null;

  const asked = new Set(v.log.filter((e) => e.q != null).map((e) => e.q!));
  const unasked = d.questions.map((_, i) => i).filter((i) => !asked.has(i));
  const facts = v.log.filter((e) => e.a === 'y').length;
  const sure = facts + 1.5 * v.hints.length;
  const opts = [0, 1, 2, 3].filter((i) => !v.wrongOpts.includes(i));
  const lastTurn = v.rules && v.circle === v.circles && v.asked.length === v.players.length - 1;
  const ready = sure >= [6, 5, 4][level] || !unasked.length || lastTurn;

  if (ready && opts.length) {
    // насколько бот «понял» историю — с такой вероятностью выберет верный вариант
    const p = Math.min(0.95, 0.15 + sure * 0.09 + level * 0.1);
    const correct = v.options.indexOf(d.options[0]);
    const opt = opts.includes(correct) && rng.next() < p ? correct : pick(opts.filter((i) => i !== correct).length ? opts.filter((i) => i !== correct) : opts, rng);
    return { type: 'guess', opt };
  }
  // без правил с ботом-ведущим — попросить подсказку, когда вопросы на исходе
  if (!v.rules && v.host == null && unasked.length <= 3 && v.hints.length < v.totalHints) return { type: 'hint' };
  const yes = unasked.filter((i) => d.questions[i].a === 'y');
  const aim = [0.35, 0.5, 0.65][level];
  const q = yes.length && rng.next() < aim ? pick(yes, rng) : pick(unasked, rng);
  return { type: 'ask', q };
}
