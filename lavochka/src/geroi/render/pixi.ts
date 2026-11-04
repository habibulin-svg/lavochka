/* Приложения Pixi не уничтожаем, а отдаём повторно. Application.destroy() кладёт разрушенные пакеты в общий на страницу пул Batcher:
 * второе живое приложение (карта под боем) и каждое следующее падает на первом кадре. Заодно не копятся контексты WebGL. */
import { Application } from 'pixi.js';

const free: Application[] = [];

export async function takeApp(host: HTMLElement): Promise<Application> {
  let app = free.pop();
  if (!app) {
    app = new Application();
    // только WebGL: шейдер грунта написан на GLSL
    await app.init({ background: 0x0c0a08, antialias: true, autoDensity: true, resolution: Math.min(2, devicePixelRatio), preference: 'webgl' });
  }
  host.appendChild(app.canvas);
  app.resizeTo = host;
  app.resize();
  app.start();
  return app;
}

/** Убрать своё со сцены и вернуть приложение; обработчики ticker и канваса снимает вид. */
export function releaseApp(app: Application): void {
  app.stop();
  app.resizeTo = window;
  for (const c of app.stage.removeChildren()) c.destroy({ children: true });
  app.canvas.remove();
  free.push(app);
}
