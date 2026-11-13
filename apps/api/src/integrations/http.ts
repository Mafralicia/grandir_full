/**
 * Cliente HTTP das integrações: uma requisição por vez com intervalo mínimo (limite de
 * taxa), nova tentativa com espera exponencial em 429 e 5xx, e respeito a Retry-After.
 */
export class IntegrationError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'IntegrationError';
  }
}

/** Dependências substituíveis em teste: nenhuma chamada real sai sem passar por aqui. */
export const runtime: { fetch: typeof fetch; sleep: (ms: number) => Promise<void> } = {
  fetch: (...args) => globalThis.fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface HttpOptions {
  /** Intervalo mínimo entre requisições, em ms. */
  minIntervalMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface Http {
  json<T>(url: string, init?: RequestInit): Promise<T>;
}

export function createHttp(options: HttpOptions = {}): Http {
  const { minIntervalMs = 250, maxRetries = 4, timeoutMs = 20_000 } = options;
  let queue: Promise<unknown> = Promise.resolve();
  let lastAt = 0;

  async function attempt<T>(url: string, init: RequestInit | undefined): Promise<T> {
    for (let tryNumber = 0; ; tryNumber++) {
      const wait = lastAt + minIntervalMs - Date.now();
      if (wait > 0) await runtime.sleep(wait);
      lastAt = Date.now();

      let response: Response;
      try {
        response = await runtime.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      } catch (cause) {
        if (tryNumber >= maxRetries) throw new IntegrationError(0, `Falha de rede ao chamar ${new URL(url).host}.`, String(cause));
        await runtime.sleep(Math.min(500 * 2 ** tryNumber, 8_000));
        continue;
      }
      if (response.ok) return (await response.json()) as T;

      const retriable = response.status === 429 || response.status >= 500;
      if (retriable && tryNumber < maxRetries) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await runtime.sleep(retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : Math.min(500 * 2 ** tryNumber, 8_000));
        continue;
      }
      const body = await response.json().catch(() => null);
      throw new IntegrationError(response.status, `${new URL(url).host} respondeu ${response.status}.`, body);
    }
  }

  return {
    json<T>(url: string, init?: RequestInit): Promise<T> {
      // Encadeia as chamadas: o limite de taxa vale para o cliente inteiro, não por requisição.
      const result = queue.then(() => attempt<T>(url, init));
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
