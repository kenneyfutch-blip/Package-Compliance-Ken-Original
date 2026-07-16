import app from "./app";
import { logger } from "./lib/logger";
import { ensureAuditImmutability } from "./lib/audit";
import { initJobs } from "./lib/jobs";
import { stopJobWorker } from "./lib/jobs/worker";
import { ensureMemoryIndexes } from "./lib/memory/engine";
import { ensureEcfrIndexes } from "./lib/ecfr/engine";
import { ensurePolicyIndexes } from "./lib/policies/engine";
import { initMaintenance, stopMaintenance } from "./lib/maintenance/archive";
import { backfillSupplierLinks } from "./lib/suppliers/link";
import { initAiUsageWriteHealthHeartbeat } from "./lib/ai-usage";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Guarantee the audit trail is append-only at the database layer.
  void ensureAuditImmutability();

  // Create the vector ANN index for Compliance Memory semantic search.
  void ensureMemoryIndexes();

  // Create the vector ANN index for synced eCFR regulatory sections.
  void ensureEcfrIndexes();

  // Create the vector ANN index for Internal Policy & Standards search.
  void ensurePolicyIndexes();

  // Link legacy packages and memory rows to their master supplier record by id
  // (idempotent, non-fatal) so supplier scoping no longer relies on vendor names.
  void backfillSupplierLinks();

  // Start the durable background job worker and schedule the escalation sweep.
  void initJobs();

  // Schedule data maintenance: roll cold audit into the partitioned archive,
  // enforce retention, and prune orphaned violations.
  initMaintenance();

  // Heartbeat this instance's AI usage write-health into the shared table so the
  // /ai-usage/health signal reflects fleet-wide telemetry health, not just this
  // process. Off the AI path — never adds latency to AI responses.
  initAiUsageWriteHealthHeartbeat();
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
// On SIGTERM/SIGINT (deploy restarts, scale-down, Ctrl-C): stop accepting new
// connections, stop scheduling background work, let the in-flight job tick
// finish so no job dies mid-write (the stale-job reclaim + ownership guards
// cover anything that still gets cut off), then exit. A hard deadline ensures
// a stuck connection or handler can never wedge the shutdown.
const SHUTDOWN_DEADLINE_MS = 15_000;
let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down gracefully");

  // Hard deadline: never hang shutdown on a stuck socket or handler.
  const deadline = setTimeout(() => {
    logger.warn({ signal }, "Shutdown deadline reached; exiting");
    process.exit(0);
  }, SHUTDOWN_DEADLINE_MS);
  if (typeof deadline.unref === "function") deadline.unref();

  // Stop accepting new connections; existing keep-alive sockets are closed
  // once their in-flight responses complete. Exit waits for BOTH the HTTP
  // drain and the worker stop (or the hard deadline, whichever comes first).
  const httpClosed = new Promise<void>((resolve) => {
    server.close(() => {
      logger.info("HTTP server closed");
      resolve();
    });
  });
  if (typeof server.closeIdleConnections === "function") {
    server.closeIdleConnections();
  }

  stopMaintenance();
  const workerStopped = stopJobWorker().catch((err) =>
    logger.error({ err }, "Job worker stop failed"),
  );

  void Promise.allSettled([httpClosed, workerStopped]).then(() => {
    clearTimeout(deadline);
    logger.info({ signal }, "Shutdown complete");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
