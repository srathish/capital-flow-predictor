/**
 * Fire-state machine — turns per-snapshot pattern detections into ONE
 * fire event per state entry, so downstream (Discord webhook, plays tracker)
 * doesn't get 12 identical alerts when a state persists across snapshots.
 *
 * Interface: keep one FireStateMachine per (ticker, timeframe) pair.
 *
 * States:
 *   - IDLE           — no active setup
 *   - BEAR_RUG       — rug_setup or bearish trapdoor active
 *   - BEAR_TRAPDOOR  — trapdoor without full rug (pre-break floor test)
 *   - BEAR_CONTINUE  — vanna-persistent bear after gamma pin flip
 *   - BEAR_OVERNIGHT — overnight-carryover fire in pre-market
 *   - BULL_REVERSE   — reverse-rug active
 *   - PIN            — pika-cloud pin (informational, no fire)
 *
 * Cooldown: after a fire, the same state cannot re-fire within COOLDOWN_MS
 * even if it clears and returns.
 */

export const State = Object.freeze({
  IDLE: 'IDLE',
  BEAR_RUG: 'BEAR_RUG',
  BEAR_TRAPDOOR: 'BEAR_TRAPDOOR',
  BEAR_CONTINUE: 'BEAR_CONTINUE',
  BEAR_OVERNIGHT: 'BEAR_OVERNIGHT',
  BULL_REVERSE: 'BULL_REVERSE',
  PIN: 'PIN',
});

// Bear states allow re-entry via BEAR_CONTINUE (Vanna-Persistent) after 15 min.
const COOLDOWN_MS = {
  BEAR_RUG: 30 * 60 * 1000,
  BEAR_TRAPDOOR: 20 * 60 * 1000,
  BEAR_CONTINUE: 15 * 60 * 1000,
  BEAR_OVERNIGHT: 60 * 60 * 1000, // only once per morning
  BULL_REVERSE: 30 * 60 * 1000,
  PIN: 0,
};

// Map pattern names to state names. Bearish patterns rank by priority.
const PATTERN_TO_STATE = {
  rug_setup: State.BEAR_RUG,
  trapdoor: State.BEAR_TRAPDOOR,
  vanna_persistent_bear: State.BEAR_CONTINUE,
  overnight_carryover: State.BEAR_OVERNIGHT,
  reverse_rug: State.BULL_REVERSE,
  pika_cloud: State.PIN,
};

const STATE_PRIORITY = [
  State.BEAR_RUG,
  State.BEAR_TRAPDOOR,
  State.BEAR_OVERNIGHT,
  State.BULL_REVERSE,
  State.BEAR_CONTINUE,
  State.PIN,
];

/**
 * Pick the highest-priority state present in the detections map.
 */
function pickState(detections) {
  const activeStates = new Set();
  for (const [pattern, det] of Object.entries(detections)) {
    if (!det?.detected) continue;
    const state = PATTERN_TO_STATE[pattern];
    if (state) activeStates.add(state);
  }
  for (const s of STATE_PRIORITY) {
    if (activeStates.has(s)) return s;
  }
  return State.IDLE;
}

export function createFireStateMachine({ ticker, tag = 'default' } = {}) {
  let currentState = State.IDLE;
  let currentStateEnteredMs = 0;
  const lastFireByState = new Map(); // state -> tsMs of last fire

  /**
   * Feed the machine one snapshot's detections. Returns a fire event OR null.
   *
   * Fire event shape:
   *   {
   *     fired: true, ticker, tag, state, patternDetection, tsMs,
   *     prevState, timeInPrevStateMs,
   *   }
   */
  function ingest({ detections, tsMs }) {
    const nextState = pickState(detections);

    // If state didn't change, nothing new — but maintain "entered" timestamp.
    if (nextState === currentState) {
      return null;
    }

    const prevState = currentState;
    const timeInPrevMs = tsMs - currentStateEnteredMs;
    currentState = nextState;
    currentStateEnteredMs = tsMs;

    // Only fire on ENTRY to a fireable state.
    if (nextState === State.IDLE || nextState === State.PIN) {
      return { fired: false, ticker, tag, state: nextState, prevState, timeInPrevStateMs: timeInPrevMs, tsMs };
    }

    // Cooldown check
    const cd = COOLDOWN_MS[nextState] ?? 0;
    const lastFire = lastFireByState.get(nextState) ?? 0;
    if (tsMs - lastFire < cd) {
      return {
        fired: false, ticker, tag, state: nextState, prevState,
        timeInPrevStateMs: timeInPrevMs, tsMs,
        rejectReason: 'cooldown_active',
        cooldownMsRemaining: cd - (tsMs - lastFire),
      };
    }

    lastFireByState.set(nextState, tsMs);

    // Find the specific pattern detection that drove this state.
    const patternForState = Object.entries(PATTERN_TO_STATE).find(([, s]) => s === nextState)?.[0];
    const patternDetection = patternForState ? detections[patternForState] : null;

    return {
      fired: true,
      ticker,
      tag,
      state: nextState,
      prevState,
      timeInPrevStateMs: timeInPrevMs,
      tsMs,
      patternName: patternForState,
      patternDetection,
    };
  }

  function getState() {
    return {
      currentState,
      currentStateEnteredMs,
      lastFireByState: Object.fromEntries(lastFireByState),
    };
  }

  return { ingest, getState };
}
