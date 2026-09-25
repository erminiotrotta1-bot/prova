const XLSX = require('xlsx');

// Colonne del file Excel dei lead -> colonne della tabella `leads`.
// Le intestazioni vengono confrontate in forma normalizzata (vedi normHeader),
// quindi spazi, maiuscole, apostrofi e punteggiatura non contano.
const COLUMNS = {
  'lead id': 'lead_id',
  'lead type': 'lead_type',
  'origine': 'origine',
  'cognome': 'cognome',
  'nome': 'nome',
  'cod fiscale': 'cod_fiscale',
  'targa': 'targa',
  'data scadenza polizza prec': 'scadenza_polizza',
  'email': 'email',
  'cellulare': 'cellulare',
  'cap': 'cap',
  'num civico': 'civico',
  'provincia': 'provincia',
  'comune': 'comune',
  'indirizzo': 'indirizzo',
  'identificativo preventivo': 'id_preventivo',
  'gia cliente': 'gia_cliente',
  'nome agenzia lead assegnata': 'agenzia',
  'consenso ricontatto lead': 'consenso',
  'data creazione lead': 'data_creazione',
  'data ultima modifica lead': 'data_modifica',
};

const DATE_FIELDS = ['scadenza_polizza', 'data_creazione', 'data_modifica'];

function normHeader(h) {
  return String(h)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// "03/01/2027" -> "2027-01-03". Valori non riconosciuti vengono lasciati invariati.
function toIsoDate(v) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (!m) return v;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// Nell'export di esempio la "@" delle email è sostituita da "?".
function fixEmail(v) {
  let e = v.trim().toLowerCase();
  if (!e.includes('@') && (e.match(/\?/g) || []).length === 1) e = e.replace('?', '@');
  return e;
}

/**
 * Legge un file Excel (.xls / .xlsx / .csv) e restituisce i lead trovati.
 * Lancia un errore se manca la colonna "Lead Id".
 */
function parseLeads(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  if (rows.length === 0) throw new Error('Il file è vuoto.');

  const mapping = rows[0].map((h) => COLUMNS[normHeader(h)] || null);
  if (!mapping.includes('lead_id')) {
    throw new Error('Colonna "Lead Id" non trovata nella prima riga del file.');
  }

  const leads = [];
  for (const row of rows.slice(1)) {
    const lead = {};
    mapping.forEach((field, i) => {
      if (field) lead[field] = String(row[i] ?? '').trim();
    });
    if (!lead.lead_id) continue;
    for (const f of DATE_FIELDS) if (lead[f]) lead[f] = toIsoDate(lead[f]);
    if (lead.email) lead.email = fixEmail(lead.email);
    leads.push(lead);
  }
  return leads;
}

const FIELDS = Object.values(COLUMNS);

/**
 * Inserisce o aggiorna i lead nel database (chiave: Lead Id).
 * Contatti già registrati e assegnazioni vengono mantenuti.
 */
function importLeads(db, leads) {
  const exists = db.prepare('SELECT 1 FROM leads WHERE lead_id = ?');
  const upsert = db.prepare(`
    INSERT INTO leads (${FIELDS.join(', ')})
    VALUES (${FIELDS.map((f) => '@' + f).join(', ')})
    ON CONFLICT (lead_id) DO UPDATE SET
      ${FIELDS.filter((f) => f !== 'lead_id').map((f) => `${f} = excluded.${f}`).join(', ')},
      updated_at = datetime('now')
  `);

  let nuovi = 0;
  let aggiornati = 0;
  db.transaction(() => {
    for (const lead of leads) {
      const row = Object.fromEntries(FIELDS.map((f) => [f, lead[f] ?? null]));
      if (exists.get(row.lead_id)) aggiornati++;
      else nuovi++;
      upsert.run(row);
    }
  })();
  return { nuovi, aggiornati };
}

module.exports = { parseLeads, importLeads };
