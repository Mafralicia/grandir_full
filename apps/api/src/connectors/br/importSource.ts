import { brConnector, type BrDataSource } from './source';

/**
 * Origem de dados por arquivo: tudo o que a auditoria usa foi importado pelo seller —
 * relatórios de vendas e repasses, ocorrências, devoluções e recebimento de lotes
 * (CSV ou XLSX com colunas mapeadas), cadastro de produtos do ERP e XML de NF-e.
 * É uma origem real: nenhum dado é gerado.
 */
const importedSource: BrDataSource = {
  async load(store, marketplace, asOf) {
    return {
      asOf,
      marketplace,
      products: store.erpProducts,
      orders: store.imported.orders,
      incidents: store.imported.incidents,
      returns: store.imported.returns,
      invoices: store.invoices,
      receipts: store.imported.receipts,
      // Sem relatório de posição de estoque, o saldo informado acompanha o calculado.
      marketplaceStock: {},
    };
  },
};

export const mercadoLivreImportConnector = brConnector('mercadolivre-import', 'Mercado Livre (arquivos)', 'mercadolivre', importedSource);
export const shopeeImportConnector = brConnector('shopee-import', 'Shopee (arquivos)', 'shopee', importedSource);
export const tiktokImportConnector = brConnector('tiktok-import', 'TikTok Shop (arquivos)', 'tiktok', importedSource);
