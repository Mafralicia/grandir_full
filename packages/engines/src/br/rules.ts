import type { SkuReconciliation } from '../types';
import { addDays, daysBetween, fmtDate } from '../util';
import type {
  BrAuditInput,
  BrRule,
  ErpProduct,
  Finding,
  FindingDetails,
  FindingIds,
  LogisticsIncident,
  MarketplaceOrder,
  Nfe,
} from './model';
import { billableWeightG, brl, freightFor, pct, REFERENCE_TABLES, type BrTables } from './tables';

interface Context {
  input: BrAuditInput;
  tables: BrTables;
  products: Map<string, ErpProduct>;
  orders: Map<string, MarketplaceOrder>;
  /** NF-e de venda por pedido, para anexar a chave ao dossiê. */
  saleInvoices: Map<string, Nfe>;
  out: Finding[];
}

const NAME: Record<string, string> = { mercadolivre: 'Mercado Livre', shopee: 'Shopee' };

function emit(
  ctx: Context,
  rule: BrRule,
  reference: string,
  sku: string,
  quantity: number,
  occurredAt: string,
  details: Omit<FindingDetails, 'marketplace' | 'amountLabels'>,
): void {
  const recoverableCents = details.expectedCents - details.actualCents;
  if (recoverableCents <= ctx.tables.toleranceCents) return;
  const deadlineAt = addDays(occurredAt, ctx.tables.deadlineDays[rule]);
  // Prazo vencido: não há o que contestar.
  if (deadlineAt < ctx.input.asOf) return;
  const product = ctx.products.get(sku);
  ctx.out.push({
    fingerprint: `${rule}:${sku}:${reference}`,
    rule,
    sku,
    productName: product?.name ?? sku,
    quantity,
    recoverableCents,
    occurredAt,
    deadlineAt,
    details: {
      ...details,
      marketplace: ctx.input.marketplace,
      amountLabels: rule.endsWith('_OVERCHARGE') ? ['Valor cobrado', 'Valor correto'] : ['Valor devido', 'Valor creditado'],
      ids: { ean: product?.ean, ...details.ids },
      timeline: [...details.timeline, { at: deadlineAt, label: 'Prazo limite para contestação' }].sort((a, b) =>
        a.at.localeCompare(b.at),
      ),
    },
  });
}

function orderIds(ctx: Context, order: MarketplaceOrder | undefined): FindingIds {
  if (!order) return {};
  return {
    orderId: order.orderId,
    shipmentId: order.shipmentId,
    trackingCode: order.trackingCode,
    itemId: order.itemId,
    nfeKey: ctx.saleInvoices.get(order.orderId)?.accessKey,
  };
}

// ───────────────────────── Extravio e avaria ─────────────────────────

const INCIDENT_RULE: Record<string, Partial<Record<LogisticsIncident['kind'], BrRule>>> = {
  mercadolivre: { WAREHOUSE_LOSS: 'ML_WAREHOUSE_LOSS', WAREHOUSE_DAMAGE: 'ML_WAREHOUSE_DAMAGE', TRANSIT_LOSS: 'ML_TRANSIT_LOSS', REVERSE_LOSS: 'ML_TRANSIT_LOSS' },
  shopee: { TRANSIT_LOSS: 'SHOPEE_LOST_NO_CREDIT', REVERSE_LOSS: 'SHOPEE_LOST_NO_CREDIT', WAREHOUSE_LOSS: 'SHOPEE_LOST_NO_CREDIT', WAREHOUSE_DAMAGE: 'SHOPEE_LOST_NO_CREDIT' },
};

const INCIDENT_TEXT: Record<LogisticsIncident['kind'], string> = {
  WAREHOUSE_LOSS: 'extraviadas dentro do centro de distribuição',
  WAREHOUSE_DAMAGE: 'avariadas sob custódia do centro de distribuição',
  TRANSIT_LOSS: 'extraviadas em trânsito',
  REVERSE_LOSS: 'extraviadas na logística reversa',
};

/** Unidades perdidas ou avariadas sob custódia do operador, sem indenização integral. */
function auditIncidents(ctx: Context): void {
  for (const incident of ctx.input.incidents) {
    const rule = INCIDENT_RULE[ctx.input.marketplace][incident.kind];
    if (!rule) continue;
    if (daysBetween(incident.occurredAt, ctx.input.asOf) < ctx.tables.incidentWaitDays) continue;
    const product = ctx.products.get(incident.sku);
    const order = incident.orderId ? ctx.orders.get(incident.orderId) : undefined;
    // Pedido já vendido: o prejuízo é o valor da venda. Estoque parado: o custo do produto.
    const expectedCents = order ? order.grossCents : (product?.costCents ?? 0) * incident.quantity;
    const basis = order
      ? `valor da venda do pedido ${order.orderId} (${brl(order.grossCents)})`
      : `custo unitário no ERP ${brl(product?.costCents ?? 0)} × ${incident.quantity} un.`;
    emit(ctx, rule, incident.id, incident.sku, incident.quantity, incident.occurredAt, {
      ids: { ...orderIds(ctx, order), shipmentId: incident.shipmentId ?? order?.shipmentId, inboundId: incident.inboundId },
      expectedCents,
      actualCents: incident.compensatedCents,
      policy: `Responsabilidade do ${NAME[ctx.input.marketplace]} por produtos sob sua custódia ou de sua malha logística: perdas e avarias devem ser indenizadas ao seller.`,
      calc: [
        `${incident.quantity} un. ${INCIDENT_TEXT[incident.kind]} em ${fmtDate(incident.occurredAt)} (ocorrência ${incident.id}).`,
        `Indenização devida: ${basis} = ${brl(expectedCents)}.`,
        `Indenização creditada: ${brl(incident.compensatedCents)}.`,
        `Diferença a recuperar: ${brl(expectedCents - incident.compensatedCents)}.`,
      ],
      timeline: [
        ...(order ? [{ at: order.saleDate, label: `Venda do pedido ${order.orderId}` }] : []),
        { at: incident.occurredAt, label: `Ocorrência registrada: unidades ${INCIDENT_TEXT[incident.kind]}` },
      ],
    });
  }
}

// ───────────────────────── Frete por peso cubado ─────────────────────────

/** Frete cobrado acima do que as medidas e o peso cadastrados no ERP justificam. */
function auditFreight(ctx: Context): void {
  const isMl = ctx.input.marketplace === 'mercadolivre';
  const table = isMl ? ctx.tables.ml : ctx.tables.shopee;
  for (const order of ctx.input.orders) {
    const product = ctx.products.get(order.sku);
    if (!product || order.shippingChargedCents === 0) continue;
    const weightG = billableWeightG(product, table.cubicDivisor);
    const expectedCents = freightFor(weightG, table.freight);
    if (order.billedWeightG <= weightG) continue;
    emit(ctx, isMl ? 'ML_FREIGHT_OVERCHARGE' : 'SHOPEE_FREIGHT_OVERCHARGE', order.orderId, order.sku, order.quantity, order.saleDate, {
      ids: orderIds(ctx, order),
      expectedCents: order.shippingChargedCents,
      actualCents: expectedCents,
      policy: `Tabela de frete do ${NAME[ctx.input.marketplace]}: a cobrança considera o maior entre o peso real e o peso cubado (C × L × A ÷ ${table.cubicDivisor}).`,
      calc: [
        `Cadastro no ERP: ${product.lengthCm} × ${product.widthCm} × ${product.heightCm} cm, ${product.weightG} g.`,
        `Peso tarifável correto: ${weightG} g → frete de ${brl(expectedCents)}.`,
        `Peso usado na cobrança: ${order.billedWeightG} g → frete cobrado de ${brl(order.shippingChargedCents)}.`,
        `Cobrança a maior: ${brl(order.shippingChargedCents - expectedCents)}.`,
      ],
      timeline: [{ at: order.saleDate, label: `Venda e postagem do pedido ${order.orderId}` }],
    });
  }
}

// ───────────────────────── Devoluções e mediações ─────────────────────────

/** Devolução encerrada a favor do comprador em que o produto não voltou, ou voltou avariado. */
function auditReturns(ctx: Context): void {
  if (ctx.input.marketplace !== 'mercadolivre') return;
  for (const ret of ctx.input.returns) {
    if (ret.resolution !== 'BUYER') continue;
    if (daysBetween(ret.closedAt, ctx.input.asOf) < ctx.tables.incidentWaitDays) continue;
    const order = ctx.orders.get(ret.orderId);
    const product = ctx.products.get(ret.sku);
    const timeline = [
      ...(order ? [{ at: order.saleDate, label: `Venda do pedido ${ret.orderId}` }] : []),
      { at: ret.closedAt, label: 'Mediação encerrada a favor do comprador' },
    ];
    if (!ret.returnedToStock) {
      emit(ctx, 'ML_RETURN_NOT_RESTOCKED', ret.id, ret.sku, ret.quantity, ret.closedAt, {
        ids: orderIds(ctx, order),
        expectedCents: ret.refundedToBuyerCents,
        actualCents: ret.compensatedCents,
        policy: 'Devoluções do Mercado Livre: se o comprador foi reembolsado e o produto não retornou ao seller, o valor deve ser restituído.',
        calc: [
          `Comprador reembolsado em ${brl(ret.refundedToBuyerCents)} na mediação ${ret.id}.`,
          'Produto não retornou ao estoque físico nem ao estoque do centro de distribuição.',
          `Valor restituído ao seller: ${brl(ret.compensatedCents)}.`,
          `Diferença a recuperar: ${brl(ret.refundedToBuyerCents - ret.compensatedCents)}.`,
        ],
        timeline,
      });
    } else if (ret.returnedCondition === 'DAMAGED') {
      const expectedCents = (product?.costCents ?? 0) * ret.quantity;
      emit(ctx, 'ML_RETURN_DAMAGED', ret.id, ret.sku, ret.quantity, ret.closedAt, {
        ids: orderIds(ctx, order),
        expectedCents,
        actualCents: ret.compensatedCents,
        policy: 'Devoluções do Mercado Livre: produto devolvido em condição diferente da enviada dá direito a indenização.',
        calc: [
          `Produto da mediação ${ret.id} retornou avariado, sem condição de revenda.`,
          `Custo no ERP: ${brl(product?.costCents ?? 0)} × ${ret.quantity} un. = ${brl(expectedCents)}.`,
          `Indenização creditada: ${brl(ret.compensatedCents)}.`,
          `Diferença a recuperar: ${brl(expectedCents - ret.compensatedCents)}.`,
        ],
        timeline,
      });
    }
  }
}

// ───────────────────────── Comissão e tarifa fixa (Mercado Livre) ─────────────────────────

function auditMlCommission(ctx: Context): void {
  if (ctx.input.marketplace !== 'mercadolivre') return;
  const { ml } = ctx.tables;
  for (const order of ctx.input.orders) {
    const rule = ml.commissions.find((c) => c.categoryId === order.categoryId) ?? ml.defaultCommission;
    const rateBps = rule.rateBps[order.listingType];
    const commission = Math.round((order.grossCents * rateBps) / 10_000);
    const unitPrice = order.grossCents / order.quantity;
    const fixed = unitPrice < ml.fixedFeeBelowCents ? ml.fixedFeeCents * order.quantity : 0;
    const charged = order.commissionCents + order.feeCents;
    emit(ctx, 'ML_COMMISSION_OVERCHARGE', order.orderId, order.sku, order.quantity, order.saleDate, {
      ids: orderIds(ctx, order),
      expectedCents: charged,
      actualCents: commission + fixed,
      policy: `Tarifas de venda do Mercado Livre: categoria "${rule.label}", anúncio ${order.listingType}, comissão de ${pct(rateBps)}; tarifa fixa de ${brl(ml.fixedFeeCents)} por unidade abaixo de ${brl(ml.fixedFeeBelowCents)}.`,
      calc: [
        `Valor da venda: ${brl(order.grossCents)} (${order.quantity} un.).`,
        `Comissão correta: ${pct(rateBps)} = ${brl(commission)}; tarifa fixa correta: ${brl(fixed)}.`,
        `Cobrado: comissão de ${brl(order.commissionCents)} + tarifa fixa de ${brl(order.feeCents)} = ${brl(charged)}.`,
        `Cobrança a maior: ${brl(charged - commission - fixed)}.`,
      ],
      timeline: [{ at: order.saleDate, label: `Venda do pedido ${order.orderId}` }],
    });
  }
}

// ───────────────────────── Repasse líquido (Shopee) ─────────────────────────

function auditShopeePayout(ctx: Context): void {
  if (ctx.input.marketplace !== 'shopee') return;
  const { shopee } = ctx.tables;
  for (const order of ctx.input.orders) {
    if (order.settledCents === null || !order.settledAt) continue;
    const commission = Math.min(Math.round((order.grossCents * shopee.commissionBps) / 10_000), shopee.commissionCapCents * order.quantity);
    const transaction = Math.round((order.grossCents * shopee.transactionFeeBps) / 10_000);
    const expectedNet = order.grossCents - commission - transaction - order.shippingChargedCents;
    emit(ctx, 'SHOPEE_PAYOUT_SHORTFALL', order.orderId, order.sku, order.quantity, order.settledAt, {
      ids: orderIds(ctx, order),
      expectedCents: expectedNet,
      actualCents: order.settledCents,
      policy: `Repasse da Shopee: preço de venda menos comissão de ${pct(shopee.commissionBps)} (teto de ${brl(shopee.commissionCapCents)} por item), taxa de transação de ${pct(shopee.transactionFeeBps)} e frete do seller.`,
      calc: [
        `Valor da venda: ${brl(order.grossCents)}.`,
        `(−) Comissão: ${brl(commission)}; (−) taxa de transação: ${brl(transaction)}; (−) frete: ${brl(order.shippingChargedCents)}.`,
        `Repasse líquido esperado: ${brl(expectedNet)}.`,
        `Valor liquidado na carteira: ${brl(order.settledCents)}.`,
        `Diferença a recuperar: ${brl(expectedNet - order.settledCents)}.`,
      ],
      timeline: [
        { at: order.saleDate, label: `Venda do pedido ${order.orderId}` },
        { at: order.settledAt, label: 'Liquidação na carteira Shopee' },
      ],
    });
  }
}

// ───────────────────────── ERP × marketplace ─────────────────────────

/** NF-e de remessa para o armazém com mais unidades do que o centro de distribuição conferiu. */
function auditInboundGaps(ctx: Context): void {
  const received = new Map<string, { qty: number; at: string }>();
  for (const receipt of ctx.input.receipts) {
    const key = `${receipt.inboundId}|${receipt.sku}`;
    const entry = received.get(key);
    received.set(key, { qty: (entry?.qty ?? 0) + receipt.receivedQty, at: receipt.receivedAt });
  }
  for (const nfe of ctx.input.invoices) {
    if (nfe.kind !== 'REMESSA' || !nfe.inboundId) continue;
    if (daysBetween(nfe.issuedAt, ctx.input.asOf) < ctx.tables.inboundWaitDays) continue;
    const receipt = received.get(`${nfe.inboundId}|${nfe.sku}`);
    const gap = nfe.quantity - (receipt?.qty ?? 0);
    if (gap <= 0) continue;
    const unitCents = Math.round(nfe.totalCents / nfe.quantity);
    // Ocorrências que o operador já indenizou para este lote abatem a diferença.
    const compensated = ctx.input.incidents
      .filter((i) => i.inboundId === nfe.inboundId && i.sku === nfe.sku)
      .reduce((sum, i) => sum + i.compensatedCents, 0);
    emit(ctx, 'ERP_INBOUND_GAP', nfe.inboundId, nfe.sku, gap, receipt?.at ?? nfe.issuedAt, {
      ids: { nfeKey: nfe.accessKey, inboundId: nfe.inboundId },
      expectedCents: gap * unitCents,
      actualCents: compensated,
      policy: `Recebimento no centro de distribuição do ${NAME[ctx.input.marketplace]}: unidades enviadas com nota fiscal de remessa e não conferidas devem ser localizadas ou indenizadas.`,
      calc: [
        `NF-e de remessa: ${nfe.quantity} un. no lote ${nfe.inboundId}, a ${brl(unitCents)} por unidade.`,
        `Conferido no centro de distribuição: ${receipt?.qty ?? 0} un.`,
        `Furo de inventário: ${gap} un. = ${brl(gap * unitCents)}.`,
        `Indenização já creditada para o lote: ${brl(compensated)}.`,
      ],
      timeline: [
        { at: nfe.issuedAt, label: `Emissão da NF-e de remessa do lote ${nfe.inboundId}` },
        ...(receipt ? [{ at: receipt.at, label: `Conferência do lote: ${receipt.qty} un. recebidas` }] : []),
      ],
    });
  }
}

/** Venda com NF-e emitida cujo repasse não foi liquidado dentro do prazo. */
function auditUnsettledSales(ctx: Context): void {
  for (const nfe of ctx.input.invoices) {
    if (nfe.kind !== 'VENDA' || !nfe.orderId) continue;
    const order = ctx.orders.get(nfe.orderId);
    if (!order || order.settledAt) continue;
    if (daysBetween(order.saleDate, ctx.input.asOf) < ctx.tables.settlementWaitDays) continue;
    const expectedNet = order.grossCents - order.commissionCents - order.feeCents - order.shippingChargedCents;
    emit(ctx, 'ERP_UNSETTLED_SALE', order.orderId, order.sku, order.quantity, order.saleDate, {
      ids: orderIds(ctx, order),
      expectedCents: expectedNet,
      actualCents: 0,
      policy: `Liquidação de vendas do ${NAME[ctx.input.marketplace]}: pedidos entregues devem ser repassados ao seller no prazo do programa.`,
      calc: [
        `NF-e de venda emitida em ${fmtDate(nfe.issuedAt)} no valor de ${brl(nfe.totalCents)}.`,
        `Repasse esperado: ${brl(order.grossCents)} − tarifas ${brl(order.commissionCents + order.feeCents)} − frete ${brl(order.shippingChargedCents)} = ${brl(expectedNet)}.`,
        `Nenhum crédito localizado no extrato após ${ctx.tables.settlementWaitDays} dias.`,
      ],
      timeline: [
        { at: order.saleDate, label: `Venda do pedido ${order.orderId}` },
        { at: nfe.issuedAt, label: 'Emissão da NF-e de venda' },
      ],
    });
  }
}

/** Posição de estoque por SKU: o que as notas fiscais dizem contra o que o marketplace informa. */
export function reconcileBrStock(input: BrAuditInput): SkuReconciliation[] {
  return input.products.map((product) => {
    const sum = <T extends { sku: string }>(rows: T[], pick: (row: T) => number) =>
      rows.filter((row) => row.sku === product.sku).reduce((total, row) => total + pick(row), 0);
    const inbound = sum(input.invoices.filter((n) => n.kind === 'REMESSA'), (n) => n.quantity) +
      sum(input.returns.filter((r) => r.returnedToStock && r.returnedCondition === 'OK'), (r) => r.quantity);
    const outbound = sum(input.orders, (o) => o.quantity);
    const adjustments = sum(input.incidents.filter((i) => i.kind.startsWith('WAREHOUSE')), (i) => i.quantity);
    const expectedEnding = inbound - outbound - adjustments;
    const reportedEnding = input.marketplaceStock[product.sku] ?? expectedEnding;
    const variance = reportedEnding - expectedEnding;
    return {
      sku: product.sku,
      productName: product.name,
      opening: 0,
      inbound,
      outbound,
      adjustments: 0 - adjustments,
      expectedEnding,
      reportedEnding,
      variance,
      varianceValueCents: variance * product.costCents,
    };
  });
}

export interface BrAuditResult {
  findings: Finding[];
  reconciliation: SkuReconciliation[];
  recordsScanned: number;
}

/** Roda todas as regras sobre um retrato dos dados. Função pura e idempotente. */
export function runBrAudit(input: BrAuditInput, tables: BrTables = REFERENCE_TABLES): BrAuditResult {
  const ctx: Context = {
    input,
    tables,
    products: new Map(input.products.map((p) => [p.sku, p])),
    orders: new Map(input.orders.map((o) => [o.orderId, o])),
    saleInvoices: new Map(input.invoices.filter((n) => n.kind === 'VENDA' && n.orderId).map((n) => [n.orderId!, n])),
    out: [],
  };
  auditIncidents(ctx);
  auditFreight(ctx);
  auditReturns(ctx);
  auditMlCommission(ctx);
  auditShopeePayout(ctx);
  auditInboundGaps(ctx);
  auditUnsettledSales(ctx);

  const unique = new Map(ctx.out.map((finding) => [finding.fingerprint, finding]));
  return {
    findings: [...unique.values()].sort((a, b) => b.recoverableCents - a.recoverableCents || a.fingerprint.localeCompare(b.fingerprint)),
    reconciliation: reconcileBrStock(input),
    recordsScanned:
      input.orders.length + input.incidents.length + input.returns.length + input.invoices.length + input.receipts.length,
  };
}
