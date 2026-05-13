import { Router, type IRouter } from "express";
import healthRouter from "./health";
import overviewRouter from "./overview";
import pipelinesRouter from "./pipelines";
import performanceRouter from "./performance";
import incidentsRouter from "./incidents";
import rcaRouter from "./rca";
import costsRouter from "./costs";
import lambdasRouter from "./lambdas";
import logsRouter from "./logs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(overviewRouter);
router.use(pipelinesRouter);
router.use(performanceRouter);
router.use(incidentsRouter);
router.use(rcaRouter);
router.use(costsRouter);
router.use(lambdasRouter);
router.use(logsRouter);

export default router;
