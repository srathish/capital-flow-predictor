// stage4-report.mjs — Output. Writes data/plans/{date}_plans.json (all cards +
// validation) and a human-readable markdown report; optional Discord webhook.
// Each tradable line is a buyable instruction with a deterministic $ size.
import path from 'node:path';
import fs from 'node:fs';
import { writeJson, resolveFromRoot, ensureDir } from './lib/util.mjs';

const money = (x) => (x == null ? '—' : `$${Math.round(x).toLocaleString('en-US')}`);
const px = (x) => (x == null ? '—' : (+x).toLocaleString('en-US', { maximumFractionDigits: 2 }));

export function assemblePlans({ runDate, requestedDate, expiry, scanOut, cards, gateSummary, circuitBroken, config }) {
  const okCards = cards.filter((c) => c.status === 'ok');
  const directional = okCards.filter((c) => c.plan.direction !== 'no_trade');
  const tradable = directional.filter((c) => !c.vetoed);
  return {
    runDate, requestedDate, expiry,
    target_is_monthly_opex: scanOut?.target_is_monthly_opex ?? null,
    generatedAt: new Date().toISOString(),
    invalidation_basis: config.invalidation_basis,
    stats: {
      cards: cards.length, ok: okCards.length, discarded: cards.length - okCards.length,
      directional: directional.length, tradable: tradable.length,
      no_trade: okCards.filter((c) => c.plan.direction === 'no_trade').length,
      ...(gateSummary || {}), circuit_broken: !!circuitBroken,
    },
    scan_file: scanOut ? `${runDate}_scan.json` : null,
    cards: cards.map((c) => ({
      ticker: c.ticker, status: c.status, attempts: c.attempts,
      flow_through_score: c.flow_through_score,
      plan: c.plan || null,
      final_confidence: c.final_confidence ?? (c.plan ? c.plan.confidence : null),
      sizing_budget_usd: c.sizing_budget_usd ?? (c.deterministic ? c.deterministic.sizing_budget_usd : null),
      vetoed: !!c.vetoed,
      validation: c.validation || null,
      deterministic: c.deterministic || null,
      errors: c.errors || null,
      snapshot: c.snapshot || null,
    })),
  };
}

export function writePlans(plans, config) {
  const file = resolveFromRoot(path.join(config.planner.plans_dir, `${plans.runDate}_plans.json`));
  writeJson(file, plans);
  return file;
}

function cardLine(c) {
  const p = c.plan;
  const dir = p.direction.toUpperCase();
  const oc = p.contract;
  const flow = c.validation ? c.validation.state : 'n/a';
  const lines = [];
  lines.push(`### ${c.ticker} — ${dir} · confidence ${c.final_confidence}/5 · flow: ${flow} · size ${money(c.sizing_budget_usd)}`);
  lines.push(`**BUY ${oc.expiry} $${px(oc.strike)} ${oc.type.toUpperCase()}** (~${money(c.sizing_budget_usd)} premium)`);
  const runner = p.runner_target != null ? ` (runner ${px(p.runner_target)})` : '';
  lines.push(`- entry ${px(p.entry_trigger)} → target ${px(p.target)}${runner} · stop **close <${px(p.invalidation)}** · time-stop ${p.time_stop}d`);
  if (c.snapshot?.magnet) lines.push(`- magnet ${c.snapshot.magnet.strike} (${c.snapshot.magnet.signed_gex_millions}M ${c.snapshot.magnet.sign}) · persistence ${c.snapshot.persistence?.consecutive_sessions_as_top_node ?? 0}d · score ${(+c.flow_through_score).toFixed(4)}`);
  lines.push(`- thesis: ${p.thesis}`);
  if (p.structural_risks?.length) lines.push(`- ⚠ ${p.structural_risks.join(' · ')}`);
  if (c.validation && c.validation.checks && c.validation.checks.in_direction_percentile != null) {
    const v = c.validation.checks;
    lines.push(`- flow: in-dir premium ${money(v.in_direction_premium)} (pct ${(v.in_direction_percentile * 100).toFixed(0)}) · opp ${money(v.opposing_premium)} (pct ${v.opposing_percentile == null ? '—' : (v.opposing_percentile * 100).toFixed(0)})${c.validation.flags.length ? ' · ' + c.validation.flags.join(', ') : ''}`);
  }
  return lines.join('\n');
}

export function renderMarkdown(plans) {
  const s = plans.stats;
  const opex = plans.target_is_monthly_opex ? ' · monthly OPEX' : '';
  const out = [];
  out.push(`# GEX Node Scanner — ${plans.runDate}${plans.expiry ? ` → ${plans.expiry}${opex}` : ''}`);
  out.push(`_generated ${plans.generatedAt} · ${s.tradable} tradable / ${s.directional} directional · ${s.confirmed ?? 0} confirmed, ${s.neutral ?? 0} neutral, ${s.contradicted ?? 0} vetoed · ${s.no_trade} no-trade · ${s.discarded} discarded · invalidation basis: ${plans.invalidation_basis}_`);
  if (s.circuit_broken) out.push(`\n> ⛔ **CIRCUIT BREAKER TRIPPED** — >50% of plans failed schema validation. Treat this run as unreliable.`);

  const dirCards = plans.cards.filter((c) => c.status === 'ok' && c.plan && c.plan.direction !== 'no_trade');
  const tradable = dirCards.filter((c) => !c.vetoed).sort((a, b) => (b.final_confidence - a.final_confidence) || (b.flow_through_score - a.flow_through_score));
  const vetoed = dirCards.filter((c) => c.vetoed);

  out.push(`\n## 🎯 Tradable cards (${tradable.length})`);
  if (!tradable.length) out.push('_none_');
  for (const c of tradable) out.push('\n' + cardLine(c));

  if (vetoed.length) {
    out.push(`\n## ❌ Vetoed by flow — do NOT trade (${vetoed.length})`);
    for (const c of vetoed) out.push(`- **${c.ticker}** ${c.plan.direction} ${c.plan.contract.expiry} $${px(c.plan.contract.strike)} ${c.plan.contract.type}: opposing flow ${money(c.validation?.checks?.opposing_premium)} (pct ${c.validation?.checks?.opposing_percentile == null ? '—' : (c.validation.checks.opposing_percentile * 100).toFixed(0)})`);
  }
  const noTrade = plans.cards.filter((c) => c.status === 'ok' && c.plan && c.plan.direction === 'no_trade');
  if (noTrade.length) out.push(`\n## ⏸ No-trade (${noTrade.length}): ${noTrade.map((c) => c.ticker).join(', ')}`);
  const disc = plans.cards.filter((c) => c.status !== 'ok');
  if (disc.length) out.push(`\n## 🗑 Discarded (schema, ${disc.length}): ${disc.map((c) => c.ticker).join(', ')}`);
  return out.join('\n') + '\n';
}

export function writeReport(plans, config) {
  const md = renderMarkdown(plans);
  const file = resolveFromRoot(path.join(config.output.reports_dir, `${plans.runDate}_report.md`));
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, md);
  return { file, md };
}

export function discordSummary(plans) {
  const s = plans.stats;
  const tradable = plans.cards.filter((c) => c.status === 'ok' && c.plan && c.plan.direction !== 'no_trade' && !c.vetoed)
    .sort((a, b) => b.final_confidence - a.final_confidence).slice(0, 8);
  const head = `**GEX Node Scanner ${plans.runDate}${plans.expiry ? ` → ${plans.expiry}` : ''}** — ${s.tradable} tradable (${s.confirmed ?? 0} confirmed, ${s.neutral ?? 0} neutral)`;
  const lines = tradable.map((c) => `${c.plan.direction === 'long' ? '🟢' : '🔴'} **${c.ticker}** ${c.plan.contract.expiry} $${px(c.plan.contract.strike)}${c.plan.contract.type[0].toUpperCase()} · ${money(c.sizing_budget_usd)} · ${px(c.plan.entry_trigger)}→${px(c.plan.target)} stop<${px(c.plan.invalidation)} · ${c.final_confidence}/5 ${c.validation?.state ?? ''}`);
  return [head, ...lines].join('\n');
}

export async function postDiscord(webhook, content) {
  if (!webhook) return false;
  try {
    await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: content.slice(0, 1900) }), signal: AbortSignal.timeout(10000) });
    return true;
  } catch { return false; }
}
