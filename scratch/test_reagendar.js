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
    
    // fetch an activity to test write on date_deadline
    clientObject.methodCall('execute_kw', [
        odooDb, uid, odooPass, 'mail.activity', 'search_read',
        [[['res_model', '=', 'crm.lead']]],
        { fields: ['id', 'date_deadline'], limit: 1 }
    ], function (e, acts) {
        if(e) return console.error(e);
        console.log("Activity:", acts);
        if(acts.length) {
            let actId = acts[0].id;
            let current = acts[0].date_deadline;
            console.log("Current deadline:", current);
            // test write
            clientObject.methodCall('execute_kw', [
                odooDb, uid, odooPass, 'mail.activity', 'write',
                [[actId], { date_deadline: current }] // writing the same date just to test permissions/validity
            ], function (errWrite, resWrite) {
                console.log("Write result:", resWrite, errWrite);
            });
        }
    });
});
