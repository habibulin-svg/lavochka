/* «Заколдованная страна» — язык сцен. На нём записаны все приключения книги ведущего, дорожные встречи «Прочее» и кампании.
 *
 * Сцена — список шагов. Движок идёт по шагам по порядку; рассказ (say) копится на экране, а на шагах, где нужно решение
 * или бросок (ask, roll, fight, shop, gamble), ждёт игроков. Ветки — вложенные списки шагов. Курсор сцены (путь по
 * вложенным спискам) хранится в состоянии партии, поэтому сцену можно сохранить и продолжить посреди разговора.
 *
 * Правила записи (для авторов приключений и кампаний):
 * - Текст для игроков (say, ask) — то, что они видят и слышат, во втором лице множественного числа («Вы входите…»).
 *   Подсказок, которых нет в книге, не давать: ведущий «говорит лишь то, что они сами видят».
 * - Текст книги ведущего — дословно в `gm` сцены (его видит только ведущий-человек).
 * - Числа (монеты, ОР, проверки) — строго как в книге. Где книга молчит — решение за автором, но в духе правил.
 * - Опасности — id из data/monsters.json (поле m), их число — n (число или кубик '1d6').
 * - Подстановки в тексте: {name} — герой текущей ветки, {leader} — вожак отряда, {n} — выпавшее число последнего броска.
 */
import type { ClassId, Stat } from './book';

/** Количество: число, кубик ('1d6', '2d6', '1d3', '3d' — основной бросок 1…18) или 'all' / 'half' (для денег). */
export type Qty = number | string;

/** Кто действует или на кого действует шаг.
 * - party — весь отряд (деньги делятся поровну), each — каждый живой герой по очереди (ветка выполняется для каждого),
 * - subject — герой текущей ветки (внутри each, или выбранный в ask/roll), leader — вожак отряда,
 * - chosen — отряд выбирает одного (вожак указывает кого), random — случайный живой герой («разыгрывается»),
 * - best:<stat> — у кого это качество выше всех, worst:<stat> — ниже. */
export type Who = 'party' | 'each' | 'subject' | 'leader' | 'chosen' | 'random' | `best:${Stat}` | `worst:${Stat}`;

export type FlagVal = boolean | number | string;

export type Cond =
  | { flag: string; is?: FlagVal }
  | { not: Cond }
  | { all: Cond[] }
  | { any: Cond[] }
  /** Качество героя (who: subject по умолчанию; any — хоть у одного; all — у всех). */
  | { stat: Stat; gte?: number; lt?: number; who?: 'subject' | 'any' | 'all' | 'leader' }
  | { cls: ClassId; who?: 'subject' | 'any' }
  /** Есть вещь: id из book.ts (WEAPONS/ARMORS/GEAR) или 'magic:<n>' — волшебная вещь/бутылка по номеру книги. */
  | { item: string; who?: 'subject' | 'any' }
  | { gold: number; who?: 'subject' | 'party' }
  | { level: number; who?: 'subject' | 'any' | 'all' }
  /** Текущие очки риска героя. */
  | { hp: { lt?: number; gte?: number }; who?: 'subject' | 'any' | 'all' | 'leader' }
  /** В отряде есть павший или окаменевший герой. */
  | { dead: true }
  /** Правило партии (настройки): rest — off/inn/always, spells — never/rest, death — dead/forpost. */
  | { rule: 'rest' | 'spells' | 'death'; is: string }
  /** Знает заклинание (id из book.ts) и у него остались применения. */
  | { spell: string; who?: 'subject' | 'any' }
  /** Комната уже пройдена: '<место>:<комната>', например 'c2:8'. */
  | { visited: string }
  | { night: true }
  /** Сколько живых героев в отряде не меньше. */
  | { party: number }
  /** Случайно, процент. */
  | { chance: number }
  /** Ведущий решает (бот-ведущий — по chance, по умолчанию 50%). */
  | { gm: string; chance?: number };

/** Бросок. Игрок бросает сам (кнопкой), бросок виден всем.
 * - main — основной бросок d3 (0/6/12) + d6 = 1…18; удача, если выпало не меньше need.
 * - save — бросок удачи (БУ): основной бросок с учётом мудрости и класса; need — число из книги/карточки.
 *   kind — от чего спасаемся (paralysis | poison | petrify | fire | acid | gas | lightning | magic): обереги и стойкость
 *   спасают без броска.
 * - d6 / d3 — удача, если выпало одно из need (список) или не меньше need (число).
 * - hit — попасть оружием в цель с КД need: движок сам считает, сколько выбросить (таблица КД, поправка силы — или ловкости,
 *   если missile, бонус класса). Для «нужно 14 и более» — kind 'main', need 14.
 * - stat — без броска: качество героя не меньше need (сила 17 — разбить цепь). */
export interface RollSpec {
  /** dice4 — «кости»: 4 кубика героя против 4 кубиков соперника, удача — если у героя больше (ничья — переброс). */
  kind: 'main' | 'save' | 'd6' | 'd3' | 'hit' | 'stat' | 'dice4';
  need: number | number[];
  stat?: Stat;
  save?: 'paralysis' | 'poison' | 'petrify' | 'fire' | 'acid' | 'gas' | 'lightning' | 'magic';
  /** Метательным (для hit). */
  missile?: boolean;
  /** Кто бросает: subject (по умолчанию), each — каждый за себя (ветки для каждого), chosen, leader, random, best:<stat>. */
  who?: Who;
  /** Подпись на кнопке: «Разбить цепь», «Догнать вора». */
  label?: string;
  /** Сколько попыток (сундук: «для открытия даётся 2 попытки»). */
  tries?: number;
}

/** Противник в бою. */
export interface Foe {
  /** id из data/monsters.json. */
  m: string;
  /** Сколько (число или кубик). */
  n?: Qty;
  /** Своё имя в этой сцене («Хозяин-гнолл», «Палач»). */
  name?: string;
  /** Переопределить карточку: ОР (вместо ЖК), КД, атаки, стоимость, мораль. */
  hp?: Qty;
  kd?: number;
  dmg?: number[];
  value?: number;
  morale?: number | 'am';
  /** «Сверхопасности» Смерти в лесу: +ЖК, стоимость ×. */
  extraHd?: number;
  valueMul?: number;
  /** Убегает, когда ОР ≤ этого (золотой минотавр — при 3). */
  fleeAt?: number;
  /** Сколько денег при нём (достаются победителям). */
  gold?: number;
  /** Спит: не бьёт, пока его не поразят дважды (белый дракон у сундука). */
  asleep?: boolean;
}

export interface Fight {
  /** Противники; одной строкой — один противник по id ('spektr'). */
  fight: Foe[] | string;
  /** Кто бьёт первым: roll — жребий (по умолчанию), foes — нападают сразу, party — отряд застал врасплох. */
  first?: 'roll' | 'foes' | 'party';
  /** Убежать нельзя. */
  noFlee?: boolean;
  /** Победили. */
  win?: Step[];
  /** Отряд убежал. */
  fled?: Step[];
  /** Противник убежал (мораль) — без этой ветки как победа. */
  routed?: Step[];
  /** Бой до первого попадания отряда (баргул с вахналлом исчезают). */
  untilHit?: boolean;
  /** Связаны вместо ран (стражники Граунда): попадание не снимает ОР; проигрыш — ветка lost. */
  capture?: boolean;
  /** Отряд пал или схвачен. Без ветки — гибель отряда. */
  lost?: Step[];
}

export interface Opt {
  /** Текст кнопки. */
  text: string;
  /** Показывать вариант только при условии. */
  if?: Cond;
  /** Что происходит. */
  do: Step[];
  /** Бот-герой предпочитает этот вариант (вес; по умолчанию 1). Осторожный бот избегает risky. */
  bot?: number;
  risky?: boolean;
}

export interface Ask {
  ask: string;
  opts: Opt[];
  /** Кто решает: leader — вожак за отряд (по умолчанию), each — каждый за себя (ветки по героям), gm — ведущий. */
  who?: 'leader' | 'each' | 'gm' | 'subject' | 'chosen';
}

/** Что дать или отнять. Числа — Qty. */
export interface Give {
  gold?: Qty;
  xp?: Qty | 'level';
  /** ОР: плюс — лечит (не выше максимума), минус — рана. */
  hp?: Qty;
  /** Прибавка к максимуму ОР (и столько же к текущим). */
  hpMax?: Qty;
  heal?: 'full';
  stat?: [Stat, Qty];
  /** Вещь: id из book.ts или 'magic:<n>'; count — стрелы и т. п. */
  item?: string;
  count?: number;
  /** Бутылочки по номерам списка книги (ещё не распознаны: на вид — «бутылочка»). */
  bottles?: number[];
  /** Заклинание по id из book.ts (с полным числом применений). */
  spell?: string;
  /** Подняться на уровень. */
  level?: number;
  /** Поставить очки риска ровно в это число (не выше максимума): «у всех по 1 ОР». */
  hpSet?: number;
  /** Оживить павших и окаменевших (живая вода, маг Смерти в лесу): ОР — столько (по умолчанию половина максимума). */
  revive?: Qty | 'full';
  /** Удвоить деньги героя (мешок клурка). */
  doubleGold?: boolean;
  /** Оберег: firstHit — первое попадание любого противника не причиняет вреда (волшебная вода клурка);
   * stunned — порча: в первой же схватке герой падает без чувств, и противник раз попадает точно (кувшин из алмазов). */
  ward?: 'firstHit' | 'stunned';
}

/** Что отнять. */
export interface Take {
  /** Деньги: с каждого героя (who: 'each' / 'subject') — или, с pool: true, общей суммой с отряда (сначала с вожака). */
  gold?: Qty | 'all' | 'half';
  pool?: boolean;
  /** Вещь по id; 'best-weapon' — лучшее оружие; 'weapons' — всё оружие; 'armor' — доспехи и щит;
   * 'iron' — железное (ржавильщик); 'all' — всё снаряжение. */
  item?: string;
}

export type Step =
  | string // то же, что { say }
  | { say: string; img?: string }
  | { gm: string }
  | Ask
  | { if: Cond; then: Step[]; else?: Step[] }
  /** Выполнить шаги для каждого живого героя по очереди ({name} — этот герой). */
  | { each: Step[] }
  /** Отложить шаги: «в первую же ночь» — сыграются на ближайшем привале (вор сбежит, алмазы станут кувшином). */
  | { later: 'night'; do: Step[] }
  | { roll: RollSpec; pass?: Step[]; fail?: Step[] }
  | Fight
  | { give: Give; who?: Who; say?: string }
  | { take: Take; who?: Who; say?: string }
  /** Флаг мира (переживает сцену): 'c1.mag_gave_gold'. Флаг 'closed:<место>' закрывает место на карте (замок рухнул). */
  | { set: string; v?: FlagVal }
  /** Случайная таблица: d6 (6 веток), d3 (3 ветки) или произвольное число равновероятных веток. */
  | { random: Step[][]; label?: string }
  /** Лавка: kind — 'trurl' (всё оружие и вещи), 'bottles', 'animals', 'weapons'; markup — множитель цены; free — даром;
   * stock — свой список (id и цена); exchange — менять деньги на ИО 1:1 (до 1000 за раз). */
  | { shop: { kind?: 'trurl' | 'bottles' | 'weapons' | 'animals' | 'custom'; markup?: number; free?: boolean; stock?: { id: string; price: number }[]; exchange?: boolean; title?: string } }
  /** Игра на деньги: dice — 4 кубика, у кого больше; cards — ставки на номера d6; hp — Кор играет на ОР.
   * stake — наибольшая ставка, gold — сколько у соперника на кону. */
  | { gamble: { game: 'dice' | 'cards' | 'hp'; vs: string; stake?: number; gold?: number; rounds?: number; win?: Step[]; lose?: Step[] } }
  /** Ночлег/трапеза за плату с человека (heal — лечит ли, в правилах «по книге» не лечит). */
  | { rest: { price: number; heal?: 'full' | number } }
  /** Спутник присоединяется (эльф, гном, крон, человек): ведёт себя как бот, может сражаться. */
  | { join: { id: string; name: string; m?: string; cls?: ClassId; hp?: Qty; kd?: number; dmg?: number[]; text?: string } }
  | { leave: string }
  /** Открыть переход (потайная дверь, проём): id комнаты, куда теперь можно пройти отсюда. */
  | { open: string }
  /** Перейти в другую комнату этого места (провалились в яму — в 17). */
  | { goto: string }
  /** Перенести отряд: на карту (exit), в другое место ('site:c3' — у входа) или в узел карты ('node:42'). */
  | { move: 'exit' | `site:${string}` | `node:${number}` }
  /** Именованный кусок сцены (nodes) — перейти туда. */
  | { node: string }
  /** Смерть героев. */
  | { kill: Who; say?: string }
  /** Сцена окончена; repeat — при новом входе сыграть заново (по умолчанию комната «пустеет» и показывает after). */
  | { end: true; repeat?: boolean }
  /** Закончить партию (победа/поражение) — для кампаний и Чёрного мага. */
  | { finish: 'win' | 'lose'; say: string }
  /** Время: ночь наступает (ночные встречи), прошло дней. */
  | { time: 'night' | 'day' | number }
  /** Задание кампании: записать/вычеркнуть строку в дневнике отряда. */
  | { quest: string; done?: boolean; text?: string }
  /** Проверка агрессивности встречных (d6, бросает ведущий): ветки 1…6 (можно короче — последняя для остальных). */
  | { aggression: Step[][] };

export interface Scene {
  /** Уникальный id: 'c1:5', 'road:17', 'k1:tavern'. */
  id: string;
  title?: string;
  /** Дословный текст книги ведущего (виден только ведущему). */
  gm?: string;
  /** Картинка: id опасности (портрет карточки) или файл из public/zakoldovannaya/. */
  img?: string;
  steps: Step[];
  /** Именованные куски сцены для { node }. */
  nodes?: Record<string, Step[]>;
  /** Что видно при повторном входе после конца сцены. */
  after?: string;
  /** Метки дорожных встреч: night — только ночью, castle — у самого замка, bridge — на мосту, swamp, lake, mountain,
   * forest, steppe, city — у города. */
  tags?: string[];
}

/** Схема своего места кампании (рисуется пергаментной схемой: комнаты — рамки, ходы — линии). Координаты — в условных
 * единицах поля size (обычно 520×330), x/y — центр комнаты, r — радиус (≈18). */
export interface PlanData {
  images: null[];
  sizes: [number, number][];
  rooms: { id: string; x: number; y: number; r: number; kind: 'room' | 'corridor' | 'yard' | 'tower' | 'outside'; img?: number }[];
  links: { a: string; b: string; kind: 'door' | 'secret' | 'open' | 'up' | 'down' | 'gate' }[];
  entry: string[];
}

/** Место с планом (замок, город) — приключение книги или кампании. */
export interface Site {
  id: string;
  /** Номер карточки замка (1–15) — картинка и план. Для своих мест кампании — 0. */
  card: number;
  title: string;
  /** Короткое описание на карте (что видно снаружи). */
  outside: string;
  /** Текст при входе (впервые). */
  enter?: Step[];
  /** Сцены комнат: ключ — id комнаты плана ('5', '5.1', 'c3'). */
  rooms: Record<string, Scene>;
  /** Что за комнатой без сцены (пустой коридор, двор). */
  empty?: string;
  /** Своя схема места (для мест кампаний; у замков книги план — из data/plans.json). Без плана место — одна сцена-меню, как Форпост. */
  plan?: PlanData;
}

// ---------- короткие помощники для записи сцен

export const say = (text: string, img?: string): Step => (img ? { say: text, img } : { say: text });
export const ask = (text: string, opts: Opt[], who?: Ask['who']): Ask => (who ? { ask: text, opts, who } : { ask: text, opts });
export const opt = (text: string, ...steps: Step[]): Opt => ({ text, do: steps });
export const fight = (foes: Foe[] | string, rest: Omit<Fight, 'fight'> = {}): Fight => ({ fight: foes, ...rest });
export const give = (g: Give, who?: Who, text?: string): Step => ({ give: g, ...(who ? { who } : {}), ...(text ? { say: text } : {}) });
export const take = (t: Take, who?: Who, text?: string): Step => ({ take: t, ...(who ? { who } : {}), ...(text ? { say: text } : {}) });
export const roll = (spec: RollSpec, pass: Step[] = [], fail: Step[] = []): Step => ({ roll: spec, pass, fail });
export const when = (cond: Cond, then: Step[], otherwise?: Step[]): Step => (otherwise ? { if: cond, then, else: otherwise } : { if: cond, then });
export const end = (repeat = false): Step => (repeat ? { end: true, repeat: true } : { end: true });

/** Сундук по правилам: набор ключей или заклинание «Отпирание» открывают сразу, иначе «1, 2, 3, 4» на d6;
 * не открылся — «таскайте с собой» (открываете на привале). loot — что внутри. */
export function chest(loot: Step[], label = 'Открыть сундук'): Step {
  const opened: Step[] = [{ say: 'Крышка поддаётся.' }, ...loot];
  return {
    if: { any: [{ item: 'keys', who: 'any' }, { spell: 'otpiranie', who: 'any' }] },
    then: [{ say: 'Набор ключей подходит к замку.' }, ...loot],
    else: [
      {
        roll: { kind: 'd6', need: [1, 2, 3, 4], label, who: 'leader' },
        pass: opened,
        fail: [{ say: 'Замок не поддаётся. Сундук тяжёлый — взваливаете его на плечи и на первом привале сбиваете замок камнем.' }, ...loot],
      },
    ],
  };
}
