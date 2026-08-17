import { Router } from 'express';
import { createFavorite, getFavorites, deleteFavorite } from '../controllers/favorite.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();
router.use(authenticateJWT);

router.post('/', createFavorite);
router.get('/', getFavorites);
router.delete('/:id', deleteFavorite);

export default router;