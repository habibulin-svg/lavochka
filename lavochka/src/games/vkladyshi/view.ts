/* «Вкладыши» — стол: лавочки двух игроков, рука, терпение и копейки. Карта — настоящий вкладыш в рамке: цена, атака, здоровье.
 * Выложить: щелчок по вкладышу в руке → (место на лавочке) → (цель приёма). Ударить: свой вкладыш → цель. Зажать/правый щелчок — увеличить. */
import type { GameView, ViewCtx } from '../../core/view';
import { card, COLL_NAME, fxText, KW_HINT, KW_NAME, RARITY_NAME, setInfo, type Card } from './cards';
import { atkOf, BOARD_MAX, type Action, type Event, type Tgt, type Unit, type View } from './engine';
import { reward } from './collection';
import { sfx } from './sfx';
import { Music } from './music';
import './vkladyshi.css';

const IMG = '/vkladyshi/';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Карта как HTML: картинка вкладыша (по центру, фон — она же размытая), цена, атака/здоровье, ключевые слова. */
export function cardHtml(c: Card, u?: Unit, atk?: number, extra = ''): string {
  const a = atk ?? u?.atk ?? c.atk;
  const hp = u?.hp ?? c.hp;
  const hurt = u && u.hp < u.maxHp ? ' hurt' : '';
  const up = u && (a > c.atk || u.maxHp > c.hp) ? ' up' : '';
  const kws = (u?.kw ?? c.kw).filter((k) => k !== 'armor' || !u || u.armor);
  const fx = c.play ? fxText(c.play) : c.death ? `прощание: ${fxText(c.death)}` : '';
  return `<div class="vk-card r${c.rarity} c-${c.coll}${c.spell ? ' spell' : ''}${u?.armor ? ' armored' : ''}${u?.stun ? ' stunned' : ''}${extra}" data-id="${c.id}">
    <div class="vk-art" style="--img:url('${IMG}${c.img}')"><img src="${IMG}${c.img}" alt="" loading="lazy" draggable="false"></div>
    <b class="vk-cost">${c.cost}</b>
    <div class="vk-name">${esc(c.name)}</div>
    ${kws.length || fx ? `<div class="vk-kw">${kws.map((k) => `<i>${KW_NAME[k]}</i>`).join('')}${fx && !kws.length ? `<i class="fx">${esc(fx)}</i>` : ''}</div>` : ''}
    ${c.spell ? '' : `<b class="vk-atk${up}">${a}</b><b class="vk-hp${hurt}${up}">${hp}</b>`}
  </div>`;
}

/** Подробная справка по карте (увеличение). */
export function cardInfo(c: Card): string {
  const s = setInfo(c.set);
  const fx = [c.play && (c.spell ? fxText(c.play) : `выход: ${fxText(c.play)}`), c.death && `прощание: ${fxText(c.death)}`].filter(Boolean);
  return `<div class="vk-zoom-info">
    <h3>${esc(c.coll === 'love' ? `Love is ${c.name}` : c.name)}</h3>
    <p class="vk-zoom-set">${esc(s.title)} · №${c.n} · ${RARITY_NAME[c.rarity]}${c.sub ? ` · ${esc(c.sub)}` : ''}</p>
    <p>${c.spell ? `Приём, ${c.cost} коп.` : `${c.cost} коп. · атака ${c.atk} · здоровье ${c.hp}`}</p>
    ${c.kw.map((k) => `<p><b>${KW_NAME[k]}</b> — ${KW_HINT[k]}</p>`).join('')}
    ${fx.map((f) => `<p>${esc(f!)}</p>`).join('')}
  </div>`;
}

export function zoom(c: Card) {
  const ov = document.createElement('div');
  ov.className = 'vk-zoom';
  ov.innerHTML = `<div class="vk-zoom-box">${cardHtml(c)}${cardInfo(c)}</div>`;
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
}

type Sel = { kind: 'hand'; i: number; slot?: number } | { kind: 'unit'; uid: number } | null;

export function createView(): GameView<View, Event> {
  let root: HTMLElement;
  let ctx: ViewCtx<Action>;
  let v: View | null = null;
  let interactive: number[] = [];
  let sel: Sel = null;
  let endBtn: HTMLButtonElement;
  let musicBtn: HTMLButtonElement;
  const music = new Music();
  let rewarded = false;

  /** Индекс «моего» игрока: первый, чьи карты видит экран (хот-сит — тот, чей ход). */
  const meIdx = () => {
    if (!v) return 0;
    if (v.me.includes(v.cur) && interactive.length) return v.cur;
    return v.me[0] ?? 0;
  };
  const myTurn = () => !!v && !v.over && interactive.includes(v.players[v.cur].seat) && v.me.includes(v.cur);

  function hero(pi: number, top: boolean) {
    const p = v!.players[pi];
    const pips = Array.from({ length: Math.max(p.maxMana, 1) }, (_, i) => `<i class="${i < p.mana ? 'on' : ''}"></i>`).join('');
    return `<div class="vk-hero ${top ? 'top' : 'bottom'}${v!.cur === pi && !v!.over ? ' now' : ''}" data-hero="${pi}">
      <div class="vk-face" data-cam="${p.seat}">${ctx.name(p.seat)}</div>
      <div class="vk-patience" title="Терпение"><b>${p.hero}</b><small>терпение</small></div>
      <div class="vk-mana" title="Копейки"><span>${p.mana}/${p.maxMana}</span><div class="vk-pips">${pips}</div></div>
      <div class="vk-deck" title="Колода">🂠 ${p.deck}</div>
    </div>`;
  }

  function board(pi: number) {
    const p = v!.players[pi];
    const mine = pi === meIdx();
    const cells: string[] = [];
    const placing = mine && sel?.kind === 'hand' && myTurn() && !card(v!.players[pi].hand[sel.i]!).spell && sel.slot === undefined;
    p.board.forEach((u, i) => {
      if (placing) cells.push(`<button class="vk-gap" data-slot="${i}" aria-label="Поставить сюда"></button>`);
      const c = card(u.id);
      const ready = mine && myTurn() && !u.sleep && !u.done && atkOf(p.board, u) > 0;
      const s = sel?.kind === 'unit' && sel.uid === u.uid ? ' sel' : '';
      cells.push(`<div class="vk-slot${ready ? ' ready' : ''}${u.sleep ? ' sleep' : ''}${s}" data-uid="${u.uid}" data-p="${pi}">${cardHtml(c, u, atkOf(p.board, u))}</div>`);
    });
    if (placing && p.board.length < BOARD_MAX) cells.push(`<button class="vk-gap" data-slot="${p.board.length}" aria-label="Поставить сюда"></button>`);
    return `<div class="vk-bench ${mine ? 'mine' : 'theirs'}" data-bench="${pi}">${cells.join('') || '<span class="vk-empty">лавочка пуста</span>'}</div>`;
  }

  function hand(pi: number) {
    const p = v!.players[pi];
    if (pi !== meIdx() || !v!.me.includes(pi)) return `<div class="vk-hand backs">${p.hand.map(() => '<div class="vk-back"></div>').join('')}</div>`;
    return `<div class="vk-hand">${p.hand
      .map((id, i) => {
        const c = card(id!);
        const ok = myTurn() && c.cost <= p.mana && (c.spell || p.board.length < BOARD_MAX);
        const s = sel?.kind === 'hand' && sel.i === i ? ' sel' : '';
        return `<div class="vk-inhand${ok ? ' ok' : ''}${s}" data-i="${i}" style="--k:${i - (p.hand.length - 1) / 2}">${cardHtml(c)}</div>`;
      })
      .join('')}</div>`;
  }

  /** Цели текущего выбора: что подсветить. */
  function targets(): Tgt[] {
    if (!v || !sel || !myTurn()) return [];
    const me = meIdx();
    const foe = 1 - me;
    if (sel.kind === 'unit') {
      const walls = v.players[foe].board.filter((u) => u.kw.includes('wall'));
      if (walls.length) return walls.map((u) => ({ p: foe, uid: u.uid }));
      return [{ p: foe }, ...v.players[foe].board.map((u) => ({ p: foe, uid: u.uid }))];
    }
    const c = card(v.players[me].hand[sel.i]!);
    const fx = c.play;
    if (!fx || fx.to === 'none') return [];
    if (!c.spell && sel.slot === undefined) return [];
    const out: Tgt[] = [];
    v.players.forEach((p, i) => {
      const mine = i === me;
      if (fx.to === 'enemy' && !mine) out.push({ p: i });
      for (const u of p.board)
        if (fx.to === 'anyUnit' || (fx.to === 'allyUnit' && mine) || ((fx.to === 'enemyUnit' || fx.to === 'enemy') && !mine)) out.push({ p: i, uid: u.uid });
    });
    return out;
  }

  function render() {
    if (!v) return;
    const me = meIdx();
    const foe = 1 - me;
    root.innerHTML = `<div class="vk-table">
      ${hero(foe, true)}
      ${hand(foe)}
      ${board(foe)}
      <div class="vk-mid"><span>ход ${v.turnNo}${hint() ? ` · ${hint()}` : ''}</span></div>
      ${board(me)}
      ${hero(me, false)}
      ${hand(me)}
    </div>`;
    for (const t of targets()) {
      const el = t.uid === undefined ? root.querySelector(`[data-hero="${t.p}"]`) : root.querySelector(`[data-uid="${t.uid}"]`);
      el?.classList.add('target');
    }
    endBtn.disabled = !myTurn();
    endBtn.classList.toggle('pulse', myTurn() && !anyMove());
  }

  function anyMove(): boolean {
    if (!v) return false;
    const p = v.players[meIdx()];
    return p.hand.some((id) => id && card(id).cost <= p.mana && (card(id).spell || p.board.length < BOARD_MAX)) || p.board.some((u) => !u.sleep && !u.done && atkOf(p.board, u) > 0);
  }

  function hint(): string {
    if (!v) return '';
    if (v.over) return '';
    if (!myTurn()) return 'ход соперника…';
    if (sel?.kind === 'hand') {
      const c = card(v.players[meIdx()].hand[sel.i]!);
      if (!c.spell && sel.slot === undefined) return 'куда на лавочку? — щёлкните промежуток';
      return 'выберите цель (подсвечена)';
    }
    if (sel?.kind === 'unit') return 'кого бить? — цели подсвечены';
    return 'выложите вкладыш или ударьте своим; зажать — рассмотреть';
  }

  function send(a: Action) {
    sel = null;
    ctx.act(v!.players[v!.cur].seat, a);
  }

  function clickHand(i: number) {
    const p = v!.players[meIdx()];
    const c = card(p.hand[i]!);
    if (!myTurn() || c.cost > p.mana) return void zoom(c);
    if (sel?.kind === 'hand' && sel.i === i) {
      sel = null;
      return render();
    }
    sel = { kind: 'hand', i };
    if (!c.spell && p.board.length >= BOARD_MAX) sel = null;
    else if (!c.spell && p.board.length === 0) return place(0);
    else if (c.spell && (!c.play || c.play.to === 'none')) return send({ t: 'play', i });
    render();
  }

  function place(slot: number) {
    if (sel?.kind !== 'hand') return;
    const c = card(v!.players[meIdx()].hand[sel.i]!);
    sel = { ...sel, slot };
    if (c.play && c.play.to !== 'none' && targets().length) return render();
    send({ t: 'play', i: sel.i, slot });
  }

  function clickTarget(t: Tgt) {
    if (!sel) return;
    if (sel.kind === 'unit') return send({ t: 'attack', uid: sel.uid, tgt: t });
    send({ t: 'play', i: sel.i, slot: sel.slot, tgt: t });
  }

  function onClick(e: MouseEvent) {
    if (!v || ctx.demo) return;
    const el = e.target as HTMLElement;
    const tgtEl = el.closest('.target') as HTMLElement | null;
    if (tgtEl) {
      const uid = tgtEl.dataset.uid;
      return clickTarget(uid ? { p: +tgtEl.dataset.p!, uid: +uid } : { p: +tgtEl.dataset.hero! });
    }
    const gap = el.closest('.vk-gap') as HTMLElement | null;
    if (gap) return place(+gap.dataset.slot!);
    const h = el.closest('.vk-inhand') as HTMLElement | null;
    if (h) return clickHand(+h.dataset.i!);
    const slot = el.closest('.vk-slot') as HTMLElement | null;
    if (slot) {
      const uid = +slot.dataset.uid!;
      const pi = +slot.dataset.p!;
      const u = v.players[pi].board.find((x) => x.uid === uid)!;
      if (pi === meIdx() && slot.classList.contains('ready')) {
        sel = sel?.kind === 'unit' && sel.uid === uid ? null : { kind: 'unit', uid };
        return render();
      }
      return zoom(card(u.id));
    }
    if (sel) {
      sel = null;
      render();
    }
  }

  // зажатие (телефон) и правый щелчок — рассмотреть карту
  let pressT = 0;
  let pressed = false;
  function cardUnder(el: HTMLElement): Card | null {
    const c = el.closest('.vk-card') as HTMLElement | null;
    return c?.dataset.id ? card(c.dataset.id) : null;
  }

  function fly(el: Element | null, cls: string, ms: number) {
    if (!el) return;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }
  function floatNum(el: Element | null, text: string, cls: string) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    const n = document.createElement('div');
    n.className = `vk-float ${cls}`;
    n.textContent = text;
    n.style.left = `${r.left - box.left + r.width / 2}px`;
    n.style.top = `${r.top - box.top + r.height / 3}px`;
    root.appendChild(n);
    setTimeout(() => n.remove(), 1100);
  }
  const elOf = (t: Tgt) => (t.uid === undefined ? root.querySelector(`[data-hero="${t.p}"]`) : root.querySelector(`[data-uid="${t.uid}"]`));

  return {
    mount(r, c) {
      root = r;
      ctx = c;
      root.classList.add('vk-root');
      endBtn = document.createElement('button');
      endBtn.className = 'btn vk-end';
      endBtn.textContent = 'Конец хода';
      endBtn.onclick = () => myTurn() && send({ t: 'end' });
      musicBtn = document.createElement('button');
      musicBtn.className = 'btn vk-music';
      musicBtn.title = 'Музыка (магнитофон во дворе)';
      const syncMusic = () => musicBtn.classList.toggle('off', !music.on());
      musicBtn.textContent = '♪';
      musicBtn.onclick = () => {
        music.toggle();
        syncMusic();
      };
      syncMusic();
      ctx.controls.append(endBtn, musicBtn);
      root.addEventListener('click', onClick);
      root.addEventListener('contextmenu', (e) => {
        const c = cardUnder(e.target as HTMLElement);
        if (!c) return;
        e.preventDefault();
        zoom(c);
      });
      root.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch') return;
        pressed = false;
        const c = cardUnder(e.target as HTMLElement);
        if (!c) return;
        pressT = window.setTimeout(() => {
          pressed = true;
          zoom(c);
        }, 450);
      });
      const cancel = () => clearTimeout(pressT);
      root.addEventListener('pointerup', cancel);
      root.addEventListener('pointermove', cancel);
      root.addEventListener(
        'click',
        (e) => {
          if (pressed) {
            pressed = false;
            e.stopImmediatePropagation();
          }
        },
        true
      );
      document.addEventListener('keydown', onKey);
      if (!ctx.demo) music.play();
    },
    setView(view) {
      v = view;
      render();
    },
    async play(events, view) {
      const sp = Math.max(0.2, ctx.speed());
      for (const e of events) {
        if (!v) break;
        switch (e.t) {
          case 'play': {
            sfx(card(e.id).spell ? 'spell' : 'place');
            const tmp = { ...view };
            v = tmp;
            render();
            const el = e.uid !== undefined ? root.querySelector(`[data-uid="${e.uid}"]`) : null;
            fly(el, 'landed', 450);
            if (card(e.id).spell && !ctx.demo && !v.me.includes(e.p)) zoomBrief(card(e.id));
            await sleep(380 / sp);
            break;
          }
          case 'attack': {
            const a = root.querySelector(`[data-uid="${e.uid}"]`);
            const t = elOf(e.tgt);
            if (a && t) {
              const ra = a.getBoundingClientRect();
              const rt = t.getBoundingClientRect();
              (a as HTMLElement).style.setProperty('--dx', `${(rt.left + rt.width / 2 - ra.left - ra.width / 2) * 0.7}px`);
              (a as HTMLElement).style.setProperty('--dy', `${(rt.top + rt.height / 2 - ra.top - ra.height / 2) * 0.7}px`);
              fly(a, 'lunge', 420);
            }
            sfx('hit');
            await sleep(260 / sp);
            break;
          }
          case 'dmg':
            floatNum(elOf(e.tgt), e.armor ? 'броня!' : `−${e.n}`, e.armor ? 'armor' : 'dmg');
            fly(elOf(e.tgt), 'shake', 350);
            break;
          case 'heal':
            floatNum(elOf(e.tgt), `+${e.n}`, 'heal');
            break;
          case 'buff':
            floatNum(elOf(e.tgt), `+${e.atk}/+${e.hp}`, 'heal');
            break;
          case 'die':
            fly(root.querySelector(`[data-uid="${e.uid}"]`), 'dying', 500);
            sfx('die');
            await sleep(300 / sp);
            break;
          case 'turn':
            if (v.me.includes(e.p) && !ctx.demo) sfx('turn');
            break;
          case 'over':
            if (!ctx.demo) {
              const mine = view.me.length === 1 ? view.me[0] : -1;
              sfx(e.winner !== null && e.winner === mine ? 'win' : 'lose');
              if (!rewarded && mine >= 0 && !ctx.online) {
                rewarded = true;
                const coins = reward(e.winner === mine);
                setTimeout(() => toast(`+${coins} монет в копилку`), 600);
              }
            }
            break;
        }
      }
      await sleep(120 / sp);
      v = view;
      render();
    },
    setTurn(_toAct, inter) {
      interactive = inter;
      if (!inter.length) sel = null;
      render();
    },
    saveTitle(view) {
      return `Ход ${view.turnNo} · терпение ${view.players.map((p) => p.hero).join(':')}`;
    },
    status(view, _toAct, inter) {
      if (view.over) return view.winner === null ? 'Ничья' : `${ctx.name(view.players[view.winner].seat)} — победа`;
      return inter.length ? 'Ваш ход' : `Ходит ${ctx.name(view.players[view.cur].seat)}`;
    },
    playerStats(view, seat) {
      const p = view.players.find((x) => x.seat === seat);
      return p ? `♥ ${p.hero} · 🪙 ${p.mana}/${p.maxMana} · 🂠 ${p.deck}` : '';
    },
    destroy() {
      music.stop();
      document.removeEventListener('keydown', onKey);
      document.querySelectorAll('.vk-zoom, .vk-toast').forEach((x) => x.remove());
    },
  };

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && myTurn() && !(e.target instanceof HTMLInputElement)) send({ t: 'end' });
  }

  function zoomBrief(c: Card) {
    const el = document.createElement('div');
    el.className = 'vk-brief';
    el.innerHTML = cardHtml(c);
    root.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  function toast(text: string) {
    const t = document.createElement('div');
    t.className = 'vk-toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
}

export { COLL_NAME };
