/* «Клад» по сети — экран стола: своё поле — тот же экран, что в одиночной игре (ход виден сразу, с анимацией; комната повторяет его
 * у себя, а если поля разошлись — например, прилетели кирпичи, — экран берёт поле из снимка). Полоска кирпичей, что летят к тебе,
 * поля соперников: в дуэли — рядом, в битве — мини-поля вокруг (нажатие — бить его; выбывшему — смотреть его крупно). */
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import '../../core/vs.css';
import { ART, CHIP, drawBrick, Game, GEM } from './index';
import { N } from './logic';
import { boardString, cloneBoard, type VsBoardView, type VsEvent, type VsIn, type VsMove, type VsView } from './versus';

const BC = 48;
const MC = 11;

/** Поле соперника по строке снимка: сокровища картинками (крупно) или цветными квадратиками (мини). */
function drawBoard(cv: HTMLCanvasElement, v: VsBoardView, c: number, mini: boolean, time = 0) {
  const g = cv.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = v.out ? '#4a443e' : '#d8c48a';
  g.fillRect(0, 0, cv.width, cv.height);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const k = v.g[(y * N + x) * 2];
      const m = v.g[(y * N + x) * 2 + 1];
      const px = x * c;
      const py = y * c;
      if ((x + y) % 2) {
        g.fillStyle = 'rgba(90,60,10,0.08)';
        g.fillRect(px, py, c, c);
      }
      if (m === '#') {
        const im = ART.get('stone');
        if (im && !mini) g.drawImage(im, px + 1, py + 1, c - 2, c - 2);
        else {
          g.fillStyle = '#6a6a6a';
          g.fillRect(px + 1, py + 1, c - 2, c - 2);
        }
        continue;
      }
      if (k === '.') continue;
      if (k === 'b') {
        if (mini) {
          g.fillStyle = '#a03a22';
          g.fillRect(px + 1, py + 1, c - 2, c - 2);
        } else drawBrick(g, px, py, c, Number(m), 1, time);
        continue;
      }
      const kind = Number(k);
      if (mini) {
        g.fillStyle = CHIP[kind] ?? '#888';
        g.beginPath();
        g.arc(px + c / 2, py + c / 2, c * 0.4, 0, Math.PI * 2);
        g.fill();
        if (m !== '-') {
          g.strokeStyle = '#fff';
          g.lineWidth = 1;
          g.stroke();
        }
        continue;
      }
      const im = ART.get(m === 'n' ? 'nugget' : GEM[kind % GEM.length]);
      if (im) g.drawImage(im, px + c * 0.06, py + c * 0.06, c * 0.88, c * 0.88);
      else {
        g.fillStyle = CHIP[kind] ?? '#888';
        g.beginPath();
        g.arc(px + c / 2, py + c / 2, c * 0.38, 0, Math.PI * 2);
        g.fill();
      }
      if (m === 'r' || m === 'c' || m === 'x') {
        const badge = ART.get(m === 'x' ? 'dynamite' : 'shovel');
        if (badge) g.drawImage(badge, px + c * 0.5, py + c * 0.5, c * 0.45, c * 0.45);
      }
    }
  if (v.out) {
    g.strokeStyle = 'rgba(255,80,60,.85)';
    g.lineWidth = c * 0.5;
    g.beginPath();
    g.moveTo(c, c);
    g.lineTo(cv.width - c, cv.height - c);
    g.moveTo(cv.width - c, c);
    g.lineTo(c, cv.height - c);
    g.stroke();
  }
}

export function createView(): GameView<VsView, VsEvent> {
  let ctx: ViewCtx;
  let root: HTMLElement;
  let latest: VsView | null = null;
  let game: Game | null = null;
  const cleanup: (() => void)[] = [];
  let mvN = 0;
  /** Свои ходы, ещё не подтверждённые комнатой. */
  let pending: VsMove[] = [];
  let target = -1;
  let sent = { json: '', at: 0 };
  let bigSeat = -1;
  let watch = -1;
  const minis = new Map<number, { el: HTMLElement; cv: HTMLCanvasElement; key: string }>();
  let els: { inc: HTMLElement; info: HTMLElement; foes: HTMLElement; foesR: HTMLElement; bigBox: HTMLElement; bigName: HTMLElement; bigCv: HTMLCanvasElement; own: HTMLElement; dim: HTMLElement };
  let bigKey = '';

  /** Чьё поле крупно: своё, а у зрителя (и в превью) — первого игрока. */
  const mySeat = () => (!ctx.demo && ctx.mySeats.length ? ctx.mySeats[0] : (latest?.boards[0]?.seat ?? -1));
  const seated = () => !ctx.demo && ctx.mySeats.includes(mySeat());
  const mine = (v: VsView | null) => v?.boards.find((x) => x.seat === mySeat()) ?? null;
  const playing = () => {
    const m = mine(latest);
    return seated() && !!m && !m.out && !latest!.over;
  };

  function send(force = false) {
    if (ctx.demo || !ctx.input || mySeat() < 0 || !playing()) return;
    const inp: VsIn = { mv: pending.slice(-4), target };
    const json = JSON.stringify(inp);
    const now = performance.now();
    if (!force && json === sent.json && now - sent.at < 400) return;
    sent = { json, at: now };
    ctx.input(mySeat(), inp);
  }

  function onMove(ax: number, ay: number, bx: number, by: number) {
    mvN++;
    pending.push([mvN, ax, ay, bx, by]);
    send(true);
  }

  /** Своё поле: начать, догнать снимок (если ходов в пути нет и анимация кончилась). */
  function reconcile(v: VsView) {
    const m = mine(v);
    if (!m?.full) return;
    pending = pending.filter((p) => p[0] > m.mvSeen);
    if (!game) {
      game = new Game(els.own, { mode: 'net', onScore() {} }, { onMove });
      game.netStart(cloneBoard(m.full));
      if (import.meta.env.DEV) (window as unknown as { __trv: Game }).__trv = game;
      return;
    }
    game.frozen = m.out || v.over;
    if (pending.length || game.netBusy) return;
    const local = game.netBoard;
    if (!local || boardString(local) !== m.g || local.score !== m.score) game.netReset(cloneBoard(m.full));
  }

  function pickSeat(seat: number) {
    const m = mine(latest);
    if (m && !m.out && !latest?.over) {
      target = target === seat ? -1 : seat;
      Sound.ui();
      send(true);
    } else {
      watch = seat;
    }
    drawFoes(true);
  }

  function bigSeatNow(v: VsView): number {
    const me = mySeat();
    if (v.mode === 'duel' || v.boards.length === 2) return v.boards.find((x) => x.seat !== me)?.seat ?? -1;
    const m = mine(v);
    if (!m || m.out || v.over) {
      if (watch >= 0 && v.boards.some((x) => x.seat === watch)) return watch;
      return v.boards.find((x) => !x.out && x.seat !== me)?.seat ?? v.boards.find((x) => x.seat !== me)?.seat ?? -1;
    }
    return -1;
  }

  function drawFoes(force = false) {
    const v = latest;
    if (!v) return;
    const me = mySeat();
    const bs = bigSeatNow(v);
    els.bigBox.hidden = bs < 0;
    if (bs >= 0) {
      const bv = v.boards.find((x) => x.seat === bs)!;
      const key = bv.g + bv.out;
      if (force || bs !== bigSeat || key !== bigKey) drawBoard(els.bigCv, bv, BC, false, performance.now() / 1000);
      bigKey = key;
      const nm = `${ctx.name(bs)}${bv.out ? ` · выбыл, ${bv.place}-е место` : ''} · ${bv.score}${bv.badges ? ` · ${'★'.repeat(Math.min(4, bv.badges))}` : ''}${bv.inc ? ` · летит ${bv.inc}` : ''}`;
      if (els.bigName.innerHTML !== nm) els.bigName.innerHTML = nm;
    }
    bigSeat = bs;
    const m = mine(v);
    const tg = m && !m.out ? m.target : -1;
    const others = v.boards.filter((x) => x.seat !== me);
    const one = bs >= 0 || matchMedia('(max-width: 760px)').matches;
    const half = one ? others.length : Math.ceil(others.length / 2);
    els.foesR.hidden = one;
    // меньше всех очков — первый кандидат на отсев
    const left = v.boards.filter((x) => !x.out);
    const low = v.mode === 'battle' && left.length > 1 ? Math.min(...left.map((x) => x.score)) : -1;
    for (const bv of others) {
      let mi = minis.get(bv.seat);
      if (!mi) {
        const el = h(`<button class="egv-mini"><canvas width="${N * MC}" height="${N * MC}"></canvas><span></span></button>`);
        el.onclick = () => pickSeat(bv.seat);
        mi = { el, cv: el.querySelector('canvas') as HTMLCanvasElement, key: '' };
        minis.set(bv.seat, mi);
      }
      const box = others.indexOf(bv) < half ? els.foes : els.foesR;
      if (mi.el.parentElement !== box) box.appendChild(mi.el);
      const key = bv.g + bv.out;
      if (force || key !== mi.key) {
        drawBoard(mi.cv, bv, MC, true);
        mi.key = key;
      }
      mi.el.classList.toggle('target', bv.seat === tg);
      mi.el.classList.toggle('picked', bv.seat === target);
      mi.el.classList.toggle('out', bv.out);
      mi.el.classList.toggle('watch', bv.seat === bs);
      mi.el.classList.toggle('danger', !bv.out && (bv.inc > 0 || bv.score === low));
      const label = `${ctx.name(bv.seat)} ${bv.out ? `· ${bv.place}` : bv.score}${bv.badges ? ` <b>${'★'.repeat(Math.min(4, bv.badges))}</b>` : ''}`;
      const sp = mi.el.lastElementChild as HTMLElement;
      if (sp.innerHTML !== label) sp.innerHTML = label;
    }
  }

  function drawInfo() {
    const v = latest;
    if (!v) return;
    const m = mine(v);
    const inc = m?.inc ?? 0;
    const soon = inc && m!.incAt - v.t < 1.5;
    let s = '';
    for (let i = 0; i < Math.min(12, inc); i++) s += '<i class="brick"></i>';
    const incHtml = `${s}${inc > 12 ? `<b>+${inc - 12}</b>` : ''}`;
    if (els.inc.innerHTML !== incHtml) els.inc.innerHTML = incHtml;
    els.inc.classList.toggle('soon', !!soon);
    const left = v.boards.filter((x) => !x.out).length;
    const low = left > 1 && m && !m.out && m.score === Math.min(...v.boards.filter((x) => !x.out).map((x) => x.score));
    const cut = v.mode === 'battle' && !v.over ? `<span class="${low ? 'warn' : ''}">отсев через <b>${Math.max(0, Math.ceil(v.cutAt - v.t))}</b> с${low ? ' — вы последний!' : ''}</span>` : '';
    const info = `${m ? `<span>очки <b>${m.score}</b></span>` : ''}${m?.badges ? `<span>${'★'.repeat(Math.min(4, m.badges))} +${Math.min(4, m.badges) * 25}%</span>` : ''}${v.boards.length > 2 ? `<span>осталось <b>${left}</b> из ${v.boards.length}</span>` : ''}${cut}<span>кирпич всем через <b>${Math.max(0, Math.ceil(v.pushAt - v.t))}</b> с</span>`;
    if (els.info.innerHTML !== info) els.info.innerHTML = info;
    const dim = m?.out ? `${m.place}-е место` : v.over && m && v.winners.includes(m.seat) ? 'Победа!' : '';
    if (els.dim.textContent !== dim) els.dim.textContent = dim;
    els.dim.hidden = !dim;
  }

  function onEvents(v: VsView, events: VsEvent[]) {
    const me = mySeat();
    for (const ev of events) {
      if (ev.k === 'attack') {
        if (ev.to === me) Sound.beep(300, 0.12, 0.12);
        const mi = minis.get(ev.to);
        if (mi) {
          mi.el.classList.remove('hit');
          void mi.el.offsetWidth;
          mi.el.classList.add('hit');
        }
      } else if (ev.k === 'land' && ev.seat === me) {
        game?.netFx(ev.cells, '#c0502a');
        Sound.beep(110, 0.2, 0.2);
      } else if (ev.k === 'push') {
        if (mine(v) && !mine(v)!.out) Sound.beep(140, 0.12, 0.12);
      } else if (ev.k === 'out') {
        if (ev.seat === me) Sound.nomove();
        else if (ev.by === me) Sound.capture();
      } else if (ev.k === 'end' && ev.winners.includes(me)) Sound.win();
    }
  }

  function build() {
    root.innerHTML = '';
    const el = h(`<div class="egv trv">
      <div class="egv-foes"></div>
      <div class="egv-mainbox">
        <div class="egv-info"></div>
        <div class="egv-main"><div class="egv-inc" title="Кирпичи, что летят к вам: успейте погасить своим каскадом"></div><div class="trv-own"></div><div class="trv-dim" hidden></div></div>
      </div>
      <div class="egv-big" hidden><div class="egv-bigname"></div><canvas width="${N * BC}" height="${N * BC}"></canvas></div>
      <div class="egv-foes egv-foes-r"></div>
    </div>`);
    root.appendChild(el);
    const q = (s: string) => el.querySelector(s) as HTMLElement;
    els = { inc: q('.egv-inc'), info: q('.egv-info'), foes: q('.egv-foes'), foesR: q('.egv-foes-r'), bigBox: q('.egv-big'), bigName: q('.egv-bigname'), bigCv: q('.egv-big canvas') as HTMLCanvasElement, own: q('.trv-own'), dim: q('.trv-dim') };
    els.bigCv.onclick = () => {
      if (bigSeat >= 0 && latest && latest.mode !== 'duel' && playing()) pickSeat(bigSeat);
    };
    minis.clear();
  }

  return {
    mount(el, c) {
      ctx = c;
      root = h(`<div class="egv-root"></div>`);
      el.appendChild(root);
      build();
      const iv = setInterval(() => send(), 100);
      cleanup.push(() => clearInterval(iv));
    },
    setView(v) {
      const first = !latest;
      latest = v;
      root.classList.toggle('duel', v.mode === 'duel' || v.boards.length === 2);
      if (first) {
        const m = mine(v);
        if (m) mvN = m.mvSeen;
      }
      reconcile(v);
      drawFoes(true);
      drawInfo();
    },
    async play(_ev, v) {
      this.setView(v);
    },
    realtime(v, events) {
      if (!latest) return this.setView(v);
      latest = v;
      reconcile(v);
      onEvents(v, events);
      drawFoes();
      drawInfo();
    },
    setTurn() {},
    status(v) {
      if (!v) return '';
      if (v.over) return v.winners.length === 1 ? `Победил ${ctx.name(v.winners[0])}` : 'Ничья';
      const m = mine(v);
      if (m?.out) return `Вы выбыли — ${m.place}-е место. Нажмите на поле соперника, чтобы смотреть его.`;
      const left = v.boards.filter((x) => !x.out).length;
      return v.boards.length > 2 ? `Битва: осталось ${left} из ${v.boards.length}` : 'Дуэль: кто продержится дольше';
    },
    playerStats(v, seat) {
      const b = v?.boards.find((x) => x.seat === seat);
      if (!b) return '';
      return `${b.out ? `выбыл, ${b.place}-е` : `очки <b>${b.score}</b>`}${b.ko ? ` · выбил ${b.ko}` : ''}`;
    },
    destroy() {
      cleanup.forEach((f) => f());
      game?.destroy();
      root?.remove();
    },
  };
}

