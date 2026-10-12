import { esc, h } from '../../core/util';
import type { GameModule } from '../../core/view';
import { def } from './def';
import { dropSave, fmtTime, listSaves, listSolved } from './saves';
import { createView } from './view';
import './puzzles.css';

/** Список недорешённого на экране игры: продолжить — с теми же местами, что выбраны ниже (можно и по сети). */
function home(box: HTMLElement, launch: (o: Record<string, string | number | boolean>) => void) {
  const render = () => {
    const saves = listSaves();
    const solved = listSolved();
    box.innerHTML = '';
    box.hidden = !saves.length && !solved.length;
    if (box.hidden) return;
    const wrap = h(`<div class="pz-saves"></div>`);
    if (saves.length) wrap.appendChild(h(`<h3>Недорешённые</h3>`));
    for (const e of saves.slice(0, 8)) {
      const row = h(`<div class="pz-save">
        <div class="t"><b>${esc(e.title)}</b><small>${Math.round(e.progress * 100)}% · ${fmtTime(e.elapsed)} · ${new Date(e.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</small><div class="pz-bar"><i style="width:${Math.round(e.progress * 100)}%"></i></div></div>
        <button class="btn small" data-a="drop" title="Забыть">✕</button><button class="btn primary small" data-a="go">Продолжить</button>
      </div>`);
      (row.querySelector('[data-a=go]') as HTMLButtonElement).onclick = () => launch({ ...e.opts, fill: e.fill });
      (row.querySelector('[data-a=drop]') as HTMLButtonElement).onclick = () => {
        dropSave(e.key);
        render();
      };
      wrap.appendChild(row);
    }
    if (solved.length) wrap.appendChild(h(`<small class="hint">Решено на этом устройстве: ${solved.length}. Последнее — ${esc(solved[0].title)} за ${fmtTime(solved[0].elapsed)}.</small>`));
    box.appendChild(wrap);
  };
  render();
}

const mod: GameModule = { def, createView, ownSaves: true, home };
export default mod;
