/* Стол гадания: выбрать расклад → «Тасовать» → колода веером, человек сам тянет карты по одной (каждая ложится на своё
 * место и открывается) → значения под рукой, итог, толкование Светки. Карты не раскладываются сами (решение пользователя:
 * игры не играют сами в себя), но и без возни: одно нажатие — одна карта на следующее место. */
import { CardStage, fan, type StageItem } from '../../cards/stage';
import { Sound } from '../../core/audio';
import { SeededRng } from '../../core/rng';
import { store } from '../../core/settings';
import { esc, h } from '../../core/util';
import { stageOpts, toStage } from './faces';
import { cardTitle, openMeaning } from './meaning';
import { combosOf, drawnName, KARTY36, kartaMeaning, majorCount, nearOf, shuffleDeck, slotsOf, TARO, verdictOf, type Drawn } from './reading';
import { spreadById, spreadsOf, spreadSize, type DeckKind, type Spread } from './spreads';
import { mountSvetka } from './svetka';

const LAND = { W: 1000, H: 720 };
const PORT = { W: 600, H: 1000 };

type Phase = 'ready' | 'person' | 'draw' | 'done';

export interface ReadingState {
  deck: DeckKind;
  spread: Spread;
  question: string;
  cards: Drawn[];
  person: number | null;
}

export function mountTable(root: HTMLElement, panel: HTMLElement, deck: DeckKind) {
  const spreads = spreadsOf(deck);
  let spread = spreadById(store.get<string>(`gadanie.${deck}.spread`, '')) ?? spreads[0];
  let straight = store.get<boolean>('gadanie.straight', false);
  let majors = store.get<boolean>('gadanie.majors', false);
  let phase: Phase = 'ready';
  let pack: Drawn[] = [];
  let drawn: Drawn[] = [];
  let person: number | null = null;
  let question = '';
  /** Какие вытянутые карты уже открылись (только что вытянутая лежит рубашкой, пока не долетит). */
  const opened = new Set<number>();
  let alive = true;
  const timers: number[] = [];
  const later = (f: () => void, ms: number) => timers.push(window.setTimeout(() => alive && f(), ms));

  root.classList.add('gd-root');
  const cs = new CardStage(root, LAND.W, LAND.H, `gd-table gd-${deck}`, '<div class="gd-slots"></div>', {
    ...stageOpts(deck),
    portrait: PORT,
  });
  const slotsEl = cs.stage.querySelector('.gd-slots') as HTMLElement;
  const cw = cs.cw;
  const ch = cs.ch;

  // ---------- раскладка мест на столе
  /** Где лежит место i расклада (центр карты на сцене) и масштаб карт. */
  const geometry = () => {
    const ux = cw * 1.16;
    const uy = ch * 0.86;
    const pts = spread.spots.map((p) => ({ x: p.x * ux, y: p.y * uy, rot: !!p.rot }));
    if (spread.person) pts.push({ x: 0, y: 0, rot: false });
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const bw = Math.max(...xs) - Math.min(...xs) + cw;
    const bh = Math.max(...ys) - Math.min(...ys) + ch;
    // место под расклад: всё, кроме полосы колоды внизу; подписи — под картами
    const top = 24;
    // колоды нет (всё вытянуто) — расклад крупнее, на весь стол
    const bottom = phase === 'done' ? cs.H - 24 : cs.H - (cs.portrait ? 200 : 190);
    const areaW = cs.W - 60;
    const areaH = bottom - top;
    const s = Math.min(1.25, areaW / bw, areaH / bh);
    const cx = cs.W / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * s;
    const cy = top + areaH / 2 - ((Math.max(...ys) + Math.min(...ys)) / 2) * s;
    return { s, at: pts.map((p) => ({ x: cx + p.x * s, y: cy + p.y * s, rot: p.rot })) };
  };
  const deckPt = () => ({ x: cs.W / 2, y: cs.H - (cs.portrait ? 105 : 98) });

  /** Пустые места расклада — пунктирные рамки с номером и подписью внутри (карта ложится сверху; что за место — в списке справа). */
  const drawSlots = () => {
    const g = geometry();
    const order = slotsOf(spread);
    slotsEl.innerHTML = spread.spots
      .map((p, i) => {
        const a = g.at[i];
        const first = order.indexOf(i) + 1;
        const w = cw * g.s;
        const hh = ch * g.s;
        // поперечная карта: рамка повёрнута, подпись — в верхней половине, чтобы не слиться с подписью нижней карты
        const style = `left:${a.x - w / 2}px;top:${a.y - hh / 2}px;width:${w}px;height:${hh}px;${a.rot ? 'transform:rotate(90deg)' : ''}`;
        return `<div class="gd-slot${a.rot ? ' gd-slot-rot' : ''}" style="${style}"><b>${first}</b><span>${esc(p.label)}</span></div>`;
      })
      .join('');
  };

  // ---------- карты на сцене
  const key = (c: number) => 'g:' + c;
  const render = (enter: { x: number; y: number } | null = null) => {
    const g = geometry();
    const items: StageItem[] = [];
    const order = slotsOf(spread);
    // сколько карт уже на месте — вторая карта места «на сердце» ложится со сдвигом
    const seen = new Map<number, number>();
    drawn.forEach((d, k) => {
      const spot = order[k];
      const nth = seen.get(spot) ?? 0;
      seen.set(spot, nth + 1);
      const a = g.at[spot];
      const shift = (spread.spots[spot].n ?? 1) > 1 ? (nth - 0.5) * cw * g.s * 0.42 : 0;
      const open = phase !== 'draw' || k < drawn.length - 1 || opened.has(k);
      items.push({
        key: key(d.card),
        card: open ? toStage(deck, d.card) : null,
        x: a.x + shift,
        y: a.y + (shift ? nth * 6 : 0),
        r: (a.rot ? 90 : 0) + (d.rev ? 180 : 0),
        s: g.s,
        z: 100 + k + (a.rot ? 50 : 0),
        cls: open ? 'cs-can gd-open' : '',
        data: { k: String(k) },
      });
    });
    if (person != null && spread.person) {
      const a = g.at[spread.spots.length];
      items.push({ key: key(person), card: toStage(deck, person), x: a.x, y: a.y, r: 0, s: g.s, z: 90, cls: 'gd-person', data: { p: '1' } });
    }
    // колода: до тасовки — стопкой, при вытягивании — веером
    const d = deckPt();
    if (phase === 'draw') {
      const n = pack.length;
      const width = cs.W - (cs.portrait ? 70 : 140);
      pack.forEach((x, i) => {
        const f = fan(n, i, d.x, d.y, width, cs.portrait ? 20 : 26, 26, 14);
        items.push({ key: key(x.card), card: null, x: f.x, y: f.y, r: f.r, s: 0.92, z: i, cls: 'cs-can gd-pick', data: { i: String(i) } });
      });
    } else if (phase !== 'done') {
      pack.forEach((x, i) => {
        if (i < pack.length - 12) return;
        items.push({ key: key(x.card), card: null, x: d.x - i * 0.25, y: d.y - i * 0.35, r: 0, s: 0.92, z: i });
      });
    }
    cs.render(items, 1, enter, null, { pair: false });
  };

  // ---------- панель
  const side = h(`<div class="gd-side">
    <label class="gd-field"><span>Расклад</span><select class="gd-spread"></select></label>
    <div class="gd-about"></div>
    <label class="gd-field"><span>О чём гадаем <small>(по желанию)</small></span><textarea class="gd-q" rows="2" maxlength="300" placeholder="Например: стоит ли менять работу?"></textarea></label>
    <div class="gd-opts"></div>
    <div class="gd-act"></div>
    <div class="gd-result"></div>
    <div class="gd-svetka"></div>
  </div>`);
  panel.appendChild(side);
  const q = <T extends HTMLElement>(s: string) => side.querySelector(s) as T;
  const sel = q<HTMLSelectElement>('.gd-spread');
  const groups = [...new Set(spreads.map((s) => s.group))];
  sel.innerHTML = groups
    .map((g) => `<optgroup label="${esc(g)}">${spreads.filter((s) => s.group === g).map((s) => `<option value="${s.id}">${esc(s.title)} — ${spreadSize(s)} ${plural(spreadSize(s))}</option>`).join('')}</optgroup>`)
    .join('');
  sel.value = spread.id;
  sel.onchange = () => {
    spread = spreadById(sel.value)!;
    store.set(`gadanie.${deck}.spread`, spread.id);
    reset();
  };
  const qa = q<HTMLTextAreaElement>('.gd-q');
  qa.oninput = () => (question = qa.value.trim());

  const opts = q('.gd-opts');
  if (deck === 'taro') {
    opts.innerHTML = `<label class="check"><input type="checkbox" data-o="straight"> Все карты прямо <small>(без перевёрнутых)</small></label>
      <label class="check"><input type="checkbox" data-o="majors"> Только старшие арканы</label>`;
    const a = opts.querySelector('[data-o=straight]') as HTMLInputElement;
    const b = opts.querySelector('[data-o=majors]') as HTMLInputElement;
    a.checked = straight;
    b.checked = majors;
    a.onchange = () => {
      straight = a.checked;
      store.set('gadanie.straight', straight);
      if (phase !== 'draw') reset();
    };
    b.onchange = () => {
      majors = b.checked;
      store.set('gadanie.majors', majors);
      if (phase !== 'draw') reset();
    };
  }
  const act = q('.gd-act');
  const result = q('.gd-result');
  const svetka = mountSvetka(q('.gd-svetka'), () => ({ deck, spread, question, cards: drawn.slice(), person }));

  const drawPanel = () => {
    q('.gd-about').innerHTML = spread.about + (spread.source ? `<p class="gd-src">Расклад: ${esc(spread.source)}.</p>` : '');
    const left = spreadSize(spread) - drawn.length;
    if (phase === 'ready') {
      act.innerHTML = `<button class="btn primary big" data-a="shuffle" data-tap>🃏 Перетасовать колоду</button>
        <p class="hint">Задумайте вопрос, перетасуйте — и тяните карты сами.</p>`;
    } else if (phase === 'person') {
      act.innerHTML = `<p class="hint"><b>На кого гадаем?</b> Выберите карту человека: король — на мужчину, дама — на женщину. Масть — по традиции: черви и бубны — светлые, трефы — тёмные, пики — постарше.</p>
        <div class="gd-persons">${KARTY36.map((c, i) => ({ c, i }))
          .filter(({ c }) => c.r === 12 || c.r === 13)
          .map(({ i }) => `<button class="btn" data-person="${i}">${esc(cardTitle('karty', i))}</button>`)
          .join('')}</div>`;
    } else if (phase === 'draw') {
      // последняя карта ещё летит на место — следующего места нет
      const next = spread.spots[slotsOf(spread)[drawn.length]];
      act.innerHTML = next
        ? `<p class="gd-left">Тяните карту из колоды: осталось <b>${left}</b></p>
        <p class="hint">Следующее место: <b>${esc(next.label)}</b>.</p>
        <button class="btn" data-a="reset">Начать заново</button>`
        : `<p class="gd-left">Все карты легли — открываем…</p>`;
    } else {
      act.innerHTML = `<button class="btn primary" data-a="again">🔄 Разложить заново</button>`;
    }
    drawResult();
  };

  const drawResult = () => {
    if (!drawn.length) {
      result.innerHTML = '';
      return;
    }
    const order = slotsOf(spread);
    const rows = drawn
      .map((d, k) => {
        const spot = spread.spots[order[k]];
        const short = deck === 'taro' ? (d.rev ? TARO[d.card].down : TARO[d.card].up).slice(0, 3).join(', ') : kartaMeaning(d.card).short;
        return `<li><button class="gd-row" data-k="${k}"><span class="gd-row-spot">${esc(spot.label)}</span>
          <b>${esc(drawnName(deck, d.card, true))}${d.rev ? ' <small>(перевёрнута)</small>' : ''}</b><span class="gd-row-short">${esc(short)}</span></button></li>`;
      })
      .join('');
    let extra = '';
    if (phase === 'done') {
      const v = verdictOf(spread, drawn);
      if (v) extra += `<p class="gd-verdict"><b>${esc(v.word[0].toUpperCase() + v.word.slice(1))}.</b> ${esc(v.text)}</p>`;
      if (deck === 'karty') for (const t of [...combosOf(drawn), ...nearOf(drawn)]) extra += `<p class="gd-combo">${esc(t)}</p>`;
      if (deck === 'taro' && drawn.length >= 5) {
        const m = majorCount(drawn);
        if (m * 2 > drawn.length) extra += `<p class="gd-combo">Старших арканов больше половины: дело важное, многое в нём от вас не зависит.</p>`;
      }
    }
    result.innerHTML = `<h3>Карты</h3><ol class="gd-rows">${rows}</ol>${extra}<p class="hint">Нажмите на карту — её значение целиком.</p>`;
  };

  // ---------- ход гадания
  const reset = () => {
    phase = 'ready';
    drawn = [];
    person = null;
    opened.clear();
    pack = shuffleDeck(deck, { reversed: !straight, majors }, new SeededRng(Date.now() ^ (Math.random() * 1e9)));
    svetka.clear();
    drawSlots();
    render();
    drawPanel();
  };

  const shuffleAnim = () => {
    Sound.shuffle();
    const d = deckPt();
    // три «встряски»: колода разваливается на две стопки и снова собирается
    const shake = (k: number) => {
      const items: StageItem[] = pack.slice(-14).map((x, i) => ({
        key: key(x.card),
        card: null,
        x: d.x + (i % 2 ? 1 : -1) * (k % 2 ? 0 : cw * 0.6) + (Math.random() - 0.5) * 6,
        y: d.y - i * 0.4,
        r: (Math.random() - 0.5) * 8,
        s: 0.92,
        z: i,
      }));
      cs.render(items, 1.6, null, null, { pair: false });
    };
    [0, 1, 2, 3].forEach((k) => later(() => shake(k), k * 230));
    later(() => {
      pack = shuffleDeck(deck, { reversed: !straight, majors, person: person ?? undefined }, new SeededRng(Date.now() ^ (Math.random() * 1e9)));
      phase = 'draw';
      render();
      drawPanel();
    }, 4 * 230 + 60);
  };

  const pick = (i: number) => {
    if (phase !== 'draw' || i < 0 || i >= pack.length) return;
    Sound.card();
    const [d] = pack.splice(i, 1);
    drawn.push(d);
    render();
    const k = drawn.length - 1;
    // легла рубашкой — через миг открывается
    later(() => {
      opened.add(k);
      render();
      if (drawn.length >= spreadSize(spread)) finish();
    }, 420);
    drawPanel();
  };

  const finish = () => {
    phase = 'done';
    drawSlots();
    render();
    drawPanel();
    const v = verdictOf(spread, drawn);
    if (v) banner(v.word);
    svetka.ready();
  };

  const banner = (word: string) => {
    const b = h(`<div class="cs-banner gd-banner">${esc(word[0].toUpperCase() + word.slice(1))}</div>`);
    cs.over.appendChild(b);
    later(() => b.remove(), 2600);
  };

  // ---------- нажатия
  act.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('button');
    if (!t) return;
    Sound.ui();
    const a = t.dataset.a;
    if (t.dataset.person) {
      person = Number(t.dataset.person);
      phase = 'ready';
      render();
      shuffleAnim();
      return;
    }
    if (a === 'shuffle') {
      if (spread.person && person == null) {
        phase = 'person';
        drawPanel();
        return;
      }
      shuffleAnim();
    } else if (a === 'reset' || a === 'again') reset();
  });
  result.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-k]');
    if (t) showDrawn(Number(t.dataset.k));
  });
  cs.stage.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.cs-card');
    if (!el) {
      // свободное место стола — та же главная кнопка (как у бросков кубика)
      if (phase === 'ready') (act.querySelector('[data-a=shuffle]') as HTMLButtonElement | null)?.click();
      return;
    }
    if (el.dataset.i != null) pick(Number(el.dataset.i));
    else if (el.dataset.k != null && el.classList.contains('gd-open')) showDrawn(Number(el.dataset.k));
    else if (el.dataset.p && person != null) openMeaning(deck, person, null);
  });
  const showDrawn = (k: number) => {
    const d = drawn[k];
    if (!d) return;
    openMeaning(deck, d.card, deck === 'taro' ? d.rev : null, spread.spots[slotsOf(spread)[k]]);
  };

  cs.onMode = () => {
    drawSlots();
    render();
  };
  reset();
  // колода подгружается заранее, чтобы карты не открывались пустыми
  preload(deck);

  return {
    destroy() {
      alive = false;
      timers.forEach(clearTimeout);
      svetka.destroy();
      cs.destroy();
      root.classList.remove('gd-root');
    },
  };
}

function plural(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'карта';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'карты';
  return 'карт';
}

const preloaded = new Set<DeckKind>();
function preload(deck: DeckKind) {
  if (preloaded.has(deck)) return;
  preloaded.add(deck);
  void import('./faces').then(({ smallUrl, backUrl }) => {
    const n = deck === 'taro' ? 78 : 36;
    const urls = [backUrl(deck), ...Array.from({ length: n }, (_, i) => smallUrl(deck, i))];
    for (const u of urls) {
      const im = new Image();
      im.src = u;
    }
  });
}

