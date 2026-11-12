import { useRef, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, errorMessage, useLoad } from '../api';
import { useAuth } from '../auth';
import { CLAIM_STATUS, date, dateTime, DOCUMENT_KIND, fileSize, integer, MARKETPLACE_LABEL, money, TYPE_LABEL } from '../labels';
import { Badge, Empty, Loading, PageHead, TypeTag } from '../ui';

interface ClaimRow {
  id: string; code: string; type: string; status: string; claimedCents: number; approvedCents: number | null;
  marketplaceCaseId: string | null; openedAt: string; updatedAt: string; sku: string; productName: string;
  quantity: number; storeName: string;
}

const FILTERS = ['', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_DOCUMENTS', 'APPROVED', 'PAID', 'DENIED'];

export function ClaimsList() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const { data, error } = useLoad<{ claims: ClaimRow[] }>(`/claims${status ? `?status=${status}` : ''}`);

  return (
    <>
      <PageHead title="Ocorrências" subtitle="Cada divergência contestada, individualmente. As que pertencem a um dossiê acompanham a situação do chamado dele." />
      <div className="card">
        <div className="card-head">
          <div className="chips">
            {FILTERS.map((value) => (
              <button key={value} className={`chip ${status === value ? 'active' : ''}`} onClick={() => setParams(value ? { status: value } : {})}>
                {value ? CLAIM_STATUS[value].label : 'Todos'}
              </button>
            ))}
          </div>
          {data && <span className="muted small">{integer(data.claims.length)} chamados</span>}
        </div>
        {!data ? (
          <Loading error={error} />
        ) : data.claims.length === 0 ? (
          <Empty title="Nenhum chamado neste filtro"><p>Abra chamados a partir das <Link to="/app/divergencias">divergências em aberto</Link>.</p></Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Chamado</th><th>Tipo</th><th>Produto</th><th className="right">Reclamado</th><th className="right">Aprovado</th><th>Situação</th><th>Atualizado</th></tr>
              </thead>
              <tbody>
                {data.claims.map((claim) => (
                  <tr key={claim.id}>
                    <td><Link className="strong" to={`/app/chamados/${claim.id}`}>{claim.code}</Link><div className="muted small">{claim.marketplaceCaseId ?? 'sem nº de caso'}</div></td>
                    <td><TypeTag type={claim.type} /></td>
                    <td><div>{claim.productName}</div><div className="muted small">{claim.sku} · {integer(claim.quantity)} un.</div></td>
                    <td className="right num">{money(claim.claimedCents)}</td>
                    <td className="right num strong">{money(claim.approvedCents)}</td>
                    <td><Badge tone={CLAIM_STATUS[claim.status].tone}>{CLAIM_STATUS[claim.status].label}</Badge></td>
                    <td className="nowrap muted">{date(claim.updatedAt)}</td>
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

interface ClaimDetailData {
  claim: ClaimRow & {
    resolvedAt: string | null; paidAt: string | null; referenceId: string; occurredAt: string; expiresAt: string | null;
    evidence: string[]; marketplace: string; nextStatuses: string[]; caseId: string | null;
  };
  events: { id: string; at: string; actor: string; kind: string; fromStatus: string | null; toStatus: string | null; note: string | null }[];
  documents: { id: string; kind: string; filename: string; sizeBytes: number; uploadedBy: string; createdAt: string }[];
}

const TRANSITION_VERB: Record<string, string> = {
  SUBMITTED: 'Enviar ao marketplace', UNDER_REVIEW: 'Marcar em análise', NEEDS_DOCUMENTS: 'Pedir documentos',
  APPROVED: 'Registrar aprovação', PARTIALLY_APPROVED: 'Registrar aprovação parcial', DENIED: 'Registrar negativa',
  REOPENED: 'Reabrir caso', PAID: 'Confirmar pagamento', CLOSED: 'Encerrar chamado',
};

export function ClaimDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, error, reload } = useLoad<ClaimDetailData>(`/claims/${id}`);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [approved, setApproved] = useState('');
  const [caseId, setCaseId] = useState('');
  const [comment, setComment] = useState('');
  const [docKind, setDocKind] = useState('NOTA_FISCAL');
  const fileInput = useRef<HTMLInputElement>(null);

  if (!data) return <Loading error={error} />;
  const { claim } = data;

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ tone: 'ok', text: success });
      await reload();
    } catch (cause) {
      setMessage({ tone: 'error', text: errorMessage(cause) });
    } finally {
      setBusy(false);
    }
  };

  const transition = (event: FormEvent) => {
    event.preventDefault();
    const approvedCents = approved ? Math.round(Number(approved.replace(/\./g, '').replace(',', '.')) * 100) : undefined;
    if (approved && !Number.isFinite(approvedCents)) return setMessage({ tone: 'error', text: 'Valor aprovado inválido.' });
    void run(async () => {
      await api(`/claims/${claim.id}/transition`, { body: { to: target, note: note || undefined, approvedCents, marketplaceCaseId: caseId || undefined } });
      setTarget(''); setNote(''); setApproved(''); setCaseId('');
    }, 'Chamado atualizado.');
  };

  const upload = (event: FormEvent) => {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) return setMessage({ tone: 'error', text: 'Selecione um arquivo.' });
    if (file.size > 5 * 1024 * 1024) return setMessage({ tone: 'error', text: 'O arquivo excede o limite de 5 MB.' });
    void run(async () => {
      const query = new URLSearchParams({ kind: docKind, filename: file.name });
      await api(`/claims/${claim.id}/documents?${query}`, { method: 'PUT', file });
      if (fileInput.current) fileInput.current.value = '';
    }, 'Documento anexado.');
  };

  return (
    <>
      <PageHead title={`Chamado ${claim.code}`} subtitle={`${TYPE_LABEL[claim.type]} · ${claim.storeName} (${MARKETPLACE_LABEL[claim.marketplace] ?? claim.marketplace})`}>
        <Badge tone={CLAIM_STATUS[claim.status].tone}>{CLAIM_STATUS[claim.status].label}</Badge>
        <Link className="btn ghost sm" to="/app/chamados">Voltar</Link>
      </PageHead>

      {message && <div className={`alert ${message.tone}`} role="status">{message.text}</div>}
      {claim.caseId && (
        <div className="alert info">Esta ocorrência faz parte de um chamado de dossiê: a situação é atualizada por lá. <Link to={`/app/dossies/${claim.caseId}`}>Abrir o chamado</Link></div>
      )}
      {claim.status === 'NEEDS_DOCUMENTS' && (
        <div className="alert warn">O marketplace pediu documentos para este caso. Anexe-os abaixo para a análise continuar.</div>
      )}

      <div className="detail-grid">
        <div className="stack">
          <div className="card card-pad stack">
            <dl className="facts" style={{ margin: 0 }}>
              <div><dt>Valor reclamado</dt><dd className="num">{money(claim.claimedCents)}</dd></div>
              <div><dt>Valor aprovado</dt><dd className="num">{money(claim.approvedCents)}</dd></div>
              <div><dt>Nº do caso</dt><dd>{claim.marketplaceCaseId ?? '—'}</dd></div>
              <div><dt>Produto</dt><dd>{claim.productName}</dd></div>
              <div><dt>SKU · quantidade</dt><dd>{claim.sku} · {integer(claim.quantity)} un.</dd></div>
              <div><dt>Referência</dt><dd>{claim.referenceId}</dd></div>
              <div><dt>Ocorrência</dt><dd>{date(claim.occurredAt)}</dd></div>
              <div><dt>Prazo de contestação</dt><dd>{claim.expiresAt ? date(claim.expiresAt) : 'Sem prazo'}</dd></div>
              <div><dt>Pago em</dt><dd>{date(claim.paidAt)}</dd></div>
            </dl>
            <div>
              <h3 style={{ fontSize: 15 }}>Como o valor foi apurado</h3>
              <ul className="evidence">{claim.evidence.map((line, index) => <li key={index}>{line}</li>)}</ul>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>Documentos</h3><span className="muted small">PDF, PNG, JPG, CSV ou XLSX · até 5 MB</span></div>
            {data.documents.length === 0 ? (
              <Empty title="Nenhum documento anexado" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {data.documents.map((doc) => (
                      <tr key={doc.id}>
                        <td><a className="strong" href={`/api/documents/${doc.id}`}>{doc.filename}</a><div className="muted small">{DOCUMENT_KIND[doc.kind]}</div></td>
                        <td className="muted small">{fileSize(doc.sizeBytes)}</td>
                        <td className="muted small right">{doc.uploadedBy} · {dateTime(doc.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {can('ANALYST') && (
              <form className="card-pad row" style={{ borderTop: '1px solid var(--line)' }} onSubmit={upload}>
                <select className="input" style={{ width: 'auto' }} value={docKind} onChange={(e) => setDocKind(e.target.value)} aria-label="Tipo de documento">
                  {Object.entries(DOCUMENT_KIND).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <input ref={fileInput} className="grow" type="file" accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx" aria-label="Arquivo" />
                <button className="btn sm" disabled={busy}>Anexar</button>
              </form>
            )}
          </div>
        </div>

        <div className="stack">
          {can('ANALYST') && claim.nextStatuses.length > 0 && (
            <form className="card card-pad stack" onSubmit={transition}>
              <h3 style={{ fontSize: 16 }}>Atualizar situação</h3>
              <label className="field"><span>Próximo passo</span>
                <select className="input" required value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="" disabled>Selecione</option>
                  {claim.nextStatuses.map((next) => <option key={next} value={next}>{TRANSITION_VERB[next]}</option>)}
                </select></label>
              {(target === 'APPROVED' || target === 'PARTIALLY_APPROVED') && (
                <label className="field"><span>Valor aprovado (R$)</span>
                  <input className="input num" inputMode="decimal" required={target === 'PARTIALLY_APPROVED'} placeholder={target === 'APPROVED' ? 'Em branco = valor integral' : '0,00'} value={approved} onChange={(e) => setApproved(e.target.value)} /></label>
              )}
              {target === 'UNDER_REVIEW' && !claim.marketplaceCaseId && (
                <label className="field"><span>Nº do caso no marketplace</span>
                  <input className="input" maxLength={60} value={caseId} onChange={(e) => setCaseId(e.target.value)} /></label>
              )}
              <label className="field"><span>Observação</span>
                <textarea className="input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
              <button className="btn" disabled={busy || !target}>Salvar</button>
            </form>
          )}

          <div className="card card-pad stack">
            <h3 style={{ fontSize: 16 }}>Linha do tempo</h3>
            <ol className="timeline">
              {data.events.map((event) => (
                <li key={event.id}>
                  <div className="when">{dateTime(event.at)} · {event.actor}</div>
                  {event.kind === 'STATUS' && event.toStatus && <Badge tone={CLAIM_STATUS[event.toStatus].tone}>{CLAIM_STATUS[event.toStatus].label}</Badge>}
                  {event.kind === 'DOCUMENT' && <Badge>Documento anexado</Badge>}
                  {event.kind === 'COMMENT' && <Badge>Comentário</Badge>}
                  {event.note && <div style={{ marginTop: 4 }}>{event.note}</div>}
                </li>
              ))}
            </ol>
            {can('ANALYST') && (
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await api(`/claims/${claim.id}/comments`, { body: { note: comment } });
                    setComment('');
                  }, 'Comentário registrado.');
                }}
              >
                <textarea className="input" required maxLength={2000} placeholder="Escreva um comentário para a equipe…" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comentário" />
                <button className="btn ghost sm" disabled={busy} style={{ alignSelf: 'flex-start' }}>Comentar</button>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
