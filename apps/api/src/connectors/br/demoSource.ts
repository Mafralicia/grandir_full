import {
  addDays,
  reconcileBrStock,
  REFERENCE_TABLES,
  type BrAuditInput,
  type ErpProduct,
  type IncidentKind,
  type MarketplaceOrder,
} from '@grandir/engines';
import { seededRandom } from '../demo';
import type { BrDataSource } from './source';

/**
 * Origem de dados de demonstração: cinco meses de operação sintética, determinística por
 * loja, com casos de todas as regras. Nenhum dado vem do Mercado Livre nem da Shopee.
 */
const PRODUCTS: [string, string, number, number, number, number, number, number, string][] = [
  // sku, nome, custo, preço, peso g, C, L, A, categoria
  ['GRD-CAF-001', 'Cafeteira italiana 6 xícaras', 5890, 12990, 620, 22, 14, 12, 'MLB-CASA'],
  ['GRD-GAR-002', 'Garrafa térmica inox 1 L', 4250, 8990, 480, 30, 9, 9, 'MLB-CASA'],
  ['GRD-FON-004', 'Fone bluetooth com cancelamento de ruído', 18900, 39990, 310, 20, 18, 8, 'MLB-ELETRO'],
  ['GRD-LUM-005', 'Luminária de mesa LED articulada', 7400, 15990, 760, 38, 16, 12, 'MLB-CASA'],
  ['GRD-TAP-006', 'Tapete de yoga antiderrapante', 6200, 12990, 1150, 62, 14, 14, 'MLB-ESPORTE'],
  ['GRD-ORG-007', 'Organizador de gavetas 6 peças', 3100, 6990, 540, 32, 24, 8, 'MLB-CASA'],
  ['GRD-BAL-009', 'Balança digital de cozinha', 2790, 5990, 330, 22, 16, 4, 'MLB-CASA'],
  ['GRD-SUP-010', 'Suporte ergonômico para notebook', 8600, 17990, 980, 28, 24, 5, 'MLB-ELETRO'],
  ['GRD-CAP-013', 'Capacete de ciclismo ajustável', 12900, 26990, 410, 30, 24, 18, 'MLB-ESPORTE'],
  ['GRD-COR-015', 'Corda de pular com rolamento', 1900, 4990, 180, 18, 12, 4, 'MLB-ESPORTE'],
];
/** Produtos que o operador mediu errado: o frete sai por um peso maior que o real. */
const WRONG_WEIGHT: Record<number, number> = { 2: 2400, 7: 5600 };

export const brDemoSource: BrDataSource = {
  async load(store, marketplace, asOf): Promise<BrAuditInput> {
    const random = seededRandom(`grandir-br:${marketplace}:${store.id}`);
    const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
    const chance = (probability: number) => random() < probability;
    const digits = (length: number) => Array.from({ length }, () => int(0, 9)).join('');
    const day = (n: number) => addDays(store.createdAt, -Math.max(0, n));
    let sequence = 0;
    const next = (prefix: string) => `${prefix}${String(++sequence).padStart(6, '0')}`;
    const isMl = marketplace === 'mercadolivre';
    const { ml, shopee } = REFERENCE_TABLES;

    const products: ErpProduct[] = PRODUCTS.map(([sku, name, costCents, , weightG, lengthCm, widthCm, heightCm]) => ({
      sku, name, costCents, weightG, lengthCm, widthCm, heightCm, ean: `789${digits(10)}`,
    }));
    const input: BrAuditInput = {
      asOf, marketplace, products, orders: [], incidents: [], returns: [], invoices: [], receipts: [], marketplaceStock: {},
    };

    PRODUCTS.forEach(([sku, , costCents, priceCents, weightG, lengthCm, widthCm, heightCm, categoryId], index) => {
      // Lotes de envio ao centro de distribuição, com NF-e de remessa e conferência.
      for (const daysBack of [150, 95, 40]) {
        const inboundId = next(isMl ? 'INB-' : 'ASN-');
        const sent = int(90, 220);
        const gap = chance(0.3) ? int(2, 9) : 0;
        input.invoices.push({ accessKey: digits(44), kind: 'REMESSA', issuedAt: day(daysBack + 4), sku, quantity: sent, totalCents: sent * costCents, inboundId });
        input.receipts.push({ inboundId, sku, receivedQty: sent - gap, receivedAt: day(daysBack) });
        if (gap > 0 && chance(0.3)) {
          input.incidents.push({ id: next('OCR-'), marketplace, kind: 'WAREHOUSE_LOSS', sku, quantity: 1, occurredAt: day(daysBack - 2), inboundId, compensatedCents: costCents });
        }
      }

      const cubicG = Math.round(((lengthCm * widthCm * heightCm) / 6000) * 1000);
      const realWeightG = Math.max(weightG, cubicG);
      const freightTable = isMl ? ml.freight : shopee.freight;
      const freightOf = (grams: number) => (freightTable.find((tier) => grams <= tier.maxG) ?? freightTable[freightTable.length - 1]).cents;

      for (let n = int(38, 52); n > 0; n--) {
        const daysBack = int(1, 120);
        const quantity = chance(0.85) ? 1 : 2;
        const grossCents = priceCents * quantity;
        const listingType = index % 2 === 0 ? 'premium' : 'classico';
        const billedWeightG = WRONG_WEIGHT[index] && daysBack <= 55 ? WRONG_WEIGHT[index] : realWeightG;
        const shippingChargedCents = freightOf(billedWeightG);

        let commissionCents: number;
        let feeCents: number;
        if (isMl) {
          const rule = ml.commissions.find((c) => c.categoryId === categoryId) ?? ml.defaultCommission;
          // Em parte dos pedidos a comissão vem pela alíquota de outra categoria.
          const rateBps = rule.rateBps[listingType] + (chance(0.06) ? 300 : 0);
          commissionCents = Math.round((grossCents * rateBps) / 10_000);
          feeCents = priceCents < ml.fixedFeeBelowCents ? ml.fixedFeeCents * quantity : 0;
        } else {
          commissionCents = Math.min(Math.round((grossCents * shopee.commissionBps) / 10_000), shopee.commissionCapCents * quantity);
          feeCents = Math.round((grossCents * shopee.transactionFeeBps) / 10_000);
        }
        const net = grossCents - commissionCents - feeCents - shippingChargedCents;
        const settledAt = daysBack > 9 && !chance(0.03) ? day(daysBack - 8) : null;
        const shortfall = !isMl && chance(0.07) ? int(300, 1800) : 0;

        const order: MarketplaceOrder = {
          marketplace, orderId: isMl ? `20000${digits(11)}` : `${digits(6)}${next('SP').slice(2)}`, shipmentId: digits(11),
          trackingCode: isMl ? `ME${digits(9)}BR` : `BR${digits(12)}`, itemId: isMl ? `MLB${digits(10)}` : digits(11),
          sku, quantity, saleDate: day(daysBack), grossCents, categoryId, listingType, commissionCents, feeCents,
          shippingChargedCents, billedWeightG, settledAt, settledCents: settledAt ? net - shortfall : null,
        };
        input.orders.push(order);
        input.invoices.push({ accessKey: digits(44), kind: 'VENDA', issuedAt: day(daysBack), sku, quantity, totalCents: grossCents, orderId: order.orderId });
      }
    });

    const pick = <T,>(list: T[]) => list[int(0, list.length - 1)];
    const settled = input.orders.filter((order) => order.settledAt);

    // Extravios e avarias: com pedido (trânsito) ou sem (estoque no centro de distribuição).
    const transit: IncidentKind[] = ['TRANSIT_LOSS', 'REVERSE_LOSS'];
    for (let n = 0; n < 9; n++) {
      const order = pick(settled);
      input.incidents.push({
        id: next('OCR-'), marketplace, kind: pick(transit), sku: order.sku, quantity: order.quantity,
        occurredAt: addDays(order.saleDate, int(3, 9)), orderId: order.orderId, shipmentId: order.shipmentId,
        compensatedCents: chance(0.35) ? order.grossCents : 0,
      });
    }
    if (isMl) {
      for (let n = 0; n < 7; n++) {
        const product = pick(products);
        const quantity = int(1, 5);
        input.incidents.push({
          id: next('OCR-'), marketplace, kind: chance(0.6) ? 'WAREHOUSE_LOSS' : 'WAREHOUSE_DAMAGE', sku: product.sku, quantity,
          occurredAt: day(int(18, 80)), compensatedCents: chance(0.25) ? product.costCents * quantity : 0,
        });
      }
      // Devoluções e mediações encerradas a favor do comprador.
      for (let n = 0; n < 16; n++) {
        const order = pick(settled);
        const returned = chance(0.62);
        input.returns.push({
          id: next('MED-'), marketplace, orderId: order.orderId, sku: order.sku, quantity: order.quantity,
          closedAt: addDays(order.saleDate, int(10, 22)), resolution: 'BUYER', refundedToBuyerCents: order.grossCents,
          returnedToStock: returned, returnedCondition: returned ? (chance(0.3) ? 'DAMAGED' : 'OK') : null,
          compensatedCents: chance(0.2) ? order.grossCents : 0,
        });
      }
    }

    // Em dois SKUs o saldo informado é menor do que as notas fiscais explicam.
    reconcileBrStock(input).forEach((row, index) => {
      input.marketplaceStock[row.sku] = row.expectedEnding - (index === 3 || index === 8 ? int(2, 6) : 0);
    });
    return input;
  },
};
