// server.js - VERSIÓN FINAL (Migrado a Firestore)

const express = require('express');
const jwt = require('jsonwebtoken');
const { Firestore } = require('@google-cloud/firestore');
const moment = require('moment-timezone');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ===================================================================================
// CONFIGURACIÓN
// ===================================================================================
const CONFIG_BASE = {
    timezone: 'America/Mexico_City',
    establecimiento: { lat: 19.533642, lng: -96.892007 },
    toleranciaMetros: 150,
    jwtSecret: 'CAMBIAR_A_UN_SECRETO_COMPLEJO'
};

// Inicializar Firestore
const firestore = new Firestore();

// ===================================================================================
// HELPERS Y MIDDLEWARES
// ===================================================================================
async function loadData(req, res, next) {
    try {
        const empleadosSnapshot = await firestore.collection('empleados').get();
        req.firestoreData = {
            empleados: empleadosSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        };
        next();
    } catch (err) {
        console.error('Error cargando datos de Firestore:', err);
        res.status(500).json({ success: false, error: 'Error al cargar datos' });
    }
}

function locationCheck(req, res, next) { /* ... Lógica de GPS sin cambios ... */ }
function verifyPin(req, res, next) {
    const { pin } = req.body;
    const { empleados } = req.firestoreData;
    const empleadoEncontrado = empleados.find(emp => String(emp.pin) === String(pin));

    if (!empleadoEncontrado) {
        return res.status(404).json({ success: false, error: 'PIN no existe' });
    }
    req.empleado = empleadoEncontrado;
    next();
}

// ===================================================================================
// RUTA DE CHECADA (Adaptada para Firestore)
// ===================================================================================
app.post('/api/checada', [loadData, locationCheck, verifyPin], async (req, res) => {
    try {
        const { empleado } = req;
        const ahora = moment().tz(CONFIG_BASE.timezone);
        const hoyStr = ahora.format('YYYY-MM-DD');

        const registrosRef = firestore.collection('registros');
        const snapshot = await registrosRef
            .where('id_empleado', '==', empleado.id)
            .where('fecha', '==', hoyStr)
            .where('hora_salida', '==', null)
            .limit(1)
            .get();

        const esEntrada = snapshot.empty;

        if (esEntrada) {
            const id_ses = `ses_${Date.now()}`;
            const token = jwt.sign({ id_sesion: id_ses, id_empleado: empleado.id }, CONFIG_BASE.jwtSecret, { expiresIn: '24h' });

            const nuevoRegistro = {
                id_empleado: empleado.id,
                nombre: empleado.nombre,
                fecha: hoyStr,
                hora_entrada: ahora.toDate(),
                hora_salida: null,
                incidencia: 'normal',
                token_sesion: token
            };
            const docRef = await registrosRef.add(nuevoRegistro);
            res.status(201).json({ success: true, message: 'Entrada registrada.', id_sesion: docRef.id, token });
        
        } else {
            const turnoAbiertoDoc = snapshot.docs[0];
            const tokenCliente = req.body.token;

            if (tokenCliente !== turnoAbiertoDoc.data().token_sesion) {
                return res.status(403).json({ success: false, error: 'Token inválido.' });
            }

            const horaEntrada = moment(turnoAbiertoDoc.data().hora_entrada.toDate());
            const horasTrabajadas = ahora.diff(horaEntrada, 'hours', true);

            await turnoAbiertoDoc.ref.update({
                hora_salida: ahora.toDate(),
                horas_trabajadas: parseFloat(horasTrabajadas.toFixed(2))
            });
            
            res.status(200).json({ success: true, message: 'Salida registrada.' });
        }
    } catch (error) {
        console.error('Error en /api/checada:', error);
        res.status(500).json({ success: false, error: 'Error procesando la checada.' });
    }
});

// ===================================================================================
// INICIAR SERVIDOR
// ===================================================================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Servidor v2.0 (Firestore) corriendo en puerto ${PORT}`);
});
