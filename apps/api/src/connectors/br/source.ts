import { runBrAudit, type BrAuditInput, type BrMarketplace, type Discrepancy } from '@grandir/engines';
import type { AuditOutcome, MarketplaceConnector, StoreRef } from '../index';

/**
 * Origem dos dados de um marketplace brasileiro. A implementação real chama as APIs
 * oficiais (pedidos, envios, faturamento, devoluções) com as credenciais OAuth da loja;
 * a de demonstração gera uma operação sintética.
 */
export interface BrDataSource {
  load(store: StoreRef, marketplace: BrMarketplace, asOf: string): Promise<BrAuditInput>;
}

/** Monta um conector a partir de uma origem de dados: carrega, aplica o ERP e roda as regras. */
export function brConnector(id: string, label: string, marketplace: BrMarketplace, source: BrDataSource): MarketplaceConnector {
  return {
    id,
    label,
    async audit(store, asOf): Promise<AuditOutcome> {
      const input = await source.load(store, marketplace, asOf);
      // O cadastro do ERP é a fonte de verdade para custo, peso e medidas.
      const erp = new Map(store.erpProducts.map((product) => [product.sku, product]));
      input.products = input.products.map((product) => {
        const own = erp.get(product.sku);
        if (!own) return product;
        return {
          ...product,
          weightG: own.weightG,
          lengthCm: own.lengthCm,
          widthCm: own.widthCm,
          heightCm: own.heightCm,
          costCents: own.costCents || product.costCents,
          ean: own.ean || product.ean,
        };
      });

      const result = runBrAudit(input);
      const discrepancies: Discrepancy[] = result.findings.map((finding) => ({
        fingerprint: finding.fingerprint,
        type: finding.rule,
        sku: finding.sku,
        productName: finding.productName,
        quantity: finding.quantity,
        estimatedValueCents: finding.recoverableCents,
        referenceId: finding.fingerprint.split(':').slice(2).join(':'),
        occurredAt: finding.occurredAt,
        expiresAt: finding.deadlineAt,
        evidence: finding.details.calc,
        details: finding.details,
      }));
      return { discrepancies, reconciliation: result.reconciliation, eventsScanned: result.recordsScanned, pendingCount: 0, expiredCount: 0 };
    },
  };
}
