/* «Коммерсы»: данные — календарь 1988–2003, эпохи, исторические даты, ниши бизнеса, карточки клеток.
 * Деньги ядра — доллары (рубли — только витрина). Дизайн — docs/kommersy/DESIGN.md. */

// ---------------------------------------------------------------- календарь
/** Месяц партии: 0 — май 1988 (закон о кооперации). */
export const START_YEAR = 1988;
export const START_MONTH = 5;
/** Последний месяц — июль 2003 (покупка лондонского клуба). Партия кончается, когда календарь его прошёл. */
export const LAST = (2003 - START_YEAR) * 12 + 7 - START_MONTH;

export const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const yearOf = (m: number) => START_YEAR + Math.floor((m + START_MONTH - 1) / 12);
export const monthOf = (m: number) => (m + START_MONTH - 1) % 12;
export const mm = (year: number, month: number) => (year - START_YEAR) * 12 + month - START_MONTH;
export const dateText = (m: number) => `${MONTHS[monthOf(m)]} ${yearOf(m)}`;

/** Кризисные окна: там отрезок дороги — месяц, а не квартал (время «растягивается»). */
export const CRISIS: [number, number][] = [
  [mm(1991, 1), mm(1991, 3)],
  [mm(1991, 8), mm(1992, 6)],
  [mm(1994, 9), mm(1994, 12)],
  [mm(1998, 7), mm(1998, 12)],
];
export const inCrisis = (m: number) => CRISIS.some(([a, b]) => m >= a && m <= b);
/** Длина отрезка, начинающегося в месяце m. */
export const segMonths = (m: number) => (inCrisis(m) ? 1 : Math.min(3, Math.max(1, CRISIS.reduce((d, [a]) => (a > m ? Math.min(d, a - m) : d), 3))));

export type Era = 'soviet' | 'wild' | 'late' | 'new';
export const eraOf = (m: number): Era => (m < mm(1992, 1) ? 'soviet' : m < mm(1996, 1) ? 'wild' : m < mm(1999, 1) ? 'late' : 'new');
export const ERA_NAME: Record<Era, string> = { soviet: 'перестройка', wild: 'лихие', late: 'передел', new: 'нулевые' };

// ---------------------------------------------------------------- клетки
export type Cell = 'deal' | 'routine' | 'study' | 'rest' | 'news' | 'event' | 'naezd' | 'check' | 'period';
export const CELL_NAME: Record<Cell, string> = {
  deal: 'Сделка', routine: 'Рутина', study: 'Учёба', rest: 'Выходной', news: 'Новости', event: 'Событие', naezd: 'Наезд', check: 'Проверка', period: 'Новый квартал',
};
export const CELL_COLOR: Record<Cell, string> = {
  deal: '#3f9b4a', routine: '#e08a2c', study: '#e3c43a', rest: '#8a5bb8', news: '#3b7fc4', event: '#c9383a', naezd: '#2b2b2b', check: '#8b8f96', period: '#f2b632',
};
/** Доли клеток по эпохам: бандиты сильны в 1991–96, проверки растут после 1999. */
export const CELL_WEIGHTS: Record<Era, Partial<Record<Cell, number>>> = {
  soviet: { deal: 9, routine: 2, study: 2, rest: 2, news: 3, event: 1, naezd: 1, check: 2 },
  wild: { deal: 9, routine: 2, study: 2, rest: 2, news: 3, event: 1, naezd: 3, check: 1 },
  late: { deal: 9, routine: 2, study: 2, rest: 2, news: 3, event: 1, naezd: 2, check: 2 },
  new: { deal: 9, routine: 2, study: 2, rest: 2, news: 3, event: 1, naezd: 1, check: 3 },
};
/** Клеток в отрезке до «Нового квартала» (решение пользователя: плотнее, плиткой встык по дороге). */
export const SEG_CELLS = 10;

// ---------------------------------------------------------------- уровни (местности дороги)
export const TIERS = ['Двор', 'Ларёк', 'Барахолка', 'Центр', 'Область', 'Москва', 'Лондон'];
export const TIER_ID = ['dvor', 'kiosk', 'bazar', 'center', 'oblast', 'moscow', 'london'];
/** Капитал, с которого начинается уровень. */
export const TIER_AT = [0, 3e3, 3e4, 3e5, 3e6, 3e7, 1e8];
/** Масштаб трат и наград карточек по уровню. */
export const SCALE = [1, 8, 60, 500, 4000, 30000, 100000];
export const tierOf = (worth: number) => TIER_AT.reduce((t, at, i) => (worth >= at ? i : t), 0);

// ---------------------------------------------------------------- параметры Коляна
export type Stat = 'health' | 'mood' | 'stress' | 'name' | 'avt' | 'svyazi' | 'heat' | 'blizkie' | 'sovest';
export const STAT_NAME: Record<Stat, string> = {
  health: 'Здоровье', mood: 'Настроение', stress: 'Стресс', name: 'Имя', avt: 'Авторитет', svyazi: 'Связи', heat: 'Внимание органов', blizkie: 'Близкие', sovest: 'Совесть',
};
/** Скрытые от соперников (а совесть и точное внимание органов — и от самого игрока: только намёк). */
export const HIDDEN: Stat[] = ['heat', 'sovest'];
export const STAT_RANGE: Record<Stat, [number, number]> = {
  health: [0, 100], mood: [-50, 50], stress: [0, 100], name: [0, 100], avt: [0, 100], svyazi: [0, 100], heat: [0, 100], blizkie: [0, 100], sovest: [0, 100],
};
export type Skill = 'trade' | 'schet' | 'bazar' | 'sila' | 'english' | 'poryadok';
export const SKILL_NAME: Record<Skill, string> = { trade: 'Торговля', schet: 'Счёт', bazar: 'Базар', sila: 'Сила', english: 'Английский', poryadok: 'Порядок' };
export const SKILL_MAX = 5;

export type Krysha = 'none' | 'bandit' | 'police' | 'own';
export const KRYSHA_NAME: Record<Krysha, string> = { none: 'без крыши', bandit: 'братва', police: 'менты', own: 'своя охрана' };

// ---------------------------------------------------------------- герои (сеть — состав холдема, у каждого своя предыстория)
export interface Hero {
  id: string;
  name: string;
  story: string;
  cash: number;
  stats: Partial<Record<Stat, number>>;
  skills: Partial<Record<Skill, number>>;
}
const H = (id: string, name: string, story: string, cash: number, stats: Hero['stats'], skills: Hero['skills']): Hero => ({ id, name, story, cash, stats, skills });
export const HEROES: Hero[] = [
  H('kolyan', 'Колян', 'ПТУ и армия, пришёл из армии на Затулинку с дембельскими', 300, { avt: 15 }, { sila: 2, bazar: 1 }),
  H('seryoga', 'Серёга', 'старше всех, отсидел по молодости, уважают во дворе', 200, { avt: 30, name: 10, heat: 10 }, { sila: 1, bazar: 2 }),
  H('vovka', 'Вовка', 'фарцевал у гостиницы, знает, где взять и кому продать', 500, { svyazi: 10 }, { trade: 2 }),
  H('lenka', 'Ленка', 'продавщица из универмага, знает весь дефицит наперечёт', 350, { blizkie: 70 }, { trade: 1, bazar: 1 }),
  H('svetka', 'Светка', 'бухгалтер с завода, считает быстрее калькулятора', 300, { name: 30 }, { schet: 2 }),
  H('dimon', 'Димон', 'самый молодой, ничего не боится и всюду лезет', 150, { mood: 15, health: 90 }, { sila: 1, poryadok: 0 }),
  H('tanka', 'Танька', 'парикмахерша, у неё стрижётся полрайона — и все рассказывают новости', 250, { blizkie: 75, svyazi: 10 }, { bazar: 2 }),
  H('zheka', 'Жека', 'студент НГУ из Академгородка, английский и компьютеры', 200, { name: 25 }, { english: 2, schet: 1 }),
  H('mihalych', 'Михалыч', 'бывший завскладом, все начальники — его старые знакомые', 600, { svyazi: 30, health: 60 }, { schet: 1, trade: 1 }),
];

export const BASE: Record<Stat, number> = { health: 80, mood: 0, stress: 20, name: 20, avt: 10, svyazi: 5, heat: 0, blizkie: 60, sovest: 70 };

// ---------------------------------------------------------------- ниши бизнеса и активы
export type Kind = 'biz' | 'estate' | 'paper';
export interface DealT {
  id: string;
  name: string;
  kind: Kind;
  tier: number;
  /** Окно, когда ниша живая: с какого месяца появляется, когда стареет (дальше доход падает). */
  from: number;
  peak: number;
  /** Цена, доход в месяц, часы в месяц. */
  price: number;
  income: number;
  hours: number;
  /** Вероятность «плохого месяца» за отрезок. */
  risk: number;
  /** Во что вырастает (решение по бизнесу на «Новостях»). */
  next?: string;
  need?: { svyazi?: number; krysha?: boolean; skill?: Partial<Record<Skill, number>>; avt?: number };
  /** Тёмная ниша: внимание органов растёт каждый квартал. */
  heat?: number;
  /** Чувствительность к кризису 0…1. */
  crisis?: number;
  /** Доходность бумаги — рост цены в месяц (доход не платит). */
  grow?: number;
  /** Гибнет в этом месяце (МММ, ГКО). */
  dies?: number;
  text: string;
}
const D = (id: string, name: string, kind: Kind, tier: number, from: number, peak: number, price: number, income: number, hours: number, risk: number, text: string, more: Partial<DealT> = {}): DealT =>
  ({ id, name, kind, tier, from, peak, price, income, hours, risk, text, ...more });

const y = (year: number, month = 1) => mm(year, month);
export const DEALS: DealT[] = [
  // уровень 0 — двор, перестройка
  D('deficit', 'Перепродажа дефицита', 'biz', 0, 0, y(1991, 6), 150, 45, 30, 0.15, 'Сапоги, кассеты, джинсы — взять у знакомой из универмага и продать на Затулинке.'),
  D('varenki', 'Кооператив «варёнки»', 'biz', 0, 0, y(1991, 1), 600, 160, 60, 0.15, 'Варить джинсы с хлоркой в баке у тёти Вали. Очередь из девчонок.', { next: 'odezhda' }),
  D('videosalon', 'Видеосалон', 'biz', 0, 0, y(1992, 6), 1500, 380, 50, 0.1, 'Видак, телевизор и подвал при ЖЭКе. «Рэмбо» по рублю.', { next: 'videoprokat' }),
  D('izvoz', 'Извоз на «копейке»', 'biz', 0, 0, y(1994, 1), 1200, 140, 80, 0.1, 'Старая «копейка» — бомбить ночами у вокзала.'),
  D('garazh', 'Гараж под сдачу', 'estate', 0, 0, y(1999, 1), 700, 25, 2, 0.02, 'Железный гараж в ряду за теплотрассой.'),
  // нулевые — для тех, кто начинает (или поднимается) заново
  D('shaurma', 'Шаурма у метро', 'biz', 0, y(1997, 1), y(2003, 7), 1200, 330, 60, 0.15, 'Вертел, лаваш и окошко у входа в метро.'),
  D('moyka', 'Автомойка', 'biz', 1, y(1997, 1), y(2003, 7), 6000, 1500, 50, 0.1, 'Бокс в гаражах, керхер и двое пацанов.'),
  D('sotovye', 'Салон сотовой связи', 'biz', 1, y(1998, 1), y(2003, 7), 9000, 2400, 50, 0.12, 'Трубки, подключения, чехлы — очередь после работы.', { next: 'set-magazinov' }),
  D('internet', 'Интернет-кафе', 'biz', 1, y(1999, 1), y(2003, 7), 7000, 1700, 40, 0.1, 'Десять компьютеров, «Контра» по ночам.'),
  D('remont', 'Ремонт квартир', 'biz', 2, y(1997, 1), y(2003, 7), 25000, 6500, 70, 0.12, 'Бригада, «евроремонт» под ключ для новых русских.'),
  // уровень 1 — ларёк, лихие
  D('larek', 'Ларёк у остановки', 'biz', 1, y(1991, 11), y(1995, 6), 3000, 900, 60, 0.2, 'Железная будка: сигареты, «Сникерсы», спирт «Рояль».', { next: 'set-larkov', crisis: 0.3 }),
  D('chelnok', 'Челнок: Турция', 'biz', 1, y(1991, 9), y(1996, 6), 2000, 700, 90, 0.2, 'Клетчатые сумки, Лалели, кожанки и свитера — назад через таможню.', { next: 'konteyner' }),
  D('yaponki', 'Перегон японок', 'biz', 1, y(1990, 1), y(1997, 6), 6000, 1700, 70, 0.2, 'Самолётом во Владивосток, обратно своим ходом на праворуких «Короллах».', { next: 'avtosalon' }),
  D('obmennik', 'Обменник', 'biz', 1, y(1992, 2), y(1998, 8), 8000, 2000, 40, 0.15, 'Будка с окошком: доллары, марки, курс мелом.', { need: { krysha: true }, crisis: 0.6 }),
  D('videoprokat', 'Видеопрокат', 'biz', 1, y(1991, 6), y(1997, 1), 4000, 950, 30, 0.1, 'Полки кассет, пиратские переводы гнусавым голосом.', { next: 'teleka' }),
  D('odezhda', 'Цех пошива', 'biz', 1, y(1990, 1), y(1996, 1), 5000, 1300, 70, 0.15, 'Шесть машинок в бывшем красном уголке: «турецкие» спортивки.'),
  D('vauchery', 'Скупка ваучеров', 'paper', 1, y(1992, 10), y(1994, 6), 3000, 0, 20, 0, 'Скупать ваучеры у проходной по две бутылки водки за штуку.', { grow: 0.08, dies: y(1994, 7), next: 'dolya-zavoda' }),
  D('kvartira', 'Квартира под сдачу', 'estate', 1, y(1992, 1), y(2003, 7), 9000, 220, 4, 0.03, 'Двушка в хрущёвке — сдавать студентам.'),
  // уровень 2 — барахолка
  D('set-larkov', 'Сеть ларьков', 'biz', 2, y(1993, 1), y(1997, 6), 30000, 8500, 80, 0.2, 'Десять будок по району, свои грузчики и «Газель».', { crisis: 0.3 }),
  D('konteyner', 'Контейнеры на барахолке', 'biz', 2, y(1992, 6), y(1999, 1), 20000, 5200, 60, 0.15, 'Ряд контейнеров на Гусинобродской: опт китайского ширпотреба.', { next: 'opt' }),
  D('opt', 'Оптовый склад', 'biz', 2, y(1993, 6), y(2000, 1), 60000, 15000, 90, 0.15, 'Ангар на окраине, фуры из Китая и Казахстана.', { next: 'set-magazinov' }),
  D('magazin', 'Магазин', 'biz', 2, y(1993, 1), y(2001, 1), 50000, 10500, 60, 0.12, 'Бывший гастроном: витрины, кассы, охранник.', { next: 'set-magazinov' }),
  D('avtosalon', 'Автосалон', 'biz', 2, y(1994, 1), y(2001, 1), 120000, 26000, 70, 0.15, 'Площадка с иномарками и вагончик-офис.', { crisis: 0.5 }),
  D('palenka', 'Водочный цех', 'biz', 2, y(1993, 1), y(1999, 1), 40000, 15000, 50, 0.2, 'Спирт «Рояль», вода, этикетки — розлив в подвале.', { heat: 6 }),
  D('mmm', 'Билеты МММ', 'paper', 2, y(1994, 2), y(1994, 7), 20000, 0, 2, 0, '«Я не халявщик, я партнёр!» Цена растёт каждую неделю.', { grow: 0.35, dies: y(1994, 8) }),
  // уровень 3 — центр
  D('bank', 'Коммерческий банк', 'biz', 3, y(1993, 1), y(1998, 8), 500000, 105000, 120, 0.12, 'Лицензия, особняк с колоннами, бронированная дверь.', { need: { svyazi: 35 }, crisis: 0.9 }),
  D('barter', 'Бартер с заводом', 'biz', 3, y(1993, 6), y(1999, 6), 300000, 70000, 80, 0.15, 'Зачёты, векселя и вагоны труб в обмен на сахар.', { need: { svyazi: 20 } }),
  D('set-magazinov', 'Сеть магазинов', 'biz', 3, y(1995, 1), y(2003, 7), 400000, 82000, 100, 0.1, 'Двадцать магазинов под одной вывеской.'),
  D('dolya-zavoda', 'Доля в заводе', 'biz', 3, y(1994, 1), y(2001, 1), 800000, 125000, 40, 0.1, 'Пакет акций приватизированного завода — и место в совете директоров.', { need: { svyazi: 25 }, next: 'metall' }),
  D('ofis', 'Офис в центре', 'estate', 3, y(1994, 1), y(2003, 7), 300000, 6500, 5, 0.03, 'Этаж в сталинке на Красном проспекте.'),
  D('gko', 'ГКО', 'paper', 3, y(1993, 5), y(1998, 7), 200000, 0, 3, 0, 'Государственные облигации: доходность выше любой торговли.', { grow: 0.06, dies: y(1998, 8) }),
  D('teleka', 'Кабельное ТВ', 'biz', 3, y(1996, 1), y(2003, 7), 350000, 60000, 60, 0.1, 'Кабель по подъездам, свой канал с рекламой.', { next: 'telekanal' }),
  // уровень 4 — область
  D('metall', 'Металлотрейдинг', 'biz', 4, y(1996, 1), y(2002, 1), 5e6, 1.3e6, 120, 0.15, 'Никель и алюминий эшелонами — через офшор.', { need: { svyazi: 40, krysha: true } }),
  D('razrez', 'Угольный разрез', 'biz', 4, y(1997, 1), y(2003, 7), 1e7, 2e6, 100, 0.12, 'Разрез в Кузбассе, БелАЗы и своя железнодорожная ветка.', { need: { svyazi: 35 }, next: 'holding' }),
  D('telekanal', 'Телеканал', 'biz', 4, y(1997, 1), y(2003, 7), 3e6, 420000, 80, 0.1, 'Областной канал: новости, реклама, выборы.', { need: { svyazi: 30 } }),
  D('skupka', 'Скупка после дефолта', 'biz', 4, y(1998, 9), y(2000, 6), 2e6, 850000, 60, 0.15, 'Всё, что рухнуло в августе, — за копейки.', { need: { skill: { schet: 2 } } }),
  D('tc', 'Торговый центр', 'estate', 4, y(1999, 1), y(2003, 7), 6e6, 125000, 10, 0.03, 'Стекло, эскалаторы и арендаторы на трёх этажах.'),
  // уровень 5 — Москва
  D('neft', 'Доля в нефтяной компании', 'biz', 5, y(1999, 6), y(2003, 7), 3e7, 5.5e6, 100, 0.1, 'Пакет акций сибирской нефтянки — через московских партнёров.', { need: { svyazi: 55 } }),
  D('holding', 'Холдинг', 'biz', 5, y(2000, 1), y(2003, 7), 5e7, 8e6, 120, 0.08, 'Уголь, металл и сталь под одной крышей.', { need: { svyazi: 50 } }),
  D('rublevka', 'Особняк на Рублёвке', 'estate', 5, y(1999, 1), y(2003, 7), 1e7, 90000, 5, 0.02, 'Сосны, забор в три метра, охрана на въезде.'),
];
export const dealById = (id: string) => DEALS.find((d) => d.id === id);

/** Доход ниши в месяц m: до пика — полный, потом стареет к 35 % за два года. */
export function nicheMul(d: DealT, m: number) {
  if (m <= d.peak) return 1;
  return Math.max(0.35, 1 - (0.65 * (m - d.peak)) / 24);
}

// ---------------------------------------------------------------- карточки клеток
/** Последствия выбора. Деньги — в долларах; cashT — в масштабе уровня (× SCALE[уровень] × 100). */
export interface Fx {
  cash?: number;
  cashT?: number;
  /** Доля наличных (−0.3 — потерять 30 %). */
  cashPct?: number;
  stats?: Partial<Record<Stat, number>>;
  skills?: Partial<Record<Skill, number>>;
  krysha?: Krysha;
  enemy?: number;
  /** Отсидка / больница / запой / бегство: месяцы вне дороги. */
  jail?: number;
  hosp?: number;
  away?: number;
  prep?: string;
  /** Постоянная прибавка свободных часов (водитель, мобильник). */
  hoursBonus?: number;
  /** Ежемесячный расход (помощники, страховка) — масштабируется уровнем, если upkeepT. */
  upkeepT?: number;
  /** Часы на учёбу в этом отрезке. */
  studyHours?: number;
  /** Малая мечта (квартира матери, «мерс»…). */
  dream?: string;
  /** Разовая покупка: водитель, пейджер, мобильник — второй раз не предлагается. */
  item?: string;
  insurance?: boolean;
  advisor?: boolean;
  /** Касается одного своего дела: хороший/плохой месяц (× дохода), рост, выкуп. */
  asset?: 'good' | 'bad' | 'grow' | 'sell' | 'fire';
  /** Захват/раздел ниши: доход всех дел ×. */
  incomeBoost?: number;
}

export interface Choice {
  label: string;
  fx: Fx;
  /** Условие доступности. */
  need?: { cashT?: number; skill?: Partial<Record<Skill, number>>; stat?: Partial<Record<Stat, number>>; krysha?: boolean; noKrysha?: boolean; asset?: boolean; growable?: boolean };
  /** Тёмный поступок — помечается в интерфейсе. */
  dark?: boolean;
  /** Шанс неудачи и что тогда. */
  risk?: { p: number; skill?: Skill; fx: Fx; text: string };
}

export interface CardT {
  id: string;
  cell: Cell;
  title: string;
  text: string;
  from?: number;
  to?: number;
  minTier?: number;
  maxTier?: number;
  choices: Choice[];
}
const C = (id: string, cell: Cell, title: string, text: string, choices: Choice[], more: Partial<CardT> = {}): CardT => ({ id, cell, title, text, choices, ...more });
const ok = (label: string, fx: Fx = {}, more: Partial<Choice> = {}): Choice => ({ label, fx, ...more });

export const CARDS: CardT[] = [
  // ---- рутина: траты растут с уровнем («начинаешь шиковать»)
  C('r-kabak', 'routine', 'Посидели', 'Встретил пацанов со двора — до утра в кабаке.', [ok('Гулять так гулять', { cashT: -0.6, stats: { mood: 8, health: -4, blizkie: 3 } }), ok('Посидел часок и домой', { cashT: -0.15, stats: { mood: 2 } })]),
  C('r-slomal', 'routine', 'Сломалось', 'Полетела коробка у машины — опять в гараж.', [ok('Чинить у знакомого', { cashT: -0.4, stats: { mood: -3 } }), ok('Отдать в сервис', { cashT: -0.8 })]),
  C('r-podarok', 'routine', 'День рождения матери', 'Мать ждёт в гости, надо с подарком.', [ok('Поехать с подарком', { cashT: -0.3, stats: { blizkie: 8, mood: 4 } }), ok('Некогда, позвоню', { stats: { blizkie: -8, sovest: -2 } })]),
  C('r-probka', 'routine', 'День насмарку', 'Встреча сорвалась, весь день на ногах впустую.', [ok('Ну и ладно', { studyHours: 20, stats: { stress: 5 } })]),
  C('r-shik', 'routine', 'Шикануть', 'Увидел в комке кожаный плащ до пят. Как у бригадира.', [ok('Беру', { cashT: -0.7, stats: { mood: 6, avt: 2 } }), ok('Перебьюсь', { stats: { mood: -2 } })]),
  C('r-zub', 'routine', 'Зуб', 'Разболелся зуб — неделю не до работы.', [ok('К платному врачу', { cashT: -0.3, stats: { health: 2 } }), ok('Перетерплю', { stats: { health: -6, mood: -4 } })]),
  C('r-dolg', 'routine', 'Просит в долг', 'Друг детства просит денег — у него беда.', [ok('Дать', { cashT: -0.4, stats: { blizkie: 6, sovest: 3 } }), ok('Отказать', { stats: { blizkie: -6, sovest: -2 } })]),
  // ---- учёба
  C('s-buh', 'study', 'Курсы бухгалтеров', 'Вечерние курсы при ДК: двойная запись, баланс, налоги.', [ok('Записаться', { cashT: -0.3, skills: { schet: 1 }, studyHours: 40 }), ok('Не до того')]),
  C('s-english', 'study', 'Английский', 'Репетитор из НГУ берёт учеников. «Без языка в Лондоне делать нечего».', [ok('Учить', { cashT: -0.4, skills: { english: 1 }, studyHours: 50 }), ok('Потом')], { from: mm(1990, 1) }),
  C('s-torg', 'study', 'Школа торговли', 'Семинар заезжего «бизнес-тренера»: маркетинг, закупки, наценка.', [ok('Пойти', { cashT: -0.3, skills: { trade: 1 }, studyHours: 30 }), ok('Ерунда это')]),
  C('s-bazar', 'study', 'Переговоры', 'Старый цеховик учит, как разговаривать с людьми.', [ok('Слушать', { cashT: -0.2, skills: { bazar: 1 }, studyHours: 25 }), ok('Сам умею')]),
  C('s-sport', 'study', 'Качалка', 'В подвале открылась качалка. Там же решаются дела.', [ok('Ходить', { cashT: -0.1, skills: { sila: 1 }, stats: { health: 5, avt: 2 }, studyHours: 25 }), ok('Без меня')]),
  C('s-poryadok', 'study', 'Ежедневник', 'Бухгалтерша показала, как планировать неделю. Часы перестают утекать.', [ok('Попробовать', { cashT: -0.1, skills: { poryadok: 1 }, studyHours: 15 }), ok('И так помню')]),
  C('s-london', 'study', 'Языковая школа в Лондоне', 'Месяц в Лондоне: язык с утра до вечера и знакомства с юристами.', [ok('Поехать', { cashT: -1, skills: { english: 1 }, studyHours: 60, stats: { svyazi: 2 } }), ok('Некогда')], { minTier: 3 }),
  C('s-repetitor', 'study', 'Репетитор-англичанин', 'Настоящий англичанин преподаёт в Академгородке. Дорого, зато с произношением.', [ok('Заниматься', { cashT: -0.6, skills: { english: 1 }, studyHours: 40 }), ok('Обойдусь')], { from: mm(1992, 1), minTier: 2 }),
  C('s-pc', 'study', 'Компьютерные курсы', '«Лексикон», таблицы и модем. Говорят, за этим будущее.', [ok('Пойти', { cashT: -0.3, skills: { schet: 1 }, studyHours: 30 }), ok('Не моё')], { from: mm(1993, 1) }),
  // ---- выходной: отдых, близкие, знакомства, малые мечты
  C('w-dacha', 'rest', 'Дача', 'Выходные на даче у матери: картошка, баня, тишина.', [ok('Поехать', { stats: { mood: 8, health: 5, stress: -10, blizkie: 6 } }), ok('Работать', { stats: { stress: 5, blizkie: -4 } })]),
  C('w-banya', 'rest', 'Баня с нужными людьми', 'Знакомый зовёт в баню — там будет человек из исполкома.', [ok('Пойти с коньяком', { cashT: -0.3, stats: { svyazi: 7, health: -2 } }), ok('Отказаться', { stats: { mood: 2 } })]),
  C('w-turciya', 'rest', 'Турция', 'Путёвка на море — впервые в жизни.', [ok('Слетать', { cashT: -1, stats: { mood: 12, stress: -15, health: 4 } }), ok('Не время', { stats: { mood: -2 } })], { from: mm(1993, 1) }),
  C('w-devushka', 'rest', 'Вечер с ней', 'Сходить в кино, как раньше, без телефона и пейджера.', [ok('Сходить', { stats: { mood: 6, blizkie: 8, stress: -6 } }), ok('Дела', { stats: { blizkie: -6 } })]),
  C('w-mvd', 'rest', 'Рыбалка с опером', 'Сосед-опер зовёт на рыбалку. Свой человек в органах.', [ok('Поехать', { cashT: -0.1, stats: { svyazi: 5, heat: -5, mood: 3 } }), ok('Не люблю ментов', { stats: { avt: 2 } })]),
  C('w-chinovnik', 'rest', 'Охота с чиновником', 'Зам главы района зовёт на охоту. Говорят, решает всё по земле и лицензиям.', [ok('Поехать с ружьём и коньяком', { cashT: -0.5, stats: { svyazi: 9, health: -1 } }), ok('Не поеду')], { minTier: 1 }),
  C('w-deputat', 'rest', 'Депутат', 'Областной депутат ищет «друзей» перед выборами.', [ok('Подружиться', { cashT: -1, stats: { svyazi: 10, heat: 3 } }), ok('Держаться подальше', { stats: { name: 2 } })], { minTier: 3 }),
  C('w-moskva', 'rest', 'Москва', 'Знакомый зовёт в Москву: «Познакомлю с людьми, которые решают».', [ok('Лететь', { cashT: -1, stats: { svyazi: 12 }, studyHours: 20 }), ok('Мне и здесь хорошо')], { minTier: 4 }),
  C('w-zemlyak', 'rest', 'Земляк в Лондоне', 'Однокурсник давно живёт в Лондоне. Возьмётся вести дела: язык, юристы, банки.', [ok('Взять в советники', { upkeepT: 0.8, advisor: true, stats: { svyazi: 2 } }), ok('Сам разберусь')], { minTier: 3 }),
  C('w-charity', 'rest', 'Детдом', 'Директор детдома просит помочь с ремонтом.', [ok('Помочь', { cashT: -0.6, stats: { name: 6, sovest: 8, mood: 5 } }), ok('Самим не хватает')]),
  C('w-mama', 'rest', 'Квартира матери', 'Мать всю жизнь в коммуналке. Купить ей квартиру — мечта.', [ok('Купить', { cash: -9000, dream: 'mama', stats: { mood: 15, blizkie: 15, sovest: 5 } }), ok('Потом')], { minTier: 1 }),
  C('w-mers', 'rest', '«Мерседес»', 'Шестисотый в отличном состоянии. Чтоб все видели.', [ok('Взять', { cash: -60000, dream: 'mers', hoursBonus: 15, stats: { mood: 12, avt: 6, heat: 3 } }), ok('Рано')], { minTier: 2 }),
  C('w-svadba', 'rest', 'Свадьба', 'Пора жениться — она ждёт уже три года.', [ok('Играем свадьбу', { cashT: -1.2, dream: 'svadba', stats: { mood: 15, blizkie: 20, stress: -10 }, upkeepT: 0.1 }), ok('Ещё не время', { stats: { blizkie: -10 } })], { from: mm(1990, 1) }),
  // ---- новости: предупреждения об исторических датах, решения по бизнесу, удачи и беды
  C('n-pavlov', 'news', 'Слух из банка', 'Знакомая из сберкассы шепчет: крупные купюры скоро отменят.', [ok('Поменять всё на доллары и товар', { cashPct: -0.05, prep: 'pavlov' }), ok('Сказки')], { from: mm(1990, 6), to: mm(1991, 1) }),
  C('n-ceny', 'news', 'Цены отпустят', 'По телевизору Гайдар. Все говорят — с января цены отпустят.', [ok('Вложиться в товар', { cashPct: -0.05, prep: 'ceny' }), ok('Не верю')], { from: mm(1991, 6), to: mm(1992, 1) }),
  C('n-black', 'news', 'Рубль шатается', 'Знакомый банкир советует: держи в долларах, осенью будет жарко.', [ok('Перевести в доллары', { cashPct: -0.03, prep: 'black' }), ok('Обойдётся')], { from: mm(1994, 3), to: mm(1994, 10) }),
  C('n-default', 'news', 'ГКО пахнут жареным', 'Московский знакомый: «Пирамида ГКО скоро лопнет. Выходи из рублей».', [ok('Выйти в доллары', { cashPct: -0.04, prep: 'default' }), ok('Государство не обманет')], { from: mm(1997, 10), to: mm(1998, 8) }),
  C('n-vybory', 'news', 'Выборы', 'Штаб кандидата ищет спонсоров. Победит — не забудет.', [ok('Дать денег', { cashT: -1.5, prep: 'vybory', stats: { svyazi: 5 } }), ok('Я вне политики')], { from: mm(1996, 1), to: mm(1996, 6) }),
  C('n-good', 'news', 'Хороший месяц', 'Касса пошла: одно из дел принесло вдвое больше.', [ok('Отлично', { asset: 'good' }, { need: { asset: true } })]),
  C('n-bad', 'news', 'Плохой месяц', 'Недостача, порча, поставщик подвёл.', [ok('Пережить', { asset: 'bad' }, { need: { asset: true } })]),
  C('n-grow', 'news', 'Расширяться?', 'Дело выросло из штанишек — можно перейти на новый уровень.', [ok('Расширить', { asset: 'grow' }, { need: { growable: true } }), ok('Пока рано')]),
  C('n-vykup', 'news', 'Предложение о выкупе', 'Солидные люди хотят купить одно из твоих дел — дорого.', [ok('Продать', { asset: 'sell' }, { need: { asset: true } }), ok('Не продаётся')]),
  C('n-voditel', 'news', 'Водитель', 'Есть надёжный парень — возить и встречать.', [ok('Нанять', { upkeepT: 0.15, hoursBonus: 25, item: 'voditel' }), ok('Сам вожу')], { minTier: 2 }),
  C('n-pager', 'news', 'Пейджер', 'Пейджер — и больше не надо сидеть у телефона.', [ok('Купить', { cashT: -0.2, hoursBonus: 10, item: 'pager' }), ok('Обойдусь')], { from: mm(1994, 1), to: mm(1997, 12) }),
  C('n-mobila', 'news', 'Мобильник', 'Трубка размером с кирпич. Дорого, но всё решается на ходу.', [ok('Купить', { cashT: -0.5, hoursBonus: 20, item: 'mobila' }), ok('Обойдусь')], { from: mm(1996, 1) }),
  C('n-strah', 'news', 'Страховка', 'Страховой агент: пожар, кража, авария — всё покроем.', [ok('Застраховаться', { upkeepT: 0.05, insurance: true }), ok('Пронесёт')], { from: mm(1992, 1) }),
  C('n-advisor', 'news', 'Советник из Лондона', 'Эмигрант из МГИМО берётся вести дела на Западе — язык, юристы, банки.', [ok('Нанять', { upkeepT: 1.2, advisor: true }), ok('Сам выучу')], { minTier: 3 }),
  C('n-sponsor', 'news', 'Спонсорство', 'Городской праздник ищет спонсора: имя на афише, мэр пожмёт руку.', [ok('Стать спонсором', { cashT: -0.8, stats: { name: 6, svyazi: 5 } }), ok('Без меня')], { from: mm(1993, 1), minTier: 2 }),
  C('n-krysha', 'news', 'Охранное агентство', 'Знакомый полковник открыл «охранное агентство». Берёт дорого, зато с погонами.', [ok('Под ментов', { krysha: 'police', cashT: -0.5, stats: { svyazi: 4, avt: -3 } }), ok('Не надо')], { from: mm(1994, 1), minTier: 2 }),
  C('n-ndfl', 'news', 'Выйти из тени', 'Новый налоговый кодекс: 13 % для всех. Можно обелиться.', [ok('Обелить бухгалтерию', { cashT: -1, stats: { heat: -20, name: 8 } }), ok('Жить как жили')], { from: mm(2001, 1) }),
  // ---- события: семья, здоровье, форс-мажоры
  C('e-pozhar', 'event', 'Пожар', 'Ночью сгорела точка. Проводка или подожгли — не разберёшь.', [ok('Восстанавливать', { asset: 'fire' }, { need: { asset: true } })]),
  C('e-bolezn', 'event', 'Свалился', 'Воспаление лёгких — месяц в больнице.', [ok('Лечиться', { hosp: 1, cashT: -0.3, stats: { health: -10 } })]),
  C('e-mat', 'event', 'Мать болеет', 'Матери плохо, нужны лекарства и уход.', [ok('Всё бросить и к ней', { cashT: -0.5, studyHours: 40, stats: { blizkie: 12, sovest: 4 } }), ok('Отправить денег', { cashT: -0.8, stats: { blizkie: 2 } }), ok('Некогда', { stats: { blizkie: -15, sovest: -6 } })]),
  C('e-rebenok', 'event', 'Ребёнок', 'Она беременна.', [ok('Ура!', { stats: { mood: 15, blizkie: 15 }, upkeepT: 0.1, studyHours: 20 })], { from: mm(1990, 1) }),
  C('e-ograb', 'event', 'Ограбили', 'Вскрыли квартиру — забрали всё, что было наличными.', [ok('Пережить', { cashPct: -0.3, stats: { mood: -8 } })]),
  C('e-drug', 'event', 'Друг подставил', 'Компаньон исчез вместе с выручкой.', [ok('Искать', { cashPct: -0.15, stats: { mood: -6, avt: 3 }, enemy: 1 }), ok('Простить', { cashPct: -0.15, stats: { sovest: 4, mood: -8 } })]),
  // ---- наезды
  C('k-reket', 'naezd', 'Рэкет', 'К точке подъехала «девятка» с тонировкой. «Кто вас крышует?»', [
    ok('Платить', { cashT: -0.8, stats: { mood: -4, avt: -3 } }, { need: { noKrysha: true } }),
    ok('Встать под них', { krysha: 'bandit', stats: { avt: 3, heat: 5 } }, { need: { noKrysha: true } }),
    ok('Послать', { stats: { avt: 8 } }, { need: { noKrysha: true }, risk: { p: 0.55, skill: 'sila', fx: { hosp: 1, stats: { health: -20 } }, text: 'Поломали в подъезде.' } }),
    ok('«Вопросы к моим людям»', { stats: { avt: 2 } }, { need: { krysha: true } }),
  ], { minTier: 0 }),
  C('k-strelka', 'naezd', 'Стрелка', 'Конкуренты забили стрелку за точку.', [
    ok('Ехать с братвой', { stats: { avt: 8, heat: 8, sovest: -3 } }, { need: { krysha: true }, risk: { p: 0.3, skill: 'bazar', fx: { hosp: 2, stats: { health: -25 }, enemy: 1 }, text: 'Стрелка кончилась стрельбой.' } }),
    ok('Договориться', { cashT: -0.6, stats: { name: 3 } }, { risk: { p: 0.3, skill: 'bazar', fx: { cashT: -1 }, text: 'Договор вышел дорогим.' } }),
    ok('Уступить точку', { asset: 'bad', stats: { avt: -8, mood: -5 } }),
  ], { from: mm(1991, 6) }),
  C('k-krysha-dan', 'naezd', 'Крыша просит', 'Крыша поднимает долю: «время сейчас сложное».', [
    ok('Платить больше', { cashT: -1, stats: { mood: -3 } }, { need: { krysha: true } }),
    ok('Сменить на ментов', { krysha: 'police', cashT: -0.8, stats: { avt: -6, svyazi: 5 }, enemy: 1 }, { need: { krysha: true } }),
    ok('Своя охрана', { krysha: 'own', cashT: -3, stats: { avt: 4 } }, { need: { krysha: true, cashT: 3 } }),
  ], { minTier: 1 }),
  C('k-zakaz', 'naezd', 'Конкурент мешает', 'Один человек давит на рынке и не уступает. «Можно решить вопрос насовсем».', [
    ok('Заказать', { cashT: -4, incomeBoost: 1.25, enemy: 2, stats: { sovest: -45, heat: 35, avt: 10, mood: -10 } }, { dark: true, need: { cashT: 4 } }),
    ok('Натравить крышу', { incomeBoost: 1.1, enemy: 1, stats: { sovest: -12, heat: 12 } }, { dark: true, need: { krysha: true } }),
    ok('Демпинг — честно', { cashT: -0.8, incomeBoost: 1.05, stats: { name: 2 } }),
    ok('Поделить рынок', { stats: { name: 4 } }),
  ], { minTier: 2 }),
  C('k-pokushenie', 'naezd', 'Покушение', 'У подъезда взорвалась машина. Метили в тебя.', [ok('Выжить', { hosp: 2, stats: { health: -30, mood: -15, stress: 20 } }), ok('Уехать на время', { away: 4, stats: { mood: -8 } })], { minTier: 2 }),
  C('k-kinul', 'naezd', 'Кинуть партнёра', 'Партнёр по сделке зазевался — можно уйти со всей суммой.', [
    ok('Кинуть', { cashT: 2, enemy: 1, stats: { name: -15, sovest: -15 } }, { dark: true }),
    ok('Честно', { stats: { name: 4, sovest: 3 } }),
  ], { minTier: 1 }),
  C('k-reyd', 'naezd', 'Рейдерский захват', 'Можно отжать чужой цех: суд, печать, охрана — всё куплено.', [
    ok('Захватить', { cashT: 3, enemy: 1, stats: { name: -12, sovest: -12, heat: 15 } }, { dark: true, need: { stat: { svyazi: 30 } } }),
    ok('Не моё', { stats: { sovest: 2 } }),
  ], { from: mm(1996, 1), minTier: 3 }),
  // ---- проверки
  C('c-nalog', 'check', 'Налоговая', 'Налоговая полиция: «Предъявите документы за три года».', [
    ok('Занести', { cashT: -0.6, stats: { svyazi: 3, heat: 6 } }, { dark: true }),
    ok('Заплатить штраф по закону', { cashT: -1.2, stats: { heat: -10, name: 4 } }),
    ok('Бухгалтерия в порядке', { stats: { heat: -6 } }, { need: { skill: { schet: 2 } } }),
  ], { from: mm(1992, 3) }),
  C('c-obep', 'check', 'ОБЭП', 'Пришли из ОБЭП: «Откуда товар?»', [
    ok('Договориться', { cashT: -0.5, stats: { heat: 4 } }, { dark: true }),
    ok('Звонок наверх', { stats: { svyazi: -3 } }, { need: { stat: { svyazi: 35 } } }),
    ok('Показать накладные', { cashT: -0.3, stats: { heat: -4 } }, { risk: { p: 0.3, skill: 'schet', fx: { cashT: -1.5, stats: { heat: 10 } }, text: 'Нашли «левак».' } }),
  ]),
  C('c-ses', 'check', 'СЭС и пожарные', 'Санстанция и пожарные — «нарушения на каждом шагу».', [
    ok('Сунуть конверт', { cashT: -0.3, stats: { heat: 2 } }, { dark: true }),
    ok('Устранить', { cashT: -0.6, stats: { name: 2 } }),
  ]),
  C('c-palenka', 'check', 'Отравление', 'В районе отравились палёной водкой. Ищут, чья.', [
    ok('Затаиться', { stats: { heat: 15, sovest: -10 } }, { dark: true }),
    ok('Закрыть цех и помочь пострадавшим', { cashT: -2, stats: { heat: -5, sovest: 10, name: -5 } }),
  ], { from: mm(1993, 1), to: mm(1999, 12) }),
  C('c-uchastkovy', 'check', 'Участковый', 'Участковый интересуется: «На какие шиши живём?»', [
    ok('Угостить', { cashT: -0.15, stats: { svyazi: 2 } }), ok('Показать трудовую', { stats: { heat: -2 } }),
  ], { to: mm(1993, 12) }),
  // ==== пополнение колоды: писали агенты Sonnet, вычитано и выверено по балансу (2026-11-02)
  // ---- рутина
  C('r-talony', 'routine', 'Талоны на водку', 'Талоны на месяц отоварили. Водка — валюта: ею платят сантехнику и гаишнику.', [ok('Отоварить и держать для дела', { cashT: -0.2, stats: { svyazi: 3 } }), ok('Выпить с пацанами', { cashT: -0.1, stats: { mood: 5, health: -3 } }), ok('Продать с наценкой', { cashT: 0.2, stats: { sovest: -1 } })], { to: mm(1991, 12), maxTier: 1 }),
  C('r-ochered', 'routine', 'Очередь', 'Выбросили колбасу. Очередь на квартал, а дел полно.', [ok('Отстоять', { studyHours: 15, cashT: -0.1, stats: { stress: 4, blizkie: 3 } }), ok('Нанять бабку в очередь', { cashT: -0.25 }), ok('Плюнуть, есть макароны', { stats: { mood: -3 } })], { to: mm(1991, 12), maxTier: 1 }),
  C('r-videosalon', 'routine', 'Видеосалон', 'Сосед открыл видеосалон в подвале: боевики с гнусавым переводом.', [ok('Сходить всей толпой', { cashT: -0.15, stats: { mood: 6, stress: -4 } }), ok('Вложиться в кассеты', { cashT: -0.4, stats: { svyazi: 2 }, asset: 'good' }, { need: { asset: true } }), ok('Некогда', { stats: { mood: -1 } })], { from: mm(1989, 6), to: mm(1995, 12), maxTier: 2 }),
  C('r-sneakers', 'routine', 'Сникерс', 'У ларька дети давятся слюной над «Сникерсом». Свой пацан смотрит так же.', [ok('Купить коробку на всю семью', { cashT: -0.3, stats: { mood: 5, blizkie: 6 } }), ok('По одному', { cashT: -0.1, stats: { mood: 2 } }), ok('Сласти — это баловство', { stats: { blizkie: -2 } })], { from: mm(1992, 1), to: mm(1996, 12), maxTier: 1 }),
  C('r-stiralka', 'routine', 'Стиралка', 'Дома сдохла «Вятка». Мать стирает руками и молчит.', [ok('Импортную с Барахолки', { cashT: -0.8, stats: { blizkie: 8, mood: 3 } }), ok('Отремонтировать «Вятку»', { cashT: -0.25, stats: { blizkie: 2 } }), ok('Потерпят', { stats: { blizkie: -6, sovest: -2 } })], { from: mm(1989, 1), to: mm(1996, 12), maxTier: 2 }),
  C('r-gai', 'routine', 'ГАИшник', 'Гаишник машет жезлом: «Превысили, командир». Торопишься.', [ok('Сунуть сотню', { cashT: -0.25, stats: { heat: 2 } }, { dark: true }), ok('Оформить штраф', { cashT: -0.1, studyHours: 10, stats: { stress: 3 } }), ok('Позвонить знакомому в УВД', { stats: { svyazi: -2 } }, { need: { stat: { svyazi: 25 } } })], { from: mm(1992, 1), minTier: 1, maxTier: 4 }),
  C('r-internet', 'routine', 'Интернет-кафе', 'На Красном открылось интернет-кафе. Почта, «аська», картинки грузятся по часу.', [ok('Посидеть часок', { cashT: -0.15, stats: { mood: 3 } }), ok('Завести почту и сайт', { cashT: -0.5, hoursBonus: 3, stats: { name: 2 } }), ok('Не моё', {})], { from: mm(1998, 6), maxTier: 4 }),
  C('r-remont', 'routine', 'Евроремонт', 'Пора обновить квартиру. Бригада из Турции берёт дорого, сделает как у людей.', [ok('Евроремонт под ключ', { cashT: -1.5, stats: { mood: 10, blizkie: 6, avt: 2 } }), ok('Косметика своими руками', { cashT: -0.4, studyHours: 15, stats: { stress: 5, health: -2 } }), ok('Ещё годик так', { stats: { blizkie: -3 } })], { from: mm(1996, 1), minTier: 2, maxTier: 4 }),
  C('r-kostyum', 'routine', 'Костюм на заказ', 'Портной из ателье для начальства зовёт на примерку: пиджак, жилет и три галстука.', [ok('Заказать пять костюмов', { cashT: -1.2, stats: { avt: 4, mood: 5 } }), ok('Один, но хороший', { cashT: -0.5, stats: { avt: 2 } }), ok('Хожу как хожу', { stats: { avt: -1 } })], { from: mm(1996, 1), minTier: 4 }),
  C('r-restoran', 'routine', 'Деловой обед', 'Партнёр зовёт в ресторан: сказал, что платит, но смотрит на меню по-хозяйски.', [ok('Заплатить за всех', { cashT: -1, stats: { name: 4, svyazi: 3 } }), ok('Разделить счёт', { cashT: -0.4, stats: { name: -1 } }), ok('Отказаться', { stats: { svyazi: -2 } })], { from: mm(1995, 1), minTier: 3 }),
  C('r-golf', 'routine', 'Гольф-клуб', 'В Лондоне деловые вопросы решаются на траве: членство стоит как квартира.', [ok('Вступить в клуб', { cashT: -2.5, stats: { svyazi: 9, name: 5, mood: 3 } }), ok('Играть как гость', { cashT: -0.8, stats: { svyazi: 3 } }), ok('Деньги лучше вложить', { stats: { svyazi: -1 } })], { minTier: 5 }),
  // ---- события
  C('e-zaliv', 'event', 'Соседи залили', 'Сверху прорвало трубу: обои плывут, по стенам ручьи.', [ok('Выставить счёт соседям', { cashT: -0.2, stats: { stress: 5, blizkie: -2 } }), ok('Починить самому', { cashT: -0.5, studyHours: 15, stats: { stress: 3 } }), ok('Вызвать ЖЭК', { cashT: -0.1, stats: { stress: 8, mood: -3 } })], { to: mm(2003, 7), maxTier: 3 }),
  C('e-avariya', 'event', 'Авария', 'Подрезала иномарка — крыло в лепёшку. Водитель делает вид, что глухой.', [ok('Решить на месте', { cashT: -0.6, stats: { stress: 5 } }, { risk: { p: 0.25, skill: 'sila', fx: { hosp: 1, stats: { health: -12 } }, text: 'Разговор перешёл в мордобой.' } }), ok('Вызвать ГАИ', { cashT: -1, studyHours: 20, stats: { mood: -4 } }), ok('Плюнуть и ехать', { stats: { mood: -6, avt: -2 } })], { from: mm(1992, 1), minTier: 1 }),
  C('e-ugon', 'event', 'Угнали', 'Утром под окном пусто. Новенькая машина — ушла на разборку.', [ok('Искать через братву', { cashT: -0.4, stats: { avt: 3, heat: 2 } }, { need: { krysha: true } }), ok('Ждать милицию', { cashT: -1, stats: { mood: -8, stress: 8 } }), ok('Купить такую же', { cashT: -2.5, stats: { mood: 3 } }, { need: { cashT: 3 } })], { from: mm(1992, 6), minTier: 2 }),
  C('e-teshcha', 'event', 'Тёща', 'Тёща приехала «на недельку». Сидит уже второй месяц.', [ok('Терпеть и улыбаться', { stats: { stress: 8, blizkie: 3 } }), ok('Купить ей путёвку в санаторий', { cashT: -0.5, stats: { blizkie: 5, stress: -4 } }), ok('Объясниться', { stats: { blizkie: -8, stress: 4 } })], { from: mm(1990, 1), maxTier: 4 }),
  C('e-infarkt', 'event', 'Сердце', 'Прихватило в кабинете: «Скорая», капельница, сухие врачи.', [ok('Лечиться как положено', { hosp: 2, cashT: -0.8, stats: { health: -8, stress: -20 } }), ok('Выписаться под расписку', { hosp: 1, stats: { health: -15, stress: 5 } })], { from: mm(1996, 1), minTier: 3 }),
  C('e-brat', 'event', 'Брат из армии', 'Младший брат вернулся из армии. Работы нет, глаза голодные.', [ok('Взять к себе', { cashT: -0.3, stats: { blizkie: 8, sovest: 3, svyazi: 2 } }), ok('Дать денег на первое время', { cashT: -0.5, stats: { blizkie: 3 } }), ok('Пусть сам', { stats: { blizkie: -8, sovest: -3 } })], { to: mm(2002, 12), maxTier: 3 }),
  C('e-shkola', 'event', 'Школа звонит', 'Классная вызывает: сын подрался и выбил зуб однокласснику.', [ok('Пойти и заплатить за зуб', { cashT: -0.3, stats: { blizkie: 4, name: 2 } }), ok('Выпороть пацана', { stats: { blizkie: -4, stress: 3 } }), ok('Научить давать сдачи', { stats: { blizkie: 3, avt: 1 } })], { from: mm(1993, 9), maxTier: 3 }),
  C('e-lotereya', 'event', 'Лотерея', 'Купил билет «Русского лото» на сдачу — и там три цифры сошлись.', [ok('Забрать выигрыш', { cashT: 1.5, stats: { mood: 10 } })], { from: mm(1994, 6) }),
  C('e-nasledstvo', 'event', 'Наследство', 'Умерла дальняя тётка в Кемерове. Оставила дом и сад, а в серванте — кое-что в долларах.', [ok('Продать дом', { cashT: 1.2, stats: { mood: 4, sovest: -1 } }), ok('Оставить, ездить на дачу', { cashT: 0.4, stats: { blizkie: 5, mood: 6 } })], { from: mm(1990, 1), maxTier: 4 }),
  C('e-dolg-vernul', 'event', 'Вернули долг', 'Знакомый, у кого ты занимал два года назад, вдруг приехал и вернул всё с благодарностью.', [ok('Принять', { cashT: 0.8, stats: { name: 3, mood: 5 } }), ok('Отказаться, угостить его', { cashT: 0.2, stats: { svyazi: 4, blizkie: 3 } })], { maxTier: 4 }),
  C('e-pai', 'event', 'Свой человек', 'Старый приятель уезжает за границу и отдаёт тебе долю в мелком деле — «на, пригодится».', [ok('Принять долю', { cashT: 0.6, stats: { svyazi: 4, mood: 4 } }), ok('Выкупить его место за доллары', { cashT: -0.4, stats: { name: 3 }, asset: 'grow' }, { need: { growable: true } })], { from: mm(1991, 1), to: mm(1999, 12), maxTier: 4 }),
  C('e-krestiny', 'event', 'Крестины', 'Позвали крёстным к племяннику. Отказаться — обидеть, прийти — вложиться.', [ok('Приехать с подарком', { cashT: -0.4, stats: { blizkie: 7, mood: 4 } }), ok('Отправить деньги в конверте', { cashT: -0.25, stats: { blizkie: 2 } }), ok('Отговориться делами', { stats: { blizkie: -6, sovest: -2 } })], { maxTier: 4 }),
  // ---- наезды
  C('k-sportsmeny', 'naezd', 'Спортсмены', 'В кооператив зашли двое в трениках и кожанках: «Охрана нужна? Недорого».', [
    ok('Заплатить', { cashT: -0.4, stats: { mood: -3, avt: -2 } }, { need: { noKrysha: true } }),
    ok('Взять в долю', { krysha: 'bandit', stats: { avt: 3, heat: 4 } }, { need: { noKrysha: true } }),
    ok('Сказать «я сам спортсмен»', { stats: { avt: 6 } }, { need: { noKrysha: true }, risk: { p: 0.45, skill: 'sila', fx: { hosp: 1, cashT: -0.5, stats: { health: -15 } }, text: 'Объяснили кулаками.' } }),
  ], { from: mm(1989, 1), to: mm(1991, 12), maxTier: 1 }),
  C('k-vaucher', 'naezd', 'Ваучеры сюда', 'Двое советуют сдать им ваучеры по «справедливой цене». Цена смешная.', [
    ok('Отдать', { cashT: 0.3, stats: { mood: -4, avt: -3 } }),
    ok('Спрятать и уйти', { stats: { avt: -2, stress: 6 } }),
    ok('Позвонить своим', { stats: { avt: 4, heat: 4 } }, { need: { krysha: true } }),
  ], { from: mm(1992, 10), to: mm(1994, 6), maxTier: 2 }),
  C('k-kidala', 'naezd', 'Предоплата', 'Поставщик взял предоплату и пропал. Телефон не отвечает, склад пустой.', [
    ok('Искать с братвой', { cashT: 0.6, stats: { avt: 4, heat: 6, sovest: -4 } }, { need: { krysha: true }, dark: true, risk: { p: 0.35, skill: 'bazar', fx: { cashT: -0.5, enemy: 1 }, text: 'Нашли не того.' } }),
    ok('Подать в милицию', { cashT: -1.2, stats: { name: 2, stress: 6 } }),
    ok('Списать убыток', { cashT: -1.2, stats: { mood: -4 } }),
  ], { from: mm(1992, 3), to: mm(1999, 12), minTier: 1 }),
  C('k-razborka', 'naezd', 'Разборка', 'Чужая бригада предъявляет: «Это наша территория». Ваши пацаны не согласны.', [
    ok('Идти на стрелку', { stats: { avt: 8, heat: 8, sovest: -3 } }, { need: { krysha: true }, dark: true, risk: { p: 0.35, skill: 'sila', fx: { hosp: 2, stats: { health: -25 }, enemy: 1 }, text: 'Приехали с «волынами».' } }),
    ok('Откупиться', { cashT: -1.2, stats: { mood: -4 } }),
    ok('Сдать точку', { asset: 'bad', stats: { avt: -8, mood: -5 } }),
  ], { from: mm(1993, 1), to: mm(1997, 12), minTier: 1 }),
  C('k-obshchak', 'naezd', 'В общак', 'Смотрящий просит «поучаствовать». Сумма круглая, отказ не принимается.', [
    ok('Дать', { cashT: -1.2, stats: { avt: 3, heat: 3 } }),
    ok('Дать меньше', { cashT: -0.5, stats: { avt: -3, stress: 6 } }, { risk: { p: 0.4, skill: 'bazar', fx: { cashT: -1, stats: { health: -10 } }, text: 'Обиделись, взяли своё.' } }),
    ok('Откажу', { stats: { avt: 6 } }, { need: { krysha: true } }),
  ], { from: mm(1994, 1), to: mm(1999, 12), minTier: 2 }),
  C('k-chop', 'naezd', 'Охранное предприятие', 'Бывшие бандиты открыли ЧОП и пришли с договором: «Теперь всё по закону».', [
    ok('Подписать', { cashT: -0.9, stats: { mood: -3, heat: -3 } }, { need: { noKrysha: true } }),
    ok('Взять охрану у полиции', { krysha: 'police', cashT: -0.8, stats: { svyazi: 4, avt: -2 } }),
    ok('Нанять своих', { krysha: 'own', cashT: -2.5, stats: { avt: 4 } }, { need: { cashT: 3 } }),
  ], { from: mm(1997, 6), minTier: 2 }),
  C('k-reyder', 'naezd', 'Чужой реестр', 'Фирму «законно» переписали на однодневку. Печать уже не твоя.', [
    ok('Нанять юристов', { cashT: -2, stats: { stress: 10, name: 3 } }, { risk: { p: 0.4, skill: 'schet', fx: { asset: 'bad', cashT: -1 }, text: 'Судья на их стороне.' } }),
    ok('Заплатить', { cashT: -3, stats: { avt: -5, mood: -6 } }),
    ok('Перехватить', { cashT: 1.5, stats: { sovest: -8, heat: 10 } }, { dark: true, need: { stat: { svyazi: 30 } } }),
  ], { from: mm(1999, 1), minTier: 3 }),
  C('k-maski', 'naezd', 'Маски-шоу', 'В офис вошли люди в масках: «Оперативное мероприятие». Изъяли компьютеры и бумаги.', [
    ok('Звонок наверх', { stats: { svyazi: -4, heat: -4 } }, { need: { stat: { svyazi: 35 } } }),
    ok('Откупить бумаги', { cashT: -2.5, stats: { heat: 6 } }, { dark: true }),
    ok('Ждать суда', { cashT: -1, stats: { stress: 12, name: -4 } }),
  ], { from: mm(2000, 1), minTier: 3 }),
  // ---- проверки
  C('c-torgovaya', 'check', 'Торговая инспекция', 'Инспектор со значком проверяет весы, ценники и срок годности.', [
    ok('Договориться', { cashT: -0.2, stats: { heat: 2 } }, { dark: true }),
    ok('Всё по закону', { cashT: -0.3, stats: { name: 2 } }),
    ok('Показать документы', { stats: { heat: -2 } }, { need: { skill: { poryadok: 1 } } }),
  ], { from: mm(1991, 1), maxTier: 3 }),
  C('c-tamozhnya', 'check', 'Таможня', 'Фуру с товаром задержали на границе: «Декларация не сходится».', [
    ok('Занести', { cashT: -1, stats: { heat: 6, sovest: -3 } }, { dark: true }),
    ok('Платить пошлину', { cashT: -1.8, stats: { name: 3 } }),
    ok('Подождать неделю', { cashT: -0.4, stats: { stress: 8 } }, { risk: { p: 0.35, skill: 'schet', fx: { cashT: -1.2 }, text: 'Товар обесценился.' } }),
  ], { from: mm(1992, 1), minTier: 1 }),
  C('c-kkm', 'check', 'Кассовый аппарат', 'Налоговый инспектор проверяет ККМ. Кассы нет, чеки на салфетках.', [
    ok('Купить аппарат', { cashT: -0.8, stats: { heat: -4 } }),
    ok('Откупиться', { cashT: -0.3, stats: { heat: 4 } }, { dark: true }),
    ok('Пообещать завтра', { stats: { stress: 4 } }, { risk: { p: 0.5, skill: 'poryadok', fx: { cashT: -1 }, text: 'Выписали штраф.' } }),
  ], { from: mm(1993, 6), to: mm(2003, 7), maxTier: 3 }),
  C('c-sanknizhka', 'check', 'Санкнижки', 'СЭС проверяет у продавцов санкнижки. У половины их нет.', [
    ok('Быстро оформить', { cashT: -0.3, stats: { name: 2 } }),
    ok('Сунуть конверт', { cashT: -0.2, stats: { heat: 3 } }, { dark: true }),
    ok('Закрыть на день', { cashT: -0.5, stats: { mood: -3 } }),
  ], { minTier: 1, maxTier: 3 }),
  C('c-pozharka', 'check', 'Пожарный надзор', 'Пожарный инспектор: огнетушители просрочены, запасный выход заперт, проводка самодельная.', [
    ok('Исправить', { cashT: -1, stats: { name: 3 } }),
    ok('Договориться', { cashT: -0.4, stats: { heat: 3 } }, { dark: true }),
    ok('Спорить', { stats: { stress: 6 } }, { risk: { p: 0.4, skill: 'bazar', fx: { cashT: -1.5, stats: { heat: 5 } }, text: 'Опечатали склад.' } }),
  ], { from: mm(1993, 1), minTier: 2 }),
  C('c-licenziya', 'check', 'Лицензия', 'Лицензионная палата проверяет разрешения. Без лицензии торговать спиртным нельзя.', [
    ok('Оформить лицензию', { cashT: -1.5, stats: { heat: -6, name: 4 } }),
    ok('Заплатить посреднику', { cashT: -0.7, stats: { svyazi: 3, heat: 4 } }, { dark: true }),
    ok('Убрать водку с полок', { cashT: -0.8, stats: { mood: -4 } }),
  ], { from: mm(1995, 1), minTier: 1 }),
  C('c-ocheredi', 'check', 'Проверки пошли косяком', 'За месяц зашли пожарные, труд, налоговая и санитары. Каждый чего-то хочет.', [
    ok('Нанять юриста', { cashT: -2, stats: { stress: -4, heat: -6 } }),
    ok('Всем занести', { cashT: -1, stats: { heat: 8, sovest: -4 } }, { dark: true }),
    ok('Принимать по очереди', { cashT: -0.6, stats: { stress: 12 } }),
  ], { from: mm(1999, 6), minTier: 2 }),
  C('c-prokuratura', 'check', 'Прокуратура', 'Следователь вызывает по «заявлению о нарушениях». Заявил кто-то конкурентный.', [
    ok('Нанять адвоката', { cashT: -2, stats: { heat: -8, stress: 5 } }),
    ok('Решить вопрос', { cashT: -1.2, stats: { heat: 8, sovest: -4 } }, { dark: true }),
    ok('Звонок наверх', { stats: { svyazi: -5 } }, { need: { stat: { svyazi: 40 } } }),
  ], { from: mm(2000, 1), minTier: 3 }),
  // ---- учёба
  C('s-zaochka', 'study', 'Заочка', 'Экономфак в НИНХ, заочное. Сессия два раза в год, зато диплом и дебет с кредитом.', [ok('Поступить', { cashT: -0.5, skills: { schet: 1 }, studyHours: 45 }), ok('Диплом мне ни к чему', { stats: { mood: 1 } })], { from: mm(1990, 9), maxTier: 3 }),
  C('s-kursy', 'study', 'Курсы менеджеров', 'Объявление на столбе: «Станьте менеджером за 3 месяца». Диплом с печатью.', [ok('Записаться', { cashT: -0.4, skills: { trade: 1 }, studyHours: 35 }), ok('Столб — не авторитет')], { from: mm(1993, 1), to: mm(2000, 12), maxTier: 3 }),
  C('s-kniga', 'study', 'Книжка про людей', 'Сосед отдал зачитанную книжку: как располагать к себе и вести переговоры.', [ok('Прочесть от корки до корки', { skills: { bazar: 1 }, studyHours: 20, stats: { stress: -2 } }), ok('Лучше телевизор')], { from: mm(1991, 1), maxTier: 2 }),
  C('s-borba', 'study', 'Секция борьбы', 'Старый тренер набирает группу в спортзале школы. Кулаки в нашем деле не лишние.', [ok('Ходить', { cashT: -0.1, skills: { sila: 1 }, studyHours: 30, stats: { health: 4, avt: 2 } }), ok('Здоровье дороже')], { maxTier: 3 }),
  C('s-school', 'study', 'Бизнес-школа', 'Вечерняя «Бизнес-школа» при университете: планирование, отчётность, расписание.', [ok('Записаться', { cashT: -1, skills: { poryadok: 1 }, studyHours: 40, stats: { name: 2 } }), ok('Некогда учиться')], { from: mm(1995, 1), minTier: 2, maxTier: 4 }),
  C('s-mba', 'study', 'MBA', 'Двухлетний курс в Лондоне для тех, кому есть что терять. Английский — до зубов.', [ok('Уехать на сессию', { cashT: -2.5, skills: { english: 1 }, studyHours: 60, stats: { svyazi: 4, name: 3 } }), ok('Время — деньги')], { from: mm(1996, 1), minTier: 5 }),
  // ---- выходной
  C('w-shashlyk', 'rest', 'Шашлыки на Оби', 'Пацаны зовут на берег: мангал, водка, гитара. Комары не в счёт.', [ok('Поехать', { cashT: -0.2, stats: { mood: 8, stress: -8, blizkie: 4, health: -1 } }), ok('Остаться на работе', { stats: { stress: 3 } })], { maxTier: 3 }),
  C('w-klass', 'rest', 'Встреча выпускников', 'Бывшие одноклассники собираются в кафе. Кто-то уже при делах, кто-то просит в долг.', [ok('Прийти при параде', { cashT: -0.4, stats: { svyazi: 5, mood: 4, avt: 2 } }), ok('Не пойду', { stats: { blizkie: -3 } })], { maxTier: 3 }),
  C('w-akadem', 'rest', 'Академгородок', 'Вечер в Академе: барды, физики и девчонки в свитерах. Разговоры до утра.', [ok('Съездить', { cashT: -0.1, stats: { mood: 6, stress: -8, svyazi: 3 } }), ok('Далеко')], { maxTier: 3 }),
  C('w-beloku', 'rest', 'Белокуриха', 'Санаторий на Алтае: грязи, горы, режим. Спина скажет спасибо.', [ok('Взять путёвку', { cashT: -0.8, stats: { health: 8, stress: -12, mood: 5 } }), ok('Не время', { stats: { stress: 2 } })], { minTier: 2, maxTier: 4 }),
  C('w-teatr', 'rest', 'Опера в оперном', 'Директор банка пригласил в ложу на премьеру. Фрак, шампанское, нужные люди.', [ok('Пойти во фраке', { cashT: -0.7, stats: { svyazi: 8, name: 3, mood: 3 } }), ok('Я не театрал', { stats: { name: -1 } })], { minTier: 3, maxTier: 4 }),
  C('w-kipr', 'rest', 'Кипр с яхтой', 'Партнёр приглашает на яхту у берегов Кипра: бизнес под парусом.', [ok('Поплыть', { cashT: -1.5, stats: { svyazi: 10, mood: 10, stress: -14 } }), ok('Укачивает', { stats: { svyazi: -1 } })], { from: mm(1995, 1), minTier: 5 }),
  C('w-kurshevel', 'rest', 'Куршевель', 'Горнолыжный сезон: шубы, икра, всё столичное общество. Чтоб видели.', [ok('Заказать шале', { cashT: -3, stats: { avt: 8, svyazi: 10, mood: 12, stress: -15 } }), ok('Обойдусь Шерегешем', { cashT: -0.5, stats: { mood: 6, stress: -8 } })], { from: mm(1998, 12), minTier: 5 }),
  C('w-cirk', 'rest', 'С детьми в цирк', 'Вырвался на воскресенье: цирк, мороженое, воздушные шарики.', [ok('Пойти всей семьёй', { cashT: -0.2, stats: { blizkie: 9, mood: 7, stress: -6 } }), ok('Дела не ждут', { stats: { blizkie: -6, stress: 3 } })], { from: mm(1991, 1), maxTier: 4 }),
  // ---- новости
  C('n-vaucher', 'news', 'Ваучеры', 'Все получили ваучеры. Кто-то сдаёт за бутылку, кто-то скупает пачками.', [ok('Скупать пачками', { cashT: 0.8, stats: { svyazi: 2 } }, { risk: { p: 0.4, skill: 'trade', fx: { cashT: -1.3, stats: { mood: -4 } }, text: 'Ваучеры упали в цене.' } }), ok('Продать свой за пару бутылок', { cashT: 0.1 })], { from: mm(1992, 10), to: mm(1994, 6) }),
  C('n-mmm', 'news', 'Пирамида «МММ»', 'Всё метро в рекламе: деньги растут как на дрожжах. Вся страна в очереди.', [ok('Вложить', { cashT: 1, stats: { mood: 4 } }, { risk: { p: 0.55, skill: 'schet', fx: { cashT: -2.2, stats: { mood: -10 } }, text: 'Пирамида рухнула.' } }), ok('Здравый смысл', { stats: { sovest: 2 } })], { from: mm(1994, 2), to: mm(1994, 7) }),
  C('n-privat', 'news', 'Приватизация', 'Завод идёт с молотка. Говорят, директор уже всё поделил, но можно влезть.', [ok('Купить долю', { cashT: 2, stats: { svyazi: 4, name: 3 } }, { need: { cashT: 3 }, risk: { p: 0.45, skill: 'bazar', fx: { cashT: -3, stats: { mood: -6 } }, text: 'Директор оставил себе всё.' } }), ok('Не моё')], { from: mm(1993, 1), to: mm(1996, 12), minTier: 2 }),
  C('n-chelnok', 'news', 'Челноки', 'Сосед привёз из Польши сумки: «Вези кожу из Стамбула — на барахолке с руками отрывают».', [ok('Съездить в Стамбул', { cashT: 0.8, stats: { stress: 5 } }, { risk: { p: 0.3, skill: 'trade', fx: { cashT: -1.2, stats: { mood: -5 } }, text: 'Таможня всё забрала.' } }), ok('Пусть сами ездят')], { from: mm(1991, 6), to: mm(1996, 12), maxTier: 2 }),
  C('n-evroremont', 'news', 'Евроремонт', 'Все хотят «как у людей»: гипсокартон, обои, натяжные потолки. Бригадиры нарасхват.', [ok('Сделать у себя', { cashT: -1, stats: { mood: 8, avt: 3, stress: -4 } }), ok('Старые обои тоже ничего', { stats: { mood: -1 } })], { from: mm(1993, 1), to: mm(2003, 12) }),
];
export const cardById = (id: string) => CARDS.find((c) => c.id === id);

// ---------------------------------------------------------------- исторические даты
export interface HistT {
  m: number;
  id: string;
  title: string;
  text: string;
  /** Потеря наличных, если не подготовился (флаг prep = id). */
  loss?: number;
  /** Кризис: доходы × на столько месяцев. */
  crisis?: { mul: number; months: number };
  fx?: Fx;
  /** Только тем, у кого бандитская крыша. */
  bandit?: Fx;
}
export const HISTORY: HistT[] = [
  { m: mm(1991, 1), id: 'pavlov', title: 'Павловская реформа', text: 'Ночью отменили полтинники и сотни. Обмен — три дня, не больше тысячи.', loss: 0.3 },
  { m: mm(1991, 8), id: 'gkchp', title: 'ГКЧП', text: 'По телевизору «Лебединое озеро». Три дня никто не знает, что будет. Покровители из обкома — уже никто.', crisis: { mul: 0.75, months: 3 }, fx: { stats: { stress: 10 } } },
  { m: mm(1992, 1), id: 'ceny', title: 'Цены отпустили', text: 'Второго января ценники выросли в разы. Сбережения растаяли.', loss: 0.5, crisis: { mul: 0.8, months: 4 } },
  { m: mm(1992, 2), id: 'svoboda', title: 'Свобода торговли', text: 'Указ: торговать можно где угодно. Город покрылся ларьками.', fx: { stats: { mood: 5 } } },
  { m: mm(1992, 10), id: 'voucher', title: 'Ваучеры', text: 'Каждому — приватизационный чек. Страна стала акционерной.', fx: { cash: 20 } },
  { m: mm(1994, 8), id: 'mmm', title: 'МММ рухнула', text: 'Офис на Варшавке взяли штурмом, билеты больше ничего не стоят.' },
  { m: mm(1994, 10), id: 'black', title: 'Чёрный вторник', text: 'Доллар за день подскочил на четверть.', loss: 0.25, crisis: { mul: 0.85, months: 3 } },
  { m: mm(1996, 7), id: 'vybory', title: 'Выборы президента', text: 'Второй тур. Кто ставил на победителя — в фаворе.' },
  { m: mm(1998, 1), id: 'denom', title: 'Деноминация', text: 'С рублей убрали три нуля. Тысяча стала рублём.' },
  { m: mm(1998, 8), id: 'default', title: 'Дефолт', text: 'Семнадцатое августа: государство не платит по долгам, банки лопаются, доллар втрое.', loss: 0.6, crisis: { mul: 0.6, months: 6 }, fx: { stats: { stress: 15 } } },
  { m: mm(2000, 7), id: 'ravno', title: 'Равноудалённость', text: 'Новая власть собрала крупный бизнес: правила меняются. Бандитские крыши — теперь обуза, прежние покровители — не у дел.', bandit: { stats: { heat: 20, avt: -5 } } },
  { m: mm(2001, 1), id: 'ndfl', title: 'Плоская шкала', text: 'Налог 13 % для всех. Выходить из тени стало выгодно.', fx: { stats: { heat: -8 } } },
];

// ---------------------------------------------------------------- клуб и условия покупки
export const CLUB = 'Лондон Юнайтед';
export const CLUB_PRICE = 230e6;
/** Пороги условий по сложности (0 — лёгкая, 2 — сложная). */
export const CLUB_NEED = [
  { name: 40, svyazi: 50, heat: 60, english: 2, hours: 60 },
  { name: 55, svyazi: 65, heat: 45, english: 3, hours: 80 },
  { name: 70, svyazi: 75, heat: 30, english: 3, hours: 100 },
];

/** Финалы «не успел» (решение пользователя). */
export const ENDINGS = {
  king: 'Король Затулинки',
  rich: 'Олигарх без клуба',
  soulless: 'Олигарх без души',
  honest: 'Честный, но небогатый',
} as const;
export type Ending = keyof typeof ENDINGS | 'club';
