/* Быки и коровы — отрисовка (HTML). Цифры — на деревянной доске: попытки рядами, ответ «быки · коровы».
 * «Логика» — бежевая пластиковая доска как в коробке: 12 рядов по пять больших лунок под фишки, справа пять маленьких
 * под штырьки и номер ряда, внизу — код за экраном; серая коробка — меньше, штырьки квадратиком.
 * Дуэль — две доски рядом (свои попытки и попытки соперника); коны и одиночная — одна доска текущего дешифровальщика.
 * Ввод — строка ячеек под доской: цифры с клавиатуры или кнопками, фишки — щелчком по палитре; щелчок по ячейке её очищает. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { woodTexture, WOODS } from '../../core/wood';
import { coderOf, decoderOf, validCode, type Event, type State, type Try } from './engine';
import './bulls.css';

const COLORS = ['#d22b2b', '#1f5fd1', '#1e9a4a', '#f2c81d', '#f4f1e8', '#1a1a1a', '#f07a1a', '#7a3b1e'];
const COLOR_NAMES = ['красная', 'синяя', 'зелёная', 'жёлтая', 'белая', 'чёрная', 'оранжевая', 'коричневая'];

let wood = '';

class BullsView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private root!: HTMLElement;
  private boards!: HTMLElement;
  private entryBox!: HTMLElement;
  private info!: HTMLElement;
  private s: State | null = null;
  private actSeat: number | null = null;
  private entry: number[] = [];
  private fresh = -1;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h(`<div class="bc-wrap"><div class="bc-boards"></div><div class="bc-entry"></div></div>`);
    root.appendChild(this.root);
    this.boards = this.root.querySelector('.bc-boards') as HTMLElement;
    this.entryBox = this.root.querySelector('.bc-entry') as HTMLElement;
    this.info = h(`<div class="bc-info"></div>`);
    ctx.controls.appendChild(this.info);
    this.entryBox.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-k],[data-slot],[data-go],[data-del]');
      if (!t || !this.s || this.actSeat == null) return;
      Sound.unlock();
      if (t.dataset.k != null) this.put(Number(t.dataset.k));
      else if (t.dataset.slot != null) {
        this.entry[Number(t.dataset.slot)] = -1;
        this.drawEntry();
      } else if (t.dataset.del != null) this.back();
      else if (t.dataset.go != null) this.send();
    });
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    const s = this.s;
    if (!s || this.actSeat == null || !this.root.isConnected) return;
    if ((e.target as HTMLElement)?.closest?.('input,textarea,select')) return;
    if (s.cfg.digits && /^[0-9]$/.test(e.key)) this.put(Number(e.key));
    else if (e.key === 'Backspace') this.back();
    else if (e.key === 'Enter') this.send();
    else return;
    e.preventDefault();
  };

  destroy() {
    window.removeEventListener('keydown', this.onKey);
  }

  private put(k: number) {
    const s = this.s!;
    const i = this.entry.indexOf(-1);
    if (i < 0) return;
    if (!s.cfg.repeats && this.entry.includes(k)) return;
    this.entry[i] = k;
    Sound.step();
    this.drawEntry();
  }

  private back() {
    for (let i = this.entry.length - 1; i >= 0; i--)
      if (this.entry[i] >= 0) {
        this.entry[i] = -1;
        break;
      }
    this.drawEntry();
  }

  private send() {
    const s = this.s;
    if (!s || this.actSeat == null || !validCode(s.cfg, this.entry)) return;
    const seat = this.actSeat;
    const code = this.entry.slice();
    this.actSeat = null;
    this.ctx.act(seat, { type: s.phase === 'secret' ? 'secret' : 'guess', code });
    this.entry = [];
    this.drawEntry();
  }

  /** Знак кода: цифра или фишка (пустая ячейка — пустая лунка). */
  private sym(k: number, big = true): string {
    const s = this.s!;
    if (k < 0) return `<i class="bc-hole${big ? '' : ' sm'}"></i>`;
    if (s.cfg.digits) return `<b class="bc-dig">${k}</b>`;
    if (s.cfg.blank && k === s.cfg.kinds - 1) return `<i class="bc-hole blank" title="пусто"></i>`;
    return `<i class="bc-peg" style="--c:${COLORS[k]}" title="${COLOR_NAMES[k]}"></i>`;
  }

  private keys(t: Try | null): string {
    const s = this.s!;
    const len = s.cfg.len;
    if (s.cfg.digits) return t ? `<span class="bc-ans"><b>${t.bulls}</b> ${t.bulls === 1 ? 'бык' : t.bulls >= 2 && t.bulls <= 4 ? 'быка' : 'быков'} · <b>${t.cows}</b> ${t.cows === 1 ? 'корова' : t.cows >= 2 && t.cows <= 4 ? 'коровы' : 'коров'}</span>` : '<span class="bc-ans"></span>';
    let o = '';
    for (let i = 0; i < len; i++) {
      const cls = t && i < t.bulls ? ' b' : t && i < t.bulls + t.cows ? ' w' : '';
      o += `<i class="bc-key${cls}"></i>`;
    }
    return `<span class="bc-keys${s.cfg.look === 'grey' ? ' sq' : ''}">${o}</span>`;
  }

  /** Доска: попытки сверху вниз, внизу — код (за экраном, пока не открыт). */
  private board(title: string, tries: Try[], secret: number[] | null, showCode: boolean, entry: boolean): string {
    const s = this.s!;
    const c = s.cfg;
    const fixed = c.look !== 'wood' && c.rows > 0;
    const rows = fixed ? c.rows : Math.max(tries.length + (entry ? 1 : 0), 1);
    let o = '';
    for (let r = 0; r < rows; r++) {
      const t = tries[r] ?? null;
      const code = t ? t.code : Array(c.len).fill(-1);
      const cur = !t && entry && r === tries.length;
      o += `<div class="bc-row${t && r === tries.length - 1 && this.fresh >= 0 ? ' new' : ''}${cur ? ' cur' : ''}"><span class="bc-n">${r + 1}</span><span class="bc-code">${code.map((k) => this.sym(k)).join('')}</span>${this.keys(t)}</div>`;
    }
    const known = secret && secret.length ? secret : null;
    const code = showCode && known ? known.map((k) => this.sym(k)).join('') : Array(c.len).fill(this.sym(-1)).join('');
    const screen = showCode && known ? '' : `<span class="bc-screen">${secret ? 'код загадан' : 'код ещё не загадан'}</span>`;
    const scroll = c.look === 'wood' ? ' scroll' : '';
    return `<div class="bc-board ${c.look}"${c.look === 'wood' && wood ? ` style="--wood:url(${wood})"` : ''}>
      <div class="bc-title">${title}</div>
      <div class="bc-rows${scroll}">${o}</div>
      <div class="bc-secret"><span class="bc-code">${code}</span>${screen}</div>
    </div>`;
  }

  private draw() {
    const s = this.s;
    if (!s) return;
    const me = this.ctx.mySeats[0] ?? 0;
    const nm = (x: number) => this.ctx.name(x);
    let o = '';
    if (s.n === 2 && s.cfg.mode === 'duel') {
      const other = 1 - me;
      const mine = this.ctx.mySeats.length > 1 ? null : me;
      for (const seat of mine == null ? [0, 1] : [me, other]) {
        const target = 1 - seat;
        const own = this.ctx.mySeats.includes(target) && this.ctx.mySeats.length === 1;
        o += this.board(`${nm(seat)} угадывает код: ${nm(target)}`, s.tries[seat], s.secrets[target], s.open || own, this.actSeat === seat && s.phase === 'guess');
      }
    } else {
      const d = decoderOf(s);
      const c = coderOf(s);
      const title = s.n === 1 ? 'Разгадайте код компьютера' : `Разгадывает ${nm(d)}, загадал ${nm(c)}`;
      const own = s.n === 2 && this.ctx.mySeats.includes(c) && !this.ctx.mySeats.includes(d);
      o += this.board(title, s.tries[d], s.secrets[c], s.open || own, this.actSeat === d && s.phase === 'guess');
    }
    this.boards.innerHTML = o;
    this.boards.querySelectorAll('.bc-rows.scroll').forEach((el) => (el.scrollTop = el.scrollHeight));
    this.fresh = -1;
    this.drawInfo();
    this.drawEntry();
  }

  private drawInfo() {
    const s = this.s!;
    const nm = (x: number) => this.ctx.name(x);
    let o = '';
    if (s.cfg.mode === 'rounds' && s.n === 2) {
      o += `<div class="bc-sc">Кон <b>${Math.min(s.round + 1, s.cfg.rounds)}</b> из ${s.cfg.rounds}. Очки (меньше — лучше):</div>`;
      o += `<div class="bc-sc">${nm(0)}: <b>${s.scores[0]}</b> · ${nm(1)}: <b>${s.scores[1]}</b></div>`;
      for (const p of s.past)
        o += `<div class="bc-past">${nm(p.decoder)}: ${p.solved ? `за ${p.tries.length}` : 'не разгадал'} <span class="bc-mini">${p.secret.map((k) => this.sym(k, false)).join('')}</span></div>`;
    } else if (s.n === 1) o += `<div class="bc-sc">Попыток: <b>${s.tries[0].length}</b>${s.cfg.rows ? ` из ${s.cfg.rows}` : ''}</div>`;
    const c = s.cfg;
    o += `<div class="bc-rule">${c.digits ? `${c.len} ${c.len >= 5 ? 'цифр' : 'цифры'}` : `${c.len} фишек, ${c.blank ? c.kinds - 1 + ' цветов и пустая ячейка' : c.kinds + ' цветов'}`}${c.repeats ? ', с повторами' : ', все разные'}</div>`;
    this.info.innerHTML = o;
  }

  private drawEntry() {
    const s = this.s;
    const box = this.entryBox;
    if (!s || this.actSeat == null || this.ctx.demo) {
      box.innerHTML = '';
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const c = s.cfg;
    if (this.entry.length !== c.len) this.entry = Array(c.len).fill(-1);
    const secret = s.phase === 'secret';
    const slots = this.entry.map((k, i) => `<button class="bc-slot" data-slot="${i}" aria-label="ячейка ${i + 1}">${this.sym(k)}</button>`).join('');
    let pal = '';
    for (let k = 0; k < c.kinds; k++) {
      const used = !c.repeats && this.entry.includes(k);
      pal += `<button class="bc-key-btn${used ? ' used' : ''}" data-k="${k}"${used ? ' disabled' : ''}>${this.sym(k)}</button>`;
    }
    const ok = validCode(c, this.entry);
    box.innerHTML = `<div class="bc-entry-in ${c.look}">
      <div class="bc-what">${secret ? `${this.ctx.name(this.actSeat)}: загадайте код${s.n === 2 && this.ctx.mySeats.length > 1 ? ' (сопернику не смотреть!)' : ''}` : 'Ваша попытка'}</div>
      <div class="bc-slots">${slots}</div>
      <div class="bc-pal">${pal}<button class="bc-key-btn del" data-del="1" aria-label="стереть">⌫</button></div>
      <button class="btn primary bc-go" data-go="1"${ok ? '' : ' disabled'}>${secret ? 'Загадать' : 'Проверить'}</button>
    </div>`;
  }

  setView(v: State) {
    this.s = v;
    if (!wood && v.cfg.look === 'wood') wood = woodTexture(WOODS.linden, 512, 5, false);
    this.draw();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'guess') {
        this.fresh = 1;
        if (ev.bulls === v.cfg.len) Sound.win();
        else Sound.place();
      } else if (ev.type === 'secret') Sound.card();
      else if (ev.type === 'round') Sound.turn();
    }
    this.s = v;
    this.draw();
    await sleep(250 / this.ctx.speed());
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.actSeat = s && s.phase !== 'over' && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    this.entry = [];
    this.draw();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.phase === 'over') return v.winners.length ? 'Партия окончена' : v.n === 1 ? 'Код не разгадан' : 'Ничья';
    const mine = interactive.find((x) => toAct.includes(x));
    if (mine != null) return v.phase === 'secret' ? 'Загадайте код' : 'Ваша попытка';
    if (v.phase === 'secret') return 'Соперник загадывает код…';
    return `Угадывает ${this.ctx.name(toAct[0])}…`;
  }
}

export function createView(): GameView<State, Event> {
  return new BullsView();
}
