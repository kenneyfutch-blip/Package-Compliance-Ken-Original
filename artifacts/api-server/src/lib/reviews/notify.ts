import { db, notificationsTable } from "@workspace/db";

export type NotificationType = "info" | "success" | "warning" | "critical";

export interface NotifyInput {
  organizationId: number;
  // Recipients. Nulls are ignored, and duplicates are collapsed, so callers can
  // pass assignee/backup/manager ids without pre-filtering. When the resolved
  // set is empty nothing is written.
  userIds: (number | null | undefined)[];
  packageId?: number | null;
  title: string;
  message: string;
  type?: NotificationType;
}

// Emit one per-user notification per distinct recipient. Best-effort and
// non-fatal: notification delivery must never roll back the assignment change
// that triggered it, so callers invoke this after their transaction commits.
export async function notifyUsers(input: NotifyInput): Promise<void> {
  const recipients = Array.from(
    new Set(input.userIds.filter((id): id is number => typeof id === "number")),
  );
  if (recipients.length === 0) return;
  await db.insert(notificationsTable).values(
    recipients.map((userId) => ({
      organizationId: input.organizationId,
      userId,
      packageId: input.packageId ?? null,
      title: input.title,
      message: input.message,
      type: input.type ?? "info",
    })),
  );
}
