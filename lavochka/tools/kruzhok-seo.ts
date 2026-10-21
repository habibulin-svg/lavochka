/* Страницы шахматного кружка для пререндера (tools/prerender.ts): разделы (учебник, задачи, партии, разбор,
 * энциклопедия), урок, классическая партия с комментариями, семейство дебютов, словарь терминов.
 * Тексты — из данных кружка (уроки, партии, справочник дебютов, terms.json), без отдельного написания. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { play } from '../src/games/chess/engine';
import { fromUci, lineRu, position, ruSan, START_FEN } from '../src/games/chess/notation';
import type { ClassicGame, ClassicInfo, Lesson } from '../src/games/kruzhok/data';
import { classicPath, familyPath, lessonPath, sectionPath, termsPath } from '../src/games/kruzhok/pages';
import { stepPositions } from '../src/games/kruzhok/lesson-steps';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface KruzhokPage {
  path: string;
  /** Короткое имя для крошек и админки. */
  name: string;
  /** Крошки после «Шахматного кружка». */
  crumbs: [string, string][];
  title: string;
  description: string;
  h1: string;
  intro: string;
  body: string;
  priority: number;
}

/** «54 урока», «37 партий», «3 варианта». */
const num = (n: number, one: string, few: string, many: string) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;
const clip = (s: string, n = 160) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');

export function kruzhokPages(root: string): KruzhokPage[] {
  const src = join(root, 'src/games/kruzhok');
  const pub = join(root, 'public/kruzhok');
  const lessons = (JSON.parse(readFileSync(join(src, 'lessons/index.json'), 'utf8')) as Pick<Lesson, 'id' | 'n'>[])
    .map((l) => JSON.parse(readFileSync(join(src, 'lessons', `${String(l.n).padStart(2, '0')}-${l.id}.json`), 'utf8')) as Lesson)
    .sort((a, b) => a.n - b.n);
  const games = (JSON.parse(readFileSync(join(pub, 'games.json'), 'utf8')) as { g: ClassicInfo[] }).g.sort((a, b) => a.year - b.year);
  const openings = (JSON.parse(readFileSync(join(pub, 'openings.json'), 'utf8')) as { o: [string, string, string, string, string][] }).o.map(
    ([eco, name, uci, , ru]) => ({ eco, name, ru, uci: uci.split(' ') }),
  );
  const terms = (JSON.parse(readFileSync(join(src, 'terms.json'), 'utf8')) as { term: string; aka?: string[]; text: string; lesson?: string }[]).sort((a, b) =>
    a.term.localeCompare(b.term, 'ru'),
  );
  const out: KruzhokPage[] = [];
  const parts = [...new Set(lessons.map((l) => l.part))];

  // ---- семейства дебютов: где хотя бы 3 линии
  const fams = new Map<string, typeof openings>();
  for (const o of openings) {
    const f = o.ru.split(', ')[0];
    if (!fams.has(f)) fams.set(f, []);
    fams.get(f)!.push(o);
  }
  const bigFams = [...fams.entries()].filter(([, os]) => os.length >= 3).sort((a, b) => b[1].length - a[1].length);

  // ---- разделы
  const toc = parts
    .map((p) => `<h3>${esc(p)}</h3>\n<ol start="${lessons.find((l) => l.part === p)!.n}">${lessons.filter((l) => l.part === p).map((l) => `<li><a href="${lessonPath(l.id)}">${esc(l.title)}</a> — ${esc(l.goal)}</li>`).join('')}</ol>`)
    .join('\n');
  out.push({
    path: sectionPath('uchebnik'),
    name: 'Учебник',
    crumbs: [['Учебник', sectionPath('uchebnik')]],
    title: `Учебник шахмат для начинающих онлайн — ${num(lessons.length, 'урок', 'урока', 'уроков')}`,
    description: clip(`Шахматы с нуля: ${num(lessons.length, 'урок', 'урока', 'уроков')} на доске — как ходят фигуры, правила, первые маты, тактика, эндшпиль, дебют и стратегия. Каждый урок — с заданиями «Твой ход» и задачами для закрепления. Бесплатно.`),
    h1: 'Учебник шахмат: от первого хода до плана',
    intro: `<p>Учебник шахматного кружка ведёт от «как ходит ладья» до плана в середине партии. Каждый урок — на настоящей доске, шаг за шагом: стрелки, подсветка, показ ходов и задания «Твой ход», где ход делаешь сам. В конце урока — «Запомни» и задачи по теме из задачника кружка.</p>`,
    body: `<h2>Оглавление</h2>\n${toc}`,
    priority: 0.8,
  });
  out.push({
    path: sectionPath('zadachi'),
    name: 'Задачи',
    crumbs: [['Задачи', sectionPath('zadachi')]],
    title: 'Шахматные задачи онлайн по рейтингу и темам',
    description: clip('6000 шахматных задач из партий: мат в 1, 2 и 3 хода, вилки, связки, жертвы, эндшпили. Задачи подбираются под ваш рейтинг, растут разряды — от новичка до КМС. Бесплатно, без регистрации.'),
    h1: 'Шахматные задачи: решать по рейтингу или по теме',
    intro: `<p>Шесть тысяч задач из открытой базы Lichess — позиции из настоящих партий с проверенным решением. Задачи подбираются под ваш рейтинг, а можно выбрать тему: мат в 1–5 ходов, типовые маты, вилка, связка, линейный удар, отвлечение, завлечение, жертва, эндшпили.</p>
<p>Неверный ход остаётся на доске, и движок показывает, что на него есть у соперника. Рейтинг — по системе Глико, разряды — по-советски: юношеские, взрослые, кандидат в мастера.</p>`,
    body: '',
    priority: 0.8,
  });
  out.push({
    path: sectionPath('partii'),
    name: 'Партии',
    crumbs: [['Партии', sectionPath('partii')]],
    title: `Классические шахматные партии с комментариями — ${num(games.length, 'партия', 'партии', 'партий')}`,
    description: clip(`Знаменитые партии мастеров от Бессмертной (1851) до Таля: ${games.map((g) => g.title).slice(0, 4).join(', ')} и другие. В ключевых местах — вопрос «А как сходил бы ты?» с проверкой движком.`),
    h1: 'Классические партии: «А как сходил бы ты?»',
    intro: `<p>Партии великих мастеров прошлого — Андерсена, Морфи, Стейница, Чигорина, Ласкера, Капабланки, Алехина, Ботвинника, Таля. Листайте ход за ходом: комментарии объясняют идеи, а в ключевых местах доска останавливается и ждёт ваш ход. Нашли ход мастера — засчитано; нет — движок покажет, чем ваш ход слабее.</p>`,
    body: `<h2>Все партии</h2>\n<ul class="seo-links">${games.map((g) => `<li><a href="${classicPath(g.id)}">${esc(g.title)}</a> — ${esc(g.white)} — ${esc(g.black)}, ${esc(g.place)} ${g.year}</li>`).join('')}</ul>`,
    priority: 0.7,
  });
  out.push({
    path: sectionPath('razbor'),
    name: 'Разбор',
    crumbs: [['Разбор', sectionPath('razbor')]],
    title: 'Шахматный анализатор онлайн — разбор позиции Stockfish',
    description: clip('Разбор шахматной позиции онлайн: доска с движком Stockfish прямо в браузере — оценка, три лучших продолжения, стрелка лучшего хода. Можно расставить любую позицию по FEN. Бесплатно.'),
    h1: 'Разбор позиции с движком',
    intro: `<p>Доска разбора кружка: делайте ходы за обе стороны или вставьте свою позицию (FEN), а Stockfish — сильнейшая шахматная программа — посчитает оценку и три лучших продолжения. Движок работает прямо в браузере, ничего ставить не нужно.</p>`,
    body: '',
    priority: 0.6,
  });
  out.push({
    path: sectionPath('enciklopediya'),
    name: 'Энциклопедия',
    crumbs: [['Энциклопедия', sectionPath('enciklopediya')]],
    title: `Шахматные дебюты: названия и ходы — ${num(openings.length, 'вариант', 'варианта', 'вариантов')}`,
    description: clip(`Справочник шахматных дебютов по-русски: ${openings.length} вариантов с ходами и кодами ЭКО — сицилианская, испанская, ферзевый гамбит и другие. Поиск по названию, коду и ходам. Словарь шахматных терминов.`),
    h1: 'Энциклопедия: дебюты и термины',
    intro: `<p>Справочник дебютов (по открытому справочнику Lichess): ${openings.length} вариантов в ${fams.size} семействах, у каждого — ходы, код ЭКО и показ на доске. Ищите по названию («ферзевый гамбит»), коду («D35») или ходам («e4 c5 Кf3»). Плюс <a href="${termsPath()}">словарь шахматных терминов</a>.</p>`,
    body: `<h2>Главные дебюты</h2>\n<ul class="seo-links">${bigFams.map(([f, os]) => `<li><a href="${familyPath(f)}">${esc(f)}</a> — ${num(os.length, 'вариант', 'варианта', 'вариантов')}, ${esc(lineRu(START_FEN, os.reduce((a, b) => (a.uci.length <= b.uci.length ? a : b)).uci))}</li>`).join('')}</ul>`,
    priority: 0.7,
  });

  // ---- уроки
  for (const l of lessons) {
    const starts = stepPositions(l);
    const steps = l.steps
      .map((st, i) => {
        let t = `<p>${esc(st.text)}</p>`;
        if (st.try) {
          // ответ задания — для тех, кто читает страницу без доски
          let s = position(starts[i]);
          for (const u of st.play ?? []) {
            const m = fromUci(s, u);
            if (m) s = play(s, m);
          }
          const m = fromUci(s, st.try.good[0]);
          if (m) t += `\n<p><i>Ответ: ${esc(ruSan(s, m))}.</i>${st.try.say ? ' ' + esc(st.try.say) : ''}</p>`;
        }
        return t;
      })
      .join('\n');
    const prev = lessons.find((x) => x.n === l.n - 1);
    const next = lessons.find((x) => x.n === l.n + 1);
    out.push({
      path: lessonPath(l.id),
      name: `${l.n}. ${l.title}`,
      crumbs: [
        ['Учебник', sectionPath('uchebnik')],
        [l.title, lessonPath(l.id)],
      ],
      title: `${l.title} — урок шахмат ${l.n}`,
      description: clip(`${l.title}: ${l.goal} ${l.summary}`),
      h1: `Урок ${l.n}. ${l.title}`,
      intro: `<p><b>${esc(l.part)}.</b> ${esc(l.goal)} Урок на доске — с показом ходов и заданиями: откройте его в кружке и делайте ходы сами.</p>`,
      body: `${steps}\n<h2>Запомни</h2>\n<p>${esc(l.summary.replace(/^Запомни[:.!]?\s*/i, ''))}</p>\n<p class="seo-links">${prev ? `← <a href="${lessonPath(prev.id)}">${esc(prev.title)}</a>` : ''}${prev && next ? ' · ' : ''}${next ? `<a href="${lessonPath(next.id)}">${esc(next.title)}</a> →` : ''} · <a href="${sectionPath('uchebnik')}">Все уроки</a></p>`,
      priority: 0.6,
    });
  }

  // ---- партии
  const RES: Record<string, string> = { '1-0': 'победа белых', '0-1': 'победа чёрных', '1/2-1/2': 'ничья' };
  for (const info of games) {
    const g = JSON.parse(readFileSync(join(pub, 'games', `${info.id}.json`), 'utf8')) as ClassicGame;
    let s = position();
    const chunks: string[] = [];
    let run: string[] = [];
    g.uci.forEach((u, i) => {
      const m = fromUci(s, u);
      if (!m) return;
      if (i % 2 === 0) run.push(`${i / 2 + 1}.`);
      else if (!run.length) run.push(`${Math.floor(i / 2) + 1}...`);
      run.push(ruSan(s, m) + (g.marks[i] ?? ''));
      s = play(s, m);
      const note = g.notes[i];
      if (note) {
        chunks.push(`<p><b>${esc(run.join(' '))}</b></p>\n<p>${esc(note)}</p>`);
        run = [];
      }
    });
    if (run.length) chunks.push(`<p><b>${esc(run.join(' '))}</b></p>`);
    out.push({
      path: classicPath(g.id),
      name: g.title,
      crumbs: [
        ['Партии', sectionPath('partii')],
        [g.title, classicPath(g.id)],
      ],
      title: `${g.white} — ${g.black}, ${g.year}: «${g.title}» — партия с комментариями`,
      description: clip(`${g.title}: ${g.white} — ${g.black}, ${g.place} ${g.year}, ${RES[g.result] ?? g.result}. ${g.intro}`),
      h1: `${g.white} — ${g.black}: «${g.title}»`,
      intro: `<p><b>${esc(g.place)}, ${g.year}. Итог — ${RES[g.result] ?? g.result}.</b>${g.opening ? ` Дебют — <a href="${familyPath(g.opening.family)}">${esc(g.opening.ru)}</a>.` : ''} ${esc(g.intro)}</p><p>В кружке партию можно пролистать на доске: в ключевых местах она остановится и спросит «А как сходил бы ты?».</p>`,
      body: `<h2>Ход партии</h2>\n${chunks.join('\n')}\n${g.outro ? `<p>${esc(g.outro)}</p>` : ''}\n<p><a href="${sectionPath('partii')}">Все классические партии</a></p>`,
      priority: 0.5,
    });
  }

  // ---- семейства дебютов
  for (const [f, os] of bigFams) {
    const sorted = [...os].sort((a, b) => a.uci.length - b.uci.length || a.ru.localeCompare(b.ru, 'ru'));
    const main = sorted[0];
    const ecos = [...new Set(os.map((o) => o.eco))].sort();
    out.push({
      path: familyPath(f),
      name: f,
      crumbs: [
        ['Энциклопедия', sectionPath('enciklopediya')],
        [f, familyPath(f)],
      ],
      title: `${f}: ходы и варианты — ${num(os.length, 'линия', 'линии', 'линий')}`,
      description: clip(`${f} (${main.name.split(':')[0]}): ${lineRu(START_FEN, main.uci)}. ${num(os.length, 'вариант', 'варианта', 'вариантов')} с ходами и кодами ЭКО ${ecos[0]}${ecos.length > 1 ? '–' + ecos[ecos.length - 1] : ''}, показ на доске и разбор движком.`),
      h1: `${f}: варианты и ходы`,
      intro: `<p>${esc(f)} (по-английски — ${esc(main.name.split(':')[0])}) начинается ходами <b>${esc(lineRu(START_FEN, main.uci))}</b>. Код ЭКО — ${ecos.slice(0, 6).join(', ')}${ecos.length > 6 ? '…' : ''}. В справочнике кружка — ${num(os.length, 'вариант', 'варианта', 'вариантов')}; каждый можно посмотреть на доске и разобрать с движком.</p>`,
      body: `<h2>Варианты</h2>\n<ul class="seo-links">${sorted.slice(0, 80).map((o) => `<li><b>${esc(o.ru)}</b> (${o.eco}): ${esc(lineRu(START_FEN, o.uci))}</li>`).join('')}</ul>${sorted.length > 80 ? `<p>…и ещё ${sorted.length - 80} — в энциклопедии кружка.</p>` : ''}\n<p><a href="${sectionPath('enciklopediya')}">Все дебюты</a> · <a href="${termsPath()}">Словарь терминов</a></p>`,
      priority: 0.5,
    });
  }

  // ---- словарь терминов
  out.push({
    path: termsPath(),
    name: 'Термины',
    crumbs: [
      ['Энциклопедия', sectionPath('enciklopediya')],
      ['Термины', termsPath()],
    ],
    title: 'Шахматные термины: словарь от «шаха» до «цугцванга»',
    description: clip(`Словарь шахматных терминов простым языком: ${terms.slice(0, 8).map((t) => t.term.toLowerCase()).join(', ')} и ещё ${terms.length - 8} — с примерами на доске и ссылками на уроки.`),
    h1: 'Шахматные термины',
    intro: `<p>${terms.length} слов, которые нужны шахматисту: от правил (шах, пат, рокировка) до тактики (вилка, связка, отвлечение), эндшпиля (оппозиция, правило квадрата) и стратегии (форпост, плохой слон).</p>`,
    body: `<dl class="seo-faq">${terms
      .map((t) => {
        const l = t.lesson ? lessons.find((x) => x.id === t.lesson) : null;
        return `<dt>${esc(t.term)}${t.aka?.length ? ` (${esc(t.aka.join(', '))})` : ''}</dt><dd>${esc(t.text)}${l ? ` <a href="${lessonPath(l.id)}">Урок «${esc(l.title)}»</a>` : ''}</dd>`;
      })
      .join('')}</dl>`,
    priority: 0.6,
  });
  return out;
}

