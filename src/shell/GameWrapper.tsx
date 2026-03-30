import { useEffect, useRef, useState } from 'react';
import { IGame } from '../types/IGame';
import { GameLoop } from '../engine/GameLoop';
import { InputManager } from '../engine/Input';
import { CanvasManager } from '../engine/Canvas';
import { GAME_LOADERS, GAMES } from '../games/registry';
import { addScore, getTopScore } from '../engine/ScoreManager';
import { audio } from '../engine/Audio';

interface Props {
  gameId: string;
  onBack: () => void;
}

export function GameWrapper({ gameId, onBack }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<IGame | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const canvasRef = useRef<CanvasManager | null>(null);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [state, setState] = useState<string>('loading');
  const [muted, setMuted] = useState(audio.isMuted());
  const [gamepadConnected, setGamepadConnected] = useState(false);

  const gameInfo = GAMES.find(g => g.id === gameId);

  // Keep focus on the game container so keyboard works
  const refocusGame = () => {
    setTimeout(() => containerRef.current?.focus(), 0);
  };

  useEffect(() => {
    // Listen for gamepad connections
    const onGpConnect = () => setGamepadConnected(true);
    const onGpDisconnect = () => setGamepadConnected(false);
    window.addEventListener('gamepadconnected', onGpConnect);
    window.addEventListener('gamepaddisconnected', onGpDisconnect);

    // Check if already connected
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of gps) {
      if (gp) { setGamepadConnected(true); break; }
    }

    if (!containerRef.current) return;
    let destroyed = false;

    (async () => {
      const loader = GAME_LOADERS[gameId];
      if (!loader) return;

      const mod = await loader();
      if (destroyed) return;

      const cm = new CanvasManager(containerRef.current!, 480, 320);
      const input = new InputManager();
      const game = new mod.default();

      // Make canvas focusable and focus it
      cm.canvas.tabIndex = 1;
      cm.canvas.style.outline = 'none';
      cm.canvas.focus();

      canvasRef.current = cm;
      inputRef.current = input;
      gameRef.current = game;

      input.attach(cm.canvas);
      await game.init(cm.canvas);
      if (destroyed) return;

      setHighScore(getTopScore(gameId));
      setState('menu');

      const loop = new GameLoop(
        (dt) => {
          input.update();
          game.update(dt, { ...input.state });
          const s = game.getScore();
          const gs = game.getState();
          setScore(s);
          setState(gs);
          if (gs === 'gameover') {
            addScore(gameId, s);
            setHighScore(getTopScore(gameId));
          }
        },
        () => {
          cm.clear('#000');
          game.render(cm.ctx);
        }
      );
      loopRef.current = loop;
      loop.start();
    })();

    return () => {
      destroyed = true;
      loopRef.current?.stop();
      inputRef.current?.detach();
      canvasRef.current?.destroy();
      gameRef.current?.destroy();
      window.removeEventListener('gamepadconnected', onGpConnect);
      window.removeEventListener('gamepaddisconnected', onGpDisconnect);
    };
  }, [gameId]);

  return (
    <div className="h-full flex flex-col" style={{ background: '#000' }}>
      <div className="flex items-center justify-between px-3 py-2" style={{ background: '#0a0a1a' }}>
        <button
          onClick={(e) => { e.currentTarget.blur(); onBack(); }}
          onMouseDown={(e) => e.preventDefault()}
          className="text-sm px-3 py-1 rounded cursor-pointer"
          style={{ background: '#1a1a3a', color: '#6a6a8a' }}
          tabIndex={-1}
        >
          &larr; Back
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: gameInfo?.color || '#fff' }}>
            {gameInfo?.name || gameId}
          </span>
          {gamepadConnected && (
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#22c55e22', color: '#22c55e' }}>
              🎮
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: '#6a6a8a' }}>
            HI: {highScore.toLocaleString()}
          </span>
          <span className="text-sm font-bold" style={{ color: '#00ff88' }}>
            {score.toLocaleString()}
          </span>
          <button
            onClick={() => { setMuted(audio.toggleMute()); refocusGame(); }}
            onMouseDown={(e) => e.preventDefault()}
            className="text-sm px-2 py-1 rounded cursor-pointer"
            style={{ background: '#1a1a3a', color: '#6a6a8a' }}
            tabIndex={-1}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center overflow-hidden"
        onClick={refocusGame}
        tabIndex={0}
        style={{ outline: 'none' }}
      >
        {state === 'loading' && (
          <div className="text-center" style={{ color: '#6a6a8a' }}>Loading...</div>
        )}
      </div>
      {state === 'gameover' && (
        <div className="absolute inset-0 flex items-center justify-center z-10"
          style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="text-center p-8 rounded-xl" style={{ background: '#12122a', border: '1px solid #2a2a4a' }}>
            <h2 className="text-2xl font-bold mb-2" style={{ color: '#ff0080' }}>GAME OVER</h2>
            <p className="text-3xl font-bold mb-4" style={{ color: '#00ff88' }}>{score.toLocaleString()}</p>
            <div className="flex gap-3">
              <button
                onClick={onBack}
                className="px-4 py-2 rounded cursor-pointer"
                style={{ background: '#1a1a3a', color: '#e0e0ff' }}
              >
                Menu
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded cursor-pointer font-bold"
                style={{ background: '#00ff88', color: '#000' }}
              >
                Play Again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
