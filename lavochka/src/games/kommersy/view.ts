/* «Коммерсы» — отрисовка: панорама местности (по уровню и эпохе), по ней вьётся дорога из клеток (кривая — кодом, поверх фона),
 * фишки игроков, карточка клетки с выбором, исторические события и «Падал, но поднимался» — плашками. В панели — Колян (облик по году),
 * деньги и часы, параметры, навыки, крыша, дела (управляющий, продать), долги, условия покупки клуба. */
import { Sound } from '../../core/audio';
import { DiceTray } from '../../core/dice';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import {
  CELL_COLOR, CELL_NAME, CLUB, ERA_NAME, HEROES, KRYSHA_NAME, SEG_CELLS, SKILL_MAX, SKILL_NAME, STAT_NAME, TIERS, TIER_ID,
  dateText, dealById, eraOf, type Cell, type Krysha, type Skill, type Stat,
} from './data';
import { RIVAL_DARK, RIVAL_NAME, money, type Action, type Ask, type Books, type Event, type Rival, type View } from './engine';
import { KolyanCam, kolyanImg, type Reaction } from './kolyan';
import { Music, eraMusic } from './music';
import { sfx } from './sfx';
import { say, voiceKey } from './voice';
import roadsJson from './roads.json';
import './kommersy.css';

const A = '/kommersy/a';
const ICON: Record<Cell, string> = { deal: '💼', routine: '🧾', study: '📚', rest: '🌿', news: '📰', event: '❗', naezd: '🚘', check: '🔍', period: '☀' };

/** Дорога — те же кривые, по которым нарисован асфальт на панорамах (roads.json, общий с studio/post/road_templates.py). */
const ROADS: number[][] = roadsJson.roads;
const ROAD_W: number = roadsJson.width;
function bez(p: number[], t: number): [number, number] {
  const seg = t < 0.5 ? 0 : 1;
  const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  const o = seg * 6;
  const k = [(1 - u) ** 3, 3 * (1 - u) ** 2 * u, 3 * (1 - u) * u ** 2, u ** 3];
  return [k[0] * p[o] + k[1] * p[o + 2] + k[2] * p[o + 4] + k[3] * p[o + 6], k[0] * p[o + 1] + k[1] * p[o + 3] + k[2] * p[o + 5] + k[3] * p[o + 7]];
}
interface RoadGeo {
  /** Центр клетки: 0 — старт, 1…SEG_CELLS+1 — клетки. */
  centers: [number, number][];
  /** Плитка клетки — многоугольник по краям дороги. */
  tiles: string[];
}
const geoCache = new Map<number, RoadGeo>();
/** Плитки встык по дороге: равные отрезки длины от входа до выхода, края — по нормали на ширину полотна. */
function roadGeo(r: number): RoadGeo {
  const hit = geoCache.get(r);
  if (hit) return hit;
  const p = ROADS[r];
  const N = 600;
  const pts = Array.from({ length: N + 1 }, (_, i) => bez(p, i / N));
  const len = [0];
  for (let i = 1; i <= N; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = len[N];
  const idx = (f: number) => Math.min(N, Math.max(0, len.findIndex((l) => l >= f * total)));
  const norm = (i: number): [number, number] => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(N, i + 1)];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / d, (b[0] - a[0]) / d];
  };
  const n = SEG_CELLS + 2;
  const from = 0.035;
  const step = (1 - 2 * from) / n;
  const hw = ROAD_W * 0.42;
  const gap = 2.5 / total;
  const centers: [number, number][] = [];
  const tiles: string[] = [];
  for (let k = 0; k < n; k++) {
    const a = from + k * step + gap;
    const b = from + (k + 1) * step - gap;
    centers.push(pts[idx((a + b) / 2)]);
    const left: string[] = [];
    const right: string[] = [];
    for (let j = 0; j <= 6; j++) {
      const i = idx(a + ((b - a) * j) / 6);
      const [nx, ny] = norm(i);
      left.push(`${(pts[i][0] + nx * hw).toFixed(1)},${(pts[i][1] + ny * hw).toFixed(1)}`);
      right.unshift(`${(pts[i][0] - nx * hw).toFixed(1)},${(pts[i][1] - ny * hw).toFixed(1)}`);
    }
    tiles.push(`M${left.join(' L')} L${right.join(' L')} Z`);
  }
  const geo = { centers, tiles };
  geoCache.set(r, geo);
  return geo;
}

/** Панорама: местность по уровню, вариант по эпохе (где у местности его нет — ближайший), часть — по отрезку. */
function pano(tier: number, m: number) {
  const place = TIER_ID[tier];
  const era = eraOf(m);
  const have: Record<string, string[]> = { dvor: ['soviet', 'wild'], kiosk: ['soviet', 'wild'], bazar: ['wild', 'new'], center: ['wild', 'new'], oblast: ['wild', 'new'], moscow: ['new'], london: ['new'] };
  const want = era === 'soviet' ? 'soviet' : era === 'new' ? 'new' : 'wild';
  const list = have[place];
  const e = list.includes(want) ? want : want === 'soviet' ? list[0] : list[list.length - 1];
  return { src: `${A}/pano/${place}-${e}-${(Math.floor(m / 3) % 3) + 1}.webp`, road: Math.floor(m / 3) % 3 };
}

/** Кто смотрит с карточки. */
const NPC_BY_CARD: Record<string, string> = {
  'k-reket': 'byk', 'k-strelka': 'brigadir', 'k-krysha-dan': 'brigadir', 'k-zakaz': 'konkurent', 'k-kinul': 'konkurent', 'k-reyd': 'reshala', 'k-pokushenie': 'byk',
  'c-nalog': 'nalogovik', 'c-obep': 'oper', 'c-ses': 'chinovnik', 'c-palenka': 'oper', 'c-uchastkovy': 'uchastkovy',
  'w-banya': 'chinovnik', 'w-chinovnik': 'chinovnik', 'w-deputat': 'chinovnik', 'w-moskva': 'reshala', 'w-mvd': 'oper', 'w-devushka': 'girl', 'w-svadba': 'girl', 'w-mama': 'mother', 'w-dacha': 'mother',
  'n-black': 'bankir', 'n-default': 'reshala', 'n-pavlov': 'mother', 'n-advisor': 'yurist', 'n-vybory': 'chinovnik', 'n-krysha': 'oper', 'n-vykup': 'bankir', 'n-sponsor': 'chinovnik',
  'e-mat': 'mother', 'e-rebenok': 'girl', 'e-drug': 'drug', 'r-dolg': 'drug', 'r-kabak': 'drug', 'r-podarok': 'mother', 's-english': 'zhurnalist', 's-london': 'yurist', 's-buh': 'chelnochnitsa',
};
const NPC_BY_CELL: Partial<Record<Cell, string>> = { deal: 'chelnochnitsa', routine: 'drug', study: 'drug', rest: 'girl', news: 'zhurnalist', event: 'mother', naezd: 'brigadir', check: 'nalogovik' };
/** Реакция Коляна на свои события. */
const REACT: Partial<Record<Event['t'], Reaction>> = { buy: 'deal', risk: 'lose', fall: 'lose', out: 'lose', club: 'win' };
const SHOW_STATS: Stat[] = ['health', 'mood', 'stress', 'name', 'avt', 'svyazi', 'blizkie'];
const FALL: Record<string, string> = { razor: 'Разорился', jail: 'Сел', pokushenie: 'Покушение', zapoi: 'Запой' };

class KommersyView implements GameView<View, Event> {
  private ctx!: ViewCtx<Action>;
  private v: View | null = null;
  private wrap!: HTMLElement;
  private bg!: HTMLImageElement;
  private bg2!: HTMLImageElement;
  private svg!: SVGSVGElement;
  private tokensEl!: HTMLElement;
  private dateEl!: HTMLElement;
  private cardEl!: HTMLElement;
  private banner!: HTMLElement;
  private panel!: HTMLElement;
  private sheet!: HTMLElement;
  private rollBtn!: HTMLButtonElement;
  private moveBtn!: HTMLButtonElement;
  private tray!: DiceTray;
  private interactive: number[] = [];
  private shownPos = new Map<number, number>();
  private road = 0;
  private bgSrc = '';
  private music = new Music();
  private musicBtn!: HTMLButtonElement;
  private kolyan = new KolyanCam();

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.wrap = h(`<div class="km-wrap"><div class="km-scene">
        <img class="km-bg" alt="" draggable="false"><img class="km-bg km-bg2" alt="" draggable="false">
        <svg class="km-road" viewBox="0 0 1600 800" preserveAspectRatio="xMidYMid slice"></svg>
        <div class="km-tokens"></div>
        <div class="km-date"></div>
        <button class="km-music" title="Музыка"></button>
        <div class="km-banner" hidden></div>
        <div class="km-card" hidden></div>
      </div></div>`);
    root.appendChild(this.wrap);
    this.bg = this.wrap.querySelector('.km-bg') as HTMLImageElement;
    this.bg2 = this.wrap.querySelector('.km-bg2') as HTMLImageElement;
    this.svg = this.wrap.querySelector('.km-road') as unknown as SVGSVGElement;
    this.tokensEl = this.wrap.querySelector('.km-tokens') as HTMLElement;
    this.dateEl = this.wrap.querySelector('.km-date') as HTMLElement;
    this.cardEl = this.wrap.querySelector('.km-card') as HTMLElement;
    this.banner = this.wrap.querySelector('.km-banner') as HTMLElement;
    this.musicBtn = this.wrap.querySelector('.km-music') as HTMLButtonElement;
    // у показа правил своей музыки нет: она шла поверх партии, и ♪ партии её не выключал
    this.musicBtn.hidden = ctx.demo;
    this.musicBtn.textContent = this.music.on() ? '♪' : '🔇';
    this.musicBtn.onclick = () => {
      this.musicBtn.textContent = this.music.toggle() ? '♪' : '🔇';
      if (this.v) this.music.set(eraMusic(this.v));
    };
    this.svg.addEventListener('click', (e) => {
      const g = (e.target as Element).closest('[data-cell]');
      if (g && this.canMove() && Number(g.getAttribute('data-cell')) === this.v!.target) this.send({ type: 'move' });
    });
    this.cardEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-choice]') as HTMLElement | null;
      if (b && !b.hasAttribute('disabled')) this.send({ type: 'choose', i: Number(b.dataset.choice) });
      if ((e.target as HTMLElement).closest('[data-buh]')) this.sendBooks();
    });
    this.cardEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).matches('.km-buh-in')) this.sendBooks();
    });
    this.panel = h(`<div class="km-panel">
        <div class="km-tray"></div>
        <button class="btn primary km-roll" data-tap hidden>Бросить кубик</button>
        <button class="btn primary km-move" data-tap hidden>Поставить фишку</button>
        <div class="km-sheet"></div>
      </div>`);
    ctx.controls.appendChild(this.panel);
    this.tray = new DiceTray(this.panel.querySelector('.km-tray') as HTMLElement, 1);
    this.rollBtn = this.panel.querySelector('.km-roll') as HTMLButtonElement;
    this.moveBtn = this.panel.querySelector('.km-move') as HTMLButtonElement;
    this.sheet = this.panel.querySelector('.km-sheet') as HTMLElement;
    this.panel.insertBefore(this.kolyan.el, this.sheet);
    this.rollBtn.onclick = () => this.send({ type: 'roll' });
    this.moveBtn.onclick = () => this.send({ type: 'move' });
    this.sheet.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!el || el.hasAttribute('disabled')) return;
      const act = el.dataset.act!;
      if (act === 'sell') this.send({ type: 'sell', uid: Number(el.dataset.uid) });
      else if (act === 'manager') this.send({ type: 'manager', uid: Number(el.dataset.uid), on: el.dataset.on === '1' });
      else if (act === 'repay') this.send({ type: 'repay' });
      else if (act === 'quit') this.send({ type: 'quit' });
      else if (act === 'krysha') this.send({ type: 'krysha', to: el.dataset.to as Krysha });
      else if (act === 'rival') this.send({ type: 'rival', kind: el.dataset.kind as Rival, target: Number(el.dataset.target) });
    });
  }

  private me() {
    return this.ctx.mySeats[0] ?? 0;
  }
  private send(a: Action) {
    const seat = this.v?.ask?.seat ?? this.v?.turn ?? this.me();
    if (!this.interactive.includes(seat)) return;
    Sound.ui();
    this.ctx.act(seat, a);
  }
  /** «Бухгалтерия»: сдать свою разноску. */
  private sendBooks() {
    const v = this.v;
    const b = v?.books.find((x) => x.ans == null && this.interactive.includes(x.seat));
    const inp = this.cardEl.querySelector('.km-buh-in') as HTMLInputElement | null;
    if (!b || !inp) return;
    const sum = Number(inp.value.replace(/[\s$]/g, '').replace(',', '.').replace('−', '-'));
    if (!inp.value.trim() || !Number.isFinite(sum)) {
      inp.focus();
      return;
    }
    Sound.ui();
    this.ctx.act(b.seat, { type: 'buh', sum });
  }
  private mineTurn() {
    return !!this.v && this.v.phase !== 'over' && this.interactive.includes(this.v.turn);
  }
  private canMove() {
    return this.mineTurn() && this.v!.phase === 'move';
  }

  setView(v: View) {
    const fresh = !this.v && v.phase === 'roll' && v.players.every((p) => p.pos === 0 && !p.assets.length);
    this.v = v;
    if (fresh && v.players.some((p) => p.hero === 'kolyan')) setTimeout(() => say('start', true), 800);
    this.shownPos = new Map(v.players.map((p) => [p.seat, p.pos]));
    if (v.roll) this.tray.show([v.roll]);
    this.render();
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.interactive = interactive;
    this.render();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.phase === 'over') return 'Июль 2003-го. Итоги.';
    const who = this.ctx.name(toAct[0] ?? v.turn).replace(/<[^>]+>/g, '');
    const mine = interactive.includes(toAct[0]);
    if (v.phase === 'buh') return v.booksWait.some((x) => interactive.includes(x)) ? 'Сведите баланс за отрезок' : 'Бухгалтерия: ждём остальных';
    if (v.phase === 'choose') return mine ? 'Выбирайте' : `${who} думает`;
    if (v.phase === 'move') return mine ? 'Поставьте фишку на подсвеченную клетку' : `${who} ходит`;
    return mine ? 'Бросайте кубик' : `${who} бросает кубик`;
  }

  saveTitle(v: View) {
    const p = v.players.find((x) => x.seat === (v.me ?? this.me())) ?? v.players[0];
    return `${dateText(v.m)} · ${TIERS[p.tier]} · ${money(p.worth)}`;
  }

  playerStats(v: View, seat: number) {
    const p = v.players.find((x) => x.seat === seat);
    if (!p) return '';
    const out = p.outKind ? ` · ${p.outKind === 'jail' ? 'в тюрьме' : p.outKind === 'hosp' ? 'в больнице' : 'уехал'}` : '';
    return `${money(p.worth)} · ${TIERS[p.tier]}${out}`;
  }

  // ---------------------------------------------------------------- отрисовка
  private myPlayer() {
    const v = this.v!;
    const seat = v.me ?? this.me();
    return v.players.find((p) => p.seat === seat) ?? v.players[0];
  }

  private render() {
    const v = this.v;
    if (!v) return;
    const me = this.myPlayer();
    const pn = pano(me.tier, v.m);
    this.road = pn.road;
    this.setBg(pn.src);
    this.dateEl.innerHTML = `<b>${dateText(v.m)}</b> · ${ERA_NAME[eraOf(v.m)]}${v.len === 1 ? ' · помесячно' : ''}${v.crisis ? ' <span class="km-crisis">кризис</span>' : ''}<span class="km-place">${TIERS[me.tier]}</span>`;
    this.drawRoad();
    this.kolyan.set(me.hero === 'kolyan' ? v.m : null);
    const thinking = v.phase === 'choose' && v.ask?.seat === me.seat;
    if (thinking) this.kolyan.play('think');
    else if (this.kolyan.now === 'think') this.kolyan.play('idle');
    this.drawTokens();
    this.drawCard();
    this.rollBtn.hidden = !(this.mineTurn() && v.phase === 'roll');
    this.moveBtn.hidden = !this.canMove();
    this.drawSheet();
    if (!this.ctx.demo) this.music.set(eraMusic(v));
  }

  private setBg(src: string) {
    if (src === this.bgSrc) return;
    const first = !this.bgSrc;
    this.bgSrc = src;
    if (first) {
      this.bg.src = src;
      return;
    }
    this.bg2.src = src;
    this.bg2.classList.add('on');
    setTimeout(() => {
      this.bg.src = src;
      this.bg2.classList.remove('on');
    }, 900);
  }

  private drawRoad() {
    const v = this.v!;
    const g = roadGeo(this.road);
    const tile = (i: number, c: Cell | 'start') => {
      const [x, y] = g.centers[i];
      const hot = c !== 'start' && v.phase === 'move' && v.target === i;
      const color = c === 'start' ? '#efe6d2' : CELL_COLOR[c];
      const icon = c === 'start' ? '' : `<text x="${x}" y="${y + 18}" text-anchor="middle" font-size="${c === 'period' ? 58 : 50}">${ICON[c]}</text>`;
      return `<g class="km-cell${hot ? ' hot' : ''}${hot && this.canMove() ? ' tap' : ''}" data-cell="${i}">
        <path d="${g.tiles[i]}" class="km-tile-shadow"/><path d="${g.tiles[i]}" fill="${color}" class="km-tile"/>${icon}<title>${c === 'start' ? 'Начало отрезка' : CELL_NAME[c]}</title></g>`;
    };
    this.svg.innerHTML = tile(0, 'start') + v.cells.map((c, i) => tile(i + 1, c)).join('');
  }

  private tokenXY(seat: number) {
    const g = roadGeo(this.road);
    const pos = Math.min(this.shownPos.get(seat) ?? 0, SEG_CELLS + 1);
    const v = this.v!;
    const same = v.players.filter((q) => Math.min(this.shownPos.get(q.seat) ?? 0, SEG_CELLS + 1) === pos);
    const k = same.findIndex((q) => q.seat === seat);
    const [x, y] = g.centers[pos];
    return { x: ((x + (k - (same.length - 1) / 2) * 30) / 1600) * 100, y: ((y - 46) / 800) * 100 };
  }

  private drawTokens() {
    const v = this.v!;
    this.tokensEl.innerHTML = v.players
      .map((p) => {
        const { x, y } = this.tokenXY(p.seat);
        const hero = HEROES.find((hh) => hh.id === p.hero);
        const img = p.hero === 'kolyan' ? `<img src="${kolyanImg(v.m)}" alt="">` : `<span>${esc(hero?.name[0] ?? '?')}</span>`;
        const on = (v.ask ? v.ask.seat : v.turn) === p.seat ? ' on' : '';
        const out = p.out > 0 ? ' out' : '';
        return `<div class="km-token${on}${out}" data-seat="${p.seat}" style="left:${x}%;top:${y}%;--c:${this.seatColor(p.seat)}">${img}</div>`;
      })
      .join('');
  }

  private seatColor(seat: number) {
    const m = /color:\s*([^;"]+)/.exec(this.ctx.name(seat));
    return m ? m[1] : '#555';
  }

  private drawCard() {
    const v = this.v!;
    if (v.phase === 'buh') {
      const b = v.books.find((x) => x.ans == null && this.interactive.includes(x.seat));
      // карточку не перерисовываем, пока игрок вписывает число
      if (b && this.cardEl.dataset.buh === String(b.seat) && !this.cardEl.hidden) return;
      this.cardEl.hidden = false;
      this.cardEl.dataset.buh = b ? String(b.seat) : '';
      this.cardEl.innerHTML = booksHtml(b, this.ctx.name(b?.seat ?? this.me()));
      (this.cardEl.querySelector('.km-buh-in') as HTMLInputElement | null)?.focus();
      return;
    }
    this.cardEl.dataset.buh = '';
    const ask = v.ask;
    if (!ask || v.phase !== 'choose') {
      this.cardEl.hidden = true;
      return;
    }
    const mine = this.interactive.includes(ask.seat);
    this.cardEl.hidden = false;
    this.cardEl.innerHTML = cardHtml(ask, mine, this.ctx.name(ask.seat));
  }

  private drawSheet() {
    const v = this.v!;
    const me = this.myPlayer();
    const my = v.my;
    const free = this.mineTurn() && v.phase === 'roll';
    const dis = free ? '' : ' disabled';
    const bar = (k: Stat, val: number) => {
      const lo = k === 'mood' ? -50 : 0;
      const pct = ((val - lo) / ((k === 'mood' ? 50 : 100) - lo)) * 100;
      const bad = k === 'stress' ? val > 60 : k === 'mood' ? val < -20 : val < 25;
      return `<div class="km-stat"><span>${STAT_NAME[k]}</span><i><b style="width:${Math.max(2, Math.min(100, pct))}%"${bad ? ' class="bad"' : ''}></b></i><em>${val}</em></div>`;
    };
    const skills = (Object.keys(SKILL_NAME) as Skill[])
      .map((k) => `<span class="km-skill" title="${SKILL_NAME[k]}">${SKILL_NAME[k]} ${'●'.repeat(me.skills[k])}${'○'.repeat(SKILL_MAX - me.skills[k])}</span>`)
      .join('');
    const assets = me.assets.length
      ? me.assets
          .map((a) => {
            const d = dealById(a.id);
            const mgr = a.kind === 'biz' ? `<button class="km-mini${a.manager ? ' on' : ''}" data-act="manager" data-uid="${a.uid}" data-on="${a.manager ? 0 : 1}"${dis} title="управляющий">👔</button>` : '';
            const inc = a.kind === 'paper' ? `${money(a.value)} в бумагах` : `+${money(a.income * a.mul)}/мес · ${a.manager ? Math.ceil(a.hours * 0.15) : a.hours} ч`;
            return `<li><b>${esc(a.name)}</b><small>${inc}${d?.heat ? ' · 🩸' : ''}</small>${mgr}<button class="km-mini" data-act="sell" data-uid="${a.uid}"${dis} title="продать">💵</button></li>`;
          })
          .join('')
      : '<li class="km-none">Дел пока нет</li>';
    const kr = (['police', 'own', 'none'] as Krysha[])
      .filter((k) => k !== me.krysha)
      .map((k) => `<button class="km-mini txt" data-act="krysha" data-to="${k}"${dis}>${KRYSHA_NAME[k]}</button>`)
      .join('');
    const club = my?.club.map((c) => `<li class="${c.ok ? 'ok' : ''}">${c.ok ? '✔' : '○'} ${esc(c.label)}</li>`).join('') ?? '';
    const RICON: Record<Rival, string> = { demping: '📉', peremanit: '👔', naezd: '🩸', donos: '✉' };
    const rivals = (my?.rivals ?? [])
      .map((r) => {
        const btns = r.acts
          .map((a) => {
            const tip = `${RIVAL_NAME[a.kind]} · ${money(a.cost)}${a.why ? ` — ${a.why}` : ''}`;
            return `<button class="km-mini${RIVAL_DARK[a.kind] ? ' dark' : ''}" data-act="rival" data-kind="${a.kind}" data-target="${r.seat}" title="${esc(tip)}"${free && !a.why ? '' : ' disabled'}>${RICON[a.kind]}</button>`;
          })
          .join('');
        return `<li><b>${this.ctx.name(r.seat)}</b>${btns}</li>`;
      })
      .join('');
    const hoursPct = my ? Math.min(100, (my.hours.used / my.hours.avail) * 100) : 0;
    this.sheet.innerHTML = `
      <div class="km-me"><div><b>${esc(HEROES.find((x) => x.id === me.hero)?.name ?? '')}</b><small>${TIERS[me.tier]} · ${KRYSHA_NAME[me.krysha]}</small></div></div>
      <div class="km-money"><div><span>Наличные</span><b>${money(me.cash)}</b></div><div><span>Капитал</span><b>${money(me.worth)}</b></div>
        ${my ? `<div><span>Доход/мес</span><b class="plus">+${money(my.income)}</b></div><div><span>Расход/мес</span><b class="minus">−${money(my.expenses)}</b></div>` : ''}</div>
      ${my ? `<div class="km-hours"><span>Часы ${my.hours.used}/${my.hours.avail}</span><i><b style="width:${hoursPct}%"${my.hours.used > my.hours.avail ? ' class="bad"' : ''}></b></i></div>` : ''}
      ${me.debt > 0 ? `<div class="km-debt">Долг ${money(me.debt)} <button class="km-mini txt" data-act="repay"${dis}>Погасить</button></div>` : ''}
      ${my?.job ? `<div class="km-job">Работа: ${esc(my.job.name)} (+${money(my.job.salary)}, ${my.job.hours} ч) <button class="km-mini txt" data-act="quit"${dis}>Уволиться</button></div>` : ''}
      <div class="km-stats">${SHOW_STATS.map((k) => bar(k, me.stats[k] ?? 0)).join('')}
        ${my ? `<div class="km-hint">Органы: <b>${my.heatHint}</b> · Совесть: <b>${my.sovestHint}</b></div>` : ''}</div>
      <div class="km-skills">${skills}</div>
      <h4>Дела</h4><ul class="km-assets">${assets}</ul>
      <div class="km-krysha">Крыша: <b>${KRYSHA_NAME[me.krysha]}</b> ${kr}</div>
      ${rivals ? `<h4>Соперники</h4><ul class="km-assets km-rivals">${rivals}</ul>` : ''}
      <h4>«${CLUB}»</h4><ul class="km-club">${club}</ul>
      ${me.falls.length ? `<div class="km-falls">Падал ${me.falls.length} раз${me.falls.length % 10 >= 2 && me.falls.length % 10 <= 4 && (me.falls.length < 10 || me.falls.length > 20) ? 'а' : ''} — и поднимался</div>` : ''}`;
  }

  // ---------------------------------------------------------------- события
  async play(events: Event[], v: View) {
    const speed = this.ctx.speed();
    const mine = this.myPlayer().seat;
    const kolyan = v.players.find((p) => p.hero === 'kolyan')?.seat;
    const old = this.v;
    for (const ev of events) {
      const r = 'seat' in ev && ev.seat === mine ? REACT[ev.t] : undefined;
      if (r) this.kolyan.play(r);
      const line = kolyan == null ? null : voiceKey(ev, kolyan, old, v);
      if (line) say(...line);
      switch (ev.t) {
        case 'roll':
          Sound.diceRoll();
          await this.tray.roll([ev.d], speed);
          break;
        case 'move': {
          const to = v.players.find((p) => p.seat === ev.seat)?.pos ?? 0;
          const from = this.shownPos.get(ev.seat) ?? 0;
          for (let p = from + 1; p <= to; p++) {
            this.shownPos.set(ev.seat, p);
            this.drawTokens();
            Sound.step();
            await sleep(160 / speed);
          }
          Sound.place();
          if (ev.cell !== 'period') sfx(`cell-${ev.cell}`, 0.8);
          break;
        }
        case 'pick':
          if (ev.dark) sfx('dark');
          await sleep(250 / speed);
          break;
        case 'hist':
          sfx('hist', 0.8);
          await this.showBanner(`${art(`h-${ev.id}`)}<small>${dateText(v.m)}</small><b>${esc(ev.title)}</b><p>${esc(ev.text)}</p>`, 'hist', 2600);
          break;
        case 'fall':
          sfx(`fall-${ev.kind}`);
          await this.showBanner(`<b>${FALL[ev.kind]}</b><p>${this.ctx.name(ev.seat)} — падал, но поднимался.</p>`, 'fall', 2200);
          break;
        case 'club':
          sfx('club');
          await this.showBanner(`<b>«${CLUB}»</b><p>${this.ctx.name(ev.seat)} покупает лондонский клуб!</p>`, 'club', 3200);
          break;
        case 'buy':
        case 'sell':
          sfx(ev.t);
          await sleep(300 / speed);
          break;
        case 'buh':
          if (this.interactive.includes(ev.seat))
            await this.showBanner(
              ev.ok ? `<b>Баланс сошёлся</b><p>${money(ev.sum)} за отрезок. Органы спокойнее.</p>` : `<b>Не сошлось</b><p>Записано ${money(ev.ans)}, а вышло ${money(ev.sum)}. Налоговая заметила.</p>`,
              'hist', 1800
            );
          break;
        case 'resold':
          sfx('buy');
          await sleep(300 / speed);
          break;
        case 'out':
          if (ev.kind === 'hosp') sfx('out-hosp');
          break;
        case 'period':
          sfx('cell-period', 0.5);
          break;
      }
    }
    this.setView(v);
  }

  private async showBanner(html: string, kind: string, ms: number) {
    this.banner.className = `km-banner ${kind}`;
    this.banner.innerHTML = html;
    this.banner.hidden = false;
    await (this.ctx.read ? this.ctx.read(ms) : sleep(ms / this.ctx.speed()));
    this.banner.hidden = true;
  }

  destroy() {
    this.music.stop();
    this.kolyan.stop();
    this.panel?.remove();
  }
}

/** Иллюстрация карточки, сделки или исторической даты (studio/jobs/kommersy 11-cards → pack_kommersy.py); нет файла — не показывается. */
const art = (id: string, cls = 'km-art') => `<img class="${cls}" src="${A}/cards/${id}.webp" alt="" onerror="this.remove()">`;

function booksHtml(b: Books | undefined, who: string) {
  const head = `<div class="km-card-head">📒 Бухгалтерия${b ? ` · ${who}` : ''}</div>`;
  if (!b) return `<div class="km-card-in" style="--cc:#8a7a5a">${head}<p>Баланс сдан. Ждём, пока сведут остальные.</p></div>`;
  const rows = b.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="${l.sum < 0 ? 'neg' : ''}">${l.sum < 0 ? '−' : '+'}$${Math.abs(l.sum)}</td></tr>`).join('');
  return `<div class="km-card-in" style="--cc:#8a7a5a">${head}
    <div class="km-card-body"><div><h3>Свести баланс</h3><p>Статьи за месяц. Сколько прибавится (или убудет) за ${b.len === 1 ? 'месяц' : `${b.len} мес.`}? Расход — с минусом.</p></div></div>
    <table class="km-buh">${rows}</table>
    <div class="km-buh-row"><span>Итого × ${b.len} =</span><input class="km-buh-in" inputmode="numeric" placeholder="$" autocomplete="off"><button class="btn primary" data-buh>Сдать</button></div></div>`;
}

function cardHtml(ask: Ask, mine: boolean, who: string) {
  const npc = (ask.card && NPC_BY_CARD[ask.card]) || NPC_BY_CELL[ask.cell];
  const face = npc ? `<img class="km-npc" src="${A}/people/${npc}.webp" alt="">` : '';
  const offers = ask.deals
    ? `<div class="km-offers">${ask.deals
        .map((o, i) => {
          const ch = ask.choices.find((c) => c.di === i)!;
          const ci = ask.choices.indexOf(ch);
          const pay = o.kind === 'paper' ? 'бумаги: цена растёт' : `окупится за ${Math.max(1, Math.round(o.price / Math.max(1, o.income)))} мес`;
          return `<button class="km-offer" data-choice="${ci}"${!mine || !ch.ok ? ' disabled' : ''}>${art(o.id, 'km-thumb')}<div>
            <b>${esc(o.name)}</b><small>${esc(o.text)}</small>
            <span>${money(o.price)} · ${o.kind === 'paper' ? '' : `+${money(o.income)}/мес · `}${o.mgr ? 'управляющий' : `${o.hours} ч`}</span>
            <em>${ch.ok ? (o.loan ? `в кредит ${money(o.loan)} · ` : '') + pay : esc(ch.why ?? '')}</em></div></button>`;
        })
        .join('')}</div>`
    : '';
  const choices = ask.choices
    .map((c, i) => (c.buy === 'deal' ? '' : `<button class="btn km-choice${c.dark ? ' dark' : ''}${c.buy === 'club' ? ' club' : ''}" data-choice="${i}"${!mine || !c.ok ? ' disabled' : ''}>${c.dark ? '🩸 ' : ''}${esc(c.label)}${c.ok ? '' : `<small>${esc(c.why ?? '')}</small>`}</button>`))
    .join('');
  return `<div class="km-card-in" style="--cc:${CELL_COLOR[ask.cell]}">
    <div class="km-card-head">${ICON[ask.cell]} ${CELL_NAME[ask.cell]}${mine ? '' : ` · ${who}`}</div>
    ${ask.card ? art(ask.card) : ''}<div class="km-card-body">${face}<div><h3>${esc(ask.title)}</h3><p>${esc(ask.text)}</p></div></div>
    ${offers}<div class="km-choices">${choices}</div></div>`;
}

export function createView(): GameView {
  return new KommersyView();
}
