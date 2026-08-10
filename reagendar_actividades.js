require('dotenv').config();
const xmlrpc = require('xmlrpc');

const odooUrl = process.env.ODOO_URL;
const odooDb = process.env.ODOO_DB;
const odooUser = process.env.ODOO_USERNAME;
const odooPass = process.env.ODOO_PASSWORD;

const urlCommon = new URL(odooUrl + '/xmlrpc/2/common');
const urlObject = new URL(odooUrl + '/xmlrpc/2/object');

const clientCommon = urlCommon.protocol === 'https:' ? xmlrpc.createSecureClient(urlCommon.href) : xmlrpc.createClient(urlCommon.href);
const clientObject = urlObject.protocol === 'https:' ? xmlrpc.createSecureClient(urlObject.href) : xmlrpc.createClient(urlObject.href);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function formatearFechaLocal(fecha) {
    const year = fecha.getFullYear();
    const month = String(fecha.getMonth() + 1).padStart(2, '0');
    const day = String(fecha.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function sumarDias(fecha, dias) {
    let resultado = new Date(fecha);
    resultado.setDate(resultado.getDate() + dias);
    return resultado;
}

function obtenerProximoDiaLaboral(fecha) {
    let proximoDia = sumarDias(fecha, 1);
    while (proximoDia.getDay() === 0 || proximoDia.getDay() === 6) {
        proximoDia = sumarDias(proximoDia, 1);
    }
    return proximoDia;
}

function autenticarOdoo() {
    return new Promise((resolve, reject) => {
        clientCommon.methodCall('authenticate', [odooDb, odooUser, odooPass, {}], function (error, uid) {
            if (error) reject(error); else resolve(uid);
        });
    });
}

function buscarActividades(uid) {
    return new Promise((resolve, reject) => {
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'mail.activity', 'search_read',
            [[ ['date_deadline', 'in', ['2026-05-14', '2026-05-15', '2026-05-16']] ]],
            { fields: ['id', 'res_id', 'date_deadline', 'summary'] }
        ], function (error, result) {
            if (error) reject(error); else resolve(result);
        });
    });
}

function actualizarActividad(uid, idActividad, nuevaFecha) {
    return new Promise((resolve, reject) => {
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'mail.activity', 'write',
            [[idActividad], { date_deadline: nuevaFecha }]
        ], function (error, result) {
            if (error) reject(error); else resolve(result);
        });
    });
}

function dejarNotaEnOdoo(uid, leadId, nota) {
    return new Promise((resolve, reject) => {
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'crm.lead', 'message_post',
            [[leadId]], { body: nota }
        ], function (error, result) {
            resolve(result);
        });
    });
}

async function reagendar() {
    console.log("Iniciando reagendamiento...");
    try {
        const uid = await autenticarOdoo();
        const actividades = await buscarActividades(uid);
        
        if (actividades.length === 0) {
            console.log("No se encontraron actividades en esas fechas.");
            return;
        }
        
        console.log(`Se encontraron ${actividades.length} actividades para reagendar.`);
        
        let fechaHoyReal = new Date();
        let punteroFecha = obtenerProximoDiaLaboral(fechaHoyReal);
        let asignadasEseDia = 0;
        const LIMITE_DIARIO = 10;
        
        for (let i = 0; i < actividades.length; i++) {
            const act = actividades[i];
            
            if (asignadasEseDia >= LIMITE_DIARIO) {
                punteroFecha = obtenerProximoDiaLaboral(punteroFecha);
                asignadasEseDia = 0;
            }
            
            const fechaString = formatearFechaLocal(punteroFecha);
            
            await actualizarActividad(uid, act.id, fechaString);
            
            if (act.res_id) {
                await dejarNotaEnOdoo(uid, act.res_id, `Actividad "${act.summary}" reagendada del ${act.date_deadline} al ${fechaString} por corrección de calendario.`);
            }
            
            console.log(`Actividad ${act.id} movida de ${act.date_deadline} a ${fechaString}`);
            asignadasEseDia++;
            await sleep(500);
        }
        
        console.log("Reagendamiento completado.");
    } catch (err) {
        console.error("Error:", err);
    }
}

reagendar();
