import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { PRIORIDADES } from '@shared/constants.js';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Icon } from '../../components/icons.jsx';
import SearchSelect from '../../components/SearchSelect.jsx';
import {
  Button, Card, ErrorBox, Field, FileInput, FileLink, Loading, Modal, PageHeader, PriorityBadge, fmtDate, fmtQty, todayISO, useFetch, useToast,
} from '../../components/ui.jsx';

const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const emptyLine = () => ({ key: uid(), id: null, is_unregistered: false, category_id: '', article_id: null, unit_id: '', quantity: '', specifications: '' });

export default function Formulario() {
  const { id } = useParams();
  const editing = !!id;
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const catalogo = useFetch('/api/catalogo');
  const existing = useFetch(editing ? `/api/requisiciones/${id}` : null);

  const [form, setForm] = useState({ required_date: '', priority: 'normal', justification: '' });
  const [lines, setLines] = useState([emptyLine()]);
  const [errors, setErrors] = useState({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(false);
  const [unregistered, setUnregistered] = useState(null); // línea en edición en el modal
  const token = useRef(uid());

  // Carga una requisición existente (borrador o devuelta).
  useEffect(() => {
    const r = existing.data;
    if (!r) return;
    setForm({ required_date: r.required_date || '', priority: r.priority, justification: r.justification || '' });
    setLines(r.items.length ? r.items.map((it) => ({
      key: uid(), id: it.id, is_unregistered: it.is_unregistered, category_id: it.category_id || '', article_id: it.article_id,
      item_name: it.item_name, unit_id: it.unit_id || '', quantity: String(it.quantity), specifications: it.specifications || '',
      description: it.description || '', reference_file_id: it.reference_file_id, reference_file: it.reference_file,
      purchasing_comment: it.purchasing_comment,
    })) : [emptyLine()]);
  }, [existing.data]);

  // Advierte antes de abandonar el formulario con cambios sin guardar.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !busy && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    const onUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const cat = catalogo.data;
  const articlesById = useMemo(() => new Map((cat?.articulos || []).map((a) => [a.id, a])), [cat]);
  const unitsById = useMemo(() => new Map((cat?.unidades || []).map((u) => [u.id, u])), [cat]);
  const categoriesById = useMemo(() => new Map((cat?.categorias || []).map((c) => [c.id, c])), [cat]);

  const touch = () => setDirty(true);
  const setField = (k, v) => { setForm((f) => ({ ...f, [k]: v })); touch(); };
  const updateLine = (key, patch) => { setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l))); touch(); };
  const removeLine = (key) => { setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : [emptyLine()])); touch(); };

  function articleOptions(categoryId) {
    return (cat?.articulos || [])
      .filter((a) => !categoryId || a.category_id === Number(categoryId))
      .map((a) => ({ value: a.id, label: a.name, sub: [a.code, a.category_name].filter(Boolean).join(' · ') }));
  }

  function lineIsEmpty(l) {
    return !l.is_unregistered && !l.article_id && !l.quantity && !l.specifications;
  }

  function validate(submit) {
    const e = {};
    const real = lines.filter((l) => !lineIsEmpty(l));
    real.forEach((l) => {
      const le = {};
      if (!l.is_unregistered && !l.article_id) le.article = 'Seleccione un artículo.';
      if (!(Number(l.quantity) > 0)) le.quantity = 'Cantidad inválida.';
      if (!l.unit_id) le.unit = 'Seleccione la unidad.';
      if (Object.keys(le).length) e[l.key] = le;
    });
    if (submit) {
      if (!real.length) e.items = 'Agregue al menos un artículo.';
      if (!form.required_date) e.required_date = 'Indique la fecha requerida.';
      else if (form.required_date < todayISO() && existing.data?.status !== 'devuelta_solicitante') e.required_date = 'No puede ser anterior a hoy.';
      if (form.justification.trim().length < 10) e.justification = 'Describa el motivo (mínimo 10 caracteres).';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function payload(submit) {
    return {
      client_token: editing ? undefined : token.current,
      required_date: form.required_date || null,
      priority: form.priority,
      justification: form.justification,
      submit,
      items: lines.filter((l) => !lineIsEmpty(l)).map((l) => ({
        id: l.id, is_unregistered: l.is_unregistered, article_id: l.is_unregistered ? null : l.article_id,
        item_name: l.is_unregistered ? l.item_name : '', category_id: l.category_id || null, unit_id: Number(l.unit_id),
        quantity: Number(l.quantity), specifications: l.specifications, description: l.description || '',
        reference_file_id: l.reference_file_id || null,
      })),
    };
  }

  async function save(submit) {
    if (busy) return;
    if (!validate(submit)) { toast('Revise los campos marcados.', 'error'); return; }
    setBusy(submit ? 'submit' : 'draft'); setError(null);
    try {
      const body = payload(submit);
      const r = editing ? await api.put(`/api/requisiciones/${id}`, body) : await api.post('/api/requisiciones', body);
      setDirty(false);
      setSummary(false);
      toast(submit ? `Requisición ${r.number} enviada a Compras.` : `Borrador ${r.number} guardado.`);
      // Se espera a que React aplique dirty=false antes de navegar.
      setTimeout(() => navigate(submit ? `/requisiciones/${r.id}` : `/requisiciones/${r.id}/editar`, { replace: !submit && !editing }), 0);
    } catch (e) {
      setError(e);
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  if (catalogo.loading || (editing && existing.loading && !existing.data)) return <Loading />;
  if (catalogo.error || existing.error) return <ErrorBox error={catalogo.error || existing.error} onRetry={() => { catalogo.reload(); existing.reload(); }} />;
  const r = existing.data;
  if (r && !r.actions.includes('editar')) {
    return <div className="alert alert-warn">Esta requisición ya no puede modificarse. <Link to={`/requisiciones/${r.id}`}>Ver detalle</Link></div>;
  }

  const validLines = lines.filter((l) => !lineIsEmpty(l));
  const lastReturn = r?.events?.filter((e) => e.to_status === 'devuelta_solicitante').pop();

  return (
    <>
      <PageHeader
        title={editing ? (r?.status === 'devuelta_solicitante' ? `Corregir requisición ${r.number}` : `Editar borrador ${r?.number}`) : 'Nueva requisición'}
        subtitle="Solicite bienes, materiales, insumos o servicios. Compras se encargará de cotizar."
        back={<Link to={editing ? `/requisiciones/${id}` : '/'} className="back-link"><Icon name="chevron-left" size={14} /> Volver</Link>}
      />

      {lastReturn && (
        <div className="alert alert-warn">
          <Icon name="undo" />
          <div><strong>Corrección solicitada por {lastReturn.user_name}:</strong> {lastReturn.comment}</div>
        </div>
      )}

      <Card title="Datos generales" icon="file">
        <div className="form-grid">
          <Field label="N.º de requisición"><input value={r?.number || 'Se asigna automáticamente al guardar'} disabled /></Field>
          <Field label="Fecha de creación"><input value={fmtDate(r?.created_at || todayISO())} disabled /></Field>
          <Field label="Solicitante"><input value={r?.requester_name || user.full_name} disabled /></Field>
          <Field label="Departamento"><input value={r?.department_name || user.department_name || '—'} disabled /></Field>
          <Field label="Fecha requerida" required error={errors.required_date}>
            <input type="date" min={todayISO()} value={form.required_date} onChange={(e) => setField('required_date', e.target.value)} />
          </Field>
          <Field label="Prioridad" required group>
            <div className="segmented">
              {Object.entries(PRIORIDADES).map(([k, v]) => (
                <button type="button" key={k} className={`seg seg-${k} ${form.priority === k ? 'on' : ''}`} onClick={() => setField('priority', k)}>{v}</button>
              ))}
            </div>
          </Field>
          <Field label="Motivo o justificación" required error={errors.justification} className="span-2"
            hint="Explique para qué se necesita y cualquier detalle que ayude a Compras.">
            <textarea rows={3} maxLength={4000} value={form.justification} onChange={(e) => setField('justification', e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title="Artículos solicitados" icon="box" actions={<span className="muted small">{validLines.length} artículo(s)</span>}>
        {errors.items && <div className="alert alert-error">{errors.items}</div>}
        <div className="lines">
          {lines.map((l, idx) => (
            <div className={`line ${l.is_unregistered ? 'line-unregistered' : ''}`} key={l.key}>
              <span className="line-n">{idx + 1}</span>
              {l.is_unregistered ? (
                <div className="line-unreg-body">
                  <div>
                    <span className="badge tone-orange">No registrado</span> <strong>{l.item_name}</strong>
                    <div className="muted small">
                      {categoriesById.get(Number(l.category_id))?.name || 'Sin categoría sugerida'} · {fmtQty(l.quantity)} {unitsById.get(Number(l.unit_id))?.name}
                      {l.description && ` · ${l.description}`}
                    </div>
                    {l.reference_file && <FileLink url={l.reference_file.url} name={l.reference_file.original_name} />}
                    {l.reference_file_name && !l.reference_file && <span className="muted small"><Icon name="file" size={12} /> {l.reference_file_name}</span>}
                  </div>
                  <Field label="Especificaciones u observaciones" className="grow">
                    <input value={l.specifications} maxLength={1000} onChange={(e) => updateLine(l.key, { specifications: e.target.value })} />
                  </Field>
                </div>
              ) : (
                <div className="line-grid">
                  <Field label="Categoría">
                    <select value={l.category_id} onChange={(e) => {
                      const c = e.target.value;
                      const a = articlesById.get(l.article_id);
                      updateLine(l.key, { category_id: c, ...(a && c && a.category_id !== Number(c) ? { article_id: null } : {}) });
                    }}>
                      <option value="">Todas</option>
                      {cat.categorias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Artículo" required error={errors[l.key]?.article} className="grow">
                    <SearchSelect
                      ariaLabel={`Artículo línea ${idx + 1}`}
                      options={articleOptions(l.category_id)}
                      value={l.article_id}
                      displayValue={l.article_id && !articlesById.get(l.article_id) ? `${l.item_name} (desactivado)` : ''}
                      invalid={!!errors[l.key]?.article}
                      placeholder="Escriba para buscar…"
                      onChange={(v) => {
                        const a = articlesById.get(v);
                        updateLine(l.key, { article_id: v, item_name: a.name, category_id: a.category_id, unit_id: l.unit_id || a.unit_id || '' });
                      }}
                    />
                  </Field>
                  <Field label="Cantidad" required error={errors[l.key]?.quantity}>
                    <input type="number" min="0" step="any" inputMode="decimal" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} />
                  </Field>
                  <Field label="Unidad" required error={errors[l.key]?.unit}>
                    <select value={l.unit_id} onChange={(e) => updateLine(l.key, { unit_id: e.target.value })}>
                      <option value="">Seleccione</option>
                      {cat.unidades.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Especificaciones u observaciones" className="span-line">
                    <input value={l.specifications} maxLength={1000} placeholder="Marca, medida, presentación, color…" onChange={(e) => updateLine(l.key, { specifications: e.target.value })} />
                  </Field>
                </div>
              )}
              <div className="line-actions">
                {l.is_unregistered && <button type="button" className="icon-btn" title="Editar" aria-label="Editar artículo no registrado" onClick={() => setUnregistered(l)}><Icon name="edit" size={16} /></button>}
                <button type="button" className="icon-btn danger" title="Eliminar línea" aria-label={`Eliminar línea ${idx + 1}`} onClick={() => removeLine(l.key)}><Icon name="trash" size={16} /></button>
              </div>
              {l.purchasing_comment && <div className="line-note"><Icon name="message" size={12} /> Compras: {l.purchasing_comment}</div>}
            </div>
          ))}
        </div>
        <div className="row gap wrap">
          <Button variant="secondary" icon="plus" onClick={() => { setLines((ls) => [...ls, emptyLine()]); touch(); }}>Agregar otro artículo</Button>
          <Button variant="ghost" icon="plus" onClick={() => setUnregistered({ ...emptyLine(), is_unregistered: true, item_name: '', description: '' })}>Solicitar artículo no registrado</Button>
        </div>
        <p className="muted small">Los precios y cotizaciones son gestionados por Compras y Administración.</p>
      </Card>

      <ErrorBox error={error} />
      <div className="form-actions">
        <Button variant="ghost" onClick={() => navigate(editing ? `/requisiciones/${id}` : '/')} disabled={!!busy}>Cancelar</Button>
        <Button variant="secondary" icon="file" busy={busy === 'draft'} disabled={!!busy} onClick={() => save(false)}>Guardar borrador</Button>
        <Button icon="send" disabled={!!busy} onClick={() => { if (validate(true)) setSummary(true); else toast('Revise los campos marcados.', 'error'); }}>Enviar requisición</Button>
      </div>

      {summary && (
        <Modal title="Confirmar envío a Compras" size="lg" onClose={() => !busy && setSummary(false)} footer={(
          <>
            <Button variant="ghost" onClick={() => setSummary(false)} disabled={!!busy}>Seguir editando</Button>
            <Button icon="send" busy={busy === 'submit'} onClick={() => save(true)}>Confirmar y enviar</Button>
          </>
        )}>
          <dl className="dl dl-inline">
            <dt>Fecha requerida</dt><dd>{fmtDate(form.required_date)}</dd>
            <dt>Prioridad</dt><dd><PriorityBadge priority={form.priority} /></dd>
            <dt>Motivo</dt><dd>{form.justification}</dd>
          </dl>
          <table className="table">
            <thead><tr><th>#</th><th>Artículo</th><th className="num">Cantidad</th><th>Unidad</th><th>Especificaciones</th></tr></thead>
            <tbody>
              {validLines.map((l, i) => (
                <tr key={l.key}>
                  <td>{i + 1}</td>
                  <td>{l.item_name || articlesById.get(l.article_id)?.name}{l.is_unregistered && <span className="badge tone-orange ml">No registrado</span>}</td>
                  <td className="num">{fmtQty(l.quantity)}</td>
                  <td>{unitsById.get(Number(l.unit_id))?.name}</td>
                  <td>{l.specifications || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Una vez enviada, solo podrá modificarse si Compras o Administración la devuelven para corrección.</p>
        </Modal>
      )}

      {unregistered && (
        <UnregisteredModal
          line={unregistered} categorias={cat.categorias} unidades={cat.unidades}
          onClose={() => setUnregistered(null)}
          onSave={(l) => {
            setLines((ls) => {
              const exists = ls.some((x) => x.key === l.key);
              const base = ls.filter((x) => !lineIsEmpty(x) || exists);
              return exists ? ls.map((x) => (x.key === l.key ? l : x)) : [...base, l];
            });
            touch();
            setUnregistered(null);
          }}
        />
      )}

      {blocker.state === 'blocked' && (
        <Modal title="¿Salir sin guardar?" onClose={() => blocker.reset()} footer={(
          <>
            <Button variant="ghost" onClick={() => blocker.reset()}>Seguir editando</Button>
            <Button variant="danger" onClick={() => blocker.proceed()}>Salir sin guardar</Button>
          </>
        )}>
          <p>Tiene cambios sin guardar. Si sale ahora se perderán. Puede usar “Guardar borrador” para continuar luego.</p>
        </Modal>
      )}
    </>
  );
}

function UnregisteredModal({ line, categorias, unidades, onSave, onClose }) {
  const [l, setL] = useState(line);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const valid = l.item_name?.trim().length >= 2 && Number(l.quantity) > 0 && l.unit_id;

  async function save() {
    setBusy(true); setError(null);
    try {
      let patch = {};
      if (file) {
        const f = await api.upload('/api/archivos', {}, file);
        patch = { reference_file_id: f.id, reference_file: null, reference_file_name: f.original_name };
      }
      onSave({ ...l, ...patch, item_name: l.item_name.trim() });
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <Modal title="Solicitar artículo no registrado" onClose={busy ? undefined : onClose} footer={(
      <>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button icon="plus" busy={busy} disabled={!valid} onClick={save}>{line.item_name ? 'Guardar cambios' : 'Añadir a la requisición'}</Button>
      </>
    )}>
      <p className="muted small">El artículo se añadirá de inmediato a esta requisición. Compras evaluará luego si debe incorporarse al catálogo oficial.</p>
      <div className="form-grid">
        <Field label="Nombre del artículo" required className="span-2"><input autoFocus maxLength={200} value={l.item_name} onChange={(e) => setL({ ...l, item_name: e.target.value })} /></Field>
        <Field label="Categoría sugerida">
          <select value={l.category_id} onChange={(e) => setL({ ...l, category_id: e.target.value })}>
            <option value="">Sin sugerencia</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Cantidad" required><input type="number" min="0" step="any" value={l.quantity} onChange={(e) => setL({ ...l, quantity: e.target.value })} /></Field>
        <Field label="Unidad de medida" required>
          <select value={l.unit_id} onChange={(e) => setL({ ...l, unit_id: e.target.value })}>
            <option value="">Seleccione</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Descripción" className="span-2" hint="Características, uso previsto, marca o modelo de referencia.">
          <textarea rows={3} maxLength={2000} value={l.description} onChange={(e) => setL({ ...l, description: e.target.value })} />
        </Field>
        <Field label="Imagen o documento de referencia (opcional)" className="span-2">
          <FileInput file={file} onChange={setFile} />
          {!file && (l.reference_file || l.reference_file_name) && <span className="muted small">Archivo actual: {l.reference_file?.original_name || l.reference_file_name}</span>}
        </Field>
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}
