@echo off
rem Сборка wrappers-dl.exe (один файл, окно без консоли). Нужен uv (G:\ai\bin\uv.exe) и Python 3.12.
chcp 65001 >nul
cd /d "%~dp0"
set UV=G:\ai\bin\uv.exe
"%UV%" run --python 3.12 --with pyinstaller --with pillow pyinstaller --noconfirm --onefile --windowed ^
  --name wrappers-dl --distpath dist --workpath G:\temp\wrappers-build --specpath G:\temp\wrappers-build ^
  wrappers_dl.py
echo Готово: %~dp0dist\wrappers-dl.exe
