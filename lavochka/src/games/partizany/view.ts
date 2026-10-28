/* Партизаны — отрисовка: игроки сверху (командир, группа, бюллетени), под ними — карта операций (пять кружков с размером группы
 * и итогом) и счётчик отказов, ниже — история попыток. Своя карта роли — в боковой панели (нажать — открыть).
 * Командир отмечает группу нажатием на игроков и подтверждает кнопкой. Хот-сит: всё тайное — за занавеской. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from './def';
import { checkable, failsNeeded, ROLE_LOW, ROLE_NAME, sideOf, SIDE_NAME, teamSize, traitorsFor, type Event, type Role, type Side, type View } from './engine';
import './partizany.css';

class PartizanyView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private root!: HTMLElement;
  private seatsEl!: HTMLElement;
  private mapEl!: HTMLElement;
  private histEl!: HTMLElement;
  private cover!: HTMLElement;
  private panel!: HTMLElement;
  private v: View | null = null;
  private interactive: number[] = [];
  /** Хот-сит: чьё тайное сейчас открыто. */
  private open: number | null = null;
  private shown = false;
  /** Набор группы командиром (до подтверждения). */
  private pick: number[] = [];
  private revealVotes: Record<number, boolean> | null = null;
  private reveal: { fails: number; size: number } | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h(`<div class="pz-wrap"><div class="pz-scroll"><div class="pz-seats"></div><div class="pz-map"></div><div class="pz-hist"></div></div>
      <div class="pz-cover" hidden><div class="pz-cover-box"><div class="pz-cover-t"></div><div class="pz-cover-b"></div></div></div></div>`);
    root.appendChild(this.root);
    this.seatsEl = this.root.querySelector('.pz-seats') as HTMLElement;
    this.mapEl = this.root.querySelector('.pz-map') as HTMLElement;
    this.histEl = this.root.querySelector('.pz-hist') as HTMLElement;
    this.cover = this.root.querySelector('.pz-cover') as HTMLElement;
    this.panel = h('<div class="pz-panel"></div>');
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

  private curtain(seat: number) {
    const t = this.cover.querySelector('.pz-cover-t') as HTMLElement;
    const b = this.cover.querySelector('.pz-cover-b') as HTMLElement;
    t.innerHTML = `Устройство — ${this.ctx.name(seat)}.<br><small>Остальные — не подглядывать!</small>`;
    b.innerHTML = '';
    const ok = h<HTMLButtonElement>('<button class="btn primary">Это я, смотрю</button>');
    ok.onclick = () => {
      Sound.unlock();
      this.cover.hidden = true;
      this.open = seat;
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
    this.drawMap(v);
    this.drawHistory(v);
  }

  private known(v: View): Record<number, Role> {
    if (v.revealed) return v.revealed;
    const out: Record<number, Role> = {};
    for (const x of this.mine(v)) if (this.sees(v, x)) Object.assign(out, v.know[x]);
    return out;
  }

  /** Командир за этим экраном набирает группу. */
  private picking(v: View): number | null {
    if (this.ctx.demo || v.phase !== 'propose') return null;
    const l = v.leader;
    return this.mine(v).includes(l) && this.can(l) && this.sees(v, l) ? l : null;
  }

  private drawSeats(v: View) {
    const known = this.known(v);
    const picking = this.picking(v) != null;
    const lastTry = v.ops[v.op]?.tries.slice(-1)[0];
    const showVotes = this.revealVotes ?? (v.phase === 'mission' && lastTry?.votes ? lastTry.votes : null);
    const team = picking ? this.pick : v.team;
    const one = this.mine(v).length === 1 ? this.mine(v)[0] : null;
    let s = '';
    for (const x of v.seats) {
      const tags = [
        x === v.leader && v.phase !== 'night' && v.phase !== 'over' ? '<span class="pz-tag pz-tag-lead">командир</span>' : '',
        v.holder === x && v.check && v.phase !== 'over' ? '<span class="pz-tag">🔍 жетон</span>' : '',
        known[x] && (x !== one || v.phase === 'over') ? `<span class="pz-tag pz-tag-${sideOf(known[x])}">${ROLE_NAME[known[x]]}</span>` : '',
        v.shot === x ? '<span class="pz-tag pz-tag-T">🎯 выстрел</span>' : '',
      ].join('');
      let ballot = '';
      if (showVotes && x in showVotes) ballot = `<span class="pz-ballot${showVotes[x] ? '' : ' pz-no'}${this.revealVotes ? ' pz-flip' : ''}">${showVotes[x] ? 'за' : 'против'}</span>`;
      else if (v.phase === 'vote' && v.voted.includes(x)) ballot = '<span class="pz-ballot pz-back">✓</span>';
      else if (v.phase === 'mission' && v.team.includes(x)) ballot = `<span class="pz-ballot pz-back">${v.played.includes(x) ? '🂠' : '…'}</span>`;
      const inTeam = team.includes(x);
      const claims = v.claims
        .filter((c) => c.target === x)
        .map((c) => `<div class="pz-bubble">${esc(this.plain(c.by))}: ${c.side ? `<b class="pz-${c.side}">${SIDE_NAME[c.side]}</b>` : 'молчит'}</div>`)
        .join('');
      s += `<div class="pz-seat${inTeam ? ' pz-in' : ''}${picking || this.targets(v).includes(x) ? ' pz-can' : ''}${x === one ? ' pz-me' : ''}${toActNow(v).includes(x) && v.phase !== 'over' ? ' pz-turn' : ''}" data-seat="${x}" style="--c:${SEATS[x].color}">
        <div class="pz-face" data-cam="${x}" data-cam-place="over">${esc(this.plain(x)).slice(0, 1)}${inTeam ? '<i class="pz-badge">🌲</i>' : ''}</div>
        <div class="pz-name">${esc(this.plain(x))}</div>${ballot}<div class="pz-tags">${tags}</div>${claims}</div>`;
    }
    this.seatsEl.innerHTML = s;
    this.seatsEl.style.setProperty('--cols', String(v.seats.length <= 7 ? v.seats.length : Math.ceil(v.seats.length / 2)));
  }

  private drawMap(v: View) {
    const n = v.seats.length;
    const ops = v.ops;
    let circles = '';
    for (let k = 0; k < 5; k++) {
      const o = ops[k];
      const cls = o?.ok === true ? ' pz-ok' : o?.ok === false ? ' pz-fail' : k === v.op && v.phase !== 'over' ? ' pz-cur' : '';
      const need = failsNeeded(n, k) > 1;
      circles += `<div class="pz-op${cls}"><b>${o?.ok === true ? '✔' : o?.ok === false ? '✖' : (o?.size ?? teamSize(n, k))}</b><small>${o?.ok == null ? `операция ${k + 1}` : o.fails ? `срывов: ${o.fails}` : 'без срывов'}</small>${need ? '<i title="нужно два срыва">2 срыва</i>' : ''}</div>`;
    }
    let track = '';
    for (let i = 1; i <= 5; i++) track += `<i class="pz-rej${i <= v.rejects ? ' pz-rej-on' : ''}${i === 5 ? ' pz-rej-last' : ''}">${i}</i>`;
    const rv = this.reveal;
    const cards = rv
      ? `<div class="pz-reveal">${Array.from({ length: rv.size }, (_, i) => `<span class="pz-card${i < rv.fails ? ' pz-card-fail' : ''}">${i < rv.fails ? 'СРЫВ' : 'УСПЕХ'}</span>`).join('')}</div>`
      : '';
    this.mapEl.innerHTML = `<div class="pz-ops">${circles}</div>
      <div class="pz-track"><span>Отказы подряд:</span>${track}<span class="pz-note">${n} игроков · предателей ${traitorsFor(n)}</span></div>${cards}`;
  }

  private drawHistory(v: View) {
    const rows: string[] = [];
    v.ops.forEach((o, k) =>
      o.tries.forEach((t, i) => {
        const yes = t.votes ? Object.values(t.votes).filter(Boolean).length : 0;
        const all = t.votes ? Object.keys(t.votes).length : 0;
        const dots = t.votes
          ? Object.entries(t.votes)
              .map(([x, y]) => `<i class="pz-dot${y ? '' : ' pz-dot-no'}" style="--c:${SEATS[+x].color}" title="${esc(this.plain(+x))}: ${y ? 'за' : 'против'}"></i>`)
              .join('')
          : '';
        const res = t.passed == null ? '<span class="pz-dim">голосуют…</span>' : t.passed ? `<span class="pz-yes">${yes}:${all - yes}</span>` : `<span class="pz-noq">отказ ${yes}:${all - yes}</span>`;
        const out = t.passed && o.ok != null ? (o.ok ? '<b class="pz-P">удалась</b>' : `<b class="pz-T">сорвана (${o.fails})</b>`) : '';
        rows.push(`<tr><td>${k + 1}.${i + 1}</td><td><b style="color:${SEATS[t.leader].color}">${esc(this.plain(t.leader))}</b>: ${t.team.map((x) => esc(this.plain(x))).join(', ')}</td><td>${res}<div class="pz-dots">${dots}</div></td><td>${out}</td></tr>`);
      }),
    );
    this.histEl.innerHTML = rows.length
      ? `<table class="pz-histt"><thead><tr><th>Оп.</th><th>Командир: группа</th><th>Голоса</th><th>Итог</th></tr></thead><tbody>${rows.reverse().join('')}</tbody></table>`
      : '';
  }

  // ---------------------------------------------------------------- выбор игрока

  private targets(v: View): number[] {
    if (this.ctx.demo) return [];
    if (v.phase === 'check' && v.holder != null && this.mine(v).includes(v.holder) && this.can(v.holder) && this.sees(v, v.holder)) return checkable(v);
    if (v.phase === 'hunt') {
      const sn = this.mine(v).find((x) => this.can(x) && this.sees(v, x));
      if (sn != null) return v.seats.filter((x) => x !== sn && !(v.know[sn]?.[x] && sideOf(v.know[sn][x]) === 'T'));
    }
    return [];
  }

  private pickSeat(seat: number) {
    const v = this.v;
    if (!v) return;
    const l = this.picking(v);
    if (l != null) {
      const size = v.ops[v.op].size;
      if (this.pick.includes(seat)) this.pick = this.pick.filter((x) => x !== seat);
      else if (this.pick.length < size) this.pick.push(seat);
      Sound.place();
      this.redraw();
      return;
    }
    if (!this.targets(v).includes(seat)) return;
    if (v.phase === 'check' && v.holder != null) return this.send(v.holder, { type: 'check', target: seat });
    if (v.phase === 'hunt') {
      const sn = this.mine(v).find((x) => this.can(x))!;
      if (confirm(`Стрелять в ${this.plain(seat)}?`)) this.send(sn, { type: 'shoot', target: seat });
    }
  }

  // ---------------------------------------------------------------- панель

  private roleBlock(v: View, x: number): HTMLElement {
    const r = v.know[x]?.[x];
    if (!r) return h('<div></div>');
    const mates = Object.entries(v.know[x])
      .filter(([y]) => +y !== x)
      .map(([y, rr]) => `<b>${esc(this.plain(+y))}</b>${r === 'scout' ? '' : ` — ${ROLE_LOW[rr]}`}`);
    const team =
      r === 'partisan'
        ? 'Вы не знаете, кто есть кто. Найдите предателей.'
        : r === 'scout'
          ? `Предатели: ${mates.join(', ')}. Ведите отряд, но не выдайте себя снайперу.`
          : `Ваши: ${mates.join(', ')}.${r === 'sniper' ? ' Если партизаны проведут три операции — стреляйте в разведчика.' : ''}`;
    const checks = v.checks
      .filter((c) => c.by === x)
      .map((c) => `<div class="pz-info">🔍 ${esc(this.plain(c.target))} — <b class="pz-${c.side}">${SIDE_NAME[c.side]}</b></div>`)
      .join('');
    return h(`<div class="pz-role pz-role-${sideOf(r)}"><div class="pz-role-card">${sideOf(r) === 'P' ? '🌲' : '🐍'}<span>${ROLE_NAME[r]}</span></div>
      <div class="pz-role-t">${this.hotseat(v) ? `${esc(this.plain(x))}: ` : ''}вы — <b class="pz-${sideOf(r)}">${ROLE_NAME[r]}</b></div><div class="pz-sub">${team}</div>${checks}</div>`);
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
      add(`<div class="pz-win pz-win-${v.winner}">${v.winner === 'P' ? 'Победа партизан' : 'Победа предателей'}<small>${esc(v.reason)}</small></div>`);
      const roles = v.revealed ?? {};
      add(`<div class="pz-revealr">${v.seats.map((x) => `<div class="pz-${sideOf(roles[x])}"><b>${esc(this.plain(x))}</b> — ${ROLE_LOW[roles[x]]}</div>`).join('')}</div>`);
      return;
    }

    if (this.hotseat(v)) {
      const need = mine.filter((x) => this.can(x));
      if (this.open != null && !mine.includes(this.open)) this.open = null;
      if (this.open == null || !need.includes(this.open)) {
        if (this.open != null) {
          p.appendChild(this.roleBlock(v, this.open));
          btn('Готово — закрыть', () => {
            this.open = null;
            this.redraw();
          }, 'btn primary');
          return;
        }
        if (need.length) {
          add(`<div class="pz-ask">${v.phase === 'vote' ? 'Голосование' : v.phase === 'mission' ? 'Карты операции' : v.phase === 'night' ? 'Каждый втайне смотрит свою роль' : 'Ход'}: передайте устройство.</div>`);
          const row = h('<div class="pz-row"></div>');
          for (const x of need) {
            const b = h<HTMLButtonElement>(`<button class="btn">${esc(this.plain(x))}</button>`);
            b.onclick = () => this.curtain(x);
            row.appendChild(b);
          }
          p.appendChild(row);
        }
        const look = h('<details class="pz-look"><summary>Посмотреть свою роль</summary><div class="pz-row"></div></details>');
        for (const x of mine) {
          const b = h<HTMLButtonElement>(`<button class="btn">${esc(this.plain(x))}</button>`);
          b.onclick = () => this.curtain(x);
          (look.querySelector('.pz-row') as HTMLElement).appendChild(b);
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
        const back = h('<div class="pz-back"><span>🂠</span><span>Ваша роль — нажмите, чтобы посмотреть</span></div>');
        back.onclick = () => {
          this.shown = true;
          this.renderPanel();
        };
        p.appendChild(back);
      }
      if (v.phase !== 'night' && this.shown)
        btn('Спрятать роль', () => {
          this.shown = false;
          this.renderPanel();
        }, 'btn pz-hide');
      if (this.can(x)) this.actions(v, x, add, btn);
    }
  }

  private actions(v: View, x: number, add: (html: string) => void, btn: (label: string, fn: () => void, cls?: string) => HTMLButtonElement) {
    if (!this.can(x)) return;
    const role = v.know[x]?.[x];
    switch (v.phase) {
      case 'night':
        add('<div class="pz-ask">Запомните роль и своих.</div>');
        btn('Запомнил', () => this.send(x, { type: 'ready' }), 'btn primary');
        break;
      case 'propose': {
        if (x !== v.leader) break;
        const size = v.ops[v.op].size;
        add(`<div class="pz-ask">Вы — командир. Наберите группу из <b>${size}</b>: нажимайте на игроков (себя тоже можно). Выбрано ${this.pick.length} из ${size}.</div>`);
        const b = btn('Отправить группу на голосование', () => {
          const m = this.pick.slice();
          this.pick = [];
          this.send(x, { type: 'team', members: m });
        }, 'btn primary');
        b.disabled = this.pick.length !== size;
        if (v.rejects === 4) add('<div class="pz-sub">Это пятая попытка: если группу не утвердят — победа предателей.</div>');
        break;
      }
      case 'vote': {
        if (v.voted.includes(x)) break;
        add(`<div class="pz-ask">Группа командира ${esc(this.plain(v.leader))}: ${v.team.map((y) => esc(this.plain(y))).join(', ')}. Ваш голос:</div>`);
        const row = h('<div class="pz-votes"></div>');
        for (const yes of [true, false]) {
          const b = h<HTMLButtonElement>(`<button class="pz-vote${yes ? '' : ' pz-no'}">${yes ? 'ЗА' : 'ПРОТИВ'}</button>`);
          b.onclick = () => {
            Sound.card();
            this.send(x, { type: 'vote', yes });
          };
          row.appendChild(b);
        }
        this.panel.appendChild(row);
        if (v.rejects === 4) add('<div class="pz-sub">Пятая попытка: отказ — победа предателей.</div>');
        break;
      }
      case 'mission': {
        if (!v.team.includes(x) || v.played.includes(x)) break;
        const traitor = role && sideOf(role) === 'T';
        add(`<div class="pz-ask">Вы в группе. Положите карту${traitor ? ' — можно сорвать операцию' : ''}:</div>`);
        const row = h('<div class="pz-votes"></div>');
        for (const fail of traitor ? [false, true] : [false]) {
          const b = h<HTMLButtonElement>(`<button class="pz-vote${fail ? ' pz-no' : ''}">${fail ? 'СРЫВ' : 'УСПЕХ'}</button>`);
          b.onclick = () => {
            Sound.card();
            this.send(x, { type: 'card', fail });
          };
          row.appendChild(b);
        }
        this.panel.appendChild(row);
        if (!traitor) add('<div class="pz-sub">Партизан может положить только «успех».</div>');
        break;
      }
      case 'check':
        add('<div class="pz-ask">Проверка: нажмите на игрока — узнаете, на чьей он стороне. Жетон уйдёт к нему.</div>');
        break;
      case 'claim': {
        const c = v.checks.filter((y) => y.by === x).pop();
        if (!c) break;
        add(`<div class="pz-ask">Вы проверили ${esc(this.plain(c.target))}: <b class="pz-${c.side}">${SIDE_NAME[c.side]}</b>. Что скажете остальным? (можно соврать)</div>`);
        for (const side of ['P', 'T'] as Side[]) btn(`«${SIDE_NAME[side]}»${c.side === side ? ' (правда)' : ''}`, () => this.send(x, { type: 'claim', side }), `btn${c.side === side ? ' primary' : ''}`);
        btn('Промолчу', () => this.send(x, { type: 'claim', side: null }));
        break;
      }
      case 'hunt':
        add('<div class="pz-ask">Вы — снайпер. Посоветуйтесь со своими и нажмите на того, кто, по-вашему, разведчик.</div>');
        break;
    }
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    if (v.phase !== 'propose') this.pick = [];
    this.v = v;
    this.redraw();
  }

  async play(events: Event[], v: View) {
    const speed = this.ctx.speed();
    for (const ev of events) {
      switch (ev.type) {
        case 'leader':
          Sound.turn();
          break;
        case 'team':
          Sound.card();
          break;
        case 'voted':
        case 'played':
          Sound.place();
          break;
        case 'votes': {
          this.revealVotes = ev.votes;
          this.v = { ...(this.v ?? v), phase: 'vote' };
          this.draw();
          Sound.shuffle();
          await sleep(1400 / speed);
          this.revealVotes = null;
          break;
        }
        case 'result': {
          const o = v.ops[ev.op];
          this.reveal = { fails: ev.fails, size: o?.tries.find((t) => t.passed)?.team.length ?? ev.fails };
          this.v = { ...v };
          this.draw();
          if (ev.ok) Sound.win();
          else Sound.capture();
          await sleep(1600 / speed);
          this.reveal = null;
          break;
        }
        case 'claim':
          Sound.chat();
          break;
        case 'shoot':
          Sound.capture();
          break;
        case 'over':
          Sound.win();
          break;
      }
    }
    this.setView(v);
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
        return v.winner === 'P' ? 'Победа партизан' : 'Победа предателей';
      case 'night':
        return 'Ночь: все смотрят свои роли';
      case 'propose':
        return me(v.leader) ? `Наберите группу из ${v.ops[v.op].size}` : `${nm(v.leader)} набирает группу…`;
      case 'vote':
        return interactive.some((x) => !v.voted.includes(x)) ? 'Голосуйте: за или против' : `Голосуют: ${v.voted.length} из ${v.seats.length}`;
      case 'mission':
        return interactive.some((x) => v.team.includes(x) && !v.played.includes(x)) ? 'Положите карту операции' : `Группа на операции: ${v.played.length} из ${v.team.length}`;
      case 'check':
      case 'claim':
        return me(v.holder) ? 'Проверка' : `${nm(v.holder)} проверяет…`;
      case 'hunt':
        return interactive.length ? 'Найдите разведчика' : 'Снайпер целится…';
    }
    return '';
  }

  focusSeat(v: View) {
    const t = toActNow(v);
    return t.length === 1 && v.phase !== 'over' ? t[0] : null;
  }

  playerStats(v: View, seat: number) {
    if (v.phase === 'night' || v.phase === 'over') return '';
    if (seat === v.leader) return 'командир';
    if (v.team.includes(seat)) return 'в группе';
    return '';
  }
}

function toActNow(v: View): number[] {
  switch (v.phase) {
    case 'propose':
      return [v.leader];
    case 'vote':
      return v.seats.filter((x) => !v.voted.includes(x));
    case 'mission':
      return v.team.filter((x) => !v.played.includes(x));
    case 'check':
    case 'claim':
      return v.holder == null ? [] : [v.holder];
    default:
      return [];
  }
}

export function createView(): GameView<View, Event> {
  return new PartizanyView();
}
