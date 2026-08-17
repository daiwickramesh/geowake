import { Router } from 'express';
import {
  createAlarm,
  getUserAlarms,
  updateAlarmStatus,
  deleteAlarm,
  deleteAllAlarms,
} from '../controllers/alarm.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();
router.use(authenticateJWT);

router.post('/', createAlarm);
router.get('/', getUserAlarms);
router.delete('/clear-all', deleteAllAlarms); // 🗑️ Clear All Endpoint
router.patch('/:id/status', updateAlarmStatus);
router.delete('/:id', deleteAlarm);

export default router;