import type { AuditPolicy } from './policy';
import type { AuditInput, DetectorResult } from './types';
import { catalogIndex, claimWindow, fingerprint, fmtDate, mulUnits, reimbursedUnits } from './util';

const empty = (): DetectorResult => ({ discrepancies: [], pendingCount: 0, expiredCount: 0 });

/** Remessas fechadas em que o centro de distribuição contou menos unidades do que as enviadas. */
export function detectInboundShortages(input: AuditInput, policy: AuditPolicy): DetectorResult {
  const catalog = catalogIndex(input.catalog);
  const result = empty();

  for (const shipment of input.inboundShipments) {
    if (!shipment.closedAt) continue;
    for (const line of shipment.lines) {
      const shortage =
        line.shipped -
        line.received -
        reimbursedUnits(input.reimbursements, 'INBOUND_SHORTAGE', line.sku, shipment.id);
      if (shortage <= 0) continue;

      const window = claimWindow(
        shipment.closedAt,
        input.asOf,
        policy.inboundWaitDays,
        policy.inboundClaimWindowDays,
      );
      if (window.state === 'PENDING') {
        result.pendingCount += 1;
        continue;
      }
      if (window.state === 'EXPIRED') {
        result.expiredCount += 1;
        continue;
      }
      const item = catalog.get(line.sku);
      result.discrepancies.push({
        fingerprint: fingerprint('INBOUND_SHORTAGE', line.sku, shipment.id),
        type: 'INBOUND_SHORTAGE',
        sku: line.sku,
        productName: item?.name ?? line.sku,
        quantity: shortage,
        estimatedValueCents: mulUnits(item?.unitCostCents ?? 0, shortage),
        referenceId: shipment.id,
        occurredAt: shipment.closedAt,
        expiresAt: window.expiresAt,
        evidence: [
          `Remessa ${shipment.id} fechada em ${fmtDate(shipment.closedAt)}: ${line.shipped} un. enviadas, ${line.received} un. recebidas.`,
          `${shortage} un. em falta. Exige nota fiscal de compra e comprovante de entrega.`,
        ],
      });
    }
  }
  return result;
}

/** Ordens de remoção concluídas em que nem todas as unidades foram devolvidas ao seller. */
export function detectRemovalShortages(input: AuditInput, policy: AuditPolicy): DetectorResult {
  const catalog = catalogIndex(input.catalog);
  const result = empty();

  for (const order of input.removalOrders) {
    if (!order.completedAt) continue;
    const missing =
      order.requested -
      order.delivered -
      order.disposed -
      reimbursedUnits(input.reimbursements, 'REMOVAL_NOT_RECEIVED', order.sku, order.id);
    if (missing <= 0) continue;

    const window = claimWindow(
      order.completedAt,
      input.asOf,
      policy.removalWaitDays,
      policy.removalClaimWindowDays,
    );
    if (window.state === 'PENDING') {
      result.pendingCount += 1;
      continue;
    }
    if (window.state === 'EXPIRED') {
      result.expiredCount += 1;
      continue;
    }
    const item = catalog.get(order.sku);
    result.discrepancies.push({
      fingerprint: fingerprint('REMOVAL_NOT_RECEIVED', order.sku, order.id),
      type: 'REMOVAL_NOT_RECEIVED',
      sku: order.sku,
      productName: item?.name ?? order.sku,
      quantity: missing,
      estimatedValueCents: mulUnits(item?.unitCostCents ?? 0, missing),
      referenceId: order.id,
      occurredAt: order.completedAt,
      expiresAt: window.expiresAt,
      evidence: [
        `Ordem de remoção ${order.id}: ${order.requested} un. solicitadas, ${order.delivered} un. entregues, ${order.disposed} un. descartadas a pedido.`,
        `${missing} un. não chegaram ao destino.`,
      ],
    });
  }
  return result;
}

/** Pedidos reembolsados ao comprador cujo item nunca voltou ao estoque. */
export function detectUnreturnedRefunds(input: AuditInput, policy: AuditPolicy): DetectorResult {
  const catalog = catalogIndex(input.catalog);
  const result = empty();

  for (const ret of input.customerReturns) {
    if (ret.returnedAt) continue;
    if (reimbursedUnits(input.reimbursements, 'RETURN_NOT_RECEIVED', ret.sku, ret.orderId) >= ret.quantity) {
      continue;
    }
    const window = claimWindow(
      ret.refundedAt,
      input.asOf,
      policy.returnWaitDays,
      policy.returnClaimWindowDays,
    );
    if (window.state === 'PENDING') {
      result.pendingCount += 1;
      continue;
    }
    if (window.state === 'EXPIRED') {
      result.expiredCount += 1;
      continue;
    }
    const item = catalog.get(ret.sku);
    result.discrepancies.push({
      fingerprint: fingerprint('RETURN_NOT_RECEIVED', ret.sku, ret.orderId),
      type: 'RETURN_NOT_RECEIVED',
      sku: ret.sku,
      productName: item?.name ?? ret.sku,
      quantity: ret.quantity,
      estimatedValueCents: ret.refundCents,
      referenceId: ret.orderId,
      occurredAt: ret.refundedAt,
      expiresAt: window.expiresAt,
      evidence: [
        `Pedido ${ret.orderId} reembolsado ao comprador em ${fmtDate(ret.refundedAt)}.`,
        `Item não retornou ao estoque em ${policy.returnWaitDays} dias e não houve compensação.`,
      ],
    });
  }
  return result;
}
