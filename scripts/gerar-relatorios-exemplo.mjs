// Gera arquivos de EXEMPLO (dados SINTÉTICOS, inventados) para experimentar a tela
// "Dados da loja" sem ter um relatório real em mãos. Os arquivos imitam a ESTRUTURA de um
// relatório de marketplace — os nomes das colunas são plausíveis, não os oficiais — e
// trazem erros plantados de propósito, para a auditoria ter o que encontrar.
//
// Uso:  node scripts/gerar-relatorios-exemplo.mjs [pasta-de-saída]     (padrão: data/exemplos)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'data/exemplos');
mkdirSync(out, { recursive: true });
const AVISO = 'EXEMPLO SINTÉTICO — dados inventados para teste do importador, que não representam nenhuma loja real';

const two = (n) => String(n).padStart(2, '0');
const day = (n) => { const d = new Date(Date.now() - n * 86_400_000); return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`; };
const iso = (n) => new Date(Date.now() - n * 86_400_000).toISOString().replace(/\.\d+Z$/, '-03:00');
const brl = (v) => v.toFixed(2).replace('.', ',');
const csv = (name, header, rows) => {
  const text = [AVISO, '', header.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n') + '\r\n';
  writeFileSync(join(out, name), '﻿' + text);
  return rows.length;
};

// Gerador determinístico: os mesmos arquivos a cada execução (as datas acompanham o dia de hoje).
let seed = 20261112;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const PRODUTOS = [
  // sku, descrição, EAN, custo, preço, peso kg, largura, altura, profundidade
  ['FONE-BT-01', 'Fone bluetooth com estojo', '7891000000017', 89.0, 199.9, 0.31, 18, 8, 20],
  ['GARRAFA-1L', 'Garrafa térmica inox 1 L', '7891000000024', 42.5, 99.9, 0.48, 9, 9, 30],
  ['CABO-USBC', 'Cabo USB-C 1 m', '7891000000031', 9.5, 29.9, 0.05, 10, 2, 12],
  ['TAPETE-YOGA', 'Tapete de yoga antiderrapante', '7891000000048', 62.0, 139.9, 1.15, 14, 14, 62],
  ['LUMINARIA-LED', 'Luminária de mesa LED', '7891000000055', 74.0, 169.9, 0.76, 16, 12, 38],
];

writeFileSync(join(out, 'produtos-erp.csv'), '﻿' + ['Código;Descrição;GTIN/EAN;Preço de custo;Peso bruto (kg);Largura;Altura;Profundidade',
  ...PRODUTOS.map(([sku, nome, ean, custo, , peso, l, a, p]) => [sku, nome, ean, brl(custo), String(peso).replace('.', ','), l, a, p].join(';'))].join('\r\n') + '\r\n');

// ── Vendas, tarifas e repasses (Mercado Livre): comissão de 12%, frete conforme o peso.
const vendas = [];
const pedidos = [];
for (let i = 0; i < 60; i++) {
  const [sku, , , , preco, peso] = PRODUTOS[int(0, PRODUTOS.length - 1)];
  const qtd = rnd() < 0.85 ? 1 : 2;
  const dias = int(4, 85);
  const bruto = preco * qtd;
  const errado = i % 11 === 0;                    // erro plantado: comissão três pontos acima
  const pesoErrado = sku === 'FONE-BT-01' && i % 4 === 0; // erro plantado: frete por peso que o produto não tem
  const comissao = bruto * (errado ? 0.15 : 0.12) + (preco < 79 ? 6.5 * qtd : 0);
  const pesoCobrado = pesoErrado ? 2.4 : peso;
  const frete = preco < 79 ? 5.95 : pesoCobrado <= 0.3 ? 12.95 : pesoCobrado <= 0.5 ? 13.95 : pesoCobrado <= 1 ? 14.95 : pesoCobrado <= 2 ? 16.45 : 19.95;
  const liquido = bruto - comissao - frete;
  const id = `20000${String(11220000000 + i * 7919)}`;
  pedidos.push({ id, sku, qtd, dias, bruto });
  vendas.push([id, day(dias), sku, qtd, brl(bruto), brl(-comissao), brl(-frete), String(pesoCobrado).replace('.', ','), `MLB${3000000000 + i * 31}`, `ME${100000000 + i * 13}BR`, 'Clássico', dias > 9 ? brl(liquido) : '', dias > 9 ? day(dias - 8) : '']);
}
const nVendas = csv('vendas-e-repasses.csv',
  ['N.º de venda', 'Data da venda', 'SKU', 'Unidades', 'Receita por produtos (BRL)', 'Tarifa de venda e impostos', 'Tarifas de envio', 'Peso cobrado', 'N.º de anúncio', 'Número de rastreamento', 'Tipo de anúncio', 'Total (BRL)', 'Data de liberação'], vendas);

// ── Extravios e avarias
const ocorr = [
  ['OCR-1001', 'Extravio em trânsito', pedidos[3].sku, pedidos[3].qtd, day(pedidos[3].dias - 3), pedidos[3].id, '', '0,00'],
  ['OCR-1002', 'Extravio na logística reversa', pedidos[9].sku, pedidos[9].qtd, day(pedidos[9].dias - 2), pedidos[9].id, '', brl(pedidos[9].bruto)],
  ['OCR-1003', 'Produto avariado no armazém', 'GARRAFA-1L', 3, day(40), '', 'INB-000902', '0,00'],
  ['OCR-1004', 'Extravio no armazém', 'TAPETE-YOGA', 2, day(33), '', 'INB-000901', '62,00'],
];
csv('extravios-e-avarias.csv', ['Código da ocorrência', 'Tipo', 'SKU', 'Quantidade', 'Data da ocorrência', 'Pedido', 'Lote', 'Indenização'], ocorr);

// ── Devoluções
const dev = [
  ['DEV-501', pedidos[5].id, pedidos[5].sku, pedidos[5].qtd, day(22), brl(pedidos[5].bruto), 'Comprador', 'Não', '', '0,00'],
  ['DEV-502', pedidos[12].id, pedidos[12].sku, pedidos[12].qtd, day(25), brl(pedidos[12].bruto), 'Comprador', 'Sim', 'Avariado', '0,00'],
  ['DEV-503', pedidos[20].id, pedidos[20].sku, pedidos[20].qtd, day(19), brl(pedidos[20].bruto), 'Comprador', 'Sim', 'Bom estado', '0,00'],
];
csv('devolucoes.csv', ['Código da devolução', 'Pedido', 'SKU', 'Quantidade', 'Data de encerramento', 'Valor reembolsado', 'Resultado', 'Produto devolvido', 'Condição do produto', 'Valor restituído'], dev);

// ── Recebimento de lotes no centro de distribuição, e as NF-e de remessa correspondentes
const lotes = [
  ['INB-000901', 'TAPETE-YOGA', 120, 116, 45],  // faltam 4 unidades
  ['INB-000902', 'GARRAFA-1L', 200, 200, 42],
  ['INB-000903', 'FONE-BT-01', 150, 141, 30],   // faltam 9 unidades
];
csv('recebimento-de-lotes.csv', ['Lote', 'SKU', 'Unidades recebidas', 'Data de recebimento'], lotes.map(([lote, sku, , recebido, dias]) => [lote, sku, recebido, day(dias)]));

function chave(numero) {
  const base = `352611${'11222333000181'}55001${String(numero).padStart(9, '0')}1${String(numero).padStart(8, '0')}`;
  let soma = 0;
  for (let i = 42, peso = 2; i >= 0; i--, peso = peso === 9 ? 2 : peso + 1) soma += Number(base[i]) * peso;
  const resto = soma % 11;
  return base + (resto < 2 ? 0 : 11 - resto);
}
mkdirSync(join(out, 'nfe'), { recursive: true });
lotes.forEach(([lote, sku, enviado, , dias], i) => {
  const produto = PRODUTOS.find((p) => p[0] === sku);
  const k = chave(7000 + i);
  const total = (produto[3] * enviado).toFixed(2);
  writeFileSync(join(out, 'nfe', `remessa-${lote}.xml`), `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${AVISO} -->
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${k}" versao="4.00">
  <ide><natOp>Remessa para depósito em centro de distribuição</natOp><mod>55</mod><serie>1</serie><nNF>${7000 + i}</nNF><dhEmi>${iso(dias + 4)}</dhEmi></ide>
  <emit><CNPJ>11222333000181</CNPJ><xNome>Empresa de Exemplo Ltda</xNome></emit>
  <dest><CNPJ>11444777000161</CNPJ><xNome>Centro de Distribuição de Exemplo</xNome></dest>
  <det nItem="1"><prod><cProd>${sku}</cProd><cEAN>${produto[2]}</cEAN><xProd>${produto[1]}</xProd><CFOP>5949</CFOP><qCom>${enviado}.0000</qCom><vUnCom>${produto[3].toFixed(4)}</vUnCom><vProd>${total}</vProd><xPed>${lote}</xPed></prod></det>
  <total><ICMSTot><vProd>${total}</vProd><vFrete>0.00</vFrete><vICMS>0.00</vICMS><vIPI>0.00</vIPI><vNF>${total}</vNF></ICMSTot></total>
  <transp><vol><pesoL>${(produto[5] * enviado).toFixed(3)}</pesoL><pesoB>${(produto[5] * enviado * 1.08).toFixed(3)}</pesoB></vol></transp>
</infNFe></NFe><protNFe><infProt><chNFe>${k}</chNFe></infProt></protNFe></nfeProc>
`);
});

writeFileSync(join(out, 'LEIA-ME.txt'), `${AVISO}

Como usar: cadastre uma loja do Mercado Livre e, em Lojas → Dados da loja, envie nesta ordem:
  1. produtos-erp.csv            (Cadastro de produtos do ERP)
  2. nfe/*.xml                   (Notas fiscais)
  3. recebimento-de-lotes.csv    (Recebimento de lotes no centro de distribuição)
  4. vendas-e-repasses.csv       (Vendas, tarifas e repasses)
  5. extravios-e-avarias.csv e devolucoes.csv

Erros plantados que a auditoria deve encontrar: comissão de 15% em vez de 12% em alguns pedidos,
frete do FONE-BT-01 cobrado por 2,4 kg, lotes INB-000901 e INB-000903 recebidos com falta,
extravios sem indenização e devoluções sem retorno do produto ou com produto avariado.

Os nomes das colunas são plausíveis, não os oficiais de nenhum marketplace: o relatório real
do seu painel pode ter outros cabeçalhos — é para isso que existe a etapa de mapeamento.
`);
console.log(`Arquivos de exemplo gravados em ${out}: ${nVendas} vendas, ${ocorr.length} ocorrências, ${dev.length} devoluções, ${lotes.length} lotes e ${lotes.length} NF-e.`);
