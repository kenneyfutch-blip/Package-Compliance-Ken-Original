import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";
import { departmentsTable } from "./departments";

// The Specialist Directory: the source of truth for reviewer identity, expertise,
// approval/escalation authority, and the AI Routing Profile a future routing agent
// consults to decide who reviews and approves packaging. A profile may optionally
// link to a login user (userId) but can also exist as a directory-only record.
export const specialistProfilesTable = pgTable("specialist_profiles", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  // Optional link to the platform login account for this specialist.
  userId: integer("user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),

  // Identity
  name: text("name").notNull(),
  email: text("email"),
  employeeId: text("employee_id"),
  photoUrl: text("photo_url"),
  jobTitle: text("job_title"),
  departmentId: integer("department_id").references(() => departmentsTable.id, {
    onDelete: "set null",
  }),
  managerName: text("manager_name"),
  location: text("location"),
  timeZone: text("time_zone"),

  // Directory role (e.g. Reviewer, Reviewer & Approver, Compliance Specialist).
  role: text("role").notNull().default("Reviewer"),
  // Lifecycle: active | disabled | archived. Disabled = temporarily out of
  // rotation; archived = removed from the directory but retained for history.
  status: text("status").notNull().default("active"),

  // ---- AI Routing Profile ----
  activeReviewer: boolean("active_reviewer").notNull().default(true),
  acceptingAssignments: boolean("accepting_assignments").notNull().default(true),
  routingPriority: integer("routing_priority").notNull().default(50), // 0-100, higher = preferred
  expertiseRating: integer("expertise_rating").notNull().default(3), // 1-5
  backupReviewer: boolean("backup_reviewer").notNull().default(false),
  escalationLevel: integer("escalation_level").notNull().default(1),
  approvalAuthority: boolean("approval_authority").notNull().default(false),
  maxActiveReviews: integer("max_active_reviews").notNull().default(5),

  // Multi-value attributes stored as JSON string arrays.
  expertise: jsonb("expertise")
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  regions: jsonb("regions")
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  productCategories: jsonb("product_categories")
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),

  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Certifications held by a specialist, with optional uploaded documentation stored
// in object storage (documentObjectPath is an /objects/... path, owner-guarded).
export const specialistCertificationsTable = pgTable(
  "specialist_certifications",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    specialistProfileId: integer("specialist_profile_id")
      .notNull()
      .references(() => specialistProfilesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    issuer: text("issuer"),
    // Dates stored as YYYY-MM-DD strings for simple form round-tripping.
    effectiveDate: text("effective_date"),
    expirationDate: text("expiration_date"),
    documentObjectPath: text("document_object_path"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type SpecialistProfileRow = typeof specialistProfilesTable.$inferSelect;
export type SpecialistCertificationRow =
  typeof specialistCertificationsTable.$inferSelect;
