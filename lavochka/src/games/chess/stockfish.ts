/* Stockfish 19 (лёгкий, однопоточный; public/stockfish, GPLv3) в Worker — для разбора в шахматном кружке.
 * Грузится только при первом запросе. Запросы идут по очереди: новый `analyse` с `cancel` прерывает текущий.
 * Оценка — всегда со стороны белых, в сантипешках; мат — `mate` (ходов, плюс — белые ставят). */

export interface PvLine {
  /** Оценка со стороны белых, сантипешки (при мате — ±100000 минус ходы до мата). */
  cp: number;
  /** Мат в столько ходов (плюс — белые ставят мат, минус — чёрные), иначе null. */
  mate: number | null;
  /** Линия ходами UCI. */
  pv: string[];
  depth: number;
}

export interface Analysis {
  fen: string;
  best: string | null;
  lines: PvLine[];
}

interface Job {
  fen: string;
  depth: number;
  multipv: number;
  ms: number;
  resolve: (a: Analysis) => void;
  reject: (e: Error) => void;
  onInfo?: (a: Analysis) => void;
}

const MATE = 100000;
const URL_JS = `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`;

/** Оценка для сравнения: мат ближе — больше. */
export const score = (l: Pick<PvLine, 'cp' | 'mate'>) => (l.mate != null ? Math.sign(l.mate) * (MATE - Math.abs(l.mate)) : l.cp);

class Engine {
  private w: Worker | null = null;
  private ready: Promise<void> | null = null;
  private queue: Job[] = [];
  private job: Job | null = null;
  private lines: PvLine[] = [];
  private turn: 'w' | 'b' = 'w';
  private waitReady: (() => void) | null = null;

  private boot(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((res, rej) => {
      try {
        this.w = new Worker(URL_JS);
      } catch (e) {
        rej(e as Error);
        return;
      }
      this.w.onmessage = (e) => this.line(String(e.data));
      this.w.onerror = () => {
        const err = new Error('Не удалось запустить движок');
        rej(err);
        this.job?.reject(err);
        this.job = null;
        for (const j of this.queue.splice(0)) j.reject(err);
        this.ready = null;
        this.w = null;
      };
      this.waitReady = res;
      this.send('uci');
      this.send('setoption name Hash value 16');
      this.send('isready');
    });
    return this.ready;
  }

  private send(cmd: string) {
    this.w?.postMessage(cmd);
  }

  private line(t: string) {
    if (t === 'readyok' && this.waitReady) {
      this.waitReady();
      this.waitReady = null;
      return;
    }
    const j = this.job;
    if (!j) return;
    if (t.startsWith('info') && t.includes(' pv ')) {
      const num = (k: string) => {
        const m = t.match(new RegExp(` ${k} (-?\\d+)`));
        return m ? Number(m[1]) : null;
      };
      const k = (num('multipv') ?? 1) - 1;
      const depth = num('depth') ?? 0;
      const sign = this.turn === 'w' ? 1 : -1;
      const mate = num('mate');
      const cp = num('cp');
      const pv = t.slice(t.indexOf(' pv ') + 4).trim().split(/\s+/);
      const l: PvLine = mate != null ? { cp: sign * Math.sign(mate) * (MATE - Math.abs(mate)), mate: sign * mate, pv, depth } : { cp: sign * (cp ?? 0), mate: null, pv, depth };
      this.lines[k] = l;
      j.onInfo?.({ fen: j.fen, best: this.lines[0]?.pv[0] ?? null, lines: this.lines.filter(Boolean) });
      return;
    }
    if (t.startsWith('bestmove')) {
      const best = t.split(/\s+/)[1];
      const a: Analysis = { fen: j.fen, best: best && best !== '(none)' ? best : null, lines: this.lines.filter(Boolean) };
      this.job = null;
      j.resolve(a);
      this.next();
    }
  }

  private next() {
    if (this.job || !this.queue.length) return;
    const j = (this.job = this.queue.shift()!);
    this.lines = [];
    this.turn = (j.fen.split(' ')[1] as 'w' | 'b') ?? 'w';
    this.send(`setoption name MultiPV value ${j.multipv}`);
    this.send(`position fen ${j.fen}`);
    this.send(`go depth ${j.depth}${j.ms ? ` movetime ${j.ms}` : ''}`);
  }

  /** Разобрать позицию. depth — глубина, ms — не дольше (0 — без ограничения), multipv — сколько лучших линий. */
  async analyse(fen: string, o: { depth?: number; ms?: number; multipv?: number; cancel?: boolean; onInfo?: (a: Analysis) => void } = {}): Promise<Analysis> {
    await this.boot();
    if (o.cancel) this.stop();
    return new Promise<Analysis>((resolve, reject) => {
      this.queue.push({ fen, depth: o.depth ?? 16, ms: o.ms ?? 0, multipv: o.multipv ?? 1, resolve, reject, onInfo: o.onInfo });
      this.next();
    });
  }

  /** Бросить очередь и прервать текущий разбор (его промис получит то, что успело посчитаться). */
  stop() {
    for (const j of this.queue.splice(0)) j.reject(new Error('cancelled'));
    if (this.job) this.send('stop');
  }

  /** Освободить память (уход из кружка). */
  quit() {
    this.stop();
    this.w?.terminate();
    this.w = null;
    this.ready = null;
    this.job = null;
  }
}

export const stockfish = new Engine();

/** Оценка словами со стороны белых: «+1,5», «−0,3», «мат в 3». */
export function evalText(l: Pick<PvLine, 'cp' | 'mate'>): string {
  if (l.mate != null) return l.mate === 0 ? 'мат' : `${l.mate > 0 ? 'белые' : 'чёрные'} ставят мат в ${Math.abs(l.mate)}`;
  const v = l.cp / 100;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1).replace('.', ',');
}
