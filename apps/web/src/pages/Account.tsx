import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage, useLoad } from '../api';
import { useAuth } from '../auth';
import { activityLabel, date, dateTime, integer, MARKETPLACE_LABEL, money, monthLabel, ROLE_LABEL } from '../labels';
import { Badge, Empty, Kpi, Loading, PageHead, TypeTag } from '../ui';

type Message = { tone: 'ok' | 'error'; text: string } | null;

function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ tone: 'ok', text: success });
    } catch (cause) {
      setMessage({ tone: 'error', text: errorMessage(cause) });
    } finally {
      setBusy(false);
    }
  };
  return { busy, message, run, setMessage };
}

const Note = ({ message }: { message: Message }) =>
  message ? <div className={`alert ${message.tone}`} role="status">{message.text}</div> : null;

// ───────────────────────── Lojas ─────────────────────────

interface StoresData {
  stores: { id: string; name: string; marketplace: string; region: string; connector: string; status: string; lastAuditAt: string | null; discrepancyCount: number; nfeCount: number; erpProductCount: number }[];
  runs: { id: string; storeName: string; finishedAt: string; eventsScanned: number; discrepanciesFound: number; newDiscrepancies: number; valueFoundCents: number; pendingCount: number; expiredCount: number }[];
}

interface Meta {
  demoMode: boolean;
  oauth: Record<string, boolean>;
}

/** Marketplaces com auditoria e entrada de dados reais; os demais aparecem como "em breve". */
const LIVE_MARKETPLACES = ['mercadolivre', 'shopee'];

function storeSource(store: StoresData['stores'][number]) {
  if (store.connector.includes('demo')) return <Badge tone="warn">Dados sintéticos de teste</Badge>;
  if (store.status === 'AGUARDANDO_DADOS') return <Badge tone="warn">Aguardando dados</Badge>;
  if (store.connector.endsWith('-import')) return <Badge tone="info">Dados por arquivo</Badge>;
  return <Badge tone="success">Conta conectada por API</Badge>;
}

export function Stores() {
  const { can, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data, error, reload } = useLoad<StoresData>('/stores');
  const meta = useLoad<Meta>('/meta');
  const { busy, message, run } = useAction();
  const [form, setForm] = useState({ name: '', marketplace: 'mercadolivre', region: 'BR' });
  if (!data || !meta.data) return <Loading error={error ?? meta.error} />;
  const { demoMode, oauth } = meta.data;

  const create = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const created = await api<{ id: string }>('/stores', { body: form });
      await Promise.all([reload(), refresh()]);
      // A loja nasce vazia: o próximo passo é alimentá-la com os dados reais.
      if (!demoMode) navigate(`/app/lojas/${created.id}/dados`);
    }, 'Loja criada.');
  };

  return (
    <>
      <PageHead title="Lojas" subtitle="Cada loja é auditada com os dados reais dela: relatórios importados, planilha do ERP, XML de NF-e ou conta conectada por API." />
      {params.get('conectada') && <div className="alert ok">Conta autorizada. A próxima auditoria já usa os dados da API do marketplace.</div>}
      {params.get('boas-vindas') && data.stores.length === 0 && (
        <div className="alert ok">Conta criada. Agora cadastre sua primeira loja para começar a auditoria.</div>
      )}
      <Note message={message} />

      <div className="stack">
        <div className="card">
          <div className="card-head"><h3>Suas lojas</h3></div>
          {data.stores.length === 0 ? (
            <Empty title="Nenhuma loja cadastrada"><p>Use o formulário abaixo para cadastrar a primeira.</p></Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Loja</th><th>Marketplace</th><th>Dados</th><th>Última auditoria</th><th className="right">Divergências</th><th /></tr></thead>
                <tbody>
                  {data.stores.map((store) => {
                    const live = LIVE_MARKETPLACES.includes(store.marketplace);
                    const connected = store.connector === store.marketplace;
                    return (
                      <tr key={store.id}>
                        <td style={{ minWidth: 200 }}><div className="strong">{store.name}</div>{storeSource(store)}</td>
                        <td>{MARKETPLACE_LABEL[store.marketplace]} · {store.region}</td>
                        <td className="muted small nowrap">{integer(store.erpProductCount)} produtos · {integer(store.nfeCount)} NF-e</td>
                        <td className="nowrap">{store.lastAuditAt ? dateTime(store.lastAuditAt) : '—'}</td>
                        <td className="right num">{integer(store.discrepancyCount)}</td>
                        <td className="right">
                          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                            {live && <Link className="btn sm" to={`/app/lojas/${store.id}/dados`}>Dados da loja</Link>}
                            {live && can('ADMIN') && oauth[store.marketplace] && (
                              <button
                                className="btn ghost sm"
                                disabled={busy}
                                title="Autoriza a Grandir a ler os dados desta conta pela API do marketplace"
                                onClick={() => run(async () => {
                                  const { url } = await api<{ url: string }>(`/stores/${store.id}/oauth/start`, { method: 'POST' });
                                  window.location.assign(url);
                                }, 'Redirecionando para o marketplace…')}
                              >
                                {connected ? 'Reconectar conta' : 'Conectar conta'}
                              </button>
                            )}
                            {can('ANALYST') && store.status !== 'AGUARDANDO_DADOS' && (
                              <button
                                className="btn ghost sm"
                                disabled={busy}
                                onClick={() => run(async () => { await api(`/stores/${store.id}/audit`, { method: 'POST' }); await reload(); }, 'Auditoria concluída.')}
                              >
                                Auditar agora
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {can('ADMIN') && (
          <form className="card card-pad stack" onSubmit={create}>
            <h3 style={{ fontSize: 16 }}>Cadastrar loja</h3>
            <p className="muted">
              A loja começa vazia. Depois de cadastrar, envie os relatórios dela em “Dados da loja”
              {oauth.mercadolivre || oauth.shopee ? ' ou conecte a conta pela API do marketplace.' : '. A conexão direta por API será habilitada quando as credenciais do aplicativo forem configuradas.'}
            </p>
            <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
              <label className="field"><span>Nome da loja</span>
                <input className="input" required minLength={2} maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label className="field"><span>Marketplace</span>
                <select className="input" value={form.marketplace} onChange={(e) => setForm({ ...form, marketplace: e.target.value })}>
                  {Object.entries(MARKETPLACE_LABEL).map(([value, label]) => {
                    const available = demoMode || LIVE_MARKETPLACES.includes(value);
                    return <option key={value} value={value} disabled={!available}>{label}{available ? '' : ' (em breve)'}</option>;
                  })}
                </select></label>
              <label className="field"><span>País de operação</span>
                <select className="input" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>
                  <option value="BR">Brasil</option>
                </select></label>
            </div>
            <button className="btn" disabled={busy} style={{ alignSelf: 'flex-start' }}>{busy ? 'Cadastrando…' : 'Cadastrar loja'}</button>
          </form>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h3>Histórico de auditorias</h3></div>
        {data.runs.length === 0 ? (
          <Empty title="Nenhuma auditoria executada"><p>A auditoria roda sozinha a cada importação de dados.</p></Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Quando</th><th>Loja</th><th className="right">Registros lidos</th><th className="right">Divergências</th><th className="right">Novas</th><th className="right">Valor apurado</th></tr></thead>
              <tbody>
                {data.runs.map((run) => (
                  <tr key={run.id}>
                    <td className="nowrap">{dateTime(run.finishedAt)}</td><td>{run.storeName}</td>
                    <td className="right num">{integer(run.eventsScanned)}</td><td className="right num">{integer(run.discrepanciesFound)}</td>
                    <td className="right num">{integer(run.newDiscrepancies)}</td><td className="right num strong">{money(run.valueFoundCents)}</td>
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

// ───────────────────────── Faturamento ─────────────────────────

interface BillingData {
  feeRateBps: number;
  invoices: { id: string; period: string; feeRateBps: number; recoveredCents: number; feeCents: number; lineCount: number; status: string }[];
  lines: { id: string; period: string; code: string; claimId: string; type: string; recoveredCents: number; feeCents: number; createdAt: string }[];
}

export function Billing() {
  const { data, error } = useLoad<BillingData>('/billing');
  if (!data) return <Loading error={error} />;
  const recovered = data.invoices.reduce((sum, invoice) => sum + invoice.recoveredCents, 0);
  const fees = data.invoices.reduce((sum, invoice) => sum + invoice.feeCents, 0);
  const rate = `${(data.feeRateBps / 100).toLocaleString('pt-BR')}%`;

  return (
    <>
      <PageHead title="Faturamento" subtitle="A taxa de sucesso incide apenas sobre reembolsos efetivamente pagos pelo marketplace." />
      <div className="kpis">
        <Kpi accent="t-gold" label="Taxa de sucesso contratada" value={rate} hint="Sem mensalidade nem adesão" />
        <Kpi accent="t-green" label="Total recuperado" value={money(recovered)} />
        <Kpi accent="t-blue" label="Taxas da Grandir" value={money(fees)} />
        <Kpi highlight label="Líquido para você" value={money(recovered - fees)} />
      </div>
      <div className="card">
        <div className="card-head"><h3>Faturas mensais</h3></div>
        {data.invoices.length === 0 ? (
          <Empty title="Nenhuma fatura ainda"><p>A primeira fatura é gerada quando o primeiro reembolso for pago.</p></Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Período</th><th className="right">Chamados pagos</th><th className="right">Recuperado</th><th className="right">Taxa</th><th className="right">Valor da fatura</th><th>Situação</th></tr></thead>
              <tbody>
                {data.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="strong">{monthLabel(invoice.period)}</td>
                    <td className="right num">{integer(invoice.lineCount)}</td>
                    <td className="right num">{money(invoice.recoveredCents)}</td>
                    <td className="right num">{(invoice.feeRateBps / 100).toLocaleString('pt-BR')}%</td>
                    <td className="right num strong">{money(invoice.feeCents)}</td>
                    <td><Badge tone={invoice.status === 'FECHADA' ? 'neutral' : 'info'}>{invoice.status === 'FECHADA' ? 'Fechada' : 'Em aberto'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {data.lines.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Detalhamento por chamado</h3><span className="muted small">Cada cobrança aponta para o reembolso que a originou</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Pago em</th><th>Chamado</th><th>Tipo</th><th className="right">Reembolso</th><th className="right">Taxa</th></tr></thead>
              <tbody>
                {data.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="nowrap">{date(line.createdAt)}</td>
                    <td><Link className="strong" to={`/app/chamados/${line.claimId}`}>{line.code}</Link></td>
                    <td><TypeTag type={line.type} /></td>
                    <td className="right num">{money(line.recoveredCents)}</td>
                    <td className="right num">{money(line.feeCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ───────────────────────── Equipe ─────────────────────────

interface TeamData {
  members: { id: string; email: string; firstName: string; lastName: string; role: string; active: boolean; mfaEnabled: boolean }[];
}

export function Team() {
  const { me } = useAuth();
  const { data, error, reload } = useLoad<TeamData>('/team');
  const { busy, message, run } = useAction();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', role: 'ANALYST' });
  if (!data) return <Loading error={error} />;

  const patch = (id: string, body: object, success: string) =>
    run(async () => { await api(`/team/${id}`, { method: 'PATCH', body }); await reload(); }, success);

  return (
    <>
      <PageHead title="Equipe" subtitle="Convide pessoas e defina o que cada uma pode ver e fazer." />
      <Note message={message} />
      <div className="two-col">
        <div className="card">
          <div className="card-head"><h3>Membros</h3></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Pessoa</th><th>Papel</th><th>2 etapas</th><th>Acesso</th><th /></tr></thead>
              <tbody>
                {data.members.map((member) => {
                  const locked = member.role === 'OWNER' || member.id === me!.user.id;
                  return (
                    <tr key={member.id}>
                      <td><div className="strong">{member.firstName} {member.lastName}</div><div className="muted small">{member.email}</div></td>
                      <td>
                        {locked ? ROLE_LABEL[member.role] : (
                          <select className="input" style={{ width: 'auto', padding: '6px 10px' }} value={member.role} disabled={busy}
                            onChange={(e) => patch(member.id, { role: e.target.value }, 'Papel atualizado.')} aria-label={`Papel de ${member.firstName}`}>
                            <option value="ADMIN">Administrador</option><option value="ANALYST">Analista</option><option value="VIEWER">Leitor</option>
                          </select>
                        )}
                      </td>
                      <td>{member.mfaEnabled ? <Badge tone="success">Ativa</Badge> : <Badge>Inativa</Badge>}</td>
                      <td>{member.active ? <Badge tone="success">Ativo</Badge> : <Badge tone="danger">Desativado</Badge>}</td>
                      <td className="right">
                        {!locked && (
                          <button className={`btn sm ${member.active ? 'danger' : 'ghost'}`} disabled={busy}
                            onClick={() => patch(member.id, { active: !member.active }, member.active ? 'Acesso desativado.' : 'Acesso reativado.')}>
                            {member.active ? 'Desativar' : 'Reativar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <form
          className="card card-pad stack"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await api('/team', { body: form });
              setForm({ firstName: '', lastName: '', email: '', role: 'ANALYST' });
              await reload();
            }, 'Convite enviado. O link para criar a senha vale por 72 horas.');
          }}
        >
          <h3 style={{ fontSize: 16 }}>Convidar pessoa</h3>
          <div className="form-grid">
            <label className="field"><span>Nome</span><input className="input" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></label>
            <label className="field"><span>Sobrenome</span><input className="input" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></label>
          </div>
          <label className="field"><span>E-mail</span><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="field"><span>Papel</span>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="ADMIN">Administrador — gerencia lojas, equipe e faturamento</option>
              <option value="ANALYST">Analista — audita e conduz chamados</option>
              <option value="VIEWER">Leitor — apenas consulta</option>
            </select></label>
          <button className="btn" disabled={busy}>Enviar convite</button>
        </form>
      </div>
    </>
  );
}

// ───────────────────────── Segurança ─────────────────────────

export function Security() {
  const { me, can, refresh } = useAuth();
  const { busy, message, run } = useAction();
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const activity = useLoad<{ entries: { id: string; at: string; actor: string; action: string; target: string | null; ip: string | null }[] }>(
    can('ADMIN') ? '/activity' : null,
  );

  return (
    <>
      <PageHead title="Segurança" subtitle="Proteja o acesso à sua conta e acompanhe o que acontece nela." />
      <Note message={message} />
      <div className="two-col" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card card-pad stack">
          <div className="row spread">
            <h3 style={{ fontSize: 16 }}>Verificação em duas etapas</h3>
            {me!.user.mfaEnabled ? <Badge tone="success">Ativa</Badge> : <Badge tone="warn">Inativa</Badge>}
          </div>
          {me!.user.mfaEnabled ? (
            <form className="stack" onSubmit={(event) => {
              event.preventDefault();
              void run(async () => { await api('/auth/mfa/disable', { body: { password: disablePassword } }); setDisablePassword(''); await refresh(); }, 'Verificação em duas etapas desativada.');
            }}>
              <p className="muted">Sua conta pede um código do aplicativo autenticador a cada entrada.</p>
              <label className="field"><span>Confirme sua senha para desativar</span>
                <input className="input" type="password" autoComplete="current-password" required value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} /></label>
              <button className="btn danger" disabled={busy} style={{ alignSelf: 'flex-start' }}>Desativar</button>
            </form>
          ) : setup ? (
            <form className="stack" onSubmit={(event) => {
              event.preventDefault();
              void run(async () => { await api('/auth/mfa/enable', { body: { code } }); setSetup(null); setCode(''); await refresh(); }, 'Verificação em duas etapas ativada. Outras sessões foram encerradas.');
            }}>
              <p>No seu aplicativo autenticador, adicione uma conta com esta chave de configuração:</p>
              <div className="secret">{setup.secret}</div>
              <label className="field"><span>Código de 6 dígitos gerado pelo aplicativo</span>
                <input className="input num" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></label>
              <button className="btn" disabled={busy} style={{ alignSelf: 'flex-start' }}>Confirmar e ativar</button>
            </form>
          ) : (
            <>
              <p className="muted">Além da senha, peça um código temporário gerado no seu celular. Recomendado para todas as contas.</p>
              <button className="btn" disabled={busy} style={{ alignSelf: 'flex-start' }}
                onClick={() => run(async () => setSetup(await api('/auth/mfa/setup', { method: 'POST' })), 'Chave gerada. Confirme com um código para ativar.')}>
                Configurar
              </button>
            </>
          )}
        </div>

        <div className="stack">
          <form className="card card-pad stack" onSubmit={(event) => {
            event.preventDefault();
            void run(async () => { await api('/auth/password/change', { body: passwords }); setPasswords({ currentPassword: '', newPassword: '' }); }, 'Senha alterada. Outras sessões foram encerradas.');
          }}>
            <h3 style={{ fontSize: 16 }}>Alterar senha</h3>
            <label className="field"><span>Senha atual</span>
              <input className="input" type="password" autoComplete="current-password" required value={passwords.currentPassword} onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })} /></label>
            <label className="field"><span>Nova senha</span>
              <input className="input" type="password" autoComplete="new-password" required minLength={12} value={passwords.newPassword} onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })} />
              <small>Mínimo de 12 caracteres, com maiúscula, minúscula, número e caractere especial.</small></label>
            <button className="btn" disabled={busy} style={{ alignSelf: 'flex-start' }}>Salvar nova senha</button>
          </form>
          <div className="card card-pad row spread">
            <div><h3 style={{ fontSize: 16 }}>Sessões</h3><p className="muted small">Encerre o acesso em todos os outros dispositivos.</p></div>
            <button className="btn ghost sm" disabled={busy} onClick={() => run(() => api('/auth/sessions/revoke-others', { method: 'POST' }), 'Outras sessões encerradas.')}>
              Encerrar outras sessões
            </button>
          </div>
        </div>
      </div>

      {can('ADMIN') && (
        <div className="card">
          <div className="card-head"><h3>Trilha de auditoria</h3><span className="muted small">Últimos 100 eventos da conta</span></div>
          {!activity.data ? <Loading error={activity.error} /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Detalhe</th><th>IP</th></tr></thead>
                <tbody>
                  {activity.data.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="nowrap">{dateTime(entry.at)}</td><td>{entry.actor}</td>
                      <td className="strong">{activityLabel(entry.action)}</td><td className="muted">{entry.target ?? '—'}</td>
                      <td className="muted small">{entry.ip ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
