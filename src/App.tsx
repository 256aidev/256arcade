import { useState } from 'react';
import { GameSelector } from './shell/GameSelector';
import { GameWrapper } from './shell/GameWrapper';

function App() {
  const [activeGame, setActiveGame] = useState<string | null>(null);

  if (activeGame) {
    return <GameWrapper gameId={activeGame} onBack={() => setActiveGame(null)} />;
  }

  return <GameSelector onSelect={setActiveGame} />;
}

export default App;
