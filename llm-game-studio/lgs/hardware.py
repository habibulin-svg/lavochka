"""Что за железо: видеокарты (nvidia-smi), память, процессор, диск. Без сторонних библиотек."""
import ctypes
import os
import platform
import re
import shutil
import subprocess
import sys

# Пропускная способность памяти, ГБ/с — для оценки скорости LLM (ток/с ≈ полоса / байты активных весов).
BANDWIDTH = [
    (r'5090', 1792), (r'4090', 1008), (r'3090', 936), (r'5080', 960), (r'4080', 717), (r'5070 ti', 896),
    (r'5070', 672), (r'4070 ti super', 672), (r'4070 ti', 504), (r'4070 super', 504), (r'4070', 504),
    (r'3080', 760), (r'5060 ti', 448), (r'5060', 448), (r'4060 ti', 288), (r'4060', 272), (r'3070', 448),
    (r'3060', 360), (r'2080', 448), (r'2070', 448), (r'2060', 336), (r'a100', 1555), (r'h100', 3350),
    (r'a6000', 768), (r'a4000', 448), (r'1080', 320), (r'1070', 256),
]
CPU_BANDWIDTH = 60  # двухканальная DDR5 — грубо

_NV = ['index', 'name', 'memory.total', 'memory.used', 'memory.free', 'utilization.gpu', 'temperature.gpu',
       'driver_version', 'compute_cap', 'power.draw']


def _nvidia_smi(fields):
    exe = shutil.which('nvidia-smi') or r'C:\Windows\System32\nvidia-smi.exe'
    try:
        r = subprocess.run([exe, '--query-gpu=' + ','.join(fields), '--format=csv,noheader,nounits'],
                           capture_output=True, text=True, timeout=8, creationflags=_NOWINDOW)
    except (OSError, subprocess.TimeoutExpired):
        return []
    if r.returncode:
        return []
    return [[c.strip() for c in line.split(',')] for line in r.stdout.strip().splitlines() if line.strip()]


_NOWINDOW = 0x08000000 if sys.platform == 'win32' else 0


def _num(s, default=0.0):
    try:
        return float(s)
    except (TypeError, ValueError):
        return default


def bandwidth(name: str) -> int:
    n = name.lower()
    for pat, bw in BANDWIDTH:
        if re.search(pat, n):
            return bw
    return 300


def gpus() -> list[dict]:
    out = []
    for row in _nvidia_smi(_NV):
        if len(row) < len(_NV):
            continue
        d = dict(zip(_NV, row))
        name = d['name'].replace('NVIDIA ', '').replace('GeForce ', '')
        out.append({
            'index': int(d['index']), 'name': name, 'vendor': 'nvidia',
            'vram_gb': round(_num(d['memory.total']) / 1024, 1),
            'used_gb': round(_num(d['memory.used']) / 1024, 1),
            'free_gb': round(_num(d['memory.free']) / 1024, 1),
            'util': _num(d['utilization.gpu']), 'temp': _num(d['temperature.gpu']),
            'power': _num(d['power.draw']), 'driver': d['driver_version'], 'cc': d['compute_cap'],
            'bandwidth': bandwidth(name),
        })
    return out


def gpu_processes() -> list[dict]:
    """Кто держит видеопамять (в Windows без прав объём часто N/A — тогда только имена)."""
    exe = shutil.which('nvidia-smi') or r'C:\Windows\System32\nvidia-smi.exe'
    try:
        r = subprocess.run([exe, '--query-compute-apps=pid,process_name,used_memory,gpu_bus_id', '--format=csv,noheader,nounits'],
                           capture_output=True, text=True, timeout=8, creationflags=_NOWINDOW)
    except (OSError, subprocess.TimeoutExpired):
        return []
    res, seen = [], set()
    for line in r.stdout.strip().splitlines():
        parts = [p.strip() for p in line.split(',')]
        if len(parts) < 3 or parts[0] in seen:
            continue
        seen.add(parts[0])
        name = os.path.basename(parts[1])
        # системные окна держат копейки — показываем только то, что похоже на ИИ
        if not re.search(r'python|llama|comfy|ollama|lm ?studio|koboldcpp|vllm|blender|tabby|exllama', parts[1], re.I):
            continue
        res.append({'pid': int(parts[0]), 'name': name, 'path': parts[1], 'mem_mb': _num(parts[2], None)})
    return res


class _MEMSTAT(ctypes.Structure):
    _fields_ = [('dwLength', ctypes.c_ulong), ('dwMemoryLoad', ctypes.c_ulong), ('ullTotalPhys', ctypes.c_ulonglong),
                ('ullAvailPhys', ctypes.c_ulonglong), ('ullTotalPageFile', ctypes.c_ulonglong),
                ('ullAvailPageFile', ctypes.c_ulonglong), ('ullTotalVirtual', ctypes.c_ulonglong),
                ('ullAvailVirtual', ctypes.c_ulonglong), ('ullAvailExtendedVirtual', ctypes.c_ulonglong)]


def ram() -> dict:
    if sys.platform == 'win32':
        m = _MEMSTAT()
        m.dwLength = ctypes.sizeof(m)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
        return {'total_gb': round(m.ullTotalPhys / 2**30, 1), 'free_gb': round(m.ullAvailPhys / 2**30, 1)}
    try:
        info = dict(re.findall(r'^(\w+):\s+(\d+)', open('/proc/meminfo').read(), re.M))
        return {'total_gb': round(int(info['MemTotal']) / 2**20, 1), 'free_gb': round(int(info['MemAvailable']) / 2**20, 1)}
    except OSError:
        pass
    try:
        total = int(subprocess.run(['sysctl', '-n', 'hw.memsize'], capture_output=True, text=True).stdout)
        return {'total_gb': round(total / 2**30, 1), 'free_gb': None}
    except (OSError, ValueError):
        return {'total_gb': None, 'free_gb': None}


def cpu() -> dict:
    name = platform.processor()
    if sys.platform == 'win32':
        try:
            import winreg
            k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'HARDWARE\DESCRIPTION\System\CentralProcessor\0')
            name = winreg.QueryValueEx(k, 'ProcessorNameString')[0].strip()
        except OSError:
            pass
    elif os.path.exists('/proc/cpuinfo'):
        m = re.search(r'model name\s*:\s*(.+)', open('/proc/cpuinfo').read())
        name = m.group(1) if m else name
    return {'name': name, 'threads': os.cpu_count() or 1}


def disk(path: str) -> dict:
    p = path
    while p and not os.path.exists(p):
        p = os.path.dirname(p.rstrip('/\\'))
        if p and len(p) <= 3:
            break
    try:
        u = shutil.disk_usage(p or '.')
        return {'path': path, 'free_gb': round(u.free / 2**30, 1), 'total_gb': round(u.total / 2**30, 1)}
    except OSError:
        return {'path': path, 'free_gb': None, 'total_gb': None}


def snapshot(paths: list[str] = ()) -> dict:
    g = gpus()
    return {
        'os': f'{platform.system()} {platform.release()}', 'python': platform.python_version(),
        'cpu': cpu(), 'ram': ram(), 'gpus': g, 'processes': gpu_processes(),
        'disks': [disk(p) for p in dict.fromkeys(p for p in paths if p)],
        'cuda13': any(x['cc'].startswith('12') for x in g),   # Blackwell (RTX 50xx) — llama.cpp под CUDA 13
    }


def live() -> dict:
    return {'gpus': gpus(), 'ram': ram()}
