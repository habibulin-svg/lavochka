/**
 * «Корона Эмбера», «Классика 1994» — вид: то же поле под камерой и пуговицы, что у упрощённой игры, и своя панель:
 * карта путника, вещи и друзья (с текстом карты по нажатию и кнопкой «применить»), эффекты, карты на полях (значки на клетках),
 * вопросы игроку кнопками, бой с бросками. Главная кнопка хода — с `data-tap`. Панель стола (чат, голос) не трогаем.
 */
import '../korona.css';
import { Sound } from '../../../core/audio';
import { BoardCam, type CamPoint } from '../../../core/boardcam';
import { DiceTray } from '../../../core/dice';
import { esc, sleep } from '../../../core/util';
import type { GameView, ViewCtx } from '../../../core/view';
import { SEATS } from '../../hodilki/core';
import { FIELD1, cellPx, sectorPx } from '../data';
import { place2 } from '../engine';
import { ITEMS, PRINCES, TRAVELLERS, advText, cellName } from './data';
import { FALL_NEED } from './cells';
import { capacity, counts, myPower, routes, thingName } from './engine';
import { HIDDEN_THING, type CAction, type CEvent, type ClassicView as V } from './glue';
import type { Status } from './script';
import type { CHero, CState, Thing } from './state';

type F = 1 | 2;
interface Pos {
  f: F;
  x: number;
  y: number;
}

const DIM: Record<F, { w: number; h: number; img: string; mini: string; r: number; name: string }> = {
  1: { w: Math.round(FIELD1.pt[0] * FIELD1.scale), h: Math.round(FIELD1.pt[1] * FIELD1.scale), img: '/korona/field1.webp', mini: '/korona/field1-small.webp', r: 95, name: 'Мир Приключений' },
  2: { w: 1743, h: 3567, img: '/korona/field2.webp', mini: '/korona/field2-small.webp', r: 40, name: 'Королевство Эмбер' },
};

/** Сколько держать событие, если за экраном не человек. */
const PACE = { card: 2800, zone: 1600 };

const nameOf = (s: number) => SEATS[s]?.name ?? String(s);
const color = (s: number) => SEATS[s]?.color ?? '#888';
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const asC = (v: V) => ({ ...v, deck: [] }) as unknown as CState;

function posOf(h: CHero): Pos {
  if (h.zone === 'world') {
    const p = h.sector != null ? sectorPx(h.cell, h.sector) : cellPx(h.cell);
    return { f: 1, x: p?.x ?? 0, y: p?.y ?? 0 };
  }
  const p = place2(h as unknown as Parameters<typeof place2>[0]);
  return { f: 2, x: p.x, y: p.y };
}

const svg = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** Эффекты путника словами. */
export function statusText(st: Status): string {
  const turns = (n: number) => `ещё ${n} ${n === 1 ? 'ход' : n < 5 ? 'хода' : 'ходов'}`;
  const until = (u: string) => `пока не придёшь на поле «${cap(u.toLowerCase())}»`;
  switch (st.k) {
    case 'world':
      return `Не можешь покинуть свой Мир${st.turns ? `, ${turns(st.turns)}` : ''}${st.until ? `, ${until(st.until)}` : ''}`;
    case 'paralysed':
      return `Парализован: нужно выбросить ${st.need} и больше на двух кубиках, чтобы идти`;
    case 'even':
      return `Ходишь только на чётное число полей, ${turns(st.turns)}`;
    case 'cw':
      return `Ходишь только по часовой стрелке${st.sleepy ? ' (сонная болезнь)' : ''}, ${until(st.until)}`;
    case 'drain':
      return `Перед каждым ходом теряешь ${st.p}, ${until(st.until)}`;
    case 'name':
      return `Называешь число вместо броска (до ${st.max}), ${turns(st.turns)}`;
    case 'unlucky':
      return `Невезение: бросок называет следующий игрок, ${turns(st.turns)}`;
    case 'peek':
      return `Смотришь верхнюю карту перед ходом, ${turns(st.turns)}`;
    case 'invisible':
      return `Невидим: можешь не выполнять карты приключений, ${turns(st.turns)}`;
    case 'reverse':
      return 'Следующий ход — в обратную сторону';
    case 'haunt':
      return `Тебя преследует «${cap(advText(st.adv)?.title.toLowerCase() ?? 'карта')}»`;
    case 'debt':
      return `Долг ${st.т} т.: нельзя войти в Провал, пока не заплатишь`;
    case 'nogold':
      return `Без золота, ${until(st.until)}`;
    case 'noamulets':
      return `Амулеты без силы${st.turns ? `, ${turns(st.turns)}` : st.until ? `, ${until(st.until)}` : ''}`;
    case 'broken':
      return 'Предметы сломаны до ремонта';
    case 'cap':
      return `ПС, ПУ и ПМ не больше ${st.n}, ${until(st.until)}`;
    case 'route':
      return `Идёшь по маршруту регента: пройдено ${st.done} из ${st.cells.length}`;
    case 'legion':
      return `В легионе, ${turns(st.turns)}`;
    case 'fly':
      return `Следующим ходом окажешься на поле «${cap(st.cell.toLowerCase())}»`;
    case 'study':
      return `Изучаешь книгу: +1 ${st.p} за ход, осталось ${st.left}`;
    default:
      return 'Особое состояние';
  }
}

/** Что про вещь написано на её карте. */
function thingInfo(t: Thing): { name: string; text: string; tags: string[] } {
  if (t.id === HIDDEN_THING) return { name: 'Карта колдовства', text: 'Чужая карта в руке — её не видно.', tags: [] };
  const tags: string[] = [];
  if (t.uses != null) tags.push(`×${t.uses}`);
  if (t.pts != null) tags.push(`${t.pts} пт.`);
  if (t.broken) tags.push('сломан');
  if (t.with) tags.push(t.with);
  if (t.hunts) tags.push('охотится');
  if (t.id.startsWith('i')) {
    const i = ITEMS[Number(t.id.slice(1))];
    if (!i) return { name: t.id, text: '', tags };
    const bonus = Object.entries(i.bonus).map(([k, n]) => `${k} ${n! > 0 ? '+' : '−'}${Math.abs(n!)}`);
    const own = i.stats ? ` Сам бьётся: ${Object.entries(i.stats).map(([k, n]) => `${k} ${n}`).join(', ')}.` : '';
    const lines = [i.text, bonus.length ? `Прибавка: ${bonus.join(', ')}.` : '', i.po ? `Нужно ПО: ${i.po}.` : '', i.price ? `Цена: ${i.price} т.` : ''].filter(Boolean);
    return { name: cap(i.name), text: lines.join(' ') + own, tags };
  }
  const a = advText(Number(t.id.slice(1)));
  return { name: cap(a?.title.toLowerCase() ?? t.id), text: a?.text ?? '', tags };
}

/** Вещь, которую можно применить «в любой удобный момент» (по тексту карты). */
const usableNow = (t: Thing) => t.id !== HIDDEN_THING && !t.broken && /удобн[а-я]*\s+момент/i.test(thingInfo(t).text);

export function createClassicView(): GameView<V, CEvent> {
  let ctx: ViewCtx<CAction> | null = null;
  let root: HTMLElement | null = null;
  let wrap: HTMLElement | null = null;
  let board: HTMLElement | null = null;
  let over: SVGSVGElement | null = null;
  let cam: BoardCam | null = null;
  let field: F = 1;
  let pinned = false;
  let panel: HTMLElement | null = null;
  let sheet: HTMLElement | null = null;
  let btns: HTMLElement | null = null;
  let hint: HTMLElement | null = null;
  let tray: DiceTray | null = null;
  let note: HTMLElement | null = null;
  let card: HTMLElement | null = null;
  let ask: HTMLElement | null = null;
  let v: V | null = null;
  let actSeat: number | null = null;
  const shown = new Map<number, Pos>();
  const pieceEl = new Map<number, SVGElement>();
  let trail: { seat: number; f: F; pts: CamPoint[] } | null = null;
  let playing = false;
  /** раскрыто на панели: особенности путника, текст вещи (`things:id` / `friends:id`) */
  let openTr = false;
  let openThing: string | null = null;

  // ---------- поле и камера ----------

  function buildField(f: F) {
    field = f;
    cam?.destroy();
    wrap?.remove();
    const d = DIM[f];
    wrap = document.createElement('div');
    wrap.className = 'kn-wrap';
    wrap.innerHTML =
      `<div class="kn-board"><img class="kn-map kn-map-mini" src="${d.mini}" alt="" draggable="false">` +
      `<img class="kn-map kn-map-full" src="${d.img}" alt="${d.name}" draggable="false"></div>`;
    root!.append(wrap);
    board = wrap.querySelector('.kn-board') as HTMLElement;
    over = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    over.setAttribute('class', 'kn-over');
    over.setAttribute('viewBox', `0 0 ${d.w} ${d.h}`);
    board.append(over);
    note = document.createElement('div');
    note.className = 'kn-note bc-ui';
    note.hidden = true;
    card = document.createElement('div');
    card.className = 'kn-card bc-ui';
    card.hidden = true;
    ask = document.createElement('div');
    ask.className = 'kn-ask bc-ui';
    ask.hidden = true;
    wrap.append(note, card, ask);
    cam = new BoardCam(wrap, board, {
      w: d.w,
      h: d.h,
      mini: d.img,
      src: d.w,
      token: (d.r * 2) / d.w,
      followKey: 'korona.follow',
      demo: ctx!.demo,
      speed: () => ctx!.speed(),
      dots: () =>
        v
          ? v.seats
              .filter((s) => shown.get(s)?.f === field)
              .map((s) => ({ key: s, x: shown.get(s)!.x, y: shown.get(s)!.y, color: color(s), on: s === v!.turn }))
          : [],
      turn: turnPoints,
    });
    const full = wrap.querySelector('.kn-map-full') as HTMLImageElement;
    const ready = () => {
      board?.classList.add('ready');
      ctx?.hold?.(0);
      cam?.shown();
      frame();
    };
    if (full.complete && full.naturalWidth) ready();
    else full.addEventListener('load', ready, { once: true });
    render();
  }

  /** Можно ли сейчас выбирать клетку хода (и какому месту). */
  const picking = (): number | null => {
    if (!v || playing || v.winner != null || v.phase !== 'pick' || v.prompt || v.fight) return null;
    return actSeat === v.turn && v.heroes[v.turn].zone === 'world' && v.heroes[v.turn].sector == null ? actSeat : null;
  };

  function turnPoints(): CamPoint[] {
    if (!v || v.winner != null) return [];
    const p = shown.get(v.turn);
    if (!p || p.f !== field) return [];
    const pts: CamPoint[] = [p];
    const me = picking();
    if (me != null) for (const end of routes(asC(v), me, v.heroes[me].cell, v.die).keys()) pts.push(cellPx(end)!);
    return pts;
  }

  function frame() {
    if (!cam || !v) return;
    const others = v.seats.map((s) => shown.get(s)).filter((p): p is Pos => !!p && p.f === field);
    void cam.frame(turnPoints(), others);
  }

  // ---------- отрисовка поля ----------

  function spread(): Map<number, { x: number; y: number }> {
    const out = new Map<number, { x: number; y: number }>();
    if (!v) return out;
    const groups = new Map<string, number[]>();
    for (const s of v.seats) {
      const p = shown.get(s);
      if (!p || p.f !== field) continue;
      const k = `${Math.round(p.x / 20)},${Math.round(p.y / 20)}`;
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    const gap = DIM[field].r * 1.15;
    for (const list of groups.values()) {
      list.forEach((s, i) => {
        const p = shown.get(s)!;
        const off = list.length > 1 ? (i - (list.length - 1) / 2) * gap : 0;
        out.set(s, { x: p.x + off, y: p.y });
      });
    }
    return out;
  }

  function render() {
    if (!over || !v) return;
    const st = v;
    const R = DIM[field].r;
    over.replaceChildren();
    pieceEl.clear();
    if (trail && trail.f === field && trail.pts.length > 1) {
      over.append(svg('polyline', { points: trail.pts.map((p) => `${p.x},${p.y}`).join(' '), class: 'kn-trail', stroke: color(trail.seat) }));
    }
    // карты приключений, лежащие на полях: значок с числом карт, нажатие — текст
    if (field === 1) {
      for (const [k, list] of Object.entries(st.field)) {
        if (!list?.length) continue;
        const p = cellPx(Number(k));
        if (!p) continue;
        const g = svg('g', { class: 'kn-fc', transform: `translate(${p.x + R * 0.95},${p.y - R * 0.95})` });
        g.append(svg('circle', { r: R * 0.62, class: 'kn-fc-b' }));
        const tx = svg('text', { class: 'kn-fc-t', 'text-anchor': 'middle', y: R * 0.3 });
        tx.textContent = list.length > 1 ? String(list.length) : '✦';
        g.append(tx);
        g.addEventListener('click', (e) => {
          e.stopPropagation();
          showField(Number(k));
        });
        over.append(g);
      }
    }
    // жёлтые кружки: куда можно прийти
    const me = picking();
    if (me != null && field === 1) {
      const h = st.heroes[me];
      const from = cellPx(h.cell)!;
      const route = svg('polyline', { class: 'kn-route', points: '' });
      over.append(route);
      for (const [end, path] of routes(asC(st), me, h.cell, st.die)) {
        const p = cellPx(end)!;
        const g = svg('circle', { cx: p.x, cy: p.y, r: R * 1.9, class: 'kn-move', 'data-to': end });
        const pts = [from, ...path.map((c) => cellPx(c)!)].map((q) => `${q.x},${q.y}`).join(' ');
        g.addEventListener('pointerenter', () => route.setAttribute('points', pts));
        g.addEventListener('pointerleave', () => route.setAttribute('points', ''));
        g.addEventListener('click', () => ctx?.act(me, { type: 'go', path }));
        over.append(g);
      }
    }
    const at = spread();
    for (const s of st.seats) {
      const p = at.get(s);
      if (!p) continue;
      const el = svg('image', {
        x: p.x - R, y: p.y - R, width: R * 2, height: R * 2,
        href: `/hodilki/buttons/${s}.webp`,
        class: 'kn-piece' + (s === st.turn && st.winner == null ? ' kn-on' : ''),
      });
      if (s === me && field === 1) takeable(el, s);
      pieceEl.set(s, el);
      over.append(el);
    }
    panelRender();
  }

  /** Пуговицу можно взять и отпустить на жёлтом кружке. */
  function takeable(el: SVGElement, seat: number) {
    el.classList.add('kn-take');
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const from = { x: e.clientX, y: e.clientY };
      const up = (ev: PointerEvent) => {
        document.removeEventListener('pointerup', up);
        if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 6 || !over || !v || picking() !== seat) return;
        const ctm = over.getScreenCTM();
        const p = ctm ? { x: (ev.clientX - ctm.e) / ctm.a, y: (ev.clientY - ctm.f) / ctm.d } : cam!.toImg(ev.clientX, ev.clientY);
        let best: number[] | null = null;
        let bd = Infinity;
        for (const [end, path] of routes(asC(v), seat, v.heroes[seat].cell, v.die)) {
          const q = cellPx(end)!;
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < bd) {
            bd = d;
            best = path;
          }
        }
        if (best && bd < 260) ctx?.act(seat, { type: 'go', path: best });
      };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* не все браузеры умеют — ловим на документе */
      }
      el.addEventListener('pointerup', up, { once: true });
      document.addEventListener('pointerup', up, { once: true });
    });
  }

  // ---------- карточки поверх поля ----------

  function cardHtml(c: { kicker: string; title: string; text: string; extra?: string }, wait: boolean) {
    return (
      `<div class="kn-card-k">${esc(c.kicker)}</div><div class="kn-card-t">${esc(c.title)}</div>` +
      `<div class="kn-card-s">${esc(c.text)}</div>${c.extra ?? ''}` +
      (wait ? '<div class="kn-card-h">нажмите, чтобы закрыть</div>' : '')
    );
  }

  /** Карты, лежащие на поле клетки, — по нажатию на значок. */
  function showField(n: number) {
    if (!card || !v) return;
    const list = v.field[n] ?? [];
    const html = list
      .map((fc) => {
        const a = advText(fc.n);
        const extra = [fc.settled ? 'поселился здесь' : '', fc.gold ? `под охраной ${fc.gold} т.` : '', fc.pts ? `${fc.pts} пт. на карте` : '', fc.bewitched ? 'заколдован: показатели удвоены' : '', fc.things?.length ? `охраняет вещи: ${fc.things.map((t) => thingName(t)).join(', ')}` : '']
          .filter(Boolean)
          .join('; ');
        return cardHtml({ kicker: `${cellName(n)}${a?.kind ? ' · ' + a.kind : ''}`, title: a?.title ?? `Карта ${fc.n}`, text: a?.text ?? '', extra: extra ? `<div class="kn-card-r"><span class="kn-good">${esc(extra)}</span></div>` : '' }, false);
      })
      .join('<hr>');
    card.innerHTML = html + '<div class="kn-card-h">нажмите, чтобы закрыть</div>';
    card.hidden = false;
    card.onpointerdown = () => {
      card!.hidden = true;
      card!.onpointerdown = null;
    };
  }

  async function say(text: string, ms: number) {
    if (!note) return;
    note.innerHTML = text;
    note.hidden = false;
    await (ctx?.read ? ctx.read(ms) : sleep(ms / (ctx?.speed() ?? 1)));
    if (note) note.hidden = true;
  }

  // ---------- панель ----------

  const viewSeat = (): number => {
    if (!v) return 0;
    if (actSeat != null) return actSeat;
    const mine = ctx?.mySeats.find((s) => v!.seats.includes(s));
    return mine ?? v.turn;
  };

  function sheetHtml(s: number, h: CHero): string {
    if (!v) return '';
    const t = TRAVELLERS[h.tr];
    const tags = [h.align, h.honest ? 'честный' : '', h.patient ? 'терпеливый' : ''].filter(Boolean);
    const num = (label: string, n: number, hot?: boolean) => `<span class="kn-num${hot ? ' kn-ok' : ''}"><i>${label}</i><b>${n}</b></span>`;
    const need = FALL_NEED.min;
    const nums =
      num('ПЖ', h.life) + num('ПС', h.st.ПС, h.st.ПС >= need) + num('ПУ', h.st.ПУ, h.st.ПУ >= need) + num('ПМ', h.st.ПМ, h.st.ПМ >= need) + num('ПО', h.po, h.po >= need) + num('т.', h.gold);
    const prince = h.prince != null ? `<div class="kn-c-line">Принц: <b>${esc(cap(PRINCES[h.prince]?.name.toLowerCase() ?? ''))}</b></div>` : '';
    const text = t?.text ?? '';
    const short = text.length > 110 && !openTr ? text.slice(0, 108).replace(/\s+\S*$/, '') + '…' : text;
    const where =
      h.zone === 'world'
        ? esc(cellName(h.cell))
        : { road: 'дорога к столице', capital: 'столица Эмбера', labyrinth: 'лабиринт', palace: 'дворец', chambers: 'дворцовые покои', arena: 'арена', dead: 'выбыл', out: 'вне игры' }[h.zone];
    let out =
      `<div class="kn-c-head"><b style="color:${color(s)}">${esc(v.names[s] ?? nameOf(s))}</b> — <b>${esc(cap((t?.name ?? '').toLowerCase()))}</b>` +
      `<div class="kn-c-tags">${tags.map((x) => `<span>${esc(x)}</span>`).join('')}<span>${where}</span></div></div>` +
      `<div class="kn-nums">${nums}</div>${prince}` +
      `<div class="kn-c-line kn-c-feat" data-feat>${esc(short)}${text.length > 110 ? ` <u>${openTr ? 'свернуть' : 'ещё'}</u>` : ''}</div>`;
    // вещи
    const open = openThing;
    const list = (title: string, items: Thing[], kind: string, extra = '') => {
      if (!items.length && !extra) return '';
      const chips = items
        .map((th) => {
          const i = thingInfo(th);
          const key = `${kind}:${th.id}`;
          return (
            `<div class="kn-thing${open === key ? ' kn-thing-on' : ''}" data-thing="${esc(key)}"><b>${esc(i.name)}</b>${i.tags.length ? ` <i>${esc(i.tags.join(' · '))}</i>` : ''}` +
            (open === key ? `<div class="kn-thing-t">${esc(i.text)}</div>` : '') +
            '</div>'
          );
        })
        .join('');
      return `<div class="kn-c-sec"><div class="kn-c-title">${title}${extra}</div>${chips}</div>`;
    };
    out += list('Вещи', h.things, 'things', ` <i>${h.things.filter(counts).length} из ${capacity(h)}</i>`);
    out += list('Друзья', h.friends, 'friends');
    // эффекты
    const fx = h.status.map(statusText);
    if (h.skip > 0) fx.push(`Пропускаешь ходов: ${h.skip}`);
    if (v.comet > 0) fx.push(`Зелёная комета: без переходов между Мирами, ${v.comet} ход.`);
    if (v.storm && v.storm.turns > 0) fx.push(`Буря колдовства в Мире ${v.storm.world}: ${v.storm.turns} ход.`);
    if (v.king != null) fx.push(`Король коронован — ${esc(v.names[v.king] ?? '')}: Провалы закрыты`);
    if (fx.length) out += `<div class="kn-c-sec"><div class="kn-c-title">Эффекты</div>${fx.map((x) => `<div class="kn-fx">${esc(x)}</div>`).join('')}</div>`;
    out += `<div class="kn-need">Колода: ${v.deckLeft} · Банк: ${v.bank} т.</div>`;
    return out;
  }

  function panelRender() {
    if (!v || !sheet || !btns || !hint || !ask) return;
    const st = v;
    const seat = viewSeat();
    const h = st.heroes[seat];
    sheet.innerHTML = sheetHtml(seat, h);
    sheet.querySelector('[data-feat]')?.addEventListener('click', () => {
      openTr = !openTr;
      panelRender();
    });
    sheet.querySelectorAll<HTMLElement>('[data-thing]').forEach((el) =>
      el.addEventListener('click', () => {
        openThing = openThing === el.dataset.thing ? null : (el.dataset.thing ?? null);
        panelRender();
      }),
    );
    btns.replaceChildren();
    ask.hidden = true;
    ask.replaceChildren();
    const sw = document.createElement('button');
    sw.className = 'btn small kn-switch';
    sw.textContent = field === 1 ? 'Показать: Королевство Эмбер' : 'Показать: Мир Приключений';
    sw.onclick = () => {
      pinned = true;
      buildField(field === 1 ? 2 : 1);
      frame();
    };
    // бой виден всем: противник и показатели
    const f = st.fight;
    let fightHtml = '';
    if (f && !playing) {
      const mine = myPower(asC(st), f.seat, f);
      const rolls = f.foeRoll != null && f.myRoll != null ? ` · броски: ${f.foe.v}+${f.foeRoll} против ${mine}+${f.myRoll}` : '';
      fightHtml =
        `<div class="kn-fight"><b>${esc(st.names[f.seat] ?? '')}</b> против <b>${esc(cap(f.foe.name.toLowerCase()))}</b>` +
        `${f.foe.kind ? ` <i>(${esc(f.foe.kind)})</i>` : ''}<br>${f.foe.stat}: противник ${f.foe.v}, у бойца ${mine}${f.left > 1 ? ` · врагов: ${f.left}` : ''}${rolls}</div>`;
    }
    const me = actSeat;
    const p = st.prompt;
    if (me == null || playing || st.winner != null) {
      btns.append(sw);
      hint.textContent = st.winner != null ? '' : 'Ходят другие. Карта двигается мышью, колесом и кнопками «+» / «−».';
      if (fightHtml) {
        ask.innerHTML = fightHtml;
        ask.hidden = false;
      }
      return;
    }
    const add = (text: string, action: CAction, primary = false, tap = false) => {
      const b = document.createElement('button');
      b.className = 'btn' + (primary ? ' primary' : '');
      b.textContent = text;
      if (tap) b.dataset.tap = '';
      b.onclick = () => ctx?.act(me, action);
      btns!.append(b);
    };
    if (p && p.seat === me) {
      const rollOnly = p.opts.length === 1 && p.opts[0].key === 'roll';
      if (rollOnly) {
        add('Бросить кубик', { type: 'answer', key: 'roll' }, true, true);
        hint.textContent = p.q;
        if (fightHtml) {
          ask.innerHTML = fightHtml;
          ask.hidden = false;
        }
      } else {
        // вопрос игроку — кнопками поверх поля
        const q = document.createElement('div');
        q.className = 'kn-ask-q';
        q.textContent = p.q;
        const row = document.createElement('div');
        row.className = 'kn-ask-b';
        for (const o of p.opts) {
          const b = document.createElement('button');
          b.className = 'btn';
          b.textContent = o.label;
          b.onclick = () => ctx?.act(me, { type: 'answer', key: o.key });
          row.append(b);
        }
        ask.innerHTML = fightHtml;
        ask.append(q, row);
        ask.hidden = false;
        hint.textContent = 'Ответьте на вопрос над полем.';
      }
    } else if (st.turn === me && !p && !st.fight) {
      if (st.phase === 'roll') {
        const sector = h.zone === 'world' && h.sector != null;
        add(sector ? 'Бросить кубик (подполе)' : 'Бросить кубик', { type: 'roll' }, true, true);
        hint.textContent =
          h.zone === 'world' ? (sector ? 'Вы бродите по секторам подполя: бросок ведёт по кругу.' : 'Бросьте кубик — кнопкой, пробелом или тапом по полю.') : 'Королевство Эмбер: бросайте кубик, дорога ведёт сама.';
      } else if (st.phase === 'pick') {
        hint.textContent = `Выпало ${st.die}. Жёлтые кружки — куда можно прийти (наведите — покажу маршрут). Нажмите кружок или перетащите пуговицу.`;
      }
      // вещи «в любой удобный момент»
      for (const t of st.heroes[me].things.concat(st.heroes[me].friends)) {
        if (usableNow(t)) add(`Применить: ${thingInfo(t).name}`, { type: 'use', id: t.id });
      }
    }
    btns.append(sw);
  }

  // ---------- движение ----------

  function glide(seat: number, to: Pos, ms: number): Promise<void> {
    const from = shown.get(seat);
    shown.set(seat, to);
    if (!from || from.f !== to.f || to.f !== field) {
      render();
      return Promise.resolve();
    }
    render();
    const el = pieceEl.get(seat);
    if (!el || !over) return Promise.resolve();
    over.append(el);
    const R = DIM[field].r;
    const end = { x: Number(el.getAttribute('x')) + R, y: Number(el.getAttribute('y')) + R };
    const t0 = performance.now();
    return new Promise((res) => {
      let fin = false;
      const finish = () => {
        if (fin) return;
        fin = true;
        el.setAttribute('x', String(end.x - R));
        el.setAttribute('y', String(end.y - R));
        res();
      };
      setTimeout(finish, ms + 80);
      const tick = (t: number) => {
        if (fin) return;
        const k = Math.min(1, (t - t0) / ms);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const hop = Math.sin(Math.PI * k) * R * 0.5;
        el.setAttribute('x', String(from.x + (end.x - from.x) * e - R));
        el.setAttribute('y', String(from.y + (end.y - from.y) * e - R - hop));
        if (k < 1) requestAnimationFrame(tick);
        else finish();
      };
      requestAnimationFrame(tick);
    });
  }

  function follow(p: Pos) {
    if (!pinned && p.f !== field) buildField(p.f);
    if (cam && p.f === field && v) void cam.frame([p], []);
  }

  const die6 = (n: number) => Math.min(6, Math.max(1, Math.round(n) || 1));

  return {
    mount(r, c) {
      ctx = c;
      root = r;
      c.hold?.(9000);
      panel = document.createElement('div');
      panel.className = 'kn-panel kn-cpanel';
      panel.innerHTML = '<div class="kn-tray"></div><div class="kn-btns"></div><div class="hint small-hint kn-hint"></div><div class="kn-sheet"></div>';
      c.controls.append(panel);
      sheet = panel.querySelector('.kn-sheet') as HTMLElement;
      btns = panel.querySelector('.kn-btns') as HTMLElement;
      hint = panel.querySelector('.kn-hint') as HTMLElement;
      tray = new DiceTray(panel.querySelector('.kn-tray') as HTMLElement, 2);
      tray.dice[1].wrap.hidden = true;
      buildField(1);
    },

    setView(view) {
      v = view;
      shown.clear();
      for (const s of view.seats) shown.set(s, posOf(view.heroes[s]));
      const mine = shown.get(view.turn);
      if (mine && !pinned && mine.f !== field) buildField(mine.f);
      else render();
    },

    async play(events, view) {
      const speed = Math.max(0.3, ctx?.speed?.() ?? 1);
      const stepMs = 300 / speed;
      playing = true;
      if (card) card.hidden = true;
      v = view;
      render();
      for (const ev of events) {
        if (!wrap) break;
        switch (ev.type) {
          case 'roll': {
            const dice = ev.dice && ev.dice.length > 1 ? ev.dice.slice(0, 2) : [ev.dice?.[0] ?? ev.die];
            tray!.dice[1].wrap.hidden = dice.length < 2;
            await tray!.roll(dice.map(die6), speed);
            const p = shown.get(ev.seat);
            if (!ev.dice && p) trail = { seat: ev.seat, f: p.f, pts: [p] };
            break;
          }
          case 'step': {
            const p = cellPx(ev.cell);
            if (!p) break;
            const to: Pos = { f: 1, x: p.x, y: p.y };
            follow(to);
            if (trail && trail.seat === ev.seat && trail.f === 1) trail.pts.push(to);
            Sound.step();
            await glide(ev.seat, to, stepMs);
            break;
          }
          case 'sector': {
            const p = sectorPx(ev.cell, ev.sector);
            const to: Pos = { f: 1, x: p.x, y: p.y };
            follow(to);
            Sound.step();
            await glide(ev.seat, to, stepMs * 1.5);
            break;
          }
          case 'zone': {
            const h = view.heroes[ev.seat];
            if (!h) break;
            const to = posOf(h);
            follow(to);
            Sound.jump();
            await glide(ev.seat, to, stepMs * 2);
            await say(esc(ev.text), PACE.zone);
            break;
          }
          case 'card': {
            Sound.card();
            if (card) {
              card.innerHTML = cardHtml({ kicker: 'Карта приключений', title: ev.title, text: ev.text }, true);
              card.hidden = false;
              card.onpointerdown = null;
              await (ctx?.read ? ctx.read(PACE.card) : sleep(PACE.card / speed));
              if (card) card.hidden = true;
            }
            break;
          }
          case 'fight': {
            tray!.dice[1].wrap.hidden = false;
            await tray!.roll([die6(ev.foeRoll), die6(ev.myRoll)], speed);
            if (ev.res === 'lose') Sound.nomove();
            else if (ev.res === 'win') Sound.capture();
            break;
          }
          case 'say':
            await say(esc(ev.text), Math.min(2600, 800 + ev.text.length * 28));
            break;
          case 'pts':
            if (ev.delta < 0) Sound.nomove();
            break;
          case 'over':
            Sound.win();
            break;
          default:
            break;
        }
      }
      // перемещения без событий (поле 2) — доезжаем до итогового места
      for (const s of view.seats) {
        const want = posOf(view.heroes[s]);
        const was = shown.get(s);
        if (!was || was.f !== want.f || Math.hypot(was.x - want.x, was.y - want.y) > 1) {
          follow(want);
          await glide(s, want, stepMs * 2);
        }
      }
      playing = false;
      v = view;
      for (const s of view.seats) shown.set(s, posOf(view.heroes[s]));
      const mine = shown.get(view.turn);
      if (mine && !pinned && mine.f !== field) buildField(mine.f);
      else render();
      frame();
    },

    setTurn(toAct, interactive) {
      const was = actSeat;
      actSeat = v && v.winner == null && toAct.length && interactive.includes(toAct[0]) ? toAct[0] : null;
      if (actSeat != null && was == null) {
        pinned = false;
        const p = shown.get(actSeat);
        if (p && p.f !== field) buildField(p.f);
        cam?.release();
      }
      render();
      frame();
    },

    status(view, _toAct, interactive) {
      if (view.winner != null) return `${view.names[view.winner]} — Владыка Королевства Эмбер`;
      const seat = view.prompt ? view.prompt.seat : view.turn;
      const who = interactive.includes(seat) ? 'Ваш ход' : `Ходит ${view.names[seat]}`;
      if (view.fight) return `${who}: бой с «${cap(view.fight.foe.name.toLowerCase())}»`;
      if (view.prompt) return `${who}: ${view.prompt.q}`;
      if (view.phase === 'pick') return `${who}: выпало ${view.die}, выбирайте, куда идти`;
      const h = view.heroes[view.turn];
      const z = { world: h.sector != null ? 'подполе' : 'Мир Приключений', road: 'дорога к столице', capital: 'столица', labyrinth: 'лабиринт', palace: 'дворец', chambers: 'покои', arena: 'арена', dead: 'выбыл', out: 'вне игры' }[h.zone];
      return `${who} (${z})`;
    },

    playerStats(view, s) {
      const h = view.heroes[s];
      if (!h) return '';
      const t = TRAVELLERS[h.tr];
      const need = FALL_NEED.min;
      const k = (n: string, x: number) => (x >= need ? `<b>${n} ${x}</b>` : `${n} ${x}`);
      return `${esc(cap((t?.name ?? '').toLowerCase()))} · ПЖ ${h.life} · ${k('ПС', h.st.ПС)} · ${k('ПУ', h.st.ПУ)} · ${k('ПМ', h.st.ПМ)} · ${k('ПО', h.po)} · ${h.gold} т.`;
    },

    destroy() {
      cam?.destroy();
      wrap?.remove();
      panel?.remove();
      cam = null;
      wrap = board = over = panel = note = card = ask = sheet = btns = hint = null;
      v = null;
      shown.clear();
      pieceEl.clear();
    },
  };
}
