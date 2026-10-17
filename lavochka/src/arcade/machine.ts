/* Общий вид эмулируемой платы автомата для проигрывателя «15 копеек». */
export type MachineInput = 'left' | 'right' | 'up' | 'down' | 'b1' | 'b2' | 'coin' | 'service';

export interface ArcadeMachine {
  /** Кадр RGBA (по 32 бита на точку), width × height. */
  readonly frame: Uint32Array;
  readonly width: number;
  readonly height: number;
  readonly cpuHz: number;
  /** Сэмпл звука — на столько тактов процессора. */
  readonly audioDiv: number;
  /** Монетоприёмник закрыт — монету не берёт. */
  readonly coinLocked: boolean;
  readonly cpu: { cycles: number };
  /** Поворотная ручка («Городки»), если есть. */
  stick?: number;
  run(cycles: number, buf: Float32Array | null): number;
  set(k: MachineInput, on: boolean): void;
  reset(): void;
}
