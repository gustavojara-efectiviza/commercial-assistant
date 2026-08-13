const xmlrpc = require('xmlrpc');
require('dotenv').config();

const odooUrl = process.env.ODOO_URL;
const odooDb = process.env.ODOO_DB;
const odooUser = process.env.ODOO_USERNAME;
const odooPass = process.env.ODOO_PASSWORD;

const clientCommon = xmlrpc.createSecureClient(new URL(odooUrl + '/xmlrpc/2/common').href);
const clientObject = xmlrpc.createSecureClient(new URL(odooUrl + '/xmlrpc/2/object').href);

clientCommon.methodCall('authenticate', [odooDb, odooUser, odooPass, {}], function (err, uid) {
    if (err) return console.error("Auth error:", err);
    
    // Buscar write_date de los primeros 10 activos no cerrados
    clientObject.methodCall('execute_kw', [
        odooDb, uid, odooPass, 'crm.lead', 'search_read',
        [[
            ['active', '=', true],
            ['type', '=', 'opportunity'],
            ['stage_id', 'not in', [4, 7, 8]]
        ]],
        { fields: ['id', 'name', 'write_date'], limit: 10, order: 'write_date asc' }
    ], function (e, leads) {
        if(e) console.error(e);
        console.log("Muestras de write_date (orden ascendente):");
        leads.forEach(l => console.log(`${l.id}: ${l.name} - ${l.write_date}`));
    });
});
