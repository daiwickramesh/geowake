import { Router } from "express";
import {
  createAlarm,
  getUserAlarms,
  updateAlarmStatus,
  deleteAlarm,
} from "../controllers/alarm.controller";
import { authenticateJWT } from "../middleware/auth.middleware";

const router = Router();

// All alarm routes require a valid JWT token
router.use(authenticateJWT);

router.post("/", createAlarm);
router.get("/", getUserAlarms);
router.patch("/:id/status", updateAlarmStatus);
router.delete("/:id", deleteAlarm);

export default router;
