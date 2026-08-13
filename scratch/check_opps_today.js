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
    
    const hoy = new Date().toISOString().split('T')[0] + " 00:00:00";
    
    const hace7DiasDate = new Date();
    hace7DiasDate.setDate(hace7DiasDate.getDate() - 7);
    const hace7DiasString = hace7DiasDate.toISOString().split('T')[0] + " 00:00:00";
    
    // 3. Active opportunities not in won/lost stages
    clientObject.methodCall('execute_kw', [
        odooDb, uid, odooPass, 'crm.lead', 'search_count', [[
            ['active', '=', true],
            ['type', '=', 'opportunity'],
            ['stage_id', 'not in', [4, 7, 8]]
        ]]
    ], function (e, activeNotClosed) {
        console.log("Total activas (No cerradas):", activeNotClosed);
        
        // 4. Stuck opportunities (write_date < hace 7 dias)
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'crm.lead', 'search_count', [[
                ['active', '=', true],
                ['type', '=', 'opportunity'],
                ['stage_id', 'not in', [4, 7, 8]],
                ['write_date', '<', hace7DiasString]
            ]]
        ], function (e, stuck) {
            console.log(`Estancadas regla 7 dias (write_date < ${hace7DiasString}):`, stuck);
            
            // 5. Check if any are older than hoy
            clientObject.methodCall('execute_kw', [
                odooDb, uid, odooPass, 'crm.lead', 'search_count', [[
                    ['active', '=', true],
                    ['type', '=', 'opportunity'],
                    ['stage_id', 'not in', [4, 7, 8]],
                    ['write_date', '<', hoy]
                ]]
            ], function (e, olderThanToday) {
                console.log(`Estancadas regla 1 dia (write_date < ${hoy}):`, olderThanToday);
            });
        });
    });
});
