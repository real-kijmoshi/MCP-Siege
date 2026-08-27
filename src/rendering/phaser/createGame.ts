import Phaser from 'phaser';
import type { SimulationEngine } from '../../game/simulation/Engine';
import { GameScene } from './GameScene';

export interface BattlefieldGame {
  game: Phaser.Game;
  scene: GameScene;
}

export function createGame(engine: SimulationEngine): BattlefieldGame {
  const scene = new GameScene(engine);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-canvas',
    backgroundColor: '#20291f',
    scene: [scene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
    },
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: true,
    },
  });
  return { game, scene };
}
