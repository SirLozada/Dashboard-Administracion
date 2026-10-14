import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { client, startServer } from './helpers.js';

let srv, sol, sol2, com, com2, adm, sup;
const future = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);

before(async () => {
  srv = await startServer();
  sol = client(srv.base); await sol.login('gerente.produccion');
  sol2 = client(srv.base); await sol2.login('subgerente.calidad');
  com = client(srv.base); await com.login('analista.compras');
  com2 = client(srv.base); await com2.login('jefe.compras');
  adm = client(srv.base); await adm.login('gerente.administracion');
  sup = client(srv.base); await sup.login('admin', 'Admin12345');
});
after(() => srv.close());

describe('autenticación y seguridad', () => {
  test('rechaza credenciales inválidas y peticiones sin sesión', async () => {
    const anon = client(srv.base);
    assert.equal((await anon.post('/api/auth/login', { usuario: 'gerente.produccion', password: 'mala' })).status, 401);
    assert.equal((await anon.get('/api/requisiciones')).status, 401);
  });

  test('permite iniciar sesión con correo', async () => {
    const c = client(srv.base);
    const u = await c.login('analista.compras@herbaplant.example');
    assert.equal(u.role, 'compras');
  });

  test('exige cabecera anti-CSRF en peticiones que modifican datos', async () => {
    const res = await fetch(`${srv.base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuario: 'x', password: 'y' }),
    });
    assert.equal(res.status, 403);
  });

  test('el solicitante no accede a pagos, reportes ni administración', async () => {
    assert.equal((await sol.get('/api/pagos')).status, 403);
    assert.equal((await sol.get('/api/reportes/gastos')).status, 403);
    assert.equal((await sol.get('/api/admin/usuarios')).status, 403);
    assert.equal((await sol.get('/api/proveedores')).status, 403);
  });
});

describe('flujo completo de una requisición', () => {
  let reqId, catalogo, unidades, reqNumber;

  test('el solicitante crea un borrador con artículo de catálogo y no registrado', async () => {
    const cat = (await sol.get('/api/catalogo')).data;
    catalogo = cat.articulos; unidades = cat.unidades;
    const up = await sol.upload('/api/archivos', {}, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), 'ref.png');
    assert.equal(up.status, 201);
    const r = await sol.post('/api/requisiciones', {
      client_token: 'tok-1', required_date: future, priority: 'alta', justification: 'Reposición de insumos para la línea de jarabes.',
      items: [
        { article_id: catalogo[0].id, unit_id: catalogo[0].unit_id, quantity: 10, specifications: 'Marca reconocida' },
        { is_unregistered: true, item_name: 'Filtro HEPA modelo X', category_id: cat.categorias[0].id, unit_id: unidades[0].id, quantity: 2, description: 'Para campana', reference_file_id: up.data.id },
      ],
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.status, 'borrador');
    assert.match(r.data.number, /^REQ-\d{4}-\d{5}$/);
    assert.equal(r.data.items.length, 2);
    assert.equal(r.data.items[1].catalog_review, 'pendiente');
    assert.equal(r.data.items[0].estimated_unit_price, undefined);
    reqId = r.data.id; reqNumber = r.data.number;
  });

  test('evita duplicados con el mismo token', async () => {
    const r = await sol.post('/api/requisiciones', { client_token: 'tok-1', items: [] });
    assert.equal(r.data.id, reqId);
    assert.equal(r.data.duplicated, true);
  });

  test('Compras no ve borradores; el mismo departamento sí, otro no', async () => {
    assert.equal((await com.get(`/api/requisiciones/${reqId}`)).status, 404);
    assert.equal((await sol2.get(`/api/requisiciones/${reqId}`)).status, 404);
  });

  test('envío a Compras genera notificación', async () => {
    const r = await sol.post(`/api/requisiciones/${reqId}/enviar`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.status, 'enviada');
    const n = (await com.get('/api/notificaciones')).data;
    assert.ok(n.no_leidas >= 1);
    assert.ok(n.items.some((x) => x.title.includes(reqNumber)));
    assert.equal((await sol.post(`/api/requisiciones/${reqId}/enviar`)).status, 409);
  });

  test('Compras recibe, solicita corrección y el solicitante corrige', async () => {
    assert.equal((await com.post(`/api/requisiciones/${reqId}/recibir`)).data.status, 'en_revision');
    assert.equal((await com.post(`/api/requisiciones/${reqId}/devolver-solicitante`, {})).status, 400);
    const d = await com.post(`/api/requisiciones/${reqId}/devolver-solicitante`, { comment: 'Indique la marca exacta del filtro.' });
    assert.equal(d.data.status, 'devuelta_solicitante');
    const det = (await sol.get(`/api/requisiciones/${reqId}`)).data;
    assert.ok(det.actions.includes('editar'));
    const items = det.items.map((it) => ({ ...it, reference_file_id: it.reference_file ? undefined : null }));
    items[1].specifications = 'Marca Camfil';
    items[1].reference_file_id = null;
    const u = await sol.put(`/api/requisiciones/${reqId}`, {
      required_date: det.required_date, priority: 'urgente', justification: det.justification, items, submit: true,
    });
    assert.equal(u.status, 200, JSON.stringify(u.data));
    assert.equal(u.data.status, 'enviada');
    assert.equal(u.data.priority, 'urgente');
  });

  test('Compras cotiza y envía a Administración', async () => {
    await com.post(`/api/requisiciones/${reqId}/recibir`);
    const prov = (await com.get('/api/proveedores')).data;
    const det = (await com.get(`/api/requisiciones/${reqId}`)).data;
    assert.ok(det.actions.includes('enviar_administracion'));
    // Falta precio: no puede enviarse
    const fail = await com.post(`/api/requisiciones/${reqId}/enviar-administracion`, { currency: 'USD', items: [] });
    assert.equal(fail.status, 400);
    const q = await com.upload(`/api/requisiciones/${reqId}/cotizaciones`, { supplier_id: prov[0].id, amount: 160, currency: 'USD' });
    assert.equal(q.status, 201, JSON.stringify(q.data));
    const bad = await com.upload(`/api/requisiciones/${reqId}/cotizaciones`, { supplier_id: prov[0].id }, Buffer.from('MZ fake exe'), 'virus.pdf');
    assert.equal(bad.status, 400);
    const r = await com.post(`/api/requisiciones/${reqId}/enviar-administracion`, {
      currency: 'USD', purchasing_notes: 'Se recomienda proveedor 1.', comment: 'Revisado',
      items: [
        { id: det.items[0].id, approved_quantity: 10, supplier_id: prov[0].id, estimated_unit_price: 5 },
        { id: det.items[1].id, approved_quantity: 2, supplier_id: prov[0].id, estimated_unit_price: 50, purchasing_comment: 'OK' },
      ],
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.status, 'pendiente_aprobacion');
    assert.equal(r.data.estimated_total, 150);
  });

  test('el solicitante nunca recibe datos financieros', async () => {
    const det = (await sol.get(`/api/requisiciones/${reqId}`)).data;
    const json = JSON.stringify(det);
    for (const k of ['estimated_unit_price', 'estimated_total', 'quotations', 'invoices', 'purchases', 'supplier_name', 'currency']) {
      assert.ok(!json.includes(`"${k}"`), `filtra ${k}`);
    }
    assert.ok(det.attachments.every((a) => a.kind === 'referencia'));
    assert.ok(det.events.every((e) => !e.finance_only));
    const list = (await sol.get('/api/requisiciones')).data.items;
    assert.ok(list.every((x) => x.estimated_total === undefined));
    const quoteFile = (await com.get(`/api/requisiciones/${reqId}`)).data.quotations[0].file_url;
    assert.equal((await sol.get(quoteFile)).status, 403);
    assert.equal((await com.get(quoteFile)).status, 200);
  });

  test('Compras no puede aprobar ni ejecutar compras pendientes de aprobación', async () => {
    assert.equal((await com.post(`/api/requisiciones/${reqId}/aprobar`)).status, 403);
    const prov = (await com.get('/api/proveedores')).data;
    const det = (await com.get(`/api/requisiciones/${reqId}`)).data;
    const r = await com.post(`/api/requisiciones/${reqId}/compras`, {
      supplier_id: prov[0].id, purchase_date: today, currency: 'USD', items: [{ requisition_item_id: det.items[0].id, quantity: 1, unit_price: 5 }],
    });
    assert.equal(r.status, 409);
  });

  test('Administración devuelve a Compras y luego aprueba', async () => {
    assert.equal((await adm.post(`/api/requisiciones/${reqId}/rechazar`, {})).status, 400);
    const d = await adm.post(`/api/requisiciones/${reqId}/devolver`, { destino: 'compras', comment: 'Adjunte segunda cotización.' });
    assert.equal(d.data.status, 'devuelta_compras');
    await com.post(`/api/requisiciones/${reqId}/enviar-administracion`);
    const a = await adm.post(`/api/requisiciones/${reqId}/aprobar`, { comment: 'Aprobado' });
    assert.equal(a.status, 200, JSON.stringify(a.data));
    assert.equal(a.data.status, 'aprobada');
    assert.equal(a.data.approved_total, 150);
  });

  let purchaseId;
  test('Compras registra compra parcial respetando cantidades y monto aprobados', async () => {
    const prov = (await com.get('/api/proveedores')).data;
    const det = (await com.get(`/api/requisiciones/${reqId}`)).data;
    const over = await com.post(`/api/requisiciones/${reqId}/compras`, {
      supplier_id: prov[0].id, purchase_date: today, currency: 'USD', items: [{ requisition_item_id: det.items[0].id, quantity: 11, unit_price: 5 }],
    });
    assert.equal(over.status, 400);
    const expensive = await com.post(`/api/requisiciones/${reqId}/compras`, {
      supplier_id: prov[0].id, purchase_date: today, currency: 'USD', items: [{ requisition_item_id: det.items[0].id, quantity: 10, unit_price: 50 }],
    });
    assert.equal(expensive.status, 409);
    const p = await com.post(`/api/requisiciones/${reqId}/compras`, {
      supplier_id: prov[0].id, purchase_date: today, currency: 'USD', items: [{ requisition_item_id: det.items[0].id, quantity: 10, unit_price: 5.5 }],
    });
    assert.equal(p.status, 201, JSON.stringify(p.data));
    assert.equal(p.data.status, 'compra_parcial');
    purchaseId = p.data.purchases[0].id;
  });

  let invoiceId;
  test('Compras carga factura; aparece en la bandeja de Administración', async () => {
    const r = await com.upload(`/api/requisiciones/${reqId}/facturas`, { purchase_id: purchaseId, number: 'F-0001', invoice_date: today, amount: 55, currency: 'USD' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const dup = await com.upload(`/api/requisiciones/${reqId}/facturas`, { purchase_id: purchaseId, number: 'F-0001', invoice_date: today, amount: 55, currency: 'USD' });
    assert.equal(dup.status, 409);
    const noFile = await com.upload(`/api/requisiciones/${reqId}/facturas`, { purchase_id: purchaseId, number: 'F-0002', invoice_date: today, amount: 5, currency: 'USD' }, null);
    assert.equal(noFile.status, 400);
    const list = (await adm.get('/api/pagos')).data.items;
    const inv = list.find((i) => i.number === 'F-0001');
    assert.ok(inv);
    assert.equal(inv.payment_status, 'pendiente');
    assert.equal(inv.balance, 55);
    invoiceId = inv.id;
    const n = (await adm.get('/api/notificaciones')).data.items;
    assert.ok(n.some((x) => x.type === 'factura'));
  });

  test('Compras finaliza la compra y el estado pasa a pendiente de pago', async () => {
    const prov = (await com.get('/api/proveedores')).data;
    const det = (await com.get(`/api/requisiciones/${reqId}`)).data;
    const p2 = await com.post(`/api/requisiciones/${reqId}/compras`, {
      supplier_id: prov[1].id, purchase_date: today, currency: 'USD', items: [{ requisition_item_id: det.items[1].id, quantity: 1, unit_price: 50 }],
    });
    assert.equal(p2.data.status, 'compra_parcial');
    const fin = await com.post(`/api/requisiciones/${reqId}/finalizar-compra`, { comment: 'Solo había 1 filtro disponible.' });
    assert.equal(fin.data.status, 'facturada');
    const p2id = fin.data.purchases.find((p) => p.supplier_id === prov[1].id).id;
    const inv2 = await com.upload(`/api/requisiciones/${reqId}/facturas`, { purchase_id: p2id, number: 'B-77', invoice_date: today, amount: 50, currency: 'USD' });
    assert.equal(inv2.data.status, 'pendiente_pago');
  });

  test('Administración programa, registra pagos parciales y controla sobrepagos', async () => {
    const s = await adm.post(`/api/pagos/facturas/${invoiceId}/programar`, { amount: 30, scheduled_date: future, method: 'transferencia' });
    assert.equal(s.status, 201, JSON.stringify(s.data));
    assert.equal(s.data.payment_status, 'programado');
    const tooMuch = await adm.post(`/api/pagos/facturas/${invoiceId}/programar`, { amount: 30, scheduled_date: future, method: 'transferencia' });
    assert.equal(tooMuch.status, 400);
    const p1 = await adm.upload(`/api/pagos/facturas/${invoiceId}/pagos`, {
      amount: 30, paid_date: today, method: 'transferencia', reference: 'TRX-1', scheduled_payment_id: s.data.payments[0].id,
    });
    assert.equal(p1.status, 201, JSON.stringify(p1.data));
    assert.equal(p1.data.payment_status, 'parcial');
    assert.equal(p1.data.balance, 25);
    const over = await adm.upload(`/api/pagos/facturas/${invoiceId}/pagos`, { amount: 30, paid_date: today, method: 'transferencia', reference: 'TRX-2' }, null);
    assert.equal(over.status, 409);
    const overForced = await adm.upload(`/api/pagos/facturas/${invoiceId}/pagos`, {
      amount: 30, paid_date: today, method: 'transferencia', reference: 'TRX-2', extraordinary: true, extraordinary_reason: 'Ajuste por diferencial cambiario',
    }, null);
    assert.equal(overForced.status, 403);
    const dupRef = await adm.upload(`/api/pagos/facturas/${invoiceId}/pagos`, { amount: 5, paid_date: today, method: 'transferencia', reference: 'TRX-1' }, null);
    assert.equal(dupRef.status, 409);
    const p2 = await adm.upload(`/api/pagos/facturas/${invoiceId}/pagos`, { amount: 25, paid_date: today, method: 'transferencia', reference: 'TRX-3' }, null);
    assert.equal(p2.data.payment_status, 'pagado');
  });

  test('pago extraordinario con permiso individual queda auditado', async () => {
    const det = (await adm.get(`/api/requisiciones/${reqId}`)).data;
    const inv = det.invoices.find((i) => i.number === 'B-77');
    // El superadministrador concede el permiso individual a la gerente de Administración.
    const users = (await sup.get('/api/admin/usuarios')).data;
    const ger = users.find((u) => u.username === 'gerente.administracion');
    const upd = await sup.put(`/api/admin/usuarios/${ger.id}`, { ...ger, permisos_extra: ['pagos.sobrepago'] });
    assert.equal(upd.status, 200, JSON.stringify(upd.data));
    await adm.login('gerente.administracion');
    const noReason = await adm.upload(`/api/pagos/facturas/${inv.id}/pagos`, { amount: 52, paid_date: today, method: 'zelle', reference: 'Z-1', extraordinary: true }, null);
    assert.equal(noReason.status, 400);
    const ok = await adm.upload(`/api/pagos/facturas/${inv.id}/pagos`, {
      amount: 52, paid_date: today, method: 'zelle', reference: 'Z-1', extraordinary: true, extraordinary_reason: 'Incluye gastos de envío no facturados',
    }, null);
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    assert.equal(ok.data.overpaid, 2);
    const audit = (await sup.get('/api/admin/auditoria?accion=pago_extraordinario')).data;
    assert.equal(audit.total, 1);
  });

  test('requisición pagada y cerrada; línea de tiempo completa', async () => {
    const det = (await adm.get(`/api/requisiciones/${reqId}`)).data;
    assert.equal(det.status, 'pagada');
    const c = await adm.post(`/api/requisiciones/${reqId}/cerrar`, {});
    assert.equal(c.data.status, 'cerrada');
    const solDet = (await sol.get(`/api/requisiciones/${reqId}`)).data;
    assert.equal(solDet.status, 'cerrada');
    const actions = solDet.events.map((e) => e.action);
    for (const a of ['creacion', 'envio', 'recepcion', 'devolucion_solicitante', 'reenvio', 'envio_administracion', 'devolucion_compras', 'aprobacion', 'cierre']) {
      assert.ok(actions.includes(a), `evento ${a}`);
    }
    assert.ok(solDet.events.every((e) => e.created_at && e.action));
  });

  test('resúmenes por rol', async () => {
    const s = (await sol.get('/api/requisiciones/resumen')).data;
    assert.equal(s.solicitante.finalizadas, 1);
    assert.equal(s.administracion, undefined);
    const a = (await adm.get('/api/requisiciones/resumen')).data;
    assert.equal(a.administracion.pagos_realizados, 3);
    const rep = await adm.get('/api/reportes/gastos');
    assert.equal(rep.status, 200);
    assert.equal(rep.data.por_departamento[0].facturado, 105);
  });
});

describe('segregación de funciones y rechazo', () => {
  test('rechazo exige motivo y quien revisó no puede aprobar', async () => {
    const cat = (await sol2.get('/api/catalogo')).data;
    const r = await sol2.post('/api/requisiciones', {
      required_date: future, priority: 'normal', justification: 'Material para análisis microbiológico.',
      items: [{ article_id: cat.articulos[3].id, unit_id: cat.unidades[0].id, quantity: 3 }], submit: true,
    });
    assert.equal(r.data.status, 'enviada');
    await com.post(`/api/requisiciones/${r.data.id}/recibir`);
    const det = (await com.get(`/api/requisiciones/${r.data.id}`)).data;
    await com.post(`/api/requisiciones/${r.data.id}/enviar-administracion`, { currency: 'USD', items: [{ id: det.items[0].id, estimated_unit_price: 10 }] });
    // Un usuario de Compras al que se le concede aprobar no puede aprobar lo que él mismo revisó.
    const users = (await sup.get('/api/admin/usuarios')).data;
    const ana = users.find((u) => u.username === 'analista.compras');
    await sup.put(`/api/admin/usuarios/${ana.id}`, { ...ana, permisos_extra: ['req.aprobar'] });
    await com.login('analista.compras');
    const self = await com.post(`/api/requisiciones/${r.data.id}/aprobar`);
    assert.equal(self.status, 403);
    const rej = await adm.post(`/api/requisiciones/${r.data.id}/rechazar`, { comment: 'Fuera de presupuesto del trimestre.' });
    assert.equal(rej.data.status, 'rechazada');
    const n = (await sol2.get('/api/notificaciones')).data.items;
    assert.ok(n.some((x) => x.type === 'rechazada'));
  });

  test('superadministrador gestiona catálogo sin perder historial', async () => {
    const cat = (await sup.get('/api/admin/catalogo')).data;
    const art = cat.articulos.find((a) => a.usos > 0);
    const r = await sup.put(`/api/admin/articulos/${art.id}`, { ...art, active: false });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const pub = (await sol.get('/api/catalogo')).data.articulos;
    assert.ok(!pub.some((a) => a.id === art.id));
    const list = (await sup.get('/api/requisiciones')).data;
    assert.ok(list.total >= 1);
  });

  test('el superadministrador no ve datos financieros por defecto', async () => {
    const list = (await sup.get('/api/requisiciones')).data.items;
    assert.ok(list.every((x) => x.estimated_total === undefined));
  });
});
