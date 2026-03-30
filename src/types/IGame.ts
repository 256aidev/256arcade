export type GameState = 'menu' | 'playing' | 'paused' | 'gameover';

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  action1: boolean;
  action2: boolean;
  start: boolean;
}

export interface GameInfo {
  id: string;
  name: string;
  description: string;
  genre: string;
  color: string;
  controls: string;
}

export interface IGame {
  info: GameInfo;
  init(canvas: HTMLCanvasElement): Promise<void>;
  update(dt: number, input: InputState): void;
  render(ctx: CanvasRenderingContext2D): void;
  resize(width: number, height: number): void;
  getScore(): number;
  getState(): GameState;
  destroy(): void;
}
