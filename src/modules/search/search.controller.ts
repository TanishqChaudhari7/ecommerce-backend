import { Request, Response, NextFunction } from 'express';
import { searchService } from './search.service';

export class SearchController {
  async index(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await searchService.ping();
      res.status(501).json({ message: 'Search module not implemented yet', ...result });
    } catch (error) {
      next(error);
    }
  }
}

export const searchController = new SearchController();
