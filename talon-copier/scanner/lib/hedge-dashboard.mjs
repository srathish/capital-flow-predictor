// hedge-dashboard.mjs — the market-context THROTTLE Talon uses to gate single-name
// aggression. Reads the structure of the index/hedge complex (QQQ/SPXW/SOXX/RUT +
// the inverse/vol products SQQQ/VXX) and derives risk-on vs risk-off. This is exactly
// what we were missing: a name in isolation can look bullish while the tape is rolling
// over — the dashboard catches that and says "size down."
import { assembleStructure } from './structure.mjs';
import { talonLevels } from './talon-levels.mjs';

// The complex. role='index' → its bullish structure = risk-ON. role='inverse' → its
// bullish structure (SQQQ/VXX rising = hedges getting bid) = risk-OFF.
export const HEDGE_COMPLEX = [
  { ticker: 'QQQ', role: 'index', label: 'growth' },
  { ticker: 'SPXW', role: 'index', label: 'broad market' },
  { ticker: 'SOXX', role: 'index', label: 'semis' },
  { ticker: 'RUT', role: 'index', label: 'small caps' },
  { ticker: 'SQQQ', role: 'inverse', label: 'inverse-QQQ hedge' },
  { ticker: 'VXX', role: 'inverse', label: 'volatility' },
];

// Classify one component from its structure (king migration = our validated directional
// read). For an inverse/vol product the sign is flipped.
export function classifyHedge(structure, role) {
  const km = structure.gamma?.king_migration?.direction ?? 'unknown';
  const bull = km === 'up_bullish', bear = km === 'down_bearish';
  let risk = 'neutral';
  if (role === 'inverse') risk = bull ? 'off' : bear ? 'on' : 'neutral';
  else risk = bull ? 'on' : bear ? 'off' : 'neutral';
  return { risk, king_migration: km };
}

// Aggregate the components into a throttle: GREEN (press the bullish map), YELLOW
// (mixed — OTE pullbacks only, respect floors), RED (risk-off confluence — size down).
export function hedgeThrottle(components) {
  const off = components.filter((c) => c.risk === 'off').length;
  const on = components.filter((c) => c.risk === 'on').length;
  const n = components.length || 1;
  let throttle, note;
  if (off >= Math.ceil(n * 0.5)) { throttle = 'RED'; note = 'risk-off confluence — reduce high-beta long aggression, hedges are talking'; }
  else if (off >= 2) { throttle = 'YELLOW'; note = 'mixed backdrop — favor OTE pullbacks only, respect risk floors'; }
  else { throttle = 'GREEN'; note = 'bullish backdrop supports the single-name map'; }
  return { throttle, on, off, neutral: components.length - on - off, note };
}

// Live orchestrator: pull each component's structure and build the dashboard.
export async function buildHedgeDashboard(gexProvider, { date = null, historySessions = 12, hhmm = null } = {}) {
  const components = [];
  for (const c of HEDGE_COMPLEX) {
    try {
      const profile = await gexProvider.getProfile(c.ticker, date ? { date, hhmm } : {});
      if (!profile) { components.push({ ...c, risk: 'unknown', error: 'no-data' }); continue; }
      const history = await gexProvider.getHistory(c.ticker, { asOfDate: profile.asofDate || date, sessions: historySessions, hhmm });
      const structure = assembleStructure(profile, history);
      const cls = classifyHedge(structure, c.role);
      const lv = talonLevels(structure);
      components.push({ ...c, spot: structure.spot, risk: cls.risk, king_migration: cls.king_migration, ote: lv.ote, first_target: lv.first_target });
    } catch (e) {
      if (e.message === 'AUTH') throw e;
      components.push({ ...c, risk: 'unknown', error: String(e.message).slice(0, 40) });
    }
  }
  return { components, throttle: hedgeThrottle(components) };
}
