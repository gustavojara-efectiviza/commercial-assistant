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
    
    // Buscar mensajes de ejemplo en crm.lead
    clientObject.methodCall('execute_kw', [
        odooDb, uid, odooPass, 'mail.message', 'search_read',
        [[['model', '=', 'crm.lead']]],
        { fields: ['id', 'res_id', 'author_id', 'body', 'message_type', 'needaction_partner_ids', 'partner_ids', 'notified_partner_ids'], limit: 10 }
    ], function (e, messages) {
        if(e) return console.error(e);
        console.log("Mensajes:");
        messages.forEach(m => {
            console.log(`ID: ${m.id} | Author: ${m.author_id ? m.author_id[1] : 'None'} | NeedAction: ${m.needaction_partner_ids} | PartnerIds: ${m.partner_ids} | Notified: ${m.notified_partner_ids}`);
        });
    });
});
