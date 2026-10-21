/* Шахматный кружок — решалка задач: задача по рейтингу ученика (или по теме), первый ход делает соперник,
 * дальше ученик сам. Неверный ход остаётся на доске со стрелкой опровержения от Stockfish — «вот почему нет»;
 * его можно вернуть и искать дальше. Рейтинг меняется только за первую попытку; подсказка — задача не в зачёт. */
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { esc, h, sleep } from '../../core/util';
import { Board } from '../chess/board';
import { play, type Move, type State } from '../chess/engine';
import { checkMark, fromUci, lineRu, position, ruSan, toFen, toUci } from '../chess/notation';
import { levelOf, mountMihalych } from '../chess/mihalych';
import { evalText, stockfish } from '../chess/stockfish';
import { mountAnalysis } from './analysis';
import { loadLessonIndex, loadPuzzles, THEME_LESSON, THEMES, themeName, type Puzzle } from './data';
import { lessonPath } from './pages';
import { addStars } from './path';
import { loadProgress, recordPuzzle, type Progress } from './progress';
import { rankOf } from './rating';

/** Открытая задача (id и рейтинг), пока её не решили и не провалили. */
const OPEN = 'kruzhok.open';

export interface TrainerOpts {
  /** Закрепление урока: только эти темы (любая из них), не выше этого рейтинга, выбор темы скрыт. */
  drill?: { themes: string[]; max?: number; title: string };
  back?: { label: string; on: () => void };
  /** Занятие пути: решить count задач — тогда onDone (узел пройден, «Дальше по пути»). */
  goal?: { count: number; onDone: () => void; next?: { label: string; on: () => void } };
}

export function mountTrainer(stage: HTMLElement, panel: HTMLElement, o: TrainerOpts = {}) {
  const host = h('<div class="kz-host"></div>');
  stage.appendChild(host);
  const board = new Board(host);
  let all: Puzzle[] = [];
  let prog: Progress = loadProgress();
  let theme = store.get<string>('kruzhok.theme', '');
  let pz: Puzzle | null = null;
  /** Сколько ходов из pz.moves уже сыграно. */
  let ply = 0;
  let pos: State = position();
  let failed = false;
  let done = false;
  let busy = false;
  /** Поколение задачи: после ожидания (ход соперника, показ решения) — проверить, что задача та же (сменили тему — нет). */
  let gen = 0;
  /** Сколько задач решено в этом занятии (цель пути). */
  let solvedHere = 0;
  const goalText = () => {
    const g = el.querySelector('.kz-goal');
    if (g && o.goal) g.textContent = solvedHere >= o.goal.count ? 'занятие пройдено ✓' : `решено ${solvedHere} из ${o.goal.count}`;
  };
  let alive = true;
  let sub: { destroy(): void } | null = null;

  const el = h(`<div class="kz-tr">
    ${o.back ? `<button class="btn kz-back">← ${esc(o.back.label)}</button>` : ''}
    ${o.drill ? `<div class="kz-drill">Закрепляем: <b>${esc(o.drill.title)}</b>${o.goal ? ` · <span class="kz-goal"></span>` : ''}</div>` : ''}
    <div class="kz-rank"></div>
    <div class="kz-task"></div>
    <div class="kz-msg"></div>
    <div class="kz-btns"></div>
    <label class="kz-theme">Тема <select><option value="">Любая — по моему рейтингу</option>${['Мат', 'Тактика', 'Эндшпиль', 'Стадия']
      .map((g) => `<optgroup label="${g}">${THEMES.filter((t) => t.group === g).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</optgroup>`)
      .join('')}</select></label>
    <small class="hint kz-about"></small>
  </div>`);
  panel.appendChild(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  /** Позиция до неверного хода, пока он стоит на доске: о ней и спрашиваем Михалыча. */
  let beforeWrong: State | null = null;
  const mh = mountMihalych(el, () => ({
    where: 'puzzle',
    level: levelOf(prog.rating.r),
    fen: toFen(beforeWrong ?? pos),
    side: (beforeWrong ?? pos).turn === 0 ? 'белые' : 'чёрные',
    theme: pz ? pz.themes.map(themeName).filter(Boolean).join(', ') : undefined,
  }));
  /** Решение с текущего места: правильный ход и вся линия (русской записью). */
  const rest = () => {
    const m = pz && ply < pz.moves.length ? fromUci(pos, pz.moves[ply]) : null;
    return { best: m ? ruSan(pos, m) : undefined, solution: pz ? lineRu(toFen(pos), pz.moves.slice(ply)) : undefined };
  };
  /** Пока задача не решена, вопрос Михалычу — подсказка намёком (и задача не в зачёт). */
  const solving = () => {
    const where = { kind: 'hint' as const, before: () => fail(), engine: () => ({ ...rest(), line: rest().solution }) };
    mh.actions([{ label: 'Куда смотреть?', say: 'Михалыч, куда тут смотреть?', ...where }]);
    mh.typed({ ...where, hint: 'Спросить (задача не в зачёт)' });
  };
  const sel = q<HTMLSelectElement>('select');
  if (o.drill) q('.kz-theme').hidden = true;
  if (o.back) q<HTMLButtonElement>('.kz-back').onclick = () => (Sound.ui(), o.back!.on());
  sel.value = theme;
  sel.onchange = () => {
    theme = sel.value;
    store.set('kruzhok.theme', theme);
    next();
  };

  const say = (html: string, kind: 'ok' | 'bad' | 'info' = 'info') => {
    const m = q('.kz-msg');
    m.className = `kz-msg kz-${kind}`;
    m.innerHTML = html;
  };

  const buttons = (list: { text: string; primary?: boolean; on: () => void }[]) => {
    const box = q('.kz-btns');
    box.innerHTML = '';
    for (const b of list) {
      const x = h<HTMLButtonElement>(`<button class="btn${b.primary ? ' primary' : ''}">${b.text}</button>`);
      x.onclick = () => {
        Sound.ui();
        b.on();
      };
      box.appendChild(x);
    }
  };

  const renderRank = () => {
    const n = Object.keys(prog.solved).length;
    const r = rankOf(prog.rating, n);
    q('.kz-rank').innerHTML = `<b>${esc(r.name)}</b>${r.provisional ? ' <small>(пока предварительно)</small>' : ''}<br>
      <span>Рейтинг в задачах: <b>${prog.rating.r}</b>${r.toFirst ? ` · разряд — после ещё ${r.toFirst} задач` : r.next ? ` · до «${esc(r.next.short)}» — ${r.next.from - prog.rating.r}` : ''}</span><br>
      <small>Решено задач: ${n} · серия без ошибок: ${prog.streak} (лучшая ${prog.best})</small>`;
  };

  /** Следующая задача: по теме или рядом с рейтингом, ещё не решённая. */
  const pick = (): Puzzle | null => {
    const d = o.drill;
    const pool = d
      ? all.filter((p) => !(p.id in prog.solved) && p.themes.some((t) => d.themes.includes(t)) && p.rating <= (d.max ?? 3000))
      : all.filter((p) => !(p.id in prog.solved) && (!theme || p.themes.includes(theme)));
    if (!pool.length) return null;
    const r = prog.rating.r;
    for (const w of [100, 200, 350, 600, 3000]) {
      const near = pool.filter((p) => Math.abs(p.rating - r) <= w);
      if (near.length >= 3 || w === 3000) return near[Math.floor(Math.random() * near.length)] ?? pool[0];
    }
    return pool[0];
  };

  const playerSide = () => (position(pz!.fen).turn === 0 ? 1 : 0) as 0 | 1;

  const taskText = () => {
    const side = playerSide() === 0 ? 'белых' : 'чёрных';
    const mate = pz!.themes.find((t) => /^mateIn\d$/.test(t));
    if (mate) return `Ход ${side}. <b>${themeName(mate)}</b>.`;
    if (pz!.themes.includes('equality')) return `Ход ${side}. Спасите партию — найдите путь к равенству.`;
    if (pz!.themes.includes('defensiveMove')) return `Ход ${side}. Найдите лучшую защиту.`;
    return `Ход ${side}. Найдите сильнейшее продолжение.`;
  };

  const next = async () => {
    if (!alive) return;
    // ушёл с открытой задачи, не решив, — она не в зачёт (иначе можно пропускать трудные без потери рейтинга)
    if (pz && !done && ply > 0) fail();
    const my = ++gen;
    busy = false;
    stockfish.stop();
    sub?.destroy();
    sub = null;
    host.hidden = false;
    el.hidden = false;
    pz = pick();
    if (!pz) {
      say(theme || o.drill ? 'По этой теме вы решили всё, что было. Выберите другую тему!' : 'Вы решили все задачи кружка. Михалыч снимает кепку!', 'ok');
      buttons([]);
      return;
    }
    ply = 0;
    failed = false;
    done = false;
    beforeWrong = null;
    mh.reset();
    pos = position(pz.fen);
    board.flip(playerSide() === 1);
    board.set(pos);
    board.draw();
    board.input(null);
    q('.kz-task').innerHTML = taskText();
    q('.kz-about').textContent = '';
    say('Соперник делает ход…');
    buttons([]);
    renderRank();
    await sleep(700);
    if (!alive || my !== gen) return;
    opponent();
  };

  /** Ход соперника по записи задачи. */
  const opponent = () => {
    const m = fromUci(pos, pz!.moves[ply]);
    if (!m) return next();
    move(m);
    ply++;
    waitPlayer();
  };

  const move = (m: Move) => {
    m.captured ? Sound.capture() : Sound.place();
    pos = play(pos, m);
    board.set(pos, { from: m.from, to: m.to });
  };

  const waitPlayer = () => {
    // задача открыта: уйдёт перезагрузкой, не решив, — при следующем входе она не в зачёт
    if (!failed && !(pz!.id in prog.solved)) store.set(OPEN, { id: pz!.id, rating: pz!.rating });
    say(failed ? 'Ищите дальше — задача уже не в зачёт, но решить её стоит.' : 'Ваш ход.');
    buttons([
      { text: '💡 Подсказка', on: hint },
      { text: 'Показать решение', on: solution },
    ]);
    board.input(pos.turn, onPlayer);
    solving();
  };

  const onPlayer = async (m: Move) => {
    if (busy) return;
    const want = pz!.moves[ply];
    const mate = checkMark(pos, m) === '#';
    if (toUci(m) !== want && !mate) return wrong(m);
    board.draw();
    move(m);
    ply++;
    if (mate || ply >= pz!.moves.length) return solved();
    busy = true;
    const my = gen;
    say('Верно! Соперник отвечает…', 'ok');
    await sleep(600);
    if (!alive || my !== gen) return;
    busy = false;
    opponent();
  };

  /** Неверный ход: показать, чем он плох, и дать вернуть. */
  const wrong = async (m: Move) => {
    const before = pos;
    const my = gen;
    beforeWrong = before;
    const ru = ruSan(before, m);
    fail();
    move(m);
    Sound.nomove();
    board.draw([], [{ sq: m.to, kind: 'bad' }]);
    say(`<b>${esc(ru)}?</b> Не то. Смотрим, что на это есть у соперника…`, 'bad');
    buttons([{ text: '↶ Вернуть ход', primary: true, on: () => takeBack(before) }]);
    const right = (() => {
      const c = fromUci(before, pz!.moves[ply]);
      return { best: c ? ruSan(before, c) : undefined, solution: lineRu(toFen(before), pz!.moves.slice(ply)) };
    })();
    const why: { after?: string; reply?: string } = {};
    const mistake = { kind: 'mistake' as const, engine: () => ({ played: ru, ...why, best: right.best, line: right.solution }) };
    mh.actions([{ label: 'Почему это ошибка?', say: `Михалыч, почему ${ru} — ошибка?`, ...mistake }]);
    mh.typed(mistake);
    busy = true;
    try {
      const a = await stockfish.analyse(toFen(pos), { depth: 14, ms: 2500, cancel: true });
      if (!alive || pos === before || my !== gen) return;
      const top = a.lines[0];
      const reply = a.best ? fromUci(pos, a.best) : null;
      if (top) {
        why.after = evalText(top) + ' (за белых)';
        why.reply = lineRu(toFen(pos), top.pv, 4);
      }
      if (reply && top) {
        board.draw([{ from: reply.from, to: reply.to, kind: 'bad' }], [{ sq: m.to, kind: 'bad' }]);
        const sign = playerSide() === 0 ? 1 : -1;
        const v = top.mate != null ? 0 : top.cp * sign;
        const mateTask = pz!.themes.some((t) => t.startsWith('mate'));
        const verdict =
          top.mate != null
            ? Math.sign(top.mate) === -sign
              ? `и соперник ставит мат в ${Math.abs(top.mate)}`
              : 'мат ещё есть, но не так быстро'
            : (mateTask ? 'и мата уже нет: ' : '') +
              (v > 150 ? `перевес у вас остаётся (${evalText(top)}), но задача требует большего` : v < -150 ? `и перевес уже у соперника (${evalText(top)})` : `и на доске примерно поровну (${evalText(top)})`);
        say(`<b>${esc(ru)}?</b> Не то: на это есть <b>${esc(lineRu(toFen(pos), top.pv, 3))}</b>${verdict ? ` — ${esc(verdict)}` : ''}. Верните ход и ищите дальше.`, 'bad');
      } else if (top?.mate === 0 || !reply) {
        say(`<b>${esc(ru)}</b> — хороший ход, но в задаче задумано другое. Верните ход и поищите ещё.`, 'info');
      }
    } catch {
      /* прервали — ученик уже вернул ход */
    } finally {
      busy = false;
    }
  };

  const takeBack = (s: State) => {
    stockfish.stop();
    beforeWrong = null;
    pos = s;
    board.set(pos, s.last);
    board.draw();
    waitPlayer();
  };

  const fail = () => {
    if (failed) return;
    failed = true;
    store.set(OPEN, null);
    const r = recordPuzzle(prog, pz!.id, pz!.rating, false);
    prog = r.progress;
    renderRank();
    if (r.first && r.delta) flash(r.delta);
  };

  const hint = () => {
    const m = fromUci(pos, pz!.moves[ply]);
    if (!m) return;
    fail();
    board.draw([], [{ sq: m.from, kind: 'hint' }]);
    say('Подсказка: ходит фигура на подсвеченном поле.', 'info');
  };

  const solution = async () => {
    fail();
    board.input(null);
    buttons([]);
    const my = gen;
    while (alive && my === gen && ply < pz!.moves.length) {
      const m = fromUci(pos, pz!.moves[ply]);
      if (!m) break;
      board.draw([{ from: m.from, to: m.to, kind: 'hint' }]);
      say(`Решение: ${esc(lineRu(pz!.fen, pz!.moves.slice(0, ply + 1)))}`, 'info');
      await sleep(900);
      if (!alive || my !== gen) return;
      board.draw();
      move(m);
      ply++;
      await sleep(500);
    }
    if (alive && my === gen) finish();
  };

  const solved = () => {
    board.input(null);
    board.draw();
    store.set(OPEN, null);
    if (!failed) {
      const r = recordPuzzle(prog, pz!.id, pz!.rating, true);
      prog = r.progress;
      if (r.first && r.delta) flash(r.delta);
      Sound.win();
      addStars(3, 'задача решена');
      say(`Решено! ${prog.streak > 2 ? `Серия — ${prog.streak} подряд.` : ''}`, 'ok');
    } else {
      addStars(1, 'задача решена со второй попытки');
      say('Решено — со второй попытки тоже счёт.', 'ok');
    }
    solvedHere++;
    goalText();
    if (o.goal && solvedHere === o.goal.count) o.goal.onDone();
    finish();
  };

  const finish = () => {
    done = true;
    renderRank();
    const names = pz!.themes.map(themeName).filter(Boolean);
    q('.kz-about').innerHTML = `Задача <a href="https://lichess.org/training/${esc(pz!.id)}" target="_blank" rel="noopener">${esc(pz!.id)}</a> · рейтинг ${pz!.rating}${names.length ? ` · ${esc(names.join(', '))}` : ''}`;
    // урок по теме задачи — чтобы разобраться, а не только решать
    const lid = pz!.themes.map((t) => THEME_LESSON[t]).find(Boolean);
    const shown = pz;
    if (lid && !o.drill)
      void loadLessonIndex().then((all) => {
        const l = all.find((x) => x.id === lid);
        if (l && alive && pz === shown) q('.kz-about').insertAdjacentHTML('beforeend', `<br>📖 Урок по теме: <a href="${lessonPath(l.id)}">${l.n}. ${esc(l.title)}</a>`);
      });
    const sol = lineRu(pz!.fen, pz!.moves);
    const explain = { kind: 'explain' as const, engine: () => ({ solution: sol }) };
    mh.actions([{ label: 'В чём идея?', say: 'Михалыч, в чём тут идея?', ...explain }]);
    mh.typed(explain);
    const reached = !!o.goal && solvedHere >= o.goal.count;
    buttons([
      ...(reached && o.goal?.next ? [{ text: `▶ ${esc(o.goal.next.label)}`, primary: true, on: o.goal.next.on }] : []),
      { text: 'Следующая задача →', primary: !reached || !o.goal?.next, on: next },
      { text: '🔍 Разобрать с движком', on: analyse },
    ]);
  };

  const analyse = () => {
    const fen = pz!.fen;
    const moves = pz!.moves.slice(0, ply);
    host.hidden = true;
    el.hidden = true;
    board.input(null);
    sub = mountAnalysis(stage, panel, {
      fen,
      moves,
      flipped: board.flipped,
      back: {
        label: 'К задачам',
        on: () => {
          sub?.destroy();
          sub = null;
          host.hidden = false;
          el.hidden = false;
          if (done) finish();
        },
      },
    });
  };

  const flash = (d: number) => {
    const f = h(`<div class="kz-flash ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${Math.abs(d)}</div>`);
    q('.kz-rank').appendChild(f);
    setTimeout(() => f.remove(), 1800);
  };

  // прошлый раз ушли с открытой задачи — она не в зачёт
  const left = store.get<{ id: string; rating: number } | null>(OPEN, null);
  if (left && !(left.id in prog.solved)) prog = recordPuzzle(prog, left.id, left.rating, false).progress;
  store.set(OPEN, null);
  renderRank();
  goalText();
  say('Раскладываю задачи…');
  loadPuzzles()
    .then((p) => {
      all = p;
      void next();
    })
    .catch(() => say('Не удалось загрузить задачи. Проверьте связь и откройте раздел ещё раз.', 'bad'));

  return {
    destroy() {
      alive = false;
      stockfish.stop();
      sub?.destroy();
      mh.destroy();
      board.destroy();
      host.remove();
      el.remove();
    },
  };
}
