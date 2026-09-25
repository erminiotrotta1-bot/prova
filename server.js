const path = require('path');
const { PORT, DATA_DIR } = require('./src/config');
const { openDb } = require('./src/db');
const { createApp } = require('./src/app');

const db = openDb(path.join(DATA_DIR, 'portale.db'));
createApp(db).listen(PORT, () => {
  console.log(`Portale lead in ascolto su http://localhost:${PORT}`);
});
