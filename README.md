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
packages/engines   Motores de auditoria — funções puras, sem I/O
apps/api           API Fastify: autenticação, multi-tenant, conectores, chamados, cobrança
apps/web           React + Vite: site público, acesso e portal do cliente
docs               Análise pública e arquitetura
```

## O que a plataforma faz

- **Conciliação de estoque** — reconstrói o saldo de cada SKU a partir do razão de movimentações e compara com o saldo informado.
- **Oito detectores de divergência** — perda e dano em armazém, descarte indevido, perda em transferência, falta em remessa, remoção não entregue, tarifa cobrada a maior e devolução não recebida. Cada divergência traz a memória de cálculo.
- **Gestão de chamados** — ciclo de vida completo (envio, análise, pedido de documentos, aprovação, negativa, reabertura, pagamento), linha do tempo, comentários e anexos.
- **Cobrança por sucesso** — fatura mensal em que cada linha aponta para o reembolso que a originou.
- **Conta e equipe** — papéis (titular, administrador, analista, leitor), convites, verificação em duas etapas e trilha de auditoria.

Detalhes de arquitetura e segurança: [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## O que ainda não está pronto para produção

Estes pontos são limites reais do estado atual, não detalhes de configuração:

1. **Conectores de marketplace.** Só existe o conector de demonstração, que gera dados sintéticos. Ligar a Amazon SP-API, Mercado Livre e outros exige cadastro como parceiro em cada marketplace e a implementação de `MarketplaceConnector` para cada um.
2. **Envio de e-mail.** Links de redefinição de senha e convites são escritos no log da API. Falta o adaptador de um provedor transacional (`apps/api/src/mailer.ts`).
3. **Recebimento das faturas.** As faturas são calculadas, mas não há integração com meio de pagamento.
4. **Banco de dados.** Usa SQLite embutido (`node:sqlite`, ainda marcado como experimental no Node 22). Para produção, migrar para PostgreSQL com Row-Level Security como segunda barreira de isolamento.
5. **Termos de Serviço e Política de Privacidade.** O cadastro exige o aceite, mas os textos jurídicos não existem e precisam ser redigidos por um advogado.
6. **Proteção contra robôs no cadastro.** Há limite de requisições e campo-isca; um CAPTCHA (por exemplo, Turnstile) é recomendável antes de abrir ao público.
7. **Regras de negócio.** Prazos de contestação e a tabela de tarifas são valores de referência configuráveis, não as regras oficiais de nenhum marketplace.
