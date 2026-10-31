@echo off
rem Студия: питон из venv ComfyUI (в нём уже есть yaml, Pillow, numpy)
chcp 65001 >nul
"G:\ai\ComfyUI\venv\Scripts\python.exe" -X utf8 "%~dp0%1" %2 %3 %4 %5 %6 %7 %8 %9
