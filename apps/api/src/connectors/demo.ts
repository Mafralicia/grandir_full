import { createHash } from 'node:crypto';
import {
  addDays,
  buildReconciliation,
  expectedFeeCents,
  runAudit,
  type AuditInput,
  type CatalogItem,
  type LedgerEvent,
} from '@grandir/engines';
import type { MarketplaceConnector, StoreRef } from './index';

/**
 * Conector de demonstração: gera um ano de operação sintética, determinística
 * por loja, com divergências de todos os tipos. Nenhum dado vem de um
 * marketplace real.
 */

const CATALOG: [string, string, number, number, number, number, number][] = [
  ['GRD-CAF-001', 'Cafeteira italiana 6 xícaras', 5890, 22, 14, 12, 620],
  ['GRD-GAR-002', 'Garrafa térmica inox 1 L', 4250, 30, 9, 9, 480],
  ['GRD-MOC-003', 'Mochila executiva 25 L', 11900, 46, 32, 14, 890],
  ['GRD-FON-004', 'Fone bluetooth com cancelamento de ruído', 18900, 20, 18, 8, 310],
  ['GRD-LUM-005', 'Luminária de mesa LED articulada', 7400, 38, 16, 12, 760],
  ['GRD-TAP-006', 'Tapete de yoga antiderrapante', 6200, 62, 14, 14, 1150],
  ['GRD-ORG-007', 'Organizador de gavetas 6 peças', 3100, 32, 24, 8, 540],
  ['GRD-PAN-008', 'Jogo de panelas antiaderentes 5 peças', 23900, 52, 32, 26, 4200],
  ['GRD-BAL-009', 'Balança digital de cozinha', 2790, 22, 16, 4, 330],
  ['GRD-SUP-010', 'Suporte ergonômico para notebook', 8600, 28, 24, 5, 980],
  ['GRD-FAC-011', 'Kit de facas em aço inox 8 peças', 14500, 38, 14, 8, 1320],
  ['GRD-TOA-012', 'Jogo de toalhas 4 peças', 9800, 36, 28, 14, 1480],
  ['GRD-CAP-013', 'Capacete de ciclismo ajustável', 12900, 30, 24, 18, 410],
  ['GRD-AQU-014', 'Aquecedor portátil cerâmico', 16900, 28, 20, 20, 1900],
];

/** SKUs cujas medidas o operador registrou erradas, e o valor cobrado a mais por unidade. */
const FEE_OVERCHARGE: Record<number, number> = { 3: 180, 7: 420, 12: 260 };
const UNREQUESTED_DISPOSAL = new Set([2, 9, 11]);
const UNEXPLAINED_VARIANCE = new Set([5, 10]);

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function seededRandom(text: string): () => number {
  return mulberry32(createHash('sha256').update(text).digest().readUInt32LE(0));
}

export function generateDemoData(store: StoreRef, asOf: string): AuditInput {
  const random = seededRandom(`grandir-demo:${store.id}`);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const chance = (probability: number) => random() < probability;
  /** Data `n` dias antes da conexão da loja; nunca no futuro. */
  const day = (n: number) => addDays(store.createdAt, -Math.max(0, n));
  let sequence = 0;
  const id = (prefix: string) => `${prefix}-${String(++sequence).padStart(5, '0')}`;

  const catalog: CatalogItem[] = CATALOG.map(([sku, name, unitCostCents, lengthCm, widthCm, heightCm, weightG]) => ({
    sku, name, unitCostCents, lengthCm, widthCm, heightCm, weightG,
  }));

  const input: AuditInput = {
    asOf,
    catalog,
    openingBalances: {},
    reportedBalances: {},
    ledger: [],
    reimbursements: [],
    inboundShipments: [],
    removalOrders: [],
    feeCharges: [],
    customerReturns: [],
  };
  const push = (event: Omit<LedgerEvent, 'id' | 'disposition'> & { disposition?: LedgerEvent['disposition'] }) =>
    input.ledger.push({ id: id('MOV'), disposition: 'SELLABLE', ...event });

  catalog.forEach((item, index) => {
    const { sku } = item;
    let balance = int(300, 700);
    input.openingBalances[sku] = balance;
    const fee = expectedFeeCents(item);

    for (let week = 52; week >= 1; week--) {
      const daysBack = week * 7 - int(0, 6);

      if (week % 6 === index % 6) {
        const received = int(120, 380);
        const shortage = chance(0.24) ? int(3, 26) : 0;
        const shipmentId = id('REM');
        input.inboundShipments.push({
          id: shipmentId,
          closedAt: daysBack >= 4 ? day(daysBack - 3) : null,
          lines: [{ sku, shipped: received + shortage, received }],
        });
        push({ sku, date: day(daysBack), type: 'RECEIPT', quantity: received, referenceId: shipmentId });
        balance += received;
        if (shortage > 0 && chance(0.2)) {
          const quantity = int(1, shortage);
          input.reimbursements.push({
            id: id('RMB'), type: 'INBOUND_SHORTAGE', sku, date: day(Math.max(0, daysBack - 40)),
            quantity, amountCents: quantity * item.unitCostCents, referenceId: shipmentId,
          });
        }
      }

      const sold = Math.min(balance, int(15, 70));
      if (sold > 0) {
        push({ sku, date: day(daysBack), type: 'SHIPMENT', quantity: sold });
        balance -= sold;
        input.feeCharges.push({
          id: id('TAR'), sku, date: day(daysBack), units: sold,
          chargedPerUnitCents: fee + (daysBack <= 150 ? (FEE_OVERCHARGE[index] ?? 0) : 0),
        });
      }
    }

    for (let n = int(0, 3); n > 0; n--) {
      const daysBack = int(8, 340);
      const quantity = int(1, 7);
      push({ sku, date: day(daysBack), type: 'ADJUSTMENT_LOST', quantity });
      if (chance(0.3)) {
        push({ sku, date: day(daysBack - int(5, 25)), type: 'ADJUSTMENT_FOUND', quantity: int(1, quantity) });
      } else if (chance(0.25)) {
        input.reimbursements.push({
          id: id('RMB'), type: 'LOST_WAREHOUSE', sku, date: day(daysBack - 35),
          quantity, amountCents: quantity * item.unitCostCents,
        });
      }
    }

    for (let n = int(0, 2); n > 0; n--) {
      const daysBack = int(10, 330);
      const quantity = int(1, 4);
      push({ sku, date: day(daysBack), type: 'ADJUSTMENT_DAMAGED', quantity });
      if (chance(0.3)) {
        input.reimbursements.push({
          id: id('RMB'), type: 'DAMAGED_WAREHOUSE', sku, date: day(daysBack - 30),
          quantity, amountCents: quantity * item.unitCostCents,
        });
      }
    }

    if (UNREQUESTED_DISPOSAL.has(index)) {
      push({ sku, date: day(int(40, 300)), type: 'DISPOSAL', quantity: int(2, 6) });
    }

    if (chance(0.6)) {
      const daysBack = int(36, 320);
      const sent = int(20, 60);
      const transferId = id('TRF');
      push({ sku, date: day(daysBack), type: 'TRANSFER_OUT', quantity: sent, referenceId: transferId });
      push({
        sku, date: day(daysBack - 4), type: 'TRANSFER_IN',
        quantity: sent - (chance(0.4) ? int(1, 5) : 0), referenceId: transferId,
      });
    }

    if (chance(0.45)) {
      const requested = int(15, 60);
      const disposed = chance(0.3) ? int(1, 5) : 0;
      const missing = chance(0.45) ? int(1, 8) : 0;
      const orderId = id('RMO');
      const daysBack = int(35, 250);
      input.removalOrders.push({
        id: orderId, sku, completedAt: day(daysBack), requested, disposed,
        delivered: requested - disposed - missing,
      });
      push({ sku, date: day(daysBack + 6), type: 'REMOVAL', quantity: requested, referenceId: orderId });
    }
  });

  for (let n = 0; n < 28; n++) {
    const item = catalog[int(0, catalog.length - 1)];
    const daysBack = int(5, 300);
    const orderId = id('PED');
    const returned = chance(0.74);
    const returnedAt = day(daysBack - int(3, 20));
    input.customerReturns.push({
      orderId, sku: item.sku, quantity: 1, refundedAt: day(daysBack),
      refundCents: Math.round((item.unitCostCents * int(180, 240)) / 100),
      returnedAt: returned ? returnedAt : null,
    });
    if (returned) {
      push({ sku: item.sku, date: returnedAt, type: 'CUSTOMER_RETURN', quantity: 1, referenceId: orderId });
    } else if (chance(0.2)) {
      input.reimbursements.push({
        id: id('RMB'), type: 'RETURN_NOT_RECEIVED', sku: item.sku, date: day(daysBack - 50),
        quantity: 1, amountCents: item.unitCostCents, referenceId: orderId,
      });
    }
  }

  // Garante saldos coerentes e, em dois SKUs, um saldo informado menor do que o razão explica.
  for (const row of buildReconciliation(input)) {
    if (row.expectedEnding < 20) input.openingBalances[row.sku] += 20 - row.expectedEnding;
  }
  buildReconciliation(input).forEach((row, index) => {
    input.reportedBalances[row.sku] = row.expectedEnding - (UNEXPLAINED_VARIANCE.has(index) ? int(2, 6) : 0);
  });

  return input;
}

export const demoConnector: MarketplaceConnector = {
  id: 'demo',
  label: 'Ambiente de demonstração',
  async audit(store, asOf) {
    const result = runAudit(generateDemoData(store, asOf));
    return {
      discrepancies: result.discrepancies,
      reconciliation: result.reconciliation,
      eventsScanned: result.stats.eventsScanned,
      pendingCount: result.stats.pendingCount,
      expiredCount: result.stats.expiredCount,
    };
  },
};
