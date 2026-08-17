import { Router } from 'express';
import { register, login, getProfile, googleAuth } from '../controllers/auth.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

router.post('/google', googleAuth);
router.post('/register', register);
router.post('/login', login);
router.get('/me', authenticateJWT, getProfile);

export default router;