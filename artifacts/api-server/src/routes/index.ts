import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import packagesRouter from "./packages";
import regulationsRouter from "./regulations";
import suppliersRouter from "./suppliers";
import miscRouter from "./misc";
import aiProvidersRouter from "./ai-providers";
import violationsRouter from "./violations";
import ocrRouter from "./ocr";
import proofsRouter from "./proofs";
import storageRouter from "./storage";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// Health check stays public; everything below requires a signed-in Dollar Tree user.
router.use(healthRouter);
router.use(requireAuth);
router.use(dashboardRouter);
router.use(packagesRouter);
router.use(regulationsRouter);
router.use(suppliersRouter);
router.use(miscRouter);
router.use(aiProvidersRouter);
router.use(violationsRouter);
router.use(ocrRouter);
router.use(proofsRouter);
router.use(storageRouter);

export default router;
