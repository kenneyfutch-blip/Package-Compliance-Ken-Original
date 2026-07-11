import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import packagesRouter from "./packages";
import regulationsRouter from "./regulations";
import suppliersRouter from "./suppliers";
import miscRouter from "./misc";
import aiProvidersRouter from "./ai-providers";
import violationsRouter from "./violations";
import languageRouter from "./language";
import ocrRouter from "./ocr";
import documentAiRouter from "./document-ai";
import proofsRouter from "./proofs";
import storageRouter from "./storage";
import fdaRouter from "./fda";
import meRouter from "./me";
import reviewsRouter from "./reviews";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// Health check stays public; everything below requires a signed-in Dollar Tree user.
router.use(healthRouter);
router.use(requireAuth);
router.use(meRouter);
router.use(dashboardRouter);
router.use(packagesRouter);
router.use(regulationsRouter);
router.use(suppliersRouter);
router.use(miscRouter);
router.use(aiProvidersRouter);
router.use(violationsRouter);
router.use(languageRouter);
router.use(ocrRouter);
router.use(documentAiRouter);
router.use(proofsRouter);
router.use(storageRouter);
router.use(fdaRouter);
router.use(reviewsRouter);

export default router;
