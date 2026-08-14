'use strict';

/**
 * Identidad del usuario, apoyada en ttfa-docker.
 *
 * En produccion nginx ya bloqueo la request con auth_request antes de que
 * llegue aca, asi que si estamos ejecutando este codigo la cookie es valida.
 * Pero auth_request solo responde 200/401: no dice QUIEN es. Como el campo
 * Auditor sale del usuario logueado (en AppSheet era USEREMAIL()), hay que
 * preguntarle a ttfa por el email.
 *
 * En desarrollo no hay nginx delante, asi que se simula con DEV_USER_EMAIL.
 */

const TTFA_VERIFY_URL = process.env.TTFA_VERIFY_URL;
const DEV_USER_EMAIL = process.env.DEV_USER_EMAIL;
const isProd = process.env.NODE_ENV === 'production';

// Cache corto para no pegarle a ttfa en cada request de la sincronizacion,
// que puede llegar en rafagas cuando un inspector recupera senal.
const cache = new Map();
const TTL_MS = 60 * 1000;

async function resolverEmail(cookieHeader) {
  if (!isProd) {
    if (!DEV_USER_EMAIL) throw new Error('Falta DEV_USER_EMAIL en desarrollo');
    return DEV_USER_EMAIL;
  }

  if (!cookieHeader) return null;

  const hit = cache.get(cookieHeader);
  if (hit && hit.expira > Date.now()) return hit.email;

  const res = await fetch(TTFA_VERIFY_URL, {
    headers: { cookie: cookieHeader }
  });
  if (!res.ok) return null;

  const data = await res.json();
  const email = data.email || (data.user && data.user.email) || null;
  if (email) cache.set(cookieHeader, { email, expira: Date.now() + TTL_MS });
  return email;
}

/**
 * Middleware. Deja el usuario en req.usuario.
 *
 * Devuelve 401 con un cuerpo JSON explicito en vez de redirigir al login:
 * la PWA necesita distinguir "sesion vencida" de "sin conexion" para decidir
 * si reintenta la cola despues o si tiene que pedirle al inspector que
 * vuelva a loguearse. Si esto redirigiera, el fetch del service worker veria
 * un 200 con HTML de login y daria la sincronizacion por exitosa.
 */
async function requiereUsuario(req, res, next) {
  try {
    const email = await resolverEmail(req.headers.cookie);
    if (!email) {
      return res.status(401).json({ error: 'sesion_invalida' });
    }

    const { Usuario } = require('../database/models');
    const [usuario] = await Usuario.findOrCreate({
      where: { email },
      defaults: { email, rol: 'inspector' }
    });

    if (!usuario.activo) {
      return res.status(403).json({ error: 'usuario_inactivo' });
    }

    req.usuario = usuario;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requiereUsuario, resolverEmail };
