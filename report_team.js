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

function searchRead(uid, domain, fields) {
    return new Promise((resolve, reject) => {
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'crm.lead', 'search_read', [domain], { fields: fields }
        ], function (error, results) {
            if (error) reject(error); else resolve(results);
        });
    });
}

function sumRevenue(leads) {
    return leads.reduce((sum, lead) => sum + (lead.expected_revenue || 0), 0);
}

async function generateReport() {
    try {
        const uid = await authenticate();
        const userIds = [31, 36, 43]; // Gustavo Jara, Andrea Tejera, Arnulfo Amarilla

        // 1. Ofertas enviadas en Julio (stage_id = 6)
        const ofertasEnviadasJulio = await searchRead(uid, [
            ['user_id', 'in', userIds],
            ['type', '=', 'opportunity'],
            ['stage_id', '=', 6],
            ['date_last_stage_update', '>=', '2026-07-01 00:00:00'],
            ['date_last_stage_update', '<=', '2026-07-31 23:59:59']
        ], ['id', 'name', 'expected_revenue']);

        // 2. Ganadas en Julio (stage_id = 4)
        const ganadasJulio = await searchRead(uid, [
            ['user_id', 'in', userIds],
            ['type', '=', 'opportunity'],
            ['stage_id', '=', 4],
            ['date_closed', '>=', '2026-07-01 00:00:00'],
            ['date_closed', '<=', '2026-07-31 23:59:59']
        ], ['id', 'name', 'expected_revenue']);

        // 3. Abiertas hasta diciembre de este año
        const abiertasHastaDiciembre = await searchRead(uid, [
            ['user_id', 'in', userIds],
            ['active', '=', true],
            ['type', '=', 'opportunity'],
            ['stage_id', 'not in', [4, 7, 8]],
            ['date_deadline', '<=', '2026-12-31']
        ], ['id', 'name', 'expected_revenue']);

        // 4. Abiertas para cerrar en Agosto
        const abiertasAgosto = await searchRead(uid, [
            ['user_id', 'in', userIds],
            ['active', '=', true],
            ['type', '=', 'opportunity'],
            ['stage_id', 'not in', [4, 7, 8]],
            ['date_deadline', '>=', '2026-08-01'],
            ['date_deadline', '<=', '2026-08-31']
        ], ['id', 'name', 'expected_revenue']);

        console.log("=== INFORME COMERCIAL (Gustavo, Andrea, Arnulfo) ===");
        console.log(`\nOFERTAS ENVIADAS EN JULIO: ${ofertasEnviadasJulio.length} | Monto: ${sumRevenue(ofertasEnviadasJulio).toLocaleString()}`);
        console.log(`VENTAS GANADAS EN JULIO: ${ganadasJulio.length} | Monto: ${sumRevenue(ganadasJulio).toLocaleString()}`);
        console.log(`\nCARTERA ABIERTA (Cierre hasta Dic 2026): ${abiertasHastaDiciembre.length} oportunidades | Monto: ${sumRevenue(abiertasHastaDiciembre).toLocaleString()}`);
        console.log(`CARTERA ABIERTA (Cierre en Agosto 2026): ${abiertasAgosto.length} oportunidades | Monto: ${sumRevenue(abiertasAgosto).toLocaleString()}`);
        
    } catch (e) {
        console.error("Error generating report", e);
    }
}
generateReport();
