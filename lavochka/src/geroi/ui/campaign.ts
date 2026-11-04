/* Кампании: выбор, ролики «окно + строка» (вступление — во весь экран), брифинг, итог сценария (CAMPAIGNS.md, DESIGN.md §9). */
import { CAMPAIGNS, CUTSCENE_TEXT, INTRO, introSeen, progressOf, saveProgress } from '../campaign';
import { DIFFICULTIES, type Difficulty, type CampaignDef, type ScenarioDef } from '../campaign/types';
import type { ScnState } from '../sim/adv/scenario';
import { button, h } from './common';

/** Печать по буквам; щелчок — дописать строку сразу, следующий — дальше. */
export function cutscenes(host: HTMLElement, ids: string[], full = false): Promise<void> {
  return new Promise((resolve) => {
    if (!ids.length) return resolve();
    const box = h('div', `c-cut${full ? ' full' : ''}`);
    const frame = h('div', 'c-frame');
    const v = h('video');
    v.loop = true;
    v.playsInline = true;
    const line = h('p', 'c-line');
    const hint = h('span', 'c-hint', 'щелчок — дальше');
    frame.append(v);
    box.append(frame, line, hint, button('Пропустить', () => finish(), 'g-btn small c-skip'));
    host.append(box);
    let shot = 0;
    let row = 0;
    let shown = 0;
    let text = '';
    let timer = 0;
    const finish = (): void => {
      window.clearInterval(timer);
      v.pause();
      box.remove();
      window.removeEventListener('keydown', key);
      resolve();
    };
    const type = (): void => {
      window.clearInterval(timer);
      shown = 0;
      line.textContent = '';
      timer = window.setInterval(() => {
        shown++;
        line.textContent = text.slice(0, shown);
        if (shown >= text.length) window.clearInterval(timer);
      }, 32);
    };
    const showShot = (): void => {
      const id = ids[shot];
      v.src = `/geroi/a/cutscenes/${id}.mp4`;
      v.play().catch(() => {});
      row = 0;
      text = CUTSCENE_TEXT[id]?.[0] ?? '';
      type();
    };
    const next = (): void => {
      if (shown < text.length) {
        window.clearInterval(timer);
        shown = text.length;
        line.textContent = text;
        return;
      }
      const lines = CUTSCENE_TEXT[ids[shot]] ?? [];
      if (row + 1 < lines.length) {
        row++;
        text = lines[row];
        type();
        return;
      }
      shot++;
      if (shot >= ids.length) finish();
      else showShot();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish();
      else if (e.key === ' ' || e.key === 'Enter') next();
    };
    box.onclick = (e) => {
      if ((e.target as HTMLElement).closest('.c-skip')) return;
      next();
    };
    window.addEventListener('keydown', key);
    showShot();
  });
}

/** Брифинг: что происходит и задания. */
export function briefing(host: HTMLElement, c: CampaignDef, i: number, onGo: () => void, onBack: () => void): void {
  const s = c.scenarios[i];
  const box = h('div', 'g-modal');
  const card = h('div', 'g-panel c-brief');
  const face = h('img', 'c-face');
  face.src = `/geroi/a/heroes/lad-${c.lad}.webp`;
  const goals = h('ul', 'c-goals');
  for (const g of s.spec.goals) if (!g.hidden) goals.append(h('li', g.optional ? 'dim' : '', g.text + (g.optional ? ' (по желанию)' : '')));
  for (const l of s.spec.lose) goals.append(h('li', 'c-lose', `Поражение: ${l.text.replace(/\.$/, '')}`));
  const text = h('div', 'c-brieftext');
  text.append(h('h2', '', `${i + 1}. ${s.title}`), h('p', '', s.brief), h('h3', '', 'Задания'), goals);
  const row = h('div', 'g-row');
  row.append(button('Назад', () => {
    box.remove();
    onBack();
  }), button('Начать', () => {
    box.remove();
    onGo();
  }, 'g-btn main'));
  text.append(row);
  card.append(face, text);
  box.append(card);
  host.append(box);
}

/** Задания посреди сценария (кнопка 📜). */
export function goalsCard(box: HTMLElement, s: ScnState): void {
  box.append(h('h3', '', 'Задания'));
  const ul = h('ul', 'c-goals');
  for (const g of s.goals) {
    if (g.hidden) continue;
    ul.append(h('li', g.done ? 'done' : g.optional ? 'dim' : '', `${g.done ? '✓ ' : ''}${g.text}${g.optional ? ' (по желанию)' : ''}`));
  }
  for (const l of s.lose) ul.append(h('li', 'c-lose', `Поражение: ${l.text.replace(/\.$/, '')}`));
  box.append(ul);
}

export interface CampaignHooks {
  play: (c: CampaignDef, i: number, diff: Difficulty) => void;
  back: () => void;
}

/** Экран кампаний: карточка на кампанию, сценарии по порядку, сложность. */
export function campaignScreen(screen: (...n: Node[]) => void, hooks: CampaignHooks): void {
  const wrap = h('div', 'c-list');
  for (const c of CAMPAIGNS) {
    const p = progressOf(c.id);
    const card = h('div', 'g-panel c-card');
    const face = h('img', 'c-face');
    face.src = `/geroi/a/heroes/lad-${c.lad}.webp`;
    const body = h('div', 'c-body');
    body.append(h('h2', '', c.title), h('b', '', c.hero), h('p', 'dim', c.text));
    const ol = h('ol', 'c-scen');
    c.scenarios.forEach((s: ScenarioDef, i) => {
      const li = h('li', i < p.done ? 'done' : i === p.done ? 'next' : 'locked');
      const name = `${s.title}${i < p.done ? ' ✓' : ''}`;
      if (i <= p.done && i < c.scenarios.length) {
        const b = button(name, () => hooks.play(c, i, diff.value as Difficulty), 'c-link');
        li.append(b);
      } else li.append(h('span', '', name));
      ol.append(li);
    });
    if (!c.scenarios.length) ol.append(h('li', 'locked', 'Скоро'));
    const diff = h('select', 'g-select');
    for (const [id, d] of Object.entries(DIFFICULTIES)) diff.append(new Option(d.name, id, false, id === p.diff));
    diff.onchange = () => saveProgress(c.id, { ...progressOf(c.id), diff: diff.value as Difficulty });
    const row = h('div', 'g-row c-row');
    const all = p.done >= c.scenarios.length && c.scenarios.length > 0;
    const go = button(all ? 'Пройдено — сыграть снова' : p.done ? 'Продолжить' : 'Начать', () => hooks.play(c, all ? 0 : p.done, diff.value as Difficulty), 'g-btn main');
    go.disabled = !c.scenarios.length;
    row.append(diff, go);
    if (p.done) {
      row.append(button('Сначала', () => {
        if (!confirm(`Начать «${c.title}» сначала? Прохождение и герой сбросятся.`)) return;
        saveProgress(c.id, { done: 0, diff: diff.value as Difficulty, carry: null, best: {} });
        campaignScreen(screen, hooks);
      }, 'g-btn small'));
    }
    body.append(ol, row);
    card.append(face, body);
    wrap.append(card);
  }
  const col = h('div', 'g-col c-col');
  col.append(h('h2', 'c-title', 'Кампании'), wrap);
  const foot = h('div', 'g-row');
  foot.append(button('Вступление', () => void cutscenes(document.getElementById('geroi')!, INTRO, true)), button('Назад', hooks.back));
  col.append(foot);
  screen(col);
}

export { introSeen };
