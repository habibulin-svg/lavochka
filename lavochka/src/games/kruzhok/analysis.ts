/* Шахматный кружок — доска разбора: ходы за обе стороны, назад/вперёд, оценка и лучшие линии Stockfish,
 * стрелка лучшего хода. Открывается из раздела «Разбор» или после задачи с её позицией. */
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { esc, h } from '../../core/util';
import { Board } from '../chess/board';
import { play, type Move } from '../chess/engine';
import { fromUci, lineRu, position, ruSan, START_FEN, toFen } from '../chess/notation';
import { levelOf, mountMihalych } from '../chess/mihalych';
import { evalText, stockfish, type Analysis } from '../chess/stockfish';
import { loadProgress } from './progress';

export interface AnalysisOpts {
  fen?: string;
  /** Ходы, уже сделанные от fen (UCI) — показать с последнего. */
  moves?: string[];
  /** Кнопка «назад» (вернуться к задаче). */
  back?: { label: string; on: () => void };
  flipped?: boolean;
}

interface Ply {
  fen: string;
  ru: string;
  move: Move | null;
}

export function mountAnalysis(stage: HTMLElement, panel: HTMLElement, o: AnalysisOpts = {}) {
  const board = new Board(stage, { flipped: o.flipped });
  let start = o.fen ?? START_FEN;
  let plies: Ply[] = [];
  let at = 0;
  let arrow = store.get('kruzhok.arrow', true);
  let alive = true;

  const el = h(`<div class="kz-an">
    ${o.back ? `<button class="btn kz-back">← ${esc(o.back.label)}</button>` : ''}
    <div class="kz-eval"><div class="kz-evalbar"><i></i></div><b class="kz-evalnum">…</b></div>
    <div class="kz-lines"><small class="hint">Движок думает…</small></div>
    <div class="kz-nav">
      <button class="btn small" data-a="first" title="В начало">⏮</button>
      <button class="btn small" data-a="prev" title="Ход назад">◀</button>
      <button class="btn small" data-a="next" title="Ход вперёд">▶</button>
      <button class="btn small" data-a="last" title="В конец">⏭</button>
      <button class="btn small" data-a="flip" title="Перевернуть доску">⇅</button>
    </div>
    <div class="kz-moves"></div>
    <label class="kz-check"><input type="checkbox" data-a="arrow"${arrow ? ' checked' : ''}> Стрелка лучшего хода</label>
    <details class="kz-fen"><summary>Своя позиция (FEN)</summary>
      <input class="recs-input" spellcheck="false"><div class="kz-fen-btns"><button class="btn small" data-a="setfen">Поставить</button><button class="btn small" data-a="startpos">Начальная</button></div><small class="kz-err"></small>
    </details>
    <small class="hint kz-credit">Движок — <a href="/stockfish/README.txt" target="_blank" rel="noopener">Stockfish</a> (GPLv3), считает прямо в браузере.</small>
  </div>`);
  panel.appendChild(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const fenInput = q<HTMLInputElement>('.kz-fen input');
  let last: Analysis | null = null;
  const mh = mountMihalych(el, () => {
    const s = position(plies[at].fen);
    return {
      where: 'analysis',
      level: levelOf(loadProgress().rating.r),
      fen: plies[at].fen,
      side: s.turn === 0 ? 'белые' : 'чёрные',
      moves: plies.slice(Math.max(1, at - 9), at + 1).map((p) => p.ru).join(' '),
    };
  });
  // вопрос о позиции — с тем, что успел насчитать движок
  const engineNow = () => {
    const fen = plies[at].fen;
    const a = last && last.fen === fen ? last : null;
    const top = a?.lines[0];
    const best = a?.best ? fromUci(position(fen), a.best) : null;
    return {
      eval: top ? evalText(top) + ' (за белых)' : undefined,
      best: best ? ruSan(position(fen), best) : undefined,
      line: top ? lineRu(fen, top.pv, 8) : undefined,
      played: plies[at].ru || undefined,
    };
  };

  const reset = (fen: string, moves: string[] = []) => {
    start = fen;
    let s = position(fen);
    plies = [{ fen, ru: '', move: null }];
    for (const u of moves) {
      const m = fromUci(s, u);
      if (!m) break;
      const ru = ruSan(s, m);
      s = play(s, m);
      plies.push({ fen: toFen(s), ru, move: m });
    }
    at = plies.length - 1;
    show();
  };

  const show = () => {
    const p = plies[at];
    const s = position(p.fen);
    board.set(s, p.move ? { from: p.move.from, to: p.move.to } : null);
    board.draw();
    board.input(s.turn, (m) => {
      const ru = ruSan(s, m);
      const fen = toFen(play(s, m));
      plies = plies.slice(0, at + 1);
      // тот же ход, что дальше по записи, — просто идём вперёд
      plies.push({ fen, ru, move: m });
      at++;
      m.captured ? Sound.capture() : Sound.place();
      show();
    });
    fenInput.value = p.fen;
    renderMoves();
    mh.actions([{ label: 'Что тут происходит?', kind: 'explain', say: 'Михалыч, что тут происходит и какой план?', engine: engineNow }]);
    mh.typed({ kind: 'chat', engine: engineNow });
    void think(p.fen);
  };

  const renderMoves = () => {
    const box = q('.kz-moves');
    const st = position(start);
    let html = '';
    let turn = st.turn;
    let num = st.full;
    for (let i = 1; i < plies.length; i++) {
      if (turn === 0 || i === 1) html += `<span class="n">${num}.${turn === 1 ? '..' : ''}</span>`;
      html += `<button class="kz-mv${i === at ? ' on' : ''}" data-i="${i}">${esc(plies[i].ru)}</button>`;
      if (turn === 1) num++;
      turn = (1 - turn) as 0 | 1;
    }
    box.innerHTML = html || '<small class="hint">Делайте ходы на доске за обе стороны.</small>';
    box.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((b) => (b.onclick = () => go(+b.dataset.i!)));
    box.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };

  const go = (i: number) => {
    at = Math.max(0, Math.min(plies.length - 1, i));
    show();
  };

  const think = async (fen: string) => {
    q('.kz-evalnum').textContent = '…';
    const paint = (a: Analysis) => {
      if (!alive || plies[at].fen !== fen) return;
      last = a;
      const top = a.lines[0];
      if (!top) return;
      q('.kz-evalnum').textContent = evalText(top);
      // полоска: доля белых, по логистической кривой оценки
      const v = top.mate != null ? (top.mate > 0 ? 1 : 0) : 1 / (1 + Math.exp(-top.cp / 250));
      q<HTMLElement>('.kz-evalbar i').style.width = `${Math.round(v * 100)}%`;
      q('.kz-lines').innerHTML = a.lines
        .map((l) => `<div class="kz-line"><b>${esc(evalText(l))}</b> ${esc(lineRu(fen, l.pv, 10))}</div>`)
        .join('') + `<small class="hint">глубина ${top.depth}</small>`;
      const best = a.best ?? top.pv[0];
      const m = best ? fromUci(position(fen), best) : null;
      board.draw(arrow && m ? [{ from: m.from, to: m.to, kind: 'good' }] : []);
    };
    try {
      const a = await stockfish.analyse(fen, { depth: 18, multipv: 3, cancel: true, onInfo: paint });
      paint(a);
    } catch (e) {
      if ((e as Error).message !== 'cancelled' && alive) q('.kz-lines').innerHTML = '<small class="kz-err">Движок не запустился в этом браузере.</small>';
    }
  };

  el.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    switch (a?.dataset.a) {
      case 'first':
        return go(0);
      case 'prev':
        return go(at - 1);
      case 'next':
        return go(at + 1);
      case 'last':
        return go(plies.length - 1);
      case 'flip':
        return board.flip();
      case 'startpos':
        return reset(START_FEN);
      case 'setfen': {
        try {
          const s = position(fenInput.value.trim());
          if (!s.board.includes('K') || !s.board.includes('k')) throw new Error('нет короля');
          q('.kz-err').textContent = '';
          reset(toFen(s));
        } catch {
          q('.kz-err').textContent = 'Не похоже на FEN: пример — «rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1».';
        }
        return;
      }
    }
  });
  q<HTMLInputElement>('[data-a=arrow]').onchange = (e) => {
    arrow = (e.target as HTMLInputElement).checked;
    store.set('kruzhok.arrow', arrow);
    void think(plies[at].fen);
  };
  if (o.back) q<HTMLButtonElement>('.kz-back').onclick = () => o.back!.on();
  const keys = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    if (e.key === 'ArrowLeft') go(at - 1);
    else if (e.key === 'ArrowRight') go(at + 1);
  };
  document.addEventListener('keydown', keys);

  reset(start, o.moves);
  return {
    destroy() {
      alive = false;
      stockfish.stop();
      document.removeEventListener('keydown', keys);
      mh.destroy();
      board.destroy();
      el.remove();
    },
  };
}
