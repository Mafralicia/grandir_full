import { useCallback, useEffect, useState } from 'react';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// O token CSRF vive só na memória da aba; o cookie de sessão é HttpOnly e o JavaScript não o lê.
let csrfToken = '';
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  onUnauthorized = handler;
};

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  body?: unknown;
  file?: Blob;
}

export async function api<T = unknown>(path: string, options: Options = {}): Promise<T> {
  const method = options.method ?? (options.body !== undefined || options.file ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.file) {
    headers['Content-Type'] = 'application/octet-stream';
    body = options.file;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'SEM_CONEXAO', 'Não foi possível falar com o servidor. Verifique sua conexão.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && data?.error?.code === 'NAO_AUTENTICADO') onUnauthorized?.();
    throw new ApiError(response.status, data?.error?.code ?? 'ERRO', data?.error?.message ?? 'Algo deu errado. Tente novamente.');
  }
  if (data && typeof data.csrfToken === 'string') csrfToken = data.csrfToken;
  return data as T;
}

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Algo deu errado. Tente novamente.';

/** Carrega um recurso da API e expõe estado de carregamento, erro e recarga. */
export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);

  const reload = useCallback(async () => {
    if (path === null) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(path !== null);
    void reload();
  }, [path, reload]);

  return { data, error, loading, reload };
}
