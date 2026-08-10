require('dotenv').config();
const xmlrpc = require('xmlrpc');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 1. Configuración de Credenciales
const odooUrl = process.env.ODOO_URL;
const odooDb = process.env.ODOO_DB;
const odooUser = process.env.ODOO_USERNAME;
const odooPass = process.env.ODOO_PASSWORD;

// Iniciar Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// 2. Conexión a Odoo
const urlCommon = new URL(odooUrl + '/xmlrpc/2/common');
const urlObject = new URL(odooUrl + '/xmlrpc/2/object');

const clientCommon = urlCommon.protocol === 'https:' ? xmlrpc.createSecureClient(urlCommon.href) : xmlrpc.createClient(urlCommon.href);
const clientObject = urlObject.protocol === 'https:' ? xmlrpc.createSecureClient(urlObject.href) : xmlrpc.createClient(urlObject.href);

// --- UTILIDADES DE FECHA Y TIEMPO ---
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function formatearFechaLocal(fecha) {
    const year = fecha.getFullYear();
    const month = String(fecha.getMonth() + 1).padStart(2, '0');
    const day = String(fecha.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function sumarDias(fecha, dias) {
    let resultado = new Date(fecha);
    resultado.setDate(resultado.getDate() + dias);
    return resultado;
}

function obtenerProximoDiaLaboral(fecha) {
    let proximoDia = sumarDias(fecha, 1);
    // 0 es Domingo, 6 es Sábado
    while (proximoDia.getDay() === 0 || proximoDia.getDay() === 6) {
        proximoDia = sumarDias(proximoDia, 1);
    }
    return proximoDia;
}

function autenticarOdoo() {
    return new Promise((resolve, reject) => {
        clientCommon.methodCall('authenticate', [odooDb, odooUser, odooPass, {}], function (error, uid) {
            if (error) reject(error); else resolve(uid);
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

function obtenerTipoActividad(uid) {
    return new Promise((resolve, reject) => {
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'mail.activity.type', 'search', [[]], { limit: 1 }
        ], function (error, result) {
            if (error) reject(error); else resolve(result[0]);
        });
    });
}

// Ahora la función de agendar acepta una fecha específica calculada por el bot
function agendarActividad(uid, leadId, modelId, activityTypeId, titulo, notaInterna, fechaDeadline) {
    return new Promise((resolve, reject) => {
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'mail.activity', 'create',
            [{
                res_id: leadId,
                res_model_id: modelId,
                activity_type_id: activityTypeId,
                summary: titulo,
                note: notaInterna,
                date_deadline: fechaDeadline,
                user_id: uid
            }]
        ], function (error, result) {
            if (error) reject(error); else resolve(result);
        });
    });
}

function dejarNotaEnOdoo(uid, leadId, nota) {
    return new Promise((resolve, reject) => {
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'crm.lead', 'message_post',
            [[leadId]], { body: nota }
        ], function (error, result) {
            if (error) reject(error); else resolve(result);
        });
    });
}

function buscarLeads(uid) {
    // Buscamos todas las oportunidades estancadas sin límite rígido
    const inicioDeHoy = formatearFechaLocal(new Date()) + " 00:00:00";
    return new Promise((resolve, reject) => {
        clientObject.methodCall('execute_kw', [
            odooDb, uid, odooPass, 'crm.lead', 'search_read',
            [[
                ['active', '=', true], ['type', '=', 'opportunity'],
                ['write_date', '<', inicioDeHoy],
                '|', ['probability', '<', 100], '&', ['probability', '=', 100], ['activity_ids', '!=', false]
            ]],
            // Quitamos el limit: 5 para procesar masivamente
            { fields: ['id', 'name', 'partner_id', 'date_last_stage_update', 'description'] }
        ], function (error, leads) {
            if (error) reject(error); else resolve(leads);
        });
    });
}

// 3. Ejecutar el Piloto Automático
async function iniciarBotMasivo() {
    console.clear();
    console.log("🚀 INICIANDO PILOTO AUTOMÁTICO DE AGENDA...\n");

    try {
        const uid = await autenticarOdoo();
        const leads = await buscarLeads(uid);

        if (leads.length === 0) {
            console.log("✅ ¡Todo limpio! No hay oportunidades pendientes en la base de datos.");
            return;
        }

        const modelCrmId = await obtenerModeloCrmLead(uid);
        const actTypeId = await obtenerTipoActividad(uid);

        // Calendarios virtuales del bot
        let fechaHoyReal = new Date();

        // Punteros para oportunidades VIEJAS (> 6 meses / > 180 días)
        let punteroFechaViejas = obtenerProximoDiaLaboral(fechaHoyReal); // Empieza mañana
        let asignadasViejasEseDia = 0;
        const LIMITE_VIEJAS_DIARIO = 8; // Tu bloque de 9 a 11 am (1 cada 15 min)

        // Punteros para oportunidades NUEVAS (< 6 meses)
        let punteroFechaNuevas = obtenerProximoDiaLaboral(fechaHoyReal); // Empieza mañana
        let asignadasNuevasEseDia = 0;
        const LIMITE_NUEVAS_DIARIO = 3; // Tu bloque de la tarde

        console.log(`📥 Procesando ${leads.length} oportunidades en masa. Por favor, no cierres la terminal...\n`);

        for (let i = 0; i < leads.length; i++) {
            const lead = leads[i];

            // Calculamos matemáticamente la inactividad real para separarlas
            const fechaActualizacion = new Date(lead.date_last_stage_update);
            const diferenciaMilisegundos = fechaHoyReal - fechaActualizacion;
            const diasInactivo = Math.floor(diferenciaMilisegundos / (1000 * 60 * 60 * 24));
            const esVieja = diasInactivo > 180;

            const prompt = `
                Analiza esta oportunidad:
                Nombre: ${lead.name}
                Cliente: ${lead.partner_id ? lead.partner_id[1] : 'Sin cliente'}
                Notas: ${lead.description || 'Sin notas'}

                Extrae la información en este formato exacto:
                🏷️ PALABRA CLAVE: [1 o 2 palabras que definan el negocio]
                🎯 ACCIÓN: [Acción corta, ej: Llamar para seguimiento]
                🏢 CLIENTE: [Nombre del cliente]
                📝 NOTA INTERNA: [Escribe una nota corta de 1 a 2 líneas justificando la acción. Redáctala en PRIMERA PERSONA como el ejecutivo responsable de ventas. Sin emojis en esta línea.]
            `;

            console.log("--------------------------------------------------");
            console.log(`🤖 Evaluando oportunidad ${i + 1} de ${leads.length} (${esVieja ? 'Más de 6 meses' : 'Reciente'})...`);

            const result = await model.generateContent(prompt);
            const respuestaIA = result.response.text().trim();

            const matchClave = respuestaIA.match(/🏷️ PALABRA CLAVE:(.*)/);
            const palabraClave = matchClave ? matchClave[1].trim() : "Seguimiento";

            const matchAccion = respuestaIA.match(/🎯 ACCIÓN:(.*)/);
            const accionRecomendada = matchAccion ? matchAccion[1].trim() : "Contactar cliente";

            const matchCliente = respuestaIA.match(/🏢 CLIENTE:(.*)/);
            const clienteNombre = matchCliente ? matchCliente[1].trim() : "Cliente";

            const matchNota = respuestaIA.match(/📝 NOTA INTERNA:(.*)/);
            const notaHumana = matchNota ? matchNota[1].trim() : "Retomando contacto programado.";

            const tituloAgenda = `${clienteNombre}, ${palabraClave} - ${accionRecomendada}`;

            // Lógica de agendamiento y balanceo de carga
            if (esVieja) {
                if (asignadasViejasEseDia >= LIMITE_VIEJAS_DIARIO) {
                    punteroFechaViejas = obtenerProximoDiaLaboral(punteroFechaViejas);
                    asignadasViejasEseDia = 0;
                }
                const fechaString = formatearFechaLocal(punteroFechaViejas);
                await agendarActividad(uid, lead.id, modelCrmId, actTypeId, tituloAgenda, notaHumana, fechaString);
                await dejarNotaEnOdoo(uid, lead.id, `Reactivación agendada para el ${fechaString}. ${notaHumana}`);
                console.log(`📅 [Ruta 1] Agendada para la mañana del: ${fechaString}`);
                asignadasViejasEseDia++;

            } else {
                if (asignadasNuevasEseDia >= LIMITE_NUEVAS_DIARIO) {
                    punteroFechaNuevas = obtenerProximoDiaLaboral(punteroFechaNuevas);
                    asignadasNuevasEseDia = 0;
                }
                const fechaString = formatearFechaLocal(punteroFechaNuevas);
                await agendarActividad(uid, lead.id, modelCrmId, actTypeId, tituloAgenda, notaHumana, fechaString);
                await dejarNotaEnOdoo(uid, lead.id, `Seguimiento agendado para el ${fechaString}. ${notaHumana}`);
                console.log(`📅 [Ruta 2] Agendada para la tarde del: ${fechaString}`);
                asignadasNuevasEseDia++;
            }

            // Pausa de 3 segundos para no saturar la API de Inteligencia Artificial
            await sleep(3000);
        }

        console.log("\n🎉 ORQUESTACIÓN COMPLETADA. Tu calendario de Odoo ha sido estructurado para las próximas semanas.");

    } catch (error) {
        console.error("\n❌ Fallo crítico en el proceso:", error);
    }
}

iniciarBotMasivo();