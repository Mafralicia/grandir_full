# Situação de cada documento da pasta `prompt/`

Atualizado em 13/11/2026. Cada seção responde a um dos seis documentos: o que já foi feito no
código, o que ficou de fora e por quê. "Feito" significa implementado e coberto por teste;
integrações por API foram testadas só com respostas simuladas.

## 01 — Environment & Codebase Review

Fatos do documento que mudaram:

| No documento | Hoje |
| --- | --- |
| Node `v22.17.1`, que bloqueava o `rea-agents` | Node `v24.22.1` |
| 77 testes | mais de 100 (ver `npm test`) |
| Dados de demonstração no caminho do produto | Só com `GRANDIR_DEMO_MODE=true`; loja nova começa vazia |
| Sem sincronização agendada | `services/scheduler.ts` (`SYNC_INTERVAL_HOURS`) |
| Só Mercado Livre e Shopee | TikTok Shop por arquivo e por OAuth |

Lacunas que continuam: coleta por API do Mercado Livre sem liberações do Mercado Pago, reclamações
e recebimento do Full; Shopee sem peso cobrado, devoluções e carteira; e-mail transacional;
cobrança; Termos e CAPTCHA. Todas essas informações já entram **por arquivo**, e as regras disparam.

## 02 — Getida vs. Grandir

| Lacuna apontada | Situação |
| --- | --- |
| Lista de documentos por regra | **Feito**: `REQUIRED_DOCUMENTS` no motor e "Documentos a anexar" na tela do chamado |
| Auditoria contínua e alerta de prazo | **Feito**: sincronização agendada das lojas conectadas e bloco de prazos a vencer no painel |
| Novos marketplaces | **Parcial**: TikTok Shop habilitado; Amazon BR e Magalu seguem como "em breve", por decisão sua |
| Modo concierge (a Grandir abre o chamado pelo seller) | **Não feito**: exige fila interna de operação e definição comercial de taxa — é decisão de negócio antes de ser código |
| Portal de agência com troca de cliente | **Não feito**: muda o modelo de sessão (um usuário em vários tenants); merece desenho próprio |
| Meio de pagamento | **Não feito**: depende de você escolher e contratar o provedor |
| Risco de identidade visual parecida | Continua valendo: revisar com advogado antes do lançamento público |

## 03 — Roteiro de marketplaces brasileiros

| Item | Situação |
| --- | --- |
| TikTok Shop | **Feito**: regras `TIKTOK_*`, importação por arquivo, OAuth, assinatura e coleta de pedidos cruzada com o extrato importado |
| Devoluções da Shopee | **Feito por arquivo** (`SHOPEE_RETURN_*`); pela API, não |
| Host da Shopee Brasil | Padrão corrigido para `partner.shopeemobile.com`; confirmar no console |
| Reclamações do ML, liberações do Mercado Pago, Full | **Não ligado na API**. Os parâmetros de busca divergem entre as fontes ([apis-oficiais.md](pesquisa/apis-oficiais.md)); ligar sem uma conta real seria escrever código sem como conferir |
| Comissão por categoria (`listing_prices`) e reputação | **Não feito**: a tabela tem três categorias de exemplo, todas `verified: false` |
| CPF × CNPJ, Frete Grátis, FBS na Shopee | **Não feito** |
| Novas regras do ML (frete de devolução, armazenagem do Full, subsídio de promoção) | **Não feito**: nenhuma tem política confirmada em fonte oficial |
| Amazon BR, Magalu, Shein | **Não feito** ("em breve") |
| Conectores Bling/Tiny/Omie e NF-e automática | **Não feito**: a entrada é planilha do ERP e XML |

## 04 — Próximos passos e prompts

- **Fase 0** (Node): resolvida.
- **Fase 1**: o registro dos aplicativos depende de você — passo a passo em [INTEGRACOES.md](INTEGRACOES.md),
  agora com a seção do TikTok Shop. Assim que as chaves estiverem no `.env`, o botão "Conectar conta"
  funciona sem mudança de código. As tarifas continuam `verified: false`.
- **Fase 2**: feito o agendador em processo (sem fila externa); PostgreSQL com RLS, e-mail, cobrança,
  CAPTCHA e textos jurídicos continuam pendentes.
- **Fase 3**: nada feito.
- **Prompts A–D**: nenhum executado por inteiro. O A é o próximo natural, logo depois da primeira
  conexão real com o Mercado Livre.

## 05 — Verificação com REA

| Recomendação | Situação |
| --- | --- |
| Divisão do pacote por rota | **Feito**: `React.lazy` em `apps/web/src/App.tsx` |
| Fluxo de exportação de dados (LGPD) | **Feito**: `GET /api/account/export`, só para o titular, sem segredos; botão em Segurança |
| Destacar a reabertura de chamado negado | Já existe (`INDEFERIDO → EM_ANALISE`); sem página própria |
| Auditoria de frete de transportadoras | **Não feito** |

Os percentuais que o documento cita do site de referência (90%, 63%, 166%) são daquele serviço e
**não** foram nem devem ser usados no Grandir.

## 06 — REA nos painéis de seller e ERPs

- O REA não está conectado a esta sessão, e os dois trabalhos de pesquisa delegados ao Antigravity
  ficaram mais de dez horas sem devolver nada. A pesquisa foi refeita por busca na web
  ([formatos-de-relatorios.md](pesquisa/formatos-de-relatorios.md), [apis-oficiais.md](pesquisa/apis-oficiais.md)).
- Os métodos A e B (inspecionar a sua própria sessão logada ou um HAR) exigem uma conta de seller, que
  ainda não existe. Quando existir, o uso correto é **descobrir quais dados o painel mostra e em que
  formato** — para escolher o endpoint oficial equivalente e calibrar o importador.
- O produto **não** deve chamar endpoints internos dos painéis com a sessão do seller: isso viola os
  termos dos marketplaces e pode custar a conta do cliente. Em produção, só APIs oficiais com OAuth e
  arquivos exportados pelo próprio seller.
- Sem relatório real, o substituto é `node scripts/gerar-relatorios-exemplo.mjs`: arquivos
  **sintéticos**, com os cabeçalhos encontrados na pesquisa e erros plantados, que um teste
  automatizado importa de ponta a ponta.
