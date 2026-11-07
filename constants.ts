import {SpriteConfig} from './utils/helper';

/**
 * Configuration for the game.
 */
export const CONFIG = {
  // Game Initialization
  title: {
    value: 'Tile Surge',
    type: 'string',
    label: 'Game Title',
    group: 'GAME',
  },
  baseCanvasWidth: {
    value: 1376,
    type: 'number',
    label: 'Base Canvas Width',
    group: 'GAME',
  },
  baseCanvasHeight: {
    value: 768,
    type: 'number',
    label: 'Base Canvas Height',
    group: 'GAME',
  },

  // System
  targetFPS: {
    value: 60,
    type: 'number',
    label: 'Target FPS',
    group: 'SYSTEM',
  },
  stepMs: {
    value: 1000 / 60,
    type: 'number',
    label: 'Step MS',
    group: 'SYSTEM',
  },
  maxSubSteps: {
    value: 5,
    type: 'number',
    label: 'Max Sub Steps',
    group: 'SYSTEM',
  },

  // Theme & Visuals
  backgroundColor: {
    value: '#050714',
    type: 'color',
    label: 'Background Color',
    group: 'THEME',
  },
  primaryColor: {
    value: '#00f0ff',
    type: 'color',
    label: 'Primary Color',
    group: 'THEME',
  },
  accentColor: {
    value: '#ff0055',
    type: 'color',
    label: 'Accent Color',
    group: 'THEME',
  },
  fontFamily: {
    value: 'system-ui, -apple-system, sans-serif',
    type: 'string',
    label: 'Font Family',
    group: 'THEME',
  },

  // Audio Levels
  defaultMusicVolume: {
    value: 0.6,
    type: 'number',
    label: 'Default Music Volume',
    group: 'AUDIO',
  },
  defaultSfxVolume: {
    value: 0.7,
    type: 'number',
    label: 'Default SFX Volume',
    group: 'AUDIO',
  },

  // Gameplay Rules
  startingLives: {
    value: 3,
    type: 'number',
    label: 'Starting Lives',
    group: 'Rules',
  },
  baseBallSpeed: {
    value: 480,
    type: 'number',
    label: 'Base Ball Speed',
    group: 'Rules',
  },
  maxBallSpeed: {
    value: 750,
    type: 'number',
    label: 'Max Ball Speed',
    group: 'Rules',
  },
  paddleBaseWidth: {
    value: 150,
    type: 'number',
    label: 'Paddle Width',
    group: 'Rules',
  },
  powerupDropChance: {
    value: 0.35,
    type: 'number',
    label: 'Power-up Drop Chance',
    group: 'Rules',
  },
  powerupDuration: {
    value: 14,
    type: 'number',
    label: 'Power-up Duration (s)',
    group: 'Rules',
  },
  relaxedSpeedMode: {
    value: false,
    type: 'boolean',
    label: 'Relaxed Speed Mode',
    group: 'Rules',
  },

  // Assets Aspect Ratios and Dimensions
  assetBgNeonGridAspectRatio: {
    value: 1.7916666667, // 1376 / 768
    type: 'number',
    label: 'Neon Grid Aspect Ratio',
    group: 'ASSETS',
  },
  assetBgMagmaCoreAspectRatio: {
    value: 1.7916666667, // 1376 / 768
    type: 'number',
    label: 'Magma Core Aspect Ratio',
    group: 'ASSETS',
  },
  assetBgAstralCosmosAspectRatio: {
    value: 1.7916666667, // 1376 / 768
    type: 'number',
    label: 'Astral Cosmos Aspect Ratio',
    group: 'ASSETS',
  },
  assetPaddleAspectRatio: {
    value: 2.5903225806, // 803 / 310
    type: 'number',
    label: 'Paddle Aspect Ratio',
    group: 'ASSETS',
  },
  assetEnergyBallAspectRatio: {
    value: 0.9986168741, // 722 / 723
    type: 'number',
    label: 'Energy Ball Aspect Ratio',
    group: 'ASSETS',
  },
  assetTileBrickAspectRatio: {
    value: 1.3895131086, // 742 / 534
    type: 'number',
    label: 'Tile Brick Aspect Ratio',
    group: 'ASSETS',
  },
  assetPowerupCapsuleAspectRatio: {
    value: 0.4645080946, // 373 / 803
    type: 'number',
    label: 'Powerup Capsule Aspect Ratio',
    group: 'ASSETS',
  },
};

// Merge customized config values if present (injected by Playground)
const {playgroundConfig} = globalThis as {
  playgroundConfig?: Record<string, unknown>;
};
if (playgroundConfig) {
  for (const [key, value] of Object.entries(playgroundConfig)) {
    if (key in CONFIG) {
      Object.assign(CONFIG[key as keyof typeof CONFIG], {value});
    }
  }
}

/**
 * Type helper for reading values in game code
 */
export type ConfigKey = keyof typeof CONFIG;

/**
 * Gets a configuration value by key.
 * @param key The configuration key.
 * @return The configuration value.
 */
export function getConfig<K extends ConfigKey>(
  key: K,
): (typeof CONFIG)[K]['value'] {
  return CONFIG[key].value;
}
