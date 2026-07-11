import { Router, type IRouter, type Request, type Response } from "express";
import { ExtractArtworkTextBody, ExtractArtworkFieldsBody } from "@workspace/api-zod";
import { extractTextFromImage, extractPackageFieldsFromImage } from "../lib/ai";
import { logger } from "../lib/logger";
import { requirePermission } from "../lib/rbac/context";

const router: IRouter = Router();

const DATA_URL_RE = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;

// POST /ocr — transcribe packaging artwork image into text for AI analysis.
router.post(
  "/ocr",
  requirePermission("packages:write"),
  async (req: Request, res: Response): Promise<void> => {
  const parsed = ExtractArtworkTextBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { imageDataUrl } = parsed.data;
  if (!DATA_URL_RE.test(imageDataUrl)) {
    res.status(400).json({ error: "imageDataUrl must be a base64 image data URL" });
    return;
  }

  try {
    const text = await extractTextFromImage(imageDataUrl);
    res.json({ text });
  } catch (err) {
    logger.error({ err }, "OCR extraction failed");
    res.status(500).json({ error: "Failed to extract text from image" });
  }
});

const EMPTY_FIELDS = {
  productName: "",
  brand: "",
  upc: "",
  netWeight: "",
  country: "",
};

// POST /ocr/fields — best-effort structured metadata extraction from artwork to
// pre-fill the upload form. Fail-safe: any failure returns all-empty fields so
// it never blocks upload or surfaces a scary error.
router.post(
  "/ocr/fields",
  requirePermission("packages:write"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ExtractArtworkFieldsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { imageDataUrl } = parsed.data;
    if (!DATA_URL_RE.test(imageDataUrl)) {
      res.status(400).json({ error: "imageDataUrl must be a base64 image data URL" });
      return;
    }

    try {
      const fields = await extractPackageFieldsFromImage(imageDataUrl);
      res.json(fields);
    } catch (err) {
      // Best-effort: never fail the upload flow over field extraction.
      logger.warn({ err }, "Structured field extraction failed; returning empty fields");
      res.json(EMPTY_FIELDS);
    }
  },
);

export default router;
