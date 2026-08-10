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

async function findUsers() {
    try {
        const uid = await authenticate();
        
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'res.users', 'search_read',
            [[]], 
            { fields: ['id', 'name'] }
        ], function (error, users) {
            if (error) console.error(error);
            else {
                console.log("Usuarios encontrados:");
                console.log(users.filter(u => u.name.toLowerCase().includes('gustavo') || u.name.toLowerCase().includes('arnulfo') || u.name.toLowerCase().includes('andrea')));
            }
        });
    } catch(e) {
        console.error(e);
    }
}
findUsers();
