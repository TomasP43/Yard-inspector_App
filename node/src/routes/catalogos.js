'use strict';

const express = require('express');
const { requiereUsuario } = require('../helpers/auth');
const ctrl = require('../controllers/catalogos');

const router = express.Router();

router.use(requiereUsuario);
router.get('/', ctrl.todos);

module.exports = router;
