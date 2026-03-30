export class GameLoop {
  private running = false;
  private lastTime = 0;
  private accumulator = 0;
  private readonly timestep = 1 / 60; // 60fps logical updates
  private rafId = 0;

  constructor(
    private onUpdate: (dt: number) => void,
    private onRender: () => void
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.tick(this.lastTime);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number) => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    let delta = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // Clamp to prevent spiral of death
    if (delta > 0.25) delta = 0.25;
    this.accumulator += delta;

    while (this.accumulator >= this.timestep) {
      this.onUpdate(this.timestep);
      this.accumulator -= this.timestep;
    }

    this.onRender();
  };
}
