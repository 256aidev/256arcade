export class CanvasManager {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  private baseWidth: number;
  private baseHeight: number;

  constructor(container: HTMLElement, baseWidth = 480, baseHeight = 320) {
    this.baseWidth = baseWidth;
    this.baseHeight = baseHeight;
    this.canvas = document.createElement('canvas');
    this.canvas.width = baseWidth;
    this.canvas.height = baseHeight;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    container.appendChild(this.canvas);
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  resize = () => {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const pw = parent.clientWidth;
    const ph = parent.clientHeight;
    const scale = Math.min(pw / this.baseWidth, ph / this.baseHeight);
    const w = Math.floor(this.baseWidth * scale);
    const h = Math.floor(this.baseHeight * scale);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.style.margin = 'auto';
    this.canvas.style.display = 'block';
  };

  clear(color = '#000') {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.baseWidth, this.baseHeight);
  }

  destroy() {
    window.removeEventListener('resize', this.resize);
    this.canvas.remove();
  }

  get width() { return this.baseWidth; }
  get height() { return this.baseHeight; }
}
