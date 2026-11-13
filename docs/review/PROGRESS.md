# Ревью кодовой базы (начато 2026-11-13)

Автономная работа по просьбе пользователя: послойное ревью всего сборника. Если лимит кончился — продолжать
отсюда: смотреть статусы ниже, недоделанное запускать заново. Найденное — в `FINDINGS.md` (сводка) и отчётах слоёв.

**Порядок (решение без пользователя):** 1 → 4 → 2 → 3 — ядро раньше игр, потому что там самые дорогие ошибки, а лимит
может кончиться. **Что чинить сразу:** утечки скрытой информации, падения, безопасность сервера и оплаты, явные
ошибки правил; спорное и большие переделки — в `FINDINGS.md` для пользователя. Пушить — после `npm run check`.

## Слои

| Слой | Что | Модель | Статус | Отчёт |
|---|---|---|---|---|
| 1 | Тест требований CLAUDE.md (`tests/requirements.test.ts`) | — | **готово** | `FINDINGS.md` §1 |
| 4 | Ядро и сервер | Opus | ревью готово; **исправлены** К1 (падение сервера), К2 (захват места), В4 (потеря hello); открыты В1–В3, В5, М1–М5 | `core.md` |
| 2 | 153 игры, 13 пачек | Haiku → проверка и починка Sonnet | см. таблицу | `games/batch-NN.md` |
| 3 | Сложные игры | Sonnet | начат, прерван лимитом | `deep/<id>.md` |

Промпты агентов: `haiku-prompt.md` (ревью пачки), `verify-prompt.md` (проверка + починка), `deep-prompt.md` (глубокое).

## Пачки слоя 2

Сложные игры (слой 3, в слой 2 не входят): gops geroi holdem poker mafia preferans kommersy manager monopol vkladyshi
zakoldovannaya bridge thousand secret-hitler detektiv kruzhok nardy shishbesh durak korona

| Пачка | Игры | Статус |
|---|---|---|
| 01 | dvor geo foxgeese cribbage konchinka bluff bulls ludo bagchal kunken | готово, исправления в коммите |
| 02 | hodilki brick2026 loto saper puluk pinochle salta xiangqi poedinok balda renju | готово, в коммите |
| 03 | sea igroteka star patolli bura schnapsen polkovodec pentago razvedchik pipes kozel | готово, в коммите |
| 04 | billiards djio chapaev gadanie erudit daldos baccarat senet whoami sunduchok chaupar musicstudio shel | готово, в коммите |
| 05 | chess avtomaty vkosmos okey rummy vozboy hangman vput sto polet tak beglye | готово, в коммите |
| 06 | domino checkers zarulem galaktika mahjong fidchell raspisnoy skat seka morskaya king devyatka | готово, в коммите |
| 07 | viktorina konversiya ur basketball shariki hive canasta cenariska azul shagdy g2048 drunkard | ревью Haiku идёт (возобновлено после лимита) |
| 08 | akcii lapta magiya vorona tanchiki astro shifrovka vataku blokus shatra perudo brick | готово, в коммите |
| 09 | puzzles borodino football cah partizany petteia danetki quoridor tafl mancala abalone hearts | ревью готово; проверка Sonnet идёт (возобновлена) |
| 10 | western crocodile hockey spy aerohockey srazhenie fanorona seabattle perekati mill santorini akulina | готово, в коммите |
| 11 | mahjong4 pekar pinbol treasures tarot shtos go shogi govno strelki ttt petardy | ревью готово; проверка Sonnet идёт |
| 12 | gorodki poezd hanafuda hat tanki shen terc surakarta khrap chinesecheckers janggi hex | готово, в коммите |
| 13 | chizh solitaire darts eggs ochko paperball kamisado deberts yahtzee dots reversi elektronika | ревью Haiku идёт (возобновлено) |

## Слой 3 — глубокое ревью

| Игра | Статус |
|---|---|
| preferans, poker+holdem, mafia(+secret-hitler), durak | начаты, прерваны лимитом (в рабочей копии частичные правки mafia, preferans — не коммитить без доведения) |
| gops, geroi, kommersy, manager+monopol, vkladyshi, zakoldovannaya, bridge, thousand, detektiv, kruzhok, nardy, shishbesh, korona | не начаты |
