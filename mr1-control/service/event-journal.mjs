import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";

export const EVENT_JOURNAL_PROTOCOL = "mr1-event-journal-v1";
export const JOURNAL_RECONCILIATION_PROTOCOL = "mr1-journal-reconciliation-v1";
export const DEFAULT_JOURNAL_FILE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_JOURNAL_FILES = 8;
const CURRENT_FILE = "mr1-events.jsonl";
const HEAD_FILE = "mr1-journal-head.json";
const KIND_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/;
const DIGEST_PATTERN = /^[A-F0-9]{64}$/;
const TERMINAL_TRANSACTION_STATES = new Set(["completed", "failed", "cancelled", "rejected"]);
const MAX_UNFINISHED_TRANSACTIONS = 8;

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex").toUpperCase();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function boundedPayload(payload, maximumBytes) {
  let json;
  try {
    json = JSON.stringify(payload ?? null, (_key, value) => {
      if (typeof value === "bigint") return value.toString();
      if (value instanceof Error) return { name: value.name, message: value.message, code: value.code ?? null };
      return value;
    });
  } catch (error) {
    return { serializationError: error instanceof Error ? error.message : String(error) };
  }
  if (Buffer.byteLength(json, "utf8") <= maximumBytes) return JSON.parse(json);
  return {
    truncated: true,
    originalBytes: Buffer.byteLength(json, "utf8"),
    preview: json.slice(0, Math.max(0, maximumBytes - 160)),
  };
}

function archivePath(directory, index) {
  return resolve(directory, `${CURRENT_FILE}.${index}`);
}

function sealedReconciliation(payload) {
  const base = {
    protocol: JOURNAL_RECONCILIATION_PROTOCOL,
    ...payload,
    physicalMotionPermitted: false,
  };
  return Object.freeze({
    ...base,
    reconciliationId: sha256(JSON.stringify(canonicalize(base))),
  });
}

export function disabledJournalReconciliation() {
  return sealedReconciliation({
    state: "DISABLED",
    integrity: "NOT AVAILABLE",
    history: "DISABLED",
    recordsVerified: 0,
    sessionsVerified: 0,
    previousSessionId: null,
    previousSessionEntries: 0,
    previousStartedAt: null,
    previousStoppedAt: null,
    previousMode: null,
    lastEventKind: null,
    lastEventAt: null,
    unfinishedCount: 0,
    unfinishedTransactions: Object.freeze([]),
    truncatedTransactionRecords: 0,
    cleanShutdown: null,
    requiresReview: false,
    reviewable: false,
    commandInterlock: "CLEAR",
    message: "EVENT JOURNAL DISABLED / NO RESTART EVIDENCE",
    error: null,
  });
}

export function failedJournalReconciliation(error) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 240);
  return sealedReconciliation({
    state: "CORRUPT",
    integrity: "FAIL",
    history: "UNTRUSTED",
    recordsVerified: 0,
    sessionsVerified: 0,
    previousSessionId: null,
    previousSessionEntries: 0,
    previousStartedAt: null,
    previousStoppedAt: null,
    previousMode: null,
    lastEventKind: null,
    lastEventAt: null,
    unfinishedCount: 0,
    unfinishedTransactions: Object.freeze([]),
    truncatedTransactionRecords: 0,
    cleanShutdown: false,
    requiresReview: true,
    reviewable: false,
    commandInterlock: "HELD",
    message: "JOURNAL INTEGRITY FAILED / ARCHIVE AND INVESTIGATE",
    error: message,
  });
}

async function ignoreMissing(operation) {
  try {
    await operation();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function defaultJournalDirectory(environment = process.env) {
  const base = environment.LOCALAPPDATA || environment.XDG_STATE_HOME || environment.HOME || process.cwd();
  return resolve(base, "MR1-Control", "journal");
}

export function createEventJournal(options = {}) {
  if (options.directory === false) {
    return {
      append: async () => null,
      close: async () => {},
      exportText: async () => "",
      reconcile: async () => disabledJournalReconciliation(),
      status: () => ({ enabled: false, state: "DISABLED", entries: 0 }),
    };
  }

  const directory = resolve(options.directory ?? defaultJournalDirectory());
  const currentPath = resolve(directory, CURRENT_FILE);
  const headPath = resolve(directory, HEAD_FILE);
  const maxFileBytes = Math.max(512, Math.min(64 * 1024 * 1024, Number(options.maxFileBytes) || DEFAULT_JOURNAL_FILE_BYTES));
  const maxFiles = Math.max(1, Math.min(32, Number(options.maxFiles) || DEFAULT_JOURNAL_FILES));
  const maxPayloadBytes = Math.max(256, Math.min(64 * 1024, Number(options.maxPayloadBytes) || 48 * 1024));
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const sessionId = String(options.sessionId ?? randomUUID()).toUpperCase();
  let initialized = false;
  let closed = false;
  let currentBytes = 0;
  let sequence = 0;
  let entries = 0;
  let rotations = 0;
  let lastDigest = null;
  let lastWriteAt = null;
  let lastError = null;
  let queue = Promise.resolve();

  const initialize = async () => {
    if (initialized) return;
    await mkdir(directory, { recursive: true });
    try {
      currentBytes = (await stat(currentPath)).size;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      currentBytes = 0;
    }
    initialized = true;
  };

  const rotate = async () => {
    if (maxFiles === 1) {
      await ignoreMissing(() => unlink(currentPath));
      currentBytes = 0;
      rotations += 1;
      return;
    }
    await ignoreMissing(() => unlink(archivePath(directory, maxFiles - 1)));
    for (let index = maxFiles - 2; index >= 1; index -= 1) {
      await ignoreMissing(() => rename(archivePath(directory, index), archivePath(directory, index + 1)));
    }
    await ignoreMissing(() => rename(currentPath, archivePath(directory, 1)));
    currentBytes = 0;
    rotations += 1;
  };

  const persistHead = async (record) => {
    const head = JSON.stringify({
      protocol: EVENT_JOURNAL_PROTOCOL,
      sessionId: record.sessionId,
      sequence: record.sequence,
      digest: record.digest,
      at: record.at,
    });
    const temporary = `${headPath}.tmp`;
    const handle = await open(temporary, "w");
    try {
      await handle.write(head, null, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, headPath);
  };

  const writeRecord = async (kind, payload, writeOptions = {}) => {
    if (closed) return null;
    await initialize();
    if (!KIND_PATTERN.test(kind)) throw new Error(`Invalid journal event kind: ${kind}`);
    // The sequence counter and hash chain commit only after a successful
    // write; a failed write must not burn a sequence number or the next
    // successful record would break chain verification forever.
    const base = {
      protocol: EVENT_JOURNAL_PROTOCOL,
      sessionId,
      sequence: sequence + 1,
      at: new Date(now()).toISOString(),
      kind,
      previousDigest: lastDigest,
      payload: boundedPayload(payload, maxPayloadBytes),
    };
    const digest = sha256(JSON.stringify(canonicalize(base)));
    const record = { ...base, digest };
    const line = `${JSON.stringify(record)}\n`;
    const lineBytes = Buffer.byteLength(line, "utf8");
    const rotationsBefore = rotations;
    if (currentBytes > 0 && currentBytes + lineBytes > maxFileBytes) await rotate();
    const handle = await open(currentPath, "a");
    try {
      await handle.write(line, null, "utf8");
      if (writeOptions.sync === true) await handle.sync();
    } finally {
      await handle.close();
    }
    currentBytes += lineBytes;
    entries += 1;
    sequence = base.sequence;
    lastDigest = digest;
    lastWriteAt = base.at;
    lastError = null;
    // Anchor the newest durable record outside the journal files so a
    // deleted newest file cannot silently pass verification. Rotations
    // re-anchor so the head can never point into a dropped archive.
    if (writeOptions.sync === true || base.sequence === 1 || rotations > rotationsBefore) {
      try {
        await persistHead(record);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    return record;
  };

  const append = (kind, payload, writeOptions = {}) => {
    const operation = queue.then(() => writeRecord(String(kind ?? ""), payload, writeOptions));
    queue = operation.catch((error) => {
      lastError = error instanceof Error ? error.message : String(error);
    });
    return operation.catch(() => null);
  };

  const exportText = async () => {
    await queue;
    await initialize();
    const names = new Set(await readdir(directory));
    const ordered = [];
    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      const name = `${CURRENT_FILE}.${index}`;
      if (names.has(name)) ordered.push(resolve(directory, name));
    }
    if (names.has(CURRENT_FILE)) ordered.push(currentPath);
    const chunks = [];
    for (const file of ordered) chunks.push(await readFile(file, "utf8"));
    return chunks.join("");
  };

  const close = async (payload = {}) => {
    if (closed) return;
    await append("service.stop", payload, { sync: true });
    await queue;
    closed = true;
  };

  const reconcile = async () => {
    try {
      let head = null;
      try {
        head = JSON.parse(await readFile(headPath, "utf8"));
      } catch (error) {
        // A missing head is a legacy journal; anything else fails closed.
        if (error?.code !== "ENOENT") throw new Error(`Journal head anchor is unreadable: ${error.message}`);
      }
      return reconcileJournalRecords(await exportText(), { head });
    } catch (error) {
      return failedJournalReconciliation(error);
    }
  };

  const status = () => ({
    enabled: true,
    state: lastError ? "ERROR" : "ACTIVE",
    protocol: EVENT_JOURNAL_PROTOCOL,
    directory,
    sessionId,
    entries,
    currentBytes,
    maxFileBytes,
    maxFiles,
    rotations,
    lastDigest,
    lastWriteAt,
    error: lastError,
  });

  return { append, close, exportText, reconcile, status };
}

export function verifyJournalRecords(text) {
  const lines = String(text ?? "").split(/\r?\n/).filter(Boolean);
  let tornTail = false;
  const records = [];
  for (const [index, line] of lines.entries()) {
    try {
      records.push(JSON.parse(line));
    } catch {
      // A torn FINAL line is the expected artifact of power loss mid-write;
      // tolerate exactly that one case and surface it, so a crash does not
      // render the whole evidence chain unrecoverable. Anything earlier is
      // corruption and still fails.
      if (index === lines.length - 1) {
        tornTail = true;
        break;
      }
      throw new Error(`Journal line ${index + 1} is not valid JSON.`);
    }
  }
  if (records.length === 0 && tornTail) {
    throw new Error("Journal contains only a torn line.");
  }
  const sessions = new Map();
  for (const [index, record] of records.entries()) {
    if (record.protocol !== EVENT_JOURNAL_PROTOCOL) throw new Error("Journal protocol is not supported.");
    if (typeof record.sessionId !== "string" || record.sessionId.length < 1 || record.sessionId.length > 128) {
      throw new Error(`Journal line ${index + 1} has an invalid session ID.`);
    }
    if (!Number.isInteger(record.sequence) || record.sequence < 1) {
      throw new Error(`Journal line ${index + 1} has an invalid sequence.`);
    }
    if (!Number.isFinite(Date.parse(record.at))) throw new Error(`Journal line ${index + 1} has an invalid timestamp.`);
    if (!KIND_PATTERN.test(record.kind)) throw new Error(`Journal line ${index + 1} has an invalid event kind.`);
    if (!DIGEST_PATTERN.test(record.digest)) throw new Error(`Journal line ${index + 1} has an invalid digest.`);
    if (record.previousDigest !== null && !DIGEST_PATTERN.test(record.previousDigest)) {
      throw new Error(`Journal line ${index + 1} has an invalid previous digest.`);
    }
    const { digest, ...base } = record;
    if (sha256(JSON.stringify(canonicalize(base))) !== digest) throw new Error("Journal digest verification failed.");
    const previous = sessions.get(record.sessionId) ?? null;
    if (previous) {
      if (record.sequence !== previous.sequence + 1) throw new Error("Journal sequence is not contiguous.");
      if (record.previousDigest !== previous.digest) throw new Error("Journal hash chain is broken.");
    } else if (record.sequence === 1 && record.previousDigest !== null) {
      throw new Error("Journal session head has an unexpected previous digest.");
    } else if (record.sequence > 1 && record.previousDigest === null) {
      throw new Error("Retained journal tail is missing its previous digest anchor.");
    }
    sessions.set(record.sessionId, { digest, sequence: record.sequence });
  }
  return { records, sessions: sessions.size, tornTail };
}

export function reconcileJournalRecords(text, options = {}) {
  const source = String(text ?? "");
  const head = options.head ?? null;
  if (!source.trim()) {
    return sealedReconciliation({
      state: "NEW",
      integrity: "NOTHING TO VERIFY",
      history: "EMPTY",
      recordsVerified: 0,
      sessionsVerified: 0,
      previousSessionId: null,
      previousSessionEntries: 0,
      previousStartedAt: null,
      previousStoppedAt: null,
      previousMode: null,
      lastEventKind: null,
      lastEventAt: null,
      unfinishedCount: 0,
      unfinishedTransactions: Object.freeze([]),
      truncatedTransactionRecords: 0,
      cleanShutdown: null,
      requiresReview: false,
      reviewable: false,
      commandInterlock: "CLEAR",
      message: "NO PRIOR JOURNAL SESSION",
      error: null,
    });
  }

  let verified;
  try {
    verified = verifyJournalRecords(source);
  } catch (error) {
    return failedJournalReconciliation(error);
  }

  // The externally anchored head record must exist in the journal: without
  // this, deleting the newest journal file leaves an older chain that still
  // verifies and could flip the restart interlock from HELD to CLEAR.
  if (head && typeof head === "object") {
    const anchored = verified.records.some((record) => (
      record.sessionId === head.sessionId
      && record.sequence === head.sequence
      && record.digest === head.digest
    ));
    if (!anchored) {
      return failedJournalReconciliation(new Error(
        "The journal does not contain its anchored head record; journal files may have been deleted or replaced.",
      ));
    }
  }

  const lastRecord = verified.records.at(-1);
  const previousSessionId = lastRecord.sessionId;
  const sessionRecords = verified.records.filter((record) => record.sessionId === previousSessionId);
  const firstSessionRecord = sessionRecords[0];
  const startRecord = sessionRecords.find((record) => record.kind === "service.start") ?? null;
  const stopRecord = [...sessionRecords].reverse().find((record) => record.kind === "service.stop") ?? null;
  const transactions = new Map();
  let truncatedTransactionRecords = 0;
  for (const record of sessionRecords) {
    if (record.kind !== "machine.transaction") continue;
    if (record.payload?.truncated === true) {
      truncatedTransactionRecords += 1;
      continue;
    }
    const id = String(record.payload?.id ?? "");
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) {
      truncatedTransactionRecords += 1;
      continue;
    }
    transactions.set(id, record.payload);
  }
  const unfinishedAll = [...transactions.values()].filter((transaction) => (
    !TERMINAL_TRANSACTION_STATES.has(String(transaction.state ?? "").toLowerCase())
  ));
  const unfinishedTransactions = Object.freeze(unfinishedAll.slice(-MAX_UNFINISHED_TRANSACTIONS).map((transaction) => Object.freeze({
    id: String(transaction.id),
    requestId: String(transaction.requestId ?? ""),
    intentType: String(transaction.intent?.type ?? "unknown"),
    state: String(transaction.state ?? "unknown"),
    phase: String(transaction.phase ?? "unknown"),
    updatedAt: Number.isFinite(Date.parse(transaction.updatedAt)) ? new Date(transaction.updatedAt).toISOString() : null,
  })));
  const lastEventIsStop = lastRecord.kind === "service.stop" && !verified.tornTail;
  const interrupted = unfinishedAll.length > 0 || truncatedTransactionRecords > 0 || verified.tornTail;
  const state = interrupted ? "INTERRUPTED" : lastEventIsStop ? "CLEAN" : "UNCLEAN";
  const message = state === "CLEAN"
    ? "PREVIOUS SERVICE STOPPED CLEANLY"
    : verified.tornTail
      ? "FINAL JOURNAL LINE TORN (POWER LOSS MID-WRITE) / REVIEW REQUIRED"
      : state === "INTERRUPTED"
        ? `${unfinishedAll.length + truncatedTransactionRecords} UNRESOLVED TRANSACTION RECORD${unfinishedAll.length + truncatedTransactionRecords === 1 ? "" : "S"} / REVIEW REQUIRED`
        : "PREVIOUS SERVICE DID NOT RECORD A CLEAN STOP / REVIEW REQUIRED";

  return sealedReconciliation({
    state,
    integrity: "PASS",
    history: firstSessionRecord.sequence === 1 && firstSessionRecord.previousDigest === null ? "COMPLETE" : "RETAINED TAIL",
    recordsVerified: verified.records.length,
    sessionsVerified: verified.sessions,
    previousSessionId,
    previousSessionEntries: sessionRecords.length,
    previousStartedAt: startRecord?.at ?? null,
    previousStoppedAt: stopRecord?.at ?? null,
    previousMode: startRecord?.payload?.mode ?? null,
    lastEventKind: lastRecord.kind,
    lastEventAt: lastRecord.at,
    unfinishedCount: unfinishedAll.length + truncatedTransactionRecords,
    unfinishedTransactions,
    truncatedTransactionRecords,
    cleanShutdown: state === "CLEAN",
    requiresReview: state !== "CLEAN",
    reviewable: state === "UNCLEAN" || state === "INTERRUPTED",
    commandInterlock: state === "CLEAN" ? "CLEAR" : "HELD",
    message,
    error: null,
  });
}
