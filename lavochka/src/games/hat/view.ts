/* Шляпа — отрисовка: кухонный стол, игроки кругом, посередине — фетровая шляпа с бумажками и часы хода.
 * Объясняющему — бумажка со словом крупно и кнопки «Угадано / Ошибка / Пропуск»; угадывающему по подсказкам бота — варианты и поле для слова.
 * Хот-сит: перед ходом занавеска «передайте телефон», свои слова каждый пишет за занавеской. Часы идут по местному времени этого экрана:
 * когда они кончаются у человека из пары, экран сам присылает «время вышло». */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { plural, ROUND_HOW, ROUND_NAME, SEATS } from './def';
import { LAST_MS, LAST_TYPE_MS, teamScore, total, type Event, type View } from './engine';
import './hat.css';

const HAT_SVG = `<svg class="ht-hat-svg" viewBox="0 0 200 120" aria-hidden="true">
  <defs>
    <linearGradient id="htFelt" x1="0" x2="1"><stop offset="0" stop-color="#2b2420"/><stop offset=".45" stop-color="#4a3d33"/><stop offset="1" stop-color="#211b17"/></linearGradient>
    <radialGradient id="htIn" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#120d0a"/><stop offset="1" stop-color="#2a211b"/></radialGradient>
  </defs>
  <ellipse cx="100" cy="104" rx="96" ry="14" fill="rgba(0,0,0,.35)"/>
  <ellipse cx="100" cy="98" rx="94" ry="16" fill="url(#htFelt)"/>
  <path d="M40 96 C40 70 46 40 52 28 L148 28 C154 40 160 70 160 96 Z" fill="url(#htFelt)"/>
  <path d="M43 80 C43 76 44 72 45 68 L155 68 C156 72 157 76 157 80 C130 86 70 86 43 80 Z" fill="#7a1f1a"/>
  <ellipse cx="100" cy="28" rx="48" ry="10" fill="url(#htIn)"/>
</svg>`;

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s);
};

class HatView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private root!: HTMLElement;
  private ring!: HTMLElement;
  private center!: HTMLElement;
  private cover!: HTMLElement;
  private panel!: HTMLElement;
  private v: View | null = null;
  private interactive: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Когда этот экран увидел начало хода / последнего слова (местные часы). */
  private seen = new Map<string, number>();
  private sent = '';
  private beeped = -1;
  /** Хот-сит: кто сейчас пишет свои слова за занавеской. */
  private writing: number | null = null;
  private draft = '';
  private pulled = -1;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h(`<div class="ht-wrap"><div class="ht-bg"></div><div class="ht-ring"></div><div class="ht-center"></div>
      <div class="ht-cover" hidden><div class="ht-cover-box"></div></div></div>`);
    root.appendChild(this.root);
    this.ring = this.root.querySelector('.ht-ring') as HTMLElement;
    this.center = this.root.querySelector('.ht-center') as HTMLElement;
    this.cover = this.root.querySelector('.ht-cover') as HTMLElement;
    this.panel = h('<div class="ht-panel"></div>');
    ctx.controls.appendChild(this.panel);
    this.timer = setInterval(() => this.tick(), 200);
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
  private can(x: number) {
    return this.interactive.includes(x);
  }
  private human(v: View, x: number) {
    return v.humans.includes(x);
  }
  private send(seat: number, a: unknown) {
    this.ctx.act(seat, a);
  }

  // ---------------------------------------------------------------- часы

  private key(v: View, what = '') {
    return `${v.gid}:${v.t}${what}`;
  }
  private mark(v: View) {
    if (v.phase === 'explain' && !this.seen.has(this.key(v))) this.seen.set(this.key(v), Date.now());
    if (v.phase === 'last' && !this.seen.has(this.key(v, ':last'))) this.seen.set(this.key(v, ':last'), Date.now());
  }
  /** Сколько осталось хода, мс. */
  private left(v: View): number {
    if (v.phase === 'ready' || v.phase === 'write') return v.time;
    if (v.phase !== 'explain') return 0;
    if (v.virt || this.ctx.demo) return v.time - v.used;
    return v.time - (Date.now() - (this.seen.get(this.key(v)) ?? Date.now()));
  }
  /** Окно последнего слова: человек угадывает по подсказкам бота — печатать дольше. */
  private lastWindow(v: View) {
    return !this.human(v, v.exp) && this.human(v, v.gue) ? LAST_TYPE_MS : LAST_MS;
  }

  private tick() {
    const v = this.v;
    const el = this.center.querySelector('.ht-clock') as HTMLElement | null;
    if (!v || !el) return;
    if (v.phase === 'last') {
      const left = this.lastWindow(v) - (Date.now() - (this.seen.get(this.key(v, ':last')) ?? Date.now()));
      el.innerHTML = `<b>${this.ctx.demo ? '!' : mmss(left)}</b><small>последнее слово</small>`;
      el.className = 'ht-clock ht-hurry';
      // угадывает человек по подсказкам бота — окно кончилось, сам говорит «не успел»
      const me = this.mine(v).find((x) => x === v.gue && this.can(x));
      if (!this.ctx.demo && me != null && !this.human(v, v.exp) && left <= 0 && this.sent !== this.key(v, ':nope')) {
        this.sent = this.key(v, ':nope');
        this.send(me, { type: 'nope' });
      }
      return;
    }
    const left = this.left(v);
    const run = v.phase === 'explain';
    el.innerHTML = `<b>${mmss(left)}</b><small>${run ? 'секунд' : 'на ход'}</small>`;
    el.className = `ht-clock${run && left <= 5000 ? ' ht-hurry' : ''}${run && !v.virt ? ' ht-run' : ''}`;
    el.style.setProperty('--p', String(Math.max(0, Math.min(1, left / v.time))));
    if (!run || v.virt || this.ctx.demo) return;
    const pair = [v.exp, v.gue].filter((x) => this.mine(v).includes(x) && this.human(v, x));
    const s = Math.ceil(left / 1000);
    if (pair.length && s <= 5 && s > 0 && s !== this.beeped) {
      this.beeped = s;
      Sound.beep(1200, 0.06, 0.08);
    }
    if (left <= 0) {
      const me = pair.find((x) => this.can(x));
      if (me != null && this.sent !== this.key(v)) {
        this.sent = this.key(v);
        this.send(me, { type: 'timeup' });
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
    const active = v.phase === 'ready' || v.phase === 'explain' || v.phase === 'last' || v.phase === 'review';
    let s = '';
    order.forEach((seat, k) => {
      const a = Math.PI / 2 + (k / n) * Math.PI * 2;
      const x = 50 + Math.cos(a) * 44;
      const y = 50 + Math.sin(a) * 41;
      const role = active && seat === v.exp ? 'exp' : active && seat === v.gue ? 'gue' : '';
      const team = v.teams ? v.teams.findIndex((t) => t.includes(seat)) : -1;
      const score = v.teams ? '' : ` <b>${total(v, seat)}</b>`;
      const tag = role === 'exp' ? '<span class="ht-tag">объясняет</span>' : role === 'gue' ? '<span class="ht-tag ht-tag-g">угадывает</span>' : '';
      const wrote = v.phase === 'write' ? `<span class="ht-tag ${v.written.includes(seat) ? 'ht-tag-g' : 'ht-tag-w'}">${v.written.includes(seat) ? 'положил' : 'пишет…'}</span>` : '';
      s += `<div class="ht-seat${role ? ' ht-' + role : ''}" style="left:${x}%;top:${y}%;--c:${SEATS[seat].color}">
        <div class="ht-face">${role === 'exp' ? '🎩' : esc(this.plain(seat)).slice(0, 1)}</div>
        <div class="ht-name">${esc(this.plain(seat))}${score}${team >= 0 ? ` <i class="ht-team ht-team${team}">${team + 1}</i>` : ''}</div>${tag}${wrote}</div>`;
    });
    this.ring.innerHTML = s;
    this.center.innerHTML = this.centerHTML(v);
    this.tick();
  }

  private head(v: View) {
    const r = v.rounds > 1 ? `Круг ${v.round + 1} из ${v.rounds}: <b>${ROUND_NAME[v.round]}</b>` : 'Объясняем словами';
    return `<div class="ht-head"><span>${r}</span><span>в шляпе <b>${v.hatLeft}</b> из ${v.total}</span></div>`;
  }

  private hatHTML(v: View, slip = '') {
    const k = Math.min(9, v.hatLeft);
    const slips = Array.from({ length: k }, (_, i) => `<i style="--r:${(i * 37) % 50 - 25}deg;--x:${(i * 23) % 60 - 30}px"></i>`).join('');
    return `<div class="ht-hat"><div class="ht-slips">${slips}</div>${HAT_SVG}${slip}</div>`;
  }

  private centerHTML(v: View): string {
    const nm = (x: number) => esc(this.plain(x));
    if (v.phase === 'write') {
      return `<div class="ht-card">${this.hatHTML(v)}<div class="ht-big">Пишем слова в шляпу</div>
        <div class="ht-sub">по ${v.per} на каждого — тайно; положили ${v.written.length} из ${v.humans.length}</div></div>`;
    }
    if (v.phase === 'over') return `<div class="ht-card ht-final">${this.scoreHTML(v, true)}</div>`;
    const clock = '<div class="ht-clock"></div>';
    const pair = `<div class="ht-pair"><b style="color:${SEATS[v.exp].color}">${nm(v.exp)}</b> <span>→</span> <b style="color:${SEATS[v.gue].color}">${nm(v.gue)}</b></div>`;
    if (v.phase === 'ready') {
      return `<div class="ht-card">${this.head(v)}${pair}${clock}${this.hatHTML(v)}<div class="ht-sub">${ROUND_HOW[v.round]}</div></div>`;
    }
    if (v.phase === 'review') {
      const got = v.turn.filter((d) => d.res === 'got').length;
      return `<div class="ht-card">${this.head(v)}${pair}<div class="ht-big">${got} ${plural(got)}</div>${this.hatHTML(v)}${this.chipsHTML(v)}</div>`;
    }
    // ход идёт
    // бумажка вылетает из шляпы один раз — когда её вытянули, а не при каждой перерисовке
    const anim = this.pulled !== v.seq && !this.ctx.demo ? ' ht-pulled' : '';
    this.pulled = v.seq;
    const fs = v.word ? (v.word.length <= 6 ? 46 : v.word.length <= 9 ? 40 : v.word.length <= 12 ? 34 : 28) : 0;
    const word = v.word
      ? `<div class="ht-slip ht-slip-open${anim}" style="--fs:${fs}px"><span>${esc(v.word)}</span></div>`
      : `<div class="ht-slip ht-slip-shut${anim}"><span>?</span></div>`;
    const hints = v.hints.length
      ? `<div class="ht-hints">${v.hints.map((x, i) => `<div class="ht-hint${i === v.hints.length - 1 ? ' ht-hint-new' : ''}">💬 ${esc(x.text)}</div>`).join('')}</div>`
      : '';
    const tries = v.tries.filter((x) => !x.right).length
      ? `<div class="ht-tries">${v.tries.filter((x) => !x.right).map((x) => `<s>${esc(x.text)}</s>`).join(' ')}</div>`
      : '';
    return `<div class="ht-card ht-play">${this.head(v)}${pair}${word}<div class="ht-mid">${clock}${this.hatHTML(v)}</div>${hints}${tries}${this.chipsHTML(v)}</div>`;
  }

  private chipsHTML(v: View) {
    if (!v.turn.length) return '';
    const mark = { got: '✓', miss: '✗', skip: '⏭', back: '↩' } as const;
    return `<div class="ht-chips">${v.turn
      .map((d) => `<span class="ht-chip ht-${d.res}">${mark[d.res]} ${d.w ? esc(d.w) : d.res === 'skip' ? 'пропуск' : 'в шляпу'}${d.last ? ' ⏰' : ''}</span>`)
      .join('')}</div>`;
  }

  private scoreHTML(v: View, final: boolean) {
    const nm = (x: number) => esc(this.plain(x));
    if (v.teams) {
      const rows = v.teams
        .map((t, j) => ({ t, j, sc: teamScore(v, t) }))
        .sort((a, b) => b.sc - a.sc)
        .map((r) => `<tr><td><i class="ht-team ht-team${r.j}">${r.j + 1}</i> ${r.t.map(nm).join(' и ')}</td><td><b>${r.sc}</b></td></tr>`)
        .join('');
      return `${final ? '<div class="ht-big">Игра окончена</div>' : ''}<table class="ht-score"><tr><th>Команда</th><th>слов</th></tr>${rows}</table>`;
    }
    const rows = v.seats
      .slice()
      .sort((a, b) => total(v, b) - total(v, a))
      .map((x) => `<tr><td>${nm(x)}</td><td>${v.expl[x] ?? 0}</td><td>${v.gues[x] ?? 0}</td><td><b>${total(v, x)}</b></td></tr>`)
      .join('');
    return `${final ? '<div class="ht-big">Игра окончена</div>' : ''}<table class="ht-score"><tr><th></th><th>объяснил</th><th>угадал</th><th>всего</th></tr>${rows}</table>`;
  }

  // ---------------------------------------------------------------- занавеска (хот-сит)

  private showCover(html: string, buttons: [string, () => void, string?][]) {
    const box = this.cover.querySelector('.ht-cover-box') as HTMLElement;
    box.innerHTML = html;
    const row = h('<div class="ht-row"></div>');
    for (const [label, fn, cls] of buttons) {
      const b = h<HTMLButtonElement>(`<button class="btn ${cls ?? 'primary'}">${label}</button>`);
      b.onclick = () => {
        Sound.unlock();
        fn();
      };
      row.appendChild(b);
    }
    box.appendChild(row);
    this.cover.hidden = false;
  }

  private coverFor(v: View) {
    if (this.ctx.demo || !this.hot(v)) {
      this.cover.hidden = true;
      return;
    }
    if (v.phase === 'ready') {
      const starter = [v.exp, v.gue].find((x) => this.human(v, x) && this.mine(v).includes(x));
      if (starter == null || !this.can(starter)) {
        this.cover.hidden = true;
        return;
      }
      const nm = (x: number) => this.ctx.name(x);
      const who = this.human(v, v.exp)
        ? `Телефон — ${nm(v.exp)}: объясняет ${nm(v.gue)}${this.human(v, v.gue) ? '' : ' подсказками из словаря'}.`
        : `${nm(v.exp)} объясняет подсказками, угадывает ${nm(v.gue)}.`;
      const how = v.rounds > 1 ? `<div class="ht-cover-how">Круг ${v.round + 1}: ${ROUND_HOW[v.round]}</div>` : '';
      this.showCover(`<div class="ht-cover-t">${who}<br><small>Остальные — не подглядывать! ${v.time / 1000} секунд.</small></div>${how}`, [
        ['Поехали!', () => this.send(starter, { type: 'start' })],
      ]);
      return;
    }
    if (v.phase === 'write' && this.writing != null && !v.written.includes(this.writing)) return;
    this.cover.hidden = true;
  }

  /** Свои слова: поле на N слов. */
  private writeForm(v: View, seat: number, inCover: boolean): HTMLElement {
    const el = h(`<div class="ht-write"><div class="ht-ask">${inCover ? esc(this.plain(seat)) + ', ваши' : 'Ваши'} слова в шляпу — по слову в строке, ${v.per} шт.
      Существительные, которые можно объяснить: «самовар», «двоечник», «Чебурашка».</div>
      <textarea rows="${Math.min(8, v.per)}" maxlength="${v.per * 32}" placeholder="самовар&#10;двоечник&#10;…"></textarea>
      <div class="ht-row"><span class="ht-count"></span></div></div>`);
    const ta = el.querySelector('textarea') as HTMLTextAreaElement;
    const cnt = el.querySelector('.ht-count') as HTMLElement;
    const row = el.querySelector('.ht-row') as HTMLElement;
    const list = () =>
      ta.value
        .split(/\n|,/)
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, v.per);
    const b = h<HTMLButtonElement>('<button class="btn primary">В шляпу</button>');
    const upd = () => {
      const n = list().length;
      cnt.textContent = `${n} из ${v.per}`;
      b.disabled = n < v.per;
      this.draft = ta.value;
    };
    ta.value = this.draft;
    ta.oninput = upd;
    b.onclick = () => {
      if (list().length < v.per) return;
      this.draft = '';
      this.writing = null;
      this.cover.hidden = true;
      this.send(seat, { type: 'words', list: list() });
    };
    row.appendChild(b);
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
    const nm = (x: number) => esc(this.plain(x));

    switch (v.phase) {
      case 'write': {
        const left = mine.filter((x) => this.human(v, x) && !v.written.includes(x) && this.can(x));
        if (!left.length) {
          add(`<div class="ht-wait">${mine.some((x) => v.myWords[x]) ? 'Ваши слова в шляпе. ' : ''}Ждём остальных…</div>`);
          break;
        }
        if (left.length === 1 && !this.hot(v)) {
          this.panel.appendChild(this.writeForm(v, left[0], false));
          break;
        }
        add('<div class="ht-ask">Каждый тайно пишет свои слова — передавайте телефон по очереди:</div>');
        const row = h('<div class="ht-row"></div>');
        for (const x of left)
          btn(`✍ ${nm(x)}`, () => {
            this.writing = x;
            this.draft = '';
            const box = this.cover.querySelector('.ht-cover-box') as HTMLElement;
            this.showCover(`<div class="ht-cover-t">Слова пишет ${this.ctx.name(x)}.<br><small>Остальные — не подглядывать!</small></div>`, [
              ['Это я', () => {
                box.innerHTML = '';
                box.appendChild(this.writeForm(v, x, true));
                const back = h<HTMLButtonElement>('<button class="btn">Отмена</button>');
                back.onclick = () => {
                  this.writing = null;
                  this.cover.hidden = true;
                };
                (box.querySelector('.ht-row') as HTMLElement).appendChild(back);
              }],
              ['Отмена', () => ((this.writing = null), (this.cover.hidden = true)), 'btn'],
            ]);
          }, 'btn', row);
        this.panel.appendChild(row);
        break;
      }
      case 'ready': {
        const starter = [v.exp, v.gue].find((x) => this.human(v, x));
        if (starter != null && mine.includes(starter) && this.can(starter)) {
          add(`<div class="ht-ask">${starter === v.exp ? `Объясняете ${nm(v.gue)}${this.human(v, v.gue) ? '' : ' — боту, подсказками из словаря'}` : `Угадываете — объясняет бот ${nm(v.exp)}`}. ${v.time / 1000} секунд.</div>`);
          const b = btn('▶ Старт', () => this.send(starter, { type: 'start' }), 'btn primary ht-go');
          b.dataset.tap = '';
        } else add(`<div class="ht-wait">Сейчас ${nm(v.exp)} объясняет ${nm(v.gue)}…</div>`);
        break;
      }
      case 'explain':
        this.explainPanel(v, btn, add);
        break;
      case 'last': {
        const meE = mine.find((x) => x === v.exp && this.can(x) && this.human(v, x));
        const meG = mine.find((x) => x === v.gue && this.can(x) && this.human(v, x));
        if (meE != null && this.human(v, v.gue)) {
          add(`<div class="ht-ask">Последнее слово! ${nm(v.gue)} — успели назвать «${esc(v.word ?? '')}»?</div>`);
          const row = h('<div class="ht-row ht-big-row"></div>');
          btn('✓ Угадали', () => this.send(meE, { type: 'got' }), 'btn ht-b-got', row);
          btn('Не успели', () => this.send(meE, { type: 'nope' }), 'btn ht-b-miss', row);
          this.panel.appendChild(row);
        } else if (meG != null && !this.human(v, v.exp)) {
          add('<div class="ht-ask">Последнее слово — успейте!</div>');
          this.guessBox(v, meG, btn);
        } else add('<div class="ht-wait">Последнее слово…</div>');
        break;
      }
      case 'review': {
        const me = mine.find((x) => (x === v.exp || x === v.gue) && this.can(x));
        add(`<div class="ht-sum">${this.scoreHTML(v, false)}</div>`);
        if (me != null) btn(this.hot(v) ? 'Передать телефон дальше' : 'Дальше', () => this.send(me, { type: 'next' }), 'btn primary');
        break;
      }
      case 'over':
        add(`<div class="ht-sum">${this.scoreHTML(v, false)}</div>`);
        break;
    }
  }

  private explainPanel(v: View, btn: (l: string, fn: () => void, cls?: string, box?: HTMLElement) => HTMLButtonElement, add: (html: string) => void) {
    const mine = this.mine(v);
    const nm = (x: number) => esc(this.plain(x));
    const meE = mine.find((x) => x === v.exp && this.can(x) && this.human(v, x));
    if (meE != null) {
      if (this.human(v, v.gue)) {
        const row = h('<div class="ht-row ht-big-row"></div>');
        btn('✓ Угадано', () => this.send(meE, { type: 'got' }), 'btn ht-b-got', row);
        this.panel.appendChild(row);
        const row2 = h('<div class="ht-row"></div>');
        btn('✗ Ошибка', () => this.send(meE, { type: 'miss' }), 'btn ht-b-miss', row2);
        if (v.skip !== 'off') btn(`⏭ Пропуск${v.skip === 'penalty' ? ' (−1)' : ''}`, () => this.send(meE, { type: 'skip' }), 'btn', row2);
        this.panel.appendChild(row2);
        add(`<div class="ht-note">${ROUND_HOW[v.round]} «Ошибка» — если сказали однокоренное или перевод: слово ${v.miss === 'burn' ? 'сгорит' : 'вернётся в шляпу'}.</div>`);
      } else {
        add(`<div class="ht-ask">${nm(v.gue)} — бот: голос не слышит. Объясняйте подсказками из словаря.</div>`);
        const row = h('<div class="ht-row ht-big-row"></div>');
        const b = btn(`💬 Подсказка${v.hintsLeft ? ` (ещё ${v.hintsLeft})` : ''}`, () => this.send(meE, { type: 'hint' }), 'btn ht-b-got', row);
        b.disabled = v.hintsLeft <= 0;
        if (v.skip !== 'off') btn(`⏭ Пропуск${v.skip === 'penalty' ? ' (−1)' : ''}`, () => this.send(meE, { type: 'skip' }), 'btn', row);
        this.panel.appendChild(row);
      }
      return;
    }
    const meG = mine.find((x) => x === v.gue && this.can(x) && this.human(v, x));
    if (meG != null) {
      if (this.human(v, v.exp))
        add(`<div class="ht-ask">Слушайте ${nm(v.exp)} и называйте слово вслух. Если голос не слышно — напечатайте:</div>`);
      else add(`<div class="ht-ask">Бот ${nm(v.exp)} объясняет подсказками — угадайте слово:</div>`);
      this.guessBox(v, meG, btn);
      return;
    }
    add(`<div class="ht-wait">${nm(v.exp)} объясняет ${nm(v.gue)}. Не подсказывайте!</div>`);
  }

  /** Угадать: варианты (по подсказкам бота) и поле для слова. */
  private guessBox(v: View, seat: number, btn: (l: string, fn: () => void, cls?: string, box?: HTMLElement) => HTMLButtonElement) {
    if (v.options) {
      const wrong = new Set(v.tries.filter((t) => !t.right).map((t) => t.text.toLowerCase()));
      const grid = h('<div class="ht-opts"></div>');
      for (const o of v.options) {
        const b = btn(esc(o), () => this.send(seat, { type: 'guess', text: o }), 'btn ht-opt', grid);
        b.disabled = wrong.has(o.toLowerCase());
      }
      this.panel.appendChild(grid);
    }
    const el = h('<div class="ht-type"><input type="text" maxlength="30" placeholder="слово…" autocomplete="off"></div>');
    const inp = el.querySelector('input') as HTMLInputElement;
    const go = () => inp.value.trim() && this.send(seat, { type: 'guess', text: inp.value.trim() });
    btn('Это!', go, 'btn primary', el);
    inp.onkeydown = (e) => e.key === 'Enter' && (e.preventDefault(), go());
    this.panel.appendChild(el);
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    this.v = v;
    this.mark(v);
    this.draw();
    this.renderPanel();
    this.coverFor(v);
  }

  async play(events: Event[], v: View) {
    const speed = this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'start') Sound.card();
      else if (ev.type === 'draw') Sound.shuffle();
      else if (ev.type === 'got') {
        Sound.place();
        // пара ботов играет в условном времени — даём разглядеть
        if (v.virt) await this.show(v, 700 / speed);
      } else if (ev.type === 'miss') Sound.nomove();
      else if (ev.type === 'skip') Sound.step();
      else if (ev.type === 'hint') {
        Sound.chat();
        if (v.virt) await this.show(v, 1100 / speed);
      } else if (ev.type === 'guess' && !ev.right) {
        Sound.ui();
        if (v.virt) await this.show(v, 600 / speed);
      }
      else if (ev.type === 'timeup') {
        Sound.beep(320, 0.5, 0.18);
        await sleep(120);
        Sound.beep(240, 0.6, 0.18);
      } else if (ev.type === 'turnEnd') {
        this.v = v;
        this.draw();
        await sleep(500 / speed);
      } else if (ev.type === 'round') Sound.turn();
      else if (ev.type === 'over') Sound.win();
    }
    this.setView(v);
  }

  private async show(v: View, ms: number) {
    this.v = v;
    this.draw();
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
      case 'write':
        return interactive.length ? 'Напишите слова в шляпу' : 'Игроки пишут слова…';
      case 'ready':
        return `${nm(v.exp)} объясняет ${nm(v.gue)}`;
      case 'explain':
        return interactive.includes(v.exp) && v.humans.includes(v.exp) ? 'Объясняйте!' : `${nm(v.exp)} объясняет ${nm(v.gue)}`;
      case 'last':
        return 'Последнее слово!';
      case 'review':
        return 'Ход окончен';
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
}

export function createView(): GameView<View, Event> {
  return new HatView();
}
