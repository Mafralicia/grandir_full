import type { DiscrepancyType } from '../types';

export const TYPE_LABELS: Record<DiscrepancyType, string> = {
  LOST_WAREHOUSE: 'Perda em armazém',
  DAMAGED_WAREHOUSE: 'Dano em armazém',
  DISPOSED_SELLABLE: 'Descarte indevido',
  TRANSFER_LOST: 'Perda em transferência',
  INBOUND_SHORTAGE: 'Falta em remessa',
  REMOVAL_NOT_RECEIVED: 'Remoção não entregue',
  FEE_OVERCHARGE: 'Tarifa cobrada a maior',
  RETURN_NOT_RECEIVED: 'Devolução não recebida',
  ML_WAREHOUSE_LOSS: 'Extravio no centro de distribuição',
  ML_WAREHOUSE_DAMAGE: 'Avaria no centro de distribuição',
  ML_TRANSIT_LOSS: 'Extravio em trânsito',
  ML_FREIGHT_OVERCHARGE: 'Frete cobrado por peso cubado indevido',
  ML_RETURN_NOT_RESTOCKED: 'Devolução sem retorno do produto',
  ML_RETURN_DAMAGED: 'Devolução com produto avariado',
  ML_COMMISSION_OVERCHARGE: 'Comissão ou tarifa fixa acima da regra',
  SHOPEE_LOST_NO_CREDIT: 'Pedido extraviado sem crédito',
  SHOPEE_PAYOUT_SHORTFALL: 'Repasse líquido menor que o esperado',
  SHOPEE_FREIGHT_OVERCHARGE: 'Frete cobrado por cubagem indevida',
  ERP_INBOUND_GAP: 'Furo de inventário no recebimento',
  ERP_UNSETTLED_SALE: 'Venda faturada sem repasse',
};

export const MARKETPLACE_NAMES: Record<string, string> = {
  amazon: 'Amazon',
  mercadolivre: 'Mercado Livre',
  shopee: 'Shopee',
  magalu: 'Magalu',
};
