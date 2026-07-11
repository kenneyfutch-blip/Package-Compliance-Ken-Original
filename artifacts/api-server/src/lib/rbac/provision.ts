import {
  db,
  usersTable,
  organizationsTable,
  permissionsTable,
  userPermissionsTable,
  suppliersTable,
  teamsTable,
  teamMembersTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { AuthContext } from "./context";
import {
  getRoleDef,
  permissionsForRole,
  DEFAULT_ROLE_KEY,
  ADMIN_EMAILS,
} from "./permissions";
import { logger } from "../logger";

const DEFAULT_ORG_SLUG = "dollar-tree";
const DEFAULT_ORG_NAME = "Dollar Tree";

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { ctx: AuthContext; expires: number }>();

export function invalidateAuthCache(clerkUserId?: string): void {
  if (clerkUserId) cache.delete(clerkUserId);
  else cache.clear();
}

async function resolveDefaultOrgId(): Promise<number> {
  const [existing] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.slug, DEFAULT_ORG_SLUG));
  if (existing) return existing.id;
  const [created] = await db
    .insert(organizationsTable)
    .values({ name: DEFAULT_ORG_NAME, slug: DEFAULT_ORG_SLUG })
    .onConflictDoNothing()
    .returning();
  if (created) return created.id;
  // Lost a race to create it — read it back.
  const [row] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.slug, DEFAULT_ORG_SLUG));
  return row!.id;
}

async function pickRoleForNewUser(
  email: string | null,
  organizationId: number,
): Promise<string> {
  if (email && ADMIN_EMAILS.includes(email.toLowerCase())) {
    return "platform_admin";
  }
  // Bootstrap: if the organization has no platform administrator yet, the first
  // user to sign in becomes one so the system is always administrable.
  const admins = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.organizationId, organizationId),
        eq(usersTable.roleKey, "platform_admin"),
      ),
    )
    .limit(1);
  if (admins.length === 0) return "platform_admin";
  return DEFAULT_ROLE_KEY;
}

// Ensures the user belongs to at least one team in their org. Every user must
// belong to a team; seed users get explicit teams, and runtime-provisioned
// users are added to a default team (created on demand) so the invariant holds.
async function ensureTeamMembership(
  userId: number,
  organizationId: number,
): Promise<void> {
  const [membership] = await db
    .select({ teamId: teamMembersTable.teamId })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.userId, userId))
    .limit(1);
  if (membership) return;

  let [team] = await db
    .select({ id: teamsTable.id })
    .from(teamsTable)
    .where(eq(teamsTable.organizationId, organizationId))
    .orderBy(teamsTable.id)
    .limit(1);
  if (!team) {
    const [created] = await db
      .insert(teamsTable)
      .values({
        organizationId,
        name: "General",
        description: "Default team for newly provisioned members.",
      })
      .returning({ id: teamsTable.id });
    team = created;
  }
  if (team) {
    await db
      .insert(teamMembersTable)
      .values({ teamId: team.id, userId })
      .onConflictDoNothing();
  }
}

async function resolvePermissions(
  userId: number,
  roleKey: string,
): Promise<Set<string>> {
  const base = new Set(permissionsForRole(roleKey));
  const overrides = await db
    .select({
      key: permissionsTable.key,
      granted: userPermissionsTable.granted,
    })
    .from(userPermissionsTable)
    .innerJoin(
      permissionsTable,
      eq(userPermissionsTable.permissionId, permissionsTable.id),
    )
    .where(eq(userPermissionsTable.userId, userId));
  for (const o of overrides) {
    if (o.granted) base.add(o.key);
    else base.delete(o.key);
  }
  return base;
}

async function buildContext(
  user: typeof usersTable.$inferSelect,
): Promise<AuthContext> {
  const roleDef = getRoleDef(user.roleKey);
  const permissions = await resolvePermissions(user.id, user.roleKey);
  const memberships = await db
    .select({ teamId: teamMembersTable.teamId })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.userId, user.id));
  const teamIds = memberships.map((m) => m.teamId);
  let supplierName: string | null = null;
  if (user.supplierId != null) {
    const [supplier] = await db
      .select({ name: suppliersTable.name })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, user.supplierId));
    supplierName = supplier?.name ?? null;
  }
  return {
    userId: user.id,
    clerkUserId: user.clerkUserId!,
    email: user.email,
    name: user.name,
    organizationId: user.organizationId!,
    roleKey: user.roleKey,
    roleName: roleDef?.name ?? user.role,
    permissions,
    supplierId: user.supplierId ?? null,
    supplierName,
    teamIds,
  };
}

// Upserts the authenticated caller into the users table (linking their Clerk id,
// organization, and role) and returns their resolved authorization context.
// Results are cached briefly to avoid a DB round-trip on every request.
export async function provisionUser(
  clerkUserId: string,
  email: string | null,
  name: string | null,
): Promise<AuthContext> {
  const cached = cache.get(clerkUserId);
  if (cached && cached.expires > Date.now()) return cached.ctx;

  const displayName = name?.trim() || (email ? email.split("@")[0]! : "User");

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId));

  let user: typeof usersTable.$inferSelect;
  if (existing) {
    // Keep name/email fresh; never downgrade role here (role changes go through
    // the admin surface in a later phase).
    if (existing.name !== displayName || existing.email !== (email ?? existing.email)) {
      const [updated] = await db
        .update(usersTable)
        .set({ name: displayName, email: email ?? existing.email })
        .where(eq(usersTable.id, existing.id))
        .returning();
      user = updated ?? existing;
    } else {
      user = existing;
    }
    // Backfill org for legacy rows that predate tenancy.
    if (user.organizationId == null) {
      const organizationId = await resolveDefaultOrgId();
      const [updated] = await db
        .update(usersTable)
        .set({ organizationId })
        .where(eq(usersTable.id, user.id))
        .returning();
      user = updated ?? user;
    }
  } else {
    const organizationId = await resolveDefaultOrgId();
    // Adopt a matching seed/demo row (same email, not yet linked) if present.
    const [seedRow] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email ?? "___no_email___"));
    if (seedRow && seedRow.clerkUserId == null) {
      const [linked] = await db
        .update(usersTable)
        .set({
          clerkUserId,
          name: displayName,
          organizationId: seedRow.organizationId ?? organizationId,
        })
        .where(eq(usersTable.id, seedRow.id))
        .returning();
      user = linked!;
    } else {
      const roleKey = await pickRoleForNewUser(email, organizationId);
      const roleDef = getRoleDef(roleKey);
      const [created] = await db
        .insert(usersTable)
        .values({
          clerkUserId,
          organizationId,
          name: displayName,
          email: email ?? "",
          roleKey,
          role: roleDef?.name ?? "Read Only User",
          status: "active",
          active: true,
        })
        .returning();
      user = created!;
      logger.info({ email, roleKey }, "Provisioned new user");
    }
  }

  await ensureTeamMembership(user.id, user.organizationId!);

  const ctx = await buildContext(user);
  cache.set(clerkUserId, { ctx, expires: Date.now() + CACHE_TTL_MS });
  return ctx;
}
