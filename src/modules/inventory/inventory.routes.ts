import { Router } from 'express';
import { inventoryController } from './inventory.controller';

const router = Router();

router.get('/', inventoryController.index.bind(inventoryController));

export default router;
