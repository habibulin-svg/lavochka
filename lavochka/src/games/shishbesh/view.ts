/* Шиш-беш — отрисовка на столе сборника: поле, лоток кубиков, кнопка броска. */
import { Sound } from '../../core/audio';
import { DiceTray } from '../../core/dice';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { Board } from './board';
import { HOME_START, legalMoves, playerBySeat, type Event, type State } from './engine';
import './shishbesh.css';

class ShishView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private board!: any;
  private tray!: DiceTray;
  private rollBtn!: HTMLButtonElement;
  private state: State | null = null;
  private piecesKey = '';
  private autoTimer: ReturnType<typeof setTimeout> | undefined;
  private rollSeat: number | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || this.rollBtn.disabled || !this.rollBtn.isConnected) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    this.roll();
  };

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="sb-wrap"><svg class="sb-board" xmlns="http://www.w3.org/2000/svg"></svg></div>`);
    root.appendChild(wrap);
    this.board = new Board(wrap.querySelector('svg'));
    const ctl = h(`<div class="sb-controls">
        <div class="sb-tray"></div>
        ${ctx.demo ? '' : '<button class="btn primary sb-roll" disabled>Бросить кости</button><div class="hint small-hint">Пробел — бросок. Нажмите на подсвеченную фишку, затем на цель.</div>'}
      </div>`);
    ctx.controls.appendChild(ctl);
    this.tray = new DiceTray(ctl.querySelector('.sb-tray') as HTMLElement);
    this.rollBtn = (ctl.querySelector('.sb-roll') as HTMLButtonElement) || document.createElement('button');
    this.rollBtn.onclick = () => this.roll();
    if (!ctx.demo) document.addEventListener('keydown', this.onKey);
  }

  private bottomSeat(s: State) {
    const mine = this.ctx.mySeats.filter((x) => s.players.some((p) => p.seat === x));
    if (mine.length) return mine[0];
    return s.players.some((p) => p.seat === 3) ? 3 : s.players[0].seat;
  }

  setView(s: State) {
    this.state = s;
    const key = s.players.map((p) => p.seat).join(',');
    if (key !== this.piecesKey) {
      this.piecesKey = key;
      this.board.initPieces(s);
      this.board.setRotation(this.bottomSeat(s));
    } else this.board.render(s, false);
    this.board.gLast.innerHTML = '';
    this.tray.show(s.dice[0] ? s.dice : null, s.phase === 'move' ? s.used : [true, true]);
  }

  async play(events: Event[], s: State) {
    const speed = this.ctx.speed();
    this.board.speed = speed;
    this.clearTurn();
    for (const ev of events) {
      if (ev.type === 'roll') {
        await this.tray.roll(ev.dice, speed);
        if (ev.noMoves) {
          Sound.nomove();
          this.tray.show(null, [true, true]);
          await sleep(700 / speed);
        }
      } else {
        this.board.setCurrentSeat(null);
        await this.board.animateMove(ev, s);
        this.tray.show(null, s.phase === 'move' ? s.used : [true, true]);
      }
    }
    this.state = s;
  }

  private clearTurn() {
    clearTimeout(this.autoTimer);
    this.board.clearInteraction();
    this.rollBtn.disabled = true;
    this.rollBtn.classList.remove('pulse');
    this.rollSeat = null;
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.clearTurn();
    const s = this.state;
    if (!s || s.phase === 'over') return;
    const seat = s.players[s.cur].seat;
    if (!interactive.includes(seat)) return;
    if (s.phase === 'roll') {
      this.rollSeat = seat;
      this.rollBtn.disabled = false;
      this.rollBtn.classList.add('pulse');
      return;
    }
    const moves = legalMoves(s);
    const send = (m: { piece: number; die: number; to: number }) => this.ctx.act(seat, { type: 'move', piece: m.piece, die: m.die, to: m.to });
    this.board.setCurrentSeat(seat);
    this.board.setInteraction(moves, send);
    const distinct = new Set(moves.map((m) => m.piece + ':' + m.to));
    if (this.ctx.autoSingle() && distinct.size === 1) {
      this.autoTimer = setTimeout(() => {
        if (this.state === s) {
          this.board.clearInteraction();
          send(moves[0]);
        }
      }, 500 / this.ctx.speed());
    }
  }

  private roll() {
    if (this.rollSeat == null) return;
    Sound.unlock();
    const seat = this.rollSeat;
    this.clearTurn();
    this.ctx.act(seat, { type: 'roll' });
  }

  status(s: State, _toAct: number[], interactive: number[]) {
    if (s.phase === 'over') return s.winner != null ? `Победа: ${this.ctx.name(s.winner)}!` : 'Партия окончена';
    const seat = s.players[s.cur].seat;
    const who = this.ctx.name(seat);
    if (!interactive.includes(seat)) return s.phase === 'roll' ? `${who} бросает…` : `${who} ходит…`;
    if (s.phase === 'roll') return `Ход: ${who} — бросайте кости`;
    const free = s.dice.filter((_d, i) => !s.used[i]).join(' и ');
    return `${who}: ходите (${free})`;
  }

  playerStats(s: State, seat: number) {
    const p = playerBySeat(s, seat);
    if (!p) return '';
    const home = p.pieces.filter((x) => x >= HOME_START).length;
    const park = p.pieces.filter((x) => x < 0).length;
    return `<span title="В домике">🏠 ${home}</span><span title="В парке">⬤ ${park}</span>`;
  }

  destroy() {
    clearTimeout(this.autoTimer);
    document.removeEventListener('keydown', this.onKey);
  }
}

export function createView(): GameView<State, Event> {
  return new ShishView();
}
