const path = require('path');

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  DATA_DIR: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),

  MODALITA: {
    telefono: 'Telefono',
    email: 'Email',
  },

  // Possibili esiti di un contatto. Modificare qui per cambiare l'elenco.
  ESITI: [
    'Non risponde',
    'Da richiamare',
    'Interessato',
    'Appuntamento fissato',
    'Preventivo inviato',
    'Polizza emessa',
    'Non interessato',
    'Recapito errato',
  ],
};
