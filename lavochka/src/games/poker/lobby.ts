/* Покер — лобби на экране игры, как в покер-руме: вкладки форматов. Сейчас работает «Быстрая игра» (стол на очки, вид — в
 * «Правилах партии»); Sit&Go, турниры, сетевое лобби, школа и статистика — следующими этапами (docs/analysis/poker-plan.md).
 * Отдельная кнопка — китайский покер «Ананас»: выбирает его пресет. */
import { h } from '../../core/util';

const TABS: { id: string; label: string; ready?: boolean; hint: string }[] = [
  { id: 'cash', label: 'Быстрая игра', ready: true, hint: 'Стол на очки: выберите вид покера в «Правилах партии», число игроков и садитесь. С друзьями — место «Сеть».' },
  { id: 'sng', label: 'Sit&Go', hint: 'Турнир на один стол: 2, 6 или 9 игроков, блайнды растут по времени.' },
  { id: 'mtt', label: 'Турниры', hint: 'Многостоловые турниры с ботами: фриз-аут, ребай, баунти.' },
  { id: 'net', label: 'По сети', hint: 'Сетевое лобби: столы и Sit&Go с живыми игроками.' },
  { id: 'school', label: 'Школа', hint: 'Уроки по шагам: позиции, шансы, турнирная игра, ICM — с задачами за столом.' },
  { id: 'stats', label: 'Моя статистика', hint: 'VPIP, PFR, выигрыш на 100 раздач, история и разбор раздач.' },
];

export function lobby(box: HTMLElement) {
  const el = h(`<div class="pk-lobby">
    <div class="pk-tabs" role="tablist">${TABS.map((t) => `<button role="tab" data-t="${t.id}" class="${t.ready ? 'on' : ''}" ${t.ready ? 'aria-selected="true"' : 'aria-disabled="true"'}>${t.label}${t.ready ? '' : '<small>скоро</small>'}</button>`).join('')}</div>
    <p class="pk-lobby-hint"></p>
    <button class="pk-ofc" type="button" title="Без ставок: разложи 13 карт в три ряда">🍍 Китайский покер «Ананас» <small>OFC: три ряда, роялти, фантазия</small></button>
  </div>`);
  // китайский покер — тот же стол «Покера», вид выбирается пресетом
  (el.querySelector('.pk-ofc') as HTMLButtonElement).onclick = () => {
    const b = document.querySelector<HTMLButtonElement>('.presets .preset[data-id="ofcp"]');
    b?.click();
    b?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const hint = el.querySelector('.pk-lobby-hint') as HTMLElement;
  const show = (id: string) => {
    const t = TABS.find((x) => x.id === id)!;
    hint.textContent = t.ready ? t.hint : `Скоро: ${t.hint}`;
  };
  for (const b of el.querySelectorAll<HTMLButtonElement>('.pk-tabs button')) {
    b.onmouseenter = b.onfocus = () => show(b.dataset.t!);
    b.onmouseleave = b.onblur = () => show('cash');
    b.onclick = () => show(b.dataset.t!);
  }
  show('cash');
  box.appendChild(el);
}
