# Pesquisa: APIs oficiais (Mercado Livre e TikTok Shop)

> Pesquisa por busca na web em 13/11/2026. Os clientes do Grandir foram testados só contra APIs
> simuladas: nenhuma chamada real foi feita, porque ainda não existe aplicativo cadastrado.
> "Confirmado" abaixo significa "confere com a fonte citada", não "testado em produção".

## Mercado Livre

| Tema | O que a fonte diz | Estado no Grandir |
| --- | --- | --- |
| Token | `access_token` vale 6 horas; renovar antes (por exemplo, com 5 h) e **guardar o novo `refresh_token` a cada renovação**; se a renovação falhar, o seller precisa autorizar de novo. [Documentação de OAuth](https://developers.mercadolivre.com.br/en_us/identity-and-access-management-oauth-and-tokens) | Confirmado: `integrations/tokens.ts` renova e regrava o par; falha marca a loja para reconexão. |
| Reclamações | `/post-purchase/v1/claims/search` (o caminho antigo `/v1/claims/` foi descontinuado em 06/05/2024), com filtros `stage`, `status` e datas. [Gerenciar reclamações](https://developers.mercadolivre.com.br/pt-br/gerenciar-reclamacoes) | **Não ligado**: devoluções e mediações entram hoje por arquivo. |
| Devoluções | `/post-purchase/v2/claims/{id}/returns`, para reclamações do tipo devolução. [Gerenciar devoluções](https://developers.mercadolivre.com.br/pt-br/gerenciar-devolucoes) | **Não ligado.** |
| Pedidos, custo de envio, liberações do Mercado Pago, recebimento do Full | Não cobertos pelas fontes encontradas. | Pedidos e envios são chamados pelo cliente, com resposta simulada nos testes; liberações e Full entram por arquivo. |

## TikTok Shop

| Tema | O que a fonte diz | Estado no Grandir |
| --- | --- | --- |
| Troca do código | `GET` no host de autenticação (`auth.tiktok-shops.com/api/v2/token/get`) com chave e segredo do app; há endpoint separado de renovação, e o token de acesso dura cerca de 7 dias. [Guia de integração de terceiro](https://help.useresponse.com/hemi/knowledge-base/article/marketplaces-tiktok-marketplace-integration-v2-tiktok-authentication-database-structure_1) | Confere com `integrations/tiktok.ts`. |
| Assinatura | HMAC-SHA256; todos os parâmetros de consulta entram, **menos `sign` e `access_token`**. [README do pacote `tiktok-shop`](https://cdn.jsdelivr.net/npm/tiktok-shop@2.0.0/README.md) | Confere; a ordem exata (segredo + caminho + pares ordenados + corpo + segredo) segue a prática dos SDKs abertos e precisa ser validada na primeira chamada real. |
| Loja | `shop_cipher` vem de `GET /authorization/202309/shops` em `open-api.tiktokglobalshop.com` e acompanha as chamadas da loja. [Exemplo Chilkat](https://example-code.com/js/tiktok_shop_authorized_shops.asp) | Confere: guardado cifrado como identificador externo da loja. |
| Webhooks | A assinatura de webhook é diferente da assinatura de requisição. [Hookdeck](https://hookdeck.com/webhooks/platforms/guide-to-tiktok-shop-webhooks-features-and-best-practices) | Webhooks não são usados. |
| Extrato financeiro pela API | Não coberto pelas fontes. | O extrato entra por arquivo e é cruzado com os pedidos da API por `pedido + SKU`. |

## Pendências de validação quando houver credenciais

1. Mercado Livre: conferir campos de pedidos e de custo de envio com uma conta real; ligar reclamações e devoluções.
2. TikTok Shop: conferir a URL de autorização do Brasil, a ordem da assinatura e os campos de `orders/search`.
3. Shopee: os itens ainda abertos estão na seção 8 de [INTEGRACOES.md](../INTEGRACOES.md).
