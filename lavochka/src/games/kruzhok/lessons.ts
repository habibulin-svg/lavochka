/* Шахматный кружок — учебник: оглавление по частям и урок шагами на настоящей доске (текст, позиция, стрелки,
 * показ ходов, «Твой ход»), в конце — «Запомни» и закрепление задачами из базы по теме урока.
 * Уроки — src/games/kruzhok/lessons/*.json (формат — docs/analysis/kruzhok-uchebnik.md). Пройденные — на устройстве. */
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { esc, h, sleep } from '../../core/util';
import { Board, type Arrow, type Mark } from '../chess/board';
import { inCheck, insufficient, legalMoves, play, sq, type Move, type State } from '../chess/engine';
import { starsBest, starsDone, stepPositions, whiteAgain } from './lesson-steps';
import { fromUci, position, ruSan, toFen, toUci } from '../chess/notation';
import { levelOf, mountMihalych } from '../chess/mihalych';
import { score, stockfish } from '../chess/stockfish';
import { loadLesson, loadLessonIndex, THEMES, type Lesson, type LessonInfo, type LessonStep } from './data';
import { loadProgress } from './progress';
import { mountTrainer } from './trainer';
import { leaveSub, lessonPath, setPath } from './pages';
import { addStars, completeNode, DRILL_COUNT } from './path';
import { touch } from './cloud';

/** Записать часть журнала кружка (и отметить для копии в базе). */
const putJournal = (key: string, v: unknown) => {
  store.set(key, v);
  touch();
};

const KEY = 'kruzhok.lessons';
export const loadDone = () => store.get<Record<string, 1>>(KEY, {});
const markDone = (id: string) => putJournal(KEY, { ...loadDone(), [id]: 1 });
export const resetLessons = () => putJournal(KEY, {});

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

/** start — id урока, открытого адресом /shahmatnyj-kruzhok/uchebnik/<id>/. */
export function mountLessons(stage: HTMLElement, panel: HTMLElement, start?: string) {
  let sub: { destroy(): void } | null = null;
  let alive = true;
  const swap = (next: { destroy(): void }) => {
    sub?.destroy();
    sub = next;
  };
  const list = () => {
    leaveSub('uchebnik');
    swap(mountContents(stage, panel, (info, all) => open(info, all)));
  };
  const open = (info: LessonInfo, all: LessonInfo[]) => {
    setPath(lessonPath(info.id));
    swap(mountLesson(stage, panel, info, all, list, open));
  };
  if (start)
    void loadLessonIndex()
      .then((all) => {
        if (!alive) return;
        const info = all.find((l) => l.id === start);
        info ? open(info, all) : list();
      })
      .catch(() => alive && list());
  else list();
  return {
    destroy() {
      alive = false;
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

/** Открыт с «Пути»: в конце урока — «Дальше по пути» вместо «следующего урока»; назад — к пути. */
export interface LessonPathOpts {
  backLabel: string;
  next?: { label: string; on: () => void };
}

export function mountLesson(stage: HTMLElement, panel: HTMLElement, info: LessonInfo, all: LessonInfo[], back: () => void, open: (l: LessonInfo, all: LessonInfo[]) => void, path?: LessonPathOpts) {
  const host = h('<div class="kz-host"></div>');
  stage.appendChild(host);
  const board = new Board(host);
  let alive = true;
  let l: Lesson | null = null;
  let starts: string[] = [];
  let at = 0;
  /** Ход «Твой ход» сделан (или показан) — можно дальше. */
  let solved = false;
  /** На этом шаге уже был неверный ход — звёзд за «Твой ход» нет. */
  let missed = false;
  let drill: { destroy(): void } | null = null;

  const el = h(`<div class="kz-an kz-ls">
    <button class="btn kz-back">← ${esc(path?.backLabel ?? 'Оглавление')}</button>
    <div class="kz-rank kz-ls-head"><b>${info.n}. ${esc(info.title)}</b><br><small>${esc(info.part)}</small></div>
    <div class="kz-msg kz-ls-text" aria-live="polite"><small class="hint">Открываю урок…</small></div>
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
    q<HTMLButtonElement>('[data-a=next]').disabled = at >= n || (!!(st?.try || st?.stars || st?.fight) && !solved);
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
    if (board.flipped) board.flip(false);
    if (at >= l.steps.length) return summary();
    const st = l.steps[at];
    const s = position(starts[at]);
    solved = false;
    missed = false;
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
        if (!ok) return void other(s, m);
        void answered(s, u, true);
      });
      buttons([{ text: 'Покажи, как надо', on: () => void answered(s, st.try!.good[0], false) }]);
    }
    if (st.stars) runStars(st);
    if (st.fight) runFight(st);
    nav();
    mh.actions([{ label: 'Объясни иначе', kind: 'explain', say: 'Михалыч, объясни это по-другому, попроще.' }]);
    mh.typed({ kind: 'chat' });
  };

  /** «Собери звёздочки»: фигура ходит подряд, звезда берётся, когда фигура встала на её поле; чёрных — съесть. */
  const runStars = (st: LessonStep) => {
    const step = at;
    const best = starsBest(starts[at], st.stars!.at);
    let s = whiteAgain(position(starts[at]));
    let left: number[] = [];
    let n = 0;
    const paint = (last: { from: number; to: number } | null = null) => {
      board.set(s, last);
      board.draw(arrowsOf(st.arrows), [...marksOf(st.marks), ...left.map((x) => ({ sq: x, kind: 'star' as const }))]);
    };
    const status = (extra = '') => say(`${esc(st.text)}<br><small>Ходов: <b>${n}</b>${best > 0 ? ` · можно управиться за ${best}` : ''}</small>${extra}`);
    const listen = () =>
      board.input(0, (m) => {
        if (!alive || at !== step) return;
        n++;
        s = whiteAgain(play(s, m));
        const got = left.includes(m.to);
        left = left.filter((x) => x !== m.to);
        paint({ from: m.from, to: m.to });
        if (m.captured) Sound.capture();
        else if (got) Sound.beep(1320, 0.09, 0.14);
        else Sound.place();
        if (!starsDone(s, left)) return void (status(), listen());
        board.input(null);
        Sound.win();
        const quick = best > 0 && n <= best;
        if (quick && !solved) addStars(2, 'быстрее не бывает');
        solved = true;
        say(
          `<b>Всё собрано!</b> Ходов: ${n}. ${quick ? 'Быстрее не бывает!' : best > 0 ? `А можно было за ${best} — попробуешь ещё раз?` : ''}${st.stars!.say ? ' ' + esc(st.stars!.say) : ''}`,
          'ok',
        );
        buttons([{ text: '↻ Ещё раз', on: start }]);
        nav();
      });
    const start = () => {
      if (!alive || at !== step) return;
      s = whiteAgain(position(starts[step]));
      left = st.stars!.at.map(sq);
      n = 0;
      paint();
      status();
      listen();
      buttons([
        { text: '↻ Начать заново', on: start },
        ...(st.stars!.hint ? [{ text: '💡 Подсказка', on: () => status(`<br>${esc(st.stars!.hint!)}`) }] : []),
      ]);
    };
    start();
  };

  /** «Доиграй против движка»: ученик ведёт позицию, Stockfish отвечает; упустил выигрыш (или ничью) — сначала. */
  const runFight = (st: LessonStep) => {
    const f = st.fight!;
    const step = at;
    const me = position(starts[at]).turn;
    const need = f.moves ?? 12;
    const goal = f.goal === 'queen' ? 'Проведи пешку в ферзи' : f.goal === 'mate' ? 'Поставь мат' : `Продержись ${need} ходов`;
    let s = position(starts[at]);
    let n = 0;
    let run = 0;
    board.flip(me === 1);
    /** Оценка за ученика: мат — ±10000. */
    const mine = (a: { lines: { cp: number; mate: number | null }[] }) => (a.lines[0] ? score(a.lines[0]) * (me === 0 ? 1 : -1) : 0);
    const status = (extra = '') => say(`${esc(st.text)}<br><small>${goal} против движка · твоих ходов: <b>${n}</b></small>${extra}`);
    const end = (ok: boolean, why: string) => {
      board.input(null);
      if (ok) {
        Sound.win();
        if (!solved) addStars(5, 'доиграл против движка');
        solved = true;
        say(`<b>Получилось!</b> ${why}${f.say ? ' ' + esc(f.say) : ''}`, 'ok');
        buttons([{ text: '↻ Ещё раз', on: start }]);
      } else {
        Sound.nomove();
        missed = true;
        say(`${why} Попробуй сначала.${f.hint ? ' ' + esc(f.hint) : ''}`, 'bad');
        buttons([{ text: '↻ Сначала', primary: true, on: start }]);
      }
      nav();
    };
    /** Конец по правилам: мат, пат, голые короли. null — играем дальше. */
    const over = (x: State): 'mate' | 'draw' | null => (legalMoves(x).length ? (insufficient(x.board) ? 'draw' : null) : inCheck(x) ? 'mate' : 'draw');
    const turn = () =>
      board.input(me, async (m) => {
        const id = run;
        if (!alive || at !== step) return;
        n++;
        s = play(s, m);
        board.set(s, { from: m.from, to: m.to });
        board.draw();
        m.captured ? Sound.capture() : Sound.place();
        board.input(null);
        const o = over(s);
        if (o === 'mate') return end(true, 'Мат!');
        if (o === 'draw') return f.goal === 'draw' ? end(true, 'Ничья — ты устоял.') : end(false, 'Ничья — а была победа.');
        status('<br>Движок думает…');
        let a;
        try {
          a = await stockfish.analyse(toFen(s), { depth: 16, ms: 1500 });
        } catch {
          return id === run && alive && at === step ? status('<br>Движок не запустился — проверь связь и нажми «Сначала».') : undefined;
        }
        if (id !== run || !alive || at !== step) return;
        const v = mine(a);
        if (f.goal === 'queen' && m.promo) return v >= 400 ? end(true, 'Пешка стала ферзём, и удержать его соперник не может.') : end(false, 'Ферзь появился, да сразу пропадает.');
        if (f.goal !== 'draw' && v < 150) return end(false, 'Этим ходом выигрыш упущен — теперь движок спасается.');
        if (f.goal === 'draw' && v < -400) return end(false, 'Позиция уже проиграна.');
        if (f.goal === 'draw' && n >= need) return end(true, `Продержался ${need} ходов — позиция ничейная.`);
        const r = a.best ? fromUci(s, a.best) : null;
        if (!r) return end(f.goal === 'draw', 'Движку нечем ходить.');
        await sleep(300);
        if (id !== run || !alive || at !== step) return;
        s = play(s, r);
        board.set(s, { from: r.from, to: r.to });
        r.captured ? Sound.capture() : Sound.place();
        const o2 = over(s);
        if (o2 === 'mate') return end(false, 'Мат тебе.');
        if (o2 === 'draw') return f.goal === 'draw' ? end(true, 'Ничья — ты устоял.') : end(false, 'Ничья — а была победа.');
        status();
        turn();
      });
    const start = () => {
      if (!alive || at !== step) return;
      run++;
      s = position(starts[step]);
      n = 0;
      board.set(s);
      board.draw(arrowsOf(st.arrows), marksOf(st.marks));
      status();
      buttons([{ text: '↻ Сначала', on: start }, ...(f.hint ? [{ text: '💡 Подсказка', on: () => status(`<br>${esc(f.hint!)}`) }] : [])]);
      turn();
    };
    start();
  };

  /** Ход не из списка: может, он не хуже задуманного — спросим движок (сравним с ходом урока). */
  const other = async (s: State, m: Move) => {
    const st = l!.steps[at];
    const step = at;
    const ru = ruSan(s, m);
    board.input(null);
    say(`${esc(st.text)}<br><b>${esc(ru)}</b>… проверяю.`);
    let fine = false;
    try {
      const want = fromUci(s, st.try!.good[0])!;
      const [a, b] = [await stockfish.analyse(toFen(play(s, m)), { depth: 12, ms: 1500 }), await stockfish.analyse(toFen(play(s, want)), { depth: 12, ms: 1500 })];
      // оценки за белых: для чёрных — наоборот
      const sign = s.turn === 0 ? 1 : -1;
      const mine = a.lines[0] ? score(a.lines[0]) * sign : -Infinity;
      const best = b.lines[0] ? score(b.lines[0]) * sign : Infinity;
      fine = mine >= best - 50 || (best > 400 && mine >= best * 0.75);
    } catch {
      /* без движка — как раньше: «не то» */
    }
    if (!alive || at !== step) return;
    if (fine) {
      void answered(s, st.try!.good[0], false, `<b>Тоже верно!</b> Ход ${esc(ru)} не хуже. А в уроке разберём другой — `);
      return;
    }
    Sound.nomove();
    missed = true;
    board.set(s);
    board.draw(arrowsOf(st.arrows), [...marksOf(st.marks), { sq: m.to, kind: 'bad' }]);
    say(`${esc(st.text)}<br><b>${esc(ru)} — не то.</b> ${st.try!.hint ? esc(st.try!.hint) : 'Подумай ещё.'}`, 'bad');
    board.input(s.turn, (x) => (st.try!.good.includes(toUci(x)) ? void answered(s, toUci(x), true) : void other(s, x)));
  };

  const answered = async (s: State, u: string, mine: boolean, lead?: string) => {
    const st = l!.steps[at];
    const step = at;
    board.input(null);
    const m = fromUci(s, u)!;
    const after = play(s, m);
    board.set(after, { from: m.from, to: m.to });
    board.draw([{ from: m.from, to: m.to, kind: 'good' }]);
    m.captured ? Sound.capture() : Sound.place();
    if (mine) Sound.win();
    if ((mine || lead) && !missed) addStars(2, 'верный ход с первой попытки');
    say(`${lead ? `${lead}<b>${esc(ruSan(s, m))}</b>. ` : mine ? '<b>Верно!</b> ' : `Вот как: <b>${esc(ruSan(s, m))}</b>. `}${st.try!.say ? esc(st.try!.say) : ''}`, mine || lead ? 'ok' : 'info');
    buttons([]);
    solved = true;
    nav();
    if (st.try!.reply) await animate(after, [st.try!.reply], step);
  };

  const summary = () => {
    markDone(l!.id);
    completeNode(`l:${l!.id}`, 10, 'урок пройден');
    board.input(null);
    board.draw();
    say(`<b>Запомни.</b> ${esc(l!.summary.replace(/^Запомни[:.!]?\s*/i, ''))}`, 'ok');
    // слова урока из словаря кружка — коротко, под «Запомни»
    const id = l!.id;
    void import('./terms.json').then((m) => {
      const ts = (m.default as { term: string; text: string; lesson?: string }[]).filter((t) => t.lesson === id);
      if (!ts.length || !alive || at < l!.steps.length || l!.id !== id) return;
      q('.kz-ls-text').insertAdjacentHTML(
        'beforeend',
        `<details class="kz-ls-terms"><summary>Слова урока: ${ts.map((t) => esc(t.term)).join(', ')}</summary>${ts.map((t) => `<p><b>${esc(t.term)}</b> — ${esc(t.text)}</p>`).join('')}</details>`,
      );
    });
    const next = all.find((x) => x.n === l!.n + 1);
    const d = l!.drill;
    buttons(
      path
        ? [...(path.next ? [{ text: `▶ ${esc(path.next.label)}`, primary: true, on: path.next.on }] : []), { text: `← ${esc(path.backLabel)}`, on: back }]
        : [
            ...(d ? [{ text: '🧩 Закрепить задачами', primary: true, on: () => practice(d) }] : []),
            ...(next ? [{ text: `Следующий урок: ${esc(next.title)} →`, primary: !d, on: () => open(next, all) }] : []),
            { text: 'К оглавлению', on: back },
          ],
    );
    nav();
  };

  const practice = (d: NonNullable<Lesson['drill']>) => {
    host.hidden = true;
    el.hidden = true;
    board.input(null);
    const title = d.themes.map((t) => THEMES.find((x) => x.id === t)?.name ?? t).join(', ');
    drill = mountTrainer(stage, panel, {
      drill: { ...d, title },
      back: { label: `К уроку «${l!.title}»`, on: () => show() },
      goal: { count: DRILL_COUNT, onDone: () => completeNode(`d:${l!.id}`, 5, 'закрепление пройдено') },
    });
  };

  const step = (d: -1 | 1) => {
    if (!l || drill) return;
    const n = l.steps.length;
    if (d < 0 ? at <= 0 : at >= n || (!!(l.steps[at]?.try || l.steps[at]?.stars || l.steps[at]?.fight) && !solved)) return;
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
      stockfish.stop();
      document.removeEventListener('keydown', keys);
      drill?.destroy();
      mh.destroy();
      board.destroy();
      host.remove();
      el.remove();
    },
  };
}
