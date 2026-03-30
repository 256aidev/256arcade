import { GAMES } from '../games/registry';
import { getTopScore } from '../engine/ScoreManager';

interface Props {
  onSelect: (gameId: string) => void;
}

export function GameSelector({ onSelect }: Props) {
  return (
    <div className="h-full flex flex-col" style={{ background: '#0a0a1a' }}>
      <header className="py-6 px-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight" style={{ color: '#00ff88' }}>
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
                className="text-left rounded-xl p-5 transition-all duration-200 hover:scale-[1.03] hover:shadow-lg cursor-pointer border"
                style={{
                  background: '#12122a',
                  borderColor: '#2a2a4a',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = game.color;
                  (e.currentTarget as HTMLElement).style.boxShadow = `0 0 20px ${game.color}33`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = '#2a2a4a';
                  (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                }}
              >
                <div className="flex items-start justify-between mb-2">
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
                <h2 className="text-xl font-bold mb-1" style={{ color: '#e0e0ff' }}>
                  {game.name}
                </h2>
                <p className="text-sm" style={{ color: '#6a6a8a' }}>
                  {game.description}
                </p>
                <p className="text-xs mt-3" style={{ color: '#4a4a6a' }}>
                  {game.controls}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
