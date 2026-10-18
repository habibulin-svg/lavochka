/* Кампания k2 «Красная собака» — городская интрига и сыск. Воровская шайка с трактирами «Красная собака» в Каменном городе
 * и в Граунде крадёт детей и девушек, подкупает стражу и тайно служит Чёрному магу. Пять-шесть глав: Форпост и деревни,
 * Каменный город, дороги и деревни, Граунд, отель «Весёлая ночка», подземный притон «Собачья нора».
 * Этапы сюжета — флаг k2.st (1…7). Рассказ ведётся «этапными» сценами и триггерами; подстраховка для ботов и заблудившихся
 * игроков — предложение доехать (nudge). */
import type { Campaign } from '../campaigns';
import { ch1, ch1Places, ch1Sites, ch1Triggers, INTRO } from './k2-1';
import { ch2, ch2Rooms, ch2Triggers } from './k2-2';
import { ch3, ch3Places, ch3Sites, ch3Triggers } from './k2-3';
import { ch4, ch4Rooms, ch4Triggers } from './k2-4';
import { ch5, ch5Places, ch5Rooms, ch5Sites, ch5Triggers } from './k2-5';
import { ch6, ch6Places, ch6Sites, ch6Triggers } from './k2-6';
import { roadK2 } from './k2-road';
import { table } from './k2-lib';

export const k2: Campaign = {
  id: 'k2',
  title: 'Красная собака',
  hint: 'Городская интрига и сыск: воровская шайка, трактиры «Красная собака», пропавшие дети и предатель при короле.',
  intro: INTRO,
  scenes: table([...ch1, ...ch2, ...ch3, ...ch4, ...ch5, ...ch6, ...roadK2]),
  sites: { ...ch1Sites, ...ch3Sites, ...ch5Sites, ...ch6Sites },
  places: [...ch1Places, ...ch3Places, ...ch5Places, ...ch6Places],
  triggers: [...ch1Triggers, ...ch2Triggers, ...ch3Triggers, ...ch4Triggers, ...ch5Triggers, ...ch6Triggers],
  rooms: { ...ch2Rooms, ...ch4Rooms, ...ch5Rooms },
  road: 'own',
  roadScenes: roadK2.map((x) => x.id.slice('camp:k2:'.length)),
};
