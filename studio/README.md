# Студия — конвейер ассетов вселенной

Тонкий слой скриптов поверх локального ИИ-стека `G:\ai` (план — `docs/PRODUCTION.md` §4).

```
studio/
  run.py            задание YAML → ComfyUI → G:\temp\studio\out\<игра>\<партия>\ + manifest.json
  run.cmd           запуск питоном из venv ComfyUI (там есть yaml и Pillow)
  runners/          клиенты серверов (comfy.py)
  workflows/        графы ComfyUI в API-формате с плейсхолдерами {{...}}
  post/sheet.py     лист для выбора: все картинки партии сеткой с подписями
  jobs/<игра>/      задания
  bible/            библия облика: решения пользователя по стилю
```

Порядок:
1. Запустить ComfyUI на 4070: `G:\ai\start\comfy-big.cmd`.
2. `studio\run.cmd run.py studio\jobs\gops\01-concepts.yaml` (`--only имя`, `--dry`). Уже сделанные файлы из манифеста не пересчитываются.
3. `studio\run.cmd post\sheet.py G:\temp\studio\out\gops\01-concepts` → `sheet.jpg` — показать пользователю.
4. Отобранное — дальше по конвейеру (TripoSG → Blender → спрайты) и в `lavochka/public/…` через Git LFS.

В манифесте у каждого файла — промпт, сид, граф и лицензия модели.
