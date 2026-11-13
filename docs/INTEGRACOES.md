# Integrações: Mercado Livre e Shopee

Guia para registrar os aplicativos da Grandir nos dois marketplaces e ligar o OAuth 2.0 que o back-end já implementa. Escrito em novembro de 2026.

Os portais de desenvolvedores do Mercado Livre e da Shopee recusaram leitura automatizada durante a pesquisa (HTTP 403 e bloqueio de domínio). O que está aqui foi confirmado por trechos das páginas oficiais obtidos via busca; o que não pôde ser confirmado está marcado com "(não confirmado na documentação oficial)". Confira esses pontos na tela antes de seguir.

## 1. Visão geral

| | Mercado Livre | Shopee |
|---|---|---|
| Cadastro | Conta do Mercado Livre com dados do titular validados | Conta de parceiro na Shopee Open Platform |
| Credenciais | Client ID e Client Secret | Partner ID e Partner Key (pares distintos para teste e produção) |
| Variáveis | `ML_CLIENT_ID`, `ML_CLIENT_SECRET` | `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_API_HOST` |
| URL de retorno | `<OAUTH_REDIRECT_BASE>/api/oauth/mercadolivre/callback` | `<OAUTH_REDIRECT_BASE>/api/oauth/shopee/callback` |
| Aprovação | Não há revisão prévia para uso com contas próprias (não confirmado na documentação oficial) | Teste imediato no sandbox; produção depende de revisão da Shopee |

Comuns às duas: `OAUTH_REDIRECT_BASE`, `WEB_ORIGIN` e `DATA_ENCRYPTION_KEY` (ver `apps/api/src/config.ts`). Se `OAUTH_REDIRECT_BASE` ficar vazio, vale a primeira origem de `WEB_ORIGIN`.

Ordem recomendada:

1. Defina a URL pública HTTPS (seção 4). Os dois portais pedem a URL ou o domínio de retorno no cadastro.
2. Gere a `DATA_ENCRYPTION_KEY` (seção 5).
3. Crie o app do Mercado Livre (seção 2). É o mais rápido.
4. Cadastre-se na Shopee e teste no sandbox (seção 3); peça produção em paralelo.

Como o fluxo funciona no código (`apps/api/src/routes/oauth.ts`):

1. Na tela Lojas, o administrador clica em "Conectar conta"; o portal chama `POST /api/stores/:id/oauth/start`.
2. A API cria um `state` aleatório de uso único, válido por 10 minutos, preso ao tenant, à loja e ao usuário, e devolve a URL de autorização do marketplace.
3. O marketplace devolve o navegador para `/api/oauth/<marketplace>/callback`. Essa rota exige o cookie de sessão do portal, então o retorno precisa cair no mesmo domínio em que o usuário está logado.
4. A API troca o `code` por tokens, grava-os cifrados (AES-256-GCM), marca a loja como conectada, apaga as divergências de demonstração em aberto e redireciona para `<primeira origem de WEB_ORIGIN>/app/lojas?conectada=<marketplace>`.

## 2. Mercado Livre

### 2.1 O que o código chama

Arquivo: `apps/api/src/integrations/mercadolivre.ts`.

| Uso | Chamada |
|---|---|
| Autorização | `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=...&redirect_uri=...&state=...` |
| Troca e renovação de token | `POST https://api.mercadolibre.com/oauth/token` (form-urlencoded; `authorization_code` e `refresh_token`) |
| Pedidos | `GET /orders/search?seller=<user_id>&order.date_created.from=...&order.date_created.to=...` |
| Envio | `GET /shipments/{id}` com cabeçalho `x-format-new: true` |
| Custo do envio | `GET /shipments/{id}/costs` |
| Reclamações (cliente pronto, ainda não usado pela auditoria) | `GET /post-purchase/v1/claims/search` |

Tudo é leitura (GET). A Grandir não precisa de escopo de escrita.

### 2.2 Criar o aplicativo

1. Entre em developers.mercadolivre.com.br com a conta do Mercado Livre da Grandir (não com a conta de um cliente). No Brasil é preciso ter os dados do titular da conta incluídos e validados, e a conta pode criar apenas 1 aplicação.
2. Abra "Minhas aplicações" e escolha criar uma nova aplicação. O nome exato do botão não foi confirmado (não confirmado na documentação oficial).
3. Preencha nome, nome curto, descrição e logotipo. Os rótulos exatos dos campos não foram confirmados (não confirmado na documentação oficial).
4. Em "Redirect URI", cadastre exatamente:
   `https://<seu-domínio>/api/oauth/mercadolivre/callback`
   A URI precisa usar HTTPS e ser estática: o `redirect_uri` enviado deve ser idêntico ao cadastrado, sem parâmetros extras. Parâmetros viajam no `state`, como o código já faz. Cadastre também a URL do túnel de desenvolvimento, se for usar uma (seção 4).
5. PKCE: deixe desligado. A documentação diz que o PKCE é opcional e configurado na aplicação; o código atual não envia `code_challenge` nem `code_verifier`. Com PKCE ligado, a autorização falha.
6. Escopos: marque leitura e `offline_access`. Sem `offline_access` o Mercado Livre não devolve `refresh_token`, e o código depende dele para renovar o acesso. Não marque escrita.
7. Permissões funcionais: a permissão de Usuários já vem ativa. Habilite também as áreas de vendas e pedidos, envios e pós-venda/reclamações em modo leitura. Os nomes exatos dessas permissões não foram confirmados (não confirmado na documentação oficial).
8. Notificações e tópicos: não são usados pela Grandir hoje. Deixe em branco se o formulário permitir (não confirmado na documentação oficial).
9. Salve. O Client ID (também chamado de App ID) e o Client Secret aparecem nos detalhes da aplicação em "Minhas aplicações" (não confirmado na documentação oficial).

Atenção: uma página oficial menciona que, a partir de 30/08/2026, cada aplicação deve ficar separada entre Mercado Livre e Mercado Pago, uma por unidade de negócio. Se o formulário pedir, escolha Mercado Livre.

### 2.3 .env

```
ML_CLIENT_ID=<Client ID>
ML_CLIENT_SECRET=<Client Secret>
OAUTH_REDIRECT_BASE=https://<seu-domínio>
```

Reinicie a API. Sem as duas variáveis, a integração fica desligada e `oauth/start` responde 503 `INTEGRACAO_NAO_CONFIGURADA`.

### 2.4 Testar

1. Abra o portal pelo mesmo domínio de `OAUTH_REDIRECT_BASE` e entre como administrador.
2. Em Lojas, cadastre uma loja do Mercado Livre (ela começa vazia).
3. Clique em "Conectar conta" e autorize com a conta de vendedor que será auditada. Use a conta principal, não uma conta de colaborador.
4. Você deve voltar para `/app/lojas?conectada=mercadolivre` com o aviso "Conta autorizada", e a loja passa a mostrar "Conta conectada por API". O botão "Conectar conta" só aparece quando `ML_CLIENT_ID` e `ML_CLIENT_SECRET` estão no `.env`.

Validade dos tokens: o access token vale 6 horas. O refresh token vale cerca de 6 meses, é de uso único e só o último emitido funciona. O código renova o access token quando faltam menos de 5 minutos e grava o refresh token novo (`apps/api/src/integrations/tokens.ts`).

## 3. Shopee Open Platform

### 3.1 O que o código chama

Arquivo: `apps/api/src/integrations/shopee.ts`. Host em `SHOPEE_API_HOST` (padrão no código: `https://partner.shopeemobile.com`).

| Uso | Caminho |
|---|---|
| Autorização da loja | `GET /api/v2/shop/auth_partner?partner_id&timestamp&sign&redirect` |
| Obter token | `POST /api/v2/auth/token/get` (corpo: `code`, `shop_id`, `partner_id`) |
| Renovar token | `POST /api/v2/auth/access_token/get` (corpo: `refresh_token`, `shop_id`, `partner_id`) |
| Pedidos | `GET /api/v2/order/get_order_list` (janelas de 15 dias) e `GET /api/v2/order/get_order_detail` (lotes de 50) |
| Repasse e tarifas | `GET /api/v2/payment/get_escrow_detail` |
| Rastreio (cliente pronto, ainda não usado pela auditoria) | `GET /api/v2/logistics/get_tracking_info` |

Assinatura: HMAC-SHA256 com a Partner Key sobre `partner_id + caminho + timestamp`, acrescido de `access_token + shop_id` nas chamadas de loja. Isso confere com a descrição dos PDFs oficiais da Shopee citados nas Fontes.

Permissões: a Grandir precisa das APIs de Order, Payment e Logistics, só leitura. Como a Shopee libera esses módulos por tipo de app não foi confirmado (não confirmado na documentação oficial).

### 3.2 Cadastro e criação do app

1. Acesse open.shopee.com e crie a conta de desenvolvedor como empresa (não confirmado na documentação oficial).
2. No console, crie um app. Escolha o tipo voltado a ferramentas para vendedores, ou seja, um ISV que atende várias lojas de terceiros; não escolha um tipo para uso exclusivo da própria loja. Os nomes dos tipos não foram confirmados (não confirmado na documentação oficial).
3. Depois de criado, o app mostra um Test Partner ID e uma Test API Partner Key para o sandbox (fonte de terceiros; não confirmado na documentação oficial).
4. Cadastre o domínio de retorno do teste ("Test Redirect URL Domain"). A Shopee recusa autorização que volte para outro domínio (fonte de terceiros; não confirmado na documentação oficial).
5. Crie uma loja de teste no sandbox pelo próprio console (não confirmado na documentação oficial).
6. Para produção, use "Go Live" na página do app. Envie a descrição do produto, um acesso de teste ao portal da Grandir e o "Live Redirect URL Domain"; a lista de IPs é opcional. Depois da revisão, aparecem o Live Partner ID e a Live Partner Key. O fluxo vem de fonte de terceiros e o prazo de aprovação não foi encontrado (não confirmado na documentação oficial).

### 3.3 Hosts

| Ambiente | Host | Situação |
|---|---|---|
| Sandbox | `https://partner.test-stable.shopeemobile.com` | Aparece nos PDFs da Shopee e em várias bibliotecas (não confirmado na documentação oficial atual) |
| Produção | `https://partner.shopeemobile.com` | Padrão do código. Aparece nos PDFs da Shopee e em bibliotecas (não confirmado na documentação oficial atual) |
| Produção Brasil (alternativo) | `https://openplatform.shopee.com.br` | Só uma fonte de terceiros cita; se o console indicar este host, defina `SHOPEE_API_HOST` (não confirmado na documentação oficial) |

Cada par de credenciais só funciona no seu ambiente: credenciais de teste com host de teste, credenciais de produção com host de produção.

### 3.4 .env

```
SHOPEE_PARTNER_ID=<Partner ID do ambiente escolhido>
SHOPEE_PARTNER_KEY=<Partner Key do mesmo ambiente>
SHOPEE_API_HOST=https://partner.test-stable.shopeemobile.com   # sandbox; troque ao ir para produção
OAUTH_REDIRECT_BASE=https://<seu-domínio>
```

### 3.5 Testar

1. Repita o teste do Mercado Livre (seção 2.4) com uma loja Shopee.
2. Faça login com a loja de teste do sandbox ou, em produção, com a conta da loja. Não use uma conta principal (main account) que agrupa lojas: o código exige `shop_id` no retorno (veja Divergências).
3. O retorno esperado é `/app/lojas?conectada=shopee`.

O código põe o `state` dentro da URL `redirect`, porque a Shopee não devolve um `state` próprio, e a Shopee acrescenta `code` e `shop_id` a essa URL. Segundo os PDFs oficiais, o access token vale 4 horas e o refresh token 30 dias.

## 4. Desenvolvimento local

O Mercado Livre exige HTTPS na Redirect URI, então `http://localhost` não serve. Na Shopee, a exigência de HTTPS não foi confirmada (não confirmado na documentação oficial), mas use HTTPS de qualquer forma.

Em desenvolvimento, o Vite (porta 5173) serve o portal e encaminha `/api` para a API (porta 4000). Exponha o Vite, não a API: assim o portal, o cookie de sessão e o callback ficam no mesmo domínio.

1. Abra um túnel HTTPS para a porta 5173. Opções: Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:5173`) ou ngrok (`ngrok http 5173`). Prefira um domínio fixo, como um túnel nomeado ou um domínio reservado: URLs aleatórias mudam a cada execução e obrigam a recadastrar o retorno nos portais.
2. O Vite 6 recusa hosts desconhecidos. Para o túnel funcionar, inclua o host em `server.allowedHosts` no `apps/web/vite.config.ts` ou defina `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=<host-do-túnel>` no ambiente do Vite.
3. No `.env`:
   ```
   WEB_ORIGIN=https://<host-do-túnel>,http://localhost:5173
   OAUTH_REDIRECT_BASE=https://<host-do-túnel>
   ```
   A origem do túnel precisa vir primeiro: a API redireciona para a primeira origem depois do callback e recusa (403 `ORIGEM_INVALIDA`) chamadas de origens fora da lista.
4. Cadastre `https://<host-do-túnel>/api/oauth/<marketplace>/callback` no Mercado Livre e o domínio do túnel na Shopee.
5. Abra e faça login no portal pelo endereço do túnel, não por `localhost`. O cookie de sessão pertence ao domínio em que você fez login.

## 5. Segurança

1. `ML_CLIENT_SECRET` e `SHOPEE_PARTNER_KEY` ficam só no `.env` ou no cofre de segredos da hospedagem. O `.env` não é versionado. Nunca ponha esses valores em `.env.example`, issues, prints ou logs.
2. `DATA_ENCRYPTION_KEY` cifra os tokens dos sellers. Ela é obrigatória em produção: a API não sobe sem ela. Em desenvolvimento, sem ela, o código usa uma chave fixa conhecida, então defina uma antes de conectar contas reais:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
3. Trocar a `DATA_ENCRYPTION_KEY` torna ilegíveis os tokens já gravados, e todas as lojas precisarão ser reconectadas. Guarde-a em backup seguro.
4. Se uma chave vazar:
   1. Gere um novo Client Secret ou uma nova Partner Key no portal do marketplace. A disponibilidade e o nome da opção de renovação não foram confirmados (não confirmado na documentação oficial).
   2. Atualize o `.env` e reinicie a API.
   3. Se a `DATA_ENCRYPTION_KEY` vazou junto com o banco, trate os tokens dos sellers como comprometidos: peça aos sellers que revoguem o acesso do app nas contas deles e reconectem.
   4. Remova o segredo do histórico do Git se ele chegou a ser commitado. Só a rotação resolve; apagar o arquivo não basta.
   5. Registre o incidente.

## 6. Lista de verificação

- [ ] URL pública HTTPS definida e cadastrada nos dois portais
- [ ] `OAUTH_REDIRECT_BASE` igual ao domínio cadastrado, sem barra final e sem caminho
- [ ] `WEB_ORIGIN` com essa origem em primeiro lugar
- [ ] `DATA_ENCRYPTION_KEY` com 32 bytes em base64
- [ ] App do Mercado Livre com leitura e `offline_access`, sem PKCE
- [ ] `ML_CLIENT_ID` e `ML_CLIENT_SECRET` preenchidos
- [ ] `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY` e `SHOPEE_API_HOST` do mesmo ambiente
- [ ] Login no portal feito pelo domínio público
- [ ] "Conectar conta" volta com `?conectada=...`

## 7. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Marketplace mostra erro de `redirect_uri` antes do login | URL enviada diferente da cadastrada: http em vez de https, barra final, host do túnel trocado | Compare `<OAUTH_REDIRECT_BASE>/api/oauth/mercadolivre/callback` com o cadastro, caractere por caractere |
| Shopee recusa a autorização | Domínio de retorno não cadastrado ou credencial de outro ambiente | Confira o Redirect URL Domain e o par Partner ID/Key com `SHOPEE_API_HOST` |
| "Autorização inválida ou expirada" (`STATE_INVALIDO`) | Passaram mais de 10 minutos, a aba foi recarregada, outro usuário fez o login ou o callback foi repetido | Clique de novo em "Conectar conta" |
| 401 no callback | O navegador voltou sem o cookie do portal, porque o login foi feito em outro domínio | Faça login pelo domínio de `OAUTH_REDIRECT_BASE` |
| 403 `ORIGEM_INVALIDA` | A origem do portal não está em `WEB_ORIGIN` | Inclua a origem e reinicie |
| 503 `INTEGRACAO_NAO_CONFIGURADA` | Credenciais ausentes no `.env` | Preencha e reinicie |
| `invalid_grant` no Mercado Livre | Code ou refresh token usado, antigo, revogado ou com mais de 6 meses | Reconecte a loja |
| Shopee: token rejeitado após semanas sem uso | Refresh token expirado (30 dias) | Reconecte a loja |
| 403 em pedidos, envios ou reclamações | Permissão funcional ou escopo ausente no app, ou a conta autorizada não é a dona da loja | Ajuste as permissões e reautorize com a conta principal do vendedor |

Se o acesso de uma loja expirar, use "Reconectar conta" em Lojas: o botão fica disponível para qualquer loja do Mercado Livre ou da Shopee enquanto as credenciais do aplicativo estiverem no `.env`.

## 8. Divergências entre o código e a documentação

Situação em 12/11/2026: os itens 1, 3 e a parte de reconexão do item 8 já foram corrigidos no código; os demais continuam em aberto e só podem ser resolvidos com uma conta real.

1. **Host da Shopee Brasil (corrigido).** O padrão de `SHOPEE_API_HOST` passou a ser `https://partner.shopeemobile.com`. Antes era `https://openplatform.shopee.com.br`. Nenhuma fonte oficial acessível confirmou esse host. As bibliotecas e os PDFs da Shopee usam `partner.shopeemobile.com` em produção e `partner.test-stable.shopeemobile.com` no sandbox, e um guia de terceiros diz que lojas da América Latina usam o host geral. Confira na página de ambientes do console antes de ir para produção. Fontes: PDFs de autorização da Shopee e guias de terceiros listados abaixo.
2. **Retorno da Shopee sem `shop_id`.** `apps/api/src/routes/oauth.ts` recusa o callback sem `shop_id`. Os PDFs da Shopee indicam que `token/get` aceita `shop_id` ou `main_account_id`, ou seja, uma autorização por conta principal pode voltar sem `shop_id`. Hoje esse caso dá erro 400.
3. **`offline_access` no Mercado Livre (corrigido).** A documentação diz que o `refresh_token` só vem com o escopo `offline_access`. O código agora recusa a autorização sem `refresh_token`, com uma mensagem pedindo para ativar o escopo, em vez de aceitar um acesso que morreria em 6 horas.
4. **PKCE no Mercado Livre.** O código não implementa PKCE. A documentação o descreve como opcional e recomendado, ligado por aplicação. O app precisa ficar com PKCE desligado; para ligar, é preciso adaptar `mlAuthorizeUrl` e `mlExchangeCode`.
5. **Busca de reclamações do Mercado Livre.** `mercadolivre.ts` envia `date_created.from` e `sort=date_created:asc`. A referência oficial, publicada no site do Mercado Pago, documenta `id`, `type`, `stage`, `status`, `resource`, `resource_id`, `date_created` (valor exato) e `limit`. Um resumo da página "Manage Claims" cita intervalo de datas via `range=date_created:after:...:before:...` e ordenação `date_asc` ou `date_desc`. Os parâmetros do código provavelmente são ignorados ou rejeitados. O impacto hoje é nulo, porque `liveSources.ts` ainda não chama `claims`. Link: https://www.mercadopago.com.ar/developers/en/reference/claims/search-claims/get
6. **Peso do envio no Mercado Livre.** `liveSources.ts` lê `shipment.dimensions.weight` de `/shipments/{id}`. A documentação de envios mostra dimensões e peso por item em `/shipments/{id}/items`. Se o campo não existir no envio, `billedWeightG` fica 0 e as regras de peso não disparam (não confirmado na documentação oficial; verifique na primeira conexão real).
7. **Validade do `code` da Shopee.** Os PDFs oficiais citam 5 minutos e também 10 minutos. O `state` do código dura 10 minutos. Não há conflito prático, mas um login lento na Shopee pode expirar o `code` antes do `state`.
8. **Renovação só sob demanda.** `tokens.ts` renova o token apenas quando uma auditoria pede. A documentação dá 30 dias de validade ao refresh token da Shopee e 6 meses ao do Mercado Livre. Lojas paradas por mais tempo perdem o acesso e precisam usar "Reconectar conta" (já disponível na tela). Uma renovação agendada ainda não existe.

## Fontes

Consultadas, com leitura direta bloqueada; conteúdo obtido por trechos de busca:
- https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao
- https://developers.mercadolivre.com.br/en_us/authentication-and-authorization
- https://developers.mercadolivre.com.br/pt_br/crie-uma-aplicacao-no-mercado-livre
- https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/crie-uma-aplicacao-no-mercado-livre
- https://developers.mercadolivre.com.br/pt_br/configuracao-ou-requisitos-previos
- https://developers.mercadolivre.com.br/pt_br/permissoes-funcionais
- https://developers.mercadolivre.com.br/pt_br/desenvolvimento-seguro
- https://developers.mercadolivre.com.br/pt_br/lojas-oficiais/gerencie-seu-aplicativo
- https://developers.mercadolivre.com.br/pt-br/gerenciamento-de-envios
- https://developers.mercadolivre.com.br/en_us/mercado-envios-shipping-costs-and-quotes
- https://developers.mercadolivre.com.br/pt-br/gerenciar-reclamacoes
- https://global-selling.mercadolibre.com/devsite/manage-claims

Lida diretamente:
- https://www.mercadopago.com.ar/developers/en/reference/claims/search-claims/get
- https://vite.dev/config/server-options

Shopee (open.shopee.com bloqueou o acesso automatizado):
- PDF oficial da Shopee sobre autorização v1/v2: https://deo.shopeemobile.com/shopee/seller/seller_cms/c575929f948611337e1249564c2b8ff6/[TW][Open%20API]API%20v1_v2%E6%8E%88%E6%AC%8A%E6%96%B9%E6%B3%95%20(2020_09)_newnew.pdf
- Fontes de terceiros, só como indício: https://github.com/mu-hanz/shoapi, https://anythingmcp.com/guides/connect-shopee-to-muse, https://www.npmjs.com/package/@codespar/mcp-shopee
