import app from "./app";
import { logger } from "./lib/logger";
import { ensureAuditImmutability } from "./lib/audit";
import { initJobs } from "./lib/jobs";
import { ensureMemoryIndexes } from "./lib/memory/engine";
import { initMaintenance } from "./lib/maintenance/archive";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Guarantee the audit trail is append-only at the database layer.
  void ensureAuditImmutability();

  // Create the vector ANN index for Compliance Memory semantic search.
  void ensureMemoryIndexes();

  // Start the durable background job worker and schedule the escalation sweep.
  void initJobs();

  // Schedule data maintenance: roll cold audit into the partitioned archive,
  // enforce retention, and prune orphaned violations.
  initMaintenance();
});
