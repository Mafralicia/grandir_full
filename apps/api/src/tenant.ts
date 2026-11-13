import type { Db } from './db';

type Params = Record<string, string | number | bigint | null | Uint8Array>;

/**
 * Único caminho pelo qual as rotas do portal acessam dados de negócio.
 *
 * Toda consulta precisa referenciar `:tenantId`, e o valor é sempre o do tenant
 * da sessão autenticada — nunca um valor vindo da requisição. Uma consulta sem
 * esse filtro é rejeitada antes de chegar ao banco, o que transforma um
 * esquecimento de `WHERE tenant_id = …` em erro imediato, e não em vazamento.
 */
export class TenantScope {
  constructor(
    private readonly db: Db,
    readonly tenantId: string,
  ) {
    if (!tenantId) throw new Error('TenantScope exige um tenantId.');
  }

  private bind(sql: string, params: Params): Params {
    if (!/:tenantId\b/.test(sql)) {
      throw new Error('Consulta bloqueada: falta o filtro :tenantId.');
    }
    return { ...params, tenantId: this.tenantId };
  }

  all<T = Record<string, unknown>>(sql: string, params: Params = {}): T[] {
    return this.db.prepare(sql).all(this.bind(sql, params)) as T[];
  }

  get<T = Record<string, unknown>>(sql: string, params: Params = {}): T | undefined {
    return this.db.prepare(sql).get(this.bind(sql, params)) as T | undefined;
  }

  run(sql: string, params: Params = {}): number {
    return Number(this.db.prepare(sql).run(this.bind(sql, params)).changes);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
