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
    // Keyboard
    const kUp = this.keys.has('ArrowUp') || this.keys.has('KeyW');
    const kDown = this.keys.has('ArrowDown') || this.keys.has('KeyS');
    const kLeft = this.keys.has('ArrowLeft') || this.keys.has('KeyA');
    const kRight = this.keys.has('ArrowRight') || this.keys.has('KeyD');
    const kAction1 = this.keys.has('Space') || this.keys.has('KeyZ');
    const kAction2 = this.keys.has('KeyX') || this.keys.has('ShiftLeft');
    const kStart = this.keys.has('Enter') || this.keys.has('Escape');

    // Gamepad
    let gUp = false, gDown = false, gLeft = false, gRight = false;
    let gAction1 = false, gAction2 = false, gStart = false;

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of gamepads) {
      if (!gp) continue;
      // D-pad buttons (standard mapping: 12=up, 13=down, 14=left, 15=right)
      if (gp.buttons[12]?.pressed) gUp = true;
      if (gp.buttons[13]?.pressed) gDown = true;
      if (gp.buttons[14]?.pressed) gLeft = true;
      if (gp.buttons[15]?.pressed) gRight = true;
      // Face buttons: A/Cross=0, B/Circle=1, X/Square=2, Y/Triangle=3
      if (gp.buttons[0]?.pressed) gAction1 = true;   // A = action1 (jump/shoot/thrust)
      if (gp.buttons[2]?.pressed) gAction2 = true;   // X = action2 (kick/switch/interact)
      if (gp.buttons[1]?.pressed) gAction2 = true;   // B = also action2
      if (gp.buttons[9]?.pressed) gStart = true;     // Start
      if (gp.buttons[8]?.pressed) gStart = true;     // Select/Back
      // Left stick (deadzone 0.3)
      if (gp.axes[0] < -0.3) gLeft = true;
      if (gp.axes[0] > 0.3) gRight = true;
      if (gp.axes[1] < -0.3) gUp = true;
      if (gp.axes[1] > 0.3) gDown = true;
    }

    // Combine all input sources
    this.state.up = kUp || gUp;
    this.state.down = kDown || gDown;
    this.state.left = kLeft || gLeft;
    this.state.right = kRight || gRight;
    this.state.action1 = kAction1 || gAction1;
    this.state.action2 = kAction2 || gAction2;
    this.state.start = kStart || gStart;
  }

  getTouches(): Map<number, { x: number; y: number }> {
    return this.touches;
  }

  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
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
