'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { sequelize } = require('./database/models');

const app = express();
const PORT = process.env.PORT || 3002;

// Las fotos van en base64 dentro del JSON de sincronizacion, por eso el
// limite alto: una inspeccion puede traer hasta 3 fotos ya comprimidas.
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());

app.get('/health', (req, res) => res.json({ ok: true }));

// Las inspecciones nunca se cachean: el service worker cachea el app shell,
// jamas los datos. Los catalogos son la excepcion y manejan su propio ETag
// (ver controllers/catalogos.js), por eso el no-store no va montado en /api.
app.use('/api/inspecciones', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use('/api/inspecciones', require('./routes/inspecciones'));
app.use('/api/catalogos', require('./routes/catalogos'));

// Fotos ya subidas. Mismo directorio que usa fotoService.
app.use(
  '/uploads',
  express.static(process.env.UPLOADS_DIR || '/app/uploads', {
    maxAge: '30d',
    immutable: true
  })
);

// PWA
app.use(express.static(path.join(__dirname, '..', 'public')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'error_interno' });
});

async function main() {
  await sequelize.authenticate();
  console.log('[db] conectado');
  app.listen(PORT, () => console.log(`[http] escuchando en :${PORT}`));
}

main().catch((err) => {
  console.error('[fatal] no se pudo arrancar:', err);
  process.exit(1);
});
