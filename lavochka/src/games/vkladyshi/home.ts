/* «Вкладыши» — блок коллекции на экране игры: копилка, ларёк с жвачками, альбом по сериям, колоды и «Сыграть своей колодой». */
import type { LaunchTable } from '../../core/view';
import type { Options } from '../../core/types';
import { CARDS, COLL_NAME, DECK_SIZE, MAX_COPIES, RARITY_NAME, SETS, card, type Card } from './cards';
import { DUST, GUMS, ODDS, PACK_SIZE, PITY, autoDeck, count, deckSpec, deckValid, dustExtras, load, openGum, save, type Collection } from './collection';
import { sfx } from './sfx';
import { cardHtml, zoom } from './view';
import './vkladyshi.css';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function modal(title: string, body: string, wide = true): HTMLElement {
  const ov = document.createElement('div');
  ov.className = 'vk-modal';
  ov.innerHTML = `<div class="vk-modal-box${wide ? ' wide' : ''}"><header><h2>${title}</h2><button class="btn vk-x" aria-label="Закрыть">✕</button></header><div class="vk-modal-body">${body}</div></div>`;
  ov.querySelector<HTMLButtonElement>('.vk-x')!.onclick = () => ov.remove();
  ov.addEventListener('click', (e) => e.target === ov && ov.remove());
  document.body.appendChild(ov);
  return ov;
}

export function home(box: HTMLElement, launch: (options: Options, table?: LaunchTable) => void) {
  let c = load();
  const draw = () => {
    c = load();
    const d = c.decks[c.active];
    const err = d ? deckValid(c, d.ids) : 'нет колоды';
    const have = Object.keys(c.owned).filter((id) => count(c, id) > 0).length;
    box.innerHTML = `<div class="vk-home">
      <div class="vk-home-top">
        <span class="vk-coins" title="Монеты: за партии с ботами — ${'+'}40 за победу, +10 за поражение">🪙 ${c.coins}</span>
        <span>альбом: ${have} из ${CARDS.length}</span>
        <span>побед: ${c.wins} из ${c.games}</span>
      </div>
      <div class="vk-home-btns">
        <button class="btn" data-a="shop">🍬 Ларёк</button>
        <button class="btn" data-a="album">📒 Альбом</button>
        <button class="btn" data-a="decks">🃏 Колоды</button>
      </div>
      <div class="vk-home-deck">
        <label>Своя колода: <select data-a="pick">${c.decks.map((x, i) => `<option value="${i}"${i === c.active ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <button class="btn primary" data-a="play" ${err ? 'disabled' : ''}>Сыграть своей колодой</button>
        ${err ? `<small class="vk-err">${esc(err)}</small>` : '<small>против бота со случайной стартовой колодой; монеты — в копилку</small>'}
      </div>
    </div>`;
    const q = (a: string) => box.querySelector<HTMLElement>(`[data-a=${a}]`)!;
    q('shop').onclick = () => shop(draw);
    q('album').onclick = () => album();
    q('decks').onclick = () => decks(draw);
    (q('pick') as HTMLSelectElement).onchange = (e) => {
      c.active = +(e.target as HTMLSelectElement).value;
      save(c);
      draw();
    };
    q('play').onclick = () => {
      const d2 = c.decks[c.active];
      if (!d2 || deckValid(c, d2.ids)) return;
      launch({ deck0: deckSpec(d2.ids), deck1: 'rand', hero: 30 }, { count: 2 });
    };
  };
  draw();
}

// ---------------------------------------------------------------- ларёк
function shop(onClose: () => void) {
  const c = load();
  const odds = ODDS.map((p, i) => `${RARITY_NAME[i]} ${p}%`).join(' · ');
  const ov = modal(
    '🍬 Ларёк',
    `<p class="vk-coins-line">В копилке: <b data-coins>🪙 ${c.coins}</b></p>
    <div class="vk-gums">${GUMS.map(
      (g) => `<div class="vk-gum c-${g.coll}">
        <div class="vk-gum-wrap"><b>${esc(g.title)}</b><small>жевательная резинка</small></div>
        <p>${PACK_SIZE} вкладыша · серии: ${g.sets.length}</p>
        <p class="vk-pity" data-pity="${g.id}">редкий — не позже чем через ${PITY - (c.pity[g.id] ?? 0)} жвач.</p>
        <button class="btn primary" data-gum="${g.id}">Купить за 🪙 ${g.price}</button>
      </div>`
    ).join('')}</div>
    <p class="vk-odds">Шансы на каждый вкладыш: ${odds}. Гарантия: редкий или лучше — не позже ${PITY}-й жвачки серии.</p>
    <div class="vk-opened"></div>
    <p><button class="btn" data-a="dust">Сдать повторы сверх двух в обменный фонд</button> <small>(${DUST.map((d, i) => `${RARITY_NAME[i]} — ${d}`).join(', ')} монет)</small></p>`
  );
  const opened = ov.querySelector<HTMLElement>('.vk-opened')!;
  const sync = () => {
    const cc = load();
    ov.querySelector('[data-coins]')!.textContent = `🪙 ${cc.coins}`;
    for (const g of GUMS) {
      ov.querySelector(`[data-pity="${g.id}"]`)!.textContent = `редкий — не позже чем через ${PITY - (cc.pity[g.id] ?? 0)} жвач.`;
      (ov.querySelector(`[data-gum="${g.id}"]`) as HTMLButtonElement).disabled = cc.coins < g.price;
    }
  };
  sync();
  ov.querySelectorAll<HTMLButtonElement>('[data-gum]').forEach((b) => {
    b.onclick = () => {
      const cc = load();
      const got = openGum(cc, b.dataset.gum!);
      if (!got) return;
      sfx('wrap');
      opened.innerHTML = `<div class="vk-pack">${got
        .map((x, i) => `<div class="vk-flip" style="--d:${i * 0.35}s"><div class="vk-flip-in"><div class="vk-flip-back"></div><div class="vk-flip-face">${cardHtml(x)}${count(cc, x.id) === 1 ? '<em class="vk-new">новый!</em>' : ''}</div></div></div>`)
        .join('')}</div>`;
      opened.querySelectorAll<HTMLElement>('.vk-flip').forEach((f, i) => {
        f.onclick = () => zoom(got[i]);
        setTimeout(() => sfx(got[i].rarity >= 2 ? 'win' : 'place', 0.7), 400 + i * 350);
      });
      sync();
    };
  });
  ov.querySelector<HTMLButtonElement>('[data-a=dust]')!.onclick = () => {
    const n = dustExtras(load());
    if (n) sfx('coin');
    opened.innerHTML = `<p>${n ? `Сдано в обменный фонд: +${n} монет.` : 'Лишних повторов нет — сверх двух ничего не лежит.'}</p>`;
    sync();
  };
  const obs = new MutationObserver(() => {
    if (!ov.isConnected) {
      obs.disconnect();
      onClose();
    }
  });
  obs.observe(document.body, { childList: true });
}

// ---------------------------------------------------------------- альбом
function album() {
  const c = load();
  const ov = modal(
    '📒 Альбом',
    `<div class="vk-tabs">${SETS.map((s, i) => {
      const all = CARDS.filter((x) => x.set === s.key);
      const have = all.filter((x) => count(c, x.id) > 0).length;
      return `<button class="btn${i === 0 ? ' on' : ''}" data-set="${s.key}">${esc(s.title)} <small>${have}/${all.length}</small></button>`;
    }).join('')}</div><div class="vk-page"></div>`
  );
  const page = ov.querySelector<HTMLElement>('.vk-page')!;
  const show = (key: string) => {
    const s = SETS.find((x) => x.key === key)!;
    const all = CARDS.filter((x) => x.set === key).sort((a, b) => a.n - b.n);
    page.innerHTML = `<p class="vk-set-sub">${esc(s.sub)} · ${COLL_NAME[s.coll]}</p><div class="vk-grid">${all
      .map((x) => {
        const n = count(c, x.id);
        return n ? `<div class="vk-cell has" data-id="${x.id}">${cardHtml(x)}${n > 1 ? `<em class="vk-n">×${n}</em>` : ''}</div>` : `<div class="vk-cell"><span>№${x.n}</span></div>`;
      })
      .join('')}</div>`;
    page.querySelectorAll<HTMLElement>('.vk-cell.has').forEach((el) => (el.onclick = () => zoom(card(el.dataset.id!))));
    ov.querySelectorAll('[data-set]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.set === key));
  };
  ov.querySelectorAll<HTMLElement>('[data-set]').forEach((b) => (b.onclick = () => show(b.dataset.set!)));
  show(SETS[0].key);
}

// ---------------------------------------------------------------- колоды
function decks(onClose: () => void) {
  let c = load();
  let di = c.active;
  let ids = [...(c.decks[di]?.ids ?? [])];
  let filter = 'all';
  const ov = modal('🃏 Колоды', `<div class="vk-decks"></div>`);
  const root = ov.querySelector<HTMLElement>('.vk-decks')!;
  const draw = () => {
    const have = CARDS.filter((x) => count(c, x.id) > 0 && (filter === 'all' || x.coll === filter)).sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
    const err = deckValid(c, ids);
    const inDeck = (id: string) => ids.filter((x) => x === id).length;
    const curve = Array.from({ length: 8 }, (_, k) => ids.filter((id) => Math.min(7, card(id).cost) === k).length);
    root.innerHTML = `<div class="vk-deck-bar">
        <select data-a="deck">${c.decks.map((d, i) => `<option value="${i}"${i === di ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}<option value="new">+ новая колода</option></select>
        <input data-a="name" value="${esc(c.decks[di]?.name ?? 'Колода')}" maxlength="24">
        <button class="btn" data-a="auto">Собрать само</button>
        <button class="btn primary" data-a="save" ${err ? 'disabled' : ''}>Сохранить</button>
        <button class="btn" data-a="del" ${c.decks.length < 2 ? 'disabled' : ''}>Удалить</button>
        <span class="${err ? 'vk-err' : 'vk-ok'}">${err ?? 'колода готова'}</span>
      </div>
      <div class="vk-curve">${curve.map((n, k) => `<div><i style="height:${n * 9}px"></i><small>${k === 7 ? '7+' : k}</small></div>`).join('')}</div>
      <div class="vk-deck-list">${[...new Set(ids)]
        .sort((a, b) => card(a).cost - card(b).cost)
        .map((id) => `<button class="vk-line" data-out="${id}"><b>${card(id).cost}</b> ${esc(card(id).name)} <small>${COLL_NAME[card(id).coll]}</small>${inDeck(id) > 1 ? ' ×2' : ''}</button>`)
        .join('')}</div>
      <div class="vk-filter">${['all', 'turbo', 'bomb', 'final', 'love', 'lazer'].map((f) => `<button class="btn${f === filter ? ' on' : ''}" data-f="${f}">${f === 'all' ? 'Все' : COLL_NAME[f as keyof typeof COLL_NAME]}</button>`).join('')}</div>
      <div class="vk-grid small">${have
        .map((x) => {
          const n = Math.min(MAX_COPIES, count(c, x.id));
          const used = inDeck(x.id);
          return `<div class="vk-cell has${used >= n ? ' used' : ''}" data-in="${x.id}">${cardHtml(x)}<em class="vk-n">${used}/${n}</em></div>`;
        })
        .join('')}</div>
      <p><small>Щелчок — в колоду, щелчок по строке слева — убрать; зажать или правый щелчок — рассмотреть. В колоде ${DECK_SIZE}, одинаковых не больше ${MAX_COPIES}.</small></p>`;
    const q = (a: string) => root.querySelector<HTMLElement>(`[data-a=${a}]`)!;
    (q('deck') as HTMLSelectElement).onchange = (e) => {
      const v = (e.target as HTMLSelectElement).value;
      if (v === 'new') {
        c.decks.push({ name: `Колода ${c.decks.length + 1}`, ids: [] });
        di = c.decks.length - 1;
      } else di = +v;
      ids = [...c.decks[di].ids];
      draw();
    };
    q('auto').onclick = () => {
      ids = autoDeck(c);
      draw();
    };
    q('save').onclick = () => {
      c.decks[di] = { name: (q('name') as HTMLInputElement).value.trim() || 'Колода', ids: [...ids] };
      c.active = di;
      save(c);
      sfx('place');
      draw();
    };
    q('del').onclick = () => {
      if (c.decks.length < 2) return;
      c.decks.splice(di, 1);
      di = 0;
      c.active = 0;
      ids = [...c.decks[0].ids];
      save(c);
      draw();
    };
    root.querySelectorAll<HTMLElement>('[data-f]').forEach((b) => (b.onclick = () => ((filter = b.dataset.f!), draw())));
    root.querySelectorAll<HTMLElement>('[data-out]').forEach(
      (b) =>
        (b.onclick = () => {
          const i = ids.indexOf(b.dataset.out!);
          if (i >= 0) ids.splice(i, 1);
          draw();
        })
    );
    root.querySelectorAll<HTMLElement>('[data-in]').forEach((el) => {
      el.onclick = () => {
        const id = el.dataset.in!;
        if (ids.length >= DECK_SIZE || ids.filter((x) => x === id).length >= Math.min(MAX_COPIES, count(c, id))) return;
        ids.push(id);
        draw();
      };
      el.oncontextmenu = (e) => {
        e.preventDefault();
        zoom(card(el.dataset.in!));
      };
    });
  };
  draw();
  const obs = new MutationObserver(() => {
    if (!ov.isConnected) {
      obs.disconnect();
      c = load();
      onClose();
    }
  });
  obs.observe(document.body, { childList: true });
}

export type { Card, Collection };
