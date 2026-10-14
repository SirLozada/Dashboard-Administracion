import { CrudTable } from '../components/CrudPage.jsx';
import { PageHeader, useFetch } from '../components/ui.jsx';

export default function Proveedores() {
  const { data, loading, error, reload } = useFetch('/api/proveedores?todos=1');
  return (
    <>
      <PageHeader title="Proveedores" subtitle="Directorio de proveedores usado en cotizaciones, compras y facturas." />
      <CrudTable
        title="Proveedor" icon="truck" endpoint="/api/proveedores" rows={data} loading={loading} error={error} reload={reload}
        searchKeys={['name', 'tax_id', 'contact_name']}
        columns={[
          { label: 'Nombre', key: 'name', render: (r) => <strong>{r.name}</strong> },
          { label: 'RIF', key: 'tax_id' },
          { label: 'Contacto', render: (r) => <>{r.contact_name || '—'}<div className="muted small">{[r.phone, r.email].filter(Boolean).join(' · ')}</div></> },
        ]}
        fields={[
          { name: 'name', label: 'Razón social', required: true, span: true },
          { name: 'tax_id', label: 'RIF / identificación fiscal' },
          { name: 'contact_name', label: 'Persona de contacto' },
          { name: 'phone', label: 'Teléfono' },
          { name: 'email', label: 'Correo electrónico', type: 'email' },
          { name: 'address', label: 'Dirección', type: 'textarea', span: true },
        ]}
      />
    </>
  );
}
