import { GameState, InputState, GameInfo, IGame } from '../../types/IGame';
import { audio } from '../../engine/Audio';
import { clamp, randInt, rectsOverlap, Rect } from '../../engine/Physics';

const W = 480;
const H = 320;
const GRAVITY = 600;
const JUMP_VEL = -260;
const MOVE_SPEED = 120;
const PLAYER_W = 16;
const PLAYER_H = 20;
const GRID_COLS = 4;
const GRID_ROWS = 3;
const HUD_H = 28;
const PLAY_Y = HUD_H;
const PLAY_H = H - HUD_H;
const MAX_LIVES = 3;
const MAX_INVENTORY = 3;
const CORE_GEAR_SCORE = 200;
const BONUS_SCORE = 50;

// Steampunk palette
const COL_BG       = '#1a1008';
const COL_WALL     = '#4a3520';
const COL_PLAT     = '#6b4c30';
const COL_PLAT_TOP = '#8b6340';
const COL_AMBER    = '#f59e0b';
const COL_BRONZE   = '#cd7f32';
const COL_GOLD     = '#fbbf24';
const COL_RUST     = '#8b4513';
const COL_STEAM    = 'rgba(200,200,200,0.6)';
const COL_GEAR_DARK = '#5c4033';
const COL_HUD_BG   = '#0d0804';
const COL_TEXT      = '#fde68a';
const COL_DANGER    = '#ef4444';
const COL_DOOR      = '#78350f';

type ItemType = 'gear' | 'key' | 'oil_can' | 'spring' | 'wrench' | 'core_gear' | 'bonus_cog';

interface Item {
  type: ItemType;
  x: number;
  y: number;
  w: number;
  h: number;
  collected: boolean;
  roomX: number;
  roomY: number;
}

interface Platform {
  x: number; y: number; w: number; h: number;
}

interface Hazard {
  type: 'steam_vent' | 'spinning_gear';
  x: number; y: number; w: number; h: number;
  // steam: timing
  onTime?: number;
  offTime?: number;
  phase?: number;
  timer?: number;
  active?: boolean;
  // gear: rotation
  angle?: number;
  radius?: number;
}

interface Door {
  x: number; y: number; w: number; h: number;
  requiresItem: ItemType;
  open: boolean;
  id: string;
}

interface Room {
  platforms: Platform[];
  hazards: Hazard[];
  items: Item[];
  doors: Door[];
  bgVariant: number;
}

interface Player {
  x: number; y: number;
  vx: number; vy: number;
  onGround: boolean;
  facingRight: boolean;
  walkFrame: number;
  walkTimer: number;
}

export default class TinkersQuestGame implements IGame {
  info: GameInfo = {
    id: 'tinkers-quest',
    name: "Tinker's Quest",
    description: 'Explore a steampunk world as a clockwork automaton, solving gear-based puzzles.',
    genre: 'Adventure',
    color: COL_AMBER,
    controls: 'Arrows to move, Z interact, X jump',
  };

  private state: GameState = 'menu';
  private score = 0;
  private lives = MAX_LIVES;
  private coreGearsFound = 0;
  private totalCoreGears = 5;
  private startTime = 0;
  private endTime = 0;

  private player: Player = { x: 0, y: 0, vx: 0, vy: 0, onGround: false, facingRight: true, walkFrame: 0, walkTimer: 0 };
  private roomX = 0;
  private roomY = 0;
  private rooms: Room[][] = [];
  private inventory: ItemType[] = [];
  private selectedSlot = 0;

  private prevAction1 = false;
  private prevAction2 = false;
  private prevStart = false;

  private transitionTimer = 0;
  private transitionDir: 'left' | 'right' | 'up' | 'down' | null = null;
  private respawnTimer = 0;
  private invincibleTimer = 0;
  private menuBlink = 0;
  private globalTimer = 0;
  private interactMsg = '';
  private interactMsgTimer = 0;

  // Opened doors persist by id
  private openedDoors: Set<string> = new Set();

  // win state
  private won = false;

  init(_canvas: HTMLCanvasElement): Promise<void> {
    this.state = 'menu';
    return Promise.resolve();
  }

  private startGame(): void {
    this.state = 'playing';
    this.score = 0;
    this.lives = MAX_LIVES;
    this.coreGearsFound = 0;
    this.inventory = [];
    this.selectedSlot = 0;
    this.won = false;
    this.openedDoors = new Set();
    this.startTime = performance.now();
    this.endTime = 0;
    this.invincibleTimer = 0;
    this.transitionTimer = 0;
    this.transitionDir = null;
    this.interactMsg = '';
    this.interactMsgTimer = 0;

    this.buildWorld();
    this.roomX = 0;
    this.roomY = 2; // bottom-left start
    this.spawnPlayer(60, 200);
  }

  private spawnPlayer(x: number, y: number): void {
    this.player.x = x;
    this.player.y = y;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.onGround = false;
  }

  private buildWorld(): void {
    this.rooms = [];
    for (let col = 0; col < GRID_COLS; col++) {
      this.rooms[col] = [];
      for (let row = 0; row < GRID_ROWS; row++) {
        this.rooms[col][row] = { platforms: [], hazards: [], items: [], doors: [], bgVariant: randInt(0, 2) };
      }
    }

    // Floor helper - most rooms have a floor
    const floor = (): Platform => ({ x: 0, y: PLAY_H - 16, w: W, h: 16 });
    const wallL = (): Platform => ({ x: 0, y: 0, w: 16, h: PLAY_H });
    const wallR = (): Platform => ({ x: W - 16, y: 0, w: 16, h: PLAY_H });

    // Room (0,2) — Starting room, bottom-left
    {
      const r = this.rooms[0][2];
      r.platforms.push(floor(), { x: 0, y: 0, w: W, h: 16 }); // ceiling
      r.platforms.push(wallL());
      r.platforms.push({ x: 100, y: PLAY_H - 80, w: 80, h: 12 });
      r.platforms.push({ x: 250, y: PLAY_H - 120, w: 80, h: 12 });
      r.items.push({ type: 'bonus_cog', x: 120, y: PLAY_H - 100, w: 14, h: 14, collected: false, roomX: 0, roomY: 2 });
    }

    // Room (1,2)
    {
      const r = this.rooms[1][2];
      r.platforms.push(floor(), { x: 0, y: 0, w: W, h: 16 });
      r.platforms.push({ x: 60, y: PLAY_H - 70, w: 100, h: 12 });
      r.platforms.push({ x: 220, y: PLAY_H - 110, w: 100, h: 12 });
      r.platforms.push({ x: 350, y: PLAY_H - 60, w: 80, h: 12 });
      r.hazards.push({ type: 'steam_vent', x: 180, y: PLAY_H - 16, w: 20, h: 50, onTime: 1.5, offTime: 2.0, phase: 0, timer: 0, active: false });
      r.items.push({ type: 'key', x: 240, y: PLAY_H - 130, w: 12, h: 14, collected: false, roomX: 1, roomY: 2 });
    }

    // Room (2,2)
    {
      const r = this.rooms[2][2];
      r.platforms.push(floor(), { x: 0, y: 0, w: W, h: 16 });
      r.platforms.push({ x: 80, y: PLAY_H - 90, w: 70, h: 12 });
      r.platforms.push({ x: 200, y: PLAY_H - 60, w: 120, h: 12 });
      r.platforms.push({ x: 360, y: PLAY_H - 100, w: 60, h: 12 });
      r.hazards.push({ type: 'spinning_gear', x: 300, y: PLAY_H - 50, w: 30, h: 30, angle: 0, radius: 15 });
      r.items.push({ type: 'core_gear', x: 375, y: PLAY_H - 120, w: 16, h: 16, collected: false, roomX: 2, roomY: 2 });
    }

    // Room (3,2) — bottom-right
    {
      const r = this.rooms[3][2];
      r.platforms.push(floor(), { x: 0, y: 0, w: W, h: 16 });
      r.platforms.push(wallR());
      r.platforms.push({ x: 60, y: PLAY_H - 80, w: 100, h: 12 });
      r.platforms.push({ x: 250, y: PLAY_H - 130, w: 80, h: 12 });
      r.hazards.push({ type: 'steam_vent', x: 350, y: PLAY_H - 16, w: 20, h: 60, onTime: 2.0, offTime: 1.5, phase: 0.5, timer: 0.5, active: false });
      r.items.push({ type: 'oil_can', x: 270, y: PLAY_H - 150, w: 12, h: 16, collected: false, roomX: 3, roomY: 2 });
    }

    // Room (0,1) — middle-left
    {
      const r = this.rooms[0][1];
      r.platforms.push(floor(), { x: 0, y: 0, w: W, h: 16 });
      r.platforms.push(wallL());
      r.platforms.push({ x: 80, y: PLAY_H - 70, w: 80, h: 12 });
      r.platforms.push({ x: 200, y: PLAY_H - 120, w: 100, h: 12 });
      r.platforms.push({ x: 380, y: PLAY_H - 80, w: 60, h: 12 });
      r.doors.push({ x: 200, y: PLAY_H - 160, w: 24, h: 40, requiresItem: 'key', open: false, id: 'door_0_1_a' });
      r.items.push({ type: 'gear', x: 395, y: PLAY_H - 100, w: 14, h: 14, collected: false, roomX: 0, roomY: 1 });
      r.items.push({ type: 'core_gear', x: 210, y: PLAY_H - 180, w: 16, h: 16, collected: false, roomX: 0, roomY: 1 });
    }

    // Room (1,1)
    {
      const r = this.rooms[1][1];
      r.platforms.push(floor(), { x: 0, y: 0, w: W, h: 16 });
      r.platforms.push({ x: 50, y: PLAY_H - 60, w: 80, h: 12 });
      r.platforms.push({ x: 180, y: PLAY_H - 100, w: 60, h: 12 });
      r.platforms.push({ x: 280, y: PLAY_H - 140, w: 80, h: 12 });
      r.platforms.push({ x: 400, y: PLAY_H - 80, w: 60, h: 12 });
      r.hazards.push({ type: 'spinning_gear', x: 140, y: PLAY_H - 40, w: 28, h: 28, angle: 0, radius: 14 });
      r.hazards.push({ type: 'steam_vent', x: 360, y: PLAY_H - 16, w: 20, h: 45, onTime: 1.0, offTime: 2.5, phase: 0, timer: 0, active: false });
      r.items.push({ type: 'wrench', x: 300, y: PLAY_H - 160, w: 12, h: 16, collected: false, roomX: 1, roomY: 1 });
    }

    // Room (2,1)
    {
      const r = this.rooms[2][1];
      r.platforms.push(floor(), { x: 0, y: 0, w: W, h: 16 });
      r.platforms.push({ x: 60, y: PLAY_H - 80, w: 90, h: 12 });
      r.platforms.push({ x: 200, y: PLAY_H - 50, w: 80, h: 12 });
      // Broken bridge - needs wrench
      r.doors.push({ x: 300, y: PLAY_H - 50, w: 80, h: 12, requiresItem: 'wrench', open: false, id: 'bridge_2_1' });
      r.platforms.push({ x: 400, y: PLAY_H - 50, w: 60, h: 12 });
      r.hazards.push({ type: 'spinning_gear', x: 160, y: PLAY_H - 110, w: 26, h: 26, angle: 0, radius: 13 });
      r.items.push({ type: 'core_gear', x: 420, y: PLAY_H - 70, w: 16, h: 16, collected: false, roomX: 2, roomY: 1 });
    }

    // Room (3,1)
    {
      const r = this.rooms[3][1];
      r.platforms.push(floor(), { x: 0, y: 0, w: W, h: 16 });
      r.platforms.push(wallR());
      r.platforms.push({ x: 40, y: PLAY_H - 90, w: 80, h: 12 });
      r.platforms.push({ x: 180, y: PLAY_H - 60, w: 60, h: 12 });
      r.platforms.push({ x: 300, y: PLAY_H - 110, w: 90, h: 12 });
      // Rust blockage - needs oil can
      r.doors.push({ x: 390, y: PLAY_H - 160, w: 24, h: 50, requiresItem: 'oil_can', open: false, id: 'rust_3_1' });
      r.items.push({ type: 'spring', x: 55, y: PLAY_H - 110, w: 14, h: 14, collected: false, roomX: 3, roomY: 1 });
      r.items.push({ type: 'bonus_cog', x: 320, y: PLAY_H - 130, w: 14, h: 14, collected: false, roomX: 3, roomY: 1 });
    }

    // Room (0,0) — top-left
    {
      const r = this.rooms[0][0];
      r.platforms.push(floor(), { x: 0, y: 0, w: W, h: 16 });
      r.platforms.push(wallL());
      r.platforms.push({ x: 80, y: PLAY_H - 60, w: 100, h: 12 });
      r.platforms.push({ x: 240, y: PLAY_H - 100, w: 80, h: 12 });
      r.platforms.push({ x: 380, y: PLAY_H - 140, w: 60, h: 12 });
      r.hazards.push({ type: 'steam_vent', x: 200, y: PLAY_H - 16, w: 20, h: 55, onTime: 1.8, offTime: 1.2, phase: 0, timer: 0, active: false });
      r.items.push({ type: 'bonus_cog', x: 260, y: PLAY_H - 120, w: 14, h: 14, collected: false, roomX: 0, roomY: 0 });
      r.items.push({ type: 'key', x: 395, y: PLAY_H - 160, w: 12, h: 14, collected: false, roomX: 0, roomY: 0 });
    }

    // Room (1,0)
    {
      const r = this.rooms[1][0];
      r.platforms.push(floor(), { x: 0, y: 0, w: W, h: 16 });
      r.platforms.push({ x: 60, y: PLAY_H - 80, w: 60, h: 12 });
      r.platforms.push({ x: 160, y: PLAY_H - 130, w: 80, h: 12 });
      r.platforms.push({ x: 300, y: PLAY_H - 70, w: 100, h: 12 });
      r.hazards.push({ type: 'spinning_gear', x: 240, y: PLAY_H - 40, w: 30, h: 30, angle: 0, radius: 15 });
      r.hazards.push({ type: 'spinning_gear', x: 420, y: PLAY_H - 100, w: 24, h: 24, angle: Math.PI, radius: 12 });
      r.items.push({ type: 'core_gear', x: 180, y: PLAY_H - 150, w: 16, h: 16, collected: false, roomX: 1, roomY: 0 });
    }

    // Room (2,0)
    {
      const r = this.rooms[2][0];
      r.platforms.push(floor(), { x: 0, y: 0, w: W, h: 16 });
      r.platforms.push({ x: 40, y: PLAY_H - 70, w: 80, h: 12 });
      r.platforms.push({ x: 170, y: PLAY_H - 110, w: 80, h: 12 });
      r.platforms.push({ x: 300, y: PLAY_H - 80, w: 80, h: 12 });
      r.platforms.push({ x: 400, y: PLAY_H - 140, w: 60, h: 12 });
      // Gear-locked door
      r.doors.push({ x: 170, y: PLAY_H - 150, w: 24, h: 40, requiresItem: 'gear', open: false, id: 'geardoor_2_0' });
      r.hazards.push({ type: 'steam_vent', x: 260, y: PLAY_H - 16, w: 20, h: 50, onTime: 1.5, offTime: 1.5, phase: 0.8, timer: 0.8, active: false });
      r.items.push({ type: 'bonus_cog', x: 415, y: PLAY_H - 160, w: 14, h: 14, collected: false, roomX: 2, roomY: 0 });
    }

    // Room (3,0) — top-right, final core gear
    {
      const r = this.rooms[3][0];
      r.platforms.push(floor(), { x: 0, y: 0, w: W, h: 16 });
      r.platforms.push(wallR());
      r.platforms.push({ x: 60, y: PLAY_H - 80, w: 80, h: 12 });
      r.platforms.push({ x: 200, y: PLAY_H - 130, w: 100, h: 12 });
      r.platforms.push({ x: 360, y: PLAY_H - 80, w: 80, h: 12 });
      r.hazards.push({ type: 'spinning_gear', x: 150, y: PLAY_H - 50, w: 28, h: 28, angle: 0, radius: 14 });
      r.hazards.push({ type: 'steam_vent', x: 310, y: PLAY_H - 16, w: 20, h: 60, onTime: 1.2, offTime: 1.8, phase: 0, timer: 0, active: false });
      r.items.push({ type: 'core_gear', x: 230, y: PLAY_H - 150, w: 16, h: 16, collected: false, roomX: 3, roomY: 0 });
      r.items.push({ type: 'bonus_cog', x: 380, y: PLAY_H - 100, w: 14, h: 14, collected: false, roomX: 3, roomY: 0 });
    }
  }

  private currentRoom(): Room {
    return this.rooms[this.roomX][this.roomY];
  }

  update(dt: number, input: InputState): void {
    this.globalTimer += dt;

    const a1Rising = input.action1 && !this.prevAction1;
    const a2Rising = input.action2 && !this.prevAction2;
    const startRising = input.start && !this.prevStart;
    this.prevAction1 = input.action1;
    this.prevAction2 = input.action2;
    this.prevStart = input.start;

    if (this.state === 'menu') {
      this.menuBlink += dt;
      if (startRising || a1Rising || a2Rising) {
        this.startGame();
        audio.powerup();
      }
      return;
    }

    if (this.state === 'gameover') {
      if (startRising || a1Rising) {
        this.state = 'menu';
      }
      return;
    }

    if (this.state === 'paused') {
      if (startRising) this.state = 'playing';
      return;
    }

    // Playing
    if (startRising) { this.state = 'paused'; return; }

    // Respawn delay
    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.respawnAtRoomEntrance();
      }
      return;
    }

    // Transition
    if (this.transitionTimer > 0) {
      this.transitionTimer -= dt;
      if (this.transitionTimer <= 0) {
        this.transitionDir = null;
      }
      return;
    }

    if (this.invincibleTimer > 0) this.invincibleTimer -= dt;
    if (this.interactMsgTimer > 0) this.interactMsgTimer -= dt;

    const p = this.player;
    const room = this.currentRoom();

    // Sync door open state from global set
    for (const d of room.doors) {
      if (this.openedDoors.has(d.id)) d.open = true;
    }

    // Movement
    p.vx = 0;
    if (input.left) { p.vx = -MOVE_SPEED; p.facingRight = false; }
    if (input.right) { p.vx = MOVE_SPEED; p.facingRight = true; }

    // Jump (rising edge of action2/X) - only when on ground
    if (a2Rising && p.onGround) {
      p.vy = JUMP_VEL;
      p.onGround = false;
      audio.jump();
    }

    // Inventory cycle with action2 when on ground and not jumping
    // (handled above: jump takes priority on rising edge when onGround)
    // Cycle only when on ground and action2 wasn't consumed for jump
    // Actually, let's use down+action1 for cycle instead to avoid conflict
    // No, spec says action2 cycles when not jumping. We'll cycle if on ground and already jumped (no rising edge for jump).
    // Simplification: just use down arrow to cycle inventory
    if (input.down && a2Rising && p.onGround) {
      // Already jumped above... let's separate: down+action2 cycles
      // Actually the jump consumed the rising edge. Let's just allow pressing down to cycle.
    }
    // Use separate: press DOWN while on ground to cycle selected inventory slot
    if (input.down && a1Rising && this.inventory.length > 0) {
      this.selectedSlot = (this.selectedSlot + 1) % this.inventory.length;
      audio.hit();
    }

    // Interact (action1 rising edge, not pressing down)
    if (a1Rising && !input.down) {
      this.tryInteract();
    }

    // Gravity
    p.vy += GRAVITY * dt;
    p.vy = clamp(p.vy, -400, 500);

    // Move X
    p.x += p.vx * dt;
    this.resolveCollisionsX(room);

    // Move Y
    p.y += p.vy * dt;
    p.onGround = false;
    this.resolveCollisionsY(room);

    // Walk animation
    if (Math.abs(p.vx) > 10 && p.onGround) {
      p.walkTimer += dt;
      if (p.walkTimer > 0.12) { p.walkTimer = 0; p.walkFrame = (p.walkFrame + 1) % 4; }
    } else {
      p.walkFrame = 0;
      p.walkTimer = 0;
    }

    // Update hazards
    for (const h of room.hazards) {
      if (h.type === 'steam_vent') {
        h.timer! += dt;
        const cycle = h.onTime! + h.offTime!;
        const t = (h.timer! + h.phase!) % cycle;
        h.active = t < h.onTime!;
      }
      if (h.type === 'spinning_gear') {
        h.angle = (h.angle || 0) + dt * 3;
      }
    }

    // Check hazard collisions
    if (this.invincibleTimer <= 0) {
      const pRect: Rect = { x: p.x, y: PLAY_Y + p.y, w: PLAYER_W, h: PLAYER_H };
      for (const h of room.hazards) {
        if (h.type === 'steam_vent' && h.active) {
          const hRect: Rect = { x: h.x, y: PLAY_Y + h.y - h.h, w: h.w, h: h.h };
          if (rectsOverlap(pRect, hRect)) {
            this.hitPlayer();
            break;
          }
        }
        if (h.type === 'spinning_gear') {
          const cx = h.x + h.w / 2;
          const cy = PLAY_Y + h.y + h.h / 2;
          const px = p.x + PLAYER_W / 2;
          const py = PLAY_Y + p.y + PLAYER_H / 2;
          const dist = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
          if (dist < (h.radius || 12) + 6) {
            this.hitPlayer();
            break;
          }
        }
      }
    }

    // Check item pickups
    const pRect: Rect = { x: p.x, y: p.y, w: PLAYER_W, h: PLAYER_H };
    for (const item of room.items) {
      if (item.collected) continue;
      const iRect: Rect = { x: item.x, y: item.y, w: item.w, h: item.h };
      if (rectsOverlap(pRect, iRect)) {
        if (item.type === 'core_gear') {
          item.collected = true;
          this.coreGearsFound++;
          this.score += CORE_GEAR_SCORE;
          audio.powerup();
          this.showMsg('CORE GEAR found! (' + this.coreGearsFound + '/' + this.totalCoreGears + ')');
          if (this.coreGearsFound >= this.totalCoreGears) {
            this.winGame();
          }
        } else if (item.type === 'bonus_cog') {
          item.collected = true;
          this.score += BONUS_SCORE;
          audio.score();
          this.showMsg('+50 Bonus!');
        } else {
          // Inventory item
          if (this.inventory.length < MAX_INVENTORY) {
            item.collected = true;
            this.inventory.push(item.type);
            audio.score();
            this.showMsg('Picked up ' + this.itemName(item.type));
          } else {
            this.showMsg('Inventory full!');
          }
        }
      }
    }

    // Screen transitions
    if (p.x < -2) {
      if (this.roomX > 0) {
        this.roomX--;
        p.x = W - PLAYER_W - 18;
        this.startTransition('left');
      } else {
        p.x = -2;
      }
    }
    if (p.x + PLAYER_W > W + 2) {
      if (this.roomX < GRID_COLS - 1) {
        this.roomX++;
        p.x = 18;
        this.startTransition('right');
      } else {
        p.x = W - PLAYER_W + 2;
      }
    }
    if (p.y < -2) {
      if (this.roomY > 0) {
        this.roomY--;
        p.y = PLAY_H - PLAYER_H - 18;
        this.startTransition('up');
      } else {
        p.y = -2;
      }
    }
    if (p.y + PLAYER_H > PLAY_H + 2) {
      if (this.roomY < GRID_ROWS - 1) {
        this.roomY++;
        p.y = 18;
        this.startTransition('down');
      } else {
        // Fell into pit
        this.hitPlayer();
      }
    }
  }

  private startTransition(dir: 'left' | 'right' | 'up' | 'down'): void {
    this.transitionTimer = 0.25;
    this.transitionDir = dir;
  }

  private resolveCollisionsX(room: Room): void {
    const p = this.player;
    const pRect: Rect = { x: p.x, y: p.y + 1, w: PLAYER_W, h: PLAYER_H - 2 };

    for (const plat of room.platforms) {
      if (rectsOverlap(pRect, plat)) {
        if (p.vx > 0) p.x = plat.x - PLAYER_W;
        else if (p.vx < 0) p.x = plat.x + plat.w;
        pRect.x = p.x;
      }
    }
    // Closed doors act as walls
    for (const d of room.doors) {
      if (d.open) continue;
      if (rectsOverlap(pRect, d)) {
        if (p.vx > 0) p.x = d.x - PLAYER_W;
        else if (p.vx < 0) p.x = d.x + d.w;
        pRect.x = p.x;
      }
    }
  }

  private resolveCollisionsY(room: Room): void {
    const p = this.player;
    const pRect: Rect = { x: p.x + 2, y: p.y, w: PLAYER_W - 4, h: PLAYER_H };

    for (const plat of room.platforms) {
      if (rectsOverlap(pRect, plat)) {
        if (p.vy > 0) {
          p.y = plat.y - PLAYER_H;
          p.vy = 0;
          p.onGround = true;
        } else if (p.vy < 0) {
          p.y = plat.y + plat.h;
          p.vy = 0;
        }
        pRect.y = p.y;
      }
    }
    // Opened doors that are bridges (wrench type) become platforms
    for (const d of room.doors) {
      if (d.requiresItem === 'wrench' && d.open) {
        // Treat as platform
        if (rectsOverlap(pRect, d)) {
          if (p.vy > 0) {
            p.y = d.y - PLAYER_H;
            p.vy = 0;
            p.onGround = true;
          }
          pRect.y = p.y;
        }
      }
      if (!d.open) {
        if (rectsOverlap(pRect, d)) {
          if (p.vy > 0) {
            p.y = d.y - PLAYER_H;
            p.vy = 0;
            p.onGround = true;
          } else if (p.vy < 0) {
            p.y = d.y + d.h;
            p.vy = 0;
          }
          pRect.y = p.y;
        }
      }
    }
  }

  private tryInteract(): void {
    const room = this.currentRoom();
    const p = this.player;
    const px = p.x + PLAYER_W / 2;
    const py = p.y + PLAYER_H / 2;

    for (const d of room.doors) {
      if (d.open) continue;
      const dx = (d.x + d.w / 2) - px;
      const dy = (d.y + d.h / 2) - py;
      if (Math.abs(dx) < 40 && Math.abs(dy) < 40) {
        const idx = this.inventory.indexOf(d.requiresItem);
        if (idx >= 0) {
          d.open = true;
          this.openedDoors.add(d.id);
          this.inventory.splice(idx, 1);
          if (this.selectedSlot >= this.inventory.length) this.selectedSlot = Math.max(0, this.inventory.length - 1);
          audio.powerup();
          this.showMsg(this.doorActionName(d.requiresItem));
        } else {
          this.showMsg('Need: ' + this.itemName(d.requiresItem));
          audio.hit();
        }
        return;
      }
    }

    // Check if near a spring item on ground (use from inventory for super jump)
    if (this.inventory.includes('spring') && p.onGround) {
      this.inventory.splice(this.inventory.indexOf('spring'), 1);
      if (this.selectedSlot >= this.inventory.length) this.selectedSlot = Math.max(0, this.inventory.length - 1);
      p.vy = JUMP_VEL * 1.8;
      p.onGround = false;
      audio.jump();
      this.showMsg('SUPER JUMP!');
      return;
    }

    this.showMsg('Nothing to interact with');
  }

  private doorActionName(item: ItemType): string {
    switch (item) {
      case 'key': return 'Door unlocked!';
      case 'gear': return 'Gear mechanism activated!';
      case 'oil_can': return 'Rust cleared!';
      case 'wrench': return 'Bridge repaired!';
      default: return 'Used ' + item;
    }
  }

  private itemName(type: ItemType): string {
    switch (type) {
      case 'gear': return 'Gear';
      case 'key': return 'Key';
      case 'oil_can': return 'Oil Can';
      case 'spring': return 'Spring';
      case 'wrench': return 'Wrench';
      case 'core_gear': return 'Core Gear';
      case 'bonus_cog': return 'Bonus Cog';
    }
  }

  private showMsg(msg: string): void {
    this.interactMsg = msg;
    this.interactMsgTimer = 2.0;
  }

  private hitPlayer(): void {
    if (this.invincibleTimer > 0) return;
    this.lives--;
    audio.lose();
    if (this.lives <= 0) {
      this.state = 'gameover';
      audio.explosion();
    } else {
      this.respawnTimer = 0.8;
      this.invincibleTimer = 2.0;
    }
  }

  private respawnAtRoomEntrance(): void {
    // Spawn at a safe position based on which direction we entered
    this.spawnPlayer(60, PLAY_H - 60);
  }

  private winGame(): void {
    this.won = true;
    this.endTime = performance.now();
    const elapsed = (this.endTime - this.startTime) / 1000;
    const timeBonus = Math.max(0, Math.floor(600 - elapsed));
    this.score += timeBonus;
    this.state = 'gameover';
    audio.powerup();
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();

    if (this.state === 'menu') {
      this.renderMenu(ctx);
      ctx.restore();
      return;
    }

    // HUD background
    ctx.fillStyle = COL_HUD_BG;
    ctx.fillRect(0, 0, W, HUD_H);

    // Room rendering area
    ctx.save();
    ctx.translate(0, PLAY_Y);

    // Transition flash effect
    if (this.transitionTimer > 0) {
      const alpha = this.transitionTimer / 0.25;
      this.renderRoom(ctx);
      ctx.fillStyle = `rgba(26,16,8,${alpha})`;
      ctx.fillRect(0, 0, W, PLAY_H);
    } else {
      this.renderRoom(ctx);
    }

    // Render player
    if (this.respawnTimer <= 0) {
      const visible = this.invincibleTimer <= 0 || Math.floor(this.invincibleTimer * 10) % 2 === 0;
      if (visible) {
        this.renderPlayer(ctx);
      }
    }

    ctx.restore();

    // HUD
    this.renderHUD(ctx);

    // Interaction message
    if (this.interactMsgTimer > 0) {
      const alpha = Math.min(1, this.interactMsgTimer);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = COL_AMBER;
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.interactMsg, W / 2, H - 20);
      ctx.globalAlpha = 1;
    }

    // Pause overlay
    if (this.state === 'paused') {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = COL_AMBER;
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, H / 2);
      ctx.font = '12px monospace';
      ctx.fillStyle = COL_TEXT;
      ctx.fillText('Press ENTER to resume', W / 2, H / 2 + 30);
    }

    // Game over / win overlay
    if (this.state === 'gameover') {
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      if (this.won) {
        ctx.fillStyle = COL_GOLD;
        ctx.font = 'bold 28px monospace';
        ctx.fillText('QUEST COMPLETE!', W / 2, H / 2 - 40);
        ctx.font = '14px monospace';
        ctx.fillStyle = COL_TEXT;
        ctx.fillText('All Core Gears collected!', W / 2, H / 2 - 10);
        ctx.fillText('Score: ' + this.score, W / 2, H / 2 + 15);
        const elapsed = Math.floor((this.endTime - this.startTime) / 1000);
        ctx.fillText('Time: ' + Math.floor(elapsed / 60) + ':' + String(elapsed % 60).padStart(2, '0'), W / 2, H / 2 + 35);
      } else {
        ctx.fillStyle = COL_DANGER;
        ctx.font = 'bold 28px monospace';
        ctx.fillText('GAME OVER', W / 2, H / 2 - 20);
        ctx.font = '14px monospace';
        ctx.fillStyle = COL_TEXT;
        ctx.fillText('Score: ' + this.score, W / 2, H / 2 + 10);
      }
      ctx.font = '12px monospace';
      ctx.fillStyle = COL_BRONZE;
      ctx.fillText('Press SPACE to continue', W / 2, H / 2 + 60);
    }

    ctx.restore();
  }

  private renderMenu(ctx: CanvasRenderingContext2D): void {
    // Dark steampunk background
    ctx.fillStyle = COL_BG;
    ctx.fillRect(0, 0, W, H);

    // Decorative gears in background
    const t = this.globalTimer;
    this.drawGearDecor(ctx, 80, 80, 40, t * 0.5, COL_GEAR_DARK);
    this.drawGearDecor(ctx, 400, 100, 30, -t * 0.7, COL_GEAR_DARK);
    this.drawGearDecor(ctx, 120, 240, 25, t * 0.6, COL_GEAR_DARK);
    this.drawGearDecor(ctx, 380, 250, 35, -t * 0.4, COL_GEAR_DARK);
    this.drawGearDecor(ctx, 240, 60, 20, t * 0.8, COL_GEAR_DARK);

    // Title
    ctx.textAlign = 'center';
    ctx.fillStyle = COL_AMBER;
    ctx.font = 'bold 32px monospace';
    ctx.fillText("TINKER'S QUEST", W / 2, 130);

    // Subtitle
    ctx.fillStyle = COL_BRONZE;
    ctx.font = '14px monospace';
    ctx.fillText('A Clockwork Adventure', W / 2, 158);

    // Small robot preview
    this.drawRobotPreview(ctx, W / 2 - 10, 190);

    // Blinking prompt
    if (Math.floor(this.menuBlink * 2) % 2 === 0) {
      ctx.fillStyle = COL_TEXT;
      ctx.font = 'bold 14px monospace';
      ctx.fillText('Press SPACE to start', W / 2, 250);
    }

    // Controls
    ctx.fillStyle = COL_PLAT_TOP;
    ctx.font = '11px monospace';
    ctx.fillText('Arrows: Move  |  X: Jump  |  Z: Interact', W / 2, 285);
    ctx.fillText('Down+Z: Cycle Inventory  |  Collect 5 Core Gears!', W / 2, 300);
  }

  private drawGearDecor(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, angle: number, color: string): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    // Teeth
    const teeth = Math.max(6, Math.floor(r / 4));
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.lineTo(Math.cos(a) * (r + 6), Math.sin(a) * (r + 6));
      ctx.stroke();
    }
    // Inner circle
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawRobotPreview(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    // Larger preview robot for menu
    const s = 2;
    // Body
    ctx.fillStyle = COL_BRONZE;
    ctx.fillRect(x, y, 16 * s, 12 * s);
    // Head
    ctx.fillStyle = '#a0764e';
    ctx.fillRect(x + 3 * s, y - 8 * s, 10 * s, 8 * s);
    // Eye
    ctx.fillStyle = COL_AMBER;
    ctx.fillRect(x + 6 * s, y - 6 * s, 3 * s, 3 * s);
    // Antenna
    ctx.fillStyle = COL_GOLD;
    ctx.fillRect(x + 7 * s, y - 11 * s, 2 * s, 3 * s);
    ctx.fillRect(x + 6 * s, y - 12 * s, 4 * s, 2 * s);
    // Legs
    ctx.fillStyle = COL_RUST;
    ctx.fillRect(x + 2 * s, y + 12 * s, 4 * s, 4 * s);
    ctx.fillRect(x + 10 * s, y + 12 * s, 4 * s, 4 * s);
  }

  private renderRoom(ctx: CanvasRenderingContext2D): void {
    const room = this.currentRoom();

    // Background
    ctx.fillStyle = COL_BG;
    ctx.fillRect(0, 0, W, PLAY_H);

    // Background pipes decoration
    ctx.strokeStyle = '#2a1a10';
    ctx.lineWidth = 3;
    const seed = this.roomX * 7 + this.roomY * 13;
    for (let i = 0; i < 3; i++) {
      const py = 40 + ((seed + i * 47) % 180);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(W, py);
      ctx.stroke();
    }
    // Vertical pipes
    for (let i = 0; i < 2; i++) {
      const px = 100 + ((seed + i * 83) % 300);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, PLAY_H);
      ctx.stroke();
    }

    // Background rivets
    ctx.fillStyle = '#2a1a10';
    for (let i = 0; i < 8; i++) {
      const rx = (seed * 17 + i * 67) % W;
      const ry = (seed * 23 + i * 41) % PLAY_H;
      ctx.beginPath();
      ctx.arc(rx, ry, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Platforms
    for (const plat of room.platforms) {
      ctx.fillStyle = COL_PLAT;
      ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
      // Top highlight
      ctx.fillStyle = COL_PLAT_TOP;
      ctx.fillRect(plat.x, plat.y, plat.w, 2);
      // Rivets on platforms
      if (plat.w > 30) {
        ctx.fillStyle = COL_RUST;
        const count = Math.floor(plat.w / 24);
        for (let i = 0; i < count; i++) {
          const rx = plat.x + 12 + i * 24;
          ctx.beginPath();
          ctx.arc(rx, plat.y + plat.h / 2, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Doors
    for (const d of room.doors) {
      if (d.open) {
        if (d.requiresItem === 'wrench') {
          // Repaired bridge - draw as platform
          ctx.fillStyle = COL_PLAT_TOP;
          ctx.fillRect(d.x, d.y, d.w, d.h);
          ctx.fillStyle = COL_BRONZE;
          ctx.fillRect(d.x, d.y, d.w, 2);
        }
        // Other opened doors just disappear
      } else {
        // Draw based on type
        if (d.requiresItem === 'wrench') {
          // Broken bridge: dashed line
          ctx.strokeStyle = COL_RUST;
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(d.x, d.y + d.h / 2);
          ctx.lineTo(d.x + d.w, d.y + d.h / 2);
          ctx.stroke();
          ctx.setLineDash([]);
          // "Broken" label
          ctx.fillStyle = COL_RUST;
          ctx.font = '8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('BROKEN', d.x + d.w / 2, d.y + d.h / 2 - 4);
        } else if (d.requiresItem === 'oil_can') {
          // Rusty blockage
          ctx.fillStyle = COL_RUST;
          ctx.fillRect(d.x, d.y, d.w, d.h);
          // Rust texture
          ctx.fillStyle = '#6b3410';
          for (let i = 0; i < 5; i++) {
            ctx.fillRect(d.x + (i * 5) % d.w, d.y + (i * 7) % d.h, 3, 3);
          }
        } else if (d.requiresItem === 'gear') {
          // Gear-locked mechanism
          ctx.fillStyle = COL_DOOR;
          ctx.fillRect(d.x, d.y, d.w, d.h);
          // Gear socket
          this.drawGearDecor(ctx, d.x + d.w / 2, d.y + d.h / 2, 8, this.globalTimer, COL_AMBER);
        } else {
          // Key-locked door
          ctx.fillStyle = COL_DOOR;
          ctx.fillRect(d.x, d.y, d.w, d.h);
          // Keyhole
          ctx.fillStyle = '#1a0a00';
          ctx.beginPath();
          ctx.arc(d.x + d.w / 2, d.y + d.h * 0.4, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillRect(d.x + d.w / 2 - 1, d.y + d.h * 0.4, 2, 8);
        }
      }
    }

    // Hazards
    for (const h of room.hazards) {
      if (h.type === 'steam_vent') {
        // Vent base
        ctx.fillStyle = COL_WALL;
        ctx.fillRect(h.x - 2, h.y, h.w + 4, 6);
        // Steam cloud
        if (h.active) {
          const alpha = 0.3 + Math.sin(this.globalTimer * 10) * 0.15;
          ctx.fillStyle = `rgba(200,200,200,${alpha})`;
          for (let i = 0; i < 4; i++) {
            const sy = h.y - i * (h.h / 4) - 5;
            const sw = h.w + i * 4 + Math.sin(this.globalTimer * 8 + i) * 3;
            ctx.beginPath();
            ctx.ellipse(h.x + h.w / 2, sy, sw / 2, 6, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      if (h.type === 'spinning_gear') {
        this.drawGearDecor(ctx, h.x + h.w / 2, h.y + h.h / 2, h.radius || 12, h.angle || 0, COL_DANGER);
        // Center dot
        ctx.fillStyle = COL_DANGER;
        ctx.beginPath();
        ctx.arc(h.x + h.w / 2, h.y + h.h / 2, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Items
    for (const item of room.items) {
      if (item.collected) continue;
      this.renderItem(ctx, item.type, item.x, item.y, item.w, item.h);
    }

    // Room coordinates indicator (subtle)
    ctx.fillStyle = 'rgba(245,158,11,0.15)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`[${this.roomX},${this.roomY}]`, W - 4, PLAY_H - 4);
  }

  private renderItem(ctx: CanvasRenderingContext2D, type: ItemType, x: number, y: number, w: number, h: number): void {
    const bob = Math.sin(this.globalTimer * 3 + x) * 2;
    const iy = y + bob;

    switch (type) {
      case 'core_gear':
        // Glowing golden gear
        ctx.fillStyle = COL_GOLD;
        ctx.shadowColor = COL_GOLD;
        ctx.shadowBlur = 8;
        this.drawGearDecor(ctx, x + w / 2, iy + h / 2, 7, this.globalTimer * 2, COL_GOLD);
        ctx.fillStyle = COL_GOLD;
        ctx.beginPath();
        ctx.arc(x + w / 2, iy + h / 2, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        break;
      case 'gear':
        this.drawGearDecor(ctx, x + w / 2, iy + h / 2, 6, this.globalTimer, COL_BRONZE);
        ctx.fillStyle = COL_BRONZE;
        ctx.beginPath();
        ctx.arc(x + w / 2, iy + h / 2, 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'key':
        ctx.fillStyle = COL_GOLD;
        ctx.fillRect(x + 2, iy + 2, 8, 4);
        ctx.fillRect(x + 8, iy, 4, 8);
        ctx.fillRect(x + 2, iy + 8, 4, 4);
        break;
      case 'oil_can':
        ctx.fillStyle = '#555';
        ctx.fillRect(x + 2, iy + 4, 8, 10);
        ctx.fillStyle = '#777';
        ctx.fillRect(x + 4, iy, 4, 5);
        // Oil drip
        ctx.fillStyle = '#222';
        ctx.fillRect(x + 5, iy + 13, 2, 2);
        break;
      case 'spring':
        ctx.strokeStyle = COL_AMBER;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const sx = x + 2 + (i % 2) * 8;
          const sy = iy + 2 + i * 3;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        // Base
        ctx.fillStyle = COL_AMBER;
        ctx.fillRect(x + 1, iy + 12, 10, 2);
        break;
      case 'wrench':
        ctx.fillStyle = '#aaa';
        ctx.fillRect(x + 4, iy + 2, 4, 12);
        ctx.fillRect(x + 2, iy, 8, 4);
        ctx.fillStyle = '#888';
        ctx.fillRect(x + 3, iy + 1, 2, 2);
        ctx.fillRect(x + 7, iy + 1, 2, 2);
        break;
      case 'bonus_cog':
        ctx.fillStyle = COL_AMBER;
        ctx.beginPath();
        ctx.arc(x + w / 2, iy + h / 2, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COL_BG;
        ctx.beginPath();
        ctx.arc(x + w / 2, iy + h / 2, 2, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
  }

  private renderPlayer(ctx: CanvasRenderingContext2D): void {
    const p = this.player;
    const x = Math.round(p.x);
    const y = Math.round(p.y);

    ctx.save();
    if (!p.facingRight) {
      ctx.translate(x + PLAYER_W, 0);
      ctx.scale(-1, 1);
      ctx.translate(-x, 0);
    }

    // Body
    ctx.fillStyle = COL_BRONZE;
    ctx.fillRect(x + 2, y + 8, 12, 8);

    // Head
    ctx.fillStyle = '#a0764e';
    ctx.fillRect(x + 3, y, 10, 8);

    // Eye (single glowing eye)
    ctx.fillStyle = COL_AMBER;
    const eyeX = x + 9;
    ctx.fillRect(eyeX, y + 2, 3, 3);

    // Antenna
    ctx.fillStyle = COL_GOLD;
    ctx.fillRect(x + 7, y - 3, 2, 3);
    // Antenna tip blinks
    if (Math.floor(this.globalTimer * 4) % 2 === 0) {
      ctx.fillStyle = COL_AMBER;
      ctx.fillRect(x + 6, y - 4, 4, 2);
    }

    // Legs (animate)
    ctx.fillStyle = COL_RUST;
    const legOffset = p.onGround ? Math.sin(p.walkFrame * Math.PI / 2) * 2 : 0;
    ctx.fillRect(x + 3, y + 16 + legOffset, 4, 4);
    ctx.fillRect(x + 9, y + 16 - legOffset, 4, 4);

    // Arm
    ctx.fillStyle = '#8b6340';
    const armY = p.onGround ? y + 9 : y + 7;
    ctx.fillRect(x + 13, armY, 3, 5);

    ctx.restore();
  }

  private renderHUD(ctx: CanvasRenderingContext2D): void {
    // Lives
    ctx.fillStyle = COL_TEXT;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i < this.lives; i++) {
      // Small hearts/gears as lives
      ctx.fillStyle = COL_DANGER;
      ctx.beginPath();
      ctx.arc(12 + i * 16, 14, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COL_BG;
      ctx.beginPath();
      ctx.arc(12 + i * 16, 14, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Score
    ctx.fillStyle = COL_TEXT;
    ctx.textAlign = 'center';
    ctx.fillText('Score: ' + this.score, W / 2, 18);

    // Core gears count
    ctx.fillStyle = COL_GOLD;
    ctx.textAlign = 'right';
    ctx.fillText('Cores: ' + this.coreGearsFound + '/' + this.totalCoreGears, W - 8, 12);

    // Inventory
    ctx.textAlign = 'right';
    const invStartX = W - 8;
    ctx.fillStyle = COL_TEXT;
    ctx.font = '9px monospace';
    if (this.inventory.length > 0) {
      for (let i = 0; i < this.inventory.length; i++) {
        const ix = invStartX - (this.inventory.length - 1 - i) * 44;
        const iy = 20;
        // Slot border
        ctx.strokeStyle = i === this.selectedSlot ? COL_AMBER : COL_GEAR_DARK;
        ctx.lineWidth = i === this.selectedSlot ? 2 : 1;
        ctx.strokeRect(ix - 38, iy - 3, 40, 12);
        // Item name
        ctx.fillStyle = i === this.selectedSlot ? COL_AMBER : COL_TEXT;
        ctx.textAlign = 'center';
        ctx.fillText(this.itemName(this.inventory[i]).substring(0, 6), ix - 18, iy + 6);
      }
    }

    // Mini map at bottom-right — actually let's put it in HUD area left side
    // Removed to keep HUD clean
  }

  resize(_w: number, _h: number): void {}
  getScore(): number { return this.score; }
  getState(): GameState { return this.state; }
  destroy(): void {}
}
