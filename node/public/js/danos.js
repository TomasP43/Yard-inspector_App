'use strict';

/**
 * El daño de una unidad: catalogo, codigo AIAG y el formulario para cargarlo.
 *
 * **Vive aparte porque lo usan dos modulos.** Precarga registra el daño con el
 * que la unidad SALE y descarga el que aparecio en el camino, y el formulario
 * es identico: mismo catalogo de 110 partes, mismos 14 tipos, mismas seis
 * gravedades, misma foto obligatoria con su lectura de calidad.
 *
 * Estaba adentro de `precarga.js` y se saco cuando aparecio el segundo modulo,
 * por el mismo motivo por el que no se escribio un generador de PDF propio:
 * **dos implementaciones del mismo formulario se despegan**. Ver D-024.
 *
 * No guarda estado del formulario: lo recibe. El `estado` que pide es
 * `{ nuevo, ultima, danos }`, que es tal cual el `form` de los dos modulos, asi
 * que se le pasa entero. Lo unico propio es el catalogo, que es de la app y no
 * de una pantalla.
 *
 * Depende de globales que declara `app.js`, que carga DESPUES (`pedir`, `esc`,
 * `$`), asi que aca no se puede invocar nada de eso al definir el modulo --solo
 * adentro de las funciones--.
 */
const Danos = (() => {
  let CATA = null;

  /** Una sola vez por sesion. Los dos modulos lo piden y es el mismo catalogo. */
  async function cargar() {
    if (CATA) return CATA;
    CATA = await pedir('api/precarga/catalogos');
    return CATA;
  }

  /** Nunca null: la hoja lo lee sin preguntar si ya cargo. */
  const catalogo = () => CATA || { partes: [], tipos_dano: [], gravedades: [] };

  // ------------------------------------------------------------- catalogo

  const parteDe = (id) => ((CATA && CATA.partes) || []).find((p) => String(p.id) === String(id));
  const danoDe = (id) => ((CATA && CATA.tipos_dano) || []).find((d) => String(d.id) === String(id));
  const nombreParte = (id) => { const p = parteDe(id); return p ? p.nombre : 'Parte ' + id; };
  const nombreDano = (id) => { const d = danoDe(id); return d ? d.nombre : 'Daño ' + id; };

  const gravedadDe = (id) => ((CATA && CATA.gravedades) || []).find((x) => String(x.id) === String(id));
  const nombreGravedad = (id) => { const g = gravedadDe(id); return g ? g.nombre : null; };
  /** La version corta, para la tabla de la hoja: ahi el nombre entero se parte en tres lineas. */
  const gravedadCorta = (id) => { const g = gravedadDe(id); return g ? (g.corto || g.nombre) : null; };

  // ------------------------------------------------------------ codigo AIAG

  /**
   * El codigo AIAG de un daño: **area + tipo + gravedad**, cinco digitos.
   *
   * No se le pide al inspector: **se arma solo con lo que ya eligio**. El area
   * es el numero de la parte, el tipo el del daño, y la gravedad el unico paso
   * que se sumo. Pedirle un codigo a alguien que ya dijo «puerta delantera
   * izquierda, abollado, hasta 7,5 cm» seria pedirle lo mismo dos veces, y en
   * AppSheet ese campo se tipeaba a mano.
   *
   * Devuelve null cuando falta alguno de los tres, y eso pasa de verdad: 26
   * partes no tienen numero de area y `Fallo de pintura` no tiene tipo --AIAG es
   * un estandar de daño de TRANSPORTE y un defecto de pintura viene de planta--.
   * Un codigo a medias no es un codigo: en esos casos no se muestra ninguno y se
   * dice por que.
   */
  function codigoAiag(d) {
    const p = parteDe(d.parte_id);
    const ti = danoDe(d.tipo_dano_id);
    if (!p || !ti || p.aiag == null || ti.aiag == null || !d.gravedad) return null;
    return String(p.aiag).padStart(2, '0')
         + String(ti.aiag).padStart(2, '0')
         + String(d.gravedad);
  }

  /** Por que este daño no tiene codigo. Se dice, no se esconde. */
  function porQueSinCodigo(d) {
    const p = parteDe(d.parte_id);
    const ti = danoDe(d.tipo_dano_id);
    if (p && p.aiag == null) return 'la parte no tiene código de área';
    if (ti && ti.aiag == null) return 'ese tipo no existe en el estándar';
    if (!d.gravedad) return 'falta la gravedad';
    return 'faltan datos';
  }

  /**
   * El codigo, o el motivo de que no haya.
   *
   * Un daño viejo --cargado antes de que existiera este paso-- no tiene
   * gravedad, y la etiqueta lo dice en vez de romperse: el historico de
   * AppSheet nunca la tuvo, y son 4.268 registros.
   */
  function etiquetaCodigo(d) {
    const c = codigoAiag(d);
    if (!c) return `<span class="pc-aiag sin">sin código · ${esc(porQueSinCodigo(d))}</span>`;
    const p = parteDe(d.parte_id), ti = danoDe(d.tipo_dano_id);
    return `<span class="pc-aiag" title="Área ${p.aiag} · tipo ${ti.aiag} · tamaño ${d.gravedad}">${c}</span>`;
  }

  /** La marca que queda cuando la foto se aviso y se uso igual. */
  function marcaFoto(d) {
    const q = d.foto_calidad && d.foto_calidad.aviso;
    if (!q) return '';
    return `<span class="pc-aiag sin">foto: ${esc((Camara.TEXTO_AVISO[q] || q).toLowerCase())}</span>`;
  }

  /**
   * El aviso de que la foto puede no servir como prueba.
   *
   * **Avisa, no bloquea, y queda anotado.** Las tres cosas son la misma
   * decision. Bloquear seria decidir desde un heuristico que el inspector no
   * puede documentar un daño: una bahia sin luz o un auto mojado dan lecturas
   * malas con fotos que son lo unico que hay. Y no avisar deja la calidad de la
   * prueba colgada del pulso de quien saca.
   *
   * Lo que cierra el circulo es que **la marca viaja con el registro**: si la
   * foto se usa igual, quien la mire despues ve que se aviso. Ver D-019.
   *
   * El texto no reta. Dice que se ve y ofrece la salida; el boton de sacar otra
   * es el mismo que ya estaba.
   */
  function avisoFoto(foto) {
    if (!foto || !foto.calidad || !foto.calidad.aviso) return '';
    const q = foto.calidad.aviso;
    return `
      <p class="nota alerta pc-foto-aviso">
        ${ico('octagon-alert', 14)}
        <span>${esc(Camara.TEXTO_AVISO[q] || 'Puede no servir')}. Si es la única que se puede sacar, va igual.</span>
      </p>`;
  }

  // --------------------------------------------------------------- pintado

  /** Un daño ya cargado en el formulario, con su boton de sacarlo. */
  function filaDano(d, i) {
    return `
      <div class="pc-dano">
        ${d.foto ? `<img src="${d.foto.url}" alt="">` : `<span class="pc-sinfoto">${ico('image', 16)}</span>`}
        <span class="txt">
          <b>${esc(nombreParte(d.parte_id))}</b>
          <small>${esc(nombreDano(d.tipo_dano_id))}${d.comentario ? ' · ' + esc(d.comentario) : ''}</small>
          ${etiquetaCodigo(d)}
        </span>
        <button type="button" class="quitar" data-quitar-dano="${i}">${ico('x', 12)}</button>
      </div>`;
  }

  /**
   * Las partes del paso, ya filtradas y ordenadas.
   *
   * Con texto escrito busca sobre **todos los sectores**: el inspector sabe que
   * se golpeo la puerta trasera izquierda mucho antes de tener que decidir en
   * que sector la puso el formulario, y obligarlo a elegir sector primero le
   * cobra un paso por una clasificacion que es nuestra, no suya.
   *
   * Se normaliza con `Similitud.normalizar`, que saca los acentos: escribir
   * "optica" tiene que encontrar "Óptica" -- con guantes nadie pone la tilde.
   */
  function partesDelPaso(n) {
    const todas = (CATA && CATA.partes) || [];
    const q = (n.busca || '').trim();
    const base = q
      ? todas.filter((p) => Similitud.normalizar(p.nombre).includes(Similitud.normalizar(q)))
      : todas.filter((p) => p.grupo === (n.grupo || (todas[0] && todas[0].grupo)));

    // Por uso y no por codigo: cuatro partes son el 55% de los daños. "Otros"
    // siempre ultimo, que el cajon de sastre a mitad de lista invita a usarlo
    // antes de haber buscado.
    return base.slice().sort((a, b) =>
      (a.nombre === 'Otros') - (b.nombre === 'Otros')
      || (b.usos || 0) - (a.usos || 0)
      || a.nombre.localeCompare(b.nombre));
  }

  /** Las filas de la lista. Se repinta sola al escribir, sin tocar el resto. */
  function filasPartes(n) {
    const lista = partesDelPaso(n);
    if (!lista.length) {
      return `<p class="nota centro">Ninguna parte se llama así. Probá con menos letras, o cargala en <b>Otros</b> y contala en el comentario.</p>`;
    }
    const buscando = !!(n.busca || '').trim();
    return lista.map((p) => `
      <button type="button" class="pc-fila-parte" data-parte="${esc(p.id)}">
        <span class="txt">
          <b>${esc(p.nombre)}</b>
          ${buscando ? `<small>${esc(p.grupo)}</small>` : ''}
        </span>
        ${ico('chevron-left', 14)}
      </button>`).join('');
  }

  /**
   * El formulario de un daño nuevo.
   *
   * Recibe el `estado` del modulo --`{ nuevo, ultima, danos }`-- y no guarda
   * nada propio. `opciones.foto` es el selector del `<input type=file>` de quien
   * lo usa, que es lo unico que cambia entre precarga y descarga.
   */
  function subform(estado, opciones) {
    const n = estado.nuevo;
    if (!n) return '';
    const op = opciones || {};
    const todas = (CATA && CATA.partes) || [];
    const grupos = [];
    for (const p of todas) if (!grupos.includes(p.grupo)) grupos.push(p.grupo);
    const grupo = n.grupo || grupos[0];
    const buscando = !!(n.busca || '').trim();

    // Un auto golpeado suele estarlo en el mismo lugar, asi que el segundo daño
    // arranca donde termino el anterior en vez de volver a cero.
    const atajo = !n.parte_id && estado.ultima && estado.ultima.parte_id
      ? `<button type="button" class="pc-atajo" data-parte="${esc(estado.ultima.parte_id)}">
           ${ico('plus', 14)} Otro en ${esc(nombreParte(estado.ultima.parte_id))}
         </button>`
      : '';

    const paso1 = n.parte_id
      ? `<div class="pc-elegida">
           ${ico('check', 14)}
           <span class="txt"><b>${esc(nombreParte(n.parte_id))}</b><small>${esc(parteDe(n.parte_id).grupo)}</small></span>
           <button type="button" class="btn sec chico" id="pc-cambiar-parte">Cambiar</button>
         </div>`
      : `${atajo}
         <div class="buscador">
           ${ico('search', 14)}
           <input type="search" id="pc-busca" value="${esc(n.busca || '')}"
                  placeholder="Buscar parte…" autocomplete="off" enterkeyhint="search">
         </div>
         <div class="tags" id="pc-sectores"${buscando ? ' hidden' : ''}>
           ${grupos.map((g) => `<button type="button" class="tag${g === grupo ? ' sel' : ''}" data-grupo="${esc(g)}">${esc(g)}</button>`).join('')}
         </div>
         <div class="pc-partes" id="pc-lista-partes">${filasPartes(n)}</div>`;

    // Los tipos van ordenados por uso: Abollado y Rayado son el 77% de los
    // daños, y en el orden del catalogo quedaban cuarto y noveno.
    const tipos = ((CATA && CATA.tipos_dano) || []).slice()
      .sort((a, b) => (b.usos || 0) - (a.usos || 0));

    const paso2 = !n.parte_id ? '' : `
      <span class="eq-label pc-sep">Tipo de daño</span>
      <div class="tags">
        ${tipos.map((d) => `<button type="button" class="tag${String(d.id) === String(n.tipo_dano_id) ? ' sel' : ''}" data-tipodano="${esc(d.id)}">${esc(d.nombre)}</button>`).join('')}
      </div>

      ${!n.tipo_dano_id ? '' : `
        <span class="eq-label pc-sep">Tamaño del daño <b class="pc-req">obligatorio</b></span>
        <div class="pc-gravedad">
          ${((CATA && CATA.gravedades) || []).map((g) => `<button type="button" class="tag${String(g.id) === String(n.gravedad) ? ' sel' : ''}" data-grav="${esc(g.id)}"><i>${g.id}</i>${esc(g.nombre)}</button>`).join('')}
        </div>`}

      <label class="campo pc-sep">
        <span>Comentario</span>
        <input type="text" id="pc-com" value="${esc(n.comentario || '')}" placeholder="Opcional" autocomplete="off">
      </label>

      <span class="eq-label pc-sep">Foto del daño <b class="pc-req">obligatoria</b></span>
      <div class="fotos una">
        ${n.foto
          ? `<div class="foto"><img src="${n.foto.url}" alt=""><button type="button" class="quitar" data-quitar-foto-dano>${ico('x', 12)}</button></div>`
          : `<button type="button" class="foto-add" data-foto="dano">${ico('camera', 20)}<span>Foto del daño</span></button>`}
      </div>
      ${avisoFoto(n.foto)}`;

    const listo = n.parte_id && n.tipo_dano_id && n.gravedad && n.foto;
    const falta = !n.parte_id ? 'Elegí la parte'
      : !n.tipo_dano_id ? 'Elegí el tipo de daño'
      : !n.gravedad ? 'Elegí el tamaño'
      : !n.foto ? 'Falta la foto'
      : 'Agregar el daño';

    return `
      <div class="pc-nuevo">
        <div class="cab">
          <span class="eq-label">${esc(op.titulo || 'Nuevo daño')}${estado.danos.length ? ' · ' + (estado.danos.length + 1) + '.º' : ''}</span>
          <button type="button" class="ib sm" id="pc-cancel-dano" aria-label="Cancelar">${ico('x', 14)}</button>
        </div>
        ${paso1}
        ${paso2}
        <button type="button" class="btn chico" id="pc-ok-dano" ${listo ? '' : 'disabled'}>${falta}</button>
      </div>`;
  }

  // --------------------------------------------------------------- eventos

  /** El daño en blanco, sembrado con el sector del anterior. */
  const nuevoVacio = (estado) => ({
    grupo: (estado.ultima && estado.ultima.grupo) || null, busca: '',
    parte_id: null, tipo_dano_id: null, gravedad: null, comentario: '', foto: null
  });

  /**
   * Lee del DOM lo que el usuario escribio, antes de repintar.
   *
   * Sin esto, tocar cualquier boton rehace el HTML y se lleva puesto el
   * comentario a medio escribir.
   */
  function capturar(estado) {
    if (!estado || !estado.nuevo) return;
    const c = document.getElementById('pc-com');
    if (c) estado.nuevo.comentario = c.value.trim();
    const b = document.getElementById('pc-busca');
    if (b) estado.nuevo.busca = b.value;
  }

  /**
   * Los clics del subformulario. Devuelve `true` si lo manejo.
   *
   * `repintar` es la funcion de pintado del modulo que llama, y `opciones.foto`
   * el selector de su input de archivo.
   */
  function manejarClic(t, estado, repintar, opciones) {
    const op = opciones || {};
    const n = estado.nuevo;

    if (t.closest('#pc-cancel-dano')) { estado.nuevo = null; repintar(); return true; }

    const grupo = t.closest('[data-grupo]');
    if (grupo && n) {
      capturar(estado);
      n.grupo = grupo.dataset.grupo;
      n.parte_id = null;   // cambiar de grupo no puede dejar elegida una parte de otro
      repintar();
      return true;
    }

    const parte = t.closest('[data-parte]');
    if (parte && n) {
      capturar(estado);
      n.parte_id = parte.dataset.parte;
      const p = parteDe(n.parte_id);
      if (p) n.grupo = p.grupo;   // el sector queda donde esta la parte
      n.busca = '';
      repintar();
      return true;
    }

    if (t.closest('#pc-cambiar-parte') && n) { capturar(estado); n.parte_id = null; repintar(); return true; }

    const grav = t.closest('[data-grav]');
    if (grav && n) {
      capturar(estado);
      const g = Number(grav.dataset.grav);
      n.gravedad = n.gravedad === g ? null : g;
      repintar();
      return true;
    }

    const tipo = t.closest('[data-tipodano]');
    if (tipo && n) {
      capturar(estado);
      n.tipo_dano_id = n.tipo_dano_id === tipo.dataset.tipodano ? null : tipo.dataset.tipodano;
      repintar();
      return true;
    }

    if (t.closest('[data-foto]') && op.foto) {
      capturar(estado);
      const inp = document.querySelector(op.foto);
      if (inp) inp.click();
      return true;
    }
    if (t.closest('[data-quitar-foto-dano]') && n) { capturar(estado); n.foto = null; repintar(); return true; }

    const quitar = t.closest('[data-quitar-dano]');
    if (quitar) { estado.danos.splice(Number(quitar.dataset.quitarDano), 1); repintar(); return true; }

    if (t.closest('#pc-ok-dano')) {
      capturar(estado);
      if (!n || !n.parte_id || !n.tipo_dano_id || !n.gravedad || !n.foto) return true;
      estado.danos.push(n);
      estado.ultima = { grupo: n.grupo, parte_id: n.parte_id };
      estado.nuevo = null;
      repintar();
      return true;
    }

    return false;
  }

  /**
   * Lo que se escribe. Devuelve `true` si lo manejo.
   *
   * **Escribir NO repinta la pantalla**: repintar en cada tecla le roba el foco
   * al teclado y el inspector pierde la palabra a medio escribir. Solo se
   * actualiza el modelo, y la lista de partes se rehace sola.
   */
  function manejarInput(e, estado) {
    if (!estado || !estado.nuevo) return false;

    if (e.target.matches('#pc-com')) { estado.nuevo.comentario = e.target.value.trim(); return true; }

    if (e.target.matches('#pc-busca')) {
      estado.nuevo.busca = e.target.value;
      const caja = document.getElementById('pc-lista-partes');
      if (caja) caja.innerHTML = filasPartes(estado.nuevo);
      // Con texto escrito la busqueda cruza todos los sectores, asi que el
      // filtro por sector deja de significar algo y estorba.
      const sect = document.getElementById('pc-sectores');
      if (sect) sect.hidden = !!estado.nuevo.busca.trim();
      return true;
    }
    return false;
  }

  /**
   * La foto del daño que se esta componiendo, con su lectura de calidad.
   *
   * Va siempre al daño en curso: es la unica foto que el formulario pide.
   */
  async function tomarFoto(input, estado) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file || !estado || !estado.nuevo) return false;
    const { blob, calidad } = await Camara.comprimirConLectura(file);
    estado.nuevo.foto = { blob, url: URL.createObjectURL(blob), calidad };
    return true;
  }

  return {
    cargar, catalogo,
    parte: parteDe, tipo: danoDe, nombreParte, nombreDano,
    nombreGravedad, gravedadCorta,
    codigoAiag, porQueSinCodigo, etiquetaCodigo, marcaFoto, avisoFoto,
    filaDano, filasPartes, subform,
    nuevoVacio, capturar, manejarClic, manejarInput, tomarFoto
  };
})();
