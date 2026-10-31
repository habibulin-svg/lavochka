# Переезд на новую машину

_Составлено 2026-10-31. Новая машина: Ryzen 5 7500F, 32 ГБ DDR5, RTX 4070 12 ГБ + RTX 3070 8 ГБ._

Код целиком в GitHub (`habibulin-svg/lavochka`), поэтому хватит клонировать репозиторий. Вне git остаются только секреты, сканы, память Claude и локальные данные dev-сервера, их переносим руками (шаг 4).

## 1. Софт

| Что | Версия как на старой машине | Заметка |
|---|---|---|
| Git for Windows | 2.55 | с Git Bash; `git lfs` тоже есть (пригодится для ассетов) |
| Node.js | **24.x** (сейчас 24.20) | ставить в `C:\Program Files\nodejs`: на этот путь завязаны хуки в `.claude/settings.json` |
| Python | 3.14 (подойдёт 3.12+) | для `tools/`: `pip install numpy scipy opencv-python pymupdf pillow` |
| Google Chrome | любая свежая | для безголовых снимков превью |
| Claude (десктоп) | свежая | войти тем же аккаунтом |
| Драйвер NVIDIA | Studio или Game Ready, свежий | CUDA-тулкит отдельно не нужен: ComfyUI и llama.cpp тянут свой |

## 2. Ключи SSH

На старой машине в `~/.ssh` лежат:
- `id_ed25519_github` — пуш в GitHub;
- `id_ed25519` — вход на прод-сервер (`ssh lavochka`, FirstVDS 82.146.38.203);
- `config` с хостами `github.com` и `lavochka`.

Есть два варианта:
- **Проще:** скопировать папку `C:\Users\<имя>\.ssh` целиком на флешке и удалить её с флешки после копирования.
- **Безопаснее:** на новой машине выполнить `ssh-keygen -t ed25519`, добавить новый `.pub` в GitHub (Settings → SSH keys) и в `/root/.ssh/authorized_keys` на сервере, `config` скопировать.

Проверка:

```bash
ssh -T git@github.com
```

```bash
ssh lavochka "uptime"
```

## 3. Клонировать — тот же путь `D:\Claude\Shish`

Путь важен: память Claude лежит в папке, названной по пути проекта (`~/.claude/projects/D--Claude-Shish/`). Если путь другой, Claude не найдёт память.

```bash
git clone https://habibulin-svg@github.com/habibulin-svg/lavochka.git D:/Claude/Shish
```

```bash
cd D:/Claude/Shish/lavochka && npm ci
```

## 4. Что перенести руками (в git этого нет)

| Что | Откуда (старая машина) | Зачем |
|---|---|---|
| Память Claude | `C:\Users\h02bt\.claude\projects\D--Claude-Shish\memory\` | решения и предпочтения из прошлых сессий; класть в ту же папку под новым пользователем |
| Глобальные настройки Claude | `C:\Users\h02bt\.claude\settings.json` | модель, разрешения |
| Локальные настройки проекта | `D:\Claude\Shish\.claude\settings.local.json` | личные разрешения |
| Ключи SEO-инструментов | `D:\Claude\Shish\lavochka\tools\seo\.env` | Wordstat/Вебмастер |
| Сканы и материалы | `D:\Claude\Shish\materials\` (2,4 ГБ) | поля ходилок, MAME, словари — только для личного использования |
| Данные dev-сервера | `D:\Claude\Shish\lavochka\data\` | не обязательно: локальные посты/рекорды |
| Неотслеженные файлы | `docs/analysis/rules-*.md`, `docs/marketing/outreach.pdf` | либо скопировать, либо закоммитить до переезда |
| Фото-образцы | `D:\temp\фоны` | сверка игрушек (см. память) |
| Утилита видео-персонажей | ключ routerai, если хранится вне репозитория | `tools/videogen/` |

Секреты прод-сервера уже лежат на самом сервере (`lavochka-secret`), их переносить не нужно.

## 5. Проверка

```bash
cd D:/Claude/Shish/lavochka && npm run check
```

Затем открыть проект в Claude (Code, папка `D:\Claude\Shish`) и попросить «запусти превью lavochka». Хуки SessionStart/Stop должны сработать сами.

## 6. Под локальные модели (ещё до установки софта)

- **Блок питания:** 4070 (200 Вт) + 3070 (220 Вт) + CPU — нужен БП от 850 Вт.
- **Второй слот PCIe:** на большинстве плат AM5 он x4 от чипсета. Для инференса это почти не важно, но 4070 ставить в верхний слот x16.
- **Диск:** под модели нужен отдельный NVMe от 1 ТБ, в сумме уйдёт 300–600 ГБ. Переменные: `HF_HOME=E:\ai\hf`, модели ComfyUI — `E:\ai\comfy\models`, GGUF — `E:\ai\llm`.
- **Порядок карт:** проверить командой `nvidia-smi -L`, индекс 0 должен быть у 4070. Если не так, задать `CUDA_DEVICE_ORDER=PCI_BUS_ID`.
- **Файл подкачки:** от 32 ГБ на NVMe. MoE-модели с экспертами в RAM съедают 18–20 ГБ.

Дальше — `docs/PRODUCTION.md`.
