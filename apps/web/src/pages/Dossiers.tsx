import { Copy, FileSpreadsheet, FileText, Sheet } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage, useLoad } from '../api';
import { date, integer, MARKETPLACE_LABEL, money } from '../labels';
import { Empty, Kpi, Loading, PageHead, TypeTag } from '../ui';

interface Group {
  key: string;
  storeName: string;
  marketplace: string;
  type: string;
  bucketLabel: string;
  count: number;
  totalCents: number;
  earliestDeadline: string | null;
}

interface DossierDetail {
  subject: string;
  ticketText: string;
}

export function Dossiers() {
  const { data, error } = useLoad<{ groups: Group[] }>('/dossiers');
  const [open, setOpen] = useState<{ key: string; detail: DossierDetail } | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return <Loading error={error} />;

  const total = data.groups.reduce((sum, group) => sum + group.totalCents, 0);
  const occurrences = data.groups.reduce((sum, group) => sum + group.count, 0);
  const url = (key: string, format: string) => `/api/dossiers/${encodeURIComponent(key)}?format=${format}`;

  const show = async (key: string) => {
    if (open?.key === key) return setOpen(null);
    setBusy(key);
    setMessage(null);
    try {
      const { dossier } = await api<{ dossier: DossierDetail }>(`/dossiers/${encodeURIComponent(key)}`);
      setOpen({ key, detail: dossier });
    } catch (cause) {
      setMessage({ tone: 'error', text: errorMessage(cause) });
    } finally {
      setBusy(null);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage({ tone: 'ok', text: 'Texto copiado. Cole na central de ajuda do marketplace e anexe o PDF e a planilha.' });
    } catch {
      setMessage({ tone: 'error', text: 'Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.' });
    }
  };

  return (
    <>
      <PageHead
        title="Dossiês de evidência"
        subtitle="As divergências em aberto, agrupadas por tipo e por lote ou mês: um chamado por assunto, com texto pronto e anexos."
      />
      <div className="kpis">
        <Kpi accent="t-gold" label="Dossiês prontos" value={integer(data.groups.length)} />
        <Kpi accent="t-blue" label="Ocorrências cobertas" value={integer(occurrences)} />
        <Kpi accent="t-green" label="Valor a recuperar" value={money(total)} />
        <Kpi accent="t-purple" label="Chamados evitados" value={integer(Math.max(0, occurrences - data.groups.length))} hint="Em relação a um chamado por ocorrência" />
      </div>
      {message && <div className={`alert ${message.tone}`} role="status">{message.text}</div>}

      <div className="card">
        {data.groups.length === 0 ? (
          <Empty title="Nenhum dossiê a gerar"><p>Não há divergências em aberto. Rode uma auditoria em Lojas.</p></Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Ocorrência</th><th>Loja</th><th>Agrupamento</th><th className="right">Itens</th><th className="right">A recuperar</th><th>Prazo mais próximo</th><th className="right">Exportar</th></tr>
              </thead>
              <tbody>
                {data.groups.map((group) => (
                  <tr key={group.key}>
                    <td><TypeTag type={group.type} /></td>
                    <td><div className="strong">{group.storeName}</div><div className="muted small">{MARKETPLACE_LABEL[group.marketplace] ?? group.marketplace}</div></td>
                    <td>{group.bucketLabel}</td>
                    <td className="right num">{integer(group.count)}</td>
                    <td className="right num strong">{money(group.totalCents)}</td>
                    <td className="nowrap">{date(group.earliestDeadline)}</td>
                    <td className="right">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 6, flexWrap: 'nowrap' }}>
                        <button className="btn sm" disabled={busy !== null} onClick={() => show(group.key)} aria-expanded={open?.key === group.key}>
                          <FileText aria-hidden="true" /> Texto
                        </button>
                        <a className="btn ghost sm" href={url(group.key, 'pdf')} title="Dossiê em PDF">PDF</a>
                        <a className="btn ghost sm" href={url(group.key, 'xlsx')} title="Planilha XLSX"><Sheet aria-hidden="true" /> XLSX</a>
                        <a className="btn ghost sm" href={url(group.key, 'csv')} title="Planilha CSV"><FileSpreadsheet aria-hidden="true" /> CSV</a>
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
            <button className="btn sm" onClick={() => copy(open.detail.ticketText)}><Copy aria-hidden="true" /> Copiar texto</button>
          </div>
          <pre className="ticket">{open.detail.ticketText}</pre>
        </div>
      )}
    </>
  );
}
