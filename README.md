# Grandir

Plataforma SaaS de **auditoria financeira, conciliação de estoque e recuperação de reembolsos** para sellers que operam em fulfillment de marketplaces. A Grandir encontra o que o marketplace deve ao seller, conduz a disputa e cobra apenas uma taxa de sucesso sobre o que for pago.

Nome, logotipo, textos, código e motores foram escritos do zero. A direção visual — ouro quente sobre creme e carvão, títulos condensados em caixa alta, botões pílula — segue a linguagem de design de um serviço de referência do setor, por decisão do dono do produto. O que foi adotado e o que permanece próprio está em [docs/ANALISE-PUBLICA.md](docs/ANALISE-PUBLICA.md), junto com a pesquisa de mercado que orientou o escopo.

## Como rodar

Requer Node.js 22.13 ou superior.

```bash
npm install
npm run seed   # cria a conta de demonstração e grava as credenciais em data/demo-credentials.txt
npm run dev    # API em http://127.0.0.1:4000 e front-end em http://localhost:5173
```

Outros comandos:

| Comando | O que faz |
| --- | --- |
| `npm test` | Testes dos motores e da API (isolamento entre tenants, autenticação, permissões) |
| `npm run typecheck` | Checagem de tipos dos três pacotes |
| `npm run build` | Build de produção do front-end |

Configuração por variáveis de ambiente: copie `.env.example` para `.env`. Em produção, `DATA_ENCRYPTION_KEY` é obrigatória.

## Estrutura

```
packages/engines   Motores de auditoria e gerador de dossiês — funções puras, sem I/O
  src/br           Regras do e-commerce brasileiro (Mercado Livre, Shopee, ERP × marketplace)
  src/evidence     Agrupamento, texto de chamado e planilha do dossiê
apps/api           API Fastify: autenticação, multi-tenant, chamados, cobrança
  src/connectors   Adaptadores: Mercado Livre, Shopee, planilha de ERP e demonstração
  src/evidence-reporter  Exportação do dossiê em PDF e XLSX
apps/web           React + Vite: site público, acesso e portal do cliente
docs               Análise pública e arquitetura
```

## O que a plataforma faz

- **Conciliação de estoque** — reconstrói o saldo de cada SKU a partir do razão de movimentações e compara com o saldo informado.
- **Oito detectores de divergência** — perda e dano em armazém, descarte indevido, perda em transferência, falta em remessa, remoção não entregue, tarifa cobrada a maior e devolução não recebida. Cada divergência traz a memória de cálculo.
- **Regras brasileiras** — Mercado Livre (extravio e avaria no centro de distribuição e em trânsito, frete por peso cubado, devoluções sem retorno ou avariadas, comissão e tarifa fixa), Shopee (pedido extraviado sem crédito, repasse líquido a menor, cubagem) e cruzamento ERP × marketplace (NF-e de remessa contra o recebimento, venda faturada sem repasse).
- **Dossiês de evidência** — agrupa as divergências por tipo e por lote de envio ou mês e gera, para cada grupo, o texto pronto para o chamado, a planilha (CSV e XLSX) e o PDF com identificadores, memória de cálculo e cronologia.
- **Planilha do ERP** — importa o cadastro de produtos exportado do Bling, Tiny ou Omie (CSV); peso, medidas e custo do ERP passam a ser a referência da auditoria.
- **Gestão de chamados** — ciclo de vida completo (envio, análise, pedido de documentos, aprovação, negativa, reabertura, pagamento), linha do tempo, comentários e anexos.
- **Cobrança por sucesso** — fatura mensal em que cada linha aponta para o reembolso que a originou.
- **Conta e equipe** — papéis (titular, administrador, analista, leitor), convites, verificação em duas etapas e trilha de auditoria.

Detalhes de arquitetura e segurança: [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## O que ainda não está pronto para produção

Estes pontos são limites reais do estado atual, não detalhes de configuração:

1. **Conectores de marketplace.** Todos os conectores usam dados sintéticos. Para Mercado Livre e Shopee, o motor de regras e o adaptador estão prontos, mas a origem de dados real (`BrDataSource`, em `apps/api/src/connectors/br`) ainda precisa ser implementada sobre as APIs oficiais, o que exige aplicativo registrado e autorização OAuth de cada seller. Integração direta com as APIs de ERP também não existe: a entrada é por planilha.
2. **Envio de e-mail.** Links de redefinição de senha e convites são escritos no log da API. Falta o adaptador de um provedor transacional (`apps/api/src/mailer.ts`).
3. **Recebimento das faturas.** As faturas são calculadas, mas não há integração com meio de pagamento.
4. **Banco de dados.** Usa SQLite embutido (`node:sqlite`, ainda marcado como experimental no Node 22). Para produção, migrar para PostgreSQL com Row-Level Security como segunda barreira de isolamento.
5. **Termos de Serviço e Política de Privacidade.** O cadastro exige o aceite, mas os textos jurídicos não existem e precisam ser redigidos por um advogado.
6. **Proteção contra robôs no cadastro.** Há limite de requisições e campo-isca; um CAPTCHA (por exemplo, Turnstile) é recomendável antes de abrir ao público.
7. **Regras de negócio.** Comissões, tarifas fixas, tabelas de frete, divisor de cubagem e prazos de contestação (`packages/engines/src/br/tables.ts`) são valores de referência para demonstração e testes, não as tabelas oficiais. Precisam ser substituídos pelas regras vigentes de cada marketplace antes de qualquer uso real — um dossiê com a regra errada enfraquece o pedido.
8. **Dossiê e chamado ainda são fluxos separados.** O dossiê agrupa várias divergências em um único pedido, mas o registro de chamados continua sendo um por divergência. Falta unificar: abrir um chamado por dossiê.
