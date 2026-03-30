import { IGame, GameState, InputState, GameInfo } from '../../types/IGame';
import { clamp, randInt, randFloat, Rect, rectsOverlap } from '../../engine/Physics';
import { audio } from '../../engine/Audio';

interface Star {
  x: number;
  y: number;
  size: number;
  speed: number;
  brightness: number;
}

interface AsteroidPair {
  x: number;
  gapY: number;     // center of the gap
  gapSize: number;   // total gap height
  scored: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

const GRAVITY = 600;
const THRUST = -280;
const SCROLL_SPEED = 120;
const ASTEROID_WIDTH = 50;
const ASTEROID_SPACING = 180;  // horizontal distance between pairs
const GAP_SIZE_MIN = 90;
const GAP_SIZE_MAX = 110;
const ROCKET_W = 24;
const ROCKET_H = 18;
const ROCKET_X = 80;          // fixed horizontal position
const STAR_COUNT = 60;

export default class RocketHopGame implements IGame {
  info: GameInfo = {
    id: 'rocket-hop',
    name: 'Rocket Hop',
    description: 'Thrust your rocket through asteroid gaps in deep space!',
    genre: 'Arcade',
    color: '#FF6B00',
    controls: 'SPACE / Tap = Thrust',
  };

  private state: GameState = 'menu';
  private score = 0;
  private width = 480;
  private height = 320;

  // Rocket
  private rocketY = 0;
  private rocketVY = 0;

  // World
  private stars: Star[] = [];
  private asteroids: AsteroidPair[] = [];
  private particles: Particle[] = [];
  private distanceTraveled = 0;

  // Input tracking for rising edge
  private prevAction1 = false;

  // Menu animation
  private menuTime = 0;

  async init(_canvas: HTMLCanvasElement): Promise<void> {
    this.reset();
  }

  private reset(): void {
    this.score = 0;
    this.rocketY = this.height / 2;
    this.rocketVY = 0;
    this.distanceTraveled = 0;
    this.particles = [];
    this.prevAction1 = false;

    // Generate stars
    this.stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      this.stars.push({
        x: randFloat(0, this.width),
        y: randFloat(0, this.height),
        size: randFloat(0.5, 2),
        speed: randFloat(10, 40),
        brightness: randFloat(0.3, 1),
      });
    }

    // Generate initial asteroids offscreen to the right
    this.asteroids = [];
    for (let i = 0; i < 6; i++) {
      this.asteroids.push({
        x: this.width + 100 + i * ASTEROID_SPACING,
        gapY: randInt(60, this.height - 60),
        gapSize: randInt(GAP_SIZE_MIN, GAP_SIZE_MAX),
        scored: false,
      });
    }
  }

  update(dt: number, input: InputState): void {
    this.menuTime += dt;

    // Update stars always (background)
    for (const star of this.stars) {
      star.x -= star.speed * dt;
      if (star.x < 0) {
        star.x = this.width;
        star.y = randFloat(0, this.height);
      }
    }

    if (this.state === 'menu') {
      if (input.action1 && !this.prevAction1) {
        this.state = 'playing';
        this.reset();
        this.state = 'playing';
        audio.jump();
      }
      this.prevAction1 = input.action1;
      return;
    }

    if (this.state === 'gameover') {
      // Update particles even in gameover for explosion effect
      this.updateParticles(dt);
      if (input.action1 && !this.prevAction1) {
        this.state = 'menu';
        this.reset();
      }
      this.prevAction1 = input.action1;
      return;
    }

    if (this.state !== 'playing') {
      this.prevAction1 = input.action1;
      return;
    }

    // --- Playing state ---

    // Thrust on rising edge
    if (input.action1 && !this.prevAction1) {
      this.rocketVY = THRUST;
      audio.jump();
      // Thrust particles
      for (let i = 0; i < 5; i++) {
        this.particles.push({
          x: ROCKET_X - ROCKET_W / 2,
          y: this.rocketY + randFloat(-4, 4),
          vx: randFloat(-80, -30),
          vy: randFloat(-20, 20),
          life: randFloat(0.15, 0.35),
          maxLife: 0.35,
          color: Math.random() > 0.5 ? '#FF6B00' : '#FFD700',
          size: randFloat(1.5, 3),
        });
      }
    }
    this.prevAction1 = input.action1;

    // Gravity
    this.rocketVY += GRAVITY * dt;
    this.rocketY += this.rocketVY * dt;

    // Clamp to screen bounds (hitting top/bottom = death)
    if (this.rocketY - ROCKET_H / 2 < 0 || this.rocketY + ROCKET_H / 2 > this.height) {
      this.rocketY = clamp(this.rocketY, ROCKET_H / 2, this.height - ROCKET_H / 2);
      this.die();
      return;
    }

    // Scroll asteroids
    this.distanceTraveled += SCROLL_SPEED * dt;
    for (const ast of this.asteroids) {
      ast.x -= SCROLL_SPEED * dt;
    }

    // Score check
    for (const ast of this.asteroids) {
      if (!ast.scored && ast.x + ASTEROID_WIDTH < ROCKET_X - ROCKET_W / 2) {
        ast.scored = true;
        this.score++;
        audio.score();
      }
    }

    // Remove offscreen asteroids and add new ones
    if (this.asteroids.length > 0 && this.asteroids[0].x + ASTEROID_WIDTH < -10) {
      this.asteroids.shift();
      const last = this.asteroids[this.asteroids.length - 1];
      this.asteroids.push({
        x: last.x + ASTEROID_SPACING,
        gapY: randInt(60, this.height - 60),
        gapSize: randInt(GAP_SIZE_MIN, GAP_SIZE_MAX),
        scored: false,
      });
    }

    // Collision detection
    const rocketRect: Rect = {
      x: ROCKET_X - ROCKET_W / 2 + 2,
      y: this.rocketY - ROCKET_H / 2 + 2,
      w: ROCKET_W - 4,
      h: ROCKET_H - 4,
    };

    for (const ast of this.asteroids) {
      const halfGap = ast.gapSize / 2;
      // Top asteroid
      const topRect: Rect = { x: ast.x, y: 0, w: ASTEROID_WIDTH, h: ast.gapY - halfGap };
      // Bottom asteroid
      const botRect: Rect = { x: ast.x, y: ast.gapY + halfGap, w: ASTEROID_WIDTH, h: this.height - (ast.gapY + halfGap) };

      if (rectsOverlap(rocketRect, topRect) || rectsOverlap(rocketRect, botRect)) {
        this.die();
        return;
      }
    }

    // Update particles
    this.updateParticles(dt);

    // Continuous exhaust trail while playing
    if (Math.random() < 0.4) {
      this.particles.push({
        x: ROCKET_X - ROCKET_W / 2 - 2,
        y: this.rocketY + randFloat(-2, 2),
        vx: randFloat(-40, -15),
        vy: randFloat(-8, 8),
        life: randFloat(0.1, 0.2),
        maxLife: 0.2,
        color: '#FF4500',
        size: randFloat(1, 2),
      });
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  private die(): void {
    this.state = 'gameover';
    audio.explosion();
    audio.lose();
    // Explosion particles
    for (let i = 0; i < 30; i++) {
      const angle = randFloat(0, Math.PI * 2);
      const speed = randFloat(40, 160);
      this.particles.push({
        x: ROCKET_X,
        y: this.rocketY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: randFloat(0.3, 0.8),
        maxLife: 0.8,
        color: ['#FF6B00', '#FFD700', '#FF4500', '#FFF'][randInt(0, 3)],
        size: randFloat(2, 5),
      });
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const w = this.width;
    const h = this.height;

    // Background - dark space
    ctx.fillStyle = '#0A0A1A';
    ctx.fillRect(0, 0, w, h);

    // Stars
    for (const star of this.stars) {
      ctx.globalAlpha = star.brightness;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(Math.floor(star.x), Math.floor(star.y), star.size, star.size);
    }
    ctx.globalAlpha = 1;

    if (this.state === 'menu') {
      this.renderMenu(ctx);
      return;
    }

    // Asteroids
    this.renderAsteroids(ctx);

    // Particles
    this.renderParticles(ctx);

    // Rocket (only if playing)
    if (this.state === 'playing') {
      this.renderRocket(ctx);
    }

    // Score display
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // Shadow for readability
    ctx.fillStyle = '#000000';
    ctx.fillText(String(this.score), w / 2 + 1, 11);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(String(this.score), w / 2, 10);

    if (this.state === 'gameover') {
      // Particles still render (explosion), score visible
      // Shell handles gameover overlay
    }
  }

  private renderMenu(ctx: CanvasRenderingContext2D): void {
    const w = this.width;
    const h = this.height;

    // Title
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Title glow
    ctx.shadowColor = '#FF6B00';
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#FF6B00';
    ctx.font = 'bold 42px monospace';
    ctx.fillText('ROCKET HOP', w / 2, h / 2 - 40);
    ctx.shadowBlur = 0;

    // Subtitle
    ctx.fillStyle = '#AAAAAA';
    ctx.font = '14px monospace';
    ctx.fillText('Navigate through asteroid gaps!', w / 2, h / 2 + 5);

    // Blinking prompt
    const blink = Math.sin(this.menuTime * 3) > 0;
    if (blink) {
      ctx.fillStyle = '#FFD700';
      ctx.font = 'bold 16px monospace';
      ctx.fillText('Press SPACE to start', w / 2, h / 2 + 50);
    }

    // Draw a little rocket icon on the menu
    const menuRocketY = h / 2 - 40 + Math.sin(this.menuTime * 2) * 8;
    this.drawRocket(ctx, w / 2 - 100, menuRocketY);
  }

  private renderRocket(ctx: CanvasRenderingContext2D): void {
    this.drawRocket(ctx, ROCKET_X, this.rocketY);
  }

  private drawRocket(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();
    ctx.translate(x, y);

    // Tilt based on vertical velocity (only during gameplay)
    const tilt = this.state === 'playing' ? clamp(this.rocketVY / 500, -0.4, 0.5) : 0;
    ctx.rotate(tilt);

    // Rocket body (neon orange)
    ctx.fillStyle = '#FF6B00';
    ctx.beginPath();
    ctx.moveTo(ROCKET_W / 2, 0);           // nose
    ctx.lineTo(-ROCKET_W / 2, -ROCKET_H / 2); // top-left
    ctx.lineTo(-ROCKET_W / 2 + 4, 0);      // indent
    ctx.lineTo(-ROCKET_W / 2, ROCKET_H / 2);  // bottom-left
    ctx.closePath();
    ctx.fill();

    // Cockpit window
    ctx.fillStyle = '#00DDFF';
    ctx.beginPath();
    ctx.arc(2, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    // Neon glow outline
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ROCKET_W / 2, 0);
    ctx.lineTo(-ROCKET_W / 2, -ROCKET_H / 2);
    ctx.lineTo(-ROCKET_W / 2 + 4, 0);
    ctx.lineTo(-ROCKET_W / 2, ROCKET_H / 2);
    ctx.closePath();
    ctx.stroke();

    // Flame (flicker)
    if (this.state === 'playing') {
      const flicker = randFloat(4, 8);
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.moveTo(-ROCKET_W / 2 + 4, -3);
      ctx.lineTo(-ROCKET_W / 2 - flicker, 0);
      ctx.lineTo(-ROCKET_W / 2 + 4, 3);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#FF4500';
      ctx.beginPath();
      ctx.moveTo(-ROCKET_W / 2 + 4, -2);
      ctx.lineTo(-ROCKET_W / 2 - flicker * 0.6, 0);
      ctx.lineTo(-ROCKET_W / 2 + 4, 2);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  private renderAsteroids(ctx: CanvasRenderingContext2D): void {
    for (const ast of this.asteroids) {
      const halfGap = ast.gapSize / 2;

      // Top asteroid
      this.drawAsteroid(ctx, ast.x, 0, ASTEROID_WIDTH, ast.gapY - halfGap, false);
      // Bottom asteroid
      this.drawAsteroid(ctx, ast.x, ast.gapY + halfGap, ASTEROID_WIDTH, this.height - (ast.gapY + halfGap), true);
    }
  }

  private drawAsteroid(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fromTop: boolean): void {
    if (h <= 0) return;

    // Main rock body
    ctx.fillStyle = '#3A3A4A';
    ctx.fillRect(x, y, w, h);

    // Darker edge
    ctx.fillStyle = '#2A2A3A';
    ctx.fillRect(x, y, 4, h);
    ctx.fillRect(x + w - 4, y, 4, h);

    // Lighter highlights (rocky texture)
    ctx.fillStyle = '#4A4A5A';
    const edgeY = fromTop ? y : y + h;
    // Jagged edge at the gap opening
    for (let i = 0; i < w; i += 8) {
      const jagH = 3 + (Math.sin(x * 0.1 + i * 0.5) * 3);
      if (fromTop) {
        ctx.fillRect(x + i, y - jagH, 8, jagH + 2);
      } else {
        ctx.fillRect(x + i, edgeY - 2, 8, jagH);
      }
    }

    // Surface texture dots
    ctx.fillStyle = '#555568';
    const seed = Math.floor(x * 7 + y * 3);
    for (let i = 0; i < 5; i++) {
      const dotX = x + 5 + ((seed + i * 37) % (w - 10));
      const dotY = y + 5 + ((seed + i * 53) % Math.max(1, h - 10));
      if (dotY >= y && dotY <= y + h - 3) {
        ctx.fillRect(dotX, dotY, 3, 3);
      }
    }

    // Neon edge highlight at gap opening
    ctx.fillStyle = '#FF6B0044';
    if (fromTop) {
      ctx.fillRect(x, y, w, 2);
    } else {
      ctx.fillRect(x, y + h - 2, w, 2);
    }
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  getScore(): number {
    return this.score;
  }

  getState(): GameState {
    return this.state;
  }

  destroy(): void {
    this.stars = [];
    this.asteroids = [];
    this.particles = [];
  }
}
