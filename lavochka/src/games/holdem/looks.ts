/* Персонажи холдема 3D: кто сидит за столом (видео-люди и 3D-модели — в одном порядке). Без three — его грузит только 3D-стол. */
import type { Look } from '../../core/view';
import { SEATS } from '../poker/def';

/** Порядок — как у мест: Вовка, Ленка, Серёга, Танька, Димон, Колян, Светка, Жека, Михалыч. */
export const CHARS = ['vovka', 'lenka', 'seryoga', 'tanka', 'dimon', 'kolyan', 'svetka', 'zheka', 'mihalych'];

export const LOOKS: Look[] = CHARS.map((id, i) => ({ id, label: SEATS[i]?.name ?? id }));

/** Персонаж места: выбранный (если знаком) или «свой» по номеру места. */
export const charOf = (seat: number, who?: string | null) => (who && CHARS.includes(who) ? who : CHARS[seat % CHARS.length]);
