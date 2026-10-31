@echo off
chcp 65001 >nul
rem Сборка Pereezd.exe (один файл, с окном, свой Python внутри). Нужен Python 3.10+ и PyInstaller: py -3.12 -m pip install pyinstaller
cd /d "%~dp0"
py -3.12 -m PyInstaller --noconfirm --onefile --windowed --name Pereezd --add-data "%~dp0catalog.json;." --distpath dist --workpath build --specpath build pereezd.py
echo.
echo Готово: %~dp0dist\Pereezd.exe
