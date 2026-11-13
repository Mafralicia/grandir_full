import { addDays, type BrAuditInput, type LogisticsIncident, type MarketplaceOrder } from '@grandir/engines';
import { mercadoLivreClient, type OAuthTokens } from '../../integrations/mercadolivre';
import { shopeeClient } from '../../integrations/shopee';
import { requireApp } from '../../integrations/tokens';
import type { StoreRef } from '../index';
import { brConnector, type BrDataSource } from './source';

/**
 * Origens de dados reais. O que cada uma traz hoje:
 *
 *   pedidos, tarifas, frete e repasse ........ das APIs do marketplace
 *   extravios ................................ do status logístico do envio
 *   produtos (peso, medidas, custo) e NF-e ... do ERP do seller (planilha e XML)
 *
 * Fora do escopo por enquanto: conferência de lotes no centro de distribuição e detalhe de
 * devoluções — sem esses dados, as regras correspondentes simplesmente não disparam.
 * O mapeamento de campos NÃO foi validado contra respostas reais das APIs.
 */
const LOOKBACK_DAYS = 120;
const MAX_ORDERS = 2_000;
const cents = (value: number | undefined | null) => Math.round((value ?? 0) * 100);
const tokensOf = (store: StoreRef) => store.credentials as unknown as OAuthTokens;

function emptyInput(store: StoreRef, marketplace: BrAuditInput['marketplace'], asOf: string): BrAuditInput {
  // O que a API ainda não entrega (lotes, devoluções, indenizações) vem dos relatórios importados.
  return {
    asOf, marketplace, products: store.erpProducts, orders: [], incidents: [...store.imported.incidents], returns: [...store.imported.returns],
    invoices: store.invoices, receipts: [...store.imported.receipts], marketplaceStock: {},
  };
}

const mercadoLivreLive: BrDataSource = {
  async load(store, marketplace, asOf) {
    const client = mercadoLivreClient(tokensOf(store));
    const input = emptyInput(store, marketplace, asOf);
    const orders = (await client.orders(addDays(asOf, -LOOKBACK_DAYS), asOf)).slice(0, MAX_ORDERS);

    for (const order of orders) {
      const shipmentId = order.shipping?.id;
      const [shipment, costs] = shipmentId
        ? await Promise.all([client.shipment(shipmentId), client.shipmentCosts(shipmentId)])
        : [undefined, undefined];
      const paid = order.payments?.find((payment) => payment.status === 'approved');

      order.order_items.forEach((line, index) => {
        const sku = line.item.seller_sku ?? line.item.id;
        input.orders.push({
          marketplace,
          orderId: String(order.id),
          shipmentId: shipmentId ? String(shipmentId) : '',
          trackingCode: shipment?.tracking_number ?? '',
          itemId: line.item.id,
          sku,
          quantity: line.quantity,
          saleDate: order.date_created,
          grossCents: cents(line.unit_price) * line.quantity,
          categoryId: line.item.category_id ?? '*',
          listingType: line.listing_type_id === 'gold_pro' ? 'premium' : 'classico',
          // A API informa a tarifa de venda por unidade, já com o custo fixo embutido.
          commissionCents: cents(line.sale_fee) * line.quantity,
          feeCents: 0,
          // O frete é do envio inteiro: fica na primeira linha para não ser contado duas vezes.
          shippingChargedCents: index === 0 ? cents(costs?.senders?.[0]?.cost) : 0,
          billedWeightG: shipment?.dimensions?.weight ?? 0,
          // A data de aprovação do pagamento não é a de liberação do dinheiro; o valor liberado
          // vem do relatório de liberações, ainda não integrado.
          settledAt: paid?.date_approved ?? null,
          settledCents: null,
        });
      });

      if (shipment?.status === 'not_delivered' && /lost|stolen/.test(shipment.substatus ?? '')) {
        const line = order.order_items[0];
        input.incidents.push(lostInTransit(marketplace, `ML-${shipment.id}`, line.item.seller_sku ?? line.item.id, line.quantity, shipment.date_created ?? order.date_created, String(order.id), String(shipment.id)));
      }
    }
    return input;
  },
};

const shopeeLive: BrDataSource = {
  async load(store, marketplace, asOf) {
    const client = shopeeClient(requireApp(store.apps, 'shopee'), tokensOf(store));
    const input = emptyInput(store, marketplace, asOf);
    const orders = (await client.orders(new Date(addDays(asOf, -LOOKBACK_DAYS)), new Date(asOf))).slice(0, MAX_ORDERS);

    for (const order of orders) {
      const line = order.item_list[0];
      if (!line) continue;
      const { order_income: income } = await client.escrow(order.order_sn);
      const quantity = order.item_list.reduce((sum, item) => sum + item.model_quantity_purchased, 0);
      const saleDate = new Date(order.create_time * 1000).toISOString();
      const sku = line.model_sku || line.item_sku || String(line.item_id);
      const mapped: MarketplaceOrder = {
        marketplace,
        orderId: order.order_sn,
        shipmentId: order.package_list?.[0]?.package_number ?? '',
        trackingCode: '',
        itemId: String(line.item_id),
        sku,
        quantity,
        saleDate,
        grossCents: order.item_list.reduce((sum, item) => sum + cents(item.model_discounted_price) * item.model_quantity_purchased, 0),
        categoryId: '*',
        listingType: 'classico',
        commissionCents: cents(income.commission_fee) + cents(income.service_fee),
        feeCents: cents(income.seller_transaction_fee),
        shippingChargedCents: cents(income.actual_shipping_fee),
        billedWeightG: 0,
        settledCents: income.escrow_release_time ? cents(income.escrow_amount) : null,
        settledAt: income.escrow_release_time ? new Date(income.escrow_release_time * 1000).toISOString() : null,
      };
      input.orders.push(mapped);
      if (order.package_list?.some((pack) => pack.logistics_status === 'LOGISTICS_LOST')) {
        input.incidents.push(lostInTransit(marketplace, `SP-${order.order_sn}`, sku, quantity, saleDate, order.order_sn, mapped.shipmentId));
      }
    }
    return input;
  },
};

function lostInTransit(marketplace: BrAuditInput['marketplace'], id: string, sku: string, quantity: number, occurredAt: string, orderId: string, shipmentId: string): LogisticsIncident {
  // A indenização já paga não é conhecida por esta origem: o seller confirma no dossiê antes de enviar.
  return { id, marketplace, kind: 'TRANSIT_LOSS', sku, quantity, occurredAt, orderId, shipmentId, compensatedCents: 0 };
}

export const mercadoLivreLiveConnector = brConnector('mercadolivre', 'Mercado Livre', 'mercadolivre', mercadoLivreLive);
export const shopeeLiveConnector = brConnector('shopee', 'Shopee', 'shopee', shopeeLive);
