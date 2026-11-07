// tslint:disable
/* eslint-disable */
import {useCallback, useEffect, useRef, useState} from 'react';

/**
 * @fileoverview Hook for interacting with the Playground SDK.
 */

/** SDK methods games call. Keep in sync with google3/play/games/playground/sdk/playground.ts. */
const PLAYGROUND_SDK_METHODS = [
  'createLobby',
  'getLobby',
  'updatePlayerPresence',
  'startGame',
  'sendGameEvent',
  'scoreUpdated',
  'levelComplete',
  'gameOver',
  'showLeaderboard',
  'pauseStateChanged',
] as const;

/** Max calls held while the SDK loads; the oldest score update is dropped first. */
const MAX_BUFFERED_SDK_CALLS = 200;

declare interface BufferedSdk {
  /** Never-null object handed to games. Stable for the component lifetime. */
  readonly facade: any;
  /** Attaches the initialized SDK and replays buffered calls in order. */
  attach(realSdk: any): void;
  /** Load or init failed: drop buffered calls; later calls are no-ops. */
  markUnavailable(): void;
}

function createBufferedSdk(): BufferedSdk {
  let status: 'pending' | 'ready' | 'unavailable' = 'pending';
  let real: any = null;
  const queue: Array<{method: string; args: unknown[]}> = [];
  const invoke = (method: string, args: unknown[]) => {
    try {
      const fn = real?.[method];
      return typeof fn === 'function' ? fn.apply(real, args) : undefined;
    } catch (error) {
      console.warn(`[usePlayground] sdk.${method}() failed:`, error);
      return undefined;
    }
  };
  const facade: any = {init: () => Promise.resolve()};
  for (const method of PLAYGROUND_SDK_METHODS) {
    facade[method] = (...args: unknown[]) => {
      if (status === 'ready') return invoke(method, args);
      if (status !== 'pending') return undefined;
      if (queue.length >= MAX_BUFFERED_SDK_CALLS) {
        const oldestScore = queue.findIndex((c) => c.method === 'scoreUpdated');
        if (oldestScore === -1) return undefined;
        queue.splice(oldestScore, 1);
      }
      queue.push({method, args});
      return undefined;
    };
  }
  return {
    facade,
    attach(realSdk: any) {
      if (status !== 'pending') return;
      real = realSdk;
      status = 'ready';
      for (const call of queue.splice(0)) invoke(call.method, call.args);
    },
    markUnavailable() {
      if (status !== 'pending') return;
      status = 'unavailable';
      queue.length = 0;
    },
  };
}

/**
 * Hook to interact with Playground SDK features.
 * Dynamically loads the script and initializes the SDK.
 *
 * @param options Optional configuration (`enabled` defaults to true; set to
 *     false to skip initializing a new SDK instance).
 */
export function usePlayground(options?: {enabled?: boolean}) {
  const enabled = options?.enabled ?? true;
  const [isReady, setIsReady] = useState(false);
  const [bufferedSdk] = useState(createBufferedSdk);
  const initStartedRef = useRef(false);

  // Use refs for callbacks to ensure they always have access to the latest React state
  const onGameEventRef = useRef<((event: any) => void) | null>(null);
  const onPresenceEventRef = useRef<((presence: any) => void) | null>(null);
  const onLobbyStatusRef = useRef<((status: any) => void) | null>(null);

  useEffect(() => {
    if (!enabled) return;
    // Prevent double initialization in StrictMode
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    const loadScript = () => {
      return new Promise<void>((resolve, reject) => {
        if ((window as any).PlaygroundSDK) {
          resolve();
          return;
        }
        const script = document.createElement('script');
        script.src =
          'https://www.gstatic.com/play/games/playground/sdk/v1/playground.js';
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error('Failed to load Playground SDK script'));
        document.head.appendChild(script);
      });
    };

    const initSDK = async () => {
      try {
        const isSandboxPreview =
          window.location.hostname === 'test.com' ||
          (window as any).__PLAYGROUND_PREVIEW__ === true;

        if (isSandboxPreview) {
          console.log(
            '🔌 [usePlayground] Local or Preview environment. Loading Fake SDK...',
          );
          // @ts-ignore - Dynamic import
          const module = await import('./playground-fake');
          (window as any).PlaygroundSDK = module.FakePlaygroundSDK;
        } else {
          await loadScript();
        }

        if ((window as any).PlaygroundSDK) {
          const realSdk = new (window as any).PlaygroundSDK();

          // Wrap callbacks to fire whatever function is currently in the Ref
          await realSdk.init(
            (event: any) => onGameEventRef.current?.(event),
            (presence: any) => onPresenceEventRef.current?.(presence),
            (status: any) => onLobbyStatusRef.current?.(status),
          );

          bufferedSdk.attach(realSdk);
          setIsReady(true);
        } else {
          bufferedSdk.markUnavailable();
          console.error('Playground SDK class not found after script load.');
        }
      } catch (error) {
        bufferedSdk.markUnavailable();
        console.warn(
          '[usePlayground] Playground SDK unavailable; SDK calls are ignored:',
          error,
        );
      }
    };

    initSDK();
  }, [enabled, bufferedSdk]);

  return {
    sdk: bufferedSdk.facade,
    isReady,
    onGameEventRef,
    onPresenceEventRef,
    onLobbyStatusRef,
  };
}

/**
 * Raw host boot state injected onto window by the Playground host application.
 */
export declare interface HostPlaygroundBootState {
  readonly unlockedLevel?: unknown;
  readonly score?: unknown;
  readonly autoStart?: unknown;
}

declare interface PlaygroundBootWindow extends Window {
  readonly __PLAYGROUND_BOOT_STATE__?: HostPlaygroundBootState;
}

/** Progress injected by the Playground host, normalized for template games. */
export interface PlaygroundBootState {
  /** Level to start the first run at (>= 1). */
  readonly level: number;
  /** Score to start the first run with (>= 0). Represents the score at entry to unlockedLevel. */
  readonly score: number;
  /** True when the player chose Continue: skip the title screen once. */
  readonly autoStart: boolean;
  /** True when the host persists progress: TRY AGAIN retries the current level at its entry score. */
  readonly persistenceEnabled: boolean;
}

/**
 * Reads window.__PLAYGROUND_BOOT_STATE__ and returns normalized boot parameters.
 * Falls back to level 1, score 0, autoStart false when no boot state exists.
 */
export function getPlaygroundBootState(): PlaygroundBootState {
  const rawState =
    typeof window !== 'undefined'
      ? (window as PlaygroundBootWindow).__PLAYGROUND_BOOT_STATE__
      : undefined;
  if (rawState && typeof rawState === 'object') {
    const rawLevel = rawState.unlockedLevel;
    const rawScore = rawState.score;
    const rawAutoStart = rawState.autoStart;
    const level =
      typeof rawLevel === 'number' && Number.isFinite(rawLevel)
        ? Math.max(1, Math.floor(rawLevel))
        : 1;
    const score =
      typeof rawScore === 'number' && Number.isFinite(rawScore)
        ? Math.max(0, Math.floor(rawScore))
        : 0;
    const autoStart = rawAutoStart === true;
    return {level, score, autoStart, persistenceEnabled: true};
  }
  return {
    level: 1,
    score: 0,
    autoStart: false,
    persistenceEnabled: false,
  };
}

export interface UsePlaygroundResumeOptions {
  /** Whether the Playground SDK is ready (from usePlayground()). */
  isReady?: boolean;
  /**
   * Whether the game's assets have loaded. Auto-start waits for them, and the
   * readiness timeout starts only once they have. Defaults to true.
   */
  assetsReady?: boolean;
  /** Callback invoked once when autoStart triggers. */
  onAutoStart?: () => void;
  /**
   * Timeout in ms, counted from when assetsReady is true, before clearing
   * autoStartPending if the SDK is still not ready. Defaults to 5000.
   */
  autoStartTimeoutMs?: number;
}

export interface PlaygroundResumeState {
  /** Level to initialize the game with (from host boot state or default 1). */
  readonly initialLevel: number;
  /** Score to initialize the game with (from host boot state or default 0). */
  readonly initialScore: number;
  /** Whether host-side persistence is enabled. When true, retries preserve level entry score. */
  readonly persistenceEnabled: boolean;
  /**
   * Whether auto-start is actively pending. Gating the title overlay on this prevents soft-locks.
   * Automatically cleared when autoStart triggers or after the readiness timeout expires.
   */
  readonly autoStartPending: boolean;
}

/**
 * Hook to manage host save/resume boot progress and auto-start lifecycle.
 *
 * Encapsulates one-time autoStart execution, readiness timeouts, and boot state
 * normalization so template games do not soft-lock on return to START.
 */
export function usePlaygroundResume(
  options?: UsePlaygroundResumeOptions,
): PlaygroundResumeState {
  const [bootState] = useState(getPlaygroundBootState);
  const [autoStartPending, setAutoStartPending] = useState(bootState.autoStart);
  const hasTriggeredAutoStartRef = useRef(false);

  const isReady = options?.isReady ?? false;
  const assetsReady = options?.assetsReady ?? true;
  const onAutoStart = options?.onAutoStart;
  const onAutoStartRef = useRef(onAutoStart);
  onAutoStartRef.current = onAutoStart;
  const timeoutMs = options?.autoStartTimeoutMs ?? 5000;

  useEffect(() => {
    if (!autoStartPending || !assetsReady) return;

    if (isReady && !hasTriggeredAutoStartRef.current) {
      hasTriggeredAutoStartRef.current = true;
      setAutoStartPending(false);
      onAutoStartRef.current?.();
      return;
    }

    // Fall back to the title screen if the SDK does not load or init within
    // the timeout after the assets have loaded.
    const timeoutId = window.setTimeout(() => {
      setAutoStartPending(false);
    }, timeoutMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [autoStartPending, assetsReady, isReady, timeoutMs]);

  return {
    initialLevel: bootState.level,
    initialScore: bootState.score,
    persistenceEnabled: bootState.persistenceEnabled,
    autoStartPending,
  };
}

export interface BaseGameState {
  status: string;
  score: number;
  level?: number | string;
}

/**
 * Hook to automatically synchronize game scores and game lifecycle (start,
 * score updates, game over, level complete) with the Playground SDK.
 *
 * @param gameState Current game state containing status ('START' | 'PLAYING' |
 *     'GAME_OVER' | 'VICTORY' | 'LEVEL_COMPLETE' | etc.), score, and optional level.
 * @param sdk Optional existing PlaygroundSDK instance (e.g. from usePlayground()).
 *     If omitted, usePlayground() is invoked internally.
 */
export function usePlaygroundGameLifecycle(
  gameState: BaseGameState,
  sdk?: any,
) {
  // `sdk` from `usePlayground()` is a stable, never-null buffered facade.
  // `sdk` is `undefined` when the argument is omitted, or `null` if a caller
  // explicitly passes `null`.
  const defaultHook = usePlayground({enabled: sdk === undefined});
  const activeSdk = sdk ?? defaultHook.sdk;
  const hasCalledGameOver = useRef(false);
  const hasCalledLevelComplete = useRef(false);
  const lastScoreRef = useRef(gameState.score);
  // Last level seen while PLAYING; undefined until the first run starts.
  const lastPlayingLevelRef = useRef<number | string | undefined>(undefined);
  const lastIsPausedRef = useRef(false);

  // Keep last score up to date for unmount flush fallback
  lastScoreRef.current = gameState.score;

  // Declared before the reporting effect so terminal events see the level of
  // the last committed PLAYING render, even before the SDK is ready.
  useEffect(() => {
    if ((gameState.status || '').toUpperCase() === 'PLAYING') {
      lastPlayingLevelRef.current = gameState.level ?? 1;
    }
  }, [gameState.status, gameState.level]);

  useEffect(() => {
    if (!activeSdk) return;

    const status = (gameState.status || '').toUpperCase();
    const isGameOver =
      status === 'GAME_OVER' || status === 'DEFEAT' || status === 'LOST';
    const isLevelComplete =
      status === 'VICTORY' || status === 'WIN' || status === 'LEVEL_COMPLETE';
    const currentLevel = gameState.level ?? 1;
    // The host saves the highest level that SCORE_UPDATED reports, so terminal
    // events report the last level seen while PLAYING. A game that advances
    // `level` as it shows GAME_OVER, VICTORY or LEVEL_COMPLETE then cannot
    // unlock a level that was never played.
    const terminalLevel = lastPlayingLevelRef.current ?? currentLevel;

    const isPaused = status === 'PAUSED' || status === 'PAUSE';
    if (lastIsPausedRef.current !== isPaused) {
      if (typeof activeSdk.pauseStateChanged === 'function') {
        activeSdk.pauseStateChanged(isPaused);
      }
      lastIsPausedRef.current = isPaused;
    }

    if (status === 'PLAYING') {
      activeSdk.scoreUpdated({
        value: gameState.score,
        level: String(currentLevel),
      });
      hasCalledGameOver.current = false;
      hasCalledLevelComplete.current = false;
    } else if (isGameOver) {
      if (!hasCalledGameOver.current) {
        activeSdk.scoreUpdated({
          value: gameState.score,
          level: String(terminalLevel),
        });
        activeSdk.gameOver();
        hasCalledGameOver.current = true;
      }
    } else if (isLevelComplete) {
      if (!hasCalledLevelComplete.current) {
        activeSdk.scoreUpdated({
          value: gameState.score,
          level: String(terminalLevel),
        });
        // The host saves progress from SCORE_UPDATED and ignores `isFinal`.
        const isFinal = status === 'VICTORY' || status === 'WIN';
        if (isFinal) {
          activeSdk.levelComplete(terminalLevel, {isFinal: true});
        } else {
          activeSdk.levelComplete(terminalLevel);
        }
        hasCalledLevelComplete.current = true;
      }
    }
  }, [gameState.score, gameState.status, gameState.level, activeSdk]);

  // Unmount fallback: record score if a started run unmounts without calling
  // gameOver or levelComplete. A score seeded on START is not a run.
  useEffect(() => {
    return () => {
      const levelToReport = lastPlayingLevelRef.current;
      if (
        activeSdk &&
        levelToReport !== undefined &&
        !hasCalledGameOver.current &&
        !hasCalledLevelComplete.current &&
        lastScoreRef.current > 0
      ) {
        try {
          activeSdk.scoreUpdated({
            value: lastScoreRef.current,
            level: String(levelToReport),
          });
          activeSdk.gameOver();
        } catch (_) {}
      }
    };
  }, [activeSdk]);
}

declare interface RpcMessage {
  type: string;
  payload: unknown;
  messageId: string;
}

declare interface RpcResponse {
  messageId: string;
  success: boolean;
  payload?: unknown;
  error?: string;
}

// Simple unique ID generator
let nextMessageId = 0;
function generateMessageId() {
  return `rpc-message-${nextMessageId++}`;
}

/**
 * React hook for making RPC calls to the parent window via postMessage.
 * This is designed to interact with IframeMessagingService in the host app.
 */
export function useRpc<RequestType, ResponseType>(
  rpcName: string,
): [(payload: RequestType) => Promise<ResponseType>, boolean] {
  const [isLoading, setIsLoading] = useState(false);
  const pendingCalls = useRef<
    Map<string, {resolve: (value: any) => void; reject: (err: Error) => void}>
  >(new Map()).current;

  useEffect(() => {
    const handleResponse = (event: MessageEvent<RpcResponse>) => {
      const response = event.data;
      if (
        !response ||
        typeof response.messageId !== 'string' ||
        typeof response.success !== 'boolean'
      ) {
        return;
      }
      const callbacks = pendingCalls.get(response.messageId);
      if (!callbacks) {
        return;
      }
      pendingCalls.delete(response.messageId);
      if (response.success) {
        callbacks.resolve(response.payload);
      } else {
        callbacks.reject(new Error(response.error ?? 'Unknown RPC error'));
      }
    };

    window.addEventListener('message', handleResponse);
    return () => {
      window.removeEventListener('message', handleResponse);
    };
  }, [pendingCalls]);

  const callRpc = useCallback(
    (payload: RequestType): Promise<ResponseType> => {
      setIsLoading(true);
      const promise = new Promise<ResponseType>((resolve, reject) => {
        const messageId = generateMessageId();
        pendingCalls.set(messageId, {resolve, reject});

        const message: RpcMessage = {
          type: rpcName,
          payload,
          messageId,
        };
        try {
          window.parent.postMessage(message, '*'); // Consider restricting target origin
        } catch (err) {
          pendingCalls.delete(messageId);
          throw err;
        }
      });
      return promise.finally(() => {
        setIsLoading(pendingCalls.size > 0);
      });
    },
    [rpcName, pendingCalls],
  );

  return [callRpc, isLoading];
}

export type NumberConfigEntry = {
  value: number;
  type: 'number';
  label: string;
  group: string;
  min?: number;
  max?: number;
  step?: number;
};

export type BooleanConfigEntry = {
  value: boolean;
  type: 'boolean';
  label: string;
  group: string;
};

export type ColorConfigEntry = {
  value: string; // hex e.g. "#ff0000"
  type: 'color';
  label: string;
  group: string;
};

export type SelectConfigEntry = {
  value: string;
  type: 'select';
  label: string;
  group: string;
  options: string[];
};

export type Vector2ConfigEntry = {
  value: {x: number; y: number};
  type: 'vector2';
  label: string;
  group: string;
};

export type ConfigEntry =
  | NumberConfigEntry
  | BooleanConfigEntry
  | ColorConfigEntry
  | SelectConfigEntry
  | Vector2ConfigEntry;

export type GameConfig = Record<string, ConfigEntry>;

// Utility: extract a flat values object from a CONFIG
export type ConfigValues<T extends GameConfig> = {
  [K in keyof T]: T[K]['value'];
};
