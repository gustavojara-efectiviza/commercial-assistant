require('dotenv').config();
const telegramModule = require('node-telegram-bot-api');
const TelegramBot = telegramModule.default || telegramModule;
const xmlrpc = require('xmlrpc');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cron = require('node-cron');

// ==========================================
// 1. CONFIGURACIONES
// ==========================================
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatIdAllowed = process.env.TELEGRAM_CHAT_ID;

if (!token) {
    console.error("❌ ERROR: Falta TELEGRAM_BOT_TOKEN en el archivo .env");
    process.exit(1);
}

// Inicializar Bot de Telegram
const bot = new TelegramBot(token, { polling: true });

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Inicializar Odoo
const odooUrl = process.env.ODOO_URL;
const odooDb = process.env.ODOO_DB;
const odooUser = process.env.ODOO_USERNAME;
const odooPass = process.env.ODOO_PASSWORD;

const urlCommon = new URL(odooUrl + '/xmlrpc/2/common');
const urlObject = new URL(odooUrl + '/xmlrpc/2/object');
const clientCommon = urlCommon.protocol === 'https:' ? xmlrpc.createSecureClient(urlCommon.href) : xmlrpc.createClient(urlCommon.href);
const clientObject = urlObject.protocol === 'https:' ? xmlrpc.createSecureClient(urlObject.href) : xmlrpc.createClient(urlObject.href);

// ==========================================
// 2. CONEXIÓN Y UTILIDADES ODOO
// ==========================================
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

// Almacén temporal para los leads y estados
const pendingLeads = new Map();
const userState = new Map();

// ==========================================
// 3. LOGICA DE COLAS Y WIZARDS
// ==========================================

async function procesarSiguienteEnCola(chatId) {
    const state = userState.get(chatId);
    if (!state || !state.queue || state.queue.length === 0) {
        bot.sendMessage(chatId, "✅ Has procesado todo tu lote de oportunidades estancadas.");
        userState.delete(chatId);
        return;
    }

    const lead = state.queue[0];
    pendingLeads.set(lead.id.toString(), lead);
    state.step = 'AUDIT_QUEUE';

    const cliente = lead.partner_id ? lead.partner_id[1] : 'Sin cliente';
    const etapa = lead.stage_id ? lead.stage_id[1] : 'Desconocida';
    const proveedor = lead.x_studio_proveedor_1 || '';
    const suministro = lead.x_studio_suministro || '';
    const monto = lead.expected_revenue || 0;

    const faltan = [];
    if (!monto) faltan.push('Monto (expected_revenue)');
    if (!proveedor) faltan.push('Proveedor');
    if (!suministro) faltan.push('Suministro');

    let mensajeFaltan = faltan.length > 0 ? ` Faltan datos clave: ${faltan.join(', ')}.` : '';

    const prompt = `
        Eres un asistente de ventas senior analizando una oportunidad estancada.
        
        DATOS DE LA OPORTUNIDAD:
        - Nombre: ${lead.name}
        - Cliente: ${cliente}
        - Etapa en el Pipeline: ${etapa}
        - Proveedor Involucrado: ${proveedor || 'No especificado'}
        - Suministro Principal: ${suministro || 'No especificado'}
        - Notas: ${lead.description || 'Sin notas'}
        
        Redacta un análisis comercial BREVE (máximo 3 líneas) sobre por qué está estancada y qué sugieres hacer.${mensajeFaltan} Dirígete a Gustavo.
    `;

    try {
        const result = await model.generateContent(prompt);
        const analisisGemini = result.response.text().trim();

        const mensajeText = `
*(1/${state.queue.length}) Oportunidad en Cola:*
🏢 *Nombre:* ${lead.name}
👤 *Cliente:* ${cliente}
📍 *Etapa:* ${etapa}
⚙️ *Proveedor:* ${proveedor || 'No especificado'}
📦 *Suministro:* ${suministro || 'No especificado'}
💰 *Monto:* ${monto}

🤖 *Análisis de Gemini:*
_${analisisGemini}_

¿Qué acción deseas tomar?
        `;

        const inline_keyboard = [
            [
                { text: '📞 Agendar Llamada', callback_data: `CALL_${lead.id}` },
                { text: '🤝 Agendar Reunión', callback_data: `MEET_${lead.id}` }
            ],
            [
                { text: '✉️ Agendar Correo', callback_data: `MAIL_${lead.id}` },
                { text: '⏭️ Ignorar (Descartar)', callback_data: `IGNORE_${lead.id}` }
            ]
        ];

        if (faltan.length > 0) {
            inline_keyboard.push([{ text: '📝 Completar Faltantes', callback_data: `FILL_${lead.id}` }]);
        }

        bot.sendMessage(chatId, mensajeText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard } });

    } catch (error) {
        console.error("Error en analisis de cola:", error);
        bot.sendMessage(chatId, "❌ Error al procesar la oportunidad.");
    }
}

function avanzarCola(chatId) {
    const state = userState.get(chatId);
    if (state && state.queue) {
        state.queue.shift(); // Saca el primero
        procesarSiguienteEnCola(chatId);
    }
}

// ==========================================
// 4. EVENTOS DEL BOT DE TELEGRAM
// ==========================================

// Manejo de mensajes de texto (Para modo "Personalizar" y "Wizard")
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (chatIdAllowed && chatId.toString() !== chatIdAllowed) return;
    if (msg.text && msg.text.startsWith('/')) return; // Ignorar comandos

    const state = userState.get(chatId);
    if (!state) return;

    if (state.step === 'AWAITING_NOTE') {
        const lead = pendingLeads.get(state.leadId);
        if (!lead) return;

        const textoPersonalizado = msg.text.trim();
        bot.sendMessage(chatId, "⏳ Guardando nota personalizada en Odoo...");

        try {
            const uid = await autenticarOdoo();
            const modelId = await obtenerModeloCrmLead(uid);
            await agendarActividadEnOdoo(uid, parseInt(state.leadId), modelId, state.draft.activityTypeId, state.draft.summary, textoPersonalizado);
            pendingLeads.delete(state.leadId);
            bot.sendMessage(chatId, `✅ *Actividad guardada* con éxito en Odoo para:\n🏢 ${lead.name}`, { parse_mode: 'Markdown' });
            avanzarCola(chatId);
        } catch (error) {
            bot.sendMessage(chatId, "❌ Error al agendar en Odoo.");
            avanzarCola(chatId);
        }
    } 
    else if (state.step === 'AWAITING_MISSING_DATA') {
        const fieldName = state.missingFields[state.currentFieldIdx];
        const respuesta = msg.text.trim();
        state.collectedData[fieldName] = respuesta;
        
        state.currentFieldIdx++;
        if (state.currentFieldIdx < state.missingFields.length) {
            const nextField = state.missingFields[state.currentFieldIdx];
            bot.sendMessage(chatId, `Por favor, ingresa el dato para: *${nextField}*`, { parse_mode: 'Markdown' });
        } else {
            // Guardar en Odoo
            bot.sendMessage(chatId, "⏳ Actualizando oportunidad en Odoo...");
            try {
                const uid = await autenticarOdoo();
                const updateDict = {};
                if (state.collectedData['Monto (expected_revenue)']) updateDict.expected_revenue = parseFloat(state.collectedData['Monto (expected_revenue)'].replace(/[^\d.-]/g, ''));
                if (state.collectedData['Proveedor']) updateDict.x_studio_proveedor_1 = state.collectedData['Proveedor'];
                if (state.collectedData['Suministro']) updateDict.x_studio_suministro = state.collectedData['Suministro'];

                await actualizarLeadEnOdoo(uid, parseInt(state.leadId), updateDict);
                
                // Actualizar objeto en memoria
                const lead = state.queue[0];
                if (updateDict.expected_revenue) lead.expected_revenue = updateDict.expected_revenue;
                if (updateDict.x_studio_proveedor_1) lead.x_studio_proveedor_1 = updateDict.x_studio_proveedor_1;
                if (updateDict.x_studio_suministro) lead.x_studio_suministro = updateDict.x_studio_suministro;

                bot.sendMessage(chatId, "✅ Oportunidad actualizada. Volviendo a la ficha principal...");
                procesarSiguienteEnCola(chatId); // Vuelve a mostrar la misma sin avanzar en la cola

            } catch (err) {
                console.error(err);
                bot.sendMessage(chatId, "❌ Hubo un error al actualizar en Odoo.");
                procesarSiguienteEnCola(chatId);
            }
        }
    }
});

// Comando /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (chatIdAllowed && chatId.toString() !== chatIdAllowed) {
        bot.sendMessage(chatId, "⛔ No estás autorizado para usar este bot.");
        return;
    }
    bot.sendMessage(chatId, `🤖 ¡Hola Gustavo! Soy tu asistente de Odoo con IA.\n\nTu Chat ID es: \`${chatId}\`\n\nUsa /auditar para extraer la cola de oportunidades estancadas.`, {parse_mode: 'Markdown'});
});

// Comando /auditar
bot.onText(/\/auditar/, async (msg) => {
    const chatId = msg.chat.id;
    if (chatIdAllowed && chatId.toString() !== chatIdAllowed) return;

    bot.sendMessage(chatId, "🔍 Obteniendo el lote de 5 oportunidades estancadas...");

    try {
        const uid = await autenticarOdoo();
        const leads = await buscarOportunidades(uid, 5);

        if (leads.length === 0) {
            bot.sendMessage(chatId, "✅ ¡Todo al día! No encontré oportunidades estancadas.");
            return;
        }

        userState.set(chatId, { step: 'AUDIT_QUEUE', queue: leads });
        procesarSiguienteEnCola(chatId);

    } catch (error) {
        console.error("Error en /auditar:", error);
        bot.sendMessage(chatId, "❌ Ocurrió un error al buscar oportunidades.");
    }
});

// Manejo de callbacks
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    if (chatIdAllowed && chatId.toString() !== chatIdAllowed) {
        bot.answerCallbackQuery(query.id, { text: "⛔ No estás autorizado.", show_alert: true });
        return;
    }
    const data = query.data;
    const messageId = query.message.message_id;

    const [action, leadId] = data.split('_');
    const lead = pendingLeads.get(leadId);

    if (!lead) {
        bot.answerCallbackQuery(query.id, { text: "⚠️ Esta oportunidad ya expiró en memoria.", show_alert: true });
        return;
    }

    if (action === 'IGNORE') {
        bot.answerCallbackQuery(query.id);
        bot.editMessageText(`⏭️ Oportunidad ignorada: ${lead.name}`, { chat_id: chatId, message_id: messageId });
        avanzarCola(chatId);
        return;
    }

    if (action === 'FILL') {
        bot.answerCallbackQuery(query.id, { text: "Iniciando asistente de relleno..." });
        
        const faltan = [];
        if (!lead.expected_revenue) faltan.push('Monto (expected_revenue)');
        if (!lead.x_studio_proveedor_1) faltan.push('Proveedor');
        if (!lead.x_studio_suministro) faltan.push('Suministro');

        if (faltan.length === 0) return; // Por si acaso

        const state = userState.get(chatId);
        state.step = 'AWAITING_MISSING_DATA';
        state.leadId = leadId;
        state.missingFields = faltan;
        state.currentFieldIdx = 0;
        state.collectedData = {};

        bot.sendMessage(chatId, `📝 *Asistente de Relleno*\nPor favor, ingresa el dato para: *${faltan[0]}*`, { parse_mode: 'Markdown' });
        return;
    }

    if (action === 'CALL' || action === 'MEET' || action === 'MAIL') {
        let activityTypeId = action === 'CALL' ? 2 : action === 'MEET' ? 3 : 1;
        let summary = action === 'CALL' ? `Llamada de seguimiento - ${lead.name}` : action === 'MEET' ? `Reunión de avance - ${lead.name}` : `Enviar correo de seguimiento - ${lead.name}`;
        
        bot.answerCallbackQuery(query.id, { text: "⏳ Generando borrador..." });
        bot.editMessageText(`⏳ Consultando a Gemini para redactar el objetivo...`, { chat_id: chatId, message_id: messageId });

        const promptBorrador = `
            Eres un ejecutivo de ventas. Vas a agendar una actividad (${summary}) para la oportunidad "${lead.name}".
            Redacta SOLO el objetivo estratégico de esta acción en 1 o 2 líneas máximo, con tono comercial y directo. NO agregues firmas, saludos ni aclaraciones de IA.
        `;

        try {
            const result = await model.generateContent(promptBorrador);
            lead.draft = { activityTypeId, summary, note: result.response.text().trim() };

            const opcionesBorrador = {
                inline_keyboard: [
                    [
                        { text: '✅ Aprobar y Guardar', callback_data: `APPROVE_${lead.id}` },
                        { text: '✏️ Personalizar', callback_data: `EDIT_${lead.id}` }
                    ]
                ]
            };
            bot.editMessageText(`📝 *Borrador generado:*\n\n"${lead.draft.note}"\n\n¿Qué deseas hacer?`, { chat_id: chatId, message_id: messageId, reply_markup: opcionesBorrador, parse_mode: 'Markdown' });
        } catch (error) {
            bot.editMessageText(`❌ Error al conectar con Gemini.`, { chat_id: chatId, message_id: messageId });
        }
        return;
    }

    if (action === 'APPROVE') {
        bot.answerCallbackQuery(query.id, { text: "⏳ Guardando..." });
        bot.editMessageText(`⏳ Guardando en Odoo...`, { chat_id: chatId, message_id: messageId });
        try {
            const uid = await autenticarOdoo();
            const modelId = await obtenerModeloCrmLead(uid);
            await agendarActividadEnOdoo(uid, parseInt(leadId), modelId, lead.draft.activityTypeId, lead.draft.summary, lead.draft.note);
            bot.editMessageText(`✅ *Actividad guardada* en Odoo para:\n🏢 ${lead.name}`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
            avanzarCola(chatId);
        } catch (error) {
            bot.editMessageText(`❌ Error al agendar en Odoo.`, { chat_id: chatId, message_id: messageId });
            avanzarCola(chatId);
        }
        return;
    }

    if (action === 'EDIT') {
        bot.answerCallbackQuery(query.id);
        const state = userState.get(chatId);
        state.step = 'AWAITING_NOTE';
        state.leadId = leadId;
        state.draft = lead.draft;
        bot.editMessageText(`✏️ *Modo Edición*\nEscribe en este chat el texto exacto a guardar en Odoo.`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        return;
    }
});

// ==========================================
// 5. CRON (REPORTES MATUTINOS)
// ==========================================
// Todos los días de Lunes a Viernes a las 08:00 AM
cron.schedule('0 8 * * 1-5', async () => {
    if (!chatIdAllowed) return;
    
    try {
        const uid = await autenticarOdoo();
        const activities = await obtenerActividadesDeHoy(uid);
        
        if (activities.length === 0) {
            bot.sendMessage(chatIdAllowed, "☀️ ¡Buenos días, Gustavo! No tienes actividades programadas en Odoo para hoy.");
            return;
        }

        let mensaje = `☀️ ¡Buenos días, Gustavo!\n\nTienes *${activities.length}* actividades programadas para hoy:\n\n`;
        
        activities.forEach(act => {
            let icono = "📌";
            if (act.activity_type_id) {
                if (act.activity_type_id[0] === 1) icono = "✉️";
                if (act.activity_type_id[0] === 2) icono = "📞";
                if (act.activity_type_id[0] === 3) icono = "🤝";
            }
            mensaje += `${icono} ${act.summary || 'Sin asunto'} - *${act.res_name || ''}*\n`;
        });
        
        mensaje += `\n¡Éxito en tus gestiones!`;
        bot.sendMessage(chatIdAllowed, mensaje, { parse_mode: 'Markdown' });
        
    } catch (err) {
        console.error("Error ejecutando el cron matutino:", err);
    }
});

console.log("🤖 Bot proactivo de Telegram inicializado y escuchando comandos...");
