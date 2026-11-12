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
