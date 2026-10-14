/* Кинь-двинь — общее про ходилки на оригинальных советских полях (картинки — public/hodilki/). Без DOM.
 * Поле — список клеток по ходу (координаты на картинке) со знаками: пропуск хода, ещё ход, «начать сначала», переход на другую клетку
 * (вверх/вниз, вперёд/назад — заранее посчитанный номер клетки). Кубик d6; знак срабатывает один раз (на клетке, куда перенесло, — уже нет).
 * До финиша считать точно не нужно: дошёл или перешёл — победил. */
export type Sign =
  | { k: 'skip'; n?: number }
  | { k: 'again' }
  | { k: 'start' }
  /** Переход на клетку to; skip — и ещё пропустить столько ходов (Шегерян: «после пропуска хода — до 24»). */
  | { k: 'jump'; to: number; text: string; good: boolean; skip?: number }
  /** Ветка «туда и обратно» (Шегерян: «до г. Крей и обратно», тупик): следующими бросками фишка идёт по cells (до конца ветки и назад), потом — дальше по пути. */
  | { k: 'route'; cells: number[]; text: string }
  /** Боны («Лукоморье»): взять `n` или сумму `dice` бросков; loss — отдать столько же; skip — ещё и пропустить ходы.
   * `diff` — взять (или отдать) не число, а разницу «очки на кубике − кружки до этого пункта». */
  | { k: 'coins'; n?: number; dice?: number; loss?: boolean; skip?: number; diff?: boolean; /** И перенос на клетку (яма → Три сосны). */ to?: number; text: string }
  /** Переброс на другое поле той же карточки (серия «Лукоморья»: части 1–4 связаны переходами). */
  | { k: 'field'; map: string; to: number; text: string }
  /** Предмет: взять себе в инвентарь. */
  | { k: 'item'; item: ItemId; text: string }
  /** Условие: есть предмет или хватает бон — один исход, иначе другой; yes: 'win' — победа,
   * а исходом бывает и переход на другую часть серии (Лукоморье: клубок — и дальше во вторую часть). */
  | { k: 'need'; item?: ItemId; coins?: number; /** Боны не только нужны, но и отдаются (клубок за 20 бон, Орёл за 15). */ pay?: boolean; yes: NeedTo; no: NeedTo; text: string }
  /** Развилка: дорога выбирается по разнице «очки на кубике − число кружков до развилки» (1…6).
   * byDiff[разница-1] — номер ветки, branches — сами ветки (клетки дороги и выход), roads — их названия. */
  | { k: 'fork'; byDiff: number[]; branches: number[][]; roads?: string[]; text: string;
      /** Кружок лабиринта («Лукоморье-4»): один бросок — один переход по стрелке грани; `coins` — боны за переход (+1/−1). */
      step?: boolean; coins?: number }
  /** Ярмарка чудес («Шёл солдат со службы»): общий запас волшебных предметов — взять до двух,
   * купить хлеб и огниво, обменять; остановка обязательная. */
  | { k: 'market'; text: string }
  /** Петля («Шёл солдат»: Леший на 64/65, Пастух на 133): фишка идёт по клеткам петли, а выйти
   * можно только броском (чёт/нечет или определённая грань); `out` — куда выходит, когда вырвался. */
  | { k: 'loop'; cells: number[]; exit?: LoopExit; out?: number; text: string }
  /** Событие с выбором («Шёл солдат»): игрок выбирает, чем пройти препятствие — предметом,
   * хлебом, монетой или потерей ходов. Недоступные варианты показываются, но недоступны. */
  | { k: 'choice'; title?: string; options: ChoiceOption[]; loss?: number; to?: number; failText?: string; self?: boolean; text: string }
  /** Дополнительные ходы: `n` или сумма `dice` бросков. */
  | { k: 'extra'; n?: number; dice?: number; text: string }
  /** Загадка с ответами: игрок выбирает ответ, и пуговица идёт на клетку `to[выбор]` (Лукоморье: «угаданное число — номер пункта»). */
  | { k: 'pick'; question: string; options: string[]; to: number[]; text: string }
  /** Ждать нужной грани: пока на кубике не выпадет `die`, пуговица стоит (Лукоморье: «выход только шестёркой»). */
  | { k: 'wait'; die: number; text: string }
  /** Загадка остальным («Лукоморье», поле 4, клетка «?»): игрок загадывает загадку, остальные отвечают.
   * Никто не отгадал — загадавший получает `extra` лишних ходов и/или `coins` бон. */
  | { k: 'riddle'; extra?: number; coins?: number; text: string }
  /** Забрать предмет у места (кикиморы отбирают аленький цветочек, разбойники — деньги и цветочек). */
  | { k: 'takeItem'; item: ItemId; text: string };

/** Предметы «Лукоморья»: их берут на клетках, по ним открываются переходы. */
export type ItemId = 'flower' | 'cap' | 'key' | 'needle' | 'sword';

/** Карточка-предмет («Шёл солдат со службы»): у поля свой запас карточек с картинками. */
export type CardId = string;

/** Из чего выходит петля: чётный/нечётный бросок или определённые грани. */
export type LoopExit = 'even' | 'odd' | number[];

/** Вариант выбора на клетке-препятствии. */
export interface ChoiceOption {
  text: string;
  /** Нужная карточка (иначе вариант недоступен). */
  need?: CardId;
  /** Нужен Конь-огонь (постоянная прибавка к броску). */
  needHorse?: boolean;
  /** Нужен флаг («подал» — Нищенке подавали). */
  needIfFlag?: string;
  /** Что уходит в общий запас. */
  pay?: CardId[];
  /** Что берётся из запаса. */
  get?: CardId[];
  /** Сколько ходов пропустить. */
  skip?: number;
  /** Переход на другую клетку ленты (номер с поля, 1…140). */
  to?: number;
  /** Переход на клетку по индексу в списке клеток (безномерные кружки: вход в круги Лешего). */
  toCell?: number;
  /** Записать флаг. */
  flag?: string;
  /** Снять флаг (черти выпущены из торбы). */
  unflag?: string;
  /** Обход: знак route с этой дорогой (дороги поля: развилка, обход реки, петли). */
  route?: number;
  /** Хорошее событие (для журнала и звука). */
  gained?: boolean;
  /** Что сказать игроку после выбора. */
  text2?: string;
}

/** Запас карточек на поле-«приключении»: ярмарки, котомка, лимиты. */
export interface Deck {
  cards: { id: CardId; name: string; img: string; kind: 'simple' | 'magic' | 'coins' }[];
  /** Куда складываются картинки карточек (public/...). */
  cardsDir: string;
  /** Имя файла картинки карточки. */
  cardImg: (c: { id: CardId; img: string }) => string;
  /** Сколько карточек вида кладётся в запас при стольких игроках (индекс: 2, 3, 4 и больше). */
  counts: number[];
  /** Запас на партию: вид → [2 игрока, 3, 4, 4+]. */
  stock: Record<string, [number, number, number, number]>;
  /** Что солдат получает на старте. */
  startCards: { card: CardId; n?: number }[];
  /** Лимиты котомки. */
  bag: { simple: number; magic: number; coins: number };
  /** Клетки-ярмарки: остановка обязательная. */
  market: number[];
  /** Что сдаётся в запас на клетке (48 — Конь-огонь, 88 — клубок). */
  keep?: Record<number, CardId[]>;
  /** Какие флаги места снимаются на клетке (48 — с Конём-огнём расстаются, прибавка к броску пропадает). */
  dropFlags?: Record<number, string[]>;
  /** Клетки (номера с поля), мимо которых не пройти с ходу: фишка встаёт на них, если у места нет флага `unless`
   * (берег Огненной реки: без Коня-огня надо остановиться и решать — мост, обход). */
  halt?: { cell: number; unless?: string }[];
}

/** Круги («Шёл солдат»: Леший, Пастух): безномерные кружки по кругу; выйти можно только нужным броском —
 * тогда первый шаг на клетку ленты `out` (номер с поля), остаток очков — дальше по ленте. */
export interface Loop {
  cells: number[];
  exit: LoopExit;
  out: number;
  text: string;
}

/** Куда ведёт исход условия: номер клетки этого поля, победа или переход на другое поле серии. */
export type NeedTo = number | 'win' | { map: string; to: number };

export const ITEMS: { id: ItemId; name: string; icon: string }[] = [
  { id: 'flower', name: 'Аленький цветочек', icon: '🌺' },
  { id: 'cap', name: 'Шапка-невидимка', icon: '🎩' },
  { id: 'key', name: 'Золотой ключик', icon: '🗝' },
  { id: 'needle', name: 'Игла — смерть Кощеева', icon: '🪡' },
  { id: 'sword', name: 'Меч-кладенец', icon: '⚔' },
];

export const itemName = (id: ItemId) => ITEMS.find((i) => i.id === id)?.name ?? id;
export const itemIcon = (id: ItemId) => ITEMS.find((i) => i.id === id)?.icon ?? '•';

/** Что лежит в котомке («Шёл солдат»): простые (хлеб, огниво), волшебные и золотые монеты. */
export interface Bag {
  simple: number;
  magic: number;
  coins: number;
}

export function bagOf(b: Board, s: State, seat: number): Bag {
  const d = b.deck;
  const cards = s.cards?.[seat] ?? [];
  if (!d) return { simple: 0, magic: 0, coins: 0 };
  const kind = (id: CardId) => d.cards.find((c) => c.id === id)?.kind ?? 'magic';
  return {
    simple: cards.filter((c) => kind(c) === 'simple').length,
    magic: cards.filter((c) => kind(c) === 'magic').length,
    coins: cards.filter((c) => kind(c) === 'coins').length,
  };
}

/** Хватает ли места в котомке (и есть ли карточка в общем запасе). */
export function canPack(b: Board, s: State, seat: number, card: CardId, left?: number): boolean {
  const d = b.deck;
  if (!d) return false;
  const have = left ?? s.stock?.[card] ?? 0;
  if (have <= 0) return false;
  const bag = bagOf(b, s, seat);
  const kind = d.cards.find((c) => c.id === card)?.kind ?? 'magic';
  return kind === 'simple' ? bag.simple < d.bag.simple : kind === 'coins' ? bag.coins < d.bag.coins : bag.magic < d.bag.magic;
}

/** Карточка из котомки — назад в общий запас (волшебные предметы в игре одноразовые). */
export function unpack(cards: CardId[], stock: Record<string, number>, card: CardId) {
  const i = cards.indexOf(card);
  if (i >= 0) {
    cards.splice(i, 1);
    stock[card] = (stock[card] ?? 0) + 1;
  }
}

/** Гонка с голами («Шайба»): у каждой дорожки свой путь из общих клеток, финиш — не победа, а гол.
 * Места делятся на дорожки по кругу (0,2,4 — первая, 1,3,5 — вторая): вдвоём это две шайбы, вчетвером — две команды по два. */
export interface Race {
  /** Дорожки: номера клеток в порядке хода (у каждой свой старт — центр поля — и свои ворота в конце). */
  tracks: number[][];
  /** Сколько голов до победы, если настройка партии не задаёт своё. */
  target: number;
  /** Особый кубик: грани 1…pips — очки, грань stick — красная клюшка (назад), последняя — зелёная (вперёд).
   * Клюшка тянет картонный квадратик с 1–3 очками. */
  die: { pips: number; stick: number };
  /** Картинки шайб по дорожкам (public/hodilki/…). */
  pucks?: string[];
}

export interface Cell {
  x: number;
  y: number;
  sign: Sign | null;
  /** Подпись (номер на поле), если есть. */
  label?: string;
  /** Текст клетки с поля или из правил («Забыли взять ружья. Возвратиться в лагерь»). */
  text?: string;
  /** Клетка ветки, а не основного пути: на неё попадают только по знаку route. */
  off?: boolean;
  /** Следующая клетка, если это не следующая по списку (поле-граф «Лукоморья»: дороги, развилки, переходы); −1 — дальше хода нет. */
  next?: number;
  /** Дороги безномерных клеток этого поля (развилка Распутья, обход реки, петли):
   * выбор на клетке может отправить фишку по дороге с номером из списка. */
  roads?: number[][];
}

export interface Board {
  id: string;
  title: string;
  /** Картинка поля: w×h — система координат клеток; tiles — пирамида тайлов из исходного скана (tools/hodilki/tiles.py):
   * dir/tiny.webp, dir/view.webp — общая карта, dir/<уровень>/<c>_<r>.webp — тайлы 512 px; уровень 0 — скан src целиком. */
  img: { w: number; h: number; dir: string; src: [number, number]; levels: number };
  cells: Cell[];
  /** Размер пуговицы — доля ширины картинки. */
  token: number;
  goal: string;
  rules: string;
  winText: string;
  /** Финиш — номер клетки; по умолчанию последняя (после неё в списке могут идти клетки веток). */
  end?: number;
  /** Кто издал, откуда поле — строка под правилами. */
  credit?: string;
  /** Гонка с голами («Шайба»): своя дорожка каждому месту, кубик с клюшками, квадратики. */
  race?: Race;
  /** Как называются деньги на этом поле («боны» у «Лукоморья»); нет — поле без денег. */
  coins?: string;
  /** Победа не по последней клетке, а по знаку на ней (Лукоморье: клубок у Бабы Яги, терем Василисы). */
  winBySign?: boolean;
  /** Перед игрой каждый берёт из банка бон по сумме `startCoins` бросков; первым ходит тот, у кого больше. */
  startCoins?: number;
  /** Показ правил: шаги с подкрученным кубиком. rig — значения для rng.int (у клюшки их два: грань и квадратик). */
  demo?: { rig?: number | number[]; caption: string; seat?: number; /** Не бросок, а это действие (ярмарка, выбор на препятствии). */ act?: Action }[];
  /** Приключение с запасом карточек и ярмарками («Шёл солдат со службы»). */
  deck?: Deck;
  /** Постоянная прибавка к броску (Конь-огонь) — знаки, с которых она начинается. */
  bonusSigns?: number[];
  /** Круги, из которых выходят только нужным броском («Шёл солдат»). */
  loops?: Loop[];
  /** Серия: у игры несколько частей-полей — в настройках это одно поле и один пресет,
   * а партия идёт по частям до конца («Лукоморье»: клубок → цветочек → Заоблачная даль → замок Кощея). */
  series?: { id: string; label: string; part: number; count: number };
}

export interface State {
  /** Поле (id из BOARDS) — карта того, чей сейчас ход (у серии «Лукоморье» игроки могут быть на разных частях). */
  map: string;
  /** Карта каждого места: у обычных полей у всех одна, у серии — своя (птица уносит в другую часть и т. п.). */
  maps?: (string | null)[];
  seats: number[];
  pos: number[];
  /** Сколько ходов пропустить (старые сохранения — true/false). */
  skip: (boolean | number)[];
  /** Ветка, по которой фишка идёт сейчас (остаток пути); нет — по основному пути. */
  route?: (number[] | null)[];
  /** Ветка пришла от развилки: на её конце ход не кончается, лишние очки идут дальше по пути. */
  routeFor?: (boolean | null)[];
  turn: number;
  /** 'roll' — бросать кубик, 'move' — кубик брошен, игрок сам переставляет пуговицу, 'pick' — ждём ответа на загадку,
   * 'ask' — загадываем загадку остальным, 'answer' — остальные отвечают, 'judge' — загадавший решает, отгадали ли,
   * 'market' — игрок на ярмарке чудес, 'choose' — выбирает, чем пройти препятствие. */
  phase?: 'roll' | 'move' | 'pick' | 'ask' | 'answer' | 'judge' | 'market' | 'choose';
  /** Сколько шагов идти: у гонки с голами шаг бывает отрицательным (красная клюшка — назад). */
  last: number | null;
  winner: number | null;
  /** Идёт загадка («Лукоморье», поле 4): кто загадал, что, кто уже ответил. */
  riddle?: RiddleState | null;
  /** Гонка с голами: забитые шайбы по дорожкам. */
  goals?: number[];
  /** Гонка с голами: сколько голов до победы (настройка партии). */
  target?: number;
  /** Гонка с голами: что выпало на кубике — очки или клюшка. */
  kind?: 'pips' | 'red' | 'green' | null;
  /** Гонка с голами: очки на вытянутом квадратике (1–3). */
  card?: number | null;
  /** Гонка с голами: какой из пяти квадратиков с этими очками вытянули (0–14) — чтобы показать ту же картинку. */
  cardSlot?: number | null;
  /** Боны (деньги «Лукоморья») по местам. */
  coins?: number[];
  /** Предметы по местам («Лукоморье»). */
  items?: (ItemId[] | null)[];
  /** Накопленные дополнительные ходы по местам. */
  extra?: number[];
  /** Карточки-предметы по местам («Шёл солдат со службы»). */
  cards?: (CardId[] | null)[];
  /** Общий запас карточек: вид → сколько осталось. */
  stock?: Record<string, number>;
  /** Кто сейчас на ярмарке и сколько уже взял за это посещение. */
  market?: { seat: number; took: number; bought: number } | null;
  /** Флаги по местам («подал Нищенке», «черти в торбе»). */
  flags?: (string[] | null)[];
  /** Название клетки-препятствия, на котором игрок выбирает (для вида). */
  choose?: { seat: number; title?: string; text: string; options: ChoiceOption[] } | null;
}

export type Action =
  | { type: 'roll' }
  | { type: 'move' }
  | { type: 'pick'; pick: number }
  /** Загадать загадку остальным: своя (текст и, если хотите, ответ) или из базы. */
  | { type: 'ask'; text: string; answer?: string }
  /** Ответ на загадку: человек печатает `text`, бот называет свою удачу (`correct`). */
  | { type: 'answer'; text?: string; correct?: boolean }
  /** Загадавший решил: кто-то отгадал (ok) или никто. */
  | { type: 'judge'; ok: boolean }
  /** Ярмарка: взять волшебный предмет бесплатно, купить простой за золотой, закрыть ярмарку. */
  | { type: 'market'; do: 'take' | 'buy' | 'done'; card?: CardId }
  /** Выбор на клетке-препятствии: номер варианта. */
  | { type: 'choose'; pick: number };

/** Загадка, которую загадывают остальным («Лукоморье», поле 4). */
export interface RiddleState {
  /** Кто загадал. */
  by: number;
  /** Текст загадки. */
  text: string;
  /** Правильный ответ: у загадки из базы он есть, у своей может не быть — тогда судит загадавший. Остальным не виден. */
  answer?: string | null;
  /** Кто уже отгадал. */
  solved: number[];
  /** Названные ответы (человек печатает, загадавший судит). */
  replies: { seat: number; text: string }[];
  /** Кого ещё ждём с ответом. */
  waiting: number[];
  /** Награда, если никто не отгадал. */
  extra?: number;
  coins?: number;
}

export type Event =
  | { type: 'roll'; seat: number; die: number; /** Что выпало: очки или клюшка (гонка с голами). */ kind?: 'pips' | 'red' | 'green'; card?: number; slot?: number }
  | { type: 'move'; seat: number; path: number[] }
  | { type: 'sign'; seat: number; sign: Sign; to: number; /** Текст клетки (что случилось). */ text?: string }
  | { type: 'skip'; seat: number }
  /** Боны: delta — сколько взял (или отдал, если отрицательно), total — сколько стало. */
  | { type: 'coins'; seat: number; delta: number; total: number }
  /** Предмет взят в инвентарь; lost — наоборот, отобран. */
  | { type: 'item'; seat: number; item: ItemId; lost?: boolean }
  /** Карточка взята из общего запаса (ярмарка, событие) или ушла в запас. */
  | { type: 'card'; seat: number; card: CardId; lost?: boolean; left?: number }
  /** Ярмарка: что игрок сделал и что осталось в запасе. */
  | { type: 'market'; seat: number; do: 'take' | 'buy' | 'done'; card?: CardId; stock?: Record<string, number> }
  /** Выбор на препятствии: что выбрали и чем это обошлось. */
  | { type: 'choose'; seat: number; text: string; option: string; skip?: number; to?: number }
  /** Дополнительные ходы: сколько добавилось. */
  | { type: 'extra'; seat: number; n: number }
  /** Гонка с голами: шайба в воротах, возвращается в центр. */
  | { type: 'goal'; seat: number; track: number; goals: number; target: number }
  /** Загадка: кто загадал и что. */
  | { type: 'ask'; seat: number; text: string }
  /** Ответ на загадку: отгадал или нет (text — что назвал). */
  | { type: 'answer'; seat: number; solved: boolean; text?: string }
  /** Итог загадки: отгадали (true) или нет; загадавший получает награду при solved = false. */
  | { type: 'riddle'; seat: number; solved: boolean; extra?: number; coins?: number }
  /** Награда за неотгаданную загадку (лишние ходы). */
  | { type: 'reward'; seat: number; extra: number }
  | { type: 'win'; seat: number };

export const SEATS = [
  { name: 'Вовка', color: '#d8241c', light: '#ff6a5a', dark: '#7a1210' },
  { name: 'Ленка', color: '#2060d0', light: '#6a9aff', dark: '#103a80' },
  { name: 'Серёга', color: '#2a9a3a', light: '#6ad07a', dark: '#145a20' },
  { name: 'Танька', color: '#e8b020', light: '#ffd870', dark: '#8a6408', ink: '#8a6408' },
  { name: 'Димон', color: '#8a3ac8', light: '#c08aff', dark: '#4a1a7a' },
  { name: 'Колян', color: '#5a5a5a', light: '#9a9a9a', dark: '#2a2a2a' },
  { name: 'Светка', color: '#e85a9a', light: '#ffa0c8', dark: '#8a2050' },
  { name: 'Жека', color: '#1a9a9a', light: '#60d0d0', dark: '#0a5a5a' },
  { name: 'Маринка', color: '#f07a1a', light: '#ffb070', dark: '#8a400a' },
  { name: 'Петька', color: '#6a4a2a', light: '#a07a50', dark: '#3a2410' },
];

export const finishOf = (b: Board) => b.end ?? b.cells.length - 1;

/** Карта места: у серии у каждого своя, у обычных полей — общая. */
export const mapOf = (s: State, seat: number) => s.maps?.[seat] ?? s.map;

/** Дорожка места: у обычных полей путь один на всех, у гонки с голами — по кругу (0, 2, 4… — первая шайба). */
export const trackOf = (b: Board, seat: number) => (b.race ? seat % b.race.tracks.length : 0);

/** Клетки дорожки места: у обычных полей нет (идут по общему пути). */
export const trailOf = (b: Board, seat: number) => b.race?.tracks[trackOf(b, seat)] ?? null;

/** Гонка с голами: путь по своей дорожке — вперёд по ходу или назад (красная клюшка). За воротами путь кончается:
 * лишние очки пропадают, а сама шайба в воротах — это гол (его считает apply). */
function racePath(s: State, b: Board, seat: number): number[] {
  const trail = trailOf(b, seat)!;
  const at = Math.max(0, trail.indexOf(s.pos[seat]));
  const n = s.last ?? 0;
  const out: number[] = [];
  if (n > 0) for (let i = at + 1; i < trail.length && out.length < n; i++) out.push(trail[i]);
  else for (let i = at - 1; i >= 0 && out.length < -n; i--) out.push(trail[i]);
  return out;
}

/** Следующая клетка по ходу: своя у клетки поля-графа (`next`), иначе следующая по списку до финиша. */
export function nextOf(b: Board, at: number): number | undefined {
  const n = b.cells[at]?.next;
  if (n != null) return n >= 0 ? n : undefined;
  return at < finishOf(b) ? at + 1 : undefined;
}

/** Какая дорога у развилки: разница «очки на кубике − число кружков до развилки» (1…6) выбирает ветку. */
export function branchOf(g: Sign & { k: 'fork' }, diff: number): { branch: number; cells: number[] } {
  const d = Math.max(1, Math.min(6, Math.round(diff) || 1));
  const branch = Math.max(0, Math.min(g.branches.length - 1, g.byDiff[d - 1] ?? 0));
  return { branch, cells: g.branches[branch] ?? [] };
}

/** Пройденная развилка: где, какая была разница и какую дорогу выбрали. */
export interface ForkPass {
  cell: number;
  diff: number;
  branch: number;
}

export interface Walk {
  /** Клетки, по которым пройдёт пуговица за этот бросок. */
  path: number[];
  /** Остаток ветки после хода (у развилок дорога может кончиться раньше броска). */
  route: number[] | null;
  /** Куда пошла дорога от развилки (true — ход продолжается и за концом ветки). */
  routeFor: boolean;
  forks: ForkPass[];
}

/** Весь ход пуговицы: клетки, остаток ветки и пройденные развилки. Развилка решается на месте — по остатку очков.
 * `steps` — сколько шагов идти, если не брать `s.last` (петля «Шёл солдата» ходит своими бросками). */
export function walkFor(s: State, b: Board, seat: number, steps?: number): Walk {
  if (b.race) return { path: racePath(s, b, seat), route: null, routeFor: false, forks: [] };
  const path: number[] = [];
  const forks: ForkPass[] = [];
  // Конь-огонь: +2 к каждому ходу
  let n = steps ?? (s.last ?? 0) + (s.flags?.[seat]?.includes('конь') ? 2 : 0);
  let route = (s.route?.[seat] ?? []).slice();
  let cont = s.routeFor?.[seat] ?? false;
  let at = s.pos[seat];
  // ярмарки в разметке заданы номерами клеток с поля (48), а путь — индексами (47)
  const stalls = (b.deck?.market ?? []).map((x) => x - 1);
  // берег Огненной реки: без Коня-огня с ходу не перейти — встаёшь и решаешь
  const flags = s.flags?.[seat] ?? [];
  for (const h of b.deck?.halt ?? []) if (!h.unless || !flags.includes(h.unless)) stalls.push(h.cell - 1);
  // фишка стоит на развилке — дорога выбирается цифрой на кубике (в правилах: «если попал на неё — просто цифра»)
  const here = b.cells[at]?.sign;
  if (!route.length && here?.k === 'fork') {
    const pick = branchOf(here, n);
    route = pick.cells.slice();
    cont = true;
    forks.push({ cell: at, diff: n, branch: pick.branch });
    // кружок лабиринта: бросок — это грань, по её стрелке ровно один переход (или пропуск хода)
    if (here.step) n = route.length;
  }
  while (n > 0) {
    let next: number | undefined;
    if (route.length) next = route.shift();
    else if (cont) next = nextOf(b, at);
    // ветка знака кончилась, а остаток очков был: с выхода ветки фишка никуда не идёт — ход кончается
    else if (path.length && s.route?.[seat]?.length) break;
    else next = nextOf(b, at);
    if (next == null) break;
    at = next;
    path.push(at);
    n--;
    // ярмарка чудес: остановка обязательная, даже если очков оставалось больше (в правилах: с 46 при 5 — на 48)
    if (stalls.includes(at)) break;
    const g = b.cells[at]?.sign;
    // вошёл в лабиринт: дальше — по броскам, по кружку за раз
    if (!route.length && g?.k === 'fork' && g.step) break;
    if (!route.length && g?.k === 'fork' && n > 0) {
      const pick = branchOf(g, n);
      route = pick.cells.slice();
      cont = true;
      forks.push({ cell: at, diff: n, branch: pick.branch });
    }
    // «взять/отдать разницу»: пуговица останавливается на пункте, не истратив очки — разница и есть плата
    if (!route.length && g?.k === 'coins' && g.diff && n > 0) break;
  }
  return { path, route: route.length ? route : null, routeFor: cont && !!route.length, forks };
}

/** Выходит ли петля по этому броску: чёт/нечет или определённые грани. */
export const loopOpens = (exit: LoopExit | undefined, die: number) =>
  exit === 'even' ? die % 2 === 0 : exit === 'odd' ? die % 2 === 1 : Array.isArray(exit) ? exit.includes(die) : true;

/** Круг, на кружке которого стоит клетка (или null). */
export const loopAt = (b: Board, cell: number) => b.loops?.find((l) => l.cells.includes(cell)) ?? null;

/** Ход по кругу (Леший, Пастух): пуговица стоит на кружке круга. Нужный бросок (чёт/нечет) выпускает —
 * первый шаг на клетку ленты за кругом, дальше по ленте; иначе пуговица идёт по кружкам дальше по кругу. */
export function loopMove(s: State, b: Board, seat: number, die: number): Walk | null {
  const lp = loopAt(b, s.pos[seat]);
  if (!lp) return null;
  if (loopOpens(lp.exit, die)) {
    // встаём «перед» клеткой out (номер с поля → индекс out-1, а перед ней — out-2) и идём по ленте
    const one = <T,>(list: T[] | undefined, v: T) => (list ?? s.pos.map(() => v)).map((x, i) => (i === seat ? v : x));
    const from: State = { ...s, pos: s.pos.map((x, i) => (i === seat ? lp.out - 2 : x)), route: one(s.route, null), routeFor: one(s.routeFor, null) };
    return walkFor(from, b, seat, die);
  }
  const j = Math.max(0, lp.cells.indexOf(s.pos[seat]));
  const path: number[] = [];
  for (let k = 1; k <= die; k++) path.push(lp.cells[(j + k) % lp.cells.length]);
  return { path, route: null, routeFor: false, forks: [] };
}

/** Клетки, по которым пройдёт пуговица за бросок. */
export const pathFor = (s: State, b: Board, seat: number): number[] => walkFor(s, b, seat).path;

/** Куда встанет пуговица после броска (до знака). */
export const target = (s: State, b: Board, seat: number) => {
  const p = pathFor(s, b, seat);
  return p.length ? p[p.length - 1] : s.pos[seat];
};

export const skipsOf = (s: State, seat: number) => Number(s.skip[seat] || 0);

export const signText = (g: Sign) =>
  g.k === 'skip'
    ? g.n && g.n > 1
      ? `пропускает ${g.n} хода`
      : 'пропускает ход'
    : g.k === 'again'
      ? 'ходит ещё раз'
      : g.k === 'start'
        ? 'начинает сначала'
        : g.k === 'riddle'
          ? 'загадывает загадку остальным'
          : g.text;

export const signGood = (g: Sign) =>
  g.k === 'again' ||
  (g.k === 'jump' && g.good) ||
  (g.k === 'coins' && !g.loss) ||
  g.k === 'item' ||
  g.k === 'extra' ||
  (g.k === 'choice' && g.options.some((o) => o.gained)) ||
  (g.k === 'need' && g.yes === 'win');

const rowWord = (n: number) => (n === 1 ? 'ряд' : n < 5 ? 'ряда' : 'рядов');

/** Поле-«змейка» Феликса Шапиро: ряды снизу вверх, нижний — слева направо, дальше поворот на каждом ряду.
 * `signs` — знаки по клеткам `'ряд,колонка'` (ряды сверху 1…N, колонки слева 1…M): `skip`, `again`, `start`, `upN`/`downN` — на N рядов
 * в той же колонке, `RN`/`LN` — на N делений по стрелке (по ходу «змейки» — вперёд, против — назад).
 * `cols(ряд)` — первая и последняя клетка ряда (где-то клетки заняты табличкой правил или заголовком); `xs`/`ys` — границы колонок и рядов. */
export function snake(o: { signs: Record<string, string>; xs: number[]; ys: number[]; k?: number; cols: (row: number) => [number, number] }): Cell[] {
  const k = o.k ?? 1;
  const rows = o.ys.length - 1;
  const geo: { row: number; col: number; dir: 1 | -1; code?: string }[] = [];
  for (let row = rows; row >= 1; row--) {
    const [a, b] = o.cols(row);
    const dir: 1 | -1 = (rows - row) % 2 === 0 ? 1 : -1;
    for (let i = 0; i <= b - a; i++) {
      const col = dir === 1 ? a + i : b - i;
      geo.push({ row, col, dir, code: o.signs[`${row},${col}`] });
    }
  }
  const at = (row: number, col: number) => geo.findIndex((c) => c.row === row && c.col === col);
  return geo.map((c, idx): Cell => {
    const x = ((o.xs[c.col - 1] + o.xs[c.col]) / 2) * k;
    const y = ((o.ys[c.row - 1] + o.ys[c.row]) / 2) * k;
    const code = c.code;
    let sign: Sign | null = null;
    if (code === 'skip' || code === 'again' || code === 'start') sign = { k: code };
    else if (code?.startsWith('up') || code?.startsWith('down')) {
      const up = code.startsWith('up');
      const n = +code.slice(up ? 2 : 4);
      const to = at(up ? c.row - n : c.row + n, c.col);
      if (to >= 0) sign = { k: 'jump', to, good: up, text: up ? `взлетает на ${n} ${rowWord(n)} вверх` : `падает на ${n} ${rowWord(n)} вниз` };
    } else if (code) {
      // стрелка вбок: по ходу «змейки» — вперёд, против — назад
      const n = +code.slice(1);
      const fwd = (code[0] === 'R' ? 1 : -1) === c.dir;
      sign = { k: 'jump', to: idx + (fwd ? n : -n), good: fwd, text: fwd ? `вперёд на ${n}` : `назад на ${n}` };
    }
    return { x, y, sign };
  });
}

/** Правила полей Шапиро — одни и те же. */
export const SNAKE_RULES = `<p>Бросьте кубик и передвиньте пуговицу на столько делений, сколько выпало, — по пунктирным стрелкам. Старт — левая клетка нижнего ряда.</p>
    <p>Знаки: <b>кружок</b> — пропуск хода, <b>квадрат</b> — ещё ход, <b>треугольник вверх/вниз</b> — на столько рядов вверх или вниз, сколько написано,
    <b>треугольник вбок</b> — на столько делений вперёд или назад, <b>чёрный кружок</b> — начинайте сначала.</p>`;
