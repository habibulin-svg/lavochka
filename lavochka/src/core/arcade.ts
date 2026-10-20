/* Аркады — игры в реальном времени для одного (электроника, Brick Game, аркады волны 6).
 * У них нет пошагового стола: модуль сам рисует устройство и крутит игру, а этот экран даёт рамку как у стола —
 * игра слева, карточка справа: меню, звук, «Старт»/«Пауза», режимы, управление, рекорды (свои и общие на сервере). */
import { Sound } from './audio';
import { SCORE_COLUMNS } from './records';
import { postClaim, recordsBox } from './records-ui';
import { saveSettings, settings, store } from './settings';
import { openSettings } from './settings-ui';
import { mountScreen, modal, showScreen } from './ui';
import { esc, h } from './util';
import { countPlay } from '../site/stats';

export interface ArcadeMode {
  id: string;
  label: string;
  hint?: string;
}

/** Запущенная игра: модуль сам рисует и слушает клавиши, экран только убирает её. */
export interface ArcadeInstance {
  destroy(): void;
  /** Заморозить игру (кнопка «Пауза», меню, вкладка в фоне). */
  pause?(on: boolean): void;
  /** Кнопка «Старт» из карточки (id — из ArcadeModule.starts). */
  launch?(id: string): void;
  /** Игра открылась с сохранения посреди партии — рамка сразу ставит паузу. */
  resumed?: boolean;
}

export interface ArcadeOpts {
  mode: string;
  /** Конец игры: счёт уходит в рекорды. */
  onScore(score: number): void;
  /** Место в карточке справа под кнопками: подпись прибора, «Сброс» и т. п. (нет в режиме превью). */
  panel?: HTMLElement;
}

export interface ArcadeModule {
  kind: 'arcade';
  id: string;
  title: string;
  /** Пара слов об игре (HTML). */
  about: string;
  /** Как управлять (HTML). */
  controls: string;
  modes: ArcadeMode[];
  /** Режимы — длинный список (игры серии), а не переключатель. */
  list?: boolean;
  /** Кнопки «Старт» в карточке (у «Электроники» — «Игра А» и «Игра Б»); без них — только «Пауза», если игра её умеет. */
  starts?: { id: string; label: string }[];
  /** Счёт не известен (эмуляция) — таблицу рекордов не показываем. */
  noRecords?: boolean;
  mount(root: HTMLElement, opts: ArcadeOpts): ArcadeInstance;
}

export const isArcade = (m: unknown): m is ArcadeModule => !!m && (m as ArcadeModule).kind === 'arcade';

/** Открыть аркаду; возвращает «остановить» — для ухода с экрана мимо меню (кнопка «назад» браузера). */
/** `at.mode` — открыть сразу эту игру серии (адрес страницы игры); `at.onMode` — игрок выбрал другую. */
export function openArcade(mod: ArcadeModule, onBack: () => void, at: { mode?: string; onMode?: (mode: string) => void } = {}): () => void {
  let mode = at.mode ?? store.get<string>(`arcade.${mod.id}.mode`, mod.modes[0]?.id ?? 'A');
  if (!mod.modes.some((m) => m.id === mode)) mode = mod.modes[0]?.id ?? 'A';
  let inst: ArcadeInstance | null = null;
  let paused = false;

  const el = h(`<section class="arcade-screen arcade--${mod.id}">
    <div class="arcade-main"><div class="arcade-stage"></div></div>
    <aside class="table-panel sheet arcade-side">
      <div class="panel-top">
        <button class="icon-btn" data-a="menu" title="Меню">☰</button>
        <div class="panel-title">${esc(mod.title)}</div>
        <button class="icon-btn" data-a="sound" title="Звук"></button>
      </div>
      <div class="arcade-run"></div>
      <div class="arcade-panel"></div>
      <div class="arcade-scroll">
        ${mod.list ? '<h3>Игры</h3>' : ''}<div class="seg arcade-modes${mod.list ? ' list' : ''}${mod.modes.length < 8 ? ' short' : ''}"></div>
        <h3>Управление</h3><div class="arcade-controls">${mod.controls}</div>
        ${mod.noRecords ? '' : '<h3>Рекорды</h3><div class="arcade-recs"></div>'}
      </div>
    </aside>
  </section>`);
  mountScreen('arcade', el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const stage = q('.arcade-stage');
  const panel = q('.arcade-panel');
  const run = q('.arcade-run');
  const recs = el.querySelector('.arcade-recs') as HTMLElement | null;
  const modes = q('.arcade-modes');
  const veil = h(`<button class="arcade-veil" hidden><b>Пауза</b><span>нажмите, чтобы продолжить</span></button>`);

  const modeLabel = () => mod.modes.find((m) => m.id === mode)?.label ?? mode;
  const drawRecords = (period?: 'all' | 'mine') => {
    if (!recs) return;
    recs.innerHTML = '';
    recs.appendChild(recordsBox(mod.id, { table: mode, label: modeLabel(), columns: SCORE_COLUMNS, rows: 10, period }));
  };

  // ---- «Старт» / «Пауза»
  const pauseBtn = h<HTMLButtonElement>(`<button class="btn arcade-pause"></button>`);
  const setPaused = (on: boolean) => {
    if (!inst?.pause) on = false;
    paused = on;
    inst?.pause?.(on);
    veil.hidden = !on;
    pauseBtn.textContent = on ? '▶ Продолжить' : '⏸ Пауза';
    pauseBtn.classList.toggle('primary', on);
  };
  pauseBtn.onclick = () => {
    Sound.ui();
    pauseBtn.blur();
    setPaused(!paused);
  };
  veil.onclick = () => setPaused(false);
  for (const s of mod.starts ?? []) {
    const b = h<HTMLButtonElement>(`<button class="btn primary">▶ ${esc(s.label)}</button>`);
    b.onclick = () => {
      Sound.ui();
      b.blur();
      setPaused(false);
      inst?.launch?.(s.id);
    };
    run.appendChild(b);
  }
  run.appendChild(pauseBtn);
  // вкладку убрали — замираем; вернулись — ждём «Продолжить»
  const onHide = () => {
    if (document.hidden && inst && !paused) setPaused(true);
  };
  document.addEventListener('visibilitychange', onHide);

  const start = () => {
    countPlay(mod.id, 'arcade');
    inst?.destroy();
    stage.innerHTML = '';
    panel.innerHTML = '';
    stage.appendChild(veil);
    inst = mod.mount(stage, {
      mode,
      onScore: (score) => finished(score),
      panel,
    });
    run.hidden = !inst.pause && !mod.starts?.length;
    pauseBtn.hidden = !inst.pause;
    setPaused(!!inst.resumed);
  };
  const finished = (score: number) => {
    if (score <= 0 || !recs) return;
    // рекорд: спрашиваем имя и пишем в общую таблицу (сервер держит лучшие за всё время, месяц, неделю и свои)
    const body = h(`<div><p>Счёт: <b>${score}</b>! Записать в таблицу рекордов?</p><input class="arcade-name recs-input" maxlength="16" placeholder="Ваше имя" value="${esc(settings.name || '')}"></div>`);
    const input = body.querySelector('input') as HTMLInputElement;
    modal(body, [
      {
        text: 'Записать',
        primary: true,
        action: () => {
          const name = input.value.trim() || 'Аноним';
          settings.name = name;
          saveSettings();
          void postClaim({ game: mod.id, name, table: mode, label: modeLabel(), values: { score } }).then((r) => drawRecords(r?.place ? 'all' : 'mine'));
        },
      },
      { text: 'Не надо' },
    ]);
    setTimeout(() => input.focus(), 50);
  };

  for (const m of mod.modes) {
    const label = mod.list && m.hint ? `${esc(m.label)}<small>${esc(m.hint)}</small>` : esc(m.label);
    const b = h<HTMLButtonElement>(`<button class="${m.id === mode ? 'on' : ''}" title="${esc(m.hint ?? '')}">${label}</button>`);
    b.onclick = () => {
      Sound.ui();
      b.blur(); // пробел в аркадах — игровая клавиша (монета, прыжок): не должен снова жать кнопку списка
      mode = m.id;
      store.set(`arcade.${mod.id}.mode`, mode);
      at.onMode?.(mode);
      modes.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      drawRecords();
      start();
    };
    modes.appendChild(b);
  }
  modes.hidden = mod.modes.length < 2;

  const stop = () => {
    document.removeEventListener('visibilitychange', onHide);
    inst?.destroy();
    inst = null;
  };
  const leave = () => {
    stop();
    onBack();
  };
  q('[data-a=menu]').onclick = () => {
    Sound.ui();
    const was = paused;
    setPaused(true);
    modal(`<h2>Пауза</h2><p>${esc(mod.title)}: игра замерла, пока открыто меню.</p>`, [
      { text: 'Настройки', action: () => openSettings() },
      { text: 'Во двор', action: leave },
      { text: 'Продолжить', primary: true, action: () => setPaused(was) },
    ]);
  };
  const sb = q<HTMLButtonElement>('[data-a=sound]');
  const upd = () => (sb.textContent = settings.sound ? '🔊' : '🔇');
  upd();
  sb.onclick = () => {
    settings.sound = !settings.sound;
    saveSettings();
    upd();
  };
  showScreen('arcade');
  start();
  drawRecords();
  return stop;
}
