import { useEffect, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth, type Role } from '../auth';
import { ROLE_LABEL, setCurrency } from '../labels';
import { Logo } from '../ui';

const icon = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);

const NAV: { group: string; items: { to: string; label: string; end?: boolean; role?: Role; icon: ReactNode }[] }[] = [
  {
    group: 'Recuperação',
    items: [
      { to: '/app', end: true, label: 'Visão geral', icon: icon(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>) },
      { to: '/app/conciliacao', label: 'Conciliação de estoque', icon: icon(<><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></>) },
      { to: '/app/divergencias', label: 'Divergências', icon: icon(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /><path d="M11 8v3.5" /><path d="M11 14h.01" /></>) },
      { to: '/app/chamados', label: 'Chamados', icon: icon(<><path d="M4 5h16v11H9l-5 4V5z" /><path d="M8 9h8M8 12h5" /></>) },
    ],
  },
  {
    group: 'Conta',
    items: [
      { to: '/app/lojas', label: 'Lojas', icon: icon(<><path d="M4 9l1.5-5h13L20 9" /><path d="M4 9v11h16V9" /><path d="M4 9a2.7 2.7 0 005.3 0 2.7 2.7 0 005.4 0A2.7 2.7 0 0020 9" /><path d="M10 20v-5h4v5" /></>) },
      { to: '/app/faturamento', label: 'Faturamento', role: 'ADMIN', icon: icon(<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" /><path d="M9 8h6M9 12h6" /></>) },
      { to: '/app/equipe', label: 'Equipe', role: 'ADMIN', icon: icon(<><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17.5" cy="9" r="2.4" /><path d="M16.5 14.2c2.6.3 4.5 2.5 4.5 5.3" /></>) },
      { to: '/app/seguranca', label: 'Segurança', icon: icon(<><path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></>) },
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
                  {item.icon}
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
              <span className="demo-pill">Ambiente de demonstração — os dados exibidos são sintéticos.</span>
            </div>
          )}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
