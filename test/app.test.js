const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const XLSX = require('xlsx');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const { parseLeads } = require('../src/importer');

const HEADER = ['Lead Id', 'Lead Type', 'Origine', 'Cognome', 'Nome ', 'Cod. Fiscale', 'Targa',
  'Data scadenza polizza prec.', 'Email', 'Cellulare', 'CAP', 'Num. civico', 'Provincia', 'Comune',
  'Indirizzo', 'Identificativo preventivo', "gia' cliente", 'Nome agenzia Lead assegnata',
  'Consenso ricontatto lead', 'Data creazione lead', 'Data ultima modifica lead'];

function xls(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, ...rows]), 'Leads');
  return XLSX.write(wb, { type: 'buffer', bookType: 'biff8' });
}

const ROWS = [
  ['001', 'FASTQUOTE', '', 'ROSSI', 'MARIO', 'RSSMRA80A01F205X', 'AB123CD', '03/01/2027',
    'MARIO.ROSSI?EXAMPLE.COM', '3330000001', '20100', '1', 'MI', 'MILANO', 'VIA ROMA', '0000123', 'S', 'AGENZIA', 'S', '03/09/2026', '03/09/2026'],
  ['002', 'PORTALE', 'CASA', 'BIANCHI', 'ANNA', '', '', '', 'ANNA?EXAMPLE.COM', '3330000002',
    '20100', '2', 'MI', 'MILANO', 'VIA MILANO', '0000000', 'N', 'AGENZIA', 'S', '21/09/2026', '21/09/2026'],
  ['003', 'PORTALE', 'SALUTE', 'BIANCHI', 'ANNA', '', '', '', 'ANNA?EXAMPLE.COM', '3330000002',
    '20100', '2', 'MI', 'MILANO', 'VIA MILANO', '0000000', 'N', 'AGENZIA', 'S', '22/09/2026', '22/09/2026'],
];

let db, app;
beforeEach(() => {
  db = openDb(':memory:');
  app = createApp(db);
});

function csrfOf(html) {
  return /name="_csrf" value="([^"]+)"/.exec(html)[1];
}

async function setupAdmin() {
  const agent = request.agent(app);
  const page = await agent.get('/setup');
  await agent.post('/setup').type('form')
    .send({ _csrf: csrfOf(page.text), nome: 'Admin', username: 'admin', password: 'password123' })
    .expect(302);
  return agent;
}

async function csrf(agent, url = '/leads') {
  return csrfOf((await agent.get(url)).text);
}

async function postForm(agent, url, data) {
  const token = await csrf(agent);
  return agent.post(url).type('form').send({ _csrf: token, ...data });
}

async function importRows(agent, rows = ROWS) {
  const token = await csrf(agent, '/admin/import');
  return agent.post('/admin/import')
    .field('_csrf', token)
    .attach('file', xls(rows), 'leads.xls')
    .expect(302);
}

test('parseLeads normalizza date ed email', () => {
  const leads = parseLeads(xls(ROWS));
  assert.strictEqual(leads.length, 3);
  assert.strictEqual(leads[0].nome, 'MARIO');
  assert.strictEqual(leads[0].email, 'mario.rossi@example.com');
  assert.strictEqual(leads[0].scadenza_polizza, '2027-01-03');
  assert.strictEqual(leads[0].data_creazione, '2026-09-03');
});

test('parseLeads rifiuta file senza colonna Lead Id', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Nome'], ['X']]), 'S');
  assert.throws(() => parseLeads(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })), /Lead Id/);
});

test('senza utenti si viene mandati al setup', async () => {
  await request(app).get('/leads').expect(302).expect('Location', '/setup');
});

test('import, registrazione contatto ed esito', async () => {
  const agent = await setupAdmin();
  await importRows(agent);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 3);

  let list = await agent.get('/leads').expect(200);
  assert.match(list.text, /ROSSI/);
  assert.match(list.text, /<strong>3<\/strong> da contattare/);

  const lead = db.prepare("SELECT id FROM leads WHERE lead_id = '001'").get();
  assert.strictEqual((await postForm(agent, `/leads/${lead.id}/contatti`, { modalita: 'telefono', esito: 'Da richiamare', nota: 'Richiamare lunedì' })).status, 302);

  const c = db.prepare('SELECT * FROM contatti').get();
  assert.strictEqual(c.modalita, 'telefono');
  assert.strictEqual(c.esito, 'Da richiamare');
  assert.strictEqual(c.nota, 'Richiamare lunedì');

  const detail = await agent.get(`/leads/${lead.id}`).expect(200);
  assert.match(detail.text, /Richiamare lunedì/);

  list = await agent.get('/leads?stato=da_contattare').expect(200);
  assert.doesNotMatch(list.text, /ROSSI/);
  list = await agent.get('/leads?stato=Da+richiamare').expect(200);
  assert.match(list.text, /ROSSI/);
});

test('contatto senza modalità o esito valido viene rifiutato', async () => {
  const agent = await setupAdmin();
  await importRows(agent);
  const lead = db.prepare("SELECT id FROM leads WHERE lead_id = '001'").get();
  const token = await csrf(agent);
  await agent.post(`/leads/${lead.id}/contatti`).type('form')
    .send({ _csrf: token, modalita: 'fax', esito: 'Interessato' }).expect(302);
  await agent.post(`/leads/${lead.id}/contatti`).type('form')
    .send({ _csrf: token, modalita: 'email', esito: 'Boh' }).expect(302);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM contatti').get().n, 0);
});

test('reimport aggiorna i lead senza perdere i contatti', async () => {
  const agent = await setupAdmin();
  await importRows(agent);
  const lead = db.prepare("SELECT id FROM leads WHERE lead_id = '001'").get();
  await postForm(agent, `/leads/${lead.id}/contatti`, { modalita: 'email', esito: 'Interessato' });

  const changed = ROWS.map((r) => [...r]);
  changed[0][9] = '3339999999';
  changed.push(['004', ...ROWS[0].slice(1)]);
  await importRows(agent, changed);

  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 4);
  assert.strictEqual(db.prepare('SELECT cellulare FROM leads WHERE id = ?').get(lead.id).cellulare, '3339999999');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM contatti').get().n, 1);
  const imp = db.prepare('SELECT * FROM imports ORDER BY id DESC').get();
  assert.deepStrictEqual([imp.nuovi, imp.aggiornati], [1, 3]);
});

test('il dettaglio segnala altri lead dello stesso cliente', async () => {
  const agent = await setupAdmin();
  await importRows(agent);
  const lead = db.prepare("SELECT id FROM leads WHERE lead_id = '002'").get();
  const res = await agent.get(`/leads/${lead.id}`).expect(200);
  assert.match(res.text, /Stesso cliente anche in/);
  assert.match(res.text, /lead 003/);
});

test('i collaboratori non accedono alle funzioni di amministrazione', async () => {
  const admin = await setupAdmin();
  await importRows(admin);
  assert.strictEqual((await postForm(admin, '/admin/utenti', { nome: 'Luca Verdi', username: 'luca', password: 'segreta123', role: 'collaboratore' })).status, 302);

  const collab = request.agent(app);
  const login = await collab.get('/login');
  await collab.post('/login').type('form')
    .send({ _csrf: csrfOf(login.text), username: 'luca', password: 'segreta123' })
    .expect(302).expect('Location', '/');

  await collab.get('/leads').expect(200);
  await collab.get('/admin/import').expect(403);
  await collab.get('/admin/utenti').expect(403);
  await collab.get('/admin/export').expect(403);

  // Può prendere in carico un lead libero ma non assegnarlo ad altri.
  const lead = db.prepare("SELECT id FROM leads WHERE lead_id = '001'").get();
  const luca = db.prepare("SELECT id FROM users WHERE username = 'luca'").get();
  const token = await csrf(collab);
  await collab.post(`/leads/${lead.id}/assegna`).type('form').send({ _csrf: token, user_id: '1' }).expect(403);
  await collab.post(`/leads/${lead.id}/assegna`).type('form').send({ _csrf: token, user_id: String(luca.id) }).expect(302);
  assert.strictEqual(db.prepare('SELECT assegnato_a FROM leads WHERE id = ?').get(lead.id).assegnato_a, luca.id);
});

test('login errato e POST senza token CSRF vengono rifiutati', async () => {
  const admin = await setupAdmin();
  const anon = request.agent(app);
  const login = await anon.get('/login');
  await anon.post('/login').type('form')
    .send({ _csrf: csrfOf(login.text), username: 'admin', password: 'sbagliata' })
    .expect(401);
  await admin.post('/admin/utenti').type('form')
    .send({ nome: 'X', username: 'xxx', password: 'password123' })
    .expect(403);
});

test('export Excel con esiti', async () => {
  const agent = await setupAdmin();
  await importRows(agent);
  const lead = db.prepare("SELECT id FROM leads WHERE lead_id = '001'").get();
  await postForm(agent, `/leads/${lead.id}/contatti`, { modalita: 'telefono', esito: 'Appuntamento fissato', nota: 'giovedì' });

  const res = await agent.get('/admin/export').buffer(true)
    .parse((r, cb) => { const d = []; r.on('data', (c) => d.push(c)); r.on('end', () => cb(null, Buffer.concat(d))); })
    .expect(200);
  const wb = XLSX.read(res.body, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Lead);
  const rossi = rows.find((r) => r['Lead Id'] === '001');
  assert.strictEqual(rossi['Esito'], 'Appuntamento fissato');
  assert.strictEqual(rossi['Modalità'], 'Telefono');
  assert.strictEqual(rossi['Nota'], 'giovedì');
});
