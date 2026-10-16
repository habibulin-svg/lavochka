/* Карты против человечества — отрисовка: чёрный стол, наверху игроки (очки, корона Царя, кто уже положил),
 * в середине чёрная карта и ответы — рубашкой вверх, на суде вперемешку и без имён, после — с именами; внизу своя рука.
 * Карты — как в оригинале: белые и чёрные, жирный гротеск, логотип внизу, на чёрных — значки PICK/DRAW.
 * Хот-сит: руку каждый смотрит за занавеской; Царь выбирает при всех. Пустые карты — поле для своего ответа. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from './def';
import { BLACK, fillParts, isBlank, RANDO, whiteText, type Event, type View } from './engine';
import './cah.css';

const size = (t: string) => (t.length > 110 ? ' cah-xs' : t.length > 70 ? ' cah-s' : '');

/** Белая карта. extra — классы, inner — что положить поверх (номер, поле ввода). */
function whiteCard(id: number, texts: Record<number, string> | undefined, extra = '', inner = ''): string {
  const t = whiteText(id, texts);
  const blank = isBlank(id);
  return `<div class="cah-card cah-w${blank ? ' cah-blankcard' : ''}${size(t)}${extra}" data-card="${id}">
    <div class="cah-t">${blank && !t ? '' : esc(t)}</div>${inner}<div class="cah-foot"><img src="/cah/logo-black.webp" alt="Cards Against Humanity"></div></div>`;
}

/** Чёрная карта: пропуски — линией; значки «PICK n» и «DRAW n». */
function blackCard(b: number, extra = ''): string {
  const c = BLACK[b];
  if (!c) return '';
  const t = esc(c.t).replace(/_/g, '<span class="cah-ln"></span>');
  const badges = `${c.draw ? `<span class="cah-badge">DRAW <i>${c.draw}</i></span>` : ''}${c.pick > 1 ? `<span class="cah-badge">PICK <i>${c.pick}</i></span>` : ''}`;
  return `<div class="cah-card cah-b${size(c.t)}${extra}"><div class="cah-t">${t}</div><div class="cah-foot"><img src="/cah/logo-white.webp" alt="Cards Against Humanity"><span class="cah-badges">${badges}</span></div></div>`;
}

const back = (white: boolean, extra = '') => `<div class="cah-card ${white ? 'cah-w' : 'cah-b'} cah-back${extra}"><div class="cah-t">Cards<br>Against<br>Humanity</div></div>`;

/** Зачитать: чёрная карта с подставленными ответами. */
function readHTML(black: number, u: { cards: number[]; texts?: Record<number, string> }): string {
  return fillParts(
    black,
    u.cards.map((c) => whiteText(c, u.texts) || '…'),
  )
    .map((p) => (p.a ? `<u>${esc(p.t)}</u>` : esc(p.t)))
    .join('');
}

type Mode = 'main' | 'bet' | 'reboot';

class CahView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private root!: HTMLElement;
  private seatsEl!: HTMLElement;
  private mid!: HTMLElement;
  private readEl!: HTMLElement;
  private handEl!: HTMLElement;
  private histEl!: HTMLElement;
  private cover!: HTMLElement;
  private panel!: HTMLElement;
  private v: View | null = null;
  private interactive: number[] = [];
  /** Хот-сит: чья рука сейчас открыта (после занавески). */
  private open: number | null = null;
  private sel: number[] = [];
  private bet: number[] | null = null;
  private reb: number[] = [];
  private mode: Mode = 'main';
  private texts: Record<number, string> = {};
  /** Ответ, выбранный на суде (до подтверждения). */
  private focus: number | null = null;
  private fresh = false;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h(`<div class="cah-wrap"><div class="cah-scroll"><div class="cah-seats"></div><div class="cah-mid"></div><div class="cah-read" hidden></div>
      <div class="cah-hand"></div><div class="cah-hist"></div></div>
      <div class="cah-cover" hidden><div class="cah-cover-box"><div class="cah-cover-t"></div><div class="cah-cover-b"></div></div></div></div>`);
    root.appendChild(this.root);
    const q = (c: string) => this.root.querySelector(c) as HTMLElement;
    this.seatsEl = q('.cah-seats');
    this.mid = q('.cah-mid');
    this.readEl = q('.cah-read');
    this.handEl = q('.cah-hand');
    this.histEl = q('.cah-hist');
    this.cover = q('.cah-cover');
    this.panel = h('<div class="cah-panel"></div>');
    ctx.controls.appendChild(this.panel);
    this.handEl.addEventListener('click', (e) => {
      if ((e.target as Element).closest('textarea')) return;
      const el = (e.target as Element).closest('[data-card]') as HTMLElement | null;
      if (el) this.tapHand(+el.dataset.card!);
    });
    this.handEl.addEventListener('input', (e) => {
      const ta = e.target as HTMLTextAreaElement;
      if (ta.dataset.blank) {
        this.texts[+ta.dataset.blank] = ta.value;
        this.renderPanel();
      }
    });
    this.mid.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-sub]') as HTMLElement | null;
      if (el) this.tapSub(+el.dataset.sub!);
    });
    if (!ctx.demo) this.adult();
  }

  /** Предупреждение 18+ — раз за сеанс браузера. */
  private adult() {
    try {
      if (sessionStorage.getItem('cah-18')) return;
    } catch {
      /* без хранилища — спросим каждый раз */
    }
    const t = this.cover.querySelector('.cah-cover-t') as HTMLElement;
    const b = this.cover.querySelector('.cah-cover-b') as HTMLElement;
    t.innerHTML = `<div class="cah-18">18+</div><b>Игра для взрослых.</b><br><small>На картах — мат, секс, наркотики, смерть, политика и чёрный юмор обо всём на свете. Если вас это заденет — лучше выберите другую игру.</small>`;
    b.innerHTML = '';
    // пока не согласились — боты ждут
    this.ctx.hold?.(30000);
    const ok = h<HTMLButtonElement>('<button class="btn primary">Мне есть 18, играем</button>');
    ok.onclick = () => {
      this.ctx.hold?.(0);
      try {
        sessionStorage.setItem('cah-18', '1');
      } catch {
        /* ничего */
      }
      this.cover.hidden = true;
      this.redraw();
    };
    b.appendChild(ok);
    this.cover.hidden = false;
  }

  // ---------------------------------------------------------------- кто за экраном

  private plain(seat: number) {
    if (seat === RANDO) return 'Рандо Кардриссиан';
    return this.ctx.name(seat).replace(/<[^>]+>/g, '').replace(/\s*\(бот\)/, '');
  }
  private mine(v: View) {
    return this.ctx.demo ? [] : this.ctx.mySeats.filter((x) => v.seats.includes(x));
  }
  private hotseat(v: View) {
    return this.mine(v).length > 1;
  }
  /** Чья рука сейчас перед глазами. */
  private me(v: View): number | null {
    const m = this.mine(v);
    if (m.length === 1) return m[0];
    return this.open != null && m.includes(this.open) ? this.open : null;
  }
  private can(seat: number) {
    return this.interactive.includes(seat);
  }
  private covered() {
    return !this.cover.hidden;
  }
  private reset() {
    this.sel = [];
    this.bet = null;
    this.reb = [];
    this.mode = 'main';
    this.focus = null;
  }
  private send(seat: number, a: unknown) {
    if (this.v && this.hotseat(this.v)) this.open = null;
    this.reset();
    this.ctx.act(seat, a);
  }

  /** Хот-сит: занавеска «устройство у такого-то». */
  private curtain(seat: number) {
    const t = this.cover.querySelector('.cah-cover-t') as HTMLElement;
    const b = this.cover.querySelector('.cah-cover-b') as HTMLElement;
    t.innerHTML = `Устройство — ${this.ctx.name(seat)}.<br><small>Остальные — не подглядывать!</small>`;
    b.innerHTML = '';
    const ok = h<HTMLButtonElement>('<button class="btn primary">Это я, смотрю</button>');
    ok.onclick = () => {
      Sound.unlock();
      this.cover.hidden = true;
      this.open = seat;
      this.reset();
      this.redraw();
    };
    b.appendChild(ok);
    this.cover.hidden = false;
  }

  // ---------------------------------------------------------------- рисунок

  private redraw() {
    this.draw();
    this.renderPanel();
  }

  private draw() {
    const v = this.v;
    if (!v) return;
    this.drawSeats(v);
    this.drawMid(v);
    this.drawHand(v);
    this.drawHistory(v);
  }

  private drawSeats(v: View) {
    const me = this.me(v);
    const last = v.history[v.history.length - 1];
    const gain = v.phase === 'reveal' || v.phase === 'over' ? last?.gain ?? {} : {};
    const tag = (x: number) => {
      const out: string[] = [];
      if (x === v.czar && v.phase !== 'over') out.push('<span class="cah-tag cah-tag-czar">👑 Царь</span>');
      if (v.phase === 'play' && x !== v.czar) out.push(v.played.includes(x) ? '<span class="cah-tag cah-tag-ok">положил</span>' : '<span class="cah-tag cah-tag-wait">думает…</span>');
      if (v.phase === 'judge' && v.house.godless) out.push(v.voted.includes(x) ? '<span class="cah-tag cah-tag-ok">голос</span>' : '<span class="cah-tag cah-tag-wait">думает…</span>');
      const g = gain[x];
      if (g) out.push(`<span class="cah-tag ${g > 0 ? 'cah-tag-ok' : 'cah-tag-x'}">${g > 0 ? '+' : ''}${g}</span>`);
      return out.join('');
    };
    const chip = (x: number, score: number, color: string, extra = '') =>
      `<div class="cah-seat${x === me ? ' cah-me' : ''}${extra}" style="--c:${color}"><div class="cah-face">${x === RANDO ? '🎲' : esc(this.plain(x)).slice(0, 1)}</div>
        <div class="cah-name">${esc(this.plain(x))}</div><div class="cah-score" title="очки"><i></i>${score}</div><div class="cah-tags">${tag(x)}</div></div>`;
    let s = v.seats.map((x) => chip(x, v.scores[x] ?? 0, SEATS[x].color, x === v.czar ? ' cah-czar' : '')).join('');
    if (v.rando != null) s += chip(RANDO, v.rando, '#444', ' cah-rando');
    this.seatsEl.innerHTML = s;
    this.seatsEl.style.setProperty('--cols', String(Math.min(v.seats.length + (v.rando != null ? 1 : 0), 6)));
  }

  private drawMid(v: View) {
    const me = this.me(v);
    const head = `<div class="cah-round">${v.phase === 'over' ? 'Игра окончена' : v.final ? 'Последний раунд' : `Раунд ${v.round}`} · до ${v.goal} очков${v.house.godless ? ' · Бог умер' : ''}</div>`;
    const black = `<div class="cah-blackbox">${blackCard(v.black, this.fresh ? ' cah-new' : '')}</div>`;
    let area = '';
    if (v.phase === 'play') {
      const n = BLACK[v.black]?.pick ?? 1;
      const piles = v.played.map((x) => {
        const own = x === me ? v.mine[x] ?? [] : [];
        if (own.length) return own.map((u) => `<div class="cah-sub cah-mine">${u.cards.map((c) => whiteCard(c, u.texts)).join('')}<div class="cah-by">ваш${u.bet ? ' · залог' : ''}</div></div>`).join('');
        return `<div class="cah-sub">${Array.from({ length: n }, () => back(true)).join('')}</div>`;
      });
      area = piles.join('') || '<div class="cah-note">Ждём ответы…</div>';
    } else if (v.phase === 'judge' || v.phase === 'reveal') {
      const open = v.phase === 'reveal';
      area = v.subs
        .map((u, i) => {
          const win = open && v.win.includes(i);
          const showBy = u.by != null && (open || u.by === me);
          const by = showBy ? `<div class="cah-by">${win ? '🏆 ' : ''}${esc(this.plain(u.by!))}${u.bet ? ' · залог' : ''}</div>` : '';
          const pick = !open && this.canJudge(v) && !(v.house.godless && u.by === me && me != null);
          return `<div class="cah-sub${win ? ' cah-win' : ''}${this.focus === i ? ' cah-focus' : ''}${pick ? ' cah-can' : ''}" data-sub="${i}">${u.cards.map((c) => whiteCard(c, u.texts)).join('')}${by}</div>`;
        })
        .join('');
    } else if (v.phase === 'over') area = this.finalHTML(v);
    this.mid.innerHTML = `${head}<div class="cah-table">${black}<div class="cah-subs cah-n${BLACK[v.black]?.pick ?? 1}">${area}</div></div>`;
    // зачитать: выбранный на суде ответ или победитель
    const show = v.phase === 'judge' && this.focus != null ? v.subs[this.focus] : v.phase === 'reveal' && v.win.length ? v.subs[v.win[0]] : null;
    this.readEl.hidden = !show;
    if (show) this.readEl.innerHTML = `<div class="cah-readt">${readHTML(v.black, show)}</div>`;
    this.fresh = false;
  }

  private finalHTML(v: View): string {
    const rows = [...v.seats]
      .sort((a, b) => (v.scores[b] ?? 0) - (v.scores[a] ?? 0))
      .map((x) => `<div class="cah-fin"><b>${esc(this.plain(x))}</b> — ${v.scores[x] ?? 0}<span>${(v.trophies[x] ?? []).map((b) => `<i title="${esc(BLACK[b]?.t ?? '')}"></i>`).join('')}</span></div>`);
    if (v.rando != null) rows.push(`<div class="cah-fin"><b>Рандо Кардриссиан</b> — ${v.rando}</div>`);
    return `<div class="cah-final">${rows.join('')}</div>`;
  }

  private drawHand(v: View) {
    const me = this.me(v);
    if (this.ctx.demo || me == null || v.phase === 'over' || this.covered()) {
      this.handEl.innerHTML = this.hotseat(v) && v.phase !== 'over' ? '<div class="cah-note">Руки скрыты — каждый смотрит свою за занавеской.</div>' : '';
      return;
    }
    const hand = v.hands[me] ?? [];
    const playing = v.phase === 'play' && this.can(me) && !v.played.includes(me);
    const label = (c: number) => {
      if (this.mode === 'reboot') return this.reb.includes(c) ? '<b class="cah-num cah-num-x">✕</b>' : '';
      const i = this.sel.indexOf(c);
      if (i >= 0) return `<b class="cah-num">${i + 1}</b>`;
      const j = this.bet?.indexOf(c) ?? -1;
      if (j >= 0) return `<b class="cah-num cah-num-bet">З${j + 1}</b>`;
      return '';
    };
    const cards = hand
      .map((c) => {
        const picked = this.sel.includes(c) || !!this.bet?.includes(c) || this.reb.includes(c);
        const inner = label(c) + (isBlank(c) && playing ? `<textarea data-blank="${c}" maxlength="90" placeholder="впишите свой ответ">${esc(this.texts[c] ?? '')}</textarea>` : '');
        return whiteCard(c, undefined, `${picked ? ' cah-picked' : ''}${playing ? ' cah-can' : ''}`, inner);
      })
      .join('');
    const who = this.hotseat(v) ? `Рука: ${esc(this.plain(me))}` : 'Ваша рука';
    this.handEl.innerHTML = `<div class="cah-handhead">${who}${v.czar === me && v.phase === 'play' ? ' · вы Царь в этом раунде' : ''}</div><div class="cah-cards">${cards}</div>`;
  }

  private drawHistory(v: View) {
    const rows = v.history
      .slice(-6)
      .reverse()
      .map((r) => {
        const u = r.subs[r.win[0]];
        if (!u) return '';
        const names = [...new Set(r.win.map((i) => r.subs[i].seat))].map((x) => esc(this.plain(x))).join(', ');
        return `<div class="cah-h"><span>${r.final ? 'Хайку' : `Раунд ${r.round}`} · ${names}</span>${readHTML(r.black, u)}</div>`;
      })
      .join('');
    this.histEl.innerHTML = rows ? `<div class="cah-hhead">Лучшие ответы</div>${rows}` : '';
  }

  // ---------------------------------------------------------------- действия

  /** Может ли тот, кто за экраном, выбирать ответ на суде. */
  private canJudge(v: View): boolean {
    if (this.ctx.demo || v.phase !== 'judge') return false;
    if (v.house.godless) {
      const me = this.me(v);
      return me != null && this.can(me) && !v.voted.includes(me);
    }
    return v.czar != null && this.mine(v).includes(v.czar) && this.can(v.czar);
  }

  private tapSub(i: number) {
    const v = this.v;
    if (!v || !this.canJudge(v)) return;
    const me = this.me(v);
    if (v.house.godless && v.subs[i]?.by === me) return;
    Sound.ui();
    this.focus = this.focus === i ? null : i;
    this.redraw();
  }

  private tapHand(c: number) {
    const v = this.v;
    if (!v) return;
    const me = this.me(v);
    if (me == null || v.phase !== 'play' || !this.can(me) || v.played.includes(me)) return;
    const n = BLACK[v.black]?.pick ?? 1;
    Sound.ui();
    if (this.mode === 'reboot') {
      this.reb = this.reb.includes(c) ? this.reb.filter((x) => x !== c) : [...this.reb, c];
    } else if (this.mode === 'bet' && this.bet) {
      if (this.bet.includes(c)) this.bet = this.bet.filter((x) => x !== c);
      else if (!this.sel.includes(c) && this.bet.length < n) this.bet = [...this.bet, c];
    } else if (this.sel.includes(c)) this.sel = this.sel.filter((x) => x !== c);
    else if (!this.bet?.includes(c)) {
      if (this.sel.length >= n) this.sel = n === 1 ? [] : this.sel;
      if (this.sel.length < n) this.sel = [...this.sel, c];
    }
    this.redraw();
  }

  private filled(cards: number[]) {
    return cards.every((c) => !isBlank(c) || (this.texts[c] ?? '').trim());
  }
  private textsOf(cards: number[]) {
    const bl = cards.filter(isBlank);
    return bl.length ? Object.fromEntries(bl.map((c) => [c, (this.texts[c] ?? '').trim()])) : undefined;
  }

  // ---------------------------------------------------------------- панель

  private renderPanel() {
    const v = this.v;
    if (!v) return;
    this.panel.innerHTML = '';
    if (this.ctx.demo) return;
    const add = (html: string) => this.panel.appendChild(h(html));
    const btn = (label: string, fn: () => void, cls = 'btn', tap = false) => {
      const b = h<HTMLButtonElement>(`<button class="${cls}"${tap ? ' data-tap' : ''}>${label}</button>`);
      b.onclick = fn;
      this.panel.appendChild(b);
      return b;
    };
    const mine = this.mine(v);
    const me = this.me(v);
    const n = BLACK[v.black]?.pick ?? 1;

    if (v.phase === 'play') {
      // хот-сит: кто ещё не положил — по очереди за занавеской
      if (this.hotseat(v) && me == null) {
        const wait = mine.filter((x) => this.can(x) && !v.played.includes(x));
        if (wait.length) {
          add('<div class="cah-ask">Кладут карты (каждый — за занавеской):</div>');
          const row = h('<div class="cah-row"></div>');
          for (const x of wait) {
            const b = h<HTMLButtonElement>(`<button class="btn">${esc(this.plain(x))}</button>`);
            b.onclick = () => this.curtain(x);
            row.appendChild(b);
          }
          this.panel.appendChild(row);
        } else add('<div class="cah-ask">Ждём остальных…</div>');
      } else if (me != null && this.can(me) && !v.played.includes(me)) {
        this.playPanel(v, me, n, add, btn);
      } else if (me != null && v.czar === me) add('<div class="cah-ask">Вы — Карточный Царь. Прочитайте карту вслух и ждите ответы.</div>');
      else if (me != null && v.played.includes(me)) add('<div class="cah-ask">Карты положены. Ждём остальных…</div>');
      if (this.hotseat(v) && me != null && !this.can(me)) btn('Закрыть руку', () => ((this.open = null), this.redraw()));
    } else if (v.phase === 'judge') {
      if (v.house.godless) this.votePanel(v, add, btn);
      else if (this.canJudge(v)) {
        add(`<div class="cah-ask">${mine.length > 1 ? `${esc(this.plain(v.czar!))}, вы` : 'Вы'} — Царь. Зачитайте каждый ответ с чёрной картой и выберите самый смешной.</div>`);
        if (this.focus != null) btn('🏆 Этот — лучший', () => this.send(v.czar!, { type: 'pick', index: this.focus! }), 'btn primary');
        else add('<div class="cah-hint">Нажмите на ответ, чтобы прочитать его целиком.</div>');
      } else add(`<div class="cah-ask">Царь ${esc(this.plain(v.czar!))} выбирает лучший ответ…</div>`);
    } else if (v.phase === 'reveal') {
      const who = mine.filter((x) => this.can(x));
      if (who.length) btn(v.final ? 'К итогам' : 'Дальше', () => who.forEach((x) => this.ctx.act(x, { type: 'next' })), 'btn primary', true);
      else add('<div class="cah-ask">Ждём остальных…</div>');
    }
  }

  private playPanel(v: View, me: number, n: number, add: (h: string) => void, btn: (l: string, f: () => void, c?: string) => HTMLButtonElement) {
    const pts = v.scores[me] ?? 0;
    if (this.mode === 'reboot') {
      add('<div class="cah-ask">Перезапуск вселенной: отметьте карты на сброс. Отдадите одно очко и доберёте до десяти.</div>');
      const ok = btn(`Сбросить ${this.reb.length} и добрать`, () => this.send(me, { type: 'reboot', cards: this.reb }), 'btn primary');
      ok.disabled = !this.reb.length;
      btn('Передумал', () => ((this.mode = 'main'), (this.reb = []), this.redraw()));
      return;
    }
    const need = n - this.sel.length;
    add(`<div class="cah-ask">${this.hotseat(v) ? `${esc(this.plain(me))}, в` : 'В'}ыберите ${n > 1 ? `${n} карты по порядку` : 'карту'}${need > 0 && this.sel.length ? ` (ещё ${need})` : ''}.</div>`);
    const ready = this.sel.length === n && this.filled(this.sel);
    const betReady = !this.bet || (this.bet.length === n && this.filled(this.bet));
    if (this.sel.some(isBlank) && !this.filled(this.sel)) add('<div class="cah-hint">Впишите ответ в пустую карту.</div>');
    const go = btn(this.bet ? 'Сыграть оба набора' : 'Сыграть', () => {
      const bet = this.bet;
      this.send(me, { type: 'play', cards: this.sel, ...(this.textsOf(this.sel) ? { texts: this.textsOf(this.sel) } : {}), ...(bet ? { bet, ...(this.textsOf(bet) ? { betTexts: this.textsOf(bet) } : {}) } : {}) });
    }, 'btn primary');
    go.disabled = !ready || !betReady;
    if (v.house.gamble && pts >= 1) {
      if (!this.bet) btn('🎲 Поставить очко: ещё набор', () => ((this.bet = []), (this.mode = 'bet'), this.redraw()));
      else {
        add(`<div class="cah-hint">Залог: отметьте ${n > 1 ? `ещё ${n} карты` : 'ещё карту'} (З). Выиграет любой ваш набор — очко при вас, нет — уйдёт победителю.</div>`);
        const row = h('<div class="cah-row"></div>');
        const sw = h<HTMLButtonElement>(`<button class="btn">${this.mode === 'bet' ? 'Выбираю основной' : 'Выбираю залог'}</button>`);
        sw.onclick = () => ((this.mode = this.mode === 'bet' ? 'main' : 'bet'), this.redraw());
        const no = h<HTMLButtonElement>('<button class="btn">Без залога</button>');
        no.onclick = () => ((this.bet = null), (this.mode = 'main'), this.redraw());
        row.append(sw, no);
        this.panel.appendChild(row);
      }
    }
    if (v.house.reboot && pts >= 1 && !this.bet) btn('🔄 Перезапуск вселенной (−1 очко)', () => ((this.mode = 'reboot'), (this.sel = []), this.redraw()));
    if (this.hotseat(v)) btn('Закрыть руку', () => ((this.open = null), this.reset(), this.redraw()));
  }

  private votePanel(v: View, add: (h: string) => void, btn: (l: string, f: () => void, c?: string) => HTMLButtonElement) {
    const mine = this.mine(v);
    const me = this.me(v);
    if (this.hotseat(v) && me == null) {
      const wait = mine.filter((x) => this.can(x) && !v.voted.includes(x));
      if (!wait.length) return add('<div class="cah-ask">Ждём остальных…</div>');
      add('<div class="cah-ask">Голосуют (каждый — за занавеской, за свой ответ нельзя):</div>');
      const row = h('<div class="cah-row"></div>');
      for (const x of wait) {
        const b = h<HTMLButtonElement>(`<button class="btn">${esc(this.plain(x))}</button>`);
        b.onclick = () => this.curtain(x);
        row.appendChild(b);
      }
      this.panel.appendChild(row);
      return;
    }
    if (me != null && this.canJudge(v)) {
      add('<div class="cah-ask">Бог умер: выберите лучший ответ (за свой нельзя).</div>');
      if (this.focus != null) btn('Голосую за этот', () => this.send(me, { type: 'vote', index: this.focus! }), 'btn primary');
      else add('<div class="cah-hint">Нажмите на ответ, чтобы прочитать его целиком.</div>');
    } else add('<div class="cah-ask">Голосуют…</div>');
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    this.v = v;
    this.redraw();
  }

  async play(events: Event[], v: View) {
    const speed = this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'round') {
        this.reset();
        this.open = null;
        this.fresh = true;
        Sound.shuffle();
        this.v = v;
        this.redraw();
        await sleep(450 / speed);
      } else if (ev.type === 'played' || ev.type === 'voted') Sound.card();
      else if (ev.type === 'reboot') Sound.shuffle();
      else if (ev.type === 'judge') {
        this.focus = null;
        this.open = null;
        Sound.card();
      } else if (ev.type === 'win') {
        this.focus = null;
        this.v = v;
        this.redraw();
        const mineWon = ev.rec.win.some((i) => this.ctx.mySeats.includes(ev.rec.subs[i].seat));
        if (mineWon) Sound.win();
        else Sound.capture();
        await sleep(900 / speed);
      }
    }
    this.v = v;
    this.redraw();
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.interactive = interactive;
    const v = this.v;
    if (!v) return;
    // одиночный экран: если ход ушёл — сбросить выбор
    const me = this.me(v);
    if (me != null && !interactive.includes(me) && v.phase === 'play') this.reset();
    this.redraw();
  }

  status(v: View, _toAct: number[], interactive: number[]) {
    const nm = (p: number) => this.ctx.name(p);
    const mine = this.mine(v);
    switch (v.phase) {
      case 'over':
        return 'Игра окончена';
      case 'play': {
        const mineToPlay = mine.filter((x) => interactive.includes(x) && !v.played.includes(x));
        if (mineToPlay.length) return 'Ваш ход: положите карты';
        return v.czar != null ? `Царь — ${nm(v.czar)}. Ждём ответы…` : 'Ждём ответы…';
      }
      case 'judge':
        if (v.house.godless) return interactive.length ? 'Голосуйте за лучший ответ' : 'Голосуют…';
        return v.czar != null && interactive.includes(v.czar) ? 'Выберите лучший ответ' : `Царь ${nm(v.czar!)} выбирает…`;
      case 'reveal': {
        const r = v.history[v.history.length - 1];
        const w = r ? [...new Set(r.win.map((i) => r.subs[i].seat))] : [];
        return w.length ? `Очко — ${w.map((x) => (x === RANDO ? 'Рандо Кардриссиану' : nm(x))).join(', ')}` : '';
      }
    }
    return '';
  }

  playerStats(v: View, seat: number) {
    return `${v.scores[seat] ?? 0} очк.`;
  }
}

export function createView(): GameView<View, Event> {
  return new CahView();
}
