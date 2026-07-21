import { Router } from 'express';
import { productsController } from './products.controller';

const router = Router();

router.get('/', productsController.index.bind(productsController));

export default router;
