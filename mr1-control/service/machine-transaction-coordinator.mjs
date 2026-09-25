import {
  MACHINE_COMMAND_POLICY,
  MACHINE_INTENT_TYPES,
  MACHINE_TRANSACTION_PROTOCOL,
  MachineCommandError,
  evaluateMachineCommand,
  normalizeMachineRequest,
  transactionIsTerminal,
} from "../src/machine-command.js";

const DEFAULT_LEASE_MS = 5000;
const DEFAULT_QUEUE_LIMIT = 8;
const DEFAULT_EXECUTION_TIMEOUT_MS = 30_000;
const MAX_REQUEST_HISTORY = 128;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function sameRequest(left, right) {
  return left.ownerId === right.ownerId
    && JSON.stringify(left.intent) === JSON.stringify(right.intent);
}

export class MachineTransactionCoordinator {
  constructor(options = {}) {
    this.mode = options.mode ?? "simulate";
    this.enabled = options.enabled === true;
    this.physicalEnabled = options.physicalEnabled === true;
    this.executor = options.executor ?? null;
    this.getTelemetry = options.getTelemetry ?? (() => null);
    this.publish = options.publish ?? (() => {});
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? ((sequence) => `tx-${this.now()}-${sequence}`);
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.queueLimit = options.queueLimit ?? DEFAULT_QUEUE_LIMIT;
    this.executionTimeoutMs = options.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
    this.queue = [];
    this.active = null;
    this.lease = null;
    this.lastTransaction = null;
    this.transactionsByRequest = new Map();
    this.transactionSequence = 0;
    this.eventSequence = 0;
    this.processing = false;
    this.stopped = false;
    this.activeAbortController = null;
    this.activeAbortReason = null;
    this.activeExecutionTimer = null;
    this.idleWaiters = [];
  }

  snapshot() {
    this.releaseExpiredLease();
    return {
      protocol: MACHINE_TRANSACTION_PROTOCOL,
      policy: MACHINE_COMMAND_POLICY,
      enabled: this.enabled,
      physicalEnabled: this.physicalEnabled,
      allowedIntents: [...MACHINE_INTENT_TYPES],
      owner: this.lease
        ? {
            ownerId: this.lease.ownerId,
            generation: this.lease.generation,
            expiresAt: new Date(this.lease.expiresAt).toISOString(),
          }
        : null,
      activeTransactionId: this.active?.id ?? null,
      queueDepth: this.queue.length,
      executionTimeoutMs: this.executionTimeoutMs,
      lastTransaction: this.lastTransaction
        ? {
            id: this.lastTransaction.id,
            requestId: this.lastTransaction.requestId,
            intentType: this.lastTransaction.intent.type,
            state: this.lastTransaction.state,
            phase: this.lastTransaction.phase,
            completedAt: this.lastTransaction.completedAt ?? null,
          }
        : null,
    };
  }

  transactionSnapshot(transaction) {
    return clone(transaction);
  }

  lookup(ownerId, transactionId) {
    const record = [...this.transactionsByRequest.values()]
      .find(({ transaction }) => transaction.id === transactionId);
    const transaction = record?.transaction ?? null;
    if (!transaction) {
      throw new MachineCommandError("Machine transaction was not found.", {
        code: "TRANSACTION_NOT_FOUND",
        statusCode: 404,
      });
    }
    if (transaction.ownerId !== ownerId) {
      throw new MachineCommandError("Only the transaction owner can inspect it.", {
        code: "TRANSACTION_OWNER_MISMATCH",
        statusCode: 403,
      });
    }
    return this.transactionSnapshot(transaction);
  }

  releaseExpiredLease() {
    if (!this.lease || this.active || this.queue.length > 0) return;
    if (this.lease.expiresAt <= this.now()) this.lease = null;
  }

  acquireLease(ownerId) {
    this.releaseExpiredLease();
    const now = this.now();
    if (this.lease && this.lease.ownerId !== ownerId) {
      throw new MachineCommandError("Another operator session owns the machine command lease.", {
        code: "COMMAND_LEASE_HELD",
        statusCode: 423,
        details: {
          ownerId: this.lease.ownerId,
          expiresAt: new Date(this.lease.expiresAt).toISOString(),
        },
      });
    }
    if (!this.lease) {
      this.lease = { ownerId, generation: 1, expiresAt: now + this.leaseMs };
    } else {
      this.lease.expiresAt = now + this.leaseMs;
    }
    return this.lease;
  }

  telemetryContext(request) {
    const telemetry = this.getTelemetry();
    const receivedAt = Date.parse(telemetry?.receivedAt);
    return {
      commandsEnabled: this.enabled,
      telemetry,
      telemetryAgeMs: Number.isFinite(receivedAt) ? Math.max(0, this.now() - receivedAt) : Number.NaN,
      observedStatusSequence: request.observedStatusSequence,
      maximumTelemetryAgeMs: 1500,
    };
  }

  evaluate(request) {
    return evaluateMachineCommand(request.intent, this.telemetryContext(request));
  }

  createTransaction(request, evaluation) {
    const now = new Date(this.now()).toISOString();
    const transaction = {
      protocol: MACHINE_TRANSACTION_PROTOCOL,
      sequence: ++this.eventSequence,
      id: this.idFactory(++this.transactionSequence),
      requestId: request.requestId,
      ownerId: request.ownerId,
      mode: this.mode,
      intent: evaluation.intent,
      state: "validating",
      phase: "preflight",
      progress: 0,
      gates: evaluation.gates,
      blockers: evaluation.blockers,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      history: [{ state: "validating", phase: "preflight", progress: 0, at: now }],
    };
    return transaction;
  }

  transition(transaction, state, options = {}) {
    const at = new Date(this.now()).toISOString();
    transaction.state = state;
    transaction.phase = options.phase ?? transaction.phase;
    transaction.progress = Number.isFinite(options.progress) ? options.progress : transaction.progress;
    transaction.updatedAt = at;
    transaction.sequence = ++this.eventSequence;
    if (options.gates) {
      transaction.gates = options.gates;
      transaction.blockers = options.gates.filter(({ passed }) => !passed);
    }
    if (options.result !== undefined) transaction.result = clone(options.result);
    if (options.error !== undefined) transaction.error = clone(options.error);
    if (transactionIsTerminal(transaction)) transaction.completedAt = at;
    transaction.history.push({
      state,
      phase: transaction.phase,
      progress: transaction.progress,
      detail: options.detail ?? null,
      at,
    });
    if (transaction.history.length > 24) transaction.history.splice(0, transaction.history.length - 24);
    this.lastTransaction = transaction;
    this.publish(this.transactionSnapshot(transaction), this.snapshot());
    return transaction;
  }

  rememberRequest(request, transaction) {
    this.transactionsByRequest.set(request.requestId, { request: clone(request), transaction });
    while (this.transactionsByRequest.size > MAX_REQUEST_HISTORY) {
      this.transactionsByRequest.delete(this.transactionsByRequest.keys().next().value);
    }
  }

  submit(candidate) {
    if (this.stopped) {
      throw new MachineCommandError("Machine transaction service is stopping.", {
        code: "COMMAND_SERVICE_STOPPED",
        statusCode: 503,
      });
    }
    const request = normalizeMachineRequest(candidate);
    const existing = this.transactionsByRequest.get(request.requestId);
    if (existing) {
      if (!sameRequest(existing.request, request)) {
        throw new MachineCommandError("Request ID was already used for a different command.", {
          code: "REQUEST_ID_CONFLICT",
          statusCode: 409,
        });
      }
      return { transaction: this.transactionSnapshot(existing.transaction), duplicate: true };
    }
    const evaluation = this.evaluate(request);
    const transaction = this.createTransaction(request, evaluation);
    this.rememberRequest(request, transaction);
    if (!evaluation.permitted) {
      this.transition(transaction, "rejected", {
        phase: "preflight-blocked",
        progress: 0,
        gates: evaluation.gates,
        error: {
          code: "COMMAND_GATES_BLOCKED",
          message: evaluation.blockers[0]?.detail ?? "Machine command safety gates blocked the request.",
        },
      });
      throw new MachineCommandError(transaction.error.message, {
        code: transaction.error.code,
        statusCode: 409,
        details: { transaction: this.transactionSnapshot(transaction) },
      });
    }

    try {
      this.acquireLease(request.ownerId);
    } catch (error) {
      this.transition(transaction, "rejected", {
        phase: "lease-held",
        error: {
          code: error?.code ?? "COMMAND_LEASE_HELD",
          message: error instanceof Error ? error.message : String(error),
        },
      });
      if (error instanceof MachineCommandError) {
        error.details = {
          ...(error.details ?? {}),
          transaction: this.transactionSnapshot(transaction),
        };
      }
      throw error;
    }
    if (this.queue.length >= this.queueLimit) {
      this.transition(transaction, "rejected", {
        phase: "queue-full",
        error: { code: "COMMAND_QUEUE_FULL", message: "Machine command queue is full." },
      });
      throw new MachineCommandError("Machine command queue is full.", {
        code: "COMMAND_QUEUE_FULL",
        statusCode: 429,
        details: { transaction: this.transactionSnapshot(transaction) },
      });
    }

    this.queue.push({ request, transaction });
    this.transition(transaction, "queued", {
      phase: "owned-and-queued",
      progress: 0.05,
      detail: `Lease generation ${this.lease.generation}`,
    });
    void this.processQueue();
    return { transaction: this.transactionSnapshot(transaction), duplicate: false };
  }

  async processQueue() {
    if (this.processing || this.stopped) return;
    this.processing = true;
    try {
      while (!this.stopped && this.queue.length > 0) {
        const entry = this.queue.shift();
        this.active = entry.transaction;
        if (this.lease?.ownerId === entry.request.ownerId) this.lease.expiresAt = this.now() + this.leaseMs;

        const executionEvaluation = this.evaluate(entry.request);
        if (!executionEvaluation.permitted) {
          this.transition(entry.transaction, "failed", {
            phase: "execution-gate-changed",
            progress: entry.transaction.progress,
            gates: executionEvaluation.gates,
            error: {
              code: "COMMAND_GATES_CHANGED",
              message: executionEvaluation.blockers[0]?.detail ?? "A command gate changed before execution.",
            },
          });
          this.active = null;
          continue;
        }

        try {
          if (!this.executor?.execute) {
            throw new MachineCommandError("No commissioned command executor is available.", {
              code: "COMMAND_EXECUTOR_UNAVAILABLE",
              statusCode: 503,
            });
          }
          this.transition(entry.transaction, "dispatching", {
            phase: "dispatching",
            progress: 0.1,
            gates: executionEvaluation.gates,
          });
          this.activeAbortController = new AbortController();
          this.activeAbortReason = null;
          const activeSignal = this.activeAbortController.signal;
          let abortListener;
          const abortPromise = new Promise((resolve, reject) => {
            abortListener = () => reject(new MachineCommandError("Machine transaction aborted.", {
              code: this.activeAbortReason === "timeout" ? "COMMAND_TIMEOUT" : "COMMAND_CANCELLED",
            }));
            activeSignal.addEventListener("abort", abortListener, { once: true });
          });
          this.activeExecutionTimer = setTimeout(() => {
            if (this.active?.id !== entry.transaction.id || activeSignal.aborted) return;
            this.activeAbortReason = "timeout";
            this.activeAbortController.abort();
          }, this.executionTimeoutMs);
          const lifecycle = (async () => {
            const result = await this.executor.execute(executionEvaluation.intent, {
              signal: activeSignal,
              onPhase: (state, phase, progress, detail = null) => {
                if (activeSignal.aborted) return;
                this.transition(entry.transaction, state, { phase, progress, detail });
              },
            });
            if (activeSignal.aborted) {
              throw new MachineCommandError("Machine transaction was aborted.", {
                code: this.activeAbortReason === "timeout" ? "COMMAND_TIMEOUT" : "COMMAND_CANCELLED",
              });
            }
            this.transition(entry.transaction, "verifying", {
              phase: "observing-controller-state",
              progress: 0.95,
              result,
            });
            if (this.executor.verify) await this.executor.verify(executionEvaluation.intent, result);
            return result;
          })();
          const result = await Promise.race([lifecycle, abortPromise]);
          activeSignal.removeEventListener("abort", abortListener);
          if (this.activeAbortController.signal.aborted) {
            throw new MachineCommandError("Machine transaction was cancelled.", {
              code: this.activeAbortReason === "timeout" ? "COMMAND_TIMEOUT" : "COMMAND_CANCELLED",
            });
          }
          this.transition(entry.transaction, "completed", {
            phase: "state-observed",
            progress: 1,
            result,
          });
        } catch (error) {
          const timedOut = this.activeAbortReason === "timeout" || error?.code === "COMMAND_TIMEOUT";
          const cancelled = !timedOut && (this.activeAbortController?.signal.aborted === true || this.stopped);
          this.transition(entry.transaction, cancelled ? "cancelled" : "failed", {
            phase: timedOut ? "execution-timeout" : cancelled ? "abort-observed" : "fail-closed",
            error: {
              code: timedOut ? "COMMAND_TIMEOUT" : cancelled ? "COMMAND_CANCELLED" : error?.code ?? "COMMAND_EXECUTION_FAILED",
              message: timedOut
                ? `Machine transaction exceeded its ${this.executionTimeoutMs} ms deadline.`
                : cancelled
                  ? "Machine transaction cancelled before completion."
                  : error instanceof Error ? error.message : String(error),
            },
          });
        } finally {
          clearTimeout(this.activeExecutionTimer);
          this.activeExecutionTimer = null;
          this.activeAbortController = null;
          this.activeAbortReason = null;
          this.active = null;
          if (this.lease?.ownerId === entry.request.ownerId) this.lease.expiresAt = this.now() + this.leaseMs;
        }
      }
    } finally {
      this.processing = false;
      this.releaseExpiredLease();
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }

  cancel(ownerId, transactionId) {
    const record = [...this.transactionsByRequest.values()]
      .find(({ transaction: candidate }) => candidate.id === transactionId);
    const transaction = record?.transaction ?? null;
    if (!transaction) throw new MachineCommandError("Machine transaction was not found.", {
      code: "TRANSACTION_NOT_FOUND",
      statusCode: 404,
    });
    if (transaction.ownerId !== ownerId) throw new MachineCommandError("Only the transaction owner can cancel it.", {
      code: "TRANSACTION_OWNER_MISMATCH",
      statusCode: 403,
    });
    if (transactionIsTerminal(transaction)) return this.transactionSnapshot(transaction);
    const queuedIndex = this.queue.findIndex(({ transaction: candidate }) => candidate.id === transactionId);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      this.transition(transaction, "cancelled", {
        phase: "cancelled-before-dispatch",
        error: { code: "COMMAND_CANCELLED", message: "Queued machine transaction cancelled by its owner." },
      });
      return this.transactionSnapshot(transaction);
    }
    this.transition(transaction, "cancelling", {
      phase: "owner-cancel-requested",
      detail: "ABORT SIGNAL SENT TO COMMAND EXECUTOR",
    });
    this.activeAbortReason = "owner-cancel";
    this.activeAbortController?.abort();
    return this.transactionSnapshot(transaction);
  }

  // Cancel everything a disconnected owner still has pending: queued
  // transactions must not execute unattended after the owner is gone.
  cancelAllForOwner(ownerId, reason = "owner-disconnected") {
    const cancelled = [];
    const remaining = [];
    for (const entry of this.queue) {
      if (entry.transaction.ownerId === ownerId) {
        this.transition(entry.transaction, "cancelled", {
          phase: "cancelled-owner-disconnected",
          error: { code: "COMMAND_OWNER_DISCONNECTED", message: `Queued machine transaction cancelled: ${reason}.` },
        });
        cancelled.push(this.transactionSnapshot(entry.transaction));
      } else {
        remaining.push(entry);
      }
    }
    this.queue = remaining;
    if (this.active && this.active.ownerId === ownerId && !transactionIsTerminal(this.active)) {
      this.transition(this.active, "cancelling", {
        phase: "owner-disconnected",
        detail: "ABORT SIGNAL SENT TO COMMAND EXECUTOR",
      });
      this.activeAbortReason = reason;
      this.activeAbortController?.abort();
      cancelled.push(this.transactionSnapshot(this.active));
    }
    return cancelled;
  }

  whenIdle() {
    if (!this.processing) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  async stop() {
    if (this.stopped) return this.whenIdle();
    this.stopped = true;
    this.activeAbortReason = "service-stop";
    this.activeAbortController?.abort();
    for (const { transaction } of this.queue.splice(0)) {
      this.transition(transaction, "cancelled", {
        phase: "service-stopped",
        error: { code: "COMMAND_SERVICE_STOPPED", message: "Command service stopped before execution." },
      });
    }
    await this.whenIdle();
  }
}
