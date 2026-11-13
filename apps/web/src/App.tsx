import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Billing, Security, Stores, Team } from './pages/Account';
import { ForgotPassword, Login, ResetPassword, Signup } from './pages/AuthPages';
import { ClaimDetail, ClaimsList } from './pages/Claims';
import { Dashboard } from './pages/Dashboard';
import { DataImport } from './pages/DataImport';
import { CaseDetail, Dossiers } from './pages/Dossiers';
import { Landing } from './pages/Landing';
import { Discrepancies, Reconciliation } from './pages/Operations';
import { Shell } from './pages/Shell';
import { Loading } from './ui';

function Protected() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/entrar" replace />;
  return <Shell />;
}

export function App() {
  return (
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
  );
}
