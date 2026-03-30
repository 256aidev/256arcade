import { audio } from '../../engine/Audio';
import { clamp, randInt } from '../../engine/Physics';
import { GameState, InputState, GameInfo, IGame } from '../../types/IGame';

// ── Constants ──────────────────────────────────────────────────────────
const W = 480;
const H = 320;
const COLS = 30;
const ROWS = 20;
const CELL = 16;
const PLAYER_SPEED = 180;
const BULLET_SPEED = 400;
const FIRE_COOLDOWN = 0.15;
const NODE_MAX_HP = 3;
const INITIAL_NODES = 30;
const SPIDER_SPAWN_INTERVAL = 8;
const SPIDER_SPEED = 120;
const ACCENT = '#8b5cf6';
const ACCENT_DARK = '#6d28d9';
const ACCENT_GLOW = '#a78bfa';
const CYAN = '#00ffff';
const MAGENTA = '#ff00ff';
const GREEN = '#00ff88';
const YELLOW = '#ffff00';
const RED = '#ff4466';

// Node colors by HP: 3=full, 2=damaged, 1=critical
const NODE_COLORS = ['', RED, YELLOW, GREEN];

// ── Interfaces ─────────────────────────────────────────────────────────
interface Segment {
  gx: number; gy: number;    // grid position
  x: number; y: number;      // pixel position (smoothed)
}

interface Virus {
  segments: Segment[];
  dir: number;               // 1=right, -1=left
  speed: number;             // cells per second
  moveTimer: number;
  headSegment: number;       // index of lead segment
}

interface Node {
  gx: number; gy: number;
  hp: number;
}

interface Bullet {
  x: number; y: number;
  active: boolean;
}

interface Spider {
  x: number; y: number;
  vx: number; vy: number;
  alive: boolean;
  bounceTimer: number;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number;
}

// ── Helpers ────────────────────────────────────────────────────────────
function gridToPixel(gx: number, gy: number): [number, number] {
  return [gx * CELL + CELL / 2, gy * CELL + CELL / 2];
}

function pixelToGrid(x: number, y: number): [number, number] {
  return [Math.floor(x / CELL), Math.floor(y / CELL)];
}

function nodeAt(nodes: Node[], gx: number, gy: number): Node | undefined {
  return nodes.find(n => n.gx === gx && n.gy === gy && n.hp > 0);
}

// ── Game ───────────────────────────────────────────────────────────────
export default class NeonSwarmGame implements IGame {
  info: GameInfo = {
    id: 'neon-swarm',
    name: 'Neon Swarm',
    description: 'Defend the data core from viruses',
    genre: 'Shooter',
    color: '#8b5cf6',
    controls: 'Left/Right to move, Space to shoot',
  };

  private state: GameState = 'menu';
  private width = W;
  private height = H;
  private scaleX = 1;
  private scaleY = 1;

  // Game objects
  private playerX = W / 2;
  private playerY = H - CELL * 2;
  private bullets: Bullet[] = [];
  private viruses: Virus[] = [];
  private nodes: Node[] = [];
  private spider: Spider | null = null;
  private particles: Particle[] = [];

  // State
  private score = 0;
  private lives = 3;
  private level = 1;
  private fireCooldown = 0;
  private spiderTimer = SPIDER_SPAWN_INTERVAL;
  private menuFlash = 0;
  private prevStart = false;
  private prevAction1 = false;
  private respawnTimer = 0;
  private levelCompleteTimer = 0;
  private hitFlash = 0;

  // Grid occupation cache (for quick lookup)
  private nodeGrid: (Node | null)[][] = [];

  async init(_canvas: HTMLCanvasElement): Promise<void> {
    this.state = 'menu';
    this.resetNodeGrid();
  }

  private resetNodeGrid(): void {
    this.nodeGrid = [];
    for (let y = 0; y < ROWS; y++) {
      this.nodeGrid[y] = [];
      for (let x = 0; x < COLS; x++) {
        this.nodeGrid[y][x] = null;
      }
    }
  }

  private syncNodeGrid(): void {
    this.resetNodeGrid();
    for (const n of this.nodes) {
      if (n.hp > 0 && n.gy >= 0 && n.gy < ROWS && n.gx >= 0 && n.gx < COLS) {
        this.nodeGrid[n.gy][n.gx] = n;
      }
    }
  }

  private startGame(): void {
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.playerX = W / 2;
    this.playerY = H - CELL * 2;
    this.bullets = [];
    this.viruses = [];
    this.particles = [];
    this.spider = null;
    this.spiderTimer = SPIDER_SPAWN_INTERVAL;
    this.respawnTimer = 0;
    this.levelCompleteTimer = 0;
    this.hitFlash = 0;
    this.spawnNodes(INITIAL_NODES);
    this.spawnVirus(10);
    this.state = 'playing';
  }

  private spawnNodes(count: number): void {
    this.nodes = [];
    this.resetNodeGrid();
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < 1000) {
      attempts++;
      const gx = randInt(0, COLS - 1);
      const gy = randInt(2, ROWS - 5); // rows 2-15, leave top for virus entry and bottom for player
      if (!this.nodeGrid[gy][gx]) {
        const node: Node = { gx, gy, hp: NODE_MAX_HP };
        this.nodes.push(node);
        this.nodeGrid[gy][gx] = node;
        placed++;
      }
    }
  }

  private spawnVirus(length: number): void {
    const segments: Segment[] = [];
    const startY = 0;
    const startX = randInt(2, COLS - 3);
    for (let i = 0; i < length; i++) {
      const gx = startX - i;
      const [px, py] = gridToPixel(gx, startY);
      segments.push({ gx, gy: startY, x: px, y: py });
    }
    const baseSpeed = 6 + this.level * 1.5;
    this.viruses.push({
      segments,
      dir: 1,
      speed: Math.min(baseSpeed, 20),
      moveTimer: 0,
      headSegment: 0,
    });
  }

  private nextLevel(): void {
    this.level++;
    this.levelCompleteTimer = 1.5;
    // Add extra nodes
    const extraNodes = 5 + this.level * 2;
    let placed = 0;
    let attempts = 0;
    this.syncNodeGrid();
    while (placed < extraNodes && attempts < 500) {
      attempts++;
      const gx = randInt(0, COLS - 1);
      const gy = randInt(2, ROWS - 5);
      if (!this.nodeGrid[gy][gx]) {
        const node: Node = { gx, gy, hp: NODE_MAX_HP };
        this.nodes.push(node);
        this.nodeGrid[gy][gx] = node;
        placed++;
      }
    }
    this.spawnVirus(10 + this.level);
    audio.powerup();
  }

  private spawnParticles(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 100;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.3 + Math.random() * 0.4,
        maxLife: 0.3 + Math.random() * 0.4,
        color,
        size: 1 + Math.random() * 3,
      });
    }
  }

  private spawnSpider(): void {
    const side = Math.random() < 0.5 ? 0 : W;
    const y = H - CELL * randInt(1, 4);
    this.spider = {
      x: side,
      y,
      vx: side === 0 ? SPIDER_SPEED : -SPIDER_SPEED,
      vy: (Math.random() < 0.5 ? 1 : -1) * SPIDER_SPEED * 0.7,
      alive: true,
      bounceTimer: 0,
    };
  }

  private playerHit(): void {
    this.lives--;
    this.hitFlash = 0.5;
    this.respawnTimer = 1.0;
    this.spawnParticles(this.playerX, this.playerY, CYAN, 20);
    audio.lose();
    if (this.lives <= 0) {
      this.state = 'gameover';
    }
  }

  // ── Update ──────────────────────────────────────────────────────────
  update(dt: number, input: InputState): void {
    this.menuFlash += dt;

    if (this.state === 'menu' || this.state === 'gameover') {
      const startPressed = input.action1 && !this.prevAction1;
      const enterPressed = input.start && !this.prevStart;
      if (startPressed || enterPressed) {
        this.startGame();
      }
      this.prevStart = input.start;
      this.prevAction1 = input.action1;
      return;
    }

    if (this.state === 'playing') {
      // Pause
      if (input.start && !this.prevStart) {
        this.state = 'paused';
        this.prevStart = input.start;
        return;
      }
    }

    if (this.state === 'paused') {
      if (input.start && !this.prevStart) {
        this.state = 'playing';
      }
      this.prevStart = input.start;
      return;
    }

    this.prevStart = input.start;
    this.prevAction1 = input.action1;

    // Level complete timer
    if (this.levelCompleteTimer > 0) {
      this.levelCompleteTimer -= dt;
      return;
    }

    // Respawn timer
    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.playerX = W / 2;
        this.playerY = H - CELL * 2;
      }
      this.updateParticles(dt);
      return;
    }

    // Hit flash
    if (this.hitFlash > 0) this.hitFlash -= dt;

    // ── Player movement ──
    const playerMinY = H - CELL * 4;
    const playerMaxY = H - CELL;
    if (input.left) this.playerX -= PLAYER_SPEED * dt;
    if (input.right) this.playerX += PLAYER_SPEED * dt;
    if (input.up) this.playerY -= PLAYER_SPEED * dt;
    if (input.down) this.playerY += PLAYER_SPEED * dt;
    this.playerX = clamp(this.playerX, CELL / 2, W - CELL / 2);
    this.playerY = clamp(this.playerY, playerMinY, playerMaxY);

    // ── Shooting ──
    this.fireCooldown -= dt;
    if (input.action1 && this.fireCooldown <= 0) {
      this.fireCooldown = FIRE_COOLDOWN;
      this.bullets.push({ x: this.playerX, y: this.playerY - 6, active: true });
      audio.playTone(900, 0.05, 'square');
    }

    // ── Update bullets ──
    for (const b of this.bullets) {
      if (!b.active) continue;
      b.y -= BULLET_SPEED * dt;
      if (b.y < -10) { b.active = false; continue; }

      // Check node collision
      const [bgx, bgy] = pixelToGrid(b.x, b.y);
      if (bgy >= 0 && bgy < ROWS && bgx >= 0 && bgx < COLS) {
        const node = this.nodeGrid[bgy]?.[bgx];
        if (node && node.hp > 0) {
          node.hp--;
          b.active = false;
          if (node.hp <= 0) {
            this.nodeGrid[bgy][bgx] = null;
            this.spawnParticles(b.x, b.y, NODE_COLORS[1], 6);
          } else {
            this.spawnParticles(b.x, b.y, NODE_COLORS[node.hp], 3);
          }
          audio.hit();
          continue;
        }
      }

      // Check virus segment collision
      for (let vi = 0; vi < this.viruses.length; vi++) {
        const virus = this.viruses[vi];
        for (let si = virus.segments.length - 1; si >= 0; si--) {
          const seg = virus.segments[si];
          const dx = b.x - seg.x;
          const dy = b.y - seg.y;
          if (dx * dx + dy * dy < (CELL * 0.8) * (CELL * 0.8)) {
            b.active = false;
            this.score += 10;

            // Spawn a node where the segment died
            const [sgx, sgy] = [seg.gx, seg.gy];
            if (sgy >= 0 && sgy < ROWS && sgx >= 0 && sgx < COLS && !this.nodeGrid[sgy]?.[sgx]) {
              const node: Node = { gx: sgx, gy: sgy, hp: NODE_MAX_HP };
              this.nodes.push(node);
              if (this.nodeGrid[sgy]) this.nodeGrid[sgy][sgx] = node;
            }

            this.spawnParticles(seg.x, seg.y, ACCENT_GLOW, 8);
            audio.playTone(600, 0.08, 'square');

            // Split virus
            if (virus.segments.length === 1) {
              // Last segment
              this.viruses.splice(vi, 1);
              vi--;
            } else if (si === 0) {
              // Head removed
              virus.segments.shift();
            } else if (si === virus.segments.length - 1) {
              // Tail removed
              virus.segments.pop();
            } else {
              // Middle segment: split into two
              const tailSegs = virus.segments.splice(si);
              tailSegs.shift(); // remove hit segment
              if (tailSegs.length > 0) {
                this.viruses.push({
                  segments: tailSegs,
                  dir: -virus.dir,
                  speed: virus.speed,
                  moveTimer: 0,
                  headSegment: 0,
                });
              }
            }
            break;
          }
        }
        if (!b.active) break;
      }

      // Check spider collision
      if (this.spider && this.spider.alive && b.active) {
        const dx = b.x - this.spider.x;
        const dy = b.y - this.spider.y;
        if (dx * dx + dy * dy < CELL * CELL) {
          b.active = false;
          const dist = Math.abs(this.playerY - this.spider.y);
          const points = dist < CELL * 2 ? 900 : dist < CELL * 4 ? 600 : 300;
          this.score += points;
          this.spawnParticles(this.spider.x, this.spider.y, MAGENTA, 12);
          audio.score();
          this.spider.alive = false;
          this.spider = null;
        }
      }
    }
    this.bullets = this.bullets.filter(b => b.active);

    // ── Update viruses ──
    this.syncNodeGrid();
    for (const virus of this.viruses) {
      virus.moveTimer += dt;
      const moveInterval = 1 / virus.speed;
      while (virus.moveTimer >= moveInterval) {
        virus.moveTimer -= moveInterval;
        this.moveVirus(virus);
      }
      // Smooth pixel positions
      for (const seg of virus.segments) {
        const [tx, ty] = gridToPixel(seg.gx, seg.gy);
        seg.x += (tx - seg.x) * 0.3;
        seg.y += (ty - seg.y) * 0.3;
      }
    }

    // Check virus-player collision
    if (this.respawnTimer <= 0) {
      for (const virus of this.viruses) {
        for (const seg of virus.segments) {
          const dx = this.playerX - seg.x;
          const dy = this.playerY - seg.y;
          if (dx * dx + dy * dy < (CELL * 0.7) * (CELL * 0.7)) {
            this.playerHit();
            break;
          }
        }
        if (this.respawnTimer > 0) break;
      }
    }

    // Check if all viruses destroyed
    if (this.viruses.length === 0 && this.levelCompleteTimer <= 0) {
      this.nextLevel();
    }

    // ── Spider ──
    this.spiderTimer -= dt;
    if (this.spiderTimer <= 0 && !this.spider) {
      this.spawnSpider();
      this.spiderTimer = SPIDER_SPAWN_INTERVAL + Math.random() * 4;
    }

    if (this.spider && this.spider.alive) {
      this.spider.x += this.spider.vx * dt;
      this.spider.y += this.spider.vy * dt;
      this.spider.bounceTimer += dt;

      // Bounce in player area
      const spMinY = H - CELL * 5;
      const spMaxY = H - CELL * 0.5;
      if (this.spider.y < spMinY || this.spider.y > spMaxY) {
        this.spider.vy *= -1;
        this.spider.y = clamp(this.spider.y, spMinY, spMaxY);
      }

      // Random direction changes
      if (this.spider.bounceTimer > 0.5) {
        this.spider.bounceTimer = 0;
        this.spider.vy = (Math.random() < 0.5 ? 1 : -1) * SPIDER_SPEED * (0.5 + Math.random() * 0.5);
      }

      // Remove if off screen
      if (this.spider.x < -CELL * 2 || this.spider.x > W + CELL * 2) {
        this.spider = null;
      }

      // Spider-player collision
      if (this.spider && this.respawnTimer <= 0) {
        const dx = this.playerX - this.spider.x;
        const dy = this.playerY - this.spider.y;
        if (dx * dx + dy * dy < (CELL * 0.7) * (CELL * 0.7)) {
          this.playerHit();
        }
      }
    }

    // ── Particles ──
    this.updateParticles(dt);
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);
  }

  private moveVirus(virus: Virus): void {
    if (virus.segments.length === 0) return;

    const head = virus.segments[0];
    let nextX = head.gx + virus.dir;
    let nextY = head.gy;
    let dropped = false;

    // Check if need to drop down
    const hitEdge = nextX < 0 || nextX >= COLS;
    const hitNode = !hitEdge && nextY >= 0 && nextY < ROWS &&
      this.nodeGrid[nextY]?.[nextX] !== null && this.nodeGrid[nextY]?.[nextX] !== undefined;

    if (hitEdge || hitNode) {
      // Drop down one row, reverse direction
      nextY = head.gy + 1;
      nextX = head.gx;
      virus.dir *= -1;
      dropped = true;

      // If at bottom, reset to top
      if (nextY >= ROWS) {
        nextY = 0;
        nextX = virus.dir === 1 ? 0 : COLS - 1;
      }
    }

    // Move each segment to position of the one in front
    for (let i = virus.segments.length - 1; i > 0; i--) {
      virus.segments[i].gx = virus.segments[i - 1].gx;
      virus.segments[i].gy = virus.segments[i - 1].gy;
    }

    head.gx = nextX;
    head.gy = nextY;
  }

  // ── Render ──────────────────────────────────────────────────────────
  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.scale(this.scaleX, this.scaleY);

    // Background
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, W, H);

    // Subtle grid
    ctx.strokeStyle = 'rgba(139,92,246,0.06)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= W; x += CELL) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += CELL) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    if (this.state === 'menu') {
      this.renderMenu(ctx);
      ctx.restore();
      return;
    }

    if (this.state === 'gameover') {
      this.renderGameplay(ctx);
      this.renderGameOver(ctx);
      ctx.restore();
      return;
    }

    this.renderGameplay(ctx);

    if (this.state === 'paused') {
      this.renderPause(ctx);
    }

    if (this.levelCompleteTimer > 0) {
      const alpha = Math.min(1, this.levelCompleteTimer * 2);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = ACCENT;
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.shadowColor = ACCENT;
      ctx.shadowBlur = 20;
      ctx.fillText(`LEVEL ${this.level}`, W / 2, H / 2);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  private renderMenu(ctx: CanvasRenderingContext2D): void {
    // Title
    const pulse = 0.7 + 0.3 * Math.sin(this.menuFlash * 3);
    ctx.save();
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 30 * pulse;
    ctx.fillStyle = ACCENT;
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('NEON SWARM', W / 2, H / 2 - 40);
    ctx.shadowBlur = 0;
    ctx.restore();

    // Subtitle
    ctx.fillStyle = CYAN;
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DEFEND THE DATA CORE', W / 2, H / 2 - 10);

    // Blink prompt
    if (Math.floor(this.menuFlash * 2) % 2 === 0) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px monospace';
      ctx.fillText('PRESS SPACE TO START', W / 2, H / 2 + 30);
    }

    // Controls
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '10px monospace';
    ctx.fillText('ARROWS: MOVE  |  SPACE: SHOOT  |  ENTER: PAUSE', W / 2, H / 2 + 60);

    // Decorative virus preview
    const vx = W / 2 - 5 * CELL;
    const vy = H / 2 + 90;
    for (let i = 0; i < 10; i++) {
      const segX = vx + i * CELL;
      const wobble = Math.sin(this.menuFlash * 4 + i * 0.5) * 2;
      this.drawSegment(ctx, segX, vy + wobble, i === 0, pulse);
    }
  }

  private renderGameplay(ctx: CanvasRenderingContext2D): void {
    // Player zone indicator
    ctx.fillStyle = 'rgba(139,92,246,0.03)';
    ctx.fillRect(0, H - CELL * 4, W, CELL * 4);

    // Nodes
    for (const node of this.nodes) {
      if (node.hp <= 0) continue;
      const [nx, ny] = gridToPixel(node.gx, node.gy);
      const color = NODE_COLORS[node.hp];
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.fillStyle = color;

      // Diamond shape
      const s = CELL * 0.35;
      ctx.beginPath();
      ctx.moveTo(nx, ny - s);
      ctx.lineTo(nx + s, ny);
      ctx.lineTo(nx, ny + s);
      ctx.lineTo(nx - s, ny);
      ctx.closePath();
      ctx.fill();

      // Inner glow for healthy nodes
      if (node.hp === 3) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        const si = s * 0.4;
        ctx.beginPath();
        ctx.moveTo(nx, ny - si);
        ctx.lineTo(nx + si, ny);
        ctx.lineTo(nx, ny + si);
        ctx.lineTo(nx - si, ny);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // Bullets
    for (const b of this.bullets) {
      ctx.save();
      ctx.shadowColor = CYAN;
      ctx.shadowBlur = 8;
      ctx.fillStyle = CYAN;
      ctx.fillRect(b.x - 1, b.y - 4, 2, 8);
      ctx.restore();
    }

    // Viruses
    for (const virus of this.viruses) {
      for (let i = virus.segments.length - 1; i >= 0; i--) {
        const seg = virus.segments[i];
        this.drawSegment(ctx, seg.x, seg.y, i === 0, 1);
      }
    }

    // Spider
    if (this.spider && this.spider.alive) {
      this.drawSpider(ctx, this.spider.x, this.spider.y);
    }

    // Player
    if (this.respawnTimer <= 0 || Math.floor(this.respawnTimer * 8) % 2 === 0) {
      this.drawPlayer(ctx, this.playerX, this.playerY);
    }

    // Particles
    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // HUD
    this.renderHUD(ctx);
  }

  private drawSegment(ctx: CanvasRenderingContext2D, x: number, y: number, isHead: boolean, alpha: number): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    const r = CELL * 0.4;

    if (isHead) {
      // Head: brighter, with eyes
      ctx.shadowColor = ACCENT;
      ctx.shadowBlur = 12;
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      // Eyes
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x - 3, y - 2, 2, 0, Math.PI * 2);
      ctx.arc(x + 3, y - 2, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(x - 3, y - 2, 1, 0, Math.PI * 2);
      ctx.arc(x + 3, y - 2, 1, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Body segment
      ctx.shadowColor = ACCENT_DARK;
      ctx.shadowBlur = 6;
      ctx.fillStyle = ACCENT_DARK;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
      ctx.fill();

      // Ring
      ctx.shadowBlur = 0;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();
    const flash = this.hitFlash > 0 && Math.floor(this.hitFlash * 16) % 2 === 0;
    const color = flash ? '#fff' : CYAN;

    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;

    // Scanner ship shape
    ctx.beginPath();
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x + 6, y + 5);
    ctx.lineTo(x + 3, y + 3);
    ctx.lineTo(x, y + 7);
    ctx.lineTo(x - 3, y + 3);
    ctx.lineTo(x - 6, y + 5);
    ctx.closePath();
    ctx.fill();

    // Center glow
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawSpider(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();
    ctx.shadowColor = MAGENTA;
    ctx.shadowBlur = 10;
    ctx.fillStyle = MAGENTA;

    // Body
    ctx.beginPath();
    ctx.arc(x, y, CELL * 0.35, 0, Math.PI * 2);
    ctx.fill();

    // Legs (4 pairs)
    ctx.strokeStyle = MAGENTA;
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 4;
    const t = Date.now() * 0.01;
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI - Math.PI / 2;
      const legWiggle = Math.sin(t + i * 2) * 3;
      // Left leg
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 8 - legWiggle, y + Math.sin(angle) * 6 + legWiggle);
      ctx.stroke();
      // Right leg
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 8 + legWiggle, y + Math.sin(angle) * 6 - legWiggle);
      ctx.stroke();
    }

    // Eyes
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x - 2, y - 2, 1.5, 0, Math.PI * 2);
    ctx.arc(x + 2, y - 2, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private renderHUD(ctx: CanvasRenderingContext2D): void {
    // Score
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`SCORE: ${this.score}`, 8, 14);

    // Level
    ctx.textAlign = 'center';
    ctx.fillStyle = ACCENT_GLOW;
    ctx.fillText(`LEVEL ${this.level}`, W / 2, 14);

    // Lives
    ctx.textAlign = 'right';
    ctx.fillStyle = CYAN;
    let livesStr = '';
    for (let i = 0; i < this.lives; i++) livesStr += '\u25C6 ';
    ctx.fillText(livesStr.trim(), W - 8, 14);
  }

  private renderGameOver(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.shadowColor = RED;
    ctx.shadowBlur = 20;
    ctx.fillStyle = RED;
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SYSTEM BREACH', W / 2, H / 2 - 30);
    ctx.shadowBlur = 0;
    ctx.restore();

    ctx.fillStyle = '#fff';
    ctx.font = '16px monospace';
    ctx.fillText(`FINAL SCORE: ${this.score}`, W / 2, H / 2 + 5);
    ctx.fillText(`LEVEL: ${this.level}`, W / 2, H / 2 + 25);

    if (Math.floor(this.menuFlash * 2) % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '12px monospace';
      ctx.fillText('PRESS SPACE TO RESTART', W / 2, H / 2 + 55);
    }
  }

  private renderPause(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 15;
    ctx.fillStyle = ACCENT;
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', W / 2, H / 2);
    ctx.shadowBlur = 0;
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '12px monospace';
    ctx.fillText('PRESS ENTER TO RESUME', W / 2, H / 2 + 25);
  }

  resize(width: number, height: number): void {
    this.scaleX = width / W;
    this.scaleY = height / H;
  }

  getScore(): number { return this.score; }
  getState(): GameState { return this.state; }

  destroy(): void {
    this.bullets = [];
    this.viruses = [];
    this.nodes = [];
    this.particles = [];
    this.spider = null;
  }
}
