const { DigitWindow } = require('../market/digitWindow');
const { pickBestBarrier, pickTargetDigit, computeEvenOddSkew } = require('../strategies/adaptiveDigitHelpers');
const { logEvent } = require('../logging/decisionLog');

/**
 * Executes an "adaptive" digit strategy — unlike DigitPatternExecutor
 * (fixed barrier/trigger digits set at creation), this one recalculates
 * which barrier/digit/side currently has the best edge on every tick, and
 * trades that. No trigger-digit/reset-digit state machine — it evaluates
 * continuously and trades whenever the live data clears the edge bar.
 */
class AdaptiveDigitExecutor {
  constructor({ definition, deriv, riskManager, trialManager }) {
    this.def = definition;
    this.strategy = { id: definition.id, symbol: definition.symbol };
    this.deriv = deriv;
    this.riskManager = riskManager;
    this.trialManager = trialManager;

    this.window = new DigitWindow(1000);
    this.openContracts = new Set();
    this.consecutiveLosses = 0;
    this._stopped = false;
    this._listenerRegistered = false;
    this._tickHandler = null;
  }

  get hasOpenPosition() {
    return this.openContracts.size > 0;
  }

  async start() {
    if (!this._listenerRegistered) {
      this._tickHandler = async (msg) => {
        if (this._stopped) return;
        if (!msg.tick || msg.tick.symbol !== this.def.symbol) return;
        await this._onTick(Number(msg.tick.quote));
      };
      this.deriv.on('tick', this._tickHandler);
      this._listenerRegistered = true;
    }
    await this.deriv.subscribeTicks(this.def.symbol);
  }

  stop() {
    this._stopped = true;
    if (this._tickHandler) this.deriv.off('tick', this._tickHandler);
    logEvent({ type: 'executor_stopped', strategyId: this.def.id });
  }

  async resumeTracking(contractId) {
    if (this.openContracts.has(contractId)) return;
    this.openContracts.add(contractId);
    await this.deriv.subscribeContract(contractId);
    this._waitForSettlement(contractId);
  }

  async _onTick(price) {
    this.window.push(price);
    if (this.window.size < 200) return; // need a meaningful live sample before trusting it
    if (this.hasOpenPosition) return;
    if (!this.riskManager.canTrade()) return;

    const stats = this.window.computeRanks();
    const minEdgePct = this.def.minEdgePct || (this.def.mode === 'even-odd' ? 5 : 3);
    let plan = null;

    if (this.def.mode === 'over-under') {
      const result = pickBestBarrier(this.def.direction, stats, minEdgePct);
      if (result) plan = { contractType: this.def.direction, barrier: result.barrier, meta: result };
    } else if (this.def.mode === 'matches-differs') {
      const result = pickTargetDigit(this.def.targetSelection || 'coldest', stats, minEdgePct);
      if (result) plan = { contractType: this.def.direction, barrier: result.digit, meta: result };
    } else if (this.def.mode === 'even-odd') {
      const result = computeEvenOddSkew(stats);
      if (result.skew >= minEdgePct) {
        const biasMode = this.def.biasMode || 'reversion';
        const side = biasMode === 'reversion' ? result.lessFrequentSide : (result.lessFrequentSide === 'even' ? 'odd' : 'even');
        plan = { contractType: side === 'even' ? 'DIGITEVEN' : 'DIGITODD', barrier: null, meta: result };
      }
    }

    if (!plan) return;
    await this._tryEnterTrade(plan);
  }

  async _tryEnterTrade(plan) {
    const stake = this.riskManager.getPositionSize();
    if (stake <= 0) return;

    try {
      const proposalParams = {
        contract_type: plan.contractType,
        underlying_symbol: this.def.symbol,
        amount: stake,
        basis: 'stake',
        duration: this.def.durationTicks || 1,
        duration_unit: 't',
        currency: 'USD',
      };
      if (plan.barrier !== null && plan.barrier !== undefined) {
        proposalParams.barrier = String(plan.barrier);
      }

      const proposalRes = await this.deriv.getProposal(proposalParams);
      const proposal = proposalRes.proposal;
      const buyRes = await this.deriv.buyContract(proposal.id, proposal.ask_price);
      const contractId = buyRes.buy.contract_id;

      this.openContracts.add(contractId);
      logEvent({
        type: 'trade_opened', strategyId: this.def.id, contractId, stake,
        contractType: plan.contractType, barrier: plan.barrier, edgeMeta: plan.meta,
      });

      await this.deriv.subscribeContract(contractId);
      this._waitForSettlement(contractId);
    } catch (err) {
      logEvent({ type: 'trade_entry_failed', strategyId: this.def.id, error: err });
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
      this.trialManager.recordTrade(this.def.id, pnl, details);

      if (pnl > 0) {
        this.consecutiveLosses = 0;
      } else {
        this.consecutiveLosses++;
        if (this.def.maxConsecutiveLosses && this.consecutiveLosses >= this.def.maxConsecutiveLosses) {
          logEvent({ type: 'pattern_circuit_breaker_tripped', strategyId: this.def.id, consecutiveLosses: this.consecutiveLosses });
          this.stop();
        }
      }

      logEvent({ type: 'trade_closed', strategyId: this.def.id, contractId, pnl, consecutiveLosses: this.consecutiveLosses, ...details });

      this.openContracts.delete(contractId);
      this.deriv.off('proposal_open_contract', handler);
    };

    this.deriv.on('proposal_open_contract', handler);
  }
}

module.exports = AdaptiveDigitExecutor;
          
