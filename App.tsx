// tslint:disable
/* eslint-disable */
import {
  ArrowLeft,
  ArrowRight,
  Heart,
  HelpCircle,
  Menu,
  Play,
  RotateCw,
  Sparkles,
  Trophy,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {getConfig} from './constants';
import BackgroundMusic from './utils/BackgroundMusic';
import {
  createFixedStepper,
  drawAsset,
  drawBackground,
  formatTime,
  gameAudio,
  GameState,
  MenuOverlay,
  Overlay,
  prepareCanvas,
  useAssets,
  useInput,
  useIsMobile,
} from './utils/helper';
import {
  usePlayground,
  usePlaygroundGameLifecycle,
  usePlaygroundResume,
  useRpc,
} from './utils/usePlayground';
import backgroundMusicUrl from './assets/audio/bgm_arcade_loop.mp3';
import bgNeonGridUrl from './assets/images/bg_neon_grid.png';
import bgMagmaCoreUrl from './assets/images/bg_magma_core.png';
import bgAstralCosmosUrl from './assets/images/bg_astral_cosmos.png';
import paddleCyberUrl from './assets/images/paddle_cyber.png';
import energyBallUrl from './assets/images/energy_ball.png';
import tileBrickNeonUrl from './assets/images/tile_brick_neon.png';
import powerupCapsuleUrl from './assets/images/powerup_capsule.png';

const BACKGROUND_MUSIC_URL = backgroundMusicUrl;

interface CustomWindow extends Window {
  canHandleBackKey?: boolean;
}

// Powerup types
type PowerupType =
  | 'EXPAND'
  | 'MULTIBALL'
  | 'SLOW'
  | 'LASER'
  | 'PENETRATION'
  | 'LIFE';

interface PowerupItem {
  id: number;
  type: PowerupType;
  x: number;
  y: number;
  width: number;
  height: number;
  vy: number;
}

interface ActivePowerup {
  type: PowerupType;
  duration: number; // remaining seconds
  maxDuration: number;
}

interface Tile {
  id: number;
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
  maxHits: number;
  hits: number; // hits taken so far
  type: 'standard' | 'reinforced' | 'explosive' | 'bumper';
  color: string;
  points: number;
}

interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  speed: number;
  docked: boolean; // docked on paddle
  penetrating: boolean;
  horizontalFrames: number; // anti-deadlock counter
}

interface LaserBolt {
  id: number;
  x: number;
  y: number;
  vy: number;
  width: number;
  height: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  radius: number;
  life: number;
  maxLife: number;
}

interface ScorePopup {
  id: number;
  text: string;
  x: number;
  y: number;
  color: string;
  life: number;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stepperRef = useRef<ReturnType<typeof createFixedStepper>>();

  // --- GLOBAL PAUSE STATE ---
  const lastCancelRef = useRef(false);

  // --- PLAYGROUND SDK INTEGRATION ---
  const {sdk, isReady} = usePlayground();
  const [exitChat] = useRpc<Record<string, unknown>, void>('ExitChat');

  // --- ASSETS ---
  const ASSETS_MANIFEST: Record<string, string> = {
    bg_neon_grid: bgNeonGridUrl,
    bg_magma_core: bgMagmaCoreUrl,
    bg_astral_cosmos: bgAstralCosmosUrl,
    paddle_cyber: paddleCyberUrl,
    energy_ball: energyBallUrl,
    tile_brick_neon: tileBrickNeonUrl,
    powerup_capsule: powerupCapsuleUrl,
  };
  const {assets, isReady: assetsReady} = useAssets(ASSETS_MANIFEST);

  const canvasWidth = getConfig('baseCanvasWidth') as number;
  const canvasHeight = getConfig('baseCanvasHeight') as number;
  const isMobile = useIsMobile();

  if (!stepperRef.current) {
    const stepMs = getConfig('stepMs');
    const maxSubSteps = getConfig('maxSubSteps');
    stepperRef.current = createFixedStepper(stepMs, maxSubSteps);
  }

  // Do not remove: Playground save/resume
  const {initialLevel, initialScore, persistenceEnabled, autoStartPending} =
    usePlaygroundResume({
      isReady,
      assetsReady,
      onAutoStart: () => {
        if (gameStateRef.current.status === 'START') {
          initGame();
        }
      },
    });

  const TOTAL_LEVELS = 3;
  const startLevel = Math.max(1, Math.min(initialLevel, TOTAL_LEVELS));
  const startScore = initialScore;

  const levelStartScoreRef = useRef(startScore);
  const prevLevelRef = useRef(startLevel);
  const runWonRef = useRef(false);

  const [gameState, setGameState] = useState<GameState>({
    status: 'START',
    score: startScore,
    level: startLevel,
    lives: getConfig('startingLives') as number,
  });

  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  // High score tracking in state & localStorage
  const [highScore, setHighScore] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('tile_surge_highscore');
      return saved ? parseInt(saved, 10) || 0 : 0;
    } catch {
      return 0;
    }
  });

  // UI Menus and Modals
  const [isGameMenuOpen, setIsGameMenuOpen] = useState(false);
  const [isHowToPlayOpen, setIsHowToPlayOpen] = useState(false);
  const [sfxMuted, setSfxMuted] = useState(false);
  const [musicMuted, setMusicMuted] = useState(false);

  // Active combo multiplier and active powerups for HUD display
  const [hudCombo, setHudCombo] = useState<number>(1);
  const [hudPowerups, setHudPowerups] = useState<ActivePowerup[]>([]);

  // Mobile virtual controls state
  const touchLeftRef = useRef(false);
  const touchRightRef = useRef(false);
  const touchActionRef = useRef(false);

  useEffect(() => {
    if (gameState.level !== prevLevelRef.current) {
      prevLevelRef.current = gameState.level;
      levelStartScoreRef.current = gameStateRef.current.score;
    }
  }, [gameState.level]);

  useEffect(() => {
    if (gameState.status === 'VICTORY') {
      runWonRef.current = true;
      gameAudio.playVictoryFanfare();
    } else if (gameState.status === 'GAME_OVER') {
      gameAudio.playDefeatMotif();
    }
  }, [gameState.status]);

  useEffect(() => {
    const canHandleBackKey = gameState.status !== 'START';
    (window as CustomWindow).canHandleBackKey = canHandleBackKey;
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          type: 'PLAYGROUND_CAN_HANDLE_BACK_KEY',
          value: canHandleBackKey,
        },
        '*',
      );
    }
  }, [gameState.status]);

  const inputRef = useInput(canvasRef, true, {
    width: canvasWidth,
    height: canvasHeight,
  });

  // --- SIMULATION REFS (HIGH-FREQUENCY 60FPS STATE) ---
  const paddleRef = useRef({
    x: (canvasWidth - (getConfig('paddleBaseWidth') as number)) / 2,
    y: canvasHeight - 75,
    width: getConfig('paddleBaseWidth') as number,
    baseWidth: getConfig('paddleBaseWidth') as number,
    height: Math.round(
      (getConfig('paddleBaseWidth') as number) /
        (getConfig('assetPaddleAspectRatio') as number),
    ),
    speed: 780,
    flashTimer: 0,
  });

  const ballsRef = useRef<Ball[]>([]);
  const tilesRef = useRef<Tile[]>([]);
  const powerupsRef = useRef<PowerupItem[]>([]);
  const activePowerupsRef = useRef<ActivePowerup[]>([]);
  const laserBoltsRef = useRef<LaserBolt[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const scorePopupsRef = useRef<ScorePopup[]>([]);
  const comboStreakRef = useRef(0);
  const comboTimerRef = useRef(0);
  const screenShakeRef = useRef(0);
  const laserCooldownRef = useRef(0);
  const nextEntityIdRef = useRef(1);

  // Generate Stage Tiles
  const generateLevelTiles = (level: number): Tile[] => {
    const tiles: Tile[] = [];
    let id = 1;
    const paddleAspect = getConfig('assetTileBrickAspectRatio') as number;

    if (level === 1) {
      // Neon Cyber Grid: 5 rows x 11 cols
      const cols = 11;
      const rows = 5;
      const marginX = 140;
      const availableWidth = canvasWidth - marginX * 2;
      const tileWidth = Math.floor(availableWidth / cols) - 10;
      const tileHeight = Math.floor(tileWidth / paddleAspect);
      const startY = 85;

      const colors = ['#00f0ff', '#00ffaa', '#ff00aa', '#ffff00', '#00e5ff'];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const isExplosive = (r === 2 && (c === 2 || c === 8)) || (r === 3 && c === 5);
          const isReinforced = r === 0 && (c % 2 === 1);
          const type: Tile['type'] = isExplosive
            ? 'explosive'
            : isReinforced
            ? 'reinforced'
            : 'standard';
          const maxHits = isReinforced ? 2 : 1;

          tiles.push({
            id: id++,
            row: r,
            col: c,
            x: marginX + c * (tileWidth + 10),
            y: startY + r * (tileHeight + 10),
            width: tileWidth,
            height: tileHeight,
            maxHits,
            hits: 0,
            type,
            color: isExplosive ? '#ff5500' : isReinforced ? '#bd00ff' : colors[r % colors.length],
            points: isExplosive ? 200 : isReinforced ? 150 : 100,
          });
        }
      }
    } else if (level === 2) {
      // Magma Core: 6 rows x 12 cols, denser, molten layout with reinforced walls
      const cols = 12;
      const rows = 6;
      const marginX = 120;
      const availableWidth = canvasWidth - marginX * 2;
      const tileWidth = Math.floor(availableWidth / cols) - 8;
      const tileHeight = Math.floor(tileWidth / paddleAspect);
      const startY = 80;

      const colors = ['#ff2200', '#ff5500', '#ff8800', '#ffaa00', '#ff0055', '#ff3300'];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Checkerboard or strategic layout
          const isBumper = (r === 2 || r === 3) && (c === 0 || c === cols - 1);
          const isExplosive = (r === 1 && (c === 3 || c === 8)) || (r === 4 && (c === 5 || c === 6));
          const isReinforced = r < 2 || (r === 3 && c % 3 === 0);
          const type: Tile['type'] = isBumper
            ? 'bumper'
            : isExplosive
            ? 'explosive'
            : isReinforced
            ? 'reinforced'
            : 'standard';
          const maxHits = isBumper ? 999 : isReinforced ? 2 : 1;

          tiles.push({
            id: id++,
            row: r,
            col: c,
            x: marginX + c * (tileWidth + 8),
            y: startY + r * (tileHeight + 9),
            width: tileWidth,
            height: tileHeight,
            maxHits,
            hits: 0,
            type,
            color: isBumper ? '#a0a0b0' : isExplosive ? '#ff0033' : isReinforced ? '#ff7700' : colors[r % colors.length],
            points: isBumper ? 0 : isExplosive ? 250 : isReinforced ? 180 : 120,
          });
        }
      }
    } else {
      // Astral Cosmos: 7 rows x 12 cols, diamond & cosmic fortress formations
      const cols = 12;
      const rows = 7;
      const marginX = 110;
      const availableWidth = canvasWidth - marginX * 2;
      const tileWidth = Math.floor(availableWidth / cols) - 8;
      const tileHeight = Math.floor(tileWidth / paddleAspect);
      const startY = 75;

      const colors = ['#bd00ff', '#d600ff', '#00e5ff', '#7000ff', '#ff00b7', '#00ffc4', '#8a2be2'];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Hollow diamond pattern or cluster
          const centerDist = Math.abs(c - 5.5) + Math.abs(r - 3);
          if (centerDist > 7.5 && r > 4) continue; // curved bottom cut

          const isBumper = (r === 3 && (c === 2 || c === 9));
          const isExplosive = (r === 2 && (c === 4 || c === 7)) || (r === 5 && c === 5);
          const isReinforced = r <= 1 || centerDist < 2.5;

          const type: Tile['type'] = isBumper
            ? 'bumper'
            : isExplosive
            ? 'explosive'
            : isReinforced
            ? 'reinforced'
            : 'standard';
          const maxHits = isBumper ? 999 : isReinforced ? 2 : 1;

          tiles.push({
            id: id++,
            row: r,
            col: c,
            x: marginX + c * (tileWidth + 8),
            y: startY + r * (tileHeight + 8),
            width: tileWidth,
            height: tileHeight,
            maxHits,
            hits: 0,
            type,
            color: isBumper ? '#99aabb' : isExplosive ? '#ff00aa' : isReinforced ? '#00f0ff' : colors[r % colors.length],
            points: isBumper ? 0 : isExplosive ? 300 : isReinforced ? 220 : 150,
          });
        }
      }
    }

    return tiles;
  };

  // Reset ball to paddle
  const spawnDockedBall = () => {
    const paddle = paddleRef.current;
    const baseSpeed = getConfig('baseBallSpeed') as number;
    const relaxed = getConfig('relaxedSpeedMode') as boolean;
    const speed = relaxed ? baseSpeed * 0.75 : baseSpeed;

    ballsRef.current = [
      {
        id: nextEntityIdRef.current++,
        x: paddle.x + paddle.width / 2,
        y: paddle.y - 14,
        vx: 0,
        vy: -speed,
        radius: 12,
        speed,
        docked: true,
        penetrating: activePowerupsRef.current.some((p) => p.type === 'PENETRATION'),
        horizontalFrames: 0,
      },
    ];
  };

  // Start or transition run
  const startRun = useCallback(
    (level: number, score: number) => {
      levelStartScoreRef.current = score;
      prevLevelRef.current = level;
      runWonRef.current = false;

      // Reset paddle
      const baseWidth = getConfig('paddleBaseWidth') as number;
      paddleRef.current = {
        x: (canvasWidth - baseWidth) / 2,
        y: canvasHeight - 75,
        width: baseWidth,
        baseWidth,
        height: Math.round(
          baseWidth / (getConfig('assetPaddleAspectRatio') as number),
        ),
        speed: 780,
        flashTimer: 0,
      };

      // Reset entities
      tilesRef.current = generateLevelTiles(level);
      powerupsRef.current = [];
      activePowerupsRef.current = [];
      laserBoltsRef.current = [];
      particlesRef.current = [];
      scorePopupsRef.current = [];
      comboStreakRef.current = 0;
      comboTimerRef.current = 0;
      screenShakeRef.current = 0;
      laserCooldownRef.current = 0;

      spawnDockedBall();

      setGameState({
        status: 'PLAYING',
        level,
        score,
        lives: getConfig('startingLives') as number,
      });

      setHudCombo(1);
      setHudPowerups([]);

      if (sdk) {
        sdk.startGame();
      }
    },
    [sdk, canvasWidth, canvasHeight],
  );

  const initGame = useCallback(() => {
    if (persistenceEnabled && !runWonRef.current) {
      startRun(gameStateRef.current.level, levelStartScoreRef.current);
    } else {
      startRun(1, 0);
    }
  }, [startRun, persistenceEnabled]);

  const resetGame = useCallback(() => {
    startRun(1, 0);
  }, [startRun]);

  // Lifecycle SDK Reporting
  usePlaygroundGameLifecycle(gameState, sdk);

  // Auto-start for preview
  const hasAutoplayed = useRef(false);
  useEffect(() => {
    if (
      !hasAutoplayed.current &&
      new URLSearchParams(window.location.search).has('autoplay')
    ) {
      hasAutoplayed.current = true;
      initGame();
    }
  }, [initGame]);

  // Launch docked ball
  const launchBall = () => {
    const dockedBall = ballsRef.current.find((b) => b.docked);
    if (dockedBall) {
      dockedBall.docked = false;
      const angle = (Math.random() * 0.4 - 0.2); // slight random angle near vertical
      dockedBall.vx = dockedBall.speed * Math.sin(angle);
      dockedBall.vy = -dockedBall.speed * Math.cos(angle);
      gameAudio.playArcadeLaser();
    }
  };

  // Particle explosion helper
  const spawnTileDebris = (x: number, y: number, color: string, count = 12) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 220 + 80;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        color,
        radius: Math.random() * 3 + 2,
        life: 0,
        maxLife: Math.random() * 0.4 + 0.3,
      });
    }
  };

  // Add score with combo popup
  const addScore = (pts: number, x: number, y: number) => {
    comboStreakRef.current += 1;
    comboTimerRef.current = 1.8; // seconds before combo expires
    const mult = Math.min(5, 1 + Math.floor(comboStreakRef.current / 3));
    const totalPts = pts * mult;

    setGameState((prev) => {
      const newScore = prev.score + totalPts;
      if (newScore > highScore) {
        setHighScore(newScore);
        try {
          localStorage.setItem('tile_surge_highscore', newScore.toString());
        } catch {}
      }
      return {...prev, score: newScore};
    });

    scorePopupsRef.current.push({
      id: nextEntityIdRef.current++,
      text: mult > 1 ? `+${totalPts} (x${mult})` : `+${totalPts}`,
      x,
      y,
      color: mult > 2 ? '#ff00aa' : mult > 1 ? '#00f0ff' : '#ffff00',
      life: 0.8,
    });
  };

  // Trigger tile destruction
  const destroyTile = (tile: Tile, fromBall: boolean = true) => {
    spawnTileDebris(tile.x + tile.width / 2, tile.y + tile.height / 2, tile.color, 14);
    addScore(tile.points, tile.x + tile.width / 2, tile.y);

    if (tile.type === 'explosive') {
      gameAudio.playChiptuneExplosion();
      screenShakeRef.current = 8;
      // Explode neighboring tiles
      const explosionRadius = 125;
      const cx = tile.x + tile.width / 2;
      const cy = tile.y + tile.height / 2;

      tilesRef.current.forEach((other) => {
        if (other.id !== tile.id && other.hits < other.maxHits && other.type !== 'bumper') {
          const ocx = other.x + other.width / 2;
          const ocy = other.y + other.height / 2;
          const dist = Math.hypot(cx - ocx, cy - ocy);
          if (dist <= explosionRadius) {
            other.hits += 2; // deal heavy blast damage
            if (other.hits >= other.maxHits) {
              spawnTileDebris(ocx, ocy, other.color, 8);
              addScore(other.points, ocx, ocy);
            }
          }
        }
      });
    } else {
      gameAudio.playCoinPickup();
    }

    // Powerup drop chance
    const dropChance = getConfig('powerupDropChance') as number;
    if (Math.random() < dropChance && tile.type !== 'bumper') {
      const powerupTypes: PowerupType[] = [
        'EXPAND',
        'MULTIBALL',
        'SLOW',
        'LASER',
        'PENETRATION',
        'LIFE',
      ];
      const selectedType =
        powerupTypes[Math.floor(Math.random() * powerupTypes.length)];

      const capsuleAspect = getConfig(
        'assetPowerupCapsuleAspectRatio',
      ) as number;
      const capWidth = 26;
      const capHeight = Math.round(capWidth / capsuleAspect);

      powerupsRef.current.push({
        id: nextEntityIdRef.current++,
        type: selectedType,
        x: tile.x + tile.width / 2 - capWidth / 2,
        y: tile.y + tile.height / 2,
        width: capWidth,
        height: capHeight,
        vy: 160,
      });
    }
  };

  // Apply powerup
  const applyPowerup = (type: PowerupType) => {
    gameAudio.playPowerupChime();
    const duration = getConfig('powerupDuration') as number;

    if (type === 'LIFE') {
      setGameState((prev) => ({...prev, lives: (prev.lives ?? 3) + 1}));
      scorePopupsRef.current.push({
        id: nextEntityIdRef.current++,
        text: '+1 EXTRA BALL',
        x: paddleRef.current.x + paddleRef.current.width / 2,
        y: paddleRef.current.y - 20,
        color: '#00ff66',
        life: 1.0,
      });
      return;
    }

    if (type === 'MULTIBALL') {
      // Duplicate current balls
      const newBalls: Ball[] = [];
      const current = ballsRef.current.filter((b) => !b.docked);
      const source = current.length > 0 ? current : ballsRef.current;

      source.forEach((b) => {
        // Spawn 2 angled balls
        const speed = b.speed;
        newBalls.push({
          id: nextEntityIdRef.current++,
          x: b.x,
          y: b.y,
          vx: b.vx * 0.7 - speed * 0.5,
          vy: b.vy * 0.7,
          radius: b.radius,
          speed,
          docked: false,
          penetrating: b.penetrating,
          horizontalFrames: 0,
        });
        newBalls.push({
          id: nextEntityIdRef.current++,
          x: b.x,
          y: b.y,
          vx: b.vx * 0.7 + speed * 0.5,
          vy: b.vy * 0.7,
          radius: b.radius,
          speed,
          docked: false,
          penetrating: b.penetrating,
          horizontalFrames: 0,
        });
      });
      ballsRef.current.push(...newBalls);
      return;
    }

    // Stack or renew duration
    const existing = activePowerupsRef.current.find((p) => p.type === type);
    if (existing) {
      existing.duration = duration;
    } else {
      activePowerupsRef.current.push({
        type,
        duration,
        maxDuration: duration,
      });
    }

    // Effect triggers
    if (type === 'EXPAND') {
      paddleRef.current.width = Math.round(
        paddleRef.current.baseWidth * 1.45,
      );
    } else if (type === 'SLOW') {
      ballsRef.current.forEach((b) => {
        b.speed = Math.max(260, b.speed * 0.7);
        const norm = Math.hypot(b.vx, b.vy);
        if (norm > 0) {
          b.vx = (b.vx / norm) * b.speed;
          b.vy = (b.vy / norm) * b.speed;
        }
      });
    } else if (type === 'PENETRATION') {
      ballsRef.current.forEach((b) => (b.penetrating = true));
    }
  };

  // --- MAIN SIMULATION UPDATE ---
  const update = (dt: number) => {
    if (gameState.status !== 'PLAYING' || isGameMenuOpen || isHowToPlayOpen) {
      return;
    }

    const input = inputRef.current;
    const paddle = paddleRef.current;

    // 1. Paddle movement (Keyboard / Mouse / Virtual Touch)
    let moveDir = 0;
    if (input.actions.left || touchLeftRef.current) moveDir -= 1;
    if (input.actions.right || touchRightRef.current) moveDir += 1;

    if (moveDir !== 0) {
      paddle.x += moveDir * paddle.speed * dt;
    } else if (input.pointer.down || isMobile) {
      // Direct tracking if pointer is inside canvas bounds
      if (input.pointer.x > 0 && input.pointer.x < canvasWidth) {
        const targetX = input.pointer.x - paddle.width / 2;
        // Smoothly interpolate toward finger/cursor
        paddle.x += (targetX - paddle.x) * Math.min(1, 20 * dt);
      }
    }

    // Hard screen clamp
    paddle.x = Math.max(0, Math.min(canvasWidth - paddle.width, paddle.x));

    if (paddle.flashTimer > 0) {
      paddle.flashTimer -= dt;
    }

    // 2. Launch or Fire Action
    const wantsAction =
      input.actions.confirm ||
      input.actions.tap ||
      touchActionRef.current;

    // Check if any ball is docked
    const hasDockedBall = ballsRef.current.some((b) => b.docked);
    if (hasDockedBall && wantsAction) {
      launchBall();
    }

    // Laser Cannon firing
    const hasLaser = activePowerupsRef.current.some((p) => p.type === 'LASER');
    if (hasLaser) {
      laserCooldownRef.current -= dt;
      if (laserCooldownRef.current <= 0 && wantsAction) {
        laserCooldownRef.current = 0.22;
        gameAudio.playArcadeLaser();
        // Fire twin bolts from paddle edges
        const boltWidth = 6;
        const boltHeight = 18;
        laserBoltsRef.current.push({
          id: nextEntityIdRef.current++,
          x: paddle.x + 16,
          y: paddle.y - 10,
          vy: -850,
          width: boltWidth,
          height: boltHeight,
        });
        laserBoltsRef.current.push({
          id: nextEntityIdRef.current++,
          x: paddle.x + paddle.width - 16 - boltWidth,
          y: paddle.y - 10,
          vy: -850,
          width: boltWidth,
          height: boltHeight,
        });
      }
    }

    // 3. Update Laser Bolts
    for (let i = laserBoltsRef.current.length - 1; i >= 0; i--) {
      const bolt = laserBoltsRef.current[i];
      bolt.y += bolt.vy * dt;

      // Collision with tiles
      let boltRemoved = false;
      if (bolt.y < 0) {
        boltRemoved = true;
      } else {
        for (const tile of tilesRef.current) {
          if (tile.hits < tile.maxHits) {
            if (
              bolt.x + bolt.width >= tile.x &&
              bolt.x <= tile.x + tile.width &&
              bolt.y <= tile.y + tile.height &&
              bolt.y + bolt.height >= tile.y
            ) {
              boltRemoved = true;
              if (tile.type !== 'bumper') {
                tile.hits += 1;
                if (tile.hits >= tile.maxHits) {
                  destroyTile(tile, false);
                } else {
                  gameAudio.playShieldBlock();
                  spawnTileDebris(bolt.x, bolt.y, '#ffffff', 4);
                }
              }
              break;
            }
          }
        }
      }

      if (boltRemoved) {
        laserBoltsRef.current.splice(i, 1);
      }
    }

    // 4. Update Powerup Items (falling capsules)
    for (let i = powerupsRef.current.length - 1; i >= 0; i--) {
      const p = powerupsRef.current[i];
      p.y += p.vy * dt;

      // Check paddle catch
      if (
        p.x + p.width >= paddle.x &&
        p.x <= paddle.x + paddle.width &&
        p.y + p.height >= paddle.y &&
        p.y <= paddle.y + paddle.height
      ) {
        applyPowerup(p.type);
        powerupsRef.current.splice(i, 1);
        continue;
      }

      // Check bottom miss
      if (p.y > canvasHeight + 20) {
        powerupsRef.current.splice(i, 1);
      }
    }

    // 5. Update Active Powerups Timers
    for (let i = activePowerupsRef.current.length - 1; i >= 0; i--) {
      const ap = activePowerupsRef.current[i];
      ap.duration -= dt;
      if (ap.duration <= 0) {
        // Revert effect
        if (ap.type === 'EXPAND') {
          paddle.width = paddle.baseWidth;
        } else if (ap.type === 'PENETRATION') {
          ballsRef.current.forEach((b) => (b.penetrating = false));
        } else if (ap.type === 'SLOW') {
          const baseSpeed = getConfig('baseBallSpeed') as number;
          ballsRef.current.forEach((b) => {
            b.speed = baseSpeed;
            const norm = Math.hypot(b.vx, b.vy);
            if (norm > 0) {
              b.vx = (b.vx / norm) * b.speed;
              b.vy = (b.vy / norm) * b.speed;
            }
          });
        }
        activePowerupsRef.current.splice(i, 1);
      }
    }

    // 6. Update Balls & Collisions
    const maxSpeed = getConfig('maxBallSpeed') as number;

    for (let i = ballsRef.current.length - 1; i >= 0; i--) {
      const ball = ballsRef.current[i];

      if (ball.docked) {
        // Ball rests centered on the paddle
        ball.x = paddle.x + paddle.width / 2;
        ball.y = paddle.y - ball.radius - 2;
        continue;
      }

      // Sub-stepping for accurate tunnel-free ball collision
      const subTicks = 3;
      const subDt = dt / subTicks;

      for (let step = 0; step < subTicks; step++) {
        ball.x += ball.vx * subDt;
        ball.y += ball.vy * subDt;

        // Anti-deadlock check: if vy is almost zero for too long
        if (Math.abs(ball.vy) < 50) {
          ball.horizontalFrames += 1;
          if (ball.horizontalFrames > 90) {
            ball.vy = (ball.vy < 0 ? -1 : 1) * Math.max(120, Math.abs(ball.vy));
            ball.horizontalFrames = 0;
          }
        } else {
          ball.horizontalFrames = 0;
        }

        // Left / Right Walls
        if (ball.x - ball.radius <= 0) {
          ball.x = ball.radius;
          ball.vx = Math.abs(ball.vx);
          gameAudio.playShieldBlock();
        } else if (ball.x + ball.radius >= canvasWidth) {
          ball.x = canvasWidth - ball.radius;
          ball.vx = -Math.abs(ball.vx);
          gameAudio.playShieldBlock();
        }

        // Top Wall
        if (ball.y - ball.radius <= 0) {
          ball.y = ball.radius;
          ball.vy = Math.abs(ball.vy);
          gameAudio.playShieldBlock();
        }

        // Paddle Collision
        if (
          ball.vy > 0 &&
          ball.y + ball.radius >= paddle.y &&
          ball.y - ball.radius <= paddle.y + paddle.height &&
          ball.x >= paddle.x - ball.radius &&
          ball.x <= paddle.x + paddle.width + ball.radius
        ) {
          ball.y = paddle.y - ball.radius;
          paddle.flashTimer = 0.12;

          // Angle calculation based on impact point along the paddle
          const paddleCenter = paddle.x + paddle.width / 2;
          const hitNorm = Math.max(
            -1,
            Math.min(1, (ball.x - paddleCenter) / (paddle.width / 2)),
          );

          // Launch angle: up to 60 degrees (pi/3) from vertical
          const maxAngle = Math.PI / 3;
          const launchAngle = hitNorm * maxAngle;

          // Accelerate slightly on successful paddle returns
          ball.speed = Math.min(maxSpeed, ball.speed + 6);
          ball.vx = ball.speed * Math.sin(launchAngle);
          ball.vy = -Math.abs(ball.speed * Math.cos(launchAngle));

          comboStreakRef.current = 0; // reset combo streak on paddle touch
          gameAudio.playShieldBlock();
          spawnTileDebris(ball.x, paddle.y, '#00f0ff', 6);
        }

        // Tile Collisions
        for (const tile of tilesRef.current) {
          if (tile.hits >= tile.maxHits) continue;

          // Circle-to-AABB collision check
          const nearestX = Math.max(
            tile.x,
            Math.min(ball.x, tile.x + tile.width),
          );
          const nearestY = Math.max(
            tile.y,
            Math.min(ball.y, tile.y + tile.height),
          );

          const distX = ball.x - nearestX;
          const distY = ball.y - nearestY;
          const distSquared = distX * distX + distY * distY;

          if (distSquared <= ball.radius * ball.radius) {
            // Collision detected!
            const hitBumper = tile.type === 'bumper';

            if (!hitBumper) {
              tile.hits += 1;
              if (tile.hits >= tile.maxHits) {
                destroyTile(tile, true);
              } else {
                gameAudio.playShieldBlock();
                spawnTileDebris(nearestX, nearestY, tile.color, 6);
              }
            } else {
              gameAudio.playArcadeLaser();
              spawnTileDebris(nearestX, nearestY, '#ffffff', 8);
            }

            // Deflection if not penetrating
            if (!ball.penetrating || hitBumper) {
              // Determine reflection normal
              const overlapX = ball.radius - Math.abs(distX);
              const overlapY = ball.radius - Math.abs(distY);

              if (overlapX < overlapY && Math.abs(distX) > 0.001) {
                ball.vx = distX > 0 ? Math.abs(ball.vx) : -Math.abs(ball.vx);
              } else {
                ball.vy = distY > 0 ? Math.abs(ball.vy) : -Math.abs(ball.vy);
              }
            }

            break; // Handle one tile collision per sub-tick
          }
        }
      }

      // Check Bottom Pit (Ball Loss)
      if (ball.y - ball.radius > canvasHeight) {
        ballsRef.current.splice(i, 1);
      }
    }

    // 7. Check if all balls lost
    if (ballsRef.current.length === 0) {
      gameAudio.playGeneralDamage();
      screenShakeRef.current = 12;

      setGameState((prev) => {
        const nextLives = (prev.lives ?? 1) - 1;
        if (nextLives <= 0) {
          return {...prev, lives: 0, status: 'GAME_OVER'};
        } else {
          // Respawn docked ball with one fewer life
          setTimeout(() => spawnDockedBall(), 200);
          return {...prev, lives: nextLives};
        }
      });
    }

    // 8. Check Stage Victory (All destructible tiles cleared)
    const remainingDestructible = tilesRef.current.filter(
      (t) => t.type !== 'bumper' && t.hits < t.maxHits,
    );

    if (
      remainingDestructible.length === 0 &&
      tilesRef.current.length > 0 &&
      gameState.status === 'PLAYING'
    ) {
      // Stage Cleared!
      if (gameState.level < TOTAL_LEVELS) {
        // Advance to next stage!
        gameAudio.playLevelUpStinger();
        const nextLvl = gameState.level + 1;
        setGameState((prev) => ({
          ...prev,
          level: nextLvl,
          score: prev.score + 1000 * prev.level, // stage clear bonus
        }));
        tilesRef.current = generateLevelTiles(nextLvl);
        powerupsRef.current = [];
        activePowerupsRef.current = [];
        laserBoltsRef.current = [];
        spawnDockedBall();
      } else {
        // Complete Victory! All 3 stages conquered!
        setGameState((prev) => ({
          ...prev,
          status: 'VICTORY',
          score: prev.score + 3000,
        }));
      }
    }

    // 9. Update Particles & Screen Shake
    if (screenShakeRef.current > 0) {
      screenShakeRef.current -= dt * 16;
      if (screenShakeRef.current < 0) screenShakeRef.current = 0;
    }

    if (comboTimerRef.current > 0) {
      comboTimerRef.current -= dt;
      if (comboTimerRef.current <= 0) {
        comboStreakRef.current = 0;
      }
    }

    for (let i = particlesRef.current.length - 1; i >= 0; i--) {
      const p = particlesRef.current[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 380 * dt; // gravity
      p.life += dt;
      if (p.life >= p.maxLife) {
        particlesRef.current.splice(i, 1);
      }
    }

    // 10. Update Score Popups
    for (let i = scorePopupsRef.current.length - 1; i >= 0; i--) {
      const sp = scorePopupsRef.current[i];
      sp.y -= 45 * dt;
      sp.life -= dt;
      if (sp.life <= 0) {
        scorePopupsRef.current.splice(i, 1);
      }
    }

    // Sync HUD states periodically
    setHudCombo(Math.min(5, 1 + Math.floor(comboStreakRef.current / 3)));
    setHudPowerups([...activePowerupsRef.current]);
  };

  // --- CANVAS RENDERING ---
  const draw = (ctx: CanvasRenderingContext2D) => {
    prepareCanvas(ctx, canvasWidth, canvasHeight);

    ctx.save();

    // Apply Screen Shake
    if (screenShakeRef.current > 0) {
      const shakeX = (Math.random() - 0.5) * screenShakeRef.current * 1.5;
      const shakeY = (Math.random() - 0.5) * screenShakeRef.current * 1.5;
      ctx.translate(shakeX, shakeY);
    }

    // 1. Draw Background corresponding to level
    let bgImg = assets['bg_neon_grid'];
    if (gameState.level === 2) bgImg = assets['bg_magma_core'];
    if (gameState.level === 3) bgImg = assets['bg_astral_cosmos'];

    drawBackground(
      ctx,
      bgImg,
      canvasWidth,
      canvasHeight,
      gameState.level === 2
        ? '#1b0d0a'
        : gameState.level === 3
        ? '#0d091a'
        : '#060a17',
    );

    // Subtle arena perimeter glow line
    ctx.strokeStyle =
      gameState.level === 2
        ? 'rgba(255, 68, 0, 0.4)'
        : gameState.level === 3
        ? 'rgba(180, 0, 255, 0.4)'
        : 'rgba(0, 240, 255, 0.4)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1, 1, canvasWidth - 2, canvasHeight - 2);

    // 2. Draw Dotted Launch Guideline if ball is docked
    const dockedBall = ballsRef.current.find((b) => b.docked);
    if (dockedBall) {
      ctx.save();
      ctx.setLineDash([8, 8]);
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(dockedBall.x, dockedBall.y);
      ctx.lineTo(dockedBall.x, dockedBall.y - 120);
      ctx.stroke();

      // Small aim reticle dot
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(dockedBall.x, dockedBall.y - 120, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 3. Draw Tiles
    tilesRef.current.forEach((tile) => {
      if (tile.hits >= tile.maxHits) return;

      const isBumper = tile.type === 'bumper';

      // Base tile rendering via asset or fallback
      drawAsset(
        ctx,
        assets['tile_brick_neon'],
        tile.x,
        tile.y,
        tile.width,
        tile.height,
        (fCtx) => {
          fCtx.fillStyle = tile.color;
          fCtx.fillRect(tile.x, tile.y, tile.width, tile.height);
          fCtx.strokeStyle = '#ffffff';
          fCtx.lineWidth = 1.5;
          fCtx.strokeRect(tile.x, tile.y, tile.width, tile.height);
        },
      );

      // Color/Glow Overlay tint
      ctx.save();
      ctx.fillStyle = tile.color;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(tile.x, tile.y, tile.width, tile.height);

      if (tile.type === 'explosive') {
        // Pulsing warning outline
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(tile.x + 2, tile.y + 2, tile.width - 4, tile.height - 4);
        // Bomb glyph
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💣', tile.x + tile.width / 2, tile.y + tile.height / 2);
      } else if (tile.type === 'reinforced') {
        // Crack lines if damaged
        if (tile.hits > 0) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(tile.x + tile.width * 0.2, tile.y + 2);
          ctx.lineTo(tile.x + tile.width * 0.5, tile.y + tile.height * 0.6);
          ctx.lineTo(tile.x + tile.width * 0.8, tile.y + tile.height - 2);
          ctx.stroke();
        }
      } else if (isBumper) {
        // Bumper metallic hazard stripe
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 3;
        ctx.strokeRect(tile.x, tile.y, tile.width, tile.height);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('BUMP', tile.x + tile.width / 2, tile.y + tile.height / 2);
      }
      ctx.restore();
    });

    // 4. Draw Falling Powerup Capsules
    powerupsRef.current.forEach((p) => {
      drawAsset(
        ctx,
        assets['powerup_capsule'],
        p.x,
        p.y,
        p.width,
        p.height,
        (fCtx) => {
          fCtx.fillStyle = '#ffff00';
          fCtx.fillRect(p.x, p.y, p.width, p.height);
        },
      );

      // Letter Badge over capsule
      ctx.save();
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const badgeLetter =
        p.type === 'EXPAND'
          ? 'W'
          : p.type === 'MULTIBALL'
          ? 'M'
          : p.type === 'SLOW'
          ? 'S'
          : p.type === 'LASER'
          ? 'L'
          : p.type === 'PENETRATION'
          ? 'P'
          : '+';
      ctx.fillText(badgeLetter, p.x + p.width / 2, p.y + p.height / 2);
      ctx.restore();
    });

    // 5. Draw Laser Bolts
    ctx.save();
    ctx.fillStyle = '#ff0055';
    ctx.shadowColor = '#ff00aa';
    ctx.shadowBlur = 10;
    laserBoltsRef.current.forEach((bolt) => {
      ctx.fillRect(bolt.x, bolt.y, bolt.width, bolt.height);
    });
    ctx.restore();

    // 6. Draw Paddle
    const paddle = paddleRef.current;
    drawAsset(
      ctx,
      assets['paddle_cyber'],
      paddle.x,
      paddle.y,
      paddle.width,
      paddle.height,
      (fCtx) => {
        fCtx.fillStyle = '#00f0ff';
        fCtx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);
      },
    );

    // Laser cannons attached to paddle edges
    if (activePowerupsRef.current.some((p) => p.type === 'LASER')) {
      ctx.fillStyle = '#ff0055';
      ctx.fillRect(paddle.x + 8, paddle.y - 8, 8, 12);
      ctx.fillRect(paddle.x + paddle.width - 16, paddle.y - 8, 8, 12);
    }

    // Paddle hit flash
    if (paddle.flashTimer > 0) {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.6;
      ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);
      ctx.restore();
    }

    // 7. Draw Balls
    ballsRef.current.forEach((ball) => {
      // Glow if penetrating
      if (ball.penetrating) {
        ctx.save();
        ctx.shadowColor = '#ff00ff';
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#ff00ff';
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.radius + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      drawAsset(
        ctx,
        assets['energy_ball'],
        ball.x - ball.radius,
        ball.y - ball.radius,
        ball.radius * 2,
        ball.radius * 2,
        (fCtx) => {
          fCtx.fillStyle = '#ffffff';
          fCtx.beginPath();
          fCtx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
          fCtx.fill();
        },
      );
    });

    // 8. Draw Particles
    particlesRef.current.forEach((p) => {
      const alpha = 1 - p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, p.radius), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // 9. Draw Floating Score Popups
    scorePopupsRef.current.forEach((sp) => {
      ctx.save();
      ctx.font = 'bold 15px sans-serif';
      ctx.fillStyle = sp.color;
      ctx.textAlign = 'center';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 4;
      ctx.fillText(sp.text, sp.x, sp.y);
      ctx.restore();
    });

    ctx.restore();
  };

  // --- RAF LOOP ---
  const updateRef = useRef(update);
  const drawRef = useRef(draw);
  updateRef.current = update;
  drawRef.current = draw;

  useEffect(() => {
    let raf = 0;
    const loop = (time: number) => {
      if (inputRef.current) {
        const cancelPressed = inputRef.current.actions.cancel;
        if (cancelPressed && !lastCancelRef.current) {
          const currentStatus = gameStateRef.current.status;
          if (currentStatus === 'PLAYING') {
            setIsGameMenuOpen((prev) => !prev);
          } else if (currentStatus === 'PAUSED') {
            setGameState((prev) => ({...prev, status: 'PLAYING'}));
          } else if (currentStatus === 'START') {
            exitChat({}).catch(() => {});
          } else if (
            ['GAME_OVER', 'VICTORY', 'LEVEL_COMPLETE'].includes(currentStatus)
          ) {
            setGameState((prev) => ({...prev, status: 'START'}));
          }
        }
        lastCancelRef.current = cancelPressed;
      }

      stepperRef.current?.(time, (dt) => updateRef.current(dt));

      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) drawRef.current(ctx);

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const isMusicPlaying =
    !['START', 'GAME_OVER', 'VICTORY'].includes(gameState.status) &&
    !isGameMenuOpen &&
    !isHowToPlayOpen;

  const stageTitles = ['NEON GRID', 'MAGMA CORE', 'ASTRAL COSMOS'];
  const currentStageTitle = stageTitles[gameState.level - 1] || 'CYBER SURGE';

  return (
    <div className="fixed inset-0 overflow-hidden touch-none flex flex-col bg-slate-950 text-white font-sans select-none">
      {!assetsReady && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 text-white font-sans">
          <div className="text-xl font-bold tracking-widest animate-pulse text-cyan-400">
            LOADING TILE SURGE...
          </div>
        </div>
      )}

      <BackgroundMusic
        url={BACKGROUND_MUSIC_URL}
        isPlaying={isMusicPlaying}
        isMuted={musicMuted}
      />

      {/* TOP DEDICATED HUD (Safe & Non-overlapping) */}
      <header className="w-full h-14 md:h-16 bg-slate-950/90 border-b border-cyan-900/40 px-3 md:px-6 flex items-center justify-between z-20 shrink-0 select-none">
        {/* Left: Score & High Score */}
        <div className="flex items-center gap-3 md:gap-5">
          <div className="flex flex-col">
            <span className="text-[10px] md:text-xs text-cyan-400 uppercase tracking-wider font-semibold">
              Score
            </span>
            <span className="text-base md:text-xl font-black text-white tabular-nums">
              {gameState.score}
            </span>
          </div>

          <div className="hidden sm:flex flex-col border-l border-slate-800 pl-3">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Trophy size={11} className="text-yellow-400" /> Best
            </span>
            <span className="text-xs md:text-sm font-bold text-slate-300 tabular-nums">
              {highScore}
            </span>
          </div>
        </div>

        {/* Center: Stage Indicator & Active Buffs */}
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="text-[10px] md:text-xs font-bold px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-700/50">
              STAGE {gameState.level}/{TOTAL_LEVELS}
            </span>
            <span className="hidden md:inline text-xs font-extrabold tracking-widest text-slate-200">
              {currentStageTitle}
            </span>
          </div>

          {/* Active Powerup Badges */}
          {hudPowerups.length > 0 && (
            <div className="flex items-center gap-1.5 mt-0.5">
              {hudPowerups.map((p, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1 px-1.5 py-0.2 text-[9px] font-bold rounded bg-amber-950/80 border border-amber-500/50 text-amber-300">
                  <Zap size={9} />
                  <span>{p.type}</span>
                  <span className="text-[8px] text-amber-200">
                    {Math.ceil(p.duration)}s
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Lives, Combo & Persistent Game Menu Button */}
        <div className="flex items-center gap-2 md:gap-4">
          {/* Combo badge */}
          {hudCombo > 1 && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-fuchsia-950 border border-fuchsia-600 text-fuchsia-300 text-xs font-black animate-pulse">
              <Sparkles size={12} /> x{hudCombo}
            </div>
          )}

          {/* Reserve Lives */}
          <div className="flex items-center gap-1">
            {Array.from({length: Math.max(0, gameState.lives ?? 3)}).map(
              (_, i) => (
                <div
                  key={i}
                  className="w-3.5 h-3.5 md:w-4 md:h-4 rounded-full bg-cyan-400 border border-white shadow-[0_0_8px_#00f0ff]"
                />
              ),
            )}
          </div>

          {/* Dedicated Persistent Menu Button (TOP-RIGHT ONLY) */}
          <button
            onClick={() => {
              gameAudio.playCrispClick();
              setIsGameMenuOpen(true);
            }}
            aria-label="Game Menu"
            className="min-w-[48px] min-h-[48px] px-3 py-1.5 rounded-lg bg-slate-900 border border-cyan-800/80 hover:bg-cyan-950 active:bg-cyan-900 text-cyan-300 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-md">
            <Menu size={18} />
            <span className="hidden sm:inline">MENU</span>
          </button>
        </div>
      </header>

      {/* GAME CANVAS CONTAINER */}
      {assetsReady && (
        <div className="flex-1 w-full min-h-0 relative flex items-center justify-center bg-slate-950">
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={canvasHeight}
            style={{
              aspectRatio: `${canvasWidth} / ${canvasHeight}`,
              width: `min(100%, calc(100vh * ${canvasWidth} / ${canvasHeight}))`,
            }}
            className="h-auto max-w-full max-h-full shadow-2xl bg-black"
          />

          {/* Mobile Overlay Touch Controls (Left/Right + Action Launch/Fire) */}
          {isMobile && gameState.status === 'PLAYING' && !isGameMenuOpen && (
            <div className="absolute inset-0 pointer-events-none flex justify-between items-end p-4 md:p-8 z-30">
              {/* Left / Right directional pad */}
              <div className="flex items-center gap-3 pointer-events-auto pl-2 pb-2">
                <button
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    touchLeftRef.current = true;
                  }}
                  onPointerUp={() => (touchLeftRef.current = false)}
                  onPointerCancel={() => (touchLeftRef.current = false)}
                  className="min-w-[56px] min-h-[56px] w-14 h-14 rounded-2xl bg-slate-900/80 border-2 border-cyan-500/60 active:bg-cyan-600/40 text-cyan-300 flex items-center justify-center shadow-lg touch-none backdrop-blur-sm">
                  <ArrowLeft size={28} />
                </button>
                <button
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    touchRightRef.current = true;
                  }}
                  onPointerUp={() => (touchRightRef.current = false)}
                  onPointerCancel={() => (touchRightRef.current = false)}
                  className="min-w-[56px] min-h-[56px] w-14 h-14 rounded-2xl bg-slate-900/80 border-2 border-cyan-500/60 active:bg-cyan-600/40 text-cyan-300 flex items-center justify-center shadow-lg touch-none backdrop-blur-sm">
                  <ArrowRight size={28} />
                </button>
              </div>

              {/* Action / Launch / Fire button */}
              <div className="pointer-events-auto pr-2 pb-2">
                <button
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    touchActionRef.current = true;
                    launchBall();
                  }}
                  onPointerUp={() => (touchActionRef.current = false)}
                  onPointerCancel={() => (touchActionRef.current = false)}
                  className="min-w-[64px] min-h-[64px] w-16 h-16 rounded-full bg-gradient-to-tr from-cyan-600 to-fuchsia-600 border-2 border-white/80 active:scale-95 text-white font-black text-xs flex flex-col items-center justify-center shadow-2xl touch-none">
                  <Zap size={22} />
                  <span>ACTION</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* START SCREEN OVERLAY */}
      {gameState.status === 'START' && !autoStartPending && assetsReady && (
        <MenuOverlay tone="neutral" zIndex={50}>
          <div className="bg-slate-900/95 border-2 border-cyan-500/60 p-6 md:p-8 rounded-2xl shadow-[0_0_50px_rgba(0,240,255,0.2)] flex flex-col items-center w-full max-w-md text-center backdrop-blur-md">
            <div className="w-16 h-16 rounded-full bg-cyan-950 border-2 border-cyan-400 flex items-center justify-center text-cyan-300 mb-4 shadow-[0_0_20px_#00f0ff]">
              <Zap size={36} />
            </div>

            <h1 className="text-4xl md:text-5xl font-black mb-2 text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-yellow-300 tracking-wider">
              TILE SURGE
            </h1>

            <p className="text-cyan-200 text-sm md:text-base font-medium mb-6">
              Smash colorful crystal tiles, collect power-up capsules, and conquer
              all three themed sectors!
            </p>

            <div className="w-full flex flex-col gap-3 mb-6">
              <button
                onClick={() => {
                  gameAudio.playCrispClick();
                  initGame();
                }}
                autoFocus
                data-testid="start-button"
                className="w-full min-h-[50px] bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 active:scale-98 text-white px-6 py-3 rounded-full font-black text-lg md:text-xl shadow-[0_0_25px_rgba(0,240,255,0.4)] flex items-center justify-center gap-2 cursor-pointer transition-all">
                <Play size={22} />
                START GAME
              </button>

              <button
                onClick={() => {
                  gameAudio.playCrispClick();
                  setIsHowToPlayOpen(true);
                }}
                className="w-full min-h-[48px] bg-slate-800 hover:bg-slate-700 text-slate-200 px-6 py-2.5 rounded-full font-bold text-sm md:text-base border border-slate-700 flex items-center justify-center gap-2 cursor-pointer transition-colors">
                <HelpCircle size={18} />
                HOW TO PLAY
              </button>
            </div>

            <div className="text-xs text-slate-400 flex items-center gap-4">
              <span>🖱️ Drag to Aim</span>
              <span>⌨️ A/D or Arrows</span>
              <span>␣ Space to Launch</span>
            </div>
          </div>
        </MenuOverlay>
      )}

      {/* GAME MENU OVERLAY (Mandatory Shared Feature) */}
      {isGameMenuOpen && (
        <MenuOverlay tone="neutral" zIndex={60}>
          <div className="w-full max-w-md bg-slate-900/95 border-2 border-cyan-500/60 rounded-2xl p-6 md:p-8 m-4 shadow-2xl flex flex-col items-center backdrop-blur-md">
            <h2 className="text-2xl md:text-3xl font-black text-cyan-400 mb-6 tracking-wide">
              GAME MENU
            </h2>

            <div className="w-full flex flex-col gap-3 mb-6">
              {/* Resume */}
              <button
                onClick={() => {
                  gameAudio.playCrispClick();
                  setIsGameMenuOpen(false);
                }}
                autoFocus
                className="w-full min-h-[48px] bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-base md:text-lg rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-md">
                <Play size={20} />
                RESUME
              </button>

              {/* SFX Toggle */}
              <button
                onClick={() => {
                  const muted = gameAudio.toggleMute();
                  setSfxMuted(muted);
                }}
                className="w-full min-h-[48px] bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm md:text-base rounded-xl border border-slate-700 flex items-center justify-between px-5 transition-colors cursor-pointer">
                <span className="flex items-center gap-2">
                  {sfxMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  Sound Effects (SFX)
                </span>
                <span
                  className={`font-black text-xs px-2.5 py-1 rounded ${
                    sfxMuted
                      ? 'bg-red-950 text-red-400'
                      : 'bg-emerald-950 text-emerald-400'
                  }`}>
                  {sfxMuted ? 'OFF' : 'ON'}
                </span>
              </button>

              {/* Music Toggle */}
              <button
                onClick={() => {
                  setMusicMuted((prev) => !prev);
                }}
                className="w-full min-h-[48px] bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm md:text-base rounded-xl border border-slate-700 flex items-center justify-between px-5 transition-colors cursor-pointer">
                <span className="flex items-center gap-2">
                  {musicMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  Background Music
                </span>
                <span
                  className={`font-black text-xs px-2.5 py-1 rounded ${
                    musicMuted
                      ? 'bg-red-950 text-red-400'
                      : 'bg-emerald-950 text-emerald-400'
                  }`}>
                  {musicMuted ? 'OFF' : 'ON'}
                </span>
              </button>

              {/* Try Level Again */}
              <button
                onClick={() => {
                  gameAudio.playCrispClick();
                  setIsGameMenuOpen(false);
                  startRun(
                    gameStateRef.current.level,
                    levelStartScoreRef.current,
                  );
                }}
                className="w-full min-h-[48px] bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-sm md:text-base rounded-xl border border-amber-900/50 flex items-center justify-center gap-2 transition-colors cursor-pointer">
                <RotateCw size={18} />
                TRY LEVEL AGAIN
              </button>

              {/* How to Play */}
              <button
                onClick={() => {
                  gameAudio.playCrispClick();
                  setIsHowToPlayOpen(true);
                }}
                className="w-full min-h-[48px] bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm md:text-base rounded-xl border border-slate-700 flex items-center justify-center gap-2 transition-colors cursor-pointer">
                <HelpCircle size={18} />
                HOW TO PLAY
              </button>

              {/* Quit to Menu */}
              <button
                onClick={() => {
                  gameAudio.playCrispClick();
                  setIsGameMenuOpen(false);
                  setGameState((prev) => ({...prev, status: 'START'}));
                }}
                className="w-full min-h-[48px] bg-red-950/60 hover:bg-red-900/80 text-red-300 font-bold text-sm md:text-base rounded-xl border border-red-800/50 flex items-center justify-center gap-2 transition-colors cursor-pointer">
                <X size={18} />
                QUIT TO TITLE
              </button>
            </div>
          </div>
        </MenuOverlay>
      )}

      {/* HOW TO PLAY MODAL */}
      {isHowToPlayOpen && (
        <div
          className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-4 overflow-y-auto touch-auto"
          role="dialog">
          <div className="w-full max-w-lg bg-slate-900 border-2 border-cyan-500/80 rounded-2xl p-6 md:p-8 m-auto text-left shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <h2 className="text-xl md:text-2xl font-black text-cyan-400 flex items-center gap-2">
                <HelpCircle size={24} /> HOW TO PLAY
              </h2>
              <button
                onClick={() => setIsHowToPlayOpen(false)}
                className="min-w-[40px] min-h-[40px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <div className="overflow-y-auto space-y-4 text-xs md:text-sm text-slate-300 pr-1">
              <div>
                <h3 className="font-bold text-white mb-1 text-sm md:text-base text-cyan-300">
                  🎯 Objective
                </h3>
                <p>
                  Shatter all destructible tiles across 3 sectors (Neon Grid,
                  Magma Core, and Astral Cosmos) to win. Prevent the energy ball
                  from falling below your defensive paddle!
                </p>
              </div>

              <div>
                <h3 className="font-bold text-white mb-1 text-sm md:text-base text-yellow-300">
                  📐 Angle-Directed Deflection
                </h3>
                <p>
                  Hitting the sphere near the edges of the paddle creates sharp,
                  surgical launch angles to target hard-to-reach tiles. Hitting the
                  center returns the ball symmetrically upward.
                </p>
              </div>

              <div>
                <h3 className="font-bold text-white mb-1 text-sm md:text-base text-fuchsia-300">
                  ⚡ Power-Up Capsules
                </h3>
                <ul className="list-disc pl-4 space-y-1">
                  <li>
                    <strong className="text-cyan-300">[W] WIDER PADDLE:</strong>{' '}
                    Expands paddle length by 45%.
                  </li>
                  <li>
                    <strong className="text-purple-300">[M] MULTIBALL:</strong>{' '}
                    Splits balls into 3 active energy spheres!
                  </li>
                  <li>
                    <strong className="text-blue-300">[S] SLOW SPHERE:</strong>{' '}
                    Eases control with reduced ball speed.
                  </li>
                  <li>
                    <strong className="text-red-300">[L] LASER CANNONS:</strong>{' '}
                    Tap or Space to blast twin lasers upward.
                  </li>
                  <li>
                    <strong className="text-pink-300">
                      [P] PLASMA PENETRATION:
                    </strong>{' '}
                    Sphere punches straight through tiles without deflecting!
                  </li>
                  <li>
                    <strong className="text-emerald-300">[+] EXTRA LIFE:</strong>{' '}
                    Adds +1 reserve ball immediately.
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-white mb-1 text-sm md:text-base text-cyan-300">
                  🎮 Controls
                </h3>
                <p>
                  <strong>Desktop:</strong> Move with Left/Right Arrow Keys or
                  A/D, or directly glide your mouse. Press Space to launch ball or
                  fire lasers.
                  <br />
                  <strong>Mobile:</strong> Touch & drag paddle directly, or use
                  virtual Left/Right buttons. Tap Action button to launch/fire.
                </p>
              </div>
            </div>

            <div className="mt-6 pt-3 border-t border-slate-800">
              <button
                onClick={() => setIsHowToPlayOpen(false)}
                autoFocus
                className="w-full min-h-[48px] bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black rounded-xl cursor-pointer transition-colors">
                CLOSE GUIDE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GAME OVER MODAL */}
      {gameState.status === 'GAME_OVER' && (
        <Overlay
          title="MISSION FAILED"
          description={`Energy spheres depleted! Final Score: ${gameState.score}`}
          actionLabel="TRY AGAIN"
          onAction={initGame}
          icon={<RotateCw size={24} />}
          tone="danger"
        />
      )}

      {/* VICTORY MODAL */}
      {gameState.status === 'VICTORY' && (
        <Overlay
          title="VICTORY ACHIEVED!"
          description={`All 3 sectors cleared! Supercharged Final Score: ${gameState.score}`}
          actionLabel="PLAY AGAIN"
          onAction={resetGame}
          icon={<RotateCw size={24} />}
          tone="victory"
        />
      )}
    </div>
  );
}
