import { useState } from 'react';
import { CrudTable } from '../../components/CrudPage.jsx';
import { PageHeader, useFetch } from '../../components/ui.jsx';

const TABS = { articulos: 'Artículos', categorias: 'Categorías', unidades: 'Unidades de medida' };

export default function Catalogo() {
  const [tab, setTab] = useState('articulos');
  const { data, loading, error, reload } = useFetch('/api/admin/catalogo');
  const common = { loading, error, reload };
  const catOptions = (data?.categorias || []).filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }));
  const unitOptions = (data?.unidades || []).filter((u) => u.active).map((u) => ({ value: u.id, label: u.name }));

  return (
    <>
      <PageHeader title="Catálogo de artículos" subtitle="Catálogo compartido por todos los departamentos. Desactivar un artículo lo oculta en nuevas requisiciones sin afectar el historial." />
      <div className="tabs" role="tablist">
        {Object.entries(TABS).map(([k, v]) => (
          <button type="button" role="tab" aria-selected={tab === k} key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
            {v} {data && <span className="tab-count">{data[k].length}</span>}
          </button>
        ))}
      </div>
      {tab === 'articulos' && (
        <CrudTable
          {...common} title="Artículo" icon="box" endpoint="/api/admin/articulos" rows={data?.articulos}
          searchKeys={['name', 'code', 'category_name']}
          columns={[
            { label: 'Código', render: (r) => <span className="code">{r.code || '—'}</span> },
            { label: 'Artículo', render: (r) => <><strong>{r.name}</strong>{r.description && <div className="muted small">{r.description}</div>}</> },
            { label: 'Categoría', key: 'category_name' },
            { label: 'Unidad', key: 'unit_name' },
            { label: 'Usos', num: true, render: (r) => r.usos },
          ]}
          fields={[
            { name: 'name', label: 'Nombre', required: true, span: true },
            { name: 'code', label: 'Código' },
            { name: 'category_id', label: 'Categoría', type: 'select', options: catOptions, required: true },
            { name: 'unit_id', label: 'Unidad por defecto', type: 'select', options: unitOptions, placeholder: '—' },
            { name: 'description', label: 'Descripción', type: 'textarea', span: true },
          ]}
        />
      )}
      {tab === 'categorias' && (
        <CrudTable
          {...common} title="Categoría" icon="tag" endpoint="/api/admin/categorias" rows={data?.categorias}
          columns={[
            { label: 'Categoría', render: (r) => <><strong>{r.name}</strong>{r.description && <div className="muted small">{r.description}</div>}</> },
            { label: 'Artículos', num: true, render: (r) => r.articulos },
          ]}
          fields={[{ name: 'name', label: 'Nombre', required: true, span: true }, { name: 'description', label: 'Descripción', type: 'textarea', span: true }]}
        />
      )}
      {tab === 'unidades' && (
        <CrudTable
          {...common} title="Unidad de medida" icon="layers" endpoint="/api/admin/unidades" rows={data?.unidades}
          searchKeys={['name', 'abbreviation']}
          columns={[{ label: 'Unidad', key: 'name', render: (r) => <strong>{r.name}</strong> }, { label: 'Abreviatura', key: 'abbreviation' }]}
          fields={[{ name: 'name', label: 'Nombre', required: true }, { name: 'abbreviation', label: 'Abreviatura', required: true }]}
        />
      )}
    </>
  );
}
