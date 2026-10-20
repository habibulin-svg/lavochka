/* Шпион — отрисовка: вечерний двор, игроки кругом; в центре — кто кого спрашивает, ответ и часы раунда.
 * Своя карточка — «досье» с картинкой и названием (нажать — открыть/закрыть); у шпиона — «совершенно секретно».
 * Хот-сит: карточку каждый смотрит за занавеской. Список слов темы открыт всем, шпион выбирает из него догадку. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { OUTCOME_TEXT, remaining, type Card, type Event, type View } from './engine';
import { SEATS } from './def';
import { FREE_QUESTIONS, pool, THEME, word as findWord, type Word } from './themes';
import './spy.css';

const img = (theme: string, w: Word | undefined) => (w?.img ? `<img class="sp-img" src="/spy/${theme}/${w.id}.webp" alt="" loading="lazy">` : `<div class="sp-img sp-noimg">${THEME[theme].icon}</div>`);
const mmss = (ms: number) => {
  const t = Math.ceil(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

type Mode = null | { kind: 'accuse'; by: number } | { kind: 'ask'; target: number | null } | { kind: 'words'; guessBy: number | null };

class SpyView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private root!: HTMLElement;
  private ring!: HTMLElement;
  private center!: HTMLElement;
  private clockEl!: HTMLElement;
  private cover!: HTMLElement;
  private sheet!: HTMLElement;
  private panel!: HTMLElement;
  private v: View | null = null;
  private interactive: number[] = [];
  /** Чью карточку показываем открытой (null — закрыта). */
  private shown: number | null = null;
  private mode: Mode = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private timeupSent = '';
  private filter = '';

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h(`<div class="sp-wrap"><div class="sp-bg"></div><div class="sp-ring"></div><div class="sp-center"></div><div class="sp-clock"></div>
      <div class="sp-sheet" hidden></div>
      <div class="sp-cover" hidden><div class="sp-cover-box"><div class="sp-cover-t"></div><button class="btn primary">Смотрю</button></div></div></div>`);
    root.appendChild(this.root);
    this.ring = this.root.querySelector('.sp-ring') as HTMLElement;
    this.center = this.root.querySelector('.sp-center') as HTMLElement;
    this.clockEl = this.root.querySelector('.sp-clock') as HTMLElement;
    this.cover = this.root.querySelector('.sp-cover') as HTMLElement;
    this.sheet = this.root.querySelector('.sp-sheet') as HTMLElement;
    this.panel = h('<div class="sp-panel"></div>');
    ctx.controls.appendChild(this.panel);
    this.ring.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-seat]') as HTMLElement | null;
      if (el) this.pickSeat(+el.dataset.seat!);
    });
    this.timer = setInterval(() => this.tick(), 500);
  }

  destroy() {
    clearInterval(this.timer);
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '').replace(/\s*\(бот\)/, '');
  }
  private mine(v: View) {
    return this.ctx.demo ? [] : this.ctx.mySeats.filter((x) => v.seats.includes(x));
  }
  private send(seat: number, a: unknown) {
    this.mode = null;
    this.sheet.hidden = true;
    this.ctx.act(seat, a);
  }
  private can(seat: number) {
    return this.interactive.includes(seat);
  }

  // ---------------------------------------------------------------- часы

  private tick() {
    const v = this.v;
    if (!v) return;
    const left = remaining(v, Date.now());
    const talk = v.phase === 'ask' || v.phase === 'answer';
    if (left == null || !(talk || v.phase === 'vote' || v.phase === 'final')) {
      this.clockEl.innerHTML = left == null && talk ? '<span class="sp-inf">∞</span>' : '';
      this.clockEl.className = 'sp-clock';
      return;
    }
    this.clockEl.textContent = v.phase === 'final' ? '0:00' : mmss(left);
    this.clockEl.className = `sp-clock${left < 60000 ? ' sp-hurry' : ''}${v.clock.start == null ? ' sp-paused' : ''}`;
    // время вышло — сообщает любой экран, у которого есть место за столом
    const key = `${v.round}`;
    if (talk && left <= 0 && this.timeupSent !== key) {
      const seat = this.interactive[0];
      if (seat != null) {
        this.timeupSent = key;
        this.ctx.act(seat, { type: 'timeup' });
      }
    }
  }

  // ---------------------------------------------------------------- рисунок

  private draw() {
    const v = this.v;
    if (!v) return;
    const n = v.seats.length;
    const mine = this.mine(v);
    const i0 = mine.length === 1 ? Math.max(0, v.seats.indexOf(mine[0])) : 0;
    const order = v.seats.map((_, k) => v.seats[(i0 + k) % n]);
    const targets = this.targets(v);
    const last = v.qa[v.qa.length - 1];
    let s = '';
    order.forEach((seat, k) => {
      const a = Math.PI / 2 + (k / n) * Math.PI * 2;
      const x = 50 + Math.cos(a) * 41;
      const y = 50 + Math.sin(a) * 39;
      const talk = v.phase === 'ask' || v.phase === 'answer';
      const asking = talk && v.asker === seat && v.phase === 'ask';
      const asked = v.phase === 'answer' && v.target === seat;
      const open = v.end && (v.phase === 'reveal' || v.phase === 'over');
      const spy = open && v.end!.spy === seat;
      const badge = [
        asking ? '<span class="sp-tag">спрашивает</span>' : '',
        asked ? '<span class="sp-tag sp-tag-q">отвечает</span>' : '',
        v.vote?.suspect === seat ? '<span class="sp-tag sp-tag-x">обвинён</span>' : '',
        v.vote && v.vote.yes.includes(seat) ? '<span class="sp-tag sp-tag-y">за</span>' : '',
        v.phase === 'final' && v.pointed.includes(seat) ? '<span class="sp-tag">показал</span>' : '',
        open && v.end!.points ? `<span class="sp-tag">→ ${esc(this.plain(v.end!.points[seat]))}</span>` : '',
        spy ? '<span class="sp-tag sp-tag-x">🕵 шпион</span>' : '',
        open && v.end!.gain[seat] ? `<span class="sp-tag sp-tag-y">+${v.end!.gain[seat]}</span>` : '',
      ].join('');
      const said = talk && last && last.to === seat && last.answer != null && v.asker === seat ? `<div class="sp-bubble">${esc(last.answer || 'ответил голосом')}</div>` : '';
      const pick = targets.includes(seat) ? ' sp-can' : '';
      const used = v.accused.includes(seat) && talk ? '<i class="sp-used" title="уже обвинял">☝</i>' : '';
      s += `<div class="sp-seat${asking || asked ? ' sp-talk' : ''}${pick}${mine.includes(seat) && mine.length === 1 ? ' sp-me' : ''}${spy ? ' sp-spy' : ''}" data-seat="${seat}" style="left:${x}%;top:${y}%;--c:${SEATS[seat].color}">
        <div class="sp-face" data-cam="${seat}">${esc(this.plain(seat)).slice(0, 1)}${used}</div><div class="sp-name">${esc(this.plain(seat))} <b>${v.scores[seat] ?? 0}</b></div><div class="sp-tags">${badge}</div>${said}</div>`;
    });
    this.ring.innerHTML = s;
    this.center.innerHTML = this.centerHTML(v);
    this.tick();
  }

  private centerHTML(v: View): string {
    const th = THEME[v.theme];
    const head = `<div class="sp-round">Раунд ${v.round} из ${v.rounds} · ${th.icon} ${th.title}</div>`;
    const nm = (x: number) => esc(this.plain(x));
    if ((v.phase === 'reveal' || v.phase === 'over') && v.end) {
      const e = v.end;
      const w = findWord(e.theme, e.word);
      const g = e.guess && e.guess !== e.word ? `<div class="sp-sub">шпион назвал: «${esc(findWord(e.theme, e.guess)?.name ?? e.guess)}»</div>` : '';
      return `${head}<div class="sp-result"><div class="sp-res-t">${OUTCOME_TEXT[e.outcome]}</div>${img(e.theme, w)}
        <div class="sp-word">${esc(w?.name ?? e.word)}</div>${w?.sub ? `<div class="sp-sub">${esc(w.sub)}</div>` : ''}${g}
        <div class="sp-sub">Шпион — <b>${nm(e.spy)}</b>${e.outcome === 'innocent' && e.accused != null ? `; обвинили мирного — ${nm(e.accused)}` : ''}</div></div>`;
    }
    if (v.phase === 'deal') return `${head}<div class="sp-big">Смотрим карточки…</div><div class="sp-sub">посмотрели: ${v.ready.length} из ${v.seats.length}</div>`;
    if (v.phase === 'vote' && v.vote) {
      return `${head}<div class="sp-big">☝ ${nm(v.vote.by)} обвиняет ${nm(v.vote.suspect)}</div><div class="sp-sub">нужно единогласно: за ${v.vote.yes.length} из ${v.seats.length - 1}</div>`;
    }
    if (v.phase === 'final') return `${head}<div class="sp-big">⏰ Время вышло!</div><div class="sp-sub">все разом показывают на шпиона: ${v.pointed.length} из ${v.seats.length}</div>`;
    const lines = v.qa
      .slice(-4)
      .map((q, i, arr) => {
        const cur = i === arr.length - 1;
        return `<div class="sp-qa${cur ? ' sp-qa-cur' : ''}"><div class="sp-q"><b>${nm(q.from)}</b> → <b>${nm(q.to)}</b>: ${esc(q.text || 'вопрос голосом')}</div>${
          q.answer != null ? `<div class="sp-a">— ${esc(q.answer || 'ответил голосом')}</div>` : cur ? '<div class="sp-a sp-wait">…</div>' : ''
        }</div>`;
      })
      .join('');
    const who = v.phase === 'ask' ? `<div class="sp-sub">спрашивает <b>${nm(v.asker)}</b>${v.prev != null ? ` (не ${nm(v.prev)})` : ''}</div>` : '';
    return `${head}${lines || '<div class="sp-sub">Вопросов ещё не было.</div>'}${who}`;
  }

  /** Кого сейчас можно выбрать нажатием на игрока. */
  private targets(v: View): number[] {
    const m = this.mode;
    if (this.ctx.demo) return [];
    if (v.phase === 'ask' && this.can(v.asker) && (!m || m.kind === 'ask')) return v.seats.filter((x) => x !== v.asker && (x !== v.prev || v.seats.length <= 2));
    if (m?.kind === 'accuse') return v.seats.filter((x) => x !== m.by);
    if (v.phase === 'final') {
      const me = this.pointer(v);
      return me == null ? [] : v.seats.filter((x) => x !== me);
    }
    return [];
  }

  /** Кто из моих ещё не показал в конце времени. */
  private pointer(v: View): number | null {
    return this.mine(v).find((x) => !v.pointed.includes(x) && this.can(x)) ?? null;
  }

  private pickSeat(seat: number) {
    const v = this.v;
    if (!v || !this.targets(v).includes(seat)) return;
    const m = this.mode;
    if (m?.kind === 'accuse') {
      this.send(m.by, { type: 'accuse', target: seat, at: Date.now() });
      return;
    }
    if (v.phase === 'final') {
      const me = this.pointer(v);
      if (me != null) this.send(me, { type: 'point', target: seat });
      return;
    }
    if (v.phase === 'ask') {
      this.mode = { kind: 'ask', target: seat };
      this.draw();
      this.renderPanel();
    }
  }

  // ---------------------------------------------------------------- панель

  private cardHTML(v: View, seat: number, c: Card): string {
    const th = THEME[v.theme];
    if (c.spy)
      return `<div class="sp-card sp-card-spy"><div class="sp-stamp">совершенно секретно</div><div class="sp-spyface">🕵</div><div class="sp-word">Вы — шпион</div>
        <div class="sp-sub">Тема: ${th.icon} ${th.title}. Слова вы не знаете — слушайте, о чём говорят, и не выдайте себя.</div></div>`;
    const w = findWord(v.theme, c.word);
    return `<div class="sp-card"><div class="sp-clip"></div>${img(v.theme, w)}<div class="sp-noun">${th.noun}</div><div class="sp-word">${esc(w?.name ?? c.word)}</div>
      ${w?.sub ? `<div class="sp-sub">${esc(w.sub)}</div>` : ''}${c.role ? `<div class="sp-role">Ваша роль: <b>${esc(c.role)}</b></div>` : ''}</div>`;
  }

  /** Своя карточка: одна — рубашкой, нажать — открыть; хот-сит — кнопки «карточка такого-то» за занавеской. */
  private cardsBlock(v: View) {
    const mine = this.mine(v);
    const box = h('<div class="sp-mycards"></div>');
    if (v.phase === 'over') return box;
    if (mine.length === 1) {
      const seat = mine[0];
      const c = v.cards[seat];
      if (!c) return box;
      const open = this.shown === seat;
      const el = h(open ? this.cardHTML(v, seat, c) : `<div class="sp-card sp-card-back"><div>Ваша карточка</div><small>нажмите, чтобы посмотреть</small></div>`);
      el.onclick = () => {
        this.shown = open ? null : seat;
        this.renderPanel();
      };
      box.appendChild(el);
      return box;
    }
    const row = h('<div class="sp-peek"><div class="sp-ask">Посмотреть свою карточку:</div><div class="sp-row"></div></div>');
    for (const seat of mine) {
      const b = h<HTMLButtonElement>(`<button class="btn">${esc(this.plain(seat))}${v.phase === 'deal' && !v.ready.includes(seat) ? ' •' : ''}</button>`);
      b.onclick = () => this.peek(seat);
      (row.querySelector('.sp-row') as HTMLElement).appendChild(b);
    }
    box.appendChild(row);
    return box;
  }

  /** Хот-сит: занавеска «смотрит такой-то» → карточка → «Запомнил». */
  private peek(seat: number) {
    const v = this.v;
    if (!v) return;
    const c = v.cards[seat];
    if (!c) return;
    const t = this.cover.querySelector('.sp-cover-t') as HTMLElement;
    const btn = this.cover.querySelector('button') as HTMLButtonElement;
    t.innerHTML = `Карточку смотрит ${this.ctx.name(seat)}.<br><small>Остальные — не подглядывать!</small>`;
    btn.textContent = 'Смотрю';
    this.cover.hidden = false;
    btn.onclick = () => {
      Sound.unlock();
      t.innerHTML = this.cardHTML(v, seat, c);
      btn.textContent = 'Запомнил';
      btn.onclick = () => {
        this.cover.hidden = true;
        if (v.phase === 'deal' && !v.ready.includes(seat) && this.can(seat)) this.send(seat, { type: 'ready', at: Date.now() });
      };
    };
  }

  private renderPanel() {
    const v = this.v;
    if (!v) return;
    this.panel.innerHTML = '';
    if (this.ctx.demo) return;
    this.panel.appendChild(this.cardsBlock(v));
    const mine = this.mine(v);
    const solo = mine.length === 1 ? mine[0] : null;
    const add = (html: string) => this.panel.appendChild(h(html));
    const btn = (label: string, fn: () => void, cls = 'btn') => {
      const b = h<HTMLButtonElement>(`<button class="${cls}">${label}</button>`);
      b.onclick = fn;
      this.panel.appendChild(b);
      return b;
    };

    switch (v.phase) {
      case 'deal':
        if (solo != null && this.can(solo)) {
          add('<div class="sp-ask">Посмотрите карточку и запомните.</div>');
          btn('Запомнил', () => this.send(solo, { type: 'ready', at: Date.now() }), 'btn primary');
        } else if (mine.some((x) => this.can(x))) add('<div class="sp-ask">Каждый по очереди смотрит свою карточку.</div>');
        break;
      case 'reveal':
        if (mine.some((x) => this.can(x))) btn(v.round >= v.rounds ? 'К итогам' : 'Следующий раунд', () => this.send(mine.find((x) => this.can(x))!, { type: 'next' }), 'btn primary');
        break;
      case 'vote': {
        const vt = v.vote!;
        add(`<div class="sp-ask">${esc(this.plain(vt.suspect))} — шпион?</div>`);
        for (const x of mine.filter((s) => this.can(s) && s !== vt.suspect && !vt.yes.includes(s))) {
          const row = h(`<div class="sp-vote">${mine.length > 1 ? `<span>${esc(this.plain(x))}:</span>` : ''}</div>`);
          for (const yes of [true, false]) {
            const b = h<HTMLButtonElement>(`<button class="btn${yes ? ' primary' : ''}">${yes ? 'Да, он' : 'Нет'}</button>`);
            b.onclick = () => this.send(x, { type: 'vote', yes, at: Date.now() });
            row.appendChild(b);
          }
          this.panel.appendChild(row);
        }
        break;
      }
      case 'final': {
        const me = this.pointer(v);
        if (me != null) add(`<div class="sp-ask">${mine.length > 1 ? esc(this.plain(me)) + ', покажите' : 'Покажите'} на шпиона — нажмите на игрока.</div>`);
        this.spyButton(v);
        break;
      }
      case 'ask':
      case 'answer':
        this.talkPanel(v);
        break;
    }
    if (v.phase !== 'over') {
      const b = btn(`📋 Все слова темы (${pool(v.theme, v.sub).length})`, () => this.openWords(null));
      b.classList.add('sp-list-btn');
    }
  }

  private talkPanel(v: View) {
    const mine = this.mine(v);
    const th = THEME[v.theme];
    const p = this.panel;
    if (v.phase === 'ask' && this.can(v.asker) && mine.includes(v.asker)) {
      const m = this.mode?.kind === 'ask' ? this.mode : { kind: 'ask' as const, target: null };
      if (m.target == null) p.appendChild(h(`<div class="sp-ask">${mine.length > 1 ? esc(this.plain(v.asker)) + ', кого' : 'Кого'} спросить? Нажмите на игрока.</div>`));
      else {
        const t = m.target;
        p.appendChild(h(`<div class="sp-ask">Вопрос для ${esc(this.plain(t))}:</div>`));
        const qs = h('<div class="sp-qs"></div>');
        th.facets.forEach((f, i) => {
          const b = h<HTMLButtonElement>(`<button class="btn sp-qbtn">${esc(f.q)}</button>`);
          b.onclick = () => this.send(v.asker, { type: 'ask', target: t, facet: i });
          qs.appendChild(b);
        });
        p.appendChild(qs);
        const card = v.cards[v.asker];
        const hints = card && !card.spy ? findWord(v.theme, card.word)?.q ?? [] : [];
        const own = h(`<div class="sp-own"><input type="text" maxlength="200" placeholder="Свой вопрос…" list="sp-qlist"><datalist id="sp-qlist">${[...hints, ...FREE_QUESTIONS].map((q) => `<option value="${esc(q)}">`).join('')}</datalist><div class="sp-row2"></div></div>`);
        const inp = own.querySelector('input') as HTMLInputElement;
        const row = own.querySelector('.sp-row2') as HTMLElement;
        const go = h<HTMLButtonElement>('<button class="btn primary">Спросить</button>');
        go.onclick = () => inp.value.trim() && this.send(v.asker, { type: 'ask', target: t, text: inp.value.trim() });
        inp.onkeydown = (e) => e.key === 'Enter' && go.click();
        const voice = h<HTMLButtonElement>('<button class="btn">Спросил голосом</button>');
        voice.onclick = () => this.send(v.asker, { type: 'ask', target: t, text: '' });
        row.append(go, voice);
        p.appendChild(own);
      }
    }
    if (v.phase === 'answer' && v.target != null && this.can(v.target) && mine.includes(v.target)) {
      const me = v.target;
      const q = v.qa[v.qa.length - 1];
      p.appendChild(h(`<div class="sp-ask">${mine.length > 1 ? esc(this.plain(me)) + ', вас' : 'Вас'} спрашивают: «${esc(q.text || 'голосом')}»</div>`));
      if (q.facet != null) {
        const qs = h('<div class="sp-qs"></div>');
        th.facets[q.facet].a.forEach((a, i) => {
          const b = h<HTMLButtonElement>(`<button class="btn sp-qbtn">${esc(a)}</button>`);
          b.onclick = () => this.send(me, { type: 'answer', val: i });
          qs.appendChild(b);
        });
        const d = h<HTMLButtonElement>('<button class="btn sp-qbtn sp-dodge">Не скажу</button>');
        d.onclick = () => this.send(me, { type: 'answer', dodge: true });
        qs.appendChild(d);
        p.appendChild(qs);
      }
      const own = h(`<div class="sp-own"><input type="text" maxlength="200" placeholder="${q.facet != null ? 'или своими словами…' : 'Ваш ответ…'}"><div class="sp-row2"></div></div>`);
      const inp = own.querySelector('input') as HTMLInputElement;
      const row = own.querySelector('.sp-row2') as HTMLElement;
      const go = h<HTMLButtonElement>('<button class="btn primary">Ответить</button>');
      go.onclick = () => inp.value.trim() && this.send(me, { type: 'answer', text: inp.value.trim() });
      inp.onkeydown = (e) => e.key === 'Enter' && go.click();
      row.appendChild(go);
      if (q.facet == null) {
        const voice = h<HTMLButtonElement>('<button class="btn">Ответил голосом</button>');
        voice.onclick = () => this.send(me, { type: 'answer', text: '' });
        row.appendChild(voice);
      }
      p.appendChild(own);
    }
    // обвинение — раз за раунд каждому
    const accusers = mine.filter((x) => this.can(x) && !v.accused.includes(x));
    if (this.mode?.kind === 'accuse') {
      p.appendChild(h(`<div class="sp-ask">${esc(this.plain(this.mode.by))} обвиняет… нажмите на подозреваемого.</div>`));
      const b = h<HTMLButtonElement>('<button class="btn">Передумал</button>');
      b.onclick = () => {
        this.mode = null;
        this.draw();
        this.renderPanel();
      };
      p.appendChild(b);
    } else if (accusers.length) {
      const row = h(`<div class="sp-accuse"><div class="sp-row"></div></div>`);
      for (const x of accusers) {
        const b = h<HTMLButtonElement>(`<button class="btn sp-btn-acc">☝ ${mine.length > 1 ? esc(this.plain(x)) + ' обвиняет' : 'Обвинить'}</button>`);
        b.onclick = () => {
          this.mode = { kind: 'accuse', by: x };
          this.draw();
          this.renderPanel();
        };
        (row.querySelector('.sp-row') as HTMLElement).appendChild(b);
      }
      p.appendChild(row);
    }
    this.spyButton(v);
  }

  /** «Я шпион!» — у одиночного экрана только шпиону; в хот-сите — всем (кто нажал — выбирает себя, чтобы не выдать, где шпион). */
  private spyButton(v: View) {
    const mine = this.mine(v);
    const spies = mine.filter((x) => v.cards[x]?.spy && this.can(x));
    if (!spies.length && mine.length <= 1) return;
    if (mine.length > 1 && !mine.some((x) => this.can(x))) return;
    const b = h<HTMLButtonElement>('<button class="btn sp-btn-spy">🕵 Я шпион — назвать слово</button>');
    b.onclick = () => {
      if (mine.length === 1) return this.openWords(spies[0]);
      // хот-сит: кто вы?
      const t = this.cover.querySelector('.sp-cover-t') as HTMLElement;
      const ok = this.cover.querySelector('button') as HTMLButtonElement;
      t.innerHTML = `Кто называет слово?<div class="sp-row">${mine.map((x) => `<button class="btn" data-who="${x}">${esc(this.plain(x))}</button>`).join('')}</div>`;
      ok.textContent = 'Отмена';
      ok.onclick = () => (this.cover.hidden = true);
      t.querySelectorAll<HTMLButtonElement>('[data-who]').forEach(
        (w) =>
          (w.onclick = () => {
            const x = +w.dataset.who!;
            if (!v.cards[x]?.spy) {
              t.innerHTML = 'Вы не шпион — ваша карточка со словом.';
              return;
            }
            this.cover.hidden = true;
            this.openWords(x);
          }),
      );
      this.cover.hidden = false;
    };
    this.panel.appendChild(b);
  }

  /** Лист со всеми словами темы; guessBy — шпион выбирает догадку. */
  private openWords(guessBy: number | null) {
    const v = this.v;
    if (!v) return;
    this.mode = { kind: 'words', guessBy };
    const th = THEME[v.theme];
    const words = pool(v.theme, v.sub)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    this.sheet.innerHTML = `<div class="sp-sheet-box"><div class="sp-sheet-head"><b>${th.icon} ${th.title}${guessBy != null ? ' — что загадано?' : ''}</b>
      <input type="search" placeholder="поиск" value="${esc(this.filter)}"><button class="btn sp-x">✕</button></div><div class="sp-words"></div></div>`;
    const list = this.sheet.querySelector('.sp-words') as HTMLElement;
    const fill = () => {
      const f = this.filter.toLowerCase();
      list.innerHTML = words
        .filter((w) => !f || w.name.toLowerCase().includes(f) || (w.sub ?? '').toLowerCase().includes(f))
        .map((w) => `<button class="sp-w${guessBy != null ? ' sp-w-pick' : ''}" data-id="${w.id}">${esc(w.name)}${w.sub ? `<small>${esc(w.sub)}</small>` : ''}</button>`)
        .join('');
    };
    fill();
    const inp = this.sheet.querySelector('input') as HTMLInputElement;
    inp.oninput = () => {
      this.filter = inp.value;
      fill();
    };
    (this.sheet.querySelector('.sp-x') as HTMLElement).onclick = () => {
      this.sheet.hidden = true;
      this.mode = null;
    };
    list.onclick = (e) => {
      const el = (e.target as Element).closest('[data-id]') as HTMLElement | null;
      if (!el || guessBy == null) return;
      const w = words.find((x) => x.id === el.dataset.id)!;
      if (!confirm(`Назвать «${w.name}»? Ошибётесь — раунд за мирными.`)) return;
      this.filter = '';
      this.send(guessBy, { type: 'guess', word: w.id, at: Date.now() });
    };
    this.sheet.hidden = false;
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    this.v = v;
    this.draw();
    this.renderPanel();
  }

  async play(events: Event[], v: View) {
    const speed = this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'round') {
        this.shown = null;
        this.mode = null;
        this.sheet.hidden = true;
        Sound.shuffle();
        this.v = v;
        this.draw();
        await sleep(500 / speed);
      } else if (ev.type === 'ask' || ev.type === 'answer') {
        Sound.chat();
        if (ev.type === 'ask' && this.ctx.mySeats.includes(ev.to)) Sound.turn();
      } else if (ev.type === 'accuse') Sound.ui();
      else if (ev.type === 'timeup') Sound.nomove();
      else if (ev.type === 'end') {
        this.v = v;
        this.draw();
        if (ev.end.outcome === 'caught' || ev.end.outcome === 'wrongGuess') Sound.capture();
        else Sound.win();
        await sleep(600 / speed);
      }
    }
    this.v = v;
    this.draw();
    this.renderPanel();
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.interactive = interactive;
    const v = this.v;
    if (!v) return;
    if (this.mode?.kind === 'ask' && !(v.phase === 'ask' && interactive.includes(v.asker))) this.mode = null;
    if (this.mode?.kind === 'accuse' && !(v.phase === 'ask' || v.phase === 'answer')) this.mode = null;
    if (this.mode?.kind === 'words' && this.mode.guessBy != null && !(v.phase === 'ask' || v.phase === 'answer' || v.phase === 'final')) {
      this.mode = null;
      this.sheet.hidden = true;
    }
    this.draw();
    this.renderPanel();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    const nm = (p: number) => this.ctx.name(p);
    const mine = this.mine(v);
    switch (v.phase) {
      case 'over':
        return 'Игра окончена';
      case 'deal':
        return 'Смотрим карточки';
      case 'reveal':
        return v.end ? OUTCOME_TEXT[v.end.outcome] : '';
      case 'vote':
        return interactive.length ? 'Голосуйте: единогласно — карточку откроют' : `Голосуют против ${nm(v.vote!.suspect)}…`;
      case 'final':
        return interactive.length ? 'Покажите на шпиона' : 'Все показывают на шпиона…';
      case 'ask':
        return mine.includes(v.asker) && interactive.includes(v.asker) ? 'Ваш вопрос' : `Спрашивает ${nm(v.asker)}…`;
      case 'answer':
        return v.target != null && mine.includes(v.target) && interactive.includes(v.target) ? 'Вам вопрос' : `Отвечает ${nm(v.target!)}…`;
    }
    void toAct;
    return '';
  }

  focusSeat(v: View) {
    return v.phase === 'ask' ? v.asker : v.phase === 'answer' ? v.target : null;
  }

  playerStats(v: View, seat: number) {
    return `${v.scores[seat] ?? 0} очк.`;
  }
}

export function createView(): GameView<View, Event> {
  return new SpyView();
}
