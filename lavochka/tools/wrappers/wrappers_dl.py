"""Качалка вкладышей с wrappers.ru: поиск по категориям и коллекциям, выбор номеров, скачивание.

Окно (по умолчанию) или командная строка для проверки:
  wrappers_dl.py --search turbo            найти категории и коллекции
  wrappers_dl.py --list 55                 номера коллекции 55
  wrappers_dl.py --get 55 --items 1-5 --out DIR

Сайт просит Crawl-delay: 3 — все запросы идут через один ограничитель, не чаще раза в 3 секунды.
"""
from __future__ import annotations

import argparse
import html
import io
import json
import os
import queue
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, asdict, field
from datetime import datetime
from pathlib import Path

BASE = 'https://wrappers.ru/'
DELAY = 3.0
UA = 'wrappers-dl/1.0 (personal collection; 1 request per 3 s per robots.txt)'
APP_DIR = Path(os.environ.get('APPDATA', Path.home())) / 'wrappers-dl'
INDEX_FILE = APP_DIR / 'index.json'
SETTINGS_FILE = APP_DIR / 'settings.json'


# ---------- сеть ----------

class Fetcher:
    """Один на программу: держит паузу между любыми запросами, из любых потоков."""

    def __init__(self, delay: float = DELAY):
        self.delay = delay
        self.lock = threading.Lock()
        self.last = 0.0

    def get(self, url: str, tries: int = 3) -> tuple[bytes, str]:
        if url.startswith('http://'):
            url = 'https://' + url[7:]
        elif not url.startswith('https://'):
            url = BASE + url.lstrip('/')
        err: Exception | None = None
        for attempt in range(tries):
            with self.lock:
                wait = self.last + self.delay - time.monotonic()
                if wait > 0:
                    time.sleep(wait)
                try:
                    req = urllib.request.Request(url, headers={'User-Agent': UA})
                    with urllib.request.urlopen(req, timeout=30) as r:
                        data = r.read()
                        ctype = r.headers.get('Content-Type', '')
                    return data, ctype
                except urllib.error.HTTPError as e:
                    if e.code == 404:
                        raise
                    err = e
                except Exception as e:  # обрыв, таймаут
                    err = e
                finally:
                    self.last = time.monotonic()
            time.sleep(2 * (attempt + 1))
        raise err or RuntimeError(url)

    def page(self, url: str) -> str:
        data, _ = self.get(url)
        try:
            return data.decode('utf-8')
        except UnicodeDecodeError:
            return data.decode('cp1251', errors='replace')


def is_image(data: bytes) -> bool:
    return data[:3] == b'\xff\xd8\xff' or data[:8] == b'\x89PNG\r\n\x1a\n' or data[:4] == b'GIF8'


# ---------- разбор страниц ----------

@dataclass
class Collection:
    id: int
    name: str
    desc: str = ''
    category: str = ''


@dataclass
class Category:
    id: int
    name: str
    count: int = 0
    collections: list[Collection] | None = None  # None — ещё не загружали


@dataclass
class Item:
    label: str
    thumb: str

    @property
    def full(self) -> str:
        return re.sub(r'/(pct_[^/]+)$', r'/Full/\1', self.thumb)


def clean(s: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(s).replace('\xa0', ' ')).strip()


def parse_categories(t: str) -> list[Category]:
    out = []
    for cid, name, cnt in re.findall(r'category=(\d+)>([^<]+?)<span class="badge">(\d+)</span>', t):
        out.append(Category(int(cid), clean(name), int(cnt)))
    return out


def parse_collections(t: str, category: str) -> tuple[list[Collection], int]:
    out = []
    for cid, name, desc in re.findall(
            r'acm=coll&(?:amp;)?id=(\d+) title="[^"]*"><b>(.*?)</b>\s*</a><br>(.*?)<br>', t, re.S):
        out.append(Collection(int(cid), clean(name), clean(re.sub(r'<[^>]+>', '', desc)), category))
    pages = [int(p) for p in re.findall(r'category=\d+&p=(\d+)', t)]
    return out, max(pages, default=1)


def parse_print(t: str) -> tuple[str, list[Item]]:
    m = re.search(r'<title>(.*?) - версия для печати</title>', t, re.S)
    title = clean(m.group(1)) if m else ''
    items = [Item(clean(lbl), src) for lbl, src in re.findall(r'<center>([^<]*)<br><img src="([^"]+)"', t)]
    return title, items


# ---------- индекс ----------

class Index:
    def __init__(self, fetcher: Fetcher):
        self.f = fetcher
        self.categories: list[Category] = []
        self.load()

    def load(self):
        try:
            raw = json.loads(INDEX_FILE.read_text(encoding='utf-8'))
            self.categories = []
            for c in raw['categories']:
                cols = c.get('collections')
                self.categories.append(Category(c['id'], c['name'], c.get('count', 0),
                                                None if cols is None else [Collection(**x) for x in cols]))
        except (OSError, ValueError, KeyError):
            self.categories = []

    def save(self):
        APP_DIR.mkdir(parents=True, exist_ok=True)
        INDEX_FILE.write_text(json.dumps({'saved': datetime.now().isoformat(timespec='seconds'),
                                          'categories': [asdict(c) for c in self.categories]},
                                         ensure_ascii=False), encoding='utf-8')

    def ensure_categories(self):
        if not self.categories:
            self.categories = parse_categories(self.f.page('?act=coll&acm=categories'))
            self.save()

    def load_category(self, cat: Category, stop: threading.Event | None = None):
        cols, pages = parse_collections(self.f.page(f'?act=coll&category={cat.id}'), cat.name)
        for p in range(2, pages + 1):
            if stop and stop.is_set():
                return
            more, _ = parse_collections(self.f.page(f'?act=coll&category={cat.id}&p={p}'), cat.name)
            cols += more
        seen, uniq = set(), []
        for c in cols:
            if c.id not in seen:
                seen.add(c.id)
                uniq.append(c)
        cat.collections = uniq
        self.save()

    def search(self, q: str) -> list[tuple[Category, list[Collection]]]:
        """Категории, у которых совпало имя (все их коллекции) или имя/описание коллекций."""
        words = q.lower().split()
        res = []
        for cat in self.categories:
            cat_hit = all(w in cat.name.lower() for w in words)
            cols = [c for c in (cat.collections or [])
                    if cat_hit or all(w in f'{cat.name} {c.name} {c.desc}'.lower() for w in words)]
            if cat_hit or cols:
                res.append((cat, cols if not cat_hit else (cat.collections or [])))
        return res


# ---------- скачивание ----------

def safe(s: str) -> str:
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', s).strip(' .')
    return s or '_'


def file_label(label: str) -> str:
    return label.zfill(3) if label.isdigit() else safe(label or 'x')


def parse_range(spec: str) -> set[str]:
    """«1-50, 61, 0» → набор подписей."""
    out = set()
    for part in re.split(r'[,\s]+', spec.strip()):
        m = re.fullmatch(r'(\d+)-(\d+)', part)
        if m:
            out |= {str(i) for i in range(int(m.group(1)), int(m.group(2)) + 1)}
        elif part:
            out.add(part)
    return out


def download(f: Fetcher, col: Collection, items: list[Item], out_root: Path, full: bool = True,
             log=print, progress=lambda i, n: None, stop: threading.Event | None = None) -> Path:
    folder = out_root / safe(col.category or 'без категории') / f'{safe(col.name)} [{col.id}]'
    folder.mkdir(parents=True, exist_ok=True)
    meta_path = folder / 'meta.json'
    try:
        meta = json.loads(meta_path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        meta = {'collection': asdict(col), 'source': f'{BASE}?act=coll&acm=coll&id={col.id}', 'items': []}
    done = {m['thumb']: m for m in meta['items']}
    used = {m['file'] for m in meta['items']}
    for i, it in enumerate(items):
        if stop and stop.is_set():
            log('Остановлено.')
            break
        progress(i, len(items))
        if it.thumb in done and (folder / done[it.thumb]['file']).exists():
            continue
        data, src, is_full = b'', it.thumb, False
        if full:
            try:
                data, _ = f.get(it.full)
                if is_image(data):
                    src, is_full = it.full, True
                else:
                    data = b''
            except Exception:
                data = b''
        if not data:
            try:
                data, _ = f.get(it.thumb)
            except Exception as e:
                log(f'  №{it.label}: не скачалось ({e})')
                continue
            if not is_image(data):
                log(f'  №{it.label}: вместо картинки пришло что-то другое')
                continue
        ext = '.png' if data[:4] == b'\x89PNG' else '.gif' if data[:4] == b'GIF8' else '.jpg'
        base, k = file_label(it.label), 1
        name = base + ext
        while name in used:
            k += 1
            name = f'{base}_{k}{ext}'
        (folder / name).write_bytes(data)
        used.add(name)
        meta['items'].append({'label': it.label, 'file': name, 'thumb': it.thumb, 'src': src, 'full': is_full})
        meta['updated'] = datetime.now().isoformat(timespec='seconds')
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
        log(f'  №{it.label} → {name}' + ('' if is_full else ' (только миниатюра)'))
    progress(len(items), len(items))
    return folder


# ---------- командная строка ----------

def cli(a) -> int:
    f = Fetcher()
    idx = Index(f)
    if a.search:
        idx.ensure_categories()
        for cat, _ in idx.search(a.search):
            if cat.collections is None:
                idx.load_category(cat)
        for cat, cols in idx.search(a.search):
            print(f'[{cat.id}] {cat.name} ({cat.count})')
            for c in cols:
                print(f'    {c.id:>6}  {c.name}  — {c.desc}')
        return 0
    if a.list or a.get:
        cid = a.list or a.get
        title, items = parse_print(f.page(f'modules/toprint.php?coll={cid}'))
        print(f'{title}: {len(items)} изобр.')
        if a.list:
            print(' '.join(i.label or '?' for i in items))
            return 0
        want = parse_range(a.items) if a.items else None
        sel = [i for i in items if want is None or i.label in want]
        cat = next((c.name for c in idx.categories for x in (c.collections or []) if x.id == cid), '')
        folder = download(f, Collection(cid, title, '', cat), sel, Path(a.out), full=not a.thumbs)
        print('Готово:', folder)
        return 0
    return 1


# ---------- окно ----------

def gui():
    import tkinter as tk
    from tkinter import ttk, filedialog, messagebox
    try:
        from PIL import Image, ImageTk
    except ImportError:
        Image = ImageTk = None

    f = Fetcher()
    idx = Index(f)
    try:
        settings = json.loads(SETTINGS_FILE.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        settings = {}

    root = tk.Tk()
    root.title('Вкладыши с wrappers.ru')
    root.geometry('1180x720')
    ui_q: queue.Queue = queue.Queue()  # (функция, аргументы) из фоновых потоков в окно
    stop = threading.Event()
    jobs: queue.Queue = queue.Queue()

    def ui(fn, *args, **kw):
        ui_q.put((fn, args, kw))

    def pump():
        try:
            while True:
                fn, args, kw = ui_q.get_nowait()
                fn(*args, **kw)
        except queue.Empty:
            pass
        root.after(80, pump)

    def bg(fn, *args):
        threading.Thread(target=fn, args=args, daemon=True).start()

    # --- раскладка ---
    top = ttk.Frame(root, padding=6)
    top.pack(fill='x')
    ttk.Label(top, text='Поиск:').pack(side='left')
    q_var = tk.StringVar(value=settings.get('query', 'turbo'))
    q_entry = ttk.Entry(top, textvariable=q_var, width=40)
    q_entry.pack(side='left', padx=4)
    btn_find = ttk.Button(top, text='Найти')
    btn_find.pack(side='left')
    btn_index = ttk.Button(top, text='Обновить весь индекс')
    btn_index.pack(side='left', padx=12)
    status = tk.StringVar(value='')
    ttk.Label(top, textvariable=status, foreground='#666').pack(side='left', padx=8)

    panes = ttk.PanedWindow(root, orient='horizontal')
    panes.pack(fill='both', expand=True, padx=6)

    left = ttk.Frame(panes)
    tree = ttk.Treeview(left, columns=('info',), show='tree headings', selectmode='browse')
    tree.heading('#0', text='Категория / коллекция')
    tree.heading('info', text='')
    tree.column('#0', width=300)
    tree.column('info', width=180)
    sb = ttk.Scrollbar(left, command=tree.yview)
    tree.configure(yscrollcommand=sb.set)
    tree.pack(side='left', fill='both', expand=True)
    sb.pack(side='left', fill='y')
    panes.add(left, weight=3)

    mid = ttk.Frame(panes)
    col_title = tk.StringVar(value='Выбери коллекцию слева')
    ttk.Label(mid, textvariable=col_title, font=('Segoe UI', 10, 'bold')).pack(anchor='w')
    items_list = tk.Listbox(mid, selectmode='extended', activestyle='none', exportselection=False)
    isb = ttk.Scrollbar(mid, command=items_list.yview)
    items_list.configure(yscrollcommand=isb.set)
    row = ttk.Frame(mid)
    row.pack(side='bottom', fill='x', pady=4)
    items_list.pack(side='left', fill='both', expand=True)
    isb.pack(side='left', fill='y')
    ttk.Label(row, text='Номера:').pack(side='left')
    range_var = tk.StringVar()
    ttk.Entry(row, textvariable=range_var, width=16).pack(side='left', padx=2)
    btn_range = ttk.Button(row, text='Выбрать')
    btn_range.pack(side='left')
    btn_all = ttk.Button(row, text='Все')
    btn_all.pack(side='left', padx=2)
    panes.add(mid, weight=2)

    right = ttk.Frame(panes)
    preview = ttk.Label(right, text='Нажми на номер —\nпокажу картинку', anchor='center', justify='center')
    preview.pack(fill='both', expand=True)
    panes.add(right, weight=3)

    bottom = ttk.Frame(root, padding=6)
    bottom.pack(fill='x')
    ttk.Label(bottom, text='Папка:').pack(side='left')
    out_var = tk.StringVar(value=settings.get('out', str(Path.home() / 'Pictures' / 'vkladyshi')))
    ttk.Entry(bottom, textvariable=out_var, width=50).pack(side='left', padx=4)
    ttk.Button(bottom, text='…', width=3,
               command=lambda: out_var.set(filedialog.askdirectory(initialdir=out_var.get()) or out_var.get())
               ).pack(side='left')
    full_var = tk.BooleanVar(value=settings.get('full', True))
    ttk.Checkbutton(bottom, text='полный размер', variable=full_var).pack(side='left', padx=8)
    btn_dl = ttk.Button(bottom, text='Скачать выбранное')
    btn_dl.pack(side='left', padx=4)
    btn_stop = ttk.Button(bottom, text='Стоп')
    btn_stop.pack(side='left')
    prog = ttk.Progressbar(bottom, length=220)
    prog.pack(side='left', padx=8)
    queue_var = tk.StringVar(value='')
    ttk.Label(bottom, textvariable=queue_var).pack(side='left')

    logbox = tk.Text(root, height=7, state='disabled', font=('Consolas', 9))
    logbox.pack(fill='x', padx=6, pady=(0, 6))

    def log(s: str):
        def w():
            logbox.configure(state='normal')
            logbox.insert('end', s + '\n')
            logbox.see('end')
            logbox.configure(state='disabled')
        ui(w)

    # --- состояние ---
    node_cat: dict[str, Category] = {}
    node_col: dict[str, Collection] = {}
    cur: dict = {'col': None, 'items': []}
    thumbs: dict[str, bytes] = {}
    photo = {'img': None}

    def fill_tree(results):
        tree.delete(*tree.get_children())
        node_cat.clear()
        node_col.clear()
        for cat, cols in results:
            n = tree.insert('', 'end', text=cat.name, values=(f'{cat.count} колл.',), open=bool(cols) and len(results) < 6)
            node_cat[n] = cat
            if cat.collections is None:
                tree.insert(n, 'end', text='…')  # раскроется — загрузим
            for c in cols:
                k = tree.insert(n, 'end', text=c.name, values=(c.desc,))
                node_col[k] = c

    def do_search(*_):
        query = q_var.get().strip()
        status.set('ищу…')

        def work():
            try:
                idx.ensure_categories()
                res = idx.search(query) if query else [(c, c.collections or []) for c in idx.categories]
                # совпавшие категории без списка коллекций — догружаем (по 3 с на страницу)
                for cat, _ in res[:8]:
                    if cat.collections is None:
                        ui(status.set, f'читаю «{cat.name}»…')
                        idx.load_category(cat)
                res = idx.search(query) if query else [(c, c.collections or []) for c in idx.categories]
                ui(fill_tree, res)
                ui(status.set, f'найдено категорий: {len(res)}')
            except Exception as e:
                ui(status.set, f'ошибка: {e}')
        bg(work)

    def on_open(_):
        n = tree.focus()
        cat = node_cat.get(n)
        if cat and cat.collections is None:
            status.set(f'читаю «{cat.name}»…')

            def work():
                try:
                    idx.load_category(cat)
                    ui(refill_node, n, cat)
                    ui(status.set, '')
                except Exception as e:
                    ui(status.set, f'ошибка: {e}')
            bg(work)

    def refill_node(n, cat):
        tree.delete(*tree.get_children(n))
        for c in cat.collections or []:
            k = tree.insert(n, 'end', text=c.name, values=(c.desc,))
            node_col[k] = c

    def on_select(_):
        c = node_col.get(tree.focus())
        if not c or (cur['col'] and cur['col'].id == c.id):
            return
        cur['col'], cur['items'] = c, []
        items_list.delete(0, 'end')
        col_title.set(f'{c.name} — загружаю…')

        def work():
            try:
                _, items = parse_print(f.page(f'modules/toprint.php?coll={c.id}'))
                ui(show_items, c, items)
            except Exception as e:
                ui(col_title.set, f'{c.name} — ошибка: {e}')
        bg(work)

    def show_items(c, items):
        if cur['col'] is not c:
            return
        cur['items'] = items
        col_title.set(f'{c.name} — {len(items)} изобр.')
        for it in items:
            items_list.insert('end', f'№ {it.label}' if it.label else '(без номера)')

    def on_item(_):
        sel = items_list.curselection()
        if not sel or not cur['items']:
            return
        it = cur['items'][sel[-1]]
        if it.thumb in thumbs:
            show_preview(it, thumbs[it.thumb])
            return
        preview.configure(image='', text='загружаю…')

        def work():
            try:
                data, _ = f.get(it.thumb)
                thumbs[it.thumb] = data
                ui(show_preview, it, data)
            except Exception as e:
                ui(preview.configure, text=f'ошибка: {e}')
        bg(work)

    def show_preview(it, data):
        if Image is None:
            preview.configure(text=f'№ {it.label}\n(нет Pillow для показа)')
            return
        try:
            im = Image.open(io.BytesIO(data))
            w = max(200, right.winfo_width() - 20)
            k = min(w / im.width, 2.5)
            im = im.resize((int(im.width * k), int(im.height * k)))
            photo['img'] = ImageTk.PhotoImage(im)
            preview.configure(image=photo['img'], text=f'№ {it.label}', compound='top')
        except Exception as e:
            preview.configure(image='', text=f'не картинка: {e}')

    def select_range():
        want = parse_range(range_var.get())
        items_list.selection_clear(0, 'end')
        for i, it in enumerate(cur['items']):
            if it.label in want:
                items_list.selection_set(i)

    def select_all():
        items_list.selection_set(0, 'end')

    def enqueue():
        c = cur['col']
        sel = [cur['items'][i] for i in items_list.curselection()]
        if not c or not sel:
            messagebox.showinfo('Вкладыши', 'Выбери коллекцию и номера (Ctrl/Shift или «Все»).')
            return
        out = Path(out_var.get())
        save_settings()
        stop.clear()
        log(f'В очередь: {c.name} — {len(sel)} шт.')
        jobs.put((c, sel, out, full_var.get()))
        queue_var.set(f'в очереди: {jobs.qsize()}')

    def worker():
        while True:
            c, sel, out, full = jobs.get()
            ui(queue_var.set, f'в очереди: {jobs.qsize()}')
            log(f'Качаю «{c.name}» ({len(sel)} шт., ~{int(len(sel) * DELAY * (2 if full else 1) / 60) + 1} мин)…')
            try:
                folder = download(f, c, sel, out, full, log=log,
                                  progress=lambda i, n: ui(prog.configure, value=100 * i / max(n, 1)), stop=stop)
                log(f'Готово: {folder}')
            except Exception as e:
                log(f'Ошибка: {e}')

    def rebuild_index():
        if not messagebox.askyesno('Вкладыши', 'Прочитать все категории сайта? Это ~200 запросов, около 10–15 минут '
                                              '(сайт просит паузу 3 с). Потом поиск работает по всем коллекциям сразу.'):
            return
        stop.clear()

        def work():
            try:
                idx.categories = []
                idx.ensure_categories()
                for i, cat in enumerate(idx.categories):
                    if stop.is_set():
                        break
                    ui(status.set, f'индекс: {i + 1}/{len(idx.categories)} — {cat.name}')
                    idx.load_category(cat, stop)
                ui(status.set, 'индекс готов')
                ui(do_search)
            except Exception as e:
                ui(status.set, f'ошибка: {e}')
        bg(work)

    def save_settings():
        try:
            APP_DIR.mkdir(parents=True, exist_ok=True)
            SETTINGS_FILE.write_text(json.dumps({'out': out_var.get(), 'full': full_var.get(), 'query': q_var.get()},
                                                ensure_ascii=False), encoding='utf-8')
        except OSError:
            pass

    btn_find.configure(command=do_search)
    q_entry.bind('<Return>', do_search)
    btn_index.configure(command=rebuild_index)
    tree.bind('<<TreeviewOpen>>', on_open)
    tree.bind('<<TreeviewSelect>>', on_select)
    items_list.bind('<<ListboxSelect>>', on_item)
    btn_range.configure(command=select_range)
    btn_all.configure(command=select_all)
    btn_dl.configure(command=enqueue)
    btn_stop.configure(command=lambda: (stop.set(), log('Стоп — остановлюсь после текущего файла.')))
    root.protocol('WM_DELETE_WINDOW', lambda: (save_settings(), root.destroy()))

    threading.Thread(target=worker, daemon=True).start()
    pump()
    if idx.categories:
        fill_tree(idx.search(q_var.get()) if q_var.get().strip() else [(c, c.collections or []) for c in idx.categories])
        status.set('индекс из прошлого раза; «Найти» — обновить совпавшее')
    else:
        do_search()
    root.mainloop()


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--search')
    p.add_argument('--list', type=int)
    p.add_argument('--get', type=int)
    p.add_argument('--items', help='например 1-50,61')
    p.add_argument('--out', default='.')
    p.add_argument('--thumbs', action='store_true', help='только миниатюры, без Full')
    a = p.parse_args()
    if a.search or a.list or a.get:
        sys.exit(cli(a))
    gui()


if __name__ == '__main__':
    main()
