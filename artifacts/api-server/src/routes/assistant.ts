import { Router, type IRouter, type Request, type Response } from "express";
import { orgId } from "../lib/rbac/context";
import { AssistantChatBody, AssistantExtractBody } from "@workspace/api-zod";
import {
  askAssistant,
  askAssistantStream,
  extractTextFromImage,
} from "../lib/ai";
import { getAuthContext } from "../lib/rbac/context";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const DATA_URL_RE = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;

// POST /assistant/chat
// General-purpose AI helper that guides users to the right tool. Available to
// every authenticated user (no extra permission) — it only reads a static tool
// catalog, never org data. requireAuth (mounted globally) populates the RBAC
// context that orgId() reads for usage attribution.
router.post(
  "/assistant/chat",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = AssistantChatBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const answer = await askAssistant(orgId(req), parsed.data.messages);
      res.json(answer);
    } catch (err) {
      logger.error({ err }, "Assistant chat failed");
      res
        .status(502)
        .json({ error: "The assistant is unavailable. Please retry." });
    }
  },
);

// POST /assistant/chat/stream
// SSE variant of /assistant/chat so the side-panel answer renders token by
// token like the AI Workspace instead of arriving all at once. Same auth
// posture and same inputs; emits `delta` events for answer text, one
// `suggestions` event, then `done` (or `error`).
router.post(
  "/assistant/chat/stream",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = AssistantChatBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
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
    try {
      const auth = getAuthContext(req);
      const { suggestions } = await askAssistantStream({
        organizationId: orgId(req),
        userId: auth.userId,
        messages: parsed.data.messages,
        signal: controller.signal,
        onDelta: (text) => send("delta", { text }),
      });
      if (suggestions.length) send("suggestions", { suggestions });
      send("done", { ok: true });
    } catch (err) {
      logger.error({ err }, "Assistant stream failed");
      send("error", { error: "The assistant is unavailable. Please retry." });
    } finally {
      res.end();
    }
  },
);

// POST /assistant/extract
// Transcribe an attached image into text for the assistant. Same open-to-all
// auth posture as /assistant/chat (no packages:write, unlike /ocr), so document
// attachments work for every role. Only accepts image data URLs.
router.post(
  "/assistant/extract",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = AssistantExtractBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { imageDataUrl } = parsed.data;
    if (!DATA_URL_RE.test(imageDataUrl)) {
      res
        .status(400)
        .json({ error: "imageDataUrl must be a base64 image data URL" });
      return;
    }
    try {
      const text = await extractTextFromImage(imageDataUrl);
      res.json({ text });
    } catch (err) {
      logger.error({ err }, "Assistant extract failed");
      res
        .status(502)
        .json({ error: "Couldn't read that image. Please try again." });
    }
  },
);

export default router;
