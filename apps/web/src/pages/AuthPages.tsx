import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../api';
import { useAuth } from '../auth';
import { Arrow, Logo, Watermark } from '../ui';

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

/** Card único centralizado sobre fundo radial quente: entrar, recuperar e redefinir senha. */
function CenterLayout({ title, lede, onSubmit, children }: { title: string; lede: string; onSubmit: (event: FormEvent) => void; children: ReactNode }) {
  return (
    <main className="auth-center">
      <Logo />
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
        {children}
      </form>
      <p className="auth-foot">© {new Date().getFullYear()} Grandir. Todos os direitos reservados.</p>
    </main>
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
    <CenterLayout title="Bem-vindo de volta!" lede="Entre com seu e-mail e senha" onSubmit={submit}>
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
      <button className="btn block" disabled={busy}>{busy ? 'Entrando…' : <>Entrar <Arrow /></>}</button>
      <div className="links">
        <Link to="/recuperar-senha">Esqueceu a senha?</Link>
        <span>Ainda não tem conta? <Link to="/criar-conta">Criar conta</Link></span>
      </div>
    </CenterLayout>
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
    <div className="auth-split">
      <aside className="auth-brand">
        <Watermark />
        <Logo />
        <div>
          <span className="eyebrow">Crie sua conta hoje</span>
          <h2 className="display">Recupere o que é seu e volte a <span className="highlight">crescer.</span></h2>
        </div>
        <div className="onboarding">
          <h3>Ative sua conta em minutos</h3>
          <ol className="auth-steps">
            <li><span className="step-badge">1</span><span>Preencha o cadastro ao lado.</span></li>
            <li><span className="step-badge">2</span><span>Conecte sua primeira loja de marketplace.</span></li>
            <li><span className="step-badge">3</span><span>A auditoria começa e as divergências aparecem no painel.</span></li>
          </ol>
        </div>
      </aside>

      <main className="auth-form">
        <form className="inner" onSubmit={submit}>
          <div>
            <h1>Vamos começar</h1>
            <p>Sem compromisso. Sem mensalidade. Cancele quando quiser.</p>
          </div>
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
            <label className="field full"><span>E-mail</span>
              <input className="input" type="email" autoComplete="username" required value={form.email} onChange={set('email')} /></label>
            <label className="field"><span>Senha</span>
              <input className="input" type="password" autoComplete="new-password" required minLength={12} value={form.password} onChange={set('password')} /></label>
            <label className="field"><span>Confirmar senha</span>
              <input className="input" type="password" autoComplete="new-password" required minLength={12} value={form.confirm} onChange={set('confirm')} /></label>
            <small className="muted full">{PASSWORD_HINT}</small>
            <label className="field full"><span>Faturamento anual em fulfillment</span>
              <select className="input" required value={form.revenueBand} onChange={set('revenueBand')}>
                <option value="" disabled>Selecione</option>
                {REVENUE.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select></label>
          </div>
          <label className="hp" aria-hidden="true">Site
            <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label>
          <label className="check">
            <input type="checkbox" required checked={form.acceptTerms} onChange={(e) => setForm((c) => ({ ...c, acceptTerms: e.target.checked }))} />
            <span>Li e aceito os Termos de Serviço e a Política de Privacidade. <span style={{ color: 'var(--required)' }}>*</span></span>
          </label>
          <button className="btn square block" disabled={busy}>{busy ? 'Criando conta…' : 'Avançar'}</button>
          <p className="small">Já tem conta? <Link to="/entrar">Entrar</Link></p>
        </form>
      </main>
    </div>
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
    <CenterLayout title="Recuperar senha" lede="Enviaremos um link para você criar uma nova senha" onSubmit={submit}>
      {error && <div className="alert error" role="alert">{error}</div>}
      {sent ? (
        <div className="alert ok">Se houver uma conta com este e-mail, o link de redefinição foi enviado. Ele vale por 1 hora.</div>
      ) : (
        <>
          <label className="field"><span>E-mail</span>
            <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <button className="btn block" disabled={busy}>{busy ? 'Enviando…' : <>Enviar link <Arrow /></>}</button>
        </>
      )}
      <div className="links"><Link to="/entrar">Voltar para a entrada</Link></div>
    </CenterLayout>
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
    <CenterLayout title="Criar nova senha" lede="Por segurança, suas sessões abertas serão encerradas" onSubmit={submit}>
      {error && <div className="alert error" role="alert">{error}</div>}
      {!token && <div className="alert error">Link incompleto. Abra novamente o link recebido por e-mail.</div>}
      {done ? (
        <>
          <div className="alert ok">Senha atualizada.</div>
          <Link className="btn block" to="/entrar">Entrar <Arrow /></Link>
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
    </CenterLayout>
  );
}
