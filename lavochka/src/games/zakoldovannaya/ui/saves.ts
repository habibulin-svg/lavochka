/* Сохранения «Заколдованной страны»: автосохранение ведёт ядро сборника (save.zakoldovannaya), а здесь — именованные
 * слоты: «💾» в игре копирует текущую партию в слот, на экране игры — список слотов («Загрузить», «Удалить»). */
import type { Snapshot } from '../../../core/authority';
import { store } from '../../../core/settings';
import { esc } from '../../../core/util';
import type { State } from '../state';

const AUTO = 'save.zakoldovannaya';
const SLOTS = 'zs.slots';
const MAX = 12;

export interface Slot {
  id: string;
  name: string;
  at: number;
  /** Подпись: отряд, день, где. */
  info: string;
  snap: Snapshot;
}

export function slots(): Slot[] {
  return store.get<Slot[]>(SLOTS, []).sort((a, b) => b.at - a.at);
}

function summary(s: State): string {
  const party = s.heroes.filter((h) => h.cls).map((h) => `${h.name}${h.dead ? ' ☠' : ''} (${h.level})`).join(', ');
  return `${party || 'оформление героев'} · день ${s.world.day}`;
}

/** Сохранить текущую партию (последнее автосохранение) в слот. */
export function saveSlot(name: string, replace?: string): boolean {
  const snap = store.get<Snapshot | null>(AUTO, null);
  if (!snap) return false;
  const st = snap.state as State;
  // лента рассказа в слоте — покороче, чтобы хватило места
  const slim: Snapshot = { ...snap, state: { ...st, story: st.story.slice(-120) } };
  const list = slots().filter((x) => x.id !== replace);
  list.unshift({ id: replace ?? `s${Date.now().toString(36)}`, name: name.trim().slice(0, 40) || 'Без названия', at: Date.now(), info: summary(st), snap: slim });
  try {
    store.set(SLOTS, list.slice(0, MAX));
    return true;
  } catch {
    return false;
  }
}

export function dropSlot(id: string): void {
  store.set(SLOTS, slots().filter((x) => x.id !== id));
}

/** Окно «Сохранить» в игре. */
export function openSaveDialog(host: HTMLElement): void {
  host.querySelector('.zs-modal')?.remove();
  const m = document.createElement('div');
  m.className = 'zs-modal';
  const draw = () => {
    const list = slots();
    m.innerHTML = `<div class="zs-modal-box zs-sheet zs-saves"><button class="zs-close">✕</button><h2>Сохранить игру</h2>
      ${store.get(AUTO, null) ? '' : '<p class="zs-hint">Сохранять можно только партию на этом устройстве.</p>'}
      <div class="zs-row"><input class="zs-sname" maxlength="40" placeholder="Название" value="${esc(new Date().toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}"><button class="btn primary" data-a="new">Новое сохранение</button></div>
      <ul class="zs-slots">${list.map((x) => `<li><b>${esc(x.name)}</b><small>${esc(x.info)} · ${new Date(x.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small><span><button data-a="over" data-id="${x.id}">записать сюда</button><button data-a="del" data-id="${x.id}">удалить</button></span></li>`).join('') || '<li><i>Сохранений пока нет</i></li>'}</ul>
      <p class="zs-hint">Загрузить — на экране игры (кнопка «Назад» → список сохранений). Партия и так сохраняется сама после каждого хода.</p></div>`;
    (m.querySelector('.zs-close') as HTMLButtonElement).onclick = () => m.remove();
    m.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.a;
        const name = (m.querySelector('.zs-sname') as HTMLInputElement).value;
        if (a === 'new') saveSlot(name);
        else if (a === 'over') saveSlot(slots().find((x) => x.id === b.dataset.id)?.name ?? name, b.dataset.id);
        else if (a === 'del') dropSlot(b.dataset.id!);
        draw();
      };
    });
  };
  m.onclick = (e) => {
    if (e.target === m) m.remove();
  };
  draw();
  host.append(m);
}

/** Список слотов на экране игры. */
export function savesHome(box: HTMLElement, load: (snap: Snapshot) => void): void {
  const draw = () => {
    const list = slots();
    box.hidden = !list.length;
    box.innerHTML = list.length
      ? `<div class="zs-home-saves"><h3>Сохранённые игры</h3>${list.map((x) => `<div class="zs-hs"><div><b>${esc(x.name)}</b><small>${esc(x.info)} · ${new Date(x.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</small></div><button class="btn small" data-d="${x.id}" title="Удалить">✕</button><button class="btn primary small" data-l="${x.id}">Загрузить</button></div>`).join('')}</div>`
      : '';
    box.querySelectorAll<HTMLButtonElement>('[data-l]').forEach((b) => (b.onclick = () => {
      const s = slots().find((x) => x.id === b.dataset.l);
      if (s) load(s.snap);
    }));
    box.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) => (b.onclick = () => {
      dropSlot(b.dataset.d!);
      draw();
    }));
  };
  draw();
}
