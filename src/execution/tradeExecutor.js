const { isInNewsBlackout } = require('../news/newsBlackout');
const { logEvent } = require('../logging/decisionLog');

/**
 * One TradeExecutor runs one strategy end-to-end. Tracks open contracts as a
 * Set (not a boolean) so it correctly recovers from a restart that left
 * positions open on Deriv's side. Can be stop()'d to remove a strategy
 * cleanly (e.g. discarded by the trial gate, or removed via the dashboard).
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
    this._stopped = false;
    this._tickHandler = null;
  }

  get hasOpenPosition() {
    return this.openContracts.size > 0;
  }

  async start() {
    if (!this._listenerRegistered) {
      this._tickHandler = async (msg) => {
        if (this._stopped) return;
        if (!msg.tick || msg.tick.symbol !== this.strategy.symbol) return;

        this.priceFeed.addTick(this.strategy.symbol, Number(msg.tick.quote));

        if (this.hasOpenPosition) return;

        const marketData = this.priceFeed.getMarketData(this.strategy.symbol);
        if (!marketData) return;

        const signal = this.strategy.signal(marketData);
        if (signal === 'hold') return;

        await this._tryEnterTrade(signal);
      };
      this.deriv.on('tick', this._tickHandler);
      this._listenerRegistered = true;
    }

    await this.deriv.subscribeTicks(this.strategy.symbol);
  }

  /** Stops taking new trades. Existing open positions still settle and get recorded. */
  stop() {
    this._stopped = true;
    if (this._tickHandler) this.deriv.off('tick', this._tickHandler);
    logEvent({ type: 'executor_stopped', strategyId: this.strategy.id });
  }

  async resumeTracking(contractId) {
    if (this.openContracts.has(contractId)) return;
    logEvent({ type: 'resumed_tracking_orphaned_contract', strategyId: this.strategy.id, contractId });
    this.openContracts.add(contractId);
    await this.deriv.subscribeContract(contractId);
    this._waitForSettlement(contractId);
  }

  async _tryEnterTrade(signal) {
    if (!this.riskManager.canTrade()) return;
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
      logEvent({ type: 'trade_opened', strategyId: this.strategy.id, contractId, signal, stake });

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
      const details = {
        entrySpot: poc.entry_spot !== undefined ? Number(poc.entry_spot) : null,
        exitSpot: poc.exit_spot !== undefined ? Number(poc.exit_spot) : (poc.sell_spot !== undefined ? Number(poc.sell_spot) : null),
        stake: poc.buy_price !== undefined ? Number(poc.buy_price) : null,
        contractType: poc.contract_type || null,
      };
      this.riskManager.recordTradeResult(pnl);
      this.trialManager.recordTrade(this.strategy.id, pnl, details);

      logEvent({ type: 'trade_closed', strategyId: this.strategy.id, contractId, pnl, ...details });

      this.openContracts.delete(contractId);
      this.deriv.off('proposal_open_contract', handler);
    };

    this.deriv.on('proposal_open_contract', handler);
  }
}

module.exports = TradeExecutor;
