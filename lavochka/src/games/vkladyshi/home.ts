/* «Вкладыши» — блок коллекции на экране игры: копилка, ларёк (жвачки и монеты за рубли), альбом, колоды, обмен, журнал;
 * и блок кона в лобби сетевой комнаты. Коллекция — bank.ts (у вошедшего на сервере, у гостя в браузере). */
import type { LaunchTable } from '../../core/view';
import type { Options } from '../../core/types';
import * as bank from './bank';
import { CARDS, COLL_NAME, DECK_SIZE, MAX_COPIES, RARITY_NAME, SETS, card, type Card } from './cards';
import { COIN_PACKS, DUST, GUMS, ODDS, PACK_SIZE, PITY, STAKE_MAX, autoDeck, coinsOf, count, deckSpec, deckValid, free, type Collection } from './collection';
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

/** Когда окно закрылось — позвать f. */
function onGone(el: HTMLElement, f: () => void) {
  const obs = new MutationObserver(() => {
    if (!el.isConnected) {
      obs.disconnect();
      f();
    }
  });
  obs.observe(document.body, { childList: true });
}

function toast(text: string) {
  const t = document.createElement('div');
  t.className = 'vk-toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

/** Форма оплаты Robokassa: браузер уходит на кассу. */
function goPay(form: { action: string; fields: Record<string, string> }) {
  const f = document.createElement('form');
  f.method = 'POST';
  f.action = form.action;
  for (const [k, v] of Object.entries(form.fields)) {
    const i = document.createElement('input');
    i.type = 'hidden';
    i.name = k;
    i.value = v;
    f.appendChild(i);
  }
  document.body.appendChild(f);
  f.submit();
}

const coinsHtml = (c: Collection) => `🪙 ${coinsOf(c)}${c.hcoins ? ` <small title="купленные монеты тратятся первыми; вкладыши из таких жвачек — домашние">(купленных ${c.hcoins})</small>` : ''}`;
const fmtDate = (t: number) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function home(box: HTMLElement, launch: (options: Options, table?: LaunchTable) => void) {
  box.innerHTML = '<div class="vk-home"><p class="vk-loading">Достаём альбом…</p></div>';
  const q0 = new URLSearchParams(location.search).get('coins');
  if (q0) setTimeout(() => toast(q0 === 'spasibo' ? 'Спасибо! Монеты придут в копилку, как только касса подтвердит оплату.' : 'Оплата не прошла — монеты не списаны.'), 400);
  const draw = () => {
    const c = bank.get();
    const server = bank.getMode() === 'server';
    const d = c.decks[c.active];
    const err = d ? deckValid(c, d.ids) : 'нет колоды';
    const have = Object.keys(c.owned).filter((id) => count(c, id) > 0).length;
    box.innerHTML = `<div class="vk-home">
      <div class="vk-home-top">
        <span class="vk-coins" title="Монеты: за партии — +40 за победу, +10 за поражение">${coinsHtml(c)}</span>
        <span>альбом: <b>${have}</b> из ${CARDS.length}</span>
        <span>побед: <b>${c.wins}</b> из ${c.games}</span>
      </div>
      <div class="vk-home-btns">
        <button class="btn" data-a="shop">🍬 Ларёк</button>
        <button class="btn" data-a="album">📒 Альбом</button>
        <button class="btn" data-a="decks">🃏 Колоды</button>
        ${server ? '<button class="btn" data-a="trade">🤝 Обмен</button><button class="btn" data-a="log">📜 Журнал</button>' : ''}
      </div>
      <div class="vk-home-deck">
        <label>Своя колода: <select data-a="pick">${c.decks.map((x, i) => `<option value="${i}"${i === c.active ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <button class="btn primary" data-a="play" ${err ? 'disabled' : ''}>Сыграть своей колодой</button>
        ${err ? `<small class="vk-err">${esc(err)}</small>` : '<small>против бота со случайной стартовой колодой; монеты — в копилку</small>'}
      </div>
      <p class="vk-home-note">${
        server
          ? '<b>Коллекция на сервере.</b> На кон — в сетевой комнате «через сервер»: каждый играет своей колодой, кон кладут в лобби, победитель забирает весь кон.'
          : '<b>Вы не вошли</b> — коллекция живёт в этом браузере. Войдите (кнопка «Вход» наверху): коллекция переедет на сервер, откроются игра на кон и обмен.'
      }</p>
    </div>`;
    const q = (a: string) => box.querySelector<HTMLElement>(`[data-a=${a}]`)!;
    q('shop').onclick = () => shop(draw);
    q('album').onclick = () => album();
    q('decks').onclick = () => decks(draw);
    if (server) {
      q('trade').onclick = () => trade(draw);
      q('log').onclick = () => journal();
    }
    (q('pick') as HTMLSelectElement).onchange = (e) => {
      void bank
        .setDecks(c.decks, +(e.target as HTMLSelectElement).value)
        .catch((x) => toast(x.message))
        .then(draw);
    };
    q('play').onclick = () => {
      const d2 = c.decks[c.active];
      if (!d2 || deckValid(c, d2.ids)) return;
      launch({ deck0: deckSpec(d2.ids), deck1: 'rand', hero: 30 }, { count: 2 });
    };
  };
  void bank.init().then(draw, draw);
}

// ---------------------------------------------------------------- ларёк
function shop(onClose: () => void) {
  const c = bank.get();
  const odds = ODDS.map((p, i) => `${RARITY_NAME[i]} ${p}%`).join(' · ');
  const pay = bank.getMode() === 'server' && bank.payEnabled();
  const ov = modal(
    '🍬 Ларёк',
    `<p class="vk-coins-line">В копилке: <b data-coins>${coinsHtml(c)}</b></p>
    <div class="vk-gums">${GUMS.map(
      (g) => `<div class="vk-gum c-${g.coll}">
        <div class="vk-gum-wrap"><b>${esc(g.title)}</b><small>жевательная резинка</small></div>
        <p>${PACK_SIZE} вкладыша · серии: ${g.sets.length}</p>
        <p class="vk-pity" data-pity="${g.id}"></p>
        <button class="btn primary" data-gum="${g.id}">Купить за 🪙 ${g.price}</button>
      </div>`
    ).join('')}</div>
    <p class="vk-odds">Шансы на каждый вкладыш: ${odds}. Гарантия: редкий или лучше — не позже ${PITY}-й жвачки серии.</p>
    <div class="vk-opened"></div>
    <p><button class="btn" data-a="dust">Сдать повторы сверх двух в обменный фонд</button> <small>(${DUST.map((d, i) => `${RARITY_NAME[i]} — ${d}`).join(', ')} монет)</small></p>
    <section class="vk-buy">
      <h3>Монеты в копилку</h3>
      ${
        pay
          ? `<div class="vk-packs">${COIN_PACKS.map((p) => `<button class="btn vk-pack-btn" data-pack="${p.id}"><b>🪙 ${p.coins}</b><span>${p.rub} ₽</span></button>`).join('')}</div>`
          : bank.getMode() === 'server'
            ? '<p><small>Покупка монет скоро откроется. Пока монеты — за партии.</small></p>'
            : '<p><small>Купить монеты можно, войдя на сайт.</small></p>'
      }
      <p class="vk-buy-note"><small>Купленные монеты тратятся первыми. Вкладыши из жвачек за купленные монеты — <b>домашние</b>: в альбом и колоду можно, на кон и в обмен — нет. Так игра на кон остаётся дворовой, а не покупной.</small></p>
    </section>`
  );
  const opened = ov.querySelector<HTMLElement>('.vk-opened')!;
  const sync = () => {
    const cc = bank.get();
    ov.querySelector('[data-coins]')!.innerHTML = coinsHtml(cc);
    for (const g of GUMS) {
      ov.querySelector(`[data-pity="${g.id}"]`)!.textContent = `редкий — не позже чем через ${PITY - (cc.pity[g.id] ?? 0)} жвач.`;
      (ov.querySelector(`[data-gum="${g.id}"]`) as HTMLButtonElement).disabled = coinsOf(cc) < g.price;
    }
  };
  sync();
  let busy = false;
  ov.querySelectorAll<HTMLButtonElement>('[data-gum]').forEach((b) => {
    b.onclick = async () => {
      if (busy) return;
      busy = true;
      const home = (bank.get().hcoins ?? 0) > 0;
      try {
        const got = await bank.gum(b.dataset.gum!);
        if (!got) return;
        const cc = bank.get();
        sfx('wrap');
        opened.innerHTML = `<div class="vk-pack">${got
          .map((x, i) => `<div class="vk-flip" style="--d:${i * 0.35}s"><div class="vk-flip-in"><div class="vk-flip-back"></div><div class="vk-flip-face">${cardHtml(x)}${count(cc, x.id) === 1 ? '<em class="vk-new">новый!</em>' : ''}${home ? '<em class="vk-home-tag">домашний</em>' : ''}</div></div></div>`)
          .join('')}</div>`;
        opened.querySelectorAll<HTMLElement>('.vk-flip').forEach((f, i) => {
          f.onclick = () => zoom(got[i]);
          setTimeout(() => sfx(got[i].rarity >= 2 ? 'win' : 'place', 0.7), 400 + i * 350);
        });
      } catch (e) {
        toast((e as Error).message);
      } finally {
        busy = false;
        sync();
      }
    };
  });
  ov.querySelector<HTMLButtonElement>('[data-a=dust]')!.onclick = async () => {
    try {
      const n = await bank.dust();
      if (n) sfx('coin');
      opened.innerHTML = `<p>${n ? `Сдано в обменный фонд: +${n} монет.` : 'Лишних повторов нет — сверх двух ничего не лежит.'}</p>`;
    } catch (e) {
      toast((e as Error).message);
    }
    sync();
  };
  ov.querySelectorAll<HTMLButtonElement>('[data-pack]').forEach((b) => {
    b.onclick = async () => {
      try {
        const r = await bank.vkApi<{ form: { action: string; fields: Record<string, string> } }>('/buy', { pack: b.dataset.pack });
        goPay(r.form);
      } catch (e) {
        toast((e as Error).message);
      }
    };
  });
  onGone(ov, onClose);
}

// ---------------------------------------------------------------- альбом
function album() {
  const c = bank.get();
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
        const h = c.owned[x.id]?.h ?? 0;
        return n
          ? `<div class="vk-cell has" data-id="${x.id}">${cardHtml(x)}${n > 1 ? `<em class="vk-n">×${n}</em>` : ''}${h ? `<em class="vk-home-tag" title="домашних: ${h}">дом.${h > 1 ? ' ×' + h : ''}</em>` : ''}</div>`
          : `<div class="vk-cell"><span>№${x.n}</span></div>`;
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
  let c = bank.get();
  const list = c.decks.map((d) => ({ ...d, ids: [...d.ids] }));
  let di = c.active;
  let ids = [...(list[di]?.ids ?? [])];
  let filter = 'all';
  const ov = modal('🃏 Колоды', `<div class="vk-decks"></div>`);
  const root = ov.querySelector<HTMLElement>('.vk-decks')!;
  const persist = async (saved = false) => {
    try {
      await bank.setDecks(list, di);
      c = bank.get();
      if (saved) sfx('place');
    } catch (e) {
      toast((e as Error).message);
    }
    draw();
  };
  const draw = () => {
    const have = CARDS.filter((x) => count(c, x.id) > 0 && (filter === 'all' || x.coll === filter)).sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
    const err = deckValid(c, ids);
    const inDeck = (id: string) => ids.filter((x) => x === id).length;
    const curve = Array.from({ length: 8 }, (_, k) => ids.filter((id) => Math.min(7, card(id).cost) === k).length);
    root.innerHTML = `<div class="vk-deck-bar">
        <select data-a="deck">${list.map((d, i) => `<option value="${i}"${i === di ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}<option value="new">+ новая колода</option></select>
        <input data-a="name" value="${esc(list[di]?.name ?? 'Колода')}" maxlength="24">
        <button class="btn" data-a="auto">Собрать само</button>
        <button class="btn primary" data-a="save" ${err ? 'disabled' : ''}>Сохранить</button>
        <button class="btn" data-a="del" ${list.length < 2 ? 'disabled' : ''}>Удалить</button>
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
      <p><small>Щелчок — в колоду, щелчок по строке слева — убрать; правый щелчок или зажать — рассмотреть. В колоде ${DECK_SIZE}, одинаковых не больше ${MAX_COPIES}.</small></p>`;
    const q = (a: string) => root.querySelector<HTMLElement>(`[data-a=${a}]`)!;
    (q('deck') as HTMLSelectElement).onchange = (e) => {
      const v = (e.target as HTMLSelectElement).value;
      if (v === 'new') {
        list.push({ name: `Колода ${list.length + 1}`, ids: [] });
        di = list.length - 1;
      } else di = +v;
      ids = [...list[di].ids];
      draw();
    };
    q('auto').onclick = () => {
      ids = autoDeck(c);
      draw();
    };
    q('save').onclick = () => {
      list[di] = { name: (q('name') as HTMLInputElement).value.trim() || 'Колода', ids: [...ids] };
      void persist(true);
    };
    q('del').onclick = () => {
      if (list.length < 2) return;
      list.splice(di, 1);
      di = 0;
      ids = [...list[0].ids];
      void persist();
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
  onGone(ov, onClose);
}

// ---------------------------------------------------------------- выбор своих дворовых (кон, обмен)
/** Сетка своих дворовых вкладышей для выбора; picked — уже выбранные здесь (с повторами). Домашние видны, но выбрать нельзя. */
function yardPicker(el: HTMLElement, picked: string[], onPick: (ids: string[]) => void) {
  let filter = 'all';
  const draw = () => {
    const c = bank.get();
    // отложенное здесь же (picked) не считается занятым
    const avail = (id: string) => free(c, id) - Math.max(0, bank.heldOf(id) - picked.filter((x) => x === id).length);
    const list = CARDS.filter((x) => count(c, x.id) > 0 && (filter === 'all' || x.coll === filter)).sort((a, b) => b.rarity - a.rarity || a.cost - b.cost);
    el.innerHTML = `<div class="vk-filter">${['all', 'turbo', 'bomb', 'final', 'love', 'lazer'].map((f) => `<button class="btn small${f === filter ? ' on' : ''}" data-f="${f}">${f === 'all' ? 'Все' : COLL_NAME[f as keyof typeof COLL_NAME]}</button>`).join('')}</div>
      <div class="vk-grid small">${list
        .map((x) => {
          const n = avail(x.id);
          const k = picked.filter((i) => i === x.id).length;
          const home = n <= 0 && (c.owned[x.id]?.h ?? 0) > 0;
          return `<div class="vk-cell has${n - k <= 0 ? ' used' : ''}" data-in="${x.id}" title="${home ? 'домашний — не на кон и не в обмен' : ''}">${cardHtml(x)}<em class="vk-n">${k ? `${k}/` : ''}${Math.max(0, n)}</em>${home ? '<em class="vk-home-tag">дом.</em>' : ''}</div>`;
        })
        .join('')}</div>`;
    el.querySelectorAll<HTMLElement>('[data-f]').forEach((b) => (b.onclick = () => ((filter = b.dataset.f!), draw())));
    el.querySelectorAll<HTMLElement>('[data-in]').forEach((cell) => {
      cell.onclick = () => {
        const id = cell.dataset.in!;
        if (picked.length >= STAKE_MAX || picked.filter((i) => i === id).length >= avail(id)) return;
        onPick([...picked, id]);
      };
      cell.oncontextmenu = (e) => {
        e.preventDefault();
        zoom(card(cell.dataset.in!));
      };
    });
  };
  draw();
}

const strip = (ids: string[], removable: boolean) =>
  ids.length
    ? `<div class="vk-strip">${ids.map((id, i) => `<div class="vk-cell has" data-k="${i}" data-id="${id}">${cardHtml(card(id))}${removable ? '<em class="vk-x-tag">✕</em>' : ''}</div>`).join('')}</div>`
    : '<p class="vk-empty-line">пусто</p>';

function bindStrip(el: HTMLElement, onRemove?: (k: number) => void) {
  el.querySelectorAll<HTMLElement>('.vk-strip .vk-cell').forEach((c) => {
    c.onclick = () => (onRemove ? onRemove(+c.dataset.k!) : zoom(card(c.dataset.id!)));
    c.oncontextmenu = (e) => {
      e.preventDefault();
      zoom(card(c.dataset.id!));
    };
  });
}

// ---------------------------------------------------------------- обмен
interface TradeView {
  code: string;
  mine: { ids: string[]; ok: boolean };
  foe: { name: string; ids: string[]; ok: boolean } | null;
  sig: string;
  done: string | null;
}

function trade(onClose: () => void) {
  const ov = modal('🤝 Обмен', '<div class="vk-trade"></div>');
  const root = ov.querySelector<HTMLElement>('.vk-trade')!;
  let t: TradeView | null = null;
  const call = async (path: string, body?: unknown) => {
    try {
      t = await bank.vkApi<TradeView>(path, body);
      if (t?.done) await bank.refresh();
    } catch (e) {
      toast((e as Error).message);
    }
    draw();
  };
  const start = () => {
    root.innerHTML = `<p>Обмен — как во дворе: оба выкладывают свои <b>дворовые</b> вкладыши, видят, что предлагает другой, и оба жмут «Меняемся». Любое изменение снимает согласие.</p>
      <div class="vk-trade-start">
        <button class="btn primary" data-a="open">Открыть стол обмена</button>
        <span>или</span>
        <input data-a="code" maxlength="4" placeholder="код" autocomplete="off">
        <button class="btn" data-a="join">Сесть за стол</button>
      </div>`;
    root.querySelector<HTMLElement>('[data-a=open]')!.onclick = () => void call('/trade/open', {});
    root.querySelector<HTMLElement>('[data-a=join]')!.onclick = () => void call('/trade/join', { code: root.querySelector<HTMLInputElement>('[data-a=code]')!.value });
  };
  const draw = () => {
    if (!t) return start();
    const tv = t;
    if (tv.done) {
      root.innerHTML = `<div class="vk-trade-done"><h3>Обмен состоялся!</h3><p>Отдали:</p>${strip(tv.mine.ids, false)}<p>Получили от ${esc(tv.foe?.name ?? '')}:</p>${strip(tv.foe?.ids ?? [], false)}<p><small>Записано в журнал у обоих.</small></p></div>`;
      bindStrip(root);
      return;
    }
    root.innerHTML = `<p class="vk-trade-code">Код стола: <b>${esc(tv.code)}</b> <small>— скажите его тому, с кем меняетесь</small></p>
      <div class="vk-trade-sides">
        <section><h3>Вы даёте ${tv.mine.ok ? '<span class="vk-ok">✔ согласны</span>' : ''}</h3><div data-a="mine">${strip(tv.mine.ids, true)}</div></section>
        <section><h3>${tv.foe ? `${esc(tv.foe.name)} даёт ${tv.foe.ok ? '<span class="vk-ok">✔ согласен</span>' : ''}` : 'Ждём второго…'}</h3><div data-a="foe">${tv.foe ? strip(tv.foe.ids, false) : ''}</div></section>
      </div>
      <div class="row buttons"><button class="btn" data-a="leave">Встать из-за стола</button><button class="btn primary" data-a="ok" ${!tv.foe || tv.mine.ok || (!tv.mine.ids.length && !tv.foe.ids.length) ? 'disabled' : ''}>Меняемся</button></div>
      <h3>Свои дворовые — щёлкните, чтобы выложить (до ${STAKE_MAX})</h3>
      <div data-a="pick"></div>`;
    bindStrip(root.querySelector<HTMLElement>('[data-a=mine]')!, (k) => void call('/trade/put', { code: tv.code, ids: tv.mine.ids.filter((_, i) => i !== k) }));
    bindStrip(root.querySelector<HTMLElement>('[data-a=foe]')!);
    yardPicker(root.querySelector<HTMLElement>('[data-a=pick]')!, tv.mine.ids, (ids) => void call('/trade/put', { code: tv.code, ids }));
    root.querySelector<HTMLElement>('[data-a=ok]')!.onclick = () => void call('/trade/ok', { code: tv.code, sig: tv.sig });
    root.querySelector<HTMLElement>('[data-a=leave]')!.onclick = async () => {
      await bank.vkApi('/trade/leave', { code: tv.code }).catch(() => {});
      t = null;
      draw();
    };
  };
  draw();
  // стол обмена — опрос раз в 1,5 с, пока окно открыто
  const timer = window.setInterval(async () => {
    if (!t || t.done) return;
    try {
      const nt = await bank.vkApi<TradeView>(`/trade?code=${encodeURIComponent(t.code)}`);
      if (JSON.stringify(nt) !== JSON.stringify(t)) {
        t = nt;
        if (t.done) await bank.refresh();
        draw();
      }
    } catch {
      /* стол закрыли */
    }
  }, 1500);
  onGone(ov, () => {
    clearInterval(timer);
    if (t && !t.done) void bank.vkApi('/trade/leave', { code: t.code }).catch(() => {});
    onClose();
  });
}

// ---------------------------------------------------------------- журнал
function journal() {
  const c = bank.get();
  modal(
    '📜 Журнал',
    c.log?.length ? `<ul class="vk-log">${c.log.map((l) => `<li><time>${fmtDate(l.at)}</time> ${esc(l.text)}</li>`).join('')}</ul>` : '<p>Пока пусто: здесь будут коны, обмены и покупки.</p>',
    false
  );
}

// ---------------------------------------------------------------- кон в лобби
interface StakeView {
  mine: { ids: string[]; ok: boolean } | null;
  foe: { name: string; ids: string[]; ok: boolean } | null;
  others: string[];
  sig: string;
  locked: boolean;
}

/** Блок кона в лобби сетевой комнаты: свой кон, кон соперника крупно, «Согласен на кон». */
export function stakePanel(box: HTMLElement, room: { code: string; mode: 'server' | 'p2p' }) {
  if (room.mode !== 'server') {
    box.innerHTML = '<p class="vk-stake-note">Игра на кон — только в комнате «через сервер».</p>';
    return;
  }
  box.innerHTML = '<p class="vk-stake-note">Проверяем, можно ли играть на кон…</p>';
  let s: StakeView | null = null;
  let picking = false;
  const url = `/stake?room=${encodeURIComponent(room.code)}`;
  const call = async (path: string, body?: unknown) => {
    try {
      s = await bank.vkApi<StakeView>(path, body);
      if (body !== undefined) await bank.refresh();
    } catch (e) {
      toast((e as Error).message);
    }
    draw();
  };
  const draw = () => {
    if (!s) return;
    const sv = s;
    const mine = sv.mine?.ids ?? [];
    const both = !!sv.mine?.ok && !!sv.foe?.ok;
    box.innerHTML = `<div class="vk-stake">
      <h3>На кон ${sv.locked ? '<span class="vk-ok">— партия идёт на кон</span>' : both ? '<span class="vk-ok">— договорились: победитель забирает всё</span>' : ''}</h3>
      <div class="vk-trade-sides">
        <section><h4>Вы ставите ${sv.mine?.ok ? '<span class="vk-ok">✔</span>' : ''}</h4><div data-a="mine">${strip(mine, !sv.locked)}</div></section>
        <section><h4>${sv.foe ? `${esc(sv.foe.name)} ставит ${sv.foe.ok ? '<span class="vk-ok">✔</span>' : ''}` : sv.others.length ? `${esc(sv.others.join(', '))} пока ничего не поставил` : 'Соперник ещё не вошёл'}</h4><div data-a="foe">${sv.foe ? strip(sv.foe.ids, false) : ''}</div></section>
      </div>
      ${
        sv.locked
          ? ''
          : `<div class="row buttons">
        <button class="btn" data-a="pick">${picking ? 'Готово' : mine.length ? 'Изменить кон' : 'Положить на кон'}</button>
        <button class="btn primary" data-a="ok" ${!sv.mine || !sv.foe || sv.mine.ok ? 'disabled' : ''}>Согласен на кон</button>
      </div>
      <small>Кон кладут оба; партия идёт на кон, только если оба согласились до начала, иначе — на интерес. Каждый играет своей активной колодой.</small>
      <div data-a="grid" ${picking ? '' : 'hidden'}></div>`
      }
    </div>`;
    bindStrip(box.querySelector<HTMLElement>('[data-a=foe]')!);
    if (sv.locked) return bindStrip(box.querySelector<HTMLElement>('[data-a=mine]')!);
    bindStrip(box.querySelector<HTMLElement>('[data-a=mine]')!, (k) => void call('/stake', { room: room.code, ids: mine.filter((_, i) => i !== k) }));
    box.querySelector<HTMLElement>('[data-a=pick]')!.onclick = () => ((picking = !picking), draw());
    box.querySelector<HTMLElement>('[data-a=ok]')!.onclick = () => void call('/stake/ok', { room: room.code, sig: sv.sig });
    if (picking) yardPicker(box.querySelector<HTMLElement>('[data-a=grid]')!, mine, (ids) => void call('/stake', { room: room.code, ids }));
  };
  void (async () => {
    await bank.init();
    if (bank.getMode() !== 'server') {
      box.innerHTML = '<p class="vk-stake-note">Игра на кон — для вошедших на сайт (кнопка «Вход» наверху). Без кона играть можно.</p>';
      return;
    }
    try {
      s = await bank.vkApi<StakeView>(url);
    } catch (e) {
      box.innerHTML = `<p class="vk-stake-note">${esc((e as Error).message)} Без кона играть можно.</p>`;
      return;
    }
    draw();
    const timer = window.setInterval(async () => {
      if (!box.isConnected) return clearInterval(timer);
      try {
        const ns = await bank.vkApi<StakeView>(url);
        if (JSON.stringify(ns) !== JSON.stringify(s)) {
          s = ns;
          draw();
        }
      } catch {
        /* комната закрылась */
      }
    }, 1500);
  })();
}

export type { Card, Collection };
