// tslint:disable
/* eslint-disable */
/**
 * @fileoverview Android TV / Google TV remote helpers for Playground games.
 *
 * Part of the 2D game template (copied to the game root). Import only in
 * TV-compatible games: `import {...} from './tv';`
 *
 * Conventions:
 * - Give every focus target a stable `data-tv-id` (for example
 *   `data-tv-id="start-howto"`). Focus restore uses this id, so it works when
 *   React re-mounts the element.
 * - Put `data-tv-scope` on the root element of each modal. The focus rover
 *   uses the last visible scope in DOM order, so render modals after screens.
 * - An element key handler that consumes an Arrow key must call
 *   `e.preventDefault()`. The rover then ignores that key.
 * - Size everything in `rem`. Importing this file makes 1rem 16px on the TV
 *   (the smallest screen) and scales it up proportionally on larger screens,
 *   so the game looks the same on a TV, a desktop, and 4K. Fixed `px` sizes
 *   and breakpoint prefixes (`sm:`, `md:`, `lg:`) break this.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';

// The TV screen is 60rem x 33.75rem at 16px. Larger 16:9 screens scale 1rem up
// by the same factor; smaller screens never go below 16px.
const TV_ROOT_FONT_SIZE =
  'max(16px, min(calc(100vw / 60), calc(100vh / 33.75)))';

if (typeof document !== 'undefined') {
  document.documentElement.style.fontSize = TV_ROOT_FONT_SIZE;
}

let cachedScale = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => (cachedScale = 0));
}

/**
 * Scale factor of the page (1 on the TV). Use it for canvas UI text. Cached,
 * so it is cheap to call every frame.
 */
export function tvScale(): number {
  if (!cachedScale) {
    cachedScale =
      parseFloat(window.getComputedStyle(document.documentElement).fontSize) /
        16 || 1;
  }
  return cachedScale;
}

// Pixel count of a full-HD TV screen. A larger canvas backing store only adds
// frame time on TV hardware, which also delays remote input.
const MAX_CANVAS_PIXELS = 1920 * 1080;

/**
 * Same as `prepareCanvas` from `./helper` (call it at the start of every frame
 * with the logical canvas size), but caps the backing store at full-HD pixels.
 * The pixel ratio can then be lower than `devicePixelRatio`, so draw with the
 * logical `width` and `height`, never `canvas.width / devicePixelRatio`.
 */
export function tvPrepareCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const scale = Math.min(
    window.devicePixelRatio || 1,
    Math.sqrt(MAX_CANVAS_PIXELS / (width * height)),
  );
  const displayWidth = Math.floor(width * scale);
  const displayHeight = Math.floor(height * scale);
  if (
    ctx.canvas.width !== displayWidth ||
    ctx.canvas.height !== displayHeight
  ) {
    // Resizing resets the context state. Keep the smoothing setting, which
    // pixel-art games often set only once.
    const {imageSmoothingEnabled, imageSmoothingQuality} = ctx;
    ctx.canvas.width = displayWidth;
    ctx.canvas.height = displayHeight;
    ctx.imageSmoothingEnabled = imageSmoothingEnabled;
    ctx.imageSmoothingQuality = imageSmoothingQuality;
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

const ARROW_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const BACK_KEYS = ['Escape', 'Back', 'BrowserBack', 'GoBack'];
const OK_KEYS = ['Enter', 'Select', 'Go', 'Ok', ' '];

/** True for the remote Back key (the TV host sends it as `Escape`). */
export function isBackKey(e: KeyboardEvent): boolean {
  return BACK_KEYS.includes(e.key) || e.keyCode === 27;
}

/** True for the remote OK / center key. */
export function isOkKey(e: KeyboardEvent): boolean {
  return OK_KEYS.includes(e.key) || e.keyCode === 13;
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return (
    style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    !el.closest('[inert]')
  );
}

function canScroll(el: HTMLElement, direction: 1 | -1): boolean {
  return direction > 0
    ? el.scrollTop + el.clientHeight < el.scrollHeight - 1
    : el.scrollTop > 1;
}

/** Visible focus targets in the topmost `data-tv-scope`, else in the page. */
export function getTvFocusables(): HTMLElement[] {
  return focusablesIn(topTvScope() ?? document.body);
}

/** The topmost visible `data-tv-scope` (the open modal), or null. */
function topTvScope(): HTMLElement | null {
  const scopes = Array.from(
    document.querySelectorAll<HTMLElement>('[data-tv-scope]'),
  ).filter(isVisible);
  return scopes.length ? scopes[scopes.length - 1] : null;
}

function focusablesIn(root: HTMLElement): HTMLElement[] {
  const visible = Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [data-tv-focusable]',
    ),
  ).filter(isVisible);
  const uncovered = visible.filter((el) => !isCovered(el));
  // A decorative overlay without `pointer-events: none` can cover every
  // target. Never leave the screen without focus targets.
  return uncovered.length ? uncovered : visible;
}

/**
 * True when another element is drawn over the centre of `el` (for example a
 * START card over gameplay buttons that has no `data-tv-scope`). Elements
 * outside the viewport (e.g. below a scroll fold) are never "covered".
 */
function isCovered(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
    return false;
  }
  const top = document.elementFromPoint(x, y);
  return !!top && !el.contains(top) && !top.contains(el);
}

/** The `data-tv-primary` target among `items`, else the first one. */
function defaultTarget(items: HTMLElement[]): HTMLElement | undefined {
  return items.find((el) => el.hasAttribute('data-tv-primary')) ?? items[0];
}

/**
 * The nearest focus target in the direction of `key` from `from`, using the
 * on-screen layout, or null when nothing lies that way. Candidates must be
 * ahead of `from` (edge to edge). The score is the gap along the direction
 * plus twice the gap across it (0 when the two overlap across the direction),
 * so the button below wins over the one beside it. Ties keep reading (DOM)
 * order, so Down from a wide button picks the left button of the next row.
 */
export function nextTvFocusTarget(
  from: HTMLElement,
  items: HTMLElement[],
  key: string,
): HTMLElement | null {
  const a = from.getBoundingClientRect();
  const vertical = key === 'ArrowUp' || key === 'ArrowDown';
  const forward = key === 'ArrowDown' || key === 'ArrowRight';
  const minAllowedGap = -Math.min(a.height, a.width) / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of items) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    let gap: number;
    let across: number;
    if (vertical) {
      gap = forward ? b.top - a.bottom : a.top - b.bottom;
      across = Math.max(0, b.left - a.right, a.left - b.right);
    } else {
      gap = forward ? b.left - a.right : a.left - b.right;
      across = Math.max(0, b.top - a.bottom, a.top - b.bottom);
    }
    // Allow a small overlap (borders, rings) but nothing behind `from`.
    if (gap < minAllowedGap) continue;
    const score = Math.max(gap, 0) + 2 * across;
    // Strictly better only (with 1px slack), so ties keep DOM order.
    if (score < bestScore - 1) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

// Short focus lock set by `useTvModalStack.close()` (opener) and
// `TvScrollArea` (on mount). While it is active, `focusTvId` ignores other
// targets, so a game's own autofocus effect cannot override the helper. The
// next key press clears it.
let focusLock: {
  id?: string | null;
  el?: HTMLElement | null;
  until: number;
} | null = null;

function setFocusLock(target: {
  id?: string | null;
  el?: HTMLElement | null;
}): void {
  if (!focusLock) {
    window.addEventListener('keydown', () => (focusLock = null), {
      capture: true,
      once: true,
    });
  }
  focusLock = {...target, until: performance.now() + 500};
}

function isLockedOut(id: string, el: HTMLElement): boolean {
  if (!focusLock) return false;
  if (performance.now() > focusLock.until) {
    focusLock = null;
    return false;
  }
  return focusLock.el ? focusLock.el !== el : focusLock.id !== id;
}

/**
 * Focuses the element with `data-tv-id={id}`. Retries for a few frames so the
 * element can re-mount after a state change.
 */
export function focusTvId(id: string | null | undefined, frames = 8): void {
  if (!id) return;
  const attempt = (left: number) => {
    const el = document.querySelector<HTMLElement>(
      `[data-tv-id="${CSS.escape(id)}"]`,
    );
    if (el && isLockedOut(id, el)) return;
    if (el && isVisible(el)) {
      el.focus();
      return;
    }
    if (left > 0) requestAnimationFrame(() => attempt(left - 1));
  };
  attempt(frames);
}

/** `window` with the TV host interop property. */
interface TvWindow extends Window {
  canHandleBackKey?: boolean;
}

/**
 * Tells the TV host whether the game handles the Back key. Set it to `true`
 * everywhere except the START screen with no modal open.
 */
export function useTvBackHandshake(canHandleBack: boolean): void {
  useEffect(() => {
    (window as TvWindow).canHandleBackKey = canHandleBack;
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {type: 'PLAYGROUND_CAN_HANDLE_BACK_KEY', value: canHandleBack},
        '*',
      );
    }
  }, [canHandleBack]);
}

/**
 * Calls `onBack` for each remote Back press. If `onBack` returns true, the
 * event is consumed (`preventDefault`). Return false only on the START screen
 * with no modal open, so the TV host can exit the game.
 */
export function useTvBackKey(onBack: () => boolean): void {
  const handlerRef = useRef(onBack);
  handlerRef.current = onBack;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isBackKey(e) && handlerRef.current()) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/**
 * Window `keydown` listener that always calls the latest `handler`, so the
 * handler never reads stale React state. Use it for every custom key handler.
 */
export function useTvKeyDown(
  handler: (e: KeyboardEvent) => void,
  enabled = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => handlerRef.current(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/** Remote actions for {@link useTvGameInput}. */
export type TvAction = 'left' | 'right' | 'up' | 'down' | 'ok';

// How long a press stays available to `consumePress`: long enough for a press
// made just before the action is possible (a jump just before landing) or
// between two slow frames, short enough that old presses never replay later.
const PRESS_BUFFER_MS = 200;

/** Gameplay input from {@link useTvGameInput}. */
export interface TvGameInput {
  /** True while the key is held (movement). Several keys can be held at once. */
  readonly isDown: (action: TvAction) => boolean;
  /**
   * True if any of `actions` was pressed in the last 200 ms and not consumed
   * yet, even if the key was released between two frames (jump, fire,
   * select). Clears the presses of all `actions`, for example
   * `consumePress('ok', 'up')` for a jump on OK or Up. Older presses expire and
   * repeated presses count once, so presses never queue up.
   */
  readonly consumePress: (...actions: TvAction[]) => boolean;
}

function toTvAction(e: KeyboardEvent): TvAction | null {
  switch (e.key) {
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    default:
      return isOkKey(e) ? 'ok' : null;
  }
}

/**
 * Gameplay input for the game loop. Every frame, read `isDown` for held
 * movement and `consumePress` for one-shot actions, so held keys and presses
 * combine (Right held + OK jumps right). Calls `preventDefault()` on Arrow keys
 * only while `enabled` (during `PLAYING`).
 */
export function useTvGameInput(enabled: boolean): TvGameInput {
  const downRef = useRef(new Set<TvAction>());
  // Time of the latest unconsumed press of each action.
  const pressedAtRef = useRef(new Map<TvAction, number>());

  useEffect(() => {
    downRef.current.clear();
    pressedAtRef.current.clear();
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const action = toTvAction(e);
      if (!action) return;
      if (ARROW_KEYS.includes(e.key)) e.preventDefault();
      if (!e.repeat) pressedAtRef.current.set(action, performance.now());
      downRef.current.add(action);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const action = toTvAction(e);
      if (action) downRef.current.delete(action);
    };
    const onBlur = () => {
      downRef.current.clear();
      pressedAtRef.current.clear();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [enabled]);

  const input = useRef<TvGameInput>({
    isDown: (action) => downRef.current.has(action),
    consumePress: (...actions) => {
      const now = performance.now();
      let pressed = false;
      for (const action of actions) {
        const pressedAt = pressedAtRef.current.get(action);
        if (pressedAt === undefined) continue;
        pressedAtRef.current.delete(action);
        if (now - pressedAt <= PRESS_BUFFER_MS) pressed = true;
      }
      return pressed;
    },
  });
  return input.current;
}

/** A modal in the LIFO stack. */
export interface TvModalEntry<T extends string> {
  readonly id: T;
  readonly openerTvId: string | null;
}

/** LIFO modal stack with focus restore to the opener `data-tv-id`. */
export interface TvModalStack<T extends string> {
  /** Opens a modal and saves the focused element's `data-tv-id`. */
  readonly open: (id: T) => void;
  /** Closes the topmost modal and refocuses its opener. False if empty. */
  readonly close: () => boolean;
  /** Closes all modals without moving focus. */
  readonly clear: () => void;
  readonly isOpen: (id: T) => boolean;
  readonly top: T | null;
  readonly anyOpen: boolean;
}

/**
 * After a modal opens, focuses its `data-tv-primary` target (else its first
 * focus target) once the modal's `data-tv-scope` has rendered. Leaves focus
 * alone if it is already inside the modal (for example a `TvScrollArea`) or a
 * focus lock is active. Retries for a few frames while the modal mounts.
 */
function focusOpenedScope(previousScope: HTMLElement | null, frames = 30) {
  const attempt = (left: number) => {
    const scope = topTvScope();
    if (scope && scope !== previousScope) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && scope.contains(active)) return;
      const target = defaultTarget(focusablesIn(scope));
      if (target) {
        const id = target.getAttribute('data-tv-id') ?? '';
        if (!isLockedOut(id, target)) target.focus();
        return;
      }
    }
    if (left > 0) {
      requestAnimationFrame(() => attempt(left - 1));
      return;
    }
    // The modal has no `data-tv-scope`: still never leave focus on <body>.
    const items = getTvFocusables();
    const active = document.activeElement;
    if (!(active instanceof HTMLElement && items.includes(active))) {
      defaultTarget(items)?.focus();
    }
  };
  attempt(frames);
}

/**
 * LIFO modal stack. `open()` focuses the new modal's primary target;
 * `close()` restores focus by `data-tv-id`, so focus returns to the opener
 * even if React removed and re-created it.
 */
export function useTvModalStack<T extends string>(): TvModalStack<T> {
  const stackRef = useRef<Array<TvModalEntry<T>>>([]);
  const [, setVersion] = useState(0);
  const rerender = () => setVersion((v) => v + 1);

  const open = useCallback((id: T) => {
    const openerTvId =
      document.activeElement?.getAttribute('data-tv-id') ?? null;
    stackRef.current = [...stackRef.current, {id, openerTvId}];
    const previousScope = topTvScope();
    rerender();
    focusOpenedScope(previousScope);
  }, []);

  const close = useCallback(() => {
    const stack = stackRef.current;
    if (!stack.length) return false;
    const top = stack[stack.length - 1];
    stackRef.current = stack.slice(0, -1);
    rerender();
    focusLock = null;
    focusTvId(top.openerTvId);
    if (top.openerTvId) setFocusLock({id: top.openerTvId});
    return true;
  }, []);

  const clear = useCallback(() => {
    stackRef.current = [];
    rerender();
  }, []);

  const stack = stackRef.current;
  return {
    open,
    close,
    clear,
    isOpen: (id: T) => stack.some((m) => m.id === id),
    top: stack.length ? stack[stack.length - 1].id : null,
    anyOpen: stack.length > 0,
  };
}

/**
 * Moves focus to the nearest visible focus target in the pressed Arrow
 * direction (spatial, no wrap-around), so Down in a two-column menu goes to
 * the row below. The TV WebView does not move focus between buttons natively.
 * Enable it in menus and modals; disable it during active gameplay.
 */
export function useTvFocusRover(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !ARROW_KEYS.includes(e.key)) return;
      const items = getTvFocusables();
      if (!items.length) return;
      e.preventDefault();
      const active = document.activeElement;
      const next =
        active instanceof HTMLElement && items.includes(active)
          ? nextTvFocusTarget(active, items, e.key)
          : defaultTarget(items);
      // Nothing in that direction: stay on the current target.
      if (!next) return;
      next.focus();
      next.scrollIntoView({block: 'nearest'});
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/**
 * Refocuses the primary target when focus is outside the current focus
 * targets (on `<body>`, on the canvas, or behind a modal) while a menu is
 * visible. Runs on keydown (capture phase), window focus, visibility change,
 * and when the page changes while focus is on `<body>`.
 */
export function useTvFocusWatchdog(
  enabled: boolean,
  primaryTvId?: string,
): void {
  useEffect(() => {
    if (!enabled) return;
    // Recovers when focus is outside the current focus targets: on <body>, on
    // the gameplay canvas after PLAYING ends, or behind an open modal scope.
    // Respects the focus lock and focuses only inside the active scope.
    const recover = (): boolean => {
      const items = getTvFocusables();
      if (!items.length) return false;
      const active = document.activeElement;
      if (active instanceof HTMLElement && items.includes(active)) return false;
      if (primaryTvId) {
        const primary = items.find(
          (el) => el.getAttribute('data-tv-id') === primaryTvId,
        );
        if (primary && !isLockedOut(primaryTvId, primary)) {
          primary.focus();
          return true;
        }
      }
      if (isLockedOut('', items[0])) return false;
      defaultTarget(items)?.focus();
      return true;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (recover() && ARROW_KEYS.includes(e.key)) e.preventDefault();
    };
    // Focus can drop to <body> without any key press, e.g. when a screen
    // unmounts as a modal opens. Recover then too, but only from <body> so a
    // game that deliberately focuses its canvas is left alone.
    let pending = 0;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        const active = document.activeElement;
        if (!active || active === document.body) recover();
      });
    });
    observer.observe(document.body, {childList: true, subtree: true});
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('focus', recover);
    document.addEventListener('visibilitychange', recover);
    const timer = window.setTimeout(recover, 0);
    return () => {
      observer.disconnect();
      if (pending) cancelAnimationFrame(pending);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('focus', recover);
      document.removeEventListener('visibilitychange', recover);
      window.clearTimeout(timer);
    };
  }, [enabled, primaryTvId]);
}

/**
 * Resumes a suspended custom AudioContext on remote key presses. TV remotes
 * fire no `click` or `pointerdown`. `gameAudio` from `./helper` already does
 * this; use this hook only for other AudioContexts.
 */
export function useTvAudioUnlock(
  getContext: () => AudioContext | null | undefined,
): void {
  const getRef = useRef(getContext);
  getRef.current = getContext;
  useEffect(() => {
    const onKeyDown = () => {
      const ctx = getRef.current();
      if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}

/** Props for {@link TvScrollArea}. */
export interface TvScrollAreaProps {
  readonly children: React.ReactNode;
  /** CSS max-height, for example `'50vh'`. */
  readonly maxHeight?: string;
  readonly className?: string;
  /** Focus the area when it mounts (default true). */
  readonly autoFocus?: boolean;
  readonly tvId?: string;
}

/**
 * Focusable text area that scrolls with ArrowUp / ArrowDown and shows ▲ / ▼
 * cues. At the top or bottom edge, the Arrow key goes to the focus rover, so
 * the user can reach the Close button. Do not put it inside another
 * scrollable container.
 */
export function TvScrollArea({
  children,
  maxHeight = '50vh',
  className = '',
  autoFocus = true,
  tvId,
}: TvScrollAreaProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [cues, setCues] = useState({up: false, down: false});

  const updateCues = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCues({up: canScroll(el, -1), down: canScroll(el, 1)});
  }, []);

  useEffect(() => {
    updateCues();
    if (autoFocus && ref.current) {
      ref.current.focus();
      setFocusLock({el: ref.current});
    }
  }, [autoFocus, updateCues]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const direction = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!direction) return;
    const el = e.currentTarget;
    if (canScroll(el, direction)) {
      e.preventDefault();
      el.scrollBy({top: direction * el.clientHeight * 0.6});
    }
  };

  return (
    <div className="relative w-full">
      <div aria-hidden className="h-6 text-center text-lg leading-6">
        {cues.up ? '▲' : ''}
      </div>
      <div
        ref={ref}
        tabIndex={0}
        role="document"
        data-tv-focusable=""
        data-tv-id={tvId}
        onKeyDown={onKeyDown}
        onScroll={updateCues}
        className={`overflow-y-auto focus:outline-none focus:ring-4 focus:ring-yellow-400 ${className}`}
        style={{maxHeight}}>
        {children}
      </div>
      <div aria-hidden className="h-6 text-center text-lg leading-6">
        {cues.down ? '▼' : ''}
      </div>
    </div>
  );
}
