import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Enterprise role (e.g. Platform Administrator). `key` is the stable machine
// identifier used in code; `name` is the human label shown in the UI. `rank`
// orders roles by seniority (higher = more senior) for display/sorting.
export const rolesTable = pgTable("roles", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  rank: integer("rank").notNull().default(0),
  isSystem: boolean("is_system").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// A granular capability (e.g. packages:write). Referenced by permission key in
// route code and mapped to roles via role_permissions.
export const permissionsTable = pgTable("permissions", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  category: text("category").notNull().default("general"),
  description: text("description"),
});

export const rolePermissionsTable = pgTable(
  "role_permissions",
  {
    roleId: integer("role_id")
      .notNull()
      .references(() => rolesTable.id, { onDelete: "cascade" }),
    permissionId: integer("permission_id")
      .notNull()
      .references(() => permissionsTable.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

// Per-user permission overrides layered on top of the user's role. `granted`
// true adds a permission, false explicitly revokes one the role would grant.
export const userPermissionsTable = pgTable(
  "user_permissions",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    permissionId: integer("permission_id")
      .notNull()
      .references(() => permissionsTable.id, { onDelete: "cascade" }),
    granted: boolean("granted").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.permissionId] })],
);

export type RoleRow = typeof rolesTable.$inferSelect;
export type PermissionRow = typeof permissionsTable.$inferSelect;
export type RolePermissionRow = typeof rolePermissionsTable.$inferSelect;
export type UserPermissionRow = typeof userPermissionsTable.$inferSelect;
