import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ESTADOS, ESTADOS_PAGO, PRIORIDADES } from '@shared/constants.js';
import { api } from '../api.js';
import { Icon } from './icons.jsx';

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

export const fmtDate = (s) => {
  if (!s) return '—';
  const d = s.length === 10 ? new Date(`${s}T12:00:00`) : new Date(s);
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
export const fmtDateTime = (s) => (s ? new Date(s).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtMoney = (n, cur = '') => (n == null ? '—' : `${Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? ` ${cur}` : ''}`);
export const fmtQty = (n) => (n == null ? '—' : Number(n).toLocaleString('es-VE', { maximumFractionDigits: 3 }));
export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export const moneyMap = (obj) => {
  const entries = Object.entries(obj || {}).filter(([, v]) => v);
  return entries.length ? entries.map(([c, v]) => fmtMoney(v, c)).join(' · ') : fmtMoney(0);
};

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

/** Carga datos de la API con estados de carga/error y recarga manual. */
export function useFetch(url, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return undefined;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(url, { signal: ctrl.signal })
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((e) => { if (e.name !== 'AbortError') setState((s) => ({ ...s, loading: false, error: e })); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick, ...deps]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data })) };
}

// ---------------------------------------------------------------------------
// Notificaciones emergentes (toasts)
// ---------------------------------------------------------------------------

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, type = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <Icon name={t.type === 'error' ? 'alert' : 'check'} size={18} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/**
 * Ejecuta una acción asíncrona evitando dobles envíos y mostrando el resultado.
 * Devuelve [run, busy].
 */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = useCallback(async (fn, success) => {
    if (lock.current) return undefined;
    lock.current = true;
    setBusy(true);
    try {
      const out = await fn();
      if (success) toast(success);
      return out;
    } catch (e) {
      toast(e.message || 'No se pudo completar la operación.', 'error');
      throw e;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, [toast]);
  return [run, busy];
}

// ---------------------------------------------------------------------------
// Componentes
// ---------------------------------------------------------------------------

export function StatusBadge({ status }) {
  const e = ESTADOS[status] || { label: status, tone: 'gray' };
  return <span className={`badge tone-${e.tone}`}>{e.label}</span>;
}

export function PaymentBadge({ status }) {
  const e = ESTADOS_PAGO[status] || { label: status, tone: 'gray' };
  return <span className={`badge tone-${e.tone}`}>{e.label}</span>;
}

export function PriorityBadge({ priority }) {
  return <span className={`priority priority-${priority}`}>{priority === 'urgente' && <Icon name="bolt" size={12} />}{PRIORIDADES[priority] || priority}</span>;
}

export function Kpi({ label, value, icon, tone = 'green', to, onClick, hint }) {
  const Tag = onClick || to ? 'button' : 'div';
  return (
    <Tag className={`kpi kpi-${tone}`} onClick={onClick} type={Tag === 'button' ? 'button' : undefined}>
      {icon && <span className="kpi-icon"><Icon name={icon} size={20} /></span>}
      <span className="kpi-body">
        <span className="kpi-value">{value ?? '—'}</span>
        <span className="kpi-label">{label}</span>
        {hint && <span className="kpi-hint">{hint}</span>}
      </span>
    </Tag>
  );
}

export function Loading({ text = 'Cargando…' }) {
  return <div className="loading"><span className="spinner" /> {text}</div>;
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error">
      <Icon name="alert" size={18} />
      <span>{error.message || String(error)}</span>
      {onRetry && <button type="button" className="btn btn-sm btn-ghost" onClick={onRetry}>Reintentar</button>}
    </div>
  );
}

export function Empty({ icon = 'inbox', title, children }) {
  return (
    <div className="empty">
      <Icon name={icon} size={36} />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, size = 'md' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, required, hint, error, children, className = '', group }) {
  // `group` para controles compuestos (botones segmentados): un <label> no debe envolver botones.
  const Tag = group ? 'div' : 'label';
  return (
    <Tag className={`field ${className}`} role={group ? 'group' : undefined} aria-label={group ? label : undefined}>
      <span className="field-label">{label}{required && <span className="req">*</span>}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </Tag>
  );
}

export function Button({ children, variant = 'primary', size, icon, busy, className = '', ...props }) {
  return (
    <button type="button" className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${className}`} disabled={busy || props.disabled} {...props}>
      {busy ? <span className="spinner spinner-sm" /> : icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className = '', icon }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          <h2>{icon && <Icon name={icon} size={18} />}{title}</h2>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, children, back }) {
  return (
    <div className="page-header">
      <div>
        {back}
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function Pagination({ total, page, perPage, onChange }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return <div className="pagination muted">{total} registro(s)</div>;
  return (
    <div className="pagination">
      <span className="muted">{total} registro(s) · página {page} de {pages}</span>
      <Button variant="ghost" size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => onChange(page - 1)}>Anterior</Button>
      <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>Siguiente <Icon name="chevron-right" size={14} /></Button>
    </div>
  );
}

export function FileLink({ url, name, children }) {
  if (!url) return null;
  return (
    <a className="file-link" href={url} target="_blank" rel="noopener noreferrer">
      <Icon name="file" size={14} /> {children || name || 'Ver archivo'}
    </a>
  );
}

/** Diálogo de confirmación con observación opcional u obligatoria. */
export function ConfirmDialog({ title, message, confirmText = 'Confirmar', variant = 'primary', commentLabel, commentRequired, minLength = 3, onConfirm, onClose, children }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const invalid = commentRequired && comment.trim().length < minLength;
  async function submit() {
    setBusy(true); setError(null);
    try { await onConfirm(comment.trim()); onClose(); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <Modal title={title} onClose={busy ? undefined : onClose} footer={(
      <>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button variant={variant} busy={busy} disabled={invalid} onClick={submit}>{confirmText}</Button>
      </>
    )}>
      {message && <p>{message}</p>}
      {children}
      {commentLabel && (
        <Field label={commentLabel} required={commentRequired} hint={commentRequired ? `Mínimo ${minLength} caracteres.` : undefined}>
          <textarea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
        </Field>
      )}
      <ErrorBox error={error} />
    </Modal>
  );
}

export function FileInput({ onChange, required, accept = 'application/pdf,image/jpeg,image/png', file }) {
  return (
    <div className="file-input">
      <input type="file" accept={accept} required={required} onChange={(e) => onChange(e.target.files?.[0] || null)} />
      <span className="field-hint">{file ? `${file.name} (${Math.ceil(file.size / 1024)} KB)` : 'PDF, JPG o PNG.'}</span>
    </div>
  );
}
