"""Запуск студии из любой папки: python llm-game-studio/run.py [--port 7870] [--no-browser]"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from lgs.server import main  # noqa: E402

main()
