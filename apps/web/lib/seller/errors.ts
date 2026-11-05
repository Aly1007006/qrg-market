export class SellerApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SellerApiError';
    this.status = status;
  }
}

export function loginErrorMessage(error: unknown): string {
  if (error instanceof SellerApiError && error.status === 401)
    return 'Не удалось войти. Проверьте email и пароль.';
  return error instanceof Error
    ? error.message
    : 'Не удалось войти. Попробуйте снова.';
}
