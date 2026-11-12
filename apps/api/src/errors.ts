/** Erro de negócio com status HTTP e código estável para o front-end. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'REQUISICAO_INVALIDA') => new AppError(400, code, message);
export const unauthorized = (message = 'Sessão expirada. Entre novamente.', code = 'NAO_AUTENTICADO') =>
  new AppError(401, code, message);
export const forbidden = (message = 'Você não tem permissão para esta ação.', code = 'SEM_PERMISSAO') =>
  new AppError(403, code, message);
export const notFound = (message = 'Registro não encontrado.') => new AppError(404, 'NAO_ENCONTRADO', message);
export const conflict = (message: string, code = 'CONFLITO') => new AppError(409, code, message);
