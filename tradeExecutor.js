const { isInNewsBlackout } = require('../news/newsBlackout');
const { logEvent } = require('../logging/decisionLog');

/**
 * One TradeExecutor runs one strategy end-to-end: listens to ticks for its
 * symbol, feeds them through the price feed's indicators, asks the strategy
 * for a signal, and — if conditions allow — places and tracks a real trade.
 *
 * Deliberately allows only ONE open position per strategy at a time. Running
 * several strategies just means several TradeExecutor instances, each with
 * its own open-position flag, so they don't block each other.
 */
class TradeExecutor {
  constructor({ strategy, deriv, priceFeed, riskManager, trialManager, defaultStake }) {
    this.strategy = strategy;
    this.deriv = deriv;
    this.priceFeed = priceFeed;
    this.riskManager = riskManager;
    this.trialManager = trialManager;
    this.defaultStake = defaultStake;
    this.hasOpenPosition = false;
  }

  async start() {
    await this.deriv.subscribeTicks(this.strategy.symbol);

    this.deriv.on('tick', async (msg) => {
      if (!msg.tick || msg.tick.symbol !== this.strategy.symbol) return;

      this.priceFeed.addTick(this.strategy.symbol, Number(msg.tick.quote));

      if (this.hasOpenPosition) return; // one open trade at a time per strategy

      const marketData = this.priceFeed.getMarketData(this.strategy.symbol);
      if (!marketData) return; // not enough price history yet

      const signal = this.strategy.signal(marketData);
      if (signal === 'hold') return;

      await this._tryEnterTrade(signal);
    });
  }

  async _tryEnterTrade(signal) {
    if (!this.riskManager.canTrade()) {
      return; // halted, or daily loss limit hit
    }
    if (await isInNewsBlackout(this.strategy.symbol)) {
      logEvent({ type: 'trade_skipped_news_blackout', strategyId: this.strategy.id });
      return;
    }

    const stake = this.riskManager.getPositionSize();
    if (stake <= 0) return; // no allowance left today

    try {
      this.hasOpenPosition = true;

      const contractType = signal === 'buy' ? 'CALL' : 'PUT';
      const proposalRes = await this.deriv.getProposal({
        contract_type: contractType,
        symbol: this.strategy.symbol,
        amount: stake,
        basis: 'stake',
        duration: 5,
        duration_unit: 'm',
        currency: 'USD',
      });

      const proposal = proposalRes.proposal;
      const buyRes = await this.deriv.buyContract(proposal.id, proposal.ask_price);
      const contractId = buyRes.buy.contract_id;

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
      this.hasOpenPosition = false;
    }
  }

  _waitForSettlement(contractId) {
    const handler = (msg) => {
      const poc = msg.proposal_open_contract;
      if (!poc || poc.contract_id !== contractId) return;
      if (!poc.is_sold) return; // still open, keep listening

      const pnl = Number(poc.profit);
      this.riskManager.recordTradeResult(pnl);
      this.trialManager.recordTrade(this.strategy.id, pnl);

      logEvent({
        type: 'trade_closed',
        strategyId: this.strategy.id,
        contractId,
        pnl,
      });

      this.hasOpenPosition = false;
      this.deriv.off('proposal_open_contract', handler);
    };

    this.deriv.on('proposal_open_contract', handler);
  }
}

module.exports = TradeExecutor;
