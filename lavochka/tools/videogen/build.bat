@echo off
rem Сборка videogen.exe (один файл, с окном). Нужен Python 3.10+ и PyInstaller: py -m pip install pyinstaller
cd /d "%~dp0"
py -m PyInstaller --noconfirm --onefile --windowed --name videogen --distpath dist --workpath build videogen.py
echo.
echo Готово: %~dp0dist\videogen.exe
