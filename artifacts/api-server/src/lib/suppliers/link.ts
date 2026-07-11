import { db, suppliersTable } from "@workspace/db";
import { and, eq, asc, sql } from "drizzle-orm";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Supplier linkage.
//
// Packages and compliance-memory rows are linked to the master supplier record
// by id (packages.supplier_id) rather than by matching the free-text vendor
// name. Name matching is fragile: a supplier rename silently breaks scoping and
// joins, and two vendors with slightly different spellings look like one. The
// id link is stable and is what supplier-isolation checks rely on.
// ---------------------------------------------------------------------------

// Resolve the master supplier id for a vendor name within an organization,
// creating the supplier record on first sight so the link always exists. Returns
// null only for an empty vendor name. Used by the create paths.
export async function resolveSupplierId(
  organizationId: number,
  vendorName: string | null | undefined,
): Promise<number | null> {
  const name = (vendorName ?? "").trim();
  if (!name) return null;

  const [existing] = await db
    .select({ id: suppliersTable.id })
    .from(suppliersTable)
    .where(
      and(
        eq(suppliersTable.organizationId, organizationId),
        eq(suppliersTable.name, name),
      ),
    )
    .orderBy(asc(suppliersTable.id))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(suppliersTable)
    .values({ organizationId, name })
    .returning({ id: suppliersTable.id });
  if (created) return created.id;

  // Lost a race — read it back.
  const [row] = await db
    .select({ id: suppliersTable.id })
    .from(suppliersTable)
    .where(
      and(
        eq(suppliersTable.organizationId, organizationId),
        eq(suppliersTable.name, name),
      ),
    )
    .orderBy(asc(suppliersTable.id))
    .limit(1);
  return row?.id ?? null;
}

// One-time (idempotent) backfill that populates supplier_id on legacy packages
// and compliance-memory rows that predate the id link. Only ever touches rows
// where supplier_id IS NULL, so it is safe to run on every boot. Non-fatal.
export async function backfillSupplierLinks(): Promise<void> {
  try {
    // 1. Create missing supplier records for any package vendor that has no
    //    matching supplier in its organization.
    await db.execute(sql`
      INSERT INTO suppliers (organization_id, name)
      SELECT DISTINCT p.organization_id, p.vendor
      FROM packages p
      LEFT JOIN suppliers s
        ON s.organization_id = p.organization_id AND s.name = p.vendor
      WHERE p.supplier_id IS NULL
        AND s.id IS NULL
        AND p.organization_id IS NOT NULL
        AND p.vendor IS NOT NULL
        AND p.vendor <> ''
    `);

    // 2. Link packages to their supplier by (org, name).
    const pkgRes = await db.execute(sql`
      UPDATE packages p
      SET supplier_id = s.id
      FROM suppliers s
      WHERE p.supplier_id IS NULL
        AND p.organization_id = s.organization_id
        AND p.vendor = s.name
    `);

    // 3. Link compliance-memory rows from their source package first (most
    //    authoritative), then by (org, vendor) for any that remain.
    await db.execute(sql`
      UPDATE compliance_memory m
      SET supplier_id = p.supplier_id
      FROM packages p
      WHERE m.supplier_id IS NULL
        AND m.package_id = p.id
        AND p.supplier_id IS NOT NULL
    `);
    await db.execute(sql`
      UPDATE compliance_memory m
      SET supplier_id = s.id
      FROM suppliers s
      WHERE m.supplier_id IS NULL
        AND m.organization_id = s.organization_id
        AND m.vendor = s.name
    `);

    const linked =
      (pkgRes as unknown as { rowCount?: number }).rowCount ?? 0;
    logger.info({ packagesLinked: linked }, "Supplier link backfill complete");
  } catch (err) {
    logger.error({ err }, "Supplier link backfill failed");
  }
}
