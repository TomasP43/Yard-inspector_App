'use strict';

/**
 * Zonas del equipo.
 *
 * El catalogo de desvios son ~70 nombres en una lista plana. Buscar "Matafuego
 * vencido" ahi adentro, de pie y con guantes, es el paso mas lento de la carga.
 * Agruparlos por la parte del equipo donde se mira el desvio convierte una
 * lista larga en dos toques: zona, despues item.
 *
 * Vive en el cliente y no en la base a proposito, por ahora: es una decision
 * de presentacion, no un dato de la inspeccion. Lo que se guarda sigue siendo
 * el id del desvio. Si mas adelante se quiere administrar desde un panel, esto
 * pasa a ser una columna `zona` en `desvio_catalogo` y este archivo se cae.
 *
 * **El catalogo manda, no esta lista.** Los nombres de aca se cruzan contra
 * `CAT.desvios`; lo que el catalogo tenga y aca no figure cae en "Otros". Esa
 * es la unica forma de que un desvio que agrega un inspector desde la app siga
 * siendo elegible sin tocar codigo.
 */
const Zonas = (() => {
  const MAPA = [
    { zona: 'Batea', icono: 'container', items: [
      // 'Óxido avanzado en batea' se fusiono con 'Óxido en batea': es el mismo
      // desvio y la severidad no la distinguia nadie de forma consistente. La
      // baja de verdad es del catalogo en la base (YI-007); sacarlo de aca solo
      // lo saca del preview, porque el catalogo manda sobre este mapa.
      // 'Óxido y suciedad en batea' tampoco existe mas: el campo es multivalor,
      // asi que la combinacion se carga marcando los dos. Como item propio
      // partia el mismo concepto en tres renglones. Ver YI-007.
      'Óxido en batea',
      // 'Suciedad avanzada en batea' se fusiono con 'Suciedad en batea', por lo
      // mismo que el oxido: la severidad no la distinguia nadie igual.
      'Suciedad en batea',
      'Bidones sueltos en batea',
      'Objetos sueltos en batea',
      'Sunchos sin acomodar',
      'Piso desoldado / roto',
      'Caño de batea desoldado',
      'Guitarra desoldada / quebrada / fisurada',
      'Rampa desoldada / caída',
      'Rampines trabados / sin orificios',
      'Sin rampines para Hiace',
      'No coinciden orificios de perno',
      'Equipo sin armar / desarmado',
      'Pintura desgastada',
      'Sin caballetes',
      'Garrafa de gas en batea'
    ] },
    { zona: 'Lona y cartelería', icono: 'flag', items: [
      'Lona en mal estado',
      'Lona trabada',
      'Guía de lona en mal estado',
      'Cartel / brazo de cartel dañado',
      'Perno faltante en cartel / brazo'
    ] },
    { zona: 'Hidráulico y motor', icono: 'gauge', items: [
      'Pérdida de aceite hidráulico',
      'Pérdida de gasoil / combustible',
      'Derrame en tanque',
      'Motor / bomba hidráulica sin funcionar',
      'Manguera hidráulica rota / pinchada',
      'Manguera rota / con pérdida',
      'Comandos / palancas faltantes',
      'Bandera sin funcionar',
      'Electroválvulas / cables de bandera'
    ] },
    { zona: 'Tractor y cabina', icono: 'truck', items: [
      'Tractor en mal estado',
      'Fisura en parabrisa',
      'Parabrisa polarizado / acrílico',
      'Paragolpe dañado',
      'Estribo roto / faltante',
      'Alarma de retroceso sin funcionar'
    ] },
    { zona: 'Ruedas', icono: 'circle-dot', items: [
      'Cubierta / rueda en mal estado',
      'Neumático gastado',
      'Rueda de auxilio en mal estado'
    ] },
    { zona: 'Elementos de seguridad', icono: 'shield-check', items: [
      'Matafuego vencido',
      'Matafuego descargado',
      'Matafuego sin anillo de seguridad',
      'Matafuego sin obleas',
      'Sin matafuego de cabina',
      'Línea de vida cortada / rota',
      'Soga precinto en mal estado / cortada',
      'Sin soga precinto'
    ] },
    { zona: 'Orden y documentación', icono: 'clipboard-check', items: [
      'Chofer sin EPP / EPP fuera de lugar',
      'Residuos en bahía',
      'Reposera / objetos no permitidos',
      'Patente en mal estado / ilegible',
      'Checklist sin completar / firmar'
    ] }
  ];

  const OTROS = { zona: 'Otros', icono: 'package', items: [] };

  /**
   * Misma normalizacion que usa el servidor para deduplicar: sin acentos, sin
   * mayusculas, sin puntuacion. Sin esto, 'Oxido en batea' del catalogo no
   * engancharia con 'Óxido en batea' de la lista de arriba y todo el catalogo
   * terminaria en "Otros".
   */
  const norm = (s) => Similitud.normalizar(s);

  /**
   * Nombres que el catalogo todavia tiene con la grafia vieja. Solo rutean a la
   * zona: la etiqueta que ve el inspector sale del catalogo, no de aca.
   *
   * Sin esto, un renombre en esta lista deja el nombre viejo sin mapear y el
   * desvio se cae a "Otros" en produccion hasta que corra la migracion. Es la
   * otra cara de "el catalogo manda": el mapa puede adelantarse, pero tiene que
   * seguir reconociendo lo que hay en la base.
   */
  const ALIAS = {
    // Se renombra en la migracion del catalogo (YI-010). Cubre el chofer sin
    // EPP puesto, que antes no tenia donde cargarse.
    'EPP fuera de lugar': 'Chofer sin EPP / EPP fuera de lugar'
  };

  const INDICE = new Map();
  MAPA.forEach((z, i) => z.items.forEach((n) => INDICE.set(norm(n), i)));
  Object.keys(ALIAS).forEach((viejo) => {
    const i = INDICE.get(norm(ALIAS[viejo]));
    if (i !== undefined) INDICE.set(norm(viejo), i);
  });

  /**
   * Reparte el catalogo real en zonas.
   *
   * Devuelve solo las zonas que tienen algo: una zona vacia es un boton que no
   * lleva a ningun lado. Los desvios que no estan mapeados -- los que agrega un
   * inspector, y cualquiera que quede fuera de la lista -- van a "Otros", que
   * aparece ultimo y solo si tiene contenido.
   */
  function repartir(desvios) {
    const cubos = MAPA.map((z) => ({ zona: z.zona, icono: z.icono, items: [] }));
    const otros = { ...OTROS, items: [] };

    (desvios || []).forEach((d) => {
      const i = INDICE.get(norm(d.nombre));
      (i === undefined ? otros : cubos[i]).items.push(d);
    });

    const salida = cubos.filter((z) => z.items.length);
    if (otros.items.length) salida.push(otros);
    return salida;
  }

  return { repartir, MAPA };
})();
