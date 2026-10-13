# Слой DeepSeek Harness (DSH) для «Вечером на лавочке»

Проект работает в двух харнессах: Claude Code (`.claude/`) и DeepSeek Harness. Этот каталог —
то, что DSH читает у проекта сам: `<корень>/.dsh/skills` попадает в каталог скиллов сессии
(провайдер `dsh-skill-filesystem`, ранг 100), файлы видны без перезапуска — правишь `SKILL.md`,
и следующий шаг модели уже видит новую редакцию.

## Скиллы

| Скилл | Когда |
|---|---|
| `lavochka-check` | `npm run check` перед коммитом, разбор падений, длинные прогоны ботов |
| `lavochka-search` | где что лежит в `lavochka/src`, поиск правил игр по источникам |
| `lavochka-preview` | живой браузер: dev-сервер, скриншоты, телефон, сеть на двух вкладках |
| `lavochka-release` | проверки → коммит → пуш → `docs/STATE.md` → предложить `/clear` |

Это замена агентам Claude Code из `.claude/agents/` (`searcher`, `tester`): в DSH они переписаны
скиллами, потому что субагенты в DSH берут тот же инструментарий, а смысл был в «прочитать
инструкцию и сделать по ней».

## Хуки

Мост `@deepseek-ai/dsh-hooks-claude-code` подключён в профиле DSH
(`%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`, строка `hooks-claude-code`) и читает
`.claude/hooks.dsh.json` — те же три скрипта, что и в Claude Code, но с матчером `pwsh`:

| Событие | Скрипт | Что делает |
|---|---|---|
| `SessionStart` | `.claude/hooks/session-start.mjs` | подкладывает `docs/STATE.md` и состояние git |
| `PreToolUse` | `.claude/hooks/guard-bash.mjs` | не даёт force-push и коммит сканов из `materials/` |
| `Stop` | `.claude/hooks/stop-check.mjs` | если код сборника менялся — `tsc` + тесты, при падении возвращает к работе |

Особенность DSH: поле `stop_hook_active` мост всегда отдаёт `false`, поэтому у `stop-check.mjs`
есть свой предохранитель — на одну и ту же проверку он возвращает к работе только один раз
(маркер `.claude/.cache/stop-blocked`).

`projectDir` в конфигурации моста не задан намеренно: им становится рабочая папка сессии, так что
в другом проекте (где нет `.claude/hooks.dsh.json`) хуки просто молчат.

**Состояние на 2026-10-13: хуки в DSH не срабатывают.** Мост (`dsh-hooks-claude-code`) подключается
в корне профиля, а агент живёт в области пресета: строки-инструменты оттуда видны (браузер
поднялся именно так), а события (`tools/pre-execute` и т. п.) до слушателя в корне не доходят.
Проверено пробным хуком, который просто писал файл: мост не запускает команды вовсе. Чтобы хуки
заработали, мост нужно ставить в список плагинов **пресета агента** (Настройки → Agent presets) —
это уже работа на будущее. Проверки перед коммитом пока гоняю вручную.

## Браузер

Плагин профиля `@local/dsh-browser` (исходник — `%USERPROFILE%\.dsh\plugins\dsh-browser`) даёт
инструменты `browser_open`, `browser_shot`, `browser_click`, `browser_type`, `browser_key`,
`browser_eval`, `browser_logs`, `browser_wait`, `browser_viewport`, `browser_tabs`, `browser_close`.
Это настоящий Chrome (по CDP, без npm-зависимостей): скриншот возвращает путь к PNG, который
смотрится инструментом `read_image`. Подробности — в README плагина.

**Грабли (стоили часа поисков):** в контракте `ToolDefinition` поле `output` обязательное, и внутри
обязательна схема — `output: { schema: {...}, render(...) }`. Без `output.schema` вызов
`ctx.tools.register()` падает, плагин не поднимается, а причина нигде не видна: stderr приложения
в Electron никуда не пишется. Ещё одна мелочь: мост хуков подставляет только `${CLAUDE_PROJECT_DIR}`
(в фигурных скобках), а `$CLAUDE_PROJECT_DIR` оставляет как есть.

Если инструменты почему-то недоступны, тот же драйвер работает из командной строки
(`browser-cli.mjs`, шаги — файлом JSON, см. скилл `lavochka-preview`).

Dev-сервер после запуска слушает только IPv6: открывай `http://localhost:5173/`
(`http://127.0.0.1:5173/` не отвечает). Если 5173 занят, Vite уходит на 5174 — бери адрес из вывода
фоновой задачи.

## Чего в DSH нет (и чем заменено)

| Claude Code | DSH |
|---|---|
| `preview_start` / скриншоты превью | фоновый `npm run dev` + инструменты `browser_*` |
| `CronCreate` для страховочного таймера | `schedule_create` (раз в ~2 часа) |
| `TaskStop`, `tabs_close` | `job_kill`, `browser_close` / `browser_tabs {action: close}` |
| агенты `searcher` / `tester` на Haiku | скиллы + субагенты и воркфлоу (модель задаётся в `workflow`) |
| `autoContinueAtUsageLimit` | цель (`create_goal`) с автоматическими продолжениями |
