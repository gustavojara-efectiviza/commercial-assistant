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

function authenticate() {
    return new Promise((resolve, reject) => {
        clientCommon.methodCall('authenticate', [odooDb, odooUser, odooPass, {}], function (error, uid) {
            if (error) reject(error); else resolve(uid);
        });
    });
}

function searchCount(uid, domain) {
    return new Promise((resolve, reject) => {
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'crm.lead', 'search_count', [domain]
        ], function (error, count) {
            if (error) reject(error); else resolve(count);
        });
    });
}

async function getStats() {
    try {
        const uid = await authenticate();
        
        // 1. Oportunidades abiertas en total
        const abiertasTotal = await searchCount(uid, [['active', '=', true], ['type', '=', 'opportunity'], ['stage_id', 'not in', [4, 7, 8]]]);
        
        // 2. Oportunidades creadas en julio 2026
        const creadasJulio = await searchCount(uid, [
            ['type', '=', 'opportunity'],
            ['create_date', '>=', '2026-07-01 00:00:00'],
            ['create_date', '<=', '2026-07-31 23:59:59']
        ]);

        // 3. Ofertas enviadas en julio 2026
        // Stage 6 = Oferta enviada
        const ofertasEnviadasJulio = await searchCount(uid, [
            ['type', '=', 'opportunity'],
            ['stage_id', '=', 6],
            ['date_last_stage_update', '>=', '2026-07-01 00:00:00'],
            ['date_last_stage_update', '<=', '2026-07-31 23:59:59']
        ]);

        // 4. Ventas (Ganadas) en julio 2026
        // Stage 4 = Won
        const ventasJulio = await searchCount(uid, [
            ['type', '=', 'opportunity'],
            ['stage_id', '=', 4],
            ['date_closed', '>=', '2026-07-01 00:00:00'],
            ['date_closed', '<=', '2026-07-31 23:59:59']
        ]);
        
        // Tambien Ventas Totales Ganadas para tener contexto
        const ventasTotales = await searchCount(uid, [['type', '=', 'opportunity'], ['stage_id', '=', 4]]);

        console.log("=== ESTADÍSTICAS ===");
        console.log(`Oportunidades Abiertas Totales: ${abiertasTotal}`);
        console.log(`Oportunidades Creadas (Julio): ${creadasJulio}`);
        console.log(`Ofertas Enviadas (Julio): ${ofertasEnviadasJulio}`);
        console.log(`Ventas Cerradas (Julio): ${ventasJulio}`);
        console.log(`Ventas Totales Históricas: ${ventasTotales}`);
        
    } catch (e) {
        console.error("Error", e);
    }
}
getStats();
