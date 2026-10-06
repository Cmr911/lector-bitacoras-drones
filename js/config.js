/*
 * Configuración editable. Los valores 'TODO_CONFIGURAR' ocultan el botón o enlace correspondiente.
 * Solo se aceptan URLs https:// o mailto:.
 */
(function (root) {
  var config = {
    marca: 'Datos de Occidente',
    nombreHerramienta: 'Lector de bitácoras de vuelo',
    urlRepositorio: 'https://github.com/Cmr911/lector-bitacoras-drones',
    // Otras herramientas de Datos de Occidente (enlaces cruzados).
    urlCalculadora: 'https://cmr911.github.io/calculadora-aspersion-drones/',
    urlRegistro: 'https://cmr911.github.io/registro-aspersion-drones/',

    // WhatsApp: 'https://wa.me/57XXXXXXXXXX' · correo: 'mailto:correo@dominio.com'
    urlFeedback: 'TODO_CONFIGURAR',
    // Web, LinkedIn o Instagram de la marca.
    urlMarca: 'TODO_CONFIGURAR',

    // Mensajes prellenados (WhatsApp/correo) para saber desde qué parte de la app escriben.
    mensajes: {
      general: 'Hola, uso el Lector de bitácoras de vuelo. Me serviría una herramienta para: ',
      registro: 'Hola, uso el Lector de bitácoras de vuelo. Me serviría pasar estos vuelos al Registro de Aspersión. ',
      muestra: 'Hola, uso el Lector de bitácoras de vuelo. Puedo compartir una exportación anonimizada de mi plataforma para mejorar el lector. '
    }
  };
  if (typeof module === 'object' && module.exports) { module.exports = config; }
  else { root.DDO = root.DDO || {}; root.DDO.config = config; }
})(typeof self !== 'undefined' ? self : this);
