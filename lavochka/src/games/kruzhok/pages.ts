/* Шахматный кружок — разделы и адреса страниц (без DOM: нужны экрану, пререндеру и тестам).
 * Раздел — свой адрес `/shahmatnyj-kruzhok/<раздел>/`; внутри — страницы урока, партии, семейства дебютов и словаря:
 * /shahmatnyj-kruzhok/uchebnik/<урок>/, /partii/<партия>/, /debyuty/<семейство>/, /terminy/. */

export const KRUZHOK_PATH = 'shahmatnyj-kruzhok';

export const MODES = [
  // «Путь» — первым: занятия по порядку, с него начинает новичок; остальное — свободно, на выбор
  { id: 'put', label: 'Путь', hint: 'занятия по порядку: урок → задачи → партия → зачёт', path: null },
  { id: 'uchebnik', label: 'Учебник', hint: 'от правил до стратегии, шаг за шагом', path: 'uchebnik' },
  { id: 'zadachi', label: 'Задачи', hint: 'решать по рейтингу или по теме', path: 'zadachi' },
  { id: 'partii', label: 'Партии', hint: 'классика: «А как сходил бы ты?»', path: 'partii' },
  { id: 'razbor', label: 'Доска с движком', hint: 'разобрать свою партию или позицию', path: 'razbor' },
  { id: 'enciklopediya', label: 'Энциклопедия', hint: 'дебюты и термины', path: 'enciklopediya' },
  { id: 'zhurnal', label: 'Журнал', hint: 'разряд, рейтинг, успехи', path: null },
] as const;

/** Вложенные страницы: часть адреса после кружка → раздел. */
const SUBS: Record<string, string> = { uchebnik: 'uchebnik', partii: 'partii', debyuty: 'enciklopediya', terminy: 'enciklopediya' };

const RU: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Адрес из русского названия: «Сицилианская защита» → «sicilianskaya-zashchita». */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map((c) => RU[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Что открыть по адресу: раздел и вложенная страница (урок, партия, «debyuty/<семейство>», «terminy»). */
export function parseKruzhok(pathname: string): { mode: string; sub?: string } | null {
  const parts = pathname.replace(/^\/+|\/+$/g, '').toLowerCase().split('/');
  if (parts[0] !== KRUZHOK_PATH || parts.length < 2) return null;
  const mode = MODES.find((m) => m.path === parts[1]);
  if (mode && parts.length === 2) return { mode: mode.id };
  const sub = SUBS[parts[1]];
  if (!sub) return null;
  if (parts[1] === 'terminy') return parts.length === 2 ? { mode: sub, sub: 'terminy' } : null;
  if (parts.length !== 3 || !/^[a-z0-9-]+$/.test(parts[2])) return null;
  return { mode: sub, sub: parts[1] === 'debyuty' ? `debyuty/${parts[2]}` : parts[2] };
}

export const lessonPath = (id: string) => `/${KRUZHOK_PATH}/uchebnik/${id}/`;
export const classicPath = (id: string) => `/${KRUZHOK_PATH}/partii/${id}/`;
export const familyPath = (family: string) => `/${KRUZHOK_PATH}/debyuty/${slug(family)}/`;
export const termsPath = () => `/${KRUZHOK_PATH}/terminy/`;
export const sectionPath = (mode: string) => {
  const m = MODES.find((x) => x.id === mode);
  return `/${KRUZHOK_PATH}/${m?.path ? m.path + '/' : ''}`;
};

/** Ушли со вложенной страницы (урок, партия, дебют, словарь) к списку — вернуть адрес раздела. */
export function leaveSub(mode: string) {
  if (typeof location !== 'undefined' && parseKruzhok(location.pathname)?.sub) setPath(sectionPath(mode));
}

/** Сменить адрес на месте (открыли урок, вернулись к списку) — без нового шага в истории. */
export function setPath(path: string) {
  if (typeof location !== 'undefined' && location.pathname !== path) history.replaceState(history.state, '', path);
}
