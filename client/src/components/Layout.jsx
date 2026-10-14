import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ROLES } from '@shared/constants.js';
import { useAuth } from '../auth.jsx';
import { NAV } from '../modules.js';
import { Icon, Logo } from './icons.jsx';
import NotificationBell from './NotificationBell.jsx';

export default function Layout() {
  const { user, config, can, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  const initials = `${user.first_name[0] || ''}${user.last_name[0] || ''}`.toUpperCase();

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <div>
            <strong>{config?.empresa || 'Laboratorios Herbaplant'}</strong>
            <span>Gestión Administrativa</span>
          </div>
        </div>
        <nav>
          {NAV.map((sec) => {
            const items = sec.items.filter((it) => !it.perms || can(...it.perms));
            if (!items.length) return null;
            return (
              <div className="nav-section" key={sec.section}>
                <span className="nav-title">{sec.section}</span>
                {items.map((it) => (
                  <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <Icon name={it.icon} size={18} /> {it.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
          <div className="nav-section">
            <span className="nav-title">Próximamente</span>
            <span className="nav-link disabled" title="Módulo planificado para una próxima fase"><Icon name="layers" size={18} /> Viáticos</span>
          </div>
        </nav>
        <div className="sidebar-foot">Fase 1 · Requisiciones</div>
      </aside>
      <div className="backdrop" onClick={() => setOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => setOpen(!open)} aria-label="Abrir menú"><Icon name="menu" /></button>
          <div className="topbar-title">
            <strong>{user.department_name || 'Sin departamento'}</strong>
            <span>{ROLES[user.role]}</span>
          </div>
          <div className="topbar-right">
            <NotificationBell />
            <div className="user-menu">
              <Link to="/perfil" className="user-chip" title="Mi perfil">
                <span className="avatar">{initials}</span>
                <span className="user-info">
                  <strong>{user.full_name}</strong>
                  <span>{user.position || ROLES[user.role]}</span>
                </span>
              </Link>
              <button type="button" className="icon-btn" onClick={logout} title="Cerrar sesión" aria-label="Cerrar sesión"><Icon name="logout" /></button>
            </div>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
