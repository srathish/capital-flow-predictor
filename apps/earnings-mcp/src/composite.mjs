// composite.mjs — high-level research tools layered on top of the raw endpoint tools.
// These fan out across many UW endpoints and return a distilled evidence block so the
// connected Claude can synthesize a dossier without 10 round-trips.
import { z } from 'zod';
import { uw, rows, num, pct, $fmt, m$, sum, pxSeries, earningsReactions, todayISO, pool } from './uw.mjs';

const T = (t) => encodeURIComponent(String(t).toUpperCase().trim());
const text = (s) => ({ content: [{ type: 'text', text: s }] });
const soft = (p) => p.catch(() => null); // battery legs are best-effort; missing legs show as '—'

export function registerComposite(server) {
  server.registerTool(
    'research_ticker',
    {
      title: 'Full research battery (one ticker)',
      description:
        'Run the full UW research battery on one ticker in a single call: price trend, next earnings + implied move + past reaction history, IV rank, 5-day net flow + ask-side %, top flow alerts, dark pool blocks, max pain, dealer gamma walls, analyst targets, insiders. Returns a compact evidence block. Use this FIRST for any single-name workup; fall back to the raw endpoint tools for drill-downs.',
      inputSchema: { ticker: z.string().describe('Stock symbol, e.g. CRWD') },
    },
    async ({ ticker }) => {
      const t = T(ticker);
      const [ohlcJ, ivJ, ovJ, alertsJ, darkJ, mpJ, gexJ, ernJ, anJ, insJ] = await Promise.all([
        soft(uw(`/api/stock/${t}/ohlc/1d?limit=400`)),
        soft(uw(`/api/stock/${t}/iv-rank?limit=5`)),
        soft(uw(`/api/stock/${t}/options-volume?limit=10`)),
        soft(uw(`/api/stock/${t}/flow-alerts?limit=40`)),
        soft(uw(`/api/darkpool/${t}?limit=15`)),
        soft(uw(`/api/stock/${t}/max-pain`)),
        soft(uw(`/api/stock/${t}/greek-exposure/strike`)),
        soft(uw(`/api/earnings/${t}`)),
        soft(uw(`/api/screener/analysts?ticker=${t}`)),
        soft(uw(`/api/insider/${t}`)),
      ]);

      const px = pxSeries(ohlcJ);
      if (!px.length) return text(`No price data for ${ticker} — check the symbol.`);
      const last = px[px.length - 1];
      const chg = (n) => { const p = px.length > n ? px[px.length - 1 - n] : null; return p?.close ? last.close / p.close - 1 : null; };
      const hi20 = Math.max(...px.slice(-20).map((r) => num(r.high) ?? r.close));
      const lo20 = Math.min(...px.slice(-20).map((r) => num(r.low) ?? r.close));

      const ernRows = rows(ernJ);
      const today = last.date;
      const ernDates = ernRows.map((e) => String(e.report_date || e.date || '').slice(0, 10)).filter(Boolean).sort();
      const nextErn = ernDates.find((d) => d >= today) || null;
      const nextRow = ernRows.find((e) => String(e.report_date || e.date || '').slice(0, 10) === nextErn) || {};
      const reactions = earningsReactions(px, ernDates, today, 4).map((r) => r.move);
      const expMove = num(nextRow.expected_move) ?? num(nextRow.implied_move);

      const ivr = rows(ivJ).slice().sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1)).pop() || {};
      let ivRank = num(ivr.iv_rank_1y);
      if (ivRank != null && ivRank <= 1) ivRank *= 100;
      const rvol = num(ivr.volatility);

      const ov = rows(ovJ).map((r) => ({ ...r, date: String(r.date || '').slice(0, 10) })).filter((r) => r.date).sort((a, b) => (a.date < b.date ? -1 : 1));
      const ovLast = ov[ov.length - 1] || {};
      const w = ov.slice(-5);
      const callAsk = sum(w, (r) => num(r.call_volume_ask_side)), callBid = sum(w, (r) => num(r.call_volume_bid_side));
      const askPct = callAsk + callBid ? Math.round((callAsk / (callAsk + callBid)) * 100) : null;
      const net5 = sum(w, (r) => (num(r.net_call_premium) || 0) + (num(r.net_put_premium) || 0));
      const bull = num(ovLast.bullish_premium), bear = num(ovLast.bearish_premium);
      const callOI = num(ovLast.call_open_interest), putOI = num(ovLast.put_open_interest);

      const alerts = rows(alertsJ).map((a) => ({
        call: a.type === 'call', rule: a.alert_rule, strike: num(a.strike), expiry: String(a.expiry || '').slice(0, 10),
        prem: num(a.total_premium), ask: num(a.total_ask_side_prem), bid: num(a.total_bid_side_prem), sweep: !!a.has_sweep, floor: !!a.has_floor,
      })).sort((a, b) => (b.prem || 0) - (a.prem || 0));
      const callPrem = sum(alerts, (a) => (a.call ? a.prem : 0)), putPrem = sum(alerts, (a) => (a.call ? 0 : a.prem));

      const dark = rows(darkJ).map((d) => ({ prem: num(d.premium), price: num(d.price), size: num(d.size), when: String(d.executed_at || '').slice(0, 10) }))
        .sort((a, b) => (b.prem || 0) - (a.prem || 0)).slice(0, 5);
      const mp = rows(mpJ).map((r) => ({ expiry: String(r.expiry || '').slice(0, 10), pain: num(r.max_pain) })).filter((r) => r.expiry >= today).slice(0, 5);

      const gex = rows(gexJ).map((r) => ({ strike: num(r.strike), net: (num(r.call_gex) || 0) + (num(r.put_gex) || 0) }))
        .filter((r) => r.strike != null && r.strike > last.close * 0.7 && r.strike < last.close * 1.4);
      const callWall = gex.filter((r) => r.net > 0).sort((a, b) => b.net - a.net)[0];
      const putWall = gex.filter((r) => r.net < 0).sort((a, b) => a.net - b.net)[0];

      const analysts = rows(anJ).map((a) => ({ firm: a.firm, rec: a.recommendation, tgt: num(a.target), action: a.action, when: String(a.timestamp || '').slice(0, 10) }))
        .filter((a) => a.tgt).slice(0, 8);
      const tgts = analysts.map((a) => a.tgt).sort((x, y) => x - y);

      const dist = (lvl) => (lvl == null ? '' : ` (${pct(lvl / last.close - 1)})`);
      const L = [];
      L.push(`📟 research_ticker — ${ticker.toUpperCase()} · ${$fmt(last.close)} · ${last.date}`);
      L.push(`price     : 1d ${pct(chg(1))} · 5d ${pct(chg(5))} · 20d ${pct(chg(20))} · 20d range ${$fmt(lo20)}–${$fmt(hi20)}`);
      L.push(`catalyst  : next earnings ${nextErn || 'none scheduled'}${expMove ? ` · implied move ${$fmt(expMove)} (${pct(expMove / last.close)})` : ''}${reactions.length ? ` · last reactions ${reactions.map(pct).join(' / ')}` : ''}`);
      L.push(`IV regime : IV rank ${ivRank != null ? ivRank.toFixed(0) : '—'}${ivRank != null ? (ivRank < 35 ? ' (cheap → favors buying)' : ivRank > 65 ? ' (rich)' : ' (moderate)') : ''} · realized vol ${rvol != null ? (rvol * 100).toFixed(0) + '%' : '—'}`);
      L.push(`flow (5d) : net premium ${m$(net5)} · call ask-side ${askPct ?? '—'}% · today bull ${m$(bull)} vs bear ${m$(bear)}`);
      L.push(`alerts    : ${alerts.length} hits · call $ ${m$(callPrem)} vs put $ ${m$(putPrem)}`);
      for (const a of alerts.slice(0, 6)) L.push(`   • ${a.expiry} $${a.strike}${a.call ? 'C' : 'P'} ${m$(a.prem)} ${a.ask > a.bid ? 'ASK' : a.bid > a.ask ? 'bid' : 'mid'}${a.sweep ? ' sweep' : ''}${a.floor ? ' FLOOR' : ''} [${a.rule}]`);
      L.push(`OI        : calls ${callOI?.toLocaleString() || '—'} / puts ${putOI?.toLocaleString() || '—'}`);
      L.push(`dark pool : ${dark.map((d) => `${m$(d.prem)}@${$fmt(d.price)} ${d.when}`).join(' · ') || '—'}`);
      L.push(`dealer γ  : call-wall $${callWall?.strike ?? '—'}${dist(callWall?.strike)} · put-node $${putWall?.strike ?? '—'}${dist(putWall?.strike)}   [UW dealer-gamma]`);
      L.push(`max pain  : ${mp.map((r) => `${r.expiry} $${r.pain}`).join(' · ') || '—'}`);
      L.push(`analysts  : ${analysts.length} rated · targets ${tgts.length ? `$${tgts[0]}–$${tgts[tgts.length - 1]}` : '—'} vs spot ${$fmt(last.close)}`);
      L.push(`insiders  : ${rows(insJ).length} on file`);
      L.push('');
      L.push('CAVEATS: flow is a lean not proof (big premium can be a capped spread/collar — check multileg before calling it conviction). Dealer gamma here is UW-attributed, one data source. No live bid/ask — price exact spreads before entry.');
      return text(L.join('\n'));
    }
  );

  server.registerTool(
    'earnings_setup',
    {
      title: 'Earnings-potential setup (one ticker)',
      description:
        'Grade how explosive a ticker\'s upcoming earnings could be (the "next CRWD/CRM" check): next report date + implied move, the last 8 post-earnings reactions with dates, average absolute reaction vs current implied move (is the market underpricing the print?), IV rank (crush risk), and the 5-day flow lean into the event.',
      inputSchema: { ticker: z.string().describe('Stock symbol, e.g. CRM') },
    },
    async ({ ticker }) => {
      const t = T(ticker);
      const [ohlcJ, ernJ, ivJ, ovJ] = await Promise.all([
        soft(uw(`/api/stock/${t}/ohlc/1d?limit=600`)),
        soft(uw(`/api/earnings/${t}`)),
        soft(uw(`/api/stock/${t}/iv-rank?limit=5`)),
        soft(uw(`/api/stock/${t}/options-volume?limit=10`)),
      ]);
      const px = pxSeries(ohlcJ);
      if (!px.length) return text(`No price data for ${ticker}.`);
      const last = px[px.length - 1];
      const ernRows = rows(ernJ);
      const ernDates = ernRows.map((e) => String(e.report_date || e.date || '').slice(0, 10)).filter(Boolean).sort();
      const nextErn = ernDates.find((d) => d >= last.date) || null;
      const nextRow = ernRows.find((e) => String(e.report_date || e.date || '').slice(0, 10) === nextErn) || {};
      const expMove = num(nextRow.expected_move) ?? num(nextRow.implied_move);
      const expPct = expMove ? expMove / last.close : null;
      const reactions = earningsReactions(px, ernDates, last.date, 8);
      const avgAbs = reactions.length ? sum(reactions, (r) => Math.abs(r.move)) / reactions.length : null;
      // NOTE: UW actual_eps is GAAP while street_mean_est is adjusted — not comparable,
      // so no beat-rate here. Price reaction history is the signal that matters.

      const ivr = rows(ivJ).slice().sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1)).pop() || {};
      let ivRank = num(ivr.iv_rank_1y);
      if (ivRank != null && ivRank <= 1) ivRank *= 100;

      const ov = rows(ovJ).map((r) => ({ ...r, date: String(r.date || '').slice(0, 10) })).filter((r) => r.date).sort((a, b) => (a.date < b.date ? -1 : 1));
      const w = ov.slice(-5);
      const net5 = sum(w, (r) => (num(r.net_call_premium) || 0) + (num(r.net_put_premium) || 0));
      const callAsk = sum(w, (r) => num(r.call_volume_ask_side)), callBid = sum(w, (r) => num(r.call_volume_bid_side));
      const askPct = callAsk + callBid ? Math.round((callAsk / (callAsk + callBid)) * 100) : null;

      const L = [];
      L.push(`🎯 earnings_setup — ${ticker.toUpperCase()} · ${$fmt(last.close)} · ${last.date}`);
      L.push(`next report : ${nextErn || 'none scheduled'}${nextRow.report_time ? ` (${nextRow.report_time})` : ''}${expPct ? ` · implied move ${pct(expPct)}` : ''}`);
      L.push(`history     : ${reactions.length ? reactions.map((r) => `${r.date} ${pct(r.move)}`).join(' · ') : 'no reaction history in price window'}`);
      L.push(`avg |react| : ${avgAbs != null ? pct(avgAbs) : '—'}${avgAbs != null && expPct != null ? (avgAbs > expPct * 1.2 ? '  → history RUNS HOTTER than current implied (underpriced tail?)' : avgAbs < expPct * 0.8 ? '  → implied is RICH vs history (crush risk for buyers)' : '  → implied roughly fair vs history') : ''}`);
      L.push(`IV rank     : ${ivRank != null ? ivRank.toFixed(0) : '—'}${ivRank != null ? (ivRank < 35 ? ' (cheap)' : ivRank > 65 ? ' (rich — crush risk)' : ' (moderate)') : ''}`);
      L.push(`flow (5d)   : net premium ${m$(net5)} · call ask-side ${askPct ?? '—'}%`);
      L.push('');
      L.push('NOTE: a big historical reaction + cheap implied move is the asymmetry to look for; direction still needs its own thesis (use research_ticker + fundamentals).');
      return text(L.join('\n'));
    }
  );

  server.registerTool(
    'upcoming_earnings_calendar',
    {
      title: 'Upcoming earnings calendar',
      description:
        'List companies reporting earnings over the next N trading days (premarket + afterhours), with expected move and street estimates where available. Use this to build the week\'s earnings-watch list, then run earnings_setup on the interesting names.',
      inputSchema: {
        days_ahead: z.number().int().min(1).max(14).optional().describe('How many calendar days ahead to scan (default 7)'),
        limit_per_day: z.number().int().min(1).max(200).optional().describe('Max reporters listed per day/session (default 60)'),
      },
    },
    async ({ days_ahead = 7, limit_per_day = 60 }) => {
      const start = todayISO();
      const dates = [];
      for (let i = 0; i < days_ahead; i++) {
        const d = new Date(Date.parse(start + 'T12:00:00Z') + i * 86400e3);
        if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
        dates.push(d.toISOString().slice(0, 10));
      }
      const fetches = dates.flatMap((d) => [
        () => uw(`/api/earnings/premarket?date=${d}&limit=${limit_per_day}`).then((j) => ({ d, when: 'premarket', rows: rows(j) })),
        () => uw(`/api/earnings/afterhours?date=${d}&limit=${limit_per_day}`).then((j) => ({ d, when: 'afterhours', rows: rows(j) })),
      ]);
      const results = (await pool(fetches, 6)).filter(Boolean);
      const L = [`📅 earnings calendar — ${start} → +${days_ahead}d`];
      let total = 0;
      for (const d of dates) {
        const day = results.filter((r) => r.d === d);
        const entries = day.flatMap((r) =>
          r.rows.map((e) => {
            const sym = e.symbol || e.ticker;
            const emp = num(e.expected_move_perc);
            return { sym, when: r.when, emp, est: num(e.street_mean_est), cap: num(e.marketcap) };
          })
        ).filter((e) => e.sym);
        if (!entries.length) continue;
        entries.sort((a, b) => (b.emp || 0) - (a.emp || 0));
        total += entries.length;
        L.push(`\n${d} — ${entries.length} reporters`);
        for (const e of entries.slice(0, 25))
          L.push(`  ${e.sym.padEnd(6)} ${e.when === 'premarket' ? 'AM' : 'PM'}  implied ${e.emp != null ? pct(e.emp) : '—'}${e.est != null ? ` · est EPS ${e.est}` : ''}`);
        if (entries.length > 25) L.push(`  …and ${entries.length - 25} more (raise limit_per_day or query earnings_premarket/earnings_afterhours for the full list)`);
      }
      L.push(`\ntotal reporters found: ${total}. Next step: earnings_setup on the highest-implied-move liquid names.`);
      return text(L.join('\n'));
    }
  );

  server.registerTool(
    'post_earnings_movers',
    {
      title: 'Post-earnings movers scan',
      description:
        'Find which recent earnings reporters actually moved (the CRWD/CRM-after-the-print scan): pulls every company that reported on a date and computes the realized post-earnings price reaction, sorted by magnitude. Use for studying what worked and catching day-2 continuation candidates.',
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Report date YYYY-MM-DD (default: yesterday ET)'),
        min_move_pct: z.number().optional().describe('Only show absolute reactions above this percent (default 4)'),
        max_tickers: z.number().int().min(5).max(80).optional().describe('Cap on reporters to price-check, ranked by implied move (default 40)'),
      },
    },
    async ({ date, min_move_pct = 4, max_tickers = 40 }) => {
      const d = date || new Date(Date.parse(todayISO() + 'T12:00:00Z') - 86400e3).toISOString().slice(0, 10);
      const [pm, ah] = await Promise.all([
        soft(uw(`/api/earnings/premarket?date=${d}&limit=200`)),
        soft(uw(`/api/earnings/afterhours?date=${d}&limit=200`)),
      ]);
      const reporters = [...rows(pm).map((e) => ({ ...e, when: 'premarket' })), ...rows(ah).map((e) => ({ ...e, when: 'afterhours' }))]
        .map((e) => ({ sym: e.symbol || e.ticker, when: e.when, emp: num(e.expected_move_perc) }))
        .filter((e) => e.sym);
      if (!reporters.length) return text(`No earnings reporters found for ${d}.`);
      reporters.sort((a, b) => (b.emp || 0) - (a.emp || 0));
      const check = reporters.slice(0, max_tickers);

      const moves = await pool(
        check.map((e) => async () => {
          const px = pxSeries(await uw(`/api/stock/${encodeURIComponent(e.sym)}/ohlc/1d?limit=8`));
          const i = px.findIndex((r) => r.date >= d);
          if (i < 1) return null;
          const a = px[i - 1]?.close, b = px[i]?.close, c = px[i + 1]?.close;
          if (!a) return null;
          const r1 = b ? b / a - 1 : 0, r2 = b && c ? c / b - 1 : 0;
          const move = Math.abs(r2) > Math.abs(r1) ? r2 : r1;
          return { ...e, move };
        }),
        8
      );
      const hits = moves.filter(Boolean).filter((e) => Math.abs(e.move) * 100 >= min_move_pct).sort((a, b) => Math.abs(b.move) - Math.abs(a.move));
      const L = [`💥 post-earnings movers — reported ${d} (checked top ${check.length}/${reporters.length} by implied move)`];
      for (const e of hits) L.push(`  ${e.sym.padEnd(6)} ${pct(e.move)}  (${e.when}${e.emp != null ? `, implied was ${pct(e.emp)}` : ''}${e.emp != null && Math.abs(e.move) > Math.abs(e.emp) ? ' → BEAT the implied move' : ''})`);
      if (!hits.length) L.push(`  none above ${min_move_pct}% among the checked names`);
      L.push(`\nNext step: research_ticker on movers that beat their implied move — day-2 continuation vs fade needs flow + structure.`);
      return text(L.join('\n'));
    }
  );

  server.registerTool(
    'flow_conviction_check',
    {
      title: 'Flow conviction check (one ticker)',
      description:
        'Verify whether the options flow behind a name is genuine directional conviction before picking strikes: ask-side vs bid-side split over 5 days, top flow alerts with sweep/floor flags, and open-interest changes confirming positions are OPENING (OI growing) rather than closing. Big premium that is really a capped spread or collar gets flagged as a caveat, not conviction.',
      inputSchema: { ticker: z.string().describe('Stock symbol') },
    },
    async ({ ticker }) => {
      const t = T(ticker);
      const [ovJ, alertsJ, oiJ] = await Promise.all([
        soft(uw(`/api/stock/${t}/options-volume?limit=10`)),
        soft(uw(`/api/stock/${t}/flow-alerts?limit=40`)),
        soft(uw(`/api/stock/${t}/oi-change?limit=25`)),
      ]);
      const ov = rows(ovJ).map((r) => ({ ...r, date: String(r.date || '').slice(0, 10) })).filter((r) => r.date).sort((a, b) => (a.date < b.date ? -1 : 1));
      const w = ov.slice(-5);
      const callAsk = sum(w, (r) => num(r.call_volume_ask_side)), callBid = sum(w, (r) => num(r.call_volume_bid_side));
      const putAsk = sum(w, (r) => num(r.put_volume_ask_side)), putBid = sum(w, (r) => num(r.put_volume_bid_side));
      const net5 = sum(w, (r) => (num(r.net_call_premium) || 0) + (num(r.net_put_premium) || 0));

      const alerts = rows(alertsJ).map((a) => ({
        call: a.type === 'call', strike: num(a.strike), expiry: String(a.expiry || '').slice(0, 10), rule: a.alert_rule,
        prem: num(a.total_premium), ask: num(a.total_ask_side_prem), bid: num(a.total_bid_side_prem),
        sweep: !!a.has_sweep, floor: !!a.has_floor, multi: !!a.has_multileg || !!a.has_singleleg === false,
        volOiRatio: num(a.volume_oi_ratio),
      })).sort((a, b) => (b.prem || 0) - (a.prem || 0)).slice(0, 10);

      const oi = rows(oiJ).map((r) => ({
        id: r.option_symbol || r.option_chain_id || `${r.strike}${r.option_type?.[0] || ''} ${String(r.expiry || '').slice(0, 10)}`,
        chg: num(r.last_oi_diff_plain) ?? num(r.oi_diff_plain) ?? num(r.oi_change) ?? num(r.diff),
      })).filter((r) => r.chg != null).sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg)).slice(0, 8);

      const L = [];
      L.push(`🔍 flow_conviction_check — ${ticker.toUpperCase()}`);
      L.push(`5d split : calls ${callAsk + callBid ? Math.round((callAsk / (callAsk + callBid)) * 100) + '% ask-side' : '—'} · puts ${putAsk + putBid ? Math.round((putAsk / (putAsk + putBid)) * 100) + '% ask-side' : '—'} · net premium ${m$(net5)}`);
      L.push(`alerts   :`);
      for (const a of alerts)
        L.push(`   • ${a.expiry} $${a.strike}${a.call ? 'C' : 'P'} ${m$(a.prem)} ${a.ask > a.bid ? 'ASK' : a.bid > a.ask ? 'BID' : 'mid'}${a.sweep ? ' sweep' : ''}${a.floor ? ' FLOOR' : ''}${a.volOiRatio != null && a.volOiRatio > 1 ? ' vol>OI(opening)' : ''} [${a.rule}]`);
      L.push(`OI moves : ${oi.map((r) => `${r.id} ${r.chg > 0 ? '+' : ''}${r.chg.toLocaleString()}`).join(' · ') || 'no OI-change data'}`);
      L.push('');
      L.push('VERDICT GUIDE: conviction = ask-side dominant + sweeps + vol>OI + next-day OI GROWTH at those strikes. If the biggest prints pair a call buy with a call sell at a higher strike, it is a capped spread — supporting evidence only, never the thesis.');
      return text(L.join('\n'));
    }
  );
}
