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
import { App } from './app';
import { mayPlay, type Release } from '../core/release';
import type { RightGrant } from '../core/rights';

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
  if (q.get('shot') === '1') c.el.classList.add('shot');
  if (import.meta.env.DEV) Object.assign((window as unknown as { __dz: object }).__dz, { concert: c });
  await c.start();
}

async function access(): Promise<{ ok: boolean; signedIn: boolean }> {
  if (import.meta.env.DEV) return { ok: true, signedIn: true };
  const get = (url: string) =>
    fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  const [me, stats] = await Promise.all([get('/api/auth/me'), get('/api/stats')]);
  const rights: RightGrant[] = me?.user?.rights ?? [];
  const release: Release = stats?.release ?? {};
  return { ok: mayPlay(release, 'dirizher', rights), signedIn: !!me?.user };
}

function locked(signedIn: boolean): void {
  host.innerHTML = `<div class="dz-screen"><div class="dz-panel">
    <div class="dz-logo"><span>Симулятор</span> дирижёра</div>
    <div class="dz-sub">Игра в раннем доступе — для подписчиков «Лавочки+».</div>
    <button class="dz-btn primary" onclick="location.href='/dirizher/'">${signedIn ? 'Оформить «Лавочку+»' : 'Войти или оформить «Лавочку+»'}</button>
    <button class="dz-btn" onclick="location.href='/'">Во двор, к другим играм</button></div></div>`;
}

const piece = q.get('piece');
if (piece) void devPiece(piece);
else
  void access().then((a) => {
    if (!a.ok) return locked(a.signedIn);
    new App(host).title();
  });
