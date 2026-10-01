// Pick the real contract and read its real price. Skylit expirations → option_chain (date= for replay).
import { expirations, optionChain } from '../feeds/skylit.js';

const CHAIN_TICKER = { SPXW: ['SPXW', 'SPX'], SPX: ['SPX', 'SPXW'], SPY: ['SPY'], QQQ: ['QQQ'] };

export async function pickContract({ symbol, direction, spot, date }) {
  const tickers = CHAIN_TICKER[symbol] ?? [symbol];
  for (const tk of tickers) {
    try {
      const ex = await expirations(tk, date);
      const list = (ex?.data || []).slice().sort((a, b) => a.dte - b.dte);
      const exp = list.find((e) => e.dte === 0) || list[0];
      if (!exp) continue;
      const oc = await optionChain(tk, exp.expiration, date);
      const strikes = oc?.data?.strikes || [];
      if (!strikes.length) continue;
      const type = direction === 'up' ? 'call' : 'put';
      const sorted = strikes.map((s) => s.strike).sort((a, b) => a - b);
      const k = type === 'put' ? sorted.filter((s) => s <= spot).slice(-1)[0] ?? sorted[0] : sorted.find((s) => s >= spot) ?? sorted[sorted.length - 1];
      const row = strikes.find((s) => s.strike === k);
      return { ticker: tk, expiration: exp.expiration, dte: exp.dte, type, strike: k, last: type === 'call' ? row.callLastPrice : row.putLastPrice, iv: type === 'call' ? row.callIv : row.putIv, oi: type === 'call' ? row.callOi : row.putOi, volume: type === 'call' ? row.callVolume : row.putVolume, underlying: oc.data.underlyingPrice, maxPain: oc.data.maxPain };
    } catch (e) { /* try next ticker */ }
  }
  return null;
}
