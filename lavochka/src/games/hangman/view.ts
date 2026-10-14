/* Виселица — отрисовка: тетрадный лист, виселица «пишется» ручкой по частям, слово — буквы на чёрточках.
 * Командная — два листка рядом. Обратная — рисунок стоит целиком, угаданные буквы стирают его с конца.
 * Управление в боковой панели: алфавит, «слово целиком», ставка (аукцион), слово ведущего (вслепую). */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { ALPHABET, norm } from '../../words/dict';
import { guessers, PARTS, puzzleOf, validWord, type Event, type Puzzle, type State } from './engine';
import { SEATS } from './def';
import './hangman.css';

const up = (w: string) => w.toUpperCase();

/** Части рисунка (viewBox 160×180) — в порядке PARTS. */
const SHAPES = [
  '<path pathLength="1" d="M8 170Q60 167 116 171"/>',
  '<path pathLength="1" d="M34 171Q36 92 35 14"/>',
  '<path pathLength="1" d="M30 15Q72 13 116 16M35 44Q50 30 64 15"/>',
  '<path pathLength="1" d="M111 16Q109 28 111 40"/>',
  '<circle pathLength="1" cx="111" cy="52" r="12"/>',
  '<path pathLength="1" d="M111 64Q112 88 111 112"/>',
  '<path pathLength="1" d="M111 76Q100 86 92 99"/>',
  '<path pathLength="1" d="M111 76Q121 86 130 99"/>',
  '<path pathLength="1" d="M111 112Q103 126 96 143"/>',
  '<path pathLength="1" d="M111 112Q118 126 126 143"/>',
];

/** Какие части сейчас нарисованы (номера). Обратная: доля открытых клеток слова стирает рисунок с конца. */
function partsShown(s: State, p: Puzzle): number[] {
  const all = PARTS.map((_, i) => i);
  if (p.hanged) return all;
  if (s.mode === 'reverse') {
    const len = p.word.length;
    const open = p.solved ? len : [...p.word].filter((c) => c !== '_').length;
    const erase = len ? Math.round((open / len) * PARTS.length) : 0;
    return all.slice(0, PARTS.length - erase);
  }
  const pre = s.limit === 6 ? 4 : 0;
  return all.slice(0, Math.min(PARTS.length, pre + p.misses));
}

class HangmanView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private sheet!: HTMLElement;
  private banner!: HTMLElement;
  private box!: HTMLElement;
  private s: State | null = null;
  /** Сколько частей было нарисовано у каждого листка — чтобы «дописывать» только новые. */
  private drawn: number[][] = [];
  private flash: string | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="hg-wrap"><div class="hg-sheet"></div><div class="hg-banner" hidden></div></div>`);
    root.appendChild(wrap);
    this.sheet = wrap.querySelector('.hg-sheet') as HTMLElement;
    this.banner = wrap.querySelector('.hg-banner') as HTMLElement;
    const ctl = h(`<div class="hg-controls"></div>`);
    ctx.controls.appendChild(ctl);
    this.box = ctl;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  private teamLabel(t: number) {
    const st = this.s!;
    return st.teams[t].map((x) => this.ctx.name(x)).join(', ');
  }

  private draw() {
    const st = this.s;
    if (!st) return;
    const pages = st.puzzles.map((p, i) => this.page(st, p, i)).join('');
    this.sheet.className = `hg-sheet${st.puzzles.length > 1 ? ' two' : ''}`;
    this.sheet.innerHTML = pages;
  }

  private page(st: State, p: Puzzle, i: number): string {
    const shown = partsShown(st, p);
    const prev = this.drawn[i];
    this.drawn[i] = shown;
    const reverse = st.mode === 'reverse';
    let svg = '';
    PARTS.forEach((_, k) => {
      const on = shown.includes(k);
      const was = prev ? prev.includes(k) : on;
      if (on) svg += `<g class="hg-part${!was ? ' fresh' : ''}${p.hanged ? ' dead' : ''}">${SHAPES[k]}</g>`;
      else if (reverse && was && prev) svg += `<g class="hg-part gone">${SHAPES[k]}</g>`;
      else svg += `<g class="hg-part ghost">${SHAPES[k]}</g>`; // карандашный набросок того, что ещё дорисуют
    });
    if (p.solved) svg += `<text x="76" y="160" class="hg-saved">спасён!</text>`;
    // слово: в маске скрытые буквы — «_»; в конце кона видно всё, неотгаданные — красным
    const letters = [...p.word]
      .map((c) => {
        const missed = c !== '_' && !p.letters.includes(c) && !p.solved;
        const fresh = this.flash && c === this.flash ? ' fresh' : '';
        return `<span class="hg-l${missed ? ' missed' : ''}${fresh}">${c === '_' ? '' : up(c)}</span>`;
      })
      .join('');
    const misses = p.letters.filter((l) => !p.word.includes(l)).map((l) => `<s>${up(l)}</s>`).join(' ');
    const words = p.wrongWords.map((w) => `<s>${up(w)}</s>`).join(', ');
    const head = st.mode === 'team' ? `<div class="hg-team">Команда ${i + 1}: ${this.teamLabel(i)}${st.team === i && st.phase === 'guess' ? ' ✎' : ''}</div>` : '';
    const counter = `<div class="hg-count">ошибок: ${p.misses} из ${st.limit}</div>`;
    const setting = st.phase === 'set' ? `<div class="hg-wait">${this.ctx.name(st.setter)} загадывает слово…</div>` : '';
    const hint = p.hint ? `<div class="hg-hint">${p.hint}</div>` : '';
    return `<div class="hg-page">${head}<svg class="hg-gallows" viewBox="0 0 160 180">${svg}</svg>
      <div class="hg-text">${setting}${hint}<div class="hg-word">${letters}</div>
      ${misses ? `<div class="hg-miss">${misses}</div>` : ''}${words ? `<div class="hg-miss words">${words}</div>` : ''}${counter}</div></div>`;
  }

  private showBanner(text: string) {
    this.banner.textContent = text;
    this.banner.hidden = !text;
  }

  private resultText(st: State): string {
    if (st.phase === 'over') {
      const best = Math.max(...st.seats.map((x) => st.scores[x]));
      const w = st.seats.filter((x) => st.scores[x] === best);
      return w.length > 1 ? 'Поровну!' : `Победа: ${this.plain(w[0])}!`;
    }
    if (st.phase !== 'between') return '';
    const hanged = st.puzzles.some((p) => p.hanged) && !st.puzzles.some((p) => p.solved);
    if (st.mode === 'team') return st.roundWinners.length ? `Кон за командой ${st.teams[0].includes(st.roundWinners[0]) ? 1 : 2}` : 'Кон окончен';
    if (hanged) return st.roundWinners.length ? `Повешен! Очки ведущему` : 'Повешен!';
    return st.roundWinners.length ? `Отгадал ${this.plain(st.roundWinners[0])}!` : 'Отгадали!';
  }

  setView(s: State) {
    this.s = s;
    this.flash = null;
    this.drawn = [];
    this.draw();
    this.showBanner(this.resultText(s));
  }

  async play(events: Event[], s: State) {
    const speed = this.ctx.speed();
    this.box.innerHTML = '';
    for (const ev of events) {
      if (ev.type === 'letter') {
        this.s = s;
        this.flash = ev.hit ? ev.l : null;
        this.draw();
        if (ev.hit) Sound.pen(Math.min(3, ev.hit));
        else Sound.nomove();
        await sleep(450 / speed);
      } else if (ev.type === 'word') {
        this.s = s;
        this.flash = null;
        this.draw();
        if (ev.ok) Sound.home();
        else Sound.nomove();
        await sleep(600 / speed);
      } else if (ev.type === 'bids') {
        Sound.card();
        await sleep(300 / speed);
      } else if (ev.type === 'set') {
        Sound.pen(2);
      } else if (ev.type === 'round') {
        this.s = s;
        this.draw();
        this.showBanner(this.resultText(s));
        if (ev.hanged.every(Boolean) || !ev.winners.length) Sound.nomove();
        else Sound.capture();
        await sleep(900 / speed);
      } else if (ev.type === 'newround') {
        this.drawn = [];
        this.showBanner('');
        Sound.shuffle();
      } else if (ev.type === 'end') {
        Sound.win();
      }
    }
    this.s = s;
    this.flash = null;
    this.draw();
    this.showBanner(this.resultText(s));
  }

  private send(seat: number, a: Parameters<ViewCtx['act']>[1]) {
    Sound.unlock();
    this.box.innerHTML = '';
    this.ctx.act(seat, a);
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.box.innerHTML = '';
    const st = this.s;
    if (!st || st.phase === 'over' || this.ctx.demo) return;
    const seat = interactive.find((x) => toAct.includes(x));
    if (seat == null) return;

    if (st.phase === 'between') {
      const b = h<HTMLButtonElement>(`<button class="btn primary" data-tap>Следующий кон</button>`);
      b.onclick = () => this.send(seat, { type: 'next' });
      this.box.appendChild(b);
    } else if (st.phase === 'set') this.setForm(seat);
    else if (st.phase === 'bid') this.bidForm(st, seat);
    else if (st.phase === 'guess') this.guessForm(st, seat);
  }

  /** Ведущий вписывает слово — вслепую, чтобы отгадчики за тем же экраном не подсмотрели. */
  private setForm(seat: number) {
    const f = h(`<form class="hg-form"><div class="hint">${this.ctx.name(seat)}, загадайте существительное (4–12 букв). Отгадчики — отвернитесь!</div>
      <input class="hg-input" type="password" autocomplete="off" maxlength="12" placeholder="слово" />
      <div class="hg-err small-hint"></div><button class="btn primary">Загадать</button></form>`);
    const inp = f.querySelector('input') as HTMLInputElement;
    const err = f.querySelector('.hg-err') as HTMLElement;
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const w = norm(inp.value.trim());
      const bad = validWord(w);
      if (bad) {
        err.textContent = bad;
        return;
      }
      this.send(seat, { type: 'set', word: w });
    });
    this.box.appendChild(f);
    setTimeout(() => inp.focus(), 50);
  }

  private bidForm(st: State, seat: number) {
    const bank = st.scores[seat];
    const f = h(`<form class="hg-form"><div class="hint">${this.ctx.name(seat)}: тайная ставка за право назвать букву (в банке ${bank}).</div>
      <div class="hg-bid"><input type="range" min="0" max="${bank}" value="${Math.min(5, bank)}" /><b>${Math.min(5, bank)}</b></div>
      <button class="btn primary">Поставить</button></form>`);
    const r = f.querySelector('input') as HTMLInputElement;
    const out = f.querySelector('b') as HTMLElement;
    r.oninput = () => (out.textContent = r.value);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      this.send(seat, { type: 'bid', n: Number(r.value) });
    });
    this.box.appendChild(f);
  }

  private guessForm(st: State, seat: number) {
    const p = puzzleOf(st, seat);
    const kb = h(`<div class="hg-kb"></div>`);
    for (const l of ALPHABET) {
      const used = p.letters.includes(l);
      const cls = used ? (p.word.includes(l) ? ' hit' : ' miss') : '';
      const b = h<HTMLButtonElement>(`<button class="hg-key${cls}"${used ? ' disabled' : ''}>${up(l)}</button>`);
      b.onclick = () => this.send(seat, { type: 'letter', l });
      kb.appendChild(b);
    }
    const len = p.word.length;
    const f = h(`<form class="hg-form word"><input class="hg-input" autocomplete="off" maxlength="${len}" placeholder="слово целиком (${len})" /><button class="btn">Назвать</button></form>`);
    const inp = f.querySelector('input') as HTMLInputElement;
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const w = norm(inp.value.trim());
      if (w.length !== len || !/^[а-я]+$/.test(w)) {
        inp.classList.add('bad');
        return;
      }
      if (p.wrongWords.includes(w)) {
        inp.classList.add('bad');
        return;
      }
      this.send(seat, { type: 'word', word: w });
    });
    inp.oninput = () => inp.classList.remove('bad');
    this.box.append(kb, f);
  }

  status(st: State, toAct: number[], interactive: number[]) {
    const name = (p: number) => this.ctx.name(p);
    const of = st.rounds > 1 ? ` (кон ${st.round} из ${st.rounds})` : '';
    if (st.phase === 'over') return this.resultText(st);
    if (st.phase === 'between') return this.resultText(st) + of;
    if (st.phase === 'set') return (interactive.includes(st.setter) ? `${name(st.setter)}: загадайте слово` : `Загадывает ${name(st.setter)}…`) + of;
    if (st.phase === 'bid') {
      const mine = toAct.filter((x) => interactive.includes(x));
      return (mine.length ? `Ставка: ${mine.map(name).join(', ')}` : 'Ставки…') + of;
    }
    const who = toAct[0];
    return (interactive.includes(who) ? `Ваш ход: ${name(who)} — назовите букву` : `Отгадывает ${name(who)}…`) + of;
  }

  playerStats(st: State, seat: number) {
    const sc = st.scores[seat];
    const label = st.mode === 'team' ? `конов: ${sc}` : st.mode === 'auction' ? `банк: ${sc}` : `очков: ${sc}`;
    let extra = '';
    if (st.byPlayers && seat === st.setter && st.phase !== 'over') extra = ' · ведущий';
    if (st.mode === 'team') extra = ` · команда ${st.teams[0].includes(seat) ? 1 : 2}`;
    if (st.phase === 'bid' && guessers(st).includes(seat)) extra = st.bids[seat] != null ? (st.bids[seat] >= 0 ? ` · ставка ${st.bids[seat]}` : ' · поставил') : ' · думает';
    return `<span style="color:${SEATS[seat].color}">${label}</span><span>${extra}</span>`;
  }
}

export function createView(): GameView<State, Event> {
  return new HangmanView();
}
