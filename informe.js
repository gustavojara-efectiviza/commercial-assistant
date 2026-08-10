require('dotenv').config();
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configuración de Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

async function generarInformeFinal() {
    console.log("📊 Iniciando lectura de texto en bruto y consolidación de datos...");

    try {
        // 1. Leemos tu archivo exactamente como lo tienes ahora (texto libre)
        // Nota: Asegúrate de que el nombre del archivo coincida exactamente con las mayúsculas: 'correos.CSV'
        const textoCorreos = fs.readFileSync('correos.CSV', 'utf8');

        console.log("✅ Texto de correos cargado correctamente en memoria.");

        // 2. Definimos los datos de éxito de Odoo (los que vimos en tu planilla)
        const datosVentas = `
            - Ventas Cerradas: $52.2K total.
            - Clientes: Concret Mix ($43.5K), Rodrigo ($5.8K), Perseverancia ($2.7K), Rieder ($0.2K).
            - Nuevas Propuestas enviadas: Enersur (Trafos Secos), Elkem (Ventilador).
            - Visitas: Rieder-GE-Artec.
        `;

        // 3. Le pedimos a Gemini que haga el trabajo pesado de interpretar el desorden
        const prompt = `
            Actúa como un Director Comercial Senior. Redacta un Informe Ejecutivo de Gestión Semanal para la gerencia de Beigel SRL.
            
            PERÍODO: 23 al 27 de febrero de 2026.
            ASESOR: Gustavo Jara.

            DATOS DE VENTAS CERRADAS (Extraídos del CRM):
            ${datosVentas}

            COMUNICACIONES DE LA SEMANA (Texto en bruto extraído de Outlook):
            ${textoCorreos}

            INSTRUCCIONES PARA EL INFORME:
            1. Resumen de Logros: Destaca el volumen de $52.2K y el cierre clave de Concret Mix.
            2. Análisis de Actividad de Correos: Lee el texto en bruto de las comunicaciones (nota la interacción con William Fernandes de GE Renewable Energy u otros si los hay) y resume las gestiones realizadas.
            3. Proyección y Próximos Pasos: Menciona estratégicamente los $11.8K pendientes de cierre (Engineering $8K y Bit7even $3.8K).
            
            Escribe el informe final directamente. Usa un tono corporativo, ejecutivo y persuasivo.
        `;

        console.log("🧠 Procesando con Inteligencia Artificial. Esto tomará unos segundos...");
        const result = await model.generateContent(prompt);

        console.log("\n==================================================");
        console.log("📋 INFORME EJECUTIVO GENERADO:");
        console.log("==================================================\n");
        console.log(result.response.text());
        console.log("\n==================================================");

    } catch (error) {
        console.error("\n❌ Error en el proceso:", error.message);
        console.log("Revisa que el archivo se llame exactamente 'correos.CSV' y esté en la misma carpeta.");
    }
}

generarInformeFinal();