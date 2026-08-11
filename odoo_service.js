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

function autenticarOdoo() {
    return new Promise((resolve, reject) => {
        clientCommon.methodCall('authenticate', [odooDb, odooUser, odooPass, {}], function (error, uid) {
            if (error) reject(error); else resolve(uid);
        });
    });
}

function buscarOportunidades(uid, limite = 5) {
    const inicioDeHoy = new Date().toISOString().split('T')[0] + " 00:00:00";
    return new Promise((resolve, reject) => {
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'crm.lead', 'search_read',
            [[
                ['active', '=', true],
                ['type', '=', 'opportunity'],
                ['write_date', '<', inicioDeHoy],
                ['stage_id', 'not in', [4, 7, 8]]
            ]],
            { 
                fields: [
                    'id', 'name', 'partner_id', 'description', 'stage_id', 
                    'x_studio_proveedor_1', 'x_studio_suministro', 'expected_revenue'
                ],
                limit: limite
            }
        ], function (error, leads) {
            if (error) reject(error); else resolve(leads);
        });
    });
}

function obtenerModeloCrmLead(uid) {
    return new Promise((resolve, reject) => {
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'ir.model', 'search', [[['model', '=', 'crm.lead']]]
        ], function (error, result) {
            if (error) reject(error); else resolve(result[0]);
        });
    });
}

function agendarActividadEnOdoo(uid, leadId, modelId, activityTypeId, summary, note) {
    let fecha = new Date();
    fecha.setDate(fecha.getDate() + 1);
    while (fecha.getDay() === 0 || fecha.getDay() === 6) {
        fecha.setDate(fecha.getDate() + 1);
    }
    const fechaString = fecha.toISOString().split('T')[0];

    return new Promise((resolve, reject) => {
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'mail.activity', 'create',
            [{
                res_id: leadId,
                res_model_id: modelId,
                activity_type_id: activityTypeId,
                summary: summary,
                note: note,
                date_deadline: fechaString,
                user_id: uid
            }]
        ], function (error, result) {
            if (error) reject(error); else resolve(result);
        });
    });
}

function actualizarLeadEnOdoo(uid, leadId, data) {
    return new Promise((resolve, reject) => {
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'crm.lead', 'write',
            [[leadId], data]
        ], function (error, result) {
            if (error) reject(error); else resolve(result);
        });
    });
}

function obtenerActividadesDeHoy(uid) {
    const hoyString = new Date().toISOString().split('T')[0];
    return new Promise((resolve, reject) => {
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'mail.activity', 'search_read',
            [[
                ['user_id', '=', uid],
                ['date_deadline', '=', hoyString]
            ]],
            { 
                fields: ['id', 'res_name', 'summary', 'activity_type_id'] 
            }
        ], function (error, activities) {
            if (error) reject(error); else resolve(activities);
        });
    });
}

module.exports = {
    autenticarOdoo,
    buscarOportunidades,
    obtenerModeloCrmLead,
    agendarActividadEnOdoo,
    actualizarLeadEnOdoo,
    obtenerActividadesDeHoy
};
