import {
  db,
  departmentsTable,
  specialistProfilesTable,
  reviewStagesTable,
  teamsTable,
  usersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

// Tenant-isolation guard for cross-entity references. All of these entities use
// global serial IDs (not composite org FKs), so a write handler must confirm any
// referenced foreign ID belongs to the caller's organization before persisting
// it — otherwise a caller who guesses an ID could stitch in another tenant's row.
//
// A null/undefined reference is always allowed (it clears the link). Each helper
// returns true when the reference is absent or owned by the org, false when it
// points at a row outside the org (or a non-existent row).

export async function departmentInOrg(
  organizationId: number,
  id: number | null | undefined,
): Promise<boolean> {
  if (id === null || id === undefined) return true;
  const [row] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(and(eq(departmentsTable.id, id), eq(departmentsTable.organizationId, organizationId)))
    .limit(1);
  return !!row;
}

export async function specialistInOrg(
  organizationId: number,
  id: number | null | undefined,
): Promise<boolean> {
  if (id === null || id === undefined) return true;
  const [row] = await db
    .select({ id: specialistProfilesTable.id })
    .from(specialistProfilesTable)
    .where(
      and(
        eq(specialistProfilesTable.id, id),
        eq(specialistProfilesTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return !!row;
}

export async function reviewStageInOrg(
  organizationId: number,
  id: number | null | undefined,
): Promise<boolean> {
  if (id === null || id === undefined) return true;
  const [row] = await db
    .select({ id: reviewStagesTable.id })
    .from(reviewStagesTable)
    .where(
      and(eq(reviewStagesTable.id, id), eq(reviewStagesTable.organizationId, organizationId)),
    )
    .limit(1);
  return !!row;
}

export async function teamInOrg(
  organizationId: number,
  id: number | null | undefined,
): Promise<boolean> {
  if (id === null || id === undefined) return true;
  const [row] = await db
    .select({ id: teamsTable.id })
    .from(teamsTable)
    .where(and(eq(teamsTable.id, id), eq(teamsTable.organizationId, organizationId)))
    .limit(1);
  return !!row;
}

export async function userInOrg(
  organizationId: number,
  id: number | null | undefined,
): Promise<boolean> {
  if (id === null || id === undefined) return true;
  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, id), eq(usersTable.organizationId, organizationId)))
    .limit(1);
  return !!row;
}
