/* «Заколдованная страна» — вид: слева сцена (карта страны / план замка / бой / лист оформления), справа «книга»
 * (рассказ ведущего и выборы). Броски — настоящими кубиками сборника: трёхгранный (тёмный) и шестигранный. */
import './zs.css';
import { Sound } from '../../core/audio';
import { DiceTray } from '../../core/dice';
import { store } from '../../core/settings';
import { esc, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import type { Ev } from './ctx';
import type { Action, View } from './engine';
import { GM } from './state';
import { heroLine, renderActions, renderFeed } from './ui/book';
import { CombatView } from './ui/combat';
import { PREF_LOOK, ensureFilters, look } from './ui/common';
import { CreateView } from './ui/create';
import { gmPanel } from './ui/gm';
import { WorldMap } from './ui/map';
import { Music, moodOf } from './ui/music';
import { PlanView } from './ui/plan';
import { openSaveDialog } from './ui/saves';
import { openSheet } from './ui/sheet';
import { siteTitle } from './world';

export function createView(): GameView<View, Ev> {
  let ctx: ViewCtx<Action>;
  let root: HTMLElement;
  let stage: HTMLElement;
  let feed: HTMLElement;
  let acts: HTMLElement;
  let head: HTMLElement;
  let party: HTMLElement;
  let gmBox: HTMLElement;
  let rollBox: HTMLElement;
  let map: WorldMap;
  let plan: PlanView;
  let combat: CombatView;
  let create: CreateView;
  const music = new Music();
  let v: View | null = null;
  let interactive: number[] = [];
  let toAct: number[] = [];

  /** Имя героя (как на листе), а если ещё не оформлен — имя игрока. */
  const nameOf = (seat: number) => {
    const h = v?.heroes.find((x) => x.seat === seat);
    return h?.cls ? esc(h.name) : ctx.name(seat);
  };
  const act = (seat: number, a: Action) => {
    Sound.ui();
    ctx.act(seat, a);
  };

  function render(): void {
    if (!v) return;
    const mode = v.phase === 'create' ? 'create' : v.where.k === 'site' && v.where.site !== 'forpost' ? 'site' : 'map';
    root.dataset.mode = mode;
    root.classList.toggle('orig', look() === 'orig');
    root.classList.toggle('gm', v.gm);
    root.classList.toggle('night', v.world.night);
    const lead = v.party.leader;
    const canGo = interactive.includes(lead) && !v.scene && !v.combat && !v.result;
    if (mode === 'create') create.render(v, ctx.mySeats.filter((s) => s !== GM), act, nameOf);
    else if (mode === 'site') plan.set(v, canGo);
    if (mode !== 'create') map.set(v, canGo && v.where.k === 'map');
    combat.render(v, interactive, act, nameOf);
    // шапка книги
    const where = v.phase === 'create' ? 'Оформление героев' : v.where.k === 'site' ? siteTitle(v as never, v.where.site) : v.world.night ? 'Ночь в пути' : 'В пути';
    head.innerHTML = `<div class="zs-where"><b>${esc(where)}</b><span>день ${v.world.day}${v.world.night ? ' · ночь' : ''}</span></div>
      <div class="zs-tools"><button data-t="look" title="Вид: цветной / как в 1990-м">${look() === 'color' ? '🎨' : '📰'}</button><button data-t="music" title="Музыка">${music.on() ? '🎵' : '🔇'}</button><button data-t="save" title="Сохранить">💾</button>${ctx.mySeats.includes(GM) ? '<button data-t="gm" title="Пульт ведущего">📜</button>' : ''}</div>`;
    head.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) => {
      b.onclick = () => {
        const t = b.dataset.t;
        if (t === 'look') {
          store.set(PREF_LOOK, look() === 'color' ? 'orig' : 'color');
          plan = rebuildPlan();
        } else if (t === 'music') music.toggle();
        else if (t === 'gm') gmBox.hidden = !gmBox.hidden;
        else if (t === 'save') openSaveDialog(root);
        render();
      };
    });
    party.innerHTML = v.heroes
      .filter((h) => h.cls)
      .map((h) => `<button class="zs-chip${h.seat === lead ? ' lead' : ''}${h.dead ? ' dead' : ''}${toAct.includes(h.seat) ? ' turn' : ''}" data-s="${h.seat}"><b>${nameOf(h.seat)}</b><span>${heroLine(h)}</span></button>`)
      .join('') + v.party.allies.map((a) => `<span class="zs-chip ally"><b>${esc(a.name)}</b><span>спутник</span></span>`).join('');
    party.querySelectorAll<HTMLButtonElement>('button.zs-chip').forEach((b) => (b.onclick = () => openSheet(root, v!, Number(b.dataset.s), ctx.mySeats.includes(Number(b.dataset.s)), act, nameOf)));
    renderFeed(feed, v, nameOf);
    renderActions(acts, v, ctx.demo ? [] : interactive, act, nameOf, { sheet: () => {}, gm: () => {} });
    if (ctx.mySeats.includes(GM) && !gmBox.hidden) gmPanel(gmBox, v, act);
    if (!ctx.demo) music.set(moodOf(v));
  }

  function rebuildPlan(): PlanView {
    plan.el.remove();
    const p = new PlanView(stage);
    p.onRoom = (id) => act(v!.party.leader, { t: 'room', id });
    stage.insertBefore(p.el, combat.el);
    return p;
  }

  async function showRoll(e: Extract<Ev, { k: 'roll' }>): Promise<void> {
    const speed = ctx.speed();
    rollBox.hidden = false;
    rollBox.innerHTML = `<div class="zs-roll-l">${esc(e.label)}</div><div class="zs-roll-dice"></div><div class="zs-roll-r"></div>`;
    const tray = new DiceTray(rollBox.querySelector('.zs-roll-dice') as HTMLElement, e.dice.length);
    e.dice.forEach((d, i) => tray.dice[i].wrap.classList.toggle('zs-d3', d.die === 'd3'));
    await tray.roll(e.dice.map((d) => d.face), speed * 1.4);
    const r = rollBox.querySelector('.zs-roll-r') as HTMLElement;
    const d3 = e.dice.find((d) => d.die === 'd3');
    const sum = d3 && e.dice.length === 2 ? `${(d3.face - 1) * 6} + ${e.dice[1].face} = ` : '';
    r.innerHTML = `${sum}<b>${e.v}</b>${e.need != null ? ` <small>(нужно ${Array.isArray(e.need) ? e.need.join(', ') : e.need + '+'})</small>` : ''}${e.ok != null ? ` <span class="${e.ok ? 'ok' : 'no'}">${e.ok ? 'удача' : 'мимо'}</span>` : ''}`;
    await sleep(Math.max(250, 700 / speed));
  }

  return {
    mount(r, c) {
      ctx = c;
      root = r;
      ensureFilters();
      root.classList.add('zs-root');
      root.innerHTML = `<div class="zs-stage"></div><div class="zs-book"><div class="zs-book-h"></div><div class="zs-party"></div><div class="zs-gmbox" hidden></div><div class="zs-feed"></div><div class="zs-actions"></div></div>`;
      stage = root.querySelector('.zs-stage') as HTMLElement;
      head = root.querySelector('.zs-book-h') as HTMLElement;
      party = root.querySelector('.zs-party') as HTMLElement;
      gmBox = root.querySelector('.zs-gmbox') as HTMLElement;
      feed = root.querySelector('.zs-feed') as HTMLElement;
      acts = root.querySelector('.zs-actions') as HTMLElement;
      map = new WorldMap(stage, c.demo, () => c.speed());
      map.onGo = (path) => act(v!.party.leader, { t: 'go', path });
      plan = new PlanView(stage);
      plan.onRoom = (id) => act(v!.party.leader, { t: 'room', id });
      combat = new CombatView(stage);
      create = new CreateView(stage);
      rollBox = document.createElement('div');
      rollBox.className = 'zs-roll';
      rollBox.hidden = true;
      stage.append(rollBox);
      rollBox.onclick = () => (rollBox.hidden = true);
      gmBox.hidden = !c.mySeats.includes(GM);
    },
    setView(view) {
      v = view;
      render();
    },
    async play(events, view) {
      for (const e of events) {
        if (e.k === 'roll') await showRoll(e);
        else if (e.k === 'move' && view.where.k === 'map') {
          root.dataset.mode = 'map';
          await map.walk(e.path, ctx.speed());
        } else if (e.k === 'sfx') {
          if (e.id === 'death') Sound.nomove();
          else if (e.id === 'level') Sound.win();
          else if (e.id === 'fight') Sound.capture();
        } else if (e.k === 'hit') Sound.capture();
      }
      v = view;
      render();
      if (events.some((e) => e.k === 'roll')) setTimeout(() => (rollBox.hidden = true), 1200);
    },
    setTurn(t, inter) {
      toAct = t;
      interactive = inter;
      render();
    },
    status(view, t) {
      if (view.result) return view.result.text;
      if (view.phase === 'create') return 'Оформление героев';
      if (view.combat) return `Бой: раунд ${view.combat.round}`;
      return t.length ? `Ход: ${t.map((s) => (s === GM ? 'ведущий' : view.heroes.find((h) => h.seat === s)?.name ?? '')).join(', ')}` : '';
    },
    playerStats(view, seat) {
      if (seat === GM) return view.gm ? 'ведёт игру' : 'ведущий';
      const h = view.heroes.find((x) => x.seat === seat);
      return h ? heroLine(h) : '';
    },
    destroy() {
      music.stop();
    },
  };
}
