/* ===================================================================
   Configuración editable del proyecto
   Cambia aquí los datos de la portada, el circuito y las zonas de la ECU.
   =================================================================== */
(function (root) {
  'use strict';

  const CONFIG = {
    proyecto: {
      titulo: 'Estimación de temperatura para ECU automotriz',
      subtitulo: 'Acondicionamiento de señal NTC e interpolación numérica',
      curso: 'Métodos Numéricos',
      docente: 'Miranda Fernandez, Josue Alfonzo',
      integrantes: [
        'Anton Puyen, Rahul Andre',
        'Fernandez Ventura, Nasya Azzaraia',
        'Audante Cordova, Pedro Moises',
        'Tineo Chinchay, Ronaldinho'
      ],
      anio: 2026
    },

    /* Conversor analógico-digital del Arduino UNO (10 bits, Vref = 5 V).
       faultLow / faultHigh: códigos que una ECU real consideraría como
       cortocircuito o circuito abierto del sensor (≈ 0.1 V y ≈ 4.9 V). */
    adc: { bits: 10, vref: 5.0, faultLow: 20, faultHigh: 1003 },

    /* Divisor de tensión con NTC de 10 kΩ (β = 3965 K) y resistencia fija de 10 kΩ.
       ntcPosicion indica dónde está conectado el NTC:
         'arriba' → NTC a +Vcc y R fija a tierra (como dice el informe).
                    Vout = Vcc · Rfija / (R_NTC + Rfija): sube al calentarse.
         'abajo'  → NTC a tierra y R fija a +Vcc.
                    Vout = Vcc · R_NTC / (R_NTC + Rfija): baja al calentarse.
       Prueba rápida en el prototipo: calienta el NTC con los dedos; si el valor
       del ADC sube, usa 'arriba'; si baja, usa 'abajo'. */
    circuito: { vcc: 5.0, rFija: 10000, r25: 10000, beta: 3965, ntcPosicion: 'arriba' },

    /* Rango de temperatura que muestra el indicador y que cubren las tablas generadas */
    temperatura: { min: -20, max: 120 },

    /* Zonas de actuación de la ECU (valores típicos de un motor convencional;
       cambian según el fabricante). Cada zona llega hasta `lt` (t < lt);
       la última recoge todo lo que queda por encima. */
    zonasEcu: [
      {
        id: 'calentamiento', nombre: 'Calentamiento', lt: 70, color: '#3d8bff',
        accion: 'Motor frío: enriquecimiento de mezcla (inyección alta) y ralentí elevado.',
        luces: ['cold'],
        salidas: {
          inyeccion: 'Enriquecimiento: pulso de inyección ampliado (mayor cuanto más frío)',
          ventilador: 'Apagado',
          ralenti: 'Elevado: la válvula IAC deja pasar más aire mientras el motor se calienta',
          lazo: 'Lazo abierto (sin corrección por sonda lambda)',
          mil: 'Apagada'
        }
      },
      {
        id: 'normal', nombre: 'Operación normal', lt: 100, color: '#35d07f',
        accion: 'Temperatura normal de operación: termostato abierto y mezcla en lazo cerrado.',
        luces: [],
        salidas: {
          inyeccion: 'Mezcla normal, sin enriquecimiento',
          ventilador: 'Apagado',
          ralenti: 'Normal',
          lazo: 'Lazo cerrado (corrige con la sonda lambda)',
          mil: 'Apagada'
        }
      },
      {
        id: 'ventilador', nombre: 'Ventilador activo', lt: 110, color: '#ffb020',
        accion: 'Temperatura alta: se enciende el electroventilador y la IAC compensa la carga.',
        luces: ['fan'],
        salidas: {
          inyeccion: 'Mezcla normal, sin enriquecimiento',
          ventilador: 'Encendido (se apaga unos 5 °C más abajo para no oscilar)',
          ralenti: 'La IAC compensa la carga eléctrica del ventilador',
          lazo: 'Lazo cerrado (corrige con la sonda lambda)',
          mil: 'Apagada'
        }
      },
      {
        id: 'sobrecalentamiento', nombre: 'Sobrecalentamiento', color: '#ff3b30',
        accion: 'Alerta: sobrecalentamiento. Luz de temperatura y estrategia de protección del motor.',
        luces: ['ect', 'fan'],
        salidas: {
          inyeccion: 'Estrategia de protección del motor (p. ej. limitar potencia, según el fabricante)',
          ventilador: 'Encendido a máxima velocidad',
          ralenti: 'Vigilado para evitar que el motor se apague',
          lazo: 'Lazo cerrado (corrige con la sonda lambda)',
          mil: 'Luz de temperatura encendida en el tablero'
        }
      }
    ],

    /* Lectura fuera de rango eléctrico (cortocircuito / circuito abierto del sensor) */
    zonaFalla: {
      id: 'falla', nombre: 'Falla del sensor ECT', color: '#ffb020',
      accion: 'La ECU descarta la lectura, usa un valor sustituto y enciende la luz de falla (MIL).',
      luces: ['mil', 'fan'],
      salidas: {
        inyeccion: 'Valor sustituto de temperatura (modo de emergencia)',
        ventilador: 'Encendido por seguridad',
        ralenti: 'Limitado / fijo',
        lazo: 'Estrategia de respaldo',
        mil: 'Encendida · se guarda un código de falla'
      }
    }
  };

  if (typeof module === 'object' && module.exports) module.exports = CONFIG;
  else root.ECU_CONFIG = CONFIG;
})(typeof self !== 'undefined' ? self : this);
