import { store } from '../../core/settings';
import { esc, h } from '../../core/util';
import type { GameModule } from '../../core/view';
import { def } from './def';
import { MJ_PREFS } from './draw';
import { createView, PREF_DIM, RECORDS, type Record_ } from './view';

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

/** Рекорды на этом устройстве — в начале карточки «Новая партия». */
function home(box: HTMLElement) {
  const all = Object.values(store.get<Record<string, Record_>>(RECORDS, {})).sort((a, b) => b.played - a.played);
  box.hidden = !all.length;
  if (!all.length) return;
  box.innerHTML = '';
  box.appendChild(
    h(`<div class="mj-records"><h3>Рекорды на этом устройстве</h3><table>
      <tr><th>Раскладка</th><th>Разобрано</th><th>Быстрее всего</th></tr>
      ${all.map((r) => `<tr><td>${esc(r.title)}</td><td>${r.won} из ${r.played}</td><td>${r.best ? fmt(r.best) : '—'}</td></tr>`).join('')}
    </table></div>`)
  );
}


const mod: GameModule = {
  def,
  createView,
  home,
  prefs: [...MJ_PREFS, { key: PREF_DIM, label: 'Занятые кости', hint: 'затенять кости, которые сейчас снять нельзя', choices: [{ value: 'on', label: 'затенять' }, { value: 'off', label: 'не затенять' }], default: 'on' }],
};
export default mod;
