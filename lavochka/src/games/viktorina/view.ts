/* Викторина — экран: студия телевикторины 90-х (картинки конвейера, art.ts). Вопрос на панели с лампочками, варианты — плашки,
 * игроки — за трибунами, кнопка-«пуговица», барабан с латунным ободом (крутит сам игрок — взмахом по барабану или кнопкой),
 * табло опроса и табло тем. Время — часы комнаты: обратный отсчёт по roomToLocal, нажатие — с моментом события (eventTime).
 * За одним экраном (несколько мест) — у каждого своя клавиша кнопки: 1…8. */
import { audioOut, Sound, tone } from '../../core/audio';
import { eventTime, roomNow } from '../../core/clocksync';
import { segRow } from '../../core/rtview';
import { store } from '../../core/settings';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { ART, MUSIC, preloadArt } from './art';
import { SEATS } from './def';
import { ALPHABET, BOARD_PRICES, LADDER_SUM, modeName, SAFE, SECTORS, topicName, type Action, type Event, type View } from './engine';
import './viktorina.css';

const PREF_MUSIC = 'viktorina.music';
const LETTERS = ['A', 'B', 'C', 'D'];
const rub = (n: number) => n.toLocaleString('ru-RU');

/** Короткий сигнал сейчас (tone ждёт время по часам звука). */
function beep(freq: number, dur: number, gain: number, type: OscillatorType = 'square') {
  const a = audioOut();
  if (a) tone(a.ctx.currentTime, { freq, dur, gain, type });
}

/** «Зуммер» — своя высота у каждого места. */
function buzzSound(seat: number) {
  Sound.unlock();
  beep(320 + seat * 40, 0.25, 0.16);
}

class VikView implements GameView<View, Event> {
  private ctx!: ViewCtx<Action>;
  private wrap!: HTMLElement;
  private stage!: HTMLElement;
  private bar!: HTMLElement;
  private timerEl!: HTMLElement;
  private banner!: HTMLElement;
  private box!: HTMLElement;
  private v: View | null = null;
  private toAct: number[] = [];
  private inter: number[] = [];
  private raf = 0;
  private wheelEl: HTMLElement | null = null;
  private rot = 0;
  private spinsShown = -1;
  private music: HTMLAudioElement | null = null;
  private track = 0;
  private sentKey = '';
  private cleanup: (() => void)[] = [];
  /** Набранный текст в поле ответа — не терять при перерисовке. */
  private draft = '';

  mount(root: HTMLElement, ctx: ViewCtx<Action>) {
    this.ctx = ctx;
    preloadArt();
    this.wrap = h(`<div class="vk-wrap${ctx.demo ? ' demo' : ''}">
      <div class="vk-top"><span class="vk-mode"></span><span class="vk-timer"><i></i></span></div>
      <div class="vk-stage"></div>
      <div class="vk-banner"></div>
    </div>`);
    this.wrap.style.setProperty('--bg', `url(${ART.bg})`);
    this.wrap.style.setProperty('--bg-tall', `url(${ART.bgTall})`);
    this.wrap.style.setProperty('--panel', `url(${ART.panel})`);
    this.wrap.style.setProperty('--plate', `url(${ART.plate})`);
    this.wrap.style.setProperty('--tile', `url(${ART.tile})`);
    this.wrap.style.setProperty('--podium', `url(${ART.podium})`);
    root.appendChild(this.wrap);
    this.stage = this.wrap.querySelector('.vk-stage') as HTMLElement;
    this.bar = this.wrap.querySelector('.vk-mode') as HTMLElement;
    this.timerEl = this.wrap.querySelector('.vk-timer') as HTMLElement;
    this.banner = this.wrap.querySelector('.vk-banner') as HTMLElement;
    this.box = h(`<div class="vk-controls"></div>`);
    ctx.controls.appendChild(this.box);
    if (!ctx.demo) {
      ctx.controls.appendChild(
        segRow(
          '♪ Музыка',
          [
            ['on', 'вкл'],
            ['off', 'выкл'],
          ],
          () => (this.musicOn() ? 'on' : 'off'),
          (x) => {
            store.set(PREF_MUSIC, x);
            this.syncMusic();
          }
        )
      );
      // клавиши кнопки за одним экраном: 1…8 — место по порядку
      const onKey = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        const v = this.v;
        if (!v || e.repeat) return;
        const n = Number(e.key);
        if (v.phase === 'buzz' && n >= 1 && n <= 8) {
          const mine = this.mineFree();
          const seat = mine.length > 1 ? mine.find((x) => v.seats.indexOf(x) === n - 1) : undefined;
          if (seat != null) {
            e.preventDefault();
            this.press(seat, e);
          }
        }
        if ((v.phase === 'q' && (v.mode === 'trivia' || v.mode === 'truth' || v.mode === 'ladder')) || (v.phase === 'answer' && v.q?.opts)) {
          const k = 'abcd'.indexOf(e.key.toLowerCase());
          const k2 = n >= 1 && n <= 4 ? n - 1 : -1;
          const i = k >= 0 ? k : k2;
          if (i >= 0 && v.q?.opts && i < v.q.opts.length) {
            const seat = this.mineFree()[0];
            if (seat != null) {
              e.preventDefault();
              this.choose(seat, i, e);
            }
          }
        }
      };
      window.addEventListener('keydown', onKey);
      this.cleanup.push(() => window.removeEventListener('keydown', onKey));
      const vis = () => this.syncMusic();
      document.addEventListener('visibilitychange', vis);
      this.cleanup.push(() => document.removeEventListener('visibilitychange', vis));
    }
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    this.raf = requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- музыка

  private musicOn = () => store.get<string>(PREF_MUSIC, 'on') !== 'off';
  private syncMusic() {
    const v = this.v;
    const want = this.musicOn() && !this.ctx.demo && !!v && v.phase !== 'over' && !document.hidden;
    if (!want) {
      this.music?.pause();
      return;
    }
    if (!this.music) {
      this.music = new Audio(MUSIC[this.track % MUSIC.length]);
      this.music.volume = 0.22;
      this.music.onended = () => {
        this.track++;
        this.music = null;
        this.syncMusic();
      };
      this.music.onerror = () => {
        this.music = null;
      };
    }
    if (this.music.paused) void this.music.play().catch(() => {});
  }

  // ---------------------------------------------------------------- время

  /** Мои места, которые могут действовать сейчас. */
  private mineFree(): number[] {
    return this.inter.filter((x) => this.toAct.includes(x));
  }


  private tick() {
    const v = this.v;
    if (!v || this.ctx.demo) {
      this.timerEl.classList.remove('on');
      return;
    }
    const now = roomNow();
    let end = 0;
    let start = 0;
    let label = '';
    if (v.phase === 'buzz' && v.bz) {
      if (now < v.bz.openAt) {
        start = v.bz.shown;
        end = v.bz.openAt;
        label = 'читаем';
      } else {
        start = v.bz.openAt;
        end = v.bz.until;
      }
      const open = now >= v.bz.openAt;
      if (open !== this.wrap.classList.contains('open')) {
        this.wrap.classList.toggle('open', open);
        if (open) beep(880, 0.12, 0.12);
        this.renderBuzzer();
      }
    } else if ((v.phase === 'q' || v.phase === 'answer' || v.phase === 'say' || v.phase === 'fword') && v.deadline) {
      start = v.phase === 'q' ? v.openAt : v.deadline - 30_000;
      end = v.deadline;
    } else if (v.phase === 'reveal') {
      start = v.revealUntil - 3200;
      end = v.revealUntil;
    }
    if (!end || !v.now) {
      this.timerEl.classList.remove('on');
      return;
    }
    const left = Math.max(0, end - now);
    const frac = Math.max(0, Math.min(1, left / Math.max(1, end - start)));
    this.timerEl.classList.add('on');
    (this.timerEl.firstElementChild as HTMLElement).style.width = `${frac * 100}%`;
    this.timerEl.dataset.t = v.phase === 'reveal' ? '' : label || `${Math.ceil(left / 1000)}`;
    this.timerEl.classList.toggle('late', left < 3000 && v.phase !== 'reveal');
  }

  // ---------------------------------------------------------------- отрисовка

  setView(v: View) {
    this.v = v;
    this.sentKey = '';
    this.draw();
    this.syncMusic();
  }

  async play(events: Event[], v: View) {
    const sp = Math.max(0.25, this.ctx.speed());
    for (const ev of events) {
      switch (ev.k) {
        case 'spin': {
          this.v = { ...v, wh: v.wh ? { ...v.wh, sector: ev.sector, spins: ev.spins, f: ev.f } : v.wh, phase: 'spin' };
          this.draw();
          await this.spinTo(ev.sector, ev.f, sp);
          break;
        }
        case 'buzzed':
          buzzSound(ev.seat);
          this.flash(`${this.plain(ev.seat)} — первым!${ev.lead != null ? ` <small>на ${ev.lead} мс раньше</small>` : ''}`, 1600);
          break;
        case 'early':
          Sound.nomove();
          break;
        case 'right':
        case 'climb':
          Sound.home();
          break;
        case 'wrong':
        case 'timeout':
        case 'fall':
          Sound.nomove();
          break;
        case 'letter':
          if (ev.n) Sound.pen(Math.min(3, ev.n));
          else Sound.nomove();
          break;
        case 'bankrupt':
          Sound.nomove();
          this.flash('Банкрот!', 1200);
          break;
        case 'say':
          if (ev.hit >= 0) Sound.capture();
          else Sound.nomove();
          break;
        case 'strike':
          this.flash('✖'.repeat(ev.n), 900);
          break;
        case 'reveal':
          Sound.turn();
          break;
        case 'word':
          if (ev.ok) Sound.win();
          else Sound.nomove();
          break;
        case 'end':
          Sound.win();
          break;
        case 'q':
          Sound.card();
          break;
      }
    }
    this.v = v;
    this.sentKey = '';
    this.draw();
    this.syncMusic();
    if (this.ctx.demo) await sleep(300 / sp);
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.toAct = toAct;
    this.inter = interactive.length ? interactive : this.ctx.mySeats;
    this.draw();
  }

  status(v: View, toAct: number[], interactive: number[]): string {
    const me = interactive.filter((x) => toAct.includes(x));
    if (v.phase === 'over') return 'Игра окончена';
    if (!v.now && !this.ctx.demo && v.phase === 'buzz') return 'Начинаем…';
    switch (v.phase) {
      case 'buzz':
        return me.length ? (roomNow() < (v.bz?.openAt ?? 0) ? 'Читаем вопрос — ждите сигнала' : 'Жмите кнопку!') : 'Кнопка…';
      case 'answer':
        return me.includes(v.answerer) ? 'Ваш ответ!' : `Отвечает ${this.plain(v.answerer)}`;
      case 'spin':
        return me.length ? 'Крутите барабан' : `Крутит ${this.plain(v.wh!.turn)}`;
      case 'letter':
        return me.length ? 'Назовите букву (или слово целиком)' : `Букву называет ${this.plain(v.wh!.turn)}`;
      case 'plus':
        return me.length ? 'Откройте любую букву — нажмите на клетку' : '«Плюс»';
      case 'pick':
        return me.length ? 'Выберите вопрос на табло' : `Вопрос выбирает ${this.plain(v.bd!.chooser)}`;
      case 'say':
        return me.length ? 'Ваш ответ — с клавиатуры' : `Отвечает ${this.plain(v.pl!.speaker)}`;
      case 'reveal':
        return 'Ответ';
      default:
        return me.length ? 'Ваш ответ' : '';
    }
  }

  saveTitle(v: View) {
    return `${modeName(v.mode)} · ${v.mode === 'ladder' ? `ступень ${v.n}` : `вопрос ${Math.max(1, v.n)}`}`;
  }

  playerStats(v: View, seat: number) {
    if (v.mode === 'ladder') return `${rub(v.ld?.won[seat] ?? 0)} ₽`;
    return `${v.scores[seat] ?? 0} очк.`;
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  private flash(html: string, ms: number) {
    this.banner.innerHTML = html;
    this.banner.classList.add('on');
    clearTimeout((this.banner as unknown as { t?: number }).t);
    (this.banner as unknown as { t?: number }).t = window.setTimeout(() => this.banner.classList.remove('on'), ms / Math.max(0.25, this.ctx.speed()));
  }

  private send(seat: number, a: Action) {
    Sound.unlock();
    const key = JSON.stringify([seat, a.type, this.v?.n, this.v?.phase]);
    // двойное касание не шлёт ход дважды
    if (key === this.sentKey && a.type !== 'letter' && a.type !== 'buzz') return;
    this.sentKey = key;
    this.ctx.act(seat, a);
  }

  private press(seat: number, e?: Event | { timeStamp?: number }) {
    this.send(seat, { type: 'buzz', at: eventTime(e as { timeStamp?: number }) });
    buzzSound(seat);
    const b = this.stage.querySelector(`.vk-buzzer[data-seat="${seat}"]`);
    b?.classList.add('hit');
  }

  private choose(seat: number, i: number, e?: { timeStamp?: number }) {
    const v = this.v!;
    if (v.phase === 'answer') this.send(seat, { type: 'pick', i });
    else this.send(seat, { type: 'answer', i, at: eventTime(e) });
  }

  private draw() {
    const v = this.v;
    if (!v) return;
    this.wrap.dataset.mode = v.mode;
    this.wrap.dataset.phase = v.phase;
    const counter =
      v.mode === 'trivia' || v.mode === 'truth' || v.mode === 'buzz'
        ? ` · вопрос ${Math.min(v.total, Math.max(1, v.n))} из ${v.total}`
        : v.mode === 'wheel' && v.wh
          ? v.wh.final
            ? ' · финал'
            : ` · тур ${v.wh.round + 1} из ${v.wh.rounds}`
          : v.mode === 'poll' && v.pl
            ? ` · раунд ${v.pl.round + 1} из ${v.pl.rounds}${v.pl.reverse ? ' (обратный)' : ` ×${v.pl.mult}`}`
            : v.mode === 'board' && v.bd
              ? ` · раунд ${v.bd.round + 1} из ${v.bd.rounds}`
              : '';
    this.bar.innerHTML = `<b>${modeName(v.mode)}</b>${counter}${v.q && v.mode !== 'board' ? ` · <span class="vk-topic">${esc(topicName(v.q.t))}</span>` : ''}`;
    const keepWheel = v.mode === 'wheel' && this.wheelEl;
    if (keepWheel) this.wheelEl!.remove();
    let html = '';
    switch (v.mode) {
      case 'trivia':
      case 'truth':
        html = this.quiz(v);
        break;
      case 'buzz':
        html = this.buzzMode(v);
        break;
      case 'ladder':
        html = this.ladder(v);
        break;
      case 'wheel':
        html = this.wheel(v);
        break;
      case 'poll':
        html = this.poll(v);
        break;
      case 'board':
        html = this.board(v);
        break;
    }
    if (v.phase === 'over') html = this.over(v);
    this.stage.innerHTML = html + (v.phase === 'over' ? '' : this.podiums(v));
    this.bind(v);
    this.renderBuzzer();
    this.controls(v);
  }

  // ---------------------------------------------------------------- части экрана

  private qPanel(text: string, sub = '') {
    return `<div class="vk-q"><div class="vk-qtext">${esc(text)}</div>${sub}</div>`;
  }

  private options(v: View, opts: string[], hidden: number[] = []) {
    const last = v.last;
    const reveal = v.phase === 'reveal' && last && last.ok != null;
    const myAns = this.inter.map((x) => v.answered[x]).find(Boolean);
    const can = this.mineFree().length > 0 && (v.phase === 'q' || v.phase === 'answer');
    return `<div class="vk-opts${opts.length === 2 ? ' two' : ''}">${opts
      .map((o, i) => {
        const cls = [
          'vk-opt',
          hidden.includes(i) ? 'gone' : '',
          reveal && i === last!.ok ? 'ok' : '',
          reveal && last!.pick === i && i !== last!.ok ? 'bad' : '',
          v.last?.kind === 'wrong' && v.last.pick === i ? 'bad' : '',
          myAns?.i === i ? 'mine' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const who = reveal
          ? v.seats
              .filter((x) => v.answered[x]?.i === i)
              .map((x) => `<i style="background:${SEATS[x].color}"></i>`)
              .join('')
          : '';
        return `<button class="${cls}" data-opt="${i}" ${can && !hidden.includes(i) ? '' : 'disabled'}><em>${opts.length === 2 ? '' : LETTERS[i] + ':'}</em> <span>${esc(o)}</span><b class="who">${who}</b></button>`;
      })
      .join('')}</div>`;
  }

  private revealLine(v: View) {
    const l = v.last;
    if (!l || v.phase !== 'reveal') return '';
    const gains = l.gains
      ? Object.entries(l.gains)
          .map(([s, g]) => `<span style="color:${SEATS[+s].light}">${esc(this.plain(+s))} ${g > 0 ? '+' : ''}${g}</span>`)
          .join(' ')
      : '';
    return `<div class="vk-reveal">${l.ans ? `Ответ: <b>${esc(l.ans)}</b>` : ''} ${gains}</div>`;
  }

  private quiz(v: View) {
    if (!v.q) return '';
    const sub = v.mode === 'truth' ? '<div class="vk-qsub">Верите?</div>' : '';
    return `${this.qPanel(v.q.text, sub)}${this.options(v, v.q.opts ?? [])}${this.revealLine(v)}`;
  }

  private buzzMode(v: View) {
    if (!v.q) return '';
    let mid = '';
    if (v.phase === 'buzz') mid = this.buzzers(v);
    else if (v.phase === 'answer') {
      mid = `<div class="vk-who">Отвечает ${this.ctx.name(v.answerer)}${v.last?.lead != null ? ` <small>— нажал на ${v.last.lead} мс раньше</small>` : ''}</div>`;
      mid += v.q.opts ? this.options(v, v.q.opts) : this.inputBox(v, v.answerer, 'Ответ…');
    } else mid = this.revealLine(v);
    const wrong = v.last?.kind === 'wrong' && v.phase === 'buzz' ? `<div class="vk-note">${this.ctx.name(v.last.seat!)}: «${esc(v.last.said || '—')}» — неверно</div>` : '';
    return `${this.qPanel(v.q.text)}${wrong}${mid}`;
  }

  private buzzers(v: View) {
    const mine = this.mineFree();
    const bz = v.bz!;
    const pressed = bz.presses.map((p) => p.seat);
    if (!mine.length) {
      const st = this.inter.filter((x) => pressed.includes(x)).length ? 'Нажато — ждём остальных…' : this.inter.some((x) => bz.tried.includes(x)) ? 'Вы уже отвечали на этот вопрос' : 'Кнопка у других';
      return `<div class="vk-buzzrow"><div class="vk-buzzer off" style="--b:url(${ART.buzzer})"></div></div><div class="vk-note">${st}</div>`;
    }
    const many = mine.length > 1;
    return `<div class="vk-buzzrow">${mine
      .map(
        (x) =>
          `<button class="vk-buzzer" data-seat="${x}" style="--b:url(${ART.buzzer});--lit:url(${ART.buzzerLit})" aria-label="Кнопка">${many ? `<span style="color:${SEATS[x].light}">${esc(this.plain(x))} · ${v.seats.indexOf(x) + 1}</span>` : ''}</button>`
      )
      .join('')}</div>${mine.length && !many ? '<div class="vk-note">Пробел или касание — по сигналу</div>' : many ? '<div class="vk-note">Клавиши 1…8 — у каждого своя</div>' : ''}`;
  }

  private renderBuzzer() {
    const v = this.v;
    if (!v?.bz) return;
    const open = roomNow() >= v.bz.openAt && !!v.now;
    this.stage.querySelectorAll<HTMLElement>('.vk-buzzer').forEach((b) => {
      const seat = Number(b.dataset.seat);
      const blocked = (v.bz!.block[seat] ?? 0) > roomNow();
      b.classList.toggle('lit', open && !blocked && !b.classList.contains('off'));
      b.classList.toggle('blocked', blocked);
    });
  }

  private inputBox(v: View, seat: number, ph: string) {
    const mine = this.mineFree().includes(seat);
    if (!mine) return '';
    return `<form class="vk-input" data-seat="${seat}"><input type="text" maxlength="40" autocomplete="off" placeholder="${ph}" value="${esc(this.draft)}"><button class="btn primary">Ответить</button></form>`;
  }

  private ladder(v: View) {
    const ld = v.ld!;
    if (!v.q) return '';
    const rows = LADDER_SUM.map((s, i) => `<li class="${i === ld.step ? 'cur' : ''}${i < ld.step ? ' done' : ''}${SAFE.includes(i) ? ' safe' : ''}"><em>${i + 1}</em> ${rub(s)}</li>`)
      .reverse()
      .join('');
    const hall = ld.hall
      ? `<div class="vk-hall">${ld.hall.map((p, i) => `<div><i style="height:${p}%"></i><b>${p}%</b><em>${LETTERS[i]}</em></div>`).join('')}</div>`
      : '';
    const call = ld.call ? `<div class="vk-call">📞 Друг: «Думаю, ${LETTERS[ld.call.i]} — ${esc(v.q.opts![ld.call.i])}. Уверен процентов на ${ld.call.sure}».</div>` : '';
    const who = v.seats.length > 1 ? `<div class="vk-who">Лестница: ${this.ctx.name(ld.seat)}</div>` : '';
    return `<div class="vk-ladder"><div class="vk-lmain">${who}${this.qPanel(v.q.text)}${hall}${call}${this.options(v, v.q.opts ?? [], ld.hidden)}${this.revealLine(v)}</div>
      <ol class="vk-money">${rows}</ol></div>`;
  }

  private wheel(v: View) {
    const wh = v.wh!;
    const tiles = wh.mask.map((c, i) => `<span class="vk-tile${c ? ' open' : ''}" data-pos="${i}">${c || ''}</span>`).join('');
    const sec = wh.sector != null ? SECTORS[wh.sector] : null;
    const secTxt = sec == null ? '' : sec === 'Б' ? 'Банкрот' : sec === '0' ? 'Ноль' : sec === 'П' ? 'Приз' : sec === '+' ? 'Плюс' : sec === 'x2' ? '×2' : `${sec} очков`;
    const rs = v.seats.map((x) => `<span style="color:${SEATS[x].light}">${esc(this.plain(x))}: ${wh.final ? v.scores[x] : wh.rs[x] ?? 0}</span>`).join(' · ');
    return `<div class="vk-wheelbox"><div class="vk-wheelslot"></div>
      <div class="vk-wside"><div class="vk-hint">${esc(wh.hint)}</div><div class="vk-tiles">${tiles}</div>
      ${secTxt ? `<div class="vk-sector">На барабане: <b>${secTxt}</b></div>` : ''}
      <div class="vk-rs">${wh.final ? `Финал — ${this.ctx.name(wh.finalist)}: три буквы и слово целиком` : `Счёт тура: ${rs}`}</div>
      ${this.letterPad(v)}</div></div>`;
  }

  private letterPad(v: View) {
    const wh = v.wh!;
    const mine = this.mineFree();
    if (!mine.length) return '';
    const seat = mine[0];
    if (v.phase === 'letter' || v.phase === 'final') {
      const keys = [...ALPHABET]
        .filter((l) => l !== 'Ё')
        .map((l) => `<button class="vk-key" data-l="${l}" ${wh.named.includes(l) ? 'disabled' : ''}>${l}</button>`)
        .join('');
      return `<div class="vk-keys">${keys}</div>${v.phase === 'letter' ? this.wordBox(seat) : ''}`;
    }
    if (v.phase === 'spin') return this.wordBox(seat);
    if (v.phase === 'fword') return `<form class="vk-input vk-word" data-seat="${seat}"><input type="text" maxlength="20" autocomplete="off" placeholder="Слово целиком" value="${esc(this.draft)}"><button class="btn primary">Это слово!</button></form>`;
    return '';
  }

  private wordBox(seat: number) {
    return `<details class="vk-wordbox"><summary>Назвать слово целиком</summary><form class="vk-input vk-word" data-seat="${seat}"><input type="text" maxlength="20" autocomplete="off" placeholder="Слово" value="${esc(this.draft)}"><button class="btn">Назвать</button></form><small>Неверно — выбываете из тура.</small></details>`;
  }

  private poll(v: View) {
    const pl = v.pl;
    if (!pl) return '';
    const rows = pl.rows
      .map((r, i) => `<li class="${r ? 'open' : ''}"><em>${i + 1}</em><span>${r ? esc(r.text) : ''}</span><b>${r ? (pl.reverse ? r.pts : r.n) : ''}</b></li>`)
      .join('');
    const teams =
      pl.teams.length > 1
        ? `<div class="vk-teams">${pl.teams
            .map((t, k) => `<span class="${k === pl.team ? 'cur' : ''}">Команда ${k + 1}: ${t.map((x) => `<b style="color:${SEATS[x].color}">${esc(this.plain(x))}</b>`).join(', ')}</span>`)
            .join('')}</div>`
        : '';
    const said = v.last && (v.last.kind === 'wrong' || v.last.kind === 'right') && v.last.said != null ? `<div class="vk-note">${this.ctx.name(v.last.seat!)}: «${esc(v.last.said || '—')}»${v.last.kind === 'right' ? ' — есть!' : ' — нет на табло'}</div>` : '';
    return `${this.qPanel(`Мы спросили сто человек: ${pl.q}`)}${teams}
      <div class="vk-pollbox"><ol class="vk-poll" style="--rows:${Math.ceil(pl.rows.length / 2)}">${rows}</ol>
      <div class="vk-pside"><div class="vk-strikes">${[0, 1, 2].map((i) => `<i class="${i < pl.strikes ? 'on' : ''}">✖</i>`).join('')}</div>
      <div class="vk-bank">Банк: <b>${pl.bank}</b></div>${pl.steal ? '<div class="vk-steal">Отыгрыш!</div>' : ''}</div></div>
      ${said}${v.phase === 'say' ? this.inputBox(v, pl.speaker, 'Что ответили люди?') : ''}`;
  }

  private board(v: View) {
    const bd = v.bd!;
    const pickable = v.phase === 'pick' && this.mineFree().includes(bd.chooser);
    if (v.phase === 'pick' || !bd.cell) {
      const grid = bd.themes
        .map(
          (t, th) =>
            `<div class="vk-brow"><div class="vk-theme">${esc(t)}</div>${BOARD_PRICES.map((p, k) => {
              const used = bd.used[th * 5 + k];
              return `<button class="vk-cell${used ? ' used' : ''}" data-th="${th}" data-k="${k}" ${pickable && !used ? '' : 'disabled'}>${used ? '' : p * (bd.round + 1)}</button>`;
            }).join('')}</div>`
        )
        .join('');
      return `<div class="vk-board">${grid}</div>`;
    }
    const th = bd.themes[bd.cell[0]];
    const head = `<div class="vk-cellhead">«${esc(th)}» за ${bd.price}</div>`;
    let mid = '';
    if (v.phase === 'buzz') mid = this.buzzers(v);
    else if (v.phase === 'answer') {
      mid = v.seats.length > 1 ? `<div class="vk-who">Отвечает ${this.ctx.name(v.answerer)}${v.last?.lead != null ? ` <small>— на ${v.last.lead} мс раньше</small>` : ''}</div>` : '';
      mid += v.q?.opts ? this.options(v, v.q.opts) : this.inputBox(v, v.answerer, 'Ответ…');
    } else mid = this.revealLine(v);
    const wrong = v.last?.kind === 'wrong' && v.phase === 'buzz' ? `<div class="vk-note">${this.ctx.name(v.last.seat!)}: «${esc(v.last.said || '—')}» — неверно</div>` : '';
    return `${head}${this.qPanel(v.q?.text ?? '')}${wrong}${mid}`;
  }

  private podiums(v: View) {
    const lamp = (x: number) => {
      if (v.phase === 'q' && v.answered[x]) return 'on';
      if (v.bz && v.phase === 'buzz' && v.bz.presses.some((p) => p.seat === x)) return 'on';
      if (v.answerer === x && v.phase === 'answer') return 'hot';
      if (v.mode === 'wheel' && v.wh && (v.wh.turn === x || v.wh.finalist === x) && v.phase !== 'reveal') return 'hot';
      if (v.mode === 'poll' && v.pl && v.pl.speaker === x && v.phase === 'say') return 'hot';
      if (v.mode === 'ladder' && v.ld?.seat === x) return 'hot';
      if (v.mode === 'board' && v.bd?.chooser === x && v.phase === 'pick') return 'hot';
      return '';
    };
    const score = (x: number) => (v.mode === 'ladder' ? `${rub(v.ld?.won[x] ?? 0)} ₽` : String(v.scores[x] ?? 0));
    const out = (x: number) => (v.mode === 'wheel' && v.wh?.out.includes(x)) || (v.bz && v.phase === 'buzz' && v.bz.tried.includes(x));
    return `<div class="vk-podiums">${v.seats
      .map(
        (x) => `<div class="vk-pod ${lamp(x)}${out(x) ? ' out' : ''}" data-cam="${x}" style="--c:${SEATS[x].color}">
          <div class="vk-pbody"><div class="vk-pscreen"><b>${score(x)}</b></div></div><div class="vk-pname">${esc(this.plain(x))}</div></div>`
      )
      .join('')}</div>`;
  }

  private over(v: View) {
    const best = Math.max(...v.seats.map((x) => v.scores[x]));
    const rows = v.seats
      .slice()
      .sort((a, b) => v.scores[b] - v.scores[a])
      .map((x) => `<li class="${v.scores[x] === best ? 'win' : ''}">${this.ctx.name(x)} <b>${v.mode === 'ladder' ? rub(v.scores[x]) + ' ₽' : v.scores[x]}</b></li>`)
      .join('');
    return `<div class="vk-q vk-over"><div class="vk-qtext">Игра окончена</div><ol class="vk-final">${rows}</ol></div>`;
  }

  // ---------------------------------------------------------------- барабан

  private ensureWheel(): HTMLElement {
    if (!this.wheelEl) {
      this.wheelEl = h(`<div class="vk-wheel"><div class="vk-disc" style="background-image:url(${ART.wheel})"></div><div class="vk-pointer" style="background-image:url(${ART.pointer})"></div></div>`);
      this.bindWheelGesture(this.wheelEl);
    }
    return this.wheelEl;
  }

  private setRot(deg: number, ms: number) {
    const d = this.ensureWheel().firstElementChild as HTMLElement;
    d.style.transition = ms ? `transform ${ms}ms cubic-bezier(.12,.6,.18,1)` : 'none';
    d.style.transform = `rotate(${deg}deg)`;
    this.rot = deg;
  }

  private async spinTo(sector: number, f: number, sp: number) {
    const step = 360 / SECTORS.length;
    const target = -sector * step;
    const turns = 3 + Math.round(f * 4);
    let next = this.rot + turns * 360;
    next = next - (((next - target) % 360) + 360) % 360;
    if (next <= this.rot + 360) next += 360;
    const ms = Math.round((2600 + f * 1600) / sp);
    // треск колышков
    const ticks = Math.min(60, Math.round((next - this.rot) / step));
    for (let i = 0; i < ticks; i++) window.setTimeout(() => beep(1800, 0.012, 0.05), ms * (1 - Math.pow(1 - i / ticks, 0.45)));
    this.setRot(next, ms);
    this.spinsShown = this.v?.wh?.spins ?? this.spinsShown;
    await sleep(ms + 150);
  }

  private bindWheelGesture(el: HTMLElement) {
    let down: { x: number; y: number; t: number } | null = null;
    let last: { x: number; y: number; t: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      if (!this.canSpin()) return;
      down = last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (down) last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    });
    el.addEventListener('pointerup', (e) => {
      if (!down || !last) return;
      const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = Math.max(16, e.timeStamp - down.t);
      down = null;
      if (dist < 25) return;
      // сила — по быстроте взмаха
      const f = Math.max(0.1, Math.min(1, dist / dt / 2.2));
      this.doSpin(f);
    });
  }

  private canSpin() {
    const v = this.v;
    return !!v && v.phase === 'spin' && this.mineFree().includes(v.wh!.turn) && !this.ctx.demo;
  }

  private doSpin(f: number) {
    if (!this.canSpin()) return;
    this.send(this.v!.wh!.turn, { type: 'spin', f });
  }

  // ---------------------------------------------------------------- ввод

  private bind(v: View) {
    if (v.mode === 'wheel' && v.phase !== 'over') {
      const slot = this.stage.querySelector('.vk-wheelslot');
      const w = this.ensureWheel();
      slot?.appendChild(w);
      w.classList.toggle('can', this.canSpin());
      // первый показ (вход в партию, загрузка): барабан сразу стоит на последнем секторе
      if (this.spinsShown < 0) {
        this.spinsShown = v.wh?.spins ?? 0;
        if (v.wh?.sector != null) this.setRot(-v.wh.sector * (360 / SECTORS.length), 0);
      }
    }
    if (this.ctx.demo) return;
    this.stage.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b) =>
      b.addEventListener('click', (e) => {
        const seat = this.mineFree()[0];
        if (seat != null) this.choose(seat, Number(b.dataset.opt), e);
      })
    );
    this.stage.querySelectorAll<HTMLButtonElement>('.vk-buzzer[data-seat]').forEach((b) => {
      const go = (e: PointerEvent | MouseEvent) => {
        e.preventDefault();
        if (b.classList.contains('hit')) return;
        this.press(Number(b.dataset.seat), e);
      };
      b.addEventListener('pointerdown', go);
    });
    this.stage.querySelectorAll<HTMLFormElement>('form.vk-input').forEach((f) => {
      const inp = f.querySelector('input')!;
      inp.addEventListener('input', () => (this.draft = inp.value));
      if (!('ontouchstart' in window)) setTimeout(() => inp.focus({ preventScroll: true }), 0);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = inp.value.trim();
        if (!text) return;
        const seat = Number(f.dataset.seat);
        this.draft = '';
        const ph = this.v!.phase;
        if (f.classList.contains('vk-word') || ph === 'fword') this.send(seat, { type: 'word', w: text });
        else this.send(seat, { type: 'say', text });
      });
    });
    this.stage.querySelectorAll<HTMLButtonElement>('.vk-key').forEach((b) =>
      b.addEventListener('click', () => {
        const seat = this.mineFree()[0];
        if (seat != null) this.send(seat, { type: 'letter', l: b.dataset.l! });
      })
    );
    if (v.phase === 'plus' && this.mineFree().length)
      this.stage.querySelectorAll<HTMLElement>('.vk-tile:not(.open)').forEach((t) => {
        t.classList.add('pickable');
        t.addEventListener('click', () => this.send(this.mineFree()[0], { type: 'plus', pos: Number(t.dataset.pos) }));
      });
    this.stage.querySelectorAll<HTMLButtonElement>('.vk-cell[data-th]').forEach((b) =>
      b.addEventListener('click', () => {
        const seat = this.mineFree()[0];
        if (seat != null) this.send(seat, { type: 'cell', th: Number(b.dataset.th), k: Number(b.dataset.k) });
      })
    );
  }

  /** Боковая панель: главная кнопка хода (data-tap: пробел и касание по полю), подсказки лестницы, «Дальше». */
  private controls(v: View) {
    this.box.innerHTML = '';
    if (this.ctx.demo || v.phase === 'over') return;
    const mine = this.mineFree();
    const add = (html: string, fn: (e: MouseEvent) => void) => {
      const b = h<HTMLButtonElement>(html);
      b.onclick = fn;
      this.box.appendChild(b);
      return b;
    };
    if (v.phase === 'buzz' && mine.length === 1) {
      add(`<button class="btn primary vk-bigbtn" data-tap>🔴 Кнопка!</button>`, (e) => {
        const b = this.stage.querySelector('.vk-buzzer[data-seat]');
        if (b?.classList.contains('hit')) return;
        this.press(mine[0], e);
      });
      add(`<button class="btn">Не знаю</button>`, () => this.send(mine[0], { type: 'pass' }));
    }
    if (v.phase === 'spin' && mine.includes(v.wh!.turn)) add(`<button class="btn primary vk-bigbtn" data-tap>🎡 Крутить барабан</button>`, () => this.doSpin(0.45 + Math.random() * 0.4));
    if (v.mode === 'ladder' && v.phase === 'q' && mine.length) {
      const ld = v.ld!;
      const seat = mine[0];
      const row = h(`<div class="vk-lifes"></div>`);
      for (const [k, label, title] of [
        ['fifty', '50:50', 'Убрать два неверных'],
        ['hall', '👥', 'Помощь зала'],
        ['call', '📞', 'Звонок другу'],
      ] as const) {
        const b = h<HTMLButtonElement>(`<button class="btn vk-life" title="${title}" ${ld.life[k] ? '' : 'disabled'}>${label}</button>`);
        b.onclick = () => this.send(seat, { type: 'life', k });
        row.appendChild(b);
      }
      this.box.appendChild(row);
      if (ld.step > 0) add(`<button class="btn">Забрать ${rub(ld.won[seat] ?? 0)} ₽</button>`, () => confirm('Забрать деньги и закончить лестницу?') && this.send(seat, { type: 'take' }));
    }
    if (v.phase === 'answer' && mine.includes(v.answerer) && !v.q?.opts) add(`<button class="btn">Не знаю</button>`, () => this.send(v.answerer, { type: 'pass' }));
    if (v.phase === 'reveal') {
      const humans = this.ctx.mySeats;
      if (humans.length === 1 && v.humans === 1) {
        const seat = humans[0];
        add(`<button class="btn primary" data-tap>Дальше ▶</button>`, () => this.send(seat, { type: 'next' }));
      }
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
    this.music?.pause();
    this.music = null;
  }
}

export const createView = (): GameView<View, Event> => new VikView();
