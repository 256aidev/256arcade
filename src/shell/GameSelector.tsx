import { useEffect, useRef, useCallback } from 'react';
import { GAMES } from '../games/registry';
import { getTopScore } from '../engine/ScoreManager';

interface Props {
  onSelect: (gameId: string) => void;
}

// Draw a mini preview scene for each game on a small canvas
function drawPreview(ctx: CanvasRenderingContext2D, gameId: string, color: string, w: number, h: number) {
  // Dark background
  ctx.fillStyle = '#080818';
  ctx.fillRect(0, 0, w, h);

  // Subtle grid
  ctx.strokeStyle = '#1a1a3a';
  ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  ctx.shadowColor = color;
  ctx.shadowBlur = 6;

  switch (gameId) {
    case 'rocket-hop': {
      // Rocket and pipes
      ctx.fillStyle = '#ff6b35';
      ctx.fillRect(40, 40, 12, 18); // rocket body
      ctx.fillStyle = '#ffaa00';
      ctx.fillRect(43, 58, 6, 8); // flame
      // Asteroids/pipes
      ctx.fillStyle = '#444';
      ctx.fillRect(90, 0, 20, 30);
      ctx.fillRect(90, 60, 20, 40);
      ctx.fillRect(140, 0, 20, 45);
      ctx.fillRect(140, 72, 20, 28);
      // Stars
      ctx.fillStyle = '#fff';
      for (const [sx, sy] of [[15, 12], [60, 8], [120, 82], [170, 15], [30, 75]]) {
        ctx.fillRect(sx, sy, 2, 2);
      }
      break;
    }
    case 'cosmic-rally': {
      // Paddles and ball
      ctx.fillStyle = '#00ff88';
      ctx.fillRect(10, 30, 6, 30); // left paddle
      ctx.fillStyle = '#ff0080';
      ctx.fillRect(w - 16, 35, 6, 30); // right paddle
      // Ball
      ctx.fillStyle = '#00d4ff';
      ctx.beginPath(); ctx.arc(w / 2, h / 2, 5, 0, Math.PI * 2); ctx.fill();
      // Center line
      ctx.strokeStyle = '#2a2a4a';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
      ctx.setLineDash([]);
      // Score
      ctx.fillStyle = '#00ff88'; ctx.font = 'bold 14px monospace'; ctx.fillText('7', w / 2 - 20, 18);
      ctx.fillStyle = '#ff0080'; ctx.fillText('5', w / 2 + 14, 18);
      break;
    }
    case 'shatter-grid': {
      // Brick rows
      const colors = ['#00d4ff', '#22c55e', '#eab308', '#f97316', '#ef4444', '#d946ef'];
      for (let row = 0; row < 6; row++) {
        ctx.fillStyle = colors[row];
        for (let col = 0; col < 9; col++) {
          if (Math.random() > 0.2) ctx.fillRect(6 + col * 20, 6 + row * 10, 18, 8);
        }
      }
      // Paddle
      ctx.fillStyle = '#00d4ff';
      ctx.fillRect(70, h - 12, 40, 6);
      // Ball
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(90, h - 24, 4, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'pixel-dash': {
      // Lanes with cars
      ctx.fillStyle = '#1a1a2a';
      for (let row = 1; row < 9; row++) ctx.fillRect(0, row * 10, w, 10);
      // Cars
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(30, 20, 20, 8); ctx.fillRect(100, 40, 20, 8);
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(60, 50, 20, 8); ctx.fillRect(140, 30, 20, 8);
      // Player robot
      ctx.fillStyle = '#ff0080';
      ctx.fillRect(85, 80, 10, 10);
      // Safe zones
      ctx.fillStyle = '#0a2a0a';
      ctx.fillRect(0, 0, w, 10); ctx.fillRect(0, h - 10, w, 10);
      break;
    }
    case 'neon-swarm': {
      // Centipede segments
      ctx.fillStyle = '#8b5cf6';
      for (let i = 0; i < 8; i++) {
        ctx.beginPath(); ctx.arc(30 + i * 14, 25, 5, 0, Math.PI * 2); ctx.fill();
      }
      // Mushrooms/nodes
      ctx.fillStyle = '#22c55e';
      for (const [mx, my] of [[40, 50], [80, 40], [120, 55], [60, 70], [140, 45], [100, 65]]) {
        ctx.fillRect(mx - 4, my - 4, 8, 8);
      }
      // Player
      ctx.fillStyle = '#00d4ff';
      ctx.beginPath(); ctx.moveTo(90, h - 10); ctx.lineTo(84, h - 2); ctx.lineTo(96, h - 2); ctx.fill();
      // Bullet
      ctx.fillStyle = '#fff';
      ctx.fillRect(89, h - 25, 2, 8);
      break;
    }
    case 'slime-dungeon': {
      // Platforms
      ctx.fillStyle = '#555';
      ctx.fillRect(0, h - 6, w, 6);
      ctx.fillRect(20, 55, 50, 6); ctx.fillRect(100, 40, 50, 6); ctx.fillRect(50, 25, 50, 6);
      // Wizard
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(30, 45, 8, 10); // body
      ctx.beginPath(); ctx.moveTo(34, 38); ctx.lineTo(28, 45); ctx.lineTo(40, 45); ctx.fill(); // hat
      // Enemies (slimes)
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(120, 35, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#eab308';
      ctx.beginPath(); ctx.arc(70, 20, 5, 0, Math.PI * 2); ctx.fill();
      // Bubble
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(55, 48, 5, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'void-patrol': {
      // Terrain
      ctx.fillStyle = '#1a1a2a';
      ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, h - 10);
      for (let x = 0; x < w; x += 10) ctx.lineTo(x, h - 8 - Math.random() * 8);
      ctx.lineTo(w, h); ctx.fill();
      // Ship
      ctx.fillStyle = '#3b82f6';
      ctx.beginPath(); ctx.moveTo(50, 40); ctx.lineTo(38, 48); ctx.lineTo(50, 45); ctx.lineTo(62, 48); ctx.fill();
      // Enemies
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(110, 30, 8, 8); ctx.fillRect(140, 50, 8, 8);
      // Bullets
      ctx.fillStyle = '#fff';
      ctx.fillRect(62, 42, 12, 2);
      // Scanner bar
      ctx.fillStyle = '#1a1a3a';
      ctx.fillRect(20, 4, w - 40, 8);
      ctx.fillStyle = '#fff';
      ctx.fillRect(60, 5, 3, 6);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(110, 5, 2, 6); ctx.fillRect(130, 5, 2, 6);
      break;
    }
    case 'iron-fist-alley': {
      // Rain
      ctx.strokeStyle = '#3355aa22';
      ctx.lineWidth = 1;
      for (let i = 0; i < 20; i++) {
        const rx = Math.random() * w, ry = Math.random() * h;
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 2, ry + 8); ctx.stroke();
      }
      // Building silhouettes
      ctx.fillStyle = '#0a0a20';
      ctx.fillRect(0, 0, 30, 50); ctx.fillRect(35, 0, 25, 35); ctx.fillRect(130, 0, 40, 45);
      // Neon sign
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(135, 15, 30, 8);
      // Player
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(70, 55, 10, 20); // body
      ctx.fillRect(65, 50, 8, 8); // head
      ctx.fillRect(80, 60, 12, 4); // punch
      // Enemy
      ctx.fillStyle = '#888';
      ctx.fillRect(120, 58, 10, 18); ctx.fillRect(118, 53, 8, 8);
      break;
    }
    case 'tinkers-quest': {
      // Steampunk room
      ctx.fillStyle = '#2a1f14';
      ctx.fillRect(0, 0, w, h);
      // Pipes
      ctx.fillStyle = '#8B7355';
      ctx.fillRect(0, 20, w, 4); ctx.fillRect(0, h - 20, w, 4);
      ctx.fillRect(10, 20, 4, h - 40);
      // Platforms
      ctx.fillStyle = '#6b4423';
      ctx.fillRect(30, 60, 50, 6); ctx.fillRect(100, 45, 50, 6); ctx.fillRect(60, 30, 40, 6);
      // Robot
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(45, 50, 8, 10); ctx.fillRect(47, 46, 4, 4);
      // Gear
      ctx.strokeStyle = '#cd7f32';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(130, 40, 6, 0, Math.PI * 2); ctx.stroke();
      // Core gear (glowing)
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath(); ctx.arc(80, 24, 4, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'nitro-circuit': {
      // Road perspective
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.moveTo(w / 2 - 5, 10); ctx.lineTo(w / 2 + 5, 10);
      ctx.lineTo(w - 10, h); ctx.lineTo(10, h);
      ctx.fill();
      // Road lines
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(w / 2, 10); ctx.lineTo(w / 2, h); ctx.stroke();
      // Rumble strips
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(15, h - 30, 8, 6); ctx.fillRect(w - 23, h - 30, 8, 6);
      ctx.fillRect(22, h - 50, 6, 5); ctx.fillRect(w - 28, h - 50, 6, 5);
      // Player car
      ctx.fillStyle = '#ec4899';
      ctx.fillRect(w / 2 - 8, h - 20, 16, 12);
      // Sky
      ctx.fillStyle = '#1a0a2a';
      ctx.fillRect(0, 0, w, 15);
      // Mountains
      ctx.fillStyle = '#2a1a3a';
      ctx.beginPath(); ctx.moveTo(0, 15); ctx.lineTo(40, 5); ctx.lineTo(80, 12); ctx.lineTo(120, 3); ctx.lineTo(w, 15); ctx.fill();
      break;
    }
    case 'turbo-kickoff': {
      // Pitch
      ctx.fillStyle = '#0a3a0a';
      ctx.fillRect(0, 0, w, h);
      // Lines
      ctx.strokeStyle = '#14b8a622';
      ctx.lineWidth = 1;
      ctx.strokeRect(10, 10, w - 20, h - 20);
      ctx.beginPath(); ctx.moveTo(w / 2, 10); ctx.lineTo(w / 2, h - 10); ctx.stroke();
      ctx.beginPath(); ctx.arc(w / 2, h / 2, 20, 0, Math.PI * 2); ctx.stroke();
      // Goals
      ctx.strokeStyle = '#14b8a6';
      ctx.lineWidth = 2;
      ctx.strokeRect(w / 2 - 15, 5, 30, 8);
      ctx.strokeRect(w / 2 - 15, h - 13, 30, 8);
      // Players - teal team
      ctx.fillStyle = '#14b8a6';
      for (const [px, py] of [[50, 60], [90, 40], [70, 50], [w / 2, 70]]) {
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
      }
      // Players - orange team
      ctx.fillStyle = '#f97316';
      for (const [px, py] of [[100, 30], [130, 50], [110, 45], [w / 2, 25]]) {
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
      }
      // Ball
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath(); ctx.arc(w / 2 + 10, h / 2, 3, 0, Math.PI * 2); ctx.fill();
      break;
    }
  }

  ctx.shadowBlur = 0;

  // Gradient overlay at bottom for text readability
  const grad = ctx.createLinearGradient(0, h - 30, 0, h);
  grad.addColorStop(0, 'transparent');
  grad.addColorStop(1, '#12122a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, h - 30, w, 30);
}

function GamePreview({ gameId, color }: { gameId: string; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(false);

  const draw = useCallback(() => {
    if (drawn.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawPreview(ctx, gameId, color, canvas.width, canvas.height);
    drawn.current = true;
  }, [gameId, color]);

  useEffect(() => { draw(); }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={180}
      height={100}
      className="w-full rounded-t-xl"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

export function GameSelector({ onSelect }: Props) {
  return (
    <div className="h-full flex flex-col" style={{ background: '#0a0a1a' }}>
      <header className="py-5 px-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight" style={{ color: '#00ff88', textShadow: '0 0 20px #00ff8844' }}>
          256 ARCADE
        </h1>
        <p className="text-sm mt-1" style={{ color: '#6a6a8a' }}>
          {GAMES.length} retro games — pick one and play
        </p>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
          {GAMES.map((game) => {
            const top = getTopScore(game.id);
            return (
              <button
                key={game.id}
                onClick={() => onSelect(game.id)}
                className="text-left rounded-xl transition-all duration-200 hover:scale-[1.03] hover:shadow-lg cursor-pointer border overflow-hidden"
                style={{
                  background: '#12122a',
                  borderColor: '#2a2a4a',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = game.color;
                  (e.currentTarget as HTMLElement).style.boxShadow = `0 0 24px ${game.color}44`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = '#2a2a4a';
                  (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                }}
              >
                <GamePreview gameId={game.id} color={game.color} />
                <div className="p-4">
                  <div className="flex items-start justify-between mb-1">
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded"
                      style={{ background: game.color + '22', color: game.color }}
                    >
                      {game.genre}
                    </span>
                    {top > 0 && (
                      <span className="text-xs" style={{ color: '#6a6a8a' }}>
                        HI: {top.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <h2 className="text-lg font-bold" style={{ color: '#e0e0ff' }}>
                    {game.name}
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: '#6a6a8a' }}>
                    {game.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
