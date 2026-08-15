import { Router } from "express";
import { register, login, getProfile } from "../controllers/auth.controller";
import { authenticateJWT } from "../middleware/auth.middleware";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", authenticateJWT, getProfile);

export default router;
