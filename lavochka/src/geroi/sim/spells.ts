/* Заклинания первого выпуска: 4 школы, запись в данных. Иконка — public/geroi/a/icons/spell-<школа>-<NN>.webp. */
export type School = 'fire' | 'water' | 'earth' | 'air';
export type SpellKind = 'damage' | 'aoe' | 'heal' | 'buff' | 'curse' | 'stun' | 'adv';

export interface SpellDef {
  id: string;
  name: string;
  school: School;
  icon: number;
  mana: number;
  kind: SpellKind;
  /** Урон и лечение: база + сила магии × perPower. Бафф и проклятие: величина. */
  base: number;
  perPower: number;
  stat?: 'atk' | 'def' | 'speed';
  /** Раундов у баффа и проклятия: rounds + сила магии ÷ 3. */
  rounds?: number;
  text: string;
}

export const SPELLS: Record<string, SpellDef> = {};
const add = (s: SpellDef) => (SPELLS[s.id] = s);
add({ id: 'fire-arrow', name: 'Огненная стрела', school: 'fire', icon: 1, mana: 5, kind: 'damage', base: 15, perPower: 12, text: 'урон одному отряду' });
add({ id: 'fireball', name: 'Огненный шар', school: 'fire', icon: 2, mana: 12, kind: 'aoe', base: 12, perPower: 8, text: 'урон врагам в круге' });
add({ id: 'bloodlust', name: 'Жажда крови', school: 'fire', icon: 8, mana: 5, kind: 'buff', base: 3, perPower: 0, stat: 'atk', rounds: 2, text: '+3 к атаке' });
add({ id: 'flash', name: 'Слепящая вспышка', school: 'fire', icon: 5, mana: 10, kind: 'stun', base: 0, perPower: 0, text: 'отряд пропускает ход' });
add({ id: 'ice-bolt', name: 'Ледяная стрела', school: 'water', icon: 1, mana: 6, kind: 'damage', base: 18, perPower: 11, text: 'урон одному отряду' });
add({ id: 'heal-light', name: 'Целебный свет', school: 'water', icon: 3, mana: 6, kind: 'heal', base: 20, perPower: 12, text: 'лечит и поднимает павших отряда' });
add({ id: 'blessing', name: 'Благословение', school: 'water', icon: 4, mana: 5, kind: 'buff', base: 2, perPower: 0, stat: 'atk', rounds: 3, text: '+2 к атаке надолго' });
add({ id: 'weakness', name: 'Слабость', school: 'water', icon: 5, mana: 6, kind: 'curse', base: -3, perPower: 0, stat: 'atk', rounds: 2, text: '−3 к атаке' });
add({ id: 'stone-skin', name: 'Каменная кожа', school: 'earth', icon: 1, mana: 5, kind: 'buff', base: 4, perPower: 0, stat: 'def', rounds: 2, text: '+4 к защите' });
add({ id: 'slow', name: 'Замедление', school: 'earth', icon: 2, mana: 6, kind: 'curse', base: -2, perPower: 0, stat: 'speed', rounds: 2, text: '−2 к скорости' });
add({ id: 'meteors', name: 'Метеоритный дождь', school: 'earth', icon: 5, mana: 16, kind: 'aoe', base: 20, perPower: 11, text: 'урон врагам в круге' });
add({ id: 'sorrow', name: 'Скорбь', school: 'earth', icon: 8, mana: 6, kind: 'curse', base: -4, perPower: 0, stat: 'def', rounds: 2, text: '−4 к защите' });
add({ id: 'lightning', name: 'Молния', school: 'air', icon: 1, mana: 8, kind: 'damage', base: 25, perPower: 15, text: 'сильный урон одному отряду' });
add({ id: 'haste', name: 'Ускорение', school: 'air', icon: 3, mana: 5, kind: 'buff', base: 2, perPower: 0, stat: 'speed', rounds: 2, text: '+2 к скорости' });
add({ id: 'precision', name: 'Меткость', school: 'air', icon: 4, mana: 5, kind: 'buff', base: 4, perPower: 0, stat: 'atk', rounds: 1, text: '+4 к атаке' });
add({ id: 'gust', name: 'Порыв ветра', school: 'air', icon: 10, mana: 4, kind: 'curse', base: -1, perPower: 0, stat: 'speed', rounds: 1, text: '−1 к скорости' });

// Заклинания карты: в книге боя их нет
add({ id: 'town-portal', name: 'Врата домой', school: 'air', icon: 7, mana: 16, kind: 'adv', base: 0, perPower: 0, text: 'перенос в ближайший свой город' });
add({ id: 'view-air', name: 'Взор ветра', school: 'air', icon: 8, mana: 4, kind: 'adv', base: 0, perPower: 0, text: 'открыть округу на 12 клеток' });
add({ id: 'summon-boat', name: 'Лодка', school: 'water', icon: 10, mana: 8, kind: 'adv', base: 0, perPower: 0, text: 'лодка к ближайшему берегу' });

/** Круг заклинания: что можно учить в гильдиях и святилищах (3-й — с Мудростью). */
export const SPELL_LEVEL: Record<string, number> = {
  'fire-arrow': 1, bloodlust: 1, 'stone-skin': 1, haste: 1, weakness: 1, gust: 1, 'view-air': 1, 'ice-bolt': 1,
  'heal-light': 2, slow: 2, blessing: 2, precision: 2, sorrow: 2, flash: 2, 'summon-boat': 2,
  fireball: 3, lightning: 3, meteors: 3, 'town-portal': 3,
};

export const spellIcon = (s: SpellDef): string => `spell-${s.school}-${String(s.icon).padStart(2, '0')}`;
