import { CrudTable } from '../../components/CrudPage.jsx';
import { PageHeader, useFetch } from '../../components/ui.jsx';

export default function Departamentos() {
  const { data, loading, error, reload } = useFetch('/api/admin/departamentos');
  return (
    <>
      <PageHeader title="Departamentos" subtitle="Áreas de la organización. Un departamento inactivo conserva su historial de requisiciones." />
      <CrudTable
        title="Departamento" icon="building" endpoint="/api/admin/departamentos" rows={data} loading={loading} error={error} reload={reload}
        searchKeys={['name', 'code']}
        columns={[
          { label: 'Código', key: 'code', render: (r) => <span className="code">{r.code}</span> },
          { label: 'Nombre', key: 'name', render: (r) => <strong>{r.name}</strong> },
          { label: 'Usuarios activos', key: 'usuarios', num: true, render: (r) => r.usuarios },
          { label: 'Requisiciones', key: 'requisiciones', num: true, render: (r) => r.requisiciones },
        ]}
        fields={[
          { name: 'name', label: 'Nombre', required: true, span: true },
          { name: 'code', label: 'Código', required: true, hint: '2 a 10 caracteres, p. ej. PRO, CC, MAN.' },
        ]}
      />
    </>
  );
}
