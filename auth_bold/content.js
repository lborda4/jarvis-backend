(() => {
  if (document.getElementById('jarvis-bold')) return;
  const ENDPOINT = 'https://jarvis-backend-y77r.onrender.com/bold/jarvis/test';
  let datos = null;
  let estado = 'listo';
  let timeoutBusqueda;
  let consultaActual = 0;

  // Flutter dibuja en canvas; un panel propio evita alterar sus controles.
  const panel = document.createElement('div');
  panel.id = 'jarvis-bold';
  panel.hidden = true;
  panel.style.cssText = 'position:fixed;left:160px;bottom:20px;z-index:2147483647;width:300px;max-width:calc(100vw - 180px);font:14px Arial,sans-serif;';
  const root = panel.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { color:#17324d; }
      section { background:white;border:1px solid #cbd5e1;border-radius:12px;padding:14px;box-shadow:0 4px 20px #0002; }
      strong { display:block;margin-bottom:8px;cursor:grab;touch-action:none;user-select:none; }
      strong:active { cursor:grabbing; }
      p { margin:8px 0;line-height:1.4; }
      button { width:100%;padding:12px;border:0;border-radius:8px;background:#298a35;color:white;font:600 15px Arial,sans-serif;cursor:pointer; }
      button:disabled { background:#64748b;cursor:default; }
      button:focus-visible { outline:3px solid #17324d;outline-offset:3px; }
      #estado { font-size:13px; }
      #estado:empty { display:none; }
      #revisado { margin-top:8px;background:white;color:#17324d;border:1px solid #cbd5e1;font-size:13px; }
      [hidden] { display:none !important; }
    </style>
    <section aria-label="Cobro con Bold">
      <strong id="titulo">JARVIS · Bold</strong>
      <p id="detalle"></p>
      <button id="enviar" type="button" disabled>Enviar a Bold</button>
      <p id="estado" role="status" aria-live="polite"></p>
      <button id="revisado" type="button" hidden>Ya revisé el datáfono · Habilitar otro envío</button>
    </section>`;
  const boton = root.getElementById('enviar');
  const detalle = root.getElementById('detalle');
  const mensaje = root.getElementById('estado');
  const revisado = root.getElementById('revisado');
  // Evitar que los eventos del panel lleguen a los controles de Siigo.
  for (const tipo of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keyup', 'touchstart', 'touchend']) {
    panel.addEventListener(tipo, evento => evento.stopPropagation());
  }
  document.body.appendChild(panel);

  const titulo = root.getElementById('titulo');
  let arrastre = null;

  function mover(left, top) {
    const rect = panel.getBoundingClientRect();
    panel.style.left = Math.max(0, Math.min(left, window.innerWidth - rect.width)) + 'px';
    panel.style.top = Math.max(0, Math.min(top, window.innerHeight - rect.height)) + 'px';
    panel.style.bottom = 'auto';
  }

  titulo.addEventListener('pointerdown', evento => {
    if (evento.button !== 0) return;
    evento.preventDefault();
    const rect = panel.getBoundingClientRect();
    arrastre = { id:evento.pointerId, x:evento.clientX - rect.left, y:evento.clientY - rect.top };
    titulo.setPointerCapture(evento.pointerId);
  });
  titulo.addEventListener('pointermove', evento => {
    if (!arrastre || evento.pointerId !== arrastre.id) return;
    mover(evento.clientX - arrastre.x, evento.clientY - arrastre.y);
  });
  for (const tipo of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    titulo.addEventListener(tipo, evento => {
      if (!arrastre || evento.pointerId !== arrastre.id) return;
      arrastre = null;
      if (titulo.hasPointerCapture(evento.pointerId)) titulo.releasePointerCapture(evento.pointerId);
    });
  }
  window.addEventListener('resize', () => {
    const rect = panel.getBoundingClientRect();
    mover(rect.left, rect.top);
  });

  function textos(elemento) {
    return [elemento.getAttribute('aria-label'), elemento.textContent, elemento.value]
      .filter(valor => typeof valor === 'string')
      .map(valor => valor.replace(/\s+/g, ' ').trim());
  }

  const CLAVE_CAJA = 'jarvis-bold-caja-seleccionada';
  let cajaSeleccionada = null;
  try { cajaSeleccionada = sessionStorage.getItem(CLAVE_CAJA); } catch {}

  function guardarCaja(caja) {
    cajaSeleccionada = caja;
    try {
      if (caja) sessionStorage.setItem(CLAVE_CAJA, caja);
      else sessionStorage.removeItem(CLAVE_CAJA);
    } catch {}
  }

  function leerCajaSeleccionada() {
    const candidatas = new Set();
    for (const campo of document.querySelectorAll('select, input, [role="combobox"], flt-semantics, [aria-label]')) {
      if (campo.closest('[hidden], [aria-hidden="true"], [role="option"], [role="listbox"]')) continue;
      const etiquetas = [campo.getAttribute('aria-label') || ''];
      for (const id of (campo.getAttribute('aria-labelledby') || '').split(/\s+/)) {
        const etiqueta = document.getElementById(id);
        if (etiqueta) etiquetas.push(etiqueta.textContent || '');
      }
      if (campo.labels) for (const etiqueta of campo.labels) etiquetas.push(etiqueta.textContent || '');
      // Solo el campo etiquetado Caja; no Sucursal, observaciones ni opciones del men?.
      const esCampoCaja = etiquetas.some(t => /^caja\s*\*?\s*$/i.test(t.trim()));
      const opciones = [...textos(campo)];
      if (esCampoCaja) {
        if (campo.selectedOptions?.length === 1) opciones.push(campo.selectedOptions[0].textContent);
        if (campo.parentElement) opciones.push(...textos(campo.parentElement));
      }
      for (const valor of opciones) {
        const texto = valor.replace(/\s+/g, ' ').trim();
        const combinado = texto.match(/^caja\s*\*?\s*:?\s+(?:banco\s+)?caja\s+(\d+)\s*$/i);
        const seleccionado = esCampoCaja && texto.match(/^(?:banco\s+)?caja\s+(\d+)\s*$/i);
        const caja = combinado?.[1] || seleccionado?.[1];
        if (caja) candidatas.add(caja);
      }
    }
    return candidatas.size === 1 ? [...candidatas][0] : null;
  }

  function capturarSeleccion(evento) {
    const accion = evento.composedPath().find(elemento =>
      elemento instanceof Element && textos(elemento).some(t => /^(ingresar|cerrar sesi[o?]n)$/i.test(t)));
    if (!accion) return;
    if (textos(accion).some(t => /^ingresar$/i.test(t))) {
      guardarCaja(leerCajaSeleccionada());
      console.log('[JARVIS Bold] Caja seleccionada:', cajaSeleccionada);
    } else guardarCaja(null);
  }
  // Capturar antes de que Flutter quite la pantalla de selecci?n.
  document.addEventListener('pointerdown', capturarSeleccion, true);
  document.addEventListener('click', capturarSeleccion, true);

  const accesibilidadActivada = new WeakSet();
  function activarAccesibilidad() {
    const control = document.querySelector('[aria-label="Enable accessibility"], flt-semantics-placeholder');
    if (control && !accesibilidadActivada.has(control)) {
      accesibilidadActivada.add(control);
      control.click();
    }
  }

  function leerDatos() {
    const valores = new Set();
    let enCobro = false;
    for (const elemento of document.querySelectorAll('flt-semantics, [aria-label], input, textarea')) {
      if (elemento.closest('[hidden], [aria-hidden="true"]')) continue;
      for (const texto of textos(elemento)) {
        if (/\bregistrar pago\b|\bpagos con tarjeta\b|\bvalor en tarjetas\b/i.test(texto)) enCobro = true;
        // Siigo puede exponer el resumen como texto, aria-label o ambos, sin dos puntos.
        const importe = texto.match(/valor en tarjetas\s*:?\s*(\$\s*[\d.]+,\d{2})/i)?.[1];
        if (importe) valores.add(importe.replace(/\s/g, ''));
      }
    }
    const valor = valores.size === 1 ? [...valores][0] : null;
    const total = valor ? Number(valor.replace(/[$.]/g, '').replace(',', '.')) : 0;
    return { enCobro, valor, total, caja:cajaSeleccionada };
  }

  function actualizar() {
    activarAccesibilidad();
    datos = leerDatos();
    panel.hidden = !datos.enCobro;
    detalle.textContent = datos
      ? `Tarjetas: ${datos.valor || '$0,00'}`
      : '';
    const valido = datos && datos.enCobro && datos.caja && Number.isFinite(datos.total) && datos.total > 0;
    boton.disabled = estado !== 'listo' || !valido;
    boton.textContent = estado === 'enviando' ? 'Enviando…' : `Enviar a Bold${valido ? ` · ${datos.valor}` : ''}`;
    revisado.hidden = estado !== 'enviado' && estado !== 'incierto';
    if (estado === 'listo') mensaje.textContent = '';
  }

  boton.addEventListener('click', async (evento) => {
    evento.preventDefault();
    evento.stopPropagation();
    actualizar();
    if (boton.disabled) return;
    const solicitud = { valor:datos.valor, caja:datos.caja };
    estado = 'enviando';
    mensaje.textContent = '';
    actualizar();
    try {
      const respuesta = await fetch(ENDPOINT, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify(solicitud),
        signal:AbortSignal.timeout(30000),
      });
      const resultado = await respuesta.json();
      if (!respuesta.ok || resultado.success !== true) throw new Error(`HTTP ${respuesta.status}`);
      console.log('[JARVIS Bold] Respuesta del backend:', resultado);
      estado = 'enviado';
      mensaje.textContent = resultado.response ? 'Esperando pago...' : 'Solicitud recibida por Jarvis.';
      if (resultado.response && resultado.statusToken) observarPago(resultado.statusToken, resultado.reference);
    } catch (error) {
      estado = 'incierto';
      mensaje.textContent = 'Error al enviar.';
      console.error('[JARVIS Bold] No se pudo confirmar la solicitud:', error);
    }
    actualizar();
  });

  async function observarPago(token, reference) {
    const consulta = ++consultaActual;
    const limite = Date.now() + 5 * 60_000;
    while (consulta === consultaActual && Date.now() < limite) {
      try {
        const respuesta = await fetch(new URL('/bold/payments/status?token=' + encodeURIComponent(token), ENDPOINT), {
          cache:'no-store', signal:AbortSignal.timeout(10000),
        });
        if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status);
        const resultado = await respuesta.json();
        if (consulta !== consultaActual) return;
        if (resultado.reference !== reference) throw new Error('Referencia diferente');
        const mensajes = { APPROVED:'Transacci\u00f3n aprobada', REJECTED:'Transacci\u00f3n rechazada', VOIDED:'Transacci\u00f3n anulada' };
        if (mensajes[resultado.status]) {
          mensaje.textContent = mensajes[resultado.status];
          actualizar();
          return;
        }
      } catch (error) {
        // Un fallo de consulta no significa que el pago fue rechazado. No reenviar.
        console.warn('[JARVIS Bold] No se pudo consultar el estado:', error);
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    if (consulta === consultaActual) mensaje.textContent = 'Sin confirmaci\u00f3n del pago.';
  }

  // No desbloquear por cambios de importe ni del DOM: podrían duplicar el cobro.
  revisado.addEventListener('click', () => {
    consultaActual++;
    estado = 'listo';
    actualizar();
  });

  // Solo actualiza la interfaz. Nunca envía cobros automáticamente.
  const observer = new MutationObserver(() => {
    clearTimeout(timeoutBusqueda);
    timeoutBusqueda = setTimeout(actualizar, 200);
  });
  observer.observe(document.body, {
    childList:true, subtree:true, characterData:true,
    attributes:true, attributeFilter:['aria-label'],
  });
  document.addEventListener('input', actualizar);
  document.addEventListener('change', actualizar);
  actualizar();
  console.log('[JARVIS] Botón Bold conectado a Siigo POS');
})();
