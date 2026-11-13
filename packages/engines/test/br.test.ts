import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildDossier,
  dossierCsv,
  groupForDossiers,
  REFERENCE_TABLES,
  runBrAudit,
  versionAt,
  type BrAuditInput,
  type BrTables,
  type EvidenceItem,
  type ErpProduct,
  type MarketplaceOrder,
} from '../src/index';

const AS_OF = '2026-06-30T00:00:00.000Z';

const freight = [{ minPriceCents: 0, tiers: [{ maxG: 500, cents: 1_990 }, { maxG: 1000, cents: 2_290 }, { maxG: 5000, cents: 2_990 }, { maxG: null, cents: 7_990 }] }];
const base2026 = { effectiveFrom: '2026-01-01', effectiveTo: null, verified: true, sources: [], notes: '', cubicDivisor: 6000 };
/** Tabela fixa dos testes: os números das asserções não dependem do arquivo de configuração. */
const T: BrTables = {
  ...REFERENCE_TABLES,
  ml: [
    { ...base2026, id: 'ml-antiga', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31', freight, commissions: [], defaultCommission: { categoryId: '*', label: 'Todas', classicoBps: 1000, premiumBps: 1500 }, fixedFee: [] },
    { ...base2026, id: 'ml-teste', freight, commissions: [{ categoryId: 'MLB-ELETRO', label: 'Eletrônicos', classicoBps: 1300, premiumBps: 1800 }], defaultCommission: { categoryId: '*', label: 'Demais', classicoBps: 1200, premiumBps: 1700 }, fixedFee: [{ belowCents: 7_900, cents: 600 }] },
  ],
  shopee: [
    { ...base2026, id: 'shopee-teste', freight: [{ minPriceCents: 0, tiers: [{ maxG: 500, cents: 1_590 }, { maxG: null, cents: 4_990 }] }], commission: [{ belowCents: null, rateBps: 1400, fixedCents: 0 }], commissionCapCents: 10_000, transactionFeeBps: 200 },
  ],
};
const audit = (input: BrAuditInput) => runBrAudit(input, T);
const daysAgo = (n: number) => new Date(new Date(AS_OF).getTime() - n * 86_400_000).toISOString();

// 20 × 18 × 8 cm = 2.880 cm³ → 480 g cubado; peso real 310 g. Peso tarifável: 480 g.
const product: ErpProduct = { sku: 'FONE', ean: '7891234567890', name: 'Fone bluetooth', costCents: 18_900, weightG: 310, lengthCm: 20, widthCm: 18, heightCm: 8 };

const order = (over: Partial<MarketplaceOrder> = {}): MarketplaceOrder => ({
  marketplace: 'mercadolivre', orderId: 'P1', shipmentId: 'E1', trackingCode: 'ME1BR', itemId: 'MLB1', sku: 'FONE', quantity: 1,
  saleDate: daysAgo(20), grossCents: 39_990, categoryId: 'MLB-ELETRO', listingType: 'premium',
  commissionCents: 7_198, feeCents: 0, shippingChargedCents: 1_990, billedWeightG: 480, settledCents: 30_802, settledAt: daysAgo(12),
  ...over,
});

const base = (over: Partial<BrAuditInput> = {}): BrAuditInput => ({
  asOf: AS_OF, marketplace: 'mercadolivre', products: [product], orders: [], incidents: [], returns: [], invoices: [], receipts: [], marketplaceStock: {},
  ...over,
});

const rules = (input: BrAuditInput) => audit(input).findings.map((f) => [f.rule, f.recoverableCents]);

describe('Mercado Livre', () => {
  it('não acusa nada quando comissão, frete e repasse estão corretos', () => {
    assert.deepEqual(rules(base({ orders: [order()] })), []);
  });

  it('aponta comissão cobrada pela alíquota errada', () => {
    // Premium de eletrônicos: 18% de 399,90 = 71,98. Cobrado a 21% = 83,98.
    const findings = audit(base({ orders: [order({ commissionCents: 8_398 })] })).findings;
    assert.equal(findings[0].rule, 'ML_COMMISSION_OVERCHARGE');
    assert.equal(findings[0].recoverableCents, 1_200);
    assert.deepEqual(findings[0].details.amountLabels, ['Valor cobrado', 'Valor correto']);
  });

  it('aponta frete cobrado por peso maior que o cadastro do ERP justifica', () => {
    // 2,4 kg → faixa de R$ 29,90; correto (480 g) → R$ 19,90.
    const findings = audit(base({ orders: [order({ billedWeightG: 2_400, shippingChargedCents: 2_990 })] })).findings;
    assert.deepEqual([findings[0].rule, findings[0].recoverableCents], ['ML_FREIGHT_OVERCHARGE', 1_000]);
    assert.equal(findings[0].details.ids.ean, '7891234567890');
  });

  it('indeniza extravio pelo valor da venda quando há pedido e pelo custo quando é estoque', () => {
    const input = base({
      orders: [order()],
      incidents: [
        { id: 'O1', marketplace: 'mercadolivre', kind: 'TRANSIT_LOSS', sku: 'FONE', quantity: 1, occurredAt: daysAgo(16), orderId: 'P1', compensatedCents: 0 },
        { id: 'O2', marketplace: 'mercadolivre', kind: 'WAREHOUSE_LOSS', sku: 'FONE', quantity: 2, occurredAt: daysAgo(30), compensatedCents: 18_900 },
        { id: 'O3', marketplace: 'mercadolivre', kind: 'WAREHOUSE_DAMAGE', sku: 'FONE', quantity: 1, occurredAt: daysAgo(30), compensatedCents: 18_900 },
      ],
    });
    assert.deepEqual(rules(input), [['ML_TRANSIT_LOSS', 39_990], ['ML_WAREHOUSE_LOSS', 18_900]]);
  });

  it('trata devolução sem retorno e devolução avariada, e ignora a que voltou em ordem', () => {
    const ret = { marketplace: 'mercadolivre' as const, orderId: 'P1', sku: 'FONE', quantity: 1, closedAt: daysAgo(18), resolution: 'BUYER' as const, refundedToBuyerCents: 39_990, compensatedCents: 0 };
    const input = base({
      orders: [order()],
      returns: [
        { ...ret, id: 'M1', returnedToStock: false, returnedCondition: null },
        { ...ret, id: 'M2', returnedToStock: true, returnedCondition: 'DAMAGED' },
        { ...ret, id: 'M3', returnedToStock: true, returnedCondition: 'OK' },
      ],
    });
    assert.deepEqual(rules(input), [['ML_RETURN_NOT_RESTOCKED', 39_990], ['ML_RETURN_DAMAGED', 18_900]]);
  });

  it('descarta ocorrência com prazo de contestação vencido', () => {
    const input = base({ incidents: [{ id: 'O9', marketplace: 'mercadolivre', kind: 'WAREHOUSE_LOSS', sku: 'FONE', quantity: 1, occurredAt: daysAgo(120), compensatedCents: 0 }] });
    assert.deepEqual(rules(input), []);
  });
});

describe('Shopee', () => {
  // 399,90 − comissão 14% (55,99) − transação 2% (8,00) − frete 15,90 = 320,01
  const shopeeOrder = (over: Partial<MarketplaceOrder> = {}) =>
    order({ marketplace: 'shopee', commissionCents: 5_599, feeCents: 800, shippingChargedCents: 1_590, settledCents: 32_001, ...over });

  it('aceita repasse igual ao esperado e aponta repasse a menor', () => {
    assert.deepEqual(rules(base({ marketplace: 'shopee', orders: [shopeeOrder()] })), []);
    assert.deepEqual(rules(base({ marketplace: 'shopee', orders: [shopeeOrder({ settledCents: 30_501 })] })), [['SHOPEE_PAYOUT_SHORTFALL', 1_500]]);
  });

  it('aponta pedido extraviado sem crédito no extrato', () => {
    const input = base({
      marketplace: 'shopee',
      orders: [shopeeOrder()],
      incidents: [{ id: 'S1', marketplace: 'shopee', kind: 'REVERSE_LOSS', sku: 'FONE', quantity: 1, occurredAt: daysAgo(16), orderId: 'P1', compensatedCents: 0 }],
    });
    assert.deepEqual(rules(input), [['SHOPEE_LOST_NO_CREDIT', 39_990]]);
  });
});

describe('ERP × marketplace', () => {
  it('cruza a NF-e de remessa com a conferência do centro de distribuição', () => {
    const input = base({
      invoices: [{ accessKey: '1'.repeat(44), kind: 'REMESSA', issuedAt: daysAgo(40), sku: 'FONE', quantity: 100, totalCents: 1_890_000, inboundId: 'INB-1' }],
      receipts: [{ inboundId: 'INB-1', sku: 'FONE', receivedQty: 96, receivedAt: daysAgo(36) }],
    });
    const { findings, reconciliation } = audit(input);
    assert.deepEqual([findings[0].rule, findings[0].quantity, findings[0].recoverableCents], ['ERP_INBOUND_GAP', 4, 75_600]);
    assert.equal(findings[0].details.ids.nfeKey, '1'.repeat(44));
    assert.equal(reconciliation[0].inbound, 100);
  });

  it('aponta venda com NF-e emitida e sem repasse após o prazo', () => {
    const unsettled = order({ saleDate: daysAgo(45), settledAt: null, settledCents: null });
    const input = base({
      orders: [unsettled],
      invoices: [{ accessKey: '2'.repeat(44), kind: 'VENDA', issuedAt: daysAgo(45), sku: 'FONE', quantity: 1, totalCents: 39_990, orderId: 'P1' }],
    });
    assert.deepEqual(rules(input), [['ERP_UNSETTLED_SALE', 39_990 - 7_198 - 1_990]]);
  });

  it('é idempotente: mesmos dados, mesmas chaves', () => {
    const input = base({ orders: [order({ commissionCents: 8_398 }), order({ orderId: 'P2', billedWeightG: 2_400, shippingChargedCents: 2_990 })] });
    const run = () => audit(input).findings.map((f) => f.fingerprint);
    assert.deepEqual(run(), run());
    assert.equal(new Set(run()).size, 2);
  });
});

describe('dossiê de evidências', () => {
  const item = (id: string, over: Partial<EvidenceItem> = {}): EvidenceItem => ({
    id, storeId: 'L1', storeName: 'Loja ML', marketplace: 'mercadolivre', type: 'ML_FREIGHT_OVERCHARGE', sku: 'FONE', productName: 'Fone bluetooth',
    quantity: 1, recoverableCents: 1_000, occurredAt: '2026-06-10T00:00:00.000Z', deadlineAt: '2026-08-09T00:00:00.000Z', referenceId: id, evidence: [],
    details: {
      marketplace: 'mercadolivre', ids: { orderId: `P-${id}`, shipmentId: 'E1', trackingCode: 'ME1BR', itemId: 'MLB1', ean: '789', nfeKey: '3'.repeat(44) },
      expectedCents: 2_990, actualCents: 1_990, amountLabels: ['Valor cobrado', 'Valor correto'], policy: 'Tabela de frete.', calc: ['Cobrança a maior: R$ 10,00.'], timeline: [],
    },
    ...over,
  });

  it('consolida por loja, tipo e mês, e separa lotes de envio', () => {
    const lot = (id: string, inboundId: string) => item(id, { type: 'ERP_INBOUND_GAP', details: { ...item(id).details!, ids: { inboundId } } });
    const groups = groupForDossiers([
      item('a'), item('b'), item('c', { occurredAt: '2026-05-20T00:00:00.000Z' }),
      item('d', { type: 'ML_COMMISSION_OVERCHARGE' }), lot('e', 'INB-1'), lot('f', 'INB-1'), lot('g', 'INB-2'),
    ]);
    assert.deepEqual(
      groups.map((g) => [g.type, g.bucketLabel, g.items.length]).sort(),
      [
        ['ERP_INBOUND_GAP', 'lote de envio INB-1', 2],
        ['ERP_INBOUND_GAP', 'lote de envio INB-2', 1],
        ['ML_COMMISSION_OVERCHARGE', 'junho de 2026', 1],
        ['ML_FREIGHT_OVERCHARGE', 'junho de 2026', 2],
        ['ML_FREIGHT_OVERCHARGE', 'maio de 2026', 1],
      ],
    );
  });

  it('divide grupos grandes em partes', () => {
    const groups = groupForDossiers(Array.from({ length: 5 }, (_, i) => item(`i${i}`)), 2);
    assert.deepEqual(groups.map((g) => g.items.length).sort(), [1, 2, 2]);
    assert.match(groups[0].bucketLabel, /parte \d de 3/);
  });

  it('gera texto de chamado com identificadores, total e prazo', () => {
    const [group] = groupForDossiers([item('a'), item('b')]);
    const dossier = buildDossier(group, 'Casa Aurora', AS_OF);
    assert.match(dossier.subject, /2 ocorrências, R\$ 20,00/);
    for (const expected of ['equipe Mercado Livre', 'Pedido P-a', 'Rastreio ME1BR', 'SKU FONE', 'Anúncio MLB1', 'EAN 789', `NF-e ${'3'.repeat(44)}`, 'Fundamento: Tabela de frete.', 'vence em 09/08/2026']) {
      assert.ok(dossier.ticketText.includes(expected), `faltou "${expected}"`);
    }
  });

  it('exporta CSV no padrão brasileiro e neutraliza fórmulas', () => {
    const [group] = groupForDossiers([item('a', { productName: '=HYPERLINK("http://x")' })]);
    const csv = dossierCsv(buildDossier(group, 'Casa Aurora', AS_OF));
    assert.ok(csv.startsWith('﻿Tipo;Marketplace;Pedido'));
    assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`));
    assert.ok(csv.includes(';29,9;19,9;10;'));
  });

  it('usa as tabelas de referência declaradas', () => {
    assert.equal(REFERENCE_TABLES.deadlineDays.ML_FREIGHT_OVERCHARGE, 60);
  });
});

describe('tabelas versionadas por vigência', () => {
  it('escolhe a versão válida na data da venda, com limites inclusivos', () => {
    assert.equal(versionAt(T.ml, '2025-12-31T23:00:00.000Z')?.id, 'ml-antiga');
    assert.equal(versionAt(T.ml, '2026-01-01T00:00:00.000Z')?.id, 'ml-teste');
    assert.equal(versionAt(T.ml, '2024-06-01T00:00:00.000Z'), undefined);
  });

  it('audita cada pedido com a regra da sua data', () => {
    // Em 2025 a comissão premium era 15%: os mesmos 18% cobrados são erro lá e acerto em 2026.
    const antigo = order({ orderId: 'P-2025', saleDate: '2025-12-20T00:00:00.000Z' });
    const findings = runBrAudit({ ...base({ orders: [antigo, order()] }), asOf: '2026-01-10T00:00:00.000Z' }, T).findings;
    assert.deepEqual(findings.map((f) => [f.details.ids.orderId, f.rule, f.details.tariff]), [
      ['P-2025', 'ML_COMMISSION_OVERCHARGE', { id: 'ml-antiga', verified: true }],
    ]);
    assert.match(findings[0].details.policy, /tabela ml-antiga, vigente desde 01\/01\/2025/);
  });

  it('não audita tarifa de pedido sem tabela vigente', () => {
    const semTabela = order({ saleDate: '2024-03-01T00:00:00.000Z', commissionCents: 99_999 });
    assert.deepEqual(runBrAudit({ ...base({ orders: [semTabela] }), asOf: '2024-03-20T00:00:00.000Z' }, T).findings, []);
  });

  it('carrega as versões do arquivo de configuração sem sobreposição e marca as não confirmadas', () => {
    assert.ok(REFERENCE_TABLES.ml.length >= 2 && REFERENCE_TABLES.shopee.length >= 3);
    assert.equal(versionAt(REFERENCE_TABLES.shopee, '2026-09-30')?.id, 'shopee-br-2026-03');
    assert.equal(versionAt(REFERENCE_TABLES.shopee, '2026-10-01')?.id, 'shopee-br-2026-10');
    assert.ok([...REFERENCE_TABLES.ml, ...REFERENCE_TABLES.shopee].every((v) => v.verified === false && v.sources.length > 0));
  });
});
