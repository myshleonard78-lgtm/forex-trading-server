const { logEvent } = require('../logging/decisionLog');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const configured = Boolean(SUPABASE_URL && SUPABASE_KEY);

if (!configured) {
  console.log('No SUPABASE_URL/SUPABASE_KEY set — trial progress will NOT survive restarts.');
}

async function rest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${options.method || 'GET'} ${path} failed: ${res.status} ${body}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function saveStrategy({ id, kind, definition, status = 'active' }) {
  if (!configured) return;
  try {
    await rest('bot_strategies', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id, kind, definition, status }),
    });
  } catch (err) {
    logEvent({ type: 'persistence_save_strategy_failed', error: String(err) });
  }
}

async function markStrategyStatus(id, status) {
  if (!configured) return;
  try {
    await rest(`bot_strategies?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status }),
    });
  } catch (err) {
    logEvent({ type: 'persistence_update_strategy_failed', error: String(err) });
  }
}

async function loadActiveStrategies() {
  if (!configured) return [];
  try {
    return (await rest('bot_strategies?status=eq.active&select=*')) || [];
  } catch (err) {
    logEvent({ type: 'persistence_load_strategies_failed', error: String(err) });
    return [];
  }
}

async function saveTrade(strategyId, pnl, details = {}) {
  if (!configured) return;
  try {
    await rest('bot_trades', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        strategy_id: strategyId,
        pnl,
        entry_spot: details.entrySpot ?? null,
        exit_spot: details.exitSpot ?? null,
        stake: details.stake ?? null,
        contract_type: details.contractType ?? null,
      }),
    });
  } catch (err) {
    logEvent({ type: 'persistence_save_trade_failed', error: String(err) });
  }
}

async function loadTrades(strategyId) {
  if (!configured) return [];
  try {
    return (await rest(`bot_trades?strategy_id=eq.${encodeURIComponent(strategyId)}&select=*&order=created_at.asc`)) || [];
  } catch (err) {
    logEvent({ type: 'persistence_load_trades_failed', error: String(err) });
    return [];
  }
}

module.exports = { configured, saveStrategy, markStrategyStatus, loadActiveStrategies, saveTrade, loadTrades };
  
