import { GameState, InputState, GameInfo, IGame } from '../../types/IGame';
import { audio } from '../../engine/Audio';
import { clamp, randInt, randFloat, rectsOverlap, Rect } from '../../engine/Physics';

const W = 480;
const H = 320;
const RED = '#ef4444';
const DARK_RED = '#b91c1c';
const NEON_BLUE = '#3b82f6';
const NEON_PINK = '#ec4899';
const NEON_GREEN = '#22c55e';
const NEON_YELLOW = '#eab308';
const BG_DARK = '#0f0f1a';
const GROUND_Y_MIN = 180;
const GROUND_Y_MAX = 290;
const PLAYER_W = 24;
const PLAYER_H = 40;
const WALK_SPEED = 100;
const DEPTH_SPEED = 60;
const SCROLL_SPEED = 80;

// Damage values
const PUNCH_DMG = 10;
const KICK_DMG = 20;
const COMBO_DMG = 25;

// Attack durations
const PUNCH_DUR = 0.2;
const KICK_DUR = 0.35;
const KNOCKDOWN_DUR = 0.8;
const INVULN_DUR = 1.0;

type EnemyType = 'thug' | 'bruiser' | 'knife';
type Direction = -1 | 1;
type AttackType = 'none' | 'punch' | 'kick';

interface Fighter {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  facing: Direction;
  attacking: AttackType;
  attackTimer: number;
  comboCount: number;
  comboTimer: number;
  knockdown: boolean;
  knockdownTimer: number;
  invulnTimer: number;
  hitStun: number;
  hitsWithoutMove: number;
  vx: number;
  vy: number;
  walkFrame: number;
}

interface Enemy extends Fighter {
  type: EnemyType;
  alive: boolean;
  aiTimer: number;
  scoreValue: number;
  attackCooldown: number;
  color: string;
  speed: number;
  damage: number;
}

interface RainDrop {
  x: number;
  y: number;
  speed: number;
  len: number;
}

interface NeonSign {
  x: number;
  y: number;
  text: string;
  color: string;
  glow: number;
  glowDir: number;
}

interface StageSection {
  enemies: { type: EnemyType; x: number; y: number }[];
  scrollTarget: number;
}

interface StageData {
  name: string;
  bgColor: string;
  sections: StageSection[];
}

const STAGES: StageData[] = [
  {
    name: 'THE ALLEY',
    bgColor: '#0a0a14',
    sections: [
      {
        enemies: [
          { type: 'thug', x: 350, y: 220 },
          { type: 'thug', x: 400, y: 250 },
        ],
        scrollTarget: 0,
      },
      {
        enemies: [
          { type: 'thug', x: 520, y: 210 },
          { type: 'thug', x: 560, y: 260 },
        ],
        scrollTarget: 480,
      },
    ],
  },
  {
    name: 'THE WAREHOUSE',
    bgColor: '#0d0d12',
    sections: [
      {
        enemies: [
          { type: 'thug', x: 350, y: 220 },
          { type: 'thug', x: 400, y: 250 },
          { type: 'bruiser', x: 420, y: 230 },
        ],
        scrollTarget: 0,
      },
      {
        enemies: [
          { type: 'thug', x: 520, y: 240 },
          { type: 'bruiser', x: 560, y: 220 },
        ],
        scrollTarget: 480,
      },
    ],
  },
  {
    name: 'THE ROOFTOP',
    bgColor: '#0a0812',
    sections: [
      {
        enemies: [
          { type: 'thug', x: 350, y: 220 },
          { type: 'thug', x: 380, y: 260 },
          { type: 'knife', x: 420, y: 230 },
          { type: 'knife', x: 440, y: 250 },
        ],
        scrollTarget: 0,
      },
      {
        enemies: [
          { type: 'bruiser', x: 520, y: 230 },
          { type: 'bruiser', x: 560, y: 250 },
        ],
        scrollTarget: 480,
      },
      {
        enemies: [
          { type: 'thug', x: 650, y: 220 },
          { type: 'knife', x: 680, y: 260 },
          { type: 'bruiser', x: 720, y: 240 }, // boss bruiser
        ],
        scrollTarget: 960,
      },
    ],
  },
];

function makeEnemy(type: EnemyType, x: number, y: number, isBoss = false): Enemy {
  const stats: Record<EnemyType, { hp: number; speed: number; damage: number; score: number; color: string }> = {
    thug:    { hp: 30,  speed: 50,  damage: 8,  score: 100, color: '#6b7280' },
    bruiser: { hp: 60,  speed: 30,  damage: 15, score: 250, color: '#92400e' },
    knife:   { hp: 20,  speed: 80,  damage: 18, score: 200, color: '#7c3aed' },
  };
  const s = stats[type];
  const hp = isBoss ? 120 : s.hp;
  return {
    x, y, hp, maxHp: hp,
    facing: -1, attacking: 'none', attackTimer: 0,
    comboCount: 0, comboTimer: 0,
    knockdown: false, knockdownTimer: 0,
    invulnTimer: 0, hitStun: 0, hitsWithoutMove: 0,
    vx: 0, vy: 0, walkFrame: 0,
    type, alive: true, aiTimer: randFloat(0.5, 1.5),
    scoreValue: s.score, attackCooldown: 0,
    color: isBoss ? '#dc2626' : s.color,
    speed: s.speed, damage: s.damage,
  };
}

function makePlayer(): Fighter {
  return {
    x: 60, y: 240,
    hp: 100, maxHp: 100,
    facing: 1, attacking: 'none', attackTimer: 0,
    comboCount: 0, comboTimer: 0,
    knockdown: false, knockdownTimer: 0,
    invulnTimer: 0, hitStun: 0, hitsWithoutMove: 0,
    vx: 0, vy: 0, walkFrame: 0,
  };
}

export default class IronFistAlleyGame implements IGame {
  info: GameInfo = {
    id: 'iron-fist-alley',
    name: 'Iron Fist Alley',
    description: 'Fight through gangs in a rain-soaked neon city',
    genre: 'Beat-em-up',
    color: RED,
    controls: 'Arrows: Move | Z: Punch | X: Kick',
  };

  private state: GameState = 'menu';
  private canvas!: HTMLCanvasElement;
  private width = W;
  private height = H;
  private scaleX = 1;
  private scaleY = 1;

  private score = 0;
  private lives = 3;
  private stageIndex = 0;
  private sectionIndex = 0;
  private player!: Fighter;
  private enemies: Enemy[] = [];
  private scrollX = 0;
  private scrollTarget = 0;
  private scrolling = false;
  private showGo = false;
  private goTimer = 0;
  private sectionCleared = false;
  private noDamageTaken = true;
  private stageTransition = 0;
  private stageTransitionText = '';
  private gameWon = false;

  // Rain
  private rain: RainDrop[] = [];
  // Neon signs
  private neonSigns: NeonSign[] = [];
  // Hit effects
  private hitEffects: { x: number; y: number; timer: number; text: string }[] = [];

  // Input tracking
  private prevAction1 = false;
  private prevAction2 = false;
  private prevStart = false;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    this.resize(canvas.width, canvas.height);
    this.initRain();
    this.initNeonSigns();
    this.reset();
  }

  private initRain(): void {
    this.rain = [];
    for (let i = 0; i < 80; i++) {
      this.rain.push({
        x: randFloat(0, W + 100),
        y: randFloat(-H, H),
        speed: randFloat(300, 500),
        len: randFloat(6, 14),
      });
    }
  }

  private initNeonSigns(): void {
    this.neonSigns = [
      { x: 100, y: 60, text: 'BAR', color: NEON_PINK, glow: 1, glowDir: 1 },
      { x: 320, y: 50, text: 'HOTEL', color: NEON_BLUE, glow: 0.5, glowDir: -1 },
      { x: 600, y: 55, text: 'CLUB', color: NEON_GREEN, glow: 0.8, glowDir: 1 },
      { x: 850, y: 65, text: '24HR', color: NEON_YELLOW, glow: 0.3, glowDir: -1 },
      { x: 1100, y: 50, text: 'NEON', color: NEON_PINK, glow: 0.6, glowDir: 1 },
    ];
  }

  private reset(): void {
    this.score = 0;
    this.lives = 3;
    this.stageIndex = 0;
    this.sectionIndex = 0;
    this.gameWon = false;
    this.loadSection();
  }

  private loadSection(): void {
    const stage = STAGES[this.stageIndex];
    const section = stage.sections[this.sectionIndex];
    this.scrollTarget = section.scrollTarget;
    this.scrollX = section.scrollTarget;
    this.scrolling = false;
    this.showGo = false;
    this.goTimer = 0;
    this.sectionCleared = false;
    this.noDamageTaken = true;
    this.player = makePlayer();
    this.player.x = this.scrollX + 60;
    this.player.y = 240;
    this.enemies = [];
    this.hitEffects = [];

    const isFinalSection = this.stageIndex === 2 && this.sectionIndex === stage.sections.length - 1;
    for (const e of section.enemies) {
      const ex = e.x + section.scrollTarget;
      // Last bruiser in final stage final section is the boss
      const isBoss = isFinalSection && e.type === 'bruiser' && e === section.enemies[section.enemies.length - 1];
      this.enemies.push(makeEnemy(e.type, ex, e.y, isBoss));
    }
  }

  private startStage(): void {
    this.sectionIndex = 0;
    this.stageTransition = 2.0;
    this.stageTransitionText = STAGES[this.stageIndex].name;
    this.loadSection();
  }

  private advanceSection(): void {
    const stage = STAGES[this.stageIndex];
    // Bonus for no damage
    if (this.noDamageTaken) {
      this.score += 500;
      this.hitEffects.push({ x: this.player.x, y: this.player.y - 30, timer: 1.5, text: 'NO DAMAGE +500' });
    }
    this.sectionIndex++;
    if (this.sectionIndex >= stage.sections.length) {
      // Next stage
      this.stageIndex++;
      if (this.stageIndex >= STAGES.length) {
        this.gameWon = true;
        this.score += 2000;
        this.state = 'gameover';
        return;
      }
      this.startStage();
    } else {
      this.showGo = true;
      this.goTimer = 0;
      this.sectionCleared = true;
    }
  }

  private scrollToNextSection(): void {
    const stage = STAGES[this.stageIndex];
    const section = stage.sections[this.sectionIndex];
    this.scrollTarget = section.scrollTarget;
    this.scrolling = true;
    this.showGo = false;
    this.sectionCleared = false;

    // Spawn enemies for the new section
    this.enemies = [];
    const isFinalSection = this.stageIndex === 2 && this.sectionIndex === stage.sections.length - 1;
    for (const e of section.enemies) {
      const ex = e.x + section.scrollTarget;
      const isBoss = isFinalSection && e.type === 'bruiser' && e === section.enemies[section.enemies.length - 1];
      this.enemies.push(makeEnemy(e.type, ex, e.y, isBoss));
    }
    this.noDamageTaken = true;
  }

  private playerDie(): void {
    this.lives--;
    if (this.lives <= 0) {
      this.state = 'gameover';
      audio.lose();
    } else {
      // Respawn at current section
      audio.playTone(150, 0.4, 'sawtooth');
      this.player.hp = this.player.maxHp;
      this.player.knockdown = false;
      this.player.knockdownTimer = 0;
      this.player.invulnTimer = INVULN_DUR * 2;
      this.player.x = this.scrollX + 60;
    }
  }

  update(dt: number, input: InputState): void {
    // Clamp dt
    dt = Math.min(dt, 0.05);

    // Update rain always
    this.updateRain(dt);
    this.updateNeonSigns(dt);

    if (this.state === 'menu') {
      if (input.start && !this.prevStart) {
        this.state = 'playing';
        this.reset();
        this.startStage();
        audio.playTone(440, 0.15, 'square');
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

    // Stage transition
    if (this.stageTransition > 0) {
      this.stageTransition -= dt;
      this.prevStart = input.start;
      this.prevAction1 = input.action1;
      this.prevAction2 = input.action2;
      return;
    }

    // Scrolling
    if (this.scrolling) {
      const diff = this.scrollTarget - this.scrollX;
      if (Math.abs(diff) < 2) {
        this.scrollX = this.scrollTarget;
        this.scrolling = false;
      } else {
        this.scrollX += Math.sign(diff) * SCROLL_SPEED * dt;
        this.player.x += Math.sign(diff) * SCROLL_SPEED * dt;
      }
      this.prevStart = input.start;
      this.prevAction1 = input.action1;
      this.prevAction2 = input.action2;
      return;
    }

    // Update hit effects
    this.hitEffects = this.hitEffects.filter(e => {
      e.timer -= dt;
      e.y -= 30 * dt;
      return e.timer > 0;
    });

    // Update player
    this.updatePlayer(dt, input);

    // Update enemies
    this.updateEnemies(dt);

    // Check for section clear
    if (!this.sectionCleared && this.enemies.every(e => !e.alive)) {
      this.advanceSection();
    }

    // Handle GO arrow + scrolling to next section
    if (this.sectionCleared && this.showGo) {
      this.goTimer += dt;
      // Player moves right past screen edge
      if (this.player.x > this.scrollX + W - 40) {
        this.scrollToNextSection();
      }
    }

    this.prevStart = input.start;
    this.prevAction1 = input.action1;
    this.prevAction2 = input.action2;
  }

  private updatePlayer(dt: number, input: InputState): void {
    const p = this.player;

    // Knockdown
    if (p.knockdown) {
      p.knockdownTimer -= dt;
      if (p.knockdownTimer <= 0) {
        p.knockdown = false;
        p.invulnTimer = INVULN_DUR;
        p.hitsWithoutMove = 0;
      }
      return;
    }

    // Invuln timer
    if (p.invulnTimer > 0) p.invulnTimer -= dt;

    // Hit stun
    if (p.hitStun > 0) {
      p.hitStun -= dt;
      return;
    }

    // Attack
    if (p.attacking !== 'none') {
      p.attackTimer -= dt;
      if (p.attackTimer <= 0) {
        p.attacking = 'none';
      }
      return;
    }

    // Combo timer decay
    if (p.comboTimer > 0) {
      p.comboTimer -= dt;
      if (p.comboTimer <= 0) {
        p.comboCount = 0;
      }
    }

    // Movement
    let moved = false;
    if (input.left) { p.vx = -WALK_SPEED; p.facing = -1; moved = true; }
    else if (input.right) { p.vx = WALK_SPEED; p.facing = 1; moved = true; }
    else { p.vx = 0; }

    if (input.up) { p.vy = -DEPTH_SPEED; moved = true; }
    else if (input.down) { p.vy = DEPTH_SPEED; moved = true; }
    else { p.vy = 0; }

    if (moved) {
      p.hitsWithoutMove = 0;
      p.walkFrame += dt * 8;
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Clamp to screen/ground
    const leftBound = this.sectionCleared ? this.scrollX : this.scrollX + 10;
    const rightBound = this.sectionCleared ? this.scrollX + W + 200 : this.scrollX + W - PLAYER_W - 10;
    p.x = clamp(p.x, leftBound, rightBound);
    p.y = clamp(p.y, GROUND_Y_MIN, GROUND_Y_MAX);

    // Attacks
    if (input.action1 && !this.prevAction1 && p.attacking === 'none') {
      p.comboCount++;
      p.comboTimer = 0.6;
      p.attacking = 'punch';
      p.attackTimer = PUNCH_DUR;
      audio.playTone(300, 0.08, 'square');
      this.doPlayerAttack(p.comboCount >= 3 ? COMBO_DMG : PUNCH_DMG, p.comboCount >= 3);
      if (p.comboCount >= 3) {
        p.comboCount = 0;
        p.comboTimer = 0;
      }
    } else if (input.action2 && !this.prevAction2 && p.attacking === 'none') {
      p.attacking = 'kick';
      p.attackTimer = KICK_DUR;
      p.comboCount = 0;
      p.comboTimer = 0;
      audio.playTone(200, 0.12, 'sawtooth');
      this.doPlayerAttack(KICK_DMG, false);
    }
  }

  private doPlayerAttack(damage: number, knockdown: boolean): void {
    const p = this.player;
    const attackRange = p.facing === 1
      ? { x: p.x + PLAYER_W, y: p.y - 5, w: 30, h: PLAYER_H + 10 }
      : { x: p.x - 30, y: p.y - 5, w: 30, h: PLAYER_H + 10 };

    for (const e of this.enemies) {
      if (!e.alive || e.knockdown) continue;
      const eRect: Rect = { x: e.x, y: e.y, w: PLAYER_W, h: PLAYER_H };
      if (rectsOverlap(attackRange, eRect) && Math.abs(e.y - p.y) < 25) {
        e.hp -= damage;
        e.hitStun = 0.3;
        e.vx = p.facing * 40;
        audio.hit();

        this.hitEffects.push({
          x: e.x + PLAYER_W / 2,
          y: e.y - 10,
          timer: 0.5,
          text: damage === COMBO_DMG ? 'COMBO!' : `-${damage}`,
        });

        if (knockdown) {
          e.knockdown = true;
          e.knockdownTimer = KNOCKDOWN_DUR;
          e.vx = p.facing * 80;
        }

        if (e.hp <= 0) {
          e.alive = false;
          this.score += e.scoreValue;
          audio.score();
          this.hitEffects.push({
            x: e.x + PLAYER_W / 2,
            y: e.y - 25,
            timer: 1.0,
            text: `+${e.scoreValue}`,
          });
        }
      }
    }
  }

  private updateEnemies(dt: number): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;

      // Knockdown
      if (e.knockdown) {
        e.knockdownTimer -= dt;
        e.x += e.vx * dt;
        e.vx *= 0.9;
        if (e.knockdownTimer <= 0) {
          e.knockdown = false;
          e.invulnTimer = 0.3;
        }
        continue;
      }

      // Hit stun
      if (e.hitStun > 0) {
        e.hitStun -= dt;
        e.x += e.vx * dt;
        e.vx *= 0.85;
        continue;
      }

      // Invuln
      if (e.invulnTimer > 0) e.invulnTimer -= dt;

      // Attack cooldown
      if (e.attackCooldown > 0) e.attackCooldown -= dt;

      // Attack timer
      if (e.attacking !== 'none') {
        e.attackTimer -= dt;
        if (e.attackTimer <= 0) {
          e.attacking = 'none';
        }
        continue;
      }

      // AI
      e.aiTimer -= dt;
      if (e.aiTimer <= 0) {
        e.aiTimer = randFloat(0.3, 0.8);
        const p = this.player;
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const dist = Math.abs(dx);
        const depthDist = Math.abs(dy);

        // Face player
        e.facing = dx > 0 ? 1 : -1;

        const attackDist = e.type === 'knife' ? 28 : 32;

        if (dist < attackDist && depthDist < 20 && e.attackCooldown <= 0) {
          // Attack
          e.attacking = 'punch';
          e.attackTimer = 0.3;
          e.attackCooldown = randFloat(0.8, 1.5);
          audio.playTone(250, 0.06, 'square');

          // Hit check
          if (p.invulnTimer <= 0 && !p.knockdown) {
            p.hp -= e.damage;
            p.hitStun = 0.2;
            p.hitsWithoutMove++;
            this.noDamageTaken = false;
            audio.playTone(180, 0.1, 'sawtooth');

            this.hitEffects.push({
              x: p.x + PLAYER_W / 2,
              y: p.y - 10,
              timer: 0.5,
              text: `-${e.damage}`,
            });

            if (p.hitsWithoutMove >= 3) {
              p.knockdown = true;
              p.knockdownTimer = KNOCKDOWN_DUR;
              p.vx = -e.facing * 60;
            }

            if (p.hp <= 0) {
              p.hp = 0;
              this.playerDie();
            }
          }
        } else {
          // Move toward player
          const moveX = Math.sign(dx) * e.speed * 0.7;
          const moveY = depthDist > 5 ? Math.sign(dy) * e.speed * 0.4 : 0;
          e.vx = moveX;
          e.vy = moveY;
        }
      }

      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.y = clamp(e.y, GROUND_Y_MIN, GROUND_Y_MAX);
      e.walkFrame += dt * 6;
    }
  }

  private updateRain(dt: number): void {
    for (const r of this.rain) {
      r.x -= dt * 30;
      r.y += r.speed * dt;
      if (r.y > H) {
        r.y = randFloat(-20, -5);
        r.x = randFloat(0, W + 100);
      }
    }
  }

  private updateNeonSigns(dt: number): void {
    for (const s of this.neonSigns) {
      s.glow += s.glowDir * dt * 1.5;
      if (s.glow > 1) { s.glow = 1; s.glowDir = -1; }
      if (s.glow < 0.2) { s.glow = 0.2; s.glowDir = 1; }
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);

    if (this.state === 'menu') {
      this.renderMenu(ctx);
    } else if (this.state === 'gameover') {
      this.renderGameOver(ctx);
    } else {
      this.renderGame(ctx);
      if (this.state === 'paused') {
        this.renderPause(ctx);
      }
    }

    ctx.restore();
  }

  private renderMenu(ctx: CanvasRenderingContext2D): void {
    // Dark bg
    ctx.fillStyle = BG_DARK;
    ctx.fillRect(0, 0, W, H);

    // Rain
    this.renderRain(ctx);

    // Title
    ctx.save();
    ctx.shadowColor = RED;
    ctx.shadowBlur = 20;
    ctx.fillStyle = RED;
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('IRON FIST', W / 2, 100);
    ctx.fillText('ALLEY', W / 2, 140);
    ctx.restore();

    // Subtitle
    ctx.fillStyle = '#9ca3af';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('A rain-soaked neon brawler', W / 2, 170);

    // Controls
    ctx.fillStyle = '#6b7280';
    ctx.font = '11px monospace';
    ctx.fillText('ARROWS: Move  |  Z: Punch  |  X: Kick', W / 2, 220);
    ctx.fillText('3-hit punch combo for knockdown!', W / 2, 238);

    // Flash "Press SPACE"
    const flash = Math.sin(Date.now() * 0.005) > 0;
    if (flash) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px monospace';
      ctx.fillText('PRESS SPACE', W / 2, 280);
    }

    // Neon border accents
    ctx.strokeStyle = RED;
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 20, W - 40, H - 40);
  }

  private renderGameOver(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = BG_DARK;
    ctx.fillRect(0, 0, W, H);
    this.renderRain(ctx);

    ctx.textAlign = 'center';
    if (this.gameWon) {
      ctx.save();
      ctx.shadowColor = NEON_GREEN;
      ctx.shadowBlur = 20;
      ctx.fillStyle = NEON_GREEN;
      ctx.font = 'bold 28px monospace';
      ctx.fillText('VICTORY!', W / 2, 100);
      ctx.restore();
      ctx.fillStyle = '#d1d5db';
      ctx.font = '14px monospace';
      ctx.fillText('The streets are yours.', W / 2, 140);
    } else {
      ctx.save();
      ctx.shadowColor = RED;
      ctx.shadowBlur = 20;
      ctx.fillStyle = RED;
      ctx.font = 'bold 28px monospace';
      ctx.fillText('GAME OVER', W / 2, 100);
      ctx.restore();
      ctx.fillStyle = '#d1d5db';
      ctx.font = '14px monospace';
      ctx.fillText('The streets claimed another.', W / 2, 140);
    }

    ctx.fillStyle = NEON_YELLOW;
    ctx.font = 'bold 20px monospace';
    ctx.fillText(`SCORE: ${this.score}`, W / 2, 190);

    const flash = Math.sin(Date.now() * 0.005) > 0;
    if (flash) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px monospace';
      ctx.fillText('PRESS SPACE', W / 2, 260);
    }
  }

  private renderGame(ctx: CanvasRenderingContext2D): void {
    const stage = STAGES[this.stageIndex];

    // Background
    ctx.fillStyle = stage?.bgColor ?? BG_DARK;
    ctx.fillRect(0, 0, W, H);

    // Background buildings (parallax)
    this.renderBackground(ctx);

    // Neon signs
    this.renderNeonSigns(ctx);

    // Ground
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, GROUND_Y_MIN - 10, W, H - GROUND_Y_MIN + 10);

    // Ground line
    ctx.strokeStyle = '#2d2d4a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y_MIN - 10);
    ctx.lineTo(W, GROUND_Y_MIN - 10);
    ctx.stroke();

    // Sort all fighters by Y for depth ordering
    const allFighters: { fighter: Fighter | Enemy; isPlayer: boolean }[] = [];
    allFighters.push({ fighter: this.player, isPlayer: true });
    for (const e of this.enemies) {
      if (e.alive) allFighters.push({ fighter: e, isPlayer: false });
    }
    allFighters.sort((a, b) => a.fighter.y - b.fighter.y);

    for (const f of allFighters) {
      if (f.isPlayer) {
        this.renderPlayer(ctx);
      } else {
        this.renderEnemy(ctx, f.fighter as Enemy);
      }
    }

    // Hit effects
    for (const eff of this.hitEffects) {
      const alpha = Math.min(1, eff.timer * 2);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = eff.text.startsWith('+') ? NEON_GREEN : eff.text.includes('COMBO') ? NEON_YELLOW : '#ff6b6b';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(eff.text, eff.x - this.scrollX, eff.y);
      ctx.globalAlpha = 1;
    }

    // Rain (on top)
    this.renderRain(ctx);

    // GO arrow
    if (this.showGo) {
      this.goTimer += 0;
      const blink = Math.sin(Date.now() * 0.008) > 0;
      if (blink) {
        ctx.save();
        ctx.shadowColor = NEON_GREEN;
        ctx.shadowBlur = 10;
        ctx.fillStyle = NEON_GREEN;
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('GO  >>>', W - 60, H / 2);
        ctx.restore();
      }
    }

    // HUD
    this.renderHUD(ctx);

    // Stage transition overlay
    if (this.stageTransition > 0) {
      const alpha = Math.min(1, this.stageTransition);
      ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.85})`;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.shadowColor = RED;
      ctx.shadowBlur = 15;
      ctx.fillStyle = RED;
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`STAGE ${this.stageIndex + 1}`, W / 2, H / 2 - 20);
      ctx.font = 'bold 24px monospace';
      ctx.fillText(this.stageTransitionText, W / 2, H / 2 + 10);
      ctx.restore();
    }
  }

  private renderBackground(ctx: CanvasRenderingContext2D): void {
    const parallax = this.scrollX * 0.3;
    // Simple building silhouettes
    const buildings = [
      { x: 0, w: 60, h: 120 },
      { x: 70, w: 50, h: 90 },
      { x: 130, w: 80, h: 140 },
      { x: 220, w: 45, h: 100 },
      { x: 280, w: 70, h: 130 },
      { x: 360, w: 55, h: 110 },
      { x: 430, w: 65, h: 95 },
      { x: 510, w: 80, h: 135 },
      { x: 600, w: 50, h: 105 },
    ];

    ctx.fillStyle = '#12121f';
    for (const b of buildings) {
      const bx = ((b.x - parallax) % (W + 100) + W + 100) % (W + 100) - 50;
      ctx.fillRect(bx, GROUND_Y_MIN - 10 - b.h, b.w, b.h);
      // Window dots
      ctx.fillStyle = '#1e1e35';
      for (let wy = GROUND_Y_MIN - 10 - b.h + 15; wy < GROUND_Y_MIN - 20; wy += 18) {
        for (let wx = bx + 8; wx < bx + b.w - 8; wx += 14) {
          if (Math.random() > 0.02) { // Rarely flicker off
            ctx.fillRect(wx, wy, 6, 8);
          }
        }
      }
      ctx.fillStyle = '#12121f';
    }
  }

  private renderNeonSigns(ctx: CanvasRenderingContext2D): void {
    const parallax = this.scrollX * 0.5;
    for (const sign of this.neonSigns) {
      const sx = ((sign.x - parallax) % (W + 200) + W + 200) % (W + 200) - 100;
      if (sx < -50 || sx > W + 50) continue;
      ctx.save();
      ctx.globalAlpha = sign.glow;
      ctx.shadowColor = sign.color;
      ctx.shadowBlur = 15 * sign.glow;
      ctx.fillStyle = sign.color;
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(sign.text, sx, sign.y);
      ctx.restore();
    }
  }

  private renderRain(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = 'rgba(150, 180, 255, 0.25)';
    ctx.lineWidth = 1;
    for (const r of this.rain) {
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x - 2, r.y + r.len);
      ctx.stroke();
    }
  }

  private renderPlayer(ctx: CanvasRenderingContext2D): void {
    const p = this.player;
    const sx = p.x - this.scrollX;
    const sy = p.y;

    // Invuln blink
    if (p.invulnTimer > 0 && Math.sin(p.invulnTimer * 20) > 0) return;

    ctx.save();

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(sx + PLAYER_W / 2, sy + PLAYER_H + 2, 14, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    if (p.knockdown) {
      // Lying down
      ctx.fillStyle = RED;
      ctx.fillRect(sx - 5, sy + PLAYER_H - 10, PLAYER_W + 10, 10);
      // Head
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(sx - 2, sy + PLAYER_H - 5, 6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const flip = p.facing;
      const cx = sx + PLAYER_W / 2;

      // Legs
      const walkOff = p.vx !== 0 ? Math.sin(p.walkFrame) * 4 : 0;
      ctx.strokeStyle = '#1e40af';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, sy + 24);
      ctx.lineTo(cx - 4 + walkOff, sy + PLAYER_H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, sy + 24);
      ctx.lineTo(cx + 4 - walkOff, sy + PLAYER_H);
      ctx.stroke();

      // Body
      ctx.fillStyle = RED;
      ctx.fillRect(cx - 6, sy + 10, 12, 16);

      // Arms
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 3;
      if (p.attacking === 'punch') {
        // Extended punch arm
        ctx.beginPath();
        ctx.moveTo(cx, sy + 14);
        ctx.lineTo(cx + flip * 28, sy + 14);
        ctx.stroke();
        // Fist
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(cx + flip * 24, sy + 11, 6, 6);
        // Other arm back
        ctx.beginPath();
        ctx.moveTo(cx, sy + 16);
        ctx.lineTo(cx - flip * 8, sy + 22);
        ctx.stroke();
      } else if (p.attacking === 'kick') {
        // Kick leg extended
        ctx.strokeStyle = '#1e40af';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(cx, sy + 24);
        ctx.lineTo(cx + flip * 26, sy + 26);
        ctx.stroke();
        // Boot
        ctx.fillStyle = '#374151';
        ctx.fillRect(cx + flip * 22, sy + 23, 6, 6);
        // Normal arms
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, sy + 14);
        ctx.lineTo(cx + flip * 6, sy + 22);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, sy + 14);
        ctx.lineTo(cx - flip * 6, sy + 22);
        ctx.stroke();
      } else {
        // Idle arms
        ctx.beginPath();
        ctx.moveTo(cx, sy + 14);
        ctx.lineTo(cx + flip * 8, sy + 22);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, sy + 14);
        ctx.lineTo(cx - flip * 6, sy + 24);
        ctx.stroke();
      }

      // Head
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(cx, sy + 6, 7, 0, Math.PI * 2);
      ctx.fill();

      // Headband
      ctx.strokeStyle = RED;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 7, sy + 5);
      ctx.lineTo(cx + 7, sy + 5);
      ctx.stroke();
      // Headband tail
      ctx.beginPath();
      ctx.moveTo(cx - flip * 7, sy + 5);
      ctx.lineTo(cx - flip * 13, sy + 3);
      ctx.stroke();
    }

    ctx.restore();
  }

  private renderEnemy(ctx: CanvasRenderingContext2D, e: Enemy): void {
    const sx = e.x - this.scrollX;
    const sy = e.y;

    if (e.invulnTimer > 0 && Math.sin(e.invulnTimer * 20) > 0) return;

    ctx.save();

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(sx + PLAYER_W / 2, sy + PLAYER_H + 2, 14, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    if (e.knockdown) {
      ctx.fillStyle = e.color;
      ctx.fillRect(sx - 5, sy + PLAYER_H - 10, PLAYER_W + 10, 10);
      ctx.fillStyle = '#d1d5db';
      ctx.beginPath();
      ctx.arc(sx - 2, sy + PLAYER_H - 5, 6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const flip = e.facing;
      const cx = sx + PLAYER_W / 2;

      // Legs
      const walkOff = e.vx !== 0 ? Math.sin(e.walkFrame) * 4 : 0;
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, sy + 24);
      ctx.lineTo(cx - 4 + walkOff, sy + PLAYER_H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, sy + 24);
      ctx.lineTo(cx + 4 - walkOff, sy + PLAYER_H);
      ctx.stroke();

      // Body - bigger for bruiser
      const bodyW = e.type === 'bruiser' ? 16 : 12;
      const bodyH = e.type === 'bruiser' ? 18 : 14;
      ctx.fillStyle = e.color;
      ctx.fillRect(cx - bodyW / 2, sy + 10, bodyW, bodyH);

      // Arms
      ctx.strokeStyle = '#d1d5db';
      ctx.lineWidth = e.type === 'bruiser' ? 4 : 3;
      if (e.attacking === 'punch') {
        ctx.beginPath();
        ctx.moveTo(cx, sy + 14);
        ctx.lineTo(cx + flip * 24, sy + 14);
        ctx.stroke();
        // Knife blade
        if (e.type === 'knife') {
          ctx.strokeStyle = '#e5e7eb';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx + flip * 24, sy + 14);
          ctx.lineTo(cx + flip * 36, sy + 12);
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.moveTo(cx, sy + 14);
        ctx.lineTo(cx + flip * 8, sy + 22);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, sy + 14);
        ctx.lineTo(cx - flip * 5, sy + 20);
        ctx.stroke();
        // Knife idle
        if (e.type === 'knife') {
          ctx.strokeStyle = '#e5e7eb';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx + flip * 8, sy + 22);
          ctx.lineTo(cx + flip * 14, sy + 18);
          ctx.stroke();
        }
      }

      // Head
      const headSize = e.type === 'bruiser' ? 8 : 6;
      ctx.fillStyle = '#d1d5db';
      ctx.beginPath();
      ctx.arc(cx, sy + 6, headSize, 0, Math.PI * 2);
      ctx.fill();

      // Enemy HP bar (small, above head)
      if (e.hp < e.maxHp) {
        const barW = 24;
        const barH = 3;
        const barX = cx - barW / 2;
        const barY = sy - 6;
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = RED;
        ctx.fillRect(barX, barY, barW * (e.hp / e.maxHp), barH);
      }

      // Boss crown
      if (e.maxHp === 120) {
        ctx.fillStyle = NEON_YELLOW;
        ctx.beginPath();
        ctx.moveTo(cx - 6, sy - 4);
        ctx.lineTo(cx - 6, sy - 10);
        ctx.lineTo(cx - 3, sy - 7);
        ctx.lineTo(cx, sy - 12);
        ctx.lineTo(cx + 3, sy - 7);
        ctx.lineTo(cx + 6, sy - 10);
        ctx.lineTo(cx + 6, sy - 4);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private renderHUD(ctx: CanvasRenderingContext2D): void {
    // Player HP bar
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(8, 8, 130, 30);

    ctx.fillStyle = '#9ca3af';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('PLAYER', 12, 18);

    // HP bar
    const hpW = 100;
    const hpH = 8;
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(12, 22, hpW, hpH);
    const hpRatio = this.player.hp / this.player.maxHp;
    ctx.fillStyle = hpRatio > 0.5 ? NEON_GREEN : hpRatio > 0.25 ? NEON_YELLOW : RED;
    ctx.fillRect(12, 22, hpW * hpRatio, hpH);

    // Lives
    ctx.fillStyle = RED;
    ctx.font = '10px monospace';
    ctx.fillText(`x${this.lives}`, 116, 18);

    // Score
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(W - 120, 8, 112, 16);
    ctx.fillStyle = NEON_YELLOW;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`SCORE: ${this.score}`, W - 12, 20);

    // Stage info
    const stageName = STAGES[this.stageIndex]?.name ?? '';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(W / 2 - 50, 8, 100, 14);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(stageName, W / 2, 18);

    // Enemies remaining
    const remaining = this.enemies.filter(e => e.alive).length;
    if (remaining > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(W / 2 - 30, 24, 60, 12);
      ctx.fillStyle = RED;
      ctx.font = '9px monospace';
      ctx.fillText(`FOES: ${remaining}`, W / 2, 33);
    }
  }

  private renderPause(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.shadowColor = RED;
    ctx.shadowBlur = 10;
    ctx.fillStyle = RED;
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', W / 2, H / 2);
    ctx.restore();
    ctx.fillStyle = '#9ca3af';
    ctx.font = '12px monospace';
    ctx.fillText('Press SPACE to resume', W / 2, H / 2 + 30);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.scaleX = width / W;
    this.scaleY = height / H;
  }

  getScore(): number {
    return this.score;
  }

  getState(): GameState {
    return this.state;
  }

  destroy(): void {
    // Nothing to clean up
  }
}
