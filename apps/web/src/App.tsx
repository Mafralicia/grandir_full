import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Landing } from './pages/Landing';
import { Loading } from './ui';

/**
 * Divisão de código por rota: quem abre o site público baixa só a landing; as telas de
 * acesso e cada área do portal chegam sob demanda. `page` adapta exports nomeados.
 */
const page = <M, K extends keyof M>(load: () => Promise<M>, name: K) =>
  lazy(async () => ({ default: (await load())[name] as ComponentType }));

const auth = () => import('./pages/AuthPages');
const Login = page(auth, 'Login');
const Signup = page(auth, 'Signup');
const ForgotPassword = page(auth, 'ForgotPassword');
const ResetPassword = page(auth, 'ResetPassword');

const Shell = page(() => import('./pages/Shell'), 'Shell');
const Dashboard = page(() => import('./pages/Dashboard'), 'Dashboard');
const operations = () => import('./pages/Operations');
const Reconciliation = page(operations, 'Reconciliation');
const Discrepancies = page(operations, 'Discrepancies');
const dossiers = () => import('./pages/Dossiers');
const Dossiers = page(dossiers, 'Dossiers');
const CaseDetail = page(dossiers, 'CaseDetail');
const claims = () => import('./pages/Claims');
const ClaimsList = page(claims, 'ClaimsList');
const ClaimDetail = page(claims, 'ClaimDetail');
const account = () => import('./pages/Account');
const Billing = page(account, 'Billing');
const Stores = page(account, 'Stores');
const Team = page(account, 'Team');
const Security = page(account, 'Security');
const DataImport = page(() => import('./pages/DataImport'), 'DataImport');

function Protected() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/entrar" replace />;
  return <Shell />;
}

export function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/entrar" element={<Login />} />
        <Route path="/criar-conta" element={<Signup />} />
        <Route path="/recuperar-senha" element={<ForgotPassword />} />
        <Route path="/redefinir-senha" element={<ResetPassword />} />
        <Route path="/app" element={<Protected />}>
          <Route index element={<Dashboard />} />
          <Route path="conciliacao" element={<Reconciliation />} />
          <Route path="divergencias" element={<Discrepancies />} />
          <Route path="dossies" element={<Dossiers />} />
          <Route path="dossies/:id" element={<CaseDetail />} />
          <Route path="chamados" element={<ClaimsList />} />
          <Route path="chamados/:id" element={<ClaimDetail />} />
          <Route path="faturamento" element={<Billing />} />
          <Route path="lojas" element={<Stores />} />
          <Route path="lojas/:id/dados" element={<DataImport />} />
          <Route path="equipe" element={<Team />} />
          <Route path="seguranca" element={<Security />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
