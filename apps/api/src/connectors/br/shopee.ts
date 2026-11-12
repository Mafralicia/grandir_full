import { brDemoSource } from './demoSource';
import { brConnector } from './source';

/**
 * Shopee (Xpress, Full e Envios).
 *
 * Usa a origem de dados de demonstração. A integração real implementa `BrDataSource`
 * sobre a Shopee Open Platform — pedidos, logística, extrato da carteira e devoluções —
 * e exige cadastro de parceiro e a autorização de cada loja.
 */
export const shopeeConnector = brConnector('shopee-demo', 'Shopee (demonstração)', 'shopee', brDemoSource);
