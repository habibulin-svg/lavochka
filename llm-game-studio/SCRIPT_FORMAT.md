# Формат скрипта LLM Game Studio (LGS v1)

Этот текст можно целиком отдать любой LLM (Claude, ChatGPT, локальной) с просьбой: «напиши скрипт LGS для …».
Студия примет скрипт файлом, вставкой текста или прямо ответом модели (блок ```yaml``` она достанет сама),
проверит, покажет план, докачает недостающие модели и запустит с прогрессом и превью.

## Коротко

- Скрипт — **YAML** (или JSON). Первая строка — `lgs: 1`.
- Скрипт — это **шаги** (`steps`). Шаг делает одно дело: картинки, видео, музыку, звуки, озвучку, текст, код, команду.
- Шаг разворачивается в **единицы работы**: каждый элемент `items` × каждый `seeds`. Одна единица — один результат.
- Шаги идут параллельно, если не зависят друг от друга и не делят видеокарту. Зависимость — `after:` или ссылка `${steps.X.dir}`.
- Модель и видеокарту студия **подбирает сама под железо** (`model: auto`, `gpu: auto`). Указывать конкретную — только если нужно.
- Готовое **не пересчитывается**: повторный запуск того же скрипта доделывает только недостающее (`force: true` — заново).
- Всё сохраняется в `<выход>/<project>/<name>/<id шага>/` + `manifest.json` (промпт, сид, модель, лицензия у каждого файла).

## Шапка

```yaml
lgs: 1                       # версия формата — обязательно
name: kiosk-props            # латиница, цифры, - _ . — имя папки выхода
title: "Ларёк: предметы"     # для людей
description: "..."           # необязательно
project: mygame              # необязательно: группирует запуски одной игры
vars:                        # свои переменные — ${style} в любом месте
  style: "flat cartoon, thick outlines, 90s russian yard, no text"
options:
  stop_on_error: false       # true — первая ошибка останавливает всё; по умолчанию падает только ветка
requires:                    # необязательно: что скачать заранее (шаги и так скажут, что им нужно)
  - kind: image              # «нужна модель картинок» — студия выберет лучшую под железо
  - model: qwen3-tts         # точная модель из каталога студии
  - hf: Qwen/Qwen3-4B-GGUF   # любая модель с Hugging Face
    quant: Q4_K_M            #   для GGUF — квант; для прочих — file: путь в репозитории
    kind: llm
steps: [...]
```

## Шаг

```yaml
- id: props                  # латиница — имя папки результата, на него ссылаются другие шаги
  title: "Предметы ларька"
  uses: image                # тип шага (таблица ниже)
  after: [style]             # необязательно: после каких шагов
  model: auto                # auto | id модели из каталога
  gpu: auto                  # auto | номер карты | cpu
  seeds: [1, 2, 3]           # необязательно: варианты каждой единицы
  with:                      # общие параметры всех единиц
    width: 1024
    height: 1024
  items:                     # единицы работы; у каждой — name (латиница) и свои поля
    - name: gum
      prompt: "pack of bubble gum, ${style}"
    - name: cola
      prompt: "glass bottle of cola, ${style}"
  continue_on_error: false   # true — зависящие шаги всё равно пойдут
  force: false               # true — пересчитать даже готовое
```

Параметр можно задать на трёх уровнях — **единица (items) > шаг (with и сам шаг) > умолчания модели**.

### Откуда берутся единицы

| Способ | Как | Пример |
|---|---|---|
| `items` | список словарей с `name` | см. выше |
| `items_from` | JSON предыдущего шага: `results.json` шага `llm`, `selected.json` шага `approve` или любой список/словарь | `items_from: "${steps.ideas.dir}/results.json"` |
| `inputs` | шаблон путей к файлам; каждый файл — единица с полями `name` (имя без расширения) и `input` (путь) | `inputs: "${steps.art.dir}/*.png"` |
| ничего | одна единица с параметрами шага | для `shell`, `python`, `code` |

`items_from` из `results.json` шага `llm` с `json: true`: если модель вернула **список** объектов — каждый станет единицей
(поля объекта — поля единицы, `name` берётся из объекта или нумеруется); если объект — его поля добавляются к единице.

### Подстановки `${...}`

- `${style}` — переменная из `vars` **или поле этой же единицы** (`prompt: "${subject}, ${style}"`).
- `${seed}`, `${name}` — сид и имя единицы.
- `${steps.<id>.dir}` — папка результатов шага (и неявная зависимость от него).
- `${run.dir}` — папка запуска, `${project}` — проект, `${studio.dir}` — папка самой студии.

## Типы шагов

| uses | Что делает | Поля единицы (обязательные — **жирным**) | Результат |
|---|---|---|---|
| `image` | картинка по промпту (Z-Image-Turbo / SDXL) | **prompt**, width, height, steps, seed, negative (SDXL) | `<name>-<seed>.png` |
| `video` | ролик (Wan 2.2): по картинке или только по тексту | **prompt**, image (путь к первому кадру), width, height, frames (121 = 5 с), steps, negative | `.mp4` |
| `upscale` | увеличение ×4 (Real-ESRGAN), `scale: 0.5` — итог ×2 | **input** (через `inputs`), scale | `.png` |
| `cutout` | вырезка фона (BiRefNet) → PNG с прозрачностью, обрезанный | **input** (через `inputs`), threshold, pad | `.png` |
| `music` | музыка: YuE2 (песни/инструментал по партитуре) или Stable Audio (петли) | YuE2: **style**, lyrics (теги частей `[intro] [verse] [chorus]` или текст), max_duration (с запасом), silence_vocal (инструментал), abc_file. Stable Audio: **prompt**, duration | `.flac`/`.ogg` + `.abc` |
| `sfx` | звук (Stable Audio SFX), громкость по классу | **prompt**, duration, level: `loud`/`normal`/`quiet`/`ui`/`ambience`, max | `.ogg` (+ сырой `.wav`) |
| `tts` | озвучка (Qwen3-TTS): голос по описанию → клон на все фразы | **text**, voice; у шага `voices: {имя: {describe, sample}}`, language | `.ogg` (+ `.wav`) |
| `asr` | распознавание (Whisper); с `expected` — ошибка символов и лучший дубль | **input** (через `inputs`), expected, group | `.json`, `results.json`, `picks.json` |
| `llm` | текст или JSON от языковой модели | **prompt**, system, json (`true` или JSON-схема), max_tokens, temperature, think (`false` — без рассуждений) | `<name>.md`/`.json` + `results.json` |
| `vlm` | модель со зрением смотрит картинки (отбор брака) | **prompt**, input/images (пути), json, system | `.json` + `results.json` |
| `code` | модель пишет файлы, тест проверяет, вывод теста — обратно модели | **task** (текст или путь к .md), **files** (что можно писать: пути/шаблоны от workdir), **test** (команда), workdir, context (файлы только для чтения), max_iters (3), keep_on_fail | файлы + `report.md` |
| `comfy` | любой граф ComfyUI в API-формате, `{{ключ}}` — подстановки из полей единицы | **workflow** (путь к .json), любые поля; `image`/`input` — путь, загрузится сам | что сохранит граф |
| `python` | свой питон-скрипт | **script**, args (список), python (`venv:имя` или путь; по умолчанию питон студии), cwd, env, outputs (шаблоны путей результатов), timeout | по протоколу |
| `shell` | команда оболочки | **run**, cwd, env, outputs, timeout | по протоколу |
| `approve` | пауза: человек смотрит результаты шагов и отмечает лучшие | **show** (id шагов), message, pick (`one`/`many`) | `selected.json` |
| `service` | вручную запустить/остановить серверы | start/stop: `llm`, `comfy-big`, `comfy-small`; llm: `exclusive` (все карты под LLM) / `shared` (малая карта + RAM) / id модели | — |

Серверы (ComfyUI, llama-server) студия поднимает сама, когда шагу нужно, и при нехватке видеопамяти
останавливает **свои** серверы на этой карте. Чужие (запущенные не студией) не трогает. `service` нужен,
только чтобы явно задать окно «все карты под LLM» перед серией шагов `code`.

### Протокол своих скриптов (`python`, `shell`)

Скрипт пишет в stdout строки — студия превращает их в прогресс и превью:

```
@progress 3/10 рисую листья      ← прогресс шага
@output out/leaf-3.png           ← готовый файл (путь от cwd или абсолютный), сразу в превью
@output out/a.ogg {"item": "a"}  ← с подписями
любой другой текст               ← в журнал шага
```

Переменные окружения: `LGS_OUT` (папка шага — пишите результаты сюда), `LGS_RUN_DIR`, `LGS_FFMPEG`,
`CUDA_VISIBLE_DEVICES` (выбранная карта — внутри процесса это `cuda:0`).

## Что модели умеют и чего нет (учитывайте в промптах)

- **Картинки:** Z-Image пишет латиницу, **кириллицу — абракадаброй**: русские надписи делайте потом кодом/шрифтом. Логотипы брендов и «тёмное на тёмном» — брак. Для 3D давайте вид в ¾.
- **Видео:** надписи в кадре — абракадабра (в промпте «no text»); простые эффекты (всплеск, пыль) лучше кодом, Wan — для огня/дыма/взрыва на чёрном. Ролик 960 px нужно апскейлить.
- **Музыка YuE2:** `max_duration` ставьте с запасом — модель обрывает трек на громком месте.
- **Звуки:** всегда указывайте `level` — иначе взрыв окажется тише шага.
- **Озвучка:** описание голоса (`describe`) — по-английски, точнее слушается: пол, возраст, тембр, темп, манера, «Russian».
- **Локальная LLM** для `code` тянет **листья**: модуль без зависимостей с готовым тестом (таблицы данных, парсеры, генераторы, перенос с языка на язык). Ядро игры — не ей.

## Пример: ассеты ларька от идеи до отбора

```yaml
lgs: 1
name: kiosk
title: "Ларёк: идеи → картинки → отбор → вырезка → звуки"
project: mygame
vars:
  style: "flat cartoon, thick outlines, warm colors, 90s russian street kiosk, white background, no text"
steps:
  - id: ideas
    title: Придумать товары
    uses: llm
    json: true
    think: false
    prompt: >
      Придумай 6 товаров ларька 90-х (жвачка, газировка...). Верни JSON-список объектов
      {"name": латиница-через-дефис, "subject": "описание предмета по-английски для генератора картинок",
      "sound": "звук, который он издаёт, по-английски"}.

  - id: art
    title: Картинки
    uses: image
    items_from: "${steps.ideas.dir}/results.json"
    seeds: [1, 2]
    with:
      prompt: "${subject}, single object, ${style}"

  - id: pick
    title: Отбор
    uses: approve
    show: [art]
    message: "Отметьте по одной лучшей картинке на товар"

  - id: cut
    title: Вырезка фона
    uses: cutout
    items_from: "${steps.pick.dir}/selected.json"
    with:
      input: "${file}"

  - id: sounds
    title: Звуки товаров
    uses: sfx
    items_from: "${steps.ideas.dir}/results.json"
    with:
      prompt: "${sound}, close mic, clean"
      duration: 2
      level: normal
```

## Пример: код по заданию с тестом

```yaml
lgs: 1
name: names-gen
project: mygame
steps:
  - id: code
    uses: code
    workdir: "G:/projects/mygame"
    task: |
      Напиши src/names.ts: export function nickname(rng: () => number): string — дворовое погоняло
      из двух частей (прилагательное + существительное), списки по 30 слов. Детерминированно от rng.
    files: ["src/names.ts"]
    context: ["tests/names.test.ts"]
    test: "npx vitest run tests/names.test.ts"
    max_iters: 4
```

## Как просить LLM

> Вот формат скрипта LLM Game Studio (ниже). Напиши скрипт LGS, который: … Только YAML, без пояснений.
> Используй `model: auto`, если не нужна конкретная модель. Имена (`name`, `id`, `items[].name`) — латиницей.

Студия добавляет к этому тексту список моделей и железа вашей машины (кнопка «Скопировать промпт для LLM»),
чтобы модель писала скрипт под то, что реально есть.
