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
    
    const inicioDeHoy = new Date().toISOString().split('T')[0] + " 00:00:00";
    
    // 1. Total leads
    clientObject.methodCall('execute_kw', [
        odooDb, uid, odooPass, 'crm.lead', 'search_count', [[]]
    ], function (e, total) {
        console.log("Total leads (all types, all states):", total);
        
        // 2. Total active opportunities
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'crm.lead', 'search_count', [[
                ['active', '=', true],
                ['type', '=', 'opportunity']
            ]]
        ], function (e, activeOpps) {
            console.log("Total active opportunities:", activeOpps);
            
            // 3. Active opportunities not in won/lost stages
            clientObject.methodCall('execute_kw', [
                odooDb, uid, odooPass, 'crm.lead', 'search_count', [[
                    ['active', '=', true],
                    ['type', '=', 'opportunity'],
                    ['stage_id', 'not in', [4, 7, 8]]
                ]]
            ], function (e, activeNotClosed) {
                console.log("Active opps NOT in stages 4,7,8:", activeNotClosed);
                
                // 4. Stuck opportunities (write_date < inicioDeHoy)
                clientObject.methodCall('execute_kw', [
                    odooDb, uid, odooPass, 'crm.lead', 'search_count', [[
                        ['active', '=', true],
                        ['type', '=', 'opportunity'],
                        ['stage_id', 'not in', [4, 7, 8]],
                        ['write_date', '<', inicioDeHoy]
                    ]]
                ], function (e, stuck) {
                    console.log(`Stuck opps (write_date < ${inicioDeHoy}):`, stuck);
                });
            });
        });
    });
});
