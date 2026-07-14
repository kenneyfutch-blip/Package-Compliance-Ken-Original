import { db } from "@workspace/db";
import {
  usersTable,
  suppliersTable,
  supplierContactsTable,
  supplierSubmissionsTable,
  supplierScorecardsTable,
  supplierStatusHistoryTable,
  regulationsTable,
  notificationsTable,
  packagesTable,
  violationsTable,
  auditEventsTable,
  reportsTable,
  packageVersionsTable,
  annotationsTable,
  commentRepliesTable,
  reviewTasksTable,
  approvalDecisionsTable,
  aiProvidersTable,
  organizationsTable,
  rolesTable,
  permissionsTable,
  rolePermissionsTable,
  userPermissionsTable,
  teamsTable,
  teamMembersTable,
  glossaryEntriesTable,
  notificationStatesTable,
  notificationPreferencesTable,
  departmentsTable,
  specialistProfilesTable,
  specialistCertificationsTable,
  reviewStagesTable,
  routingRulesTable,
  escalationRulesTable,
  aiUsageTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { analyzePackaging } from "./lib/ai";
import { applyAnalysis, ensureInitialVersion } from "./lib/packageService";
import { logger } from "./lib/logger";
import {
  PERMISSIONS,
  ROLES,
  permissionsForRole,
  getRoleDef,
} from "./lib/rbac/permissions";
import { ensureAuditImmutability, dropAuditImmutability } from "./lib/audit";

const ORG = { name: "Dollar Tree", slug: "dollar-tree" };

// Maps legacy display role names to the enterprise role keys.
const ROLE_KEY_BY_LEGACY: Record<string, string> = {
  Administrator: "platform_admin",
  "Compliance Manager": "compliance_manager",
  "Compliance Reviewer": "compliance_specialist",
  "Packaging Manager": "packaging_manager",
  Designer: "designer",
  Auditor: "legal_reviewer",
  "Executive Viewer": "executive_viewer",
};

const users = [
  { name: "Dana Whitfield", email: "dana.whitfield@dollartree.com", legacyRole: "Administrator" },
  { name: "Marcus Lee", email: "marcus.lee@dollartree.com", legacyRole: "Compliance Manager" },
  { name: "Priya Nair", email: "priya.nair@dollartree.com", legacyRole: "Compliance Reviewer" },
  { name: "Sofia Alvarez", email: "sofia.alvarez@dollartree.com", legacyRole: "Packaging Manager" },
  { name: "Tom Becker", email: "tom.becker@dollartree.com", legacyRole: "Designer" },
  { name: "Rachel Kim", email: "rachel.kim@dollartree.com", legacyRole: "Auditor" },
  { name: "James Okafor", email: "james.okafor@dollartree.com", legacyRole: "Executive Viewer" },
];

const teams = [
  { name: "Food & Beverage Compliance", description: "Reviews food, beverage, and snack packaging." },
  { name: "Household & Chemicals", description: "Reviews household chemical and cleaning products." },
  { name: "Toys & Children Safety", description: "Reviews toys and children's product packaging." },
];

const suppliers = [
  { name: "Sunrise Packaging Co.", code: "SUP-1001", category: "Food & Beverage", riskLevel: "Low", contactEmail: "qa@sunrisepkg.com", country: "USA", complianceScore: 94, packagesReviewed: 128 },
  { name: "Golden Harvest Foods", code: "SUP-1002", category: "Food & Beverage", riskLevel: "Medium", contactEmail: "compliance@goldenharvest.cn", country: "China", complianceScore: 76, packagesReviewed: 84 },
  { name: "CleanCo Household", code: "SUP-1003", category: "Household Chemicals", riskLevel: "High", contactEmail: "regulatory@cleanco.com", country: "USA", complianceScore: 61, packagesReviewed: 57 },
  { name: "PlayWorks Toys", code: "SUP-1004", category: "Toys & Children", riskLevel: "High", contactEmail: "safety@playworks.com", country: "Vietnam", complianceScore: 68, packagesReviewed: 43 },
  { name: "PureGlow Cosmetics", code: "SUP-1005", category: "Cosmetics & Personal Care", riskLevel: "Medium", contactEmail: "hello@pureglow.com", country: "USA", complianceScore: 82, packagesReviewed: 39 },
];

const regulations = [
  { agency: "FDA", category: "Food Labeling", ruleCode: "21 CFR 101.9", title: "Nutrition Labeling of Food", summary: "Requires a Nutrition Facts panel with serving size, calories, and nutrient amounts in the FDA-specified format.", section: "101.9", source: "https://www.ecfr.gov/current/title-21/part-101", regulationText: "Nutrition information relating to food shall be presented using the Nutrition Facts format, including serving size, servings per container, calories, and quantitative amounts of specified nutrients per serving." },
  { agency: "FDA", category: "Allergen", ruleCode: "FALCPA", title: "Food Allergen Labeling and Consumer Protection Act", summary: "Requires the nine major food allergens to be clearly declared using their common names on food packaging.", section: "403(w)", source: "https://www.fda.gov/food/food-allergensgluten-free-guidance-documents-regulatory-information", regulationText: "The label of a food that contains a major food allergen must declare the presence of the allergen using the name of the food source, either in the ingredient list or in a separate Contains statement." },
  { agency: "FDA", category: "Food Labeling", ruleCode: "21 CFR 101.4", title: "Ingredient Declaration", summary: "Ingredients must be listed in descending order of predominance by weight using common or usual names.", section: "101.4", source: "https://www.ecfr.gov/current/title-21/part-101" },
  { agency: "FTC", category: "Marketing Claims", ruleCode: "16 CFR 260", title: "Green Guides", summary: "Environmental marketing claims such as biodegradable, recyclable, or eco-friendly must be substantiated and not deceptive.", section: "260.4", source: "https://www.ftc.gov/legal-library/browse/rules/green-guides" },
  { agency: "EPA", category: "Pesticides", ruleCode: "40 CFR 156.10", title: "FIFRA Labeling Requirements", summary: "Antimicrobial and pesticide products must display an EPA registration number, signal word, and precautionary statements.", section: "156.10", source: "https://www.epa.gov/pesticide-registration" },
  { agency: "CPSC", category: "Children's Products", ruleCode: "16 CFR 1500.19", title: "Small Parts / Choking Hazard Warnings", summary: "Toys and games for children under 3 or with small parts require specific choking hazard warning statements.", section: "1500.19", source: "https://www.cpsc.gov" },
  { agency: "CPSC", category: "Children's Products", ruleCode: "CPSIA", title: "Tracking Label Requirement", summary: "Children's products must bear a permanent tracking label with manufacturer, location, and date of production.", section: "103", source: "https://www.cpsc.gov" },
  { agency: "FTC", category: "Country of Origin", ruleCode: "19 CFR 134", title: "Country of Origin Marking", summary: "Imported articles must be conspicuously marked with the English name of the country of origin.", section: "134.11", source: "https://www.cbp.gov" },
];

const notifications = [
  { title: "High-risk package detected", message: "SKU DT-CLN-4471 flagged with 2 critical EPA violations. Immediate review required.", type: "critical", read: false },
  { title: "Bulk analysis complete", message: "Overnight batch of 12 packages finished processing. 4 passed, 5 failed, 3 need review.", type: "info", read: false },
  { title: "New regulation added", message: "FTC Green Guides (16 CFR 260) was added to the knowledge base.", type: "info", read: false },
  { title: "Supplier score changed", message: "CleanCo Household compliance score dropped below 65%.", type: "warning", read: true },
];

type SeedPackage = {
  sku: string;
  upc: string;
  name: string;
  brand: string;
  vendor: string;
  category: string;
  country: string;
  netWeight: string;
  dimensions: string;
  packageType: string;
  productType: string;
  manufacturingRegion: string;
  reviewer: string;
  extractedText: string;
  artworkUrl: string;
};

const seedPackages: SeedPackage[] = [
  {
    sku: "DT-SNK-2201", upc: "071912004417", name: "Cheddar Cheese Crackers", brand: "Snack Time", vendor: "Golden Harvest Foods", category: "Food & Beverage", country: "USA", netWeight: "6 oz (170g)", dimensions: "8 x 5 x 2 in", packageType: "Flexible Film Bag", productType: "Baked Snack", manufacturingRegion: "China", reviewer: "Priya Nair", artworkUrl: "/artwork/pkg-1.png",
    extractedText: `SNACK TIME CHEDDAR CHEESE CRACKERS\nNOW WITH 100% REAL CHEESE!\nNet Wt 6oz\nIngredients: Enriched flour, vegetable oil, cheddar cheese, salt, whey, spices, natural flavor.\nManufactured for Snack Time Brands, distributed by Golden Harvest Foods.\nBest by date printed on back.\nMade in China`,
  },
  {
    sku: "DT-CLN-4471", upc: "071912044718", name: "Ultra Power Disinfectant Spray", brand: "CleanCo", vendor: "CleanCo Household", category: "Household Chemicals", country: "USA", netWeight: "12 fl oz (355 mL)", dimensions: "9 x 3 x 3 in", packageType: "Aerosol Can", productType: "Antimicrobial Spray", manufacturingRegion: "USA", reviewer: "Marcus Lee", artworkUrl: "/artwork/pkg-2.png",
    extractedText: `CLEANCO ULTRA POWER DISINFECTANT SPRAY\nKILLS 99.9% OF GERMS INSTANTLY\nAll natural and completely safe for kids and pets!\nDirections: Spray on surface and wipe.\nContents: 12 fl oz\nDistributed by CleanCo Household, USA`,
  },
  {
    sku: "DT-TOY-8890", upc: "071912088905", name: "Mini Building Blocks Set", brand: "PlayWorks", vendor: "PlayWorks Toys", category: "Toys & Children", country: "USA", netWeight: "0.5 lb", dimensions: "10 x 7 x 2 in", packageType: "Blister Card", productType: "Construction Toy", manufacturingRegion: "Vietnam", reviewer: "Sofia Alvarez", artworkUrl: "/artwork/pkg-3.png",
    extractedText: `PLAYWORKS MINI BUILDING BLOCKS\n120 Pieces of Creative Fun!\nGreat for ages 3+\nBuild houses, cars, animals and more.\nColors may vary.\nDistributed by PlayWorks Toys\nMade in Vietnam`,
  },
  {
    sku: "DT-COS-3312", upc: "071912033127", name: "Hydrating Face Cream", brand: "PureGlow", vendor: "PureGlow Cosmetics", category: "Cosmetics & Personal Care", country: "USA", netWeight: "1.7 oz (50g)", dimensions: "3 x 3 x 3 in", packageType: "Plastic Jar", productType: "Skin Moisturizer", manufacturingRegion: "USA", reviewer: "Priya Nair", artworkUrl: "/artwork/pkg-4.png",
    extractedText: `PUREGLOW HYDRATING FACE CREAM\nClinically proven to reverse aging in 7 days!\nReduces wrinkles 100%.\nApply daily to clean skin.\nIngredients: Water, glycerin, shea butter, fragrance, tocopherol.\n1.7 oz\nMade in USA`,
  },
  {
    sku: "DT-BEV-5540", upc: "071912055401", name: "Tropical Fruit Punch Drink Mix", brand: "Sunrise", vendor: "Sunrise Packaging Co.", category: "Food & Beverage", country: "USA", netWeight: "4.2 oz (119g)", dimensions: "6 x 4 x 1 in", packageType: "Carton", productType: "Powdered Drink Mix", manufacturingRegion: "USA", reviewer: "Rachel Kim", artworkUrl: "/artwork/pkg-5.png",
    extractedText: `SUNRISE TROPICAL FRUIT PUNCH DRINK MIX\nMakes 8 quarts\nNutrition Facts: Serving size 1 scoop (8g), Calories 30, Total Sugars 7g, Sodium 15mg.\nIngredients: Sugar, citric acid, natural and artificial flavors, red 40, blue 1.\nContains: no major allergens.\nManufactured by Sunrise Packaging Co., Springfield, IL, USA.\nNet Wt 4.2 oz (119g)`,
  },
  {
    sku: "DT-SNK-2208", upc: "071912022084", name: "Milk Chocolate Peanut Bar", brand: "Snack Time", vendor: "Golden Harvest Foods", category: "Food & Beverage", country: "USA", netWeight: "1.5 oz (43g)", dimensions: "5 x 2 x 0.5 in", packageType: "Flexible Film Wrap", productType: "Confection", manufacturingRegion: "China", reviewer: "Priya Nair", artworkUrl: "/artwork/pkg-6.png",
    extractedText: `SNACK TIME MILK CHOCOLATE PEANUT BAR\nDeliciously smooth!\nIngredients: Milk chocolate (sugar, cocoa butter, milk, chocolate liquor), peanuts, sugar.\nNet Wt 1.5 oz\nManufactured for Snack Time Brands.\nMade in China`,
  },
];

// Reset tenant data for a fresh demo. Global reference data (permissions,
// roles, role-permission mappings, regulations, AI providers) is intentionally
// preserved. NOTE: this clears ALL tenant-scoped tables, not a single org — it
// is only ever reached via seedDemo(), which refuses to run outside
// development/staging/test, so it can never touch a production database. In
// dev/staging the demo org is the only tenant; do not run the demo seed in an
// environment that holds real customer data.
async function clearDemo() {
  // Audit is append-only in normal operation; drop the guard so the reset can
  // clear it, then the caller reinstalls it once seeding completes.
  await dropAuditImmutability();
  // Specialist Directory & Routing Engine (child → parent).
  await db.delete(escalationRulesTable);
  await db.delete(routingRulesTable);
  await db.delete(reviewStagesTable);
  await db.delete(specialistCertificationsTable);
  await db.delete(specialistProfilesTable);
  await db.delete(departmentsTable);
  await db.delete(notificationStatesTable);
  await db.delete(notificationPreferencesTable);
  await db.delete(teamMembersTable);
  await db.delete(teamsTable);
  await db.delete(userPermissionsTable);
  await db.delete(commentRepliesTable);
  await db.delete(annotationsTable);
  await db.delete(reviewTasksTable);
  await db.delete(approvalDecisionsTable);
  await db.delete(packageVersionsTable);
  await db.delete(violationsTable);
  await db.delete(reportsTable);
  await db.delete(auditEventsTable);
  await db.delete(glossaryEntriesTable);
  await db.delete(supplierContactsTable);
  await db.delete(supplierScorecardsTable);
  await db.delete(supplierStatusHistoryTable);
  await db.delete(supplierSubmissionsTable);
  await db.delete(packagesTable);
  await db.delete(suppliersTable);
  await db.delete(notificationsTable);
  // ai_usage has a non-cascade org FK, so it must be cleared before the org row.
  await db.delete(aiUsageTable);
  await db.delete(usersTable);
  await db.delete(organizationsTable);
}

async function currentVersionId(packageId: number): Promise<number | null> {
  const [v] = await db
    .select()
    .from(packageVersionsTable)
    .where(
      and(
        eq(packageVersionsTable.packageId, packageId),
        eq(packageVersionsTable.isCurrent, true),
      ),
    );
  return v?.id ?? null;
}

/**
 * Seed human collaboration data: reviewer comments with threads and mentions,
 * manual review tasks, approval decisions, and a second artwork version so the
 * A/B compare feature has something to diff.
 */
async function seedCollaboration(regs: Parameters<typeof analyzePackaging>[1]) {
  const bySku = new Map<string, number>();
  for (const p of await db.select().from(packagesTable)) {
    bySku.set(p.sku, p.id);
  }

  // --- Disinfectant: reviewer thread + task + needs-revision decision -------
  const cleanId = bySku.get("DT-CLN-4471");
  if (cleanId) {
    const vId = await currentVersionId(cleanId);
    const [ann] = await db
      .insert(annotationsTable)
      .values({
        packageId: cleanId,
        versionId: vId,
        type: "pin",
        page: 0,
        x: 0.5,
        y: 0.42,
        color: "#3b82f6",
        author: "Marcus Lee",
        authorRole: "Compliance Manager",
        text: "The 'all natural and completely safe for kids and pets' claim conflicts with EPA antimicrobial labeling. @Priya Nair please confirm precautionary statements are added.",
        priority: "high",
        status: "open",
        source: "human",
        mentions: ["Priya Nair"],
      })
      .returning();
    if (ann) {
      await db.insert(commentRepliesTable).values({
        annotationId: ann.id,
        author: "Priya Nair",
        authorRole: "Compliance Reviewer",
        text: "Agreed — we need the EPA registration number and signal word before this can move forward.",
        source: "human",
        mentions: [],
      });
    }
    await db.insert(reviewTasksTable).values({
      packageId: cleanId,
      versionId: vId,
      title: "Add EPA registration number and precautionary statements",
      description:
        "Antimicrobial spray must display EPA reg number, signal word, and precautionary statements per 40 CFR 156.10.",
      assignedRole: "EPA Specialist",
      assignee: "Marcus Lee",
      priority: "high",
      status: "open",
      source: "manual",
    });
    await db.insert(approvalDecisionsTable).values({
      packageId: cleanId,
      versionId: vId,
      decision: "needs_revision",
      reviewer: "Marcus Lee",
      reviewerRole: "Compliance Manager",
      note: "Blocking EPA labeling issues must be resolved before approval.",
    });
    await db
      .update(packagesTable)
      .set({ approvalStatus: "Needs Revision" })
      .where(eq(packagesTable.id, cleanId));
    await db.insert(auditEventsTable).values({
      packageId: cleanId,
      actor: "Marcus Lee",
      action: "Decision: Needs revision",
      detail: "Blocking EPA labeling issues must be resolved before approval.",
    });
  }

  // --- Face cream: critical claim comment + rejection ----------------------
  const cosId = bySku.get("DT-COS-3312");
  if (cosId) {
    const vId = await currentVersionId(cosId);
    const [ann] = await db
      .insert(annotationsTable)
      .values({
        packageId: cosId,
        versionId: vId,
        type: "highlight",
        page: 0,
        x: 0.5,
        y: 0.28,
        w: 0.6,
        h: 0.08,
        color: "#3b82f6",
        author: "Priya Nair",
        authorRole: "Compliance Reviewer",
        text: "'Clinically proven to reverse aging in 7 days' and 'Reduces wrinkles 100%' are unsubstantiated drug claims. @Marcus Lee flagging for Legal review.",
        priority: "critical",
        status: "open",
        source: "human",
        mentions: ["Marcus Lee"],
      })
      .returning();
    if (ann) {
      await db.insert(commentRepliesTable).values({
        annotationId: ann.id,
        author: "Marcus Lee",
        authorRole: "Compliance Manager",
        text: "Confirmed. These claims cross into drug territory (FDA). Rejecting until Marketing revises.",
        source: "human",
        mentions: [],
      });
    }
    await db.insert(approvalDecisionsTable).values({
      packageId: cosId,
      versionId: vId,
      decision: "reject",
      reviewer: "Marcus Lee",
      reviewerRole: "Compliance Manager",
      note: "Unsubstantiated anti-aging drug claims.",
    });
    await db
      .update(packagesTable)
      .set({ approvalStatus: "Rejected", status: "Rejected" })
      .where(eq(packagesTable.id, cosId));
    await db.insert(auditEventsTable).values({
      packageId: cosId,
      actor: "Marcus Lee",
      action: "Decision: Rejected",
      detail: "Unsubstantiated anti-aging drug claims.",
    });
  }

  // --- Crackers: add a revised version 2 for A/B compare -------------------
  const snackId = bySku.get("DT-SNK-2201");
  if (snackId) {
    const [pkg] = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.id, snackId));
    if (pkg) {
      const revisedText = `SNACK TIME CHEDDAR CHEESE CRACKERS\nMADE WITH REAL CHEESE\nNet Wt 6 oz (170g)\nINGREDIENTS: Enriched flour (wheat), vegetable oil, cheddar cheese (milk), salt, whey (milk), spices, natural flavor.\nCONTAINS: Wheat, Milk.\nNutrition Facts: Serving size 16 crackers (30g), Servings per container about 5, Calories 150.\nManufactured for Snack Time Brands, distributed by Golden Harvest Foods, Springfield, IL.\nBEST BY date printed on back panel.\nProduct of China`;
      await db
        .update(packageVersionsTable)
        .set({ isCurrent: false })
        .where(eq(packageVersionsTable.packageId, snackId));
      const [v2] = await db
        .insert(packageVersionsTable)
        .values({
          packageId: snackId,
          versionNumber: 2,
          label: "Version 2 (revised copy)",
          fileUrl: pkg.artworkUrl,
          fileName: pkg.artworkUrl ? pkg.artworkUrl.split("/").pop() : null,
          fileType: "png",
          pageCount: 1,
          extractedText: revisedText,
          notes: "Added allergen Contains statement, Nutrition Facts, corrected origin wording.",
          isCurrent: true,
          createdBy: "Tom Becker",
        })
        .returning();
      await db
        .update(packagesTable)
        .set({ extractedText: revisedText, approvalStatus: "Pending" })
        .where(eq(packagesTable.id, snackId));
      await db.insert(auditEventsTable).values({
        packageId: snackId,
        actor: "Tom Becker",
        action: "Version added",
        detail: "Version 2 (revised copy) uploaded with allergen and nutrition corrections.",
      });
      if (v2) {
        try {
          const [refreshed] = await db
            .select()
            .from(packagesTable)
            .where(eq(packagesTable.id, snackId));
          const result = await analyzePackaging(refreshed!, regs);
          await applyAnalysis(refreshed!, result, v2.id);
        } catch (err) {
          logger.error({ err }, "Seed v2 analysis failed");
        }
      }
    }
  }
}

// Production-safe, idempotent baseline: the config a live environment needs but
// that contains NO fictional/demo content. Safe to run repeatedly and safe to
// run in production. Never deletes anything.
export async function seedReference() {
  logger.info("Seeding reference data...");

  // Permissions (idempotent by unique key)
  await db
    .insert(permissionsTable)
    .values(PERMISSIONS)
    .onConflictDoNothing({ target: permissionsTable.key });
  const insertedPerms = await db.select().from(permissionsTable);
  const permIdByKey = new Map(insertedPerms.map((p) => [p.key, p.id]));

  // Roles (idempotent by unique key)
  await db
    .insert(rolesTable)
    .values(
      ROLES.map((r) => ({
        key: r.key,
        name: r.name,
        description: r.description,
        rank: r.rank,
        isSystem: true,
      })),
    )
    .onConflictDoNothing({ target: rolesTable.key });
  const insertedRoles = await db.select().from(rolesTable);
  const roleIdByKey = new Map(insertedRoles.map((r) => [r.key, r.id]));

  // Role → permission mappings, derived from code (idempotent by composite PK)
  const rolePermRows: { roleId: number; permissionId: number }[] = [];
  for (const role of ROLES) {
    const roleId = roleIdByKey.get(role.key);
    if (!roleId) continue;
    for (const permKey of permissionsForRole(role.key)) {
      const permissionId = permIdByKey.get(permKey);
      if (permissionId) rolePermRows.push({ roleId, permissionId });
    }
  }
  if (rolePermRows.length) {
    await db
      .insert(rolePermissionsTable)
      .values(rolePermRows)
      .onConflictDoNothing();
  }

  // Global federal regulations baseline — add only rules not already present so
  // any eCFR-synced rules are left untouched.
  const existingRegs = await db
    .select({ ruleCode: regulationsTable.ruleCode })
    .from(regulationsTable);
  const existingCodes = new Set(existingRegs.map((r) => r.ruleCode));
  const missingRegs = regulations.filter((r) => !existingCodes.has(r.ruleCode));
  if (missingRegs.length) {
    await db.insert(regulationsTable).values(missingRegs);
  }

  // Managed AI provider — only when none is configured yet (respects the
  // single-active invariant).
  const existingProviders = await db
    .select({ id: aiProvidersTable.id })
    .from(aiProvidersTable);
  if (existingProviders.length === 0) {
    await db.insert(aiProvidersTable).values({
      name: "Replit-managed OpenAI",
      providerType: "openai",
      model: "gpt-5.4",
      managed: true,
      active: true,
      status: "connected",
      statusMessage: "Built-in Replit AI integration",
    });
  }

  logger.info("Reference data ready.");
}

// Fictional demo tenant ("Dollar Tree") and all its sample content. DEV/STAGING
// ONLY — refuses to run in production so a live deploy never loads demo data.
export async function seedDemo() {
  // Hard block: demo data may load ONLY in a recognized non-production
  // environment. Production AND an unset/misconfigured NODE_ENV both count as
  // unsafe and are refused, so demo content can never reach a live database.
  const env = process.env.NODE_ENV;
  if (env !== "development" && env !== "staging" && env !== "test") {
    throw new Error(
      `Refusing to seed demo data: NODE_ENV="${env ?? "(unset)"}" is not a ` +
        "recognized non-production environment (development | staging | test). " +
        "Demo content must never be loaded into a live database — run the " +
        "reference seed instead.",
    );
  }
  logger.info("Seeding demo data...");

  // Reference data (permissions, roles, regulations, AI provider) must exist
  // first — the demo package analysis reasons against the regulations.
  await seedReference();

  // Reset demo-scoped data only; global reference data is preserved.
  await clearDemo();

  // Organization (demo tenant)
  const [org] = await db.insert(organizationsTable).values(ORG).returning();
  const orgId = org!.id;

  // Teams
  const insertedTeams = await db
    .insert(teamsTable)
    .values(teams.map((t) => ({ ...t, organizationId: orgId })))
    .returning();

  // Users (scoped to org, with enterprise role keys)
  const insertedUsers = await db
    .insert(usersTable)
    .values(
      users.map((u) => {
        const roleKey = ROLE_KEY_BY_LEGACY[u.legacyRole] ?? "read_only";
        return {
          name: u.name,
          email: u.email,
          organizationId: orgId,
          roleKey,
          role: getRoleDef(roleKey)?.name ?? "Read Only User",
          status: "active",
          active: true,
        };
      }),
    )
    .returning();

  // Assign a few users to teams as a starting point.
  const teamMemberRows: { teamId: number; userId: number }[] = [];
  if (insertedTeams[0]) {
    for (const email of ["marcus.lee@dollartree.com", "priya.nair@dollartree.com", "rachel.kim@dollartree.com"]) {
      const u = insertedUsers.find((x) => x.email === email);
      if (u) teamMemberRows.push({ teamId: insertedTeams[0].id, userId: u.id });
    }
  }
  if (insertedTeams[1]) {
    const u = insertedUsers.find((x) => x.email === "marcus.lee@dollartree.com");
    if (u) teamMemberRows.push({ teamId: insertedTeams[1].id, userId: u.id });
  }
  if (insertedTeams[2]) {
    const u = insertedUsers.find((x) => x.email === "sofia.alvarez@dollartree.com");
    if (u) teamMemberRows.push({ teamId: insertedTeams[2].id, userId: u.id });
  }
  if (teamMemberRows.length) {
    await db.insert(teamMembersTable).values(teamMemberRows);
  }

  // ---- Specialist Directory & Routing Engine (demo tenant) ----
  const userByEmail = (email: string) =>
    insertedUsers.find((u) => u.email === email) ?? null;

  const insertedDepartments = await db
    .insert(departmentsTable)
    .values([
      {
        organizationId: orgId,
        name: "Compliance",
        description: "Owns packaging compliance review and final approvals.",
        leaderUserId: userByEmail("marcus.lee@dollartree.com")?.id ?? null,
        escalationOwnerUserId: userByEmail("dana.whitfield@dollartree.com")?.id ?? null,
      },
      {
        organizationId: orgId,
        name: "Packaging",
        description: "Artwork, dieline, and barcode verification for packaging.",
        leaderUserId: userByEmail("sofia.alvarez@dollartree.com")?.id ?? null,
        escalationOwnerUserId: userByEmail("marcus.lee@dollartree.com")?.id ?? null,
      },
      {
        organizationId: orgId,
        name: "Regulatory Affairs",
        description: "FDA, USDA, and federal labeling regulation specialists.",
        leaderUserId: userByEmail("rachel.kim@dollartree.com")?.id ?? null,
        escalationOwnerUserId: userByEmail("dana.whitfield@dollartree.com")?.id ?? null,
      },
      {
        organizationId: orgId,
        name: "Legal",
        description: "Marketing claims and legal review of packaging language.",
        leaderUserId: userByEmail("dana.whitfield@dollartree.com")?.id ?? null,
        escalationOwnerUserId: userByEmail("dana.whitfield@dollartree.com")?.id ?? null,
      },
    ])
    .returning();
  const deptId = (name: string) =>
    insertedDepartments.find((d) => d.name === name)?.id ?? null;

  // Five real reviewers seeded as directory-only profiles (no login link).
  const insertedSpecialists = await db
    .insert(specialistProfilesTable)
    .values([
      {
        organizationId: orgId,
        name: "Shantel Woody",
        jobTitle: "Manager, Packaging Compliance",
        role: "Compliance Reviewer & Approver",
        departmentId: deptId("Compliance"),
        managerName: "Dana Whitfield",
        location: "Chesapeake, VA",
        status: "active",
        activeReviewer: true,
        acceptingAssignments: true,
        approvalAuthority: true,
        escalationLevel: 3,
        routingPriority: 90,
        expertiseRating: 5,
        maxActiveReviews: 8,
        expertise: ["Packaging Compliance", "Final Approvals", "Label Regulations"],
        regions: ["US"],
        productCategories: ["Food & Beverage", "Household Chemicals", "Cosmetics & Personal Care"],
        notes: "Final approval authority for packaging compliance.",
      },
      {
        organizationId: orgId,
        name: "Laura Bolt",
        jobTitle: "Senior Regulatory Specialist",
        role: "Regulatory Reviewer & Approver",
        departmentId: deptId("Regulatory Affairs"),
        managerName: "Rachel Kim",
        location: "Chesapeake, VA",
        status: "active",
        activeReviewer: true,
        acceptingAssignments: true,
        approvalAuthority: true,
        escalationLevel: 2,
        routingPriority: 80,
        expertiseRating: 5,
        maxActiveReviews: 6,
        expertise: ["FDA Regulations", "Allergen Labeling", "Nutrition Facts"],
        regions: ["US"],
        productCategories: ["Food & Beverage"],
        notes: "Lead reviewer for FDA-regulated food labeling.",
      },
      {
        organizationId: orgId,
        name: "Alice Rees",
        jobTitle: "Packaging Compliance Analyst",
        role: "Reviewer",
        departmentId: deptId("Packaging"),
        managerName: "Sofia Alvarez",
        location: "Remote",
        status: "active",
        activeReviewer: true,
        acceptingAssignments: true,
        approvalAuthority: false,
        escalationLevel: 1,
        routingPriority: 60,
        expertiseRating: 4,
        maxActiveReviews: 5,
        expertise: ["Artwork Review", "Barcode Verification", "Dieline Compliance"],
        regions: ["US"],
        productCategories: ["Food & Beverage", "Toys & Children"],
        notes: "First-pass packaging artwork and barcode checks.",
      },
      {
        organizationId: orgId,
        name: "Eric Blanchette",
        jobTitle: "Legal & Claims Reviewer",
        role: "Legal Reviewer & Approver",
        departmentId: deptId("Legal"),
        managerName: "Dana Whitfield",
        location: "Chesapeake, VA",
        status: "active",
        activeReviewer: true,
        acceptingAssignments: true,
        approvalAuthority: true,
        escalationLevel: 2,
        routingPriority: 75,
        expertiseRating: 4,
        maxActiveReviews: 5,
        expertise: ["Marketing Claims", "FTC Compliance", "Legal Review"],
        regions: ["US"],
        productCategories: ["Food & Beverage", "Cosmetics & Personal Care"],
        notes: "Reviews substantiation of marketing and health claims.",
      },
      {
        organizationId: orgId,
        name: "Megan Everding",
        jobTitle: "Compliance Specialist",
        role: "Reviewer",
        departmentId: deptId("Compliance"),
        managerName: "Marcus Lee",
        location: "Remote",
        status: "active",
        activeReviewer: true,
        acceptingAssignments: true,
        approvalAuthority: false,
        escalationLevel: 1,
        routingPriority: 55,
        expertiseRating: 4,
        maxActiveReviews: 6,
        expertise: ["Household Chemicals", "EPA Labeling", "Safety Warnings"],
        regions: ["US"],
        productCategories: ["Household Chemicals"],
        notes: "Specialist for EPA-regulated household chemical labeling.",
      },
    ])
    .returning();
  const specId = (name: string) =>
    insertedSpecialists.find((s) => s.name === name)?.id ?? null;

  const shantelId = specId("Shantel Woody");
  const lauraId = specId("Laura Bolt");
  await db.insert(specialistCertificationsTable).values([
    ...(shantelId
      ? [{
          organizationId: orgId,
          specialistProfileId: shantelId,
          name: "Certified Packaging Professional (CPP)",
          issuer: "Institute of Packaging Professionals",
          effectiveDate: "2022-03-01",
          expirationDate: "2027-03-01",
        }]
      : []),
    ...(lauraId
      ? [{
          organizationId: orgId,
          specialistProfileId: lauraId,
          name: "Regulatory Affairs Certification (RAC)",
          issuer: "Regulatory Affairs Professionals Society",
          effectiveDate: "2021-06-15",
          expirationDate: "2026-06-15",
        }]
      : []),
  ]);

  // Default review pipeline.
  await db.insert(reviewStagesTable).values([
    { organizationId: orgId, name: "Packaging Review", stageOrder: 1, assignedDepartmentId: deptId("Packaging"), approvalAuthority: "Packaging Analyst", slaHours: 24, escalationPath: "Escalate to Packaging lead after SLA breach." },
    { organizationId: orgId, name: "Compliance Review", stageOrder: 2, assignedDepartmentId: deptId("Compliance"), approvalAuthority: "Compliance Specialist", slaHours: 48, escalationPath: "Escalate to Compliance manager after SLA breach." },
    { organizationId: orgId, name: "Regulatory Review", stageOrder: 3, assignedDepartmentId: deptId("Regulatory Affairs"), approvalAuthority: "Regulatory Specialist", slaHours: 48, escalationPath: "Escalate to Regulatory lead after SLA breach." },
    { organizationId: orgId, name: "Final Approval", stageOrder: 4, assignedSpecialistId: shantelId, approvalAuthority: "Compliance Approver", slaHours: 24, escalationPath: "Escalate to Director." },
  ]);

  // Routing rules — first match (lowest priority number) wins.
  await db.insert(routingRulesTable).values([
    { organizationId: orgId, name: "Food & Beverage → Regulatory Affairs", description: "Food labeling requires FDA regulatory review.", priority: 10, conditions: [{ field: "category", operator: "equals", value: "Food & Beverage" }], actionType: "department", actionDepartmentId: deptId("Regulatory Affairs") },
    { organizationId: orgId, name: "Household Chemicals → Megan Everding", description: "EPA-regulated household chemicals route to the chemicals specialist.", priority: 20, conditions: [{ field: "category", operator: "equals", value: "Household Chemicals" }], actionType: "specialist", actionSpecialistId: specId("Megan Everding") },
    { organizationId: orgId, name: "Marketing claims → Legal", description: "Packages with marketing claims need legal review.", priority: 30, conditions: [{ field: "hasClaims", operator: "equals", value: "true" }], actionType: "specialist", actionSpecialistId: specId("Eric Blanchette") },
    { organizationId: orgId, name: "Default → Compliance", description: "Catch-all: unmatched work goes to Compliance.", priority: 100, conditions: [], actionType: "department", actionDepartmentId: deptId("Compliance") },
  ]);

  // Escalation matrix — ordered; first matching trigger applies.
  await db.insert(escalationRulesTable).values([
    { organizationId: orgId, name: "Critical finding → Final approver", matrixOrder: 1, triggerType: "severity", triggerOperator: "equals", triggerValue: "Critical", escalateToLevel: 3, escalateToSpecialistId: shantelId },
    { organizationId: orgId, name: "SLA breach → Compliance", matrixOrder: 2, triggerType: "sla_breach", triggerOperator: "greaterOrEqual", triggerValue: "24", escalateToLevel: 2, escalateToDepartmentId: deptId("Compliance") },
    { organizationId: orgId, name: "High risk score → Director", matrixOrder: 3, triggerType: "risk_score", triggerOperator: "greaterOrEqual", triggerValue: "90", escalateToLevel: 3, escalateToRole: "Director" },
  ]);

  const insertedSuppliers = await db
    .insert(suppliersTable)
    .values(suppliers.map((s) => ({ ...s, organizationId: orgId })))
    .returning();

  // Seed supplier sub-entities against the first few suppliers so the supplier
  // architecture (contacts, submissions, reviews, scorecards, lifecycle) is
  // demonstrable out of the box.
  const supById = (code: string) =>
    insertedSuppliers.find((s) => s.code === code) ?? insertedSuppliers[0]!;
  const sunrise = supById("SUP-1001");
  const golden = supById("SUP-1002");
  const cleanco = supById("SUP-1003");

  await db.insert(supplierContactsTable).values([
    { organizationId: orgId, supplierId: sunrise.id, name: "Maria Santos", title: "QA Director", email: "maria@sunrisepkg.com", phone: "+1 555 0101", isPrimary: true },
    { organizationId: orgId, supplierId: sunrise.id, name: "Devon Clarke", title: "Regulatory Lead", email: "devon@sunrisepkg.com", isPrimary: false },
    { organizationId: orgId, supplierId: golden.id, name: "Li Wei", title: "Compliance Manager", email: "liwei@goldenharvest.cn", isPrimary: true },
    { organizationId: orgId, supplierId: cleanco.id, name: "Sarah Brooks", title: "Regulatory Affairs", email: "sarah@cleanco.com", phone: "+1 555 0199", isPrimary: true },
  ]);

  await db.insert(supplierScorecardsTable).values([
    { organizationId: orgId, supplierId: sunrise.id, period: "2026-Q1", overallScore: 94, qualityScore: 96, complianceScore: 93, timelinessScore: 92, submissionsCount: 18, approvedCount: 16, rejectedCount: 2, recordedByName: "System", notes: "Consistently strong performer." },
    { organizationId: orgId, supplierId: golden.id, period: "2026-Q1", overallScore: 76, qualityScore: 74, complianceScore: 78, timelinessScore: 76, submissionsCount: 12, approvedCount: 8, rejectedCount: 4, recordedByName: "System", notes: "Allergen declarations need attention." },
    { organizationId: orgId, supplierId: cleanco.id, period: "2026-Q1", overallScore: 61, qualityScore: 58, complianceScore: 60, timelinessScore: 65, submissionsCount: 9, approvedCount: 4, rejectedCount: 5, recordedByName: "System", notes: "High-risk; EPA labeling issues recurring." },
  ]);

  await db.insert(supplierStatusHistoryTable).values([
    { organizationId: orgId, supplierId: sunrise.id, fromStatus: "Prospective", toStatus: "Active", reason: "Passed onboarding audit.", actorName: "System" },
    { organizationId: orgId, supplierId: cleanco.id, fromStatus: "Active", toStatus: "Active", reason: "Under enhanced monitoring due to score decline.", actorName: "System" },
  ]);

  await db.insert(supplierSubmissionsTable).values([
    { organizationId: orgId, supplierId: sunrise.id, submittedByName: "Maria Santos", title: "Organic Granola pouch v2", category: "Food & Beverage", notes: "Updated nutrition panel per new serving size.", status: "Approved", reviewerName: "Compliance Team", reviewNotes: "Panel formatting verified.", reviewedAt: new Date() },
    { organizationId: orgId, supplierId: golden.id, submittedByName: "Li Wei", title: "Snack mix carton", category: "Food & Beverage", notes: "New product line.", status: "ChangesRequested", reviewerName: "Compliance Team", reviewNotes: "Add Contains statement for tree nuts (FALCPA)." },
    { organizationId: orgId, supplierId: cleanco.id, submittedByName: "Sarah Brooks", title: "Multi-surface cleaner label", category: "Household Chemicals", notes: "Reformulated product.", status: "Submitted" },
  ]);
  // Reference regulations were loaded by seedReference(); read them back so the
  // AI analysis below can reason against them.
  const insertedRegs = await db.select().from(regulationsTable);

  // Approved Language & Glossary library — the wording reviewers must reuse and
  // that the AI language review reasons against.
  await db.insert(glossaryEntriesTable).values(
    [
      {
        term: "Contains: Soy",
        approvedValue:
          "Contains: Soy. (Use exact FALCPA \"Contains\" statement immediately after the ingredient list.)",
        category: "Required Statement",
        regulatoryReference: "FDA 21 CFR 101 (FALCPA)",
        notes: "Mandatory when soy is present. Do not paraphrase.",
      },
      {
        term: "May contain traces of tree nuts",
        approvedValue: "May contain tree nuts.",
        category: "Allergen & Warning",
        regulatoryReference: "FDA FALCPA advisory labeling",
        notes: "Use only advisory phrasing; never substitute for a required Contains statement.",
      },
      {
        term: "Non-GMO",
        approvedValue:
          "Made with non-GMO ingredients (not verified by a third party unless the Non-GMO Project seal is present).",
        category: "Approved Claim",
        regulatoryReference: "USDA BE / FTC Green Guides",
        notes: "Only use the seal when certification is on file.",
      },
      {
        term: "All natural",
        approvedValue:
          "Avoid \"all natural.\" Use specific, substantiated descriptors (e.g. \"no artificial colors\").",
        category: "Prohibited Language",
        regulatoryReference: "FTC / FDA policy on \"natural\"",
        notes: "\"Natural\" is not defined by the FDA and invites challenge.",
      },
      {
        term: "Net Wt",
        approvedValue:
          "Net Wt (both US customary and metric, e.g. \"Net Wt 12 oz (340 g)\").",
        category: "Required Statement",
        regulatoryReference: "FPLA 21 CFR 101.105",
        notes: "Place in the bottom 30% of the principal display panel.",
      },
      {
        term: "Best if used by",
        approvedValue:
          "BEST IF USED BY [date] — preferred quality date phrasing for non-perishable foods.",
        category: "Defined Term",
        regulatoryReference: "FDA date labeling guidance",
        notes: "Reserve \"USE BY\" for safety-sensitive items.",
      },
      {
        term: "Company voice — sustainability",
        approvedValue:
          "Thoughtfully sourced, responsibly packaged. (Approved brand phrasing for eco messaging.)",
        category: "Brand Language",
        notes: "Use in place of unqualified \"eco-friendly\" or \"green\" claims.",
      },
    ].map((g) => ({ ...g, organizationId: orgId, status: "active", createdBy: "System", updatedBy: "System" })),
  );
  await db.insert(notificationsTable).values(
    notifications.map((n) => ({ ...n, organizationId: orgId })),
  );

  logger.info("Analyzing seed packages with AI (this may take a minute)...");
  for (const sp of seedPackages) {
    const [pkg] = await db
      .insert(packagesTable)
      .values({
        organizationId: orgId,
        sku: sp.sku,
        upc: sp.upc,
        name: sp.name,
        brand: sp.brand,
        vendor: sp.vendor,
        category: sp.category,
        country: sp.country,
        netWeight: sp.netWeight,
        dimensions: sp.dimensions,
        packageType: sp.packageType,
        productType: sp.productType,
        manufacturingRegion: sp.manufacturingRegion,
        reviewer: sp.reviewer,
        extractedText: sp.extractedText,
        artworkUrl: sp.artworkUrl,
        status: "Uploaded",
        complianceStatus: "Pending",
      })
      .returning();
    if (!pkg) continue;

    await db.insert(auditEventsTable).values({
      organizationId: orgId,
      packageId: pkg.id,
      entityType: "package",
      entityId: pkg.id,
      actor: "System",
      action: "Package uploaded",
      detail: `${pkg.name} (${pkg.sku}) uploaded for review.`,
    });

    const version = await ensureInitialVersion(pkg);

    try {
      const result = await analyzePackaging(pkg, insertedRegs);
      await applyAnalysis(pkg, result, version.id, orgId);
      logger.info(
        { sku: sp.sku, grade: result.grade, status: result.complianceStatus },
        "Analyzed seed package",
      );
    } catch (err) {
      logger.error({ err, sku: sp.sku }, "Seed analysis failed; skipping");
      continue;
    }
  }

  await seedCollaboration(insertedRegs);

  // A couple of generated reports for the reports page
  const analyzed = await db.select().from(packagesTable);
  const failedPkgs = analyzed.filter((p) => p.complianceStatus === "Failed");
  for (const p of failedPkgs.slice(0, 2)) {
    await db.insert(reportsTable).values({
      organizationId: orgId,
      packageId: p.id,
      title: `Compliance Report - ${p.name}`,
      type: "Compliance",
      format: "PDF",
      summary: p.summary,
    });
  }

  // Re-enable append-only enforcement on the audit trail.
  await ensureAuditImmutability();

  logger.info("Demo data seeded.");
}

// --- CLI --------------------------------------------------------------------
// Usage:
//   node dist/seed.mjs reference   → production-safe reference data only
//   node dist/seed.mjs demo        → demo data (also ensures reference exists)
//   node dist/seed.mjs [all]       → full dev seed (reference + demo)
async function runCli() {
  const mode = (process.argv[2] ?? "all").toLowerCase();
  if (mode === "reference") {
    await seedReference();
  } else if (mode === "demo" || mode === "all") {
    await seedDemo();
  } else {
    throw new Error(`Unknown seed mode "${mode}". Use: reference | demo | all`);
  }
  logger.info(`Seed finished (mode: ${mode}).`);
}

runCli()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "Seed failed");
    process.exit(1);
  });
