const { sendWhatsAppMessage } = require('./whatsapp');

/**
 * One digest per day covering everything you'd want to know without
 * watching the logs: per-strategy trade counts/wins/losses/win rate today,
 * each strategy's overall progress toward the promotion gate, and the
 * account's risk status (today's loss vs the daily cap).
 */
function buildDailySummary({ trialManager, riskManager }) {
  const lines = [`📊 Daily trading summary — ${new Date().toDateString()}`, ''];

  for (const trial of trialManager.trials.values()) {
    const today = trial.todaysTrades();
    const winsToday = today.filter((t) => t.pnl > 0).length;
    const lossesToday = today.filter((t) => t.pnl <= 0).length;

    lines.push(`Strategy: ${trial.strategyId} (${trial.status})`);
    lines.push(`  Today: ${today.length} trades — ${winsToday} won, ${lossesToday} lost`);
    lines.push(
      `  Overall: ${trial.tradeCount} trades, ${trial.winRatePct.toFixed(1)}% win rate, ` +
        `profit factor ${trial.profitFactor === Infinity ? '∞' : trial.profitFactor.toFixed(2)}`
    );
    lines.push(
      `  Progress to promotion gate: ${trial.tradeCount}/40 trades, ` +
        `drawdown ${trial.drawdownPct.toFixed(1)}%`
    );
    lines.push('');
  }

  lines.push(`Account balance: $${riskManager.balance.toFixed(2)}`);
  lines.push(
    `Today's loss: $${riskManager.todaysLoss().toFixed(2)} (daily cap applies once set)`
  );
  lines.push(`Trading halted: ${riskManager.halted ? 'YES — manual resume needed' : 'No'}`);

  return lines.join('\n');
}

function scheduleDailySummary({ trialManager, riskManager }) {
  const send = () => sendWhatsAppMessage(buildDailySummary({ trialManager, riskManager }));
  send(); // one immediately on startup so you know it's alive
  setInterval(send, 24 * 60 * 60 * 1000);
}

module.exports = { buildDailySummary, scheduleDailySummary };
