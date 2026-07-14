import { Router, type IRouter, type Request, type Response } from "express";
import { orgId } from "../lib/rbac/context";
import { AssistantChatBody } from "@workspace/api-zod";
import { askAssistant } from "../lib/ai";
import { logger } from "../lib/logger";

const router: IRouter = Router();

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

export default router;
