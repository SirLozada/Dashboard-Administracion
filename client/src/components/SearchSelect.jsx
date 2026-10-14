import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon } from './icons.jsx';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Lista desplegable con buscador (accesible por teclado). options: [{ value, label, sub }] */
export default function SearchSelect({ options, value, onChange, placeholder = 'Buscar…', displayValue, invalid, disabled, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef();
  const listRef = useRef();
  const id = useId();
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = norm(query).split(/\s+/).filter(Boolean);
    const list = q.length ? options.filter((o) => { const t = norm(`${o.label} ${o.sub || ''}`); return q.every((w) => t.includes(w)); }) : options;
    return list.slice(0, 80);
  }, [options, query]);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function pick(o) {
    onChange(o.value, o);
    setOpen(false);
    setQuery('');
  }

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { if (open && filtered[active]) { e.preventDefault(); pick(filtered[active]); } }
    else if (e.key === 'Escape') setOpen(false);
  }

  const shown = open ? query : (selected?.label || displayValue || '');

  return (
    <div className={`combo ${invalid ? 'invalid' : ''}`} ref={ref}>
      <input
        role="combobox" aria-expanded={open} aria-controls={id} aria-label={ariaLabel} disabled={disabled}
        value={shown} placeholder={selected?.label || displayValue || placeholder}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onKeyDown={onKey}
      />
      <Icon name={open ? 'search' : 'chevron-down'} size={16} className="combo-icon" />
      {open && (
        <ul className="combo-list" id={id} role="listbox" ref={listRef}>
          {filtered.length === 0 && <li className="combo-empty">Sin resultados. Si no existe, use “Solicitar artículo no registrado”.</li>}
          {filtered.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value}
              className={`${i === active ? 'active' : ''} ${o.value === value ? 'selected' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setActive(i)}>
              <span>{o.label}</span>
              {o.sub && <small>{o.sub}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
