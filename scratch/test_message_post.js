const xmlrpc = require('xmlrpc');
require('dotenv').config();
const odooUrl = process.env.ODOO_URL;
const odooDb = process.env.ODOO_DB;
const odooUser = process.env.ODOO_USERNAME;
const odooPass = process.env.ODOO_PASSWORD;
const clientCommon = xmlrpc.createSecureClient(new URL(odooUrl + '/xmlrpc/2/common').href);
const clientObject = xmlrpc.createSecureClient(new URL(odooUrl + '/xmlrpc/2/object').href);

clientCommon.methodCall('authenticate', [odooDb, odooUser, odooPass, {}], function (err, uid) {
    if (err) return console.error(err);
    clientObject.methodCall('execute_kw', [
        odooDb, uid, odooPass, 'crm.lead', 'search_read', [[], {limit: 1, fields: ['id']}]
    ], function (e, leads) {
        if(e) return console.error(e);
        if(!leads.length) return console.log("No leads");
        
        let leadId = leads[0].id;
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'crm.lead', 'message_post',
            [[leadId]],
            { body: "Nota de prueba via XML-RPC", message_type: 'comment', subtype_xmlid: 'mail.mt_note' }
        ], function(err2, result) {
            if(err2) console.error(err2);
            else console.log("Nota registrada:", result);
        });
    });
});
