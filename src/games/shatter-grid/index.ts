import { audio } from '../../engine/Audio';
import { clamp, randFloat, Rect, circleRectOverlap } from '../../engine/Physics';
import { GameState, InputState, GameInfo, IGame } from '../../types/IGame';

// ── Constants ──────────────────────────────────────────────────────────
const W = 480;
const H = 320;
const COLS = 12;
const ROWS = 8;
const BRICK_W = 36;
const BRICK_H = 12;
const BRICK_PAD = 2;
const BRICK_OFFSET_X = (W - COLS * (BRICK_W + BRICK_PAD)) / 2;
const BRICK_OFFSET_Y = 40;
const PADDLE_W = 60;
const PADDLE_H = 8;
const PADDLE_Y = H - 24;
const PADDLE_SPEED = 280;
const BALL_R = 4;
const BASE_BALL_SPEED = 180;
const MAX_BALL_SPEED = 340;
const POWERUP_CHANCE = 0.10;
const POWERUP_SIZE = 12;
const POWERUP_FALL_SPEED = 80;
const WIDE_PADDLE_W = 96;
const WIDE_PADDLE_DURATION = 8;
const MAX_LIVES = 5;
const TOTAL_LEVELS = 3;

// Row colors (bottom to top): cyan, green, yellow, orange, red, magenta, cyan, green
const ROW_COLORS = ['#00ffff', '#00ff88', '#ffff00', '#ff8800', '#ff2244', '#ff00ff', '#00ffff', '#00ff88'];
const ROW_POINTS = [10, 15, 20, 25, 30, 40, 50, 60];

type PowerupType = 'wide' | 'multi' | 'life';
const POWERUP_COLORS: Record<PowerupType, string> = { wide: '#00ff88', multi: '#00ffff', life: '#ff4466' };

// ── Interfaces ─────────────────────────────────────────────────────────
interface Brick { x: number; y: number; w: number; h: number; row: number; alive: boolean; }
interface Ball { x: number; y: number; vx: number; vy: number; speed: number; active: boolean; }
interface Powerup { x: number; y: number; type: PowerupType; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; }

// ── Game ───────────────────────────────────────────────────────────────
export default class ShatterGridGame implements IGame {
  info: GameInfo = {
    id: 'shatter-grid',
    name: 'Shatter Grid',
    description: 'Break the encrypted data blocks',
    genre: 'Arcade',
    color: '#00d4ff',
    controls: 'Left/Right to move, Space to launch',
  };

  private state: GameState = 'menu';
  private width = W;
  private height = H;
  private scaleX = 1;
  private scaleY = 1;

  // Game objects
  private paddleX = W / 2;
  private paddleW = PADDLE_W;
  private balls: Ball[] = [];
  private bricks: Brick[] = [];
  private powerups: Powerup[] = [];
  private particles: Particle[] = [];

  // State
  private score = 0;
  private lives = 3;
  private level = 1;
  private ballAttached = true;
  private widePaddleTimer = 0;
  private speedMultiplier = 1;
  private menuFlash = 0;
  private prevAction1 = false;
  private prevStart = false;
  private gameWon = false;
  private levelClearTimer = 0;
  private lifeLostTimer = 0;

  // Hex grid cache
  private hexGridCanvas: HTMLCanvasElement | null = null;

  async init(_canvas: HTMLCanvasElement): Promise<void> {
    this.state = 'menu';
    this.resetFull();
  }

  private resetFull(): void {
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.gameWon = false;
    this.resetLevel();
  }

  private resetLevel(): void {
    this.speedMultiplier = 1 + (this.level - 1) * 0.15;
    this.paddleX = W / 2;
    this.paddleW = PADDLE_W;
    this.widePaddleTimer = 0;
    this.balls = [];
    this.powerups = [];
    this.particles = [];
    this.ballAttached = true;
    this.buildBricks();
    this.spawnBall();
  }

  private buildBricks(): void {
    this.bricks = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        this.bricks.push({
          x: BRICK_OFFSET_X + c * (BRICK_W + BRICK_PAD),
          y: BRICK_OFFSET_Y + r * (BRICK_H + BRICK_PAD),
          w: BRICK_W,
          h: BRICK_H,
          row: ROWS - 1 - r, // top rows = higher index = more points
          alive: true,
        });
      }
    }
  }

  private spawnBall(): void {
    const speed = BASE_BALL_SPEED * this.speedMultiplier;
    this.balls.push({
      x: this.paddleX,
      y: PADDLE_Y - BALL_R - 1,
      vx: 0,
      vy: -speed,
      speed,
      active: true,
    });
    this.ballAttached = true;
  }

  private launchBall(): void {
    if (!this.ballAttached) return;
    this.ballAttached = false;
    const b = this.balls[0];
    if (!b) return;
    const angle = randFloat(-0.4, 0.4);
    const speed = b.speed;
    b.vx = Math.sin(angle) * speed;
    b.vy = -Math.cos(angle) * speed;
    audio.hit();
  }

  // ── Update ─────────────────────────────────────────────────────────
  update(dt: number, input: InputState): void {
    this.menuFlash += dt;
    const spacePressed = input.action1 && !this.prevAction1;
    const startPressed = input.start && !this.prevStart;
    this.prevAction1 = input.action1;
    this.prevStart = input.start;

    if (this.state === 'menu') {
      if (spacePressed || startPressed) {
        this.resetFull();
        this.state = 'playing';
      }
      return;
    }

    if (this.state === 'gameover') {
      if (spacePressed || startPressed) {
        this.state = 'menu';
      }
      return;
    }

    if (this.state === 'playing' && startPressed) {
      this.state = 'paused';
      return;
    }
    if (this.state === 'paused') {
      if (startPressed) this.state = 'playing';
      return;
    }

    // ── Level clear pause ──
    if (this.levelClearTimer > 0) {
      this.levelClearTimer -= dt;
      if (this.levelClearTimer <= 0) {
        this.levelClearTimer = 0;
        this.level++;
        this.resetLevel();
      }
      return;
    }

    // ── Life lost pause ──
    if (this.lifeLostTimer > 0) {
      this.lifeLostTimer -= dt;
      if (this.lifeLostTimer <= 0) {
        this.lifeLostTimer = 0;
        this.spawnBall();
      }
      return;
    }

    // Clamp dt to avoid physics tunneling
    dt = Math.min(dt, 0.033);

    // ── Paddle movement ──
    let pdx = 0;
    if (input.left) pdx -= PADDLE_SPEED * dt;
    if (input.right) pdx += PADDLE_SPEED * dt;
    this.paddleX = clamp(this.paddleX + pdx, this.paddleW / 2, W - this.paddleW / 2);

    // ── Wide paddle timer ──
    if (this.widePaddleTimer > 0) {
      this.widePaddleTimer -= dt;
      if (this.widePaddleTimer <= 0) {
        this.paddleW = PADDLE_W;
        this.widePaddleTimer = 0;
      }
    }

    // ── Launch ball ──
    if (this.ballAttached && (spacePressed || startPressed)) {
      this.launchBall();
    }

    // ── Ball attached follows paddle ──
    if (this.ballAttached && this.balls.length > 0) {
      this.balls[0].x = this.paddleX;
      this.balls[0].y = PADDLE_Y - BALL_R - 1;
    }

    // ── Ball physics ──
    const paddleRect: Rect = {
      x: this.paddleX - this.paddleW / 2,
      y: PADDLE_Y,
      w: this.paddleW,
      h: PADDLE_H,
    };

    for (const ball of this.balls) {
      if (!ball.active) continue;
      if (this.ballAttached && ball === this.balls[0]) continue;

      // Gradually increase speed
      ball.speed = Math.min(ball.speed + 4 * dt, MAX_BALL_SPEED * this.speedMultiplier);
      const mag = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
      if (mag > 0) {
        ball.vx = (ball.vx / mag) * ball.speed;
        ball.vy = (ball.vy / mag) * ball.speed;
      }

      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      // Wall bounces
      if (ball.x - BALL_R < 0) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); audio.playTone(300, 0.05, 'sine'); }
      if (ball.x + BALL_R > W) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx); audio.playTone(300, 0.05, 'sine'); }
      if (ball.y - BALL_R < 0) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy); audio.playTone(300, 0.05, 'sine'); }

      // Paddle bounce
      if (circleRectOverlap({ x: ball.x, y: ball.y, r: BALL_R }, paddleRect) && ball.vy > 0) {
        ball.y = PADDLE_Y - BALL_R;
        const hitPos = (ball.x - this.paddleX) / (this.paddleW / 2); // -1 to 1
        const angle = hitPos * 1.1; // max ~63 degrees
        ball.vx = Math.sin(angle) * ball.speed;
        ball.vy = -Math.cos(angle) * ball.speed;
        audio.playTone(500, 0.06, 'square');
      }

      // Brick collision
      for (const brick of this.bricks) {
        if (!brick.alive) continue;
        if (circleRectOverlap({ x: ball.x, y: ball.y, r: BALL_R }, brick)) {
          brick.alive = false;
          this.score += ROW_POINTS[brick.row] || 10;

          // Determine bounce direction
          const cx = clamp(ball.x, brick.x, brick.x + brick.w);
          const cy = clamp(ball.y, brick.y, brick.y + brick.h);
          const dx = ball.x - cx;
          const dy = ball.y - cy;
          if (Math.abs(dx) > Math.abs(dy)) {
            ball.vx = dx > 0 ? Math.abs(ball.vx) : -Math.abs(ball.vx);
          } else {
            ball.vy = dy > 0 ? Math.abs(ball.vy) : -Math.abs(ball.vy);
          }

          // Particles
          this.spawnBrickParticles(brick);

          // Powerup drop
          if (Math.random() < POWERUP_CHANCE) {
            this.spawnPowerup(brick.x + brick.w / 2, brick.y + brick.h / 2);
          }

          audio.playTone(600 + brick.row * 60, 0.08, 'square');
          break; // one brick per ball per frame
        }
      }

      // Ball lost
      if (ball.y - BALL_R > H) {
        ball.active = false;
      }
    }

    // Remove inactive balls
    this.balls = this.balls.filter(b => b.active);

    // If no balls left, lose a life
    if (this.balls.length === 0) {
      this.lives--;
      audio.lose();
      if (this.lives <= 0) {
        this.state = 'gameover';
        this.gameWon = false;
        return;
      }
      this.lifeLostTimer = 1.0; // 1-second pause before respawn
      return;
    }

    // ── Powerups ──
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      p.y += POWERUP_FALL_SPEED * dt;

      // Check paddle catch
      if (p.y + POWERUP_SIZE / 2 >= PADDLE_Y && p.y - POWERUP_SIZE / 2 <= PADDLE_Y + PADDLE_H &&
          p.x >= this.paddleX - this.paddleW / 2 && p.x <= this.paddleX + this.paddleW / 2) {
        this.applyPowerup(p.type);
        this.powerups.splice(i, 1);
        continue;
      }

      // Off screen
      if (p.y > H + POWERUP_SIZE) {
        this.powerups.splice(i, 1);
      }
    }

    // ── Particles ──
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 120 * dt; // gravity
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // ── Check level complete ──
    if (this.bricks.every(b => !b.alive)) {
      if (this.level >= TOTAL_LEVELS) {
        this.state = 'gameover';
        this.gameWon = true;
        audio.score();
      } else {
        audio.powerup();
        this.levelClearTimer = 2.0; // 2-second "LEVEL CLEAR!" pause
        return;
      }
    }
  }

  private spawnBrickParticles(brick: Brick): void {
    const color = ROW_COLORS[brick.row] || '#ffffff';
    for (let i = 0; i < 8; i++) {
      this.particles.push({
        x: brick.x + randFloat(0, brick.w),
        y: brick.y + randFloat(0, brick.h),
        vx: randFloat(-80, 80),
        vy: randFloat(-100, 20),
        life: randFloat(0.3, 0.7),
        maxLife: 0.7,
        color,
        size: randFloat(1.5, 3.5),
      });
    }
  }

  private spawnPowerup(x: number, y: number): void {
    const types: PowerupType[] = ['wide', 'multi', 'life'];
    const weights = [0.45, 0.35, 0.20];
    let r = Math.random();
    let type: PowerupType = 'wide';
    for (let i = 0; i < types.length; i++) {
      r -= weights[i];
      if (r <= 0) { type = types[i]; break; }
    }
    this.powerups.push({ x, y, type });
  }

  private applyPowerup(type: PowerupType): void {
    audio.powerup();
    switch (type) {
      case 'wide':
        this.paddleW = WIDE_PADDLE_W;
        this.widePaddleTimer = WIDE_PADDLE_DURATION;
        break;
      case 'multi':
        // Duplicate each active ball
        const newBalls: Ball[] = [];
        for (const b of this.balls) {
          if (!b.active) continue;
          newBalls.push({
            x: b.x,
            y: b.y,
            vx: b.vx * Math.cos(0.3) - b.vy * Math.sin(0.3),
            vy: b.vx * Math.sin(0.3) + b.vy * Math.cos(0.3),
            speed: b.speed,
            active: true,
          });
          newBalls.push({
            x: b.x,
            y: b.y,
            vx: b.vx * Math.cos(-0.3) - b.vy * Math.sin(-0.3),
            vy: b.vx * Math.sin(-0.3) + b.vy * Math.cos(-0.3),
            speed: b.speed,
            active: true,
          });
        }
        this.balls.push(...newBalls);
        break;
      case 'life':
        this.lives = Math.min(this.lives + 1, MAX_LIVES);
        break;
    }
  }

  // ── Render ─────────────────────────────────────────────────────────
  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.scale(this.scaleX, this.scaleY);

    // Background
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, W, H);
    this.drawHexGrid(ctx);

    if (this.state === 'menu') {
      this.drawMenu(ctx);
      ctx.restore();
      return;
    }

    if (this.state === 'paused') {
      this.drawGame(ctx);
      this.drawOverlay(ctx, 'PAUSED', 'Press ENTER to resume');
      ctx.restore();
      return;
    }

    if (this.state === 'gameover') {
      this.drawGame(ctx);
      const msg = this.gameWon ? 'GRID DECRYPTED' : 'SYSTEM FAILURE';
      const sub = `Score: ${this.score}  |  Press SPACE`;
      this.drawOverlay(ctx, msg, sub);
      ctx.restore();
      return;
    }

    this.drawGame(ctx);

    // Level clear overlay
    if (this.levelClearTimer > 0) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#00ff88';
      ctx.shadowColor = '#00ff88';
      ctx.shadowBlur = 20;
      ctx.font = 'bold 28px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('LEVEL CLEAR!', W / 2, H / 2 - 14);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#aabbcc';
      ctx.font = '14px monospace';
      ctx.fillText(`Level ${this.level} complete`, W / 2, H / 2 + 18);
    }

    // Life lost overlay
    if (this.lifeLostTimer > 0) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ff4466';
      ctx.shadowColor = '#ff4466';
      ctx.shadowBlur = 16;
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('LIFE LOST', W / 2, H / 2 - 8);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#aabbcc';
      ctx.font = '12px monospace';
      ctx.fillText(`${this.lives} ${this.lives === 1 ? 'life' : 'lives'} remaining`, W / 2, H / 2 + 14);
    }

    ctx.restore();
  }

  private drawHexGrid(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.04)';
    ctx.lineWidth = 0.5;
    const spacing = 24;
    for (let y = 0; y < H + spacing; y += spacing) {
      for (let x = 0; x < W + spacing; x += spacing) {
        const offsetX = (Math.floor(y / spacing) % 2) * (spacing / 2);
        ctx.strokeRect(x + offsetX, y, spacing, spacing);
      }
    }
  }

  private drawGame(ctx: CanvasRenderingContext2D): void {
    // ── Bricks ──
    for (const brick of this.bricks) {
      if (!brick.alive) continue;
      const color = ROW_COLORS[brick.row] || '#ffffff';
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
      // Inner highlight
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(brick.x + 1, brick.y + 1, brick.w - 2, 2);
      ctx.globalAlpha = 1;
    }

    // ── Particles ──
    for (const p of this.particles) {
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 4;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // ── Powerups ──
    for (const p of this.powerups) {
      const color = POWERUP_COLORS[p.type];
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      // Diamond shape
      ctx.moveTo(p.x, p.y - POWERUP_SIZE / 2);
      ctx.lineTo(p.x + POWERUP_SIZE / 2, p.y);
      ctx.lineTo(p.x, p.y + POWERUP_SIZE / 2);
      ctx.lineTo(p.x - POWERUP_SIZE / 2, p.y);
      ctx.closePath();
      ctx.fill();
      // Label
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#000';
      ctx.font = 'bold 7px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = p.type === 'wide' ? 'W' : p.type === 'multi' ? 'M' : '+';
      ctx.fillText(label, p.x, p.y + 1);
    }
    ctx.shadowBlur = 0;

    // ── Paddle ──
    const px = this.paddleX - this.paddleW / 2;
    ctx.fillStyle = '#00d4ff';
    ctx.shadowColor = '#00d4ff';
    ctx.shadowBlur = 12;
    ctx.fillRect(px, PADDLE_Y, this.paddleW, PADDLE_H);
    // Paddle inner glow
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(px + 2, PADDLE_Y + 1, this.paddleW - 4, 2);

    // ── Balls ──
    for (const ball of this.balls) {
      if (!ball.active) continue;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#00d4ff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // ── HUD ──
    ctx.fillStyle = '#00d4ff';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`SCORE: ${this.score}`, 6, 4);
    ctx.textAlign = 'center';
    ctx.fillText(`LEVEL ${this.level}`, W / 2, 4);
    ctx.textAlign = 'right';
    ctx.fillText('LIVES:', W - 46, 4);

    // Lives as dots
    for (let i = 0; i < this.lives; i++) {
      ctx.fillStyle = '#ff4466';
      ctx.shadowColor = '#ff4466';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(W - 36 + i * 10, 10, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Wide paddle timer indicator
    if (this.widePaddleTimer > 0) {
      ctx.fillStyle = '#00ff88';
      ctx.font = '8px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`WIDE: ${this.widePaddleTimer.toFixed(1)}s`, 6, 18);
    }

    // Ball count
    if (this.balls.length > 1) {
      ctx.fillStyle = '#00ffff';
      ctx.font = '8px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`BALLS: ${this.balls.length}`, W - 6, 18);
    }
  }

  private drawMenu(ctx: CanvasRenderingContext2D): void {
    // Title
    ctx.fillStyle = '#00d4ff';
    ctx.shadowColor = '#00d4ff';
    ctx.shadowBlur = 20;
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SHATTER GRID', W / 2, H / 2 - 40);
    ctx.shadowBlur = 0;

    // Subtitle
    ctx.fillStyle = '#668899';
    ctx.font = '10px monospace';
    ctx.fillText('// DATA BLOCK DECRYPTION PROTOCOL //', W / 2, H / 2 - 10);

    // Flashing prompt
    const alpha = 0.5 + Math.sin(this.menuFlash * 3) * 0.5;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#00ff88';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('PRESS SPACE TO INITIALIZE', W / 2, H / 2 + 30);
    ctx.globalAlpha = 1;

    // Controls help box
    const boxW = 320;
    const boxH = 38;
    const boxX = (W - boxW) / 2;
    const boxY = H / 2 + 48;
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = 'rgba(0, 10, 20, 0.5)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = '#7799aa';
    ctx.font = '9px monospace';
    ctx.fillText('LEFT/RIGHT = Move Paddle  |  SPACE = Launch Ball', W / 2, boxY + 14);
    ctx.fillText('ENTER = Pause', W / 2, boxY + 28);
  }

  private drawOverlay(ctx: CanvasRenderingContext2D, title: string, subtitle: string): void {
    // Dim background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, W, H);

    // Title
    const color = this.gameWon ? '#00ff88' : '#ff4466';
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, W / 2, H / 2 - 16);
    ctx.shadowBlur = 0;

    const alpha = 0.5 + Math.sin(this.menuFlash * 3) * 0.5;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#aabbcc';
    ctx.font = '12px monospace';
    ctx.fillText(subtitle, W / 2, H / 2 + 16);
    ctx.globalAlpha = 1;
  }

  // ── Interface methods ──────────────────────────────────────────────
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.scaleX = width / W;
    this.scaleY = height / H;
  }

  getScore(): number { return this.score; }
  getState(): GameState { return this.state; }

  destroy(): void {
    this.balls = [];
    this.bricks = [];
    this.powerups = [];
    this.particles = [];
    this.hexGridCanvas = null;
  }
}
