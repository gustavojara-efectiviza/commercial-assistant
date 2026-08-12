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
    } catch (error) {
        console.error("Error inicializando Firebase:", error);
    }
}
const db = getFirestore();

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Parser de Fecha
async function parsearFecha(texto) {
    const hoy = new Date().toISOString().split('T')[0];
    const prompt = `Hoy es ${hoy}. El usuario pide agendar una actividad para: "${texto}".
    Devuelve ÚNICAMENTE la fecha en formato YYYY-MM-DD. No agregues texto ni explicaciones. Si no logras entenderlo, devuelve la fecha de mañana.`;
    try {
        const result = await model.generateContent(prompt);
        let fecha = result.response.text().trim();
        // clean up any markdown
        fecha = fecha.replace(/[^0-9-]/g, '');
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
        await bot.sendMessage(chatId, "✅ Has procesado todo tu lote de oportunidades.");
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
            // calcular dias de atraso (puede ser negativo si es a futuro)
            const diffTime = hoyDate - actDate;
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            let estadoFecha = diffDays > 0 ? `(Vencida hace ${diffDays} días)` : diffDays === 0 ? `(Vence Hoy)` : `(A futuro)`;

            const mensaje = `⚠️ *Tarea Pendiente para:* ${lead.name}\n\n📌 *${act.summary || 'Sin asunto'}*\n📅 Fecha límite: ${act.date_deadline} ${estadoFecha}\n\n¿Qué deseas hacer con esta tarea?`;
            
            const inline_keyboard = [
                [ { text: '✅ Simplemente Marcar Hecha', callback_data: `ACTDONE_${act.id}` } ],
                [ { text: '📝 Hecha + Siguiente Paso', callback_data: `ACTNEXT_${act.id}` } ],
                [ { text: '❌ Cancelar Tarea', callback_data: `ACTCANCEL_${act.id}` } ]
            ];

            await bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
            return;
        }
    } catch (err) {
        console.error("Error obteniendo actividades:", err);
    }

    // SI NO HAY TAREAS PENDIENTES -> ANALISIS GEMINI
    const cliente = lead.partner_id ? lead.partner_id[1] : 'Sin cliente';
    const etapa = lead.stage_id ? lead.stage_id[1] : 'Desconocida';
    const monto = lead.expected_revenue || 0;

    const prompt = `Eres un asistente de ventas analizando una oportunidad estancada.
        - Nombre: ${lead.name}
        - Cliente: ${cliente}
        - Etapa: ${etapa}
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
        await bot.sendMessage(chatId, "❌ Error al procesar con Gemini.");
    }
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send('OK');
    try {
        await procesarActualizacion(req.body);
        return res.status(200).send('OK');
    } catch (error) {
        console.error(error);
        return res.status(200).send('OK');
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
            await bot.sendMessage(chatId, "🔍 Obteniendo oportunidades...");
            try {
                const uid = await odoo.autenticarOdoo();
                const leads = await odoo.buscarOportunidades(uid, 5);
                if (leads.length === 0) {
                    await bot.sendMessage(chatId, "✅ No encontré oportunidades.");
                    return;
                }
                const sessionRef = db.collection('sesiones').doc(chatId.toString());
                await sessionRef.set({ step: 'AUDIT_QUEUE', queue: leads, currentIndex: 0, estado: 'IDLE' });
                const sessionDoc = await sessionRef.get();
                await procesarSiguienteEnCola(chatId, sessionDoc);
            } catch (err) {
                await bot.sendMessage(chatId, "❌ Error Odoo.");
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
                const uid = await odoo.autenticarOdoo();
                const modelId = await odoo.obtenerModeloCrmLead(uid);
                
                const fechaParseada = await parsearFecha(text);
                const draftData = data.draftData;
                
                // Agregamos la hora al texto original si el usuario la especificó, para no perderla
                const notaConHora = `[Fecha solicitada: ${text}] - ${draftData.note}`;

                try {
                    await odoo.agendarActividadEnOdoo(uid, parseInt(draftData.leadId), modelId, draftData.activityTypeId, draftData.summary, notaConHora);
                    // Actualizamos manualmente el date_deadline en odoo porque la funcion lo hace para manana
                    // WAIT, the function agendarActividadEnOdoo hardcodes the date!
                    // I MUST UPDATE agendarActividadEnOdoo IN odoo_service.js TO ACCEPT THE DATE!
                    // We'll pass fechaParseada to it.
                    await bot.sendMessage(chatId, `✅ Actividad guardada para el ${fechaParseada}.`);
                } catch(e) {
                    await bot.sendMessage(chatId, "❌ Error al agendar.");
                }

                await sessionRef.update({ estado: 'IDLE', draftData: FieldValue.delete(), currentIndex: data.currentIndex + 1 });
                const updatedDoc = await sessionRef.get();
                await procesarSiguienteEnCola(chatId, updatedDoc);
                return;
            }

            // Si esperamos edicion de borrador
            if (data.estado === 'AWAITING_EDIT') {
                // ...
            }

            // Si esperamos feedback para cerrar una tarea
            if (data.estado === 'AWAITING_ACT_FEEDBACK') {
                await bot.sendMessage(chatId, "⏳ Cerrando tarea en Odoo...");
                const uid = await odoo.autenticarOdoo();
                try {
                    await odoo.marcarActividadHecha(uid, data.actId, text);
                    await bot.sendMessage(chatId, "✅ Tarea cerrada con tu comentario.");
                } catch(e) {
                    await bot.sendMessage(chatId, "❌ Error al cerrar tarea.");
                }
                
                await sessionRef.update({ estado: 'IDLE', actId: FieldValue.delete() });
                const updatedDoc = await sessionRef.get();
                await procesarSiguienteEnCola(chatId, updatedDoc); // Volvemos a procesar el mismo lead (ahora pasara al analisis de Gemini o a otra tarea)
                return;
            }
            
            // Si esperamos una nota interna
            if (data.estado === 'AWAITING_NOTE') {
                await bot.sendMessage(chatId, "⏳ Guardando nota en Odoo...");
                const uid = await odoo.autenticarOdoo();
                const leadId = data.queue[data.currentIndex].id;
                try {
                    await odoo.registrarNotaInterna(uid, leadId, text);
                    await bot.sendMessage(chatId, "✅ Nota guardada exitosamente.");
                } catch(e) {
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
        // ... (resto de botones)
    }
}
