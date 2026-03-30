import { InputState } from '../types/IGame';

export class InputManager {
  private keys = new Set<string>();
  private touches: Map<number, { x: number; y: number }> = new Map();
  private canvasRect: DOMRect | null = null;
  private canvas: HTMLCanvasElement | null = null;

  readonly state: InputState = {
    up: false, down: false, left: false, right: false,
    action1: false, action2: false, start: false,
  };

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.onTouchEnd);
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    if (this.canvas) {
      this.canvas.removeEventListener('touchstart', this.onTouchStart);
      this.canvas.removeEventListener('touchmove', this.onTouchMove);
      this.canvas.removeEventListener('touchend', this.onTouchEnd);
    }
  }

  update() {
    this.state.up = this.keys.has('ArrowUp') || this.keys.has('KeyW');
    this.state.down = this.keys.has('ArrowDown') || this.keys.has('KeyS');
    this.state.left = this.keys.has('ArrowLeft') || this.keys.has('KeyA');
    this.state.right = this.keys.has('ArrowRight') || this.keys.has('KeyD');
    this.state.action1 = this.keys.has('Space') || this.keys.has('KeyZ');
    this.state.action2 = this.keys.has('KeyX') || this.keys.has('ShiftLeft');
    this.state.start = this.keys.has('Enter') || this.keys.has('Escape');
  }

  // For games that need raw touch positions
  getTouches(): Map<number, { x: number; y: number }> {
    return this.touches;
  }

  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    // Prevent scrolling with arrow keys/space
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    this.updateCanvasRect();
    for (const touch of Array.from(e.changedTouches)) {
      this.touches.set(touch.identifier, this.touchPos(touch));
    }
    this.updateTouchState();
  };

  private onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    for (const touch of Array.from(e.changedTouches)) {
      this.touches.set(touch.identifier, this.touchPos(touch));
    }
    this.updateTouchState();
  };

  private onTouchEnd = (e: TouchEvent) => {
    for (const touch of Array.from(e.changedTouches)) {
      this.touches.delete(touch.identifier);
    }
    this.updateTouchState();
  };

  private touchPos(touch: Touch): { x: number; y: number } {
    const r = this.canvasRect!;
    return {
      x: (touch.clientX - r.left) / r.width,
      y: (touch.clientY - r.top) / r.height,
    };
  }

  private updateCanvasRect() {
    if (this.canvas) this.canvasRect = this.canvas.getBoundingClientRect();
  }

  private updateTouchState() {
    // Simple touch zones: left third = left, right third = right,
    // top half = up/action1, bottom half = down
    // Any touch = action1
    this.state.action1 = this.touches.size > 0;
    this.state.left = false;
    this.state.right = false;
    this.state.up = false;
    this.state.down = false;
    for (const pos of this.touches.values()) {
      if (pos.x < 0.33) this.state.left = true;
      if (pos.x > 0.66) this.state.right = true;
      if (pos.y < 0.4) this.state.up = true;
      if (pos.y > 0.6) this.state.down = true;
    }
  }
}
