/* Шахматный кружок — этюды: классические композиции (Рети, Сааведра, Троицкий…). Ученик ведёт сторону, чей ход,
 * соперник отвечает защитой из авторского решения. Свой ход, который тоже держит результат, движок признаёт, но
 * просит найти авторский путь; ход, упускающий результат, — показывает опровержение и даёт вернуть. Решённый этюд
 * можно доиграть против движка. Отметки — в журнале (kruzhok.etudes: 1 — сам, 0 — с подсказкой). */
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { esc, h, sleep } from '../../core/util';
import { Board } from '../chess/board';
import { play, type Move, type State } from '../chess/engine';
import { fromUci, lineRu, position, ruSan, toFen, toUci } from '../chess/notation';
import { levelOf, mountMihalych } from '../chess/mihalych';
import { score, stockfish } from '../chess/stockfish';
import { loadEtudes, type Etude } from './data';
import { loadProgress } from './progress';
import { etudePath, leaveSub, setPath } from './pages';
import { addStars } from './path';
import { touch } from './cloud';
import { runFight } from './fight';

const KEY = 'kruzhok.etudes';
export const loadSolvedEtudes = () => store.get<Record<string, 0 | 1>>(KEY, {});
export const resetEtudes = () => (store.set(KEY, {}), touch());
const markSolved = (id: string, clean: boolean) => {
  const a = loadSolvedEtudes();
  if (a[id] === 1) return false;
  const first = !(id in a);
  a[id] = clean ? 1 : 0;
  store.set(KEY, a);
  touch();
  return first || clean;
};

const LEVEL = ['', 'Для начала', 'Посложнее', 'Для сильных'];
/** Звёзды за этюд, решённый без подсказки: по трудности. */
const STARS = [0, 3, 5, 8];
export const goalText = (e: Pick<Etude, 'goal' | 'mateIn' | 'fen'>) => {
  const side = position(e.fen).turn === 0 ? 'Белые' : 'Чёрные';
  return e.goal === 'win' ? `${side} начинают и выигрывают` : e.goal === 'draw' ? `${side} начинают и делают ничью` : `${side} дают мат в ${e.mateIn} ход${e.mateIn === 1 ? '' : e.mateIn! < 5 ? 'а' : 'ов'}`;
};

/** start — id этюда, открытого адресом /shahmatnyj-kruzhok/etyudy/<id>/. */
export function mountEtudes(stage: HTMLElement, panel: HTMLElement, start?: string) {
  let sub: { destroy(): void } | null = null;
  const swap = (next: { destroy(): void }) => {
    sub?.destroy();
    sub = next;
  };
  const one = (id: string) => {
    setPath(etudePath(id));
    swap(mountEtude(stage, panel, id, list, one));
  };
  const list = () => {
    leaveSub('etyudy');
    swap(mountList(stage, panel, one));
  };
  start ? one(start) : list();
  return {
    destroy() {
      sub?.destroy();
    },
  };
}

function mountList(stage: HTMLElement, panel: HTMLElement, open: (id: string) => void) {
  const page = h(`<div class="kz-journal sheet kz-gl"><h2>Этюды</h2><small class="hint">Загружаю…</small></div>`);
  stage.appendChild(page);
  const side = h(`<div class="kz-tr">
    <p><b>Этюд</b> — позиция, придуманная мастером: на вид простая или безнадёжная, а внутри — единственный красивый путь к победе или к ничьей.</p>
    <p><small>Ходи за сторону, чей ход, — соперник защищается, как задумал автор. Нашёл другой путь, который тоже ведёт к цели, — движок скажет, но попросит найти авторский.</small></p>
    <small class="hint kz-credit">Классические этюды; каждое решение проверено Stockfish.</small>
  </div>`);
  panel.appendChild(side);
  void loadEtudes()
    .then((all) => {
      const done = loadSolvedEtudes();
      const row = (e: Etude) => `<button class="kz-gi" data-id="${esc(e.id)}">
          <b>${esc(e.title)}</b>
          <span>${esc(e.author)}, ${e.year}</span>
          <small>${esc(goalText(e))}</small>
          <i>${done[e.id] === 1 ? '✔ решён' : done[e.id] === 0 ? '✔ с подсказкой' : '★'.repeat(e.level)}</i>
        </button>`;
      const n = Object.keys(done).filter((id) => all.some((e) => e.id === id)).length;
      page.innerHTML = `<h2>Этюды</h2><p class="hint">Решено ${n} из ${all.length}</p>${[1, 2, 3]
        .map((lv) => {
          const part = all.filter((e) => e.level === lv);
          return part.length ? `<h3>${LEVEL[lv]}</h3><div class="kz-gl-list">${part.map(row).join('')}</div>` : '';
        })
        .join('')}`;
      page.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) => (b.onclick = () => (Sound.ui(), open(b.dataset.id!))));
    })
    .catch(() => (page.innerHTML = '<h2>Этюды</h2><p class="kz-err">Не удалось загрузить этюды. Проверьте связь и откройте раздел ещё раз.</p>'));
  return {
    destroy() {
      page.remove();
      side.remove();
    },
  };
}

export function mountEtude(stage: HTMLElement, panel: HTMLElement, id: string, back: () => void, open: (id: string) => void, backLabel = 'Все этюды') {
  const host = h('<div class="kz-host"></div>');
  stage.appendChild(host);
  const board = new Board(host);
  let alive = true;
  let e: Etude | null = null;
  let all: Etude[] = [];
  let s: State = position();
  /** Сколько полуходов главного варианта уже на доске. */
  let ply = 0;
  /** Брал подсказку или показ хода — этюд решён не сам. */
  let helped = false;
  let run = 0;
  let stopFight: (() => void) | null = null;

  const el = h(`<div class="kz-an kz-pg">
    <button class="btn kz-back">← ${esc(backLabel)}</button>
    <div class="kz-rank kz-pg-head"><small class="hint">Загружаю этюд…</small></div>
    <div class="kz-msg kz-note" aria-live="polite"></div>
    <div class="kz-btns"></div>
    <div class="kz-moves"></div>
  </div>`);
  panel.appendChild(el);
  const q = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T;
  q<HTMLButtonElement>('.kz-back').onclick = () => (Sound.ui(), back());

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

  const mh = mountMihalych(el, () => ({
    where: 'puzzle',
    level: levelOf(loadProgress().rating.r),
    fen: toFen(s),
    side: s.turn === 0 ? 'белые' : 'чёрные',
    theme: e ? `этюд: ${goalText(e).toLowerCase()} (${e.author}, ${e.year})` : undefined,
  }));
  /** Решение с текущего места — для Михалыча. */
  const rest = () => {
    const m = e && ply < e.line.length ? fromUci(s, e.line[ply]) : null;
    return { best: m ? ruSan(s, m) : undefined, solution: e ? lineRu(toFen(s), e.line.slice(ply)) : undefined, line: e ? lineRu(toFen(s), e.line.slice(ply)) : undefined };
  };
  const solving = () => {
    const hint = { kind: 'hint' as const, before: () => (helped = true), engine: rest };
    mh.actions([{ label: 'Куда смотреть?', say: 'Михалыч, куда тут смотреть?', ...hint }]);
    mh.typed({ ...hint, hint: 'Спросить (этюд не в зачёт)' });
  };

  const renderMoves = () => {
    if (!e) return;
    const start = position(e.fen);
    let x = start;
    let html = '';
    for (let i = 0; i < ply; i++) {
      const m = fromUci(x, e.line[i])!;
      if (x.turn === 0) html += `<span class="n">${x.full}.</span>`;
      else if (i === 0) html += `<span class="n">${x.full}…</span>`;
      html += `<span class="kz-mv">${esc(ruSan(x, m))}</span>`;
      x = play(x, m);
    }
    q('.kz-moves').innerHTML = html;
  };

  const head = () => {
    if (!e) return;
    const mark = loadSolvedEtudes()[e.id];
    q('.kz-pg-head').innerHTML = `<b>${esc(e.title)}</b><br><span>${esc(e.author)}, ${e.year}</span><br><small>${esc(goalText(e))} · ${'★'.repeat(e.level)}${mark === 1 ? ' · ✔ решён' : mark === 0 ? ' · ✔ с подсказкой' : ''}</small>`;
  };

  const nextOne = () => {
    if (!e) return null;
    const done = loadSolvedEtudes();
    const i = all.findIndex((x) => x.id === e!.id);
    return [...all.slice(i + 1), ...all.slice(0, i)].find((x) => !(x.id in done)) ?? null;
  };

  const solveButtons = () =>
    buttons([
      { text: '💡 Подсказка', on: () => ((helped = true), say(`${esc(e!.hint)}<br><small>Этюд засчитается «с подсказкой».</small>`)) },
      {
        text: 'Показать ход',
        on: () => {
          helped = true;
          const m = fromUci(s, e!.line[ply]);
          if (m) board.draw([{ from: m.from, to: m.to, kind: 'hint' }]);
          say(`Ход автора — <b>${esc(ruSan(s, m!))}</b>. Сделай его на доске.`);
        },
      },
      { text: '↻ Сначала', on: begin },
    ]);

  const finished = () => {
    board.input(null);
    const clean = !helped;
    const fresh = markSolved(e!.id, clean);
    if (fresh && clean) addStars(STARS[e!.level], 'этюд');
    Sound.win();
    head();
    say(`<b>Этюд решён${clean ? '!' : ' — с подсказкой.'}</b> ${esc(e!.idea)}`, 'ok');
    const nx = nextOne();
    const fightGoal = e!.goal === 'draw' ? { goal: 'draw' as const, moves: 10 } : { goal: 'mate' as const };
    const endFen = toFen(s);
    // доиграть имеет смысл, если в конце варианта ещё не мат и ход за решающей стороной
    const canFight = s.turn === position(e!.fen).turn && !/#/.test(rest().solution ?? '');
    buttons([
      ...(nx ? [{ text: `Следующий: ${esc(nx.title)}`, primary: true, on: () => open(nx.id) }] : []),
      ...(canFight
        ? [
            {
              text: e!.goal === 'draw' ? 'Удержи ничью против движка' : 'Доиграй против движка',
              on: () => {
                stopFight?.();
                stopFight = runFight({
                  ...fightGoal,
                  board,
                  fen: endFen,
                  text: e!.goal === 'draw' ? 'Позиция ничейная — удержи её.' : 'Выигрыш есть — доведи до мата.',
                  live: () => alive,
                  tell: say,
                  buttons,
                  extra: [{ text: '↻ Этюд сначала', on: begin }],
                });
              },
            },
          ]
        : []),
      { text: '↻ Ещё раз', on: begin },
    ]);
    mh.actions([{ label: 'В чём идея?', say: 'Михалыч, в чём красота этого этюда?', kind: 'explain', engine: () => ({ solution: lineRu(e!.fen, e!.line) }) }]);
  };

  /** Ход ученика. */
  const onMove = async (m: Move) => {
    const id = run;
    if (!e || !alive) return;
    const want = e.line[ply];
    const before = s;
    if (toUci(m) === want) {
      s = play(s, m);
      ply++;
      board.set(s, { from: m.from, to: m.to });
      board.draw();
      m.captured ? Sound.capture() : Sound.place();
      renderMoves();
      if (ply >= e.line.length) return finished();
      board.input(null);
      say('Верно! Соперник отвечает…', 'ok');
      await sleep(600);
      if (id !== run || !alive) return;
      const r = fromUci(s, e.line[ply])!;
      s = play(s, r);
      ply++;
      board.set(s, { from: r.from, to: r.to });
      r.captured ? Sound.capture() : Sound.place();
      renderMoves();
      if (ply >= e.line.length) return finished();
      say('Верно! Соперник ответил — твой ход.', 'ok');
      turn();
      return;
    }
    // не авторский ход: держит ли он результат?
    s = play(before, m);
    board.set(s, { from: m.from, to: m.to });
    board.draw();
    board.input(null);
    say('Проверяю ход движком…');
    let a;
    try {
      a = await stockfish.analyse(toFen(s), { depth: 18, ms: 2000 });
    } catch {
      if (id !== run || !alive) return;
      s = before;
      board.set(s);
      say('Это не авторский ход, а движок не запустился, чтобы его проверить. Попробуй ещё раз.', 'bad');
      return turn();
    }
    if (id !== run || !alive) return;
    const v = a.lines[0] ? -score(a.lines[0]) : 0; // за ученика
    const keeps = e.goal === 'win' ? v >= 300 : e.goal === 'draw' ? v >= -80 : v >= 9000;
    const ru = ruSan(before, m);
    const reply = a.best ? fromUci(s, a.best) : null;
    if (keeps) {
      Sound.nomove();
      say(`<b>${esc(ru)}</b> — тоже не проигрывает цель, движок согласен. Но автор задумал другой путь — точнее и красивее. Найди его!`, 'info');
    } else {
      Sound.nomove();
      if (reply) board.draw([{ from: reply.from, to: reply.to, kind: 'bad' }]);
      say(
        `<b>${esc(ru)}</b> — не то: ${e.goal === 'draw' ? 'после этого позиция проигрывается' : 'после этого выигрыша уже нет'}${reply ? `, соперник ответит <b>${esc(ruSan(s, reply))}</b>` : ''}.`,
        'bad',
      );
    }
    buttons([
      {
        text: '↶ Вернуть ход',
        primary: true,
        on: () => {
          s = before;
          board.set(s);
          board.draw();
          say(`${esc(goalText(e!))}. Твой ход.`);
          solveButtons();
          turn();
        },
      },
      { text: '↻ Сначала', on: begin },
    ]);
  };

  const turn = () => board.input(position(e!.fen).turn, (m) => void onMove(m));

  function begin() {
    if (!e || !alive) return;
    run++;
    stopFight?.();
    stopFight = null;
    s = position(e.fen);
    ply = 0;
    helped = false;
    board.flip(s.turn === 1);
    board.set(s);
    board.draw();
    renderMoves();
    say(`${esc(goalText(e))}. Найди путь, который задумал автор.`);
    solveButtons();
    solving();
    turn();
  }

  void loadEtudes()
    .then((list) => {
      if (!alive) return;
      all = list;
      e = list.find((x) => x.id === id) ?? null;
      if (!e) return say('Такого этюда нет. Вернитесь к списку.', 'bad');
      head();
      begin();
    })
    .catch(() => alive && say('Не удалось загрузить этюд. Проверьте связь и откройте ещё раз.', 'bad'));

  return {
    destroy() {
      alive = false;
      run++;
      stopFight?.();
      board.input(null);
      stockfish.stop();
      mh.destroy();
      board.destroy();
      host.remove();
      el.remove();
    },
  };
}
