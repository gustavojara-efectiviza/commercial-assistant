require('dotenv').config();
const xmlrpc = require('xmlrpc');
const fs = require('fs');

const url = process.env.ODOO_URL;
const db = process.env.ODOO_DB;
const username = process.env.ODOO_USERNAME;
const password = process.env.ODOO_PASSWORD;

async function auditStructure() {
    console.log("🔍 Conectando a Odoo para extraer estructura...");

    const commonClient = xmlrpc.createSecureClient({ host: new URL(url).hostname, port: 443, path: '/xmlrpc/2/common' });
    const modelsClient = xmlrpc.createSecureClient({ host: new URL(url).hostname, port: 443, path: '/xmlrpc/2/object' });

    function authenticate() {
        return new Promise((resolve, reject) => {
            commonClient.methodCall('authenticate', [db, username, password, {}], (error, uid) => {
                if (error) reject(error); else resolve(uid);
            });
        });
    }

    function executeKw(uid, model, method, args, kwargs = {}) {
        return new Promise((resolve, reject) => {
            modelsClient.methodCall('execute_kw', [db, uid, password, model, method, args, kwargs], (error, result) => {
                if (error) reject(error); else resolve(result);
            });
        });
    }

    try {
        const uid = await authenticate();
        if (!uid) throw new Error("Autenticación fallida.");
        console.log("✅ Autenticado con éxito. UID:", uid);

        const auditData = {};

        // 1. Obtener etapas del CRM
        console.log("📊 Extrayendo etapas del CRM (crm.stage)...");
        auditData.stages = await executeKw(uid, 'crm.stage', 'search_read', [[]], { fields: ['id', 'name', 'sequence'] });

        // 2. Obtener tipos de actividades
        console.log("📅 Extrayendo tipos de actividades (mail.activity.type)...");
        auditData.activityTypes = await executeKw(uid, 'mail.activity.type', 'search_read', [[]], { fields: ['id', 'name', 'category'] });

        // 3. Obtener campos del modelo CRM
        console.log("📋 Extrayendo campos de oportunidades (crm.lead)...");
        const fields = await executeKw(uid, 'crm.lead', 'fields_get', [[]], { attributes: ['string', 'type', 'required'] });
        auditData.fields = fields;

        // Guardar resultado para análisis
        fs.writeFileSync('estructura_odoo.json', JSON.stringify(auditData, null, 2));
        console.log("💾 Estructura guardada en estructura_odoo.json");
        
        console.log("\n=== RESUMEN ===");
        console.log(`- Etapas del CRM encontradas: ${auditData.stages.length}`);
        console.log(`- Tipos de Actividades encontrados: ${auditData.activityTypes.length}`);
        console.log(`- Campos en crm.lead encontrados: ${Object.keys(fields).length}`);
        
    } catch (err) {
        console.error("❌ Error durante la auditoría:", err);
    }
}

auditStructure();
