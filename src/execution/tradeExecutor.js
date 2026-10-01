const { isInNewsBlackout } = require('../news/newsBlackout');
const { logEvent } = require('../logging/decisionLog');

/**
 * One TradeExecutor runs one strategy end-to-end.
 *
 * Tracks open contracts as a Set rather than a single boolean — this lets it
 * correctly recover from a restart that left multiple orphaned positions
 * open on Deriv's side (every redeploy restarts the process, which forgets
 * any in-flight trade even though it's still open on Deriv's books). Each
 * orphan gets tracked to settlement and properly recorded; new entries stay
 * blocked until ALL open contracts for this strategy have cleared.
 */
class TradeExecutor {
  constructor({ strategy, deriv, priceFeed, riskManager, trialManager, defaultStake }) {
    this.strategy = strategy;
    this.deriv = deriv;
    this.priceFeed = priceFeed;
    this.riskManager = riskManager;
    this.trialManager = trialManager;
    this.defaultStake = defaultStake;
    this.openContracts = new Set();
    this._listenerRegistered = false;
  }

  get hasOpenPosition() {
    return this.openContracts.size > 0;
  }

  async start() {
    if (!this._listenerRegistered) {
      this.deriv.on('tick', async (msg) => {
        if (!msg.tick || msg.tick.symbol !== this.strategy.symbol) return;

        this.priceFeed.addTick(this.strategy.symbol, Number(msg.tick.quote));

        if (this.hasOpenPosition) return;

        const marketData = this.priceFeed.getMarketData(this.strategy.symbol);
        if (!marketData) return;

        const signal = this.strategy.signal(marketData);
        if (signal === 'hold') return;

        await this._tryEnterTrade(signal);
      });
      this._listenerRegistered = true;
    }

    await this.deriv.subscribeTicks(this.strategy.symbol);
  }

  /**
   * Resume tracking a contract that was already open before this process
   * started (e.g. still open from before a redeploy). Safe to call for a
   * contract already being tracked — it's a no-op in that case.
   */
  async resumeTracking(contractId) {
    if (this.openContracts.has(contractId)) return;
    logEvent({ type: 'resumed_tracking_orphaned_contract', strategyId: this.strategy.id, contractId });
    this.openContracts.add(contractId);
    await this.deriv.subscribeContract(contractId);
    this._waitForSettlement(contractId);
  }

  async _tryEnterTrade(signal) {
    if (!this.riskManager.canTrade()) {
      return;
    }
    if (await isInNewsBlackout(this.strategy.symbol)) {
      logEvent({ type: 'trade_skipped_news_blackout', strategyId: this.strategy.id });
      return;
    }

    const stake = this.riskManager.getPositionSize();
    if (stake <= 0) return;

    try {
      const contractType = signal === 'buy' ? 'CALL' : 'PUT';
      const proposalRes = await this.deriv.getProposal({
        contract_type: contractType,
        underlying_symbol: this.strategy.symbol,
        amount: stake,
        basis: 'stake',
        duration: 5,
        duration_unit: 'm',
        currency: 'USD',
      });

      const proposal = proposalRes.proposal;
      const buyRes = await this.deriv.buyContract(proposal.id, proposal.ask_price);
      const contractId = buyRes.buy.contract_id;

      this.openContracts.add(contractId);

      logEvent({
        type: 'trade_opened',
        strategyId: this.strategy.id,
        contractId,
        signal,
        stake,
      });

      await this.deriv.subscribeContract(contractId);
      this._waitForSettlement(contractId);
    } catch (err) {
      logEvent({ type: 'trade_entry_failed', strategyId: this.strategy.id, error: err });
    }
  }

  _waitForSettlement(contractId) {
    const handler = (msg) => {
      const poc = msg.proposal_open_contract;
      if (!poc || poc.contract_id !== contractId) return;
      if (!poc.is_sold) return;

      const pnl = Number(poc.profit);
      this.riskManager.recordTradeResult(pnl);
      this.trialManager.recordTrade(this.strategy.id, pnl);

      logEvent({
        type: 'trade_closed',
        strategyId: this.strategy.id,
        contractId,
        pnl,
      });

      this.openContracts.delete(contractId);
      this.deriv.off('proposal_open_contract', handler);
    };

    this.deriv.on('proposal_open_contract', handler);
  }
}

module.exports = TradeExecutor;
