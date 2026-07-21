export class AuthService {
  async ping(): Promise<{ module: string }> {
    return { module: 'auth' };
  }
}

export const authService = new AuthService();
