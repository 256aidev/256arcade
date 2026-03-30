import { IGame, GameInfo, GameState, InputState } from '../../types/IGame';
import { audio } from '../../engine/Audio';
import { clamp, lerp, randInt, randFloat } from '../../engine/Physics';

// ── Constants ──────────────────────────────────────────────────────────
const W = 480;
const H = 320;
const PINK = '#ec4899';
const PINK_DIM = '#9d174d';
const ROAD_W = 2000;       // road half-width in world units
const SEG_LEN = 200;       // length of each road segment in world Z
const DRAW_DIST = 150;     // how many segments ahead to draw
const TOTAL_SEGS = 600;    // total segments per lap
const CAMERA_H = 1000;     // camera height above road
const CAMERA_DEPTH = 1 / Math.tan(50 * Math.PI / 180); // FOV ~100deg
const MAX_SPEED = 12000;   // world units/sec at 200mph
const ACCEL = 8000;
const BRAKE = 16000;
const DECEL = 4000;        // natural deceleration
const OFF_ROAD_DECEL = 12000;
const STEER_SPEED = 3.0;
const CENTRIFUGAL = 0.3;
const LAP_COUNT = 3;
const LAP_TIME_LIMIT = 45;
const OVERTAKE_POINTS = 50;

// ── Types ──────────────────────────────────────────────────────────────
interface Segment {
  index: number;
  p1: ProjectedPoint;
  p2: ProjectedPoint;
  curve: number;
  hill: number;
  color: SegColor;
  sprites: Sprite[];
  cars: AICar[];
}

interface ProjectedPoint {
  world: { x: number; y: number; z: number };
  screen: { x: number; y: number; w: number };
  scale: number;
}

interface SegColor {
  road: string;
  rumble: string;
  lane: string;
  grass: string;
}

interface Sprite {
  offset: number; // -1 to 1 from road center, >1 or <-1 = off road
  type: 'cactus' | 'rock' | 'sign' | 'pillar';
}

interface AICar {
  offset: number;
  speed: number;
  z: number;
  color: string;
  passed: boolean;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string;
}

// ── Color palettes ─────────────────────────────────────────────────────
const LIGHT_SEG: SegColor = { road: '#6b6b6b', rumble: '#cc0000', lane: '#cccccc', grass: '#c2a366' };
const DARK_SEG: SegColor = { road: '#606060', rumble: '#ffffff', lane: '#606060', grass: '#b89858' };
const TUNNEL_LIGHT: SegColor = { road: '#555566', rumble: PINK, lane: '#ec489966', grass: '#1a1a2e' };
const TUNNEL_DARK: SegColor = { road: '#444455', rumble: '#9d174d', lane: '#444455', grass: '#15152a' };

const AI_COLORS = ['#ff4444', '#44ff44', '#4488ff', '#ffff44', '#ff44ff', '#44ffff', '#ff8844', '#88ff44'];

// ── Game Class ─────────────────────────────────────────────────────────
export default class NitroCircuitGame implements IGame {
  info: GameInfo = {
    id: 'nitro-circuit',
    name: 'Nitro Circuit',
    description: 'Pseudo-3D desert canyon racer',
    genre: 'Racing',
    color: PINK,
    controls: 'Arrow keys to drive, SPACE to start',
  };

  private state: GameState = 'menu';
  private canvasW = W;
  private canvasH = H;

  // Road
  private segments: Segment[] = [];
  private trackLength = 0;

  // Player
  private position = 0;     // Z position along track
  private speed = 0;         // world units/sec
  private playerX = 0;       // -1 to 1 (road position)
  private steerInput = 0;

  // Race state
  private lap = 0;
  private lapTime = 0;
  private lapTimes: number[] = [];
  private totalTime = 0;
  private score = 0;
  private carsOvertaken = 0;
  private finished = false;
  private timeUp = false;

  // AI cars
  private aiCars: AICar[] = [];

  // Effects
  private menuPulse = 0;
  private particles: Particle[] = [];
  private shakeTimer = 0;
  private engineSoundTimer = 0;
  private countdownTimer = 0;
  private countdownValue = 0;
  private raceStarted = false;
  private lapMessage = '';
  private lapMessageTimer = 0;
  private raceEndTimer = 0;
  private raceEndPending = false;

  // ── Interface Methods ──────────────────────────────────────────────

  async init(_canvas: HTMLCanvasElement): Promise<void> {
    this.state = 'menu';
    this.buildTrack();
  }

  update(dt: number, input: InputState): void {
    dt = Math.min(dt, 0.05); // cap delta

    if (this.state === 'menu') {
      this.menuPulse += dt;
      if (input.action1 || input.start) {
        this.startRace();
      }
      return;
    }

    if (this.state === 'gameover') {
      this.menuPulse += dt;
      if (input.action1 || input.start) {
        this.startRace();
      }
      return;
    }

    if (this.state === 'paused') {
      if (input.start) this.state = 'playing';
      return;
    }

    if (this.state === 'playing') {
      if (input.start) {
        this.state = 'paused';
        return;
      }

      // Countdown
      if (!this.raceStarted) {
        this.countdownTimer += dt;
        if (this.countdownTimer < 1) this.countdownValue = 3;
        else if (this.countdownTimer < 2) this.countdownValue = 2;
        else if (this.countdownTimer < 3) this.countdownValue = 1;
        else {
          this.countdownValue = 0;
          this.raceStarted = true;
          audio.playTone(880, 0.3, 'square');
        }
        if (this.countdownValue > 0 && this.countdownTimer % 1 < dt) {
          audio.playTone(440, 0.2, 'square');
        }
        return;
      }

      this.updateDriving(dt, input);
      this.updateAICars(dt);
      this.updateParticles(dt);
      this.updateTimers(dt);
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();

    // Screen shake
    if (this.shakeTimer > 0) {
      const intensity = this.shakeTimer * 8;
      ctx.translate(randFloat(-intensity, intensity), randFloat(-intensity, intensity));
    }

    if (this.state === 'menu') {
      this.renderMenu(ctx);
    } else if (this.state === 'gameover') {
      this.renderGameOver(ctx);
    } else {
      this.renderRoad(ctx);
      this.renderHUD(ctx);
      if (this.lapMessageTimer > 0) this.renderLapMessage(ctx);
      if (this.raceEndPending) this.renderRaceEndOverlay(ctx);
      if (!this.raceStarted) this.renderCountdown(ctx);
      if (this.state === 'paused') this.renderPaused(ctx);
    }

    ctx.restore();
  }

  resize(width: number, height: number): void {
    this.canvasW = width;
    this.canvasH = height;
  }

  getScore(): number { return this.score; }
  getState(): GameState { return this.state; }
  destroy(): void { }

  // ── Track Builder ──────────────────────────────────────────────────

  private buildTrack(): void {
    this.segments = [];

    const addSegments = (count: number, curve: number, hill: number) => {
      for (let i = 0; i < count; i++) {
        const idx = this.segments.length;
        // Ease curve in/out
        const easeIn = i < 25 ? i / 25 : 1;
        const easeOut = i > count - 25 ? (count - i) / 25 : 1;
        const ease = Math.min(easeIn, easeOut);

        // Determine if tunnel section
        const isTunnel = idx >= 200 && idx < 280;
        const isLight = idx % 2 === 0;
        let color: SegColor;
        if (isTunnel) {
          color = isLight ? TUNNEL_LIGHT : TUNNEL_DARK;
        } else {
          color = isLight ? LIGHT_SEG : DARK_SEG;
        }

        const seg: Segment = {
          index: idx,
          p1: this.makePoint(idx),
          p2: this.makePoint(idx + 1),
          curve: curve * ease,
          hill: hill * ease,
          color,
          sprites: [],
          cars: [],
        };
        this.segments.push(seg);
      }
    };

    // Build track layout - varied terrain
    addSegments(50, 0, 0);        // straight
    addSegments(50, 2, 0);        // gentle right
    addSegments(30, 0, 20);       // uphill straight
    addSegments(40, -3, 0);       // sharp left
    addSegments(30, 0, -15);      // downhill
    addSegments(40, 1.5, 10);     // gentle right uphill
    addSegments(80, 0, 0);        // tunnel straight (200-280)
    addSegments(50, -2, -10);     // left downhill
    addSegments(60, 4, 0);        // hard right
    addSegments(40, 0, 20);       // uphill
    addSegments(50, -1, -20);     // gentle left downhill
    addSegments(30, 0, 0);        // finish straight

    // Fill to TOTAL_SEGS
    while (this.segments.length < TOTAL_SEGS) {
      const idx = this.segments.length;
      const isLight = idx % 2 === 0;
      this.segments.push({
        index: idx,
        p1: this.makePoint(idx),
        p2: this.makePoint(idx + 1),
        curve: 0,
        hill: 0,
        color: isLight ? LIGHT_SEG : DARK_SEG,
        sprites: [],
        cars: [],
      });
    }

    this.trackLength = TOTAL_SEGS * SEG_LEN;

    // Place roadside sprites
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      const isTunnel = i >= 200 && i < 280;

      if (i % 5 === 0) {
        const side = i % 2 === 0 ? 1 : -1;
        if (isTunnel) {
          seg.sprites.push({ offset: side * 1.4, type: 'pillar' });
        } else {
          const r = Math.random();
          if (r < 0.4) {
            seg.sprites.push({ offset: side * (1.2 + randFloat(0, 0.5)), type: 'cactus' });
          } else if (r < 0.7) {
            seg.sprites.push({ offset: side * (1.1 + randFloat(0, 0.3)), type: 'rock' });
          } else {
            seg.sprites.push({ offset: side * 1.3, type: 'sign' });
          }
        }
      }
    }
  }

  private makePoint(index: number): ProjectedPoint {
    return {
      world: { x: 0, y: 0, z: index * SEG_LEN },
      screen: { x: 0, y: 0, w: 0 },
      scale: 0,
    };
  }

  // ── Race Control ───────────────────────────────────────────────────

  private startRace(): void {
    this.buildTrack();
    this.position = 0;
    this.speed = 0;
    this.playerX = 0;
    this.steerInput = 0;
    this.lap = 1;
    this.lapTime = 0;
    this.lapTimes = [];
    this.totalTime = 0;
    this.score = 0;
    this.carsOvertaken = 0;
    this.finished = false;
    this.timeUp = false;
    this.particles = [];
    this.shakeTimer = 0;
    this.countdownTimer = 0;
    this.countdownValue = 3;
    this.raceStarted = false;
    this.lapMessage = '';
    this.lapMessageTimer = 0;
    this.raceEndTimer = 0;
    this.raceEndPending = false;

    // Spawn AI cars
    this.aiCars = [];
    const carCount = randInt(5, 8);
    for (let i = 0; i < carCount; i++) {
      this.aiCars.push({
        offset: randFloat(-0.6, 0.6),
        speed: randFloat(MAX_SPEED * 0.3, MAX_SPEED * 0.6),
        z: randFloat(SEG_LEN * 30, this.trackLength - SEG_LEN * 30),
        color: AI_COLORS[i % AI_COLORS.length],
        passed: false,
      });
    }

    // Assign cars to segments for rendering
    this.assignCarsToSegments();
    this.state = 'playing';
  }

  private assignCarsToSegments(): void {
    for (const seg of this.segments) seg.cars = [];
    for (const car of this.aiCars) {
      const segIdx = Math.floor((car.z % this.trackLength) / SEG_LEN) % this.segments.length;
      this.segments[segIdx].cars.push(car);
    }
  }

  // ── Driving Update ─────────────────────────────────────────────────

  private updateDriving(dt: number, input: InputState): void {
    const seg = this.segments[Math.floor(this.position / SEG_LEN) % this.segments.length];
    const speedRatio = this.speed / MAX_SPEED;
    const offRoad = Math.abs(this.playerX) > 1.0;

    // Acceleration / braking
    if (input.up) {
      this.speed += ACCEL * dt;
    } else {
      this.speed -= DECEL * dt;
    }
    if (input.down) {
      this.speed -= BRAKE * dt;
    }
    if (offRoad) {
      this.speed -= OFF_ROAD_DECEL * dt;
    }

    this.speed = clamp(this.speed, 0, MAX_SPEED);

    // Steering
    if (this.speed > 0) {
      if (input.left) this.steerInput = -STEER_SPEED;
      else if (input.right) this.steerInput = STEER_SPEED;
      else this.steerInput = 0;

      this.playerX += this.steerInput * speedRatio * dt;

      // Centrifugal force from curves
      this.playerX += seg.curve * CENTRIFUGAL * speedRatio * dt;
    }

    // Clamp player to off-road edges (but allow going a bit off)
    this.playerX = clamp(this.playerX, -2.5, 2.5);

    // Position update
    this.position += this.speed * dt;

    // Lap detection
    if (this.position >= this.trackLength) {
      this.position -= this.trackLength;
      this.lapTimes.push(this.lapTime);

      // Reset AI car passed status on new lap
      for (const car of this.aiCars) car.passed = false;

      if (this.lap >= LAP_COUNT) {
        this.finishRace();
        return;
      }
      this.lapMessage = `LAP ${this.lap} COMPLETE!`;
      this.lapMessageTimer = 1.5;
      this.lap++;
      this.lapTime = 0;
      audio.playTone(660, 0.15, 'square');
      audio.playTone(880, 0.15, 'square');
    }

    // Collision with roadside objects
    if (offRoad && this.speed > MAX_SPEED * 0.1) {
      const segIdx = Math.floor(this.position / SEG_LEN) % this.segments.length;
      const s = this.segments[segIdx];
      for (const spr of s.sprites) {
        if (Math.abs(this.playerX - spr.offset) < 0.3) {
          this.speed *= 0.3;
          this.shakeTimer = 0.3;
          audio.hit();
          this.spawnCollisionParticles();
          break;
        }
      }
    }

    // Collision with AI cars
    for (const car of this.aiCars) {
      const relZ = car.z - this.position;
      const wrappedZ = ((relZ % this.trackLength) + this.trackLength) % this.trackLength;
      if (wrappedZ < SEG_LEN * 2 && wrappedZ > 0) {
        if (Math.abs(this.playerX - car.offset) < 0.4) {
          this.speed *= 0.5;
          this.shakeTimer = 0.2;
          audio.hit();
          break;
        }
      }
    }

    // Engine sound
    this.engineSoundTimer -= dt;
    if (this.engineSoundTimer <= 0 && this.speed > 100) {
      const freq = 60 + speedRatio * 120;
      audio.playTone(freq, 0.08, 'sawtooth');
      this.engineSoundTimer = 0.12 - speedRatio * 0.06;
    }

    // Tire squeal on sharp turns
    if (Math.abs(this.steerInput) > 1 && this.speed > MAX_SPEED * 0.4) {
      if (Math.random() < 0.1) {
        audio.playNoise(0.05);
      }
    }

    // Score: distance
    this.score = Math.floor(this.position / SEG_LEN) + this.lap * 100 + this.carsOvertaken * OVERTAKE_POINTS;
  }

  // ── AI Cars ────────────────────────────────────────────────────────

  private updateAICars(dt: number): void {
    for (const car of this.aiCars) {
      car.z += car.speed * dt;
      if (car.z >= this.trackLength) car.z -= this.trackLength;

      // Weave slightly
      car.offset += Math.sin(car.z * 0.001) * dt * 0.3;
      car.offset = clamp(car.offset, -0.8, 0.8);

      // Check if player has passed this car
      if (!car.passed) {
        const relZ = car.z - this.position;
        const wrappedZ = ((relZ % this.trackLength) + this.trackLength) % this.trackLength;
        if (wrappedZ > this.trackLength * 0.5) {
          car.passed = true;
          this.carsOvertaken++;
          audio.score();
        }
      }
    }
    this.assignCarsToSegments();
  }

  // ── Timers ─────────────────────────────────────────────────────────

  private updateTimers(dt: number): void {
    this.lapTime += dt;
    this.totalTime += dt;
    this.shakeTimer = Math.max(0, this.shakeTimer - dt);
    if (this.lapMessageTimer > 0) this.lapMessageTimer -= dt;

    if (this.raceEndPending) {
      this.raceEndTimer -= dt;
      if (this.raceEndTimer <= 0) {
        this.raceEndPending = false;
        this.state = 'gameover';
      }
      return;
    }

    if (this.lapTime >= LAP_TIME_LIMIT) {
      this.timeUp = true;
      this.raceEndPending = true;
      this.raceEndTimer = 3;
      audio.lose();
    }
  }

  private finishRace(): void {
    this.finished = true;
    // Time bonus: faster = more points
    const avgLap = this.totalTime / LAP_COUNT;
    const timeBonus = Math.max(0, Math.floor((LAP_TIME_LIMIT - avgLap) * 100));
    this.score += timeBonus;
    this.raceEndPending = true;
    this.raceEndTimer = 3;
    this.lapMessage = 'RACE COMPLETE!';
    this.lapMessageTimer = 3;
    audio.powerup();
  }

  // ── Particles ──────────────────────────────────────────────────────

  private spawnCollisionParticles(): void {
    for (let i = 0; i < 10; i++) {
      this.particles.push({
        x: W / 2, y: H - 60,
        vx: randFloat(-100, 100), vy: randFloat(-150, -30),
        life: 0.5, maxLife: 0.5,
        color: Math.random() > 0.5 ? PINK : '#ffaa00',
      });
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 300 * dt;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────

  private project(p: ProjectedPoint, camX: number, camY: number, camZ: number): void {
    const tx = p.world.x - camX;
    const ty = p.world.y - camY;
    const tz = p.world.z - camZ;

    if (tz <= 0) {
      p.scale = 0;
      return;
    }

    p.scale = CAMERA_DEPTH / tz;
    p.screen.x = Math.round(W / 2 + p.scale * tx * W / 2);
    p.screen.y = Math.round(H / 2 - p.scale * ty * W / 2);
    p.screen.w = Math.round(p.scale * ROAD_W * W / 2);
  }

  private renderRoad(ctx: CanvasRenderingContext2D): void {
    const baseSegIdx = Math.floor(this.position / SEG_LEN) % this.segments.length;
    const basePercent = (this.position % SEG_LEN) / SEG_LEN;

    // Sky gradient
    const isTunnel = baseSegIdx >= 200 && baseSegIdx < 280;
    if (isTunnel) {
      ctx.fillStyle = '#0a0a1e';
      ctx.fillRect(0, 0, W, H);
      // Neon glow lines at top
      for (let i = 0; i < 5; i++) {
        ctx.strokeStyle = `rgba(236, 72, 153, ${0.1 + i * 0.05})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 10 + i * 15);
        ctx.lineTo(W, 10 + i * 15);
        ctx.stroke();
      }
    } else {
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H / 2);
      skyGrad.addColorStop(0, '#1a0a2e');
      skyGrad.addColorStop(0.5, '#2d1b4e');
      skyGrad.addColorStop(1, '#ff6b35');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H);

      // Stars
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 30; i++) {
        const sx = (i * 127 + Math.floor(this.totalTime * 2)) % W;
        const sy = (i * 83) % (H / 3);
        const blink = Math.sin(this.totalTime * 3 + i) * 0.5 + 0.5;
        ctx.globalAlpha = blink * 0.8;
        ctx.fillRect(sx, sy, 1, 1);
      }
      ctx.globalAlpha = 1;

      // Distant mountains
      ctx.fillStyle = '#2a1a3e';
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      for (let x = 0; x <= W; x += 20) {
        const mh = Math.sin(x * 0.02 + 1) * 25 + Math.sin(x * 0.005) * 40 + 10;
        ctx.lineTo(x, H / 2 - mh);
      }
      ctx.lineTo(W, H / 2);
      ctx.closePath();
      ctx.fill();
    }

    // Ground fill below horizon
    ctx.fillStyle = isTunnel ? '#111122' : '#b89858';
    ctx.fillRect(0, H / 2, W, H / 2);

    // Accumulate curve and hill offsets
    let curveX = 0;
    let hillY = 0;
    const camX = this.playerX * ROAD_W;
    const camY = CAMERA_H;
    const camZ = this.position - CAMERA_DEPTH * SEG_LEN;

    // First pass: project all visible segments
    let maxY = H; // clip from bottom of screen

    for (let n = 0; n < DRAW_DIST; n++) {
      const segIdx = (baseSegIdx + n) % this.segments.length;
      const seg = this.segments[segIdx];

      // Calculate world positions with curve accumulation
      seg.p1.world.x = curveX - camX;
      seg.p1.world.y = hillY;
      seg.p1.world.z = (n === 0 ? (1 - basePercent) : 1) * SEG_LEN + (n > 0 ? (n - 1 + (1 - basePercent)) * SEG_LEN : 0);
      // Simpler: just use index-based Z with camera offset
      seg.p1.world.z = n * SEG_LEN - (basePercent * SEG_LEN);

      curveX += seg.curve;
      hillY += seg.hill;

      seg.p2.world.x = curveX - camX;
      seg.p2.world.y = hillY;
      seg.p2.world.z = (n + 1) * SEG_LEN - (basePercent * SEG_LEN);

      this.project(seg.p1, 0, camY, 0);
      this.project(seg.p2, 0, camY, 0);
    }

    // Draw segments from far to near
    for (let n = DRAW_DIST - 1; n >= 0; n--) {
      const segIdx = (baseSegIdx + n) % this.segments.length;
      const seg = this.segments[segIdx];

      if (seg.p1.scale <= 0 || seg.p2.scale <= 0) continue;

      const y1 = seg.p1.screen.y;
      const y2 = seg.p2.screen.y;
      const x1 = seg.p1.screen.x;
      const x2 = seg.p2.screen.x;
      const w1 = seg.p1.screen.w;
      const w2 = seg.p2.screen.w;

      if (y2 >= maxY) continue; // behind a hill

      // Grass
      ctx.fillStyle = seg.color.grass;
      ctx.fillRect(0, y2, W, y1 - y2 + 1);

      // Rumble strips
      this.drawTrapezoid(ctx, x1, y1, w1 * 1.15, x2, y2, w2 * 1.15, seg.color.rumble);

      // Road
      this.drawTrapezoid(ctx, x1, y1, w1, x2, y2, w2, seg.color.road);

      // Lane markings (center dashes)
      if (seg.color.lane !== seg.color.road) {
        this.drawTrapezoid(ctx, x1, y1, w1 * 0.02, x2, y2, w2 * 0.02, seg.color.lane);
        // Side lanes
        this.drawTrapezoid(ctx, x1 - w1 * 0.48, y1, w1 * 0.02, x2 - w2 * 0.48, y2, w2 * 0.02, seg.color.lane);
        this.drawTrapezoid(ctx, x1 + w1 * 0.48, y1, w1 * 0.02, x2 + w2 * 0.48, y2, w2 * 0.02, seg.color.lane);
      }

      // Roadside sprites
      for (const spr of seg.sprites) {
        const spriteX = x2 + w2 * spr.offset;
        const spriteY = y2;
        const spriteScale = seg.p2.scale * 2000;
        if (spriteScale < 1) continue;

        this.renderSprite(ctx, spr.type, spriteX, spriteY, spriteScale, segIdx >= 200 && segIdx < 280);
      }

      // AI cars on this segment
      for (const car of seg.cars) {
        const carScreenX = x2 + w2 * car.offset;
        const carScreenY = y2;
        const carScale = seg.p2.scale * 2500;
        if (carScale < 2) continue;
        this.renderAICar(ctx, carScreenX, carScreenY, carScale, car.color);
      }

      if (y2 < maxY) maxY = y2;
    }

    // Player car
    this.renderPlayerCar(ctx);

    // Particles
    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // Speed lines at high speed
    const speedRatio = this.speed / MAX_SPEED;
    if (speedRatio > 0.6) {
      const lineAlpha = (speedRatio - 0.6) * 2;
      ctx.strokeStyle = `rgba(255,255,255,${lineAlpha * 0.3})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const lx = randInt(0, W);
        ctx.beginPath();
        ctx.moveTo(lx, H * 0.4);
        ctx.lineTo(lx + (lx - W / 2) * 0.2, H);
        ctx.stroke();
      }
    }
  }

  private drawTrapezoid(
    ctx: CanvasRenderingContext2D,
    x1: number, y1: number, w1: number,
    x2: number, y2: number, w2: number,
    color: string,
  ): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1 - w1, y1);
    ctx.lineTo(x1 + w1, y1);
    ctx.lineTo(x2 + w2, y2);
    ctx.lineTo(x2 - w2, y2);
    ctx.closePath();
    ctx.fill();
  }

  private renderSprite(ctx: CanvasRenderingContext2D, type: string, x: number, y: number, scale: number, tunnel: boolean): void {
    const s = Math.max(scale, 2);

    switch (type) {
      case 'cactus': {
        // Trunk
        ctx.fillStyle = '#2d6b2d';
        ctx.fillRect(x - s * 0.1, y - s * 0.8, s * 0.2, s * 0.8);
        // Arms
        ctx.fillRect(x - s * 0.35, y - s * 0.6, s * 0.25, s * 0.1);
        ctx.fillRect(x - s * 0.35, y - s * 0.7, s * 0.1, s * 0.2);
        ctx.fillRect(x + s * 0.1, y - s * 0.45, s * 0.25, s * 0.1);
        ctx.fillRect(x + s * 0.25, y - s * 0.55, s * 0.1, s * 0.2);
        break;
      }
      case 'rock': {
        ctx.fillStyle = '#665544';
        ctx.beginPath();
        ctx.moveTo(x - s * 0.3, y);
        ctx.lineTo(x - s * 0.2, y - s * 0.35);
        ctx.lineTo(x + s * 0.15, y - s * 0.4);
        ctx.lineTo(x + s * 0.3, y - s * 0.15);
        ctx.lineTo(x + s * 0.25, y);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'sign': {
        ctx.fillStyle = '#888888';
        ctx.fillRect(x - s * 0.03, y - s * 0.7, s * 0.06, s * 0.7);
        ctx.fillStyle = tunnel ? PINK : '#ff6600';
        ctx.fillRect(x - s * 0.2, y - s * 0.7, s * 0.4, s * 0.25);
        break;
      }
      case 'pillar': {
        ctx.fillStyle = '#333355';
        ctx.fillRect(x - s * 0.12, y - s * 1.2, s * 0.24, s * 1.2);
        // Neon strip
        ctx.fillStyle = PINK;
        ctx.fillRect(x - s * 0.04, y - s * 1.2, s * 0.08, s * 1.2);
        break;
      }
    }
  }

  private renderAICar(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string): void {
    const s = Math.max(scale, 3);

    // Body
    ctx.fillStyle = color;
    ctx.fillRect(x - s * 0.4, y - s * 0.3, s * 0.8, s * 0.3);

    // Top/cabin
    ctx.fillStyle = '#222222';
    ctx.fillRect(x - s * 0.25, y - s * 0.5, s * 0.5, s * 0.2);

    // Wheels
    ctx.fillStyle = '#111111';
    ctx.fillRect(x - s * 0.45, y - s * 0.1, s * 0.15, s * 0.1);
    ctx.fillRect(x + s * 0.3, y - s * 0.1, s * 0.15, s * 0.1);
  }

  private renderPlayerCar(ctx: CanvasRenderingContext2D): void {
    const cx = W / 2 + this.steerInput * 15;
    const cy = H - 45;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx, H - 18, 28, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wheels
    ctx.fillStyle = '#222222';
    ctx.fillRect(cx - 30, cy + 8, 10, 14);
    ctx.fillRect(cx + 20, cy + 8, 10, 14);
    ctx.fillRect(cx - 28, cy - 16, 8, 12);
    ctx.fillRect(cx + 20, cy - 16, 8, 12);

    // Body
    ctx.fillStyle = PINK;
    ctx.fillRect(cx - 22, cy - 10, 44, 32);

    // Cabin/windshield
    ctx.fillStyle = '#1a1a3e';
    ctx.fillRect(cx - 15, cy - 5, 30, 12);

    // Roof
    ctx.fillStyle = PINK_DIM;
    ctx.fillRect(cx - 12, cy - 14, 24, 10);

    // Headlights
    ctx.fillStyle = '#ffff88';
    ctx.fillRect(cx - 20, cy - 12, 6, 4);
    ctx.fillRect(cx + 14, cy - 12, 6, 4);

    // Taillights
    ctx.fillStyle = '#ff2222';
    ctx.fillRect(cx - 20, cy + 18, 6, 4);
    ctx.fillRect(cx + 14, cy + 18, 6, 4);

    // Exhaust particles when accelerating
    if (this.speed > MAX_SPEED * 0.3) {
      const flicker = Math.random();
      if (flicker > 0.3) {
        ctx.fillStyle = `rgba(255,100,50,${flicker * 0.5})`;
        ctx.fillRect(cx - 5 + randFloat(-3, 3), cy + 24, 4, 4 + randFloat(0, 6));
      }
    }

    // Steering tilt indicator
    if (this.steerInput !== 0) {
      const tiltDir = this.steerInput > 0 ? 1 : -1;
      ctx.fillStyle = 'rgba(236,72,153,0.3)';
      ctx.fillRect(cx + tiltDir * 24, cy, 3, 20);
    }
  }

  // ── HUD ────────────────────────────────────────────────────────────

  private renderHUD(ctx: CanvasRenderingContext2D): void {
    // Speed
    const mph = Math.round((this.speed / MAX_SPEED) * 200);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(W - 100, H - 40, 95, 35);
    ctx.fillStyle = PINK;
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${mph} MPH`, W - 12, H - 18);

    // Speed bar
    const barW = 85;
    const barRatio = mph / 200;
    ctx.fillStyle = '#333';
    ctx.fillRect(W - 93, H - 14, barW, 6);
    const barColor = barRatio > 0.8 ? '#ff4444' : barRatio > 0.5 ? '#ffaa00' : PINK;
    ctx.fillStyle = barColor;
    ctx.fillRect(W - 93, H - 14, barW * barRatio, 6);

    // Lap
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(5, 5, 90, 28);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`LAP ${this.lap}/${LAP_COUNT}`, 12, 24);

    // Lap time
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(100, 5, 110, 28);
    const timeRemaining = Math.max(0, LAP_TIME_LIMIT - this.lapTime);
    const timeColor = timeRemaining < 10 ? '#ff4444' : timeRemaining < 20 ? '#ffaa00' : '#ffffff';
    ctx.fillStyle = timeColor;
    ctx.fillText(`TIME: ${timeRemaining.toFixed(1)}s`, 107, 24);

    // Flash time warning
    if (timeRemaining < 10 && Math.floor(this.totalTime * 4) % 2 === 0) {
      ctx.fillStyle = 'rgba(255,0,0,0.15)';
      ctx.fillRect(0, 0, W, H);
    }

    // Score
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(215, 5, 100, 28);
    ctx.fillStyle = PINK;
    ctx.fillText(`SCORE: ${this.score}`, 222, 24);

    // Cars passed
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(320, 5, 80, 28);
    ctx.fillStyle = '#44ff88';
    ctx.fillText(`PASS: ${this.carsOvertaken}`, 327, 24);

    // Minimap / position indicator
    const lapProgress = (this.position % this.trackLength) / this.trackLength;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(W - 100, 5, 95, 12);
    ctx.fillStyle = '#444';
    ctx.fillRect(W - 97, 8, 89, 6);
    ctx.fillStyle = PINK;
    ctx.fillRect(W - 97 + lapProgress * 85, 7, 4, 8);
  }

  private renderCountdown(ctx: CanvasRenderingContext2D): void {
    if (this.countdownValue <= 0) return;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.font = 'bold 72px monospace';
    ctx.fillStyle = PINK;
    ctx.fillText(`${this.countdownValue}`, W / 2, H / 2 + 20);
  }

  private renderLapMessage(ctx: CanvasRenderingContext2D): void {
    const alpha = Math.min(1, this.lapMessageTimer / 0.3);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.shadowColor = PINK;
    ctx.shadowBlur = 20;
    ctx.font = 'bold 28px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(this.lapMessage, W / 2, H / 2 - 20);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  private renderRaceEndOverlay(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    const alpha = Math.min(0.7, (3 - this.raceEndTimer) * 0.5);
    ctx.fillStyle = `rgba(10,10,26,${alpha})`;
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 32px monospace';
    ctx.shadowColor = PINK;
    ctx.shadowBlur = 15;
    if (this.finished) {
      ctx.fillStyle = PINK;
      ctx.fillText('RACE COMPLETE!', W / 2, H / 2 - 20);
      ctx.shadowBlur = 0;
      ctx.font = 'bold 20px monospace';
      ctx.fillStyle = '#44ff88';
      ctx.fillText(`SCORE: ${this.score}`, W / 2, H / 2 + 20);
    } else {
      ctx.fillStyle = '#ff4444';
      ctx.fillText('TIME UP!', W / 2, H / 2 - 10);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  // ── Menu ───────────────────────────────────────────────────────────

  private renderMenu(ctx: CanvasRenderingContext2D): void {
    // Background
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#1a0a2e');
    grad.addColorStop(1, '#0a0a1a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Road vanishing point effect
    ctx.strokeStyle = 'rgba(236,72,153,0.2)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const y = H * 0.4 + i * 15;
      const spread = (y - H * 0.4) * 1.5;
      ctx.beginPath();
      ctx.moveTo(W / 2 - spread, y);
      ctx.lineTo(W / 2 + spread, y);
      ctx.stroke();
    }

    // Side lines converging
    ctx.strokeStyle = 'rgba(236,72,153,0.15)';
    ctx.beginPath();
    ctx.moveTo(W / 2, H * 0.35);
    ctx.lineTo(-50, H);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(W / 2, H * 0.35);
    ctx.lineTo(W + 50, H);
    ctx.stroke();

    // Title
    ctx.textAlign = 'center';

    // Glow
    ctx.shadowColor = PINK;
    ctx.shadowBlur = 20;
    ctx.font = 'bold 36px monospace';
    ctx.fillStyle = PINK;
    ctx.fillText('NITRO CIRCUIT', W / 2, 90);
    ctx.shadowBlur = 0;

    // Subtitle
    ctx.font = '12px monospace';
    ctx.fillStyle = '#888';
    ctx.fillText('DESERT CANYON RACER', W / 2, 115);

    // Car icon
    ctx.fillStyle = PINK;
    ctx.fillRect(W / 2 - 15, 150, 30, 16);
    ctx.fillStyle = PINK_DIM;
    ctx.fillRect(W / 2 - 10, 142, 20, 10);
    ctx.fillStyle = '#222';
    ctx.fillRect(W / 2 - 18, 162, 8, 6);
    ctx.fillRect(W / 2 + 10, 162, 8, 6);

    // Controls help box
    const boxW = 340;
    const boxH = 36;
    const boxX = (W - boxW) / 2;
    const boxY = 190;
    ctx.strokeStyle = PINK;
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.font = '12px monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText('UP = Accelerate | DOWN = Brake | LEFT/RIGHT = Steer', W / 2, boxY + boxH / 2 + 1);

    ctx.fillStyle = '#aaa';
    ctx.fillText(`Complete ${LAP_COUNT} laps to win!`, W / 2, boxY + boxH + 20);

    // Blink prompt
    const alpha = Math.sin(this.menuPulse * 3) * 0.5 + 0.5;
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = PINK;
    ctx.fillText('PRESS SPACE', W / 2, 280);
    ctx.globalAlpha = 1;
  }

  // ── Game Over ──────────────────────────────────────────────────────

  private renderGameOver(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(10,10,26,0.95)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';

    if (this.finished) {
      ctx.shadowColor = PINK;
      ctx.shadowBlur = 15;
      ctx.font = 'bold 28px monospace';
      ctx.fillStyle = PINK;
      ctx.fillText('RACE COMPLETE!', W / 2, 60);
      ctx.shadowBlur = 0;

      ctx.font = '14px monospace';
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < this.lapTimes.length; i++) {
        ctx.fillText(`Lap ${i + 1}: ${this.lapTimes[i].toFixed(2)}s`, W / 2, 100 + i * 22);
      }

      ctx.fillStyle = '#44ff88';
      ctx.fillText(`Total: ${this.totalTime.toFixed(2)}s`, W / 2, 100 + this.lapTimes.length * 22 + 10);
      ctx.fillText(`Cars Passed: ${this.carsOvertaken}`, W / 2, 100 + this.lapTimes.length * 22 + 32);

      ctx.font = 'bold 20px monospace';
      ctx.fillStyle = PINK;
      ctx.fillText(`SCORE: ${this.score}`, W / 2, 240);
    } else {
      ctx.shadowColor = '#ff4444';
      ctx.shadowBlur = 15;
      ctx.font = 'bold 28px monospace';
      ctx.fillStyle = '#ff4444';
      ctx.fillText('TIME UP!', W / 2, 80);
      ctx.shadowBlur = 0;

      ctx.font = '14px monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`Lap ${this.lap} of ${LAP_COUNT}`, W / 2, 120);
      ctx.fillText(`Cars Passed: ${this.carsOvertaken}`, W / 2, 145);

      ctx.font = 'bold 20px monospace';
      ctx.fillStyle = PINK;
      ctx.fillText(`SCORE: ${this.score}`, W / 2, 200);
    }

    const alpha = Math.sin(this.menuPulse * 3) * 0.5 + 0.5;
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#aaa';
    ctx.fillText('PRESS SPACE TO RETRY', W / 2, 290);
    ctx.globalAlpha = 1;
  }

  private renderPaused(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 24px monospace';
    ctx.fillStyle = PINK;
    ctx.fillText('PAUSED', W / 2, H / 2);
    ctx.font = '12px monospace';
    ctx.fillStyle = '#aaa';
    ctx.fillText('Press START to continue', W / 2, H / 2 + 25);
  }
}
