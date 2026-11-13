# Arquitetura

## Visão geral

```
Navegador ──► apps/web (React, Vite) ──/api──► apps/api (Fastify) ──► SQLite
                                                   │
                                                   ├─► conectores de marketplace ──► relatórios do operador
                                                   └─► packages/engines (funções puras)
```

O fluxo central tem três etapas, cada uma em um lugar:

1. **Conector** (`apps/api/src/connectors`) traduz os relatórios de um marketplace para um formato neutro, `AuditInput`: catálogo, saldos, razão de movimentações, remessas, remoções, tarifas, devoluções e reembolsos já pagos.
2. **Motores** (`packages/engines`) recebem o `AuditInput` e devolvem divergências e a conciliação por SKU. Não acessam banco, rede nem relógio — a data de referência vem na entrada.
3. **Serviços** (`apps/api/src/services`) gravam o resultado, abrem chamados e lançam a cobrança.

Essa separação faz com que toda regra de auditoria seja testável com dados em memória, e que um novo marketplace exija apenas um conector.

## Motores de auditoria

| Detector | Regra |
| --- | --- |
| Conciliação | `esperado = inicial + entradas − saídas − ajustes`, comparado ao saldo informado |
| Perda, dano e descarte | Ocorrências do razão menos itens localizados e reembolsos, abatidos das mais antigas primeiro |
| Variação de saldo | Diferença negativa que nenhum ajuste explica |
| Perda em transferência | Unidades expedidas menos recebidas, por transferência |
| Falta em remessa | Enviado menos recebido em remessas fechadas |
| Remoção não entregue | Solicitado menos entregue menos descartado a pedido |
| Tarifa a maior | Cobrado contra o esperado pela faixa de tamanho e peso tarifável, agrupado por SKU e mês |
| Devolução não recebida | Reembolso ao comprador sem retorno do item no prazo |

Propriedades garantidas por teste:

- **Idempotência.** Cada divergência tem uma chave estável (`tipo:sku:referência`). Reexecutar a auditoria atualiza o que está em aberto e nunca duplica.
- **Prazos.** Cada ocorrência é classificada como em espera, contestável ou prescrita, conforme a `AuditPolicy`.
- **Dinheiro em centavos inteiros.** Nenhum cálculo monetário usa ponto flutuante; a taxa de sucesso é aplicada em pontos-base com arredondamento definido.

Os prazos (`policy.ts`) e a tabela de tarifas (`fees.ts`) são valores de referência. Cada conector real deve fornecer os do marketplace correspondente.

## Núcleo brasileiro: conectores, motor de regras e dossiês

Três módulos com responsabilidades separadas:

| Módulo | Onde | Papel |
| --- | --- | --- |
| `connectors` | `apps/api/src/connectors` | Busca os dados e traduz para o modelo neutro `BrAuditInput` |
| `audit-engine` | `packages/engines/src/br` | Aplica as regras e devolve `Finding[]` com valor, prazo e evidência |
| `evidence-reporter` | `packages/engines/src/evidence` e `apps/api/src/evidence-reporter` | Agrupa, redige o chamado e exporta PDF, CSV e XLSX |

### Conectores

Cada marketplace brasileiro é um `brConnector(id, rótulo, marketplace, origem)`. A **origem de dados** (`BrDataSource`) é a única parte que muda entre demonstração e produção: hoje é um gerador sintético; a versão real chama as APIs oficiais. O conector sobrepõe o **cadastro do ERP** (importado por planilha) ao do marketplace antes de rodar as regras, porque peso, medidas e custo do ERP são a fonte de verdade.

### Modelo de dados neutro

`ErpProduct` (SKU, EAN, custo, peso, medidas) · `MarketplaceOrder` (pedido, envio, rastreio, anúncio, comissão, tarifa, frete, peso cobrado, repasse) · `LogisticsIncident` (extravio ou avaria) · `ReturnCase` (devolução ou mediação) · `Nfe` (entrada, remessa, venda, devolução, com chave de acesso) · `WarehouseReceipt` (conferência do lote).

### Regras

| Regra | Compara | Valor a recuperar |
| --- | --- | --- |
| `ML_WAREHOUSE_LOSS` / `ML_WAREHOUSE_DAMAGE` | Ocorrência no centro de distribuição × indenização | Custo no ERP − creditado |
| `ML_TRANSIT_LOSS` | Extravio em trânsito ou na reversa × indenização | Valor da venda − creditado |
| `ML_FREIGHT_OVERCHARGE` | Peso cobrado × peso tarifável pelo cadastro do ERP | Frete cobrado − frete correto |
| `ML_RETURN_NOT_RESTOCKED` | Mediação a favor do comprador × retorno ao estoque | Reembolso ao comprador − restituído |
| `ML_RETURN_DAMAGED` | Produto devolvido avariado × indenização | Custo no ERP − creditado |
| `ML_COMMISSION_OVERCHARGE` | Comissão e tarifa fixa × regra da categoria e do tipo de anúncio | Cobrado − correto |
| `SHOPEE_LOST_NO_CREDIT` | Pedido extraviado × crédito no extrato | Valor da venda − creditado |
| `SHOPEE_PAYOUT_SHORTFALL` | Repasse esperado (venda − comissão − taxa − frete) × liquidado | Esperado − liquidado |
| `SHOPEE_FREIGHT_OVERCHARGE` | Cubagem cobrada × medidas do ERP | Frete cobrado − frete correto |
| `ERP_INBOUND_GAP` | NF-e de remessa × conferência do lote | Unidades faltantes × valor unitário da nota |
| `ERP_UNSETTLED_SALE` | NF-e de venda × repasse no prazo | Repasse líquido esperado |

Toda regra passa por um único ponto (`emit`), que aplica a tolerância, calcula o prazo de contestação, descarta o que já prescreveu e anexa identificadores, memória de cálculo e cronologia. As tabelas de tarifas e prazos (`tables.ts`) são **valores de referência** e precisam ser trocadas pelas vigentes.

### Tabelas versionadas por vigência

As tarifas ficam em `packages/engines/config/tarifas/mercadolivre.json` e `shopee.json`. Cada versão tem `effectiveFrom`, `effectiveTo` (ou `null`, em aberto), `verified`, `sources` e `notes`. A carga valida que as vigências não se sobrepõem. `versionAt(versões, dataDaVenda)` escolhe a regra de cada pedido; sem versão para a data, as regras de tarifa não disparam para aquele pedido. A divergência guarda qual versão a calculou (`details.tariff`) e, se ela não estiver confirmada, o dossiê leva um aviso para o seller — fora do texto enviado ao marketplace.

Para incluir uma mudança de regra: acrescentar uma versão nova com a data de início e fechar a anterior com `effectiveTo`. Pedidos antigos continuam sendo auditados pela regra antiga.

### Chamado por dossiê

```
RASCUNHO → ABERTO → EM_ANALISE → DEFERIDO → PAGO
                         │  ▲
                         ▼  │ (reabertura)
                     INDEFERIDO
```

Criar o chamado (`dossier_cases`) gera um registro por divergência (`claims.case_id`), que guarda o valor contestado e o deferido daquele item. O status do chamado **governa** esses registros: `transitionCase` move todos juntos, e a alteração individual de um registro vinculado é recusada. No deferimento, cada item recebe seu valor (integral, parcial ou zero); no pagamento, só os itens deferidos são pagos e cada um gera a linha de cobrança por sucesso. Abrir exige o protocolo do marketplace.

### Contas reais (OAuth 2.0)

1. `POST /api/stores/:id/oauth/start` gera a URL de autorização e um `state` aleatório, guardado só como hash, preso ao tenant, à loja e ao usuário, com validade de 10 minutos.
2. O marketplace redireciona para `GET /api/oauth/:marketplace/callback`. O `state` é apagado antes de qualquer chamada externa (uso único) e conferido contra a sessão.
3. O código é trocado por `access_token` e `refresh_token`, gravados cifrados (AES-256-GCM) na loja, que passa a usar o conector real.
4. Antes de cada coleta, `freshTokens` renova o token que expira em menos de cinco minutos.

O cliente HTTP (`integrations/http.ts`) serializa as chamadas com intervalo mínimo, repete em 429 e 5xx com espera exponencial e respeita `Retry-After`. A Shopee exige assinatura HMAC-SHA256 em cada chamada (`shopeeSign`). Toda saída de rede passa por `runtime.fetch`, substituído nos testes.

### NF-e (modelo 55)

`parseNfeXml` lê o XML autorizado ou a nota isolada: chave de acesso (com conferência do dígito verificador), CFOP, itens (código, EAN, quantidade, valores), pesos bruto e líquido e totais fiscais. O CFOP classifica a nota em entrada, remessa, retorno, venda ou devolução. O número do pedido no item (`xPed`) liga a nota de venda ao pedido do marketplace e a de remessa ao lote. Entidades e DTD do XML não são processadas.

### Dossiês

- **Agrupamento:** por loja e tipo, e depois por **lote de envio** (quando a ocorrência pertence a um lote) ou por **mês**. Grupos grandes são divididos em partes. Na conta de demonstração, 135 ocorrências viram 35 dossiês.
- **Conteúdo:** pedido, envio, rastreio, SKU, anúncio (MLB ou Item ID), EAN, chave da NF-e e lote; valor de referência, valor creditado ou correto e diferença; regra aplicável; cronologia até o prazo limite.
- **Saídas:** texto pronto para colar no chamado, CSV no padrão brasileiro, XLSX e PDF. Células que uma planilha leria como fórmula são neutralizadas.
- **Antes e depois do chamado:** enquanto as divergências estão em aberto, o dossiê é montado sob demanda (a chave do grupo é estável enquanto elas não mudam). Depois de virar chamado, o conteúdo fica fixo nas divergências vinculadas e continua exportável. Cada exportação fica na trilha de auditoria.

## Ciclo de vida do chamado

```
SUBMITTED → UNDER_REVIEW → APPROVED ───────────► PAID
                 │   ▲     PARTIALLY_APPROVED ─► PAID
                 ▼   │     DENIED → REOPENED → UNDER_REVIEW
          NEEDS_DOCUMENTS                 └────► CLOSED
```

As transições válidas ficam em `packages/engines/src/claims.ts` e são aplicadas pela API; o front-end só oferece os passos que a API informa como possíveis. Quando um chamado chega a `PAID`, a taxa é lançada na fatura do mês, com a alíquota fixada na abertura do período.

## Segurança

### Isolamento entre clientes

Todas as tabelas de negócio têm `tenant_id`. As rotas do portal não acessam o banco diretamente: usam `TenantScope` (`apps/api/src/tenant.ts`), que

- recebe o tenant da **sessão autenticada**, nunca de um parâmetro da requisição;
- **recusa qualquer consulta que não referencie `:tenantId`**, antes de ela chegar ao banco.

Esquecer o filtro vira erro imediato, e não vazamento silencioso. Junções repetem a condição de tenant em cada tabela. Os testes criam dois tenants e verificam que um não lê, não lista e não altera dados do outro.

### Autenticação e sessão

| Controle | Implementação |
| --- | --- |
| Senhas | scrypt (N=2¹⁵, r=8, p=1), sal aleatório por senha, comparação em tempo constante |
| Política | 12+ caracteres com maiúscula, minúscula, número e caractere especial |
| Sessão | Token opaco de 256 bits; o banco guarda apenas o SHA-256; revogação imediata |
| Cookie | `HttpOnly`, `SameSite=Lax`, `Secure` e prefixo `__Host-` em produção |
| CSRF | Token por sessão exigido em cabeçalho, mais checagem de `Origin`, em toda escrita |
| Força bruta | Limite de requisições por IP e bloqueio da conta por 15 min após 5 erros |
| Enumeração de contas | Mesma resposta e mesmo custo de tempo para e-mail inexistente e senha errada |
| Duas etapas | TOTP (RFC 6238), segredo cifrado em repouso, código não reutilizável |
| Redefinição de senha | Token de uso único com validade de 1 hora; encerra todas as sessões |

### Autorização

Quatro papéis em ordem crescente: leitor, analista, administrador e titular. Cada rota declara o papel mínimo. Alterar o papel ou desativar um membro encerra as sessões dele na hora; o titular não pode ser rebaixado.

### Dados e arquivos

- Credenciais de marketplace e segredos de 2FA são cifrados com AES-256-GCM; a chave vem de `DATA_ENCRYPTION_KEY` e é obrigatória em produção.
- Uploads: até 5 MB, extensões permitidas, conferência da assinatura do arquivo, gravação sob identificador gerado pelo servidor em pasta do tenant, e download sempre como anexo.
- Entradas validadas com Zod em todas as rotas; consultas sempre parametrizadas.
- Cabeçalhos de segurança via Helmet; respostas da API com `Cache-Control: no-store`.
- Trilha de auditoria registra entradas, mudanças de acesso, ações em chamados e downloads.

## Próximos passos de arquitetura

1. Conectores reais por marketplace, com coleta agendada em fila de tarefas.
2. PostgreSQL com Row-Level Security como segunda barreira de isolamento.
3. Provedor de e-mail transacional e integração de pagamento das faturas.
4. Armazenamento de documentos em serviço de objetos com varredura antivírus.
5. Observabilidade: métricas por auditoria e alertas de falha de conector.
