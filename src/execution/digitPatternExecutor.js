const { DigitWindow, rankSatisfies } = require('../market/digitWindow');
const { logEvent } = require('../logging/decisionLog');

/**
 * Executes a digit-pattern strategy (Over/Under, Matches/Differs, Even/Odd
 * with hot/cold conditions and prior-digit exclusion) — a different
 * execution model from TradeExecutor's indicator-threshold strategies.
 *
 * State: "armed" means ready to take an entry. Taking an entry disarms it;
 * a reset digit re-arms it. This mirrors the manual process Mysh described:
 * take a trade, then wait for an "exit spot" digit before watching again.
 * Combined with the open-contract check, a new entry needs BOTH a reset
 * digit seen AND the previous contract settled — stated plainly since this
 * is a judgment call translating a manual process into a precise rule.
 */
class DigitPatternExecutor {
  constructor({ definition, deriv, riskManager, trialManager }) {
    this.def = definition;
    this.strategy = { id: definition.id, symbol: definition.symbol }; // shape StrategyManager expects
    this.deriv = deriv;
    this.riskManager = riskManager;
    this.trialManager = trialManager;

    this.window = new DigitWindow(1000);
    this.openContracts = new Set();
    this.armed = true;
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
    const digit = this.window.push(price);
    const priorDigit = this.window.digitBack(this.def.priorDigitsBack || 1);

    if ((this.def.resetDigits || []).includes(digit)) {
      this.armed = true;
      logEvent({ type: 'pattern_reset_seen', strategyId: this.def.id, digit });
    }

    if (this.window.size < (this.def.priorDigitsBack || 1) + 1) return; // not enough history yet
    if (this.hasOpenPosition) return; // one trade at a time
    if (!this.armed) return;
    if (!(this.def.entryDigits || []).includes(digit)) return;

    const entryRank = this.window.rankOf(digit);
    if (!rankSatisfies(entryRank, this.def.entryMustBe || 'any')) {
      logEvent({ type: 'pattern_entry_skipped_rank', strategyId: this.def.id, digit, entryRank });
      return;
    }

    const barrierRank = this.window.rankOf(this.def.barrierDigit);
    if (!rankSatisfies(barrierRank, this.def.barrierMustBe || 'any')) {
      logEvent({ type: 'pattern_entry_skipped_barrier_rank', strategyId: this.def.id, barrierDigit: this.def.barrierDigit, barrierRank });
      return;
    }

    if (priorDigit !== null && (this.def.excludeIfPriorDigitIn || []).includes(priorDigit)) {
      logEvent({ type: 'pattern_entry_skipped_prior_digit', strategyId: this.def.id, digit, priorDigit });
      return;
    }

    await this._tryEnterTrade(digit, priorDigit, entryRank);
  }

  async _tryEnterTrade(triggerDigit, priorDigit, entryRank) {
    if (!this.riskManager.canTrade()) return;

    const stake = this.riskManager.getPositionSize();
    if (stake <= 0) return;

    try {
      const proposalParams = {
        contract_type: this.def.contractType,
        underlying_symbol: this.def.symbol,
        amount: stake,
        basis: 'stake',
        duration: this.def.durationTicks || 1,
        duration_unit: 't',
        currency: 'USD',
      };
      if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(this.def.contractType)) {
        proposalParams.barrier = String(this.def.barrierDigit);
      }

      const proposalRes = await this.deriv.getProposal(proposalParams);
      const proposal = proposalRes.proposal;
      const buyRes = await this.deriv.buyContract(proposal.id, proposal.ask_price);
      const contractId = buyRes.buy.contract_id;

      this.openContracts.add(contractId);
      this.armed = false; // require a reset digit before the next entry

      logEvent({
        type: 'trade_opened', strategyId: this.def.id, contractId, stake,
        triggerDigit, priorDigit, entryRank, barrierDigit: this.def.barrierDigit,
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
      this.riskManager.recordTradeResult(pnl);
      this.trialManager.recordTrade(this.def.id, pnl);

      if (pnl > 0) {
        this.consecutiveLosses = 0;
      } else {
        this.consecutiveLosses++;
        if (this.def.maxConsecutiveLosses && this.consecutiveLosses >= this.def.maxConsecutiveLosses) {
          logEvent({ type: 'pattern_circuit_breaker_tripped', strategyId: this.def.id, consecutiveLosses: this.consecutiveLosses });
          this.stop();
        }
      }

      logEvent({ type: 'trade_closed', strategyId: this.def.id, contractId, pnl, consecutiveLosses: this.consecutiveLosses });

      this.openContracts.delete(contractId);
      this.deriv.off('proposal_open_contract', handler);
    };

    this.deriv.on('proposal_open_contract', handler);
  }
}

module.exports = DigitPatternExecutor;
                                                  
