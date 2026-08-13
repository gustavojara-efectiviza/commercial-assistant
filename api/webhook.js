const telegramModule = require('node-telegram-bot-api');
const TelegramBot = telegramModule.default || telegramModule;
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const odoo = require('../odoo_service');

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
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

async function parsearFecha(texto) {
    const hoy = new Date().toISOString().split('T')[0];
    const prompt = `Hoy es ${hoy}. El usuario quiere agendar algo para: "${texto}".
Devuelve ÚNICAMENTE la fecha en formato YYYY-MM-DD. No agregues texto extra. Si no logras entender, devuelve mañana.`;
    try {
        const result = await model.generateContent(prompt);
        let fecha = result.response.text().trim().replace(/[^0-9-]/g, '');
        if (fecha.length !== 10) throw new Error("Formato incorrecto");
        return fecha;
    } catch (e) {
        let mañana = new Date();
        mañana.setDate(mañana.getDate() + 1);
        return mañana.toISOString().split('T')[0];
    }
}

async function procesarSiguienteEnCola(chatId, sessionDoc) {
    const data = sessionDoc.data();
    if (!data || !data.queue || data.currentIndex >= data.queue.length) {
        await bot.sendMessage(chatId, "✅ Has procesado todo tu lote de oportunidades estancadas.");
        await sessionDoc.ref.delete();
        return;
    }

    const lead = data.queue[data.currentIndex];
    
    // VERIFICAR TAREAS PENDIENTES
    try {
        const uid = await odoo.autenticarOdoo();
        const activities = await odoo.obtenerActividadesDeLead(uid, lead.id);
        
        if (activities && activities.length > 0) {
            const act = activities[0];
            const hoyDate = new Date();
            const actDate = new Date(act.date_deadline);
            // calcular dias de atraso
            const diffTime = hoyDate.getTime() - actDate.getTime();
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            let estadoFecha = diffDays > 0 ? `(Vencida hace ${diffDays} días)` : diffDays === 0 ? `(Vence Hoy)` : `(A futuro)`;

            const mensaje = `⚠️ *Tarea Pendiente para:* ${lead.name}\n\n📌 *${act.summary || 'Sin asunto'}*\n📅 Fecha límite: ${act.date_deadline} ${estadoFecha}\n\n¿Qué deseas hacer con esta tarea?`;
            
            const inline_keyboard = [
                [ { text: '✅ Simplemente Marcar Hecha', callback_data: `ACTDONE_${act.id}` } ],
                [ { text: '📝 Hecha + Siguiente Paso', callback_data: `ACTNEXT_${act.id}` } ],
                [ { text: '📅 Reagendar', callback_data: `ACTRESCHEDULE_${act.id}` } ],
                [ { text: '⏭️ Pasar al siguiente', callback_data: `ACTSKIP_${act.id}` } ],
                [ { text: '❌ Cancelar Tarea', callback_data: `ACTCANCEL_${act.id}` } ]
            ];

            await bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
            return; // Esperamos respuesta a esta tarea
        }
    } catch (err) {
        console.error("Error obteniendo actividades:", err);
    }

    // SI NO HAY TAREAS PENDIENTES -> ANALISIS GEMINI
    const cliente = lead.partner_id ? lead.partner_id[1] : 'Sin cliente';
    const etapa = lead.stage_id ? lead.stage_id[1] : 'Desconocida';
    const monto = lead.expected_revenue || 0;

    const prompt = `Eres un asistente de ventas analizando una oportunidad estancada.
DATOS: Nombre: ${lead.name}, Cliente: ${cliente}, Etapa: ${etapa}, Monto: ${monto}
Redacta un análisis comercial BREVE (máximo 3 líneas) sobre por qué está estancada y qué sugieres hacer.`;

    try {
        const result = await model.generateContent(prompt);
        const analisisGemini = result.response.text().trim();

        const mensajeText = `*(${data.currentIndex + 1}/${data.queue.length}) Oportunidad:*
🏢 *Nombre:* ${lead.name}
👤 *Cliente:* ${cliente}
📍 *Etapa:* ${etapa}
💰 *Monto:* ${monto}

🤖 *Análisis:*
_${analisisGemini}_

¿Qué acción deseas tomar?`;

        const inline_keyboard = [
            [
                { text: '📞 Llamada', callback_data: `CALL_${lead.id}` },
                { text: '🤝 Reunión', callback_data: `MEET_${lead.id}` },
                { text: '✉️ Correo', callback_data: `MAIL_${lead.id}` }
            ],
            [
                { text: '📝 Nota Interna', callback_data: `NOTE_${lead.id}` },
                { text: '⏭️ Ignorar', callback_data: `IGNORE_${lead.id}` }
            ]
        ];

        await bot.sendMessage(chatId, mensajeText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
    } catch (error) {
        console.error(error);
        await bot.sendMessage(chatId, "❌ Error procesando con Gemini.");
    }
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send('Webhook activo.');
    try {
        await procesarActualizacion(req.body);
        return res.status(200).send('OK');
    } catch (error) {
        console.error("Error procesando webhook:", error);
        return res.status(200).send('Error internally resolved');
    }
}

async function procesarActualizacion(update) {
    if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const text = msg.text || '';

        if (text.startsWith('/start')) {
            await bot.sendMessage(chatId, `🤖 ¡Hola! Usa /auditar para evaluar oportunidades.`);
            return;
        }

        if (text.startsWith('/auditar')) {
            await bot.sendMessage(chatId, "🔍 Obteniendo oportunidades y verificando tareas pendientes...");
            try {
                const uid = await odoo.autenticarOdoo();
                const leads = await odoo.buscarOportunidades(uid, 5);
                if (leads.length === 0) {
                    await bot.sendMessage(chatId, "✅ No encontré oportunidades estancadas.");
                    return;
                }
                const sessionRef = db.collection('sesiones').doc(chatId.toString());
                await sessionRef.set({ step: 'AUDIT_QUEUE', queue: leads, currentIndex: 0, estado: 'IDLE' });
                const sessionDoc = await sessionRef.get();
                await procesarSiguienteEnCola(chatId, sessionDoc);
            } catch (err) {
                console.error(err);
                await bot.sendMessage(chatId, "❌ Error conectando con Odoo.");
            }
            return;
        }

        // MAQUINA DE ESTADOS TEXTO
        const sessionRef = db.collection('sesiones').doc(chatId.toString());
        const doc = await sessionRef.get();
        if (doc.exists) {
            const data = doc.data();
            
            // Si esperamos la fecha para una nueva actividad
            if (data.estado === 'AWAITING_DATE') {
                await bot.sendMessage(chatId, "⏳ Entendiendo fecha y guardando en Odoo...");
                try {
                    const uid = await odoo.autenticarOdoo();
                    const modelId = await odoo.obtenerModeloCrmLead(uid);
                    
                    const fechaParseada = await parsearFecha(text);
                    const draftData = data.draftData;
                    
                    const notaConHora = `[Solicitado: ${text}] - ${draftData.note}`;
                    await odoo.agendarActividadEnOdoo(uid, parseInt(draftData.leadId), modelId, draftData.activityTypeId, draftData.summary, notaConHora, fechaParseada);
                    
                    await bot.sendMessage(chatId, `✅ Actividad guardada para el ${fechaParseada}.`);
                } catch(e) {
                    console.error(e);
                    await bot.sendMessage(chatId, "❌ Error al agendar.");
                }

                await sessionRef.update({ estado: 'IDLE', draftData: FieldValue.delete(), currentIndex: data.currentIndex + 1 });
                const updatedDoc = await sessionRef.get();
                await procesarSiguienteEnCola(chatId, updatedDoc);
                return;
            }

            // Si esperamos edicion de borrador de IA antes de la fecha
            if (data.estado === 'AWAITING_EDIT') {
                const draftData = data.draftData;
                draftData.note = text.trim();
                await sessionRef.update({ estado: 'AWAITING_DATE', draftData: draftData });
                await bot.sendMessage(chatId, `✅ Borrador actualizado.\n\n¿Para cuándo quieres agendar la actividad? (Ej. "Mañana a las 10", "El próximo lunes")`);
                return;
            }

            // Si esperamos fecha de reagendamiento
            if (data.estado === 'AWAITING_RESCHEDULE_DATE') {
                await bot.sendMessage(chatId, "⏳ Reagendando tarea en Odoo...");
                try {
                    const uid = await odoo.autenticarOdoo();
                    const fechaParseada = await parsearFecha(text);
                    await odoo.reagendarActividad(uid, data.actId, fechaParseada);
                    await bot.sendMessage(chatId, `✅ Tarea reagendada para el ${fechaParseada}.`);
                } catch(e) {
                    console.error(e);
                    await bot.sendMessage(chatId, "❌ Error al reagendar tarea.");
                }
                
                await sessionRef.update({ estado: 'IDLE', actId: FieldValue.delete() });
                const updatedDoc = await sessionRef.get();
                // Volvemos a procesar, ahora la tarea es a futuro, así que no saldrá como pendiente
                await procesarSiguienteEnCola(chatId, updatedDoc); 
                return;
            }

            // Si esperamos feedback para cerrar una tarea
            if (data.estado === 'AWAITING_ACT_FEEDBACK') {
                await bot.sendMessage(chatId, "⏳ Cerrando tarea en Odoo...");
                try {
                    const uid = await odoo.autenticarOdoo();
                    await odoo.marcarActividadHecha(uid, data.actId, text);
                    await bot.sendMessage(chatId, "✅ Tarea cerrada con tu comentario.");
                } catch(e) {
                    console.error(e);
                    await bot.sendMessage(chatId, "❌ Error al cerrar tarea.");
                }
                
                await sessionRef.update({ estado: 'IDLE', actId: FieldValue.delete() });
                const updatedDoc = await sessionRef.get();
                // Volvemos a procesar el mismo lead. Ahora q la tarea está cerrada, pasará a la siguiente o al análisis.
                await procesarSiguienteEnCola(chatId, updatedDoc); 
                return;
            }
            
            // Si esperamos una nota interna
            if (data.estado === 'AWAITING_NOTE') {
                await bot.sendMessage(chatId, "⏳ Guardando nota en Odoo...");
                try {
                    const uid = await odoo.autenticarOdoo();
                    const leadId = data.queue[data.currentIndex].id;
                    await odoo.registrarNotaInterna(uid, leadId, text);
                    await bot.sendMessage(chatId, "✅ Nota guardada exitosamente en el historial.");
                } catch(e) {
                    console.error(e);
                    await bot.sendMessage(chatId, "❌ Error al guardar nota.");
                }
                
                await sessionRef.update({ estado: 'IDLE', currentIndex: data.currentIndex + 1 });
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

        const sessionRef = db.collection('sesiones').doc(chatId.toString());
        const sessionDoc = await sessionRef.get();
        if (!sessionDoc.exists) {
            await bot.answerCallbackQuery(query.id, { text: "⚠️ Sesión expirada.", show_alert: true });
            return;
        }

        const sessionData = sessionDoc.data();
        const currentLead = sessionData.queue[sessionData.currentIndex];

        // LOGICA DE BOTONES DE ACTIVIDAD (ACTDONE, ACTNEXT, ACTCANCEL)
        if (data.startsWith('ACT')) {
            const [action, actIdStr] = data.split('_');
            const actId = parseInt(actIdStr);

            if (action === 'ACTCANCEL') {
                await bot.answerCallbackQuery(query.id, { text: "Cancelando..." });
                await bot.editMessageText(`⏳ Cancelando tarea en Odoo...`, { chat_id: chatId, message_id: messageId });
                try {
                    const uid = await odoo.autenticarOdoo();
                    await odoo.cancelarActividad(uid, actId);
                    await bot.editMessageText(`❌ Tarea cancelada.`, { chat_id: chatId, message_id: messageId });
                } catch(e) {
                    console.error(e);
                    await bot.sendMessage(chatId, "❌ Error al cancelar tarea.");
                }
                const updatedDoc = await sessionRef.get();
                await procesarSiguienteEnCola(chatId, updatedDoc);
                return;
            }

            if (action === 'ACTDONE') {
                await bot.answerCallbackQuery(query.id, { text: "Marcando como hecha..." });
                await bot.editMessageText(`⏳ Cerrando tarea en Odoo...`, { chat_id: chatId, message_id: messageId });
                try {
                    const uid = await odoo.autenticarOdoo();
                    await odoo.marcarActividadHecha(uid, actId, ''); // sin comentario
                    await bot.editMessageText(`✅ Tarea marcada como hecha.`, { chat_id: chatId, message_id: messageId });
                } catch(e) {
                    console.error(e);
                    await bot.sendMessage(chatId, "❌ Error al cerrar tarea.");
                }
                const updatedDoc = await sessionRef.get();
                await procesarSiguienteEnCola(chatId, updatedDoc);
                return;
            }

            if (action === 'ACTNEXT') {
                await bot.answerCallbackQuery(query.id);
                await sessionRef.update({ estado: 'AWAITING_ACT_FEEDBACK', actId: actId });
                await bot.editMessageText(`📝 Por favor, escribe en este chat el comentario o resultado de esta tarea para darla por terminada.`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
                return;
            }

            if (action === 'ACTRESCHEDULE') {
                await bot.answerCallbackQuery(query.id);
                await sessionRef.update({ estado: 'AWAITING_RESCHEDULE_DATE', actId: actId });
                await bot.editMessageText(`📅 *Reagendar Tarea*\n¿Para cuándo quieres reagendarla? (Ej. "Mañana", "El lunes a las 10").`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
                return;
            }

            if (action === 'ACTSKIP') {
                await bot.answerCallbackQuery(query.id);
                await bot.editMessageText(`⏭️ Tarea ignorada por ahora.`, { chat_id: chatId, message_id: messageId });
                await sessionRef.update({ currentIndex: sessionData.currentIndex + 1 });
                const updatedDoc = await sessionRef.get();
                await procesarSiguienteEnCola(chatId, updatedDoc);
                return;
            }
        }

        // LOGICA DE BOTONES DE OPORTUNIDAD (CALL, MEET, MAIL, NOTE, IGNORE, APPROVE, EDIT)
        const [action, leadIdStr] = data.split('_');
        const leadId = parseInt(leadIdStr);

        if (!currentLead || currentLead.id !== leadId) {
            await bot.answerCallbackQuery(query.id, { text: "⚠️ Este lead ya no está activo.", show_alert: true });
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

        if (action === 'NOTE') {
            await bot.answerCallbackQuery(query.id);
            await sessionRef.update({ estado: 'AWAITING_NOTE' });
            await bot.editMessageText(`📝 *Registrar Nota Interna*\nEscribe en este chat el comentario que deseas guardar en el historial de la oportunidad.`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
            return;
        }

        if (action === 'CALL' || action === 'MEET' || action === 'MAIL') {
            await bot.answerCallbackQuery(query.id, { text: "⏳ Consultando a Gemini..." });
            await bot.editMessageText(`⏳ Redactando objetivo estratégico con IA...`, { chat_id: chatId, message_id: messageId });

            let activityTypeId = action === 'CALL' ? 2 : action === 'MEET' ? 3 : 1;
            let summary = action === 'CALL' ? `Llamada de seguimiento` : action === 'MEET' ? `Reunión de avance` : `Enviar correo de seguimiento`;

            const prompt = `Eres un ejecutivo de ventas. Vas a agendar una actividad (${summary}) para la oportunidad "${currentLead.name}".
Redacta SOLO el objetivo estratégico de esta acción en 1 o 2 líneas máximo, con tono comercial y directo. NO agregues firmas ni aclaraciones.`;

            try {
                const result = await model.generateContent(prompt);
                const borradorIA = result.response.text().trim();

                await sessionRef.update({
                    draftData: { action: action, leadId: leadId, note: borradorIA, activityTypeId: activityTypeId, summary: summary }
                });

                const mensajeBorrador = `📝 *Borrador generado:*\n\n"${borradorIA}"\n\n¿Deseas aprobar este texto o personalizarlo?`;
                const inline_keyboard = [
                    [
                        { text: '✅ Aprobar Texto', callback_data: `APPROVE_${leadId}` },
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
            await bot.answerCallbackQuery(query.id);
            await sessionRef.update({ estado: 'AWAITING_DATE' });
            await bot.editMessageText(`✅ Borrador aprobado.\n\n¿Para cuándo quieres agendar la actividad? (Ej. "Mañana a las 10am", "El próximo lunes")`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
            return;
        }

        if (action === 'EDIT') {
            await bot.answerCallbackQuery(query.id);
            await sessionRef.update({ estado: 'AWAITING_EDIT' });
            await bot.editMessageText(`✏️ *Modo Edición*\nEscribe en este chat el texto exacto que quieres guardar como objetivo de la actividad.`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
            return;
        }
    }
}
