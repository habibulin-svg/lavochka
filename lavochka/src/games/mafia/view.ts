/* Мафия — отрисовка: двор ночью (луна, окна гаснут) или днём; игроки сидят кругом — карточки с именами, пузыри с речами,
 * отметки «выставлен» и голоса. Своя роль — карточкой (нажать — показать/спрятать). Ночью — выбор цели, днём — речь, выставление, голос.
 * Хот-сит: ночью каждый ходит за занавеской. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { isMafia, knownRole, ROLE_NAME, type Event, type Role, type View } from './engine';
import { SEATS, withNames } from './def';
import './mafia.css';

const ROLE_ICON: Record<Role, string> = { civ: '🏠', mafia: '🔫', don: '🎩', sheriff: '⭐', doctor: '💉', putana: '💋' };
const ROLE_HINT: Record<Role, string> = {
  civ: 'Днём ищите мафию и голосуйте. Ночью просто выберите, кого подозреваете.',
  mafia: 'Ночью вместе со своими выбирайте жертву. Днём не выдавайте себя.',
  don: 'Вы главный в мафии: ночью ищете комиссара, при споре решаете, в кого стрелять.',
  sheriff: 'Ночью проверяйте игроков. Нашли мафию — можно открыться днём.',
  doctor: 'Ночью лечите одного — его не убьют. Себя — не два раза подряд.',
  putana: 'Ночью приходите к игроку: его ход не сработает, но и убить его нельзя.',
};

class MafiaView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private root!: HTMLElement;
  private ring!: HTMLElement;
  private center!: HTMLElement;
  private cover!: HTMLElement;
  private panel!: HTMLElement;
  private v: View | null = null;
  private viewer = 0;
  private hidden = false;
  private actSeat: number | null = null;
  private showRole = false;
  private nominate: number | null = null;
  /** Дон (спортивная): выстрел уже выбран, ждём проверку. */
  private donShot: number | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h(`<div class="mf-wrap"><div class="mf-sky"><div class="mf-moon"></div><div class="mf-houses"></div></div><div class="mf-ring"></div><div class="mf-center"></div>
      <div class="mf-cover" hidden><div class="mf-cover-box"><div class="mf-cover-t"></div><button class="btn primary">Я готов</button></div></div></div>`);
    root.appendChild(this.root);
    this.ring = this.root.querySelector('.mf-ring') as HTMLElement;
    this.center = this.root.querySelector('.mf-center') as HTMLElement;
    this.cover = this.root.querySelector('.mf-cover') as HTMLElement;
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.renderPanel();
    };
    let houses = '';
    for (let i = 0; i < 14; i++) houses += `<div class="mf-house" style="--h:${60 + ((i * 37) % 70)}px;--w:${50 + ((i * 23) % 40)}px"><i></i><i></i><i></i><i></i></div>`;
    (this.root.querySelector('.mf-houses') as HTMLElement).innerHTML = houses;
    this.panel = h('<div class="mf-panel"></div>');
    ctx.controls.appendChild(this.panel);
    this.ring.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-seat]') as HTMLElement | null;
      if (el) this.pickSeat(+el.dataset.seat!);
    });
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  private chooseViewer(v: View, toAct: number[]) {
    const mine = this.ctx.mySeats.filter((x) => v.seats.includes(x));
    if (!mine.length) return;
    if (mine.length === 1) {
      this.viewer = mine[0];
      return;
    }
    const next = toAct.find((x) => mine.includes(x));
    if (next != null && next !== this.viewer) {
      this.viewer = next;
      // днём всё открыто, ночью — за занавеской
      if (v.phase === 'night') this.hidden = true;
      this.showRole = false;
    }
  }

  // ---------------------------------------------------------------- рисунок

  private draw() {
    const v = this.v;
    if (!v) return;
    this.root.classList.toggle('mf-night', v.phase === 'night');
    const n = v.seats.length;
    const i0 = Math.max(0, v.seats.indexOf(this.viewer));
    const order = v.seats.map((_, k) => v.seats[(i0 + k) % n]);
    const votes = new Map<number, number>();
    for (const t of Object.values(v.votes)) votes.set(t, (votes.get(t) ?? 0) + 1);
    const targets = this.targets(v);
    let s = '';
    order.forEach((seat, k) => {
      const a = Math.PI / 2 + (k / n) * Math.PI * 2;
      const x = 50 + Math.cos(a) * 40;
      const y = 50 + Math.sin(a) * 37;
      const dead = !v.alive.includes(seat);
      const me = this.ctx.mySeats.includes(seat) && seat === this.viewer;
      const known = !this.hidden && (knownRole(v, seat) || v.phase === 'over');
      const role = v.roles[seat];
      const showBadge = known && (role !== 'civ' || dead || v.phase === 'over' || (me && this.showRole));
      const badge = showBadge && (!me || this.showRole || dead || v.phase === 'over') ? `<span class="mf-role" title="${ROLE_NAME[role]}">${ROLE_ICON[role]}</span>` : '';
      const speaking = (v.phase === 'day' && v.speaker === seat) || (v.phase === 'vote' && v.voter === seat);
      const said = v.said[seat] ? `<div class="mf-bubble">${withNames(v.said[seat], (x) => esc(this.plain(x)))}</div>` : '';
      const nom = v.nominees.includes(seat) ? `<span class="mf-nom">выставлен${votes.get(seat) ? ` · ${votes.get(seat)}` : ''}</span>` : '';
      const pick = targets.includes(seat) ? ' mf-can' : '';
      const sel = this.nominate === seat ? ' mf-sel' : '';
      const side = x < 25 ? ' mf-l' : x > 75 ? ' mf-r' : '';
      s += `<div class="mf-seat${dead ? ' mf-dead' : ''}${me ? ' mf-me' : ''}${speaking ? ' mf-talk' : ''}${pick}${sel}${side}" data-seat="${seat}" style="left:${x}%;top:${y}%;--c:${SEATS[seat].color}">
        <div class="mf-face">${dead ? '✝' : esc(this.plain(seat)).slice(0, 1)}</div><div class="mf-name">${esc(this.plain(seat))}${badge}</div>${nom}${said}</div>`;
    });
    this.ring.innerHTML = s;
    const title = v.phase === 'over' ? (v.winner === 'city' ? 'Город победил' : 'Мафия победила') : v.phase === 'night' ? `Ночь ${v.day}` : v.phase === 'day' ? `День ${v.day}` : `День ${v.day}: голосование`;
    this.center.innerHTML = `<div class="mf-title">${title}</div>${v.meet && v.phase === 'night' ? '<div class="mf-sub">ночь знакомства</div>' : ''}`;
  }

  /** Кого сейчас можно выбрать нажатием. */
  private targets(v: View): number[] {
    const me = this.actSeat;
    if (me == null || this.hidden) return [];
    const role = v.roles[me];
    if (v.phase === 'night') {
      if (v.meet) return [me];
      if (this.donStep(v)) return v.alive.filter((x) => x !== me);
      return v.alive.filter((x) => {
        if (isMafia(role)) return !isMafia(v.roles[x]) || !knownRole(v, x);
        if (role === 'sheriff' || role === 'putana') return x !== me;
        if (role === 'doctor') return !(x === me && v.lastHeal === me);
        return true;
      });
    }
    if (v.phase === 'day') return v.alive.filter((x) => x !== me && !v.nominees.includes(x));
    if (v.phase === 'vote') return v.nominees.slice();
    return [];
  }

  /** Дону в спортивной сейчас выбирать проверку (выстрел уже выбран). */
  private donStep(v: View) {
    return this.actSeat != null && v.roles[this.actSeat] === 'don' && v.cfg.variant === 'sport' && !v.meet && this.donShot != null;
  }

  private pickSeat(seat: number) {
    const v = this.v;
    if (!v || this.actSeat == null || !this.targets(v).includes(seat)) return;
    if (v.phase === 'night' && v.roles[this.actSeat] === 'don' && v.cfg.variant === 'sport' && !v.meet) {
      if (this.donShot == null) {
        this.donShot = seat;
        Sound.ui();
        this.draw();
        this.renderPanel();
        return;
      }
      return this.send({ type: 'night', target: this.donShot, check: seat });
    }
    if (v.phase === 'night') return this.send({ type: 'night', target: seat });
    if (v.phase === 'vote') return this.send({ type: 'vote', target: seat });
    this.nominate = this.nominate === seat ? null : seat;
    Sound.ui();
    this.draw();
    this.renderPanel();
  }

  private send(a: Parameters<ViewCtx['act']>[1]) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.actSeat = null;
    this.nominate = null;
    this.donShot = null;
    this.panel.innerHTML = '';
    this.ctx.act(seat, a);
  }

  private renderPanel() {
    const v = this.v;
    if (!v) return;
    this.panel.innerHTML = '';
    const me = this.viewer;
    if (this.ctx.mySeats.includes(me) && v.seats.includes(me) && !this.hidden) {
      const role = v.roles[me];
      const card = h(`<div class="mf-card${this.showRole ? ' open' : ''}"><div class="mf-card-back">Ваша роль<br><small>нажмите, чтобы посмотреть</small></div>
        <div class="mf-card-face"><b>${ROLE_ICON[role]} ${ROLE_NAME[role]}</b><small>${ROLE_HINT[role]}</small></div></div>`);
      card.onclick = () => {
        this.showRole = !this.showRole;
        this.draw();
        this.renderPanel();
      };
      this.panel.appendChild(card);
      const checks = v.checks[me] ?? [];
      if (checks.length) this.panel.appendChild(h(`<div class="mf-checks">Проверки: ${checks.map((c) => `${esc(this.plain(c.target))} — ${c.result ? (role === 'don' ? 'комиссар' : 'мафия') : role === 'don' ? 'не комиссар' : 'не мафия'}`).join('; ')}</div>`));
      if (isMafia(role)) {
        const mates = v.seats.filter((x) => x !== me && isMafia(v.roles[x]));
        if (mates.length) this.panel.appendChild(h(`<div class="mf-checks">Свои: ${mates.map((x) => esc(this.plain(x))).join(', ')}</div>`));
      }
    }
    const seat = this.actSeat;
    if (seat == null || this.ctx.demo || this.hidden) return;
    if (v.phase === 'night') {
      const role = v.roles[seat];
      const donCheck = this.donStep(v);
      const ask = v.meet
        ? isMafia(role)
          ? 'Познакомьтесь со своими и нажмите на себя.'
          : 'Ночь знакомства. Нажмите на себя — вы спите.'
        : donCheck
          ? `Выстрел — в ${esc(this.plain(this.donShot!))}. Теперь: кого проверить — не комиссар ли?`
          : isMafia(role)
            ? 'Кого убить? Нажмите на игрока.'
            : role === 'sheriff'
              ? 'Кого проверить?'
              : role === 'doctor'
                ? 'Кого лечить?'
                : role === 'putana'
                  ? 'К кому пойти?'
                  : 'Кого подозреваете? (ни на что не влияет)';
      this.panel.appendChild(h(`<div class="mf-ask">${ask}</div>`));
      return;
    }
    if (v.phase === 'vote') {
      this.panel.appendChild(h('<div class="mf-ask">Голосуйте: нажмите на выставленного.</div>'));
      return;
    }
    // речь
    const box = h(`<div class="mf-speak"><div class="mf-ask">Ваше слово${this.nominate != null ? ` — выставить ${esc(this.plain(this.nominate))}` : ' (нажмите на игрока, чтобы выставить)'}</div>
      <textarea maxlength="200" rows="2" placeholder="Что скажете городу?"></textarea><div class="mf-row"></div></div>`);
    const ta = box.querySelector('textarea') as HTMLTextAreaElement;
    const row = box.querySelector('.mf-row') as HTMLElement;
    const say = h<HTMLButtonElement>('<button class="btn primary">Сказать</button>');
    say.onclick = () => this.send({ type: 'speak', text: ta.value.trim() || '…', nominate: this.nominate ?? undefined });
    row.appendChild(say);
    if (v.roles[seat] === 'sheriff' || isMafia(v.roles[seat])) {
      // заявить проверку (комиссар — правду, мафия может и соврать)
      const tgt = this.nominate;
      if (tgt != null) {
        for (const maf of [true, false]) {
          const b = h<HTMLButtonElement>(`<button class="btn">«Я комиссар: ${esc(this.plain(tgt))} — ${maf ? 'мафия' : 'мирный'}»</button>`);
          b.onclick = () => this.send({ type: 'speak', text: `Я комиссар! {@${tgt}} — ${maf ? 'мафия' : 'мирный'}.`, nominate: maf ? tgt : undefined, claim: { target: tgt, mafia: maf } });
          row.appendChild(b);
        }
      }
    }
    this.panel.appendChild(box);
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
      if (ev.type === 'night') {
        Sound.turn();
        this.v = { ...v };
        this.draw();
        await sleep(700 / speed);
      } else if (ev.type === 'dawn') {
        Sound.ui();
        await sleep(400 / speed);
        if (ev.killed != null) Sound.capture();
      } else if (ev.type === 'speak') {
        const cur = this.v!;
        this.v = { ...cur, said: { ...cur.said, [ev.seat]: ev.text }, nominees: ev.nominate != null && !cur.nominees.includes(ev.nominate) ? [...cur.nominees, ev.nominate] : cur.nominees };
        this.draw();
        Sound.chat();
        await sleep(900 / speed);
      } else if (ev.type === 'vote') {
        const cur = this.v!;
        this.v = { ...cur, votes: { ...cur.votes, [ev.seat]: ev.target } };
        this.draw();
        Sound.step();
        await sleep(350 / speed);
      } else if (ev.type === 'out') {
        Sound.capture();
        await sleep(600 / speed);
      } else if (ev.type === 'end') Sound.win();
    }
    this.v = v;
    this.draw();
    this.renderPanel();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const v = this.v;
    if (!v) return;
    this.actSeat = null;
    if (v.phase === 'over' || this.ctx.demo) {
      this.draw();
      this.renderPanel();
      return;
    }
    this.chooseViewer(v, toAct);
    const seat = interactive.find((x) => x === this.viewer) ?? interactive[0] ?? null;
    if (seat != null && seat !== this.viewer && this.ctx.mySeats.length > 1) {
      this.viewer = seat;
      if (v.phase === 'night') this.hidden = true;
    }
    if (this.hidden && interactive.length && this.ctx.mySeats.length > 1) {
      (this.cover.querySelector('.mf-cover-t') as HTMLElement).innerHTML = `Ходит ${this.ctx.name(this.viewer)}.<br><small>Остальные — закройте глаза!</small>`;
      this.cover.hidden = false;
    } else {
      this.hidden = false;
      this.cover.hidden = true;
    }
    this.actSeat = seat;
    this.draw();
    this.renderPanel();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    const name = (p: number) => this.ctx.name(p);
    if (v.phase === 'over') return v.winner === 'city' ? 'Город победил!' : 'Мафия победила';
    const mine = interactive.length > 0;
    if (v.phase === 'night') return mine ? 'Ночь: ваш ход' : 'Город спит…';
    if (v.phase === 'day') return mine ? 'Ваше слово' : `Говорит ${name(toAct[0])}…`;
    return mine ? 'Ваш голос' : `Голосует ${name(toAct[0])}…`;
  }

  quiet(v: View) {
    return v.phase === 'night' ? 'Ночь — город спит: микрофоны и камеры выключены' : null;
  }

  playerStats(v: View, seat: number) {
    if (!v.alive.includes(seat)) return v.shown[seat] ? `выбыл · ${ROLE_NAME[v.shown[seat]]}` : 'выбыл';
    return v.nominees.includes(seat) ? 'выставлен' : '';
  }
}

export function createView(): GameView<View, Event> {
  return new MafiaView();
}
