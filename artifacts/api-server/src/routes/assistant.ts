import { Router, type IRouter, type Request, type Response } from "express";
import { orgId } from "../lib/rbac/context";
import { AssistantChatBody, AssistantExtractBody } from "@workspace/api-zod";
import { askAssistant, extractTextFromImage } from "../lib/ai";
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
