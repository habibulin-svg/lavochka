/* Шахматный кружок — учебник: оглавление по частям и урок шагами на настоящей доске (текст, позиция, стрелки,
 * показ ходов, «Твой ход»), в конце — «Запомни» и закрепление задачами из базы по теме урока.
 * Уроки — src/games/kruzhok/lessons/*.json (формат — docs/analysis/kruzhok-uchebnik.md). Пройденные — на устройстве. */
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { esc, h, sleep } from '../../core/util';
import { Board, type Arrow, type Mark } from '../chess/board';
import { play, sq, type State } from '../chess/engine';
import { stepPositions } from './lesson-steps';
import { fromUci, position, ruSan, toUci } from '../chess/notation';
import { levelOf, mountMihalych } from '../chess/mihalych';
import { loadLesson, loadLessonIndex, THEMES, type Lesson, type LessonInfo } from './data';
import { loadProgress } from './progress';
import { mountTrainer } from './trainer';

const KEY = 'kruzhok.lessons';
export const loadDone = () => store.get<Record<string, 1>>(KEY, {});
const markDone = (id: string) => store.set(KEY, { ...loadDone(), [id]: 1 });
export const resetLessons = () => store.set(KEY, {});

type Kind = 'good' | 'bad' | 'info' | 'hint';
const kindOf = (k: string | undefined): Kind => (k === 'good' || k === 'bad' || k === 'hint' ? k : 'info');
const arrowsOf = (list: string[] = []): Arrow[] =>
  list.map((a) => {
    const [m, k] = a.split(':');
    return { from: sq(m.slice(0, 2)), to: sq(m.slice(2, 4)), kind: kindOf(k) };
  });
const marksOf = (list: string[] = []): Mark[] =>
  list.map((a) => {
    const [s, k] = a.split(':');
    return { sq: sq(s), kind: kindOf(k) };
  });

export function mountLessons(stage: HTMLElement, panel: HTMLElement) {
  let sub: { destroy(): void } | null = null;
  const swap = (next: { destroy(): void }) => {
    sub?.destroy();
    sub = next;
  };
  const list = () => swap(mountContents(stage, panel, (info, all) => open(info, all)));
  const open = (info: LessonInfo, all: LessonInfo[]) => swap(mountLesson(stage, panel, info, all, list, open));
  list();
  return {
    destroy() {
      sub?.destroy();
    },
  };
}

function mountContents(stage: HTMLElement, panel: HTMLElement, open: (l: LessonInfo, all: LessonInfo[]) => void) {
  const page = h(`<div class="kz-journal sheet kz-gl"><h2>Учебник</h2><small class="hint">Открываю тетрадь…</small></div>`);
  stage.appendChild(page);
  const side = h(`<div class="kz-tr">
    <p>Учебник кружка: от того, как ходит ладья, до плана в середине партии. Каждый урок — на доске, шаг за шагом, с ходами, которые делаешь сам.</p>
    <p><small>После урока — задачи по теме из задачника кружка.</small></p>
  </div>`);
  panel.appendChild(side);
  void loadLessonIndex()
    .then((all) => {
      const done = loadDone();
      const parts = [...new Set(all.map((l) => l.part))];
      page.innerHTML =
        `<h2>Учебник</h2>` +
        (all.length ? '' : '<p>Уроки скоро появятся.</p>') +
        parts
          .map(
            (p) => `<h3>${esc(p)}</h3><div class="kz-gl-list">${all
              .filter((l) => l.part === p)
              .map((l) => `<button class="kz-gi${done[l.id] ? ' done' : ''}" data-id="${esc(l.id)}"><b>${l.n}. ${esc(l.title)}</b><small>${esc(l.goal)}</small>${done[l.id] ? '<i>✓ пройден</i>' : ''}</button>`)
              .join('')}</div>`,
          )
          .join('');
      page.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) => (b.onclick = () => (Sound.ui(), open(all.find((l) => l.id === b.dataset.id)!, all))));
    })
    .catch(() => (page.innerHTML = '<h2>Учебник</h2><p class="kz-err">Не удалось открыть учебник. Проверьте связь и откройте раздел ещё раз.</p>'));
  return {
    destroy() {
      page.remove();
      side.remove();
    },
  };
}

function mountLesson(stage: HTMLElement, panel: HTMLElement, info: LessonInfo, all: LessonInfo[], back: () => void, open: (l: LessonInfo, all: LessonInfo[]) => void) {
  const host = h('<div class="kz-host"></div>');
  stage.appendChild(host);
  const board = new Board(host);
  let alive = true;
  let l: Lesson | null = null;
  let starts: string[] = [];
  let at = 0;
  /** Ход «Твой ход» сделан (или показан) — можно дальше. */
  let solved = false;
  let drill: { destroy(): void } | null = null;

  const el = h(`<div class="kz-an kz-ls">
    <button class="btn kz-back">← Оглавление</button>
    <div class="kz-rank kz-ls-head"><b>${info.n}. ${esc(info.title)}</b><br><small>${esc(info.part)}</small></div>
    <div class="kz-msg kz-ls-text"><small class="hint">Открываю урок…</small></div>
    <div class="kz-nav">
      <button class="btn small" data-a="prev" title="Шаг назад">◀</button>
      <small class="kz-ls-step"></small>
      <button class="btn small primary" data-a="next" title="Дальше">▶</button>
    </div>
    <div class="kz-btns"></div>
  </div>`);
  panel.appendChild(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  q<HTMLButtonElement>('.kz-back').onclick = () => (Sound.ui(), back());

  const mh = mountMihalych(el, () => ({
    where: 'lesson',
    level: levelOf(loadProgress().rating.r),
    fen: board.fen,
    side: board.state.turn === 0 ? 'белые' : 'чёрные',
    theme: l ? `урок «${l.title}»: ${l.steps[Math.min(at, l.steps.length - 1)]?.text ?? ''}`.slice(0, 120) : undefined,
  }));

  const say = (html: string, kind: 'ok' | 'bad' | 'info' = 'info') => {
    const m = q('.kz-ls-text');
    m.className = `kz-msg kz-ls-text kz-${kind}`;
    m.innerHTML = html;
  };
  const buttons = (list: { text: string; primary?: boolean; on: () => void }[]) => {
    const box = q('.kz-btns');
    box.innerHTML = '';
    for (const b of list) {
      const x = h<HTMLButtonElement>(`<button class="btn${b.primary ? ' primary' : ''}">${b.text}</button>`);
      x.onclick = () => (Sound.ui(), b.on());
      box.appendChild(x);
    }
  };

  const nav = () => {
    const n = l!.steps.length;
    q('.kz-ls-step').textContent = at < n ? `шаг ${at + 1} из ${n}` : 'итог';
    q<HTMLButtonElement>('[data-a=prev]').disabled = at === 0;
    const st = l!.steps[at];
    q<HTMLButtonElement>('[data-a=next]').disabled = at >= n || (!!st?.try && !solved);
  };

  /** Показать ходы по очереди на доске. */
  const animate = async (s0: State, moves: string[], step: number) => {
    let s = s0;
    for (const u of moves) {
      await sleep(550);
      if (!alive || at !== step) return s;
      const m = fromUci(s, u);
      if (!m) break;
      s = play(s, m);
      board.set(s, { from: m.from, to: m.to });
      board.draw([{ from: m.from, to: m.to, kind: 'info' }]);
      m.captured ? Sound.capture() : Sound.place();
    }
    return s;
  };

  const show = () => {
    if (!l) return;
    drill?.destroy();
    drill = null;
    host.hidden = false;
    el.hidden = false;
    board.input(null);
    if (at >= l.steps.length) return summary();
    const st = l.steps[at];
    const s = position(starts[at]);
    solved = false;
    board.set(s);
    board.draw(arrowsOf(st.arrows), marksOf(st.marks));
    say(esc(st.text));
    buttons([]);
    if (st.play?.length) {
      const step = at;
      const run = async () => {
        board.set(s);
        board.draw(arrowsOf(st.arrows), marksOf(st.marks));
        await animate(s, st.play!, step);
      };
      buttons([{ text: '↻ Показать ещё раз', on: () => void run() }]);
      void run();
    }
    if (st.try) {
      board.input(s.turn, (m) => {
        const u = toUci(m);
        const ok = st.try!.good.includes(u);
        if (!ok) {
          Sound.nomove();
          board.set(s);
          board.draw(arrowsOf(st.arrows), [...marksOf(st.marks), { sq: m.to, kind: 'bad' }]);
          say(`${esc(st.text)}<br><b>${esc(ruSan(s, m))} — не то.</b> ${st.try!.hint ? esc(st.try!.hint) : 'Подумай ещё.'}`, 'bad');
          return;
        }
        void answered(s, u, true);
      });
      buttons([{ text: 'Покажи, как надо', on: () => void answered(s, st.try!.good[0], false) }]);
    }
    nav();
    mh.actions([{ label: 'Объясни иначе', kind: 'explain', say: 'Михалыч, объясни это по-другому, попроще.' }]);
    mh.typed({ kind: 'chat' });
  };

  const answered = async (s: State, u: string, mine: boolean) => {
    const st = l!.steps[at];
    const step = at;
    board.input(null);
    const m = fromUci(s, u)!;
    const after = play(s, m);
    board.set(after, { from: m.from, to: m.to });
    board.draw([{ from: m.from, to: m.to, kind: 'good' }]);
    m.captured ? Sound.capture() : Sound.place();
    if (mine) Sound.win();
    say(`${mine ? '<b>Верно!</b> ' : `Вот как: <b>${esc(ruSan(s, m))}</b>. `}${st.try!.say ? esc(st.try!.say) : ''}`, mine ? 'ok' : 'info');
    buttons([]);
    solved = true;
    nav();
    if (st.try!.reply) await animate(after, [st.try!.reply], step);
  };

  const summary = () => {
    markDone(l!.id);
    board.input(null);
    board.draw();
    say(`<b>Запомни.</b> ${esc(l!.summary)}`, 'ok');
    const next = all.find((x) => x.n === l!.n + 1);
    const d = l!.drill;
    buttons([
      ...(d ? [{ text: '🧩 Закрепить задачами', primary: true, on: () => practice(d) }] : []),
      ...(next ? [{ text: `Следующий урок: ${esc(next.title)} →`, primary: !d, on: () => open(next, all) }] : []),
      { text: 'К оглавлению', on: back },
    ]);
    nav();
  };

  const practice = (d: NonNullable<Lesson['drill']>) => {
    host.hidden = true;
    el.hidden = true;
    board.input(null);
    const title = d.themes.map((t) => THEMES.find((x) => x.id === t)?.name ?? t).join(', ');
    drill = mountTrainer(stage, panel, { drill: { ...d, title }, back: { label: `К уроку «${l!.title}»`, on: () => show() } });
  };

  const step = (d: -1 | 1) => {
    if (!l || drill) return;
    const n = l.steps.length;
    if (d < 0 ? at <= 0 : at >= n || (!!l.steps[at]?.try && !solved)) return;
    at += d;
    Sound.ui();
    show();
  };
  el.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    if (a?.dataset.a === 'prev') step(-1);
    else if (a?.dataset.a === 'next') step(1);
  });
  const keys = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  };
  document.addEventListener('keydown', keys);

  void loadLesson(info.file)
    .then((lesson) => {
      if (!alive) return;
      l = lesson;
      starts = stepPositions(lesson);
      q('.kz-ls-head').innerHTML = `<b>${lesson.n}. ${esc(lesson.title)}</b><br><small>${esc(lesson.part)} · ${esc(lesson.goal)}</small>`;
      show();
    })
    .catch(() => say('Не удалось открыть урок.', 'bad'));

  return {
    destroy() {
      alive = false;
      document.removeEventListener('keydown', keys);
      drill?.destroy();
      mh.destroy();
      board.destroy();
      host.remove();
      el.remove();
    },
  };
}
