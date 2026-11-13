import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildInvoice,
  canTransition,
  DEFAULT_FEE_SCHEDULE,
  expectedFeeCents,
  nextStatuses,
  runAudit,
  successFeeCents,
  type AuditInput,
  type CatalogItem,
} from '../src/index';

const AS_OF = '2026-06-30T00:00:00.000Z';
const daysAgo = (n: number) => new Date(new Date(AS_OF).getTime() - n * 86_400_000).toISOString();

const item: CatalogItem = {
  sku: 'SKU-1',
  name: 'Garrafa térmica 1 L',
  unitCostCents: 4_000,
  lengthCm: 30,
  widthCm: 10,
  heightCm: 10,
  weightG: 600,
};

const base = (over: Partial<AuditInput> = {}): AuditInput => ({
  asOf: AS_OF,
  catalog: [item],
  openingBalances: { 'SKU-1': 100 },
  reportedBalances: {},
  ledger: [],
  reimbursements: [],
  inboundShipments: [],
  removalOrders: [],
  feeCharges: [],
  customerReturns: [],
  ...over,
});

describe('conciliação de estoque', () => {
  it('reconstrói o saldo esperado a partir do razão', () => {
    const { reconciliation } = runAudit(
      base({
        reportedBalances: { 'SKU-1': 125 },
        ledger: [
          { id: 'e1', sku: 'SKU-1', date: daysAgo(90), type: 'RECEIPT', quantity: 50, disposition: 'SELLABLE' },
          { id: 'e2', sku: 'SKU-1', date: daysAgo(80), type: 'SHIPMENT', quantity: 20, disposition: 'SELLABLE' },
          { id: 'e3', sku: 'SKU-1', date: daysAgo(70), type: 'ADJUSTMENT_LOST', quantity: 5, disposition: 'SELLABLE' },
        ],
      }),
    );
    assert.deepEqual(
      { ...reconciliation[0], productName: undefined },
      {
        sku: 'SKU-1',
        productName: undefined,
        opening: 100,
        inbound: 50,
        outbound: 20,
        adjustments: -5,
        expectedEnding: 125,
        reportedEnding: 125,
        variance: 0,
        varianceValueCents: 0,
      },
    );
  });

  it('abate itens localizados e reembolsados das perdas mais antigas primeiro', () => {
    const { discrepancies } = runAudit(
      base({
        ledger: [
          { id: 'l1', sku: 'SKU-1', date: daysAgo(120), type: 'ADJUSTMENT_LOST', quantity: 4, disposition: 'SELLABLE' },
          { id: 'l2', sku: 'SKU-1', date: daysAgo(60), type: 'ADJUSTMENT_LOST', quantity: 6, disposition: 'SELLABLE' },
          { id: 'f1', sku: 'SKU-1', date: daysAgo(100), type: 'ADJUSTMENT_FOUND', quantity: 3, disposition: 'SELLABLE' },
        ],
        reimbursements: [
          { id: 'r1', type: 'LOST_WAREHOUSE', sku: 'SKU-1', date: daysAgo(50), quantity: 2, amountCents: 8_000 },
        ],
      }),
    );
    // 5 créditos (3 localizados + 2 reembolsados): quitam l1 (4) e 1 un. de l2.
    assert.equal(discrepancies.length, 1);
    assert.equal(discrepancies[0].referenceId, 'l2');
    assert.equal(discrepancies[0].quantity, 5);
    assert.equal(discrepancies[0].estimatedValueCents, 20_000);
  });

  it('respeita o prazo de espera e a janela de contestação', () => {
    const { discrepancies, stats } = runAudit(
      base({
        ledger: [
          { id: 'novo', sku: 'SKU-1', date: daysAgo(10), type: 'ADJUSTMENT_LOST', quantity: 1, disposition: 'SELLABLE' },
          { id: 'velho', sku: 'SKU-1', date: daysAgo(700), type: 'ADJUSTMENT_LOST', quantity: 1, disposition: 'SELLABLE' },
        ],
      }),
    );
    assert.equal(discrepancies.length, 0);
    assert.equal(stats.pendingCount, 1);
    assert.equal(stats.expiredCount, 1);
  });

  it('aponta variação de saldo sem justificativa', () => {
    const { discrepancies } = runAudit(base({ reportedBalances: { 'SKU-1': 93 } }));
    assert.equal(discrepancies.length, 1);
    assert.equal(discrepancies[0].type, 'LOST_WAREHOUSE');
    assert.equal(discrepancies[0].quantity, 7);
    assert.equal(discrepancies[0].estimatedValueCents, 28_000);
  });

  it('não contesta descarte que pertence a uma ordem de remoção', () => {
    const { discrepancies } = runAudit(
      base({
        ledger: [
          { id: 'd1', sku: 'SKU-1', date: daysAgo(60), type: 'DISPOSAL', quantity: 3, disposition: 'SELLABLE', referenceId: 'REM-1' },
          { id: 'd2', sku: 'SKU-1', date: daysAgo(60), type: 'DISPOSAL', quantity: 2, disposition: 'SELLABLE' },
        ],
      }),
    );
    assert.deepEqual(discrepancies.map((d) => [d.type, d.referenceId, d.quantity]), [['DISPOSED_SELLABLE', 'd2', 2]]);
  });
});

describe('logística', () => {
  it('detecta falta em remessa de entrada descontando o que já foi reembolsado', () => {
    const { discrepancies } = runAudit(
      base({
        inboundShipments: [{ id: 'REM-9', closedAt: daysAgo(40), lines: [{ sku: 'SKU-1', shipped: 200, received: 188 }] }],
        reimbursements: [
          { id: 'r', type: 'INBOUND_SHORTAGE', sku: 'SKU-1', date: daysAgo(5), quantity: 4, amountCents: 16_000, referenceId: 'REM-9' },
        ],
      }),
    );
    assert.equal(discrepancies[0].type, 'INBOUND_SHORTAGE');
    assert.equal(discrepancies[0].quantity, 8);
  });

  it('ignora remessa ainda aberta', () => {
    const { discrepancies } = runAudit(
      base({ inboundShipments: [{ id: 'REM-1', closedAt: null, lines: [{ sku: 'SKU-1', shipped: 10, received: 2 }] }] }),
    );
    assert.equal(discrepancies.length, 0);
  });

  it('detecta remoção incompleta, transferência perdida e devolução não recebida', () => {
    const { discrepancies } = runAudit(
      base({
        removalOrders: [{ id: 'RO-1', sku: 'SKU-1', completedAt: daysAgo(45), requested: 30, delivered: 24, disposed: 2 }],
        ledger: [
          { id: 't1', sku: 'SKU-1', date: daysAgo(50), type: 'TRANSFER_OUT', quantity: 40, disposition: 'SELLABLE', referenceId: 'TR-1' },
          { id: 't2', sku: 'SKU-1', date: daysAgo(46), type: 'TRANSFER_IN', quantity: 37, disposition: 'SELLABLE', referenceId: 'TR-1' },
        ],
        customerReturns: [
          { orderId: 'P-1', sku: 'SKU-1', quantity: 1, refundedAt: daysAgo(75), refundCents: 9_990, returnedAt: null },
          { orderId: 'P-2', sku: 'SKU-1', quantity: 1, refundedAt: daysAgo(75), refundCents: 9_990, returnedAt: daysAgo(70) },
        ],
        // O saldo informado acompanha o razão: só interessam as divergências logísticas.
        reportedBalances: { 'SKU-1': 97 },
      }),
    );
    const byType = Object.fromEntries(discrepancies.map((d) => [d.type, d]));
    assert.equal(byType.REMOVAL_NOT_RECEIVED.quantity, 4);
    assert.equal(byType.TRANSFER_LOST.quantity, 3);
    assert.equal(byType.RETURN_NOT_RECEIVED.estimatedValueCents, 9_990);
    assert.equal(discrepancies.length, 3);
  });
});

describe('tarifas', () => {
  it('calcula a tarifa esperada pela faixa de tamanho e peso tarifável', () => {
    // 30×10×10 cm = 3000 cm³ → 500 g cubado; peso real 600 g prevalece. Faixa Médio.
    assert.equal(expectedFeeCents(item, DEFAULT_FEE_SCHEDULE), 1295 + 1 * 60);
  });

  it('agrupa cobranças a maior por SKU e mês e ignora diferenças dentro da tolerância', () => {
    const expected = expectedFeeCents(item);
    const { discrepancies } = runAudit(
      base({
        feeCharges: [
          { id: 'c1', sku: 'SKU-1', date: '2026-06-03T00:00:00.000Z', units: 10, chargedPerUnitCents: expected + 300 },
          { id: 'c2', sku: 'SKU-1', date: '2026-06-17T00:00:00.000Z', units: 5, chargedPerUnitCents: expected + 300 },
          { id: 'c3', sku: 'SKU-1', date: '2026-05-20T00:00:00.000Z', units: 8, chargedPerUnitCents: expected + 3 },
        ],
      }),
    );
    assert.equal(discrepancies.length, 1);
    assert.equal(discrepancies[0].referenceId, '2026-06');
    assert.equal(discrepancies[0].quantity, 15);
    assert.equal(discrepancies[0].estimatedValueCents, 4_500);
  });
});

describe('idempotência', () => {
  it('gera as mesmas chaves ao reexecutar sobre os mesmos dados', () => {
    const input = base({
      reportedBalances: { 'SKU-1': 90 },
      inboundShipments: [{ id: 'REM-2', closedAt: daysAgo(30), lines: [{ sku: 'SKU-1', shipped: 50, received: 45 }] }],
    });
    const first = runAudit(input).discrepancies.map((d) => d.fingerprint);
    const second = runAudit(input).discrepancies.map((d) => d.fingerprint);
    assert.deepEqual(first, second);
    assert.equal(new Set(first).size, first.length);
  });
});

describe('cobrança por sucesso', () => {
  it('arredonda para o centavo mais próximo', () => {
    assert.equal(successFeeCents(10_000, 2_000), 2_000);
    assert.equal(successFeeCents(333, 2_000), 67); // 66,6 → 67
    assert.equal(successFeeCents(0, 2_000), 0);
  });

  it('rejeita valores inválidos', () => {
    assert.throws(() => successFeeCents(-1, 2_000));
    assert.throws(() => successFeeCents(100, 10_001));
    assert.throws(() => successFeeCents(10.5, 2_000));
  });

  it('fecha a fatura como soma das linhas', () => {
    const invoice = buildInvoice(
      [
        { claimId: 'a', recoveredCents: 333 },
        { claimId: 'b', recoveredCents: 333 },
      ],
      2_000,
    );
    assert.equal(invoice.recoveredCents, 666);
    assert.equal(invoice.feeCents, 134);
  });
});

describe('ciclo de vida do chamado', () => {
  it('permite apenas transições válidas', () => {
    assert.ok(canTransition('SUBMITTED', 'UNDER_REVIEW'));
    assert.ok(canTransition('DENIED', 'REOPENED'));
    assert.ok(!canTransition('SUBMITTED', 'PAID'));
    assert.ok(!canTransition('PAID', 'REOPENED'));
    assert.deepEqual(nextStatuses('CLOSED'), []);
  });
});
