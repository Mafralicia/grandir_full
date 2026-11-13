import { brDemoSource } from './demoSource';
import { brConnector } from './source';

/**
 * Mercado Livre (Full, Coleta e Agências).
 *
 * Usa a origem de dados de demonstração. A integração real implementa `BrDataSource`
 * sobre a API do Mercado Livre — pedidos, envios, faturamento, estoque Full e
 * reclamações — e exige um aplicativo registrado e a autorização OAuth de cada seller.
 */
export const mercadoLivreConnector = brConnector('mercadolivre-demo', 'Mercado Livre (demonstração)', 'mercadolivre', brDemoSource);
