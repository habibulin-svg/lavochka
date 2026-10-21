/* Шахматный кружок — энциклопедия: дебюты (справочник Lichess, 3865 линий, названия по-русски) с поиском по названию,
 * коду ЭКО и ходам, дерево «семейство → варианты»; словарь терминов (kruzhok/terms.json) с иллюстрациями на доске.
 * Выбранный дебют показывается на доске ход за ходом, оттуда — в разбор с движком. */
import { Sound } from '../../core/audio';
import { esc, h } from '../../core/util';
import { Board } from '../chess/board';
import { play, sq } from '../chess/engine';
import { fromUci, lineRu, position, START_FEN } from '../chess/notation';
import { mountAnalysis } from './analysis';
import { loadOpenings, type Opening } from './data';
import { familyPath, leaveSub, setPath, slug, termsPath } from './pages';

export interface Term {
  term: string;
  aka?: string[];
  text: string;
  lesson?: string;
  fen?: string;
  marks?: string[];
}

/** Для поиска: строчные, ё → е, без кавычек и тире. */
export const norm = (t: string) => t.toLowerCase().replace(/ё/g, 'е').replace(/[«»"'—–-]/g, ' ').replace(/\s+/g, ' ').trim();
/** Ходы для поиска: «1. e4 c5 2. Кf3» → «e4 c5 кf3». */
const movesKey = (t: string) => norm(t).replace(/\d+\.(\.\.)?/g, ' ').replace(/[+#x:]/g, '').replace(/\s+/g, ' ').trim();
const family = (o: Opening) => o.ru.split(', ')[0];

/** Дебюты по запросу: код ЭКО («B90»), часть названия (по-русски или по-английски) или начало ходов. */
export function searchOpenings(all: (Opening & { line: string })[], query: string, max = 60): (Opening & { line: string })[] {
  const q = norm(query);
  if (!q) return [];
  if (/^[a-e]\d{0,2}$/.test(q)) return all.filter((o) => o.eco.toLowerCase().startsWith(q)).slice(0, max);
  const mk = movesKey(query);
  const words = q.split(' ');
  const hits = all.filter((o) => {
    const name = norm(o.ru + ' ' + o.name);
    return words.every((w) => name.includes(w)) || (mk.length >= 2 && movesKey(o.line).startsWith(mk));
  });
  // сначала короткие (главные) линии
  return hits.sort((a, b) => a.uci.length - b.uci.length).slice(0, max);
}

/** start — «terminy» или «debyuty/<семейство>» (открыли адресом). */
export function mountEncyclopedia(stage: HTMLElement, panel: HTMLElement, start?: string) {
  const host = h('<div class="kz-host"></div>');
  stage.appendChild(host);
  const board = new Board(host);
  let alive = true;
  let tab: 'op' | 'terms' = 'op';
  let all: (Opening & { line: string })[] = [];
  let terms: Term[] = [];
  let sub: { destroy(): void } | null = null;
  let timer = 0;

  const el = h(`<div class="kz-an kz-en">
    <div class="kz-en-tabs"><button class="btn small on" data-tab="op">Дебюты</button><button class="btn small" data-tab="terms">Термины</button></div>
    <input class="recs-input kz-en-q" placeholder="Название, код ЭКО или ходы: «сицилианская», «B90», «e4 c5 Кf3»" spellcheck="false">
    <div class="kz-msg kz-en-card" hidden></div>
    <div class="kz-btns"></div>
    <div class="kz-en-list"><small class="hint">Открываю справочник…</small></div>
    <small class="hint kz-credit">Дебюты — справочник Lichess chess-openings (CC0), названия — по-русски.</small>
  </div>`);
  panel.appendChild(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const input = q<HTMLInputElement>('.kz-en-q');
  const list = q('.kz-en-list');
  const card = q('.kz-en-card');

  const buttons = (b: { text: string; primary?: boolean; on: () => void }[]) => {
    const box = q('.kz-btns');
    box.innerHTML = '';
    for (const x of b) {
      const btn = h<HTMLButtonElement>(`<button class="btn${x.primary ? ' primary' : ''}">${x.text}</button>`);
      btn.onclick = () => (Sound.ui(), x.on());
      box.appendChild(btn);
    }
  };

  /** Показать дебют: доска ходит по линии, карточка — название и ходы. */
  const showOpening = async (o: Opening & { line: string }) => {
    card.hidden = false;
    card.innerHTML = `<b>${esc(o.ru)}</b><br><small>${esc(o.eco)} · ${esc(o.name)}</small><br>${esc(o.line)}`;
    buttons([
      { text: '↻ Показать ходы', on: () => void showOpening(o) },
      { text: '🔍 Разобрать с движком', primary: true, on: () => analyse(o) },
    ]);
    let s = position();
    board.set(s);
    board.draw();
    for (const u of o.uci) {
      await new Promise((r) => setTimeout(r, 380));
      if (!alive || card.dataset.id !== o.eco + o.name) return;
      const m = fromUci(s, u);
      if (!m) break;
      s = play(s, m);
      board.set(s, { from: m.from, to: m.to });
      m.captured ? Sound.capture() : Sound.place();
    }
  };
  const openOpening = (o: Opening & { line: string }) => {
    card.dataset.id = o.eco + o.name;
    void showOpening(o);
  };

  const analyse = (o: Opening) => {
    host.hidden = true;
    el.hidden = true;
    sub = mountAnalysis(stage, panel, {
      fen: START_FEN,
      moves: o.uci,
      back: {
        label: 'В энциклопедию',
        on: () => {
          sub?.destroy();
          sub = null;
          host.hidden = false;
          el.hidden = false;
        },
      },
    });
  };

  const opRow = (o: Opening & { line: string }) => `<button class="kz-en-row" data-i="${all.indexOf(o)}"><b>${esc(o.ru)}</b><small>${esc(o.eco)} · ${esc(o.line)}</small></button>`;

  /** Без запроса — семейства (сколько линий у каждого), по клику — варианты семейства. */
  const families = () => {
    if (tab === 'op') leaveSub('enciklopediya');
    const by = new Map<string, (Opening & { line: string })[]>();
    for (const o of all) {
      const f = family(o);
      if (!by.has(f)) by.set(f, []);
      by.get(f)!.push(o);
    }
    const rows = [...by.entries()].sort((a, b) => b[1].length - a[1].length);
    list.innerHTML = `<small class="hint">${all.length} линий в ${rows.length} семействах. Выберите семейство или ищите выше.</small>` +
      rows.map(([f, os]) => `<button class="kz-en-row" data-f="${esc(f)}"><b>${esc(f)}</b><small>${os[0].eco} · ${os.length} линий</small></button>`).join('');
    list.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) => (b.onclick = () => (Sound.ui(), variants(b.dataset.f!, by.get(b.dataset.f!)!))));
  };
  const variants = (f: string, os: (Opening & { line: string })[]) => {
    setPath(familyPath(f));
    const sorted = [...os].sort((a, b) => a.uci.length - b.uci.length || a.ru.localeCompare(b.ru, 'ru'));
    list.innerHTML = `<button class="btn small kz-en-up">← Все семейства</button><h4>${esc(f)}</h4>` + sorted.map(opRow).join('');
    q<HTMLButtonElement>('.kz-en-up').onclick = () => (Sound.ui(), families());
    bindRows();
    openOpening(sorted[0]);
  };
  const bindRows = () => list.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((b) => (b.onclick = () => (Sound.ui(), openOpening(all[+b.dataset.i!]))));

  const renderOp = () => {
    const query = input.value.trim();
    if (!query) return families();
    const hits = searchOpenings(all, query);
    list.innerHTML = hits.length ? hits.map(opRow).join('') : '<small class="hint">Ничего не нашлось. Попробуйте часть названия («ферзевый гамбит»), код («D35») или ходы («d4 d5 c4»).</small>';
    bindRows();
  };

  // ---- термины
  const showTerm = (t: Term) => {
    card.hidden = false;
    card.dataset.id = '';
    card.innerHTML = `<b>${esc(t.term)}</b>${t.aka?.length ? ` <small>(${esc(t.aka.join(', '))})</small>` : ''}<br>${esc(t.text)}`;
    buttons([]);
    if (t.fen) {
      try {
        board.set(position(t.fen));
        board.draw([], (t.marks ?? []).map((m) => ({ sq: sq(m), kind: 'hint' as const })));
      } catch {
        board.set(position());
        board.draw();
      }
    } else {
      board.set(position());
      board.draw();
    }
  };
  const renderTerms = () => {
    const query = norm(input.value);
    const hits = query ? terms.filter((t) => norm([t.term, ...(t.aka ?? []), t.text].join(' ')).includes(query)) : terms;
    list.innerHTML = hits.length
      ? hits.map((t) => `<button class="kz-en-row" data-t="${terms.indexOf(t)}"><b>${esc(t.term)}</b><small>${esc(t.text.split(/(?<=[.!?])\s/)[0])}</small></button>`).join('')
      : '<small class="hint">Такого термина нет.</small>';
    list.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) => (b.onclick = () => (Sound.ui(), showTerm(terms[+b.dataset.t!]))));
  };

  const render = () => (tab === 'op' ? renderOp() : renderTerms());
  input.oninput = () => {
    clearTimeout(timer);
    timer = window.setTimeout(render, 150);
  };
  el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(
    (b) =>
      (b.onclick = () => {
        Sound.ui();
        tab = b.dataset.tab as 'op' | 'terms';
        if (tab === 'terms') setPath(termsPath());
        else leaveSub('enciklopediya');
        el.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
        input.value = '';
        input.placeholder = tab === 'op' ? 'Название, код ЭКО или ходы: «сицилианская», «B90», «e4 c5 Кf3»' : 'Найти термин: «вилка», «пат», «оппозиция»';
        card.hidden = true;
        buttons([]);
        board.set(position());
        board.draw();
        render();
      }),
  );

  board.set(position());
  void Promise.all([loadOpenings(), import('./terms.json').then((m) => m.default as Term[]).catch(() => [] as Term[])])
    .then(([ops, ts]) => {
      if (!alive) return;
      all = ops.map((o) => ({ ...o, line: lineRu(START_FEN, o.uci) }));
      terms = [...ts].sort((a, b) => a.term.localeCompare(b.term, 'ru'));
      if (start === 'terminy') return (el.querySelector('[data-tab=terms]') as HTMLButtonElement).click();
      render();
      const fam = start?.startsWith('debyuty/') ? start.slice(8) : null;
      if (fam) {
        const os = all.filter((o) => slug(family(o)) === fam);
        if (os.length) variants(family(os[0]), os);
      }
    })
    .catch(() => (list.innerHTML = '<p class="kz-err">Не удалось открыть справочник. Проверьте связь и откройте раздел ещё раз.</p>'));

  return {
    destroy() {
      alive = false;
      clearTimeout(timer);
      sub?.destroy();
      board.destroy();
      host.remove();
      el.remove();
    },
  };
}
