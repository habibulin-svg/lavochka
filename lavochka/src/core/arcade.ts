/* Аркады — игры в реальном времени для одного (электроника, Brick Game, «За рулём», аркады волны 6).
 * У них нет пошагового стола: модуль сам рисует устройство и крутит игру, а этот экран даёт рамку —
 * «назад», режимы, управление, таблицу рекордов (на этом устройстве и общую на сервере). */
import { Sound } from './audio';
import { fetchRecords, postRecord } from './net/ws';
import { settings, store } from './settings';
import { mountScreen, modal, showScreen } from './ui';
import { esc, h } from './util';

export interface ArcadeMode {
  id: string;
  label: string;
  hint?: string;
}

/** Запущенная игра: модуль сам рисует и слушает клавиши, экран только убирает её. */
export interface ArcadeInstance {
  destroy(): void;
}

export interface ArcadeOpts {
  mode: string;
  /** Конец игры: счёт уходит в рекорды. */
  onScore(score: number): void;
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
  mount(root: HTMLElement, opts: ArcadeOpts): ArcadeInstance;
}

export const isArcade = (m: unknown): m is ArcadeModule => !!m && (m as ArcadeModule).kind === 'arcade';

interface Rec {
  name: string;
  score: number;
  at: number;
  mode?: string;
}

const localKey = (id: string, mode: string) => `records.${id}.${mode}`;

export function localRecords(id: string, mode: string): Rec[] {
  return store.get<Rec[]>(localKey(id, mode), []);
}

/** Добавить рекорд на этом устройстве (держим десять лучших). Возвращает место (0…9) или -1. */
export function addLocalRecord(id: string, mode: string, rec: Rec): number {
  const list = [...localRecords(id, mode), rec].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, 10);
  store.set(localKey(id, mode), list);
  return list.indexOf(rec);
}

export function openArcade(mod: ArcadeModule, onBack: () => void) {
  let mode = store.get<string>(`arcade.${mod.id}.mode`, mod.modes[0]?.id ?? 'A');
  if (!mod.modes.some((m) => m.id === mode)) mode = mod.modes[0]?.id ?? 'A';
  let inst: ArcadeInstance | null = null;

  const el = h(`<section class="arcade-screen">
    <header class="home-top">
      <button class="btn back" data-a="back">← Во двор</button>
      <div class="home-title"><h1>${esc(mod.title)}</h1><p>${mod.about}</p></div>
    </header>
    <div class="arcade-cols">
      <div class="arcade-stage"></div>
      <aside class="sheet arcade-side">
        <div class="seg arcade-modes"></div>
        <h3>Управление</h3><div class="arcade-controls">${mod.controls}</div>
        <h3>Рекорды</h3><div class="arcade-recs"></div>
      </aside>
    </div>
  </section>`);
  mountScreen('arcade', el);
  const stage = el.querySelector('.arcade-stage') as HTMLElement;
  const recs = el.querySelector('.arcade-recs') as HTMLElement;
  const modes = el.querySelector('.arcade-modes') as HTMLElement;

  const drawRecords = async () => {
    const mine = localRecords(mod.id, mode);
    const row = (r: Rec, i: number) => `<li><span>${i + 1}.</span> ${esc(r.name)} <b>${r.score}</b></li>`;
    recs.innerHTML = `<div class="arcade-rec-t">На этом устройстве</div><ol>${mine.map(row).join('') || '<li class="empty">пока пусто</li>'}</ol><div class="arcade-rec-t">Во дворе (на сервере)</div><ol class="srv"><li class="empty">…</li></ol>`;
    const srv = (await fetchRecords(`${mod.id}-${mode}`)) as Rec[];
    const ol = recs.querySelector('.srv') as HTMLElement;
    if (ol) ol.innerHTML = srv.map(row).join('') || '<li class="empty">нет связи или рекордов</li>';
  };

  const start = () => {
    inst?.destroy();
    stage.innerHTML = '';
    inst = mod.mount(stage, {
      mode,
      onScore: (score) => void finished(score),
    });
  };

  const finished = async (score: number) => {
    if (score <= 0) return;
    const mine = localRecords(mod.id, mode);
    if (mine.length >= 10 && score <= mine[mine.length - 1].score) return;
    // новый рекорд: спрашиваем имя
    const body = h(`<div><p>Новый рекорд: <b>${score}</b>!</p><input class="arcade-name" maxlength="16" placeholder="Ваше имя" value="${esc(settings.name || '')}"></div>`);
    const input = body.querySelector('input') as HTMLInputElement;
    modal(body, [
      {
        text: 'Записать',
        primary: true,
        action: () => {
          const name = input.value.trim() || 'Аноним';
          settings.name = name;
          addLocalRecord(mod.id, mode, { name, score, at: Date.now(), mode });
          void postRecord(`${mod.id}-${mode}`, name, score).then(drawRecords);
          void drawRecords();
        },
      },
      { text: 'Не надо' },
    ]);
    setTimeout(() => input.focus(), 50);
  };

  for (const m of mod.modes) {
    const b = h<HTMLButtonElement>(`<button class="${m.id === mode ? 'on' : ''}" title="${esc(m.hint ?? '')}">${esc(m.label)}</button>`);
    b.onclick = () => {
      Sound.ui();
      mode = m.id;
      store.set(`arcade.${mod.id}.mode`, mode);
      modes.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      void drawRecords();
      start();
    };
    modes.appendChild(b);
  }
  modes.hidden = mod.modes.length < 2;

  (el.querySelector('[data-a=back]') as HTMLButtonElement).onclick = () => {
    Sound.ui();
    inst?.destroy();
    inst = null;
    onBack();
  };
  showScreen('arcade');
  start();
  void drawRecords();
}
