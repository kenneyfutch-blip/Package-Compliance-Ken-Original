import type { Request } from "express";
import { db, auditEventsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getAuthContext } from "./rbac/context";
import { logger } from "./logger";

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: number | null;
  packageId?: number | null;
  detail?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  regulationRefs?: string[];
}

// The single sanctioned path for appending to the immutable audit trail. Actor
// identity is taken from the authenticated context, never the request body, so
// it cannot be spoofed.
export async function writeAudit(req: Request, input: AuditInput): Promise<void> {
  const ctx = getAuthContext(req);
  await db.insert(auditEventsTable).values({
    organizationId: ctx.organizationId,
    packageId: input.packageId ?? null,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    actor: ctx.name || ctx.email || "Unknown",
    actorId: ctx.clerkUserId,
    action: input.action,
    detail: input.detail ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    regulationRefs: input.regulationRefs ?? [],
  });
}

// System-actor audit write for background/seed contexts that have no request.
export async function writeSystemAudit(
  organizationId: number,
  input: AuditInput & { actor?: string },
): Promise<void> {
  await db.insert(auditEventsTable).values({
    organizationId,
    packageId: input.packageId ?? null,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    actor: input.actor ?? "System",
    actorId: null,
    action: input.action,
    detail: input.detail ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    regulationRefs: input.regulationRefs ?? [],
  });
}

// Defense-in-depth: a database trigger that rejects any UPDATE or DELETE on the
// audit table, guaranteeing append-only semantics even if application code is
// bypassed. Idempotent.
export async function ensureAuditImmutability(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION audit_events_prevent_mutation()
      RETURNS trigger AS $fn$
      BEGIN
        -- Governed retention: the archival routine sets app.audit_archival for
        -- its own transaction so it may move cold rows to the archive. Every
        -- other DELETE, and all UPDATEs, remain forbidden.
        IF TG_OP = 'DELETE'
           AND current_setting('app.audit_archival', true) = 'on' THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'audit_events is append-only; % is not permitted', TG_OP;
      END;
      $fn$ LANGUAGE plpgsql;
    `);
    await db.execute(
      sql`DROP TRIGGER IF EXISTS audit_events_no_mutation ON audit_events;`,
    );
    await db.execute(sql`
      CREATE TRIGGER audit_events_no_mutation
      BEFORE UPDATE OR DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION audit_events_prevent_mutation();
    `);
  } catch (err) {
    logger.error({ err }, "Failed to install audit immutability trigger");
  }
}

// Removes the append-only trigger so a controlled process (the seed) can reset
// the table. Callers must re-run ensureAuditImmutability afterwards.
export async function dropAuditImmutability(): Promise<void> {
  await db.execute(
    sql`DROP TRIGGER IF EXISTS audit_events_no_mutation ON audit_events;`,
  );
}
