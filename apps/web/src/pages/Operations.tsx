import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage, useLoad } from '../api';
import { useAuth } from '../auth';
import { date, DISCREPANCY_STATUS, integer, money, TYPE_LABEL } from '../labels';
import { Badge, Empty, Kpi, Loading, PageHead, TypeTag } from '../ui';

interface ReconRow {
  sku: string; productName: string; storeName: string; opening: number; inbound: number; outbound: number;
  adjustments: number; expectedEnding: number; reportedEnding: number; variance: number; varianceValueCents: number;
}

export function Reconciliation() {
  const { data, error } = useLoad<{ rows: ReconRow[] }>('/reconciliation');
  const [onlyVariance, setOnlyVariance] = useState(false);
  if (!data) return <Loading error={error} />;

  const withVariance = data.rows.filter((row) => row.variance !== 0);
  const rows = onlyVariance ? withVariance : data.rows;
  const missingUnits = withVariance.reduce((sum, row) => sum + Math.min(0, row.variance), 0);
  const missingValue = withVariance.reduce((sum, row) => sum + Math.min(0, row.varianceValueCents), 0);

  return (
    <>
      <PageHead
        title="Conciliação de estoque"
        subtitle="Saldo esperado = inicial + entradas − saídas − ajustes. Comparamos com o saldo informado pelo marketplace, SKU a SKU."
      />
      <div className="kpis">
        <Kpi accent="t-blue" label="SKUs conciliados" value={integer(data.rows.length)} />
        <Kpi accent="t-purple" label="SKUs com variação" value={integer(withVariance.length)} />
        <Kpi accent="t-gold" label="Unidades sem explicação" value={integer(-missingUnits)} />
        <Kpi accent="t-green" label="Valor da variação" value={money(-missingValue)} hint="Pelo custo unitário" />
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Razão por SKU</h3>
          <div className="chips">
            <button className={`chip ${!onlyVariance ? 'active' : ''}`} onClick={() => setOnlyVariance(false)}>Todos</button>
            <button className={`chip ${onlyVariance ? 'active' : ''}`} onClick={() => setOnlyVariance(true)}>Só com variação</button>
          </div>
        </div>
        {rows.length === 0 ? (
          <Empty title={data.rows.length === 0 ? 'Sem dados de estoque' : 'Nenhuma variação'}>
            <p>{data.rows.length === 0 ? 'Conecte uma loja para iniciar a conciliação.' : 'Todos os saldos batem com o razão.'}</p>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>SKU</th><th className="right">Inicial</th><th className="right">Entradas</th><th className="right">Saídas</th>
                  <th className="right">Ajustes</th><th className="right">Esperado</th><th className="right">Informado</th>
                  <th className="right">Variação</th><th className="right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.storeName}-${row.sku}`}>
                    <td><div className="strong">{row.sku}</div><div className="muted small">{row.productName}</div></td>
                    <td className="right num">{integer(row.opening)}</td>
                    <td className="right num">{integer(row.inbound)}</td>
                    <td className="right num">{integer(row.outbound)}</td>
                    <td className="right num">{integer(row.adjustments)}</td>
                    <td className="right num">{integer(row.expectedEnding)}</td>
                    <td className="right num">{integer(row.reportedEnding)}</td>
                    <td className={`right num ${row.variance < 0 ? 'neg' : row.variance > 0 ? 'pos' : ''}`}>{row.variance === 0 ? '—' : integer(row.variance)}</td>
                    <td className={`right num ${row.variance < 0 ? 'neg' : ''}`}>{row.variance === 0 ? '—' : money(row.varianceValueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

interface DiscrepancyRow {
  id: string; type: string; sku: string; productName: string; quantity: number; estimatedValueCents: number;
  referenceId: string; evidence: string[]; occurredAt: string; expiresAt: string | null; status: string;
  storeName: string; claimId: string | null; claimCode: string | null;
}

const STATUS_FILTERS = [['', 'Todas'], ['OPEN', 'Em aberto'], ['CLAIMED', 'Em disputa'], ['RESOLVED', 'Resolvidas'], ['DISMISSED', 'Descartadas']];

export function Discrepancies() {
  const { can } = useAuth();
  const [status, setStatus] = useState('OPEN');
  const [type, setType] = useState('');
  const query = new URLSearchParams({ ...(status && { status }), ...(type && { type }) }).toString();
  const { data, error, reload } = useLoad<{ discrepancies: DiscrepancyRow[] }>(`/discrepancies${query ? `?${query}` : ''}`);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const act = async (key: string, path: string, success: (result: { code?: string; opened?: number }) => string) => {
    setBusy(key);
    setMessage(null);
    try {
      const result = await api<{ code?: string; opened?: number }>(path, { method: 'POST' });
      setMessage({ tone: 'ok', text: success(result) });
      await reload();
    } catch (cause) {
      setMessage({ tone: 'error', text: errorMessage(cause) });
    } finally {
      setBusy(null);
    }
  };

  const rows = data?.discrepancies ?? [];
  const total = rows.reduce((sum, row) => sum + row.estimatedValueCents, 0);
  const openCount = rows.filter((row) => row.status === 'OPEN').length;

  return (
    <>
      <PageHead title="Divergências" subtitle="Tudo o que a auditoria encontrou, com a memória de cálculo de cada valor.">
        {can('ANALYST') && openCount > 1 && (
          <button
            className="btn"
            disabled={busy !== null}
            onClick={() => act('all', '/discrepancies/claim-all', (r) => `${r.opened} chamados abertos.`)}
          >
            {busy === 'all' ? 'Abrindo…' : 'Abrir chamados para todas'}
          </button>
        )}
      </PageHead>

      {message && <div className={`alert ${message.tone}`} role="status">{message.text}</div>}

      <div className="card">
        <div className="card-head">
          <div className="chips">
            {STATUS_FILTERS.map(([value, label]) => (
              <button key={value} className={`chip ${status === value ? 'active' : ''}`} onClick={() => setStatus(value)}>{label}</button>
            ))}
          </div>
          <div className="row">
            <span className="muted small">{integer(rows.length)} itens · {money(total)}</span>
            <select className="input" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Filtrar por tipo">
              <option value="">Todos os tipos</option>
              {Object.entries(TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </div>
        {!data ? (
          <Loading error={error} />
        ) : rows.length === 0 ? (
          <Empty title="Nenhuma divergência neste filtro"><p>Mude o filtro ou rode uma nova auditoria em Lojas.</p></Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Divergência</th><th className="right">Qtd.</th><th className="right">Valor estimado</th><th>Ocorrência</th><th>Prazo</th><th>Situação</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <tr>
                      <td>
                        <TypeTag type={row.type} />
                        <div className="strong" style={{ marginTop: 6 }}>{row.productName}</div>
                        <div className="muted small">{row.sku} · ref. {row.referenceId}</div>
                        <button className="link-btn small" onClick={() => setExpanded(expanded === row.id ? null : row.id)} aria-expanded={expanded === row.id}>
                          {expanded === row.id ? 'Ocultar evidências' : 'Ver evidências'}
                        </button>
                      </td>
                      <td className="right num">{integer(row.quantity)}</td>
                      <td className="right num strong">{money(row.estimatedValueCents)}</td>
                      <td className="nowrap">{date(row.occurredAt)}</td>
                      <td className="nowrap">{row.expiresAt ? date(row.expiresAt) : '—'}</td>
                      <td>
                        <Badge tone={DISCREPANCY_STATUS[row.status].tone}>{DISCREPANCY_STATUS[row.status].label}</Badge>
                        {row.claimId && <div className="small" style={{ marginTop: 4 }}><Link to={`/app/chamados/${row.claimId}`}>{row.claimCode}</Link></div>}
                      </td>
                      <td className="right">
                        {row.status === 'OPEN' && can('ANALYST') && (
                          <div className="actions">
                            <button className="btn sm" disabled={busy !== null} onClick={() => act(row.id, `/discrepancies/${row.id}/claim`, (r) => `Chamado ${r.code} aberto.`)}>
                              Abrir chamado
                            </button>
                            <button className="btn danger sm" disabled={busy !== null} onClick={() => act(row.id, `/discrepancies/${row.id}/dismiss`, () => 'Divergência descartada.')}>
                              Descartar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {expanded === row.id && (
                      <tr>
                        <td colSpan={7} style={{ paddingTop: 0 }}>
                          <ul className="evidence">{row.evidence.map((line, index) => <li key={index}>{line}</li>)}</ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
