/* Обращения (поддержка, ошибки, предложения): общее для сайта и сервера.
 * Обращение приходит формой с сайта или письмом на адреса домена (support@, bugs@, admin@…), ответ Мастера уходит
 * письмом от support@ и виден в профиле автора. */

export const SUPPORT_EMAIL = 'support@lavochka-games.ru';

export const TICKET_KINDS = {
  bug: 'Ошибка',
  question: 'Вопрос',
  idea: 'Предложение',
  pay: 'Подписка и оплата',
  data: 'Персональные данные',
  other: 'Другое',
} as const;
export type TicketKind = keyof typeof TICKET_KINDS;

export const TICKET_STATUS = { new: 'новое', open: 'отвечено', closed: 'закрыто' } as const;
export type TicketStatus = keyof typeof TICKET_STATUS;

export const SUPPORT_LIMITS = { subject: 120, text: 8000, name: 60, email: 200, context: 2000 };

/** Обращение в списке. */
export interface TicketBrief {
  id: number;
  kind: TicketKind;
  status: TicketStatus;
  subject: string;
  /** Кто написал: имя/почта (для Мастера). */
  from: string;
  createdAt: number;
  updatedAt: number;
  source: 'site' | 'mail';
}

export interface TicketMessage {
  /** true — ответ Мастера. */
  staff: boolean;
  author: string;
  text: string;
  at: number;
}

export interface TicketFull extends TicketBrief {
  email: string | null;
  /** Откуда отправлено с сайта: игра, вариант, адрес страницы, браузер (строками «ключ: значение»). */
  context: string | null;
  messages: TicketMessage[];
}

/** Номер обращения в теме письма: «… [№123]» — по нему ответ на письмо попадает в ту же переписку. */
export const ticketTag = (id: number) => `[№${id}]`;
export function ticketIdOf(subject: string): number | null {
  const m = subject.match(/\[(?:№|#|N)\s?(\d{1,9})\]/i);
  return m ? Number(m[1]) : null;
}
