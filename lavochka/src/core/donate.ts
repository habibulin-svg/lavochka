/* Поддержка проекта (донат): общее для сайта и сервера. Надпись кнопки и цель сбора меняет Мастер в админке. */

/** Готовые суммы, ₽. */
export const DONATE_AMOUNTS = [100, 300, 500, 1000];
/** Пределы свободной суммы, ₽. */
export const DONATE_MIN = 10;
export const DONATE_MAX = 50_000;
/** Надпись кнопки, пока Мастер не задал свою. */
export const DONATE_LABEL = 'Поддержать проект';
/** Назначение платежа (оно же — строка чека). */
export const DONATE_PURPOSE = 'Добровольная поддержка проекта «Вечером на лавочке»';

export interface DonateGoal {
  title: string;
  text: string;
  /** Сколько собрать, ₽ (0 — без шкалы). */
  target: number;
  /** Собрано с начала цели, ₽. */
  collected: number;
}

/** Что сайт показывает про донат (GET /api/donate). */
export interface DonateInfo {
  label: string;
  goal: DonateGoal | null;
  /** Приём платежей подключён (есть ключи Robokassa и база). */
  enabled: boolean;
}

/** Настройки, которые правит Мастер (POST /api/admin/donate). */
export interface DonateSettings {
  label: string;
  goalTitle: string;
  goalText: string;
  goalTarget: number;
  /** Начать счёт собранного заново (с этой минуты). */
  resetCollected?: boolean;
}

export const LIMITS = { label: 40, goalTitle: 80, goalText: 400 };
