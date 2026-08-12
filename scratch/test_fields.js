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
    clientObject.methodCall('execute_kw', [odooDb, uid, odooPass, 'mail.activity', 'fields_get', [[], {attributes: ['type', 'string']}]], function (e, fields) {
        if(e) console.error(e);
        // check methods too? cannot easily introspect methods, but let's just see fields to ensure connection works.
        console.log(Object.keys(fields || {}).slice(0, 10));
    });
});
