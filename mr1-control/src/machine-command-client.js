import { normalizeMachineIntent, transactionIsTerminal } from "./machine-command.js";

export const MACHINE_TRANSACTION_ENDPOINT = "http://127.0.0.1:8787/machine/transactions";
export const MACHINE_CANCEL_ENDPOINT = "http://127.0.0.1:8787/machine/cancel";
const OWNER_STORAGE_KEY = "mr1-control.command-owner.v1";

function fallbackId(prefix) {
  const random = Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function loadCommandOwnerId(
  storage = globalThis.sessionStorage,
  randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
) {
  try {
    const saved = storage?.getItem(OWNER_STORAGE_KEY);
    if (/^[A-Za-z0-9_-]{8,80}$/.test(saved ?? "")) return saved;
    const generated = `ui-${randomUuid ? randomUuid() : fallbackId("owner")}`.replace(/[^A-Za-z0-9_-]/g, "_");
    storage?.setItem(OWNER_STORAGE_KEY, generated);
    return generated;
  } catch {
    return fallbackId("ui-owner");
  }
}

export class MachineCommandRequestError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "MachineCommandRequestError";
    this.code = options.code ?? "MACHINE_COMMAND_REQUEST_FAILED";
    this.status = options.status ?? 0;
    this.payload = options.payload ?? null;
  }
}

export class MachineCommandClient {
  constructor(options = {}) {
    this.endpoint = options.endpoint ?? MACHINE_TRANSACTION_ENDPOINT;
    this.cancelEndpoint = options.cancelEndpoint ?? MACHINE_CANCEL_ENDPOINT;
    this.ownerId = options.ownerId ?? loadCommandOwnerId(options.storage, options.randomUuid);
    this.fetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
    this.randomUuid = options.randomUuid ?? globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
    this.requestTimeoutMs = Number.isFinite(Number(options.requestTimeoutMs))
      ? Math.max(250, Number(options.requestTimeoutMs))
      : 5_000;
    this.requestSequence = 0;
  }

  async request(url, init, unreachableMessage) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await this.fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      throw new MachineCommandRequestError(
        controller.signal.aborted
          ? `Machine command service exceeded ${this.requestTimeoutMs} ms.`
          : error instanceof Error ? error.message : unreachableMessage,
        { code: controller.signal.aborted ? "COMMAND_SERVICE_TIMEOUT" : "COMMAND_SERVICE_UNREACHABLE" },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  nextRequestId() {
    this.requestSequence += 1;
    const unique = this.randomUuid ? this.randomUuid() : fallbackId("request");
    return `req-${unique}-${this.requestSequence}`.replace(/[^A-Za-z0-9_-]/g, "_");
  }

  async submit(intent, options = {}) {
    if (typeof this.fetch !== "function") {
      throw new MachineCommandRequestError("Fetch is unavailable.", { code: "FETCH_UNAVAILABLE" });
    }
    const request = {
      ownerId: this.ownerId,
      requestId: options.requestId ?? this.nextRequestId(),
      observedStatusSequence: Number.isInteger(options.observedStatusSequence)
        ? options.observedStatusSequence
        : null,
      intent: normalizeMachineIntent(intent),
    };
    let response;
    try {
      response = await this.request(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }, "Machine command service is unreachable.");
    } catch (error) {
      if (error instanceof MachineCommandRequestError) throw error;
      throw new MachineCommandRequestError(
        error instanceof Error ? error.message : "Machine command service is unreachable.",
        { code: "COMMAND_SERVICE_UNREACHABLE" },
      );
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // The status code still distinguishes a service failure from acceptance.
    }
    if (!response.ok) {
      throw new MachineCommandRequestError(
        payload?.error ?? `Machine command request failed with HTTP ${response.status}.`,
        {
          code: payload?.code ?? "MACHINE_COMMAND_REJECTED",
          status: response.status,
          payload,
        },
      );
    }
    return payload;
  }

  async get(transactionId) {
    if (typeof this.fetch !== "function") {
      throw new MachineCommandRequestError("Fetch is unavailable.", { code: "FETCH_UNAVAILABLE" });
    }
    const query = new URLSearchParams({ ownerId: this.ownerId, transactionId: String(transactionId) });
    // The endpoint may already carry a query (e.g. a companion pair token);
    // appending a second "?" would corrupt both parameters.
    const separator = String(this.endpoint).includes("?") ? "&" : "?";
    const response = await this.request(
      `${this.endpoint}${separator}${query}`,
      { method: "GET" },
      "Machine command status service is unreachable.",
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new MachineCommandRequestError(
        payload?.error ?? `Machine command status failed with HTTP ${response.status}.`,
        {
          code: payload?.code ?? "MACHINE_TRANSACTION_LOOKUP_FAILED",
          status: response.status,
          payload,
        },
      );
    }
    return payload;
  }

  async waitForTerminal(transactionId, options = {}) {
    const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Math.max(500, Number(options.timeoutMs)) : 35_000;
    const pollMs = Number.isFinite(Number(options.pollMs)) ? Math.max(25, Number(options.pollMs)) : 125;
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() <= deadline) {
      if (options.signal?.aborted) {
        throw new MachineCommandRequestError("Transaction reconciliation was cancelled.", {
          code: "TRANSACTION_RECONCILIATION_CANCELLED",
        });
      }
      try {
        const payload = await this.get(transactionId);
        lastError = null;
        options.onUpdate?.(payload.transaction, payload.machineCommands);
        if (transactionIsTerminal(payload.transaction)) return payload;
      } catch (error) {
        lastError = error;
        if (error instanceof MachineCommandRequestError && [400, 403, 404].includes(error.status)) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new MachineCommandRequestError(
      `Transaction status was not reconciled within ${timeoutMs} ms${lastError ? `: ${lastError.message}` : "."}`,
      { code: "TRANSACTION_RECONCILIATION_TIMEOUT", payload: lastError?.payload ?? null },
    );
  }

  async cancel(transactionId) {
    if (typeof this.fetch !== "function") {
      throw new MachineCommandRequestError("Fetch is unavailable.", { code: "FETCH_UNAVAILABLE" });
    }
    let response;
    try {
      response = await this.request(this.cancelEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId: this.ownerId, transactionId }),
      }, "Machine cancel service is unreachable.");
    } catch (error) {
      if (error instanceof MachineCommandRequestError) throw error;
      throw new MachineCommandRequestError(
        error instanceof Error ? error.message : "Machine command service is unreachable.",
        { code: "COMMAND_SERVICE_UNREACHABLE" },
      );
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new MachineCommandRequestError(
        payload?.error ?? `Machine cancel request failed with HTTP ${response.status}.`,
        {
          code: payload?.code ?? "MACHINE_CANCEL_REJECTED",
          status: response.status,
          payload,
        },
      );
    }
    return payload;
  }
}
