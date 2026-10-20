/* Крокодил — отрисовка: комната, ковёр на стене, у ковра — показывающий, зрители на диване. Посередине — часы, слово
 * (только показывающему), карточки-пантомима и догадки с кивками. По сети над ковром — видео показывающего (стол сам ставит его
 * в [data-spot]). Хот-сит: слово — за занавеской («посмотрел — положил телефон»), загадывание и набор эмодзи — тоже.
 * Часы идут по местному времени экрана; когда кончаются у человека, экран сам присылает «время вышло». */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { NOD_TEXT, SEATS } from './def';
import { teamScore, total, type Event, type View } from './engine';
import { cardText, KIND_NAME, searchEmoji, type Card } from './words';
import './croc.css';

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const KIND_ICON = { w: '🐊', o: '🐊', p: '📜', f: '🎬' } as const;
const NOD_ICON = { yes: '👍', close: '🤏', no: '👎' } as const;

function cardHTML(c: Card, fresh = false) {
  const cls = `cr-pc cr-pc-${c.k}${fresh ? ' cr-pc-new' : ''}`;
  switch (c.k) {
    case 'syl':
      return `<div class="${cls}"><i>✋</i><span>слогов: <b>${c.n}</b></span></div>`;
    case 'emo':
      return `<div class="${cls}"><em>${c.es.map(esc).join('')}</em></div>`;
    case 'clue':
      return `<div class="${cls}"><i>🤲</i><span>${esc(c.text)}</span></div>`;
    case 'words':
      return `<div class="${cls}"><i>🖐</i><span>слов: <b>${c.n}</b></span></div>`;
    case 'word':
      return `<div class="${cls}"><i>${c.pos}</i><span>${esc(c.w)}</span></div>`;
  }
}

class CrocView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private root!: HTMLElement;
  private stage!: HTMLElement;
  private sofa!: HTMLElement;
  private center!: HTMLElement;
  private cover!: HTMLElement;
  private panel!: HTMLElement;
  private v: View | null = null;
  private interactive: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private seen = new Map<string, number>();
  private sent = '';
  private beeped = -1;
  /** Хот-сит: какое слово показывающий уже посмотрел за занавеской. */
  private peeked = '';
  /** Хот-сит: загадывающий открыл выбор; показывающий набирает эмодзи. */
  private picking = false;
  private composing = false;
  private draft: string[] = [];
  private query = '';
  private lastCards = 0;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h(`<div class="cr-wrap"><div class="cr-wall"></div><div class="cr-rug"></div>
      <div class="cr-spotslot" data-spot></div><div class="cr-stage"></div><div class="cr-center"></div><div class="cr-sofa"></div>
      <div class="cr-cover" hidden><div class="cr-cover-box"></div></div></div>`);
    root.appendChild(this.root);
    this.stage = this.root.querySelector('.cr-stage') as HTMLElement;
    this.sofa = this.root.querySelector('.cr-sofa') as HTMLElement;
    this.center = this.root.querySelector('.cr-center') as HTMLElement;
    this.cover = this.root.querySelector('.cr-cover') as HTMLElement;
    this.panel = h('<div class="cr-panel"></div>');
    ctx.controls.appendChild(this.panel);
    // кнопки у догадок: засчитать, кивнуть
    this.center.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      const v = this.v;
      if (!b || !v) return;
      const me = this.showerHere(v);
      if (me == null) return;
      Sound.unlock();
      if (b.dataset.acc) this.send(me, { type: 'accept', id: Number(b.dataset.acc) });
      else if (b.dataset.nod) this.send(me, { type: 'nod', id: Number(b.dataset.id), val: b.dataset.nod });
    });
    this.timer = setInterval(() => this.tick(), 250);
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '').replace(/\s*\(бот\)/, '');
  }
  private mine(v: View) {
    return this.ctx.demo ? [] : this.ctx.mySeats.filter((x) => v.seats.includes(x));
  }
  private hot(v: View) {
    return this.mine(v).length > 1;
  }
  private human(v: View, x: number) {
    return v.humans.includes(x);
  }
  private can(x: number) {
    return this.interactive.includes(x);
  }
  private send(seat: number, a: unknown) {
    this.ctx.act(seat, a);
  }
  /** Показывающий-человек за этим экраном (может действовать). */
  private showerHere(v: View) {
    return v.phase === 'show' && this.mine(v).includes(v.shower) && this.human(v, v.shower) && this.can(v.shower) ? v.shower : null;
  }
  private wordKey(v: View) {
    return `${v.gid}:${v.t}:${v.seq}`;
  }
  /** Камера показывающего — крупно (по сети, пока показывает жестами). */
  private spotOn(v: View) {
    return !!this.ctx.online && v.phase === 'show' && v.style === 'gesture' && this.human(v, v.shower);
  }

  // ---------------------------------------------------------------- часы

  private key(v: View) {
    return `${v.gid}:${v.t}`;
  }
  private left(v: View): number {
    if (!v.time) return Infinity;
    if (v.phase !== 'show') return v.phase === 'ready' || v.phase === 'pick' ? v.time : 0;
    if (v.virt || this.ctx.demo) return v.time - v.used;
    if (!this.seen.has(this.key(v))) this.seen.set(this.key(v), Date.now());
    return v.time - (Date.now() - this.seen.get(this.key(v))!);
  }

  private tick() {
    const v = this.v;
    const el = this.root.querySelector('.cr-clock') as HTMLElement | null;
    if (!v || !el) return;
    const left = this.left(v);
    const run = v.phase === 'show';
    if (!v.time) {
      el.innerHTML = '<b>∞</b><small>без времени</small>';
      return;
    }
    el.innerHTML = `<b>${mmss(left)}</b><small>${run ? 'осталось' : 'на слово'}</small>`;
    el.className = `cr-clock${run && left <= 10000 ? ' cr-hurry' : ''}`;
    el.style.setProperty('--p', String(Math.max(0, Math.min(1, left / v.time))));
    if (!run || v.virt || this.ctx.demo) return;
    const people = this.mine(v).filter((x) => this.human(v, x));
    if (!people.length) return;
    const s = Math.ceil(left / 1000);
    if (s <= 5 && s > 0 && s !== this.beeped) {
      this.beeped = s;
      Sound.beep(1200, 0.06, 0.08);
    }
    if (left <= 0 && this.sent !== this.key(v)) {
      // присылает любой человек за этим экраном (лишние «время» движок отклонит)
      const me = people.includes(v.shower) ? v.shower : people[0];
      if (me != null) {
        this.sent = this.key(v);
        this.send(me, { type: 'timeup' });
      }
    }
  }

  // ---------------------------------------------------------------- рисунок

  private draw() {
    const v = this.v;
    if (!v) return;
    this.root.classList.toggle('cr-spot', this.spotOn(v));
    this.root.classList.toggle('cr-emoji', v.style === 'emoji');
    const nm = (x: number) => esc(this.plain(x));
    const active = v.phase !== 'over';
    // у ковра — показывающий
    this.stage.innerHTML = active
      ? `<div class="cr-mime" style="--c:${SEATS[v.shower].color}"><div class="cr-mime-face">${v.style === 'emoji' ? '😶' : '🤸'}</div>
          <div class="cr-mime-name">${nm(v.shower)}${this.human(v, v.shower) ? '' : ' 🤖'}</div><div class="cr-tag">показывает</div></div>`
      : '';
    // зрители на диване
    let s = '';
    for (const seat of v.seats) {
      if (active && seat === v.shower) continue;
      const team = v.teams ? v.teams.findIndex((t) => t.includes(seat)) : -1;
      const role = !active ? '' : v.eligible.includes(seat) ? 'угадывает' : seat === v.picker ? 'загадал' : v.teams ? 'соперник' : '';
      const sc = v.teams ? '' : ` <b>${total(v, seat)}</b>`;
      s += `<div class="cr-seat${v.eligible.includes(seat) && active ? ' cr-gue' : ''}" style="--c:${SEATS[seat].color}">
        <div class="cr-face" data-cam="${seat}">${esc(this.plain(seat)).slice(0, 1)}</div>
        <div class="cr-name">${nm(seat)}${sc}${team >= 0 ? ` <i class="cr-team cr-team${team}">${team + 1}</i>` : ''}</div>${role ? `<span class="cr-tag${role === 'угадывает' ? ' cr-tag-g' : ''}">${role}</span>` : ''}</div>`;
    }
    this.sofa.innerHTML = s;
    this.center.innerHTML = this.centerHTML(v);
    this.tick();
  }

  private head(v: View) {
    const kind = v.kind ? `${KIND_ICON[v.kind]} ${KIND_NAME[v.kind]}` : v.style === 'emoji' ? '😶 эмодзи' : '🤫 молча';
    return `<div class="cr-head"><span>ход <b>${Math.min(v.t + 1, v.turns)}</b> из ${v.turns}</span><span>${kind}</span></div>`;
  }

  private centerHTML(v: View): string {
    const nm = (x: number) => esc(this.plain(x));
    const clock = '<div class="cr-clock"></div>';
    if (v.phase === 'over') return `<div class="cr-card cr-final"><div class="cr-big">Игра окончена</div>${this.scoreHTML(v)}</div>`;
    if (v.phase === 'pick')
      return `<div class="cr-card">${this.head(v)}<div class="cr-sub">${nm(v.picker!)} загадывает слово для ${nm(v.shower)}…</div>${clock}</div>`;
    if (v.phase === 'ready') {
      const how = v.style === 'emoji' ? 'Показывать — только эмодзи из набора.' : 'Ни звука, ни букв в воздухе, ни показа на предметы!';
      return `<div class="cr-card">${this.head(v)}<div class="cr-sub">Сейчас показывает <b>${nm(v.shower)}</b>${v.picker != null ? `, слово загадал ${nm(v.picker)}` : ''}.<br>${how}</div>${clock}</div>`;
    }
    if (v.phase === 'reveal' && v.last) {
      const L = v.last;
      const res =
        L.res === 'got'
          ? `✓ угадал <b>${nm(L.by!)}</b>`
          : L.res === 'timeup'
            ? '⏰ время вышло'
            : '🏳 показывающий сдался';
      const sk = L.skipped.length ? `<div class="cr-sub">пропущено: ${L.skipped.map((w) => `«${esc(w)}»`).join(', ')}</div>` : '';
      return `<div class="cr-card">${this.head(v)}<div class="cr-slip cr-slip-open"><span>${esc(L.w)}</span></div><div class="cr-res cr-res-${L.res}">${res}</div>${sk}${this.cardsHTML(v)}</div>`;
    }
    // показ
    const hot = this.hot(v);
    const showWord = v.word && !hot;
    const fs = v.word ? (v.word.length <= 8 ? 40 : v.word.length <= 14 ? 32 : v.word.length <= 24 ? 24 : 19) : 0;
    const word = showWord
      ? `<div class="cr-slip cr-slip-open" style="--fs:${fs}px"><span>${esc(v.word!)}</span></div>`
      : `<div class="cr-slip cr-slip-shut"><span>?</span></div>`;
    return `<div class="cr-card cr-play">${this.head(v)}<div class="cr-mid">${clock}${word}</div>${this.cardsHTML(v)}${this.triesHTML(v)}</div>`;
  }

  private cardsHTML(v: View) {
    if (!v.cards.length) return '';
    const fresh = v.cards.length > this.lastCards;
    return `<div class="cr-cards">${v.cards.map((c, i) => cardHTML(c, fresh && i === v.cards.length - 1)).join('')}</div>`;
  }

  private triesHTML(v: View) {
    const list = v.tries.filter((t) => t.res !== 'right').slice(-8);
    if (!list.length) return '';
    const me = this.showerHere(v);
    return `<div class="cr-tries">${list
      .map((t) => {
        const btns =
          me == null
            ? ''
            : (t.res === 'near' ? `<button class="cr-acc" data-acc="${t.id}" title="Засчитать">✓ засчитать</button>` : '') +
              (v.nod && !t.nod ? (['yes', 'close', 'no'] as const).map((n) => `<button data-nod="${n}" data-id="${t.id}" title="${NOD_TEXT[n]}">${NOD_ICON[n]}</button>`).join('') : '');
        return `<div class="cr-try${t.res === 'near' ? ' cr-near' : ''}"><b style="color:${SEATS[t.seat].color}">${esc(this.plain(t.seat))}:</b> ${esc(t.text)}${t.nod ? ` <i>${NOD_ICON[t.nod]}</i>` : ''}${t.res === 'near' ? ' <small>почти</small>' : ''}${btns}</div>`;
      })
      .join('')}</div>`;
  }

  private scoreHTML(v: View) {
    const nm = (x: number) => esc(this.plain(x));
    if (v.teams) {
      const rows = v.teams
        .map((t, j) => ({ t, j, sc: teamScore(v, t) }))
        .sort((a, b) => b.sc - a.sc)
        .map((r) => `<tr><td><i class="cr-team cr-team${r.j}">${r.j + 1}</i> ${r.t.map(nm).join(', ')}</td><td><b>${r.sc}</b></td></tr>`)
        .join('');
      return `<table class="cr-score"><tr><th>Команда</th><th>слов</th></tr>${rows}</table>`;
    }
    const both = v.score === 'both';
    const rows = v.seats
      .slice()
      .sort((a, b) => total(v, b) - total(v, a))
      .map((x) => `<tr><td>${nm(x)}</td><td>${v.pts[x] ?? 0}</td>${both ? `<td>${v.shown[x] ?? 0}</td>` : ''}<td><b>${total(v, x)}</b></td></tr>`)
      .join('');
    return `<table class="cr-score"><tr><th></th><th>угадал</th>${both ? '<th>показал</th>' : ''}<th>очки</th></tr>${rows}</table>`;
  }

  // ---------------------------------------------------------------- занавеска (хот-сит)

  private showCover(html: string | HTMLElement, buttons: [string, () => void, string?][]) {
    const box = this.cover.querySelector('.cr-cover-box') as HTMLElement;
    box.innerHTML = '';
    if (typeof html === 'string') box.innerHTML = html;
    else box.appendChild(html);
    const row = h('<div class="cr-row"></div>');
    for (const [label, fn, cls] of buttons) {
      const b = h<HTMLButtonElement>(`<button class="btn ${cls ?? 'primary'}">${label}</button>`);
      b.onclick = () => {
        Sound.unlock();
        fn();
      };
      row.appendChild(b);
    }
    if (buttons.length) box.appendChild(row);
    this.cover.hidden = false;
  }

  private coverFor(v: View) {
    const hide = () => (this.cover.hidden = true);
    if (this.ctx.demo || !this.hot(v)) return hide();
    const nm = (x: number) => this.ctx.name(x);
    const mine = this.mine(v);
    if (v.phase === 'pick' && v.picker != null && mine.includes(v.picker) && this.human(v, v.picker) && this.can(v.picker)) {
      const p = v.picker;
      if (!this.picking)
        return this.showCover(`<div class="cr-cover-t">Слово для ${nm(v.shower)} загадывает ${nm(p)}.<br><small>${esc(this.plain(v.shower))}, не подглядывай!</small></div>`, [
          ['Это я', () => ((this.picking = true), this.coverFor(v))],
        ]);
      return this.showCover(this.pickForm(v, p), []);
    }
    this.picking = false;
    const sh = v.shower;
    if (!mine.includes(sh) || !this.human(v, sh) || !this.can(sh)) return hide();
    if (v.phase === 'ready')
      return this.showCover(
        `<div class="cr-cover-t">Показывает ${nm(sh)}. Телефон — ${nm(sh)}!<br><small>Остальные — не смотреть. Посмотрите слово, положите телефон экраном вниз и показывайте.</small></div>`,
        [['Посмотреть слово', () => this.send(sh, { type: 'start' })]]
      );
    if (v.phase !== 'show') return hide();
    if (this.composing) return this.showCover(this.palette(v, sh, true), []);
    if (this.peeked !== this.wordKey(v) && v.word) {
      const kind = v.kind && v.kind !== 'w' && v.kind !== 'o' ? `<div class="cr-cover-how">${KIND_ICON[v.kind]} ${KIND_NAME[v.kind]} — показывайте по словам</div>` : '';
      return this.showCover(`<div class="cr-cover-t">${nm(sh)}, ваше слово:</div><div class="cr-slip cr-slip-open cr-cover-word"><span>${esc(v.word)}</span></div>${kind}`, [
        [v.style === 'emoji' ? 'Запомнил — набирать эмодзи' : 'Запомнил — показываю!', () => {
          this.peeked = this.wordKey(v);
          if (v.style === 'emoji') this.composing = true;
          this.coverFor(v);
          this.renderPanel();
        }],
      ]);
    }
    hide();
  }

  /** Загадать: из трёх или своё. */
  private pickForm(v: View, seat: number): HTMLElement {
    const el = h(`<div class="cr-pick"><div class="cr-ask">${esc(this.plain(seat))}, загадайте слово для ${esc(this.plain(v.shower))}:</div><div class="cr-opts"></div></div>`);
    const opts = el.querySelector('.cr-opts') as HTMLElement;
    (v.offers ?? []).forEach((o, k) => {
      const b = h<HTMLButtonElement>(`<button class="btn cr-opt">${esc(o)}</button>`);
      b.onclick = () => {
        Sound.unlock();
        this.picking = false;
        this.cover.hidden = true;
        this.send(seat, { type: 'offer', k });
      };
      opts.appendChild(b);
    });
    if (v.canOwn) {
      const own = h(`<div class="cr-type"><input type="text" maxlength="50" placeholder="или своё слово…" autocomplete="off"><button class="btn">Загадать</button></div>`);
      const inp = own.querySelector('input') as HTMLInputElement;
      const go = () => {
        if (!inp.value.trim()) return;
        this.picking = false;
        this.cover.hidden = true;
        this.send(seat, { type: 'own', text: inp.value.trim() });
      };
      (own.querySelector('button') as HTMLButtonElement).onclick = go;
      inp.onkeydown = (e) => e.key === 'Enter' && (e.preventDefault(), go());
      el.appendChild(own);
    }
    return el;
  }

  /** Набор эмодзи: поиск по слову, черновик, «показать». */
  private palette(v: View, seat: number, inCover: boolean): HTMLElement {
    const el = h(`<div class="cr-pal"><div class="cr-ask">${inCover ? `Слово: <b>${esc(v.word ?? '')}</b>. ` : ''}Наберите эмодзи и покажите:</div>
      <div class="cr-draft"></div><input type="search" placeholder="найти: кот, дом, зима…" autocomplete="off"><div class="cr-grid"></div><div class="cr-row"></div></div>`);
    const draft = el.querySelector('.cr-draft') as HTMLElement;
    const grid = el.querySelector('.cr-grid') as HTMLElement;
    const inp = el.querySelector('input') as HTMLInputElement;
    const row = el.querySelector('.cr-row') as HTMLElement;
    const upd = () => {
      draft.innerHTML = this.draft.length ? this.draft.map((e, i) => `<button data-i="${i}" title="убрать">${e}</button>`).join('') : '<small>пусто — нажмите на картинки ниже</small>';
      go.disabled = !this.draft.length;
    };
    const fill = () => {
      grid.innerHTML = searchEmoji(this.query, 160)
        .map((x) => `<button data-e="${x.e}" title="${esc(x.name)}">${x.e}</button>`)
        .join('');
    };
    grid.onclick = (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b || this.draft.length >= 8) return;
      this.draft.push(b.dataset.e!);
      upd();
    };
    draft.onclick = (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b) return;
      this.draft.splice(Number(b.dataset.i), 1);
      upd();
    };
    inp.value = this.query;
    inp.oninput = () => {
      this.query = inp.value;
      fill();
    };
    const go = h<HTMLButtonElement>('<button class="btn primary">Показать ➤</button>');
    go.onclick = () => {
      if (!this.draft.length) return;
      Sound.unlock();
      this.send(seat, { type: 'emo', list: this.draft.slice() });
      this.draft = [];
      if (inCover) {
        this.composing = false;
        this.cover.hidden = true;
        this.renderPanel();
      } else upd();
    };
    row.appendChild(go);
    if (inCover) {
      const back = h<HTMLButtonElement>('<button class="btn">Закрыть</button>');
      back.onclick = () => {
        this.composing = false;
        this.cover.hidden = true;
        this.renderPanel();
      };
      row.appendChild(back);
    }
    fill();
    upd();
    return el;
  }

  // ---------------------------------------------------------------- панель

  private renderPanel() {
    const v = this.v;
    if (!v) return;
    this.panel.innerHTML = '';
    if (this.ctx.demo) return;
    const mine = this.mine(v);
    const nm = (x: number) => esc(this.plain(x));
    const add = (html: string) => this.panel.appendChild(h(html));
    const btn = (label: string, fn: () => void, cls = 'btn', box: HTMLElement = this.panel) => {
      const b = h<HTMLButtonElement>(`<button class="${cls}">${label}</button>`);
      b.onclick = () => {
        Sound.unlock();
        fn();
      };
      box.appendChild(b);
      return b;
    };
    const hot = this.hot(v);
    switch (v.phase) {
      case 'pick': {
        const p = v.picker!;
        if (mine.includes(p) && this.human(v, p) && this.can(p)) {
          if (hot) btn(`✍ Загадывает ${nm(p)}`, () => ((this.picking = true), this.coverFor(v)), 'btn primary');
          else this.panel.appendChild(this.pickForm(v, p));
        } else add(`<div class="cr-wait">${nm(p)} загадывает слово…</div>`);
        break;
      }
      case 'ready': {
        if (mine.includes(v.shower) && this.human(v, v.shower) && this.can(v.shower)) {
          add(`<div class="cr-ask">Ваша очередь показывать${v.time ? ` — ${v.time / 60000} мин.` : ''}</div>`);
          const b = btn(hot ? '▶ Посмотреть слово' : '▶ Старт', () => this.send(v.shower, { type: 'start' }), 'btn primary cr-go');
          b.dataset.tap = '';
        } else add(`<div class="cr-wait">Сейчас показывает ${nm(v.shower)}…</div>`);
        break;
      }
      case 'show':
        this.showPanel(v, btn, add);
        break;
      case 'reveal': {
        add(`<div class="cr-sum">${this.scoreHTML(v)}</div>`);
        const me = mine.find((x) => this.human(v, x) && this.can(x));
        if (me != null) {
          const b = btn(hot ? 'Дальше — передать телефон' : 'Дальше', () => this.send(me, { type: 'next' }), 'btn primary');
          b.dataset.tap = '';
        }
        break;
      }
      case 'over':
        add(`<div class="cr-sum">${this.scoreHTML(v)}</div>`);
        break;
    }
  }

  private showPanel(v: View, btn: (l: string, fn: () => void, cls?: string, box?: HTMLElement) => HTMLButtonElement, add: (html: string) => void) {
    const nm = (x: number) => esc(this.plain(x));
    const hot = this.hot(v);
    const me = this.showerHere(v);
    const bots = v.eligible.filter((x) => !this.human(v, x));
    const people = v.eligible.filter((x) => this.human(v, x));
    if (me != null) {
      if (v.style === 'emoji') {
        if (hot) btn('😶 Набрать эмодзи', () => ((this.composing = true), this.coverFor(v)), 'btn primary');
        else this.panel.appendChild(this.palette(v, me, false));
      } else add(`<div class="cr-ask">Показывайте молча!${hot ? '' : this.ctx.online ? ' Вас видно по камере.' : ''}</div>`);
      if (people.length) {
        add('<div class="cr-note">Угадали вслух:</div>');
        const row = h('<div class="cr-row cr-who"></div>');
        for (const x of people) btn(`✓ ${nm(x)}`, () => this.send(me, { type: 'got', by: x }), 'btn cr-b-got', row);
        this.panel.appendChild(row);
      }
      if (bots.length && v.style === 'gesture' && v.deck?.length) {
        const left = v.deck.filter((d) => !d.used).length;
        if (hot) {
          const b = btn(`🃏 Карточка ботам${left ? ` (ещё ${left})` : ''}`, () => this.send(me, { type: 'card' }), 'btn');
          b.disabled = !left;
        } else {
          add('<div class="cr-note">Боты жестов не видят — выложите им карточки:</div>');
          const grid = h('<div class="cr-deck"></div>');
          v.deck.forEach((d, n) => {
            const b = btn(esc(cardText(d.card)), () => this.send(me, { type: 'card', n }), 'btn cr-deck-b', grid);
            b.disabled = d.used;
          });
          this.panel.appendChild(grid);
        }
      }
      const row = h('<div class="cr-row"></div>');
      if (v.skip === 'free' || (v.skip === 'one' && v.skips < 1)) btn('⏭ Пропуск', () => this.send(me, { type: 'skip' }), 'btn', row);
      btn('🏳 Сдаюсь', () => this.send(me, { type: 'giveup' }), 'btn', row);
      if (hot && v.word) btn('👁 Слово', () => ((this.peeked = ''), this.coverFor(v)), 'btn', row);
      this.panel.appendChild(row);
      return;
    }
    // угадывает человек за этим экраном (по сети — пишет; на одном телефоне — кричат вслух)
    const g = this.mine(v).find((x) => v.eligible.includes(x) && this.human(v, x) && this.can(x));
    if (g != null && !hot) {
      add(`<div class="cr-ask">${this.human(v, v.shower) ? (v.style === 'emoji' ? `${nm(v.shower)} показывает эмодзи.` : `Показывает ${nm(v.shower)} — смотрите и называйте вслух.`) : `Бот ${nm(v.shower)} показывает карточками.`} Или напишите:</div>`);
      const el = h('<div class="cr-type"><input type="text" maxlength="60" placeholder="догадка…" autocomplete="off"></div>');
      const inp = el.querySelector('input') as HTMLInputElement;
      const go = () => {
        const t = inp.value.trim();
        if (!t) return;
        this.send(g, { type: 'guess', text: t });
        inp.value = '';
      };
      btn('➤', go, 'btn primary', el);
      inp.onkeydown = (e) => e.key === 'Enter' && (e.preventDefault(), go());
      this.panel.appendChild(el);
      setTimeout(() => document.activeElement === document.body && inp.focus({ preventScroll: true }), 0);
      return;
    }
    add(`<div class="cr-wait">${nm(v.shower)} показывает${v.teams ? ' своей команде' : ''}. ${hot ? 'Кричите догадки!' : 'Не подсказывайте!'}</div>`);
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    const prev = this.v;
    if (!prev || prev.seq !== v.seq || prev.t !== v.t) this.lastCards = 0;
    this.v = v;
    if (v.phase !== 'show') this.composing = false;
    this.draw();
    this.lastCards = v.cards.length;
    this.renderPanel();
    this.coverFor(v);
  }

  async play(events: Event[], v: View) {
    const speed = this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'turn') Sound.turn();
      else if (ev.type === 'start') Sound.card();
      else if (ev.type === 'card') {
        Sound.card();
        if (v.virt) await this.show(v, 1100 / speed);
      } else if (ev.type === 'guess' && ev.res !== 'right') {
        Sound.ui();
        if (v.virt) await this.show(v, 500 / speed);
      } else if (ev.type === 'nod') Sound.step();
      else if (ev.type === 'skip') Sound.shuffle();
      else if (ev.type === 'done') {
        if (ev.res === 'got') Sound.place();
        else {
          Sound.beep(320, 0.5, 0.18);
          await sleep(120);
          Sound.beep(240, 0.6, 0.18);
        }
      } else if (ev.type === 'over') Sound.win();
    }
    this.setView(v);
  }

  private async show(v: View, ms: number) {
    this.v = v;
    this.draw();
    this.lastCards = v.cards.length;
    await sleep(ms);
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.interactive = interactive;
    if (!this.v) return;
    this.draw();
    this.renderPanel();
    this.coverFor(this.v);
  }

  status(v: View, _toAct: number[], interactive: number[]) {
    const nm = (p: number) => this.ctx.name(p);
    switch (v.phase) {
      case 'pick':
        return `${nm(v.picker!)} загадывает слово`;
      case 'ready':
        return `Показывает ${nm(v.shower)}`;
      case 'show':
        return interactive.includes(v.shower) && v.humans.includes(v.shower) ? 'Показывайте — молча!' : `${nm(v.shower)} показывает`;
      case 'reveal':
        return 'Слово открыто';
      default:
        return 'Игра окончена';
    }
  }

  playerStats(v: View, seat: number) {
    if (v.teams) {
      const t = v.teams.find((x) => x.includes(seat))!;
      return `команда ${v.teams.indexOf(t) + 1}: ${teamScore(v, t)}`;
    }
    return `${total(v, seat)} очк.`;
  }

  spotlight(v: View) {
    return this.spotOn(v) ? v.shower : null;
  }
}

export function createView(): GameView<View, Event> {
  return new CrocView();
}
