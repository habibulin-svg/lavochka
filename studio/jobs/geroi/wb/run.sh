#!/bin/bash
# Задания «Героев» на конвейере Webbook: bash run.sh <задание.yaml> [ключи run.py]
"G:/ai/ComfyUI/venv/Scripts/python.exe" -X utf8 "G:/Claude/Webbook/studio/run.py" "G:/Claude/Shish/studio/jobs/geroi/wb/$1" "${@:2}"
