import { Router } from 'express';
import { ordersController } from './orders.controller';

const router = Router();

router.get('/', ordersController.index.bind(ordersController));

export default router;
