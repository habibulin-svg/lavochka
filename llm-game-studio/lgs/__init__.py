"""LLM Game Studio — локальная студия генерации ассетов и кода на своих моделях."""
import pathlib
import sys

VERSION = '0.1.0'

try:
    import yaml  # noqa: F401
except ImportError:  # PyYAML (MIT) лежит в vendor/ — студии не нужны пакеты сверх стандартной библиотеки
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'vendor'))
