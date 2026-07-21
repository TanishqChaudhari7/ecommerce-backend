import { Router } from 'express';
import { paymentsController } from './payments.controller';

const router = Router();

router.get('/', paymentsController.index.bind(paymentsController));

export default router;
