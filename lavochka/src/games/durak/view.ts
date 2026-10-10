/* Дурак — отрисовка: дворовый стол под клеёнкой, веер своих карт, соперники по дуге, колода с козырем, бито.
 * Карты — общая сцена CardStage (cards/stage.ts): 1000×720, на телефоне — вертикальная 540×900 со своей раскладкой.
 * Анимация — CSS-переход transform от старого места к новому (новые карты влетают из колоды или от игрока). */
import { Sound } from '../../core/audio';
import { settings } from '../../core/settings';
import { esc, h, sleep, touchScreen } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { preloadDeck } from '../../cards/render';
import { CardStage, cardKey, portraitArc, portraitHand, type StageItem } from '../../cards/stage';
import { sameCard, sortHand, SUIT_NAME, SUIT_SYM, SUITS, type Card, type Suit } from '../../cards/deck';
import { beats, canTransfer, deckLeft, has, longOn, polishBeaters, room, throwable, transferTarget, trumpOf, unbeaten, type Action, type Event, type View } from './engine';
import { SEATS, titleOf } from './def';
import './durak.css';

type Anchor = { x: number; y: number };

/** Геометрия стола: альбомная (1000×720) и вертикальная для телефона (540×900). */
interface Geo {
  port: boolean;
  W: number;
  /** Центр своей руки. */
  hand: Anchor;
  /** Колода (козырь — поперёк справа от неё), бито, значок козыря. */
  deck: Anchor;
  bito: Anchor;
  trump: Anchor;
  /** Масштаб карт: рука, стол, колода, бито — одного размера. */
  ds: number;
  /** Польский: центр со стопкой и полуоси кольца колоды. */
  pc: Anchor;
  ring: Anchor;
}

const LAND: Geo = { port: false, W: 1000, hand: { x: 500, y: 612 }, deck: { x: 100, y: 345 }, bito: { x: 900, y: 345 }, trump: { x: 100, y: 214 }, ds: 1.1, pc: { x: 500, y: 356 }, ring: { x: 285, y: 92 } };
const PORT: Geo = { port: true, W: 540, hand: { x: 270, y: 792 }, deck: { x: 170, y: 236 }, bito: { x: 460, y: 236 }, trump: { x: 56, y: 236 }, ds: 1.05, pc: { x: 270, y: 450 }, ring: { x: 205, y: 125 } };

/** Польский: кольцо колоды рубашкой вверх вокруг стопки. */
function stockPos(g: Geo, i: number, n: number) {
  const a = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
  return { x: g.pc.x + Math.cos(a) * g.ring.x, y: g.pc.y + Math.sin(a) * g.ring.y, r: (a * 180) / Math.PI + 90 };
}

/** Места соперников сверху: слева направо — по часовой стрелке от меня. */
function arc(g: Geo, n: number): Anchor[] {
  if (g.port) return portraitArc(n, g.W);
  if (n === 1) return [{ x: 500, y: 92 }];
  const out: Anchor[] = [];
  const span = Math.min(760, 220 * (n - 1));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = 500 - span / 2 + span * t;
    const y = 86 + Math.pow(2 * t - 1, 2) * (n > 3 ? 70 : 40);
    out.push({ x, y });
  }
  return out;
}

/** Место i-й пары на столе из n. В вертикальной раскладке — сетка по три, места не съезжают при добавлении карт. */
function tablePos(g: Geo, i: number, n: number): Anchor {
  if (g.port) return { x: 120 + (i % 3) * 142, y: 408 + Math.floor(i / 3) * 160 };
  const rows = n > 3 ? 2 : 1;
  const perRow = rows === 2 ? Math.ceil(n / 2) : n;
  const row = rows === 2 && i >= perRow ? 1 : 0;
  const col = row ? i - perRow : i;
  const inRow = row ? n - perRow : perRow;
  return { x: 500 + (col - (inRow - 1) / 2) * 140 - 10, y: rows === 2 ? (row ? 412 : 242) : 330 };
}

/** Своя рука: веер; на телефоне при многих картах — в два ряда. */
function handPos(g: Geo, n: number, k: number) {
  if (!g.port) {
    const step = Math.min(80, 780 / Math.max(1, n - 1));
    const t = n > 1 ? k / (n - 1) - 0.5 : 0;
    return { x: g.hand.x + (k - (n - 1) / 2) * step, y: g.hand.y + t * t * 40 * (n > 8 ? 1.4 : 1), r: t * Math.min(26, n * 2.6), s: g.ds };
  }
  return portraitHand(n, k, g.hand.x, g.hand.y, 410, g.ds, false);
}

interface Item extends StageItem {
  role?: 'hand' | 'att' | 'def' | 'ptop' | 'stock';
  i?: number;
}

class DurakView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private plates!: HTMLElement;
  private zone!: HTMLElement;
  private banner!: HTMLElement;
  private cover!: HTMLElement;
  private btns!: HTMLElement;
  private info!: HTMLElement;
  private m: View | null = null;
  /** Чьи карты внизу экрана (за этим экраном). */
  private viewer = 0;
  /** Хот-сит: карты скрыты, пока игрок не нажмёт «показать». */
  private hidden = false;
  private actSeat: number | null = null;
  private selected: Card[] = [];
  private onKey = (e: KeyboardEvent) => {
    if (this.actSeat == null) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'Escape') this.select(null);
  };

  private get g(): Geo {
    return this.cs.portrait ? PORT : LAND;
  }

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(settings.deck);
    this.cs = new CardStage(root, 1000, 720, 'dk-wrap', '<div class="dk-cloth"></div>', { portrait: { W: 540, H: 900 } });
    this.cs.over.innerHTML = '<div class="dk-plates"></div><div class="dk-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.dk-plates') as HTMLElement;
    this.banner = this.cs.over.querySelector('.dk-banner') as HTMLElement;
    this.zone = h('<div class="dk-zone" hidden><span>Сюда</span></div>');
    this.cover = h('<div class="dk-cover" hidden><div class="dk-cover-box"><div class="dk-cover-t"></div><button class="btn primary">Показать карты</button></div></div>');
    this.cs.stage.append(this.zone, this.cover);
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.refreshTurn();
    };
    const ctl = h(`<div class="dk-controls"><div class="dk-info"></div><div class="dk-btns"></div>
      ${ctx.demo ? '' : `<div class="hint small-hint">Нажмите карту, потом — куда её положить (подсвечено). Отменить выбор — ${touchScreen() ? 'нажмите на пустое место стола' : 'Esc или щелчок по пустому месту стола'}.</div>`}</div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.dk-btns') as HTMLElement;
    this.info = ctl.querySelector('.dk-info') as HTMLElement;

    this.cs.stage.addEventListener('click', (e) => this.onClick(e));
    this.zone.addEventListener('click', (e) => {
      e.stopPropagation();
      this.playToZone();
    });
    this.cs.onMode = () => this.draw();
    if (!ctx.demo) document.addEventListener('keydown', this.onKey);
  }

  // ---------------------------------------------------------------- кто где сидит

  /** Места по кругу, начиная со зрителя. */
  private order(v: View): number[] {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]);
  }

  private anchorOf(v: View, seat: number): Anchor {
    const g = this.g;
    if (seat === this.viewer) return g.hand;
    const others = this.order(v).slice(1);
    return arc(g, others.length)[others.indexOf(seat)] ?? { x: g.W / 2, y: 90 };
  }

  private chooseViewer(v: View, toAct: number[]) {
    const mine = this.ctx.mySeats.filter((x) => v.seats.includes(x));
    if (!mine.length) {
      this.viewer = v.seats.includes(this.viewer) ? this.viewer : v.seats[0];
      return;
    }
    if (mine.length === 1) {
      this.viewer = mine[0];
      return;
    }
    // хот-сит: внизу тот, кто ходит; если ходит бот — оставляем прежнего
    const next = toAct.find((x) => mine.includes(x));
    if (next != null && next !== this.viewer) {
      this.viewer = next;
      this.hidden = true;
    } else if (!mine.includes(this.viewer)) this.viewer = mine[0];
  }

  /** Видно ли лицо карт игрока seat на этом экране. */
  private faceUp(v: View, seat: number) {
    if (this.ctx.demo) return v.hands[seat].length > 0 || v.counts[seat] === 0;
    return seat === this.viewer && !this.hidden && this.ctx.mySeats.includes(seat);
  }

  // ---------------------------------------------------------------- раскладка

  private layout(v: View): Item[] {
    const g = this.g;
    const items: Item[] = [];
    if (v.cfg.polish) this.layoutPolish(v, items);
    // колода и козырь
    const dl = v.cfg.polish ? 0 : deckLeft(v);
    const D = g.deck;
    const ds = g.ds;
    // потайной: закрытая карта под козырем
    if (v.hasHidden && v.trumpCard) items.push({ key: 'hidden', card: null, x: D.x + 44 * ds, y: D.y + 36 * ds, r: 78, s: ds, z: 0, cls: 'dk-hidden' });
    if (v.trumpCard && dl > 0) items.push({ key: cardKey(v.trumpCard), card: v.trumpCard, x: D.x + 34 * ds, y: D.y, r: 90, s: ds, z: 1 });
    if (dl > (v.trumpCard ? 1 : 0)) items.push({ key: 'deck', card: null, x: D.x, y: D.y - Math.min(8, dl / 4), r: 0, s: ds, z: 2, cls: 'dk-deck' });
    // бито
    if (v.bito.length) items.push({ key: 'bito', card: null, x: g.bito.x, y: g.bito.y, r: 12, s: ds, z: 1, cls: 'dk-bito' });
    // стол
    const n = v.table.length;
    const targets = this.targetsFor(v);
    v.table.forEach((p, i) => {
      const { x, y } = tablePos(g, i, n);
      const cls = targets.has(i) ? 'cs-target' : '';
      const ts = g.ds;
      items.push({ key: cardKey(p.a), card: p.a, x, y, r: -3 + ((i * 7) % 6), s: ts, z: 10 + i * 2, cls, data: { role: 'att', i: String(i) } });
      if (p.d) items.push({ key: cardKey(p.d), card: p.d, x: x + 20, y: y + 26, r: 8 - ((i * 5) % 7), s: ts, z: 11 + i * 2, data: { role: 'def', i: String(i) } });
    });
    // руки
    for (const seat of v.seats) {
      const cnt = v.counts[seat];
      if (!cnt) continue;
      if (seat === this.viewer) {
        const up = this.faceUp(v, seat);
        const hand = up ? sortHand(v.hands[seat], v.trump) : [];
        const N = up ? hand.length : cnt;
        const playable = up ? this.playable(v) : [];
        for (let k = 0; k < N; k++) {
          const p = handPos(g, N, k);
          if (!up) {
            items.push({ key: `b:${seat}:${k}`, card: null, ...p, z: 100 + k });
            continue;
          }
          const c = hand[k];
          const isSel = this.selected.some((x) => sameCard(x, c));
          const can = playable.some((x) => sameCard(x, c));
          const cls = this.actSeat != null ? (isSel ? 'cs-sel' : can ? 'cs-can' : 'cs-dim') : '';
          items.push({ key: cardKey(c), card: c, ...p, y: p.y - (isSel ? 34 : 0), z: 100 + k, cls, data: { role: 'hand', k: cardKey(c) } });
        }
        continue;
      }
      const a = this.anchorOf(v, seat);
      const up = this.faceUp(v, seat);
      const list = up ? sortHand(v.hands[seat], v.trump) : [];
      const N = up ? list.length : cnt;
      const s = g.port ? 0.5 : 0.66;
      const step = Math.min(up ? 26 : 14, (g.port ? 90 : 150) / Math.max(1, N - 1));
      for (let k = 0; k < N; k++) {
        const t = N > 1 ? k / (N - 1) - 0.5 : 0;
        const x = a.x + (k - (N - 1) / 2) * step;
        const y = a.y + Math.abs(t) * 8;
        const r = t * Math.min(30, N * 4);
        items.push(up ? { key: cardKey(list[k]), card: list[k], x, y, r, s, z: 50 + k } : { key: `b:${seat}:${k}`, card: null, x, y, r, s, z: 50 + k });
      }
    }
    // длинный дурак: шестёрка (личный козырь) и выложенные карты — веером рядом с игроком
    if (longOn(v)) {
      for (const seat of v.seats) {
        const list = v.laid[seat] || [];
        const me = seat === this.viewer;
        const a = this.anchorOf(v, seat);
        const right = !me && a.x > g.W * 0.64;
        list.forEach((c, i) => {
          const x = g.port ? (me ? 34 + i * 17 : a.x - 30 + i * 13) : me ? 150 + i * 17 : right ? a.x - 112 - i * 15 : a.x + 112 + i * 15;
          const y = g.port ? (me ? g.hand.y - 150 : a.y + 100) : me ? g.hand.y + 20 : a.y + 6;
          items.push({ key: cardKey(c), card: c, x, y, r: me ? -4 : 0, s: g.port ? (me ? 0.42 : 0.34) : me ? 0.46 : 0.4, z: 30 + i, cls: 'dk-laid' });
        });
      }
    }
    return items;
  }

  /** Польский: стопка в центре (внизу — козырь поперёк) и колода кольцом вокруг. */
  private layoutPolish(v: View, items: Item[]) {
    const g = this.g;
    const n = v.deckCount;
    for (let i = 0; i < n; i++) {
      const p = stockPos(g, i, n);
      items.push({ key: 's:' + i, card: null, x: p.x, y: p.y, r: p.r, s: 0.42, z: 5, cls: this.stockLive(v) ? 'cs-can' : '', data: { role: 'stock' } });
    }
    const c = v.center;
    const from = Math.max(0, c.length - 7);
    for (let i = 0; i < c.length; i++) {
      const top = i === c.length - 1;
      const base = i === 0;
      const old = i < from;
      const k = i - from;
      const target = top && this.polishTarget(v);
      items.push({
        key: cardKey(c[i]),
        card: c[i],
        // старые карты стопки лежат ровно под верхними семью (чтобы не исчезали из-под низа)
        x: g.pc.x + (base || old ? 0 : (k % 3) * 9 - 9),
        y: g.pc.y + (base || old ? 0 : (k % 2) * 6 - 3),
        r: base ? 90 : old ? 0 : ((i * 37) % 30) - 15,
        s: 0.82,
        z: old ? 19 : 20 + k,
        cls: target ? 'cs-target' : '',
        data: top ? { role: 'ptop' } : undefined,
      });
    }
  }

  /** Можно ли сейчас тянуть из колоды (польский). */
  private stockLive(v: View) {
    return this.actSeat != null && v.cfg.polish && v.deckCount > 0 && (v.phase === 'pbeat' || v.phase === 'plead');
  }

  /** Подсветить верхнюю карту центра: выбранная карта её бьёт. */
  private polishTarget(v: View) {
    if (this.actSeat == null || v.phase !== 'pbeat' || this.selected.length !== 1) return false;
    return polishBeaters(v, this.actSeat).some((x) => sameCard(x, this.selected[0]));
  }

  /** Разложить карты по местам. Новые влетают из enter, исчезнувшие улетают в exit. */
  private draw(enter: Anchor | null = null, exit: Anchor | null = null) {
    const v = this.m;
    if (!v) return;
    this.cs.render(this.layout(v), this.ctx.speed(), enter, exit);
    this.drawPlates(v);
    this.drawZone(v);
  }

  private drawPlates(v: View) {
    const g = this.g;
    let s = '';
    const dl = deckLeft(v);
    if (v.cfg.polish) {
      if (v.deckCount) s += `<div class="dk-count" style="left:${g.pc.x - 40}px;top:${g.pc.y + 82}px">в колоде ${v.deckCount}</div>`;
    } else if (dl > 0) s += `<div class="dk-count" style="left:${g.deck.x - 40}px;top:${g.deck.y + 92 * g.ds}px">${dl}</div>`;
    if (!longOn(v))
      s += `<div class="dk-trump" style="left:${g.trump.x - 60}px;top:${g.trump.y - 30}px" title="Козырь"><span class="${v.trump === 'H' || v.trump === 'D' ? 'red' : ''}">${SUIT_SYM[v.trump]}</span>${dl ? '' : '<small>козырь</small>'}</div>`;
    if (v.bito.length) s += `<div class="dk-count" style="left:${g.bito.x - 40}px;top:${g.bito.y + 104 * g.ds}px">бито ${v.bito.length}</div>`;
    const toAct = v.phase === 'attack' || v.phase === 'pbeat' || v.phase === 'plead' ? v.attacker : v.phase === 'defend' ? v.defender : v.asker;
    const many = v.seats.length > 4;
    for (const seat of v.seats) {
      const a = this.anchorOf(v, seat);
      const me = seat === this.viewer;
      const role = v.out.includes(seat)
        ? `вышел${v.out.indexOf(seat) === 0 ? ' первым' : ''}`
        : v.phase === 'over' || v.phase === 'trump'
          ? ''
          : v.cfg.polish
            ? seat === v.attacker
              ? v.phase === 'pbeat'
                ? 'кроет'
                : 'ходит'
              : ''
          : seat === v.attacker
            ? 'ходит'
            : seat === v.defender
              ? v.phase === 'take'
                ? 'берёт'
                : 'отбивается'
              : '';
      const title = v.cfg.ranks && v.ranking.length === v.seats.length ? titleOf(v.ranking.indexOf(seat), v.seats.length) : '';
      const pt = longOn(v) && v.ptrump[seat] ? v.ptrump[seat]! : null;
      const ptChip = pt ? `<span class="dk-pt${pt === 'H' || pt === 'D' ? ' red' : ''}" title="Личный козырь">${SUIT_SYM[pt]}</span>` : '';
      const pog = v.pogony[seat] ? `<span class="dk-pog" title="Погоны">${'★'.repeat(Math.min(4, v.pogony[seat]))}</span>` : '';
      const team = v.team[seat] >= 0 ? `<span class="dk-team t${v.team[seat]}" title="Команда">${v.team[seat] ? 'Б' : 'А'}</span>` : '';
      const fool = v.cfg.games > 1 && v.fools[seat] ? `<span class="dk-fools" title="Сколько раз был дураком">🃏${v.fools[seat]}</span>` : '';
      // своя табличка — над верхним краем веера
      const y = me ? (g.port ? g.hand.y - (v.counts[seat] > 9 ? 150 : 100) : g.hand.y - 124) : a.y + (g.port ? 44 : 58);
      // у края узкой сцены табличка не вылезает за стол
      const x = me ? g.hand.x : g.port ? Math.max(78, Math.min(g.W - 78, a.x)) : a.x;
      const look = SEATS[seat];
      // в узкой раскладке при многих игроках таблички соперников мельче
      const sm = g.port && many && !me;
      s += `<div class="dk-plate${toAct === seat && v.phase !== 'over' ? ' on' : ''}${me ? ' me' : ''}${sm ? ' sm' : ''}" style="left:${x}px;top:${y}px;--c:${look.color}">
        ${team}${ptChip}${title ? `<i class="dk-title">${esc(title)}</i><small>${this.ctx.name(seat)}</small>` : `<b>${this.ctx.name(seat)}</b>`}${role ? `<em>${role}</em>` : ''}${pog}${fool}</div>`;
    }
    this.plates.innerHTML = s;
  }

  private drawZone(v: View) {
    const g = this.g;
    const show = this.actSeat != null && this.selected.length > 0 && this.zoneAction(v) != null;
    this.zone.hidden = !show;
    if (!show) return;
    const act = this.zoneAction(v)!;
    const n = v.table.length;
    const tr = act.type === 'transfer';
    const label = act.type === 'attack' || act.type === 'plead' ? 'Ходить' : act.type === 'throw' ? 'Подкинуть' : 'Перевести';
    (this.zone.firstElementChild as HTMLElement).textContent = label;
    let x = g.port ? 270 : 500;
    let y = g.port ? 408 : 330;
    if (v.cfg.polish) x = g.port ? g.pc.x + 150 : 640;
    else if (g.port) {
      // следующее место в сетке по три
      if (n < 6) ({ x, y } = tablePos(g, n, n + 1));
    } else if (n) {
      // справа от последней карты
      const rows = n > 3 ? 2 : 1;
      const perRow = rows === 2 ? Math.ceil(n / 2) : n;
      const inRow = rows === 2 ? n - perRow : perRow;
      x = 500 + (inRow - (inRow - 1) / 2) * 140 - 10;
      y = rows === 2 ? 412 : 330;
      if (x > 800) {
        x = 500;
        y = 330;
      }
    }
    this.zone.style.left = x - 55 + 'px';
    this.zone.style.top = y - 75 + 'px';
    this.zone.classList.toggle('tr', tr);
  }

  // ---------------------------------------------------------------- выбор хода

  /** Что можно сделать выбранными картами, положив их в зону стола. */
  private zoneAction(v: View): Action | null {
    const sel = this.selected;
    if (!sel.length || this.actSeat == null) return null;
    if (v.phase === 'plead' && v.attacker === this.actSeat) return { type: 'plead', card: sel[0] };
    if (v.phase === 'attack' && v.attacker === this.actSeat) return { type: 'attack', cards: sel };
    if ((v.phase === 'throw' || v.phase === 'take') && v.asker === this.actSeat) return { type: 'throw', cards: sel };
    if (v.phase === 'defend' && v.defender === this.actSeat && sel.length === 1 && canTransfer(v, sel[0], false)) return { type: 'transfer', card: sel[0] };
    return null;
  }

  /** Непокрытые карты на столе, которые бьёт выбранная. */
  private targetsFor(v: View): Set<number> {
    const out = new Set<number>();
    if (this.actSeat == null || v.phase !== 'defend' || v.defender !== this.actSeat || this.selected.length !== 1) return out;
    const c = this.selected[0];
    v.table.forEach((p, i) => {
      if (!p.d && beats(v, p.a, c)) out.add(i);
    });
    return out;
  }

  /** Какими картами вообще можно сейчас сыграть. */
  private playable(v: View): Card[] {
    const seat = this.actSeat;
    if (seat == null) return [];
    const hand = v.hands[seat] || [];
    if (v.phase === 'attack' || v.phase === 'plead') return hand;
    if (v.phase === 'pbeat') return polishBeaters(v, seat);
    if (v.phase === 'throw' || v.phase === 'take') return throwable(v, seat);
    if (v.phase === 'defend') return hand.filter((c) => v.table.some((p) => !p.d && beats(v, p.a, c)) || canTransfer(v, c, false));
    return [];
  }

  private onClick(e: MouseEvent) {
    const el = (e.target as Element).closest('.cs-card') as HTMLElement | null;
    const v = this.m;
    if (!v || this.actSeat == null || this.hidden) return;
    if (!el) return this.select(null);
    const role = el.dataset.role;
    const key = el.dataset.k || '';
    if (role === 'hand') {
      const c = (v.hands[this.actSeat] || []).find((x) => cardKey(x) === key);
      if (c) this.select(c);
      return;
    }
    if (role === 'stock') {
      if (!this.stockLive(v)) return;
      return this.send(v.phase === 'pbeat' ? { type: 'pflip' } : { type: 'pflipLead' });
    }
    if (role === 'ptop' && el.classList.contains('cs-target')) {
      const c = this.selected[0];
      if (c) this.send({ type: 'pbeat', card: c });
      return;
    }
    if (role === 'att' && el.classList.contains('cs-target')) {
      const i = +(el.dataset.i ?? -1);
      const c = this.selected[0];
      if (c) this.send({ type: 'beat', i, card: c });
      return;
    }
    if (role === 'att' || role === 'def') {
      // нажали на стол — как на зону, если она есть
      if (this.zoneAction(v)) this.playToZone();
      return;
    }
  }

  private select(c: Card | null) {
    const v = this.m;
    if (!v || this.actSeat == null) return;
    if (!c) this.selected = [];
    else if (!this.playable(v).some((x) => sameCard(x, c))) return;
    else if (this.selected.some((x) => sameCard(x, c))) this.selected = this.selected.filter((x) => !sameCard(x, c));
    else {
      const multi = (v.phase === 'attack' && v.cfg.multiLead) || v.phase === 'throw' || v.phase === 'take';
      if (multi && this.selected.length && (v.phase !== 'attack' || this.selected[0].r === c.r)) {
        const lim = room(v);
        this.selected = [...this.selected, c].slice(-Math.max(1, lim));
      } else this.selected = [c];
    }
    Sound.ui();
    this.draw();
    this.renderButtons();
  }

  private playToZone() {
    const v = this.m;
    if (!v) return;
    const a = this.zoneAction(v);
    if (a) this.send(a);
  }

  private send(a: Action) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.clearTurn();
    this.ctx.act(seat, a);
  }

  private clearTurn() {
    this.actSeat = null;
    this.selected = [];
    this.btns.innerHTML = '';
    if (this.m) this.draw();
  }

  private button(text: string, primary: boolean, on: () => void, cls = '') {
    const b = h<HTMLButtonElement>(`<button class="btn ${primary ? 'primary pulse' : ''} ${cls}">${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      on();
    };
    this.btns.appendChild(b);
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const v = this.m;
    const seat = this.actSeat;
    if (!v || seat == null || this.hidden) return;
    const za = this.zoneAction(v);
    if (v.phase === 'trump') {
      const row = h(`<div class="dk-suits"></div>`);
      for (const s of SUITS) {
        const b = h<HTMLButtonElement>(`<button class="btn dk-suit${s === 'H' || s === 'D' ? ' red' : ''}" title="${SUIT_NAME[s]}">${SUIT_SYM[s]}</button>`);
        b.onclick = () => this.send({ type: 'trump', suit: s });
        row.appendChild(b);
      }
      this.btns.appendChild(h(`<div class="dk-ask">Король, назначайте козырь:</div>`));
      this.btns.appendChild(row);
      return;
    }
    if (za && (za.type === 'attack' || za.type === 'throw')) this.button(`${za.type === 'attack' ? 'Ходить' : 'Подкинуть'} (${this.selected.length})`, true, () => this.send(za));
    if (v.phase === 'defend') {
      if (za?.type === 'transfer') this.button('Перевести', true, () => this.send(za));
      if (transferTarget(v) != null) {
        const r = v.table[0].a.r;
        for (const c of (v.hands[seat] || []).filter((x) => x.r === r && x.s === v.trump))
          if (canTransfer(v, c, true)) this.button(`Показать ${this.cardTxt(c)} — перевести`, false, () => this.send({ type: 'show', card: c }));
      }
      this.button('Беру', false, () => this.send({ type: 'take' }), 'dk-take');
    }
    if (v.phase === 'plead') {
      if (za) this.button('Ходить', true, () => this.send(za));
      if (v.deckCount) this.button('Ходить вслепую из колоды', !za && !(v.hands[seat] || []).length, () => this.send({ type: 'pflipLead' }));
    }
    if (v.phase === 'pbeat') {
      const sel = this.selected[0];
      if (sel && polishBeaters(v, seat).some((x) => sameCard(x, sel))) this.button('Покрыть', true, () => this.send({ type: 'pbeat', card: sel }));
      if (v.deckCount) this.button('Тянуть из колоды', !polishBeaters(v, seat).length, () => this.send({ type: 'pflip' }));
      else if (!polishBeaters(v, seat).length) this.button('Крыть нечем — забрать три', true, () => this.send({ type: 'ptake' }));
    }
    if (v.phase === 'throw') this.button(v.attacker === seat ? 'Бито' : 'Пас', !za, () => this.send({ type: 'pass' }));
    if (v.phase === 'take') this.button('Хватит — пусть забирает', !za, () => this.send({ type: 'pass' }));
  }

  private cardTxt(c: Card) {
    const r = c.r > 10 ? 'ВДКТ'[c.r - 11] : String(c.r);
    return `<b class="${c.s === 'H' || c.s === 'D' ? 'red' : ''}">${r}${SUIT_SYM[c.s]}</b>`;
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    this.m = v;
    this.chooseViewer(v, this.toActOf(v));
    this.cs.clear();
    this.banner.hidden = true;
    this.draw();
    this.renderInfo(v);
  }

  private toActOf(v: View): number[] {
    if (v.phase === 'attack') return [v.attacker];
    if (v.phase === 'defend') return [v.defender];
    if (v.phase === 'throw' || v.phase === 'take' || v.phase === 'trump') return v.asker >= 0 ? [v.asker] : [];
    if (v.phase === 'pbeat' || v.phase === 'plead') return [v.attacker];
    return [];
  }

  private renderInfo(v: View) {
    const parts: string[] = [];
    if (v.cfg.games > 1) parts.push(`Партия <b>${v.game}</b> из ${v.cfg.games}`);
    if (longOn(v)) {
      const mine = trumpOf(v, this.viewer);
      parts.push(`Ваш козырь: <b class="${mine === 'H' || mine === 'D' ? 'red' : ''}">${SUIT_SYM[mine]} ${SUIT_NAME[mine]}</b>`);
      parts.push(`<small>у каждого свой козырь — масть его шестёрки</small>`);
    } else parts.push(`Козырь: <b class="${v.trump === 'H' || v.trump === 'D' ? 'red' : ''}">${SUIT_SYM[v.trump]} ${SUIT_NAME[v.trump]}</b>`);
    const variant = [v.cfg.polish ? 'польский' : '', v.cfg.hidden && !v.cfg.polish ? 'потайной козырь' : '', longOn(v) ? 'длинный' : '', v.cfg.ranks ? 'Король-говно' : '', v.team.some((t) => t >= 0) ? (v.seats.length === 6 ? '3 на 3' : '2 на 2') : '', v.cfg.polish ? '' : v.cfg.transfer ? 'переводной' : v.cfg.throwers === 'none' ? 'простой' : 'подкидной', v.cfg.spades ? 'пики пиками' : '', v.cfg.pogony ? 'с погонами' : ''].filter(Boolean).join(', ');
    parts.push(`<small>${variant}</small>`);
    this.info.innerHTML = parts.map((p) => `<div>${p}</div>`).join('');
  }

  /** Применить событие к модели на экране (чтобы показать промежуточные шаги до финального view). */
  private step(m: View, ev: Event): { enter: Anchor | null; exit: Anchor | null } {
    const takeFrom = (seat: number, list: Card[]) => {
      if (m.hands[seat].length) m.hands[seat] = m.hands[seat].filter((x) => !list.some((c) => sameCard(c, x)));
      m.counts[seat] = Math.max(0, m.counts[seat] - list.length);
    };
    switch (ev.type) {
      case 'attack':
      case 'throw':
        takeFrom(ev.seat, ev.cards);
        for (const c of ev.cards) m.table.push({ a: c, d: null });
        return { enter: this.anchorOf(m, ev.seat), exit: null };
      case 'beat':
        takeFrom(ev.seat, [ev.card]);
        if (m.table[ev.i]) m.table[ev.i] = { ...m.table[ev.i], d: ev.card };
        return { enter: this.anchorOf(m, ev.seat), exit: null };
      case 'transfer':
        if (ev.card) {
          takeFrom(ev.seat, [ev.card]);
          m.table.push({ a: ev.card, d: null });
        }
        m.attacker = ev.seat;
        m.defender = ev.to;
        return { enter: this.anchorOf(m, ev.seat), exit: null };
      case 'bito':
        m.bito = [...m.bito, ...m.table.flatMap((p) => (p.d ? [p.a, p.d] : [p.a]))];
        m.table = [];
        return { enter: null, exit: this.g.bito };
      case 'pickup': {
        const seat = ev.seat;
        if (this.faceUp(m, seat) || m.hands[seat].length) m.hands[seat] = [...m.hands[seat], ...ev.cards];
        m.counts[seat] += ev.cards.length;
        m.table = [];
        return { enter: null, exit: this.anchorOf(m, seat) };
      }
      case 'draw': {
        const seat = ev.seat;
        m.counts[seat] += ev.count;
        if (ev.cards && (this.faceUp(m, seat) || m.hands[seat].length)) m.hands[seat] = [...m.hands[seat], ...ev.cards];
        m.deckCount = Math.max(0, m.deckCount - ev.count);
        if (!m.deckCount) m.trumpCard = null;
        return { enter: this.g.deck, exit: null };
      }
      case 'out':
        m.out = [...m.out, ev.seat];
        return { enter: null, exit: null };
      case 'retrump':
        m.trump = ev.card.s;
        m.trumpCard = ev.card;
        m.deckCount = 1;
        m.hasHidden = false;
        return { enter: null, exit: null };
      case 'pbeat':
        takeFrom(ev.seat, [ev.card]);
        m.center = [...m.center, ev.card];
        return { enter: this.anchorOf(m, ev.seat), exit: null };
      case 'plead':
        if (ev.blind) m.deckCount = Math.max(0, m.deckCount - 1);
        else takeFrom(ev.seat, [ev.card]);
        m.center = [...m.center, ev.card];
        return { enter: ev.blind ? stockPos(this.g, m.deckCount, m.deckCount + 1) : this.anchorOf(m, ev.seat), exit: null };
      case 'pflip': {
        m.deckCount = Math.max(0, m.deckCount - 1);
        const from = stockPos(this.g, m.deckCount, m.deckCount + 1);
        if (ev.beat) {
          m.center = [...m.center, ev.card];
          return { enter: from, exit: null };
        }
        m.center = m.center.filter((x) => !ev.taken.some((t) => sameCard(t, x)));
        if (this.faceUp(m, ev.seat) || m.hands[ev.seat].length) m.hands[ev.seat] = [...m.hands[ev.seat], ...ev.taken];
        m.counts[ev.seat] += ev.taken.length;
        return { enter: from, exit: this.anchorOf(m, ev.seat) };
      }
      case 'ptake':
        m.center = m.center.filter((x) => !ev.cards.some((t) => sameCard(t, x)));
        if (this.faceUp(m, ev.seat) || m.hands[ev.seat].length) m.hands[ev.seat] = [...m.hands[ev.seat], ...ev.cards];
        m.counts[ev.seat] += ev.cards.length;
        return { enter: null, exit: this.anchorOf(m, ev.seat) };
      case 'laid':
        m.laid = m.laid.map((x, i) => (i === ev.seat ? [...x, ev.card] : x));
        m.level = m.level.map((x, i) => (i === ev.seat ? ev.card.r : x));
        return { enter: this.g.deck, exit: null };
      default:
        return { enter: null, exit: null };
    }
  }

  async play(events: Event[], v: View) {
    const speed = this.ctx.speed();
    const dur = 380 / speed;
    this.clearTurn();
    const m: View = this.m ? structuredClone(this.m) : structuredClone(v);
    for (const ev of events) {
      switch (ev.type) {
        case 'deal': {
          this.banner.hidden = true;
          Sound.shuffle();
          this.m = v;
          this.chooseViewer(v, this.toActOf(v));
          this.draw(this.g.deck, this.g.deck);
          this.renderInfo(v);
          await sleep(dur + 700 / speed);
          if (ev.chooser != null) await this.showBanner(`${SEATS[ev.chooser] ? this.plain(ev.chooser) : ''} выбирает козырь`, 900 / speed);
          else await this.showBanner(`Козырь — ${SUIT_SYM[ev.trump]} ${SUIT_NAME[ev.trump]}`, 900 / speed);
          Object.assign(m, structuredClone(v));
          continue;
        }
        case 'trump':
          Sound.ui();
          m.trump = ev.suit;
          this.m = m;
          this.renderInfo(m);
          await this.showBanner(`Козырь — ${SUIT_SYM[ev.suit]} ${SUIT_NAME[ev.suit]}`, 1000 / speed);
          continue;
        case 'take':
          Sound.nomove();
          await this.showBanner(`${this.plain(ev.seat)}: беру!`, 650 / speed);
          continue;
        case 'pass':
          await sleep(120 / speed);
          continue;
        case 'gameEnd': {
          Sound.win();
          const who = ev.fool == null && ev.ranking.length === 1 ? `${this.plain(ev.ranking[0])} — без карт, победа!` : ev.losers.length > 1 ? `Дураки — ${ev.losers.map((x) => this.plain(x)).join(' и ')}!` : `${this.plain(ev.fool!)} — дурак!`;
          const t = ev.draw ? 'Ничья!' : `${who}${ev.pogony ? (ev.pogony === 2 ? ' С погонами!' : ' С погоном!') : ''}`;
          await this.showBanner(t, ev.last ? 0 : 2200 / speed, ev.last);
          continue;
        }
        default:
          break;
      }
      const { enter, exit } = this.step(m, ev);
      this.m = m;
      if (ev.type === 'bito' || ev.type === 'pickup') Sound.shuffle();
      else if (ev.type !== 'out') Sound.card();
      this.draw(enter, exit);
      await sleep(dur + (ev.type === 'draw' ? Math.min(ev.count, 8) * 45 : 0) + 60);
      if (ev.type === 'out') await this.showBanner(`${this.plain(ev.seat)} вышел`, 700 / speed);
      if (ev.type === 'retrump') {
        this.renderInfo(m);
        await this.showBanner(`Потайная карта ${this.cardPlain(ev.card)} — новый козырь ${SUIT_SYM[ev.card.s]}!`, 1500 / speed);
      }
      if (ev.type === 'pflip' && !ev.beat) await this.showBanner(`${this.plain(ev.seat)}: не кроет — забирает`, 700 / speed);
      if (ev.type === 'ptake') await this.showBanner(`${this.plain(ev.seat)} забирает три`, 800 / speed);
      if (ev.type === 'laid') await this.showBanner(`${this.plain(ev.seat)} выкладывает ${this.cardPlain(ev.card)}${ev.card.r === 14 ? ' — длинный дурак!' : ''}`, 1300 / speed);
      if (ev.type === 'transfer') {
        const how = ev.shown ? `показывает ${this.cardPlain(ev.shown)} — ` : '';
        await this.showBanner(`${this.plain(ev.seat)}: ${how}перевод на ${this.plain(ev.to)}`, 900 / speed);
      }
    }
    this.m = v;
    this.draw();
    this.renderInfo(v);
  }

  private cardPlain(c: Card) {
    return `${c.r > 10 ? 'ВДКТ'[c.r - 11] : c.r}${SUIT_SYM[c.s]}`;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  private async showBanner(text: string, ms: number, stay = false) {
    this.banner.textContent = text;
    this.banner.hidden = false;
    if (stay) return;
    await sleep(ms);
    this.banner.hidden = true;
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.clearTurn();
    const v = this.m;
    if (!v || v.phase === 'over' || this.ctx.demo) return;
    const prev = this.viewer;
    this.chooseViewer(v, toAct);
    const seat = interactive.find((x) => x === this.viewer) ?? null;
    if (this.hidden && interactive.length && this.ctx.mySeats.length > 1) {
      (this.cover.querySelector('.dk-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(this.viewer)}.<br><small>Передайте устройство — остальным не подглядывать!</small>`;
      this.cover.hidden = false;
    } else {
      this.hidden = false;
      this.cover.hidden = true;
    }
    this.actSeat = seat;
    if (prev !== this.viewer) {
      this.cs.clear();
    }
    this.draw();
    this.renderButtons();
  }

  private refreshTurn() {
    this.renderButtons();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    const name = (p: number) => this.ctx.name(p);
    if (v.phase === 'over') {
      if (v.cfg.games > 1) return 'Серия окончена';
      if (v.losers.length > 1) return `Дураки — ${v.losers.map(name).join(' и ')}`;
      if (v.cfg.polish && v.winner != null) return `Победа: ${name(v.winner)} — первым без карт`;
      return v.draw ? 'Ничья!' : v.fool != null ? `Дурак — ${name(v.fool)}` : 'Партия окончена';
    }
    const who = toAct[0];
    if (who == null) return '';
    const mine = interactive.includes(who);
    switch (v.phase) {
      case 'pbeat': {
        const top = v.center[v.center.length - 1];
        const t = top ? this.cardPlain(top) : '';
        return mine ? `Кройте ${t}: с руки${v.deckCount ? ' или тяните из колоды' : ' — или забирайте три'}` : `${name(who)} кроет ${t}…`;
      }
      case 'plead':
        return mine ? `Ходите под ${name(v.defender)}: картой с руки${v.deckCount ? ' или вслепую из колоды' : ''}` : `${name(who)} ходит…`;
      case 'trump':
        return mine ? 'Назначьте козырь' : `${name(who)} выбирает козырь…`;
      case 'attack':
        return mine ? `Ваш ход под ${name(v.defender)}` : `${name(who)} ходит под ${name(v.defender)}…`;
      case 'defend': {
        const n = unbeaten(v.table);
        return mine ? `Отбивайтесь${longOn(v) ? ` (ваш козырь ${SUIT_SYM[trumpOf(v, who)]})` : ''}: ${n} ${n === 1 ? 'карта' : n < 5 ? 'карты' : 'карт'}${v.cfg.transfer && transferTarget(v) != null ? ' — или переводите' : ''}` : `${name(who)} отбивается…`;
      }
      case 'throw':
        return mine ? `Подкинете ${name(v.defender)}? Можно ещё ${room(v)}` : `${name(who)} думает, подкинуть ли…`;
      case 'take':
        return mine ? `${name(v.defender)} берёт — подкинете вдогонку?` : `${name(v.defender)} берёт…`;
    }
    return '';
  }

  playerStats(v: View, seat: number) {
    const out = v.out.includes(seat);
    const cnt = out ? '✓' : `🂠 ${v.counts[seat]}`;
    const f = v.cfg.games > 1 ? `<span title="Сколько раз был дураком">🃏 ${v.fools[seat]}</span>` : '';
    return `<span title="Карт на руках">${cnt}</span>${f}`;
  }

  destroy() {
    this.cs.destroy();
    document.removeEventListener('keydown', this.onKey);
  }
}

export function createView(): GameView<View, Event> {
  return new DurakView();
}

export { has };
export type { Suit };
