# Pesquisa: formato dos relatórios exportados pelos painéis

> **Alcance e limites.** Não havia nenhum relatório real disponível, e as páginas oficiais de ajuda não
> listam as colunas. O que está aqui vem de fontes públicas de terceiros (projetos abertos que processam
> esses arquivos e bases de conhecimento de ferramentas). Serve para calibrar as **sugestões** de
> mapeamento; nada no importador depende destes nomes — o seller confirma o mapeamento na tela.
> Pesquisa feita em 13/11/2026 por busca na web (os trabalhos delegados ao Antigravity não retornaram).

## Mercado Livre — relatório de vendas ("Vendas BR")

| Achado | Fonte | Efeito no Grandir |
| --- | --- | --- |
| O arquivo tem cerca de 67 colunas e o **cabeçalho fica na linha 7**; acima dele há título e filtros. | [PR nº 492 de Lksntzz/nisti-identificacao](https://github.com/Lksntzz/nisti-identificacao/pull/492) | `imports/tabular.ts` já procura a primeira linha "larga" em vez da primeira linha do arquivo. |
| Colunas vistas: `N.º de venda`, `Data da venda`, `Unidades`, `Receita por produtos (BRL)`, `Tarifa de venda e impostos`, `Tarifas de envio`, `Cancelamentos e reembolsos (BRL)`, `Total (BRL)`, `Reclamação encerrada`. | [renato-perussi/Vendas_Mercado_Livre](https://github.com/renato-perussi/Vendas_Mercado_Livre) | Todos esses nomes são apelidos em `imports/schema.ts`; os arquivos de exemplo usam os mesmos cabeçalhos. |
| `Total (BRL)` é o valor **líquido** (já com frete e tarifas); a receita bruta é `Receita por produtos (BRL)`. | PR nº 492 acima | `Total (BRL)` é sugerido para "Valor repassado", nunca para "Valor da venda". |
| Vendas com vários itens (pacotes) aparecem em mais de uma linha. | PR nº 492 acima | A chave do registro é `pedido + SKU`; uma linha de pacote sem SKU é recusada com o motivo. |
| Existe um relatório separado, "Faturamento do Mercado Livre" (XLSX ou CSV), para conciliar tarifas. | [Central de vendedores](https://vendedores.mercadolivre.com.br/nota/como-reconciliar-o-relatorio-faturamento-do-mercado-livre) | Pode ser enviado como "Vendas, tarifas e repasses" mapeando as colunas de tarifa. |

## Shopee — exportação de pedidos (`Order.all`)

| Achado | Fonte | Efeito no Grandir |
| --- | --- | --- |
| Caminho: Pedidos → Meus Pedidos → Todos → Exportar; o arquivo se chama `order.all…` e fica em Meus Relatórios. | [Preço Certo](https://precocerto.helpscoutdocs.com/article/92-planilha-de-repasse-shopee), [Marketize](https://www.marketizesales.com.br/guia-de-exportacao-de-planilha-shopee) | Instrução repetida na tela de importação. |
| A exportação é limitada por período: exportar mês a mês. | Marketize acima | Reimportar é idempotente (mesma chave substitui a linha). |
| Cerca de 64 colunas; existem `Taxa de Comissão` e `Taxa de Serviço` separadas. | [PR nº 29 de Switerz/mktplace](https://github.com/Switerz/mktplace/pull/29), Preço Certo | Apelidos de "Comissão cobrada". |
| Alguns arquivos trazem valores em formato numérico americano (`1,234.56`). | PR nº 29 acima | `parseMoney` passou a tratar o **último** separador como decimal; há teste. |
| Na versão em inglês: `Order ID`, `SKU Reference No.`, `Product Subtotal`. | [ChatExcel](https://www.chatexcel.co/guides/analyze-shopee-lazada-orders) | Apelidos acrescentados. |
| O mesmo pedido pode aparecer em exportações sucessivas com estados diferentes. | PR nº 29 acima | A última importação vence. |

## TikTok Shop

Não encontrei fonte pública confiável com as colunas do extrato de liquidação em português. O
importador funciona com qualquer cabeçalho pelo mapeamento manual; os apelidos serão ajustados quando
houver um arquivo real.

## O que só um arquivo real resolve

1. Nome exato da coluna de SKU no relatório do Mercado Livre e se o peso cobrado aparece nele.
2. Se a data de liberação do dinheiro vem no relatório de vendas ou só no extrato do Mercado Pago.
3. Cabeçalhos do extrato do TikTok Shop Brasil.

Enquanto isso, `node scripts/gerar-relatorios-exemplo.mjs` gera arquivos **sintéticos**, com os
cabeçalhos acima e erros plantados, para exercitar o fluxo inteiro.
