import { audio } from '../../engine/Audio';
import { clamp, randInt, randFloat, rectsOverlap, Rect } from '../../engine/Physics';
import { GameState, InputState, GameInfo, IGame } from '../../types/IGame';

// ── Constants ──────────────────────────────────────────────────────────
const W = 480;
const H = 320;
const WORLD_W = 2400;
const GROUND_Y = H - 20;
const SCANNER_H = 20;
const PLAYER_SPEED = 180;
const BULLET_SPEED = 400;
const FIRE_COOLDOWN = 0.1;
const SMART_BOMBS_PER_LIFE = 3;
const INITIAL_LIVES = 3;
const COLONIST_COUNT = 10;
const ACCENT = '#3b82f6';
const ACCENT_DIM = '#1d4ed8';

// Score values
const SCORE_LANDER = 150;
const SCORE_BOMBER = 250;
const SCORE_POD = 1000;
const SCORE_SWARMER = 150;
const SCORE_MUTANT = 150;
const SCORE_SAVE_COLONIST = 500;

// ── Types ──────────────────────────────────────────────────────────────
type EnemyType = 'lander' | 'bomber' | 'pod' | 'swarmer' | 'mutant';
type Direction = -1 | 1;

interface Star { x: number; y: number; speed: number; brightness: number; }

interface Player {
  x: number; y: number; facing: Direction;
  invulnTimer: number;
}

interface Bullet { x: number; y: number; vx: number; life: number; }

interface Colonist {
  x: number; y: number;
  alive: boolean;
  grabbed: boolean;
  falling: boolean;
  vy: number;
  carriedBy: number; // enemy index or -1
}

interface Enemy {
  type: EnemyType;
  x: number; y: number;
  vx: number; vy: number;
  alive: boolean;
  targetColonist: number; // index or -1
  carryingColonist: number; // index or -1
  timer: number;
  mineTimer: number;
}

interface Mine { x: number; y: number; life: number; }

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; color: string;
}

// ── Helper ─────────────────────────────────────────────────────────────
function wrapX(x: number): number {
  return ((x % WORLD_W) + WORLD_W) % WORLD_W;
}

function worldDistX(a: number, b: number): number {
  let d = b - a;
  if (d > WORLD_W / 2) d -= WORLD_W;
  if (d < -WORLD_W / 2) d += WORLD_W;
  return d;
}

function toScreen(worldX: number, cameraX: number): number {
  let dx = worldX - cameraX;
  if (dx > WORLD_W / 2) dx -= WORLD_W;
  if (dx < -WORLD_W / 2) dx += WORLD_W;
  return dx + W / 2;
}

// ── Game ───────────────────────────────────────────────────────────────
export default class VoidPatrolGame implements IGame {
  info: GameInfo = {
    id: 'void-patrol',
    name: 'Void Patrol',
    description: 'Defend colonists across the asteroid belt',
    genre: 'Shooter',
    color: ACCENT,
    controls: 'Arrows to fly, Space to shoot, X for smart bomb',
  };

  private state: GameState = 'menu';
  private score = 0;
  private lives = INITIAL_LIVES;
  private smartBombs = SMART_BOMBS_PER_LIFE;
  private wave = 0;
  private waveTimer = 0;
  private menuTimer = 0;
  private startDebounce = false;
  private action2Debounce = false;
  private waveClearTimer = 0;   // 2s pause between waves
  private deathPauseTimer = 0;  // 1.5s pause on death before respawn

  private player!: Player;
  private bullets: Bullet[] = [];
  private enemies: Enemy[] = [];
  private colonists: Colonist[] = [];
  private mines: Mine[] = [];
  private particles: Particle[] = [];
  private fireCooldown = 0;
  private cameraX = 0;

  // Star layers for parallax
  private starsBack: Star[] = [];
  private starsMid: Star[] = [];
  private starsFront: Star[] = [];

  private canvas!: HTMLCanvasElement;
  private screenW = W;
  private screenH = H;

  // ── Interface ────────────────────────────────────────────────────────
  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    this.generateStars();
    this.state = 'menu';
    this.menuTimer = 0;
  }

  getScore(): number { return this.score; }
  getState(): GameState { return this.state; }

  resize(width: number, height: number): void {
    this.screenW = width;
    this.screenH = height;
  }

  destroy(): void { /* nothing to clean up */ }

  // ── Stars ────────────────────────────────────────────────────────────
  private generateStars(): void {
    this.starsBack = [];
    this.starsMid = [];
    this.starsFront = [];
    for (let i = 0; i < 60; i++) this.starsBack.push({ x: Math.random() * WORLD_W, y: Math.random() * H, speed: 0.1, brightness: randFloat(0.2, 0.4) });
    for (let i = 0; i < 40; i++) this.starsMid.push({ x: Math.random() * WORLD_W, y: Math.random() * H, speed: 0.3, brightness: randFloat(0.4, 0.7) });
    for (let i = 0; i < 20; i++) this.starsFront.push({ x: Math.random() * WORLD_W, y: Math.random() * H, speed: 0.6, brightness: randFloat(0.7, 1.0) });
  }

  // ── Reset / Start ───────────────────────────────────────────────────
  private startGame(): void {
    this.score = 0;
    this.lives = INITIAL_LIVES;
    this.smartBombs = SMART_BOMBS_PER_LIFE;
    this.wave = 0;
    this.bullets = [];
    this.enemies = [];
    this.mines = [];
    this.particles = [];
    this.fireCooldown = 0;
    this.waveClearTimer = 0;
    this.deathPauseTimer = 0;

    this.player = { x: WORLD_W / 2, y: H / 2, facing: 1, invulnTimer: 2 };
    this.cameraX = this.player.x;

    // Place colonists along the ground
    this.colonists = [];
    for (let i = 0; i < COLONIST_COUNT; i++) {
      this.colonists.push({
        x: (WORLD_W / COLONIST_COUNT) * i + randInt(20, 100),
        y: GROUND_Y - 8,
        alive: true,
        grabbed: false,
        falling: false,
        vy: 0,
        carriedBy: -1,
      });
    }

    this.state = 'playing';
    this.nextWave();
  }

  private nextWave(): void {
    this.wave++;
    this.waveTimer = 2;
    const base = 3 + this.wave * 2;
    const landerCount = Math.min(base, 15);
    const bomberCount = Math.min(Math.floor(this.wave / 2), 6);
    const podCount = Math.min(Math.floor((this.wave - 1) / 3), 4);

    for (let i = 0; i < landerCount; i++) this.spawnEnemy('lander');
    for (let i = 0; i < bomberCount; i++) this.spawnEnemy('bomber');
    for (let i = 0; i < podCount; i++) this.spawnEnemy('pod');
  }

  private spawnEnemy(type: EnemyType): void {
    const px = this.player.x;
    // Spawn away from player
    const offset = randFloat(W * 0.6, WORLD_W / 2) * (Math.random() < 0.5 ? 1 : -1);
    const x = wrapX(px + offset);
    let y: number, vx: number, vy: number;

    switch (type) {
      case 'lander':
        y = randFloat(30, 80);
        vx = randFloat(-30, 30);
        vy = randFloat(10, 30);
        break;
      case 'bomber':
        y = randFloat(40, 120);
        vx = (Math.random() < 0.5 ? 1 : -1) * randFloat(60, 120);
        vy = 0;
        break;
      case 'pod':
        y = randFloat(40, 100);
        vx = randFloat(-40, 40);
        vy = randFloat(-20, 20);
        break;
      case 'swarmer':
        y = randFloat(40, 200);
        vx = randFloat(-100, 100);
        vy = randFloat(-80, 80);
        break;
      case 'mutant':
        y = randFloat(30, 150);
        vx = (Math.random() < 0.5 ? 1 : -1) * randFloat(100, 180);
        vy = randFloat(-60, 60);
        break;
      default:
        y = 60; vx = 0; vy = 0;
    }

    this.enemies.push({
      type, x, y, vx, vy,
      alive: true,
      targetColonist: -1,
      carryingColonist: -1,
      timer: 0,
      mineTimer: randFloat(1, 3),
    });
  }

  // ── Particles ────────────────────────────────────────────────────────
  private explode(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = randFloat(30, 150);
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: randFloat(0.3, 0.8),
        maxLife: 0.8,
        color,
      });
    }
  }

  // ── Update ──────────────────────────────────────────────────────────
  update(dt: number, input: InputState): void {
    dt = Math.min(dt, 0.05); // Cap delta

    if (this.state === 'menu') {
      this.menuTimer += dt;
      if (input.start || input.action1) {
        if (!this.startDebounce) {
          this.startDebounce = true;
          this.startGame();
        }
      } else {
        this.startDebounce = false;
      }
      return;
    }

    if (this.state === 'gameover') {
      this.menuTimer += dt;
      if ((input.start || input.action1) && this.menuTimer > 1) {
        if (!this.startDebounce) {
          this.startDebounce = true;
          this.state = 'menu';
          this.menuTimer = 0;
        }
      } else if (!input.start && !input.action1) {
        this.startDebounce = false;
      }
      // Still update particles
      this.updateParticles(dt);
      return;
    }

    if (this.state === 'paused') {
      if (input.start) {
        if (!this.startDebounce) { this.startDebounce = true; this.state = 'playing'; }
      } else { this.startDebounce = false; }
      return;
    }

    // Playing
    if (input.start) {
      if (!this.startDebounce) { this.startDebounce = true; this.state = 'paused'; return; }
    } else { this.startDebounce = false; }

    this.waveTimer = Math.max(0, this.waveTimer - dt);

    // Death pause: count down before respawn, only update particles
    if (this.deathPauseTimer > 0) {
      this.deathPauseTimer -= dt;
      this.updateParticles(dt);
      if (this.deathPauseTimer <= 0) {
        this.deathPauseTimer = 0;
        this.player.invulnTimer = 2;
        this.player.y = H / 2;
        this.smartBombs = SMART_BOMBS_PER_LIFE;
      }
      return;
    }

    // Wave-clear pause: count down then spawn next wave
    if (this.waveClearTimer > 0) {
      this.waveClearTimer -= dt;
      this.updateParticles(dt);
      if (this.waveClearTimer <= 0) {
        this.waveClearTimer = 0;
        this.nextWave();
      }
      return;
    }

    this.updatePlayer(dt, input);
    this.updateBullets(dt);
    this.updateEnemies(dt);
    this.updateMines(dt);
    this.updateColonists(dt);
    this.updateParticles(dt);
    this.checkCollisions();

    // Check wave complete — start 2-second cleared pause
    if (this.enemies.filter(e => e.alive).length === 0 && this.mines.length === 0) {
      this.waveClearTimer = 2;
    }
  }

  private updatePlayer(dt: number, input: InputState): void {
    const p = this.player;
    p.invulnTimer = Math.max(0, p.invulnTimer - dt);

    let dx = 0, dy = 0;
    if (input.left) { dx = -1; p.facing = -1; }
    if (input.right) { dx = 1; p.facing = 1; }
    if (input.up) dy = -1;
    if (input.down) dy = 1;

    // Normalize diagonal
    if (dx !== 0 && dy !== 0) {
      dx *= 0.707;
      dy *= 0.707;
    }

    p.x = wrapX(p.x + dx * PLAYER_SPEED * dt);
    p.y = clamp(p.y + dy * PLAYER_SPEED * dt, SCANNER_H + 10, GROUND_Y - 12);

    // Camera follows smoothly
    const camDist = worldDistX(this.cameraX, p.x);
    this.cameraX = wrapX(this.cameraX + camDist * 5 * dt);

    // Shooting
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (input.action1 && this.fireCooldown <= 0) {
      this.fireCooldown = FIRE_COOLDOWN;
      this.bullets.push({
        x: p.x + p.facing * 12,
        y: p.y,
        vx: BULLET_SPEED * p.facing,
        life: 1.2,
      });
      audio.playTone(880, 0.05, 'square');
    }

    // Smart bomb
    if (input.action2) {
      if (!this.action2Debounce && this.smartBombs > 0) {
        this.action2Debounce = true;
        this.smartBombs--;
        this.detonateSmartBomb();
      }
    } else {
      this.action2Debounce = false;
    }
  }

  private detonateSmartBomb(): void {
    audio.explosion();
    audio.playTone(200, 0.4, 'sawtooth');

    // Kill all on-screen enemies
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const sx = toScreen(e.x, this.cameraX);
      if (sx >= -20 && sx <= W + 20) {
        this.killEnemy(e);
      }
    }
    // Destroy on-screen mines
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const sx = toScreen(this.mines[i].x, this.cameraX);
      if (sx >= -20 && sx <= W + 20) {
        this.explode(this.mines[i].x, this.mines[i].y, '#ff0', 5);
        this.mines.splice(i, 1);
      }
    }

    // Big screen flash via particles
    for (let i = 0; i < 30; i++) {
      this.particles.push({
        x: this.player.x + randFloat(-W / 2, W / 2),
        y: randFloat(SCANNER_H, GROUND_Y),
        vx: 0, vy: 0,
        life: 0.5, maxLife: 0.5,
        color: '#fff',
      });
    }
  }

  private killEnemy(e: Enemy): void {
    e.alive = false;
    let color: string;
    let scoreVal: number;

    switch (e.type) {
      case 'lander': scoreVal = SCORE_LANDER; color = '#0f0'; break;
      case 'bomber': scoreVal = SCORE_BOMBER; color = '#f80'; break;
      case 'pod': scoreVal = SCORE_POD; color = '#f0f'; break;
      case 'swarmer': scoreVal = SCORE_SWARMER; color = '#ff0'; break;
      case 'mutant': scoreVal = SCORE_MUTANT; color = '#f00'; break;
      default: scoreVal = 100; color = '#fff';
    }

    this.score += scoreVal;
    this.explode(e.x, e.y, color, 12);
    audio.hit();

    // Pod splits into swarmers
    if (e.type === 'pod') {
      for (let i = 0; i < 5; i++) {
        const s: Enemy = {
          type: 'swarmer',
          x: e.x + randFloat(-10, 10),
          y: e.y + randFloat(-10, 10),
          vx: randFloat(-120, 120),
          vy: randFloat(-100, 100),
          alive: true,
          targetColonist: -1,
          carryingColonist: -1,
          timer: 0,
          mineTimer: 0,
        };
        this.enemies.push(s);
      }
    }

    // Release colonist if carrying
    if (e.carryingColonist >= 0) {
      const c = this.colonists[e.carryingColonist];
      if (c && c.alive) {
        c.grabbed = false;
        c.falling = true;
        c.vy = 0;
        c.carriedBy = -1;
      }
      e.carryingColonist = -1;
    }
  }

  private updateBullets(dt: number): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x = wrapX(b.x + b.vx * dt);
      b.life -= dt;
      if (b.life <= 0) this.bullets.splice(i, 1);
    }
  }

  private updateEnemies(dt: number): void {
    const allColonistsDead = this.colonists.every(c => !c.alive);

    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.timer += dt;

      // If all colonists dead, convert to mutant
      if (allColonistsDead && e.type === 'lander') {
        e.type = 'mutant';
        e.vx = (Math.random() < 0.5 ? 1 : -1) * randFloat(100, 180);
        e.vy = randFloat(-60, 60);
      }

      switch (e.type) {
        case 'lander':
          this.updateLander(e, dt);
          break;
        case 'bomber':
          this.updateBomber(e, dt);
          break;
        case 'pod':
          this.updatePod(e, dt);
          break;
        case 'swarmer':
          this.updateSwarmer(e, dt);
          break;
        case 'mutant':
          this.updateMutant(e, dt);
          break;
      }

      e.x = wrapX(e.x + e.vx * dt);
      e.y = clamp(e.y + e.vy * dt, SCANNER_H + 5, GROUND_Y - 5);
    }

    // Remove dead enemies
    this.enemies = this.enemies.filter(e => e.alive);
  }

  private updateLander(e: Enemy, dt: number): void {
    if (e.carryingColonist >= 0) {
      // Flying up with colonist
      e.vy = -60;
      e.vx *= 0.98;
      // If reached top, become mutant
      if (e.y <= SCANNER_H + 10) {
        const c = this.colonists[e.carryingColonist];
        if (c) { c.alive = false; c.grabbed = false; }
        e.carryingColonist = -1;
        e.type = 'mutant';
        e.vx = (Math.random() < 0.5 ? 1 : -1) * randFloat(100, 180);
        e.vy = randFloat(-60, 60);
      }
      return;
    }

    // Find a target colonist
    if (e.targetColonist < 0 || !this.colonists[e.targetColonist]?.alive || this.colonists[e.targetColonist]?.grabbed) {
      const available = this.colonists
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.alive && !c.grabbed);
      if (available.length > 0) {
        const pick = available[randInt(0, available.length - 1)];
        e.targetColonist = pick.i;
      } else {
        // No colonists, wander
        e.vy += randFloat(-50, 50) * dt;
        e.vx += randFloat(-30, 30) * dt;
        return;
      }
    }

    const target = this.colonists[e.targetColonist];
    if (!target) return;

    // Move toward target
    const distX = worldDistX(e.x, target.x);
    e.vx += Math.sign(distX) * 80 * dt;
    e.vx = clamp(e.vx, -80, 80);

    if (Math.abs(distX) < 30) {
      // Descend toward colonist
      e.vy = 40;
    } else {
      e.vy = clamp(e.vy + randFloat(-20, 20) * dt, -30, 30);
    }

    // Grab check
    if (Math.abs(distX) < 12 && Math.abs(e.y - target.y) < 12 && target.alive && !target.grabbed) {
      target.grabbed = true;
      target.carriedBy = this.enemies.indexOf(e);
      e.carryingColonist = this.colonists.indexOf(target);
    }
  }

  private updateBomber(e: Enemy, dt: number): void {
    // Fly across, drop mines
    e.vy += randFloat(-30, 30) * dt;
    e.vy = clamp(e.vy, -40, 40);

    e.mineTimer -= dt;
    if (e.mineTimer <= 0) {
      e.mineTimer = randFloat(1.5, 3);
      this.mines.push({ x: e.x, y: e.y + 8, life: 8 });
    }
  }

  private updatePod(e: Enemy, _dt: number): void {
    // Drift slowly
    e.vx += randFloat(-10, 10);
    e.vy += randFloat(-10, 10);
    e.vx = clamp(e.vx, -50, 50);
    e.vy = clamp(e.vy, -30, 30);
  }

  private updateSwarmer(e: Enemy, dt: number): void {
    // Aggressively chase player
    const distX = worldDistX(e.x, this.player.x);
    const distY = this.player.y - e.y;
    e.vx += Math.sign(distX) * 200 * dt;
    e.vy += Math.sign(distY) * 200 * dt;
    e.vx = clamp(e.vx, -150, 150);
    e.vy = clamp(e.vy, -150, 150);
  }

  private updateMutant(e: Enemy, dt: number): void {
    // Very aggressive chase
    const distX = worldDistX(e.x, this.player.x);
    const distY = this.player.y - e.y;
    e.vx += Math.sign(distX) * 300 * dt;
    e.vy += Math.sign(distY) * 300 * dt;
    e.vx = clamp(e.vx, -200, 200);
    e.vy = clamp(e.vy, -200, 200);
  }

  private updateMines(dt: number): void {
    for (let i = this.mines.length - 1; i >= 0; i--) {
      this.mines[i].life -= dt;
      if (this.mines[i].life <= 0) {
        this.mines.splice(i, 1);
      }
    }
  }

  private updateColonists(dt: number): void {
    for (const c of this.colonists) {
      if (!c.alive) continue;

      if (c.grabbed && c.carriedBy >= 0) {
        // Follow the enemy carrying us
        const carrier = this.enemies[c.carriedBy];
        if (carrier && carrier.alive) {
          c.x = carrier.x;
          c.y = carrier.y + 10;
        } else {
          c.grabbed = false;
          c.falling = true;
          c.vy = 0;
          c.carriedBy = -1;
        }
      }

      if (c.falling) {
        c.vy += 200 * dt; // gravity
        c.y += c.vy * dt;
        if (c.y >= GROUND_Y - 8) {
          // Landed safely if caught or fell from low height
          c.y = GROUND_Y - 8;
          c.falling = false;
          c.vy = 0;
          // If fell from high up, colonist dies
          if (c.vy > 200) {
            c.alive = false;
            this.explode(c.x, c.y, '#0ff', 6);
          }
        }
      }
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

  // ── Collisions ──────────────────────────────────────────────────────
  private checkCollisions(): void {
    const p = this.player;

    // Bullet vs Enemy
    for (let bi = this.bullets.length - 1; bi >= 0; bi--) {
      const b = this.bullets[bi];
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const dist = Math.abs(worldDistX(b.x, e.x));
        if (dist < 12 && Math.abs(b.y - e.y) < 12) {
          this.killEnemy(e);
          this.bullets.splice(bi, 1);
          break;
        }
      }
    }

    // Bullet vs Mine
    for (let bi = this.bullets.length - 1; bi >= 0; bi--) {
      const b = this.bullets[bi];
      for (let mi = this.mines.length - 1; mi >= 0; mi--) {
        const m = this.mines[mi];
        const dist = Math.abs(worldDistX(b.x, m.x));
        if (dist < 8 && Math.abs(b.y - m.y) < 8) {
          this.explode(m.x, m.y, '#ff0', 6);
          this.mines.splice(mi, 1);
          this.bullets.splice(bi, 1);
          audio.hit();
          break;
        }
      }
    }

    if (p.invulnTimer > 0) return;

    // Player vs Enemy
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dist = Math.abs(worldDistX(p.x, e.x));
      if (dist < 14 && Math.abs(p.y - e.y) < 14) {
        this.playerDeath();
        return;
      }
    }

    // Player vs Mine
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      const dist = Math.abs(worldDistX(p.x, m.x));
      if (dist < 10 && Math.abs(p.y - m.y) < 10) {
        this.explode(m.x, m.y, '#ff0', 8);
        this.mines.splice(i, 1);
        this.playerDeath();
        return;
      }
    }

    // Player catches falling colonist
    for (const c of this.colonists) {
      if (!c.alive || !c.falling) continue;
      const dist = Math.abs(worldDistX(p.x, c.x));
      if (dist < 16 && Math.abs(p.y - c.y) < 16) {
        c.falling = false;
        // Gently carry colonist down
        c.y = GROUND_Y - 8;
        c.vy = 0;
        this.score += SCORE_SAVE_COLONIST;
        audio.powerup();
        this.explode(c.x, c.y, '#0ff', 8);
      }
    }
  }

  private playerDeath(): void {
    this.explode(this.player.x, this.player.y, ACCENT, 20);
    this.explode(this.player.x, this.player.y, '#fff', 10);
    audio.explosion();
    audio.lose();

    this.lives--;
    if (this.lives <= 0) {
      this.state = 'gameover';
      this.menuTimer = 0;
    } else {
      // Start 1.5s death pause before respawn
      this.deathPauseTimer = 1.5;
    }
  }

  // ── Render ──────────────────────────────────────────────────────────
  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();

    // Scale to fit
    const sx = this.screenW / W;
    const sy = this.screenH / H;
    const scale = Math.min(sx, sy);
    const offX = (this.screenW - W * scale) / 2;
    const offY = (this.screenH - H * scale) / 2;
    ctx.translate(offX, offY);
    ctx.scale(scale, scale);

    // Clip to game area
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();

    // Background
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, W, H);

    this.renderStars(ctx);

    if (this.state === 'menu') {
      this.renderMenu(ctx);
      ctx.restore();
      return;
    }

    // Ground / terrain
    this.renderTerrain(ctx);

    // Game objects
    this.renderColonists(ctx);
    this.renderMines(ctx);
    this.renderEnemies(ctx);
    this.renderBullets(ctx);
    this.renderPlayer(ctx);
    this.renderParticles(ctx);

    // Scanner
    this.renderScanner(ctx);

    // HUD
    this.renderHUD(ctx);

    if (this.state === 'paused') {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, H / 2);
      ctx.font = '12px monospace';
      ctx.fillText('Press ENTER to resume', W / 2, H / 2 + 24);
    }

    if (this.state === 'gameover') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#f00';
      ctx.font = 'bold 28px monospace';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#f00';
      ctx.shadowBlur = 15;
      ctx.fillText('GAME OVER', W / 2, H / 2 - 10);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.font = '14px monospace';
      ctx.fillText(`Score: ${this.score}`, W / 2, H / 2 + 16);
      ctx.font = '11px monospace';
      ctx.fillStyle = '#aaa';
      ctx.fillText('Press SPACE to continue', W / 2, H / 2 + 38);
    }

    // Wave announcement
    if (this.state === 'playing' && this.waveTimer > 0) {
      const alpha = Math.min(1, this.waveTimer);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = ACCENT;
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.shadowColor = ACCENT;
      ctx.shadowBlur = 10;
      ctx.fillText(`WAVE ${this.wave}`, W / 2, H / 2 - 20);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    // Wave cleared pause overlay
    if (this.state === 'playing' && this.waveClearTimer > 0) {
      const alpha = Math.min(1, this.waveClearTimer);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#0f0';
      ctx.font = 'bold 22px monospace';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#0f0';
      ctx.shadowBlur = 12;
      ctx.fillText('WAVE CLEARED!', W / 2, H / 2 - 10);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    // Death pause overlay
    if (this.state === 'playing' && this.deathPauseTimer > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, W, H);
      const alpha = 0.6 + Math.sin(this.deathPauseTimer * 6) * 0.4;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#f44';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SHIP DESTROYED', W / 2, H / 2);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  private renderStars(ctx: CanvasRenderingContext2D): void {
    const cam = this.state === 'menu' ? this.menuTimer * 20 : this.cameraX;
    const layers = [this.starsBack, this.starsMid, this.starsFront];
    for (const layer of layers) {
      for (const s of layer) {
        const sx = toScreen(s.x, cam * s.speed);
        if (sx < -2 || sx > W + 2) continue;
        ctx.fillStyle = `rgba(255,255,255,${s.brightness})`;
        ctx.fillRect(sx, s.y, 1.5, 1.5);
      }
    }
  }

  private renderTerrain(ctx: CanvasRenderingContext2D): void {
    // Ground line
    ctx.strokeStyle = '#1a3a1a';
    ctx.lineWidth = 1;
    ctx.beginPath();

    // Jagged terrain
    for (let sx = 0; sx <= W; sx += 4) {
      const worldX = wrapX(this.cameraX - W / 2 + sx);
      // Deterministic pseudo-random terrain height using worldX
      const h = Math.sin(worldX * 0.02) * 4 + Math.sin(worldX * 0.007) * 6;
      const ty = GROUND_Y + h;
      if (sx === 0) ctx.moveTo(sx, ty);
      else ctx.lineTo(sx, ty);
    }
    ctx.stroke();

    // Fill below terrain
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = '#0a1a0a';
    ctx.fill();
  }

  private renderColonists(ctx: CanvasRenderingContext2D): void {
    for (const c of this.colonists) {
      if (!c.alive) continue;
      const sx = toScreen(c.x, this.cameraX);
      if (sx < -10 || sx > W + 10) continue;

      // Small humanoid figure
      ctx.fillStyle = '#0ff';
      ctx.shadowColor = '#0ff';
      ctx.shadowBlur = 4;
      // Head
      ctx.fillRect(sx - 1.5, c.y - 7, 3, 3);
      // Body
      ctx.fillRect(sx - 1, c.y - 4, 2, 4);
      // Legs
      ctx.fillRect(sx - 2.5, c.y, 2, 3);
      ctx.fillRect(sx + 0.5, c.y, 2, 3);
      ctx.shadowBlur = 0;
    }
  }

  private renderMines(ctx: CanvasRenderingContext2D): void {
    for (const m of this.mines) {
      const sx = toScreen(m.x, this.cameraX);
      if (sx < -10 || sx > W + 10) continue;

      const pulse = 0.5 + Math.sin(m.life * 8) * 0.5;
      ctx.fillStyle = `rgba(255, 255, 0, ${0.5 + pulse * 0.5})`;
      ctx.shadowColor = '#ff0';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(sx, m.y, 3 + pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  private renderEnemies(ctx: CanvasRenderingContext2D): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const sx = toScreen(e.x, this.cameraX);
      if (sx < -20 || sx > W + 20) continue;

      ctx.save();
      ctx.translate(sx, e.y);

      switch (e.type) {
        case 'lander':
          // Green diamond shape
          ctx.fillStyle = '#0f0';
          ctx.shadowColor = '#0f0';
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.moveTo(0, -8);
          ctx.lineTo(8, 0);
          ctx.lineTo(0, 8);
          ctx.lineTo(-8, 0);
          ctx.closePath();
          ctx.fill();
          // Inner dot
          ctx.fillStyle = '#0a0';
          ctx.fillRect(-2, -2, 4, 4);
          break;

        case 'bomber':
          // Orange hexagon
          ctx.fillStyle = '#f80';
          ctx.shadowColor = '#f80';
          ctx.shadowBlur = 6;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 6;
            const rx = Math.cos(angle) * 8;
            const ry = Math.sin(angle) * 8;
            if (i === 0) ctx.moveTo(rx, ry);
            else ctx.lineTo(rx, ry);
          }
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#a50';
          ctx.fillRect(-3, -3, 6, 6);
          break;

        case 'pod':
          // Purple circle
          ctx.fillStyle = '#f0f';
          ctx.shadowColor = '#f0f';
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(0, 0, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#808';
          ctx.beginPath();
          ctx.arc(0, 0, 5, 0, Math.PI * 2);
          ctx.fill();
          break;

        case 'swarmer':
          // Small yellow triangles
          ctx.fillStyle = '#ff0';
          ctx.shadowColor = '#ff0';
          ctx.shadowBlur = 4;
          ctx.beginPath();
          ctx.moveTo(0, -5);
          ctx.lineTo(5, 4);
          ctx.lineTo(-5, 4);
          ctx.closePath();
          ctx.fill();
          break;

        case 'mutant':
          // Red aggressive shape
          ctx.fillStyle = '#f00';
          ctx.shadowColor = '#f00';
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.moveTo(0, -8);
          ctx.lineTo(10, -3);
          ctx.lineTo(6, 6);
          ctx.lineTo(-6, 6);
          ctx.lineTo(-10, -3);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#ff0';
          ctx.fillRect(-2, -3, 2, 2);
          ctx.fillRect(1, -3, 2, 2);
          break;
      }

      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }

  private renderBullets(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = ACCENT;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 6;
    for (const b of this.bullets) {
      const sx = toScreen(b.x, this.cameraX);
      if (sx < -5 || sx > W + 5) continue;
      ctx.fillRect(sx - 4, b.y - 1, 8, 2);
    }
    ctx.shadowBlur = 0;
  }

  private renderPlayer(ctx: CanvasRenderingContext2D): void {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    const p = this.player;

    // Blink when invulnerable
    if (p.invulnTimer > 0 && Math.floor(p.invulnTimer * 10) % 2 === 0) return;

    const sx = toScreen(p.x, this.cameraX);
    ctx.save();
    ctx.translate(sx, p.y);
    ctx.scale(p.facing, 1);

    // Ship body
    ctx.fillStyle = ACCENT;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-8, -7);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-8, 7);
    ctx.closePath();
    ctx.fill();

    // Cockpit
    ctx.fillStyle = '#fff';
    ctx.fillRect(4, -2, 4, 4);

    // Engine glow
    ctx.fillStyle = '#0af';
    ctx.shadowColor = '#0af';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(-5, -3);
    ctx.lineTo(-10 - Math.random() * 4, 0);
    ctx.lineTo(-5, 3);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const sx = toScreen(p.x, this.cameraX);
      if (sx < -5 || sx > W + 5) continue;
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 4;
      const size = 2 * alpha;
      ctx.fillRect(sx - size / 2, p.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  private renderScanner(ctx: CanvasRenderingContext2D): void {
    // Scanner background
    ctx.fillStyle = 'rgba(0, 10, 30, 0.8)';
    ctx.fillRect(W / 2 - 120, 0, 240, SCANNER_H);
    ctx.strokeStyle = ACCENT_DIM;
    ctx.lineWidth = 1;
    ctx.strokeRect(W / 2 - 120, 0, 240, SCANNER_H);

    const scanW = 236;
    const scanX = W / 2 - 118;
    const scanScale = scanW / WORLD_W;

    // Viewport indicator
    const viewLeft = ((this.cameraX - W / 2 + WORLD_W) % WORLD_W) * scanScale;
    const viewW = W * scanScale;
    ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
    ctx.fillRect(scanX + viewLeft, 1, viewW, SCANNER_H - 2);

    // Colonists on scanner
    for (const c of this.colonists) {
      if (!c.alive) continue;
      const cx = scanX + (c.x * scanScale);
      ctx.fillStyle = '#0ff';
      ctx.fillRect(cx, SCANNER_H - 4, 2, 3);
    }

    // Enemies on scanner
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const ex = scanX + (e.x * scanScale);
      const ey = 2 + (e.y / H) * (SCANNER_H - 4);
      let color: string;
      switch (e.type) {
        case 'lander': color = '#0f0'; break;
        case 'bomber': color = '#f80'; break;
        case 'pod': color = '#f0f'; break;
        case 'swarmer': color = '#ff0'; break;
        case 'mutant': color = '#f00'; break;
        default: color = '#fff';
      }
      ctx.fillStyle = color;
      ctx.fillRect(ex, ey, 2, 2);
    }

    // Player on scanner
    const px = scanX + (this.player?.x ?? 0) * scanScale;
    const py = 2 + ((this.player?.y ?? H / 2) / H) * (SCANNER_H - 4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(px - 1, py - 1, 3, 3);
  }

  private renderHUD(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = 'left';

    // Score
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`SCORE ${this.score}`, 6, SCANNER_H + 14);

    // Lives
    ctx.fillStyle = ACCENT;
    for (let i = 0; i < this.lives; i++) {
      const lx = 6 + i * 16;
      const ly = SCANNER_H + 22;
      ctx.beginPath();
      ctx.moveTo(lx + 8, ly);
      ctx.lineTo(lx, ly - 4);
      ctx.lineTo(lx + 2, ly);
      ctx.lineTo(lx, ly + 4);
      ctx.closePath();
      ctx.fill();
    }

    // Smart bombs
    ctx.fillStyle = '#ff0';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`BOMBS: ${this.smartBombs}`, W - 6, SCANNER_H + 14);

    // Wave
    ctx.fillStyle = '#888';
    ctx.fillText(`WAVE ${this.wave}`, W - 6, SCANNER_H + 26);

    // Colonists remaining
    const alive = this.colonists.filter(c => c.alive).length;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0ff';
    ctx.font = '10px monospace';
    ctx.fillText(`COLONISTS: ${alive}`, 6, H - 6);
  }

  private renderMenu(ctx: CanvasRenderingContext2D): void {
    // Title
    const pulse = 0.7 + Math.sin(this.menuTimer * 3) * 0.3;

    ctx.fillStyle = ACCENT;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 20;
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('VOID PATROL', W / 2, H / 2 - 40);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#8bb8f8';
    ctx.font = '12px monospace';
    ctx.fillText('DEFEND THE COLONISTS', W / 2, H / 2 - 10);

    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#fff';
    ctx.font = '14px monospace';
    ctx.fillText('Press SPACE to start', W / 2, H / 2 + 30);
    ctx.globalAlpha = 1;

    // Controls help box
    const boxW = 280;
    const boxH = 40;
    const boxX = W / 2 - boxW / 2;
    const boxY = H / 2 + 46;
    ctx.strokeStyle = ACCENT_DIM;
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = 'rgba(10, 10, 40, 0.6)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = '#aaa';
    ctx.font = '11px monospace';
    ctx.fillText('ARROWS = Fly | SPACE = Shoot | X = Smart Bomb', W / 2, boxY + 16);
    ctx.fillStyle = '#666';
    ctx.font = '10px monospace';
    ctx.fillText('ENTER: Pause', W / 2, boxY + 32);

    // Decorative ships
    const shipY = H / 2 + 110;
    for (let i = 0; i < 3; i++) {
      const ox = W / 2 - 40 + i * 40;
      ctx.fillStyle = ACCENT;
      ctx.shadowColor = ACCENT;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(ox + 8, shipY);
      ctx.lineTo(ox - 4, shipY - 4);
      ctx.lineTo(ox - 2, shipY);
      ctx.lineTo(ox - 4, shipY + 4);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}
