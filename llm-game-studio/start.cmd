@echo off
chcp 65001 >nul
rem LLM Game Studio: нужен только Python 3.11+ (пакеты не нужны — PyYAML лежит в vendor/).
cd /d "%~dp0"
where py >nul 2>&1 && (py -3 -m lgs %*) || (python -m lgs %*)
