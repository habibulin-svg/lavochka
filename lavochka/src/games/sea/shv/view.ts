/* «Путешествие в Швамбранию» — отрисовка: карта Швамбрании (склейка оригинального поля) с камерой, кораблики игроков на узлах
 * маршрута, в панели — оригинальный компас-циферблат со стрелкой, марки «1» и «3» швамбрании, вопросник с полем ответа,
 * выборы на развилках. Вымпел Великого Лоцмана лежит у грота, пока его не взяли. */
import { Sound } from '../../../core/audio';
import { BoardCam, type CamPoint } from '../../../core/boardcam';
import { esc, h, sleep } from '../../../core/util';
import type { GameView, ViewCtx } from '../../../core/view';
import { SEATS as HSEATS } from '../../hodilki/core';
import { MAP, NODES, nodeOf, ransom, seatNow, type Ship, type ShvAction, type ShvEvent, type ShvState } from './engine';
import { BOOKS, sectionOf } from './words';
import { describeShv } from './rules';

const SEATS = HSEATS;

/** Кораблик-фишка: силуэт парусника цвета игрока. */
const shipSvg = (c: string) => `<svg viewBox="0 0 40 40"><path d="M5 27 h30 l-5 7 h-20 z" fill="${c}" stroke="#1a1208" stroke-width="1.6"/>
  <path d="M20 4 v23" stroke="#1a1208" stroke-width="1.8"/><path d="M21 6 q11 9 0 19 z" fill="#f6efd8" stroke="#1a1208" stroke-width="1.3"/>
  <path d="M19 9 q-9 7 0 15 z" fill="#f6efd8" stroke="#1a1208" stroke-width="1.3"/><path d="M20 4 l7 2 -7 2 z" fill="${c}"/></svg>`;

/** Марки игрока: по три и по одной швамбрании. */
function stamps(n: number): string {
  const three = Math.floor(n / 3);
  const one = n % 3;
  const img = (k: 1 | 3) => `<img src="/shv/mark${k}.webp" alt="${k}">`;
  return `<span class="shv-stamps" title="${n} швамбраний">${img(3).repeat(Math.min(three, 6))}${three > 6 ? `<i>×${three}</i>` : ''}${img(1).repeat(one)}<b>${n}</b></span>`;
}

function status(sh: Ship, s: ShvState): string {
  const t: string[] = [];
  if (sh.quiz) t.push(sh.quiz.why === 'start' ? 'экзамен на капитана' : 'вопросник');
  if (sh.reef) t.push('на рифах');
  if (sh.inPlen) t.push('в плену');
  else if (sh.captive) t.push('в руках пиратов');
  if (sh.repair) t.push('идёт чиниться');
  if (sh.wrecked) t.push('пешком');
  if (sh.lotsman) t.push('вымпел');
  if (sh.skip) t.push('пропуск хода');
  if (!t.length && sh.leg === 'start' && sh.i < 0 && !s.result) t.push('на Большом рейде');
  return t.join(', ');
}

class ShvView implements GameView<ShvState, ShvEvent> {
  private ctx!: ViewCtx<ShvAction>;
  private v: ShvState | null = null;
  private wrap!: HTMLElement;
  private board!: HTMLElement;
  private img!: HTMLImageElement;
  private marksEl!: HTMLElement;
  private shipsEl!: HTMLElement;
  private float!: HTMLElement;
  private panel!: HTMLElement;
  private needle!: HTMLElement;
  private readout!: HTMLElement;
  private spinBtn!: HTMLButtonElement;
  private mine!: HTMLElement;
  private tokens = new Map<number, HTMLElement>();
  /** Где кораблик показан сейчас (во время анимации отличается от состояния). */
  private pos = new Map<number, string>();
  private interactive: number[] = [];
  private busy = false;
  private cam!: BoardCam;
  private angle = 0;
  private panelKey = '';

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.wrap = h(`<div class="sea-wrap shv"><div class="sea-board shv-board">
        <img class="sea-img" alt="карта Швамбрании" draggable="false">
        <div class="sea-marks"></div>
        <div class="sea-ships"></div>
      </div>
      <div class="sea-float"></div></div>`);
    root.appendChild(this.wrap);
    this.board = this.wrap.querySelector('.sea-board') as HTMLElement;
    this.img = this.wrap.querySelector('.sea-img') as HTMLImageElement;
    this.marksEl = this.wrap.querySelector('.sea-marks') as HTMLElement;
    this.shipsEl = this.wrap.querySelector('.sea-ships') as HTMLElement;
    this.float = this.wrap.querySelector('.sea-float') as HTMLElement;
    this.panel = h(`<div class="sea-panel shv-panel">
        <div class="shv-compass"><img src="/shv/compass.webp" alt="компас-циферблат"><i class="shv-needle"></i></div>
        <div class="shv-readout"></div>
        <button class="btn primary sea-spin" data-tap hidden>Запустить стрелку</button>
        <div class="sea-mine"></div>
      </div>`);
    ctx.controls.appendChild(this.panel);
    this.needle = this.panel.querySelector('.shv-needle') as HTMLElement;
    this.readout = this.panel.querySelector('.shv-readout') as HTMLElement;
    this.spinBtn = this.panel.querySelector('.sea-spin') as HTMLButtonElement;
    this.mine = this.panel.querySelector('.sea-mine') as HTMLElement;
    this.spinBtn.onclick = () => {
      const v = this.v;
      if (!v) return;
      this.send(v.phase === 'quiz' ? { type: 'qspin' } : { type: 'spin' });
    };
    this.mine.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
      if (el) this.send(JSON.parse(el.dataset.a!) as ShvAction);
    });
    this.mine.addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = this.mine.querySelector('input') as HTMLInputElement | null;
      const text = inp?.value.trim() ?? '';
      this.send(text ? { type: 'answer', text } : { type: 'giveup' });
    });
    this.board.style.setProperty('--cell', '2.2%');
    this.img.src = MAP.img;
    this.cam = new BoardCam(this.wrap, this.board, {
      w: MAP.w,
      h: MAP.h,
      mini: MAP.mini,
      src: MAP.src,
      token: 0.02,
      followKey: 'shv.follow',
      demo: ctx.demo,
      speed: () => ctx.speed(),
      dots: () => (this.v ? this.v.seats.map((x) => ({ key: x, ...this.xy(x), color: SEATS[x].color, on: x === seatNow(this.v!) })) : []),
      turn: () => (this.v && !this.v.result ? [this.xy(seatNow(this.v))] : []),
    });
    ctx.hold?.(8000);
    const ready = () => {
      this.board.classList.add('ready');
      ctx.hold?.(0);
      this.cam.shown();
    };
    if (this.img.complete && this.img.naturalWidth) ready();
    else this.img.onload = ready;
  }

  private node(seat: number) {
    return this.pos.get(seat) ?? nodeOf(this.v!.ships[seat]);
  }

  private xy(seat: number): CamPoint {
    const [x, y] = NODES[this.node(seat)];
    return { x, y };
  }

  setView(v: ShvState) {
    this.v = v;
    this.pos.clear();
    this.turnNeedle(v.needle, false);
    this.render();
  }

  async play(events: ShvEvent[], v: ShvState) {
    const speed = this.ctx.speed();
    this.busy = true;
    if (this.v) for (const x of this.v.seats) this.pos.set(x, nodeOf(this.v.ships[x]));
    this.v = { ...v };
    this.render();
    for (const ev of events) {
      switch (ev.t) {
        case 'compass':
          Sound.diceRoll(1.2 / speed);
          await this.turnNeedle(ev.angle, true);
          this.say(`Компас: ${ev.n}`);
          this.readout.innerHTML = `<b>${ev.n}</b> ${ev.n === 1 ? 'узел' : ev.n < 5 ? 'узла' : 'узлов'}`;
          await sleep(350 / speed);
          break;
        case 'qspin': {
          Sound.diceRoll(1.2 / speed);
          await this.turnNeedle(ev.a1, true);
          this.readout.innerHTML = `№${ev.q}: ${esc(sectionOf(ev.book, ev.q).title.toLowerCase())}`;
          if (ev.a2 !== null) {
            await sleep(250 / speed);
            Sound.diceRoll(1 / speed);
            await this.turnNeedle(ev.a2, true);
            this.readout.innerHTML += `<br>на букву <b>${esc(ev.letters.split('').join(' / '))}</b>`;
          }
          await sleep(300 / speed);
          break;
        }
        case 'go':
        case 'back': {
          const el = this.tokens.get(ev.seat);
          const last = ev.path[ev.path.length - 1];
          await this.cam.frame([this.xy(ev.seat), { x: NODES[last][0], y: NODES[last][1] }], []);
          el?.classList.add('lifted');
          for (const n of ev.path) {
            this.pos.set(ev.seat, n);
            this.place();
            Sound.step();
            await sleep((ev.t === 'back' ? 160 : 210) / speed);
          }
          el?.classList.remove('lifted');
          Sound.place();
          break;
        }
        case 'answer':
          if (ev.text) this.say(`«${ev.text}»`);
          await sleep(500 / speed);
          break;
        case 'quiz':
          (ev.ok ? Sound.enter : Sound.nomove)();
          this.say(ev.ok ? (ev.gain ? `Верно! +${ev.gain} марок` : 'Верно!') : 'Не засчитано');
          await sleep(700 / speed);
          break;
        case 'point':
        case 'pirates':
        case 'escape':
        case 'tow':
        case 'ice': {
          const t = describeShv(ev, (x) => SEATS[x].name);
          if (t && !(ev.t === 'point' && ev.kind === 'home')) this.say(t.replace(/<[^>]+>/g, '').replace(/^[^:]+: /, ''));
          if (ev.t === 'point' && (ev.kind === 'storm' || ev.kind === 'battery' || ev.kind === 'fire')) Sound.nomove();
          if (ev.t === 'pirates' && ev.paid === null) Sound.nomove();
          this.renderMarks();
          await sleep(900 / speed);
          break;
        }
        case 'end':
          Sound.win();
          break;
      }
    }
    this.v = v;
    this.pos.clear();
    this.busy = false;
    this.render();
  }

  private async turnNeedle(angle: number, anim: boolean) {
    const cur = ((this.angle % 360) + 360) % 360;
    this.angle += (anim ? 720 : 0) + ((angle - cur + 360) % 360);
    this.needle.style.transitionDuration = anim ? `${1.3 / this.ctx.speed()}s` : '0s';
    this.needle.style.transform = `rotate(${this.angle}deg)`;
    if (anim) await sleep(1350 / this.ctx.speed());
  }

  setTurn(_toAct: number[], interactive: number[]) {
    const mine = interactive.length > 0 && !this.interactive.length;
    this.interactive = interactive;
    this.render();
    if (mine && this.v && !this.v.result) {
      this.cam.release();
      void this.cam.frame([this.xy(seatNow(this.v))], []);
    }
  }

  status(v: ShvState, toAct: number[], interactive: number[]) {
    if (v.result) return `${v.result.winners.map((s) => this.ctx.name(s)).join(', ')}: ${esc(v.result.text)}`;
    const who = toAct[0];
    const me = interactive.includes(who);
    const nm = this.ctx.name(who);
    switch (v.phase) {
      case 'quiz':
        return me ? 'Запустите стрелку: номер вопроса и буква' : `${nm} отвечает на вопросник…`;
      case 'answer':
        return me ? 'Ответьте на вопрос' : `${nm} думает над ответом…`;
      case 'judge':
        return me ? `Засчитать ответ «${esc(v.quiz?.answer ?? '')}»?` : `${nm} решает, засчитать ли ответ…`;
      case 'fork':
        return me ? 'Развилка — выберите путь' : `${nm} выбирает путь…`;
      case 'pirates':
        return me ? 'Пираты! Откупиться или сдаться?' : `${nm}: пираты!`;
      case 'escape':
        return me ? 'Побег! Куда бежать?' : `${nm} бежит из плена…`;
      case 'tow':
        return me ? 'SOS у пункта 3 — взять на буксир?' : `${nm} решает, брать ли на буксир…`;
      case 'bayFail':
        return me ? 'Не ответили в Бухте Добычи' : `${nm}: Бухта Добычи…`;
      default:
        return me ? `Запустите стрелку компаса (круг ${v.round})` : `Ходит ${nm}…`;
    }
  }

  playerStats(v: ShvState, seat: number) {
    const sh = v.ships[seat];
    return `${stamps(sh.marks)}${status(sh, v) ? ` · ${status(sh, v)}` : ''}`;
  }

  destroy() {
    this.cam?.destroy();
  }

  // ---------- отрисовка ----------

  private render() {
    if (!this.v) return;
    this.sync();
    this.place();
    this.renderMarks();
    this.renderPanel();
  }

  private sync() {
    const v = this.v!;
    for (const x of v.seats) {
      let el = this.tokens.get(x);
      if (!el) {
        el = h(`<div class="shv-ship" data-seat="${x}">${shipSvg(SEATS[x].color)}<i class="shv-pen"></i></div>`);
        this.shipsEl.appendChild(el);
        this.tokens.set(x, el);
      }
      const sh = v.ships[x];
      el.classList.toggle('on', !v.result && x === seatNow(v));
      el.classList.toggle('wreck', !!sh.wrecked);
      el.classList.toggle('lotsman', !!sh.lotsman);
      el.classList.toggle('plen', !!sh.inPlen || !!sh.captive);
      el.title = `${SEATS[x].name}${status(sh, v) ? ' — ' + status(sh, v) : ''}`;
    }
  }

  private place() {
    const v = this.v!;
    const by = new Map<string, number[]>();
    for (const x of v.seats) {
      const n = this.node(x);
      by.set(n, [...(by.get(n) ?? []), x]);
    }
    for (const [n, list] of by) {
      const [cx, cy] = NODES[n];
      list.forEach((x, i) => {
        const k = list.length;
        const a = (i / k) * Math.PI * 2 - Math.PI / 2;
        const r = k > 1 ? 34 : 0;
        const el = this.tokens.get(x)!;
        el.style.left = ((cx + Math.cos(a) * r) / MAP.w) * 100 + '%';
        el.style.top = ((cy + Math.sin(a) * r - 18) / MAP.h) * 100 + '%';
        el.classList.toggle('small', k > 1);
      });
    }
  }

  private renderMarks() {
    const v = this.v!;
    const pct = (n: string, dy = 0) => `left:${(NODES[n][0] / MAP.w) * 100}%;top:${((NODES[n][1] + dy) / MAP.h) * 100}%`;
    let html = '';
    if (v.pennant) html += `<img class="shv-pennant" src="/shv/pennant.webp" alt="вымпел" title="Вымпел Великого Лоцмана" style="${pct('P_GROT', -70)}">`;
    if (v.frozen) html += `<div class="shv-ice" style="${pct('d184')}" title="Льды: путь закрыт">❄</div>`;
    this.marksEl.innerHTML = html;
  }

  private mineTurn() {
    const v = this.v;
    return !!v && !v.result && !this.busy && !this.ctx.demo && this.interactive.includes(v.phase === 'judge' ? v.quiz!.judge! : seatNow(v));
  }

  private renderPanel() {
    const v = this.v!;
    const mine = this.mineTurn();
    const sh = v.ships[seatNow(v)];
    this.spinBtn.hidden = !(mine && (v.phase === 'spin' || v.phase === 'quiz'));
    this.spinBtn.textContent = v.phase === 'quiz' ? (v.o.quiz === 'letters' ? 'Запустить стрелку: номер и буква' : 'Запустить стрелку: номер вопроса') : sh.inPlen ? 'Запустить стрелку: побег на чётном' : sh.reef ? 'Запустить стрелку: снимемся на 3, 6, 9, 12' : 'Запустить стрелку';
    const key = JSON.stringify([mine, v.phase, v.turn, v.round, v.quiz, v.pending, v.towOffer, sh.marks]);
    if (key === this.panelKey && this.mine.childElementCount) return;
    this.panelKey = key;
    const btn = (a: ShvAction, label: string, cls = '') => `<button class="btn ${cls}" data-a='${esc(JSON.stringify(a))}'>${label}</button>`;
    let html = '';
    if (v.quiz && (v.phase === 'answer' || v.phase === 'judge')) {
      const q = v.quiz;
      html += `<div class="shv-q"><small>${esc(BOOKS[q.book].title)}</small><b>№${q.q}. ${esc(sectionOf(q.book, q.q).title)}</b>${q.letters ? `<span>на букву <em>${esc(q.letters.split('').join(' / '))}</em></span>` : '<span>любое слово раздела</span>'}</div>`;
    }
    if (mine) {
      switch (v.phase) {
        case 'quiz':
          if (sh.quiz) html += `<div class="sea-note">${sh.quiz.why === 'start' ? 'Экзамен на капитана: «Капитанский вопросник».' : esc(BOOKS[sh.quiz.book].title)}</div>`;
          if (sh.quiz?.why === 'bay') html += `<div class="sea-btns">${btn({ type: 'pass' }, 'Плыть дальше без марок')}</div>`;
          break;
        case 'answer':
          html += `<form class="shv-answer"><input type="text" maxlength="60" autocomplete="off" placeholder="Ваш ответ" aria-label="Ваш ответ"><button class="btn primary">Ответить</button></form>
            <div class="sea-btns">${btn({ type: 'giveup' }, 'Не знаю')}</div>`;
          break;
        case 'judge':
          html += `<div class="sea-note">${esc(SEATS[v.quiz!.seat].name)} отвечает: <b>«${esc(v.quiz!.answer ?? '')}»</b>. Такого слова нет в словаре игры — засчитать?</div>
            <div class="sea-btns">${btn({ type: 'judge', ok: true }, 'Засчитать', 'primary')}${btn({ type: 'judge', ok: false }, 'Не засчитывать', 'warn')}</div>`;
          break;
        case 'fork':
          html +=
            v.pending?.fork === 'n4'
              ? `<div class="sea-h">Пункт 4: куда плыть?</div><div class="sea-btns">${!v.frozen || sh.iceOk ? btn({ type: 'fork', way: 'ice' }, 'Через льды — безопасно, но дольше') : ''}${btn({ type: 'fork', way: 'south' }, 'Южным проливом — коротко, но батареи', 'warn')}</div>`
              : `<div class="sea-h">Мыс Маяка Доброй Надежды</div><div class="sea-btns">${btn({ type: 'fork', way: 'straight' }, 'Прямо Фиолетовым морем')}${btn({ type: 'fork', way: 'bay' }, 'В Бухту Добычи за топливом (+8 марок)')}</div>`;
          break;
        case 'pirates':
          html += `<div class="sea-h">Пираты настигают!</div><div class="sea-btns">${btn({ type: 'pirates', pay: true }, `Уйти: за борт ${ransom(sh.marks)} марок`, 'primary')}${btn({ type: 'pirates', pay: false }, 'Сдаться — на Остров Плена', 'warn')}</div>`;
          break;
        case 'escape':
          html += `<div class="sea-h">Побег из плена!</div><div class="sea-btns">${btn({ type: 'escape', way: 'N' }, 'На север, кратчайшим путём')}${btn({ type: 'escape', way: 'W' }, v.pennant ? 'На запад, к гроту — за вымпелом Лоцмана' : 'На запад (вымпел уже взят)')}</div>`;
          break;
        case 'tow':
          html += `<div class="sea-note">${esc(SEATS[v.towOffer!.victim].name)} на рифах подаёт SOS. Взять на буксир? Приз — до 3 марок, но в следующий ход отойдёте на 4 узла.</div>
            <div class="sea-btns">${btn({ type: 'tow', yes: true }, 'Взять на буксир', 'primary')}${btn({ type: 'tow', yes: false }, 'Плыть мимо')}</div>`;
          break;
        case 'bayFail':
          html += `<div class="sea-btns">${btn({ type: 'bay', retry: true }, 'Попробовать снова в следующий ход')}${btn({ type: 'bay', retry: false }, 'Плыть дальше без марок', 'primary')}</div>`;
          break;
      }
    }
    html += this.legend();
    this.mine.innerHTML = html;
    const inp = this.mine.querySelector('input') as HTMLInputElement | null;
    if (inp) setTimeout(() => inp.focus(), 50);
  }

  private legend() {
    return this.v!.frozen ? '<div class="sea-note">❄ Лазурный океан скован льдами — дальше только Южным проливом.</div>' : '';
  }

  private send(a: ShvAction) {
    const v = this.v;
    if (!v || this.busy) return;
    const actor = v.phase === 'judge' ? v.quiz!.judge! : seatNow(v);
    if (!this.interactive.includes(actor)) return;
    Sound.unlock();
    this.ctx.act(actor, a);
  }

  private say(text: string) {
    const el = h(`<div class="sea-say">${esc(text)}</div>`);
    this.float.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }
}

export function createShvView(): GameView<ShvState, ShvEvent> {
  return new ShvView();
}

