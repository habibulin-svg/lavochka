"""«Переезд» — перенос «Вечером на лавочке» на новую машину и установка локального ИИ-стека.

Один exe (PyInstaller, внутри свой Python и tkinter — на новой машине ставить ничего не нужно). Вкладки по порядку:
  1. Сбор (старая машина): всё, чего нет в GitHub, — в папку-пакет с описью manifest.json.
  2. Программы (новая): драйвер, VC++, Git (+LFS), Node 24, Python 3.12, Chrome, Claude — прямые ссылки и тихая установка.
  3. Секреты: токены и ключи, где их взять; раскладываются по местам. Серверные — на сервере, тут только замена.
  4. Перенос и код: домашние файлы (SSH, память Claude) → git clone → файлы проекта → npm ci, pip.
  5. ИИ-стек: программы и модели (каталог catalog.json) в указанную папку, стартовые скрипты под найденные видеокарты.
  6. Поручения: задания от Claude (JSON в studio/tasks/inbox) — скачать, запустить ComfyUI/LLM, выполнить команду.

Без окна: Pereezd.exe collect --dest X | task FILE [--yes] | watch [--yes] — для запуска из Claude.
"""
import json, os, re, shutil, subprocess, sys, threading, time, queue, urllib.request, urllib.error, urllib.parse, zipfile, datetime, getpass

APP = "Переезд — Вечером на лавочке"
HOME = os.path.expanduser("~")
DEFAULT_PROJECT = r"D:\Claude\Shish"
CFG_DIR = os.path.join(os.environ.get("APPDATA", HOME), "Pereezd")
CFG = os.path.join(CFG_DIR, "settings.json")
UA = {"User-Agent": "pereezd/1.0"}
NOWIN = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW


def here(*p):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, *p)


def load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def settings():
    return load_json(CFG, {}) or {}


def set_setting(**kw):
    s = settings()
    s.update(kw)
    save_json(CFG, s)


def load_catalog(log=None):
    cat = load_json(here("catalog.json"), {})
    url = (cat.get("repo") or {}).get("raw_catalog")
    if url:
        try:
            fresh = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=10).read().decode("utf-8"))
            if fresh.get("version", "") > cat.get("version", ""):
                if log: log(f"Каталог обновлён из GitHub: {fresh['version']}")
                return fresh
        except Exception:
            pass
    return cat


def gb(n):
    if n >= 1e9:
        return f"{n / 1e9:.1f} ГБ"
    if n >= 1e6:
        return f"{n / 1e6:.0f} МБ"
    return f"{max(1, round(n / 1e3))} КБ" if n else "0"


def du(path):
    if os.path.isfile(path):
        return os.path.getsize(path)
    t = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                t += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return t


def claude_key(project):
    """Папка памяти Claude по пути проекта: D:\\Claude\\Shish → D--Claude-Shish."""
    return re.sub(r"[:\\/]", "-", os.path.normpath(project))


# ---------------------------------------------------------------- окружение и запуск

def refresh_path():
    """PATH из реестра — чтобы только что установленные git/node/python находились без перезапуска программы."""
    if os.name != "nt":
        return
    import winreg
    parts = []
    for hive, key in ((winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"), (winreg.HKEY_CURRENT_USER, "Environment")):
        try:
            with winreg.OpenKey(hive, key) as k:
                parts.append(os.path.expandvars(winreg.QueryValueEx(k, "Path")[0]))
        except OSError:
            pass
    extra = [r"C:\Program Files\Git\cmd", r"C:\Program Files\nodejs", os.path.join(os.environ.get("APPDATA", ""), "npm")]
    os.environ["PATH"] = ";".join(parts + extra + [os.environ.get("PATH", "")])


def decode_line(raw):
    """Вывод консольных программ: UTF-8 или кодовая страница OEM (cp866 у cmd и winget)."""
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        try:
            import ctypes
            return raw.decode(f"cp{ctypes.windll.kernel32.GetOEMCP()}", "replace")
        except Exception:
            return raw.decode("cp866", "replace")


def run(cmd, log, cwd=None, env=None, check=True, timeout=None, shell=False):
    """Запуск с выводом в журнал построчно. Возвращает код выхода."""
    refresh_path()
    e = dict(os.environ)
    if env:
        e.update({k: str(v) for k, v in env.items()})
    shown = cmd if isinstance(cmd, str) else " ".join(f'"{c}"' if " " in str(c) else str(c) for c in cmd)
    log(f"> {shown}" + (f"   (в {cwd})" if cwd else ""))
    try:
        p = subprocess.Popen(cmd, cwd=cwd, env=e, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                             shell=shell, creationflags=NOWIN)
    except FileNotFoundError:
        log(f"  не найдено: {cmd[0] if isinstance(cmd, list) else cmd}")
        if check:
            raise RuntimeError(f"нет программы {cmd[0] if isinstance(cmd, list) else cmd}")
        return 127
    t0 = time.time()
    for raw in iter(p.stdout.readline, b""):
        line = decode_line(raw).rstrip()
        if line:
            log("  " + line[-400:])
        if timeout and time.time() - t0 > timeout:
            p.kill()
            raise RuntimeError("превышено время")
    code = p.wait()
    if code and check:
        raise RuntimeError(f"код выхода {code}")
    return code


def which(name):
    refresh_path()
    return shutil.which(name)


def python312():
    if which("py"):
        try:
            out = subprocess.run(["py", "-3.12", "-c", "import sys;print(sys.executable)"], capture_output=True, text=True, creationflags=NOWIN)
            if out.returncode == 0:
                return out.stdout.strip()
        except OSError:
            pass
    p = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Python", "Python312", "python.exe")
    return p if os.path.exists(p) else None


# ---------------------------------------------------------------- скачивание

class _StripAuth(urllib.request.HTTPRedirectHandler):
    """Hugging Face отдаёт файл через CDN: при переходе на другой хост заголовок авторизации не передаём."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None and urllib.parse.urlparse(newurl).netloc != urllib.parse.urlparse(req.full_url).netloc:
            new.headers.pop("Authorization", None)
            new.unredirected_hdrs.pop("Authorization", None)
        return new


_opener = urllib.request.build_opener(_StripAuth)


def http_json(url, token=None, timeout=30):
    h = dict(UA)
    if token:
        h["Authorization"] = f"Bearer {token}"
    return json.loads(_opener.open(urllib.request.Request(url, headers=h), timeout=timeout).read().decode("utf-8"))


def download(url, dest, log, token=None, size=None, stop=None):
    """Скачивание с докачкой (.part + Range). Уже скачанный файл нужного размера пропускается."""
    if os.path.exists(dest) and (size is None or os.path.getsize(dest) == size):
        log(f"  уже есть: {os.path.basename(dest)}")
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    part = dest + ".part"
    have = os.path.getsize(part) if os.path.exists(part) else 0
    h = dict(UA)
    if token:
        h["Authorization"] = f"Bearer {token}"
    if have:
        h["Range"] = f"bytes={have}-"
    try:
        r = _opener.open(urllib.request.Request(url, headers=h), timeout=60)
    except urllib.error.HTTPError as e:
        if e.code == 416:
            os.replace(part, dest)
            return dest
        if e.code in (401, 403):
            raise RuntimeError(f"доступ закрыт ({e.code}): нужен токен Hugging Face и принятая лицензия на странице модели")
        raise
    if have and r.status != 206:
        have = 0
    total = (int(r.headers.get("Content-Length", 0)) + have) or size
    mode = "ab" if have else "wb"
    done, t_last, t0, d0 = have, 0, time.time(), have
    log(f"  качаю {os.path.basename(dest)}" + (f" ({gb(total)})" if total else "") + (f", докачка с {gb(have)}" if have else ""))
    with open(part, mode) as f:
        while True:
            if stop and stop.is_set():
                raise RuntimeError("остановлено")
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if time.time() - t_last > 3:
                t_last = time.time()
                speed = (done - d0) / max(0.1, t_last - t0) / 1e6
                pct = f"{done * 100 // total}%" if total else gb(done)
                log(f"    {os.path.basename(dest)}: {pct}, {speed:.1f} МБ/с", replace=True)
    if total and done < total:
        raise RuntimeError(f"оборвалось на {gb(done)} из {gb(total)} — запустите ещё раз, докачается")
    os.replace(part, dest)
    return dest


def hf_url(repo, path):
    return f"https://huggingface.co/{repo}/resolve/main/{urllib.parse.quote(path)}"


def hf_tree(repo, token=None):
    return [f for f in http_json(f"https://huggingface.co/api/models/{repo}/tree/main?recursive=1", token) if f.get("type") == "file"]


def gh_release_asset(repo, pattern, log, all_releases=False):
    """Последний релиз GitHub с подходящим файлом (у llama.cpp «latest» — не то, поэтому листаем список)."""
    rx = re.compile(pattern)
    rels = http_json(f"https://api.github.com/repos/{repo}/releases?per_page=10") if all_releases else [http_json(f"https://api.github.com/repos/{repo}/releases/latest")]
    for rel in rels:
        for a in rel.get("assets", []):
            if rx.search(a["name"]):
                log(f"  {repo}: {rel['tag_name']} → {a['name']}")
                return a["browser_download_url"], a["name"], a.get("size")
    raise RuntimeError(f"в релизах {repo} нет файла по шаблону {pattern}")


def unzip(path, dest, log, strip_single=False):
    log(f"  распаковка {os.path.basename(path)} → {dest}")
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        tops = {n.split("/")[0] for n in names if n.strip("/")}
        if strip_single and len(tops) == 1:
            top = tops.pop() + "/"
            for n in names:
                if n.endswith("/") or not n.startswith(top):
                    continue
                out = os.path.join(dest, n[len(top):])
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with z.open(n) as src, open(out, "wb") as dst:
                    shutil.copyfileobj(src, dst)
        else:
            z.extractall(dest)


# ---------------------------------------------------------------- 1. сбор

EXCLUDE = ("node_modules/", "__pycache__/", "lavochka/dist/", "lavochka/dist-server/", ".claude/worktrees/", ".claude/.cache/",
           ".claude/scheduled_tasks.lock", "lavochka/tools/videogen/build/", "studio/tasks/done/")


def collect_plan(project, log):
    """Что собрать: [(группа, корень, путь от корня, абсолютный путь, по умолчанию)]."""
    items = []
    git = which("git")
    if git and os.path.isdir(os.path.join(project, ".git")):
        seen = set()
        for args in (["ls-files", "--others", "--exclude-standard"], ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"]):
            out = subprocess.run([git, "-C", project, "-c", "core.quotepath=off"] + args, capture_output=True, creationflags=NOWIN).stdout.decode("utf-8", "replace")
            for rel in out.splitlines():
                rel = rel.strip()
                if not rel or rel in seen or any(x in rel or rel.startswith(x) for x in EXCLUDE):
                    continue
                seen.add(rel)
                rel_os = rel.rstrip("/").replace("/", os.sep)
                default = not rel.endswith(".log")
                items.append(("Проект (нет в GitHub)", "PROJECT", rel_os, os.path.join(project, rel_os), default))
    else:
        log("Git или папка проекта не найдены — файлы проекта не собираю.")
    key = claude_key(project)
    home_items = [
        (".ssh", True, "SSH-ключи: GitHub и прод-сервер (секрет!)"),
        (os.path.join(".claude", "projects", key, "memory"), True, "память Claude по проекту"),
        (os.path.join(".claude", "settings.json"), True, "общие настройки Claude"),
        (".gitconfig", True, "настройки git"),
        (os.path.join(".config", "git"), True, "настройки git"),
    ]
    for rel, d, _ in home_items:
        p = os.path.join(HOME, rel)
        if os.path.exists(p):
            items.append(("Домашняя папка", "HOME", rel, p, d))
    for extra in (r"D:\temp\фоны",):
        if os.path.exists(extra):
            items.append(("Прочее", "ABS", extra, extra, True))
    return items


def git_warnings(project):
    git = which("git")
    if not git:
        return []
    w = []
    st = subprocess.run([git, "-C", project, "status", "--porcelain", "--untracked-files=no"], capture_output=True, text=True, creationflags=NOWIN).stdout.strip()
    if st:
        w.append(f"Есть незакоммиченные изменения в отслеживаемых файлах ({len(st.splitlines())}): они НЕ приедут через GitHub. Закоммитьте и запушьте.")
    subprocess.run([git, "-C", project, "fetch", "-q"], capture_output=True, creationflags=NOWIN)
    ahead = subprocess.run([git, "-C", project, "rev-list", "--count", "@{u}..HEAD"], capture_output=True, text=True, creationflags=NOWIN).stdout.strip()
    if ahead and ahead != "0":
        w.append(f"Есть незапушенные коммиты ({ahead}): сделайте git push.")
    return w


def do_collect(project, dest, chosen, log, stop=None):
    os.makedirs(dest, exist_ok=True)
    files_root = os.path.join(dest, "files")
    manifest = {"made": datetime.datetime.now().isoformat(timespec="seconds"), "user": getpass.getuser(), "home": HOME,
                "project": project, "claude_key": claude_key(project), "items": [], "git": {}}
    git = which("git")
    if git:
        for k in ("user.name", "user.email"):
            v = subprocess.run([git, "config", "--global", k], capture_output=True, text=True, creationflags=NOWIN).stdout.strip() or \
                subprocess.run([git, "-C", project, "config", k], capture_output=True, text=True, creationflags=NOWIN).stdout.strip()
            if v:
                manifest["git"][k] = v
    for group, root, rel, src, _ in chosen:
        if stop and stop.is_set():
            raise RuntimeError("остановлено")
        sub = {"PROJECT": "project", "HOME": "home", "ABS": "abs"}[root]
        rel_store = re.sub(r"^([A-Za-z]):", r"\1", rel) if root == "ABS" else rel
        dst = os.path.join(files_root, sub, rel_store)
        log(f"{group}: {rel}")
        if os.path.isdir(src):
            shutil.copytree(src, dst, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", "node_modules"))
        else:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
        manifest["items"].append({"group": group, "root": root, "rel": rel, "stored": os.path.relpath(dst, dest)})
    if getattr(sys, "frozen", False):
        shutil.copy2(sys.executable, os.path.join(dest, os.path.basename(sys.executable)))
        log("Скопировал саму программу в пакет — на новой машине запускайте её оттуда.")
    save_json(os.path.join(dest, "manifest.json"), manifest)
    log(f"Готово: {dest} ({gb(du(dest))}). В пакете ключи SSH и секреты — храните флешку бережно, после переезда сотрите.")


# ---------------------------------------------------------------- 2. программы

def install_base(item, log, stop=None):
    a = item.get("auto")
    if not a:
        raise RuntimeError("ставится вручную: " + item.get("manual", item["page"]))
    tmp = os.path.join(os.environ.get("TEMP", HOME), "pereezd")
    if a["kind"] == "exe":
        f = download(a["url"], os.path.join(tmp, os.path.basename(urllib.parse.urlparse(a["url"]).path)), log, stop=stop)
        run([f] + a.get("args", []), log, check=False)
    elif a["kind"] == "gh":
        url, name, size = gh_release_asset(a["repo"], a["asset"], log)
        f = download(url, os.path.join(tmp, name), log, size=size, stop=stop)
        run([f] + a.get("args", []), log, check=False)
    elif a["kind"] == "node_msi":
        txt = urllib.request.urlopen(urllib.request.Request(a["index"], headers=UA), timeout=30).read().decode()
        name = re.search(a["pattern"], txt).group(0)
        f = download(a["base"] + name, os.path.join(tmp, name), log, stop=stop)
        run(["msiexec", "/i", f, "/passive", "/norestart"], log, check=False)
    refresh_path()
    if item.get("check"):
        code = run(item["check"], log, check=False)
        log("  ✓ работает" if code == 0 else "  ✗ пока не находится — может понадобиться перезапуск программы или Windows")


# ---------------------------------------------------------------- 3. секреты

SECRETS = [
    {"id": "HF_TOKEN", "name": "Hugging Face — токен (read)",
     "how": "huggingface.co → войти → Settings → Access Tokens → Create new token → тип Read. Для моделей с пометкой «нужен токен» "
            "ещё зайти на страницу модели и нажать «Agree and access repository».",
     "url": "https://huggingface.co/settings/tokens", "where": "переменная HF_TOKEN (setx) и файл токена в HF_HOME"},
    {"id": "GITHUB_TOKEN", "name": "GitHub — токен (не обязателен)",
     "how": "Нужен, только если клонировать по HTTPS без ключа SSH и без входа через браузер. github.com → Settings → Developer settings → "
            "Fine-grained tokens → репозиторий lavochka, права Contents: Read and write.",
     "url": "https://github.com/settings/personal-access-tokens", "where": "хранилище учётных данных git (Git Credential Manager)"},
    {"id": "ROUTERAI_API_KEY", "name": "routerai.ru — ключ API (видеогенератор, tools/videogen)",
     "how": "routerai.ru → Настройки → Ключи. Обычно приезжает из пакета (videogen.json).",
     "url": "https://routerai.ru/settings/keys", "where": "lavochka/tools/videogen/dist/videogen.json и переменная ROUTERAI_API_KEY"},
    {"id": "YANDEX_SEARCH_API_KEY", "name": "Yandex Cloud — ключ Search API (SEO-инструменты)",
     "how": "console.yandex.cloud → сервисный аккаунт с ролью search-api.webSearch.user → Создать API-ключ (область yc.search-api.execute). "
            "Обычно приезжает из пакета (tools/seo/.env).",
     "url": "https://console.yandex.cloud/", "where": "lavochka/tools/seo/.env"},
    {"id": "YANDEX_FOLDER_ID", "name": "Yandex Cloud — ID каталога (b1g…)",
     "how": "console.yandex.cloud → каталог сервисного аккаунта → ID в шапке.", "url": "https://console.yandex.cloud/", "where": "lavochka/tools/seo/.env"},
]

SERVER_SECRETS = [
    ("YADISK_TOKEN", "/etc/lavochka-backup.env", "Яндекс Диск — токен бэкапов (живёт год)", "https://oauth.yandex.ru/"),
    ("ROUTERAI_API_KEY", "/etc/lavochka.env", "routerai.ru — ключ API (Михалыч и ИИ-собеседники)", "https://routerai.ru/settings/keys"),
    ("YANDEX_CLIENT_SECRET", "/etc/lavochka.env", "Яндекс ID — Client secret", "https://oauth.yandex.ru/"),
    ("VK_CLIENT_SECRET", "/etc/lavochka.env", "VK ID — защищённый ключ", "https://id.vk.com/about/business/go"),
    ("VK_SERVICE_KEY", "/etc/lavochka.env", "VK ID — сервисный ключ", "https://id.vk.com/about/business/go"),
    ("UNISENDER_API_KEY", "/etc/lavochka.env", "Unisender Go — API-ключ", "https://go2.unisender.ru/"),
    ("ROBOKASSA_PASS1", "/etc/lavochka.env", "Robokassa — Пароль #1", "https://partner.robokassa.ru/"),
    ("ROBOKASSA_PASS2", "/etc/lavochka.env", "Robokassa — Пароль #2", "https://partner.robokassa.ru/"),
]


def read_env_file(path):
    d = {}
    try:
        for line in open(path, encoding="utf-8"):
            m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$", line)
            if m:
                d[m.group(1)] = m.group(2)
    except OSError:
        pass
    return d


def write_env_file(path, values):
    lines, keys = [], set(values)
    try:
        for line in open(path, encoding="utf-8"):
            m = re.match(r"^\s*([A-Z0-9_]+)\s*=", line)
            if m and m.group(1) in keys:
                lines.append(f"{m.group(1)}={values[m.group(1)]}\n")
                keys.discard(m.group(1))
            else:
                lines.append(line if line.endswith("\n") else line + "\n")
    except OSError:
        pass
    lines += [f"{k}={values[k]}\n" for k in keys]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.writelines(lines)


def current_secrets(project):
    s = {}
    seo = read_env_file(os.path.join(project, "lavochka", "tools", "seo", ".env"))
    s.update({k: v for k, v in seo.items() if v})
    vg = load_json(os.path.join(project, "lavochka", "tools", "videogen", "dist", "videogen.json"), {}) or {}
    if vg.get("key"):
        s["ROUTERAI_API_KEY"] = vg["key"]
    if os.environ.get("HF_TOKEN"):
        s["HF_TOKEN"] = os.environ["HF_TOKEN"]
    s.update({k: v for k, v in (settings().get("secrets") or {}).items() if v})
    return s


def apply_secrets(project, values, log):
    values = {k: v.strip() for k, v in values.items() if v and v.strip()}
    set_setting(secrets={**(settings().get("secrets") or {}), **values})
    if values.get("HF_TOKEN"):
        run(["setx", "HF_TOKEN", values["HF_TOKEN"]], log, check=False)
        os.environ["HF_TOKEN"] = values["HF_TOKEN"]
        hf_home = os.environ.get("HF_HOME") or settings().get("hf_home")
        if hf_home:
            os.makedirs(hf_home, exist_ok=True)
            open(os.path.join(hf_home, "token"), "w").write(values["HF_TOKEN"])
        log("HF_TOKEN записан.")
    seo = {k: values[k] for k in ("YANDEX_SEARCH_API_KEY", "YANDEX_FOLDER_ID") if k in values}
    if seo and os.path.isdir(project):
        write_env_file(os.path.join(project, "lavochka", "tools", "seo", ".env"), seo)
        log("Ключи SEO записаны в lavochka/tools/seo/.env")
    if values.get("ROUTERAI_API_KEY"):
        run(["setx", "ROUTERAI_API_KEY", values["ROUTERAI_API_KEY"]], log, check=False)
        p = os.path.join(project, "lavochka", "tools", "videogen", "dist", "videogen.json")
        if os.path.isdir(project):
            cfg = load_json(p, {}) or {}
            cfg["key"] = values["ROUTERAI_API_KEY"]
            save_json(p, cfg)
            log("Ключ routerai записан для видеогенератора.")
    if values.get("GITHUB_TOKEN") and which("git"):
        data = f"protocol=https\nhost=github.com\nusername=habibulin-svg\npassword={values['GITHUB_TOKEN']}\n\n"
        subprocess.run(["git", "credential", "approve"], input=data.encode(), creationflags=NOWIN)
        log("Токен GitHub сохранён в хранилище git.")


def send_server_secret(name, file, value, log):
    """Как tools/server/secret-gui: значение — во вход lavochka-secret по SSH, нигде не сохраняется."""
    p = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "lavochka", f"lavochka-secret {name} {file}"],
                       input=(value.strip() + "\n").encode("utf-8"), capture_output=True, creationflags=NOWIN)
    out = (p.stdout + p.stderr).decode("utf-8", "replace").strip()
    log(f"{name}: {out or ('готово' if p.returncode == 0 else 'ошибка')}")


# ---------------------------------------------------------------- 4. перенос и код

def restore(pack, project, part, log, stop=None):
    """part: 'home' — SSH, Claude, git; 'project' — файлы проекта и прочее."""
    m = load_json(os.path.join(pack, "manifest.json"))
    if not m:
        raise RuntimeError("в папке нет manifest.json — укажите папку, которую сделала вкладка «Сбор»")
    new_key = claude_key(project)
    for it in m["items"]:
        if stop and stop.is_set():
            raise RuntimeError("остановлено")
        src = os.path.join(pack, it["stored"])
        if it["root"] == "HOME" and part == "home":
            rel = it["rel"].replace(m["claude_key"], new_key)
            dst = os.path.join(HOME, rel)
        elif it["root"] == "PROJECT" and part == "project":
            dst = os.path.join(project, it["rel"])
        elif it["root"] == "ABS" and part == "project":
            dst = it["rel"]
        else:
            continue
        if os.path.isfile(src) and os.path.isfile(dst) and dst.endswith("settings.json"):
            shutil.copy2(dst, dst + ".bak")
        log(f"→ {dst}")
        if os.path.isdir(src):
            shutil.copytree(src, dst, dirs_exist_ok=True)
        else:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
    if part == "home":
        ssh = os.path.join(HOME, ".ssh")
        if os.path.isdir(ssh):
            # OpenSSH под Windows не берёт ключ, если его видят другие пользователи
            for f in os.listdir(ssh):
                if f.startswith("id_") and not f.endswith(".pub"):
                    run(["icacls", os.path.join(ssh, f), "/inheritance:r", "/grant:r", f"{getpass.getuser()}:F"], log, check=False)
        if which("git"):
            for k, v in (m.get("git") or {}).items():
                run(["git", "config", "--global", k, v], log, check=False)


def setup_code(pack, project, opts, cat, log, stop=None):
    refresh_path()
    if not which("git"):
        raise RuntimeError("git не найден — сначала вкладка «Программы»")
    if pack and opts.get("home"):
        log("— Домашние файлы (SSH, память Claude, git)")
        restore(pack, project, "home", log, stop)
    run(["git", "lfs", "install"], log, check=False)
    if not os.path.isdir(os.path.join(project, ".git")):
        if os.path.isdir(project) and os.listdir(project):
            raise RuntimeError(f"папка {project} не пуста и это не git — выберите пустую или новую")
        os.makedirs(os.path.dirname(project), exist_ok=True)
        key = os.path.join(HOME, ".ssh", "id_ed25519_github")
        url = cat["repo"]["ssh"] if os.path.exists(key) else cat["repo"]["https"]
        log(f"— Клонирую {url}")
        if url.startswith("git@"):
            run(["ssh", "-o", "StrictHostKeyChecking=accept-new", "-T", "git@github.com"], log, check=False)
        run(["git", "clone", url, project], log)
        if url.startswith("git@"):
            run(["git", "-C", project, "remote", "set-url", "--push", "origin", cat["repo"]["https"].replace("https://", "https://habibulin-svg@")], log, check=False)
            run(["git", "-C", project, "remote", "set-url", "origin", cat["repo"]["https"].replace("https://", "https://habibulin-svg@")], log, check=False)
    else:
        log("— Проект уже склонирован, git pull")
        run(["git", "-C", project, "pull", "--ff-only"], log, check=False)
    if pack and opts.get("project"):
        log("— Файлы проекта, которых нет в GitHub")
        restore(pack, project, "project", log, stop)
    if opts.get("npm"):
        log("— npm ci (библиотеки сборника)")
        run(["npm", "ci"], log, cwd=os.path.join(project, "lavochka"), shell=True)
    if opts.get("pip"):
        py = python312() or which("python")
        if py:
            log("— Python-библиотеки инструментов")
            run([py, "-m", "pip", "install", "--upgrade", "numpy", "scipy", "opencv-python", "pymupdf", "pillow"], log, check=False)
    log("Готово. Откройте папку проекта в Claude и попросите «запусти npm run check».")


# ---------------------------------------------------------------- 5. ИИ-стек

def gpus():
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=index,name,memory.total,pci.bus_id", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, creationflags=NOWIN).stdout
    except OSError:
        return []
    res = []
    for line in out.strip().splitlines():
        i, name, mem, bus = [x.strip() for x in line.split(",")]
        res.append({"index": int(i), "name": name, "mem_gb": round(int(mem) / 1024), "bus": bus})
    return res


def gpu_roles(gs):
    if not gs:
        return None, None
    s = sorted(gs, key=lambda g: -g["mem_gb"])
    return s[0], (s[1] if len(s) > 1 else None)


def install_ai_program(pid, root, log, stop=None):
    tmp = os.path.join(root, "_downloads")
    if pid == "llamacpp":
        d = os.path.join(root, "llama.cpp")
        for pat in (r"^llama-b\d+-bin-win-cuda-12\.\d+-x64\.zip$", r"^cudart-llama-bin-win-cuda-12\.\d+-x64\.zip$"):
            url, name, size = gh_release_asset("ggml-org/llama.cpp", pat, log, all_releases=True)
            unzip(download(url, os.path.join(tmp, name), log, size=size, stop=stop), d, log)
    elif pid == "comfyui":
        py = python312()
        if not py:
            raise RuntimeError("нужен Python 3.12 — вкладка «Программы»")
        d = os.path.join(root, "ComfyUI")
        if not os.path.isdir(os.path.join(d, ".git")):
            run(["git", "clone", "https://github.com/comfyanonymous/ComfyUI.git", d], log)
        else:
            run(["git", "-C", d, "pull", "--ff-only"], log, check=False)
        vpy = os.path.join(d, "venv", "Scripts", "python.exe")
        if not os.path.exists(vpy):
            run([py, "-m", "venv", os.path.join(d, "venv")], log)
        run([vpy, "-m", "pip", "install", "--upgrade", "pip"], log, check=False)
        run([vpy, "-m", "pip", "install", "torch", "torchvision", "torchaudio", "--index-url", "https://download.pytorch.org/whl/cu128"], log)
        run([vpy, "-m", "pip", "install", "-r", os.path.join(d, "requirements.txt")], log)
        for repo in ("Comfy-Org/ComfyUI-Manager", "city96/ComfyUI-GGUF", "pollockjj/ComfyUI-MultiGPU"):
            nd = os.path.join(d, "custom_nodes", repo.split("/")[1])
            if not os.path.isdir(nd):
                run(["git", "clone", f"https://github.com/{repo}.git", nd], log, check=False)
            req = os.path.join(nd, "requirements.txt")
            if os.path.exists(req):
                run([vpy, "-m", "pip", "install", "-r", req], log, check=False)
    elif pid == "uv":
        url = "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip"
        unzip(download(url, os.path.join(tmp, "uv.zip"), log, stop=stop), os.path.join(root, "bin"), log)
    elif pid == "acestep":
        d = os.path.join(root, "ACE-Step-1.5")
        if not os.path.isdir(os.path.join(d, ".git")):
            run(["git", "clone", "https://github.com/ace-step/ACE-Step-1.5.git", d], log)
        uv = os.path.join(root, "bin", "uv.exe")
        if not os.path.exists(uv):
            install_ai_program("uv", root, log, stop)
        run([uv, "sync"], log, cwd=d, env={"UV_PYTHON": python312() or "3.12"})
    elif pid in ("audio", "tts"):
        py = python312()
        if not py:
            raise RuntimeError("нужен Python 3.12")
        venv = os.path.join(root, "venvs", pid)
        vpy = os.path.join(venv, "Scripts", "python.exe")
        if not os.path.exists(vpy):
            run([py, "-m", "venv", venv], log)
        run([vpy, "-m", "pip", "install", "--upgrade", "pip"], log, check=False)
        run([vpy, "-m", "pip", "install", "torch", "torchaudio", "--index-url", "https://download.pytorch.org/whl/cu128"], log)
        if pid == "audio":
            run([vpy, "-m", "pip", "install", "audio-separator[gpu]", "git+https://github.com/CPJKU/beat_this.git"], log)
            run([vpy, "-m", "pip", "install", "basic-pitch"], log, check=False)
        else:
            run([vpy, "-m", "pip", "install", "chatterbox-tts"], log)
    elif pid == "ffmpeg":
        f = download("https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip", os.path.join(tmp, "ffmpeg.zip"), log, stop=stop)
        unzip(f, os.path.join(root, "ffmpeg"), log, strip_single=True)
    elif pid == "blender":
        run(["winget", "install", "-e", "--id", "BlenderFoundation.Blender", "--silent", "--accept-source-agreements", "--accept-package-agreements"], log, check=False)
    elif pid == "opencode":
        run(["npm", "install", "-g", "opencode-ai"], log, shell=True, check=False)
    elif pid == "lmstudio":
        run(["winget", "install", "-e", "--id", "ElementLabs.LMStudio", "--silent", "--accept-source-agreements", "--accept-package-agreements"], log, check=False)


def model_dir(root, m):
    base = {"llm": os.path.join(root, "llm"), "comfy": os.path.join(root, "ComfyUI", "models"), "models": os.path.join(root, "models")}[m["dest"]]
    return base


def install_model(m, root, token, log, stop=None):
    if m.get("gated") and not token:
        raise RuntimeError("модель закрыта: впишите токен Hugging Face на вкладке «Секреты» и примите лицензию на странице модели")
    base = model_dir(root, m)
    if m.get("url"):
        download(m["url"], os.path.join(base, m.get("sub", ""), os.path.basename(m["url"])), log, stop=stop)
        return
    if m.get("snapshot"):
        files = hf_tree(m["repo"], token)
        log(f"  {m['repo']}: {len(files)} файлов, {gb(sum(f.get('size', 0) for f in files))}")
        for f in files:
            download(hf_url(m["repo"], f["path"]), os.path.join(base, m["sub"], *f["path"].split("/")), log, token, f.get("size"), stop)
        return
    sizes = {f["path"]: f.get("size") for f in hf_tree(m["repo"], token)}
    for f in m["files"]:
        if f["path"] not in sizes:
            raise RuntimeError(f"в {m['repo']} нет файла {f['path']} — обновите каталог")
        name = f.get("as") or os.path.basename(f["path"])
        download(hf_url(m["repo"], f["path"]), os.path.join(base, f.get("sub", ""), name), log, token, sizes[f["path"]], stop)


def check_new_versions(cat, log, token=None):
    log("Свежие модели тех же семейств на Hugging Face (новее, чем в каталоге):")
    for m in cat["models"]:
        w = m.get("watch")
        if not w:
            continue
        try:
            q = f"https://huggingface.co/api/models?author={w['author']}&search={urllib.parse.quote(w['search'])}&sort=createdAt&direction=-1&limit=15"
            newer = [x for x in http_json(q, token) if x.get("createdAt", "")[:10] > w["since"]
                     and (not w.get("match") or re.search(w["match"], x["id"]))]
        except Exception as e:
            log(f"  {m['name']}: ошибка {e}")
            continue
        if newer:
            log(f"  {m['name']}  [{w.get('hint', '')}]")
            for x in newer[:8]:
                log(f"     {x['createdAt'][:10]}  {x['id']}")
        else:
            log(f"  {m['name']}: новее нет")
    log("Новое не значит подходящее: размер и лицензию сверяет Claude, он и обновит каталог.")


def write_start_scripts(root, cat, log):
    gs = gpus()
    big, small = gpu_roles(gs)
    if not big:
        log("nvidia-smi не нашёл видеокарт — скрипты пишу с индексами 0 и 1, поправьте при необходимости.")
        big, small = {"index": 0, "name": "?", "mem_gb": 12}, {"index": 1, "name": "?", "mem_gb": 8}
    log(f"Большая карта: #{big['index']} {big['name']} {big['mem_gb']} ГБ" + (f"; малая: #{small['index']} {small['name']} {small['mem_gb']} ГБ" if small else "; вторая не найдена"))
    sm = small or big
    hf_home = os.path.join(root, "hf")
    os.makedirs(hf_home, exist_ok=True)
    run(["setx", "HF_HOME", hf_home], log, check=False)
    os.environ["HF_HOME"] = hf_home
    set_setting(hf_home=hf_home)
    d = os.path.join(root, "start")
    os.makedirs(d, exist_ok=True)
    llm = os.path.join(root, "llm")
    srv = os.path.join(root, "llama.cpp", "llama-server.exe")
    head = f"@echo off\r\nchcp 65001 >nul\r\nset CUDA_DEVICE_ORDER=PCI_BUS_ID\r\nset HF_HOME={hf_home}\r\nset PATH={root}\\bin;{root}\\ffmpeg\\bin;%PATH%\r\n"
    two = f"{big['index']},{sm['index']}" if small else f"{big['index']}"
    ts = f"-ts {big['mem_gb']},{sm['mem_gb']}" if small else ""
    comfy = os.path.join(root, "ComfyUI")
    scripts = {
        "llm-code.cmd": f'{head}title lav-llm-code\r\nset CUDA_VISIBLE_DEVICES={two}\r\n"{srv}" -m "{llm}\\Qwen3.8-27B-UD-Q4_K_M.gguf" --mmproj "{llm}\\Qwen3.8-27B-mmproj-F16.gguf" -ngl 999 {ts} -sm layer -c 32768 -fa on --jinja --temp 0.6 --top-p 0.95 --top-k 20 --host 127.0.0.1 --port 8080\r\n',
        "llm-moe.cmd": f'{head}title lav-llm-code\r\nset CUDA_VISIBLE_DEVICES={big["index"]}\r\nrem эксперты MoE в оперативной памяти; если не влезает в видеопамять — увеличить --n-cpu-moe\r\n"{srv}" -m "{llm}\\Qwen3.6-35B-A3B-MTP-UD-IQ4_XS.gguf" -ngl 999 --n-cpu-moe 24 --spec-type draft-mtp --spec-draft-n-max 2 -c 65536 -fa on --jinja --temp 0.6 --top-p 0.95 --top-k 20 --host 127.0.0.1 --port 8080\r\n',
        "vlm-check.cmd": f'{head}title lav-vlm\r\nset CUDA_VISIBLE_DEVICES={sm["index"]}\r\n"{srv}" -m "{llm}\\Qwen_Qwen3.5-9B-Q4_K_M.gguf" --mmproj "{llm}\\mmproj-Qwen_Qwen3.5-9B-f16.gguf" -ngl 999 -c 16384 -fa on --jinja --host 127.0.0.1 --port 8081\r\n',
        "comfy-big.cmd": f'{head}title lav-comfy-big\r\ncd /d "{comfy}"\r\nvenv\\Scripts\\python.exe main.py --cuda-device {big["index"]} --port 8188 --output-directory "{root}\\out\\comfy-big" --user-directory "{root}\\comfy-user-big"\r\n',
        "comfy-small.cmd": f'{head}title lav-comfy-small\r\ncd /d "{comfy}"\r\nvenv\\Scripts\\python.exe main.py --cuda-device {sm["index"]} --port 8189 --output-directory "{root}\\out\\comfy-small" --user-directory "{root}\\comfy-user-small" --lowvram\r\n',
        "acestep.cmd": f'{head}title lav-acestep\r\nset CUDA_VISIBLE_DEVICES={big["index"]}\r\ncd /d "{root}\\ACE-Step-1.5"\r\n"{root}\\bin\\uv.exe" run acestep\r\n',
        "stop-all.cmd": '@echo off\r\nfor %%t in (lav-llm-code lav-vlm lav-comfy-big lav-comfy-small lav-acestep) do taskkill /FI "WINDOWTITLE eq %%t*" /T /F >nul 2>&1\r\ntaskkill /IM llama-server.exe /F >nul 2>&1\r\necho Всё остановлено.\r\n',
    }
    scripts["mode-code.cmd"] = f'@echo off\r\ncall "{d}\\stop-all.cmd"\r\nstart "lav-llm-code" cmd /k "{d}\\llm-code.cmd"\r\n'
    scripts["mode-content.cmd"] = f'@echo off\r\ncall "{d}\\stop-all.cmd"\r\nstart "lav-comfy-big" cmd /k "{d}\\comfy-big.cmd"\r\nstart "lav-comfy-small" cmd /k "{d}\\comfy-small.cmd"\r\n'
    for name, body in scripts.items():
        with open(os.path.join(d, name), "w", encoding="utf-8", newline="") as f:
            f.write(body)
    ai = {"root": root, "hf_home": hf_home, "gpus": gs, "big": big, "small": small,
          "servers": {"code": 8080, "vlm": 8081, "comfy-big": 8188, "comfy-small": 8189, "acestep": 7860},
          "paths": {"llm": llm, "comfy": comfy, "models": os.path.join(root, "models"), "out": os.path.join(root, "out"),
                    "venv_audio": os.path.join(root, "venvs", "audio"), "venv_tts": os.path.join(root, "venvs", "tts"),
                    "ffmpeg": os.path.join(root, "ffmpeg", "bin", "ffmpeg.exe")},
          "catalog": cat.get("version")}
    save_json(os.path.join(root, "ai.json"), ai)
    set_setting(ai_root=root)
    log(f"Скрипты: {d}. Описание стека для Claude: {os.path.join(root, 'ai.json')}")


# ---------------------------------------------------------------- 6. поручения

TASK_HELP = """Поручение — JSON-файл в <проект>\\studio\\tasks\\inbox\\. Его пишет Claude; программа выполняет шаги по порядку,
итог кладёт в studio\\tasks\\done\\<id>\\ (task.json, log.txt, result.json). Подстановки: {AI} {PROJECT} {HF_HOME} {OUT}.
{"id": "...", "title": "...", "steps": [
  {"type": "hf", "repo": "...", "file": "путь в репо", "dest": "{AI}/ComfyUI/models/loras"},
  {"type": "download", "url": "...", "dest": "{AI}/x/file.zip", "unzip": "{AI}/x"},
  {"type": "cmd", "cmd": ["..."], "cwd": "{AI}", "env": {}, "timeout": 3600},        ← спросит подтверждение
  {"type": "comfy", "server": "comfy-big", "workflow": "{PROJECT}/studio/workflows/x.json", "set": {"6.inputs.text": "..."}, "out": "{OUT}"},
  {"type": "llm", "server": "code", "system": "...", "prompt": "...", "images": ["a.png"], "out": "{OUT}/answer.md"},
  {"type": "git_pull"}]}"""


def subst(v, ctx):
    if isinstance(v, str):
        for k, x in ctx.items():
            v = v.replace("{" + k + "}", x)
        return v
    if isinstance(v, list):
        return [subst(x, ctx) for x in v]
    if isinstance(v, dict):
        return {k: subst(x, ctx) for k, x in v.items()}
    return v


def comfy_run(port, workflow, sets, out, log, stop=None):
    wf = load_json(workflow)
    if not wf:
        raise RuntimeError(f"нет workflow {workflow} (нужен формат API: Save (API Format))")
    for path, val in (sets or {}).items():
        node, *keys = path.split(".")
        t = wf[node]
        for k in keys[:-1]:
            t = t[k]
        t[keys[-1]] = val
    base = f"http://127.0.0.1:{port}"
    req = urllib.request.Request(base + "/prompt", data=json.dumps({"prompt": wf}).encode(), headers={"Content-Type": "application/json"})
    pid = json.loads(urllib.request.urlopen(req, timeout=30).read())["prompt_id"]
    log(f"  ComfyUI :{port} принял задание {pid}")
    while True:
        if stop and stop.is_set():
            raise RuntimeError("остановлено")
        h = json.loads(urllib.request.urlopen(f"{base}/history/{pid}", timeout=30).read())
        if pid in h:
            break
        time.sleep(2)
    files = []
    os.makedirs(out, exist_ok=True)
    for node in h[pid].get("outputs", {}).values():
        for kind in ("images", "gifs", "audio", "video", "files"):
            for f in node.get(kind, []):
                q = urllib.parse.urlencode({"filename": f["filename"], "subfolder": f.get("subfolder", ""), "type": f.get("type", "output")})
                dst = os.path.join(out, f["filename"])
                with open(dst, "wb") as w:
                    w.write(urllib.request.urlopen(f"{base}/view?{q}", timeout=120).read())
                files.append(dst)
    log(f"  получено файлов: {len(files)}")
    return files


def llm_run(port, step, log):
    import base64
    content = [{"type": "text", "text": step.get("prompt") or open(step["prompt_file"], encoding="utf-8").read()}]
    for img in step.get("images", []):
        ext = os.path.splitext(img)[1].lstrip(".").lower().replace("jpg", "jpeg")
        content.append({"type": "image_url", "image_url": {"url": f"data:image/{ext};base64," + base64.b64encode(open(img, "rb").read()).decode()}})
    msgs = ([{"role": "system", "content": step["system"]}] if step.get("system") else []) + [{"role": "user", "content": content}]
    body = {"messages": msgs, "max_tokens": step.get("max_tokens", 4096), "temperature": step.get("temperature", 0.6)}
    if step.get("json"):
        body["response_format"] = {"type": "json_object"}
    req = urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=step.get("timeout", 1800)).read())
    text = r["choices"][0]["message"]["content"]
    if step.get("out"):
        os.makedirs(os.path.dirname(step["out"]), exist_ok=True)
        open(step["out"], "w", encoding="utf-8").write(text)
    log(f"  ответ: {len(text)} знаков" + (f" → {step['out']}" if step.get("out") else ""))
    return text


def run_task(path, project, log, confirm, stop=None):
    task = load_json(path)
    if not task:
        raise RuntimeError(f"не читается {path}")
    tid = re.sub(r"[^\w.-]", "_", task.get("id") or os.path.splitext(os.path.basename(path))[0])
    s = settings()
    ai = load_json(os.path.join(s.get("ai_root", ""), "ai.json"), {}) or {}
    done = os.path.join(project, "studio", "tasks", "done", tid)
    os.makedirs(done, exist_ok=True)
    ctx = {"AI": ai.get("root", ""), "PROJECT": project, "HF_HOME": ai.get("hf_home", ""), "OUT": os.path.join(ai.get("root", project), "out", tid)}
    lines = []

    def tlog(msg, replace=False):
        if not replace:
            lines.append(msg)
        log(msg, replace=replace)

    servers = ai.get("servers", {})
    result = {"id": tid, "title": task.get("title"), "started": datetime.datetime.now().isoformat(timespec="seconds"), "steps": [], "ok": True}
    tlog(f"=== Поручение {tid}: {task.get('title', '')}")
    token = (s.get("secrets") or {}).get("HF_TOKEN") or os.environ.get("HF_TOKEN")
    try:
        for i, raw in enumerate(task.get("steps", []), 1):
            st = subst(raw, ctx)
            t = st["type"]
            tlog(f"[{i}] {t}")
            r = {"type": t, "ok": True}
            if t == "hf":
                download(hf_url(st["repo"], st["file"]), os.path.join(st["dest"], st.get("as") or os.path.basename(st["file"])), tlog, token, stop=stop)
            elif t == "download":
                f = download(st["url"], st["dest"], tlog, stop=stop)
                if st.get("unzip"):
                    unzip(f, st["unzip"], tlog)
            elif t == "cmd":
                if not confirm(task, st):
                    raise RuntimeError("команду не разрешили")
                r["code"] = run(st["cmd"], tlog, cwd=st.get("cwd"), env=st.get("env"), check=st.get("check", True), timeout=st.get("timeout"), shell=isinstance(st["cmd"], str))
            elif t == "comfy":
                port = servers.get(st.get("server", "comfy-big"), st.get("server"))
                r["files"] = comfy_run(port, st["workflow"], st.get("set"), st.get("out", ctx["OUT"]), tlog, stop)
            elif t == "llm":
                port = servers.get(st.get("server", "code"), st.get("server"))
                r["chars"] = len(llm_run(port, st, tlog))
            elif t == "git_pull":
                run(["git", "-C", project, "pull", "--ff-only"], tlog, check=False)
            else:
                raise RuntimeError(f"неизвестный шаг {t}")
            result["steps"].append(r)
    except Exception as e:
        result["ok"] = False
        result["error"] = str(e)
        tlog(f"ОШИБКА: {e}")
    result["finished"] = datetime.datetime.now().isoformat(timespec="seconds")
    save_json(os.path.join(done, "result.json"), result)
    shutil.copy2(path, os.path.join(done, "task.json"))
    open(os.path.join(done, "log.txt"), "w", encoding="utf-8").write("\n".join(lines))
    if os.path.dirname(os.path.abspath(path)).endswith(os.path.join("tasks", "inbox")):
        os.remove(path)
    tlog(f"=== {'готово' if result['ok'] else 'с ошибкой'}: {done}")
    return result


def inbox(project):
    d = os.path.join(project, "studio", "tasks", "inbox")
    os.makedirs(d, exist_ok=True)
    return sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith(".json"))


# ---------------------------------------------------------------- окно

ORDER = """ПОРЯДОК ПЕРЕЕЗДА

На СТАРОЙ машине
  1. Вкладка «1. Сбор»: выбрать папку (флешка/внешний диск) → «Собрать». В пакет ляжет и эта программа.

На НОВОЙ машине (запускать программу из пакета)
  2. Вкладка «2. Программы» — строго сверху вниз:
       драйвер NVIDIA (вручную, по ссылке, потом перезагрузка) → VC++ → Git → Node.js 24 → Python 3.12 → Chrome → Claude (вручную).
     Кнопка «Поставить отмеченные» скачивает и ставит сама; рядом — ссылка на официальную страницу, если что-то не вышло.
     После установки Git/Node/Python лучше перезапустить программу.
  3. Вкладка «4. Перенос и код»: указать пакет и папку проекта (лучше та же D:\\Claude\\Shish — по ней Claude находит свою память)
     → «Выполнить»: ключи SSH и память Claude → клонирование с GitHub → файлы проекта из пакета → npm ci → библиотеки Python.
  4. Вкладка «3. Секреты»: проверить, что ключи подтянулись; вписать токен Hugging Face (нужен для части моделей).
  5. Вкладка «5. ИИ-стек»: папка под ИИ (отдельный NVMe, нужно 150–300 ГБ) → «Найти видеокарты» → отметить → «Установить».
     В конце программа напишет стартовые скрипты в <папка>\\start и описание стека ai.json для Claude.
  6. Открыть проект в Claude: «проверь переезд — npm run check, превью lavochka». Пакет с флешки после этого стереть (там ключи).

Дальше
  7. Вкладка «6. Поручения»: Claude кладёт задания в studio\\tasks\\inbox — нажмите «Выполнить новые» или включите слежение.
     Без окна: Pereezd.exe watch (следить) или Pereezd.exe task <файл>.
"""


def gui():
    import tkinter as tk
    from tkinter import ttk, filedialog, messagebox
    import webbrowser

    cat_holder = {}
    root = tk.Tk()
    root.title(APP)
    root.geometry("1100x760")
    try:
        root.tk.call("tk", "scaling", 1.25)
    except Exception:
        pass
    q = queue.Queue()
    stop = threading.Event()
    busy = {"on": False}
    s0 = settings()

    nb = ttk.Notebook(root)
    nb.pack(fill="both", expand=True, padx=6, pady=(6, 0))
    logbox = tk.Text(root, height=12, wrap="word", font=("Consolas", 9), bg="#111", fg="#ddd", insertbackground="#ddd")
    bar = ttk.Frame(root)
    bar.pack(fill="x", padx=6)
    ttk.Label(bar, text="Журнал").pack(side="left")
    ttk.Button(bar, text="Остановить", command=lambda: stop.set()).pack(side="right")
    ttk.Button(bar, text="Сохранить журнал", command=lambda: save_log()).pack(side="right", padx=4)
    logbox.pack(fill="both", padx=6, pady=(0, 6))

    def save_log():
        p = filedialog.asksaveasfilename(defaultextension=".txt", initialfile="pereezd-log.txt")
        if p:
            open(p, "w", encoding="utf-8").write(logbox.get("1.0", "end"))

    def log(msg, replace=False):
        q.put((msg, replace))

    def pump():
        try:
            while True:
                msg, replace = q.get_nowait()
                if replace and logbox.get("end-2l", "end-1c").startswith("    "):
                    logbox.delete("end-2l", "end-1c")
                logbox.insert("end", msg + "\n")
                logbox.see("end")
        except queue.Empty:
            pass
        root.after(150, pump)

    def task(fn, *a):
        if busy["on"]:
            messagebox.showinfo(APP, "Уже идёт работа — дождитесь или нажмите «Остановить».")
            return
        stop.clear()
        busy["on"] = True

        def body():
            try:
                fn(*a)
            except Exception as e:
                log(f"ОШИБКА: {e}")
            finally:
                busy["on"] = False
        threading.Thread(target=body, daemon=True).start()

    def folder_row(parent, label, var, row, is_dir=True):
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", padx=4, pady=3)
        ttk.Entry(parent, textvariable=var, width=70).grid(row=row, column=1, sticky="we", padx=4)
        ttk.Button(parent, text="…", width=3, command=lambda: var.set(filedialog.askdirectory() or var.get())).grid(row=row, column=2)

    def link(parent, text, url):
        l = tk.Label(parent, text=text, fg="#2a6fdb", cursor="hand2")
        l.bind("<Button-1>", lambda e: webbrowser.open(url))
        return l

    def checklist(parent, cols, heights=14):
        tv = ttk.Treeview(parent, columns=cols, show="headings", height=heights)
        for c in cols:
            tv.heading(c, text=c)
        tv.column(cols[0], width=30, anchor="center", stretch=False)

        def toggle(e):
            iid = tv.identify_row(e.y)
            if iid:
                v = tv.set(iid, cols[0])
                tv.set(iid, cols[0], "" if v == "✓" else "✓")
        tv.bind("<Double-1>", toggle)
        tv.bind("<space>", lambda e: [tv.set(i, cols[0], "" if tv.set(i, cols[0]) == "✓" else "✓") for i in tv.selection()])
        return tv

    # --- 0. Порядок
    f0 = ttk.Frame(nb)
    nb.add(f0, text="Порядок")
    t0 = tk.Text(f0, wrap="word", font=("Segoe UI", 10))
    t0.insert("1.0", ORDER)
    t0.config(state="disabled")
    t0.pack(fill="both", expand=True, padx=6, pady=6)

    # --- 1. Сбор
    f1 = ttk.Frame(nb)
    nb.add(f1, text="1. Сбор (старая машина)")
    v_proj1 = tk.StringVar(value=s0.get("project", DEFAULT_PROJECT))
    v_dest = tk.StringVar(value=s0.get("pack", ""))
    top1 = ttk.Frame(f1)
    top1.pack(fill="x", pady=4)
    folder_row(top1, "Папка проекта", v_proj1, 0)
    folder_row(top1, "Куда сложить пакет", v_dest, 1)
    top1.columnconfigure(1, weight=1)
    ttk.Label(f1, text="Двойной щелчок или пробел — отметить/снять. Размеры считаются после «Найти».").pack(anchor="w", padx=6)
    tv1 = checklist(f1, ("✓", "Группа", "Что", "Размер"), 16)
    tv1.column("Что", width=640)
    tv1.pack(fill="both", expand=True, padx=6)
    plan1 = {}

    def find1():
        tv1.delete(*tv1.get_children())
        plan1.clear()
        proj = v_proj1.get()
        for w in git_warnings(proj):
            log("ВНИМАНИЕ: " + w)
        items = collect_plan(proj, log)
        for it in items:
            iid = tv1.insert("", "end", values=("✓" if it[4] else "", it[0], it[2], "…"))
            plan1[iid] = it

        def sizes():
            total = 0
            for iid, it in list(plan1.items()):
                n = du(it[3])
                total += n
                root.after(0, lambda i=iid, n=n: tv1.set(i, "Размер", gb(n)))
            log(f"Найдено {len(items)} позиций, всего {gb(total)}.")
        threading.Thread(target=sizes, daemon=True).start()

    def go1():
        if not v_dest.get():
            messagebox.showwarning(APP, "Укажите, куда сложить пакет.")
            return
        set_setting(project=v_proj1.get(), pack=v_dest.get())
        chosen = [plan1[i] for i in tv1.get_children() if tv1.set(i, "✓") == "✓"]
        task(do_collect, v_proj1.get(), v_dest.get(), chosen, log, stop)
    b1 = ttk.Frame(f1)
    b1.pack(fill="x", pady=4)
    ttk.Button(b1, text="Найти", command=find1).pack(side="left", padx=6)
    ttk.Button(b1, text="Собрать", command=go1).pack(side="left")

    # --- 2. Программы
    f2 = ttk.Frame(nb)
    nb.add(f2, text="2. Программы")
    ttk.Label(f2, text="Ставить сверху вниз. Отмеченное «вручную» — открыть ссылку, скачать, установить. Остальное ставит кнопка.").pack(anchor="w", padx=6, pady=4)
    box2 = ttk.Frame(f2)
    box2.pack(fill="both", expand=True, padx=6)
    vars2 = {}

    def fill2():
        for w in box2.winfo_children():
            w.destroy()
        for i, it in enumerate(cat_holder["cat"]["base"]):
            v = tk.BooleanVar(value=bool(it.get("auto")))
            vars2[it["id"]] = (v, it)
            ttk.Checkbutton(box2, variable=v, state="normal" if it.get("auto") else "disabled").grid(row=i, column=0)
            ttk.Label(box2, text=f"{i + 1}. {it['name']}", font=("Segoe UI", 10, "bold")).grid(row=i, column=1, sticky="w")
            ttk.Label(box2, text=it["why"] + ("" if it.get("auto") else "  — вручную: " + it.get("manual", "")), wraplength=520).grid(row=i, column=2, sticky="w", padx=6)
            link(box2, "страница", it["page"]).grid(row=i, column=3, padx=4)
            ttk.Button(box2, text="поставить", command=lambda it=it: task(install_base, it, log, stop), state="normal" if it.get("auto") else "disabled").grid(row=i, column=4, pady=2)

    def go2():
        items = [it for v, it in vars2.values() if v.get()]

        def body():
            for it in items:
                log(f"— {it['name']}")
                try:
                    install_base(it, log, stop)
                except Exception as e:
                    log(f"  ✗ {e}")
            log("Программы: готово. Перезапустите эту программу, чтобы она увидела git, node и python.")
        task(body)
    ttk.Button(f2, text="Поставить отмеченные", command=go2).pack(anchor="w", padx=6, pady=6)

    # --- 3. Секреты
    f3 = ttk.Frame(nb)
    nb.add(f3, text="3. Секреты")
    v_proj3 = tk.StringVar(value=s0.get("project", DEFAULT_PROJECT))
    top3 = ttk.Frame(f3)
    top3.pack(fill="x")
    folder_row(top3, "Папка проекта", v_proj3, 0)
    top3.columnconfigure(1, weight=1)
    box3 = ttk.LabelFrame(f3, text="Секреты этого компьютера (хранятся в %APPDATA%\\Pereezd и раскладываются по местам)")
    box3.pack(fill="x", padx=6, pady=4)
    vars3 = {}
    show = tk.BooleanVar(value=False)
    entries = []
    for i, sc in enumerate(SECRETS):
        v = tk.StringVar()
        vars3[sc["id"]] = v
        ttk.Label(box3, text=sc["name"], font=("Segoe UI", 9, "bold")).grid(row=2 * i, column=0, sticky="w", padx=4)
        e = ttk.Entry(box3, textvariable=v, width=48, show="•")
        e.grid(row=2 * i, column=1, sticky="we", padx=4)
        entries.append(e)
        link(box3, "где взять", sc["url"]).grid(row=2 * i, column=2)
        ttk.Label(box3, text=sc["how"] + "  → " + sc["where"], wraplength=1000, foreground="#555").grid(row=2 * i + 1, column=0, columnspan=3, sticky="w", padx=14, pady=(0, 4))
    box3.columnconfigure(1, weight=1)

    def load3():
        cur = current_secrets(v_proj3.get())
        for k, v in vars3.items():
            v.set(cur.get(k, ""))
        log("Секреты: подтянул то, что нашлось (" + (", ".join(k for k in vars3 if cur.get(k)) or "ничего") + ").")
    b3 = ttk.Frame(f3)
    b3.pack(fill="x", padx=6)
    ttk.Checkbutton(b3, text="показать", variable=show, command=lambda: [e.config(show="" if show.get() else "•") for e in entries]).pack(side="left")
    ttk.Button(b3, text="Подтянуть из проекта", command=load3).pack(side="left", padx=6)
    ttk.Button(b3, text="Сохранить и разложить", command=lambda: task(apply_secrets, v_proj3.get(), {k: v.get() for k, v in vars3.items()}, log)).pack(side="left")
    box3s = ttk.LabelFrame(f3, text="Ключи на сервере — уже там, переносить не нужно. Только если ключ сменился (например, токен Яндекс Диска раз в год)")
    box3s.pack(fill="x", padx=6, pady=8)
    v_sname = tk.StringVar(value=SERVER_SECRETS[0][0])
    v_sval = tk.StringVar()
    cb = ttk.Combobox(box3s, textvariable=v_sname, values=[x[0] for x in SERVER_SECRETS], width=26, state="readonly")
    cb.grid(row=0, column=0, padx=4, pady=4)
    lbl = ttk.Label(box3s, text="")
    lbl.grid(row=1, column=0, columnspan=4, sticky="w", padx=4)
    lnk = link(box3s, "где взять", SERVER_SECRETS[0][3])
    lnk.grid(row=0, column=3)

    def on_s(*_):
        x = next(x for x in SERVER_SECRETS if x[0] == v_sname.get())
        lbl.config(text=f"{x[2]}  → {x[1]} на сервере (через ssh lavochka, lavochka-secret)")
        lnk.bind("<Button-1>", lambda e: webbrowser.open(x[3]))
    cb.bind("<<ComboboxSelected>>", on_s)
    on_s()
    ttk.Entry(box3s, textvariable=v_sval, width=50, show="•").grid(row=0, column=1, padx=4)

    def send3():
        x = next(x for x in SERVER_SECRETS if x[0] == v_sname.get())
        if not v_sval.get().strip():
            return
        if messagebox.askyesno(APP, f"Записать {x[0]} в {x[1]} на сервере? Служба сайта перезапустится."):
            val = v_sval.get()
            v_sval.set("")
            task(send_server_secret, x[0], x[1], val, log)
    ttk.Button(box3s, text="Отправить на сервер", command=send3).grid(row=0, column=2, padx=4)

    # --- 4. Перенос и код
    f4 = ttk.Frame(nb)
    nb.add(f4, text="4. Перенос и код")
    v_pack = tk.StringVar(value=s0.get("pack", os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else ""))
    v_proj4 = tk.StringVar(value=s0.get("project", DEFAULT_PROJECT))
    top4 = ttk.Frame(f4)
    top4.pack(fill="x", pady=4)
    folder_row(top4, "Пакет со старой машины", v_pack, 0)
    folder_row(top4, "Папка проекта (лучше D:\\Claude\\Shish)", v_proj4, 1)
    top4.columnconfigure(1, weight=1)
    opts4 = {k: tk.BooleanVar(value=True) for k in ("home", "project", "npm", "pip")}
    for k, t in (("home", "Домашние файлы из пакета: ключи SSH, память и настройки Claude, имя для git"),
                 ("project", "Файлы проекта из пакета: материалы, .env, данные, неотслеженные документы (после клонирования)"),
                 ("npm", "npm ci — библиотеки сборника"), ("pip", "Python-библиотеки инструментов (numpy, scipy, opencv, pymupdf, pillow)")):
        ttk.Checkbutton(f4, text=t, variable=opts4[k]).pack(anchor="w", padx=10)
    ttk.Label(f4, text="Клонирование: по SSH, если ключ GitHub приехал в пакете, иначе по HTTPS (откроется вход в GitHub через браузер).", foreground="#555").pack(anchor="w", padx=10, pady=4)

    def go4():
        set_setting(pack=v_pack.get(), project=v_proj4.get())
        task(setup_code, v_pack.get() if os.path.exists(os.path.join(v_pack.get(), "manifest.json")) else "", v_proj4.get(),
             {k: v.get() for k, v in opts4.items()}, cat_holder["cat"], log, stop)
    ttk.Button(f4, text="Выполнить", command=go4).pack(anchor="w", padx=10, pady=6)

    # --- 5. ИИ-стек
    f5 = ttk.Frame(nb)
    nb.add(f5, text="5. ИИ-стек")
    v_ai = tk.StringVar(value=s0.get("ai_root", r"E:\ai"))
    top5 = ttk.Frame(f5)
    top5.pack(fill="x", pady=4)
    folder_row(top5, "Папка под ИИ (отдельный NVMe)", v_ai, 0)
    top5.columnconfigure(1, weight=1)
    gpu_lbl = ttk.Label(f5, text="Видеокарты: не проверены")
    gpu_lbl.pack(anchor="w", padx=6)
    ttk.Label(f5, text="Лицензия: ✓ — можно в игры; ⚠ — с порогом выручки или нужен токен; модели без ✓ в продакшн не идут. Двойной щелчок — отметить.", foreground="#555").pack(anchor="w", padx=6)
    tv5 = checklist(f5, ("✓", "Раздел", "Что", "Лицензия", "Размер"), 15)
    tv5.column("Что", width=640)
    tv5.column("Раздел", width=90)
    tv5.column("Размер", width=80)
    tv5.pack(fill="both", expand=True, padx=6)
    rows5 = {}

    def fill5():
        tv5.delete(*tv5.get_children())
        rows5.clear()
        c = cat_holder["cat"]
        for p in c["ai_programs"]:
            iid = tv5.insert("", "end", values=("✓" if p.get("default") else "", "Программа", f"{p['name']} — {p['why']}", "", f"{p['size_gb']} ГБ"))
            rows5[iid] = ("prog", p)
        for m in c["models"]:
            mark = "✓ " if m.get("ok") is True else "⚠ "
            iid = tv5.insert("", "end", values=("✓" if m.get("default") else "", m["group"], m["name"], mark + m["license"], f"{m['size_gb']} ГБ"))
            rows5[iid] = ("model", m)

    def detect():
        gs = gpus()
        big, small = gpu_roles(gs)
        gpu_lbl.config(text="Видеокарты: " + ("; ".join(f"#{g['index']} {g['name']} {g['mem_gb']} ГБ" for g in gs) or "не найдены (нет драйвера NVIDIA?)") +
                       (f"   → большая #{big['index']}, малая #{small['index']}" if big and small else ""))

    def go5():
        r = v_ai.get()
        if not r:
            return
        chosen = [rows5[i] for i in tv5.get_children() if tv5.set(i, "✓") == "✓"]
        need = sum((x[1]["size_gb"] for x in chosen)) * 1e9
        os.makedirs(r, exist_ok=True)
        free = shutil.disk_usage(r).free
        if need > free and not messagebox.askyesno(APP, f"Нужно около {gb(need)}, свободно {gb(free)}. Всё равно продолжить?"):
            return
        set_setting(ai_root=r)
        token = (settings().get("secrets") or {}).get("HF_TOKEN") or os.environ.get("HF_TOKEN")

        def body():
            os.environ["HF_HOME"] = os.path.join(r, "hf")
            for kind, x in chosen:
                if stop.is_set():
                    break
                log(f"— {x['name']}")
                try:
                    if kind == "prog":
                        install_ai_program(x["id"], r, log, stop)
                    else:
                        install_model(x, r, token, log, stop)
                    log("  ✓")
                except Exception as e:
                    log(f"  ✗ {e}")
            write_start_scripts(r, cat_holder["cat"], log)
            log("ИИ-стек: готово. Повторный запуск докачает недостающее и пропустит скачанное.")
        task(body)
    b5 = ttk.Frame(f5)
    b5.pack(fill="x", pady=4)
    ttk.Button(b5, text="Найти видеокарты", command=detect).pack(side="left", padx=6)
    ttk.Button(b5, text="Проверить новые версии моделей", command=lambda: task(check_new_versions, cat_holder["cat"], log)).pack(side="left")
    ttk.Button(b5, text="Только переписать стартовые скрипты", command=lambda: task(write_start_scripts, v_ai.get(), cat_holder["cat"], log)).pack(side="left", padx=6)
    ttk.Button(b5, text="Установить отмеченное", command=go5).pack(side="right", padx=6)

    # --- 6. Поручения
    f6 = ttk.Frame(nb)
    nb.add(f6, text="6. Поручения")
    v_proj6 = tk.StringVar(value=s0.get("project", DEFAULT_PROJECT))
    top6 = ttk.Frame(f6)
    top6.pack(fill="x", pady=4)
    folder_row(top6, "Папка проекта", v_proj6, 0)
    top6.columnconfigure(1, weight=1)
    trust = tk.BooleanVar(value=False)
    watch = tk.BooleanVar(value=False)
    t6 = tk.Text(f6, height=12, wrap="none", font=("Consolas", 9))
    t6.insert("1.0", TASK_HELP)
    t6.config(state="disabled")
    t6.pack(fill="both", expand=True, padx=6)

    def confirm(tk_task, st):
        if trust.get():
            return True
        res = {}
        ev = threading.Event()

        def ask():
            res["ok"] = messagebox.askyesno(APP, f"Поручение «{tk_task.get('title', '')}» хочет выполнить команду:\n\n{st['cmd']}\n\nв папке {st.get('cwd') or '(текущей)'}.\nРазрешить?")
            ev.set()
        root.after(0, ask)
        ev.wait()
        return res["ok"]

    def run_inbox():
        files = inbox(v_proj6.get())
        if not files:
            log("Поручений нет.")
        for f in files:
            if stop.is_set():
                break
            run_task(f, v_proj6.get(), log, confirm, stop)

    def watcher():
        if watch.get() and not busy["on"] and inbox(v_proj6.get()):
            task(run_inbox)
        root.after(10000, watcher)
    b6 = ttk.Frame(f6)
    b6.pack(fill="x", pady=4)
    ttk.Button(b6, text="Выполнить новые", command=lambda: task(run_inbox)).pack(side="left", padx=6)
    ttk.Checkbutton(b6, text="Следить за папкой (раз в 10 с)", variable=watch).pack(side="left")
    ttk.Checkbutton(b6, text="Не спрашивать про команды (доверять поручениям)", variable=trust).pack(side="left", padx=10)
    ttk.Button(b6, text="Открыть папку поручений", command=lambda: os.startfile(os.path.dirname(inbox(v_proj6.get())[0]) if inbox(v_proj6.get()) else os.path.join(v_proj6.get(), "studio", "tasks", "inbox"))).pack(side="right", padx=6)

    def init():
        cat_holder["cat"] = load_catalog(log)
        fill2()
        fill5()
        load3()
        log(f"Каталог: {cat_holder['cat'].get('version')}. Начните со вкладки «Порядок».")
    root.after(100, init)
    root.after(150, pump)
    root.after(10000, watcher)
    root.mainloop()


def cli(argv):
    import argparse
    ap = argparse.ArgumentParser(prog="pereezd")
    sub = ap.add_subparsers(dest="cmd")
    c = sub.add_parser("collect")
    c.add_argument("--dest", required=True)
    c.add_argument("--project", default=DEFAULT_PROJECT)
    t = sub.add_parser("task")
    t.add_argument("file")
    t.add_argument("--project", default=settings().get("project", DEFAULT_PROJECT))
    t.add_argument("--yes", action="store_true")
    w = sub.add_parser("watch")
    w.add_argument("--project", default=settings().get("project", DEFAULT_PROJECT))
    w.add_argument("--yes", action="store_true")
    a = sub.add_parser("scripts")
    a.add_argument("--root", required=True)
    args = ap.parse_args(argv)
    if sys.stdout is None and os.name == "nt":
        # окно без консоли: при запуске из терминала пишем в его консоль
        import ctypes
        if ctypes.windll.kernel32.AttachConsole(-1):
            sys.stdout = open("CONOUT$", "w", encoding="utf-8", buffering=1)
            sys.stdin = open("CONIN$", "r", encoding="utf-8")
    if sys.stdout is None:
        os.makedirs(CFG_DIR, exist_ok=True)
        sys.stdout = open(os.path.join(CFG_DIR, "cli.log"), "a", encoding="utf-8", buffering=1)
    else:
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    def log(m, replace=False):
        print(m, flush=True)

    def confirm(tk_task, st):
        if args.yes:
            return True
        return input(f"Выполнить {st['cmd']}? [y/N] ").strip().lower() in ("y", "д", "yes", "да")
    if args.cmd == "collect":
        for w_ in git_warnings(args.project):
            log("ВНИМАНИЕ: " + w_)
        do_collect(args.project, args.dest, [x for x in collect_plan(args.project, log) if x[4]], log)
    elif args.cmd == "task":
        r = run_task(args.file, args.project, log, confirm)
        sys.exit(0 if r["ok"] else 1)
    elif args.cmd == "watch":
        log("Слежу за studio/tasks/inbox (Ctrl+C — выход)")
        while True:
            for f in inbox(args.project):
                run_task(f, args.project, log, confirm)
            time.sleep(10)
    elif args.cmd == "scripts":
        write_start_scripts(args.root, load_catalog(log), log)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        cli(sys.argv[1:])
    else:
        gui()
