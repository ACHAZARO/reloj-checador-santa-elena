// server.js - v2.0 (MIGRACIÓN COMPLETA A FIRESTORE)

const express = require('express');
const jwt = require('jsonwebtoken');
const { Firestore } = require('@google-cloud/firestore'); // Librería para Firestore
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

// Inicializar el cliente de Firestore
const firestore = new Firestore();

// ===================================================================================
// HELPERS
// ===================================================================================
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const toRad = d => d * Math.PI / 180;
    const φ1 = toRad(lat1), φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1), Δλ = toRad(lon2 - lon1);
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ===================================================================================
// MIDDLEWARES (Adaptados para Firestore)
// ===================================================================================
async function loadData(req, res, next) {
    try {
        // Ahora leemos las colecciones de Firestore
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

function locationCheck(req, res, next) {
    const { lat, lon } = req.body;
    if (lat == null || lon == null) return res.status(400).json({ success: false, error: 'Ubicación requerida' });
    const dist = calculateDistance(lat, lon, CONFIG_BASE.establecimiento.lat, CONFIG_BASE.establecimiento.lng);
    if (dist > CONFIG_BASE.toleranciaMetros) return res.status(403).json({ success: false, error: `Estás a ${Math.round(dist)} m. Fuera de rango.` });
    next();
}

function verifyPin(req, res, next) {
    const { pin } = req.body;
    const { empleados } = req.firestoreData;
    
    if (!empleados || empleados.length === 0) {
        return res.status(500).json({ success: false, error: 'No hay empleados en la base de datos.' });
    }
    
    const empleadoEncontrado = empleados.find(emp => String(emp.pin) === String(pin));

    if (!empleadoEncontrado) {
        return res.status(404).json({ success: false, error: 'PIN no existe' });
    }
    
    req.empleado = empleadoEncontrado;
    next();
}

// ===================================================================================
// RUTAS DE LA API (Adaptadas para Firestore)
// ===================================================================================
app.post('/api/checada', [loadData, locationCheck, verifyPin], async (req, res) => {
    try {
        const { empleado } = req;
        const ahora = moment().tz(CONFIG_BASE.timezone);
        const hoyStr = ahora.format('YYYY-MM-DD');

        // Buscar si hay un turno abierto para este empleado hoy
        const registrosRef = firestore.collection('registros');
        const snapshot = await registrosRef
            .where('id_empleado', '==', empleado.id)
            .where('fecha', '==', hoyStr)
            .where('hora_salida', '==', null)
            .limit(1)
            .get();

        const esEntrada = snapshot.empty;

        if (esEntrada) {
            // LÓGICA DE ENTRADA
            const id_ses = `ses_${Date.now()}`;
            const token = jwt.sign({ id_sesion: id_ses, id_empleado: empleado.id }, CONFIG_BASE.jwtSecret, { expiresIn: '24h' });

            const nuevoRegistro = {
                id_empleado: empleado.id,
                nombre: empleado.nombre,
                pin: empleado.pin, // Guardamos el pin para referencia
                fecha: hoyStr,
                hora_entrada: ahora.toDate(), // Firestore usa objetos Date de JS
                hora_salida: null,
                horas_trabajadas: null,
                incidencia: 'normal', // Lógica de cobertura se puede añadir aquí
                info_adicional: '',
                status_aprobacion: 'pendiente',
                token_sesion: token
            };

            const docRef = await registrosRef.add(nuevoRegistro);
            res.status(201).json({ success: true, message: 'Entrada registrada en Firestore.', id_sesion: docRef.id, token });
        
        } else {
            // LÓGICA DE SALIDA
            const turnoAbiertoDoc = snapshot.docs[0];
            const tokenCliente = req.body.token;

            if (tokenCliente !== turnoAbiertoDoc.data().token_sesion) {
                return res.status(403).json({ success: false, error: 'Token inválido. No puedes checar salida.' });
            }

            const horaEntrada = moment(turnoAbiertoDoc.data().hora_entrada.toDate());
            const horasTrabajadas = ahora.diff(horaEntrada, 'hours', true).toFixed(2);

            await turnoAbiertoDoc.ref.update({
                hora_salida: ahora.toDate(),
                horas_trabajadas: parseFloat(horasTrabajadas)
            });
            
            res.status(200).json({ success: true, message: 'Salida registrada en Firestore.' });
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
