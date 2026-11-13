// Lavochka Music Studio «Dance With Me!» — секвенсор из готовых сэмплов по духу Dance eJay (docs/music-studio/DESIGN.md).
// Отдельная страница /music-studio.html: дорожки сверху, библиотека снизу, перетаскивание сэмплов на сетку тактов.
import './style.css';
import { store } from '../core/settings';
import { DEMOS, buildDemo } from './demo';
import { Engine } from './engine';
import {
  ECHO_TIMES, GROOVE_PRESETS, GROOVE_ROWS, KitIndex, MAX_GROOVES, STEPS, TRACKS, applyPreset, canPlace, chordAt, cycleStep,
  deleteGroove, fxOn, grooveEmpty, move, newFx, newGroove, newProject, nextFree, nextGrooveId, parseGroove, parseProject, place,
  remove, saveGroove, serialize, setBars, setGrooveBars, songEnd, type Block, type Groove, type Group, type Kit, type KitSample,
  type Project, type Track,
} from './project';
import { setUiSound, ui, uiSoundOn, type UiSound } from './uisound';
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
  groove: { title: 'Мои грувы', color: '#ffb58a' },
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
  sndBtn = el('button', 'ms-btn', '');
  /** Когда прозвучал последний «смысловой» звук — чтобы общий щелчок кнопки его не перекрывал. */
  lastSnd = 0;

  constructor(readonly kit: Kit, host: HTMLElement, p: Project) {
    this.p = p;
    this.group = kit.groups[0];
    this.engine = new Engine(kit, p);
    this.ix = this.engine.ix; // один указатель сэмплов на студию и звук (в нём и грувы проекта)
    this.engine.onStop = () => this.playBtn.classList.remove('on');
    host.append(this.root);
    this.root.id = 'ms';
    this.build();
    this.renderAll();
    requestAnimationFrame(() => this.frame());
    window.addEventListener('keydown', e => this.key(e));
    // общий щелчок кнопок (и в окнах): после onclick кнопки — если она сама не прозвучала
    document.addEventListener('click', e => {
      const b = (e.target as Element | null)?.closest?.('button');
      if (!b || performance.now() - this.lastSnd < 80) return;
      ui(b.classList.contains('ms-tab') ? 'tab' : b.closest('.ms-head') ? 'toggle' : 'click');
    });
    window.addEventListener('beforeunload', () => autosave(this.p));
    // панель эффектов закрывается щелчком мимо неё
    document.addEventListener('pointerdown', e => {
      if (this.fxPop && !(e.target as Element | null)?.closest?.('.ms-head .fx')) this.closeFx();
    });
  }

  // ── каркас ────────────────────────────────────────────────────────────────
  build(): void {
    const top = el('div', 'ms-top');
    const logo = el('div', 'ms-logo', '<img src="/music-studio/ui/logo.webp" alt="Lavochka Music Studio — Dance With Me!" width="107" height="48">');
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
    this.sndBtn.onclick = () => {
      setUiSound(!uiSoundOn());
      this.renderSnd();
    };
    this.renderSnd();
    const help = el('button', 'ms-btn', '?');
    help.title = 'Как пользоваться';
    help.onclick = () => this.help();
    const groove = el('button', 'ms-btn groove', '🥁 Грув');
    groove.title = 'Groove Generator — собрать свой ритм на 16 шагов';
    groove.onclick = () => this.grooveEditor();
    top.append(logo, tr, this.lcd, this.tempo, zoom, groove, this.nameEl, el('div', 'ms-spacer'), this.sndBtn, menu, help);

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

  renderSnd(): void {
    this.sndBtn.textContent = uiSoundOn() ? '🔊' : '🔇';
    this.sndBtn.title = `Звуки кнопок: ${uiSoundOn() ? 'вкл' : 'выкл'} (на музыку трека не влияет)`;
    this.sndBtn.classList.toggle('off', !uiSoundOn());
  }

  snd(s: UiSound): void {
    ui(s);
    this.lastSnd = performance.now();
  }

  /** Поставить сэмпл со звуком «положил» (или «нельзя»). */
  put(track: number, bar: number, id: string): void {
    if (!canPlace(this.p, this.ix, track, bar, id)) return this.snd('bad');
    this.snd('drop');
    this.edit(() => place(this.p, this.ix, track, bar, id));
  }

  drop(id: number): void {
    this.snd('del');
    this.edit(() => remove(this.p, id));
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
      const fx = el('button', 'fx' + (fxOn(t.fx) ? ' on' : ''), 'FX');
      fx.title = 'Эффекты дорожки: эхо, реверб, фильтр';
      fx.onclick = e => {
        e.stopPropagation();
        this.fxPanel(i, fx);
      };
      h.append(n, m, s, vol, pan, fx);
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
    d.addEventListener('dblclick', () => this.drop(b.id));
    d.addEventListener('contextmenu', e => {
      e.preventDefault();
      this.drop(b.id);
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
    const gt = el('button', 'ms-tab' + (this.group === 'groove' ? ' on' : ''), `🥁 ${GROUP.groove.title} <small>${this.p.grooves.length}</small>`);
    gt.style.background = GROUP.groove.color;
    gt.onclick = () => {
      this.group = 'groove';
      this.renderTabs();
      this.renderTiles();
    };
    this.tabs.append(gt);
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
    const list = this.group === 'groove' ? [...this.ix.grooves.values()] : this.kit.samples.filter(s => s.group === this.group);
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
      if (s.groove) {
        const ed = el('button', 'ms-tile-edit', '✎');
        ed.title = 'Изменить грув';
        ed.addEventListener('pointerdown', e => e.stopPropagation());
        ed.addEventListener('dblclick', e => e.stopPropagation());
        ed.onclick = () => this.grooveEditor(s.groove);
        t.append(ed);
      }
      this.tiles.append(t);
    }
    if (this.group === 'groove') {
      const add = el('div', 'ms-tile add', '＋ Новый грув <small>Groove Generator: ритм на 16 шагов</small>');
      add.onclick = () => this.grooveEditor();
      this.tiles.append(add);
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
    this.ix.useProject(this.p);
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
    this.ix.useProject(this.p);
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
    this.grooveView?.(this.engine.loopStep());
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
        this.snd('pick');
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
      else this.snd('bad');
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
    this.drag(e, s, 0, (track, bar) => this.put(track, bar, s.id), undefined, () => {
      this.armed = this.armed?.id === s.id ? null : s;
      this.snd(this.armed ? 'pick' : 'click');
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
    this.drag(e, s, grab, (track, bar, cp) => {
      if (cp) return this.put(track, bar, s.id);
      if (!canPlace(this.p, this.ix, track, bar, s.id, b.id)) return this.snd('bad');
      this.snd('drop');
      this.edit(() => move(this.p, this.ix, b.id, track, bar));
    }, b.id, () => {
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
      if (!canPlace(this.p, this.ix, track, h.bar, s.id)) {
        this.snd('bad');
        return this.toast('Здесь занято — выбери свободное место');
      }
      return this.put(track, h.bar, s.id);
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
      if (canPlace(this.p, this.ix, t, this.cursor, s.id)) return this.put(t, this.cursor, s.id);
    }
    const t = this.p.blocks.length ? this.p.blocks[this.p.blocks.length - 1].track : 0;
    const bar = nextFree(this.p, this.ix, t, this.cursor, s.id);
    if (bar != null) this.put(t, bar, s.id);
    else this.snd('bad');
  }

  key(e: KeyboardEvent): void {
    const tg = e.target as HTMLInputElement | null;
    if (tg?.tagName === 'INPUT' && tg.type === 'text') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.fxPop) return this.closeFx();
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
      this.drop(id);
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
    this.toastEl(msg, ms);
  }

  toastEl(msg: string, ms = 1800): HTMLDivElement {
    const t = el('div', 'ms-toast', esc(msg));
    document.body.append(t);
    window.setTimeout(() => (t.style.opacity = '0'), ms);
    window.setTimeout(() => t.remove(), ms + 400);
    return t;
  }

  open(html: string | HTMLElement): HTMLDivElement {
    this.closeFx();
    this.runOnClose();
    if (this.over) this.over.remove();
    this.over = null;
    this.snd('open');
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
    if (this.over) this.snd('close');
    this.runOnClose();
    this.over?.remove();
    this.over = null;
  }

  runOnClose(): void {
    const f = this.onClose;
    this.onClose = null;
    f?.();
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
    btn('⤓ Свести в OGG', () => void this.exportSong());
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
    const sb = el('button', 'ms-btn', '');
    const sbText = () => (sb.textContent = `${uiSoundOn() ? '🔊' : '🔇'} Звуки кнопок: ${uiSoundOn() ? 'вкл' : 'выкл'}`);
    sbText();
    sb.onclick = () => {
      setUiSound(!uiSoundOn());
      sbText();
      this.renderSnd();
    };
    const sc = el('div', 'col');
    sc.append(sb);
    w.append(el('h3', '', 'Звук'), sc);
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
<tr><td>FX</td><td>эффекты дорожки: эхо в такт песне, реверб (зал), фильтр — влево глушит верх, вправо — низ. Крути прямо во время игры</td></tr>
<tr><td>🥁 Грув</td><td>Groove Generator: расставь удары бочки, хлопка, хэтов… на 16 шагов (щелчок — удар, ещё раз — акцент, ещё — пусто) или возьми готовый рисунок. Грув ложится в библиотеку «Мои грувы» и ставится на дорожку как сэмпл</td></tr>
<tr><td>128 / 140</td><td>темп: 128 — хаус и дрим-хаус, 140 — евродэнс и транс. Трек можно переключать на ходу</td></tr>
<tr><td>Отменить</td><td>Ctrl+Z, вернуть — Ctrl+Y</td></tr>
<tr><td>Меню</td><td>Esc: сохранить, загрузить, демо, свести в OGG, ссылка</td></tr>
<tr><td>🔊</td><td>тихие звуки кнопок — вкл/выкл; на музыку трека и сведение не влияют</td></tr>
</table>`);
  }

  async exportSong(): Promise<void> {
    if (!this.p.blocks.length) return this.toast('Пустой трек — нечего сводить');
    if (this.exporting) return;
    this.exporting = true;
    const t = this.toastEl('Свожу… 0 %', 600000);
    try {
      const { blob, ext } = await this.engine.exportSong(k => (t.textContent = `Свожу… ${Math.round(k * 100)} %`));
      const a = el('a') as HTMLAnchorElement;
      a.href = URL.createObjectURL(blob);
      a.download = `${this.p.name.replace(/[\\/:*?"<>|]+/g, '_') || 'trek'}.${ext}`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      this.lastExport = blob;
      this.toast(`Готово: ${a.download} · ${(blob.size / 1048576).toFixed(1).replace('.', ',')} МБ${ext === 'wav' ? ' (браузер не умеет OGG — сведено в WAV)' : ''}`, 3500);
    } catch (e) {
      console.error(e);
      this.toast('Свести не получилось');
    } finally {
      t.remove();
      this.exporting = false;
    }
  }

  exporting = false;
  /** Последнее сведение — для проверки из консоли. */
  lastExport: Blob | null = null;

  // ── эффекты дорожки ───────────────────────────────────────────────────────
  fxPop: HTMLDivElement | null = null;

  closeFx(): void {
    if (this.fxPop) this.snd('close');
    this.fxPop?.remove();
    this.fxPop = null;
  }

  fxPanel(i: number, btn: HTMLElement): void {
    const wasOpen = this.fxPop?.dataset.track === String(i);
    this.closeFx();
    if (wasOpen) return;
    this.snd('open');
    const t: Track = this.p.tracks[i];
    const pop = el('div', 'ms-fx');
    pop.dataset.track = String(i);
    pop.addEventListener('pointerdown', e => e.stopPropagation());
    const lit = () => btn.classList.toggle('on', fxOn(t.fx));
    const changed = () => {
      lit();
      this.engine.mix();
    };
    const knob = (label: string, min: number, max: number, get: () => number, put: (v: number) => void, hint: string, ends?: [string, string]) => {
      const row = el('label', 'knob');
      const r = el('input') as HTMLInputElement;
      r.type = 'range';
      r.min = String(min);
      r.max = String(max);
      r.step = '0.01';
      r.value = String(get());
      r.title = `${hint} (двойной щелчок — выкл)`;
      r.oninput = () => {
        put(+r.value);
        changed();
      };
      r.onchange = () => this.saved();
      r.ondblclick = () => {
        put(0);
        r.value = '0';
        changed();
        this.saved();
      };
      row.append(el('span', '', label));
      if (ends) {
        const w = el('div', 'ends');
        w.append(el('small', '', ends[0]), r, el('small', '', ends[1]));
        row.append(w);
      } else row.append(r);
      return row;
    };
    const times = el('div', 'times');
    const renderTimes = () => {
      times.innerHTML = '';
      ECHO_TIMES.forEach((et, k) => {
        const b = el('button', 'ms-btn' + (t.fx.time === k ? ' on' : ''), et.label);
        b.title = `Эхо через ${et.label} такта`;
        b.onclick = () => {
          t.fx.time = k;
          renderTimes();
          changed();
          this.saved();
        };
        times.append(b);
      });
    };
    renderTimes();
    const reset = el('button', 'ms-btn', 'Сбросить');
    reset.onclick = () => {
      t.fx = newFx();
      changed();
      this.saved();
      this.fxPop?.remove();
      this.fxPop = null;
      this.fxPanel(i, btn);
    };
    pop.append(
      el('h4', '', `Дорожка ${i + 1} · эффекты`),
      knob('Эхо', 0, 1, () => t.fx.echo, v => (t.fx.echo = v), 'Сколько эха (и как долго оно тянется)'),
      times,
      knob('Реверб', 0, 1, () => t.fx.reverb, v => (t.fx.reverb = v), 'Зал: сколько звука уходит в реверберацию'),
      knob('Фильтр', -1, 1, () => t.fx.filter, v => (t.fx.filter = Math.abs(v) < 0.03 ? 0 : v),
        'Влево — глушит верх (НЧ-фильтр), вправо — срезает низ (ВЧ-фильтр); в середине — выкл', ['НЧ', 'ВЧ']),
      reset,
    );
    document.body.append(pop);
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left))}px`;
    pop.style.top = `${r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
    this.fxPop = pop;
  }

  // ── Groove Generator ──────────────────────────────────────────────────────
  grooveView: ((step: number | null) => void) | null = null;
  onClose: (() => void) | null = null;

  grooveEditor(src?: Groove): void {
    this.engine.stop();
    this.closeFx();
    if (!src && this.p.grooves.length >= MAX_GROOVES) return this.toast(`Грувов уже ${MAX_GROOVES} — убери ненужные`);
    const isNew = !src;
    const g: Groove = src ? parseGroove(JSON.parse(JSON.stringify(src)))! : newGroove(nextGrooveId(this.p), `Грув ${this.p.grooves.length + 1}`);
    if (isNew) applyPreset(g, 'house');
    let looping = false;
    const w = this.open('<h2>Groove Generator</h2>');
    w.classList.add('wide', 'ms-gg');
    this.onClose = () => {
      this.engine.stopPreview();
      this.grooveView = null;
    };
    const top = el('div', 'gg-top');
    const name = el('input') as HTMLInputElement;
    name.type = 'text';
    name.value = g.name;
    name.maxLength = 40;
    name.oninput = () => (g.name = name.value.trim() || 'Грув');
    const play = el('button', 'ms-btn play', '▶');
    play.title = 'Слушать грув по кругу';
    const refresh = () => {
      if (looping) void this.engine.loopGroove(g);
    };
    play.onclick = () => {
      looping = !looping;
      play.classList.toggle('on', looping);
      play.textContent = looping ? '⏹' : '▶';
      if (looping) void this.engine.loopGroove(g);
      else this.engine.stopPreview();
    };
    const len = el('div', 'ms-group');
    const preset = el('select') as HTMLSelectElement;
    const swing = el('input') as HTMLInputElement;
    const grid = el('div', 'gg-grid');
    const cells: HTMLButtonElement[][] = [];
    const renderGrid = () => {
      grid.innerHTML = '';
      cells.length = 0;
      grid.style.setProperty('--steps', String(g.bars * STEPS));
      GROOVE_ROWS.forEach((row, ri) => {
        const r = g.rows[ri];
        const sel = el('select') as HTMLSelectElement;
        sel.title = row.title;
        for (const h of row.hits) {
          const o = el('option', '', esc(h.name)) as HTMLOptionElement;
          o.value = h.id;
          o.selected = h.id === r.sound;
          sel.append(o);
        }
        sel.onchange = () => {
          r.sound = sel.value;
          if (looping) refresh();
          else void this.engine.previewHit(r.sound);
        };
        const lab = el('div', 'gg-lab');
        lab.append(el('span', '', row.title), sel);
        grid.append(lab);
        const line: HTMLButtonElement[] = [];
        for (let k = 0; k < g.bars * STEPS; k++) {
          const c = el('button', 'gg-step' + (k % 4 === 0 ? ' beat' : '') + (Math.floor(k / 4) % 2 ? ' odd' : '')) as HTMLButtonElement;
          const paint = () => {
            c.classList.toggle('on', r.pat[k] !== '.');
            c.classList.toggle('acc', r.pat[k] === 'X');
          };
          paint();
          c.onclick = () => {
            cycleStep(g, ri, k);
            paint();
            this.snd(r.pat[k] === '.' ? 'click' : 'toggle');
            if (looping) refresh();
            else if (r.pat[k] !== '.') void this.engine.previewHit(r.sound, r.pat[k] === 'X');
          };
          line.push(c);
          grid.append(c);
        }
        cells.push(line);
      });
    };
    const renderLen = () => {
      len.innerHTML = '';
      for (const b of [1, 2] as const) {
        const x = el('button', 'ms-btn' + (g.bars === b ? ' on' : ''), b === 1 ? '1 такт' : '2 такта');
        x.onclick = () => {
          setGrooveBars(g, b);
          renderLen();
          renderGrid();
          refresh();
        };
        len.append(x);
      }
    };
    preset.append(el('option', '', 'Готовый рисунок…'));
    for (const pr of GROOVE_PRESETS) {
      const o = el('option', '', esc(pr.title)) as HTMLOptionElement;
      o.value = pr.id;
      preset.append(o);
    }
    preset.onchange = () => {
      applyPreset(g, preset.value);
      preset.selectedIndex = 0;
      swing.value = String(g.swing);
      renderGrid();
      refresh();
    };
    swing.type = 'range';
    swing.min = '0';
    swing.max = '0.5';
    swing.step = '0.01';
    swing.value = String(g.swing);
    swing.title = 'Свинг: запаздывание каждой второй шестнадцатой';
    swing.oninput = () => {
      g.swing = +swing.value;
      refresh();
    };
    const sw = el('label', 'gg-swing', 'Свинг');
    sw.append(swing);
    const clear = el('button', 'ms-btn', 'Очистить');
    clear.onclick = () => {
      for (const r of g.rows) r.pat = '.'.repeat(g.bars * STEPS);
      renderGrid();
      refresh();
    };
    top.append(play, name, len, preset, sw, clear);
    renderLen();
    renderGrid();
    this.grooveView = (step: number | null) => {
      for (const line of cells) line.forEach((c, k) => c.classList.toggle('now', k === step));
    };
    const foot = el('div', 'gg-foot');
    const commit = (andPlace: boolean) => {
      if (grooveEmpty(g)) return this.toast('Грув пустой — поставь хоть один удар');
      let dropped = 0;
      this.edit(() => (dropped = saveGroove(this.p, this.ix, g)));
      this.group = 'groove';
      this.renderTabs();
      this.renderTiles();
      this.close();
      if (dropped) this.toast(`Грув стал длиннее — блоков не поместилось: ${dropped}, они убраны (Ctrl+Z — вернуть)`, 3500);
      else this.toast(isNew ? `«${g.name}» — в библиотеке «Мои грувы»` : `«${g.name}» сохранён`);
      if (andPlace) this.quickPlace(this.ix.get(g.id)!);
    };
    const save = el('button', 'ms-btn', isNew ? '💾 В библиотеку' : '💾 Сохранить');
    save.onclick = () => commit(false);
    const put = el('button', 'ms-btn', '⤵ И на дорожку');
    put.title = 'Сохранить в библиотеку и поставить у курсора';
    put.onclick = () => commit(true);
    foot.append(save, put);
    if (!isNew) {
      const copyB = el('button', 'ms-btn', '⧉ Копией');
      copyB.title = 'Сохранить как новый грув, этот не трогать';
      copyB.onclick = () => {
        if (this.p.grooves.length >= MAX_GROOVES) return this.toast(`Грувов уже ${MAX_GROOVES}`);
        g.id = nextGrooveId(this.p);
        g.name = `${g.name} (копия)`.slice(0, 40);
        commit(false);
      };
      const del = el('button', 'ms-btn danger', '🗑 Убрать');
      del.title = 'Убрать грув из библиотеки (и с дорожек)';
      del.onclick = () => {
        const used = this.p.blocks.filter(b => b.sample === g.id).length;
        if (used && !confirm(`Грув стоит на дорожках (${used}). Убрать его вместе с блоками?`)) return;
        this.edit(() => deleteGroove(this.p, this.ix, g.id));
        this.renderTabs();
        this.renderTiles();
        this.close();
      };
      foot.append(copyB, del);
    }
    const cancel = el('button', 'ms-btn', 'Закрыть');
    cancel.onclick = () => this.close();
    foot.append(cancel);
    w.append(top, grid, el('p', 'gg-hint', 'Щелчок по клетке — удар, ещё раз — акцент (громче), ещё раз — пусто. Слева в строке — выбор звука. Темп — как у трека.'), foot);
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
