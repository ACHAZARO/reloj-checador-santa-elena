// server.js – v2.1 (Firestore + CORS arreglado)

/* -------------------------------------------------
   IMPORTS
--------------------------------------------------*/
const express       = require('express');
const cors          = require('cors');
const jwt           = require('jsonwebtoken');
const { Firestore } = require('@google-cloud/firestore');
const moment        = require('moment-timezone');

const payrollRoutes = require('./payroll/routes');

/* -------------------------------------------------
   APP & CORS
--------------------------------------------------*/
const app = express();

/* ---------- RESPUESTA MANUAL A OPTIONS ---------- */
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.status(204).send('');
  }
  next();
});
/* ------------------------------------------------- */

app.use(cors({ origin: '*' }));   // En producción puedes poner tu URL de Netlify
app.use(express.json());
app.use('/api/payroll', payrollRoutes);

/* -------------------------------------------------
   CONFIGURACIÓN
--------------------------------------------------*/
const CONFIG_BASE = {
  timezone: 'America/Mexico_City',
  establecimiento: { lat: 19.533642, lng: -96.892007 },
  toleranciaMetros: 150,
  jwtSecret: 'RelojChecadorClaveSúperSecreta_2025!',
  gerenteKey: 'CHEMEX17',
};

const firestore = new Firestore({ databaseId: 'reloj-checador-db' });

/* -------------------------------------------------
   HELPERS
--------------------------------------------------*/
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = d => (d * Math.PI) / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1), Δλ = toRad(lon2 - lon1);
  const a = Math.sin(Δφ / 2) ** 2 +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* -------------------------------------------------
   MIDDLEWARES
--------------------------------------------------*/
async function loadData(req, _res, next) {
  try {
    const empleadosSnap = await firestore.collection('empleados').get();
    req.firestoreData = {
      empleados: empleadosSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    };
    next();
  } catch (err) {
    console.error('Error cargando empleados:', err);
    next(err);
  }
}

function locationCheck(req, res, next) {
  const { lat, lon } = req.body;
  if (lat == null || lon == null) {
    return res.status(400).json({ success: false, error: 'Ubicación requerida.' });
  }
  const dist = calculateDistance(
    lat, lon,
    CONFIG_BASE.establecimiento.lat,
    CONFIG_BASE.establecimiento.lng,
  );
  if (dist > CONFIG_BASE.toleranciaMetros) {
    return res.status(403).json({
      success: false,
      error: `Estás a ${Math.round(dist)} m – fuera de rango.`,
    });
  }
  next();
}

function verifyPin(req, res, next) {
  const { pin } = req.body;
  const { empleados } = req.firestoreData;
  if (!empleados?.length) {
    return res.status(500).json({ success: false, error: 'Sin empleados en BD.' });
  }
  const emp = empleados.find(e => String(e.pin) === String(pin));
  if (!emp) return res.status(404).json({ success: false, error: 'PIN no existe.' });
  req.empleado = emp;
  next();
}

/* -------------------------------------------------
   RUTA PRINCIPAL /api/checada
--------------------------------------------------*/
app.post('/api/checada', [loadData, locationCheck, verifyPin], async (req, res) => {
  try {
    const { empleado } = req;
    const ahora   = moment().tz(CONFIG_BASE.timezone);
    const hoyStr  = ahora.format('YYYY-MM-DD');

    const registrosRef = firestore.collection('registros');
    const snap = await registrosRef
      .where('id_empleado', '==', empleado.id)
      .where('fecha',       '==', hoyStr)
      .where('hora_salida', '==', null)
      .limit(1)
      .get();

    const esEntrada = snap.empty;

    if (esEntrada) {
      /* -------- ENTRADA -------- */
      const id_ses = `ses_${Date.now()}`;
      const token  = jwt.sign(
        { id_sesion: id_ses, id_empleado: empleado.id },
        CONFIG_BASE.jwtSecret,
        { expiresIn: '24h' },
      );

      const nuevo = {
        id_empleado: empleado.id,
        nombre        : empleado.nombre,
        pin           : empleado.pin,
        fecha         : hoyStr,
        hora_entrada  : ahora.toDate(),
        hora_salida   : null,
        token_sesion  : token,
      };

      const doc = await registrosRef.add(nuevo);
      return res.status(201).json({
        success  : true,
        message  : 'Entrada registrada.',
        id_sesion: doc.id,
        token,
      });
    }

    /* -------- SALIDA -------- */
    const turnoDoc = snap.docs[0];
    const tokenCli = req.body.token;
    if (tokenCli !== turnoDoc.data().token_sesion) {
      return res.status(403).json({ success: false, error:'Token inválido.' });
    }

    const horaEnt  = moment(turnoDoc.data().hora_entrada.toDate());
    const horas    = ahora.diff(horaEnt, 'hours', true);

    await turnoDoc.ref.update({
      hora_salida     : ahora.toDate(),
      horas_trabajadas: +horas.toFixed(2),
    });

    return res.status(200).json({ success: true, message: 'Salida registrada.' });
  } catch (err) {
    console.error('Error en /api/checada:', err);
    return res.status(500).json({ success: false, error:'Error procesando la checada.' });
  }
});

/* -------------------------------------------------
   ARRANQUE Y RUTAS ADICIONALES
--------------------------------------------------*/
const PORT = process.env.PORT || 8080;

// ───────────── /api/clave-gerente ─────────────
app.get('/api/clave-gerente', async (req, res) => {
  try {
    const doc = await firestore
      .collection('parametros')
      .doc('contrasena_gerente')
      .get();

    if (!doc.exists) return res.status(404).json({ error: 'no_doc' });
    res.json({ valor: doc.get('valor') });
  } catch (e) {
    console.error('error /api/clave-gerente', e);
    res.status(500).json({ error: 'server' });
  }
});

// ───────────── /api/empleados (listar) ─────────────
app.get('/api/empleados', async (req, res) => {
  try {
    const snap = await firestore.collection('empleados')
      .where('deleted', '==', false).get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(list);
  } catch (err) {
    console.error('Error listando empleados:', err);
    res.status(500).json({ error: 'server' });
  }
});

// ───────────── /api/empleados (crear) ─────────────
app.post('/api/empleados', async (req, res) => {
  try {
    const { nombre, pin, salarioDiario, fechaIngreso } = req.body;
    if (!nombre || !pin || !salarioDiario) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }
    const pinSnap = await firestore.collection('empleados')
      .where('pin', '==', pin).get();
    if (!pinSnap.empty) {
      return res.status(409).json({ error: 'PIN ya existe' });
    }
    const nuevoEmpleado = {
      nombre,
      pin,
      basePayType : 'daily',
      basePay     : parseFloat(salarioDiario),
      status      : 'active',
      deleted     : false,
      fechaIngreso: fechaIngreso ? new Date(fechaIngreso) : new Date(),
      createdAt   : new Date(),
    };
    const docRef = await firestore.collection('empleados').add(nuevoEmpleado);
    res.status(201).json({ id: docRef.id, ...nuevoEmpleado });
  } catch (err) {
    console.error('Error creando empleado:', err);
    res.status(500).json({ error: 'server' });
  }
});

// 
// --- Resumen por empleado ---
app.get('/api/empleados/resumen', async (req, res) => {
  try {
    const empSnap = await firestore.collection('empleados')
      .where('deleted', '==', false).get();
    const resumen = [];
    for (const doc of empSnap.docs) {
      const empData = doc.data();
      // Suma las horas trabajadas del empleado
      const regsSnap = await firestore.collection('registros')
        .where('id_empleado', '==', doc.id).get();
      let totalHoras = 0;
      regsSnap.forEach(rDoc => {
        const horas = rDoc.data().horas_trabajadas;
        if (horas) totalHoras += parseFloat(horas);
      });
      resumen.push({
        id: doc.id,
        nombre: empData.nombre,
        fechaIngreso: empData.fechaIngreso || empData.createdAt || null,
        totalHoras: +totalHoras.toFixed(2),
      });
    }
    res.json(resumen);
  } catch (err) {
    console.error('Error generando resumen:', err);
    res.status(500).json({ error: 'server' });
  }
});

console.log("Arranque del servidor");
app.listen(PORT, () => {
  console.log(`Servidor v2.1 corriendo en puerto ${PORT}`);
});

module.exports = app;

