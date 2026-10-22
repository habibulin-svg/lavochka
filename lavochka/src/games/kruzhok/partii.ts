/* Шахматный кружок — классические партии с остановками «А как сходил бы ты?»: партию листают ход за ходом,
 * в ключевых местах (ход, который сильнее всех остальных, — по разметке Stockfish) доска ждёт ход ученика.
 * Нашёл сыгранный ход или равный ему — засчитано; нет — движок покажет, чем свой ход хуже. Комментарии к ходам
 * и вступление — из данных партии (tools/kruzhok/games.ts). Счёт найденного — в журнале на этом устройстве. */
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { esc, h } from '../../core/util';
import { Board } from '../chess/board';
import { play, type Move } from '../chess/engine';
import { fromUci, position, ruSan, toFen, toUci } from '../chess/notation';
import { levelOf, mountMihalych, type MihalychEngine } from '../chess/mihalych';
import { evalText, stockfish } from '../chess/stockfish';
import { loadClassic, loadClassics, type ClassicGame, type ClassicInfo } from './data';
import { loadProgress } from './progress';
import { classicPath, familyPath, leaveSub, setPath } from './pages';
import { addStars, completeNode } from './path';
import { touch } from './cloud';

/** Записать часть журнала кружка (и отметить для копии в базе). */
const putJournal = (key: string, v: unknown) => {
  store.set(key, v);
  touch();
};

/** Ответы на остановки: id партии → номер полухода → 1 нашёл, 0 нет. */
type Answers = Record<string, Record<string, 0 | 1>>;
const KEY = 'kruzhok.classics';
export const loadAnswers = () => store.get<Answers>(KEY, {});
export const resetAnswers = () => putJournal(KEY, {});
const saveAnswer = (id: string, ply: number, ok: 0 | 1) => {
  const a = loadAnswers();
  (a[id] ??= {})[ply] = ok;
  putJournal(KEY, a);
};

/** Оценка из разметки (за белых, мат — ±10000) — в виде строки движка. */
const evalOf = (v: number) => evalText(Math.abs(v) >= 9000 ? { cp: v, mate: Math.sign(v) * (10000 - Math.abs(v)) } : { cp: v, mate: null });
const RESULT: Record<string, string> = { '1-0': 'Победа белых', '0-1': 'Победа чёрных', '1/2-1/2': 'Ничья' };

/** start — id партии, открытой адресом /shahmatnyj-kruzhok/partii/<id>/. */
export function mountClassics(stage: HTMLElement, panel: HTMLElement, start?: string) {
  let sub: { destroy(): void } | null = null;
  const swap = (next: { destroy(): void }) => {
    sub?.destroy();
    sub = next;
  };
  const game = (id: string) => {
    setPath(classicPath(id));
    swap(mountGame(stage, panel, id, list));
  };
  const list = () => {
    leaveSub('partii');
    swap(mountList(stage, panel, game));
  };
  start ? game(start) : list();
  return {
    destroy() {
      sub?.destroy();
    },
  };
}

function mountList(stage: HTMLElement, panel: HTMLElement, open: (id: string) => void) {
  const page = h(`<div class="kz-journal sheet kz-gl"><h2>Классические партии</h2><small class="hint">Загружаю…</small></div>`);
  stage.appendChild(page);
  const side = h(`<div class="kz-tr">
    <p>Партии великих мастеров прошлого — от Андерсена до Таля. Листайте ход за ходом; в ключевых местах Михалыч остановит доску и спросит: <b>«А как сходил бы ты?»</b></p>
    <p><small>Найдёте ход мастера (или не хуже, по мнению движка) — засчитано. Нет — движок покажет, чем ваш ход слабее.</small></p>
    <small class="hint kz-credit">Записи партий — PGN Mentor, разметка — Stockfish.</small>
  </div>`);
  panel.appendChild(side);
  void loadClassics()
    .then((all) => {
      const ans = loadAnswers();
      const row = (g: ClassicInfo) => {
        const a = ans[g.id] ?? {};
        const seen = Object.keys(a).length;
        const ok = Object.values(a).filter((x) => x === 1).length;
        return `<button class="kz-gi" data-id="${esc(g.id)}">
          <b>${esc(g.title)}</b>
          <span>${esc(g.white)} — ${esc(g.black)}</span>
          <small>${esc(g.place)}, ${g.year} · ${g.result.replace('1/2-1/2', '½–½')} · ${Math.ceil(g.plies / 2)} ход.</small>
          <i>${seen ? `найдено ${ok} из ${g.stops}` : `${g.stops} вопрос${g.stops === 1 ? '' : g.stops < 5 ? 'а' : 'ов'}`}</i>
        </button>`;
      };
      page.innerHTML = `<h2>Классические партии</h2><div class="kz-gl-list">${[...all].sort((x, y) => x.year - y.year).map(row).join('')}</div>`;
      page.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) => (b.onclick = () => (Sound.ui(), open(b.dataset.id!))));
    })
    .catch(() => (page.innerHTML = '<h2>Классические партии</h2><p class="kz-err">Не удалось загрузить партии. Проверьте связь и откройте раздел ещё раз.</p>'));
  return {
    destroy() {
      page.remove();
      side.remove();
    },
  };
}

export function mountGame(stage: HTMLElement, panel: HTMLElement, id: string, back: () => void, backLabel = 'Все партии') {
  const host = h('<div class="kz-host"></div>');
  stage.appendChild(host);
  const board = new Board(host);
  let alive = true;
  let g: ClassicGame | null = null;
  let fens: string[] = [];
  let ru: string[] = [];
  let moves: Move[] = [];
  let at = 0;
  /** До какого хода партия уже открыта: дальше список ходов скрыт, чтобы не подсказывать ответы. */
  let reach = 0;
  /** Остановка, на которой ждём ход ученика (номер полухода), или null. */
  let asking: number | null = null;
  let hinted = false;
  let quiz = store.get('kruzhok.quiz', true);
  let answers: Record<string, 0 | 1> = loadAnswers()[id] ?? {};

  const el = h(`<div class="kz-an kz-pg">
    <button class="btn kz-back">← ${esc(backLabel)}</button>
    <div class="kz-rank kz-pg-head"><small class="hint">Загружаю партию…</small></div>
    <div class="kz-msg kz-note" aria-live="polite"></div>
    <div class="kz-btns"></div>
    <div class="kz-eval"><div class="kz-evalbar"><i></i></div><b class="kz-evalnum"></b></div>
    <div class="kz-nav">
      <button class="btn small" data-a="first" title="В начало">⏮</button>
      <button class="btn small" data-a="prev" title="Ход назад">◀</button>
      <button class="btn small primary" data-a="next" title="Ход вперёд">▶</button>
      <button class="btn small" data-a="last" title="В конец">⏭</button>
      <button class="btn small" data-a="flip" title="Перевернуть доску">⇅</button>
    </div>
    <div class="kz-moves"></div>
    <label class="kz-check"><input type="checkbox" data-a="quiz"${quiz ? ' checked' : ''}> Спрашивать «А как сходил бы ты?»</label>
  </div>`);
  panel.appendChild(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  q<HTMLButtonElement>('.kz-back').onclick = () => (Sound.ui(), back());

  const mh = mountMihalych(el, () => ({
    where: 'classic',
    level: levelOf(loadProgress().rating.r),
    fen: fens[asking ?? at] ?? fens[0],
    side: position(fens[asking ?? at] ?? fens[0]).turn === 0 ? 'белые' : 'чёрные',
    moves: ru.slice(Math.max(0, (asking ?? at) - 10), asking ?? at).join(' '),
    opening: g ? `${g.white} — ${g.black}, ${g.place} ${g.year}${g.title ? ` («${g.title}»)` : ''}` : undefined,
  }));

  const stopAt = (ply: number) => g?.stops.find((s) => s.ply === ply) ?? null;

  const say = (html: string, kind: 'ok' | 'bad' | 'info' = 'info') => {
    const m = q('.kz-note');
    m.className = `kz-msg kz-note kz-${kind}`;
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

  const renderHead = () => {
    if (!g) return;
    const ok = Object.values(answers).filter((x) => x === 1).length;
    q('.kz-pg-head').innerHTML = `<b>${esc(g.title)}</b><br><span>${esc(g.white)} — ${esc(g.black)}</span><br>
      <small>${esc(g.place)}, ${g.year} · ${RESULT[g.result] ?? g.result}${g.stops.length ? ` · найдено ${ok} из ${g.stops.length}` : ''}</small>${
        g.opening ? `<br><small>Дебют: <a href="${familyPath(g.opening.family)}">${esc(g.opening.ru)}</a></small>` : ''
      }`;
  };

  const renderMoves = () => {
    const box = q('.kz-moves');
    let html = '';
    const shown = quiz ? reach : ru.length;
    for (let i = 0; i < shown; i++) {
      if (i % 2 === 0) html += `<span class="n">${i / 2 + 1}.</span>`;
      const mark = g!.marks[i] ?? '';
      const st = stopAt(i);
      const cls = [i + 1 === at ? 'on' : '', st ? 'stop' : '', st && answers[i] === 1 ? 'found' : ''].filter(Boolean).join(' ');
      html += `<button class="kz-mv ${cls}" data-i="${i + 1}">${esc(ru[i])}${mark}</button>`;
    }
    if (shown < ru.length) html += '<span class="n">…</span>';
    box.innerHTML = html;
    box.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((b) => (b.onclick = () => go(+b.dataset.i!)));
    box.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };

  const paintEval = (v: number) => {
    q('.kz-evalnum').textContent = evalOf(v);
    const share = Math.abs(v) >= 9000 ? (v > 0 ? 1 : 0) : 1 / (1 + Math.exp(-v / 250));
    q<HTMLElement>('.kz-evalbar i').style.width = `${Math.round(share * 100)}%`;
  };

  /** Текст под доской для текущего места: вступление, комментарий к ходу, итог. */
  const noteHtml = () => {
    const parts: string[] = [];
    if (at === 0) parts.push(g!.intro ? esc(g!.intro) : 'Партия начинается. Жмите ▶, чтобы листать ходы.');
    else {
      const i = at - 1;
      const n = g!.notes[i];
      if (n) parts.push(esc(n));
      const mark = g!.marks[i];
      if (mark?.includes('?') && g!.best[i]) parts.push(`<small>Движок предлагал: ${esc(g!.best[i])}</small>`);
      if (at === ru.length) parts.push(`<b>${RESULT[g!.result] ?? g!.result}.</b>${g!.outro ? ' ' + esc(g!.outro) : ''}`);
    }
    return parts.join('<br>') || '&nbsp;';
  };

  const explainMove = (): MihalychEngine => {
    const i = at - 1;
    return { at: fens[i], played: ru[i], eval: evalOf(g!.ev[i]) + ' (за белых)', line: g!.best[i] };
  };

  const show = () => {
    if (!g) return;
    const last = at > 0 ? moves[at - 1] : null;
    board.set(position(fens[at]), last ? { from: last.from, to: last.to } : null);
    board.draw();
    board.input(null);
    paintEval(at > 0 ? g.ev[at - 1] : 0);
    say(noteHtml());
    buttons([]);
    renderMoves();
    renderHead();
    q<HTMLButtonElement>('[data-a=next]').disabled = at >= ru.length;
    mh.actions(at > 0 ? [{ label: 'В чём идея хода?', kind: 'explain', say: `Михалыч, в чём идея хода ${ru[at - 1]}?`, engine: explainMove }] : []);
    mh.typed({ kind: 'chat', engine: () => (at > 0 ? explainMove() : {}) });
  };

  const go = (i: number) => {
    asking = null;
    at = Math.max(0, Math.min(ru.length, i));
    reach = Math.max(reach, at);
    show();
  };

  /** Ход вперёд; перед ключевым ходом — вопрос. */
  const next = () => {
    // пока ждём ответ, вперёд не листаем: ответ — ходом на доске или кнопкой «Не знаю»
    if (!g || at >= ru.length || asking !== null) return;
    if (quiz && stopAt(at) && answers[at] === undefined) return ask(at);
    go(at + 1);
    moves[at - 1].captured ? Sound.capture() : Sound.place();
  };

  const ask = (ply: number) => {
    asking = ply;
    hinted = false;
    const s = position(fens[ply]);
    board.set(s, ply > 0 ? { from: moves[ply - 1].from, to: moves[ply - 1].to } : null);
    board.draw();
    const side = s.turn === 0 ? 'белых' : 'чёрных';
    const st = stopAt(ply)!;
    say(`<b>А как сходил бы ты?</b> Ход ${side}${st.gap >= 250 ? ' — здесь есть ход, который сильнее всех остальных' : ''}. Сделайте его на доске.`);
    buttons([{ text: 'Не знаю — покажите ход', on: () => reveal(0, null) }]);
    board.input(s.turn, answer);
    mh.actions([
      {
        label: 'Куда смотреть?',
        kind: 'hint',
        say: 'Михалыч, куда тут смотреть?',
        before: () => (hinted = true),
        engine: () => ({ best: ru[ply], line: g!.best[ply] }),
      },
    ]);
    mh.typed({ kind: 'hint', before: () => (hinted = true), engine: () => ({ best: ru[ply], line: g!.best[ply] }) });
  };

  const answer = async (m: Move) => {
    if (asking === null || !g) return;
    const ply = asking;
    const st = stopAt(ply)!;
    const uci = toUci(m);
    const s = position(fens[ply]);
    board.input(null);
    if (st.good.includes(uci)) {
      Sound.win();
      const same = uci === g.uci[ply];
      reveal(1, same ? `<b>В точку!</b> Как у мастера: в партии так и сыграно — ${esc(ru[ply])}.` : `<b>Сильно!</b> Ваш ${esc(ruSan(s, m))} движок ценит не ниже хода из партии — там сыграли ${esc(ru[ply])}.`);
      return;
    }
    // неверно: показать свой ход и чем он хуже
    const mine = ruSan(s, m);
    const after = play(s, m);
    board.set(after, { from: m.from, to: m.to });
    board.draw([], [{ sq: m.to, kind: 'bad' }]);
    m.captured ? Sound.capture() : Sound.place();
    say(`Ваш ход ${esc(mine)}… Движок считает.`, 'bad');
    buttons([]);
    let verdict = '';
    try {
      const a = await stockfish.analyse(toFen(after), { depth: 14, ms: 2500, cancel: true });
      const top = a.lines[0];
      if (top) verdict = ` Оценка после него — ${esc(evalText(top))}, а после хода из партии — ${esc(evalOf(g.ev[ply]))}.`;
      const reply = a.best ? fromUci(after, a.best) : null;
      if (reply && alive && asking === ply) board.draw([{ from: reply.from, to: reply.to, kind: 'bad' }], [{ sq: m.to, kind: 'bad' }]);
    } catch {
      /* без движка — просто покажем ход партии */
    }
    if (!alive || asking !== ply) return;
    say(`Ваш ход ${esc(mine)} слабее.${verdict} Красная стрелка — сильный ответ соперника.`, 'bad');
    buttons([{ text: 'Показать ход из партии', primary: true, on: () => reveal(0, null) }]);
    mh.actions([{ label: 'Почему мой ход хуже?', kind: 'mistake', say: `Михалыч, а чем плох мой ход ${mine}?`, engine: () => ({ at: fens[ply], played: mine, best: ru[ply], line: g!.best[ply] }) }]);
  };

  /** Показать ход из партии после ответа; ok — засчитан ли ответ. */
  const reveal = (ok: 0 | 1, text: string | null) => {
    if (!g || asking === null) return;
    const ply = asking;
    const res: 0 | 1 = ok && !hinted ? 1 : 0;
    answers = { ...answers, [ply]: res };
    saveAnswer(id, ply, res);
    if (res) addStars(5, 'найден ход мастера');
    // все вопросы партии пройдены — узел пути «партия мастера»
    if (g.stops.every((x) => answers[x.ply] !== undefined)) completeNode(`g:${id}`, 10, 'партия мастера разобрана');
    asking = null;
    at = ply + 1;
    reach = Math.max(reach, at);
    show();
    const m = moves[ply];
    board.draw([{ from: m.from, to: m.to, kind: 'good' }]);
    m.captured ? Sound.capture() : Sound.place();
    const head = text ?? `В партии сыграно <b>${esc(ru[ply])}</b>.`;
    say(`${head}${ok && hinted ? ' <small>(с подсказкой — не в зачёт)</small>' : ''}${g.notes[ply] ? '<br>' + esc(g.notes[ply]) : ''}`, ok ? 'ok' : 'info');
  };

  el.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    switch (a?.dataset.a) {
      case 'first':
        return go(0);
      case 'prev':
        return go(asking ?? at - 1);
      case 'next':
        return next();
      case 'last':
        return go(ru.length);
      case 'flip':
        return board.flip();
    }
  });
  q<HTMLInputElement>('[data-a=quiz]').onchange = (e) => {
    quiz = (e.target as HTMLInputElement).checked;
    store.set('kruzhok.quiz', quiz);
    if (asking === null) renderMoves();
  };
  const keys = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    if (e.key === 'ArrowLeft') go(asking ?? at - 1);
    else if (e.key === 'ArrowRight') next();
  };
  document.addEventListener('keydown', keys);

  void loadClassic(id)
    .then((game) => {
      if (!alive) return;
      g = game;
      let s = position();
      fens = [toFen(s)];
      for (const u of g.uci) {
        const m = fromUci(s, u);
        if (!m) break;
        moves.push(m);
        ru.push(ruSan(s, m));
        s = play(s, m);
        fens.push(toFen(s));
      }
      // доска — со стороны победителя
      board.flip(g.result === '0-1');
      show();
    })
    .catch(() => say('Не удалось загрузить партию.', 'bad'));

  return {
    destroy() {
      alive = false;
      stockfish.stop();
      document.removeEventListener('keydown', keys);
      mh.destroy();
      board.destroy();
      host.remove();
      el.remove();
    },
  };
}
