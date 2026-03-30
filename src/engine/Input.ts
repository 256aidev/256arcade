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

    // Gamepad — poll every frame
    let gUp = false, gDown = false, gLeft = false, gRight = false;
    let gAction1 = false, gAction2 = false, gStart = false;

    try {
      const gamepads = navigator.getGamepads();
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (!gp || !gp.connected) continue;

        const btn = (idx: number) => idx < gp.buttons.length && gp.buttons[idx].pressed;
        const val = (idx: number) => idx < gp.buttons.length ? gp.buttons[idx].value : 0;

        // D-pad (standard mapping: 12=up, 13=down, 14=left, 15=right)
        if (btn(12)) gUp = true;
        if (btn(13)) gDown = true;
        if (btn(14)) gLeft = true;
        if (btn(15)) gRight = true;

        // Face buttons: A/Cross=0, B/Circle=1, X/Square=2, Y/Triangle=3
        if (btn(0)) gAction1 = true;    // A = action1
        if (btn(1)) gAction2 = true;    // B = action2
        if (btn(2)) gAction2 = true;    // X = also action2
        if (btn(3)) gAction1 = true;    // Y = also action1

        // Shoulders and triggers
        if (btn(4)) gAction2 = true;    // LB
        if (btn(5)) gAction1 = true;    // RB
        if (val(6) > 0.3) gDown = true; // LT = brake/down
        if (val(7) > 0.3) gUp = true;   // RT = accelerate/up

        // Start / Select
        if (btn(9)) gStart = true;      // Start/Menu
        if (btn(8)) gStart = true;      // Select/View

        // Left stick (deadzone 0.25)
        if (gp.axes.length >= 2) {
          if (gp.axes[0] < -0.25) gLeft = true;
          if (gp.axes[0] > 0.25) gRight = true;
          if (gp.axes[1] < -0.25) gUp = true;
          if (gp.axes[1] > 0.25) gDown = true;
        }

        // Right stick as fallback
        if (gp.axes.length >= 4) {
          if (gp.axes[2] < -0.25) gLeft = true;
          if (gp.axes[2] > 0.25) gRight = true;
          if (gp.axes[3] < -0.25) gUp = true;
          if (gp.axes[3] > 0.25) gDown = true;
        }
      }
    } catch (_e) { /* getGamepads may throw in some contexts */ }

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
