import { Router } from "express";
import { parseSmartAlarm } from "../controllers/ai.controller";
import { authenticateJWT } from "../middleware/auth.middleware";

const router = Router();

// Protect with JWT
router.post("/parse-alarm", authenticateJWT, parseSmartAlarm);

export default router;
