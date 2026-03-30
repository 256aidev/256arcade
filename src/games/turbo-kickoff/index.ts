import { GameState, InputState, GameInfo, IGame } from '../../types/IGame';
import { audio } from '../../engine/Audio';
import { clamp, lerp, randFloat } from '../../engine/Physics';

const W = 480;
const H = 320;
const FIELD_W = 800;
const FIELD_H = 500;
const GOAL_W = 80;
const GOAL_DEPTH = 20;
const PLAYER_R = 8;
const BALL_R = 5;
const TEAL = '#14b8a6';
const ORANGE = '#f97316';
const PITCH_GREEN = '#0a3a1a';
const PITCH_LINE = '#0d5c2d';
const NEON_LINE = 'rgba(20,184,166,0.25)';
const MATCH_TIME = 90;
const EXTRA_TIME = 30;
const PASS_FORCE = 250;
const SHOOT_FORCE = 420;
const BALL_FRICTION = 0.97;
const PLAYER_SPEED = 130;
const AI_SPEED = 115;
const GK_SPEED = 100;
const TACKLE_DIST = 14;
const KICK_COOLDOWN = 0.3;
const RESTART_DELAY = 2.0;

interface Vec2 { x: number; y: number; }

interface Player {
  x: number; y: number;
  vx: number; vy: number;
  team: 0 | 1; // 0=player(teal,top), 1=cpu(orange,bottom)
  isGK: boolean;
  facingX: number; facingY: number;
  homeX: number; homeY: number;
  hasBall: boolean;
  kickCooldown: number;
}

interface Ball {
  x: number; y: number;
  vx: number; vy: number;
  owner: Player | null;
  lastKicker: Player | null;
  z: number; // height for visual only
}

function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function normalize(vx: number, vy: number): Vec2 {
  const len = Math.sqrt(vx * vx + vy * vy);
  if (len < 0.001) return { x: 0, y: 1 };
  return { x: vx / len, y: vy / len };
}

export default class TurboKickoffGame implements IGame {
  info: GameInfo = {
    id: 'turbo-kickoff',
    name: 'Turbo Kickoff',
    description: 'Fast-paced top-down future-soccer with hover-boots on a neon pitch. Score more goals than the CPU in 90 seconds!',
    genre: 'Sports',
    color: TEAL,
    controls: 'Arrows: move | Z: pass/shoot | X: switch/tackle | SPACE: start',
  };

  private state: GameState = 'menu';
  private score = 0;
  private playerGoals = 0;
  private cpuGoals = 0;
  private timer = MATCH_TIME;
  private suddenDeath = false;
  private players: Player[] = [];
  private ball: Ball = { x: 0, y: 0, vx: 0, vy: 0, owner: null, lastKicker: null, z: 0 };
  private controlledIdx = 0;
  private camX = 0;
  private camY = 0;
  private canvasW = W;
  private canvasH = H;
  private animT = 0;
  private restartTimer = 0;
  private goalFlash = 0;
  private goalMessage = '';
  private prevInput: InputState = { up: false, down: false, left: false, right: false, action1: false, action2: false, start: false };
  private action1HoldTime = 0;
  private particles: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] = [];
  private matchOver = false;
  private matchEndTimer = 0;
  private matchEndPending = false;

  async init(_canvas: HTMLCanvasElement): Promise<void> {
    this.state = 'menu';
  }

  private resetMatch(): void {
    this.playerGoals = 0;
    this.cpuGoals = 0;
    this.timer = MATCH_TIME;
    this.suddenDeath = false;
    this.matchOver = false;
    this.matchEndTimer = 0;
    this.matchEndPending = false;
    this.goalFlash = 0;
    this.goalMessage = '';
    this.setupPlayers();
    this.resetPositions();
  }

  private setupPlayers(): void {
    this.players = [];
    // Team 0 (player/teal) attacks downward (scores in bottom goal)
    // Team 1 (CPU/orange) attacks upward (scores in top goal)
    const cx = FIELD_W / 2;
    const cy = FIELD_H / 2;

    // Team 0 (teal) - player's team, attacks bottom goal
    const t0Home: [number, number, boolean][] = [
      [cx, 40, true],           // GK at top
      [cx - 100, cy - 80, false], // left mid
      [cx + 100, cy - 80, false], // right mid
      [cx, cy - 30, false],       // center mid
      [cx, cy + 80, false],       // striker
    ];
    for (const [hx, hy, isGK] of t0Home) {
      this.players.push({
        x: hx, y: hy, vx: 0, vy: 0, team: 0, isGK,
        facingX: 0, facingY: 1, homeX: hx, homeY: hy,
        hasBall: false, kickCooldown: 0,
      });
    }

    // Team 1 (orange/CPU) - attacks top goal
    const t1Home: [number, number, boolean][] = [
      [cx, FIELD_H - 40, true],    // GK at bottom
      [cx - 100, cy + 80, false],
      [cx + 100, cy + 80, false],
      [cx, cy + 30, false],
      [cx, cy - 80, false],        // striker
    ];
    for (const [hx, hy, isGK] of t1Home) {
      this.players.push({
        x: hx, y: hy, vx: 0, vy: 0, team: 1, isGK,
        facingX: 0, facingY: -1, homeX: hx, homeY: hy,
        hasBall: false, kickCooldown: 0,
      });
    }
  }

  private resetPositions(): void {
    for (const p of this.players) {
      p.x = p.homeX;
      p.y = p.homeY;
      p.vx = 0;
      p.vy = 0;
      p.hasBall = false;
      p.kickCooldown = 0;
    }
    this.ball.x = FIELD_W / 2;
    this.ball.y = FIELD_H / 2;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.owner = null;
    this.ball.lastKicker = null;
    this.ball.z = 0;
    this.restartTimer = 0;
    this.action1HoldTime = 0;
    // auto-select nearest player to ball on team 0
    this.selectNearest();
  }

  private selectNearest(): void {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.team !== 0 || p.isGK) continue;
      const d = dist(p, this.ball);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (best >= 0) this.controlledIdx = best;
  }

  update(dt: number, input: InputState): void {
    this.animT += dt;

    if (this.state === 'menu') {
      if ((input.start && !this.prevInput.start) || (input.action1 && !this.prevInput.action1)) {
        this.state = 'playing';
        this.resetMatch();
        audio.hit();
      }
      this.prevInput = { ...input };
      return;
    }

    if (this.state === 'gameover') {
      if ((input.start && !this.prevInput.start) || (input.action1 && !this.prevInput.action1)) {
        this.state = 'menu';
      }
      this.prevInput = { ...input };
      return;
    }

    if (this.state === 'paused') {
      if (input.start && !this.prevInput.start) {
        this.state = 'playing';
      }
      this.prevInput = { ...input };
      return;
    }

    // Playing state
    if (input.start && !this.prevInput.start) {
      this.state = 'paused';
      this.prevInput = { ...input };
      return;
    }

    // Match end delay (show final score for 3 seconds before gameover)
    if (this.matchEndPending) {
      this.matchEndTimer -= dt;
      this.goalFlash = Math.max(0, this.goalFlash - dt);
      this.updateParticles(dt);
      if (this.matchEndTimer <= 0) {
        this.matchOver = true;
        this.state = 'gameover';
        this.score = this.playerGoals;
      }
      this.prevInput = { ...input };
      return;
    }

    // Restart delay after goal
    if (this.restartTimer > 0) {
      this.restartTimer -= dt;
      this.goalFlash = Math.max(0, this.goalFlash - dt);
      this.updateParticles(dt);
      this.prevInput = { ...input };
      return;
    }

    // Timer
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0;
      if (!this.suddenDeath && this.playerGoals === this.cpuGoals) {
        this.suddenDeath = true;
        this.timer = EXTRA_TIME;
        this.goalMessage = 'SUDDEN DEATH!';
        this.goalFlash = 2;
      } else {
        this.matchEndPending = true;
        this.matchEndTimer = 3;
        this.goalMessage = this.playerGoals > this.cpuGoals ? 'YOU WIN!' : this.cpuGoals > this.playerGoals ? 'YOU LOSE' : 'DRAW';
        this.goalFlash = 3;
        this.score = this.playerGoals;
        if (this.playerGoals > this.cpuGoals) {
          audio.score();
        } else {
          audio.lose();
        }
        this.prevInput = { ...input };
        return;
      }
    }

    // Track action1 hold
    if (input.action1) {
      this.action1HoldTime += dt;
    } else if (this.prevInput.action1 && !input.action1) {
      // Released - kick if we have ball
      this.tryKick();
      this.action1HoldTime = 0;
    }

    // Switch player (action2 press)
    if (input.action2 && !this.prevInput.action2) {
      if (!this.ball.owner || this.ball.owner.team !== 0) {
        // Tackle attempt if near opponent with ball
        const controlled = this.players[this.controlledIdx];
        if (this.ball.owner && this.ball.owner.team === 1) {
          if (dist(controlled, this.ball.owner) < TACKLE_DIST * 2) {
            this.tackle(controlled, this.ball.owner);
          }
        }
        // Also switch to nearest
        this.switchPlayer();
      } else {
        this.switchPlayer();
      }
    }

    // Update cooldowns
    for (const p of this.players) {
      if (p.kickCooldown > 0) p.kickCooldown -= dt;
    }

    // Move controlled player
    const cp = this.players[this.controlledIdx];
    let mx = 0, my = 0;
    if (input.left) mx -= 1;
    if (input.right) mx += 1;
    if (input.up) my -= 1;
    if (input.down) my += 1;
    if (mx !== 0 || my !== 0) {
      const n = normalize(mx, my);
      cp.vx = n.x * PLAYER_SPEED;
      cp.vy = n.y * PLAYER_SPEED;
      cp.facingX = n.x;
      cp.facingY = n.y;
    } else {
      cp.vx = 0;
      cp.vy = 0;
    }

    // Update all players
    for (const p of this.players) {
      // AI movement (non-controlled players)
      if (p !== cp) {
        this.updateAI(p, dt);
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Clamp to field
      if (p.isGK) {
        // GK stays near goal line
        const goalY = p.team === 0 ? 30 : FIELD_H - 30;
        p.x = clamp(p.x, FIELD_W / 2 - 80, FIELD_W / 2 + 80);
        p.y = clamp(p.y, goalY - 20, goalY + 20);
      } else {
        p.x = clamp(p.x, PLAYER_R, FIELD_W - PLAYER_R);
        p.y = clamp(p.y, PLAYER_R, FIELD_H - PLAYER_R);
      }

      // Pick up ball if close
      if (!this.ball.owner && p.kickCooldown <= 0) {
        if (dist(p, this.ball) < PLAYER_R + BALL_R + 2) {
          this.ball.owner = p;
          p.hasBall = true;
          audio.playTone(300, 0.05, 'sine');
        }
      }

      // Tackle: controlled player vs opponent with ball
      if (p === cp && this.ball.owner && this.ball.owner.team === 1) {
        if (dist(cp, this.ball.owner) < TACKLE_DIST) {
          this.tackle(cp, this.ball.owner);
        }
      }
      // CPU tackle
      if (p.team === 1 && !p.isGK && this.ball.owner && this.ball.owner.team === 0) {
        if (dist(p, this.ball.owner) < TACKLE_DIST) {
          this.tackle(p, this.ball.owner);
        }
      }
    }

    // Ball attached to owner
    if (this.ball.owner) {
      const o = this.ball.owner;
      this.ball.x = o.x + o.facingX * (PLAYER_R + BALL_R);
      this.ball.y = o.y + o.facingY * (PLAYER_R + BALL_R);
      this.ball.vx = 0;
      this.ball.vy = 0;
    } else {
      // Ball physics
      this.ball.x += this.ball.vx * dt;
      this.ball.y += this.ball.vy * dt;
      this.ball.vx *= BALL_FRICTION;
      this.ball.vy *= BALL_FRICTION;
      if (Math.abs(this.ball.vx) < 1) this.ball.vx = 0;
      if (Math.abs(this.ball.vy) < 1) this.ball.vy = 0;

      // Bounce off side walls
      if (this.ball.x < BALL_R) { this.ball.x = BALL_R; this.ball.vx *= -0.7; }
      if (this.ball.x > FIELD_W - BALL_R) { this.ball.x = FIELD_W - BALL_R; this.ball.vx *= -0.7; }

      // Check goals or bounce off top/bottom
      const goalLeft = FIELD_W / 2 - GOAL_W / 2;
      const goalRight = FIELD_W / 2 + GOAL_W / 2;

      if (this.ball.y < BALL_R) {
        if (this.ball.x > goalLeft && this.ball.x < goalRight) {
          // Goal scored in top goal (CPU scores)
          this.cpuGoals++;
          this.onGoal(1);
        } else {
          this.ball.y = BALL_R;
          this.ball.vy *= -0.7;
        }
      }
      if (this.ball.y > FIELD_H - BALL_R) {
        if (this.ball.x > goalLeft && this.ball.x < goalRight) {
          // Goal scored in bottom goal (Player scores)
          this.playerGoals++;
          this.onGoal(0);
        } else {
          this.ball.y = FIELD_H - BALL_R;
          this.ball.vy *= -0.7;
        }
      }

      // Goal post collision
      this.goalPostCollision(goalLeft, goalRight);
    }

    // CPU auto-kick
    for (const p of this.players) {
      if (p.team === 1 && p.hasBall && this.ball.owner === p && p.kickCooldown <= 0) {
        this.cpuKick(p);
      }
    }

    // Camera follows ball
    this.camX = lerp(this.camX, this.ball.x - W / 2, 0.08);
    this.camY = lerp(this.camY, this.ball.y - H / 2, 0.08);
    this.camX = clamp(this.camX, 0, FIELD_W - W);
    this.camY = clamp(this.camY, 0, FIELD_H - H);

    this.goalFlash = Math.max(0, this.goalFlash - dt);
    this.updateParticles(dt);
    this.score = this.playerGoals;
    this.prevInput = { ...input };
  }

  private tryKick(): void {
    const cp = this.players[this.controlledIdx];
    if (!cp.hasBall || this.ball.owner !== cp || cp.kickCooldown > 0) return;

    const isShoot = this.action1HoldTime > 0.15;
    const force = isShoot ? SHOOT_FORCE : PASS_FORCE;

    if (isShoot) {
      // Shoot toward opponent goal (bottom)
      const dir = normalize(cp.facingX, cp.facingY);
      this.ball.vx = dir.x * force;
      this.ball.vy = dir.y * force;
      audio.playTone(550, 0.1, 'square');
    } else {
      // Pass: find nearest teammate in facing direction
      let bestTeammate: Player | null = null;
      let bestScore = -Infinity;
      for (const p of this.players) {
        if (p === cp || p.team !== 0) continue;
        const dx = p.x - cp.x, dy = p.y - cp.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 20 || d > 300) continue;
        const n = normalize(dx, dy);
        const dot = n.x * cp.facingX + n.y * cp.facingY;
        if (dot > 0.2) {
          const sc = dot / d * 1000;
          if (sc > bestScore) { bestScore = sc; bestTeammate = p; }
        }
      }
      if (bestTeammate) {
        const dx = bestTeammate.x - cp.x;
        const dy = bestTeammate.y - cp.y;
        const n = normalize(dx, dy);
        this.ball.vx = n.x * force;
        this.ball.vy = n.y * force;
      } else {
        // Just kick forward
        this.ball.vx = cp.facingX * force;
        this.ball.vy = cp.facingY * force;
      }
      audio.playTone(400, 0.08, 'sine');
    }

    cp.hasBall = false;
    this.ball.owner = null;
    this.ball.lastKicker = cp;
    cp.kickCooldown = KICK_COOLDOWN;
    // Spawn trail particles
    for (let i = 0; i < 5; i++) {
      this.particles.push({
        x: this.ball.x, y: this.ball.y,
        vx: randFloat(-30, 30), vy: randFloat(-30, 30),
        life: 0.3, color: TEAL,
      });
    }
  }

  private tackle(tackler: Player, ballHolder: Player): void {
    // 70% success chance
    if (Math.random() < 0.7) {
      ballHolder.hasBall = false;
      this.ball.owner = null;
      ballHolder.kickCooldown = 0.5;
      // Ball goes loose
      this.ball.vx = randFloat(-60, 60);
      this.ball.vy = randFloat(-60, 60);
      audio.playTone(200, 0.08, 'square');
      for (let i = 0; i < 4; i++) {
        this.particles.push({
          x: ballHolder.x, y: ballHolder.y,
          vx: randFloat(-50, 50), vy: randFloat(-50, 50),
          life: 0.4, color: '#ffffff',
        });
      }
    } else {
      // Foul: tackler bounces back
      const dx = tackler.x - ballHolder.x;
      const dy = tackler.y - ballHolder.y;
      const n = normalize(dx, dy);
      tackler.x += n.x * 15;
      tackler.y += n.y * 15;
      tackler.kickCooldown = 0.8;
      audio.playTone(150, 0.1, 'sawtooth');
    }
  }

  private switchPlayer(): void {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.players.length; i++) {
      if (i === this.controlledIdx) continue;
      const p = this.players[i];
      if (p.team !== 0 || p.isGK) continue;
      const d = dist(p, this.ball);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (best >= 0) this.controlledIdx = best;
  }

  private cpuKick(p: Player): void {
    // CPU decision: shoot if near top goal, else pass
    const goalTarget = { x: FIELD_W / 2 + randFloat(-30, 30), y: 0 };
    const distToGoal = dist(p, goalTarget);

    if (distToGoal < 180) {
      // Shoot
      const dir = normalize(goalTarget.x - p.x, goalTarget.y - p.y);
      this.ball.vx = dir.x * SHOOT_FORCE * 0.85;
      this.ball.vy = dir.y * SHOOT_FORCE * 0.85;
      p.facingX = dir.x;
      p.facingY = dir.y;
      audio.playTone(500, 0.08, 'square');
    } else {
      // Pass or dribble forward
      const teammates = this.players.filter(t => t !== p && t.team === 1 && !t.isGK);
      const forward = teammates.filter(t => t.y < p.y);
      const target = forward.length > 0
        ? forward[Math.floor(Math.random() * forward.length)]
        : { x: FIELD_W / 2, y: p.y - 100 };
      const dir = normalize(target.x - p.x, target.y - p.y);
      this.ball.vx = dir.x * PASS_FORCE * 0.8;
      this.ball.vy = dir.y * PASS_FORCE * 0.8;
      p.facingX = dir.x;
      p.facingY = dir.y;
      audio.playTone(350, 0.06, 'sine');
    }

    p.hasBall = false;
    this.ball.owner = null;
    this.ball.lastKicker = p;
    p.kickCooldown = KICK_COOLDOWN + 0.2;
  }

  private updateAI(p: Player, dt: number): void {
    if (p.isGK) {
      this.updateGKAI(p, dt);
      return;
    }

    const speed = p.team === 1 ? AI_SPEED : AI_SPEED * 0.95;
    const hasPossession = this.ball.owner && this.ball.owner.team === p.team;

    if (p.hasBall) {
      // Handled by cpuKick / player input
      return;
    }

    let tx = p.homeX, ty = p.homeY;

    if (p.team === 1) {
      // CPU team AI
      if (!hasPossession) {
        // Chase ball
        const nearestToBall = this.players
          .filter(pl => pl.team === 1 && !pl.isGK && !pl.hasBall)
          .sort((a, b) => dist(a, this.ball) - dist(b, this.ball));
        if (nearestToBall.length > 0 && nearestToBall[0] === p) {
          tx = this.ball.x;
          ty = this.ball.y;
        } else {
          // Support: drift toward ball side
          tx = lerp(p.homeX, this.ball.x, 0.4);
          ty = lerp(p.homeY, this.ball.y, 0.3);
        }
      } else {
        // Teammate has ball: get into position forward
        tx = lerp(p.homeX, FIELD_W / 2, 0.3);
        ty = p.homeY - 40;
      }
    } else {
      // Player's teammates AI
      if (hasPossession) {
        // Get open for a pass
        tx = lerp(p.homeX, this.ball.x + randFloat(-50, 50), 0.4);
        ty = lerp(p.homeY, this.ball.y + 60, 0.3);
      } else {
        // Defend: drift toward ball
        tx = lerp(p.homeX, this.ball.x, 0.35);
        ty = lerp(p.homeY, this.ball.y, 0.25);
      }
    }

    const dx = tx - p.x, dy = ty - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 5) {
      const n = normalize(dx, dy);
      p.vx = n.x * speed;
      p.vy = n.y * speed;
      p.facingX = n.x;
      p.facingY = n.y;
    } else {
      p.vx = 0;
      p.vy = 0;
    }
  }

  private updateGKAI(p: Player, _dt: number): void {
    // GK follows ball x within goal area
    const goalY = p.team === 0 ? 30 : FIELD_H - 30;
    const tx = clamp(this.ball.x, FIELD_W / 2 - GOAL_W / 2 + 10, FIELD_W / 2 + GOAL_W / 2 - 10);
    const dx = tx - p.x;
    if (Math.abs(dx) > 3) {
      p.vx = dx > 0 ? GK_SPEED : -GK_SPEED;
    } else {
      p.vx = 0;
    }
    // Stay on goal line
    const dy = goalY - p.y;
    p.vy = dy * 2;
    p.facingX = 0;
    p.facingY = p.team === 0 ? 1 : -1;

    // GK save: if ball is very close and free, grab it
    if (!this.ball.owner && dist(p, this.ball) < PLAYER_R + BALL_R + 6 && p.kickCooldown <= 0) {
      this.ball.owner = p;
      p.hasBall = true;
      // GK punts the ball
      const dir = p.team === 0 ? 1 : -1;
      setTimeout(() => {
        if (this.ball.owner === p) {
          this.ball.vx = randFloat(-80, 80);
          this.ball.vy = dir * PASS_FORCE * 0.9;
          p.hasBall = false;
          this.ball.owner = null;
          this.ball.lastKicker = p;
          p.kickCooldown = 1.0;
        }
      }, 300);
    }
  }

  private goalPostCollision(goalLeft: number, goalRight: number): void {
    // Top goal posts
    for (const px of [goalLeft, goalRight]) {
      for (const py of [0]) {
        const d = dist(this.ball, { x: px, y: py });
        if (d < BALL_R + 4) {
          const nx = (this.ball.x - px) / d;
          const ny = (this.ball.y - py) / d;
          this.ball.vx = nx * Math.abs(this.ball.vx) * 0.5 + nx * 50;
          this.ball.vy = Math.abs(this.ball.vy) * 0.5;
          this.ball.x = px + nx * (BALL_R + 5);
          this.ball.y = py + ny * (BALL_R + 5);
          audio.playTone(800, 0.05, 'square');
        }
      }
    }
    // Bottom goal posts
    for (const px of [goalLeft, goalRight]) {
      const py = FIELD_H;
      const d = dist(this.ball, { x: px, y: py });
      if (d < BALL_R + 4) {
        const nx = (this.ball.x - px) / d;
        const ny = (this.ball.y - py) / d;
        this.ball.vx = nx * Math.abs(this.ball.vx) * 0.5 + nx * 50;
        this.ball.vy = -Math.abs(this.ball.vy) * 0.5;
        this.ball.x = px + nx * (BALL_R + 5);
        this.ball.y = py + ny * (BALL_R + 5);
        audio.playTone(800, 0.05, 'square');
      }
    }
  }

  private onGoal(scoringTeam: 0 | 1): void {
    this.goalMessage = scoringTeam === 0 ? 'GOAL!!' : 'CPU SCORES!';
    this.goalFlash = RESTART_DELAY;
    this.restartTimer = RESTART_DELAY;
    this.score = this.playerGoals;

    // Goal celebration particles
    for (let i = 0; i < 20; i++) {
      this.particles.push({
        x: this.ball.x, y: this.ball.y,
        vx: randFloat(-100, 100), vy: randFloat(-100, 100),
        life: 1.0, color: scoringTeam === 0 ? TEAL : ORANGE,
      });
    }

    if (scoringTeam === 0) {
      audio.score();
    } else {
      audio.lose();
    }

    // Check sudden death
    if (this.suddenDeath) {
      // Game over after showing result for 3 seconds
      this.matchEndPending = true;
      this.matchEndTimer = 3;
      this.goalMessage = scoringTeam === 0 ? 'YOU WIN!' : 'YOU LOSE';
      this.goalFlash = 3;
    } else {
      setTimeout(() => {
        if (this.state === 'playing') this.resetPositions();
      }, RESTART_DELAY * 1000);
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

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvasW, this.canvasH);

    if (this.state === 'menu') {
      this.renderMenu(ctx);
      ctx.restore();
      return;
    }

    if (this.state === 'gameover') {
      this.renderField(ctx);
      this.renderGameOver(ctx);
      ctx.restore();
      return;
    }

    this.renderField(ctx);

    if (this.matchEndPending) {
      const alpha = Math.min(0.7, (3 - this.matchEndTimer) * 0.4);
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = TEAL;
      ctx.shadowBlur = 15;
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px monospace';
      ctx.fillText('FULL TIME', W / 2, H / 2 - 50);
      ctx.shadowBlur = 0;
      ctx.font = 'bold 36px monospace';
      ctx.fillStyle = TEAL;
      ctx.fillText(`${this.playerGoals}`, W / 2 - 50, H / 2);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px monospace';
      ctx.fillText('-', W / 2, H / 2);
      ctx.fillStyle = ORANGE;
      ctx.font = 'bold 36px monospace';
      ctx.fillText(`${this.cpuGoals}`, W / 2 + 50, H / 2);
      ctx.font = 'bold 18px monospace';
      if (this.playerGoals > this.cpuGoals) {
        ctx.fillStyle = TEAL;
        ctx.fillText('YOU WIN!', W / 2, H / 2 + 45);
      } else if (this.cpuGoals > this.playerGoals) {
        ctx.fillStyle = ORANGE;
        ctx.fillText('YOU LOSE', W / 2, H / 2 + 45);
      } else {
        ctx.fillStyle = '#fff';
        ctx.fillText('DRAW', W / 2, H / 2 + 45);
      }
    }

    if (this.state === 'paused') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, H / 2);
      ctx.font = '12px monospace';
      ctx.fillText('Press SPACE to resume', W / 2, H / 2 + 25);
    }

    ctx.restore();
  }

  private renderMenu(ctx: CanvasRenderingContext2D): void {
    // Animated background
    ctx.fillStyle = PITCH_GREEN;
    ctx.fillRect(0, 0, W, H);

    // Neon grid
    ctx.strokeStyle = NEON_LINE;
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y < H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Title
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Glow effect
    ctx.shadowColor = TEAL;
    ctx.shadowBlur = 20;
    ctx.fillStyle = TEAL;
    ctx.font = 'bold 36px monospace';
    ctx.fillText('TURBO', W / 2, H / 2 - 50);
    ctx.fillText('KICKOFF', W / 2, H / 2 - 10);
    ctx.shadowBlur = 0;

    // Ball icon
    const by = H / 2 + 30 + Math.sin(this.animT * 3) * 5;
    ctx.beginPath();
    ctx.arc(W / 2, by, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe066';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Prompt
    const alpha = 0.5 + 0.5 * Math.sin(this.animT * 4);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fff';
    ctx.font = '14px monospace';
    ctx.fillText('Press SPACE to start', W / 2, H / 2 + 70);
    ctx.globalAlpha = 1;

    // Controls help box
    const boxW = 380;
    const boxH = 32;
    const boxX = (W - boxW) / 2;
    const boxY = H - 50;
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.font = '11px monospace';
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 1;
    ctx.fillText('ARROWS = Move | Z = Pass/Shoot | X = Switch/Tackle', W / 2, boxY + boxH / 2 + 1);
  }

  private renderField(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(-this.camX, -this.camY);

    // Pitch background
    ctx.fillStyle = PITCH_GREEN;
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);

    // Grid lines
    ctx.strokeStyle = NEON_LINE;
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= FIELD_W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, FIELD_H);
      ctx.stroke();
    }
    for (let y = 0; y <= FIELD_H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(FIELD_W, y);
      ctx.stroke();
    }

    // Field markings
    ctx.strokeStyle = PITCH_LINE;
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, FIELD_W - 20, FIELD_H - 20);

    // Center line
    ctx.beginPath();
    ctx.moveTo(10, FIELD_H / 2);
    ctx.lineTo(FIELD_W - 10, FIELD_H / 2);
    ctx.stroke();

    // Center circle
    ctx.beginPath();
    ctx.arc(FIELD_W / 2, FIELD_H / 2, 50, 0, Math.PI * 2);
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(FIELD_W / 2, FIELD_H / 2, 3, 0, Math.PI * 2);
    ctx.fillStyle = PITCH_LINE;
    ctx.fill();

    // Goal areas
    const goalLeft = FIELD_W / 2 - GOAL_W / 2;
    const goalRight = FIELD_W / 2 + GOAL_W / 2;

    // Top goal
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = 3;
    ctx.shadowColor = TEAL;
    ctx.shadowBlur = 10;
    ctx.strokeRect(goalLeft, -GOAL_DEPTH, GOAL_W, GOAL_DEPTH + 2);
    ctx.shadowBlur = 0;

    // Top penalty area
    ctx.strokeStyle = PITCH_LINE;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(FIELD_W / 2 - 100, 10, 200, 60);

    // Bottom goal
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 3;
    ctx.shadowColor = ORANGE;
    ctx.shadowBlur = 10;
    ctx.strokeRect(goalLeft, FIELD_H - 2, GOAL_W, GOAL_DEPTH);
    ctx.shadowBlur = 0;

    // Bottom penalty area
    ctx.strokeStyle = PITCH_LINE;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(FIELD_W / 2 - 100, FIELD_H - 70, 200, 60);

    // Goal nets (shading)
    ctx.fillStyle = 'rgba(20,184,166,0.1)';
    ctx.fillRect(goalLeft, -GOAL_DEPTH, GOAL_W, GOAL_DEPTH);
    ctx.fillStyle = 'rgba(249,115,22,0.1)';
    ctx.fillRect(goalLeft, FIELD_H, GOAL_W, GOAL_DEPTH);

    // Particles
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Ball shadow
    if (!this.ball.owner) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(this.ball.x + 2, this.ball.y + 3, BALL_R + 1, BALL_R * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Players
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const color = p.team === 0 ? TEAL : ORANGE;

      // Player shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(p.x + 1, p.y + 3, PLAYER_R, PLAYER_R * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Highlight ring for controlled player
      if (i === this.controlledIdx) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, PLAYER_R + 4, 0, Math.PI * 2);
        ctx.stroke();
        // Pulsing ring
        const pulseR = PLAYER_R + 6 + Math.sin(this.animT * 6) * 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, pulseR, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Player body
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, PLAYER_R, 0, Math.PI * 2);
      ctx.fill();

      // GK marker
      if (p.isGK) {
        ctx.fillStyle = p.team === 0 ? '#0d9488' : '#c2410c';
        ctx.beginPath();
        ctx.arc(p.x, p.y, PLAYER_R - 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Direction indicator
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.facingX * (PLAYER_R + 3), p.y + p.facingY * (PLAYER_R + 3));
      ctx.stroke();

      // Hover-boot glow
      ctx.fillStyle = `rgba(${p.team === 0 ? '20,184,166' : '249,115,22'},0.3)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y + PLAYER_R - 1, PLAYER_R * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ball
    if (!this.ball.owner || this.restartTimer > 0) {
      // Ball glow
      ctx.shadowColor = '#ffe066';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#ffe066';
      ctx.beginPath();
      ctx.arc(this.ball.x, this.ball.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(this.ball.x, this.ball.y, BALL_R, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();

    // HUD
    this.renderHUD(ctx);

    // Goal flash overlay
    if (this.goalFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.goalFlash * 0.15})`;
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = TEAL;
      ctx.shadowBlur = 15;
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px monospace';
      ctx.fillText(this.goalMessage, W / 2, H / 2);
      ctx.shadowBlur = 0;
    }
  }

  private renderHUD(ctx: CanvasRenderingContext2D): void {
    // Score bar background
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, W, 24);

    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px monospace';

    // Player score
    ctx.textAlign = 'left';
    ctx.fillStyle = TEAL;
    ctx.fillText(`YOU  ${this.playerGoals}`, 10, 12);

    // Timer
    ctx.textAlign = 'center';
    const mins = Math.floor(this.timer / 60);
    const secs = Math.floor(this.timer % 60);
    const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
    ctx.fillStyle = this.timer < 10 ? '#ff4444' : '#fff';
    ctx.fillText(timeStr, W / 2, 12);

    if (this.suddenDeath) {
      ctx.font = '9px monospace';
      ctx.fillStyle = '#ff4444';
      ctx.fillText('SUDDEN DEATH', W / 2, 22);
    }

    // CPU score
    ctx.textAlign = 'right';
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = ORANGE;
    ctx.fillText(`${this.cpuGoals}  CPU`, W - 10, 12);

    // Ball possession indicator (small dot)
    if (this.ball.owner) {
      const c = this.ball.owner.team === 0 ? TEAL : ORANGE;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(W / 2, 20, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderGameOver(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.shadowColor = TEAL;
    ctx.shadowBlur = 15;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px monospace';
    ctx.fillText('FULL TIME', W / 2, H / 2 - 60);
    ctx.shadowBlur = 0;

    ctx.font = 'bold 36px monospace';
    ctx.fillStyle = TEAL;
    ctx.fillText(`${this.playerGoals}`, W / 2 - 60, H / 2 - 10);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('-', W / 2, H / 2 - 10);
    ctx.fillStyle = ORANGE;
    ctx.font = 'bold 36px monospace';
    ctx.fillText(`${this.cpuGoals}`, W / 2 + 60, H / 2 - 10);

    ctx.font = '14px monospace';
    ctx.fillStyle = '#aaa';
    ctx.fillText('YOU', W / 2 - 60, H / 2 + 20);
    ctx.fillText('CPU', W / 2 + 60, H / 2 + 20);

    ctx.font = 'bold 18px monospace';
    if (this.playerGoals > this.cpuGoals) {
      ctx.fillStyle = TEAL;
      ctx.fillText('YOU WIN!', W / 2, H / 2 + 55);
    } else if (this.cpuGoals > this.playerGoals) {
      ctx.fillStyle = ORANGE;
      ctx.fillText('YOU LOSE', W / 2, H / 2 + 55);
    } else {
      ctx.fillStyle = '#fff';
      ctx.fillText('DRAW', W / 2, H / 2 + 55);
    }

    const alpha = 0.5 + 0.5 * Math.sin(this.animT * 4);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.fillText('Press SPACE for menu', W / 2, H / 2 + 85);
    ctx.globalAlpha = 1;
  }

  resize(width: number, height: number): void {
    this.canvasW = width;
    this.canvasH = height;
  }

  getScore(): number {
    return this.score;
  }

  getState(): GameState {
    return this.state;
  }

  destroy(): void {
    this.players = [];
    this.particles = [];
  }
}
