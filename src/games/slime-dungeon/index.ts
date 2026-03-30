import { IGame, GameState, InputState, GameInfo } from '../../types/IGame';
import { clamp, randInt, rectsOverlap, Rect } from '../../engine/Physics';
import { audio } from '../../engine/Audio';

// --- Constants ---
const W = 480;
const H = 320;
const TILE = 16;
const GRAVITY = 550;
const PLAYER_SPEED = 120;
const PLAYER_JUMP = -260;
const ORB_SPEED = 200;
const ORB_LIFETIME = 2.0;
const TRAP_FLOAT_SPEED = -25;
const GEM_LIFETIME = 8.0;
const INVULN_TIME = 2.0;
const MAX_LIVES = 3;
const TOTAL_LEVELS = 5;

// --- Types ---
type EnemyType = 'walker' | 'jumper' | 'charger';

interface Entity {
  x: number; y: number; w: number; h: number;
  vx: number; vy: number;
}

interface Player extends Entity {
  facingRight: boolean;
  onGround: boolean;
  lives: number;
  invuln: number;
}

interface Orb extends Entity {
  life: number;
}

interface Enemy extends Entity {
  type: EnemyType;
  trapped: boolean;
  trapTimer: number;
  onGround: boolean;
  color: string;
  speed: number;
}

interface Gem {
  x: number; y: number; w: number; h: number;
  life: number;
  value: number;
  color: string;
  vy: number;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number;
}

interface Platform extends Rect {}

// --- Level layouts ---
// Each level is an array of platform rects (in tile coords: col, row, widthInTiles)
// The game area is 30 tiles wide (480/16) and 20 tiles tall (320/16)
// Bottom row (row 19) and side walls are always present

const LEVEL_LAYOUTS: number[][][] = [
  // Level 1: Simple symmetric
  [
    [4, 15, 8], [18, 15, 8],
    [10, 12, 10],
    [2, 9, 7], [21, 9, 7],
    [9, 6, 12],
    [0, 3, 6], [24, 3, 6],
  ],
  // Level 2: Staircase
  [
    [2, 16, 6], [22, 16, 6],
    [8, 14, 5], [17, 14, 5],
    [0, 11, 8], [22, 11, 8],
    [10, 10, 10],
    [4, 7, 6], [20, 7, 6],
    [11, 4, 8],
  ],
  // Level 3: Dense platforms
  [
    [1, 16, 5], [10, 16, 5], [20, 16, 5],
    [5, 13, 6], [16, 13, 6],
    [0, 10, 5], [12, 10, 6], [25, 10, 5],
    [6, 7, 5], [18, 7, 5],
    [10, 4, 10],
    [1, 3, 4], [25, 3, 4],
  ],
  // Level 4: Corridors
  [
    [0, 16, 12], [18, 16, 12],
    [6, 13, 18],
    [0, 10, 12], [18, 10, 12],
    [6, 7, 18],
    [0, 4, 12], [18, 4, 12],
  ],
  // Level 5: Chaotic
  [
    [2, 17, 4], [12, 17, 6], [24, 17, 4],
    [7, 15, 4], [19, 15, 4],
    [0, 12, 5], [13, 12, 4], [25, 12, 5],
    [7, 10, 4], [19, 10, 4],
    [2, 8, 5], [23, 8, 5],
    [10, 6, 10],
    [0, 3, 4], [26, 3, 4],
    [12, 3, 6],
  ],
];

// Enemy spawns per level: [type, tileX, tileY]
const LEVEL_ENEMIES: [EnemyType, number, number][][] = [
  // Level 1
  [['walker', 5, 14], ['walker', 20, 14], ['jumper', 14, 11], ['walker', 4, 8]],
  // Level 2
  [['walker', 3, 15], ['walker', 23, 15], ['jumper', 12, 9], ['charger', 5, 6], ['walker', 22, 6]],
  // Level 3
  [['walker', 2, 15], ['walker', 22, 15], ['jumper', 13, 9], ['charger', 7, 6], ['jumper', 20, 6], ['walker', 13, 3]],
  // Level 4
  [['walker', 3, 15], ['charger', 22, 15], ['walker', 10, 12], ['jumper', 20, 12], ['charger', 5, 9], ['walker', 22, 9], ['jumper', 14, 6]],
  // Level 5
  [['charger', 3, 16], ['charger', 25, 16], ['jumper', 14, 16], ['walker', 8, 9], ['walker', 20, 9], ['jumper', 13, 5], ['charger', 2, 2], ['charger', 27, 2]],
];

function enemyColor(type: EnemyType): string {
  switch (type) {
    case 'walker': return '#4ade80';
    case 'jumper': return '#facc15';
    case 'charger': return '#f87171';
  }
}

function enemySpeed(type: EnemyType, difficulty: number): number {
  const mult = 1 + difficulty * 0.15;
  switch (type) {
    case 'walker': return 40 * mult;
    case 'jumper': return 50 * mult;
    case 'charger': return 65 * mult;
  }
}

export default class SlimeDungeonGame implements IGame {
  info: GameInfo = {
    id: 'slime-dungeon',
    name: 'Slime Dungeon',
    description: 'Trap dungeon creatures with magic orbs',
    genre: 'Platformer',
    color: '#22c55e',
    controls: 'Arrows to move, Z to shoot, X to jump',
  };

  private state: GameState = 'menu';
  private score = 0;
  private level = 0;
  private difficulty = 0; // increments each full loop of 5 levels
  private platforms: Platform[] = [];
  private player!: Player;
  private orbs: Orb[] = [];
  private enemies: Enemy[] = [];
  private gems: Gem[] = [];
  private particles: Particle[] = [];
  private prevAction1 = false;
  private prevAction2 = false;
  private prevStart = false;
  private levelClearTimer = 0;
  private screenShake = 0;
  private menuBlink = 0;
  private deathPauseTimer = 0;

  async init(_canvas: HTMLCanvasElement): Promise<void> {
    this.state = 'menu';
    this.score = 0;
  }

  private startGame(): void {
    this.score = 0;
    this.level = 0;
    this.difficulty = 0;
    this.initPlayer();
    this.loadLevel(0);
    this.state = 'playing';
  }

  private initPlayer(): void {
    this.player = {
      x: W / 2 - 6, y: H - TILE - 14,
      w: 12, h: 14,
      vx: 0, vy: 0,
      facingRight: true,
      onGround: false,
      lives: MAX_LIVES,
      invuln: 0,
    };
  }

  private loadLevel(idx: number): void {
    const layoutIdx = idx % TOTAL_LEVELS;
    this.orbs = [];
    this.gems = [];
    this.particles = [];
    this.levelClearTimer = 0;

    // Build platforms: always have floor
    this.platforms = [];
    // Floor
    this.platforms.push({ x: 0, y: H - TILE, w: W, h: TILE });
    // Side walls (thin, for wrapping visual only — enemies/player wrap)

    // Level-specific platforms
    const layout = LEVEL_LAYOUTS[layoutIdx];
    for (const [col, row, wTiles] of layout) {
      this.platforms.push({ x: col * TILE, y: row * TILE, w: wTiles * TILE, h: TILE / 2 });
    }

    // Spawn enemies
    this.enemies = [];
    const enemyDefs = LEVEL_ENEMIES[layoutIdx];
    for (const [type, tx, ty] of enemyDefs) {
      this.enemies.push({
        x: tx * TILE, y: ty * TILE - 12,
        w: 14, h: 12,
        vx: (Math.random() > 0.5 ? 1 : -1) * enemySpeed(type, this.difficulty),
        vy: 0,
        type,
        trapped: false,
        trapTimer: 0,
        onGround: false,
        color: enemyColor(type),
        speed: enemySpeed(type, this.difficulty),
      });
    }

    // Reset player position but keep lives/score
    this.player.x = W / 2 - 6;
    this.player.y = H - TILE - 14;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.onGround = false;
    this.player.invuln = INVULN_TIME;
  }

  update(dt: number, input: InputState): void {
    dt = Math.min(dt, 0.05); // cap dt
    this.menuBlink += dt;

    if (this.state === 'menu') {
      if ((input.start && !this.prevStart) || (input.action1 && !this.prevAction1)) {
        this.startGame();
        audio.powerup();
      }
      this.prevStart = input.start;
      this.prevAction1 = input.action1;
      this.prevAction2 = input.action2;
      return;
    }

    if (this.state === 'gameover') {
      if (input.start && !this.prevStart) {
        this.state = 'menu';
      }
      this.prevStart = input.start;
      this.prevAction1 = input.action1;
      this.prevAction2 = input.action2;
      return;
    }

    if (this.state === 'paused') {
      if (input.start && !this.prevStart) {
        this.state = 'playing';
      }
      this.prevStart = input.start;
      this.prevAction1 = input.action1;
      this.prevAction2 = input.action2;
      return;
    }

    // Playing state
    if (input.start && !this.prevStart) {
      this.state = 'paused';
      this.prevStart = input.start;
      return;
    }

    // Death pause (brief freeze after being hit)
    if (this.deathPauseTimer > 0) {
      this.deathPauseTimer -= dt;
      this.updateParticles(dt);
      this.prevStart = input.start;
      this.prevAction1 = input.action1;
      this.prevAction2 = input.action2;
      return;
    }

    // Level clear check
    if (this.enemies.length === 0 && this.levelClearTimer <= 0) {
      this.levelClearTimer = 2.0;
    }
    if (this.levelClearTimer > 0) {
      this.levelClearTimer -= dt;
      if (this.levelClearTimer <= 0) {
        this.level++;
        if (this.level >= TOTAL_LEVELS) {
          this.difficulty++;
        }
        this.loadLevel(this.level);
        audio.powerup();
      }
      // Still update gems/particles during clear
      this.updateGems(dt);
      this.updateParticles(dt);
      this.updatePlayerPhysics(dt, input);
      this.prevStart = input.start;
      this.prevAction1 = input.action1;
      this.prevAction2 = input.action2;
      return;
    }

    // Player input
    this.updatePlayerPhysics(dt, input);

    // Shoot orb (rising edge)
    if (input.action1 && !this.prevAction1) {
      this.shootOrb();
    }

    // Update orbs
    this.updateOrbs(dt);

    // Update enemies
    this.updateEnemies(dt);

    // Update gems
    this.updateGems(dt);

    // Update particles
    this.updateParticles(dt);

    // Collision: player vs enemies
    if (this.player.invuln <= 0) {
      for (const e of this.enemies) {
        if (e.trapped) continue;
        if (rectsOverlap(this.player, e)) {
          this.playerHit();
          break;
        }
      }
    }

    // Collision: player vs trapped enemies (pop them)
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.trapped) continue;
      if (rectsOverlap(this.player, { x: e.x - 2, y: e.y - 2, w: e.w + 4, h: e.h + 4 })) {
        this.popEnemy(i);
      }
    }

    // Collision: player vs gems
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const g = this.gems[i];
      if (rectsOverlap(this.player, g)) {
        this.score += g.value;
        this.spawnParticles(g.x + g.w / 2, g.y + g.h / 2, g.color, 5);
        audio.score();
        this.gems.splice(i, 1);
      }
    }

    this.screenShake = Math.max(0, this.screenShake - dt);

    this.prevStart = input.start;
    this.prevAction1 = input.action1;
    this.prevAction2 = input.action2;
  }

  private updatePlayerPhysics(dt: number, input: InputState): void {
    const p = this.player;

    // Horizontal movement
    p.vx = 0;
    if (input.left) { p.vx = -PLAYER_SPEED; p.facingRight = false; }
    if (input.right) { p.vx = PLAYER_SPEED; p.facingRight = true; }

    // Jump (rising edge)
    if (input.action2 && !this.prevAction2 && p.onGround) {
      p.vy = PLAYER_JUMP;
      p.onGround = false;
      audio.jump();
    }

    // Gravity
    p.vy += GRAVITY * dt;
    p.vy = clamp(p.vy, -400, 400);

    // Move X
    p.x += p.vx * dt;
    // Screen wrap
    if (p.x + p.w < 0) p.x = W;
    if (p.x > W) p.x = -p.w;

    // Move Y
    p.y += p.vy * dt;

    // Platform collision
    p.onGround = false;
    for (const plat of this.platforms) {
      if (this.landOnPlatform(p, plat, dt)) {
        p.y = plat.y - p.h;
        p.vy = 0;
        p.onGround = true;
      }
    }

    // Fall off bottom -> wrap to top
    if (p.y > H + 10) {
      p.y = -p.h;
    }

    // Invulnerability timer
    if (p.invuln > 0) p.invuln -= dt;
  }

  private landOnPlatform(entity: Entity, plat: Platform, _dt: number): boolean {
    // Only land if falling downward and feet are near platform top
    if (entity.vy < 0) return false;
    const feetY = entity.y + entity.h;
    const prevFeetY = feetY - entity.vy * 0.017; // approximate previous frame
    if (prevFeetY > plat.y + 4) return false; // was already below platform
    if (feetY < plat.y || feetY > plat.y + plat.h + 8) return false;
    if (entity.x + entity.w <= plat.x || entity.x >= plat.x + plat.w) return false;
    return true;
  }

  private shootOrb(): void {
    const p = this.player;
    const dir = p.facingRight ? 1 : -1;
    this.orbs.push({
      x: p.x + (p.facingRight ? p.w : -8),
      y: p.y + 2,
      w: 8, h: 8,
      vx: ORB_SPEED * dir,
      vy: 0,
      life: ORB_LIFETIME,
    });
    audio.hit();
  }

  private updateOrbs(dt: number): void {
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.x += o.vx * dt;
      o.life -= dt;

      // Screen wrap
      if (o.x + o.w < 0) o.x = W;
      if (o.x > W) o.x = -o.w;

      // Remove expired
      if (o.life <= 0) {
        this.orbs.splice(i, 1);
        continue;
      }

      // Check collision with non-trapped enemies
      for (let j = 0; j < this.enemies.length; j++) {
        const e = this.enemies[j];
        if (e.trapped) continue;
        if (rectsOverlap(o, e)) {
          e.trapped = true;
          e.trapTimer = 5 + Math.random() * 3; // time before breaking free
          e.vx = 0;
          e.vy = TRAP_FLOAT_SPEED;
          this.orbs.splice(i, 1);
          this.spawnParticles(e.x + e.w / 2, e.y + e.h / 2, '#22c55e', 8);
          audio.powerup();
          break;
        }
      }
    }
  }

  private updateEnemies(dt: number): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];

      if (e.trapped) {
        // Float upward
        e.y += e.vy * dt;
        e.trapTimer -= dt;

        // Wrap at top
        if (e.y + e.h < -10) e.y = H + 5;

        // Break free
        if (e.trapTimer <= 0) {
          e.trapped = false;
          e.vx = (Math.random() > 0.5 ? 1 : -1) * e.speed;
          e.vy = 0;
          this.spawnParticles(e.x + e.w / 2, e.y + e.h / 2, '#ff4444', 6);
          audio.explosion();
        }
        continue;
      }

      // AI based on type
      switch (e.type) {
        case 'walker':
          // Just walks, reverses at edges or walls
          break;
        case 'jumper':
          if (e.onGround && Math.random() < 2 * dt) {
            e.vy = -200 - Math.random() * 80;
            e.onGround = false;
          }
          break;
        case 'charger':
          // Move toward player
          if (e.onGround) {
            const dx = this.player.x - e.x;
            e.vx = dx > 0 ? e.speed : -e.speed;
          }
          break;
      }

      // Gravity
      e.vy += GRAVITY * dt;
      e.vy = clamp(e.vy, -400, 400);

      // Move X
      e.x += e.vx * dt;

      // Screen wrap
      if (e.x + e.w < 0) e.x = W;
      if (e.x > W) e.x = -e.w;

      // Move Y
      e.y += e.vy * dt;

      // Platform collision
      e.onGround = false;
      for (const plat of this.platforms) {
        if (this.landOnPlatform(e, plat, dt)) {
          e.y = plat.y - e.h;
          e.vy = 0;
          e.onGround = true;
        }
      }

      // Fall off bottom -> appear at top
      if (e.y > H + 10) {
        e.y = -e.h - 5;
        e.vy = 0;
      }

      // Walker: reverse at platform edges
      if (e.type === 'walker' && e.onGround) {
        // Check if about to walk off a platform edge
        const checkX = e.vx > 0 ? e.x + e.w + 2 : e.x - 2;
        let overPlatform = false;
        for (const plat of this.platforms) {
          if (checkX >= plat.x && checkX <= plat.x + plat.w &&
              e.y + e.h >= plat.y - 2 && e.y + e.h <= plat.y + plat.h + 2) {
            overPlatform = true;
            break;
          }
        }
        if (!overPlatform) {
          e.vx = -e.vx;
        }
      }
    }
  }

  private popEnemy(idx: number): void {
    const e = this.enemies[idx];
    const value = e.type === 'charger' ? 300 : e.type === 'jumper' ? 200 : 100;
    const gemColor = e.type === 'charger' ? '#f87171' : e.type === 'jumper' ? '#facc15' : '#4ade80';

    // Spawn gem
    this.gems.push({
      x: e.x, y: e.y, w: 10, h: 10,
      life: GEM_LIFETIME,
      value: value * (1 + this.difficulty),
      color: gemColor,
      vy: -60,
    });

    this.spawnParticles(e.x + e.w / 2, e.y + e.h / 2, '#22c55e', 10);
    audio.score();
    this.enemies.splice(idx, 1);
  }

  private playerHit(): void {
    this.player.lives--;
    this.player.invuln = INVULN_TIME;
    this.screenShake = 0.3;
    this.spawnParticles(this.player.x + this.player.w / 2, this.player.y + this.player.h / 2, '#ff4444', 12);
    audio.lose();

    if (this.player.lives <= 0) {
      this.state = 'gameover';
    } else {
      this.deathPauseTimer = 1.0;
    }
  }

  private updateGems(dt: number): void {
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const g = this.gems[i];
      g.life -= dt;
      g.vy += 200 * dt;
      g.y += g.vy * dt;

      // Land on platforms
      for (const plat of this.platforms) {
        const feetY = g.y + g.h;
        if (g.vy > 0 && feetY >= plat.y && feetY <= plat.y + plat.h + 4 &&
            g.x + g.w > plat.x && g.x < plat.x + plat.w) {
          g.y = plat.y - g.h;
          g.vy = 0;
        }
      }

      if (g.life <= 0) {
        this.gems.splice(i, 1);
      }
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

  private spawnParticles(cx: number, cy: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: cx, y: cy,
        vx: (Math.random() - 0.5) * 150,
        vy: (Math.random() - 0.5) * 150,
        life: 0.3 + Math.random() * 0.4,
        maxLife: 0.7,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  // --- Rendering ---
  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();

    // Screen shake
    if (this.screenShake > 0) {
      const sx = (Math.random() - 0.5) * 6;
      const sy = (Math.random() - 0.5) * 6;
      ctx.translate(sx, sy);
    }

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    // Draw some background bricks
    this.drawBackgroundBricks(ctx);

    if (this.state === 'menu') {
      this.drawMenu(ctx);
      ctx.restore();
      return;
    }

    if (this.state === 'gameover') {
      this.drawGameScene(ctx);
      this.drawGameOver(ctx);
      ctx.restore();
      return;
    }

    if (this.state === 'paused') {
      this.drawGameScene(ctx);
      this.drawPaused(ctx);
      ctx.restore();
      return;
    }

    // Playing
    this.drawGameScene(ctx);

    // Death pause indicator
    if (this.deathPauseTimer > 0) {
      ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ff4444';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('OUCH!', W / 2, H / 2 - 10);
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px monospace';
      ctx.fillText(`Lives: ${this.player.lives}`, W / 2, H / 2 + 12);
    }

    // Level clear message
    if (this.levelClearTimer > 0) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#22c55e';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('LEVEL CLEAR!', W / 2, H / 2 - 10);
      ctx.fillStyle = '#ffffff';
      ctx.font = '16px monospace';
      ctx.fillText(`Level ${this.level + 1} Complete`, W / 2, H / 2 + 16);
    }

    ctx.restore();
  }

  private drawBackgroundBricks(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#1f1f38';
    for (let r = 0; r < 20; r++) {
      for (let c = 0; c < 30; c++) {
        const offset = (r % 2) * 8;
        const bx = c * TILE + offset;
        ctx.fillRect(bx + 0.5, r * TILE + 0.5, TILE - 1, TILE - 1);
      }
    }
  }

  private drawGameScene(ctx: CanvasRenderingContext2D): void {
    // Platforms
    for (const p of this.platforms) {
      this.drawPlatform(ctx, p);
    }

    // Gems
    for (const g of this.gems) {
      this.drawGem(ctx, g);
    }

    // Orbs
    for (const o of this.orbs) {
      this.drawOrb(ctx, o);
    }

    // Enemies
    for (const e of this.enemies) {
      this.drawEnemy(ctx, e);
    }

    // Player
    this.drawPlayer(ctx);

    // Particles
    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // HUD
    this.drawHUD(ctx);
  }

  private drawPlatform(ctx: CanvasRenderingContext2D, p: Platform): void {
    if (p.h >= TILE) {
      // Floor - solid stone
      ctx.fillStyle = '#4a4a5e';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = '#5a5a70';
      for (let bx = p.x; bx < p.x + p.w; bx += TILE) {
        ctx.fillRect(bx + 1, p.y + 1, TILE - 2, TILE - 2);
      }
    } else {
      // Thin platform
      ctx.fillStyle = '#5a5a70';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = '#6a6a82';
      ctx.fillRect(p.x, p.y, p.w, 2);
      // Bricks pattern
      ctx.fillStyle = '#4a4a5e';
      for (let bx = p.x; bx < p.x + p.w; bx += TILE) {
        ctx.fillRect(bx, p.y, 1, p.h);
      }
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    const p = this.player;

    // Invulnerability blink
    if (p.invuln > 0 && Math.floor(p.invuln * 10) % 2 === 0) return;

    const cx = p.x + p.w / 2;
    const dir = p.facingRight ? 1 : -1;

    // Body (robe)
    ctx.fillStyle = '#6366f1';
    ctx.fillRect(p.x, p.y + 4, p.w, p.h - 4);

    // Head
    ctx.fillStyle = '#fcd34d';
    ctx.fillRect(cx - 4, p.y + 2, 8, 6);

    // Eyes
    ctx.fillStyle = '#000';
    ctx.fillRect(cx + dir * 1, p.y + 4, 2, 2);

    // Wizard hat
    ctx.fillStyle = '#6366f1';
    ctx.beginPath();
    ctx.moveTo(cx - 5, p.y + 3);
    ctx.lineTo(cx, p.y - 6);
    ctx.lineTo(cx + 5, p.y + 3);
    ctx.fill();

    // Hat brim
    ctx.fillRect(cx - 6, p.y + 2, 12, 2);

    // Hat star
    ctx.fillStyle = '#fcd34d';
    ctx.fillRect(cx - 1, p.y - 3, 2, 2);

    // Wand
    ctx.fillStyle = '#a78bfa';
    const wandX = p.facingRight ? p.x + p.w : p.x - 4;
    ctx.fillRect(wandX, p.y + 5, 4, 2);
    // Wand tip glow
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(wandX + (p.facingRight ? 3 : -1), p.y + 4, 2, 4);
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy): void {
    if (e.trapped) {
      // Draw bubble/orb around enemy
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x + e.w / 2, e.y + e.h / 2, Math.max(e.w, e.h) * 0.8, 0, Math.PI * 2);
      ctx.stroke();

      // Bubble shine
      ctx.fillStyle = 'rgba(34, 197, 94, 0.15)';
      ctx.fill();

      // Trapped enemy is dimmer
      ctx.globalAlpha = 0.7;
    }

    const cx = e.x + e.w / 2;
    const cy = e.y + e.h;

    // Slime body
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.ellipse(cx, cy - e.h / 2, e.w / 2 + 1, e.h / 2 + 1, 0, 0, Math.PI * 2);
    ctx.fill();

    // Slime highlight
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.ellipse(cx - 2, cy - e.h / 2 - 2, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx - 4, cy - e.h / 2 - 2, 3, 3);
    ctx.fillRect(cx + 1, cy - e.h / 2 - 2, 3, 3);
    ctx.fillStyle = '#000';
    ctx.fillRect(cx - 3, cy - e.h / 2 - 1, 2, 2);
    ctx.fillRect(cx + 2, cy - e.h / 2 - 1, 2, 2);

    // Charger has angry brows
    if (e.type === 'charger' && !e.trapped) {
      ctx.fillStyle = e.color;
      ctx.fillRect(cx - 5, cy - e.h / 2 - 4, 4, 1);
      ctx.fillRect(cx + 1, cy - e.h / 2 - 4, 4, 1);
    }

    ctx.globalAlpha = 1;
  }

  private drawOrb(ctx: CanvasRenderingContext2D, o: Orb): void {
    const cx = o.x + o.w / 2;
    const cy = o.y + o.h / 2;

    // Glow
    ctx.fillStyle = 'rgba(34, 197, 94, 0.3)';
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();

    // Core
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();

    // Sparkle
    ctx.fillStyle = '#bbf7d0';
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
  }

  private drawGem(ctx: CanvasRenderingContext2D, g: Gem): void {
    // Blink when about to expire
    if (g.life < 2 && Math.floor(g.life * 5) % 2 === 0) return;

    const cx = g.x + g.w / 2;
    const cy = g.y + g.h / 2;

    // Diamond shape
    ctx.fillStyle = g.color;
    ctx.beginPath();
    ctx.moveTo(cx, g.y);
    ctx.lineTo(g.x + g.w, cy);
    ctx.lineTo(cx, g.y + g.h);
    ctx.lineTo(g.x, cy);
    ctx.closePath();
    ctx.fill();

    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(cx, g.y + 2);
    ctx.lineTo(cx + 3, cy);
    ctx.lineTo(cx, cy + 1);
    ctx.lineTo(cx - 1, cy);
    ctx.closePath();
    ctx.fill();
  }

  private drawHUD(ctx: CanvasRenderingContext2D): void {
    // Score
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`SCORE: ${this.score}`, 8, 14);

    // Level
    ctx.textAlign = 'center';
    ctx.fillText(`LEVEL ${this.level + 1}`, W / 2, 14);

    // Lives
    ctx.textAlign = 'right';
    for (let i = 0; i < this.player.lives; i++) {
      // Small wizard hat icons
      const hx = W - 12 - i * 18;
      ctx.fillStyle = '#6366f1';
      ctx.beginPath();
      ctx.moveTo(hx - 5, 14);
      ctx.lineTo(hx, 4);
      ctx.lineTo(hx + 5, 14);
      ctx.fill();
      ctx.fillStyle = '#fcd34d';
      ctx.fillRect(hx - 1, 6, 2, 2);
    }
  }

  private drawMenu(ctx: CanvasRenderingContext2D): void {
    // Title
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SLIME DUNGEON', W / 2, 100);

    // Decorative slime
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.ellipse(W / 2 - 40, 150, 14, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.ellipse(W / 2, 155, 12, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f87171';
    ctx.beginPath();
    ctx.ellipse(W / 2 + 40, 148, 13, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes on slimes
    for (const sx of [W / 2 - 40, W / 2, W / 2 + 40]) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(sx - 4, 147, 3, 3);
      ctx.fillRect(sx + 1, 147, 3, 3);
      ctx.fillStyle = '#000';
      ctx.fillRect(sx - 3, 148, 2, 2);
      ctx.fillRect(sx + 2, 148, 2, 2);
    }

    // Wizard icon
    ctx.fillStyle = '#6366f1';
    ctx.beginPath();
    ctx.moveTo(W / 2 - 8, 200);
    ctx.lineTo(W / 2, 182);
    ctx.lineTo(W / 2 + 8, 200);
    ctx.fill();
    ctx.fillRect(W / 2 - 9, 199, 18, 3);
    ctx.fillStyle = '#fcd34d';
    ctx.fillRect(W / 2 - 1, 188, 2, 2);

    // Blink text
    if (Math.floor(this.menuBlink * 2) % 2 === 0) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px monospace';
      ctx.fillText('PRESS SPACE', W / 2, 240);
    }

    // Controls help box
    const boxW = 320;
    const boxH = 50;
    const boxX = (W - boxW) / 2;
    const boxY = 258;
    ctx.strokeStyle = '#4a4a5e';
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = 'rgba(26, 26, 46, 0.8)';
    ctx.fillRect(boxX + 1, boxY + 1, boxW - 2, boxH - 2);

    ctx.fillStyle = '#aaa';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('ARROWS = Move  |  Z = Shoot Orb  |  X = Jump', W / 2, boxY + 20);
    ctx.fillStyle = '#777';
    ctx.font = '10px monospace';
    ctx.fillText('Trap slimes in magic orbs, then pop them!', W / 2, boxY + 38);
  }

  private drawGameOver(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#f87171';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', W / 2, 130);

    ctx.fillStyle = '#ffffff';
    ctx.font = '16px monospace';
    ctx.fillText(`SCORE: ${this.score}`, W / 2, 170);
    ctx.fillText(`LEVEL: ${this.level + 1}`, W / 2, 195);

    if (Math.floor(this.menuBlink * 2) % 2 === 0) {
      ctx.fillStyle = '#aaa';
      ctx.font = '12px monospace';
      ctx.fillText('PRESS SPACE', W / 2, 240);
    }
  }

  private drawPaused(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', W / 2, H / 2);
  }

  resize(_width: number, _height: number): void {
    // Fixed 480x320 game, no dynamic resize needed
  }

  getScore(): number { return this.score; }
  getState(): GameState { return this.state; }
  destroy(): void {
    // No resources to clean up
  }
}
