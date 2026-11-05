/* Кампании: выбор, ролики «окно + строка» (вступление — во весь экран), брифинг, итог сценария (CAMPAIGNS.md, DESIGN.md §9). */
import { CAMPAIGNS, CUTSCENE_TEXT, INTRO, introSeen, progressOf, saveProgress } from '../campaign';
import { DIFFICULTIES, type Difficulty, type CampaignDef, type ScenarioDef } from '../campaign/types';
import { SALE_OPEN, buyOffer, ownsFull } from './paid';
import type { ScnState } from '../sim/adv/scenario';
import { button, h } from './common';

/** Ролик играет один раз и замирает на последнем кадре; строки печатаются по буквам и листаются сами.
 *  Щелчок — дописать строку сразу, следующий — дальше. Промис отдаёт true, если ролики пропустили целиком. */
export function cutscenes(host: HTMLElement, ids: string[], full = false): Promise<boolean> {
  return new Promise((resolve) => {
    if (!ids.length) return resolve(false);
    const box = h('div', `c-cut${full ? ' full' : ''}`);
    const frame = h('div', 'c-frame');
    const v = h('video');
    v.playsInline = true;
    const line = h('p', 'c-line');
    const hint = h('span', 'c-hint', 'щелчок — дальше · Esc — пропустить');
    frame.append(v);
    box.append(frame, line, hint, button('Пропустить', () => finish(true), 'g-btn small c-skip'));
    host.append(box);
    let shot = 0;
    let row = 0;
    let shown = 0;
    let text = '';
    let timer = 0;
    let wait = 0;
    let ended = false;
    const finish = (skipped: boolean): void => {
      window.clearInterval(timer);
      window.clearTimeout(wait);
      v.pause();
      v.removeAttribute('src');
      box.remove();
      window.removeEventListener('keydown', key);
      resolve(skipped);
    };
    const lastRow = (): boolean => row + 1 >= (CUTSCENE_TEXT[ids[shot]] ?? []).length;
    /** Строка дописана: дать прочитать и листать дальше; последнюю строку кадра — только когда ролик кончился. */
    const typed = (): void => {
      window.clearTimeout(wait);
      if (lastRow() && !ended) return;
      wait = window.setTimeout(next, 1400 + text.length * 45);
    };
    const type = (): void => {
      window.clearInterval(timer);
      window.clearTimeout(wait);
      shown = 0;
      line.textContent = '';
      timer = window.setInterval(() => {
        shown++;
        line.textContent = text.slice(0, shown);
        if (shown >= text.length) {
          window.clearInterval(timer);
          typed();
        }
      }, 32);
    };
    const showShot = (): void => {
      const id = ids[shot];
      ended = false;
      v.src = `/geroi/a/cutscenes/${id}.mp4`;
      v.play().catch(() => {});
      row = 0;
      text = CUTSCENE_TEXT[id]?.[0] ?? '';
      type();
    };
    v.onended = v.onerror = () => {
      ended = true;
      if (shown >= text.length) typed();
    };
    const next = (): void => {
      if (shown < text.length) {
        window.clearInterval(timer);
        shown = text.length;
        line.textContent = text;
        typed();
        return;
      }
      if (!lastRow()) {
        row++;
        text = CUTSCENE_TEXT[ids[shot]][row];
        type();
        return;
      }
      shot++;
      if (shot >= ids.length) finish(false);
      else showShot();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish(true);
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

/** Выбор концовки после финальных роликов: окно с вопросом и ответами; промис отдаёт выбранный ответ. */
export function endingChoice(host: HTMLElement, e: NonNullable<CampaignDef['ending']>): Promise<NonNullable<CampaignDef['ending']>['options'][number]> {
  return new Promise((resolve) => {
    const box = h('div', 'g-modal');
    const card = h('div', 'g-panel c-brief c-ending');
    const text = h('div', 'c-brieftext');
    text.append(h('h2', '', e.ask));
    const row = h('div', 'g-row');
    e.options.forEach((o, i) => row.append(button(o.text, () => {
      box.remove();
      resolve(o);
    }, i === 0 ? 'g-btn main' : 'g-btn')));
    text.append(row);
    card.append(text);
    box.append(card);
    host.append(box);
  });
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

/** Почему кампания заперта; null — открыта. */
export function campaignLock(c: CampaignDef): { text: string; buy: boolean } | null {
  if (c.paid && !ownsFull()) return { text: 'Кампания из полной игры.', buy: true };
  const done = (id: string): boolean => {
    const x = CAMPAIGNS.find((k) => k.id === id);
    return !!x && progressOf(id).done >= x.scenarios.length;
  };
  const n = c.needs;
  if (!n) return null;
  const all = (n.all ?? []).every(done);
  const some = !n.some || n.some.of.filter(done).length >= n.some.n;
  if (all && some) return null;
  const parts: string[] = [];
  if (!all) parts.push(`пройти ${(n.all ?? []).map((id) => `«${CAMPAIGNS.find((k) => k.id === id)?.title ?? id}»`).join(' и ')}`);
  if (!some) parts.push(`и ещё ${n.some!.n} из кампаний ${n.some!.of.map((id) => `«${CAMPAIGNS.find((k) => k.id === id)?.title ?? id}»`).join(', ')}`);
  return { text: `Откроется, когда получится ${parts.join(' ')}.`, buy: false };
}

/** Экран кампаний: карточка на кампанию, сценарии по порядку, сложность. */
export function campaignScreen(screen: (...n: Node[]) => void, hooks: CampaignHooks): void {
  const wrap = h('div', 'c-list');
  for (const c of CAMPAIGNS) {
    // платную без покупки не показываем, пока продажа не открыта (ui/paid.ts)
    if (c.paid && !ownsFull() && !SALE_OPEN) continue;
    const p = progressOf(c.id);
    const lock = campaignLock(c);
    const card = h('div', 'g-panel c-card');
    const face = h('img', 'c-face');
    face.src = `/geroi/a/heroes/lad-${c.lad}.webp`;
    const body = h('div', 'c-body');
    body.append(h('h2', '', c.title), h('b', '', c.hero), h('p', 'dim', c.text));
    const end = p.ending && c.ending?.options.find((o) => o.id === p.ending);
    if (end) body.append(h('p', 'g-note', `Концовка: «${end.text}»`));
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
    if (lock) {
      // заперто: покупка или «сначала пройди…»
      go.textContent = lock.buy ? `🔒 Полная игра` : '🔒 Пока закрыто';
      go.disabled = !lock.buy;
      go.onclick = () => buyOffer(document.body);
      ol.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
      body.append(h('p', 'g-note', lock.text));
    }
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
