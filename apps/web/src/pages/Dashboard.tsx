import { Link } from 'react-router-dom';
import { useLoad } from '../api';
import { useAuth } from '../auth';
import { CLAIM_STATUS, date, dateTime, integer, money, percent, TYPE_CATEGORY, TYPE_LABEL } from '../labels';
import { Badge, Empty, Kpi, Loading, Meter, MonthlyBars, PageHead } from '../ui';

interface DashboardData {
  totals: {
    identifiedCents: number; identifiedCount: number; openCents: number; openCount: number;
    inDisputeCents: number; inDisputeCount: number; awaitingPaymentCents: number; recoveredCents: number;
    feesCents: number; needsDocumentsCount: number; successRate: number | null;
  };
  monthly: { period: string; cents: number }[];
  byType: { type: string; count: number; cents: number }[];
  pipeline: { status: string; count: number; claimedCents: number }[];
  recent: { at: string; kind: string; toStatus: string | null; note: string | null; actor: string; code: string; claimId: string }[];
  stores: { count: number; lastAuditAt: string | null };
}

const PIPELINE_ORDER = ['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_DOCUMENTS', 'REOPENED', 'APPROVED', 'PARTIALLY_APPROVED', 'PAID', 'DENIED', 'CLOSED'];

export function Dashboard() {
  const { me, can } = useAuth();
  const { data, error } = useLoad<DashboardData>('/dashboard');
  if (!data) return <Loading error={error} />;

  if (data.stores.count === 0) {
    return (
      <>
        <PageHead title={`Olá, ${me!.user.firstName}`} subtitle="Sua conta está pronta. Falta só conectar a primeira loja." />
        <div className="card">
          <Empty title="Nenhuma loja conectada">
            <p style={{ maxWidth: 440, margin: '0 auto 18px' }}>
              Assim que uma loja é conectada, a auditoria roda sobre o histórico contestável e as divergências aparecem aqui.
            </p>
            {can('ADMIN') ? <Link className="btn" to="/app/lojas?boas-vindas=1">Conectar loja</Link> : <p>Peça a um administrador para conectar a loja.</p>}
          </Empty>
        </div>
      </>
    );
  }

  const { totals } = data;
  const maxType = Math.max(1, ...data.byType.map((row) => row.cents));
  const pipeline = PIPELINE_ORDER.map((status) => data.pipeline.find((row) => row.status === status)).filter((row) => row !== undefined);
  const maxPipeline = Math.max(1, ...pipeline.map((row) => row.count));

  return (
    <>
      <PageHead
        title="Visão geral"
        subtitle={`Última auditoria em ${date(data.stores.lastAuditAt)} · ${integer(data.stores.count)} ${data.stores.count === 1 ? 'loja conectada' : 'lojas conectadas'}`}
      >
        <Link className="btn ghost" to="/app/divergencias">Ver divergências</Link>
      </PageHead>

      {totals.needsDocumentsCount > 0 && (
        <div className="alert warn">
          {integer(totals.needsDocumentsCount)} {totals.needsDocumentsCount === 1 ? 'chamado aguarda' : 'chamados aguardam'} documentos seus.{' '}
          <Link to="/app/chamados?status=NEEDS_DOCUMENTS">Enviar agora</Link>
        </div>
      )}

      <div className="kpis">
        <Kpi highlight label="Recuperado" value={money(totals.recoveredCents)} hint={`Líquido da taxa: ${money(totals.recoveredCents - totals.feesCents)}`} />
        <Kpi accent="t-green" label="Aguardando pagamento" value={money(totals.awaitingPaymentCents)} hint="Aprovado, ainda não creditado" />
        <Kpi accent="t-blue" label="Em disputa" value={money(totals.inDisputeCents)} hint={`${integer(totals.inDisputeCount)} chamados em andamento`} />
        <Kpi accent="t-purple" label="Divergências em aberto" value={money(totals.openCents)} hint={`${integer(totals.openCount)} ainda sem chamado`} />
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head">
            <h3>Recuperado por mês</h3>
            <span className="muted small">Taxa de êxito dos chamados decididos: <b>{percent(totals.successRate)}</b></span>
          </div>
          <div className="card-pad"><MonthlyBars data={data.monthly} /></div>
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Onde está o dinheiro</h3>
            <span className="muted small">{money(totals.identifiedCents)} identificados</span>
          </div>
          <div className="card-pad meter-list">
            {data.byType.map((row) => (
              <Meter key={row.type} tone={TYPE_CATEGORY[row.type]?.tone} label={<>{TYPE_LABEL[row.type]} <span className="muted">· {integer(row.count)}</span></>} value={money(row.cents)} ratio={row.cents / maxType} />
            ))}
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head"><h3>Movimentações recentes</h3><Link className="small" to="/app/chamados">Todos os chamados</Link></div>
          {data.recent.length === 0 ? (
            <Empty title="Nada por aqui ainda"><p>As atualizações dos chamados aparecem nesta lista.</p></Empty>
          ) : (
            <ul className="feed">
              {data.recent.map((event, index) => (
                <li key={index}>
                  <div>
                    <Link className="strong" to={`/app/chamados/${event.claimId}`}>{event.code}</Link>{' '}
                    {event.toStatus && <Badge tone={CLAIM_STATUS[event.toStatus].tone}>{CLAIM_STATUS[event.toStatus].label}</Badge>}
                    <div className="muted small">{event.note ?? event.actor}</div>
                  </div>
                  <span className="muted small nowrap">{dateTime(event.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <div className="card-head"><h3>Funil de chamados</h3></div>
          <div className="card-pad meter-list">
            {pipeline.length === 0 && <p className="muted">Nenhum chamado aberto ainda.</p>}
            {pipeline.map((row) => (
              <Meter key={row.status} label={CLAIM_STATUS[row.status].label} value={integer(row.count)} ratio={row.count / maxPipeline} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
