/* Экран игры: правила, продолжение, настройка мест и вариантов правил, запуск. */
import { Sound } from './audio';
import { openRecords } from './records-ui';
import { allowedCounts, matchPreset, optionsEditor } from './optsui';
import { openRules, defaultOptions } from './rules';
import { dropSave, hostGame, loadSave, startLocal } from './session';
import { settings, store } from './settings';
import type { Options, SeatKind, SeatSpec } from './types';
import { mountScreen, showScreen } from './ui';
import { esc, h, plural } from './util';
import type { GameModule } from './view';

interface SeatDraft {
  kind: SeatKind | 'off';
  level: number;
  name: string;
}

interface SetupDraft {
  count: number;
  seats: Record<number, SeatDraft>;
  options: Options;
  preset: string | null;
}

const KIND_LABEL: Record<string, string> = { human: 'Человек', bot: 'Бот', remote: 'Сеть' };

export interface HomeOpts {
  /** Пользователь сменил вариант правил (для адреса в строке браузера). */
  onPreset?: (preset: string | null) => void;
  /** Открыть сразу правила (адрес /<игра>/pravila/). */
  rules?: boolean;
  /** Окно правил открыли или закрыли (для адреса в строке браузера). */
  onRules?: (open: boolean) => void;
  /** Вернуться в незаконченную партию (обновили страницу посреди партии). */
  resume?: boolean;
  /** Своя кнопка в шапке экрана (лайк — её даёт сайт). */
  topExtra?: HTMLElement;
}

export function openHome(mod: GameModule, onBack: () => void, fixed?: Record<string, unknown>, o: HomeOpts = {}) {
  const def = mod.def;
  const seatsFor = (n: number) => (def.seatsFor ? def.seatsFor(n) : Array.from({ length: n }, (_, i) => i));
  const allSeats = seatsFor(def.players.max);
  const midLevel = Math.floor((def.bot.levels.length - 1) / 2);

  const saved = store.get<SetupDraft | null>('setup.' + def.id, null);
  const draft: SetupDraft = saved ?? { count: def.players.default, seats: {}, options: defaultOptions(def), preset: def.presets?.[0]?.id ?? null };
  draft.options = Object.assign(defaultOptions(def), draft.options);
  for (const s of allSeats) draft.seats[s] ??= { kind: 'off', level: midLevel, name: '' };
  // вход по ярлыку: варианты заданы карточкой, подсвечиваем подходящий пресет
  if (fixed) {
    Object.assign(draft.options, fixed);
    draft.preset = def.presets?.find((p) => Object.entries(fixed).every(([k, v]) => p.options[k] === v))?.id ?? null;
  }
  const persist = () => store.set('setup.' + def.id, draft);
  /** Экран собран: дальше смена варианта — дело рук пользователя. */
  let ready = false;

  const el = h(`<section class="home-screen">
    <header class="home-top">
      <button class="btn back" data-a="back">← Во двор</button>
      <div class="home-title"><h1>${esc(def.title)}</h1><p>${def.rules.goal}</p></div>
      <div class="home-top-btns">${def.records ? '<button class="btn" data-a="records">🏆 Рекорды</button>' : ''}<button class="btn" data-a="rules">Правила и показ</button></div>
    </header>
    <div class="home-cols">
      <div class="sheet home-card">
        <div class="resume" hidden></div>
        <div class="home-extra" hidden></div>
        <h2>Новая партия</h2>
        <div class="row count-row"><span class="lbl">Игроков:</span><div class="seg count-seg"></div><small class="count-hint" hidden></small></div>
        <div class="seat-rows"></div>
        <div class="prefs"></div>
        <p class="hint">«Человек» — игра за этим экраном (по очереди). «Сеть» — место для друга: он подключится по коду комнаты.</p>
        <div class="row buttons"><button class="btn primary big" data-a="start">Начать</button></div>
        <p class="err"></p>
      </div>
      <div class="sheet home-card opts-card" hidden>
        <h2>Правила партии</h2>
        <div class="presets seg-wrap"></div>
        <div class="opts"></div>
      </div>
    </div>
  </section>`);
  if (o.topExtra) el.querySelector('.home-top-btns')!.prepend(o.topExtra);
  mountScreen('home', el);
  const q = <T extends HTMLElement = HTMLElement>(s: string) => el.querySelector(s) as T;
  q('[data-a=back]').onclick = () => {
    Sound.ui();
    onBack();
  };
  const showRules = () => {
    const m = openRules(mod);
    o.onRules?.(true);
    new MutationObserver((_r, obs) => {
      if (m.el.isConnected) return;
      obs.disconnect();
      o.onRules?.(false);
    }).observe(document.body, { childList: true });
  };
  q('[data-a=rules]').onclick = showRules;
  const recBtn = el.querySelector('[data-a=records]') as HTMLElement | null;
  if (recBtn && def.records) {
    const rec = def.records;
    recBtn.onclick = () => {
      Sound.ui();
      const t = rec.table(draft.options);
      openRecords(def.id, def.title, { table: t?.id, label: t?.label, columns: rec.columns });
    };
  }

  // ---------- продолжение сохранённой партии
  const resume = q('.resume');
  const snap = mod.ownSaves ? null : loadSave(def.id);
  if (snap) {
    resume.hidden = false;
    resume.innerHTML = `<div>Есть незаконченная партия (ход ${snap.seq}).</div><div class="row"><button class="btn small" data-a="drop">Забыть</button><button class="btn primary" data-a="cont">Продолжить</button></div>`;
    (resume.querySelector('[data-a=cont]') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      startLocal(mod, snap.seats, snap.options, snap);
    };
    (resume.querySelector('[data-a=drop]') as HTMLButtonElement).onclick = () => {
      dropSave(def.id);
      resume.hidden = true;
    };
  }

  // ---------- число игроков и места
  const seg = q('.count-seg');

  /** Допустимые числа игроков при текущих настройках: игра может сузить список («Шайба» — 2, 4, 6). */
  const counts = () => allowedCounts(def, draft.options);

  /** Пересобрать кнопки числа игроков; выбранное число, если оно больше не годится, подтянуть к подходящему. */
  function renderCounts() {
    const list = counts();
    seg.replaceChildren();
    for (const n of list) {
      const b = h<HTMLButtonElement>(`<button data-n="${n}">${n}</button>`);
      b.onclick = () => applyCount(n);
      b.classList.toggle('on', n === draft.count);
      seg.appendChild(b);
    }
    q('.count-row').hidden = list.length === 1;
    const hint = def.countsHint?.(draft.options);
    const hb = q('.count-hint');
    hb.textContent = hint ?? '';
    hb.hidden = !hint;
    if (!list.includes(draft.count)) applyCount(list.find((n) => n >= draft.count) ?? list[list.length - 1]);
    else renderSeats();
  }

  function applyCount(n: number) {
    draft.count = n;
    const active = seatsFor(n);
    const anyHuman = allSeats.some((s) => draft.seats[s].kind === 'human' && active.includes(s));
    for (const s of allSeats) {
      const st = draft.seats[s];
      if (!active.includes(s)) st.kind = 'off';
      else if (st.kind === 'off') st.kind = !anyHuman && s === (def.defaultHuman != null && active.includes(def.defaultHuman) ? def.defaultHuman : active[0]) ? 'human' : 'bot';
    }
    if (!active.some((s) => draft.seats[s].kind === 'human' || draft.seats[s].kind === 'remote')) draft.seats[def.defaultHuman != null && active.includes(def.defaultHuman) ? def.defaultHuman : active[0]].kind = 'human';
    renderSeats();
  }

  function renderSeats() {
    const active = seatsFor(draft.count);
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.n! === draft.count));
    const box = q('.seat-rows');
    box.innerHTML = '';
    for (const s of active) {
      const st = draft.seats[s];
      const look = def.seats[s];
      const row = h(`<div class="seat-row">
        <span class="chip" style="--c:${look.color};--d:${look.dark}"></span>
        <span class="seat-name">${esc(look.name)}</span>
        <select class="kind">${['human', 'bot', 'remote'].map((k) => `<option value="${k}">${KIND_LABEL[k]}</option>`).join('')}</select>
        <select class="level" ${st.kind === 'bot' ? '' : 'hidden'}>${def.bot.levels.map((l, i) => `<option value="${i}">${esc(l)}</option>`).join('')}</select>
        <input class="pname" maxlength="16" placeholder="${esc(look.name)}" ${st.kind === 'human' ? '' : 'hidden'}>
        <span class="remote-note" ${st.kind === 'remote' ? '' : 'hidden'}>имя задаст друг</span>
      </div>`);
      const kind = row.querySelector('.kind') as HTMLSelectElement;
      kind.value = st.kind === 'off' ? 'bot' : st.kind;
      kind.onchange = () => {
        st.kind = kind.value as SeatKind;
        persist();
        renderSeats();
      };
      const lvl = row.querySelector('.level') as HTMLSelectElement;
      lvl.value = String(st.level);
      lvl.onchange = () => {
        st.level = +lvl.value;
        persist();
      };
      const nm = row.querySelector('.pname') as HTMLInputElement;
      nm.value = st.name;
      nm.oninput = () => {
        st.name = nm.value.trim();
        persist();
      };
      box.appendChild(row);
    }
    const remote = active.filter((s) => draft.seats[s].kind === 'remote').length;
    q('[data-a=start]').textContent = remote ? `Создать комнату (${remote} ${plural(remote, 'место', 'места', 'мест')} по сети)` : 'Начать';
    q('.err').textContent = '';
    persist();
  }

  // ---------- вид на этом экране (у каждого игрока свой)
  const prefsBox = q('.prefs');
  const prefRows: [HTMLElement, (o: Options) => boolean][] = [];
  for (const p of mod.prefs || []) {
    const row = h(`<div class="row pref-row"><span class="lbl">${esc(p.label)}:</span><div class="seg"></div>${p.hint ? `<small class="opt-hint">${esc(p.hint)}</small>` : ''}</div>`);
    const box = row.querySelector('.seg') as HTMLElement;
    const mark = () => {
      const cur = store.get<string>(p.key, p.default);
      box.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === cur));
    };
    for (const c of p.choices) {
      const b = h<HTMLButtonElement>(`<button data-v="${esc(c.value)}">${esc(c.label)}</button>`);
      b.onclick = () => {
        store.set(p.key, c.value);
        mark();
      };
      box.appendChild(b);
    }
    mark();
    if (p.showIf) prefRows.push([row, p.showIf]);
    prefsBox.appendChild(row);
  }

  // ---------- варианты правил
  const optsCard = q('.opts-card');
  if (def.options?.length) {
    optsCard.hidden = false;
    optionsEditor(def, draft.options, q('.presets'), q('.opts'), renderOpts);
  }

  function renderOpts() {
    const was = draft.preset;
    draft.preset = matchPreset(def, draft.options);
    for (const [row, show] of prefRows) row.hidden = !show(draft.options);
    if (ready && draft.preset !== was) o.onPreset?.(draft.preset);
    persist();
    renderCounts();
  }

  // ---------- запуск
  q('[data-a=start]').onclick = () => launch({ ...draft.options });
  function launch(options: Options) {
    Sound.unlock();
    const seats: SeatSpec[] = seatsFor(draft.count).map((s) => {
      const st = draft.seats[s];
      const look = def.seats[s];
      const kind = st.kind === 'off' ? 'bot' : st.kind;
      const name = kind === 'bot' ? `${look.name} (бот)` : kind === 'human' ? st.name || (onlyHuman() ? settings.name : '') || look.name : '';
      return { seat: s, kind, level: st.level, name };
    });
    if (seats.some((s) => s.kind === 'remote')) void hostGame(mod, seats, options);
    else {
      if (!mod.ownSaves) dropSave(def.id);
      startLocal(mod, seats, options);
    }
  }
  if (mod.home) {
    const box = q('.home-extra');
    box.hidden = false;
    mod.home(box, launch);
  }
  const onlyHuman = () => seatsFor(draft.count).filter((s) => draft.seats[s].kind === 'human').length === 1;

  if (!saved) applyCount(draft.count);
  else renderSeats();
  renderOpts();
  renderCounts();
  showScreen('home');
  ready = true;
  if (o.resume && snap) startLocal(mod, snap.seats, snap.options, snap);
  else if (o.rules) showRules();
}
