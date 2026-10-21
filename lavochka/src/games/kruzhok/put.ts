/* Шахматный кружок — экран «Путь»: занятия по порядку (урок → задачи → партия мастера → зачёт) по частям учебника,
 * большая кнопка «Дальше», звёзды, разряд, серия дней, грамоты (docs/analysis/kruzhok-put.md). Узел открывается
 * тем же экраном, что и в разделах (урок, решалка, партия), а по выходу — снова путь. */
import { Sound } from '../../core/audio';
import { esc, h } from '../../core/util';
import { PORTRAIT } from '../chess/mihalych';
import { loadClassics, loadLessonIndex, type LessonInfo } from './data';
import { loadDone } from './lessons';
import { loadAnswers } from './partii';
import { sectionPath } from './pages';
import { mountLesson } from './lessons';
import { mountGame } from './partii';
import { buildPath, completeNode, loadPath, nextNode, partShare, syncPath, type PathNode } from './path';
import { dayStreak, loadProgress } from './progress';
import { rankOf } from './rating';
import { mountTrainer } from './trainer';

const ICON: Record<PathNode['kind'], string> = { lesson: '📖', drill: '🧩', game: '♟', exam: '🎓' };

export function mountPut(stage: HTMLElement, panel: HTMLElement) {
  let alive = true;
  let nodes: PathNode[] = [];
  let lessons: LessonInfo[] = [];
  let sub: { destroy(): void } | null = null;

  const page = h(`<div class="kz-journal sheet kz-put"><h2>Путь кружка</h2><small class="hint">Раскрываю тетрадь…</small></div>`);
  const side = h(`<div class="kz-tr kz-put-side"></div>`);
  stage.appendChild(page);
  panel.appendChild(side);

  const toPath = () => {
    sub?.destroy();
    sub = null;
    page.hidden = false;
    side.hidden = false;
    render();
  };

  /** Узел, который идёт следом за этим на пути. */
  const after = (n: PathNode) => nodes[nodes.indexOf(n) + 1] ?? null;
  const nextBtn = (n: PathNode) => {
    const x = after(n);
    return x ? { label: `Дальше: ${x.title}`, on: () => openNode(x) } : undefined;
  };

  const openNode = (n: PathNode) => {
    Sound.ui();
    sub?.destroy();
    page.hidden = true;
    side.hidden = true;
    if (n.kind === 'lesson') {
      sub = mountLesson(stage, panel, n.lesson!, lessons, toPath, () => {}, { backLabel: 'К пути', next: nextBtn(n) });
    } else if (n.kind === 'game') {
      sub = mountGame(stage, panel, n.game!, toPath, 'К пути');
    } else {
      const exam = n.kind === 'exam';
      sub = mountTrainer(stage, panel, {
        drill: { themes: n.themes!, max: n.max, title: exam ? `зачёт — ${n.part.toLowerCase()}` : n.lesson!.title },
        back: { label: 'К пути', on: toPath },
        goal: {
          count: n.count!,
          onDone: () => completeNode(n.id, exam ? 30 : 5, exam ? `зачёт сдан: ${n.part}` : 'закрепление пройдено'),
          next: nextBtn(n),
        },
      });
    }
  };

  const render = () => {
    if (!alive || !nodes.length) return;
    const p = loadPath();
    const prog = loadProgress();
    const solved = Object.keys(prog.solved).length;
    const rank = rankOf(prog.rating, solved);
    const next = nextNode(nodes, p.done);
    const doneN = Object.keys(p.done).filter((k) => nodes.some((n) => n.id === k)).length;
    const parts = [...new Set(nodes.map((n) => n.part))];

    // ---- карта пути
    page.innerHTML =
      `<h2>Шахматный кружок</h2>
      <p class="kz-put-lead">Учимся играть в шахматы с нуля до разряда — как в кружке при Доме пионеров. Иди по <b>Пути</b>: урок на доске → задачи на закрепление → партия мастера → зачёт. За каждое занятие — звёзды, за часть — грамота, за задачи растёт разряд.</p>
      ${next ? `<button class="btn primary kz-put-go kz-put-go-top">▶ ${doneN ? 'Продолжить' : 'Начать'}: ${esc(next.title)}</button>` : ''}
      <div class="kz-put-more"><b>А ещё в кружке — на выбор, когда захочется:</b>
        <a href="${sectionPath('zadachi')}">🧩 <b>Задачи</b> — 6000 задач под твой рейтинг или по теме</a>
        <a href="${sectionPath('partii')}">♟ <b>Партии мастеров</b> — 37 классических партий с вопросом «А как сходил бы ты?»</a>
        <a href="${sectionPath('enciklopediya')}">📚 <b>Энциклопедия</b> — все дебюты по-русски и словарь терминов</a>
        <a href="${sectionPath('razbor')}">🔍 <b>Доска с движком</b> — разобрать свою партию: где ошибся и как надо было</a>
        <a href="${sectionPath('uchebnik')}">📖 <b>Учебник</b> — любой урок сразу, без порядка</a>
      </div>
      <h3 class="kz-put-h">Путь: пройдено ${doneN} из ${nodes.length}</h3>` +
      parts
        .map((part, pi) => {
          const sh = partShare(nodes, p.done, part);
          const dip = p.diplomas[part];
          return `<section class="kz-put-part${sh.done === sh.total ? ' full' : ''}">
            <h3><span>${pi + 1}. ${esc(part)}</span>${dip ? `<b class="kz-diploma" title="Грамота от ${esc(dip)}">🏅 грамота</b>` : ''}<small>${sh.done}/${sh.total}</small></h3>
            <i class="kz-put-bar" style="--w:${Math.round((sh.done / sh.total) * 100)}%"></i>
            <div class="kz-put-nodes">${nodes
              .filter((n) => n.part === part)
              .map((n) => {
                const st = n.id in p.done ? 'done' : n === next ? 'now' : 'ahead';
                return `<button class="kz-node ${n.kind} ${st}" data-id="${esc(n.id)}" title="${esc(n.title)}"><span>${ICON[n.kind]}</span><small>${esc(n.title)}</small>${st === 'done' ? '<em>✓</em>' : ''}</button>`;
              })
              .join('')}</div>
          </section>`;
        })
        .join('');
    page.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) => (b.onclick = () => openNode(nodes.find((n) => n.id === b.dataset.id)!)));
    const top = page.querySelector<HTMLButtonElement>('.kz-put-go-top');
    if (top && next) top.onclick = () => openNode(next);

    // ---- панель: Михалыч, «Дальше», успехи
    const hello = !doneN
      ? 'Здорово, что пришёл! Начнём с самого начала — с доски. Иди по пути по порядку: урок, потом задачи, потом партия мастера.'
      : next
        ? `С возвращением! Сегодня по плану — «${next.title.replace(/^\d+\.\s*/, '')}». Не спеши, ферзь не убежит.`
        : 'Весь путь пройден — снимаю кепку! Теперь решай задачи на рейтинг и разбирай партии мастеров.';
    side.innerHTML = `
      <div class="kz-put-mh"><img src="${PORTRAIT}" alt="Михалыч" width="56" height="56"><p>${esc(hello)}</p></div>
      ${next ? `<button class="btn primary kz-put-go">▶ ${next.id in p.done ? '' : 'Дальше: '}${esc(next.title)}</button>` : ''}
      <div class="kz-put-stats">
        <div><b>⭐ ${p.stars}</b><small>звёзд кружка</small></div>
        <div><b>${esc(rank.short)}</b><small>${rank.toFirst ? `разряд — после ${rank.toFirst} задач` : `рейтинг ${prog.rating.r}`}</small></div>
        <div><b>${dayStreak(prog)}</b><small>дней подряд</small></div>
        <div><b>${Object.keys(p.diplomas).length}</b><small>грамот</small></div>
      </div>
      <p class="hint"><small>Звёзды — за всё: урок +10, верный ход с первой попытки +2, задача +3, ход мастера +5, зачёт +30. Свободно решать задачи, листать партии и дебюты — во вкладках ниже.</small></p>`;
    const go = side.querySelector<HTMLButtonElement>('.kz-put-go');
    if (go && next) go.onclick = () => openNode(next);
  };

  void Promise.all([loadLessonIndex(), loadClassics().catch(() => [])])
    .then(([all, games]) => {
      if (!alive) return;
      lessons = all;
      nodes = buildPath(all);
      syncPath(nodes, loadDone(), loadAnswers(), Object.fromEntries(games.map((g) => [g.id, g.stops])));
      render();
    })
    .catch(() => (page.innerHTML = '<h2>Путь кружка</h2><p class="kz-err">Не удалось открыть тетрадь. Проверьте связь и откройте раздел ещё раз.</p>'));

  return {
    destroy() {
      alive = false;
      sub?.destroy();
      page.remove();
      side.remove();
    },
  };
}
