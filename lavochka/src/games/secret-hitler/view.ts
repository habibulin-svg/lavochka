/* Тайный Гитлер — отрисовка: поля фашистов и либералов из русского PnP (законы ложатся в клетки, лишние для этого стола полномочия притушены,
 * жетон «Хода выборов» на поле либералов), над ними — игроки с табличками президента/канцлера и картами голосования,
 * ниже — история правительств. Своя карта роли и карта партии — в боковой панели (нажать — открыть).
 * Сессия: карты законов — крупно поверх полей, только президенту/канцлеру. Хот-сит: всё тайное — за занавеской. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from './def';
import { alive, boardPowers, cardsText, eligible, partyOf, POWER_NAME, ROLE_LOW, ROLE_NAME, type Event, type Gov, type Party, type Role, type View } from './engine';
import './secret-hitler.css';

const IMG = '/secret-hitler/';
const pol = (p: Party) => `${IMG}policy-${p === 'L' ? 'liberal' : 'fascist'}.webp`;
const roleImg = (r: Role, art: number | undefined) => `${IMG}role-${r === 'hitler' ? 'hitler' : `${r}-${(art ?? 0) + 1}`}.webp`;

/** Клетки полей в процентах картинки (замерено по PnP). */
const F_X = [6.5, 20.5, 35.2, 49.9, 64.7, 79.5, 93.9];
const F_Y = [19.0, 39.9, 60.5, 81.5];
const L_X = [13.5, 28.0, 42.6, 57.3, 72.0, 86.8];
const L_Y = [19.2, 81.4];
const TRACK_X = [34.2, 44.2, 54.1, 64.1];
const TRACK_Y = 91.0;

/** Цветные «Л»/«Ф» для заявлений. */
const chips = (fas: number, n: number) =>
  cardsText(fas, n)
    .split('')
    .map((c) => `<i class="sh-chip sh-chip-${c === 'Л' ? 'l' : 'f'}">${c}</i>`)
    .join('');


class SecretHitlerView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private root!: HTMLElement;
  private seatsEl!: HTMLElement;
  private boardsEl!: HTMLElement;
  private histEl!: HTMLElement;
  private stage!: HTMLElement;
  private cover!: HTMLElement;
  private panel!: HTMLElement;
  private v: View | null = null;
  private interactive: number[] = [];
  /** Хот-сит: чьё тайное сейчас открыто (после занавески). */
  private open: number | null = null;
  /** Своя карта роли открыта (один игрок за экраном). */
  private shown = false;
  private fresh: { side: Party; k: number } | null = null;
  private revealVotes = false;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h(`<div class="sh-wrap"><div class="sh-scroll"><div class="sh-seats"></div><div class="sh-boards"></div><div class="sh-hist"></div></div>
      <div class="sh-stage" hidden></div>
      <div class="sh-cover" hidden><div class="sh-cover-box"><div class="sh-cover-t"></div><div class="sh-cover-b"></div></div></div></div>`);
    root.appendChild(this.root);
    this.seatsEl = this.root.querySelector('.sh-seats') as HTMLElement;
    this.boardsEl = this.root.querySelector('.sh-boards') as HTMLElement;
    this.histEl = this.root.querySelector('.sh-hist') as HTMLElement;
    this.stage = this.root.querySelector('.sh-stage') as HTMLElement;
    this.cover = this.root.querySelector('.sh-cover') as HTMLElement;
    this.panel = h('<div class="sh-panel"></div>');
    ctx.controls.appendChild(this.panel);
    this.seatsEl.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-seat]') as HTMLElement | null;
      if (el) this.pickSeat(+el.dataset.seat!);
    });
  }

  // ---------------------------------------------------------------- кто за экраном

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '').replace(/\s*\(бот\)/, '');
  }
  private mine(v: View) {
    return this.ctx.demo ? [] : this.ctx.mySeats.filter((x) => v.seats.includes(x));
  }
  private hotseat(v: View) {
    return this.mine(v).length > 1;
  }
  /** Можно ли сейчас показывать тайное места x. */
  private sees(v: View, x: number) {
    if (this.ctx.demo) return false;
    return this.hotseat(v) ? this.open === x : this.mine(v).includes(x);
  }
  private can(seat: number) {
    return this.interactive.includes(seat);
  }
  private send(seat: number, a: unknown) {
    if (this.v && this.hotseat(this.v)) this.open = null;
    this.ctx.act(seat, a);
  }

  /** Хот-сит: занавеска «смотрит такой-то». */
  private curtain(seat: number, then?: () => void) {
    const t = this.cover.querySelector('.sh-cover-t') as HTMLElement;
    const b = this.cover.querySelector('.sh-cover-b') as HTMLElement;
    t.innerHTML = `Устройство — ${this.ctx.name(seat)}.<br><small>Остальные — не подглядывать!</small>`;
    b.innerHTML = '';
    const ok = h<HTMLButtonElement>('<button class="btn primary">Это я, смотрю</button>');
    ok.onclick = () => {
      Sound.unlock();
      this.cover.hidden = true;
      this.open = seat;
      then?.();
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
    this.drawBoards(v);
    this.drawHistory(v);
    this.drawStage(v);
  }

  private lastGov(v: View): Gov | undefined {
    return v.govs[v.govs.length - 1];
  }

  /** Чьи роли видны этому экрану (своя и известные свои). */
  private known(v: View): Record<number, Role> {
    if (v.revealed) return v.revealed;
    const out: Record<number, Role> = {};
    for (const x of this.mine(v)) if (this.sees(v, x)) Object.assign(out, v.know[x]);
    return out;
  }

  private drawSeats(v: View) {
    const g = this.lastGov(v);
    const targets = this.targets(v);
    const known = this.known(v);
    const showVotes = !!g?.votes && v.phase !== 'vote' && v.phase !== 'nominate' ? g.votes : this.revealVotes && g?.votes ? g.votes : null;
    let s = '';
    for (const x of v.seats) {
      const dead = v.dead.includes(x);
      const placards: string[] = [];
      if (v.phase !== 'night' && v.phase !== 'over') {
        if (x === v.pres) placards.push(`<img class="sh-plq" src="${IMG}placard-president.webp" alt="Президент" title="${v.phase === 'nominate' || v.phase === 'vote' ? 'кандидат в президенты' : 'президент'}">`);
        if (x === v.chanc) placards.push(`<img class="sh-plq" src="${IMG}placard-chancellor.webp" alt="Канцлер" title="${v.phase === 'vote' ? 'кандидат в канцлеры' : 'канцлер'}">`);
        if (x === v.lastPres && x !== v.pres && x !== v.chanc) placards.push(`<img class="sh-plq sh-ex" src="${IMG}placard-ex-president.webp" alt="Экс-президент" title="экс-президент">`);
        if (x === v.lastChanc && x !== v.pres && x !== v.chanc) placards.push(`<img class="sh-plq sh-ex" src="${IMG}placard-ex-chancellor.webp" alt="Экс-канцлер" title="экс-канцлер">`);
      }
      let ballot = '';
      if (showVotes && x in showVotes) ballot = `<img class="sh-ballot${this.revealVotes ? ' sh-flipin' : ''}" src="${IMG}${showVotes[x] ? 'ja' : 'nein'}.webp" alt="${showVotes[x] ? 'Ja!' : 'Nein'}">`;
      else if (v.phase === 'vote' && v.voted.includes(x)) ballot = `<img class="sh-ballot" src="${IMG}ballot-back.webp" alt="проголосовал">`;
      const tags = [
        v.notHitler.includes(x) ? '<span class="sh-tag">не Гитлер</span>' : '',
        v.investigated.includes(x) ? '<span class="sh-tag">проверен</span>' : '',
        known[x] && (this.mine(v).length !== 1 || x !== this.mine(v)[0] || v.phase === 'over') ? `<span class="sh-tag sh-tag-${known[x]}">${ROLE_NAME[known[x]]}</span>` : '',
        v.phase === 'claim' && v.claimWait.includes(x) ? '<span class="sh-tag sh-tag-wait">заявляет…</span>' : '',
      ].join('');
      const claim = this.claimBubble(v, g, x);
      const me = this.mine(v).length === 1 && this.mine(v)[0] === x;
      s += `<div class="sh-seat${dead ? ' sh-dead' : ''}${targets.includes(x) ? ' sh-can' : ''}${me ? ' sh-me' : ''}${toActNow(v).includes(x) && v.phase !== 'over' ? ' sh-turn' : ''}" data-seat="${x}" style="--c:${SEATS[x].color}">
        <div class="sh-face" data-cam="${x}" data-cam-place="over">${esc(this.plain(x)).slice(0, 1)}${dead ? `<img class="sh-bullet" src="${IMG}bullet.webp" alt="казнён">` : ''}</div>
        <div class="sh-name">${esc(this.plain(x))}</div>
        <div class="sh-plqs">${placards.join('')}</div>${ballot}<div class="sh-tags">${tags}</div>${claim}</div>`;
    }
    this.seatsEl.innerHTML = s;
    this.seatsEl.style.setProperty('--cols', String(v.seats.length <= 7 ? v.seats.length : Math.ceil(v.seats.length / 2)));
  }

  private claimBubble(v: View, g: Gov | undefined, x: number): string {
    if (!g) return '';
    let c = '';
    if (x === g.pres && g.presClaim) c = g.presClaim.silent ? 'молчит' : `${chips(g.presClaim.drew!, 3)} → ${chips(g.presClaim.passed!, 2)}`;
    if (x === g.chanc && g.chancClaim) c = g.chancClaim.silent ? 'молчит' : `пришло ${chips(g.chancClaim.got!, 2)}`;
    if (x === g.pres && g.powerClaim) {
      const p = g.powerClaim;
      c = p.silent ? 'молчит' : p.party ? `${esc(this.plain(g.target!))} — ${p.party === 'L' ? '<b class="sh-l">либерал</b>' : '<b class="sh-f">фашист</b>'}` : `сверху ${chips(p.fas!, 3)}`;
    }
    return c ? `<div class="sh-bubble">${c}</div>` : '';
  }

  private drawBoards(v: View) {
    const n = v.seats.length;
    const row = n <= 6 ? 0 : n <= 8 ? 1 : 2;
    const fresh = this.fresh;
    const tile = (side: Party, k: number, x0: number, x1: number, y0: number, y1: number) =>
      `<img class="sh-tile${fresh && fresh.side === side && fresh.k === k ? ' sh-new' : ''}" src="${pol(side)}" alt="" style="left:${x0}%;width:${x1 - x0}%;top:${y0}%;height:${y1 - y0}%">`;
    let f = '';
    // притушить ряды полномочий других размеров стола
    for (let k = v.fas; k < 3; k++)
      for (let r = 0; r < 3; r++) if (r !== row) f += `<div class="sh-dim" style="left:${F_X[k]}%;width:${F_X[k + 1] - F_X[k]}%;top:${F_Y[r]}%;height:${F_Y[r + 1] - F_Y[r]}%"></div>`;
    for (let k = 0; k < v.fas; k++) f += tile('F', k, F_X[k], F_X[k + 1], F_Y[0], F_Y[3]);
    const powers = boardPowers(n);
    const next = v.fas < 5 ? powers[v.fas] : null;
    let l = '';
    for (let k = 0; k < v.lib; k++) l += tile('L', k, L_X[k], L_X[k + 1], L_Y[0], L_Y[1]);
    l += `<div class="sh-tracker" style="left:${TRACK_X[Math.min(3, v.tracker)]}%;top:${TRACK_Y}%"></div>`;
    l += `<div class="sh-pile sh-pile-deck" title="колода законов"><img src="${IMG}policy-back.webp" alt=""><b>${v.deck}</b></div>`;
    l += `<div class="sh-pile sh-pile-disc" title="сброс"><img src="${IMG}policy-back.webp" alt=""><b>${v.discard}</b></div>`;
    this.boardsEl.innerHTML = `<div class="sh-board sh-board-f"><img class="sh-bimg" src="${IMG}board-fascist.webp" alt="Поле фашистов">${f}</div>
      <div class="sh-note">${n} игроков: ${n <= 6 ? '1 фашист и Гитлер, Гитлер знает своего' : `${n <= 8 ? 2 : 3} фашиста и Гитлер, Гитлер своих не знает`}.
        ${v.fas < 6 ? `Следующий фашистский закон: ${next ? `<b>${POWER_NAME[next]}</b>` : v.fas === 5 ? '<b>победа фашистов</b>' : 'без полномочия'}.` : ''}${v.fas >= 5 ? ' Вето разблокировано.' : ''}</div>
      <div class="sh-board sh-board-l"><img class="sh-bimg" src="${IMG}board-liberal.webp" alt="Поле либералов">${l}</div>`;
  }

  private drawHistory(v: View) {
    const rows = v.govs
      .slice()
      .reverse()
      .map((g) => {
        const ja = g.votes ? Object.entries(g.votes).filter(([, y]) => y).length : 0;
        const all = g.votes ? Object.keys(g.votes).length : 0;
        const dots = g.votes
          ? Object.entries(g.votes)
              .map(([x, y]) => `<i class="sh-dot${y ? '' : ' sh-dot-no'}" style="--c:${SEATS[+x].color}" title="${esc(this.plain(+x))}: ${y ? 'Ja!' : 'Nein'}"></i>`)
              .join('')
          : '';
        const res = g.passed == null ? '<span class="sh-dim-t">голосуют…</span>' : !g.passed ? `<span class="sh-no">не избрано ${ja}:${all - ja}</span>` : `<span class="sh-yes">${ja}:${all - ja}</span>`;
        const policy = g.policy ? `<img class="sh-mini" src="${pol(g.policy)}" alt="${g.policy}">` : g.veto ? '<span class="sh-tag">вето</span>' : '';
        const pc = g.presClaim ? (g.presClaim.silent ? 'молчит' : `${chips(g.presClaim.drew!, 3)}→${chips(g.presClaim.passed!, 2)}`) : '';
        const cc = g.chancClaim ? (g.chancClaim.silent ? 'молчит' : chips(g.chancClaim.got!, 2)) : '';
        const truth = g.drew || g.gave ? `<span class="sh-truth" title="видели вы">${g.drew ? chips(g.drew.filter((c) => c === 'F').length, 3) : ''}${g.gave ? `→${chips(g.gave.filter((c) => c === 'F').length, 2)}` : ''}</span>` : '';
        let pw = '';
        if (g.power && g.target != null) pw = `${POWER_NAME[g.power]}: ${esc(this.plain(g.target))}`;
        else if (g.power === 'peek') pw = POWER_NAME.peek;
        if (g.powerClaim) pw += g.powerClaim.silent ? ' (молчит)' : g.powerClaim.party ? ` — «${g.powerClaim.party === 'L' ? 'либерал' : 'фашист'}»` : ` — «${cardsText(g.powerClaim.fas!, 3)}»`;
        return `<tr><td>${g.round}</td><td><b style="color:${SEATS[g.pres].color}">${esc(this.plain(g.pres))}</b>${g.special ? '*' : ''} → <b style="color:${SEATS[g.chanc].color}">${esc(this.plain(g.chanc))}</b></td>
          <td>${res}<div class="sh-dots">${dots}</div></td><td>${policy}</td><td>${pc || cc ? `${pc || '…'} / ${cc || '…'}` : ''}${truth}${pw ? `<div class="sh-pw">${pw}</div>` : ''}</td></tr>`;
      })
      .join('');
    this.histEl.innerHTML = rows
      ? `<table class="sh-gov"><thead><tr><th>Р.</th><th>Президент → канцлер</th><th>Голоса</th><th>Закон</th><th>Заявления</th></tr></thead><tbody>${rows}</tbody></table>`
      : '';
  }

  /** Сессия крупно: карты законов президенту/канцлеру; остальным — рубашки. */
  private drawStage(v: View) {
    const st = this.stage;
    const holder = v.phase === 'pres' || v.phase === 'veto' ? v.pres : v.phase === 'chanc' ? v.chanc : null;
    if (holder == null) {
      st.hidden = true;
      return;
    }
    if (this.ctx.demo) {
      // показ правил: карты сессии видны, но без кнопок
      if (!v.hand?.length) return void (st.hidden = true);
      st.innerHTML = `<div class="sh-stage-box sh-stage-demo"><div class="sh-stage-t">${v.phase === 'pres' ? 'Президенту пришло:' : v.phase === 'veto' ? 'Канцлер просит вето:' : 'Канцлеру передали:'}</div>
        <div class="sh-hand">${v.hand.map((p) => `<span class="sh-card"><img src="${pol(p)}" alt=""></span>`).join('')}</div></div>`;
      st.hidden = false;
      return;
    }
    const mine = this.mine(v).includes(holder);
    if (!mine || !this.sees(v, holder) || !v.hand) {
      st.hidden = true;
      return;
    }
    const can = this.can(holder);
    const pres = v.phase === 'pres';
    const veto = v.phase === 'veto';
    const head = veto
      ? `Канцлер просит вето. Наложить вето на эти законы?`
      : pres
        ? 'Вы — президент. Сбросьте один закон, два уйдут канцлеру.'
        : 'Вы — канцлер. Выберите закон, который примете (второй — в сброс).';
    st.innerHTML = `<div class="sh-stage-box"><div class="sh-stage-t">${head}</div><div class="sh-hand">${v.hand
      .map((p, i) => `<button class="sh-card${can && !veto ? ' sh-pick' : ''}" data-i="${i}"><img src="${pol(p)}" alt="${p === 'L' ? 'либеральный' : 'фашистский'}"><span>${!veto && can ? (pres ? 'сбросить' : 'принять') : ''}</span></button>`)
      .join('')}</div><div class="sh-stage-b"></div><div class="sh-sub">Молча! Говорить о картах — после сессии.</div></div>`;
    const b = st.querySelector('.sh-stage-b') as HTMLElement;
    if (can && !veto) {
      st.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((el) => (el.onclick = () => this.send(holder, { type: pres ? 'discard' : 'enact', index: +el.dataset.i! })));
      if (!pres && v.fas >= 5 && !v.vetoDenied) {
        const vb = h<HTMLButtonElement>('<button class="btn">Я хочу наложить вето</button>');
        vb.onclick = () => this.send(holder, { type: 'veto' });
        b.appendChild(vb);
      }
    }
    if (can && veto) {
      for (const yes of [true, false]) {
        const x = h<HTMLButtonElement>(`<button class="btn${yes ? ' primary' : ''}">${yes ? 'Согласен с вето' : 'Нет, принимай'}</button>`);
        x.onclick = () => this.send(holder, { type: 'vetoAnswer', yes });
        b.appendChild(x);
      }
    }
    st.hidden = false;
  }

  // ---------------------------------------------------------------- выбор игрока

  private targets(v: View): number[] {
    if (this.ctx.demo) return [];
    const p = v.pres;
    if (!this.mine(v).includes(p) || !this.can(p) || !this.sees(v, p)) return [];
    if (v.phase === 'nominate') return eligible(v);
    if (v.phase === 'power') {
      const others = alive(v).filter((x) => x !== p);
      if (v.power === 'investigate') return others.filter((x) => !v.investigated.includes(x));
      if (v.power === 'special' || v.power === 'kill') return others;
    }
    return [];
  }

  private pickSeat(seat: number) {
    const v = this.v;
    if (!v || !this.targets(v).includes(seat)) return;
    const p = v.pres;
    if (v.phase === 'nominate') return this.send(p, { type: 'nominate', target: seat });
    if (v.power === 'kill' && !confirm(`Казнить ${this.plain(seat)}?`)) return;
    if (v.power === 'investigate' || v.power === 'special' || v.power === 'kill') this.send(p, { type: v.power, target: seat });
  }

  // ---------------------------------------------------------------- панель

  private roleBlock(v: View, x: number): HTMLElement {
    const r = v.know[x]?.[x];
    if (!r) return h('<div></div>');
    const mates = Object.entries(v.know[x])
      .filter(([y]) => +y !== x)
      .map(([y, rr]) => `<b>${esc(this.plain(+y))}</b> — ${ROLE_LOW[rr]}`);
    const team =
      r === 'liberal'
        ? 'Вы не знаете, кто есть кто. Найдите фашистов и Гитлера.'
        : r === 'hitler' && !mates.length
          ? 'Свои фашисты знают вас, а вы их — нет. Притворяйтесь либералом.'
          : `Ваши: ${mates.join(', ')}.`;
    const inv = v.inv
      .filter((i) => i.by === x)
      .map((i) => `<div class="sh-info">🔍 ${esc(this.plain(i.target))} — <b class="${i.party === 'L' ? 'sh-l' : 'sh-f'}">${i.party === 'L' ? 'либерал' : 'фашист'}</b></div>`)
      .join('');
    const pk = v.peeks
      .filter((i) => i.by === x)
      .map((i) => `<div class="sh-info">👁 Сверху колоды было: ${i.cards.map((c) => `<i class="sh-chip sh-chip-${c === 'L' ? 'l' : 'f'}">${c === 'L' ? 'Л' : 'Ф'}</i>`).join('')}</div>`)
      .join('');
    return h(`<div class="sh-role"><div class="sh-role-cards"><img src="${roleImg(r, v.art[x])}" alt="${ROLE_NAME[r]}"><img src="${IMG}party-${partyOf(r) === 'L' ? 'liberal' : 'fascist'}.webp" alt=""></div>
      <div class="sh-role-t">${this.hotseat(v) ? `${esc(this.plain(x))}: ` : ''}вы — <b class="${r === 'liberal' ? 'sh-l' : 'sh-f'}">${ROLE_NAME[r]}</b></div><div class="sh-sub">${team}</div>${inv}${pk}</div>`);
  }

  private renderPanel() {
    const v = this.v;
    const p = this.panel;
    p.innerHTML = '';
    if (!v || this.ctx.demo) return;
    const mine = this.mine(v);
    const add = (html: string) => p.appendChild(h(html));
    const btn = (label: string, fn: () => void, cls = 'btn') => {
      const b = h<HTMLButtonElement>(`<button class="${cls}">${label}</button>`);
      b.onclick = fn;
      p.appendChild(b);
      return b;
    };

    if (v.phase === 'over') {
      add(`<div class="sh-win sh-win-${v.winner}">${v.winner === 'L' ? 'Победа либералов' : 'Победа фашистов'}<small>${esc(v.reason)}</small></div>`);
      const roles = v.revealed ?? {};
      add(
        `<div class="sh-reveal">${v.seats
          .map((x) => `<div><img src="${roleImg(roles[x], v.art[x])}" alt=""><span>${esc(this.plain(x))}</span></div>`)
          .join('')}</div>`,
      );
      return;
    }

    // хот-сит: кому нужно тайное — занавеска
    if (this.hotseat(v)) {
      const need = mine.filter((x) => this.can(x));
      if (this.open != null && !mine.includes(this.open)) this.open = null;
      if (this.open == null || !need.includes(this.open)) {
        if (this.open != null && !need.includes(this.open)) {
          p.appendChild(this.roleBlock(v, this.open));
          btn('Готово — закрыть', () => {
            this.open = null;
            this.redraw();
          }, 'btn primary');
          return;
        }
        if (need.length) {
          add(`<div class="sh-ask">${v.phase === 'vote' ? 'Тайное голосование' : v.phase === 'night' ? 'Каждый втайне смотрит свою роль' : 'Ход'}: передайте устройство.</div>`);
          const row = h('<div class="sh-row"></div>');
          for (const x of need) {
            const b = h<HTMLButtonElement>(`<button class="btn">${esc(this.plain(x))}</button>`);
            b.onclick = () => this.curtain(x);
            row.appendChild(b);
          }
          p.appendChild(row);
        }
        const look = h('<details class="sh-look"><summary>Посмотреть свою роль</summary><div class="sh-row"></div></details>');
        for (const x of mine) {
          const b = h<HTMLButtonElement>(`<button class="btn">${esc(this.plain(x))}</button>`);
          b.onclick = () => this.curtain(x);
          (look.querySelector('.sh-row') as HTMLElement).appendChild(b);
        }
        p.appendChild(look);
        return;
      }
      p.appendChild(this.roleBlock(v, this.open));
      this.actions(v, this.open, add, btn);
      return;
    }

    if (mine.length === 1) {
      const x = mine[0];
      if (v.phase === 'night' || this.shown) p.appendChild(this.roleBlock(v, x));
      else {
        const back = h(`<div class="sh-back"><img src="${IMG}role-back.webp" alt=""><span>Ваша роль — нажмите, чтобы посмотреть</span></div>`);
        back.onclick = () => {
          this.shown = true;
          this.renderPanel();
        };
        p.appendChild(back);
      }
      if (v.phase !== 'night' && this.shown) btn('Спрятать роль', () => {
        this.shown = false;
        this.renderPanel();
      }, 'btn sh-hide');
      if (this.can(x)) this.actions(v, x, add, btn);
    }
  }

  /** Кнопки хода места x. */
  private actions(v: View, x: number, add: (html: string) => void, btn: (label: string, fn: () => void, cls?: string) => HTMLButtonElement) {
    if (!this.can(x)) return;
    const g = this.lastGov(v);
    switch (v.phase) {
      case 'night':
        add('<div class="sh-ask">Запомните роль и своих.</div>');
        btn('Запомнил', () => this.send(x, { type: 'ready' }), 'btn primary');
        break;
      case 'nominate':
        if (x === v.pres) add('<div class="sh-ask">Вы — кандидат в президенты. Выдвиньте канцлера — нажмите на игрока.</div>');
        break;
      case 'vote': {
        if (v.voted.includes(x)) break;
        add(`<div class="sh-ask">Президент ${esc(this.plain(v.pres))}, канцлер ${esc(this.plain(v.chanc!))}. Ваш голос:</div>`);
        const row = h('<div class="sh-votes"></div>');
        for (const ja of [true, false]) {
          const b = h<HTMLButtonElement>(`<button class="sh-vote"><img src="${IMG}${ja ? 'ja' : 'nein'}.webp" alt="${ja ? 'Ja! (да)' : 'Nein (нет)'}"></button>`);
          b.onclick = () => {
            Sound.card();
            this.send(x, { type: 'vote', ja });
          };
          row.appendChild(b);
        }
        this.panel.appendChild(row);
        if (v.tracker === 2) add('<div class="sh-sub">Два провала подряд: ещё один — и хаос.</div>');
        if (v.fas >= 3) add('<div class="sh-sub">Уже три фашистских закона: если канцлер — Гитлер, фашисты победят.</div>');
        break;
      }
      case 'pres':
      case 'chanc':
      case 'veto':
        add('<div class="sh-ask">Законы — на столе крупно.</div>');
        break;
      case 'power':
        if (x !== v.pres || !v.power) break;
        if (v.power === 'peek') {
          add('<div class="sh-ask">Полномочие: посмотреть три верхних закона колоды.</div>');
          btn('Посмотреть', () => this.send(x, { type: 'peek' }), 'btn primary');
        } else add(`<div class="sh-ask">Полномочие — ${POWER_NAME[v.power]}: нажмите на игрока.</div>`);
        break;
      case 'claim':
        if (!g || !v.claimWait.includes(x)) break;
        this.claimButtons(v, g, x, add, btn);
        break;
    }
  }

  private claimButtons(v: View, g: Gov, x: number, add: (html: string) => void, btn: (label: string, fn: () => void, cls?: string) => HTMLButtonElement) {
    const silent = () => btn('Промолчу', () => this.send(x, { type: 'claim', silent: true }), 'btn sh-quiet');
    const grid = (items: { html: string; a: unknown; truth: boolean }[]) => {
      const box = h('<div class="sh-claims"></div>');
      for (const it of items) {
        const b = h<HTMLButtonElement>(`<button class="btn sh-claim${it.truth ? ' sh-true' : ''}"><span class="sh-claim-c">${it.html}</span>${it.truth ? '<small>правда</small>' : ''}</button>`);
        b.onclick = () => this.send(x, it.a);
        box.appendChild(b);
      }
      this.panel.appendChild(box);
    };
    const fc = (c: Party[] | undefined) => (c ?? []).filter((p) => p === 'F').length;
    if (x === g.pres && g.presClaim && (g.power === 'investigate' || g.power === 'peek')) {
      if (g.power === 'investigate') {
        const r = v.inv.find((i) => i.by === x && i.target === g.target);
        add(`<div class="sh-ask">Вы проверили: ${esc(this.plain(g.target!))}. Что скажете остальным? (можно соврать)</div>`);
        grid((['L', 'F'] as Party[]).map((p) => ({ html: p === 'L' ? '<b class="sh-l">Либерал</b>' : '<b class="sh-f">Фашист</b>', a: { type: 'claim', party: p }, truth: r?.party === p })));
      } else {
        const pk = v.peeks.filter((i) => i.by === x).pop();
        add('<div class="sh-ask">Что было сверху колоды? (можно соврать)</div>');
        grid([0, 1, 2, 3].map((f) => ({ html: chips(f, 3), a: { type: 'claim', fas: f }, truth: fc(pk?.cards) === f })));
      }
      silent();
      return;
    }
    if (x === g.pres && !g.presClaim) {
      add('<div class="sh-ask">Заявление президента: что пришло и что передали канцлеру? (можно соврать)</div>');
      const items: { html: string; a: unknown; truth: boolean }[] = [];
      for (let d = 0; d <= 3; d++)
        for (const p of [d - 1, d]) if (p >= 0 && p <= 2) items.push({ html: `${chips(d, 3)} → ${chips(p, 2)}`, a: { type: 'claim', drew: d, passed: p }, truth: fc(g.drew) === d && fc(g.gave) === p });
      grid(items);
      silent();
      return;
    }
    if (x === g.chanc && !g.chancClaim) {
      add('<div class="sh-ask">Заявление канцлера: что вам пришло? (можно соврать)</div>');
      grid([0, 1, 2].map((f) => ({ html: chips(f, 2), a: { type: 'claim', got: f }, truth: fc(g.gave) === f })));
      silent();
    }
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    this.v = v;
    this.redraw();
  }

  async play(events: Event[], v: View) {
    const speed = this.ctx.speed();
    for (const ev of events) {
      switch (ev.type) {
        case 'round':
          Sound.turn();
          break;
        case 'nominate':
          Sound.card();
          break;
        case 'voted':
          Sound.place();
          break;
        case 'votes': {
          // открыть голоса разом
          this.v = { ...(this.v ?? v), govs: v.govs, phase: 'vote' };
          this.revealVotes = true;
          this.draw();
          Sound.shuffle();
          await sleep(1400 / speed);
          this.revealVotes = false;
          break;
        }
        case 'enact':
          this.fresh = { side: ev.policy, k: (ev.policy === 'L' ? ev.lib : ev.fas) - 1 };
          this.v = { ...v, lib: ev.lib, fas: ev.fas };
          this.draw();
          Sound.card();
          await sleep(900 / speed);
          this.fresh = null;
          break;
        case 'draw':
        case 'pass':
          Sound.card();
          break;
        case 'kill':
          Sound.capture();
          break;
        case 'claim':
          Sound.chat();
          break;
        case 'over':
          Sound.win();
          break;
      }
    }
    this.v = v;
    this.redraw();
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.interactive = interactive;
    this.redraw();
  }

  status(v: View, _toAct: number[], interactive: number[]) {
    const nm = (x: number | null) => (x == null ? '' : this.ctx.name(x));
    const me = (x: number | null) => x != null && interactive.includes(x) && this.mine(v).includes(x);
    switch (v.phase) {
      case 'over':
        return v.winner === 'L' ? 'Победа либералов' : 'Победа фашистов';
      case 'night':
        return 'Ночь: все смотрят свои роли';
      case 'nominate':
        return me(v.pres) ? 'Выдвиньте канцлера' : `${nm(v.pres)} выдвигает канцлера…`;
      case 'vote':
        return interactive.some((x) => !v.voted.includes(x)) ? 'Голосуйте: Ja! или Nein' : `Голосуют: ${v.voted.length} из ${alive(v).length}`;
      case 'pres':
        return me(v.pres) ? 'Сбросьте один закон' : `Президент ${nm(v.pres)} смотрит законы…`;
      case 'chanc':
        return me(v.chanc) ? 'Примите закон' : `Канцлер ${nm(v.chanc)} выбирает закон…`;
      case 'veto':
        return me(v.pres) ? 'Канцлер просит вето' : 'Вето?..';
      case 'power':
        return me(v.pres) ? `Полномочие: ${POWER_NAME[v.power!]}` : `${nm(v.pres)}: ${POWER_NAME[v.power!]}…`;
      case 'claim':
        return interactive.some((x) => v.claimWait.includes(x)) ? 'Ваше заявление' : 'Заявления правительства…';
    }
    return '';
  }

  focusSeat(v: View) {
    const t = toActNow(v);
    return t.length === 1 && v.phase !== 'over' ? t[0] : null;
  }

  playerStats(v: View, seat: number) {
    if (v.dead.includes(seat)) return 'казнён';
    if (v.phase === 'night') return '';
    if (seat === v.pres && v.phase !== 'over') return 'президент';
    if (seat === v.chanc && v.phase !== 'over') return 'канцлер';
    return '';
  }
}

function toActNow(v: View): number[] {
  switch (v.phase) {
    case 'nominate':
    case 'pres':
    case 'veto':
    case 'power':
      return [v.pres];
    case 'chanc':
      return v.chanc == null ? [] : [v.chanc];
    case 'vote':
      return alive(v).filter((x) => !v.voted.includes(x));
    case 'claim':
      return v.claimWait;
    default:
      return [];
  }
}

export function createView(): GameView<View, Event> {
  return new SecretHitlerView();
}
