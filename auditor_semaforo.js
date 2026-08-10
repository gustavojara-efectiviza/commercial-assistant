require('dotenv').config();
const fs = require('fs');
const path = require('path');
const xmlrpc = require('xmlrpc');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const url = process.env.ODOO_URL;
const db = process.env.ODOO_DB;
const username = process.env.ODOO_USERNAME;
const password = process.env.ODOO_PASSWORD;

const rutasAAnalizar = [
    'C:\\Users\\gusta\\BEIGEL S.R.L\\Edgar Uner - 2026 Locales',
    'C:\\Users\\gusta\\BEIGEL S.R.L\\Edgar Uner - 2026 Representadas'
];

async function ejecutarAuditorInteligente() {
    console.log("🚦 Iniciando Auditoría con Conexión Real a Odoo...\n");

    try {
        // --- 1. LEER CARPETAS LOCALES (CON FECHAS) ---
        console.log("📂 1. Escaneando directorios físicos...");
        let listadoCarpetas = "";
        rutasAAnalizar.forEach(ruta => {
            try {
                const carpetas = fs.readdirSync(ruta, { withFileTypes: true });
                carpetas.forEach(item => {
                    if (item.isDirectory() && item.name.toUpperCase().startsWith('OF')) {
                        const stats = fs.statSync(path.join(ruta, item.name));
                        // Obtenemos la fecha de la última vez que modificaste algo dentro
                        listadoCarpetas += `- ${item.name} | Última modif: ${stats.mtime.toISOString().split('T')[0]}\n`;
                    }
                });
            } catch (err) { }
        });

        // --- 2. LEER CORREOS ---
        console.log("📧 2. Cargando actividad digital (Outlook)...");
        let correos = "Bandejas no encontradas.";
        try {
            const recibidos = fs.readFileSync('recibidos.CSV', 'utf8');
            const enviados = fs.readFileSync('correos.CSV', 'utf8');
            // Aquí le pasamos solo un resumen si son muy largos
            correos = `ENVIADOS (Resumen):\n${enviados.substring(0, 1000)}\nRECIBIDOS (Resumen):\n${recibidos.substring(0, 1000)}`;
        } catch (e) { }

        // --- 3. CONEXIÓN VIVA A ODOO ---
        console.log("☁️  3. Descargando historial completo de Odoo...");
        const commonClient = xmlrpc.createSecureClient({ host: new URL(url).hostname, port: 443, path: '/xmlrpc/2/common' });

        commonClient.methodCall('authenticate', [db, username, password, {}], (error, uid) => {
            if (error || !uid) return console.error("❌ Error de autenticación en Odoo.");

            const modelsClient = xmlrpc.createSecureClient({ host: new URL(url).hostname, port: 443, path: '/xmlrpc/2/object' });

            // Buscamos TODAS las oportunidades (sin filtro de estado para traer ganadas y perdidas también)
            // Extraemos: Nombre, Etapa, y Usuario Asignado
            modelsClient.methodCall('execute_kw', [db, uid, password, 'crm.lead', 'search_read',
                [[ /* Lista vacía para traer todo o puedes agregar filtros */]],
                { fields: ['name', 'stage_id', 'user_id'], limit: 100 }],

                async (err, oportunidades) => {
                    if (err) return console.error("❌ Error leyendo oportunidades:", err);

                    console.log(`   ✅ Se extrajeron ${oportunidades.length} registros históricos de Odoo.\n`);

                    let oportunidadesOdoo = oportunidades.map(op =>
                        `- ${op.name} | Estado: ${op.stage_id ? op.stage_id[1] : 'Nuevo'} | Asignado: ${op.user_id ? op.user_id[1] : 'Sin asignar'}`
                    ).join('\n');

                    // --- 4. EL CEREBRO (Prompt con Reglas de Negocio) ---
                    console.log("🧠 4. Ejecutando análisis semántico de duplicados...\n");

                    const prompt = `
                    Eres el auditor de CRM de Beigel SRL.
                    
                    CARPETAS EN PC DE GUSTAVO:
                    ${listadoCarpetas}
                    
                    HISTORIAL REAL DE ODOO (Incluye Ganadas y Perdidas):
                    ${oportunidadesOdoo}

                    REGLAS DE CLASIFICACIÓN (ESTRICTAS):
                    1. ⚪ BLANCO (Ignorar): La carpeta ya existe en el Historial de Odoo (usa Fuzzy Matching, ej. "Trafo Itaugua" = "Hospital Itaugua"). No importa si está Ganada, Perdida o En Curso, si ya está en Odoo, la ignoras.
                    2. 🟢 VERDE (Recomendado para Crear): La carpeta NO TIENE NINGUNA COINCIDENCIA en el historial de Odoo y pertenece a Gustavo.
                    3. 🟡 NARANJA (Revisión): Duda de si es de otro asesor o si podría ser un duplicado de un nombre raro en Odoo.

                    FORMATO DE SALIDA:
                    Solo muestra las categorías VERDE y NARANJA. Explica brevemente por qué.
                `;

                    const result = await model.generateContent(prompt);
                    console.log(result.response.text());
                    fs.writeFileSync('reporte_semaforo_real.txt', result.response.text());
                });
        });

    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

ejecutarAuditorInteligente();