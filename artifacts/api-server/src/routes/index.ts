import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import packagesRouter from "./packages";
import regulationsRouter from "./regulations";
import suppliersRouter from "./suppliers";
import miscRouter from "./misc";
import aiProvidersRouter from "./ai-providers";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(packagesRouter);
router.use(regulationsRouter);
router.use(suppliersRouter);
router.use(miscRouter);
router.use(aiProvidersRouter);

export default router;
