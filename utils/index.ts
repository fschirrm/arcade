/**
 * @fileoverview Canonical barrel export for shared Playground utilities.
 *
 * Re-exports all shared helpers, components, and types from `./BackgroundMusic`,
 * `./helper`, and `./usePlayground` so generated games importing from `./utils`
 * or `../utils` resolve cleanly when `utils/` is a directory.
 */

export {
  BackgroundMusic,
  createSeamlessLoopBuffer,
  scanAudioBoundaries,
  type AudioBoundaries,
  type BackgroundMusicProps,
  type SeamlessLoopResult,
} from './BackgroundMusic';
export {
  MenuOverlay,
  Overlay,
  clamp,
  createFixedStepper,
  drawAsset,
  drawBackground,
  formatTime,
  gameAudio,
  prepareCanvas,
  shuffle,
  useAssets,
  useAutoFocus,
  useInput,
  useIsMobile,
  useModalDialog,
  useOverlayFocusNavigation,
  type Entity,
  type GamePhase,
  type GameState,
  type InputAction,
  type InputSnapshot,
  type MenuOverlayProps,
  type MusicTrack,
  type OverlayProps,
  type OverlayTone,
  type PointerState,
  type Position,
  type SpriteConfig,
} from './helper';
export {
  getPlaygroundBootState,
  usePlayground,
  usePlaygroundGameLifecycle,
  usePlaygroundResume,
  useRpc,
  type BaseGameState,
  type BooleanConfigEntry,
  type ColorConfigEntry,
  type ConfigEntry,
  type ConfigValues,
  type GameConfig,
  type HostPlaygroundBootState,
  type NumberConfigEntry,
  type PlaygroundBootState,
  type PlaygroundResumeState,
  type SelectConfigEntry,
  type UsePlaygroundResumeOptions,
  type Vector2ConfigEntry,
} from './usePlayground';
