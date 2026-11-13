# Ревью кодовой базы (начато 2026-11-13)

Автономная работа по просьбе пользователя: послойное ревью всего сборника. Если лимит кончился — продолжать
отсюда: смотреть статусы ниже, недоделанное запускать заново. Найденное — в `FINDINGS.md` (сводка) и отчётах слоёв.

**Порядок (решение без пользователя):** 1 → 4 → 2 → 3 — ядро раньше игр, потому что там самые дорогие ошибки, а лимит
может кончиться. **Что чинить сразу:** утечки скрытой информации, падения, безопасность сервера и оплаты, явные
ошибки правил; спорное и большие переделки — в `FINDINGS.md` для пользователя. Пушить — после `npm run check`.

## Слои

| Слой | Что | Модель | Статус | Отчёт |
|---|---|---|---|---|
| 1 | Тест требований CLAUDE.md (`tests/requirements.test.ts`) | — | готово (тест + тексты); открыт показ правил у beglye | `FINDINGS.md` §1 |
| 4 | Ядро и сервер: `core/room, authority, session, client, protocol, net/*, voice, slots, buy/plus/donate`, `server/*` | Opus | идёт | `core.md` |
| 2 | 175 игр пачками | Haiku | идёт (01–06) | `games/batch-NN.md` |
| 3 | Сложные игры (~20) | Sonnet | не начат | `deep/<игра>.md` |

## Пачки слоя 2

(заполняется по мере запуска: пачка → игры → статус)

Сложные игры (слой 3, в слой 2 не входят): gops geroi holdem poker mafia preferans kommersy manager monopol vkladyshi zakoldovannaya bridge thousand secret-hitler detektiv kruzhok nardy shishbesh durak korona

| Пачка | Игры | Статус |
|---|---|---|
| 01 | dvor geo foxgeese cribbage konchinka bluff bulls ludo bagchal kunken | идёт |
| 02 | hodilki brick2026 loto saper puluk pinochle salta xiangqi poedinok balda renju | идёт |
| 03 | sea igroteka star patolli bura schnapsen polkovodec pentago razvedchik pipes kozel | идёт |
| 04 | billiards djio chapaev gadanie erudit daldos baccarat senet whoami sunduchok chaupar musicstudio shel | идёт |
| 05 | chess avtomaty vkosmos okey rummy vozboy hangman vput sto polet tak beglye | идёт |
| 06 | domino checkers zarulem galaktika mahjong fidchell raspisnoy skat seka morskaya king devyatka | идёт |
| 07 | viktorina konversiya ur basketball shariki hive canasta cenariska azul shagdy g2048 drunkard | не начата |
| 08 | akcii lapta magiya vorona tanchiki astro shifrovka vataku blokus shatra perudo brick | не начата |
| 09 | puzzles borodino football cah partizany petteia danetki quoridor tafl mancala abalone hearts | не начата |
| 10 | western crocodile hockey spy aerohockey srazhenie fanorona seabattle perekati mill santorini akulina | не начата |
| 11 | mahjong4 pekar pinbol treasures tarot shtos go shogi govno strelki ttt petardy | не начата |
| 12 | gorodki poezd hanafuda hat tanki shen terc surakarta khrap chinesecheckers janggi hex | не начата |
| 13 | chizh solitaire darts eggs ochko paperball kamisado deberts yahtzee dots reversi elektronika | не начата |
