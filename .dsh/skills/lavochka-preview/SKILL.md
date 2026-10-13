---
name: lavochka-preview
description: Проверка сборника «Вечером на лавочке» в живом браузере — поднять dev-сервер, открыть лаунчер и игру, снять скриншот, потыкать мышью и клавишами, проверить телефон и сетевую игру на двух вкладках. Загружать, когда правку надо увидеть глазами, а не только тестами.
whenToUse: Нужно посмотреть интерфейс в браузере, снять скриншот, проверить раскладку на телефоне, сетевую игру на двух вкладках или сделать превью карточки.
---

# Превью в браузере (DSH)

В DSH нет `preview_start` — вместо него dev-сервер фоновой задачей и браузерный драйвер
`C:\Users\h02bt\.dsh\plugins\dsh-browser\browser-cli.mjs` (настоящий Chrome по CDP, без npm-зависимостей).
Скриншот возвращает путь к PNG — смотри его инструментом `read_image`.

## 1. Dev-сервер

```powershell
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
npm run dev
```
из `D:\Claude\Shish\lavochka`, **в фоне** (`run_in_background: true`), затем прочитать вывод задачи: Vite печатает настоящий адрес.

- Vite слушает только IPv6-localhost: `http://localhost:5173/` работает, `http://127.0.0.1:5173/` **нет** — это не поломка.
- Порт 5173 занят — Vite уходит на 5174; бери адрес из вывода задачи.
- Сервер комнат для сети: `npm run dev:server` (8787, Vite проксирует `/ws` и `/api`).

## 2. Браузер: шаги в одном вызове

Оболочка калечит кавычки в аргументах, поэтому шаги передаются **файлом** (JSON-массив):

```powershell
# файл шагов записать инструментом write, например C:\Users\h02bt\AppData\Local\Temp\dsh-browser\steps.json
& "C:\Program Files\nodejs\node.exe" "C:\Users\h02bt\.dsh\plugins\dsh-browser\browser-cli.mjs" `
  --url "http://localhost:5173/" --width 1280 --height 800 --steps-file "C:\…\steps.json"
```

Шаги: `{"wait":1500}` · `{"shot":"C:/…/a.png"}` (`fullPage`, `selector`) · `{"click":"css"}` или `{"click":{"x":100,"y":200},"touch":true}` ·
`{"type":{"selector":"input","text":"слово"}}` · `{"key":"ArrowLeft","repeat":3}` · `{"eval":"document.title"}` ·
`{"viewport":{"width":390,"height":780,"mobile":true}}` · `{"tabs":"list"}` / `{"tabs":"new","url":"…"}` / `{"tabs":{"select":1}}` / `{"tabs":{"close":1}}` ·
`{"log":true,"onlyErrors":true}` · `{"info":true}` · `{"close":true}`.

Каждый вызов печатает по JSON-строке на шаг: `{"step":"shot","path":"C:/…/a.png","bytes":652974}` — этот путь и открывай `read_image`.

Телефон: `--width 390 --height 780 --mobile`. Сеть: `{"tabs":"new","url":"http://localhost:5173/"}` — у вкладки свой clientId; переключение `{"tabs":{"select":1}}`.

## 3. Убрать за собой

- Проверил партию — закрой вкладку или весь браузер (`{"close":true}`): живая партия ботов играет звуки у пользователя.
- Ненужные фоновые задачи гаси (`job_kill`); dev-серверы `lavochka` / `lavochka-server` можно оставить — они беззвучные.

## 4. Превью карточки игры

Открой `http://localhost:5173/?thumb=<id>` (кадр 960×600), сними скриншот, приведи к 480×300 webp
и положи в `lavochka/public/thumbs/<id>.webp`, прописав `thumb` в `src/games/catalog.ts`.

## 5. Когда браузерный плагин профиля поднимется

Тогда вместо CLI будут доступны инструменты `browser_open`, `browser_shot`, `browser_click`,
`browser_type`, `browser_key`, `browser_eval`, `browser_logs`, `browser_wait`, `browser_viewport`,
`browser_tabs`, `browser_close` — тот же драйвер `cdp.mjs`, только без шелла. Пока строка плагина в
профиле не активируется (статус `absent` в `Config.listConfigs`) — работать через CLI.
