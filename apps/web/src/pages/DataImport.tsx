import { useId, useState, type ChangeEvent, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage, useLoad } from '../api';
import { dateTime, integer, MARKETPLACE_LABEL, money } from '../labels';
import { Badge, Kpi, Loading, PageHead } from '../ui';

// ───────────────────────── Contrato da API ─────────────────────────

type ImportKind = 'orders' | 'incidents' | 'returns' | 'receipts';

interface ImportField {
  key: string;
  label: string;
  required: boolean;
  hint: string;
}

interface KindInfo {
  kind: ImportKind;
  label: string;
  description: string;
  fields: ImportField[];
  rowCount: number;
  lastImportedAt: string | null;
  mapping: Record<string, string> | null;
}

interface ImportsData {
  store: { id: string; name: string; marketplace: string; connector: string; lastAuditAt: string | null };
  kinds: KindInfo[];
  erpProductCount: number;
  nfeCount: number;
}

interface PreviewResult {
  headers: string[];
  sample: string[][];
  suggested: Record<string, string | null>;
  totalRows: number;
}

interface ImportResult {
  imported: number;
  updated: number;
  errors: { line: number; reason: string }[];
  audit: { discrepanciesFound: number; newDiscrepancies: number; valueFoundCents: number } | null;
}

interface ErpResult {
  imported: number;
  errors: { line: number; reason: string }[];
}

interface NfeResult {
  imported: number;
  duplicates: number;
  byKind?: Record<string, number>;
  errors: { file: string; reason: string }[];
}

const MAX_ERRORS_SHOWN = 10;

const ellipsis: CSSProperties = { maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

const plural = (count: number, one: string, many: string) => `${integer(count)} ${count === 1 ? one : many}`;

const lastImport = (iso: string | null) => (iso ? `Última importação em ${dateTime(iso)}` : 'Nada importado ainda');

/** Mapeamento inicial: o salvo vence quando a coluna existe no arquivo; senão, o palpite do servidor. */
function initialMapping(fields: ImportField[], preview: PreviewResult, saved: Record<string, string> | null): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of fields) {
    const stored = saved?.[field.key];
    const guess = preview.suggested[field.key];
    if (stored && preview.headers.includes(stored)) result[field.key] = stored;
    else if (guess && preview.headers.includes(guess)) result[field.key] = guess;
    else result[field.key] = '';
  }
  return result;
}

function ErrorList<T>({ errors, render, label }: { errors: T[]; render: (error: T) => string; label: string }) {
  if (errors.length === 0) return null;
  return (
    <div className="alert warn small" role="status">
      <div className="strong" style={{ marginBottom: 6 }}>{label}</div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
        {errors.slice(0, MAX_ERRORS_SHOWN).map((error, index) => (
          <li key={index} style={{ overflowWrap: 'anywhere' }}>{render(error)}</li>
        ))}
      </ul>
      {errors.length > MAX_ERRORS_SHOWN && (
        <div style={{ marginTop: 6 }}>E mais {plural(errors.length - MAX_ERRORS_SHOWN, 'linha', 'linhas')} com problema.</div>
      )}
    </div>
  );
}

// ───────────────────────── Página ─────────────────────────

export function DataImport() {
  const { id = '' } = useParams<{ id: string }>();
  const { data, error, reload } = useLoad<ImportsData>(id ? `/stores/${id}/imports` : null);

  if (!id) return <div className="alert error" role="status">Loja não informada.</div>;
  if (!data) return <Loading error={error} />;

  const orders = data.kinds.find((kind) => kind.kind === 'orders');
  const marketplace = MARKETPLACE_LABEL[data.store.marketplace] ?? data.store.marketplace;

  return (
    <>
      <PageHead
        title="Dados da loja"
        subtitle={`${data.store.name} · ${marketplace}. Envie os relatórios da loja para a auditoria trabalhar com os seus números reais.`}
      >
        <Link className="btn ghost sm" to="/app/lojas">Voltar</Link>
      </PageHead>

      <div className="kpis">
        <Kpi accent="t-gold" label="Registros de vendas importados" value={integer(orders?.rowCount ?? 0)} hint={orders ? lastImport(orders.lastImportedAt) : undefined} />
        <Kpi accent="t-blue" label="Produtos do ERP" value={integer(data.erpProductCount)} />
        <Kpi accent="t-purple" label="NF-e importadas" value={integer(data.nfeCount)} />
        <Kpi accent="t-green" label="Última auditoria" value={data.store.lastAuditAt ? dateTime(data.store.lastAuditAt) : '—'} />
      </div>

      <div className="stack">
        {data.kinds.map((kind) => (
          <KindCard key={kind.kind} storeId={id} info={kind} onImported={reload} />
        ))}
        <ErpCard storeId={id} count={data.erpProductCount} onImported={reload} />
        <NfeCard storeId={id} count={data.nfeCount} onImported={reload} />
      </div>
    </>
  );
}

// ───────────────────────── Relatórios do marketplace ─────────────────────────

type Step = 'pick' | 'map' | 'done';

function KindCard({ storeId, info, onImported }: { storeId: string; info: KindInfo; onImported: () => Promise<void> }) {
  const baseId = useId();
  const [step, setStep] = useState<Step>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const reset = () => {
    setStep('pick');
    setFile(null);
    setPreview(null);
    setMapping({});
    setResult(null);
    setFailure(null);
  };

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (!chosen) return;
    setBusy('preview');
    setFailure(null);
    try {
      const data = await api<PreviewResult>(
        `/stores/${storeId}/imports/${info.kind}/preview?filename=${encodeURIComponent(chosen.name)}`,
        { method: 'POST', file: chosen },
      );
      setFile(chosen);
      setPreview(data);
      setMapping(initialMapping(info.fields, data, info.mapping));
      setStep('map');
    } catch (cause) {
      setFailure(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!file) return;
    const chosen = Object.fromEntries(Object.entries(mapping).filter(([, header]) => header !== ''));
    setBusy('import');
    setFailure(null);
    try {
      const data = await api<ImportResult>(
        `/stores/${storeId}/imports/${info.kind}?filename=${encodeURIComponent(file.name)}&mapping=${encodeURIComponent(JSON.stringify(chosen))}`,
        { method: 'PUT', file },
      );
      setResult(data);
      setStep('done');
      await onImported();
    } catch (cause) {
      setFailure(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const missing = info.fields.filter((field) => field.required && !mapping[field.key]);
  const headingId = `${baseId}-title`;

  return (
    <section className="card" aria-labelledby={headingId}>
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <h3 id={headingId}>{info.label}</h3>
          <div className="muted small">{plural(info.rowCount, 'registro', 'registros')} · {lastImport(info.lastImportedAt)}</div>
        </div>
        {step !== 'pick' && (
          <span className="muted small">Passo {step === 'map' ? 2 : 3} de 3</span>
        )}
      </div>

      <div className="card-pad stack">
        <p className="muted" style={{ margin: 0 }}>{info.description}</p>

        {failure && <div className="alert error" role="status">{failure}</div>}

        {step === 'pick' && (
          <label className="field" style={{ maxWidth: 460 }}>
            <span>Arquivo do relatório (CSV ou XLSX)</span>
            <input
              className="input"
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy !== null}
              onChange={(event) => void choose(event)}
            />
            <small role="status">{busy === 'preview' ? 'Lendo o arquivo…' : 'Na próxima etapa você confere quais colunas correspondem a cada informação.'}</small>
          </label>
        )}

        {step === 'map' && preview && file && (
          <MappingStep
            baseId={baseId}
            file={file}
            fields={info.fields}
            preview={preview}
            mapping={mapping}
            onChange={(key, header) => setMapping((current) => ({ ...current, [key]: header }))}
            missing={missing}
            busy={busy === 'import'}
            onSubmit={() => void submit()}
            onCancel={reset}
          />
        )}

        {step === 'done' && result && (
          <ResultStep result={result} fileName={file?.name ?? ''} onAgain={reset} />
        )}
      </div>
    </section>
  );
}

function MappingStep({
  baseId, file, fields, preview, mapping, onChange, missing, busy, onSubmit, onCancel,
}: {
  baseId: string;
  file: File;
  fields: ImportField[];
  preview: PreviewResult;
  mapping: Record<string, string>;
  onChange: (key: string, header: string) => void;
  missing: ImportField[];
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const firstRow = preview.sample[0] ?? [];
  const exampleFor = (header: string) => {
    if (!header) return null;
    const index = preview.headers.indexOf(header);
    return index >= 0 ? firstRow[index] ?? '' : null;
  };
  const empty = preview.totalRows === 0;
  const canImport = !busy && !empty && missing.length === 0;

  return (
    <div className="stack">
      <div className="row spread">
        <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <div className="strong">{file.name}</div>
          <div className="muted small">{plural(preview.totalRows, 'linha encontrada', 'linhas encontradas')} · {plural(preview.headers.length, 'coluna', 'colunas')}</div>
        </div>
        <button type="button" className="btn ghost sm" disabled={busy} onClick={onCancel}>Trocar arquivo</button>
      </div>

      <h4 style={{ fontSize: 15, margin: 0 }}>Qual coluna do arquivo traz cada informação?</h4>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Informação</th><th>Coluna do arquivo</th><th>Exemplo da 1ª linha</th></tr>
          </thead>
          <tbody>
            {fields.map((field) => {
              const selectId = `${baseId}-${field.key}`;
              const hintId = `${selectId}-hint`;
              const example = exampleFor(mapping[field.key] ?? '');
              const unmappedRequired = field.required && !mapping[field.key];
              return (
                <tr key={field.key}>
                  <td style={{ minWidth: 200, maxWidth: 320 }}>
                    <label htmlFor={selectId} className="strong">{field.label}</label>{' '}
                    {field.required ? <Badge tone="warn">Obrigatório</Badge> : <Badge>Opcional</Badge>}
                    {field.hint && <div id={hintId} className="muted small" style={{ marginTop: 4 }}>{field.hint}</div>}
                  </td>
                  <td style={{ minWidth: 200 }}>
                    <select
                      id={selectId}
                      className="input"
                      style={{ width: '100%', minWidth: 180, borderColor: unmappedRequired ? 'var(--danger)' : undefined }}
                      value={mapping[field.key] ?? ''}
                      disabled={busy}
                      aria-describedby={field.hint ? hintId : undefined}
                      aria-invalid={unmappedRequired || undefined}
                      onChange={(event) => onChange(field.key, event.target.value)}
                    >
                      <option value="">— não importar —</option>
                      {preview.headers.map((header, index) => (
                        <option key={`${index}-${header}`} value={header}>{header || `Coluna ${index + 1} (sem título)`}</option>
                      ))}
                    </select>
                  </td>
                  <td className="small" style={{ minWidth: 140 }}>
                    {example === null ? <span className="muted">—</span>
                      : example === '' ? <span className="muted">(vazio)</span>
                      : <div style={ellipsis} title={example}>{example}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {preview.sample.length > 0 && (
        <details>
          <summary className="small strong" style={{ cursor: 'pointer' }}>
            Ver as primeiras {plural(preview.sample.length, 'linha', 'linhas')} do arquivo
          </summary>
          <div className="table-wrap" style={{ marginTop: 10, border: '1px solid var(--line)', borderRadius: 'var(--radius-md)' }}>
            <table className="table small">
              <thead>
                <tr>{preview.headers.map((header, index) => <th key={`${index}-${header}`}>{header || `Coluna ${index + 1}`}</th>)}</tr>
              </thead>
              <tbody>
                {preview.sample.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {preview.headers.map((_, cellIndex) => (
                      <td key={cellIndex}><div style={{ ...ellipsis, maxWidth: 180 }} title={row[cellIndex] ?? ''}>{row[cellIndex] ?? ''}</div></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {empty && <div className="alert warn" role="status">O arquivo não tem linhas de dados. Confira se exportou o relatório certo.</div>}
      {!empty && missing.length > 0 && (
        <div className="alert warn" role="status">
          Escolha a coluna para: {missing.map((field) => field.label).join(', ')}.
        </div>
      )}

      <div className="row">
        <button type="button" className="btn" disabled={!canImport} onClick={onSubmit}>
          {busy ? 'Importando e refazendo a auditoria…' : `Importar ${plural(preview.totalRows, 'linha', 'linhas')}`}
        </button>
        {busy && <span className="muted small" role="status">Isso pode levar alguns segundos.</span>}
      </div>
    </div>
  );
}

function ResultStep({ result, fileName, onAgain }: { result: ImportResult; fileName: string; onAgain: () => void }) {
  const nothing = result.imported === 0 && result.updated === 0;
  return (
    <div className="stack">
      <div className={`alert ${nothing ? 'error' : 'ok'}`} role="status">
        {nothing
          ? `Nenhuma linha de ${fileName} foi importada.`
          : `${fileName}: ${plural(result.imported, 'linha nova importada', 'linhas novas importadas')}, ${plural(result.updated, 'atualizada', 'atualizadas')}.`}
        {result.errors.length > 0 && ` ${plural(result.errors.length, 'linha ficou de fora', 'linhas ficaram de fora')}.`}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <Stat label="Importadas" value={integer(result.imported)} />
        <Stat label="Atualizadas" value={integer(result.updated)} />
        <Stat label="Com erro" value={integer(result.errors.length)} />
      </div>

      <ErrorList
        errors={result.errors}
        label="Linhas não importadas"
        render={(error) => `Linha ${integer(error.line)}: ${error.reason}`}
      />

      {result.audit && (
        <div className="alert info" role="status">
          <span className="strong">Auditoria refeita: </span>
          {plural(result.audit.discrepanciesFound, 'divergência encontrada', 'divergências encontradas')}
          {result.audit.newDiscrepancies > 0 && `, ${plural(result.audit.newDiscrepancies, 'nova', 'novas')}`}
          {`, somando ${money(result.audit.valueFoundCents)}. `}
          <Link to="/app/divergencias">Ver divergências</Link>
        </div>
      )}

      <div className="row">
        <button type="button" className="btn ghost sm" onClick={onAgain}>Importar outro arquivo</button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', background: 'var(--cream-tint)', padding: '12px 14px' }}>
      <div className="muted small">{label}</div>
      <div className="num strong" style={{ fontSize: 22, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

// ───────────────────────── ERP e NF-e ─────────────────────────

function SimpleCard({ title, meta, description, children }: { title: string; meta: string; description: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section className="card" aria-labelledby={headingId}>
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <h3 id={headingId}>{title}</h3>
          <div className="muted small">{meta}</div>
        </div>
      </div>
      <div className="card-pad stack">
        <p className="muted" style={{ margin: 0 }}>{description}</p>
        {children}
      </div>
    </section>
  );
}

function ErpCard({ storeId, count, onImported }: { storeId: string; count: number; onImported: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<(ErpResult & { fileName: string }) | null>(null);

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setFailure(null);
    setResult(null);
    try {
      const data = await api<ErpResult>(`/stores/${storeId}/erp-products`, { method: 'PUT', file, contentType: 'text/csv' });
      setResult({ ...data, fileName: file.name });
      await onImported();
    } catch (cause) {
      setFailure(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SimpleCard
      title="Cadastro de produtos do ERP"
      meta={plural(count, 'produto cadastrado', 'produtos cadastrados')}
      description="Planilha CSV exportada do seu ERP (Bling, Tiny, Omie ou outro) com SKU, peso e medidas de cada produto. Serve para conferir o frete cobrado pelo peso e tamanho reais."
    >
      {failure && <div className="alert error" role="status">{failure}</div>}
      {result && (
        <>
          <div className={`alert ${result.imported > 0 ? 'ok' : 'error'}`} role="status">
            {result.fileName}: {plural(result.imported, 'produto importado', 'produtos importados')}
            {result.errors.length > 0 && `, ${plural(result.errors.length, 'linha ignorada', 'linhas ignoradas')}`}.
          </div>
          <ErrorList errors={result.errors} label="Linhas ignoradas" render={(error) => `Linha ${integer(error.line)}: ${error.reason}`} />
        </>
      )}
      <label className="field" style={{ maxWidth: 460 }}>
        <span>Planilha do ERP (CSV)</span>
        <input className="input" type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => void choose(event)} />
        <small role="status">{busy ? 'Importando e refazendo a auditoria…' : 'Enviar de novo atualiza os produtos que já existem.'}</small>
      </label>
    </SimpleCard>
  );
}

function NfeCard({ storeId, count, onImported }: { storeId: string; count: number; onImported: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<NfeResult | null>(null);

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (files.length === 0) return;
    setBusy(true);
    setFailure(null);
    setResult(null);
    try {
      const payload = await Promise.all(files.map(async (file) => ({ name: file.name, xml: await file.text() })));
      const data = await api<NfeResult>(`/stores/${storeId}/nfe`, { method: 'PUT', body: { files: payload } });
      setResult(data);
      await onImported();
    } catch (cause) {
      setFailure(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const kinds = result?.byKind ? Object.entries(result.byKind).filter(([, total]) => total > 0) : [];

  return (
    <SimpleCard
      title="Notas fiscais (XML de NF-e)"
      meta={plural(count, 'nota importada', 'notas importadas')}
      description="Arquivos XML das NF-e modelo 55: entrada, remessa para o centro de distribuição, retorno, venda e devolução. Comprovam o que entrou e saiu do estoque."
    >
      {failure && <div className="alert error" role="status">{failure}</div>}
      {result && (
        <>
          <div className={`alert ${result.imported > 0 ? 'ok' : 'warn'}`} role="status">
            {result.imported > 0
              ? `${plural(result.imported, 'nota importada', 'notas importadas')}`
              : 'Nenhuma nota nova'}
            {result.duplicates > 0 && `, ${plural(result.duplicates, 'já estava importada', 'já estavam importadas')}`}
            {result.errors.length > 0 && `, ${plural(result.errors.length, 'recusada', 'recusadas')}`}.
            {kinds.length > 0 && (
              <div className="small" style={{ marginTop: 4 }}>
                Por tipo: {kinds.map(([kind, total]) => `${kind}: ${integer(total)}`).join(' · ')}
              </div>
            )}
          </div>
          <ErrorList errors={result.errors} label="Arquivos recusados" render={(error) => `${error.file}: ${error.reason}`} />
        </>
      )}
      <label className="field" style={{ maxWidth: 460 }}>
        <span>Arquivos XML (pode escolher vários)</span>
        <input className="input" type="file" accept=".xml,text/xml,application/xml" multiple disabled={busy} onChange={(event) => void choose(event)} />
        <small role="status">{busy ? 'Lendo as notas e refazendo a auditoria…' : 'Notas já importadas são reconhecidas e não se repetem.'}</small>
      </label>
    </SimpleCard>
  );
}
