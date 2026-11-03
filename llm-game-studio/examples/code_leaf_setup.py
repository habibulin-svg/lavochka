"""Пример code-leaf: кладёт в рабочую папку тест, под который локальная LLM пишет модуль."""
import pathlib
import sys

work = pathlib.Path(sys.argv[1])
work.mkdir(parents=True, exist_ok=True)
(work / 'test_nicknames.py').write_text('''import unittest

from nicknames import all_unique, nickname


class T(unittest.TestCase):
    def test_shape(self):
        n = nickname(1)
        self.assertEqual(len(n.split()), 2)
        self.assertTrue(n[0].isupper())

    def test_stable(self):
        self.assertEqual(nickname(42), nickname(42))

    def test_varied(self):
        self.assertGreater(len({nickname(i) for i in range(50)}), 30)
        self.assertIsInstance(all_unique(5), bool)
''', encoding='utf-8')
print('@output', work / 'test_nicknames.py')
