const xmlrpc = require('xmlrpc');
require('dotenv').config();

const odooUrl = process.env.ODOO_URL;
const odooDb = process.env.ODOO_DB;
const odooUser = process.env.ODOO_USERNAME;
const odooPass = process.env.ODOO_PASSWORD;

const urlCommon = new URL(odooUrl + '/xmlrpc/2/common');
const urlObject = new URL(odooUrl + '/xmlrpc/2/object');
const clientCommon = urlCommon.protocol === 'https:' ? xmlrpc.createSecureClient(urlCommon.href) : xmlrpc.createClient(urlCommon.href);
const clientObject = urlObject.protocol === 'https:' ? xmlrpc.createSecureClient(urlObject.href) : xmlrpc.createClient(urlObject.href);

clientCommon.methodCall('authenticate', [odooDb, odooUser, odooPass, {}], function (error, uid) {
    if (error) { console.error(error); return; }
    
    // Buscar actividades pendientes para crm.lead
    clientObject.methodCall('execute_kw', [
        odooDb, uid, odooPass, 'mail.activity', 'search_read',
        [[['res_model', '=', 'crm.lead']]],
        { fields: ['id', 'res_id', 'res_name', 'activity_type_id', 'summary', 'date_deadline', 'state'], limit: 5 }
    ], function (err, acts) {
        if (err) console.error(err);
        else console.log(acts);
    });
});
