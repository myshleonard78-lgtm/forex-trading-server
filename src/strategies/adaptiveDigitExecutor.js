const { DigitWindow } = require('../market/digitWindow');
const { pickBestBarrier, pickTargetDigit, computeEvenOddSkew, computeGroupSkew } = require('../strategies/adaptiveDigitHelpers');
const { logEvent } = require('../logging/decisionLog');

/**
 * Executes an "adaptive" digit strategy — recalculates which barrier/digit/
 * side currently has the best edge on every tick, and trades that.
 *
 * mode:
 *  - 'over-under'       : scans every candidate barrier, trades whichever
 *                          currently gives the best edge
 *  - 'over-under-group' : splits into Under(0-4)/Over(5-9) groups; once one
 *                          side's share crosses groupThresholdPct, trades a
 *                          FIXED barrier (def.barrierDigit) in that direction
 *  - 'matches-differs'  : targets the coldest or hottest single digit
 *  - 'even-odd'         : trades the more/less frequent parity once skew
 *                          crosses the edge threshold
 *
 * windowSize (def.windowSize, default 1000) controls how many recent ticks
 * the live stats are computed from — a short window (e.g. 50) reacts to
 * short-term anomalies; a long one is steadier.
 *
 * Circuit breaker: if def.pauseMinutes is set, tripping it pauses this
 * strategy for that many minutes and then resumes automatically. If not
 * set, tripping it stops the strategy permanently (previous behavior).
 */
class AdaptiveDigitExecutor {
  constructor({ definition, deriv, riskManager, trialManager }) {
    this.def = definition;
    this.strategy = { id: definition.id, symbol: definition.symbol };
    this.deriv = deriv;
    this.riskManager = riskManager;
    this.trialManager = trialManager;

    this.window = new DigitWindow(definition.windowSize || 1000);
    this.openContracts = new Set();
    this.consecutiveLosses = 0;
    this.pausedUntil = null;
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
    if (this.window.size < this.window.maxSize) return; // wait for the window to fully fill, matching the stated lookback
    if (this.hasOpenPosition) return;
    if (!this.riskManager.canTrade()) return;

    if (this.pausedUntil) {
      if (Date.now() < this.pausedUntil) return; // still in a timed pause
      logEvent({ type: 'pattern_pause_ended', strategyId: this.def.id });
      this.pausedUntil = null;
      this.consecutiveLosses = 0; // fresh start once the pause clears
    }

    const stats = this.window.computeRanks();
    const minEdgePct = this.def.minEdgePct || (this.def.mode === 'even-odd' ? 5 : 3);
    let plan = null;

    if (this.def.mode === 'over-under') {
      const result = pickBestBarrier(this.def.direction, stats, minEdgePct);
      if (result) plan = { contractType: this.def.direction, barrier: result.barrier, meta: result };
    } else if (this.def.mode === 'over-under-group') {
      const result = computeGroupSkew(stats);
      const threshold = this.def.groupThresholdPct || 70;
      if (result.skew >= 0 && (result.strongerSide === 'over' ? result.overPct : result.underPct) >= threshold) {
        const contractType = result.strongerSide === 'over' ? 'DIGITOVER' : 'DIGITUNDER';
        plan = { contractType, barrier: this.def.barrierDigit, meta: result };
      }
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
          if (this.def.pauseMinutes) {
            this.pausedUntil = Date.now() + this.def.pauseMinutes * 60000;
            logEvent({ type: 'pattern_paused', strategyId: this.def.id, pauseMinutes: this.def.pauseMinutes, consecutiveLosses: this.consecutiveLosses });
          } else {
            logEvent({ type: 'pattern_circuit_breaker_tripped', strategyId: this.def.id, consecutiveLosses: this.consecutiveLosses });
            this.stop();
          }
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
