import { Router } from 'express';
import { cartController } from './cart.controller';

const router = Router();

router.get('/', cartController.index.bind(cartController));

export default router;
