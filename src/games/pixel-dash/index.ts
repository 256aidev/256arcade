import { GameState, InputState, GameInfo, IGame } from '../../types/IGame';
import { audio } from '../../engine/Audio';
import { clamp, randInt, randFloat } from '../../engine/Physics';

const W = 480;
const H = 320;
const COLS = 15;
const ROWS = 10;
const CELL = 32;
const PINK = '#ff0080';
const CYAN = '#00e5ff';
const MAX_LIVES = 3;
const MAX_LEVEL = 3;
const TIMER_DURATION = 25; // seconds per attempt
const SAFE_SLOTS = 5;

type LaneType = 'safe' | 'traffic' | 'conveyor' | 'laser';

interface Lane {
  type: LaneType;
  row: number;
  direction: number; // -1 left, 1 right
  speed: number; // pixels per second
  // laser specific
  onTime?: number;
  offTime?: number;
  phase?: number;
  // conveyor specific
  conveyorSpeed?: number;
}

interface Vehicle {
  x: number;
  y: number;
  w: number;
  lane: number;
  speed: number;
  direction: number;
  color: string;
}

interface Slot {
  col: number;
  filled: boolean;
}

export default class PixelDashGame implements IGame {
  info: GameInfo = {
    id: 'pixel-dash',
    name: 'Pixel Dash',
    description: 'Guide a robot courier across conveyor belts, laser grids, and hover-traffic in a cyberpunk factory.',
    genre: 'Arcade',
    color: PINK,
    controls: 'Arrow Keys to move, SPACE to start',
  };

  private state: GameState = 'menu';
  private score = 0;
  private lives = MAX_LIVES;
  private level = 1;
  private playerCol = 7;
  private playerRow = 9;
  private playerPixelX = 0;
  private playerPixelY = 0;
  private animT = 0; // animation time
  private timer = TIMER_DURATION;
  private lanes: Lane[] = [];
  private vehicles: Vehicle[] = [];
  private slots: Slot[] = [];
  private prevInput: InputState = { up: false, down: false, left: false, right: false, action1: false, action2: false, start: false };
  private deathFlash = 0;
  private winFlash = 0;
  private gameWon = false;
  private canvasW = W;
  private canvasH = H;
  private scaleX = 1;
  private scaleY = 1;
  private particles: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] = [];

  async init(_canvas: HTMLCanvasElement): Promise<void> {
    this.state = 'menu';
    this.score = 0;
    this.lives = MAX_LIVES;
    this.level = 1;
    this.gameWon = false;
  }

  private startLevel(): void {
    this.playerCol = 7;
    this.playerRow = 9;
    this.syncPlayerPixel();
    this.timer = TIMER_DURATION;
    this.deathFlash = 0;
    this.vehicles = [];
    this.particles = [];

    // reset slots
    this.slots = [];
    const slotCols = [1, 4, 7, 10, 13];
    for (const c of slotCols) {
      this.slots.push({ col: c, filled: false });
    }

    this.buildLanes();
    this.spawnVehicles();
  }

  private buildLanes(): void {
    const speedMul = 1 + (this.level - 1) * 0.35;
    this.lanes = [];

    // Row 0: safe zone (top — slots)
    this.lanes.push({ type: 'safe', row: 0, direction: 0, speed: 0 });
    // Row 1: traffic
    this.lanes.push({ type: 'traffic', row: 1, direction: -1, speed: 50 * speedMul });
    // Row 2: traffic
    this.lanes.push({ type: 'traffic', row: 2, direction: 1, speed: 70 * speedMul });
    // Row 3: laser
    this.lanes.push({ type: 'laser', row: 3, direction: 0, speed: 0, onTime: 1.5, offTime: 1.8, phase: 0 });
    // Row 4: conveyor
    this.lanes.push({ type: 'conveyor', row: 4, direction: 1, speed: 0, conveyorSpeed: 40 * speedMul });
    // Row 5: traffic
    this.lanes.push({ type: 'traffic', row: 5, direction: -1, speed: 90 * speedMul });
    // Row 6: laser
    this.lanes.push({ type: 'laser', row: 6, direction: 0, speed: 0, onTime: 1.2, offTime: 2.0, phase: 0.7 });
    // Row 7: traffic
    this.lanes.push({ type: 'traffic', row: 7, direction: 1, speed: 60 * speedMul });
    // Row 8: conveyor
    this.lanes.push({ type: 'conveyor', row: 8, direction: -1, speed: 0, conveyorSpeed: 30 * speedMul });
    // Row 9: safe zone (bottom — start)
    this.lanes.push({ type: 'safe', row: 9, direction: 0, speed: 0 });
  }

  private spawnVehicles(): void {
    this.vehicles = [];
    for (const lane of this.lanes) {
      if (lane.type !== 'traffic') continue;
      const count = randInt(2, 4);
      const spacing = W / count;
      for (let i = 0; i < count; i++) {
        const vw = randInt(2, 3) * CELL; // vehicle width in pixels
        this.vehicles.push({
          x: i * spacing + randFloat(0, spacing * 0.4),
          y: lane.row * CELL,
          w: vw,
          lane: lane.row,
          speed: lane.speed,
          direction: lane.direction,
          color: this.vehicleColor(),
        });
      }
    }
  }

  private vehicleColor(): string {
    const colors = ['#ff4444', '#44aaff', '#ffaa00', '#aa44ff', '#00ffaa'];
    return colors[randInt(0, colors.length - 1)];
  }

  private syncPlayerPixel(): void {
    this.playerPixelX = this.playerCol * CELL;
    this.playerPixelY = this.playerRow * CELL;
  }

  private risingEdge(key: keyof InputState, input: InputState): boolean {
    return input[key] && !this.prevInput[key];
  }

  update(dt: number, input: InputState): void {
    this.animT += dt;

    if (this.state === 'menu') {
      if (this.risingEdge('start', input) || this.risingEdge('action1', input)) {
        this.state = 'playing';
        this.score = 0;
        this.lives = MAX_LIVES;
        this.level = 1;
        this.gameWon = false;
        this.startLevel();
        audio.jump();
      }
      this.prevInput = { ...input };
      return;
    }

    if (this.state === 'gameover') {
      if (this.risingEdge('start', input) || this.risingEdge('action1', input)) {
        this.state = 'menu';
      }
      this.prevInput = { ...input };
      return;
    }

    if (this.state !== 'playing') {
      this.prevInput = { ...input };
      return;
    }

    // Death flash cooldown
    if (this.deathFlash > 0) {
      this.deathFlash -= dt;
      if (this.deathFlash <= 0) {
        this.deathFlash = 0;
      }
      this.prevInput = { ...input };
      return;
    }

    // Win flash
    if (this.winFlash > 0) {
      this.winFlash -= dt;
      if (this.winFlash <= 0) {
        this.winFlash = 0;
        if (this.level > MAX_LEVEL) {
          this.gameWon = true;
          this.state = 'gameover';
        } else {
          this.startLevel();
        }
      }
      this.prevInput = { ...input };
      return;
    }

    // Timer
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0;
      this.loseLife();
      this.prevInput = { ...input };
      return;
    }

    // Player movement (rising edge, grid-based)
    let moved = false;
    if (this.risingEdge('up', input) && this.playerRow > 0) {
      this.playerRow--;
      moved = true;
    } else if (this.risingEdge('down', input) && this.playerRow < ROWS - 1) {
      this.playerRow++;
      moved = true;
    } else if (this.risingEdge('left', input) && this.playerCol > 0) {
      this.playerCol--;
      moved = true;
    } else if (this.risingEdge('right', input) && this.playerCol < COLS - 1) {
      this.playerCol++;
      moved = true;
    }
    if (moved) {
      audio.jump();
    }
    this.syncPlayerPixel();

    // Conveyor belt drift
    const lane = this.lanes[this.playerRow];
    if (lane && lane.type === 'conveyor') {
      const drift = (lane.conveyorSpeed || 0) * lane.direction * dt;
      this.playerPixelX += drift;
      // Snap back to grid col
      this.playerCol = Math.round(this.playerPixelX / CELL);
      this.playerCol = clamp(this.playerCol, 0, COLS - 1);
      this.playerPixelX = clamp(this.playerPixelX, 0, (COLS - 1) * CELL);
    }

    // Update vehicles
    for (const v of this.vehicles) {
      v.x += v.speed * v.direction * dt;
      // Wrap around
      if (v.direction > 0 && v.x > W) v.x = -v.w;
      if (v.direction < 0 && v.x + v.w < 0) v.x = W;
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    // Collision: vehicles
    const px = this.playerPixelX;
    const py = this.playerPixelY;
    for (const v of this.vehicles) {
      if (
        px + CELL - 4 > v.x &&
        px + 4 < v.x + v.w &&
        py + CELL - 4 > v.y &&
        py + 4 < v.y + CELL
      ) {
        this.loseLife();
        this.prevInput = { ...input };
        return;
      }
    }

    // Collision: lasers
    if (lane && lane.type === 'laser') {
      const period = (lane.onTime || 1) + (lane.offTime || 1);
      const t = ((this.animT + (lane.phase || 0) * period) % period);
      if (t < (lane.onTime || 1)) {
        // Laser is ON — player hit
        this.loseLife();
        this.prevInput = { ...input };
        return;
      }
    }

    // Check top row — slot reached
    if (this.playerRow === 0) {
      let slotHit = false;
      for (const slot of this.slots) {
        if (!slot.filled && Math.abs(this.playerCol - slot.col) <= 0) {
          slot.filled = true;
          slotHit = true;
          this.score += 100;
          audio.score();
          this.spawnParticles(this.playerPixelX + CELL / 2, this.playerPixelY + CELL / 2, PINK, 12);
          break;
        }
      }
      if (slotHit) {
        // Check if all slots filled
        if (this.slots.every(s => s.filled)) {
          this.level++;
          this.score += 200; // level bonus
          audio.powerup();
          this.winFlash = 1.2;
        } else {
          this.playerCol = 7;
          this.playerRow = 9;
          this.syncPlayerPixel();
          this.timer = TIMER_DURATION;
        }
      } else {
        // Not on a slot — push back
        this.playerRow = 1;
        this.syncPlayerPixel();
      }
    }

    // Out of bounds check (conveyor can push off)
    if (this.playerPixelX < -4 || this.playerPixelX > W - CELL + 4) {
      this.loseLife();
    }

    this.prevInput = { ...input };
  }

  private loseLife(): void {
    this.lives--;
    audio.explosion();
    this.spawnParticles(this.playerPixelX + CELL / 2, this.playerPixelY + CELL / 2, '#ff4444', 20);
    if (this.lives <= 0) {
      this.state = 'gameover';
      this.gameWon = false;
    } else {
      this.deathFlash = 1.0;
      this.playerCol = 7;
      this.playerRow = 9;
      this.syncPlayerPixel();
      this.timer = TIMER_DURATION;
    }
  }

  private spawnParticles(cx: number, cy: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: cx,
        y: cy,
        vx: randFloat(-120, 120),
        vy: randFloat(-120, 120),
        life: randFloat(0.3, 0.8),
        color,
      });
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.scale(this.scaleX, this.scaleY);

    // Dark industrial background
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, W, H);

    if (this.state === 'menu') {
      this.renderMenu(ctx);
      ctx.restore();
      return;
    }

    if (this.state === 'gameover' && this.winFlash <= 0) {
      this.renderGameOver(ctx);
      ctx.restore();
      return;
    }

    // Draw lanes
    this.renderLanes(ctx);

    // Draw vehicles
    this.renderVehicles(ctx);

    // Draw slots
    this.renderSlots(ctx);

    // Draw player
    if (this.deathFlash <= 0 || Math.floor(this.deathFlash * 10) % 2 === 0) {
      this.renderPlayer(ctx);
    }

    // Particles
    this.renderParticles(ctx);

    // HUD
    this.renderHUD(ctx);

    // Win flash overlay
    if (this.winFlash > 0) {
      ctx.fillStyle = `rgba(255, 0, 128, ${this.winFlash * 0.4})`;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`LEVEL ${this.level - 1} COMPLETE!`, W / 2, H / 2);
    }

    ctx.restore();
  }

  private renderMenu(ctx: CanvasRenderingContext2D): void {
    // Grid pattern background
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += CELL) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += CELL) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Title with neon glow
    const pulse = Math.sin(this.animT * 3) * 0.3 + 0.7;
    ctx.save();
    ctx.shadowColor = PINK;
    ctx.shadowBlur = 20 * pulse;
    ctx.fillStyle = PINK;
    ctx.font = 'bold 42px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PIXEL DASH', W / 2, 120);
    ctx.restore();

    // Subtitle
    ctx.fillStyle = CYAN;
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CYBERPUNK FACTORY COURIER', W / 2, 155);

    // Robot preview
    this.drawRobot(ctx, W / 2 - CELL / 2, 175, true);

    // Prompt
    const blink = Math.sin(this.animT * 4) > 0;
    if (blink) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('PRESS SPACE', W / 2, 260);
    }

    // Controls
    ctx.fillStyle = '#666688';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ARROW KEYS TO MOVE', W / 2, 290);
  }

  private renderGameOver(ctx: CanvasRenderingContext2D): void {
    // Background
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';

    if (this.gameWon) {
      ctx.save();
      ctx.shadowColor = CYAN;
      ctx.shadowBlur = 15;
      ctx.fillStyle = CYAN;
      ctx.font = 'bold 32px monospace';
      ctx.fillText('MISSION COMPLETE', W / 2, 100);
      ctx.restore();

      ctx.fillStyle = '#aaaacc';
      ctx.font = '16px monospace';
      ctx.fillText('All deliveries made!', W / 2, 140);
    } else {
      ctx.save();
      ctx.shadowColor = '#ff4444';
      ctx.shadowBlur = 15;
      ctx.fillStyle = '#ff4444';
      ctx.font = 'bold 32px monospace';
      ctx.fillText('SYSTEM FAILURE', W / 2, 100);
      ctx.restore();

      ctx.fillStyle = '#aaaacc';
      ctx.font = '16px monospace';
      ctx.fillText('Robot destroyed.', W / 2, 140);
    }

    ctx.fillStyle = PINK;
    ctx.font = 'bold 24px monospace';
    ctx.fillText(`SCORE: ${this.score}`, W / 2, 190);

    const blink = Math.sin(this.animT * 4) > 0;
    if (blink) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px monospace';
      ctx.fillText('PRESS SPACE', W / 2, 250);
    }
  }

  private renderLanes(ctx: CanvasRenderingContext2D): void {
    for (const lane of this.lanes) {
      const y = lane.row * CELL;

      switch (lane.type) {
        case 'safe':
          ctx.fillStyle = '#12122a';
          ctx.fillRect(0, y, W, CELL);
          // chevron pattern
          ctx.strokeStyle = '#1e1e3a';
          ctx.lineWidth = 1;
          for (let x = 0; x < W; x += 16) {
            ctx.beginPath();
            ctx.moveTo(x, y + CELL);
            ctx.lineTo(x + 8, y);
            ctx.lineTo(x + 16, y + CELL);
            ctx.stroke();
          }
          break;

        case 'traffic':
          ctx.fillStyle = '#0e0e1e';
          ctx.fillRect(0, y, W, CELL);
          // Lane markings
          ctx.strokeStyle = '#2a2a44';
          ctx.lineWidth = 1;
          ctx.setLineDash([8, 8]);
          ctx.beginPath();
          ctx.moveTo(0, y + CELL / 2);
          ctx.lineTo(W, y + CELL / 2);
          ctx.stroke();
          ctx.setLineDash([]);
          break;

        case 'conveyor': {
          ctx.fillStyle = '#181830';
          ctx.fillRect(0, y, W, CELL);
          // Moving arrows
          const offset = (this.animT * (lane.conveyorSpeed || 40) * lane.direction) % 32;
          ctx.fillStyle = '#2a2a50';
          for (let x = -32; x < W + 32; x += 32) {
            const ax = x + offset;
            const dir = lane.direction;
            ctx.beginPath();
            ctx.moveTo(ax, y + CELL / 2);
            ctx.lineTo(ax - 8 * dir, y + 6);
            ctx.lineTo(ax - 8 * dir, y + CELL - 6);
            ctx.closePath();
            ctx.fill();
          }
          break;
        }

        case 'laser': {
          ctx.fillStyle = '#120a0a';
          ctx.fillRect(0, y, W, CELL);
          // Laser state
          const period = (lane.onTime || 1) + (lane.offTime || 1);
          const t = ((this.animT + (lane.phase || 0) * period) % period);
          const isOn = t < (lane.onTime || 1);

          if (isOn) {
            // Draw active laser beams
            ctx.save();
            ctx.shadowColor = '#ff2244';
            ctx.shadowBlur = 12;
            ctx.strokeStyle = '#ff2244';
            ctx.lineWidth = 2;
            // horizontal beams
            for (let ly = y + 8; ly < y + CELL; ly += 10) {
              ctx.beginPath();
              ctx.moveTo(0, ly);
              ctx.lineTo(W, ly);
              ctx.stroke();
            }
            // glow fill
            ctx.fillStyle = 'rgba(255, 34, 68, 0.15)';
            ctx.fillRect(0, y, W, CELL);
            ctx.restore();
          } else {
            // Emitter nodes — lasers off
            ctx.fillStyle = '#331111';
            for (let x = 0; x < W; x += 48) {
              ctx.fillRect(x, y + 12, 4, 8);
            }
            // Warning blink near end of off time
            const remaining = period - t;
            if (remaining < 0.4) {
              const warn = Math.sin(remaining * 25) > 0;
              if (warn) {
                ctx.fillStyle = 'rgba(255, 34, 68, 0.08)';
                ctx.fillRect(0, y, W, CELL);
              }
            }
          }
          break;
        }
      }
    }
  }

  private renderVehicles(ctx: CanvasRenderingContext2D): void {
    for (const v of this.vehicles) {
      ctx.save();
      // Body
      ctx.fillStyle = v.color;
      ctx.shadowColor = v.color;
      ctx.shadowBlur = 6;
      // Hover car shape
      const bx = v.x;
      const by = v.y + 4;
      const bh = CELL - 8;
      ctx.beginPath();
      ctx.roundRect(bx, by, v.w, bh, 4);
      ctx.fill();
      // Windshield
      ctx.fillStyle = '#00ccff44';
      const wx = v.direction > 0 ? bx + v.w - 14 : bx + 4;
      ctx.fillRect(wx, by + 4, 10, bh - 8);
      // Hover glow underneath
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(0, 200, 255, ${0.2 + Math.sin(this.animT * 8) * 0.1})`;
      ctx.fillRect(bx + 4, v.y + CELL - 4, v.w - 8, 3);
      ctx.restore();
    }
  }

  private renderSlots(ctx: CanvasRenderingContext2D): void {
    for (const slot of this.slots) {
      const x = slot.col * CELL;
      const y = 0;
      if (slot.filled) {
        ctx.save();
        ctx.shadowColor = CYAN;
        ctx.shadowBlur = 8;
        ctx.fillStyle = CYAN;
        ctx.fillRect(x + 4, y + 4, CELL - 8, CELL - 8);
        ctx.restore();
        // Checkmark
        ctx.strokeStyle = '#0a0a12';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + 10, y + 16);
        ctx.lineTo(x + 15, y + 22);
        ctx.lineTo(x + 24, y + 10);
        ctx.stroke();
      } else {
        // Empty slot outline
        const pulse = Math.sin(this.animT * 2) * 0.3 + 0.7;
        ctx.save();
        ctx.shadowColor = PINK;
        ctx.shadowBlur = 6 * pulse;
        ctx.strokeStyle = PINK;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 4, y + 4, CELL - 8, CELL - 8);
        ctx.restore();
        // Arrow indicator
        ctx.fillStyle = `rgba(255, 0, 128, ${pulse * 0.5})`;
        ctx.beginPath();
        ctx.moveTo(x + CELL / 2, y + 8);
        ctx.lineTo(x + CELL / 2 - 5, y + 16);
        ctx.lineTo(x + CELL / 2 + 5, y + 16);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  private renderPlayer(ctx: CanvasRenderingContext2D): void {
    this.drawRobot(ctx, this.playerPixelX, this.playerPixelY, true);
  }

  private drawRobot(ctx: CanvasRenderingContext2D, x: number, y: number, glow: boolean): void {
    ctx.save();
    if (glow) {
      ctx.shadowColor = PINK;
      ctx.shadowBlur = 10 + Math.sin(this.animT * 6) * 4;
    }

    // Body
    ctx.fillStyle = '#ccccdd';
    ctx.fillRect(x + 6, y + 10, 20, 16);

    // Head
    ctx.fillStyle = '#aaaacc';
    ctx.fillRect(x + 8, y + 2, 16, 10);

    // Eyes
    const eyeFlicker = Math.sin(this.animT * 8) > 0.9 ? 0 : 1;
    ctx.fillStyle = eyeFlicker ? PINK : '#440022';
    ctx.fillRect(x + 11, y + 5, 4, 4);
    ctx.fillRect(x + 18, y + 5, 4, 4);

    // Antenna
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 16, y + 2);
    ctx.lineTo(x + 16, y - 3);
    ctx.stroke();
    ctx.fillStyle = CYAN;
    ctx.beginPath();
    ctx.arc(x + 16, y - 4, 2, 0, Math.PI * 2);
    ctx.fill();

    // Legs
    ctx.fillStyle = '#8888aa';
    ctx.fillRect(x + 8, y + 26, 5, 4);
    ctx.fillRect(x + 19, y + 26, 5, 4);

    // Accent stripe
    ctx.fillStyle = PINK;
    ctx.fillRect(x + 10, y + 15, 12, 2);

    ctx.restore();
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const alpha = clamp(p.life / 0.5, 0, 1);
      ctx.fillStyle = p.color + Math.floor(alpha * 255).toString(16).padStart(2, '0');
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
  }

  private renderHUD(ctx: CanvasRenderingContext2D): void {
    // Timer bar at very top
    const timerFrac = clamp(this.timer / TIMER_DURATION, 0, 1);
    const barW = W - 120;
    const barX = 60;
    const barY = 1;
    const barH = 3;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(barX, barY, barW, barH);
    const timerColor = timerFrac > 0.3 ? CYAN : '#ff4444';
    ctx.fillStyle = timerColor;
    ctx.fillRect(barX, barY, barW * timerFrac, barH);

    // Score — top left
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`SCORE:${this.score}`, 4, 10);

    // Lives — top right
    ctx.textAlign = 'right';
    ctx.fillStyle = PINK;
    let livesStr = '';
    for (let i = 0; i < this.lives; i++) livesStr += '\u2665 ';
    ctx.fillText(livesStr.trim(), W - 4, 10);

    // Level
    ctx.textAlign = 'center';
    ctx.fillStyle = '#666688';
    ctx.fillText(`LV${this.level}`, W / 2, 10);
  }

  resize(width: number, height: number): void {
    this.canvasW = width;
    this.canvasH = height;
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
    this.vehicles = [];
    this.particles = [];
  }
}
