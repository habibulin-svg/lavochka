/* Г*вно — отрисовка: свои четыре карты внизу (касание — какую отдать), соседи по дуге рубашками, по центру — кольцо такта
 * и ладони хлопнувших. Хлоп — большая кнопка или пробел; 1–4 — выбрать карту. Ввод уходит в комнату раз в 120 мс и при изменении. */
import { audioOut, click, Sound, tone } from '../../core/audio';
import { esc, h } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { settings } from '../../core/settings';
import { preloadDeck } from '../../cards/render';
import { CardStage, cardKey, fan, type Point, type StageItem } from '../../cards/stage';
import type { Card } from '../../cards/deck';
import { cid, hasFour, type Event, type Input, type View } from './engine';
import { lettersOf, SEATS } from './def';
import './govno.css';

interface Geo {
  port: boolean;
  W: number;
  hand: Point;
  center: Point;
}
const LAND: Geo = { port: false, W: 1000, hand: { x: 500, y: 560 }, center: { x: 500, y: 300 } };
const PORT: Geo = { port: true, W: 540, hand: { x: 270, y: 770 }, center: { x: 270, y: 430 } };

/** По достоинству — четвёрка собирается рядом. */
const sorted = (hand: Card[]) => hand.slice().sort((a, b) => b.r - a.r || a.s.localeCompare(b.s));
const sec = (ms: number) => (ms / 1000).toFixed(2).replace('.', ',');

function slapSound(big: boolean) {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  click(t, { freq: 420, q: 0.8, dur: big ? 0.12 : 0.07, gain: big ? 1 : 0.6 });
  tone(t, { freq: 110, to: 60, dur: 0.12, gain: big ? 0.5 : 0.25, type: 'triangle' });
}

class GovnoView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cs!: CardStage;
  private plates!: HTMLElement;
  private ring!: HTMLElement;
  private palms!: HTMLElement;
  private banner!: HTMLElement;
  private btn!: HTMLButtonElement;
  private hint!: HTMLElement;
  private v: View | null = null;
  private snapAt = 0;
  private me: number | null = null;
  private inp: Input = { pick: null, tact: 0, slap: 0 };
  private sent = '';
  private sentAt = 0;
  private raf = 0;
  private iv: ReturnType<typeof setInterval> | undefined;
  private bannerT: ReturnType<typeof setTimeout> | undefined;
  private cleanup: (() => void)[] = [];

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    preloadDeck(settings.deck);
    this.cs = new CardStage(root, 1000, 660, 'gv-wrap', '<div class="gv-cloth"></div>', { portrait: { W: 540, H: 900 } });
    this.cs.onMode = () => this.draw();
    this.cs.over.innerHTML = '<div class="gv-plates"></div><div class="gv-ring"><b></b><small></small></div><div class="gv-palms"></div><div class="cs-banner" hidden></div>';
    this.plates = this.cs.over.querySelector('.gv-plates') as HTMLElement;
    this.ring = this.cs.over.querySelector('.gv-ring') as HTMLElement;
    this.palms = this.cs.over.querySelector('.gv-palms') as HTMLElement;
    this.banner = this.cs.over.querySelector('.cs-banner') as HTMLElement;
    this.cs.stage.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-pick]') as HTMLElement | null;
      if (el) this.pick(el.dataset.pick!);
    });
    const ctl = h(`<div class="gv-controls"><button class="btn primary gv-slap">🖐 Хлоп!</button><div class="gv-hint"></div></div>`);
    ctx.controls.appendChild(ctl);
    this.btn = ctl.querySelector('.gv-slap') as HTMLButtonElement;
    this.hint = ctl.querySelector('.gv-hint') as HTMLElement;
    this.btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.slap();
    });
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea') || ctx.demo || this.me == null) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.slap();
      } else if (/^Digit[1-4]$/.test(e.code) && this.v) {
        const hand = this.myHand();
        const c = hand[Number(e.code.slice(5)) - 1];
        if (c) this.pick(cid(c));
      }
    };
    window.addEventListener('keydown', kd);
    this.cleanup.push(() => window.removeEventListener('keydown', kd));
    this.iv = setInterval(() => this.send(), 120);
    const frame = () => {
      this.tickRing();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- ввод

  private myHand(): Card[] {
    const v = this.v;
    if (!v || this.me == null) return [];
    return sorted(v.hands[this.me]);
  }

  private canPlay() {
    const v = this.v;
    return !!v && this.me != null && !this.ctx.demo && (v.phase === 'look' || v.phase === 'pass');
  }

  private pick(id: string) {
    if (!this.canPlay()) return;
    Sound.unlock();
    this.inp.pick = this.inp.pick === id ? null : id;
    this.inp.tact = this.v!.tacts;
    Sound.ui();
    this.draw();
    this.send(true);
  }

  private slap() {
    const v = this.v;
    if (!v || this.me == null || this.ctx.demo) return;
    if (v.phase !== 'look' && v.phase !== 'pass' && v.phase !== 'slap') return;
    if (v.phase === 'slap' && v.slaps.some((x) => x.seat === this.me)) return;
    Sound.unlock();
    this.inp.slap++;
    slapSound(true);
    this.btn.classList.add('hit');
    setTimeout(() => this.btn.classList.remove('hit'), 150);
    this.send(true);
  }

  private send(force = false) {
    if (this.me == null || !this.ctx.input || this.ctx.demo || !this.v || this.v.phase === 'over') return;
    const json = JSON.stringify(this.inp);
    const now = performance.now();
    if (!force && json === this.sent && now - this.sentAt < 300) return;
    this.sent = json;
    this.sentAt = now;
    this.ctx.input(this.me, { ...this.inp });
  }

  // ---------------------------------------------------------------- места

  private get g(): Geo {
    return this.cs.portrait ? PORT : LAND;
  }

  private order(v: View): number[] {
    const i0 = Math.max(0, v.seats.indexOf(this.viewer(v)));
    return v.seats.map((_, k) => v.seats[(i0 + k) % v.seats.length]);
  }

  private viewer(v: View) {
    return this.me ?? v.seats[0];
  }

  /** Я — внизу, сосед слева (кому отдаю) — слева, дальше по кругу через верх. */
  private anchor(v: View, seat: number): Point {
    const k = this.order(v).indexOf(seat);
    const n = v.seats.length;
    const g = this.g;
    if (k === 0) return g.hand;
    const t = (k - 1) / (n - 2 || 1);
    const a = Math.PI * (1 - t);
    if (g.port) return { x: 270 + Math.cos(a) * 205, y: 330 - Math.sin(a) * 230 };
    return { x: 500 + Math.cos(a) * 400, y: 300 - Math.sin(a) * 220 };
  }

  private items(v: View, passed: boolean): StageItem[] {
    const g = this.g;
    const items: StageItem[] = [];
    const vw = this.viewer(v);
    const open = v.phase === 'result' || v.phase === 'over';
    for (const p of v.seats) {
      const a = this.anchor(v, p);
      if (p === vw) {
        const hand = sorted(v.hands[p]);
        const li = v.lastIn[p];
        const n = Math.max(hand.length, v.counts[p]);
        for (let k = 0; k < n; k++) {
          const c = hand[k];
          const f = fan(n, k, a.x, a.y, g.port ? 400 : 520, g.port ? 112 : 128, 10, 8);
          if (!c) {
            items.push({ key: `b:${p}:${k}`, card: null, ...f, s: g.port ? 1.15 : 1.1, z: 100 + k });
            continue;
          }
          const sel = this.inp.pick === cid(c) && this.inp.tact === v.tacts && this.canPlay();
          const can = this.canPlay();
          items.push({ key: cardKey(c), card: c, x: f.x, y: f.y - (sel ? 34 : 0), r: f.r, s: g.port ? 1.15 : 1.1, z: 100 + k, cls: sel ? 'cs-sel' : can ? 'cs-can' : '', data: can ? { pick: cid(c) } : undefined, fromPt: passed && li && li.s === c.s && li.r === c.r ? this.anchor(v, this.prev(v, p)) : undefined });
        }
      } else {
        const list = open || this.ctx.demo ? v.hands[p] : [];
        const n = v.counts[p];
        for (let k = 0; k < n; k++) {
          const f = fan(n, k, a.x, a.y, g.port ? 80 : 110, g.port ? 24 : 30, 6, 10);
          const c = list[k];
          items.push(c ? { key: cardKey(c), card: c, ...f, s: g.port ? 0.5 : 0.52, z: 50 + k } : { key: `b:${p}:${k}`, card: null, ...f, s: g.port ? 0.5 : 0.52, z: 50 + k });
        }
      }
    }
    return items;
  }

  private prev(v: View, seat: number) {
    const i = v.seats.indexOf(seat);
    return v.seats[(i - 1 + v.seats.length) % v.seats.length];
  }

  private next(v: View, seat: number) {
    return v.seats[(v.seats.indexOf(seat) + 1) % v.seats.length];
  }

  private draw(exit: Point | null = null) {
    const v = this.v;
    if (!v) return;
    this.cs.render(this.items(v, !!exit), this.ctx.speed(), null, exit);
    const g = this.g;
    const vw = this.viewer(v);
    let s = '';
    for (const p of v.seats) {
      const a = this.anchor(v, p);
      const me = p === vw;
      const y = me ? a.y - 155 * 1.1 * 0.5 - 50 : a.y + (g.port ? 52 : 56);
      const x = Math.max(g.port ? 80 : 90, Math.min(g.W - (g.port ? 80 : 90), a.x));
      const lost = (v.phase === 'result' || v.phase === 'over') && v.losers.includes(p);
      const let_ = v.letters[p] ? `<i class="gv-let">${esc(lettersOf(v.letters[p]))}</i>` : '';
      s += `<div class="cs-plate${lost ? ' gv-lost' : ''}" style="--c:${SEATS[p].color};left:${x}px;top:${y}px">${esc(this.plain(p))} ${let_}</div>`;
    }
    // стрелка «кому отдаю»
    if (v.seats.length) {
      const to = this.anchor(v, this.next(v, vw));
      const from = g.hand;
      const mx = (to.x + from.x) / 2 - (g.port ? 40 : 60);
      const my = (to.y + from.y) / 2 + (g.port ? 40 : 30);
      s += `<div class="gv-arrow" style="left:${mx}px;top:${my}px">↖ отдаю</div>`;
    }
    this.plates.innerHTML = s;
    this.ring.style.left = `${g.center.x}px`;
    this.ring.style.top = `${g.center.y}px`;
    this.palms.style.left = `${g.center.x}px`;
    this.palms.style.top = `${g.center.y}px`;
    this.drawPalms(v);
    this.drawHint(v);
  }

  private palmsKey = '';

  private drawPalms(v: View) {
    const n = v.slaps.length;
    // перерисовываем только при новом хлопке — иначе анимация хлопка начинается заново на каждом снимке
    const key = `${v.round}:${v.slaps.map((x) => x.seat).join()}:${this.cs.portrait}`;
    if (key === this.palmsKey) return;
    this.palmsKey = key;
    this.palms.innerHTML = v.slaps
      .map((x, i) => {
        const ang = (i - (n - 1) / 2) * 0.5;
        const dx = Math.sin(ang) * 36;
        const dy = -i * 6;
        return `<div class="gv-palm" style="--c:${SEATS[x.seat].color};transform:translate(${dx - 32}px,${dy - 32}px) rotate(${ang * 40}deg);z-index:${i}">🖐<small>${i === 0 ? '1-й' : sec(x.dt)}</small></div>`;
      })
      .join('');
  }

  private drawHint(v: View) {
    if (this.ctx.demo) return;
    let t = '';
    if (this.me == null) t = 'Вы смотрите.';
    else if (v.phase === 'look') t = 'Посмотрите карты. Коснитесь той, что отдадите соседу (или 1–4).';
    else if (v.phase === 'pass') t = hasFour(v.hands[this.me]) ? '<b>Четыре! Хлопайте!</b>' : 'Копите четыре одного достоинства. Коснитесь карты, которую отдать.';
    else if (v.phase === 'slap') t = v.slaps.some((x) => x.seat === this.me) ? 'Хлопнули. Ждём остальных…' : '<b>Хлопайте!</b>';
    else if (v.phase === 'result') t = 'Новый кон через пару секунд.';
    else t = 'Партия окончена.';
    if (this.ctx.mySeats.length > 1) t += '<br><small>За одним экраном играет один — остальных зовите по сети или ставьте ботов.</small>';
    this.hint.innerHTML = t;
    const off = this.me == null || v.phase === 'result' || v.phase === 'over' || (v.phase === 'slap' && v.slaps.some((x) => x.seat === this.me));
    this.btn.disabled = off;
  }

  /** Кольцо такта: сколько до передачи. */
  private tickRing() {
    const v = this.v;
    if (!v) return;
    const t = v.t + (performance.now() - this.snapAt) * (this.ctx.demo ? 0 : 1);
    const b = this.ring.querySelector('b') as HTMLElement;
    const sm = this.ring.querySelector('small') as HTMLElement;
    let frac = 0;
    if (v.phase === 'pass') {
      frac = Math.max(0, Math.min(1, 1 - (v.nextAt - t) / v.cfg.tact));
      b.textContent = '⇄';
      sm.textContent = `такт ${v.tacts + 1}`;
    } else if (v.phase === 'look') {
      frac = 0;
      b.textContent = String(Math.max(1, Math.ceil((v.nextAt - t) / 1000)));
      sm.textContent = 'смотрим';
    } else {
      b.textContent = '';
      sm.textContent = '';
    }
    this.ring.style.setProperty('--f', String(frac));
    this.ring.classList.toggle('off', v.phase !== 'pass' && v.phase !== 'look');
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  private showBanner(text: string, ms: number) {
    clearTimeout(this.bannerT);
    this.banner.textContent = text;
    this.banner.hidden = false;
    if (ms) this.bannerT = setTimeout(() => (this.banner.hidden = true), ms);
  }

  // ---------------------------------------------------------------- снимки

  private adopt(v: View) {
    const mine = this.ctx.mySeats.filter((x) => v.seats.includes(x));
    this.me = this.ctx.demo ? null : mine[0] ?? null;
    if (this.me != null) this.inp.slap = Math.max(this.inp.slap, v.slapN[this.me]);
    if (this.inp.tact !== v.tacts) {
      this.inp.pick = null;
      this.inp.tact = v.tacts;
    }
    this.v = v;
    this.snapAt = performance.now();
  }

  setView(v: View) {
    this.adopt(v);
    if (v.phase !== 'result' && v.phase !== 'over') this.banner.hidden = true;
    this.draw();
  }

  async play(events: Event[], v: View) {
    // показ правил: события идут через play
    this.realtime(v, events);
  }

  realtime(v: View, events: Event[]) {
    this.adopt(v);
    let exit: Point | null = null;
    for (const ev of events) {
      if (ev.k === 'pass') {
        exit = this.anchor(v, this.next(v, this.viewer(v)));
        Sound.card();
      } else if (ev.k === 'slap') {
        const mine = ev.seat === this.me;
        if (!mine && !v.cfg.silent) slapSound(ev.first);
        if (ev.first && !v.cfg.silent && !this.ctx.demo && !(v.phase === 'result' || v.phase === 'over')) this.showBanner(mine ? 'Хлоп!' : `${this.plain(ev.seat)}: «Г*вно!»`, 900);
      } else if (ev.k === 'round') {
        const who = ev.losers.map((p) => (p === this.me ? 'Вы' : this.plain(p))).join(', ');
        this.showBanner(ev.losers.length ? `💩 ${who}${ev.reason === 'foul' ? ' — без четвёрки!' : ' — последний'}` : 'Кон без проигравшего', this.ctx.demo ? 0 : 3200);
        if (ev.losers.includes(this.me ?? -1)) Sound.nomove();
        else Sound.win();
      } else if (ev.k === 'deal') {
        Sound.shuffle();
      } else if (ev.k === 'go') {
        Sound.turn();
      } else if (ev.k === 'end') {
        this.showBanner(`Г*вно партии: ${ev.losers.map((p) => this.plain(p)).join(', ')}`, 0);
      }
    }
    this.draw(exit);
  }

  setTurn() {
    if (this.v) this.drawHint(this.v);
  }

  status(v: View) {
    if (v.phase === 'over') return 'Партия окончена';
    if (v.phase === 'slap') return 'Хлоп! Кто последний?';
    if (v.phase === 'result') return `Кон ${v.round} окончен`;
    return `Кон ${v.round}: передаём по кругу`;
  }

  playerStats(v: View, seat: number) {
    return v.letters[seat] ? `буквы: ${esc(lettersOf(v.letters[seat]))}` : 'чистый';
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.iv);
    clearTimeout(this.bannerT);
    this.cleanup.forEach((f) => f());
    this.cs.destroy();
  }
}

export function createView(): GameView<View, Event> {
  return new GovnoView();
}
