require('dotenv').config();
const fs = require('fs');
const xmlrpc = require('xmlrpc');

const url = process.env.ODOO_URL;
const db = process.env.ODOO_DB;
const username = process.env.ODOO_USERNAME;
const password = process.env.ODOO_PASSWORD;

async function extraerHistorialCompleto() {
    console.log("🔍 Conectando a Odoo para extraer TODO el historial...");

    const commonClient = xmlrpc.createSecureClient({ host: new URL(url).hostname, port: 443, path: '/xmlrpc/2/common' });

    commonClient.methodCall('authenticate', [db, username, password, {}], (error, uid) => {
        if (error || !uid) return console.error("❌ Error de autenticación.");

        const modelsClient = xmlrpc.createSecureClient({ host: new URL(url).hostname, port: 443, path: '/xmlrpc/2/object' });

        // Aumentamos el límite a 1000 para no dejar nada afuera
        modelsClient.methodCall('execute_kw', [db, uid, password, 'crm.lead', 'search_read',
            [[ /* Sin filtros, trae todo */]],
            { fields: ['name', 'stage_id', 'user_id'], limit: 1000 }],

            (err, oportunidades) => {
                if (err) return console.error("❌ Error leyendo oportunidades:", err);

                console.log(`✅ Odoo devolvió ${oportunidades.length} oportunidades en total.`);

                let contenidoArchivo = "=== HISTORIAL COMPLETO DE ODOO ===\n\n";
                oportunidades.forEach(op => {
                    contenidoArchivo += `ID: ${op.id} | NOMBRE: ${op.name} | ESTADO: ${op.stage_id ? op.stage_id[1] : 'N/A'}\n`;
                });

                fs.writeFileSync('mi_odoo_real.txt', contenidoArchivo);
                console.log("💾 Se ha guardado el archivo 'mi_odoo_real.txt' en tu carpeta.");
            });
    });
}

extraerHistorialCompleto();