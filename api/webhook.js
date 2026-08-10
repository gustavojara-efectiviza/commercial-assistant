import TelegramBot from 'node-telegram-bot-api';
import admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';

// 1. INICIALIZAR FIREBASE ADMIN (SEGURO PARA SERVERLESS)
if (!admin.apps.length) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                // Manejar los saltos de línea en la clave privada si viene desde variables de entorno
                privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
            })
        });
        console.log("Firebase inicializado correctamente.");
    } catch (error) {
        console.error("Error inicializando Firebase:", error);
    }
}
const db = admin.firestore();

// 2. INICIALIZAR SERVICIOS (TELEGRAM Y GEMINI)
const token = process.env.TELEGRAM_BOT_TOKEN;
// Nota: en Serverless, no usamos 'polling: true'
const bot = new TelegramBot(token);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// 3. HANDLER DEL WEBHOOK PARA VERCEL
export default async function handler(req, res) {
    // Validar método
    if (req.method !== 'POST') {
        return res.status(200).send('Webhook activo. Esperando solicitudes POST de Telegram.');
    }

    try {
        const update = req.body;
        // Le pasamos el objeto update directamente a la instancia del bot
        await procesarActualizacion(update);
        return res.status(200).send('OK');
    } catch (error) {
        console.error("Error procesando webhook:", error);
        return res.status(500).send('Error');
    }
}

// 4. LÓGICA DE PROCESAMIENTO
async function procesarActualizacion(update) {
    // Si es un mensaje de texto
    if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const text = msg.text || '';

        // Comando /start
        if (text.startsWith('/start')) {
            await bot.sendMessage(chatId, `🤖 ¡Hola! Soy tu asistente comercial Serverless.\nUsa /auditar para evaluar oportunidades.`);
            return;
        }

        // Comando /auditar
        if (text.startsWith('/auditar')) {
            await bot.sendMessage(chatId, "🔍 Buscando oportunidad estancada en Odoo (Modo Serverless)...");

            // MOCK de Odoo
            const leadMock = {
                id: 12345,
                name: "Implementación Sistema Eléctrico Básico",
                cliente: "Constructora XYZ",
                etapa: "Calificación",
                proveedor: "Schneider",
                suministro: "Tableros Eléctricos",
                monto: 15000
            };

            const mensaje = `
🏢 *Oportunidad (Mock):* ${leadMock.name}
👤 *Cliente:* ${leadMock.cliente}
📍 *Etapa:* ${leadMock.etapa}
⚙️ *Proveedor:* ${leadMock.proveedor}
📦 *Suministro:* ${leadMock.suministro}
💰 *Monto:* $${leadMock.monto}

¿Qué acción deseas tomar?
            `;

            const inline_keyboard = [
                [
                    { text: '📞 Llamar', callback_data: `CALL_${leadMock.id}` },
                    { text: '🤝 Reunión', callback_data: `MEET_${leadMock.id}` }
                ],
                [
                    { text: '⏭️ Ignorar', callback_data: `IGNORE_${leadMock.id}` }
                ]
            ];

            await bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
            return;
        }

        // Si no es comando, verificamos si está en "Modo Edición" en Firebase
        const sessionRef = db.collection('sesiones').doc(chatId.toString());
        const doc = await sessionRef.get();

        if (doc.exists) {
            const data = doc.data();
            if (data.esperandoEdicion) {
                // El usuario ha enviado la nota personalizada
                const notaFinal = text;
                
                await bot.sendMessage(chatId, `⏳ Guardando en Odoo (Simulado):\n\n"${notaFinal}"`);
                
                // MOCK de guardado en Odoo...
                // await agendarActividadEnOdoo(...)

                // Limpiamos el estado en Firebase
                await sessionRef.update({
                    esperandoEdicion: false,
                    draftData: null
                });

                await bot.sendMessage(chatId, "✅ Actividad guardada correctamente en el CRM.");
                return;
            }
        }
    }

    // Si es un callback (toque de botón)
    if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;

        const [action, leadId] = data.split('_');

        if (action === 'IGNORE') {
            await bot.answerCallbackQuery(query.id);
            await bot.editMessageText(`⏭️ Oportunidad ignorada.`, { chat_id: chatId, message_id: messageId });
            return;
        }

        // Solicitar borrador a Gemini
        if (action === 'CALL' || action === 'MEET') {
            await bot.answerCallbackQuery(query.id, { text: "⏳ Consultando a Gemini..." });
            await bot.editMessageText(`⏳ Redactando objetivo estratégico con IA...`, { chat_id: chatId, message_id: messageId });

            const summary = action === 'CALL' ? "Llamada de seguimiento" : "Reunión de avance";
            
            const prompt = `
                Eres un ejecutivo de ventas. Vas a agendar una actividad (${summary}) para una oportunidad.
                Redacta SOLO el objetivo estratégico de esta acción en 1 o 2 líneas máximo, con tono comercial y directo. NO agregues firmas, saludos ni aclaraciones de IA.
            `;

            try {
                const result = await model.generateContent(prompt);
                const borradorIA = result.response.text().trim();

                // Guardar temporalmente en Firestore para poder recuperar el borrador si deciden "Aprobar" después (Opcional, pero útil en serverless)
                const sessionRef = db.collection('sesiones').doc(chatId.toString());
                await sessionRef.set({
                    esperandoEdicion: false, // Aun no está editando, solo viendo opciones
                    draftData: {
                        action: action,
                        leadId: leadId,
                        note: borradorIA
                    }
                }, { merge: true });

                const mensajeBorrador = `
📝 *Borrador generado:*

"${borradorIA}"

¿Deseas aprobar este texto o personalizarlo?
                `;

                const inline_keyboard = [
                    [
                        { text: '✅ Aprobar y Guardar', callback_data: `APPROVE_${leadId}` },
                        { text: '✏️ Editar / Personalizar', callback_data: `EDIT_${leadId}` }
                    ]
                ];

                await bot.editMessageText(mensajeBorrador, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard }, parse_mode: 'Markdown' });

            } catch (error) {
                console.error("Error en Gemini:", error);
                await bot.editMessageText(`❌ Error consultando a Gemini.`, { chat_id: chatId, message_id: messageId });
            }
            return;
        }

        // Flujo de Aprobación o Edición
        if (action === 'APPROVE') {
            await bot.answerCallbackQuery(query.id, { text: "Guardando..." });
            
            // Aquí iría el guardado real en Odoo. Por ahora simulamos.
            await bot.editMessageText(`✅ *Actividad guardada* en Odoo con el texto sugerido por IA.`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
            return;
        }

        if (action === 'EDIT') {
            await bot.answerCallbackQuery(query.id);
            
            // Activar flag en Firebase
            const sessionRef = db.collection('sesiones').doc(chatId.toString());
            await sessionRef.set({
                esperandoEdicion: true
            }, { merge: true });

            await bot.editMessageText(`✏️ *Modo Edición Activado*\nPor favor, escribe en este chat el texto exacto que quieres guardar.`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
            return;
        }
    }
}
