const TelegramBot = require('node-telegram-bot-api');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const odoo = require('../odoo_service');

// 1. INICIALIZAR FIREBASE ADMIN (SEGURO PARA SERVERLESS)
if (!getApps().length) {
    try {
        initializeApp({
            credential: cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
            })
        });
        console.log("Firebase inicializado correctamente.");
    } catch (error) {
        console.error("Error inicializando Firebase:", error);
    }
}
const db = getFirestore();

// 2. INICIALIZAR SERVICIOS
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// ==========================================
// LÓGICA DE COLA STATELESS CON FIREBASE
// ==========================================
async function procesarSiguienteEnCola(chatId, sessionDoc) {
    const data = sessionDoc.data();
    if (!data || !data.queue || data.currentIndex >= data.queue.length) {
        await bot.sendMessage(chatId, "✅ Has procesado todo tu lote de oportunidades estancadas.");
        await sessionDoc.ref.delete();
        return;
    }

    const lead = data.queue[data.currentIndex];
    
    const cliente = lead.partner_id ? lead.partner_id[1] : 'Sin cliente';
    const etapa = lead.stage_id ? lead.stage_id[1] : 'Desconocida';
    const proveedor = lead.x_studio_proveedor_1 || '';
    const suministro = lead.x_studio_suministro || '';
    const monto = lead.expected_revenue || 0;

    const prompt = `
        Eres un asistente de ventas senior analizando una oportunidad estancada.
        DATOS DE LA OPORTUNIDAD:
        - Nombre: ${lead.name}
        - Cliente: ${cliente}
        - Etapa: ${etapa}
        - Notas: ${lead.description || 'Sin notas'}
        Redacta un análisis comercial BREVE (máximo 3 líneas) sobre por qué está estancada y qué sugieres hacer. Dirígete a Gustavo.
    `;

    try {
        const result = await model.generateContent(prompt);
        const analisisGemini = result.response.text().trim();

        const mensajeText = `
*(${data.currentIndex + 1}/${data.queue.length}) Oportunidad en Cola:*
🏢 *Nombre:* ${lead.name}
👤 *Cliente:* ${cliente}
📍 *Etapa:* ${etapa}
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

        await bot.sendMessage(chatId, mensajeText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
    } catch (error) {
        console.error("Error en analisis de cola:", error);
        await bot.sendMessage(chatId, "❌ Error al procesar la oportunidad con Gemini.");
    }
}

// 3. HANDLER DEL WEBHOOK PARA VERCEL
module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).send('Webhook activo. Esperando solicitudes POST de Telegram.');
    }

    try {
        const update = req.body;
        await procesarActualizacion(update);
        return res.status(200).send('OK');
    } catch (error) {
        console.error("Error procesando webhook:", error);
        // Respondemos 200 para que Telegram no reintente infinitamente si hay un error nuestro
        return res.status(200).send('Error internally resolved');
    }
}

async function procesarActualizacion(update) {
    if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const text = msg.text || '';

        if (text.startsWith('/start')) {
            await bot.sendMessage(chatId, `🤖 ¡Hola! Soy tu asistente comercial Serverless.\nUsa /auditar para evaluar oportunidades estancadas.`);
            return;
        }

        if (text.startsWith('/auditar')) {
            await bot.sendMessage(chatId, "🔍 Conectando a Odoo y obteniendo el lote de oportunidades estancadas...");
            try {
                const uid = await odoo.autenticarOdoo();
                const leads = await odoo.buscarOportunidades(uid, 5);

                if (leads.length === 0) {
                    await bot.sendMessage(chatId, "✅ ¡Todo al día! No encontré oportunidades estancadas.");
                    return;
                }

                const sessionRef = db.collection('sesiones').doc(chatId.toString());
                await sessionRef.set({
                    step: 'AUDIT_QUEUE',
                    queue: leads,
                    currentIndex: 0,
                    esperandoEdicion: false
                });

                const sessionDoc = await sessionRef.get();
                await procesarSiguienteEnCola(chatId, sessionDoc);
            } catch (err) {
                console.error("Error en auditar:", err);
                await bot.sendMessage(chatId, "❌ Error al conectar con Odoo.");
            }
            return;
        }

        // Modo edición
        const sessionRef = db.collection('sesiones').doc(chatId.toString());
        const doc = await sessionRef.get();

        if (doc.exists) {
            const data = doc.data();
            if (data.esperandoEdicion) {
                const uid = await odoo.autenticarOdoo();
                const modelId = await odoo.obtenerModeloCrmLead(uid);
                const draftData = data.draftData;

                await bot.sendMessage(chatId, `⏳ Guardando en Odoo con tu nota personalizada...`);
                try {
                    await odoo.agendarActividadEnOdoo(uid, parseInt(draftData.leadId), modelId, draftData.activityTypeId, draftData.summary, text.trim());
                    await bot.sendMessage(chatId, "✅ Actividad guardada correctamente en Odoo.");
                } catch (e) {
                    console.error("Error agendando editado", e);
                    await bot.sendMessage(chatId, "❌ Fallo al agendar en Odoo.");
                }

                // Avanzar cola
                await sessionRef.update({
                    esperandoEdicion: false,
                    draftData: FieldValue.delete(),
                    currentIndex: data.currentIndex + 1
                });

                const updatedDoc = await sessionRef.get();
                await procesarSiguienteEnCola(chatId, updatedDoc);
                return;
            }
        }
    }

    if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;

        const [action, leadIdStr] = data.split('_');
        const leadId = parseInt(leadIdStr);

        const sessionRef = db.collection('sesiones').doc(chatId.toString());
        const sessionDoc = await sessionRef.get();
        if (!sessionDoc.exists) {
            await bot.answerCallbackQuery(query.id, { text: "⚠️ Sesión expirada.", show_alert: true });
            return;
        }

        const sessionData = sessionDoc.data();
        const currentLead = sessionData.queue[sessionData.currentIndex];

        if (!currentLead || currentLead.id !== leadId) {
            await bot.answerCallbackQuery(query.id, { text: "⚠️ Este lead ya no está activo en la cola.", show_alert: true });
            return;
        }

        if (action === 'IGNORE') {
            await bot.answerCallbackQuery(query.id);
            await bot.editMessageText(`⏭️ Oportunidad ignorada: ${currentLead.name}`, { chat_id: chatId, message_id: messageId });
            
            await sessionRef.update({ currentIndex: sessionData.currentIndex + 1 });
            const updatedDoc = await sessionRef.get();
            await procesarSiguienteEnCola(chatId, updatedDoc);
            return;
        }

        if (action === 'CALL' || action === 'MEET' || action === 'MAIL') {
            await bot.answerCallbackQuery(query.id, { text: "⏳ Consultando a Gemini..." });
            await bot.editMessageText(`⏳ Redactando objetivo estratégico con IA...`, { chat_id: chatId, message_id: messageId });

            let activityTypeId = action === 'CALL' ? 2 : action === 'MEET' ? 3 : 1;
            let summary = action === 'CALL' ? `Llamada de seguimiento` : action === 'MEET' ? `Reunión de avance` : `Enviar correo de seguimiento`;

            const prompt = `
                Eres un ejecutivo de ventas. Vas a agendar una actividad (${summary}) para la oportunidad "${currentLead.name}".
                Redacta SOLO el objetivo estratégico de esta acción en 1 o 2 líneas máximo, con tono comercial y directo. NO agregues firmas, saludos ni aclaraciones de IA.
            `;

            try {
                const result = await model.generateContent(prompt);
                const borradorIA = result.response.text().trim();

                await sessionRef.update({
                    draftData: {
                        action: action,
                        leadId: leadId,
                        note: borradorIA,
                        activityTypeId: activityTypeId,
                        summary: summary
                    }
                });

                const mensajeBorrador = `
📝 *Borrador generado:*

"${borradorIA}"

¿Deseas aprobar este texto o personalizarlo?
                `;

                const inline_keyboard = [
                    [
                        { text: '✅ Aprobar y Guardar', callback_data: `APPROVE_${leadId}` },
                        { text: '✏️ Editar', callback_data: `EDIT_${leadId}` }
                    ]
                ];

                await bot.editMessageText(mensajeBorrador, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });
            } catch (error) {
                console.error("Error en Gemini:", error);
                await bot.editMessageText(`❌ Error consultando a Gemini.`, { chat_id: chatId, message_id: messageId });
            }
            return;
        }

        if (action === 'APPROVE') {
            await bot.answerCallbackQuery(query.id, { text: "Guardando..." });
            await bot.editMessageText(`⏳ Guardando en Odoo...`, { chat_id: chatId, message_id: messageId });

            const draftData = sessionData.draftData;
            try {
                const uid = await odoo.autenticarOdoo();
                const modelId = await odoo.obtenerModeloCrmLead(uid);
                await odoo.agendarActividadEnOdoo(uid, leadId, modelId, draftData.activityTypeId, draftData.summary, draftData.note);
                await bot.editMessageText(`✅ *Actividad guardada* en Odoo para:\n🏢 ${currentLead.name}`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
            } catch (e) {
                console.error("Error aprobando:", e);
                await bot.editMessageText(`❌ Error al agendar en Odoo.`, { chat_id: chatId, message_id: messageId });
            }

            await sessionRef.update({ 
                draftData: FieldValue.delete(),
                currentIndex: sessionData.currentIndex + 1 
            });
            const updatedDoc = await sessionRef.get();
            await procesarSiguienteEnCola(chatId, updatedDoc);
            return;
        }

        if (action === 'EDIT') {
            await bot.answerCallbackQuery(query.id);
            await sessionRef.update({ esperandoEdicion: true });
            await bot.editMessageText(`✏️ *Modo Edición Activado*\nPor favor, escribe en este chat el texto exacto que quieres guardar.`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
            return;
        }
    }
}
