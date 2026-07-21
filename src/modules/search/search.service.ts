export class SearchService {
  async ping(): Promise<{ module: string }> {
    return { module: 'search' };
  }
}

export const searchService = new SearchService();
