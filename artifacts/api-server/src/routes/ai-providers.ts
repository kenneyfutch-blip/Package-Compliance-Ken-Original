import { Router, type IRouter, type Request, type Response } from "express";
import { db, aiProvidersTable, type AiProvider } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateAiProviderBody, UpdateAiProviderBody } from "@workspace/api-zod";
import { buildClient, tierModelFor, TIER_CODENAMES } from "../lib/ai-client";
import { encryptSecret } from "../lib/crypto";
import { isValidProviderType, validateBaseUrl } from "../lib/provider-security";
import { requirePermission } from "../lib/rbac/context";

const router: IRouter = Router();

function requireId(
  raw: string | string[] | undefined,
  res: Response,
): number | null {
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  return id;
}

function mapProvider(row: AiProvider) {
  const usingManaged = row.managed || !row.apiKey;
  return {
    id: row.id,
    name: row.name,
    providerType: row.providerType,
    model: row.model,
    fastModel: row.fastModel,
    reasoningModel: row.reasoningModel,
    // Effective model backing each routing tier (Luna/Terra/Sol).
    tiers: {
      fast: {
        codename: TIER_CODENAMES.fast,
        model: tierModelFor(row, "fast", usingManaged),
      },
      standard: {
        codename: TIER_CODENAMES.standard,
        model: tierModelFor(row, "standard", usingManaged),
      },
      reasoning: {
        codename: TIER_CODENAMES.reasoning,
        model: tierModelFor(row, "reasoning", usingManaged),
      },
    },
    baseUrl: row.baseUrl,
    managed: row.managed,
    active: row.active,
    status: row.status,
    statusMessage: row.statusMessage,
    hasKey: row.managed ? true : Boolean(row.apiKey),
    keyLast4: row.keyLast4,
    lastTestedAt: row.lastTestedAt ? row.lastTestedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadProvider(id: number): Promise<AiProvider | undefined> {
  const [row] = await db
    .select()
    .from(aiProvidersTable)
    .where(eq(aiProvidersTable.id, id));
  return row;
}

router.get(
  "/ai-providers",
  requirePermission("ai_providers:read"),
  async (_req: Request, res: Response): Promise<void> => {
    const rows = await db
      .select()
      .from(aiProvidersTable)
      .orderBy(aiProvidersTable.id);
    res.json(rows.map(mapProvider));
  },
);

router.post(
  "/ai-providers",
  requirePermission("ai_providers:write"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateAiProviderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid provider" });
      return;
    }
    const { name, model, apiKey } = parsed.data;
    const providerType = parsed.data.providerType || "openai";
    const baseUrl = parsed.data.baseUrl?.trim() || null;

    if (!isValidProviderType(providerType)) {
      res.status(400).json({ error: "Unsupported provider type" });
      return;
    }
    if (providerType !== "openai" && !baseUrl) {
      res.status(400).json({ error: "A base URL is required for this provider" });
      return;
    }
    if (baseUrl) {
      const urlError = await validateBaseUrl(baseUrl);
      if (urlError) {
        res.status(400).json({ error: urlError });
        return;
      }
    }

    const [row] = await db
      .insert(aiProvidersTable)
      .values({
        name,
        providerType,
        model,
        fastModel: parsed.data.fastModel?.trim() || null,
        reasoningModel: parsed.data.reasoningModel?.trim() || null,
        baseUrl: providerType === "openai" ? null : baseUrl,
        apiKey: apiKey ? encryptSecret(apiKey) : null,
        keyLast4: apiKey ? apiKey.slice(-4) : null,
        managed: false,
        active: false,
        status: "unknown",
      })
      .returning();
    res.status(201).json(mapProvider(row!));
  },
);

router.patch(
  "/ai-providers/:id",
  requirePermission("ai_providers:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const parsed = UpdateAiProviderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid update" });
      return;
    }
    const existing = await loadProvider(id);
    if (!existing) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    if (existing.managed) {
      res.status(400).json({ error: "The managed provider cannot be edited" });
      return;
    }

    const { name, model, apiKey } = parsed.data;
    const baseUrl = parsed.data.baseUrl?.trim();
    const updates: Partial<typeof aiProvidersTable.$inferInsert> = {};
    if (name !== undefined) updates.name = name;
    if (model !== undefined) updates.model = model;
    if (parsed.data.fastModel !== undefined)
      updates.fastModel = parsed.data.fastModel.trim() || null;
    if (parsed.data.reasoningModel !== undefined)
      updates.reasoningModel = parsed.data.reasoningModel.trim() || null;
    if (baseUrl !== undefined) {
      if (baseUrl) {
        const urlError = await validateBaseUrl(baseUrl);
        if (urlError) {
          res.status(400).json({ error: urlError });
          return;
        }
      }
      updates.baseUrl = baseUrl || null;
    }
    // Only overwrite the key when a non-empty value is supplied.
    if (apiKey) {
      updates.apiKey = encryptSecret(apiKey);
      updates.keyLast4 = apiKey.slice(-4);
      updates.status = "unknown";
    }
    // Activation is only ever changed via the dedicated /activate endpoint.

    const [row] = await db
      .update(aiProvidersTable)
      .set(updates)
      .where(eq(aiProvidersTable.id, id))
      .returning();
    res.json(mapProvider(row!));
  },
);

router.delete(
  "/ai-providers/:id",
  requirePermission("ai_providers:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const existing = await loadProvider(id);
    if (!existing) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    if (existing.managed) {
      res.status(400).json({ error: "The managed provider cannot be removed" });
      return;
    }
    await db.transaction(async (tx) => {
      await tx.delete(aiProvidersTable).where(eq(aiProvidersTable.id, id));
      // If we removed the active provider, fall back to the managed one.
      if (existing.active) {
        await tx
          .update(aiProvidersTable)
          .set({ active: true })
          .where(eq(aiProvidersTable.managed, true));
      }
    });
    res.status(204).send();
  },
);

router.post(
  "/ai-providers/:id/activate",
  requirePermission("ai_providers:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const existing = await loadProvider(id);
    if (!existing) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    const row = await db.transaction(async (tx) => {
      await tx
        .update(aiProvidersTable)
        .set({ active: false })
        .where(eq(aiProvidersTable.active, true));
      const [updated] = await tx
        .update(aiProvidersTable)
        .set({ active: true })
        .where(eq(aiProvidersTable.id, id))
        .returning();
      return updated;
    });
    res.json(mapProvider(row!));
  },
);

router.post(
  "/ai-providers/:id/test",
  requirePermission("ai_providers:write"),
  async (req: Request, res: Response): Promise<void> => {
    const id = requireId(req.params["id"], res);
    if (id === null) return;
    const existing = await loadProvider(id);
    if (!existing) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    let status = "connected";
    let message: string | null = "Connection successful.";
    try {
      const { client, model } = buildClient(existing);
      await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_completion_tokens: 5,
      });
    } catch (err) {
      status = "error";
      message =
        err instanceof Error ? err.message : "Unable to reach the provider.";
    }
    await db
      .update(aiProvidersTable)
      .set({ status, statusMessage: message, lastTestedAt: new Date() })
      .where(eq(aiProvidersTable.id, id));
    res.json({ status, message });
  },
);

export default router;
