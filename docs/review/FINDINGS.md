# Найденное при ревью — сводка

Статусы: **исправлено** (коммит), **открыто** (нужно решение пользователя или крупная работа), **принято** (так задумано).

## 1. Требования CLAUDE.md (`tests/requirements.test.ts`)

- FAQ не 4–5 вопросов: chess 3, checkers 2, ur 6, domino 2, mahjong4 3, yahtzee 3, loto 2, perudo 3, durak 3,
  solitaire 2, elektronika 3, brick 3, avtomaty 3 — **исправлено** (дописаны вопросы, у ur убран шестой).
- beglye: нет `seo.ts` — **исправлено**; нет ни одного показа в правилах — **открыто** (сделать показ
  броска кубика со знаками и выхода из монастыря).
- Аркады без пошагового показа правил (hockey, football, aerohockey, basketball, zarulem, treasures, shariki,
  brick2026, eggs) — **принято**, записаны в `KNOWN` теста.
- Карточки-разделы (`members`) и отложенные «Петарды» (`shelved`) тест пропускает.
