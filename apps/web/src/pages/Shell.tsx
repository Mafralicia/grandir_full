import { Boxes, FolderCheck, LayoutDashboard, MessagesSquare, ReceiptText, ScanSearch, ShieldCheck, Store, Users, type LucideIcon } from 'lucide-react';
import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth, type Role } from '../auth';
import { ROLE_LABEL, setCurrency } from '../labels';
import { Logo } from '../ui';

const NAV: { group: string; items: { to: string; label: string; end?: boolean; role?: Role; icon: LucideIcon }[] }[] = [
  {
    group: 'Recuperação',
    items: [
      { to: '/app', end: true, label: 'Visão geral', icon: LayoutDashboard },
      { to: '/app/conciliacao', label: 'Conciliação de estoque', icon: Boxes },
      { to: '/app/divergencias', label: 'Divergências', icon: ScanSearch },
      { to: '/app/dossies', label: 'Dossiês e chamados', icon: FolderCheck },
      { to: '/app/chamados', label: 'Ocorrências avulsas', icon: MessagesSquare },
    ],
  },
  {
    group: 'Conta',
    items: [
      { to: '/app/lojas', label: 'Lojas', icon: Store },
      { to: '/app/faturamento', label: 'Faturamento', role: 'ADMIN', icon: ReceiptText },
      { to: '/app/equipe', label: 'Equipe', role: 'ADMIN', icon: Users },
      { to: '/app/seguranca', label: 'Segurança', icon: ShieldCheck },
    ],
  },
];

export function Shell() {
  const { me, logout, can } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (me) setCurrency(me.tenant.currency);
  }, [me]);

  if (!me) return null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <Logo to="/app" />
        {NAV.map((section) => (
          <div key={section.group} style={{ display: 'contents' }}>
            <div className="group">{section.group}</div>
            {section.items
              .filter((item) => !item.role || can(item.role))
              .map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav ${isActive ? 'active' : ''}`}>
                  <item.icon aria-hidden="true" />
                  {item.label}
                </NavLink>
              ))}
          </div>
        ))}
        <div className="me">
          <div>
            <div className="name">{me.user.firstName} {me.user.lastName}</div>
            <div className="org">{me.tenant.name} · {ROLE_LABEL[me.user.role]}</div>
          </div>
          <button
            className="link-btn"
            onClick={async () => {
              await logout();
              navigate('/entrar');
            }}
          >
            Sair
          </button>
        </div>
      </aside>
      <main className="content">
        <div className="inner">
          {me.tenant.demoData && (
            <div>
              <span className="demo-pill">Modo de teste ligado — esta conta tem dados sintéticos, não dados reais.</span>
            </div>
          )}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
