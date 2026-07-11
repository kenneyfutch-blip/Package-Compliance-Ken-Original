import { Router, type IRouter, type Request, type Response } from "express";
import { db, packagesTable, violationsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requirePermission, orgId } from "../lib/rbac/context";
import { packageConds } from "../lib/rbac/scope";

const router: IRouter = Router();

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Packages visible to the caller (organization + supplier scoped).
function scopedPackages(req: Request) {
  return db
    .select()
    .from(packagesTable)
    .where(and(...packageConds(req)));
}

router.get(
  "/dashboard/stats",
  requirePermission("dashboard:read"),
  async (req: Request, res: Response): Promise<void> => {
    const packages = await scopedPackages(req);
    const today = dayKey(new Date());

    const reviewedToday = packages.filter(
      (p) => p.analyzedAt && dayKey(new Date(p.analyzedAt)) === today,
    ).length;
    const inReview = packages.filter((p) =>
      ["AI Review", "OCR Complete", "Uploaded", "Resubmitted"].includes(
        p.status,
      ),
    ).length;
    const passed = packages.filter(
      (p) => p.complianceStatus === "Passed",
    ).length;
    const failed = packages.filter(
      (p) => p.complianceStatus === "Failed",
    ).length;
    const highRisk = packages.filter((p) => (p.riskScore ?? 0) >= 70).length;
    const mediumRisk = packages.filter(
      (p) => (p.riskScore ?? 0) >= 40 && (p.riskScore ?? 0) < 70,
    ).length;
    const lowRisk = packages.filter(
      (p) => p.riskScore !== null && p.riskScore < 40,
    ).length;
    const criticalViolations = packages.reduce(
      (sum, p) => sum + p.criticalCount,
      0,
    );
    const analyzed = packages.filter((p) => p.analyzedAt);
    const complianceVelocity =
      analyzed.length > 0 ? Math.round((passed / analyzed.length) * 100) : 0;

    res.json({
      reviewedToday,
      inReview,
      passed,
      failed,
      highRisk,
      mediumRisk,
      lowRisk,
      avgReviewMinutes: 3.2,
      complianceVelocity,
      totalPackages: packages.length,
      criticalViolations,
    });
  },
);

router.get(
  "/dashboard/trends",
  requirePermission("dashboard:read"),
  async (req: Request, res: Response): Promise<void> => {
    const packages = await scopedPackages(req);
    const days: { date: string; key: string }[] = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      days.push({
        date: d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        key: dayKey(d),
      });
    }

    const result = days.map(({ date, key }) => {
      const dayPkgs = packages.filter(
        (p) => p.analyzedAt && dayKey(new Date(p.analyzedAt)) === key,
      );
      const passed = dayPkgs.filter(
        (p) => p.complianceStatus === "Passed",
      ).length;
      const failed = dayPkgs.filter(
        (p) => p.complianceStatus === "Failed",
      ).length;
      const avgRisk =
        dayPkgs.length > 0
          ? Math.round(
              dayPkgs.reduce((s, p) => s + (p.riskScore ?? 0), 0) /
                dayPkgs.length,
            )
          : 0;
      return {
        date,
        passed,
        failed,
        reviewVolume: dayPkgs.length,
        avgRisk,
      };
    });

    res.json(result);
  },
);

router.get(
  "/dashboard/violation-distribution",
  requirePermission("dashboard:read"),
  async (req: Request, res: Response): Promise<void> => {
    const violations = await db
      .select()
      .from(violationsTable)
      .where(eq(violationsTable.organizationId, orgId(req)));
    const counts = new Map<string, number>();
    for (const v of violations) {
      counts.set(v.engine, (counts.get(v.engine) ?? 0) + 1);
    }
    res.json(
      [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
    );
  },
);

router.get(
  "/dashboard/category-distribution",
  requirePermission("dashboard:read"),
  async (req: Request, res: Response): Promise<void> => {
    const packages = await scopedPackages(req);
    const counts = new Map<string, number>();
    for (const p of packages) {
      counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    }
    res.json(
      [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
    );
  },
);

router.get(
  "/dashboard/vendor-performance",
  requirePermission("dashboard:read"),
  async (req: Request, res: Response): Promise<void> => {
    const packages = await scopedPackages(req);
    const byVendor = new Map<
      string,
      { packages: number; failed: number; riskSum: number; scored: number }
    >();
    for (const p of packages) {
      const entry = byVendor.get(p.vendor) ?? {
        packages: 0,
        failed: 0,
        riskSum: 0,
        scored: 0,
      };
      entry.packages += 1;
      if (p.complianceStatus === "Failed") entry.failed += 1;
      if (p.riskScore !== null) {
        entry.riskSum += p.riskScore;
        entry.scored += 1;
      }
      byVendor.set(p.vendor, entry);
    }
    const result = [...byVendor.entries()].map(([vendor, e]) => ({
      vendor,
      complianceScore:
        e.scored > 0 ? Math.max(0, 100 - Math.round(e.riskSum / e.scored)) : 100,
      packages: e.packages,
      failed: e.failed,
    }));
    result.sort((a, b) => b.complianceScore - a.complianceScore);
    res.json(result);
  },
);

export default router;
