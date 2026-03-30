import { IGame, GameInfo, GameState, InputState } from '../../types/IGame';
import { audio } from '../../engine/Audio';
import { clamp, randFloat } from '../../engine/Physics';

// ── Constants ──────────────────────────────────────────────────────────
const W = 480;
const H = 320;
const PADDLE_W = 10;
const PADDLE_H = 56;
const PADDLE_MARGIN = 18;
const PADDLE_SPEED = 260;
const BALL_R = 6;
const BALL_SPEED_INIT = 220;
const BALL_SPEED_INC = 12;
const BALL_SPEED_MAX = 500;
const AI_SPEED = 210;
const AI_REACT_DIST = 12;
const WIN_SCORE = 11;
const TRAIL_LEN = 12;
const GRID_SPACING = 40;

const COL_PLAYER = '#00ff88';
const COL_AI = '#ff0080';
const COL_BALL = '#00e5ff';
const COL_BG = '#0a0a1a';
const COL_GRID = 'rgba(60,60,120,0.15)';

// ── Helpers ────────────────────────────────────────────────────────────
interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; color: string; size: number;
}

interface TrailPoint { x: number; y: number; }

// ── Game Class ─────────────────────────────────────────────────────────
export default class CosmicRallyGame implements IGame {
  info: GameInfo = {
    id: 'cosmic-rally',
    name: 'Cosmic Rally',
    description: 'Neon space paddle duel',
    genre: 'Sports',
    color: '#00ff88',
    controls: 'W/S & Up/Down arrows',
  };

  private state: GameState = 'menu';
  private canvasW = W;
  private canvasH = H;
  private scaleX = 1;
  private scaleY = 1;

  // Paddles  (x,y = top-left corner)
  private playerY = 0;
  private aiY = 0;
  private readonly playerX = PADDLE_MARGIN;
  private readonly aiX = W - PADDLE_MARGIN - PADDLE_W;

  // Ball
  private ballX = 0;
  private ballY = 0;
  private ballVX = 0;
  private ballVY = 0;
  private ballSpeed = BALL_SPEED_INIT;

  // Score
  private playerScore = 0;
  private aiScore = 0;

  // Effects
  private trail: TrailPoint[] = [];
  private particles: Particle[] = [];
  private serveTimer = 0;
  private menuPulse = 0;
  private starField: { x: number; y: number; brightness: number }[] = [];
  private scorePauseTimer = 0;
  private scorePauseDir = 1;
  private winMessageTimer = 0;

  // ── Interface Methods ──────────────────────────────────────────────

  async init(_canvas: HTMLCanvasElement): Promise<void> {
    this.state = 'menu';
    this.playerScore = 0;
    this.aiScore = 0;
    this.generateStars();
    this.resetPositions();
  }

  update(dt: number, input: InputState): void {
    this.menuPulse += dt;

    if (this.state === 'menu') {
      if (input.action1 || input.start) {
        this.state = 'playing';
        this.playerScore = 0;
        this.aiScore = 0;
        this.resetBall(1);
      }
      return;
    }

    if (this.state === 'gameover') {
      if (input.action1 || input.start) {
        this.state = 'menu';
      }
      return;
    }

    if (this.state === 'paused') {
      if (input.start) this.state = 'playing';
      return;
    }

    // Playing state
    if (input.start) {
      this.state = 'paused';
      return;
    }

    // Win message delay (show "YOU WIN!" / "GAME OVER" before switching state)
    if (this.winMessageTimer > 0) {
      this.winMessageTimer -= dt;
      this.updateParticles(dt);
      if (this.winMessageTimer <= 0) {
        this.state = 'gameover';
      }
      return;
    }

    // Score pause (brief pause after a point before ball resets)
    if (this.scorePauseTimer > 0) {
      this.scorePauseTimer -= dt;
      this.updateParticles(dt);
      if (this.scorePauseTimer <= 0) {
        this.checkWin(this.scorePauseDir);
      }
      return;
    }

    // Serve delay
    if (this.serveTimer > 0) {
      this.serveTimer -= dt;
      this.updateAI(dt);
      this.updatePlayerPaddle(dt, input);
      this.updateParticles(dt);
      return;
    }

    this.updatePlayerPaddle(dt, input);
    this.updateAI(dt);
    this.updateBall(dt);
    this.updateParticles(dt);
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.scale(this.scaleX, this.scaleY);

    // Background
    ctx.fillStyle = COL_BG;
    ctx.fillRect(0, 0, W, H);

    // Stars
    for (const s of this.starField) {
      ctx.fillStyle = `rgba(200,200,255,${s.brightness})`;
      ctx.fillRect(s.x, s.y, 1, 1);
    }

    // Grid
    ctx.strokeStyle = COL_GRID;
    ctx.lineWidth = 0.5;
    for (let x = 0; x < W; x += GRID_SPACING) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += GRID_SPACING) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Centre dashed line
    ctx.strokeStyle = 'rgba(100,100,180,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.setLineDash([]);

    if (this.state === 'menu') {
      this.renderMenu(ctx);
      ctx.restore();
      return;
    }

    // Ball trail
    this.renderTrail(ctx);

    // Ball
    this.renderBall(ctx);

    // Paddles
    this.renderPaddle(ctx, this.playerX, this.playerY, COL_PLAYER);
    this.renderPaddle(ctx, this.aiX, this.aiY, COL_AI);

    // Particles
    this.renderParticles(ctx);

    // Scores
    this.renderScores(ctx);

    // Win message overlay (shown during winMessageTimer before gameover)
    if (this.winMessageTimer > 0 && this.state === 'playing') {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, W, H);
      const won = this.playerScore >= WIN_SCORE;
      const msg = won ? 'YOU WIN!' : 'GAME OVER';
      const col = won ? COL_PLAYER : COL_AI;
      this.drawGlowText(ctx, msg, W / 2, H / 2 - 10, 32, col, 14);
      this.drawGlowText(ctx, `${this.playerScore} - ${this.aiScore}`, W / 2, H / 2 + 22, 18, '#ffffff', 6);
    }

    // Paused overlay
    if (this.state === 'paused') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, H);
      this.drawGlowText(ctx, 'PAUSED', W / 2, H / 2, 28, '#ffffff', 10);
      this.drawGlowText(ctx, 'Press ENTER to resume', W / 2, H / 2 + 30, 12, '#aaaacc', 4);
    }

    // Game over overlay
    if (this.state === 'gameover') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      const won = this.playerScore >= WIN_SCORE;
      const msg = won ? 'YOU WIN!' : 'GAME OVER';
      const col = won ? COL_PLAYER : COL_AI;
      this.drawGlowText(ctx, msg, W / 2, H / 2 - 10, 32, col, 14);
      this.drawGlowText(ctx, `${this.playerScore} - ${this.aiScore}`, W / 2, H / 2 + 22, 18, '#ffffff', 6);
      this.drawGlowText(ctx, 'Press SPACE to continue', W / 2, H / 2 + 50, 11, '#aaaacc', 3);
    }

    ctx.restore();
  }

  resize(width: number, height: number): void {
    this.canvasW = width;
    this.canvasH = height;
    this.scaleX = width / W;
    this.scaleY = height / H;
  }

  getScore(): number { return this.playerScore; }
  getState(): GameState { return this.state; }

  destroy(): void {
    this.particles = [];
    this.trail = [];
  }

  // ── Internal Logic ─────────────────────────────────────────────────

  private resetPositions(): void {
    this.playerY = H / 2 - PADDLE_H / 2;
    this.aiY = H / 2 - PADDLE_H / 2;
    this.ballX = W / 2;
    this.ballY = H / 2;
    this.ballVX = 0;
    this.ballVY = 0;
    this.ballSpeed = BALL_SPEED_INIT;
    this.trail = [];
  }

  private resetBall(dir: number): void {
    this.ballX = W / 2;
    this.ballY = H / 2;
    this.ballSpeed = BALL_SPEED_INIT;
    const angle = randFloat(-Math.PI / 5, Math.PI / 5);
    this.ballVX = Math.cos(angle) * this.ballSpeed * dir;
    this.ballVY = Math.sin(angle) * this.ballSpeed;
    this.trail = [];
    this.serveTimer = 0.5;
  }

  private updatePlayerPaddle(dt: number, input: InputState): void {
    if (input.up) this.playerY -= PADDLE_SPEED * dt;
    if (input.down) this.playerY += PADDLE_SPEED * dt;
    this.playerY = clamp(this.playerY, 0, H - PADDLE_H);
  }

  private updateAI(dt: number): void {
    const center = this.aiY + PADDLE_H / 2;
    const target = this.ballY;
    const diff = target - center;
    if (Math.abs(diff) > AI_REACT_DIST) {
      const move = Math.sign(diff) * AI_SPEED * dt;
      this.aiY += move;
    }
    this.aiY = clamp(this.aiY, 0, H - PADDLE_H);
  }

  private updateBall(dt: number): void {
    // Record trail
    this.trail.push({ x: this.ballX, y: this.ballY });
    if (this.trail.length > TRAIL_LEN) this.trail.shift();

    this.ballX += this.ballVX * dt;
    this.ballY += this.ballVY * dt;

    // Top / bottom wall bounce
    if (this.ballY - BALL_R < 0) {
      this.ballY = BALL_R;
      this.ballVY = Math.abs(this.ballVY);
      audio.playTone(300, 0.05, 'sine');
    } else if (this.ballY + BALL_R > H) {
      this.ballY = H - BALL_R;
      this.ballVY = -Math.abs(this.ballVY);
      audio.playTone(300, 0.05, 'sine');
    }

    // Player paddle collision
    if (
      this.ballVX < 0 &&
      this.ballX - BALL_R <= this.playerX + PADDLE_W &&
      this.ballX - BALL_R >= this.playerX - 4 &&
      this.ballY >= this.playerY &&
      this.ballY <= this.playerY + PADDLE_H
    ) {
      this.handlePaddleHit(this.playerX + PADDLE_W, this.playerY, 1, COL_PLAYER);
    }

    // AI paddle collision
    if (
      this.ballVX > 0 &&
      this.ballX + BALL_R >= this.aiX &&
      this.ballX + BALL_R <= this.aiX + PADDLE_W + 4 &&
      this.ballY >= this.aiY &&
      this.ballY <= this.aiY + PADDLE_H
    ) {
      this.handlePaddleHit(this.aiX, this.aiY, -1, COL_AI);
    }

    // Scoring
    if (this.ballX < -BALL_R * 2) {
      this.aiScore++;
      audio.lose();
      this.ballVX = 0;
      this.ballVY = 0;
      this.scorePauseTimer = 1.0;
      this.scorePauseDir = -1;
    } else if (this.ballX > W + BALL_R * 2) {
      this.playerScore++;
      audio.score();
      this.ballVX = 0;
      this.ballVY = 0;
      this.scorePauseTimer = 1.0;
      this.scorePauseDir = 1;
    }
  }

  private handlePaddleHit(edgeX: number, paddleY: number, dirX: number, color: string): void {
    this.ballX = edgeX + BALL_R * dirX;
    // Angle based on where ball hits paddle (-1 top, +1 bottom)
    const hitPos = (this.ballY - paddleY) / PADDLE_H; // 0..1
    const angle = (hitPos - 0.5) * (Math.PI / 3); // -60..+60 deg
    this.ballSpeed = Math.min(this.ballSpeed + BALL_SPEED_INC, BALL_SPEED_MAX);
    this.ballVX = Math.cos(angle) * this.ballSpeed * dirX;
    this.ballVY = Math.sin(angle) * this.ballSpeed;
    audio.hit();
    this.spawnHitParticles(this.ballX, this.ballY, dirX, color);
  }

  private checkWin(serveDir: number): void {
    if (this.playerScore >= WIN_SCORE || this.aiScore >= WIN_SCORE) {
      this.ballVX = 0;
      this.ballVY = 0;
      this.winMessageTimer = 2.0;
    } else {
      this.resetBall(serveDir);
    }
  }

  private spawnHitParticles(x: number, y: number, dirX: number, color: string): void {
    const count = 14;
    for (let i = 0; i < count; i++) {
      const angle = randFloat(0, Math.PI * 2);
      const speed = randFloat(60, 200);
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed + dirX * 40,
        vy: Math.sin(angle) * speed,
        life: randFloat(0.2, 0.5),
        maxLife: 0.5,
        color,
        size: randFloat(1.5, 3.5),
      });
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  private generateStars(): void {
    this.starField = [];
    for (let i = 0; i < 80; i++) {
      this.starField.push({
        x: Math.random() * W,
        y: Math.random() * H,
        brightness: randFloat(0.15, 0.55),
      });
    }
  }

  // ── Render Helpers ─────────────────────────────────────────────────

  private renderPaddle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = color;
    // Rounded rect
    const r = 4;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + PADDLE_W - r, y);
    ctx.quadraticCurveTo(x + PADDLE_W, y, x + PADDLE_W, y + r);
    ctx.lineTo(x + PADDLE_W, y + PADDLE_H - r);
    ctx.quadraticCurveTo(x + PADDLE_W, y + PADDLE_H, x + PADDLE_W - r, y + PADDLE_H);
    ctx.lineTo(x + r, y + PADDLE_H);
    ctx.quadraticCurveTo(x, y + PADDLE_H, x, y + PADDLE_H - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private renderBall(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.shadowColor = COL_BALL;
    ctx.shadowBlur = 18;
    ctx.fillStyle = COL_BALL;
    ctx.beginPath();
    ctx.arc(this.ballX, this.ballY, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    // Inner bright core
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(this.ballX, this.ballY, BALL_R * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private renderTrail(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.trail.length; i++) {
      const t = this.trail[i];
      const alpha = (i / this.trail.length) * 0.45;
      const radius = BALL_R * (0.3 + 0.7 * (i / this.trail.length));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = COL_BALL;
      ctx.shadowBlur = 8;
      ctx.fillStyle = COL_BALL;
      ctx.beginPath();
      ctx.arc(t.x, t.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      ctx.restore();
    }
  }

  private renderScores(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 22px monospace';
    // Player score
    ctx.shadowColor = COL_PLAYER;
    ctx.shadowBlur = 8;
    ctx.fillStyle = COL_PLAYER;
    ctx.fillText(String(this.playerScore), W / 2 - 30, 10);
    // Separator
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 2;
    ctx.fillStyle = '#556';
    ctx.fillText('-', W / 2, 10);
    // AI score
    ctx.shadowColor = COL_AI;
    ctx.shadowBlur = 8;
    ctx.fillStyle = COL_AI;
    ctx.fillText(String(this.aiScore), W / 2 + 30, 10);
    ctx.restore();
  }

  private renderMenu(ctx: CanvasRenderingContext2D): void {
    // Decorative paddles
    this.renderPaddle(ctx, this.playerX, H / 2 - PADDLE_H / 2, COL_PLAYER);
    this.renderPaddle(ctx, this.aiX, H / 2 - PADDLE_H / 2, COL_AI);

    // Decorative ball in center
    ctx.save();
    ctx.shadowColor = COL_BALL;
    ctx.shadowBlur = 20;
    ctx.fillStyle = COL_BALL;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, BALL_R + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Title
    const pulse = 0.85 + Math.sin(this.menuPulse * 2.5) * 0.15;
    ctx.save();
    ctx.globalAlpha = pulse;
    this.drawGlowText(ctx, 'COSMIC RALLY', W / 2, H / 2 - 50, 30, COL_BALL, 16);
    ctx.restore();

    // Subtitle
    const blink = Math.sin(this.menuPulse * 3.5) > 0;
    if (blink) {
      this.drawGlowText(ctx, 'Press SPACE or START', W / 2, H / 2 + 20, 13, '#aaaacc', 4);
    }

    // Controls help box
    const boxW = 280;
    const boxH = 36;
    const boxX = W / 2 - boxW / 2;
    const boxY = H / 2 + 42;
    ctx.save();
    ctx.fillStyle = 'rgba(20,20,50,0.7)';
    ctx.strokeStyle = 'rgba(100,100,180,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    this.drawGlowText(ctx, 'W/S or D-Pad = Move Paddle', W / 2, boxY + 12, 10, '#99aabb', 0);
    this.drawGlowText(ctx, 'First to 11 wins', W / 2, boxY + 26, 10, '#99aabb', 0);
  }

  private drawGlowText(
    ctx: CanvasRenderingContext2D, text: string,
    x: number, y: number, size: number, color: string, blur: number,
  ): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${size}px monospace`;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}
