/* Кости маджонга — общее для пасьянса и игры вчетвером. Без DOM.
 * Вид кости (kind): 0–8 медяки 1–9, 9–17 бамбуки, 18–26 тьмы, 27–30 ветра В/Ю/З/С, 31–33 драконы белый/зелёный/красный,
 * 34–37 цветы (слива, орхидея, хризантема, бамбук), 38–41 сезоны (весна, лето, осень, зима).
 * Номер кости (id) в полном наборе из 144: 0–135 — по четыре каждого из 34 видов (kind = id >> 2), 136–143 — цветы и сезоны. */

export const KINDS = 42;
export const kindOf = (id: number) => (id < 136 ? id >> 2 : 34 + (id - 136));

export const isSuit = (k: number) => k < 27;
export const suitOf = (k: number) => Math.floor(k / 9); // 0 медяки, 1 бамбуки, 2 тьмы, 3 — честь
export const rankOf = (k: number) => (k % 9) + 1;
export const isHonor = (k: number) => k >= 27 && k < 34;
export const isWind = (k: number) => k >= 27 && k <= 30;
export const isDragon = (k: number) => k >= 31 && k <= 33;
export const isBonus = (k: number) => k >= 34;
export const isFlower = (k: number) => k >= 34 && k <= 37;
export const isSeason = (k: number) => k >= 38;
export const isTerminal = (k: number) => k < 27 && (k % 9 === 0 || k % 9 === 8);
/** Крайние и честь — «яотю». */
export const isOrphan = (k: number) => isTerminal(k) || isHonor(k);

/** Пара в пасьянсе: одинаковые; цветок — к любому цветку, сезон — к любому сезону. */
export function matches(a: number, b: number) {
  if (a === b) return true;
  return (isFlower(a) && isFlower(b)) || (isSeason(a) && isSeason(b));
}

const SUIT_GEN = ['медяков', 'бамбуков', 'тем'];
const SUIT_SHORT = ['м', 'б', 'т'];
const WIND = ['Восток', 'Юг', 'Запад', 'Север'];
const DRAGON = ['Белый дракон', 'Зелёный дракон', 'Красный дракон'];
const FLOWER = ['Слива', 'Орхидея', 'Хризантема', 'Бамбук-цветок'];
const SEASON = ['Весна', 'Лето', 'Осень', 'Зима'];

/** «пять медяков», «Восток», «Красный дракон». */
export function kindName(k: number): string {
  if (k < 27) {
    const n = rankOf(k);
    const w = ['один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'][n - 1];
    return `${w} ${SUIT_GEN[suitOf(k)]}`;
  }
  if (k <= 30) return WIND[k - 27];
  if (k <= 33) return DRAGON[k - 31];
  if (k <= 37) return FLOWER[k - 34];
  return SEASON[k - 38];
}

/** Короткая запись для журнала: 5м, 7б, В, Кр. */
export function kindShort(k: number): string {
  if (k < 27) return `${rankOf(k)}${SUIT_SHORT[suitOf(k)]}`;
  if (k <= 30) return ['В', 'Ю', 'З', 'С'][k - 27];
  if (k <= 33) return ['Бел', 'Зел', 'Кр'][k - 31];
  if (k <= 37) return FLOWER[k - 34];
  return SEASON[k - 38];
}

export const WIND_NAMES = WIND;
export const WIND_SHORT = ['В', 'Ю', 'З', 'С'];

/** Откуда рисунки костей — раздел правил в обеих играх. */
export const TILE_CREDITS = `<p><b>Японский рисунок</b> — набор <a href="https://github.com/FluffyStuff/riichi-mahjong-tiles" target="_blank" rel="noopener">FluffyStuff/riichi-mahjong-tiles</a>
  (общественное достояние, CC0). <b>Гонконгский рисунок</b>, а также цветы и сезоны в обоих наборах — Cangjie6,
  <a href="https://commons.wikimedia.org/wiki/User:Cangjie6" target="_blank" rel="noopener">Викисклад</a>, лицензия
  <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.ru" target="_blank" rel="noopener">CC BY-SA 4.0</a> (для сборника снят нарисованный корпус кости — корпус рисует игра).
  Набор и цвет рубашки выбираются на экране игры.</p>`;
