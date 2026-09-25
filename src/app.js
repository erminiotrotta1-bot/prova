const crypto = require('crypto');
const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const XLSX = require('xlsx');
const { MODALITA, ESITI } = require('./config');
const { parseLeads, importLeads } = require('./importer');

const PAGE_SIZE = 50;

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || '';
}

// I timestamp SQLite sono in UTC ("2026-09-25 17:22:36").
function fmtDateTime(ts) {
  if (!ts) return '';
  return new Date(ts.replace(' ', 'T') + 'Z').toLocaleString('it-IT', {
    timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short',
  });
}

function getSessionSecret(db) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'session_secret'").get();
  if (row) return row.value;
  const secret = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT INTO settings (key, value) VALUES ('session_secret', ?)").run(secret);
  return secret;
}

function createApp(db) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieSession({
    name: 'portale_lead',
    secret: getSessionSecret(db),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: 12 * 60 * 60 * 1000,
  }));

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

  // --- Utente corrente, CSRF, helper per le viste -------------------------
  app.use((req, res, next) => {
    if (!req.session.csrf) req.session.csrf = crypto.randomBytes(18).toString('hex');
    req.user = req.session.uid
      ? db.prepare('SELECT id, username, nome, role FROM users WHERE id = ? AND attivo = 1').get(req.session.uid)
      : null;
    if (req.session.uid && !req.user) req.session.uid = null;

    res.locals.user = req.user;
    res.locals.csrf = req.session.csrf;
    res.locals.flash = req.session.flash || null;
    req.session.flash = null;
    res.locals.fmtDate = fmtDate;
    res.locals.fmtDateTime = fmtDateTime;
    res.locals.MODALITA = MODALITA;
    res.locals.ESITI = ESITI;
    res.locals.path = req.path;
    next();
  });

  function flash(req, type, text) {
    req.session.flash = { type, text };
  }

  function checkCsrf(req, res, next) {
    const token = (req.body && req.body._csrf) || '';
    const expected = req.session.csrf || '';
    if (token.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      return res.status(403).render('error', { message: 'Sessione scaduta: ricarica la pagina e riprova.' });
    }
    next();
  }

  // Tutti i POST urlencoded passano dal controllo CSRF. L'upload (multipart)
  // lo esegue dopo multer, quando il body è disponibile.
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.is('application/x-www-form-urlencoded')) return checkCsrf(req, res, next);
    next();
  });

  const hasUsers = () => !!db.prepare('SELECT 1 FROM users LIMIT 1').get();

  function requireLogin(req, res, next) {
    if (!hasUsers()) return res.redirect('/setup');
    if (!req.user) return res.redirect('/login');
    next();
  }

  function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).render('error', { message: 'Accesso riservato agli amministratori.' });
    next();
  }

  // --- Primo avvio: creazione amministratore ------------------------------
  app.get('/setup', (req, res) => {
    if (hasUsers()) return res.redirect('/login');
    res.render('setup', { error: null });
  });

  app.post('/setup', (req, res) => {
    if (hasUsers()) return res.redirect('/login');
    const { username = '', nome = '', password = '' } = req.body;
    const error = validateUser(username, nome, password);
    if (error) return res.render('setup', { error });
    const info = db.prepare('INSERT INTO users (username, nome, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(username.trim(), nome.trim(), bcrypt.hashSync(password, 10), 'admin');
    req.session.uid = info.lastInsertRowid;
    flash(req, 'ok', 'Amministratore creato. Ora puoi importare il primo file di lead.');
    res.redirect('/admin/import');
  });

  // --- Login ----------------------------------------------------------------
  const failures = new Map(); // ip -> { count, until }

  app.get('/login', (req, res) => {
    if (!hasUsers()) return res.redirect('/setup');
    if (req.user) return res.redirect('/');
    res.render('login', { error: null, username: '' });
  });

  app.post('/login', (req, res) => {
    const ip = req.ip;
    const f = failures.get(ip);
    if (f && f.count >= 10 && f.until > Date.now()) {
      return res.status(429).render('login', { error: 'Troppi tentativi. Riprova tra qualche minuto.', username: '' });
    }
    const { username = '', password = '' } = req.body;
    const u = db.prepare('SELECT * FROM users WHERE username = ? AND attivo = 1').get(username.trim());
    if (!u || !bcrypt.compareSync(password, u.password_hash)) {
      const count = f && f.until > Date.now() ? f.count + 1 : 1;
      failures.set(ip, { count, until: Date.now() + 15 * 60 * 1000 });
      return res.status(401).render('login', { error: 'Utente o password non validi.', username });
    }
    failures.delete(ip);
    req.session.uid = u.id;
    res.redirect('/');
  });

  app.post('/logout', (req, res) => {
    req.session = null;
    res.redirect('/login');
  });

  app.use(requireLogin);

  app.get('/', (req, res) => res.redirect('/leads'));

  // --- Elenco lead ----------------------------------------------------------
  const LEAD_SELECT = `
    SELECT l.*, au.nome AS assegnato_nome,
           c.modalita AS ult_modalita, c.esito AS ult_esito, c.nota AS ult_nota,
           c.created_at AS ult_data, cu.nome AS ult_utente,
           (SELECT COUNT(*) FROM contatti x WHERE x.lead_id = l.id) AS n_contatti
    FROM leads l
    LEFT JOIN users au ON au.id = l.assegnato_a
    LEFT JOIN contatti c ON c.id = (SELECT MAX(id) FROM contatti x WHERE x.lead_id = l.id)
    LEFT JOIN users cu ON cu.id = c.user_id
  `;

  app.get('/leads', (req, res) => {
    const filters = {
      q: String(req.query.q || '').trim(),
      stato: String(req.query.stato || ''),
      tipo: String(req.query.tipo || ''),
      assegnati: String(req.query.assegnati || ''),
    };
    const where = [];
    const params = {};
    if (filters.q) {
      where.push(`(l.cognome || ' ' || l.nome LIKE @q OR l.nome || ' ' || l.cognome LIKE @q
        OR l.cellulare LIKE @q OR l.email LIKE @q OR l.targa LIKE @q
        OR l.cod_fiscale LIKE @q OR l.lead_id LIKE @q)`);
      params.q = `%${filters.q}%`;
    }
    if (filters.stato === 'da_contattare') where.push('c.id IS NULL');
    else if (filters.stato === 'contattati') where.push('c.id IS NOT NULL');
    else if (ESITI.includes(filters.stato)) { where.push('c.esito = @esito'); params.esito = filters.stato; }
    if (filters.tipo) { where.push('l.lead_type = @tipo'); params.tipo = filters.tipo; }
    if (filters.assegnati === 'miei') { where.push('l.assegnato_a = @me'); params.me = req.user.id; }
    else if (filters.assegnati === 'nessuno') where.push('l.assegnato_a IS NULL');

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM (${LEAD_SELECT} ${whereSql})`).get(params).n;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(pages, Math.max(1, parseInt(req.query.page, 10) || 1));
    const leads = db.prepare(`${LEAD_SELECT} ${whereSql}
      ORDER BY l.data_creazione DESC, l.id DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`).all(params);

    const stats = db.prepare(`
      SELECT COUNT(*) AS totale,
             SUM(NOT EXISTS (SELECT 1 FROM contatti c WHERE c.lead_id = l.id)) AS da_contattare
      FROM leads l`).get();
    const tipi = db.prepare("SELECT DISTINCT lead_type FROM leads WHERE lead_type <> '' ORDER BY 1").pluck().all();

    const qs = (p) => '?' + new URLSearchParams({ ...filters, page: p }).toString();
    res.render('leads', { leads, filters, stats, tipi, total, page, pages, qs });
  });

  // --- Dettaglio lead e registrazione contatto ------------------------------
  function loadLead(req, res, next) {
    const lead = db.prepare(`${LEAD_SELECT} WHERE l.id = ?`).get(req.params.id);
    if (!lead) return res.status(404).render('error', { message: 'Lead non trovato.' });
    req.lead = lead;
    next();
  }

  app.get('/leads/:id', loadLead, (req, res) => {
    const lead = req.lead;
    const contatti = db.prepare(`
      SELECT c.*, u.nome AS utente FROM contatti c JOIN users u ON u.id = c.user_id
      WHERE c.lead_id = ? ORDER BY c.id DESC`).all(lead.id);
    // Altri lead della stessa persona (stesso cellulare o email), per evitare doppie chiamate.
    const collegati = db.prepare(`${LEAD_SELECT}
      WHERE l.id <> @id AND ((@cell <> '' AND l.cellulare = @cell) OR (@email <> '' AND l.email = @email))
      ORDER BY l.id DESC`).all({ id: lead.id, cell: lead.cellulare || '', email: lead.email || '' });
    const utenti = req.user.role === 'admin'
      ? db.prepare('SELECT id, nome FROM users WHERE attivo = 1 ORDER BY nome').all()
      : [];
    res.render('lead', { lead, contatti, collegati, utenti, error: null, form: {} });
  });

  app.post('/leads/:id/contatti', loadLead, (req, res) => {
    const { modalita = '', esito = '', nota = '' } = req.body;
    let error = null;
    if (!MODALITA[modalita]) error = 'Indica la modalità di contatto (telefono o email).';
    else if (!ESITI.includes(esito)) error = "Seleziona l'esito del contatto.";
    else if (nota.length > 5000) error = 'La nota è troppo lunga (max 5000 caratteri).';
    if (error) {
      flash(req, 'error', error);
      return res.redirect(`/leads/${req.lead.id}#nuovo-contatto`);
    }
    db.prepare('INSERT INTO contatti (lead_id, user_id, modalita, esito, nota) VALUES (?, ?, ?, ?, ?)')
      .run(req.lead.id, req.user.id, modalita, esito, nota.trim());
    flash(req, 'ok', 'Contatto registrato.');
    res.redirect(`/leads/${req.lead.id}`);
  });

  app.post('/leads/:id/assegna', loadLead, (req, res) => {
    let target = req.body.user_id ? Number(req.body.user_id) : null;
    if (req.user.role !== 'admin') {
      // Un collaboratore può solo prendere in carico un lead libero, o rilasciare il proprio.
      const own = req.lead.assegnato_a === req.user.id;
      if (!(target === req.user.id && !req.lead.assegnato_a) && !(target === null && own)) {
        return res.status(403).render('error', { message: 'Operazione non consentita.' });
      }
    } else if (target && !db.prepare('SELECT 1 FROM users WHERE id = ? AND attivo = 1').get(target)) {
      target = null;
    }
    db.prepare("UPDATE leads SET assegnato_a = ?, updated_at = datetime('now') WHERE id = ?").run(target, req.lead.id);
    flash(req, 'ok', target ? 'Lead assegnato.' : 'Assegnazione rimossa.');
    res.redirect(`/leads/${req.lead.id}`);
  });

  app.post('/leads/:id/contatti/:cid/elimina', loadLead, requireAdmin, (req, res) => {
    db.prepare('DELETE FROM contatti WHERE id = ? AND lead_id = ?').run(req.params.cid, req.lead.id);
    flash(req, 'ok', 'Contatto eliminato.');
    res.redirect(`/leads/${req.lead.id}`);
  });

  // --- Account personale ----------------------------------------------------
  app.get('/account', (req, res) => res.render('account', { error: null }));

  app.post('/account', (req, res) => {
    const { attuale = '', nuova = '', conferma = '' } = req.body;
    const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    let error = null;
    if (!bcrypt.compareSync(attuale, u.password_hash)) error = 'La password attuale non è corretta.';
    else if (nuova.length < 8) error = 'La nuova password deve avere almeno 8 caratteri.';
    else if (nuova !== conferma) error = 'Le due password non coincidono.';
    if (error) return res.render('account', { error });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(nuova, 10), req.user.id);
    flash(req, 'ok', 'Password aggiornata.');
    res.redirect('/leads');
  });

  // --- Amministrazione: import ----------------------------------------------
  app.get('/admin/import', requireAdmin, (req, res) => {
    const storico = db.prepare(`
      SELECT i.*, u.nome AS utente FROM imports i LEFT JOIN users u ON u.id = i.user_id
      ORDER BY i.id DESC LIMIT 20`).all();
    res.render('import', { storico });
  });

  app.post('/admin/import', requireAdmin, upload.single('file'), checkCsrf, (req, res) => {
    if (!req.file) {
      flash(req, 'error', 'Seleziona un file Excel da caricare.');
      return res.redirect('/admin/import');
    }
    let result;
    try {
      const leads = parseLeads(req.file.buffer);
      if (leads.length === 0) throw new Error('Nessun lead trovato nel file.');
      result = importLeads(db, leads);
    } catch (e) {
      flash(req, 'error', `Import non riuscito: ${e.message}`);
      return res.redirect('/admin/import');
    }
    db.prepare('INSERT INTO imports (filename, user_id, nuovi, aggiornati) VALUES (?, ?, ?, ?)')
      .run(req.file.originalname, req.user.id, result.nuovi, result.aggiornati);
    flash(req, 'ok', `Import completato: ${result.nuovi} nuovi lead, ${result.aggiornati} aggiornati.`);
    res.redirect('/admin/import');
  });

  // --- Amministrazione: export ----------------------------------------------
  app.get('/admin/export', requireAdmin, (req, res) => {
    const rows = db.prepare(`${LEAD_SELECT} ORDER BY l.data_creazione DESC, l.id DESC`).all().map((l) => ({
      'Lead Id': l.lead_id,
      'Lead Type': l.lead_type,
      'Origine': l.origine,
      'Cognome': l.cognome,
      'Nome': l.nome,
      'Cod. Fiscale': l.cod_fiscale,
      'Targa': l.targa,
      'Data scadenza polizza prec.': fmtDate(l.scadenza_polizza),
      'Email': l.email,
      'Cellulare': l.cellulare,
      'Comune': l.comune,
      'Data creazione lead': fmtDate(l.data_creazione),
      'Assegnato a': l.assegnato_nome || '',
      'N. contatti': l.n_contatti,
      'Ultimo contatto': fmtDateTime(l.ult_data),
      'Modalità': l.ult_modalita ? MODALITA[l.ult_modalita] : '',
      'Esito': l.ult_esito || '',
      'Nota': l.ult_nota || '',
      'Operatore': l.ult_utente || '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Lead');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const today = new Date().toISOString().slice(0, 10);
    res.attachment(`lead-esiti-${today}.xlsx`).type('xlsx').send(buf);
  });

  // --- Amministrazione: utenti ----------------------------------------------
  function validateUser(username, nome, password) {
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username.trim())) return 'Nome utente: 3-40 caratteri tra lettere, numeri, punto, trattino.';
    if (!nome.trim()) return 'Inserisci nome e cognome.';
    if (password.length < 8) return 'La password deve avere almeno 8 caratteri.';
    return null;
  }

  function renderUsers(res, error, form = {}) {
    const utenti = db.prepare(`
      SELECT u.*, (SELECT COUNT(*) FROM contatti c WHERE c.user_id = u.id) AS n_contatti
      FROM users u ORDER BY u.attivo DESC, u.nome`).all();
    res.render('users', { utenti, error, form });
  }

  app.get('/admin/utenti', requireAdmin, (req, res) => renderUsers(res, null));

  app.post('/admin/utenti', requireAdmin, (req, res) => {
    const { username = '', nome = '', password = '', role = 'collaboratore' } = req.body;
    const error = validateUser(username, nome, password)
      || (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username.trim()) ? 'Nome utente già esistente.' : null);
    if (error) return renderUsers(res.status(400), error, { username, nome, role });
    db.prepare('INSERT INTO users (username, nome, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(username.trim(), nome.trim(), bcrypt.hashSync(password, 10), role === 'admin' ? 'admin' : 'collaboratore');
    flash(req, 'ok', `Utente ${username.trim()} creato.`);
    res.redirect('/admin/utenti');
  });

  app.post('/admin/utenti/:id/attivo', requireAdmin, (req, res) => {
    if (Number(req.params.id) === req.user.id) {
      flash(req, 'error', 'Non puoi disattivare il tuo stesso utente.');
    } else {
      db.prepare('UPDATE users SET attivo = 1 - attivo WHERE id = ?').run(req.params.id);
      flash(req, 'ok', 'Stato utente aggiornato.');
    }
    res.redirect('/admin/utenti');
  });

  app.post('/admin/utenti/:id/password', requireAdmin, (req, res) => {
    const password = req.body.password || '';
    if (password.length < 8) {
      flash(req, 'error', 'La password deve avere almeno 8 caratteri.');
    } else {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), req.params.id);
      flash(req, 'ok', 'Password reimpostata.');
    }
    res.redirect('/admin/utenti');
  });

  app.use((req, res) => res.status(404).render('error', { message: 'Pagina non trovata.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Il file è troppo grande (max 20 MB).' : 'Si è verificato un errore.';
    res.status(err.status || 500).render('error', { message });
  });

  return app;
}

module.exports = { createApp };
