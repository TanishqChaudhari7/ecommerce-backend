import { Request, Response, NextFunction } from 'express';
import { searchService } from './search.service';
import { SearchQuery } from './search.validation';

export class SearchController {
  async search(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = res.locals.query as SearchQuery;
      const result = await searchService.search(query);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const searchController = new SearchController();
