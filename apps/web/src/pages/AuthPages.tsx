import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../api';
import { useAuth } from '../auth';
import { Logo } from '../ui';

const PASSWORD_HINT = 'Mínimo de 12 caracteres, com maiúscula, minúscula, número e caractere especial.';

const COUNTRIES: [string, string][] = [
  ['BR', 'Brasil'], ['PT', 'Portugal'], ['US', 'Estados Unidos'], ['MX', 'México'], ['AR', 'Argentina'],
  ['CL', 'Chile'], ['CO', 'Colômbia'], ['ES', 'Espanha'], ['GB', 'Reino Unido'], ['DE', 'Alemanha'],
  ['FR', 'França'], ['IT', 'Itália'], ['CA', 'Canadá'], ['CN', 'China'], ['JP', 'Japão'],
];

const REVENUE: [string, string][] = [
  ['ATE_1M', 'Até R$ 1 milhão'], ['1M_3M', 'R$ 1 a 3 milhões'], ['3M_5M', 'R$ 3 a 5 milhões'],
  ['5M_10M', 'R$ 5 a 10 milhões'], ['ACIMA_10M', 'Acima de R$ 10 milhões'],
];

function AuthLayout({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return (
    <div className="auth">
      <aside className="auth-side">
        <Logo />
        <div>
          <h2>Ative sua conta em três passos</h2>
          <ol className="auth-steps">
            <li><b>1</b><span>Crie sua conta com os dados da empresa.</span></li>
            <li><b>2</b><span>Conecte sua primeira loja de marketplace.</span></li>
            <li><b>3</b><span>A auditoria começa e as divergências aparecem no painel.</span></li>
          </ol>
        </div>
        <p className="small" style={{ color: 'rgba(255,255,255,.55)' }}>Sem mensalidade. Você só paga sobre o que recuperar.</p>
      </aside>
      <main className="auth-main">
        <div className={`auth-box ${narrow ? 'narrow' : ''}`}>{children}</div>
      </main>
    </div>
  );
}

export function Login() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me) return <Navigate to="/app" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { body: { email, password, remember, totp: needsTotp ? totp : undefined } });
      await refresh();
      navigate('/app');
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'MFA_OBRIGATORIO') {
        setNeedsTotp(true);
      } else {
        setError(errorMessage(cause));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout narrow>
      <h1>Bem-vindo de volta</h1>
      <p className="muted">Entre com seu e-mail e senha.</p>
      <form className="card card-pad stack" onSubmit={submit}>
        {error && <div className="alert error" role="alert">{error}</div>}
        <label className="field">
          <span>E-mail</span>
          <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Senha</span>
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {needsTotp && (
          <label className="field">
            <span>Código de verificação</span>
            <input className="input num" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus value={totp} onChange={(e) => setTotp(e.target.value)} />
            <small>Abra seu aplicativo autenticador e digite o código de 6 dígitos.</small>
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Manter conectado neste dispositivo</span>
        </label>
        <button className="btn block" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <div className="row spread small">
          <Link to="/recuperar-senha">Esqueci minha senha</Link>
          <span className="muted">Não tem conta? <Link to="/criar-conta">Criar conta</Link></span>
        </div>
      </form>
    </AuthLayout>
  );
}

export function Signup() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', companyName: '', isAgency: '', country: 'BR',
    email: '', password: '', confirm: '', revenueBand: '', acceptTerms: false, website: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me) return <Navigate to="/app" replace />;

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (form.password !== form.confirm) return setError('As senhas não coincidem.');
    setBusy(true);
    setError(null);
    try {
      const { confirm: _confirm, isAgency, ...rest } = form;
      await api('/auth/signup', { body: { ...rest, isAgency: isAgency === 'sim' } });
      await refresh();
      navigate('/app/lojas?boas-vindas=1');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h1>Vamos começar</h1>
      <p className="muted">Sem compromisso e sem mensalidade.</p>
      <form className="card card-pad stack" onSubmit={submit}>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="form-grid">
          <label className="field"><span>Nome</span>
            <input className="input" autoComplete="given-name" required value={form.firstName} onChange={set('firstName')} /></label>
          <label className="field"><span>Sobrenome</span>
            <input className="input" autoComplete="family-name" required value={form.lastName} onChange={set('lastName')} /></label>
          <label className="field"><span>Celular</span>
            <input className="input" type="tel" autoComplete="tel" required value={form.phone} onChange={set('phone')} /></label>
          <label className="field"><span>Empresa</span>
            <input className="input" autoComplete="organization" required value={form.companyName} onChange={set('companyName')} /></label>
          <label className="field"><span>Você é uma agência?</span>
            <select className="input" required value={form.isAgency} onChange={set('isAgency')}>
              <option value="" disabled>Selecione</option><option value="sim">Sim</option><option value="nao">Não</option>
            </select></label>
          <label className="field"><span>País de atendimento</span>
            <select className="input" required value={form.country} onChange={set('country')}>
              {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select></label>
          <label className="field full"><span>Faturamento anual em fulfillment</span>
            <select className="input" required value={form.revenueBand} onChange={set('revenueBand')}>
              <option value="" disabled>Selecione</option>
              {REVENUE.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select></label>
          <label className="field full"><span>E-mail</span>
            <input className="input" type="email" autoComplete="username" required value={form.email} onChange={set('email')} /></label>
          <label className="field"><span>Senha</span>
            <input className="input" type="password" autoComplete="new-password" required minLength={12} value={form.password} onChange={set('password')} /></label>
          <label className="field"><span>Confirmar senha</span>
            <input className="input" type="password" autoComplete="new-password" required minLength={12} value={form.confirm} onChange={set('confirm')} /></label>
          <small className="muted full">{PASSWORD_HINT}</small>
        </div>
        <label className="hp" aria-hidden="true">Site
          <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label>
        <label className="check">
          <input type="checkbox" required checked={form.acceptTerms} onChange={(e) => setForm((c) => ({ ...c, acceptTerms: e.target.checked }))} />
          <span>Li e aceito os Termos de Serviço e a Política de Privacidade.</span>
        </label>
        <button className="btn block" disabled={busy}>{busy ? 'Criando conta…' : 'Criar conta e continuar'}</button>
        <p className="small muted">Já tem conta? <Link to="/entrar">Entrar</Link></p>
      </form>
    </AuthLayout>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password/forgot', { body: { email } });
      setSent(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout narrow>
      <h1>Recuperar senha</h1>
      <p className="muted">Enviaremos um link para você criar uma nova senha.</p>
      <form className="card card-pad stack" onSubmit={submit}>
        {error && <div className="alert error" role="alert">{error}</div>}
        {sent ? (
          <div className="alert ok">Se houver uma conta com este e-mail, o link de redefinição foi enviado. Ele vale por 1 hora.</div>
        ) : (
          <>
            <label className="field"><span>E-mail</span>
              <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <button className="btn block" disabled={busy}>{busy ? 'Enviando…' : 'Enviar link'}</button>
          </>
        )}
        <Link className="small" to="/entrar">Voltar para a entrada</Link>
      </form>
    </AuthLayout>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) return setError('As senhas não coincidem.');
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password/reset', { body: { token, password } });
      setDone(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout narrow>
      <h1>Criar nova senha</h1>
      <p className="muted">Por segurança, suas sessões abertas serão encerradas.</p>
      <form className="card card-pad stack" onSubmit={submit}>
        {error && <div className="alert error" role="alert">{error}</div>}
        {!token && <div className="alert error">Link incompleto. Abra novamente o link recebido por e-mail.</div>}
        {done ? (
          <>
            <div className="alert ok">Senha atualizada.</div>
            <Link className="btn block" to="/entrar">Entrar</Link>
          </>
        ) : (
          <>
            <label className="field"><span>Nova senha</span>
              <input className="input" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} />
              <small>{PASSWORD_HINT}</small></label>
            <label className="field"><span>Confirmar nova senha</span>
              <input className="input" type="password" autoComplete="new-password" required minLength={12} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
            <button className="btn block" disabled={busy || !token}>{busy ? 'Salvando…' : 'Salvar nova senha'}</button>
          </>
        )}
      </form>
    </AuthLayout>
  );
}
