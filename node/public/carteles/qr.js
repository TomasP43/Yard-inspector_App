'use strict';

/**
 * Generador de codigos QR.
 *
 * Escrito a mano porque el cartel se imprime desde la intranet, que **no sale a
 * internet**: no hay CDN ni servicio de generacion al que pedirle la imagen.
 *
 * Alcance deliberadamente chico: modo byte, versiones 1 a 4, correccion de
 * errores **nivel H (30%)**. Eso alcanza para 34 caracteres, y los tokens de
 * bahia son de ocho. El nivel H no es capricho: el sticker vive en una playa,
 * se ensucia y se raya, y con H el codigo sigue leyendose con casi un tercio
 * de la superficie arruinada.
 *
 * **No confiar en que esto anda porque compila.** Un QR mal armado se ve igual
 * de bien que uno bueno: son cuadraditos negros. La prueba que vale es leer lo
 * generado con el mismo `BarcodeDetector` que usa la app -- eso hace
 * `verificar()` en cartel.js, y si falla no se imprime nada.
 */
const QR = (() => {

  // --- GF(256), primitivo 0x11d ------------------------------------------
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (() => {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  /** Polinomio generador de Reed-Solomon para `grado` codewords de control. */
  function generador(grado) {
    let p = [1];
    for (let i = 0; i < grado; i++) {
      const q = [1, EXP[i]];
      const r = new Array(p.length + 1).fill(0);
      for (let a = 0; a < p.length; a++) {
        for (let b = 0; b < q.length; b++) r[a + b] ^= mul(p[a], q[b]);
      }
      p = r;
    }
    return p;
  }

  /** Codewords de correccion para un bloque de datos. */
  function ecc(datos, grado) {
    const gen = generador(grado);
    const res = new Array(datos.length + grado).fill(0);
    datos.forEach((d, i) => { res[i] = d; });
    for (let i = 0; i < datos.length; i++) {
      const coef = res[i];
      if (!coef) continue;
      for (let j = 0; j < gen.length; j++) res[i + j] ^= mul(gen[j], coef);
    }
    return res.slice(datos.length);
  }

  // --- tablas de version, solo nivel H -----------------------------------
  //
  // `bloques` son los codewords de DATOS de cada bloque; `ec` los de control
  // por bloque. Los totales cierran: v3 = 2*(13+22) = 70, v4 = 4*(9+16) = 100.
  const VERSIONES = {
    1: { size: 21, ec: 17, bloques: [9],           alineacion: [] },
    2: { size: 25, ec: 28, bloques: [16],          alineacion: [6, 18] },
    3: { size: 29, ec: 22, bloques: [13, 13],      alineacion: [6, 22] },
    4: { size: 33, ec: 16, bloques: [9, 9, 9, 9],  alineacion: [6, 26] }
  };

  const capacidad = (v) => VERSIONES[v].bloques.reduce((a, b) => a + b, 0);

  /** La version mas chica que entra. Mas chico = modulos mas grandes al imprimir. */
  function versionPara(bytes) {
    for (const v of [1, 2, 3, 4]) {
      // 4 bits de modo + 8 de longitud = 12 bits de encabezado.
      if (bytes + 2 <= capacidad(v)) return Number(v);
    }
    throw new Error('El dato no entra en un QR version 4 nivel H (maximo 34 bytes)');
  }

  // --- armado del flujo de bits ------------------------------------------

  function codewordsDe(texto, version) {
    const bytes = new TextEncoder().encode(texto);
    if (bytes.length > 255) throw new Error('dato demasiado largo');

    const bits = [];
    const push = (valor, largo) => {
      for (let i = largo - 1; i >= 0; i--) bits.push((valor >> i) & 1);
    };

    push(0b0100, 4);            // modo byte
    push(bytes.length, 8);      // longitud (versiones 1-9)
    bytes.forEach((b) => push(b, 8));

    const total = capacidad(version) * 8;
    // Terminador: hasta cuatro ceros, o menos si no hay lugar.
    for (let i = 0; i < 4 && bits.length < total; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);

    const cw = [];
    for (let i = 0; i < bits.length; i += 8) {
      cw.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    }
    // Relleno alternado que manda la norma.
    const RELLENO = [0xec, 0x11];
    let k = 0;
    while (cw.length < capacidad(version)) cw.push(RELLENO[k++ % 2]);
    return cw;
  }

  /**
   * Parte en bloques, calcula la correccion de cada uno y los **intercala**.
   *
   * El intercalado es lo que hace que una mancha grande no se coma un bloque
   * entero: los codewords quedan repartidos por todo el simbolo.
   */
  function intercalar(cw, version) {
    const { bloques, ec: grado } = VERSIONES[version];
    const datos = [];
    const control = [];
    let p = 0;
    bloques.forEach((largo) => {
      const b = cw.slice(p, p + largo);
      p += largo;
      datos.push(b);
      control.push(ecc(b, grado));
    });

    const salida = [];
    const maxDatos = Math.max(...bloques);
    for (let i = 0; i < maxDatos; i++) {
      datos.forEach((b) => { if (i < b.length) salida.push(b[i]); });
    }
    for (let i = 0; i < grado; i++) {
      control.forEach((b) => salida.push(b[i]));
    }
    return salida;
  }

  // --- matriz -------------------------------------------------------------

  function matrizVacia(size) {
    return {
      m: Array.from({ length: size }, () => new Array(size).fill(null)),
      size
    };
  }

  function patronBusqueda(M, fila, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const y = fila + r;
        const x = col + c;
        if (y < 0 || y >= M.size || x < 0 || x >= M.size) continue;
        const borde = r === -1 || r === 7 || c === -1 || c === 7;
        const anillo = (r >= 0 && r <= 6 && (c === 0 || c === 6))
          || (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const centro = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        M.m[y][x] = borde ? 0 : (anillo || centro ? 1 : 0);
      }
    }
  }

  function patronAlineacion(M, version) {
    const pos = VERSIONES[version].alineacion;
    for (const fy of pos) {
      for (const fx of pos) {
        // No van encima de los patrones de busqueda.
        if (M.m[fy][fx] !== null) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            const borde = Math.max(Math.abs(r), Math.abs(c));
            M.m[fy + r][fx + c] = (borde === 1) ? 0 : 1;
          }
        }
      }
    }
  }

  function armarBase(version) {
    const size = VERSIONES[version].size;
    const M = matrizVacia(size);

    patronBusqueda(M, 0, 0);
    patronBusqueda(M, 0, size - 7);
    patronBusqueda(M, size - 7, 0);

    // Temporizacion: la fila y la columna 6 alternan.
    for (let i = 8; i < size - 8; i++) {
      const v = i % 2 === 0 ? 1 : 0;
      if (M.m[6][i] === null) M.m[6][i] = v;
      if (M.m[i][6] === null) M.m[i][6] = v;
    }

    patronAlineacion(M, version);

    // Modulo oscuro, siempre negro.
    M.m[size - 8][8] = 1;

    return M;
  }

  /** Reserva las celdas del formato para que no las use el dato. */
  function reservarFormato(M) {
    const s = M.size;
    for (let i = 0; i < 9; i++) {
      if (M.m[8][i] === null) M.m[8][i] = 'f';
      if (M.m[i][8] === null) M.m[i][8] = 'f';
    }
    for (let i = s - 8; i < s; i++) {
      if (M.m[8][i] === null) M.m[8][i] = 'f';
      if (M.m[i][8] === null) M.m[i][8] = 'f';
    }
  }

  /** Recorrido en zigzag de derecha a izquierda, salteando la columna 6. */
  function colocarDatos(M, bytes) {
    const s = M.size;
    const bits = [];
    bytes.forEach((b) => { for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1); });

    let idx = 0;
    let arriba = true;
    for (let col = s - 1; col > 0; col -= 2) {
      if (col === 6) col--;   // la columna de temporizacion no lleva datos
      for (let i = 0; i < s; i++) {
        const fila = arriba ? s - 1 - i : i;
        for (const c of [col, col - 1]) {
          if (M.m[fila][c] !== null) continue;
          M.m[fila][c] = idx < bits.length ? bits[idx] : 0;
          idx++;
        }
      }
      arriba = !arriba;
    }
  }

  const MASCARAS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ];

  /**
   * Penalizacion de la norma. Se prueban las ocho mascaras y gana la de menor
   * puntaje: la que deja menos rachas largas, menos bloques macizos y menos
   * figuras que se parecen a un patron de busqueda.
   */
  function penalidad(m, s) {
    let p = 0;

    // Regla 1: rachas de 5 o mas del mismo color.
    const racha = (get) => {
      for (let a = 0; a < s; a++) {
        let run = 1;
        for (let b = 1; b < s; b++) {
          if (get(a, b) === get(a, b - 1)) { run++; }
          else { if (run >= 5) p += 3 + (run - 5); run = 1; }
        }
        if (run >= 5) p += 3 + (run - 5);
      }
    };
    racha((a, b) => m[a][b]);
    racha((a, b) => m[b][a]);

    // Regla 2: bloques macizos de 2x2.
    for (let r = 0; r < s - 1; r++) {
      for (let c = 0; c < s - 1; c++) {
        const v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
      }
    }

    // Regla 3: la figura 1011101 con cuatro claros a un lado.
    const PAT = [1, 0, 1, 1, 1, 0, 1];
    const busca = (get) => {
      for (let a = 0; a < s; a++) {
        for (let b = 0; b + 7 <= s; b++) {
          let ok = true;
          for (let k = 0; k < 7; k++) if (get(a, b + k) !== PAT[k]) { ok = false; break; }
          if (!ok) continue;
          const antes = b >= 4 && [1, 2, 3, 4].every((k) => get(a, b - k) === 0);
          const despues = b + 10 < s && [7, 8, 9, 10].every((k) => get(a, b + k) === 0);
          if (antes || despues) p += 40;
        }
      }
    };
    busca((a, b) => m[a][b]);
    busca((a, b) => m[b][a]);

    // Regla 4: desbalance entre claros y oscuros.
    let oscuros = 0;
    for (let r = 0; r < s; r++) for (let c = 0; c < s; c++) oscuros += m[r][c];
    const pct = (oscuros * 100) / (s * s);
    p += Math.floor(Math.abs(pct - 50) / 5) * 10;

    return p;
  }

  /** Informacion de formato: nivel H + mascara, con BCH(15,5). */
  function bitsFormato(mascara) {
    const datos = (0b10 << 3) | mascara;   // 10 = nivel H
    let v = datos << 10;
    for (let i = 4; i >= 0; i--) {
      if (v & (1 << (i + 10))) v ^= 0x537 << i;
    }
    return ((datos << 10) | v) ^ 0x5412;
  }

  function ponerFormato(M, mascara) {
    const s = M.size;
    const f = bitsFormato(mascara);

    /**
     * **El bit mas significativo va primero.** Es el error que tuvo esto y
     * costo encontrar: poniendolos de menos a mas significativo el QR sale
     * perfectamente dibujado -- patrones, temporizacion, datos, todo bien -- y
     * **ningun lector lo abre**, porque el formato le dice el nivel de
     * correccion y la mascara equivocados. Se ve igual de bien que uno bueno.
     */
    const bit = (i) => (f >> (14 - i)) & 1;

    // Copia de arriba a la izquierda, rodeando el patron de busqueda.
    for (let i = 0; i <= 5; i++) M.m[8][i] = bit(i);
    M.m[8][7] = bit(6);
    M.m[8][8] = bit(7);
    M.m[7][8] = bit(8);
    for (let i = 9; i <= 14; i++) M.m[14 - i][8] = bit(i);

    // Segunda copia: los primeros ocho por la columna, el resto por la fila.
    for (let i = 0; i <= 7; i++) M.m[s - 1 - i][8] = bit(i);
    for (let i = 8; i <= 14; i++) M.m[8][s - 15 + i] = bit(i);

    // El modulo oscuro pisa al ultimo de la columna, y va SIEMPRE en 1. Se
    // reafirma despues del formato porque comparten esa celda.
    M.m[s - 8][8] = 1;
  }

  /**
   * Genera la matriz del QR. Devuelve `{ size, modulos }`, con `modulos[y][x]`
   * en 1 (oscuro) o 0 (claro).
   */
  function generar(texto) {
    const bytes = new TextEncoder().encode(texto).length;
    const version = versionPara(bytes);

    const cw = codewordsDe(texto, version);
    const finales = intercalar(cw, version);

    const base = armarBase(version);
    reservarFormato(base);

    // Se guarda cuales celdas son de funcion ANTES de poner datos: la mascara
    // no puede tocarlas.
    const esFuncion = base.m.map((fila) => fila.map((v) => v !== null));

    colocarDatos(base, finales);

    let mejor = null;
    for (let k = 0; k < 8; k++) {
      const m = base.m.map((fila, r) => fila.map((v, c) => {
        if (esFuncion[r][c]) return v === 'f' ? 0 : v;
        return MASCARAS[k](r, c) ? v ^ 1 : v;
      }));
      const copia = { m, size: base.size };
      ponerFormato(copia, k);
      const p = penalidad(copia.m, copia.size);
      if (!mejor || p < mejor.p) mejor = { p, m: copia.m };
    }

    return { size: base.size, modulos: mejor.m, version };
  }

  /** El QR como SVG, con el margen silencioso de 4 modulos que pide la norma. */
  function svg(texto, lado) {
    const { size, modulos } = generar(texto);
    const quiet = 4;
    const total = size + quiet * 2;
    let d = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (modulos[r][c]) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}"
      width="${lado}" height="${lado}" shape-rendering="crispEdges">
      <rect width="${total}" height="${total}" fill="#fff"/>
      <path d="${d}" fill="#000"/>
    </svg>`;
  }

  /**
   * Vectores de prueba, para que no se imprima un QR roto nunca mas.
   *
   * Las huellas se calcularon con este codificador **despues de verificarlo
   * contra un decodificador real** (jsQR): los cinco casos se generaron, se
   * rasterizaron y se leyeron de vuelta devolviendo su texto. Si alguien toca
   * el codificador y cambia un modulo, la huella deja de coincidir y la pagina
   * se niega a imprimir.
   *
   * No prueba que el algoritmo sea correcto desde cero -- prueba que sigue
   * siendo **el mismo que se verifico**. Y eso es lo que hace falta aca: un QR
   * mal generado se ve identico a uno bueno, asi que el error no aparece hasta
   * que el sticker esta pegado en la playa y el inspector no puede trabajar.
   * Ya paso una vez: los bits de formato iban al reves y ningun lector abria
   * el codigo.
   */
  const VECTORES = {
    'b5-ujv': '5bc2f2f6',
    'A': 'adacc5e5',
    'hola mundo 123': 'fc4129af',
    'bahia-08-TOKEN-largo-x': 'f6bbb885',
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWX': 'd805f5ec'
  };

  function huella(texto) {
    const m = generar(texto).modulos.map((f) => f.join('')).join('|');
    let h = 0x811c9dc5;
    for (let i = 0; i < m.length; i++) {
      h ^= m.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  /** Corre los vectores. Devuelve la lista de los que fallan, vacia si esta bien. */
  function autoprueba() {
    const fallas = [];
    Object.keys(VECTORES).forEach((t) => {
      let h;
      try { h = huella(t); } catch (e) { h = 'error: ' + e.message; }
      if (h !== VECTORES[t]) fallas.push({ texto: t, esperado: VECTORES[t], obtenido: h });
    });
    return fallas;
  }

  return { generar, svg, autoprueba, huella };
})();
