import { Router, type IRouter, type Request, type Response } from "express";
import { db, regulationsTable } from "@workspace/db";
import { eq, desc, and, or, ilike, type SQL } from "drizzle-orm";
import { CreateRegulationBody } from "@workspace/api-zod";
import { mapRegulation } from "../lib/mappers";

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}

router.get(
  "/regulations",
  async (req: Request, res: Response): Promise<void> => {
    const { search, agency, category } = req.query;
    const conditions: SQL[] = [];
    if (typeof search === "string" && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(
        or(
          ilike(regulationsTable.title, term),
          ilike(regulationsTable.summary, term),
          ilike(regulationsTable.ruleCode, term),
        )!,
      );
    }
    if (typeof agency === "string" && agency) {
      conditions.push(eq(regulationsTable.agency, agency));
    }
    if (typeof category === "string" && category) {
      conditions.push(eq(regulationsTable.category, category));
    }
    const rows = await db
      .select()
      .from(regulationsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(regulationsTable.createdAt));
    res.json(rows.map(mapRegulation));
  },
);

router.post(
  "/regulations",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateRegulationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    const [row] = await db
      .insert(regulationsTable)
      .values({
        agency: d.agency,
        category: d.category,
        ruleCode: d.ruleCode,
        title: d.title,
        summary: d.summary,
        regulationText: d.regulationText ?? null,
        section: d.section ?? null,
        source: d.source ?? null,
        publicationDate: d.publicationDate ?? null,
      })
      .returning();
    res.status(201).json(mapRegulation(row!));
  },
);

router.get(
  "/regulations/:id",
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    const [row] = await db
      .select()
      .from(regulationsTable)
      .where(eq(regulationsTable.id, id));
    if (!row) {
      res.status(404).json({ error: "Regulation not found" });
      return;
    }
    res.json(mapRegulation(row));
  },
);

export default router;
