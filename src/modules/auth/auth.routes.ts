import { Router } from 'express';
import { authController } from './auth.controller';

const router = Router();

router.get('/', authController.index.bind(authController));

export default router;
