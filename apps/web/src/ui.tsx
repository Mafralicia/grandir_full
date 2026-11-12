import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { money, moneyShort, monthLabel, type Tone } from './labels';

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="logo" aria-label="Grandir">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="#1E6B52" />
        <rect x="7" y="18" width="4.5" height="7" rx="1.6" fill="#C5EE6B" opacity=".55" />
        <rect x="13.75" y="13" width="4.5" height="12" rx="1.6" fill="#C5EE6B" opacity=".8" />
        <rect x="20.5" y="11" width="4.5" height="14" rx="1.6" fill="#C5EE6B" />
        <path d="M22.75 10.5c0-3 1.9-4.6 4.6-4.6 0 2.9-1.7 4.6-4.6 4.6Z" fill="#C5EE6B" />
      </svg>
      grandir
    </Link>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone === 'neutral' ? '' : tone}`}>{children}</span>;
}

export function PageHead({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Kpi({ label, value, hint, highlight }: { label: string; value: string; hint?: string; highlight?: boolean }) {
  return (
    <div className={`card kpi ${highlight ? 'hero-kpi' : ''}`}>
      <div className="label">{label}</div>
      <div className="value num">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Loading({ error }: { error?: string | null }) {
  return error ? <div className="alert error">{error}</div> : <div className="spinner">Carregando…</div>;
}

/** Barras mensais em SVG puro: sem dependência de biblioteca de gráficos. */
export function MonthlyBars({ data }: { data: { period: string; cents: number }[] }) {
  const width = 720;
  const height = 240;
  const pad = { top: 16, right: 8, bottom: 30, left: 62 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...data.map((d) => d.cents));
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const top = Math.ceil(max / magnitude) * magnitude;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ratio * top);
  const slot = innerW / data.length;
  const barW = Math.min(36, slot * 0.62);

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Valor recuperado por mês">
      {ticks.map((tick) => {
        const y = pad.top + innerH - (tick / top) * innerH;
        return (
          <g key={tick}>
            <line className="grid-line" x1={pad.left} x2={width - pad.right} y1={y} y2={y} />
            <text x={pad.left - 10} y={y + 4} textAnchor="end">
              {moneyShort(tick)}
            </text>
          </g>
        );
      })}
      {data.map((point, index) => {
        const barH = (point.cents / top) * innerH;
        const x = pad.left + index * slot + (slot - barW) / 2;
        return (
          <g key={point.period}>
            <rect
              className={`bar ${index === data.length - 1 ? 'last' : ''}`}
              x={x}
              y={pad.top + innerH - barH}
              width={barW}
              height={Math.max(barH, point.cents > 0 ? 2 : 0)}
              rx={4}
            >
              <title>{`${monthLabel(point.period)}: ${money(point.cents)}`}</title>
            </rect>
            <text x={x + barW / 2} y={height - 10} textAnchor="middle">
              {monthLabel(point.period)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Meter({ label, value, ratio }: { label: ReactNode; value: string; ratio: number }) {
  return (
    <div className="meter">
      <div className="top">
        <span>{label}</span>
        <span className="num strong">{value}</span>
      </div>
      <div className="track">
        <div className="fill" style={{ width: `${Math.max(2, Math.min(100, ratio * 100))}%` }} />
      </div>
    </div>
  );
}
