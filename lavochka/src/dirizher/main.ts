/* Вход «Симулятора дирижёра» (dirizher.html). Без параметров — меню. Для разработки:
 * ?piece=<id>&diff=easy|normal|hard|master&concert=1&speed=0.8 — сразу пьеса; &flat=1 — план рассадки вместо 3D. */
import './ui/dz.css';
import { Orchestra } from './audio/orchestra';
import { Concert } from './game';
import type { DiffId } from './core/chart';
import type { ScoreJson } from './core/score';
import { FlatStage } from './scene/stage';
import { Scene3D } from './scene/scene3d';
import { initGamepad } from '../core/gamepad';

const host = document.getElementById('dirizher')!;
const q = new URLSearchParams(location.search);
initGamepad();

let orch: Orchestra | null = null;
export function orchestra(): Orchestra {
  if (!orch) {
    orch = new Orchestra();
    if (import.meta.env.DEV) (window as unknown as { __dz: unknown }).__dz = { orch };
  }
  return orch;
}

export async function loadScore(id: string): Promise<ScoreJson> {
  const r = await fetch(`${import.meta.env.BASE_URL}dirizher/scores/${id}.json`);
  if (!r.ok) throw new Error(`нет партитуры ${id}`);
  return (await r.json()) as ScoreJson;
}

async function devPiece(id: string): Promise<void> {
  const score = await loadScore(id);
  const diff = (q.get('diff') ?? 'easy') as DiffId;
  // звук можно включить только по жесту
  const go = document.createElement('button');
  go.className = 'dz-btn primary';
  go.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:auto;z-index:60';
  go.textContent = `▶ ${score.composer}. ${score.title}`;
  host.appendChild(go);
  await new Promise<void>((r) => (go.onclick = () => r()));
  go.remove();
  const c = new Concert(host, orchestra(), { score, diff, concert: q.get('concert') === '1', speed: Number(q.get('speed') ?? 1), auto: q.get('auto') === '1' });
  c.stage = q.get('flat') === '1' ? new FlatStage(c.stageEl) : new Scene3D(c.stageEl, score, { hall: q.get('hall') ?? undefined, small: q.get('small') === '1' ? true : undefined });
  c.onEnd = (r) => {
    c.say(`${'★'.repeat(r.stars)} ${r.score}`, 10);
  };
  let paused = false;
  c.onPause = () => {
    paused = !paused;
    c.pause(paused);
    c.say(paused ? 'Пауза' : '', paused ? 0 : 0.1);
  };
  if (import.meta.env.DEV) Object.assign((window as unknown as { __dz: object }).__dz, { concert: c });
  await c.start();
}

const piece = q.get('piece');
if (piece) void devPiece(piece);
else host.textContent = 'Меню — скоро';
