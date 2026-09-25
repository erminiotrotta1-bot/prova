# Portale Lead

Portale web per condividere con i collaboratori i lead ricevuti via file Excel
e tracciare per ciascuno **se è stato contattato, in che modo (telefono o email),
con quale esito** e con una **nota**.

## Funzionalità

- **Import Excel** (`.xls`, `.xlsx`, `.csv`) nel formato standard dei lead
  (Lead Id, Lead Type, Origine, Cognome, Nome, Email, Cellulare, …).
  Reimportare un file aggiorna i lead esistenti (chiave *Lead Id*) senza perdere
  contatti ed esiti. Le email con `?` al posto di `@` vengono corrette.
- **Elenco lead** con ricerca (nome, telefono, email, targa, codice fiscale),
  filtri per stato/ultimo esito, tipo e assegnazione, contatori "da contattare".
- **Scheda lead** con tutti i dati, link diretti per chiamare / scrivere,
  modulo *Registra contatto* (modalità + esito + nota) e storico completo dei
  contatti con operatore e data. Segnala se la stessa persona compare in altri
  lead (stesso cellulare o email) per evitare doppie chiamate.
- **Assegnazione**: l'amministratore assegna i lead; un collaboratore può
  prendere in carico un lead libero.
- **Export Excel** con l'ultimo contatto ed esito di ogni lead.
- **Utenti** con due ruoli: *amministratore* (import, export, gestione utenti)
  e *collaboratore* (consulta lead e registra contatti).

Gli esiti disponibili si modificano in `src/config.js`:
Non risponde, Da richiamare, Interessato, Appuntamento fissato,
Preventivo inviato, Polizza emessa, Non interessato, Recapito errato.

## Avvio

Serve Node.js 18 o superiore.

```bash
npm install
npm start          # http://localhost:3000
```

Al primo accesso il portale chiede di creare l'utente amministratore. Da
**Utenti** si creano poi gli account dei collaboratori e da **Importa** si
carica il file dei lead.

I dati sono salvati in un database SQLite in `data/portale.db`
(fare backup di questa cartella).

### Con Docker

```bash
docker build -t portale-lead .
docker run -d -p 3000:3000 -v portale-lead-data:/data -e COOKIE_SECURE=1 portale-lead
```

### Variabili d'ambiente

| Variabile        | Default   | Descrizione                                                            |
|------------------|-----------|------------------------------------------------------------------------|
| `PORT`           | `3000`    | Porta HTTP                                                             |
| `DATA_DIR`       | `./data`  | Cartella del database                                                  |
| `SESSION_SECRET` | generato  | Chiave di firma dei cookie di sessione (generata e salvata se assente) |
| `COOKIE_SECURE`  | –         | Impostare a `1` quando il portale è servito in HTTPS                   |

## Messa online

Il portale contiene dati personali dei clienti: pubblicarlo **solo in HTTPS**
(ad es. dietro un reverse proxy come Caddy o Nginx, oppure su un servizio come
Render/Railway/Fly.io con disco persistente) e impostare `COOKIE_SECURE=1`.
Non caricare i file Excel dei lead nel repository (sono esclusi da `.gitignore`).

### Nota sulla libreria Excel

La versione di SheetJS (`xlsx`) su npm è ferma alla 0.18.5, che ha due
vulnerabilità note (prototype pollution e ReDoS) sfruttabili con file
malevoli. Il rischio è contenuto perché solo gli amministratori possono
caricare file; per eliminarlo installare la versione aggiornata distribuita
da SheetJS:

```bash
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

## Test

```bash
npm test
```
