import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  aiConversationsTable,
  aiConversationMessagesTable,
  packagesTable,
  reportsTable,
  reviewTasksTable,
  type AiConversationRow,
  type AiConversationMessageRow,
} from "@workspace/db";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { orgId, getAuthContext } from "../lib/rbac/context";
import { parsePagination } from "../lib/pagination";
import { writeAudit } from "../lib/audit";
import {
  extractTextFromImage,
  type WorkspacePageContext,
} from "../lib/ai";
import { runWorkspaceAgent } from "../lib/workspace/agent";
import { listSpecialists, isSpecialistKey } from "../lib/specialists";
import { logger } from "../lib/logger";

// A single uploaded attachment for a Workspace turn. Text attachments carry
// client-extracted text (txt/pdf-text-layer/docx/xlsx); image attachments carry
// a data URL that is OCR'd server-side. Both are bounded before use.
type ParsedAttachment = { name: string; kind: "text" | "image"; text: string };

const IMAGE_DATA_URL_RE = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_TEXT = 6000;

// Extract usable text from the request's attachments, reusing the server-side
// OCR pipeline for images. Never throws — a failed attachment is skipped so the
// chat still proceeds.
async function parseAttachments(raw: unknown): Promise<ParsedAttachment[]> {
  if (!Array.isArray(raw)) return [];
  const out: ParsedAttachment[] = [];
  for (const item of raw.slice(0, MAX_ATTACHMENTS)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name =
      typeof o["name"] === "string" && o["name"].trim()
        ? o["name"].trim().slice(0, 200)
        : "attachment";
    const kind = o["kind"] === "image" ? "image" : "text";
    if (kind === "image") {
      const dataUrl = typeof o["imageDataUrl"] === "string" ? o["imageDataUrl"] : "";
      if (!IMAGE_DATA_URL_RE.test(dataUrl)) continue;
      try {
        const text = await extractTextFromImage(dataUrl);
        if (text && text.trim())
          out.push({ name, kind, text: text.trim().slice(0, MAX_ATTACHMENT_TEXT) });
      } catch (err) {
        logger.warn({ err, name }, "workspace attachment OCR failed");
      }
    } else {
      const text = typeof o["content"] === "string" ? o["content"] : "";
      if (text.trim())
        out.push({ name, kind, text: text.trim().slice(0, MAX_ATTACHMENT_TEXT) });
    }
  }
  return out;
}

// Fold a message row's persisted attachment text into the content sent to the
// model, so uploaded-document context survives across turns without dumping raw
// text into the chat bubble (which renders only `content`).
function contentWithAttachments(
  content: string,
  attachments: unknown,
): string {
  if (!Array.isArray(attachments) || attachments.length === 0) return content;
  const blocks = attachments
    .map((a) => {
      if (!a || typeof a !== "object") return null;
      const o = a as Record<string, unknown>;
      const name = typeof o["name"] === "string" ? o["name"] : "attachment";
      const text = typeof o["text"] === "string" ? o["text"] : "";
      if (!text.trim()) return null;
      return `--- Attached document: ${name} ---\n${text}`;
    })
    .filter(Boolean)
    .join("\n\n");
  return blocks ? `${content}\n\n${blocks}` : content;
}

const router: IRouter = Router();

// Concrete linked-record kinds we can validate against the caller's org.
type LinkedKind = "package" | "report" | "task";
const LINKED_KINDS: LinkedKind[] = ["package", "report", "task"];

function parseId(raw: string | string[] | undefined): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

// Confirm a linked record belongs to the caller's org. review_tasks has no
// organizationId of its own, so its ownership is derived from its package.
// Returns the resolved label on success, or null when the record is not found
// in the caller's org (caller should reject the link).
async function resolveLinkedLabel(
  organizationId: number,
  kind: LinkedKind,
  recordId: number,
): Promise<string | null> {
  if (kind === "package") {
    const [row] = await db
      .select({ name: packagesTable.name, sku: packagesTable.sku })
      .from(packagesTable)
      .where(
        and(
          eq(packagesTable.id, recordId),
          eq(packagesTable.organizationId, organizationId),
        ),
      )
      .limit(1);
    return row ? `Package: ${row.name} (${row.sku})` : null;
  }
  if (kind === "report") {
    const [row] = await db
      .select({ title: reportsTable.title })
      .from(reportsTable)
      .where(
        and(
          eq(reportsTable.id, recordId),
          eq(reportsTable.organizationId, organizationId),
        ),
      )
      .limit(1);
    return row ? `Report: ${row.title}` : null;
  }
  // task → validate via its package's org
  const [row] = await db
    .select({ title: reviewTasksTable.title })
    .from(reviewTasksTable)
    .innerJoin(packagesTable, eq(reviewTasksTable.packageId, packagesTable.id))
    .where(
      and(
        eq(reviewTasksTable.id, recordId),
        eq(packagesTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ? `Task: ${row.title}` : null;
}

function mapConversation(row: AiConversationRow) {
  return {
    id: row.id,
    title: row.title,
    specialist: row.specialist,
    favorite: row.favorite,
    archived: row.archived,
    linkedRecordType: row.linkedRecordType ?? null,
    linkedRecordId: row.linkedRecordId ?? null,
    linkedRecordLabel: row.linkedRecordLabel ?? null,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

function mapMessage(row: AiConversationMessageRow) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    suggestions: (row.suggestions as unknown) ?? null,
    // Ship only attachment metadata (name/kind) to the client; the extracted
    // text stays server-side (it's folded into model history directly from the
    // DB) so conversation loads don't carry large document blobs.
    attachments: Array.isArray(row.attachments)
      ? (row.attachments as { name?: unknown; kind?: unknown }[]).map((a) => ({
          name: typeof a?.name === "string" ? a.name : "attachment",
          kind: a?.kind === "image" ? "image" : "text",
        }))
      : null,
    citations: (row.citations as unknown) ?? null,
    createdAt: iso(row.createdAt)!,
  };
}

// Every conversation read is scoped to the caller's org AND the caller as owner
// (conversations are private to their creator).
function ownerConds(req: Request) {
  const organizationId = orgId(req);
  const { userId } = getAuthContext(req);
  return and(
    eq(aiConversationsTable.organizationId, organizationId),
    eq(aiConversationsTable.userId, userId),
  );
}

// Load a conversation the caller owns, or null.
async function loadOwnedConversation(
  req: Request,
  id: number,
): Promise<AiConversationRow | null> {
  const [row] = await db
    .select()
    .from(aiConversationsTable)
    .where(and(eq(aiConversationsTable.id, id), ownerConds(req)))
    .limit(1);
  return row ?? null;
}

// GET /workspace/specialists — the persona catalog (open to all authed users).
router.get(
  "/workspace/specialists",
  async (_req: Request, res: Response): Promise<void> => {
    res.json({
      specialists: listSpecialists().map((s) => ({
        key: s.key,
        label: s.label,
        description: s.description,
        suggestedPrompts: s.suggestedPrompts,
      })),
    });
  },
);

// GET /workspace/conversations — list the caller's conversations (newest first).
// Supports ?q= search over title, ?favorite=true, ?includeArchived=true.
router.get(
  "/workspace/conversations",
  async (req: Request, res: Response): Promise<void> => {
    const { limit, offset } = parsePagination(req);
    const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
    const favoriteOnly = req.query["favorite"] === "true";
    const includeArchived = req.query["includeArchived"] === "true";

    const conds = [ownerConds(req)];
    if (!includeArchived) conds.push(eq(aiConversationsTable.archived, false));
    if (favoriteOnly) conds.push(eq(aiConversationsTable.favorite, true));
    if (q) conds.push(ilike(aiConversationsTable.title, `%${q}%`));

    const rows = await db
      .select()
      .from(aiConversationsTable)
      .where(and(...conds))
      .orderBy(desc(aiConversationsTable.updatedAt))
      .limit(limit)
      .offset(offset);

    res.json({ conversations: rows.map(mapConversation) });
  },
);

// POST /workspace/conversations — create a conversation.
router.post(
  "/workspace/conversations",
  async (req: Request, res: Response): Promise<void> => {
    const organizationId = orgId(req);
    const { userId } = getAuthContext(req);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const title =
      typeof body["title"] === "string" && body["title"].trim()
        ? String(body["title"]).trim().slice(0, 200)
        : "New conversation";
    const specialistRaw =
      typeof body["specialist"] === "string" ? body["specialist"] : "general";
    const specialist = isSpecialistKey(specialistRaw) ? specialistRaw : "general";

    // Optional linked record — validated against the caller's org.
    let linkedRecordType: LinkedKind | null = null;
    let linkedRecordId: number | null = null;
    let linkedRecordLabel: string | null = null;
    const rawType = body["linkedRecordType"];
    const rawId = body["linkedRecordId"];
    if (rawType != null && rawId != null) {
      const kind = String(rawType) as LinkedKind;
      const recId = Number(rawId);
      if (!LINKED_KINDS.includes(kind) || !Number.isFinite(recId)) {
        res.status(400).json({ error: "Invalid linked record" });
        return;
      }
      const label = await resolveLinkedLabel(organizationId, kind, recId);
      if (!label) {
        res.status(404).json({ error: "Linked record not found" });
        return;
      }
      linkedRecordType = kind;
      linkedRecordId = recId;
      linkedRecordLabel = label;
    }

    // Optional seed transcript — used when the classic assistant panel hands its
    // conversation off to the workspace. Persisting the prior turns keeps history
    // durable across refetch and gives the next turn real model context (the
    // stream endpoint rebuilds history from these rows). Bounded to stay sane.
    const seedRaw = body["seedMessages"];
    const seedMessages: { role: "user" | "assistant"; content: string }[] = [];
    if (Array.isArray(seedRaw)) {
      for (const item of seedRaw.slice(0, 40)) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        const role = rec["role"] === "assistant" ? "assistant" : "user";
        const content =
          typeof rec["content"] === "string" ? rec["content"].slice(0, 8000) : "";
        if (content.trim()) seedMessages.push({ role, content });
      }
    }
    // Derive a title from the first user turn when the caller didn't set one.
    const derivedTitle =
      title === "New conversation" && seedMessages.length > 0
        ? (seedMessages.find((m) => m.role === "user")?.content ?? title)
            .trim()
            .slice(0, 80)
        : title;

    const [row] = await db
      .insert(aiConversationsTable)
      .values({
        organizationId,
        userId,
        title: derivedTitle,
        specialist,
        linkedRecordType,
        linkedRecordId,
        linkedRecordLabel,
      })
      .returning();

    if (seedMessages.length > 0) {
      await db.insert(aiConversationMessagesTable).values(
        seedMessages.map((m) => ({
          conversationId: row.id,
          organizationId,
          role: m.role,
          content: m.content,
        })),
      );
    }

    await writeAudit(req, {
      action: "ai_conversation.create",
      entityType: "ai_conversation",
      entityId: row.id,
    });

    res.status(201).json(mapConversation(row));
  },
);

// GET /workspace/conversations/:id — conversation with its messages.
router.get(
  "/workspace/conversations/:id",
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const conv = await loadOwnedConversation(req, id);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const messages = await db
      .select()
      .from(aiConversationMessagesTable)
      .where(eq(aiConversationMessagesTable.conversationId, id))
      .orderBy(aiConversationMessagesTable.createdAt);

    res.json({
      ...mapConversation(conv),
      messages: messages.map(mapMessage),
    });
  },
);

// PATCH /workspace/conversations/:id — rename / change specialist / favorite /
// archive. Only the owner may update.
router.patch(
  "/workspace/conversations/:id",
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const conv = await loadOwnedConversation(req, id);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: Partial<typeof aiConversationsTable.$inferInsert> = {};
    if (typeof body["title"] === "string" && body["title"].trim()) {
      updates.title = String(body["title"]).trim().slice(0, 200);
    }
    if (typeof body["specialist"] === "string" && isSpecialistKey(body["specialist"])) {
      updates.specialist = body["specialist"];
    }
    if (typeof body["favorite"] === "boolean") updates.favorite = body["favorite"];
    if (typeof body["archived"] === "boolean") updates.archived = body["archived"];

    if (Object.keys(updates).length === 0) {
      res.json(mapConversation(conv));
      return;
    }
    updates.updatedAt = new Date();

    const [row] = await db
      .update(aiConversationsTable)
      .set(updates)
      .where(and(eq(aiConversationsTable.id, id), ownerConds(req)))
      .returning();

    res.json(mapConversation(row));
  },
);

// DELETE /workspace/conversations/:id — soft delete (archive). Owner only.
router.delete(
  "/workspace/conversations/:id",
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const conv = await loadOwnedConversation(req, id);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    await db
      .update(aiConversationsTable)
      .set({ archived: true, updatedAt: new Date() })
      .where(and(eq(aiConversationsTable.id, id), ownerConds(req)));

    await writeAudit(req, {
      action: "ai_conversation.archive",
      entityType: "ai_conversation",
      entityId: id,
    });

    res.status(204).end();
  },
);

// POST /workspace/conversations/:id/stream — hand-written SSE endpoint (kept
// OUTSIDE the OpenAPI/Orval codegen, which cannot express streaming). Persists
// the user message, streams the assistant answer token-by-token as SSE `data:`
// lines, then persists the assistant message. The client consumes this via
// fetch() + ReadableStream (EventSource cannot POST).
router.post(
  "/workspace/conversations/:id/stream",
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const organizationId = orgId(req);
    const { userId } = getAuthContext(req);
    const conv = await loadOwnedConversation(req, id);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const message =
      typeof body["message"] === "string" ? body["message"].trim() : "";
    let pageContext: WorkspacePageContext | null = null;
    const pc = body["pageContext"];
    if (pc && typeof pc === "object") {
      const o = pc as Record<string, unknown>;
      pageContext = {
        path: typeof o["path"] === "string" ? o["path"] : null,
        title: typeof o["title"] === "string" ? o["title"] : null,
        summary: typeof o["summary"] === "string" ? o["summary"] : null,
      };
    }

    // Extract text from any uploaded attachments (images OCR'd server-side).
    const attachments = await parseAttachments(body["attachments"]);

    // A turn needs either typed text OR at least one usable attachment (the UI
    // allows sending files with no message for "analyze this" requests).
    if (!message && attachments.length === 0) {
      res.status(400).json({ error: "message or an attachment is required" });
      return;
    }

    // Persist the user turn before streaming so history is durable even if the
    // stream is interrupted. Attachment text is stored in the attachments jsonb
    // (not in content) so the bubble stays clean but context survives reloads.
    await db.insert(aiConversationMessagesTable).values({
      conversationId: id,
      organizationId,
      role: "user",
      content: message.slice(0, 8000),
      attachments: attachments.length ? attachments : null,
    });

    // Build the message history (existing turns + this one) for the model,
    // folding each turn's persisted attachment text into its content.
    const prior = await db
      .select({
        role: aiConversationMessagesTable.role,
        content: aiConversationMessagesTable.content,
        attachments: aiConversationMessagesTable.attachments,
      })
      .from(aiConversationMessagesTable)
      .where(eq(aiConversationMessagesTable.conversationId, id))
      .orderBy(aiConversationMessagesTable.createdAt);
    const history = prior.map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: contentWithAttachments(m.content, m.attachments),
    }));

    // Auto-title a fresh conversation from the first user message (or the first
    // attachment's name for an attachment-only turn).
    if (conv.title === "New conversation") {
      const derived =
        (message || attachments[0]?.name || "New conversation").slice(0, 60);
      await db
        .update(aiConversationsTable)
        .set({ title: derived, updatedAt: new Date() })
        .where(eq(aiConversationsTable.id, id));
    }

    // SSE headers.
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const controller = new AbortController();
    req.on("close", () => controller.abort());

    let full = "";
    try {
      const { citations } = await runWorkspaceAgent({
        req,
        organizationId,
        userId,
        specialistKey: conv.specialist,
        messages: history,
        pageContext,
        linkedRecordLabel: conv.linkedRecordLabel ?? null,
        signal: controller.signal,
        onDelta: (delta) => {
          full += delta;
          send("delta", { text: delta });
        },
        onStatus: (info) => {
          send("status", info);
        },
      });

      // Surface grounded source links to the client before completion.
      if (citations.length) send("citations", { citations });

      // Persist the assistant turn (with its citations) and bump the timestamp.
      if (full) {
        await db.insert(aiConversationMessagesTable).values({
          conversationId: id,
          organizationId,
          role: "assistant",
          content: full,
          citations: citations.length ? citations : null,
        });
      }
      await db
        .update(aiConversationsTable)
        .set({ updatedAt: new Date() })
        .where(eq(aiConversationsTable.id, id));

      send("done", { ok: true });
      res.end();
    } catch (err) {
      logger.error({ err }, "Workspace stream failed");
      // Persist whatever partial answer we produced so history is consistent.
      if (full) {
        await db
          .insert(aiConversationMessagesTable)
          .values({
            conversationId: id,
            organizationId,
            role: "assistant",
            content: full,
          })
          .catch(() => {});
      }
      if (!res.headersSent) {
        res.status(502).json({ error: "The assistant is unavailable." });
        return;
      }
      send("error", { error: "The assistant is unavailable. Please retry." });
      res.end();
    }
  },
);

export default router;
