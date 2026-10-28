/**
 * «Корона Эмбера», «Классика 1994» — состояние партии.
 * Всё — чистые данные (уходит по сети и в сохранения); сценарии карт лежат в кадрах `run` копиями операций.
 */
import type { Align, Op, Stat, Status } from './script';

/** Вещь путника: карта предмета (`i12`) или карта приключений (`a189` — трофей, друг, предмет, карта в руке). */
export interface Thing {
  id: string;
  /** осталось применений (амулеты, заклинания) */
  uses?: number;
  /** сломан (магнитный удар, кровавый дождь) — не действует до ремонта */
  broken?: boolean;
  /** пункты на карте (источник, волколак, тюк с провизией) */
  pts?: number;
  /** друг: бьётся вместе или вместо, охотится, носит предметы */
  with?: 'вместе' | 'вместо';
  hunts?: boolean;
  carries?: number;
  /** куплен на поле (для ремонта после магнитного удара) */
  from?: number;
  /** заговорён амулетом №4/№5 — бьётся вместо тебя столько раз */
  charm?: number;
}

export type Zone = 'world' | 'road' | 'capital' | 'labyrinth' | 'palace' | 'chambers' | 'arena' | 'dead' | 'out';

export interface CHero {
  seat: number;
  /** номер путника в TRAVELLERS */
  tr: number;
  /** карты путников, взятые после смерти или превращения (для «начального уровня» — текущая) */
  sex: 'м' | 'ж';
  align: Align;
  honest: boolean;
  patient: boolean;
  chaos: boolean;
  life: number;
  st: Record<Stat, number>;
  po: number;
  gold: number;
  cell: number;
  /** сектор подполя (Храм Бааля, Перевал); null — не в подполе */
  sector: number | null;
  zone: Zone;
  /** поле 2 */
  node: string;
  ring: number;
  gate: 'L' | 'R' | null;
  room: number;
  prince: number | null;
  things: Thing[];
  friends: Thing[];
  status: Status[];
  skip: number;
  /** клетки последнего хода — для «в обратную сторону» */
  lastPath: number[];
  /** в этом ходу уже прошёл Провал («за 1 ход можешь пройти только 1 провал») */
  fallUsed?: boolean;
  /** регент мира: 'Сила' | 'Ум' | 'Магия' */
  regent?: 'Сила' | 'Ум' | 'Магия';
}

/** Карта приключений, лежащая на поле. */
export interface FieldCard {
  n: number;
  /** зверь «поселился» здесь — при встрече сценарий идёт с места после поселения */
  settled?: boolean;
  /** деньги/пункты под охраной (тролль, всадники, источник, волколак) */
  gold?: number;
  pts?: number;
  /** вещи под охраной (чекист, коммандо, горилла) */
  things?: Thing[];
  /** заколдован (колдовство №29): показатели удвоены */
  bewitched?: boolean;
}

/** Кадр исполнения сценария. */
export interface Frame {
  seat: number;
  ops: Op[];
  i: number;
  /** карта приключений, чей это сценарий (судьба карты — по операции `card`) */
  card?: number;
  /** клетка, на которой карта взята (уйдя с неё, остальные карты серии остаются здесь) */
  at?: number;
  /** судьба карты уже решена */
  fated?: boolean;
  /** кадр условий клетки */
  cell?: number;
}

/** Вопрос игроку. */
export interface Prompt {
  seat: number;
  q: string;
  /** варианты; `key` — машинная метка для обработчика */
  opts: { label: string; key: string }[];
  /** что ждёт ответа: обработчик в engine */
  kind: string;
  /** данные обработчика */
  data?: Record<string, unknown>;
}

/** Бой в процессе. */
export interface Fight {
  seat: number;
  card?: number;
  foe: { name: string; kind?: string; v: number; stat: Stat };
  /** сколько противников осталось (поочерёдно) */
  left: number;
  hunt: boolean;
  without: string[];
  win: Op[];
  lose: Op[];
  draw?: Op[];
  /** кто бьётся: сам или друг (индекс в friends) / призрак / заговорённый */
  champion: { kind: 'self' } | { kind: 'friend'; i: number } | { kind: 'ghost'; v: number };
  stage: 'pre' | 'roll' | 'post';
  /** броски */
  foeRoll?: number;
  myRoll?: number;
  /** итог последнего броска: разница */
  diff?: number;
  /** временная прибавка к своему показателю (перстень, учёный, разрушитель) */
  boost: number;
  /** удвоение своих качеств (перстень 3-4) */
  double?: boolean;
  /** уже применённые средства (чтобы не предлагать снова) */
  used: string[];
}

export interface CState {
  seats: number[];
  kinds: Record<number, 'human' | 'bot'>;
  names: Record<number, string>;
  levels: Record<number, number>;
  heroes: Record<number, CHero>;
  turn: number;
  phase: 'roll' | 'pick' | 'run' | 'over';
  die: number;
  /** ход: сколько очков осталось пройти (после остановки «проходом» — 0) */
  deck: number[];
  discard: number[];
  /** карты приключений на полях */
  field: Record<number, FieldCard[]>;
  /** карты предметов, лежащие на поле предметов (свободные) */
  shelf: number[];
  /** деньги на полях «Банк» и «Чёрная касса мафии» */
  bank: number;
  mafia: number;
  run: Frame[];
  prompt: Prompt | null;
  /** вопросы, заданные, пока висит другой (очередь) */
  pending?: Prompt[];
  fight: Fight | null;
  /** зелёная комета: ходов без переходов между Мирами; буря колдовства: Мир и ходов */
  comet: number;
  storm: { world: string; turns: number; by?: number } | null;
  /** коронованный Король (место) — Провалы закрыты */
  king: number | null;
  log: string[];
  winner: number | null;
  /** номер хода партии */
  round: number;
  /** дуэль в процессе: вызвавший, вызванный, чем бьются, броски */
  duel?: { a: number; b: number; stat: Stat; ra?: number } | null;
  /** предложенная сделка, ждущая ответа */
  trade?: Offer | null;
  /** сколько сделок предложено в этот ход (не больше трёх) */
  offers?: number;
}

/** Предложение торговой сделки: что отдаёт `from` и что просит у `to` (id вещей и талеры). */
export interface Offer {
  from: number;
  to: number;
  give: string[];
  gg: number;
  take: string[];
  tg: number;
}
