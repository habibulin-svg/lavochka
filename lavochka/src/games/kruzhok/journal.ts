/* Шахматный кружок — журнал ученика: разряд и лесенка разрядов, рейтинг по дням, серия, задачи по темам. */
import { esc, h } from '../../core/util';
import { loadPuzzles, THEMES } from './data';
import { loadDone, resetLessons } from './lessons';
import { loadPath, resetPath } from './path';
import { loadAnswers, resetAnswers } from './partii';
import { dayStreak, loadProgress, resetProgress } from './progress';
import { RANKS, rankOf } from './rating';

export function mountJournal(stage: HTMLElement, panel: HTMLElement, onReset: () => void) {
  const p = loadProgress();
  const solved = Object.keys(p.solved).length;
  const r = rankOf(p.rating, solved);
  const clean = Object.values(p.solved).filter((x) => x === 1).length;
  const answers = Object.values(loadAnswers()).flatMap((a) => Object.values(a));

  const page = h(`<div class="kz-journal sheet">
    <h2>Журнал кружка</h2>
    <div class="kz-j-top">
      <div><small>Разряд</small><b>${esc(r.name)}</b>${r.provisional ? '<small>предварительно — решите ещё десяток задач</small>' : ''}</div>
      <div><small>Рейтинг в задачах</small><b>${p.rating.r}</b></div>
      <div><small>Решено</small><b>${solved}</b><small>${clean} с первого раза</small></div>
      <div><small>Звёзды кружка</small><b>⭐ ${loadPath().stars}</b><small>грамот: ${Object.keys(loadPath().diplomas).length}</small></div>
      <div><small>Учебник</small><b>${Object.keys(loadDone()).length}</b><small>уроков пройдено</small></div>
      <div><small>Классические партии</small><b>${answers.filter((x) => x === 1).length} из ${answers.length}</b><small>ходов мастеров найдено</small></div>
      <div><small>Занимаетесь подряд</small><b>${dayStreak(p)} дн.</b><small>лучшая серия задач — ${p.best}</small></div>
    </div>
    <h3>Рейтинг</h3>
    <div class="kz-j-chart"></div>
    <h3>Лесенка разрядов</h3>
    <ol class="kz-ladder">${RANKS.map((x, i) => `<li class="${i === r.index ? 'on' : i < r.index ? 'past' : ''}"><b>${esc(x.short)}</b> ${esc(x.name)} <small>${x.from ? `от ${x.from}` : ''}</small></li>`).join('')}</ol>
    <h3>По темам</h3>
    <div class="kz-j-themes"><small class="hint">Считаю…</small></div>
  </div>`);
  stage.appendChild(page);

  // график рейтинга: последние задачи
  const hist = p.history;
  const chart = page.querySelector('.kz-j-chart') as HTMLElement;
  if (hist.length < 2) chart.innerHTML = '<small class="hint">Решите пару задач — здесь появится линия рейтинга.</small>';
  else {
    const vals = hist.map((x) => x[1]);
    const lo = Math.min(...vals) - 20;
    const hi = Math.max(...vals) + 20;
    const W = 600;
    const H = 140;
    const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * W).toFixed(1)},${(H - ((v - lo) / (hi - lo)) * H).toFixed(1)}`).join(' ');
    chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>
      <div class="kz-j-axis"><small>${Math.round(lo + 20)}</small><small>${Math.round(hi - 20)}</small></div>`;
  }

  void loadPuzzles().then((all) => {
    const byId = new Map(all.map((x) => [x.id, x]));
    const rows: string[] = [];
    for (const t of THEMES) {
      const total = all.filter((x) => x.themes.includes(t.id)).length;
      if (!total) continue;
      const mine = Object.entries(p.solved).filter(([id]) => byId.get(id)?.themes.includes(t.id));
      const ok = mine.filter(([, v]) => v === 1).length;
      rows.push(`<div class="kz-j-th"><span>${esc(t.name)}</span><i style="--w:${Math.round((mine.length / total) * 100)}%"></i><small>${mine.length ? `${ok}/${mine.length}` : '—'} из ${total}</small></div>`);
    }
    (page.querySelector('.kz-j-themes') as HTMLElement).innerHTML = rows.join('');
  });

  const side = h(`<div class="kz-tr">
    <p>Журнал хранится на этом устройстве. Чтобы не потерять его при смене телефона, скоро можно будет войти на сайт — журнал перенесётся в аккаунт.</p>
    <button class="btn small" data-a="reset">Начать журнал заново</button>
  </div>`);
  panel.appendChild(side);
  const reset = side.querySelector('[data-a=reset]') as HTMLButtonElement;
  let sure = false;
  reset.onclick = () => {
    if (!sure) {
      sure = true;
      reset.textContent = 'Точно? Рейтинг, задачи и партии сотрутся';
      reset.classList.add('primary');
      return;
    }
    resetProgress();
    resetAnswers();
    resetLessons();
    resetPath();
    onReset();
  };

  return {
    destroy() {
      page.remove();
      side.remove();
    },
  };
}
