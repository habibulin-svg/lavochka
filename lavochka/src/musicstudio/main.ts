// Lavochka Music Studio «Dance With Me!» — секвенсор из готовых сэмплов по духу Dance eJay (docs/music-studio/DESIGN.md).
// Отдельная страница /music-studio.html: дорожки сверху, библиотека снизу, перетаскивание сэмплов на сетку тактов.
import './style.css';
import { store } from '../core/settings';
import { DEMOS, buildDemo } from './demo';
import { Engine } from './engine';
import {
  KitIndex, TRACKS, canPlace, chordAt, move, newProject, nextFree, parseProject, place, remove, serialize, setBars,
  songEnd, type Block, type Group, type Kit, type KitSample, type Project,
} from './project';
import { SLOTS, autosave, fromLink, loadSlots, readAuto, readSlot, shareLink, writeSlot } from './saves';

const GROUP: Record<Group, { title: string; color: string }> = {
  loop: { title: 'Лупы', color: '#ef5f5a' },
  drum: { title: 'Ударные', color: '#f59a4a' },
  bass: { title: 'Бас', color: '#5b8df5' },
  layer: { title: 'Подложки', color: '#a07af5' },
  keys: { title: 'Клавишные', color: '#4fd0ae' },
  seq: { title: 'Секвенции', color: '#f5d24a' },
  synth: { title: 'Синты', color: '#f572cc' },
  fx: { title: 'Эффекты', color: '#8fc3d8' },
  rap: { title: 'Выкрики', color: '#a6dc58' },
  voice: { title: 'Вокал', color: '#ffa6d0' },
};
const STAR = ['', '★', '★★', '★★★', '★★★★'];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

class Studio {
  readonly ix: KitIndex;
  readonly engine: Engine;
  p: Project;
  group: Group;
  sort: 'chord' | 'abc' | 'len' = store.get('musicstudio.sort', 'chord');
  barW = store.get('musicstudio.zoom', 40);
  cursor = 0;
  sel: number | null = null;
  armed: KitSample | null = null;
  undoStack: string[] = [];
  redoStack: string[] = [];
  hintBar = 0;

  root = el('div');
  lcd = el('div', 'ms-lcd');
  playBtn = el('button', 'ms-btn play', '▶');
  loopBtn = el('button', 'ms-btn', '⟲');
  tempo = el('div', 'ms-group');
  nameEl = el('div', 'ms-name');
  scroll = el('div', 'ms-scroll');
  sheet = el('div', 'ms-sheet');
  ticks = el('div', 'ms-ticks');
  loopEl = el('div', 'ms-loop');
  playEl = el('div', 'ms-play');
  cursorEl = el('div', 'ms-cursor');
  lanes: HTMLDivElement[] = [];
  heads: HTMLDivElement[] = [];
  tabs = el('div', 'ms-tabs');
  tiles = el('div', 'ms-tiles');
  over: HTMLDivElement | null = null;

  constructor(readonly kit: Kit, host: HTMLElement, p: Project) {
    this.ix = new KitIndex(kit);
    this.p = p;
    this.group = kit.groups[0];
    this.engine = new Engine(kit, p);
    this.engine.onStop = () => this.playBtn.classList.remove('on');
    host.append(this.root);
    this.root.id = 'ms';
    this.build();
    this.renderAll();
    requestAnimationFrame(() => this.frame());
    window.addEventListener('keydown', e => this.key(e));
    window.addEventListener('beforeunload', () => autosave(this.p));
  }

  // ── каркас ────────────────────────────────────────────────────────────────
  build(): void {
    const top = el('div', 'ms-top');
    const logo = el('div', 'ms-logo', '<b>LAVOCHKA MUSIC STUDIO</b><i>DANCE WITH ME!</i>');
    const tr = el('div', 'ms-group');
    const home = el('button', 'ms-btn', '⏮');
    home.title = 'В начало (Home)';
    home.onclick = () => this.setCursor(this.p.loop?.from ?? 0, true);
    this.playBtn.title = 'Играть / стоп (пробел)';
    this.playBtn.onclick = () => this.toggle();
    const stop = el('button', 'ms-btn', '⏹');
    stop.title = 'Стоп';
    stop.onclick = () => this.engine.stop();
    this.loopBtn.title = 'Петля (L): играть выделенный на линейке кусок по кругу';
    this.loopBtn.onclick = () => this.toggleLoop();
    tr.append(home, this.playBtn, stop, this.loopBtn);
    const zoom = el('div', 'ms-group');
    const zm = el('button', 'ms-btn', '−');
    const zp = el('button', 'ms-btn', '+');
    zm.title = zp.title = 'Масштаб (− / +)';
    zm.onclick = () => this.zoom(-1);
    zp.onclick = () => this.zoom(1);
    zoom.append(zm, zp);
    const menu = el('button', 'ms-btn', '☰');
    menu.title = 'Меню (Esc)';
    menu.onclick = () => this.menu();
    const help = el('button', 'ms-btn', '?');
    help.title = 'Как пользоваться';
    help.onclick = () => this.help();
    top.append(logo, tr, this.lcd, this.tempo, zoom, this.nameEl, el('div', 'ms-spacer'), menu, help);

    const ruler = el('div', 'ms-ruler');
    const corner = el('div', 'corner', 'такты ▸ щёлкни — курсор, протяни — петля');
    ruler.append(corner, this.ticks);
    this.ticks.append(this.loopEl);
    this.sheet.append(ruler);
    for (let t = 0; t < TRACKS; t++) {
      const row = el('div', 'ms-row');
      const head = el('div', 'ms-head');
      const lane = el('div', 'ms-lane');
      lane.dataset.track = String(t);
      row.append(head, lane);
      this.sheet.append(row);
      this.heads.push(head);
      this.lanes.push(lane);
      lane.addEventListener('pointerdown', e => this.lanePointer(e, t));
    }
    this.sheet.append(this.playEl, this.cursorEl);
    this.scroll.append(this.sheet);
    this.ticks.addEventListener('pointerdown', e => this.rulerPointer(e));

    const lib = el('div', 'ms-lib');
    lib.append(this.tabs, this.tiles);
    this.root.append(top, this.scroll, lib);
  }

  renderAll(): void {
    this.root.style.setProperty('--bar', `${this.barW}px`);
    this.renderTempo();
    this.renderHeads();
    this.renderSheet();
    this.renderTabs();
    this.renderTiles();
    this.nameEl.textContent = this.p.name;
    this.loopBtn.classList.toggle('on', !!this.p.loop);
  }

  renderTempo(): void {
    this.tempo.innerHTML = '';
    for (const b of this.kit.bpms) {
      const btn = el('button', 'ms-btn' + (b === this.p.bpm ? ' on' : ''), `${b}`);
      btn.title = b === 128 ? 'Хаус, дрим-хаус' : 'Евродэнс, транс';
      btn.onclick = () => this.setBpm(b);
      this.tempo.append(btn);
    }
  }

  renderHeads(): void {
    this.p.tracks.forEach((t, i) => {
      const h = this.heads[i];
      h.innerHTML = '';
      const n = el('span', 'n', String(i + 1).padStart(2, '0'));
      const m = el('button', 'm' + (t.mute ? ' on' : ''), 'M');
      m.title = 'Без звука';
      m.onclick = () => this.edit(() => (t.mute = !t.mute), false);
      const s = el('button', 's' + (t.solo ? ' on' : ''), 'S');
      s.title = 'Соло';
      s.onclick = () => this.edit(() => (t.solo = !t.solo), false);
      const vol = el('input') as HTMLInputElement;
      vol.type = 'range';
      vol.min = '0';
      vol.max = '1.5';
      vol.step = '0.05';
      vol.value = String(t.vol);
      vol.title = 'Громкость';
      vol.oninput = () => {
        t.vol = +vol.value;
        this.engine.mix();
      };
      vol.onchange = () => this.saved();
      const pan = el('input', 'pan') as HTMLInputElement;
      pan.type = 'range';
      pan.min = '-1';
      pan.max = '1';
      pan.step = '0.1';
      pan.value = String(t.pan);
      pan.title = 'Панорама: левее — правее (двойной щелчок — в центр)';
      pan.oninput = () => {
        t.pan = +pan.value;
        this.engine.mix();
      };
      pan.ondblclick = () => {
        t.pan = 0;
        pan.value = '0';
        this.engine.mix();
      };
      pan.onchange = () => this.saved();
      h.append(n, m, s, vol, pan);
    });
  }

  renderSheet(): void {
    const w = this.p.bars * this.barW;
    this.ticks.style.width = `${w}px`;
    this.ticks.querySelectorAll('span').forEach(s => s.remove());
    const step = this.barW < 24 ? 4 : 1;
    for (let b = 0; b < this.p.bars; b += step) {
      const s = el('span', b % 4 === 0 ? 'four' : '', b % 4 === 0 || this.barW >= 40 ? String(b + 1) : '');
      s.style.left = `${b * this.barW}px`;
      this.ticks.append(s);
    }
    for (const lane of this.lanes) {
      lane.style.width = `${w}px`;
      lane.innerHTML = '';
    }
    for (const b of this.p.blocks) this.lanes[b.track]?.append(this.blockEl(b));
    this.renderLoop();
    this.cursorEl.style.left = `calc(var(--head) + ${this.cursor * this.barW}px)`;
  }

  renderLoop(): void {
    const lp = this.p.loop ?? this.lastLoop;
    this.loopEl.style.display = lp ? '' : 'none';
    if (lp) {
      this.loopEl.style.left = `${lp.from * this.barW}px`;
      this.loopEl.style.width = `${(lp.to - lp.from) * this.barW}px`;
      this.loopEl.classList.toggle('off', !this.p.loop);
    }
  }

  lastLoop: { from: number; to: number } | null = null;

  blockEl(b: Block): HTMLDivElement {
    const s = this.ix.get(b.sample)!;
    const d = el('div', 'ms-block' + (b.id === this.sel ? ' sel' : ''));
    d.style.left = `${b.bar * this.barW + 1}px`;
    d.style.width = `${s.bars * this.barW - 2}px`;
    d.style.background = GROUP[s.group].color;
    d.innerHTML = `${esc(s.name.replace(/ \*+$/, ''))} <small>${STAR[s.star]}</small>`;
    d.title = `${s.name} · ${s.bars} такт. · ${GROUP[s.group].title}${s.chord ? ' · аккорд ' + s.chord : ''}\nПеретащить — сдвинуть, с Ctrl — копия; двойной щелчок или Delete — убрать`;
    d.addEventListener('pointerdown', e => this.blockPointer(e, b, d));
    d.addEventListener('dblclick', () => this.edit(() => remove(this.p, b.id)));
    d.addEventListener('contextmenu', e => {
      e.preventDefault();
      this.edit(() => remove(this.p, b.id));
    });
    return d;
  }

  renderTabs(): void {
    this.tabs.innerHTML = '';
    for (const g of this.kit.groups) {
      const n = this.kit.samples.filter(s => s.group === g).length;
      if (!n) continue;
      const t = el('button', 'ms-tab' + (g === this.group ? ' on' : ''), `${GROUP[g].title} <small>${n}</small>`);
      t.style.background = GROUP[g].color;
      t.onclick = () => {
        this.group = g;
        this.renderTabs();
        this.renderTiles();
      };
      this.tabs.append(t);
    }
    const tools = el('div', 'ms-tools');
    const sel = el('select') as HTMLSelectElement;
    for (const [v, l] of [['chord', 'по аккорду'], ['abc', 'по алфавиту'], ['len', 'по длине']] as const) {
      const o = el('option', '', l) as HTMLOptionElement;
      o.value = v;
      o.selected = v === this.sort;
      sel.append(o);
    }
    sel.onchange = () => {
      this.sort = sel.value as typeof this.sort;
      store.set('musicstudio.sort', this.sort);
      this.renderTiles();
    };
    tools.append('Порядок:', sel);
    this.tabs.append(tools);
  }

  renderTiles(): void {
    const list = this.kit.samples.filter(s => s.group === this.group);
    const by = {
      chord: (a: KitSample, b: KitSample) => (a.family ?? a.name).localeCompare(b.family ?? b.name) || a.star - b.star,
      abc: (a: KitSample, b: KitSample) => a.name.localeCompare(b.name),
      len: (a: KitSample, b: KitSample) => a.bars - b.bars || a.name.localeCompare(b.name),
    }[this.sort];
    list.sort(by);
    const chord = chordAt(this.p, this.ix, this.hintBar);
    this.tiles.innerHTML = '';
    for (const s of list) {
      const fits = !s.chord || !chord || s.chord === chord;
      const t = el('div', 'ms-tile' + (this.armed?.id === s.id ? ' armed' : '') + (chord && s.chord === chord ? ' fit' : '') + (fits ? '' : ' dim'));
      t.style.background = GROUP[s.group].color;
      t.innerHTML = `${esc(s.name.replace(/ \*+$/, ''))} <small>${s.bars} такт${s.bars === 1 ? '' : 'а'}${s.chord ? ` · ${STAR[s.star]} ${s.chord}` : ''}${s.text ? ` · «${esc(s.text)}»` : ''}</small>`;
      t.title = 'Щелчок — послушать и выбрать (потом щёлкни по дорожке); перетащи на дорожку; двойной щелчок — поставить у курсора';
      t.addEventListener('pointerdown', e => this.tilePointer(e, s, t));
      t.addEventListener('dblclick', () => this.quickPlace(s));
      this.tiles.append(t);
    }
  }

  // ── правки и отмена ───────────────────────────────────────────────────────
  edit(fn: () => unknown, structural = true): void {
    const before = serialize(this.p);
    fn();
    if (serialize(this.p) === before) return;
    this.undoStack.push(before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.after(structural);
  }

  after(structural: boolean): void {
    if (structural) {
      setBars(this.p, this.ix, Math.max(this.p.bars, songEnd(this.p, this.ix) + 8));
      this.renderSheet();
      this.renderTiles();
      this.engine.resync();
    } else {
      this.renderHeads();
      this.engine.mix();
    }
    this.saved();
  }

  saved(): void {
    window.clearTimeout(this.saveT);
    this.saveT = window.setTimeout(() => autosave(this.p), 400);
  }

  saveT = 0;

  undo(redo = false): void {
    const from = redo ? this.redoStack : this.undoStack;
    const to = redo ? this.undoStack : this.redoStack;
    const s = from.pop();
    if (!s) return;
    to.push(serialize(this.p));
    const q = parseProject(JSON.parse(s), this.kit);
    Object.assign(this.p, q);
    this.sel = null;
    this.renderAll();
    this.engine.mix();
    this.engine.resync();
    this.saved();
  }

  load(p: Project): void {
    this.engine.setProject(p);
    this.p = p;
    this.undoStack = [];
    this.redoStack = [];
    this.sel = null;
    this.cursor = 0;
    this.lastLoop = p.loop;
    this.renderAll();
    this.scroll.scrollLeft = 0;
    autosave(p);
  }

  // ── транспорт ─────────────────────────────────────────────────────────────
  async toggle(): Promise<void> {
    if (this.engine.playing) return this.engine.stop();
    this.toast('Загрузка сэмплов…', 600);
    await this.engine.preload();
    this.engine.play(this.cursor);
    this.playBtn.classList.add('on');
  }

  setCursor(bar: number, restart = false): void {
    this.cursor = Math.max(0, Math.min(this.p.bars - 1, Math.floor(bar)));
    this.hintBar = this.cursor;
    this.cursorEl.style.left = `calc(var(--head) + ${this.cursor * this.barW}px)`;
    this.renderTiles();
    if (restart && this.engine.playing) this.engine.play(this.cursor);
  }

  toggleLoop(): void {
    if (this.p.loop) {
      this.lastLoop = this.p.loop;
      this.p.loop = null;
    } else {
      const from = this.lastLoop?.from ?? this.cursor - (this.cursor % 4);
      this.p.loop = this.lastLoop ?? { from, to: Math.min(this.p.bars, from + 8) };
    }
    this.loopBtn.classList.toggle('on', !!this.p.loop);
    this.renderLoop();
    this.saved();
    if (this.engine.playing) this.engine.play(this.engine.position() ?? this.cursor);
  }

  setBpm(b: number): void {
    if (b === this.p.bpm) return;
    const was = this.engine.playing;
    const pos = this.engine.position();
    this.engine.stop();
    this.p.bpm = b;
    this.renderTempo();
    this.saved();
    if (was) void this.engine.preload().then(() => this.engine.play(pos ?? this.cursor));
  }

  zoom(d: number): void {
    const z = [12, 18, 24, 32, 40, 52, 68, 88];
    const i = Math.max(0, Math.min(z.length - 1, z.indexOf(this.barW) + d));
    if (z.indexOf(this.barW) < 0) this.barW = 40;
    this.barW = z[i];
    store.set('musicstudio.zoom', this.barW);
    this.root.style.setProperty('--bar', `${this.barW}px`);
    this.renderSheet();
  }

  frame(): void {
    requestAnimationFrame(() => this.frame());
    const pos = this.engine.position();
    const shown = pos ?? this.cursor;
    const bar = Math.floor(shown);
    const beat = Math.floor((shown - bar) * 4);
    const secs = shown * this.engine.barSec;
    const chord = chordAt(this.p, this.ix, bar);
    this.lcd.innerHTML = `${String(bar + 1).padStart(3, '0')}:${beat + 1} <small>${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}</small><small>${chord ? '♫ ' + chord : ''}</small><small>${this.p.bpm} BPM</small>`;
    this.playEl.style.display = pos == null ? 'none' : '';
    if (pos != null) {
      const x = pos * this.barW;
      this.playEl.style.left = `calc(var(--head) + ${x}px)`;
      const head = this.heads[0].offsetWidth;
      const view = this.scroll.clientWidth - head;
      if (x < this.scroll.scrollLeft || x > this.scroll.scrollLeft + view - 40) this.scroll.scrollLeft = Math.max(0, x - 40);
      if (bar !== this.hintBar) {
        this.hintBar = bar;
        this.renderTiles();
      }
    }
  }

  // ── мышь и палец ──────────────────────────────────────────────────────────
  /** Такт и дорожка под точкой экрана (или null — не над листом). */
  hit(x: number, y: number): { track: number; bar: number } | null {
    for (let t = 0; t < this.lanes.length; t++) {
      const r = this.lanes[t].getBoundingClientRect();
      if (y >= r.top && y < r.bottom && x >= r.left && x < r.right) {
        const head = this.heads[t].getBoundingClientRect();
        if (x < head.right) return null;
        return { track: t, bar: Math.floor((x - r.left) / this.barW) };
      }
    }
    return null;
  }

  drag(e: PointerEvent, s: KitSample, grabBars: number, onDrop: (track: number, bar: number, copy: boolean) => void, ignore?: number, onClick?: () => void): void {
    const sx = e.clientX;
    const sy = e.clientY;
    let ghost: HTMLDivElement | null = null;
    const touch = e.pointerType === 'touch';
    const moveH = (ev: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        ghost = el('div', 'ms-block ghost');
        ghost.style.background = GROUP[s.group].color;
        ghost.style.width = `${s.bars * this.barW - 2}px`;
        ghost.style.height = `calc(var(--row) - 6px)`;
        ghost.textContent = s.name;
        ghost.style.position = 'fixed';
        document.body.append(ghost);
      }
      const h = this.hit(ev.clientX - grabBars * this.barW + this.barW / 2, ev.clientY);
      if (h) {
        const bar = Math.max(0, h.bar);
        const r = this.lanes[h.track].getBoundingClientRect();
        ghost.style.left = `${r.left + bar * this.barW + 1}px`;
        ghost.style.top = `${r.top + 3}px`;
        ghost.classList.toggle('bad', !canPlace(this.p, this.ix, h.track, bar, s.id, ev.ctrlKey ? undefined : ignore));
      } else {
        ghost.style.left = `${ev.clientX - grabBars * this.barW}px`;
        ghost.style.top = `${ev.clientY - 14}px`;
        ghost.classList.add('bad');
      }
      // у края листа — прокрутка
      const r = this.scroll.getBoundingClientRect();
      if (ev.clientX > r.right - 30) this.scroll.scrollLeft += 12;
      if (ev.clientX < r.left + this.heads[0].offsetWidth + 20) this.scroll.scrollLeft -= 12;
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', moveH);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!ghost) return onClick?.();
      ghost.remove();
      const h = this.hit(ev.clientX - grabBars * this.barW + this.barW / 2, ev.clientY);
      if (h) onDrop(h.track, Math.max(0, h.bar), ev.ctrlKey || ev.altKey);
    };
    if (touch && !ignore) {
      // палец по библиотеке: тянуть — прокрутка списка, короткое касание — послушать и выбрать (потом касание дорожки)
      const tap = (ev: PointerEvent) => {
        window.removeEventListener('pointerup', tap);
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 10) onClick?.();
      };
      window.addEventListener('pointerup', tap);
      return;
    }
    window.addEventListener('pointermove', moveH);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  tilePointer(e: PointerEvent, s: KitSample, t: HTMLElement): void {
    if (e.button !== 0) return;
    this.drag(e, s, 0, (track, bar) => this.edit(() => place(this.p, this.ix, track, bar, s.id)), undefined, () => {
      this.armed = this.armed?.id === s.id ? null : s;
      this.tiles.querySelectorAll('.armed').forEach(x => x.classList.remove('armed'));
      if (this.armed) t.classList.add('armed');
      t.classList.add('playing');
      window.setTimeout(() => t.classList.remove('playing'), s.bars * this.engine.barSec * 1000);
      void this.engine.previewSample(s);
    });
  }

  blockPointer(e: PointerEvent, b: Block, d: HTMLElement): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    const s = this.ix.get(b.sample)!;
    const r = d.getBoundingClientRect();
    const grab = Math.floor((e.clientX - r.left) / this.barW);
    this.drag(e, s, grab, (track, bar, cp) => this.edit(() => (cp ? place(this.p, this.ix, track, bar, s.id) : move(this.p, this.ix, b.id, track, bar))), b.id, () => {
      this.sel = b.id;
      this.lanes.forEach(l => l.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')));
      d.classList.add('sel');
      if (!this.engine.playing) void this.engine.previewSample(s);
    });
  }

  lanePointer(e: PointerEvent, track: number): void {
    if (e.target !== this.lanes[track]) return;
    const h = this.hit(e.clientX, e.clientY);
    if (!h) return;
    if (this.armed) {
      const s = this.armed;
      if (!canPlace(this.p, this.ix, track, h.bar, s.id)) return this.toast('Здесь занято — выбери свободное место');
      this.edit(() => place(this.p, this.ix, track, h.bar, s.id));
      return;
    }
    this.sel = null;
    this.setCursor(h.bar, true);
    this.renderSheet();
  }

  rulerPointer(e: PointerEvent): void {
    const r = this.ticks.getBoundingClientRect();
    const at = (x: number) => Math.max(0, Math.min(this.p.bars, Math.round((x - r.left) / this.barW)));
    const start = at(e.clientX);
    let dragged = false;
    const mv = (ev: PointerEvent) => {
      const end = at(ev.clientX);
      if (Math.abs(end - start) < 1) return;
      dragged = true;
      this.p.loop = { from: Math.min(start, end), to: Math.max(start, end) };
      this.lastLoop = this.p.loop;
      this.loopBtn.classList.add('on');
      this.renderLoop();
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      if (!dragged) this.setCursor(Math.floor((ev.clientX - r.left) / this.barW), true);
      else {
        this.saved();
        if (this.engine.playing) this.engine.play(this.p.loop!.from);
      }
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  }

  quickPlace(s: KitSample): void {
    for (let t = 0; t < TRACKS; t++) {
      if (canPlace(this.p, this.ix, t, this.cursor, s.id)) return this.edit(() => place(this.p, this.ix, t, this.cursor, s.id));
    }
    const t = this.p.blocks.length ? this.p.blocks[this.p.blocks.length - 1].track : 0;
    const bar = nextFree(this.p, this.ix, t, this.cursor, s.id);
    if (bar != null) this.edit(() => place(this.p, this.ix, t, bar, s.id));
  }

  key(e: KeyboardEvent): void {
    const tg = e.target as HTMLInputElement | null;
    if (tg?.tagName === 'INPUT' && tg.type === 'text') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.over) return this.close();
      if (this.armed) {
        this.armed = null;
        return this.renderTiles();
      }
      return this.menu();
    }
    if (this.over) return;
    if (e.code === 'Space') {
      e.preventDefault();
      void this.toggle();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel != null) {
      const id = this.sel;
      this.sel = null;
      this.edit(() => remove(this.p, id));
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      this.undo(e.shiftKey);
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
      e.preventDefault();
      this.undo(true);
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
      e.preventDefault();
      this.menu('save');
    } else if (e.code === 'KeyL') this.toggleLoop();
    else if (e.key === 'Home') this.setCursor(0, true);
    else if (e.key === '+' || e.key === '=') this.zoom(1);
    else if (e.key === '-') this.zoom(-1);
  }

  // ── окна ──────────────────────────────────────────────────────────────────
  toast(msg: string, ms = 1800): void {
    const t = el('div', 'ms-toast', esc(msg));
    document.body.append(t);
    window.setTimeout(() => (t.style.opacity = '0'), ms);
    window.setTimeout(() => t.remove(), ms + 400);
  }

  open(html: string | HTMLElement): HTMLDivElement {
    this.close();
    const o = el('div', 'ms-over');
    const w = el('div', 'ms-win');
    if (typeof html === 'string') w.innerHTML = html;
    else w.append(html);
    o.append(w);
    o.addEventListener('pointerdown', e => e.target === o && this.close());
    document.body.append(o);
    this.over = o;
    return w;
  }

  close(): void {
    this.over?.remove();
    this.over = null;
  }

  menu(focus?: 'save'): void {
    this.engine.stop();
    const w = this.open('<h2>Пауза</h2>');
    const col = el('div', 'col');
    const btn = (label: string, fn: () => void) => {
      const b = el('button', 'ms-btn', label);
      b.onclick = fn;
      col.append(b);
      return b;
    };
    btn('▶ Продолжить', () => this.close());
    const name = el('input') as HTMLInputElement;
    name.type = 'text';
    name.value = this.p.name;
    name.maxLength = 60;
    name.placeholder = 'Название трека';
    name.onchange = () => {
      this.p.name = name.value.trim() || 'Новый трек';
      this.nameEl.textContent = this.p.name;
      this.saved();
    };
    w.append(el('h3', '', 'Название'), name, el('h3', '', 'Трек'), col);
    btn('Новый пустой трек', () => {
      if (this.p.blocks.length && !confirm('Начать заново? Несохранённое пропадёт (отменить нельзя).')) return;
      this.load(newProject(this.kit, this.p.bpm));
      this.close();
    });
    btn('⤓ Свести в WAV', () => void this.exportWav());
    btn('🔗 Поделиться ссылкой', () => void this.share());
    const demos = el('div', 'col');
    for (const d of DEMOS) {
      const b = el('button', 'ms-btn', `♫ ${esc(d.title)}`);
      b.onclick = () => {
        if (this.p.blocks.length && !confirm('Открыть демо? Текущий трек заменится (сохрани его сначала).')) return;
        this.load(buildDemo(this.kit, d));
        this.close();
      };
      demos.append(b);
    }
    w.append(el('h3', '', 'Демо-миксы'), demos);
    const saves = el('div', 'col');
    const slots = loadSlots();
    for (let i = 0; i < SLOTS; i++) {
      const s = slots[i];
      const row = el('div', '');
      row.style.display = 'flex';
      row.style.gap = '6px';
      const sv = el('button', 'ms-btn', `💾 Ячейка ${i + 1}`);
      sv.style.flex = '1';
      sv.onclick = () => {
        if (s && !confirm(`Записать поверх «${s.name}»?`)) return;
        writeSlot(i, this.p);
        this.toast('Сохранено');
        this.menu();
      };
      const ld = el('button', 'ms-btn', s ? `📂 ${esc(s.name)} <small>${new Date(s.date).toLocaleString('ru')}</small>` : '— пусто —');
      ld.style.flex = '2';
      (ld as HTMLButtonElement).disabled = !s;
      ld.onclick = () => {
        const q = readSlot(i, this.kit);
        if (!q) return this.toast('Не читается');
        this.load(q);
        this.close();
      };
      row.append(sv, ld);
      saves.append(row);
    }
    w.append(el('h3', '', 'Сохранить / загрузить'), saves);
    const out = el('div', 'col');
    const yard = el('button', 'ms-btn', '🏠 Во двор');
    yard.onclick = () => {
      autosave(this.p);
      location.href = '/';
    };
    out.append(yard);
    w.append(el('h3', '', ''), out);
    if (focus === 'save') saves.querySelector('button')?.focus();
  }

  help(): void {
    this.open(`<h2>Как пользоваться</h2>
<p>Музыка собирается из готовых кусочков — <b>сэмплов</b>. Все они в одном темпе и одной тональности, поэтому подходят друг к другу.</p>
<table>
<tr><td>Послушать</td><td>щёлкни по сэмплу внизу</td></tr>
<tr><td>Поставить</td><td>перетащи сэмпл на дорожку — или щёлкни сэмпл, а потом место на дорожке; двойной щелчок — к курсору</td></tr>
<tr><td>Сдвинуть</td><td>перетащи блок; с Ctrl — копия</td></tr>
<tr><td>Убрать</td><td>двойной щелчок по блоку, правая кнопка или Delete</td></tr>
<tr><td>Играть</td><td>пробел или ▶; щелчок по линейке — откуда играть</td></tr>
<tr><td>Петля</td><td>протяни по линейке — кусок играет по кругу; L — вкл/выкл</td></tr>
<tr><td>Звёздочки</td><td>★ ★★ ★★★ ★★★★ — четыре аккорда песни (Am · F · C · G). Ставь их по очереди — получится гармония. Без звёздочек — подходит к любому месту</td></tr>
<tr><td>♪ на сэмпле</td><td>подходит к аккорду, где стоит курсор</td></tr>
<tr><td>M / S</td><td>выключить дорожку / слушать только её; ползунки — громкость и панорама</td></tr>
<tr><td>128 / 140</td><td>темп: 128 — хаус и дрим-хаус, 140 — евродэнс и транс. Трек можно переключать на ходу</td></tr>
<tr><td>Отменить</td><td>Ctrl+Z, вернуть — Ctrl+Y</td></tr>
<tr><td>Меню</td><td>Esc: сохранить, загрузить, демо, свести в WAV, ссылка</td></tr>
</table>`);
  }

  async exportWav(): Promise<void> {
    if (!this.p.blocks.length) return this.toast('Пустой трек — нечего сводить');
    this.toast('Свожу…', 2500);
    const blob = await this.engine.exportWav();
    const a = el('a') as HTMLAnchorElement;
    a.href = URL.createObjectURL(blob);
    a.download = `${this.p.name.replace(/[\\/:*?"<>|]+/g, '_') || 'trek'}.wav`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  async share(): Promise<void> {
    const url = await shareLink(this.p);
    try {
      await navigator.clipboard.writeText(url);
      this.toast('Ссылка скопирована — отправь её другу');
    } catch {
      prompt('Ссылка на трек:', url);
    }
  }
}

async function main(): Promise<void> {
  const host = document.getElementById('music-studio')!;
  const kit = (await (await fetch('/music-studio/dance/kit.json')).json()) as Kit;
  let p = (await fromLink(location.hash, kit)) ?? readAuto(kit);
  const first = !store.get('musicstudio.seen', false);
  if (!p) p = buildDemo(kit, DEMOS[0]);
  const st = new Studio(kit, host, p);
  if (location.hash) history.replaceState(null, '', location.pathname);
  if (first && !new URLSearchParams(location.search).has('thumb')) {
    store.set('musicstudio.seen', true);
    const w = st.open(`<h2>Lavochka Music Studio</h2><p><b style="color:#ff6ac1">Dance With Me!</b> — собери свой танцевальный хит 90-х из готовых сэмплов: евродэнс, хаус, транс, дрим-хаус.</p>
<p>Уже открыт демо-микс — нажми <b>▶</b> или пробел. Потом щёлкай сэмплы внизу и перетаскивай их на дорожки.</p>`);
    const ok = el('button', 'ms-btn', '▶ Поехали');
    ok.onclick = () => {
      st.close();
      void st.toggle();
    };
    const hb = el('button', 'ms-btn', '? Как пользоваться');
    hb.onclick = () => st.help();
    const row = el('div', 'col');
    row.append(ok, hb);
    w.append(row);
  }
  // для проверки из консоли и тестов в браузере
  (window as unknown as { studio: Studio }).studio = st;
}

main().catch(e => {
  document.body.textContent = `Студия не запустилась: ${e}`;
  console.error(e);
});
