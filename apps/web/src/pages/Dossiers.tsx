import { Copy, FileSpreadsheet, FolderPlus, Sheet } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage, useLoad } from '../api';
import { useAuth } from '../auth';
import { CASE_STATUS, CLAIM_STATUS, date, dateTime, integer, MARKETPLACE_LABEL, money } from '../labels';
import { Badge, Empty, Kpi, Loading, PageHead, TypeTag } from '../ui';

type Message = { tone: 'ok' | 'error'; text: string } | null;

interface Group {
  key: string; storeName: string; marketplace: string; type: string; bucketLabel: string;
  count: number; totalCents: number; earliestDeadline: string | null;
}

interface CaseRow {
  id: string; code: string; type: string; bucketLabel: string; status: string; protocol: string | null; openedAt: string | null;
  claimedCents: number; approvedCents: number | null; refundedCents: number | null; storeName: string; marketplace: string; itemCount: number;
}

const caseBadge = (row: { status: string; claimedCents: number; approvedCents: number | null }) => {
  const partial = (row.status === 'DEFERIDO' || row.status === 'PAGO') && row.approvedCents !== null && row.approvedCents < row.claimedCents;
  const status = CASE_STATUS[row.status];
  return <Badge tone={status.tone}>{partial && row.status === 'DEFERIDO' ? 'Deferido parcialmente' : status.label}</Badge>;
};

async function copyText(text: string, setMessage: (message: Message) => void) {
  try {
    await navigator.clipboard.writeText(text);
    setMessage({ tone: 'ok', text: 'Texto copiado. Cole na central de ajuda do marketplace e anexe o PDF e a planilha.' });
  } catch {
    setMessage({ tone: 'error', text: 'Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.' });
  }
}

export function Dossiers() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const groups = useLoad<{ groups: Group[] }>('/dossiers');
  const cases = useLoad<{ cases: CaseRow[] }>('/cases');
  const [open, setOpen] = useState<{ key: string; text: string } | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!groups.data || !cases.data) return <Loading error={groups.error ?? cases.error} />;

  const list = groups.data.groups;
  const total = list.reduce((sum, group) => sum + group.totalCents, 0);
  const occurrences = list.reduce((sum, group) => sum + group.count, 0);
  const inProgress = cases.data.cases.filter((row) => !['PAGO', 'INDEFERIDO'].includes(row.status));
  const url = (key: string, format: string) => `/api/dossiers/${encodeURIComponent(key)}?format=${format}`;

  const act = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setMessage(null);
    try {
      await action();
    } catch (cause) {
      setMessage({ tone: 'error', text: errorMessage(cause) });
    } finally {
      setBusy(null);
    }
  };
  const show = (key: string) =>
    open?.key === key
      ? setOpen(null)
      : act(key, async () => {
          const { dossier } = await api<{ dossier: { ticketText: string } }>(`/dossiers/${encodeURIComponent(key)}`);
          setOpen({ key, text: dossier.ticketText });
        });
  const createCase = (key: string) =>
    act(key, async () => {
      const created = await api<{ id: string }>(`/dossiers/${encodeURIComponent(key)}/case`, { method: 'POST' });
      navigate(`/app/dossies/${created.id}`);
    });

  return (
    <>
      <PageHead
        title="Dossiês e chamados"
        subtitle="As divergências em aberto são agrupadas por tipo e por lote ou mês. Cada grupo vira um único chamado, e a situação do chamado vale para todas as ocorrências dele."
      />
      <div className="kpis">
        <Kpi accent="t-gold" label="Dossiês a abrir" value={integer(list.length)} hint={`${integer(occurrences)} ocorrências`} />
        <Kpi accent="t-green" label="Valor ainda sem chamado" value={money(total)} />
        <Kpi accent="t-blue" label="Chamados em andamento" value={integer(inProgress.length)} hint={money(inProgress.reduce((sum, row) => sum + row.claimedCents, 0))} />
        <Kpi accent="t-purple" label="Reembolsado por dossiês" value={money(cases.data.cases.reduce((sum, row) => sum + (row.refundedCents ?? 0), 0))} />
      </div>
      {message && <div className={`alert ${message.tone}`} role="status">{message.text}</div>}

      <div className="card">
        <div className="card-head"><h3>Chamados de dossiê</h3><span className="muted small">{integer(cases.data.cases.length)} no total</span></div>
        {cases.data.cases.length === 0 ? (
          <Empty title="Nenhum chamado criado"><p>Escolha um dossiê abaixo e clique em “Criar chamado”.</p></Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Chamado</th><th>Ocorrência</th><th>Loja</th><th>Protocolo</th><th className="right">Itens</th><th className="right">Contestado</th><th className="right">Deferido</th><th className="right">Reembolsado</th><th>Situação</th></tr>
              </thead>
              <tbody>
                {cases.data.cases.map((row) => (
                  <tr key={row.id}>
                    <td><Link className="strong nowrap" to={`/app/dossies/${row.id}`}>{row.code}</Link><div className="muted small">{row.bucketLabel}</div></td>
                    <td><TypeTag type={row.type} /></td>
                    <td>{row.storeName}</td>
                    <td>{row.protocol ?? <span className="muted">—</span>}</td>
                    <td className="right num">{integer(row.itemCount)}</td>
                    <td className="right num">{money(row.claimedCents)}</td>
                    <td className="right num">{money(row.approvedCents)}</td>
                    <td className="right num strong">{money(row.refundedCents)}</td>
                    <td>{caseBadge(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h3>Dossiês prontos para abrir</h3><span className="muted small">Texto, PDF e planilha gerados na hora</span></div>
        {list.length === 0 ? (
          <Empty title="Nenhum dossiê a gerar"><p>Não há divergências em aberto. Rode uma auditoria em Lojas.</p></Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Ocorrência</th><th>Loja</th><th>Agrupamento</th><th className="right">Itens</th><th className="right">A recuperar</th><th>Prazo mais próximo</th><th className="right">Ações</th></tr>
              </thead>
              <tbody>
                {list.map((group) => (
                  <tr key={group.key}>
                    <td><TypeTag type={group.type} /></td>
                    <td><div className="strong">{group.storeName}</div><div className="muted small">{MARKETPLACE_LABEL[group.marketplace] ?? group.marketplace}</div></td>
                    <td>{group.bucketLabel}</td>
                    <td className="right num">{integer(group.count)}</td>
                    <td className="right num strong">{money(group.totalCents)}</td>
                    <td className="nowrap">{date(group.earliestDeadline)}</td>
                    <td className="right">
                      <div className="row-actions">
                        {can('ANALYST') && (
                          <button className="btn sm" disabled={busy !== null} onClick={() => createCase(group.key)}>
                            <FolderPlus aria-hidden="true" /> Criar chamado
                          </button>
                        )}
                        <div className="export-links">
                          <button className="link-btn" disabled={busy !== null} onClick={() => show(group.key)} aria-expanded={open?.key === group.key}>Texto</button>
                          <a href={url(group.key, 'pdf')}>PDF</a>
                          <a href={url(group.key, 'xlsx')}>XLSX</a>
                          <a href={url(group.key, 'csv')}>CSV</a>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <div className="card">
          <div className="card-head">
            <h3>Texto pronto para o chamado</h3>
            <button className="btn sm" onClick={() => copyText(open.text, setMessage)}><Copy aria-hidden="true" /> Copiar texto</button>
          </div>
          <pre className="ticket">{open.text}</pre>
        </div>
      )}
    </>
  );
}

interface CaseDetailData {
  case: CaseRow & { nextStatuses: string[]; earliestDeadline: string | null };
  items: { claimId: string; claimCode: string; discrepancyId: string; status: string; claimedCents: number; approvedCents: number | null; sku: string; productName: string; quantity: number; referenceId: string }[];
  events: { id: string; at: string; actor: string; fromStatus: string | null; toStatus: string; note: string | null }[];
  ticket: { subject: string; text: string; warnings: string[]; requiredDocuments: string[] };
}

const CASE_VERB: Record<string, string> = {
  ABERTO: 'Registrar abertura no marketplace',
  EM_ANALISE: 'Marcar em análise',
  DEFERIDO: 'Registrar deferimento',
  INDEFERIDO: 'Registrar indeferimento',
  PAGO: 'Confirmar reembolso recebido',
};

const toCents = (text: string) => Math.round(Number(text.replace(/\./g, '').replace(',', '.')) * 100);
const toInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

export function CaseDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, error, reload } = useLoad<CaseDetailData>(`/cases/${id}`);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState('');
  const [protocol, setProtocol] = useState('');
  const [note, setNote] = useState('');
  const [approved, setApproved] = useState<Record<string, string>>({});
  if (!data) return <Loading error={error} />;
  const row = data.case;
  const deciding = target === 'DEFERIDO';
  const decidedTotal = data.items.reduce((sum, item) => sum + (approved[item.discrepancyId] !== undefined ? toCents(approved[item.discrepancyId]) || 0 : item.claimedCents), 0);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const items = deciding
      ? data.items.filter((item) => approved[item.discrepancyId] !== undefined).map((item) => ({ discrepancyId: item.discrepancyId, approvedCents: toCents(approved[item.discrepancyId]) }))
      : undefined;
    if (items?.some((item) => !Number.isFinite(item.approvedCents) || item.approvedCents < 0)) {
      return setMessage({ tone: 'error', text: 'Há um valor deferido inválido.' });
    }
    setBusy(true);
    setMessage(null);
    try {
      await api(`/cases/${row.id}/transition`, { body: { to: target, protocol: protocol || undefined, note: note || undefined, items } });
      setTarget(''); setNote(''); setApproved({});
      setMessage({ tone: 'ok', text: 'Chamado atualizado. A situação foi aplicada a todas as ocorrências do dossiê.' });
      await reload();
    } catch (cause) {
      setMessage({ tone: 'error', text: errorMessage(cause) });
    } finally {
      setBusy(false);
    }
  };
  const exportUrl = (format: string) => `/api/cases/${row.id}/export?format=${format}`;

  return (
    <>
      <PageHead title={`Chamado ${row.code}`} subtitle={`${row.storeName} (${MARKETPLACE_LABEL[row.marketplace] ?? row.marketplace}) · ${row.bucketLabel}`}>
        <TypeTag type={row.type} />
        {caseBadge(row)}
        <Link className="btn ghost sm" to="/app/dossies">Voltar</Link>
      </PageHead>
      {message && <div className={`alert ${message.tone}`} role="status">{message.text}</div>}
      {data.ticket.warnings.map((warning) => <div className="alert warn" key={warning}>{warning}</div>)}

      <div className="kpis">
        <Kpi accent="t-gold" label="Valor contestado" value={money(row.claimedCents)} hint={`${integer(data.items.length)} ocorrências`} />
        <Kpi accent="t-blue" label="Valor deferido" value={money(row.approvedCents)} />
        <Kpi accent="t-green" label="Efetivamente reembolsado" value={money(row.refundedCents)} />
        <Kpi accent="t-purple" label="Protocolo" value={row.protocol ?? '—'} hint={row.openedAt ? `Aberto em ${date(row.openedAt)}` : `Prazo mais próximo: ${date(row.earliestDeadline)}`} />
      </div>

      <div className="detail-grid">
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h3>Ocorrências do dossiê</h3>
              {deciding && <span className="small">Total a deferir: <b className="num">{money(decidedTotal)}</b></span>}
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Produto</th><th className="right">Qtd.</th><th className="right">Contestado</th><th className="right">{deciding ? 'Deferir (R$)' : 'Deferido'}</th><th>Situação</th></tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.claimId}>
                      <td><div className="strong">{item.productName}</div><div className="muted small">{item.sku} · ref. {item.referenceId}</div></td>
                      <td className="right num">{integer(item.quantity)}</td>
                      <td className="right num">{money(item.claimedCents)}</td>
                      <td className="right num">
                        {deciding ? (
                          <input
                            className="input num"
                            style={{ width: 120, height: 34, textAlign: 'right' }}
                            inputMode="decimal"
                            aria-label={`Valor deferido para ${item.productName}`}
                            value={approved[item.discrepancyId] ?? toInput(item.claimedCents)}
                            onChange={(e) => setApproved({ ...approved, [item.discrepancyId]: e.target.value })}
                          />
                        ) : money(item.approvedCents)}
                      </td>
                      <td><Badge tone={CLAIM_STATUS[item.status].tone}>{CLAIM_STATUS[item.status].label}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Texto e anexos do chamado</h3>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm" onClick={() => copyText(data.ticket.text, setMessage)}><Copy aria-hidden="true" /> Copiar texto</button>
                <a className="btn ghost sm" href={exportUrl('pdf')}>PDF</a>
                <a className="btn ghost sm" href={exportUrl('xlsx')}><Sheet aria-hidden="true" /> XLSX</a>
                <a className="btn ghost sm" href={exportUrl('csv')}><FileSpreadsheet aria-hidden="true" /> CSV</a>
              </div>
            </div>
            <pre className="ticket">{data.ticket.text}</pre>
          </div>
        </div>

        <div className="stack">
          {can('ANALYST') && row.nextStatuses.length > 0 && (
            <form className="card card-pad stack" onSubmit={submit}>
              <h3 style={{ fontSize: 16 }}>Atualizar situação</h3>
              <label className="field"><span>Próximo passo</span>
                <select className="input" required value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="" disabled>Selecione</option>
                  {row.nextStatuses.map((next) => <option key={next} value={next}>{CASE_VERB[next]}</option>)}
                </select></label>
              {target === 'ABERTO' && (
                <label className="field"><span>Protocolo do marketplace</span>
                  <input className="input" required maxLength={60} value={protocol} onChange={(e) => setProtocol(e.target.value)} />
                  <small>Número do caso gerado pela central de ajuda ao enviar o chamado.</small></label>
              )}
              {deciding && <div className="alert info small">Ajuste na tabela ao lado o valor deferido de cada item. Deixe zero para os itens negados.</div>}
              <label className="field"><span>Observação</span>
                <textarea className="input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
              <button className="btn" disabled={busy || !target}>Salvar</button>
            </form>
          )}
          {data.ticket.requiredDocuments.length > 0 && (
            <div className="card card-pad stack">
              <h3 style={{ fontSize: 16 }}>Documentos a anexar</h3>
              <p className="muted small">O que o suporte costuma pedir para este tipo de divergência. Separe antes de abrir o chamado.</p>
              <ul className="evidence" style={{ margin: 0 }}>{data.ticket.requiredDocuments.map((doc) => <li key={doc}>{doc}</li>)}</ul>
            </div>
          )}
          <div className="card card-pad stack">
            <h3 style={{ fontSize: 16 }}>Linha do tempo</h3>
            <ol className="timeline">
              {data.events.map((event) => (
                <li key={event.id}>
                  <div className="when">{dateTime(event.at)} · {event.actor}</div>
                  <Badge tone={CASE_STATUS[event.toStatus].tone}>{CASE_STATUS[event.toStatus].label}</Badge>
                  {event.note && <div style={{ marginTop: 4 }}>{event.note}</div>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </>
  );
}
