/* Покер — вкладка лобби «Моя статистика»: свои цифры как в HUD, выигрыш в быстрой игре (bb/100 и кривая), турниры
 * (места, ITM, ROI банкролла), последние раздачи с реплеером и разбором, выгрузка истории в формате для трекеров. */
import type { Card } from '../../cards/deck';
import { esc, h } from '../../core/util';
import { bankInfo } from './bankroll';
import { bestMove } from './calc';
import { syncPoker } from './cloud';
import { gameTitle, SEATS } from './def';
import { exportHistory, hhGame } from './hh';
import { emptyHud, loadHud, saveHud, statN, STATS, statVal, styleGuess, summaryOf, tourSummary, type Saved } from './hud';
import { frames, potOf, type Frame } from './replay';
import { FMTS, type TourFmt } from './tour';

const RN: Record<number, string> = { 14: 'Т', 13: 'К', 12: 'Д', 11: 'В' };
const SS: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const card = (c: Card | null) => (c ? `<span class="pk-c pk-c-${c.s}">${RN[c.r] ?? c.r}${SS[c.s]}</span>` : '<span class="pk-c pk-c-x">🂠</span>');
const cards = (cs: (Card | null)[]) => cs.map(card).join('');
const signed = (x: number, d = 1) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}`;
const when = (at: number) => new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Кривая выигрыша в ББ (SVG). */
function curve(pts: number[]): string {
  if (pts.length < 2) return '<p class="pk-ms-empty">Кривая появится после нескольких раздач быстрой игры.</p>';
  const W = 560;
  const H = 150;
  const lo = Math.min(0, ...pts);
  const hi = Math.max(0, ...pts);
  const span = hi - lo || 1;
  const x = (i: number) => ((i / (pts.length - 1)) * (W - 8) + 4).toFixed(1);
  const y = (v: number) => (H - 6 - ((v - lo) / span) * (H - 12)).toFixed(1);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
  const last = pts[pts.length - 1];
  return `<svg class="pk-ms-curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Выигрыш по раздачам, в больших блайндах">
    <line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="pk-ms-zero"/>
    <path d="${d}" class="${last >= 0 ? 'pk-ms-up' : 'pk-ms-down'}"/>
    <text x="${W - 4}" y="12" text-anchor="end">${signed(hi, 0)} ББ</text><text x="${W - 4}" y="${H - 2}" text-anchor="end">${signed(lo, 0)} ББ</text></svg>`;
}

export function renderStats(box: HTMLElement) {
  const draw = () => {
    const d = loadHud();
    const s = summaryOf(d.me);
    const guess = styleGuess(s);
    const bank = bankInfo();
    const ts = tourSummary(d);
    const bb100 = d.cash.hands ? (d.cash.bb / d.cash.hands) * 100 : 0;
    const rows = STATS.map((st) => {
      const n = statN(s, st.key);
      const val = statVal(s, st.key);
      return `<details class="pk-stat"><summary><span>${esc(st.name)}</span><b>${val}${st.key === 'hands' || st.key === 'af' || val === '—' ? '' : '%'}</b>${st.key !== 'hands' ? `<small>из ${n}</small>` : ''}</summary>
        <p><b>Что значит:</b> ${st.what}</p><p><b>У стилей:</b> ${st.styles}</p><p><b>Как пользоваться:</b> ${st.use}</p></details>`;
    }).join('');
    const tours = d.tours
      .slice(-8)
      .reverse()
      .map((t) => `<li>${when(t.at)} · ${esc(FMTS[t.fmt as TourFmt]?.label ?? t.fmt)} — <b>${t.place}-е</b> из ${t.field}${t.prize ? `, приз ${t.prize}` : ''}${t.bank ? ' · банкролл' : ''}</li>`)
      .join('');
    const hands = d.hist
      .slice(-40)
      .reverse()
      .map((x, k) => {
        const net = (x.rec.net[x.me] ?? 0) / x.rec.big;
        return `<li><button type="button" class="pk-ms-hand" data-i="${d.hist.length - 1 - k}"><span class="pk-ms-when">${when(x.at)}</span><span class="pk-ms-g">${esc(gameTitle(x.rec.game, x.rec.hilo))}</span><span class="pk-ms-cards">${cards(x.rec.hole[x.me] ?? [])}</span><b class="${net > 0 ? 'pk-good' : net < 0 ? 'pk-bad' : ''}">${signed(net)} ББ</b>${x.best ? `<small>${esc(x.best)}</small>` : ''}</button></li>`;
      })
      .join('');
    const exp = d.hist.filter((x) => hhGame(x.rec)).length;
    box.innerHTML = `<div class="pk-ms">
      <section><h3>Мои показатели ${guess ? `<span class="pk-guess">по цифрам: ${guess}</span>` : ''}</h3>
        <p class="pk-pnote">Считаются так же, как HUD соперников, по всем вашим раздачам (вошли на сайт — хранятся и в профиле). Коснитесь цифры — что она значит.</p>
        <div class="pk-ms-grid">${rows}</div></section>
      <section><h3>Быстрая игра</h3>
        <p>Раздач: <b>${d.cash.hands}</b> · итог <b class="${d.cash.bb >= 0 ? 'pk-good' : 'pk-bad'}">${signed(d.cash.bb)} ББ</b> · <b>${signed(bb100, 1)} ББ/100</b> <small>(выигрыш на 100 раздач в больших блайндах — главная цифра кэш-игры)</small></p>
        ${curve(d.cash.curve)}</section>
      <section><h3>Турниры</h3>
        <p>Сыграно: <b>${ts.played}</b>${ts.played ? ` · в призах (ITM) <b>${Math.round(ts.itm * 100)}%</b> · побед ${ts.wins} · среднее место — в верхних ${Math.round(ts.avgPlace * 100)}% поля` : ''}</p>
        <p>Банкролл: <b>${bank.balance.toLocaleString('ru-RU')}</b> очков · турниров на банкролл ${bank.played} · ITM ${Math.round(bank.itm * 100)}% · ROI <b>${bank.roi >= 0 ? '+' : ''}${Math.round(bank.roi * 100)}%</b></p>
        ${tours ? `<ul class="pk-ms-tours">${tours}</ul>` : ''}</section>
      <section><h3>Последние раздачи</h3>
        ${hands ? `<p class="pk-pnote">Коснитесь раздачи — реплеер по шагам и разбор.</p><ul class="pk-ms-hands">${hands}</ul>` : '<p class="pk-ms-empty">Пока пусто — сыграйте за столом.</p>'}
        <div class="pk-row pk-ms-btns">
          <button type="button" class="btn pk-ms-export" ${exp ? '' : 'disabled'}>⬇ История в формате для трекеров (${exp})</button>
          <button type="button" class="btn pk-ms-reset">Сбросить статистику</button>
        </div>
        <p class="pk-pnote">Файл .txt в текстовом формате истории раздач, который понимают популярные покерные трекеры: холдем и Омаха. Хранятся последние 200 раздач.</p></section>
    </div>`;
    for (const b of box.querySelectorAll<HTMLButtonElement>('.pk-ms-hand')) b.onclick = () => openReplay(d.hist[Number(b.dataset.i)]);
    (box.querySelector('.pk-ms-export') as HTMLButtonElement).onclick = () => {
      const { text } = exportHistory(loadHud().hist);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      a.download = `lavochka-poker-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 500);
    };
    (box.querySelector('.pk-ms-reset') as HTMLButtonElement).onclick = () => {
      if (!confirm('Сбросить всю статистику тренажёра: свои цифры, HUD соперников, историю раздач и турниров? Банкролл останется.')) return;
      saveHud(emptyHud());
      draw();
    };
  };
  draw();
  void syncPoker(true).then((changed) => changed && box.isConnected && draw());
}

// ---------------------------------------------------------------- реплеер

function openReplay(x: Saved) {
  const r = x.rec;
  const nm = (p: number) => x.names[p] ?? SEATS[p]?.name ?? `Место ${p + 1}`;
  const fr = frames(r, (p) => esc(nm(p)));
  const verdict = bestMove(r, x.me, x.prizes, (p) => esc(nm(p)));
  let i = 0;
  const el = h('<div class="pk-rp" role="dialog" aria-label="Реплеер раздачи"><div class="pk-pbox pk-rpbox"></div></div>');
  const boxEl = el.querySelector('.pk-rpbox') as HTMLElement;
  const ring = r.seats.map((s) => s.seat).sort((a, b) => a - b);
  const render = () => {
    const f: Frame = fr[i];
    const end = i === fr.length - 1;
    const seats = ring
      .map((p) => {
        const hole = end && r.shown[p] ? r.shown[p] : r.hole[p] ?? [];
        const out = f.folded.includes(p);
        return `<tr class="${f.seat === p ? 'on' : ''}${out ? ' out' : ''}"><td>${esc(nm(p))}${p === r.button ? ' <b class="pk-d">D</b>' : ''}${p === x.me ? ' <small>(вы)</small>' : ''}</td><td>${cards(hole)}</td><td>${f.stacks[p]}</td><td>${f.bets[p] ? f.bets[p] : ''}</td></tr>`;
      })
      .join('');
    boxEl.innerHTML = `<div class="pk-phead"><b>Раздача ${r.no} · ${esc(gameTitle(r.game, r.hilo))}</b><button type="button" class="pk-pclose" aria-label="Закрыть">✕</button></div>
      <div class="pk-rp-board">${f.board.length ? cards(f.board) : '<small>доски пока нет</small>'}<span>банк ${potOf(f)}</span></div>
      <table class="pk-rp-seats"><thead><tr><th>Игрок</th><th>Карты</th><th>Стек</th><th>Ставка</th></tr></thead><tbody>${seats}</tbody></table>
      <p class="pk-rp-text">${f.text}</p>
      <div class="pk-row pk-rp-nav"><button type="button" class="btn" data-n="first" aria-label="В начало">⏮</button><button type="button" class="btn" data-n="prev" aria-label="Назад">◀</button><span>${i + 1} / ${fr.length}</span><button type="button" class="btn primary" data-n="next" aria-label="Вперёд">▶</button><button type="button" class="btn" data-n="last" aria-label="В конец">⏭</button></div>
      ${end && verdict.kind !== 'none' ? `<div class="pk-rp-verdict"><h4>${verdict.kind === 'exact' ? 'Лучший ход (точно)' : 'Разбор (оценка)'}</h4>${verdict.html}</div>` : ''}`;
    for (const b of boxEl.querySelectorAll<HTMLButtonElement>('[data-n]'))
      b.onclick = () => {
        const n = b.dataset.n;
        i = n === 'first' ? 0 : n === 'last' ? fr.length - 1 : n === 'prev' ? Math.max(0, i - 1) : Math.min(fr.length - 1, i + 1);
        render();
      };
    (boxEl.querySelector('.pk-pclose') as HTMLButtonElement).onclick = close;
  };
  const close = () => {
    el.remove();
    removeEventListener('keydown', key);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') (boxEl.querySelector('[data-n="next"]') as HTMLButtonElement)?.click();
    else if (e.key === 'ArrowLeft') (boxEl.querySelector('[data-n="prev"]') as HTMLButtonElement)?.click();
  };
  el.addEventListener('click', (e) => e.target === el && close());
  addEventListener('keydown', key);
  document.body.appendChild(el);
  render();
}
