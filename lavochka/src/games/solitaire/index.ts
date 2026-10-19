import { store } from '../../core/settings';
import { esc, h } from '../../core/util';
import type { GameModule } from '../../core/view';
import { def } from './def';
import { createView, RECORDS, type Record_ } from './view';

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

/** Статистика на этом устройстве (сколько разложено, лучшее время) — в начале карточки «Новая партия»; общие рекорды — core/records-ui. */
function home(box: HTMLElement) {
  const all = Object.values(store.get<Record<string, Record_>>(RECORDS, {})).sort((a, b) => b.played - a.played);
  box.hidden = !all.length;
  if (!all.length) return;
  box.innerHTML = '';
  box.appendChild(
    h(`<div class="so-records"><h3>Ваша статистика на этом устройстве</h3><p class="hint">Общая таблица двора — кнопка «🏆 Рекорды» наверху.</p><table>
      <tr><th>Пасьянс</th><th>Сошёлся</th><th>Быстрее всего</th><th>Меньше ходов</th></tr>
      ${all
        .slice(0, 10)
        .map((r) => `<tr><td>${esc(r.title)}</td><td>${r.won} из ${r.played}</td><td>${r.best ? fmt(r.best) : '—'}</td><td>${r.bestMoves || '—'}</td></tr>`)
        .join('')}
    </table></div>`)
  );
}

const mod: GameModule = { def, createView, home };
export default mod;
