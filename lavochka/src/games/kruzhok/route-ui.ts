/* Шахматный кружок — карточка «Личный маршрут от Михалыча» на «Пути»: кнопка «Что мне подтянуть?» разбирает свои
 * партии движком (kruzhok/mygames.ts), считает профиль и кандидатов (kruzhok/route.ts), спрашивает Михалыча
 * (/api/mihalych/route) и показывает шаги-кнопки. Без «Лавочки+» — профиль слабых мест без маршрута. Маршрут
 * хранится в журнале (kruzhok.route), шаги отмечаются, когда их открыли. */
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { esc, h } from '../../core/util';
import { stockfish } from '../chess/stockfish';
import { loadClassics, loadEtudes, loadLessonIndex, loadThemeIndex } from './data';
import { loadSolvedEtudes } from './etyudy';
import { loadDone } from './lessons';
import { loadMyGames, reviewPending } from './mygames';
import { loadAnswers } from './partii';
import { loadProgress } from './progress';
import { buildProfile, profileText, routeItems, type Route, type RouteItem, type RouteInput } from './route';
import { touch } from './cloud';

const KEY = 'kruzhok.route';
export const loadRoute = () => store.get<Route | null>(KEY, null);
const saveRoute = (r: Route) => (store.set(KEY, r), touch());

/** Отметить шаг маршрута пройденным (открыли его). */
export function markStep(id: string) {
  const r = loadRoute();
  if (!r || r.done.includes(id)) return;
  r.done.push(id);
  saveRoute(r);
}

async function gather(): Promise<RouteInput> {
  const [lessons, idx, etudes, classics] = await Promise.all([
    loadLessonIndex(),
    loadThemeIndex(),
    loadEtudes().catch(() => []),
    loadClassics().catch(() => []),
  ]);
  const p = loadProgress();
  return {
    rating: p.rating.r,
    solved: p.solved,
    themesOf: idx.of,
    lessons: lessons.map((l) => ({ id: l.id, title: l.title, part: l.part, n: l.n })),
    lessonsDone: loadDone(),
    games: loadMyGames(),
    etudes,
    etudesDone: loadSolvedEtudes(),
    classics,
    classicsSeen: loadAnswers(),
  };
}

/** Карточка в панели «Пути»; open — открыть шаг (урок, задачи, этюд, партию, свою позицию). */
export function mountRouteCard(host: HTMLElement, open: (item: RouteItem) => void) {
  let alive = true;
  const el = h(`<div class="kz-route"></div>`);
  host.appendChild(el);

  const draw = (note = '') => {
    const r = loadRoute();
    const steps = r?.steps.map((s) => ({ s, it: r.items.find((x) => x.id === s.id) })).filter((x) => x.it) ?? [];
    el.innerHTML = `<h4>🧭 Личный маршрут от Михалыча</h4>
      ${
        steps.length
          ? `<p class="kz-route-intro">${esc(r!.intro)}</p>
        <ol class="kz-route-steps">${steps
          .map(({ s, it }) => `<li class="${r!.done.includes(s.id) ? 'done' : ''}"><button class="kz-route-step" data-id="${esc(s.id)}"><b>${esc(it!.title)}</b><small>${esc(s.say)}</small></button></li>`)
          .join('')}</ol>
        <small class="hint">Составлен ${new Date(r!.at).toLocaleDateString('ru-RU')} · пройдено ${r!.done.filter((d) => steps.some((x) => x.s.id === d)).length} из ${steps.length}</small>`
          : '<p class="hint"><small>Михалыч посмотрит твои задачи, уроки и партии с компьютером и подберёт, что подтянуть в первую очередь.</small></p>'
      }
      <div class="kz-route-note" aria-live="polite">${note}</div>
      <button class="btn${steps.length ? '' : ' primary'} kz-route-ask">${steps.length ? '↻ Что мне ещё подтянуть?' : '🧭 Михалыч, что мне подтянуть?'}</button>`;
    el.querySelectorAll<HTMLButtonElement>('.kz-route-step').forEach(
      (b) =>
        (b.onclick = () => {
          const it = loadRoute()?.items.find((x) => x.id === b.dataset.id);
          if (!it) return;
          Sound.ui();
          markStep(it.id);
          open(it);
        }),
    );
    el.querySelector<HTMLButtonElement>('.kz-route-ask')!.onclick = () => void ask();
  };

  const say = (html: string) => {
    const n = el.querySelector('.kz-route-note');
    if (n) n.innerHTML = html;
  };

  const ask = async () => {
    Sound.ui();
    el.querySelector<HTMLButtonElement>('.kz-route-ask')!.disabled = true;
    try {
      const pending = loadMyGames().filter((g) => !g.review).length;
      if (pending) {
        say(`Михалыч разбирает твои партии с компьютером… 0 из ${pending}`);
        let n = 0;
        await reviewPending(stockfish, () => alive, () => say(`Михалыч разбирает твои партии с компьютером… ${++n} из ${pending}`));
        if (!alive) return;
      }
      say('Михалыч листает журнал…');
      const input = await gather();
      const prof = buildProfile(input);
      const items = routeItems(input, prof);
      const text = profileText(prof, input.rating);
      if (!items.length) return say('Пока не из чего собирать маршрут: порешай задачи, пройди пару уроков или сыграй партию с компьютером в «Шахматах» — и спроси снова.');
      const r = await fetch('/api/mihalych/route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile: text, items }) }).catch(() => null);
      if (!alive) return;
      const body = r ? await r.json().catch(() => ({})) : {};
      if (!r?.ok) {
        // без подписки и без входа — честно показать профиль, а маршрут — с «Лавочкой+»
        const plus = body.error === 'plus' || body.error === 'login';
        return say(
          `${plus ? '' : `<p class="kz-bad">${esc(body.message || 'Михалыч не ответил. Попробуй ещё раз.')}</p>`}<p><b>Что видно по журналу:</b></p><p class="kz-route-prof">${esc(text).replace(/\n/g, '<br>')}</p>${
            plus ? '<p>Личный маршрут из уроков, задач и этюдов Михалыч составляет подписчикам <a href="#plus">«Лавочки+»</a>.</p>' : ''
          }`,
        );
      }
      saveRoute({ at: Date.now(), intro: body.intro, steps: body.steps, items, done: [] });
      draw();
    } finally {
      if (alive) {
        const b = el.querySelector<HTMLButtonElement>('.kz-route-ask');
        if (b) b.disabled = false;
      }
    }
  };

  draw();
  return {
    destroy() {
      alive = false;
      el.remove();
    },
  };
}
