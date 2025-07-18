// server.js – v2.1 (Firestore + CORS arreglado)

/* -------------------------------------------------
   IMPORTS
--------------------------------------------------*/
const express      = require('express');
const cors         = require('cors');
const jwt          = require('jsonwebtoken');
const { Firestore } = require('@google-cloud/firestore');
const moment       = require('moment-timezone');

/* -------------------------------------------------
   APP & CORS
   – origin: '*' permite cualquier dominio (útil en pruebas).
     Si quieres restringir, pon la URL exacta de tu Netlify.
--------------------------------------------------*/
const app = express();
app.use(cors({ origin: '*' }));   // cabeceras para GET / POST
app.options('*', cors());         // responde a las pre-flight OPTIONS

app.use(express.json());

/* -------------------------------------------------
   CONFIGURACIÓN
--------------------------------------------------*/
const CONFIG_BASE = {
  timezone: 'America/Mexico_City',
  establecimiento: { lat: 19.533642, lng: -96.892007 },
  toleranciaMetros: 150,
  // Clave fija para firmar JWT (cámbiala cuando quieras)
  jwtSecret: 'RelojChecadorClaveSúperSecreta_2025!',
};

const firestore = new Firestore();

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
        nombre     : empleado.nombre,
        pin        : empleado.pin,
        fecha      : hoyStr,
        hora_entrada : ahora.toDate(),
        hora_salida  : null,
        token_sesion : token,
      };

      const doc = await registrosRef.add(nuevo);
      return res.status(201).json({
        success : true,
        message : 'Entrada registrada.',
        id_sesion: doc.id,
        token,
      });
    }

    /* -------- SALIDA -------- */
    const turnoDoc = snap.docs[0];
    const tokenCli = req.body.token;
    if (tokenCli !== turnoDoc.data().token_sesion) {
      return res.status(403).json({ success:false, error:'Token inválido.' });
    }

    const horaEnt  = moment(turnoDoc.data().hora_entrada.toDate());
    const horas    = ahora.diff(horaEnt, 'hours', true);

    await turnoDoc.ref.update({
      hora_salida     : ahora.toDate(),
      horas_trabajadas: +horas.toFixed(2),
    });

    return res.status(200).json({ success:true, message:'Salida registrada.' });
  } catch (err) {
    console.error('Error en /api/checada:', err);
    return res.status(500).json({ success:false, error:'Error procesando la checada.' });
  }
});

/* -------------------------------------------------
   ARRANQUE
--------------------------------------------------*/
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servidor v2.1 corriendo en puerto ${PORT}`);
});
