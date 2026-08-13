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
    
    // 1. Find Edgar Uner
    clientObject.methodCall('execute_kw', [
        odooDb, uid, odooPass, 'res.partner', 'search_read',
        [[['name', 'ilike', 'Edgar']]],
        { fields: ['id', 'name'], limit: 5 }
    ], function (e, edgar) {
        if(e) console.error(e);
        console.log("Edgar Partner:", edgar);
    });

    // 2. Find Gustavo (The User)
    clientObject.methodCall('execute_kw', [
        odooDb, uid, odooPass, 'res.users', 'search_read',
        [[['id', '=', uid]]],
        { fields: ['id', 'name', 'partner_id'], limit: 1 }
    ], function (e, gustavo) {
        if(e) console.error(e);
        console.log("Gustavo User:", gustavo);
        
        let gustavoPartnerId = gustavo[0].partner_id[0];
        
        // 3. Find recent messages in crm.lead
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'mail.message', 'search_read',
            [[
                ['model', '=', 'crm.lead'],
                ['message_type', 'in', ['comment', 'email']]
            ]],
            { fields: ['id', 'res_id', 'author_id', 'body', 'partner_ids', 'notified_partner_ids'], limit: 5, order: 'id desc' }
        ], function (e, messages) {
            if(e) console.error(e);
            console.log("Recent Messages:");
            messages.forEach(m => {
                console.log(`Lead ID: ${m.res_id} | Author: ${m.author_id ? m.author_id[1] : 'None'}`);
                console.log(`Body Snippet: ${m.body.substring(0, 50)}...`);
                console.log(`Partner IDs (Mentions?):`, m.partner_ids);
                console.log(`Notified Partner IDs:`, m.notified_partner_ids);
            });
        });
    });
});
