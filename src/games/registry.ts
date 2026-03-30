import { GameInfo } from '../types/IGame';

export const GAMES: GameInfo[] = [
  { id: 'rocket-hop', name: 'Rocket Hop', description: 'Tap to thrust through asteroid gaps', genre: 'Arcade', color: '#ff6b35', controls: 'Space/Tap to thrust' },
  { id: 'cosmic-rally', name: 'Cosmic Rally', description: 'Neon space paddle duel', genre: 'Sports', color: '#00ff88', controls: 'W/S & Up/Down arrows' },
  { id: 'shatter-grid', name: 'Shatter Grid', description: 'Break the encrypted data blocks', genre: 'Arcade', color: '#00d4ff', controls: 'Left/Right to move, Space to launch' },
  { id: 'pixel-dash', name: 'Pixel Dash', description: 'Cross the cyberpunk factory alive', genre: 'Action', color: '#ff0080', controls: 'Arrow keys to move' },
  { id: 'neon-swarm', name: 'Neon Swarm', description: 'Defend the data core from viruses', genre: 'Shooter', color: '#8b5cf6', controls: 'Left/Right to move, Space to shoot' },
  { id: 'slime-dungeon', name: 'Slime Dungeon', description: 'Trap dungeon creatures with magic orbs', genre: 'Platformer', color: '#22c55e', controls: 'Arrows to move, Z to shoot, X to jump' },
  { id: 'void-patrol', name: 'Void Patrol', description: 'Defend colonists across the asteroid belt', genre: 'Shooter', color: '#3b82f6', controls: 'Arrows to fly, Space to shoot' },
  { id: 'iron-fist-alley', name: 'Iron Fist Alley', description: 'Fight through the neon city streets', genre: 'Beat-em-up', color: '#ef4444', controls: 'Arrows to move, Z punch, X kick' },
  { id: 'tinkers-quest', name: "Tinker's Quest", description: 'Explore the steampunk world', genre: 'Adventure', color: '#f59e0b', controls: 'Arrows to move, Z interact, X jump' },
  { id: 'nitro-circuit', name: 'Nitro Circuit', description: 'Pseudo-3D retro racing', genre: 'Racing', color: '#ec4899', controls: 'Left/Right to steer, Up to accelerate' },
  { id: 'turbo-kickoff', name: 'Turbo Kickoff', description: 'Top-down future-sport action', genre: 'Sports', color: '#14b8a6', controls: 'Arrows to move, Z pass, X shoot' },
];

export type GameLoader = () => Promise<{ default: new () => import('../types/IGame').IGame }>;

export const GAME_LOADERS: Record<string, GameLoader> = {
  'rocket-hop': () => import('./rocket-hop/index'),
  'cosmic-rally': () => import('./cosmic-rally/index'),
  'shatter-grid': () => import('./shatter-grid/index'),
  'pixel-dash': () => import('./pixel-dash/index'),
  'neon-swarm': () => import('./neon-swarm/index'),
  'slime-dungeon': () => import('./slime-dungeon/index'),
  'void-patrol': () => import('./void-patrol/index'),
  'iron-fist-alley': () => import('./iron-fist-alley/index'),
  'tinkers-quest': () => import('./tinkers-quest/index'),
  'nitro-circuit': () => import('./nitro-circuit/index'),
  'turbo-kickoff': () => import('./turbo-kickoff/index'),
};
