# Grandir

Plataforma SaaS de **auditoria financeira, conciliação de estoque e recuperação de reembolsos** para sellers que operam em fulfillment de marketplaces. A Grandir encontra o que o marketplace deve ao seller, conduz a disputa e cobra apenas uma taxa de sucesso sobre o que for pago.

Nome, logotipo, textos, código e motores foram escritos do zero. A direção visual — ouro quente sobre creme e carvão, títulos condensados em caixa alta, botões pílula — segue a linguagem de design de um serviço de referência do setor, por decisão do dono do produto. O que foi adotado e o que permanece próprio está em [docs/ANALISE-PUBLICA.md](docs/ANALISE-PUBLICA.md), junto com a pesquisa de mercado que orientou o escopo.

## Como rodar

Requer Node.js 22.13 ou superior.

```bash
npm install
npm run dev    # API em http://127.0.0.1:4000 e front-end em http://localhost:5173
```

Primeiro uso, com dados reais:

1. Abra http://localhost:5173, crie sua conta e cadastre a loja (Mercado Livre ou Shopee). Ela começa vazia.
2. Em **Lojas → Dados da loja**, envie o que você tiver: relatório de vendas e repasses exportado do painel do seller (CSV ou XLSX), planilha de produtos do ERP, XML de NF-e, e, se houver, relatórios de ocorrências, devoluções e recebimento de lotes.
3. Para cada relatório, confira qual coluna do arquivo corresponde a cada informação. O mapeamento fica salvo para a próxima vez.
4. A auditoria roda a cada importação. Veja o resultado em **Divergências** e abra os chamados em **Dossiês e chamados**.

A conexão direta por API (OAuth) é opcional e depende de cadastrar um aplicativo em cada marketplace: veja [docs/INTEGRACOES.md](docs/INTEGRACOES.md).

Outros comandos:

| Comando | O que faz |
| --- | --- |
| `npm test` | Testes dos motores e da API (isolamento entre tenants, autenticação, permissões) |
| `npm run typecheck` | Checagem de tipos dos três pacotes |
| `npm run build` | Build de produção do front-end |
| `node scripts/real-flow-check.mjs . <pasta>` | Com o app rodando, cria uma conta de teste e percorre o caminho real pela interface (loja vazia → importação → auditoria) em 1440x900 |
| `npm run seed:demo` | Só com `GRANDIR_DEMO_MODE=true`: cria uma conta com dados **sintéticos**, para avaliar telas sem dados reais |
| `node scripts/desktop-check.mjs . <pasta-de-saída>` | Com o app rodando, mede estouro de tabelas e captura as telas do portal em 1440x900 (Edge headless) |

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
- **Chamado por dossiê** — o dossiê vira um único chamado, cujo status (rascunho, aberto, em análise, deferido, indeferido, pago) vale para todas as divergências do grupo. Registra protocolo, data de abertura, valor contestado, valor deferido por item (deferimento parcial) e valor reembolsado; a taxa de sucesso incide só sobre os itens pagos.
- **Tarifas versionadas** — tabelas de Mercado Livre e Shopee em `packages/engines/config/tarifas/*.json`, com `effectiveFrom`/`effectiveTo`; cada pedido é auditado com a versão vigente na data da venda.
- **Dados reais por arquivo** — importa qualquer CSV ou XLSX exportado do painel do seller: o sistema lê os cabeçalhos, sugere o mapeamento e você confirma qual coluna é qual. Cobre vendas e repasses, extravios e avarias, devoluções e recebimento de lotes. Nenhum dado é gerado: loja sem importação fica vazia.
- **Contas reais por OAuth** — autorização OAuth 2.0 com Mercado Livre e Shopee, tokens cifrados e renovados automaticamente, clientes HTTP com limite de taxa e nova tentativa.
- **XML de NF-e** — importação em lote de NF-e modelo 55 (chave de acesso, CFOP, itens, pesos e valores fiscais), independente do ERP.
- **Dossiês de evidência** — agrupa as divergências por tipo e por lote de envio ou mês e gera, para cada grupo, o texto pronto para o chamado, a planilha (CSV e XLSX) e o PDF com identificadores, memória de cálculo e cronologia.
- **Planilha do ERP** — importa o cadastro de produtos exportado do Bling, Tiny ou Omie (CSV); peso, medidas e custo do ERP passam a ser a referência da auditoria.
- **Gestão de chamados** — ciclo de vida completo (envio, análise, pedido de documentos, aprovação, negativa, reabertura, pagamento), linha do tempo, comentários e anexos.
- **Cobrança por sucesso** — fatura mensal em que cada linha aponta para o reembolso que a originou.
- **Conta e equipe** — papéis (titular, administrador, analista, leitor), convites, verificação em duas etapas e trilha de auditoria.

Detalhes de arquitetura e segurança: [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## O que ainda não está pronto para produção

Estes pontos são limites reais do estado atual, não detalhes de configuração:

1. **O importador de relatórios não foi testado com um relatório real.** Ele não depende do formato (você mapeia as colunas), mas foi exercitado só com arquivos que eu montei. Relatórios com várias linhas por pedido, totais no rodapé ou valores em formato inesperado podem exigir ajuste. As sugestões automáticas de coluna usam nomes que eu supus.
2. **Integrações por API não testadas contra as APIs de verdade.** O OAuth e os clientes de Mercado Livre e Shopee foram escritos pela documentação pública e exercitados apenas com respostas simuladas. Nomes de campos, rotas e o host da Shopee precisam ser conferidos na primeira conexão com um aplicativo registrado (`ML_CLIENT_ID`, `SHOPEE_PARTNER_ID` etc. no `.env`). A coleta real ainda não traz conferência de lotes no centro de distribuição, detalhe de devoluções nem o relatório de liberações do Mercado Pago; as regras que dependem desses dados não disparam para lojas conectadas. Extravios vêm do status do envio, sem saber se já houve indenização. Integração direta com APIs de ERP não existe: a entrada é por planilha e XML.
2. **Envio de e-mail.** Links de redefinição de senha e convites são escritos no log da API. Falta o adaptador de um provedor transacional (`apps/api/src/mailer.ts`).
3. **Recebimento das faturas.** As faturas são calculadas, mas não há integração com meio de pagamento.
4. **Banco de dados.** Usa SQLite embutido (`node:sqlite`, ainda marcado como experimental no Node 22). Para produção, migrar para PostgreSQL com Row-Level Security como segunda barreira de isolamento.
5. **Termos de Serviço e Política de Privacidade.** O cadastro exige o aceite, mas os textos jurídicos não existem e precisam ser redigidos por um advogado.
6. **Proteção contra robôs no cadastro.** Há limite de requisições e campo-isca; um CAPTCHA (por exemplo, Turnstile) é recomendável antes de abrir ao público.
7. **Tabelas de tarifas não confirmadas.** O versionamento por vigência está pronto, mas **nenhuma versão carregada foi conferida na fonte oficial**: as páginas de ajuda do Mercado Livre e da Shopee não puderam ser lidas, e as fontes secundárias divergem entre si. Todas estão com `"verified": false`, e o portal avisa no chamado quando a regra usada não foi confirmada. A comissão do Mercado Livre por categoria traz só três categorias de exemplo; a tabela de frete não considera reputação. Prazos de contestação também são valores de referência. Antes de contestar de verdade: conferir cada versão no painel do seller e marcar `"verified": true`.
8. **Classificação de CFOP.** O importador de NF-e trata 5.949/6.949 ("outras saídas") como remessa para armazém, que é o uso comum em fulfillment, mas o código também serve a outras operações. Vale revisar com o contador do seller.
