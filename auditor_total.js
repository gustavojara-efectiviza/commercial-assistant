require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Usamos el modelo flash que es rapidísimo para procesar grandes volúmenes de texto
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const rutasCarpetas = [
    'C:\\Users\\gusta\\BEIGEL S.R.L\\Edgar Uner - 2026 Locales',
    'C:\\Users\\gusta\\BEIGEL S.R.L\\Edgar Uner - 2026 Representadas'
];

async function ejecutarAuditoriaGlobal() {
    console.log("🌍 Iniciando AUDITORÍA GLOBAL MASIVA (Sin límite de fechas)...\n");

    try {
        // --- 1. LEER ODOO REAL ---
        console.log("☁️  1. Cargando la base de datos completa de Odoo...");
        const odooReal = fs.readFileSync('mi_odoo_real.txt', 'utf8');

        // --- 2. LEER CARPETAS LOCALES ---
        console.log("📂 2. Escaneando la totalidad de los directorios físicos...");
        let carpetasActivas = "";
        let contadorCarpetas = 0;
        rutasCarpetas.forEach(ruta => {
            try {
                const carpetas = fs.readdirSync(ruta, { withFileTypes: true });
                carpetas.forEach(item => {
                    if (item.isDirectory() && item.name.toUpperCase().startsWith('OF')) {
                        carpetasActivas += `- ${item.name}\n`;
                        contadorCarpetas++;
                    }
                });
            } catch (err) { }
        });
        console.log(`   ✅ Se detectaron ${contadorCarpetas} carpetas de ofertas comerciales.`);

        // --- 3. PROCESAR TODOS LOS ARCHIVOS DE CORREOS (SIN FILTRO DE FECHA) ---
        console.log("📧 3. Procesando el histórico completo de los 4 archivos CSV...");
        let correosTotales = "";

        const archivosEnCarpeta = fs.readdirSync('.');
        const archivosCSV = archivosEnCarpeta.filter(file => file.toUpperCase().endsWith('.CSV'));

        archivosCSV.forEach(archivo => {
            const contenido = fs.readFileSync(archivo, 'utf8');
            // Tomamos el contenido. Si es inmensamente grande, lo limitamos un poco para no saturar la memoria,
            // pero le pasamos la mayor cantidad posible de Asuntos y Remitentes a la IA.
            correosTotales += `\n--- Archivo: ${archivo} ---\n`;
            correosTotales += contenido + '\n';
        });
        console.log(`   ✅ Se cargó el histórico de comunicaciones.\n`);

        // --- 4. EL CEREBRO (Análisis Global) ---
        console.log("🧠 4. Ejecutando el cruce masivo con Inteligencia Artificial. Esto puede tomar un minuto...");

        const prompt = `
            Eres el Auditor General de Sistemas de Beigel SRL.
            Tu objetivo es realizar una AUDITORÍA GLOBAL HISTÓRICA para Gustavo Jara, sin restricciones de fecha.
            
            1. HISTORIAL COMPLETO DE ODOO (La Verdad Absoluta):
            ${odooReal}
            
            2. TODAS LAS CARPETAS FÍSICAS (Lo que existe en su PC):
            ${carpetasActivas}
            
            3. HISTORIAL DE CORREOS (Todas las fechas):
            ${correosTotales.substring(0, 100000)} // Límite de seguridad de caracteres para asegurar procesamiento rápido

            INSTRUCCIONES ESTRICTAS DE AUDITORÍA:
            Compara TODAS las "Carpetas Físicas" contra el "Historial de Odoo". Usa Fuzzy Matching (Ej. "Trafo Seco Museo" es "Museo de Ciencias").
            
            Ignora por completo las carpetas que ya estén en Odoo.
            
            Tu objetivo es entregarme SOLO LO QUE FALTA (Los agujeros negros del sistema). Clasifícalos así:

            🟢 VERDE (Falta Crear - Prioridad Alta): 
            La carpeta NO ESTÁ en Odoo, y encontraste menciones a ese cliente o proyecto en el Historial de Correos (lo que confirma que Gustavo lo gestionó o lo está gestionando).
            
            🟡 NARANJA (Cabos Sueltos - Requiere Revisión): 
            La carpeta NO ESTÁ en Odoo, PERO tampoco encontraste ni un solo correo al respecto. (Puede ser una carpeta vieja, un proyecto muerto, o territorio exclusivo de Jesús/Edgar).

            FORMATO DE SALIDA:
            Presenta un reporte ejecutivo directo. 
            - Lista numerada bajo la categoría VERDE con el nombre de la carpeta y por qué recomiendas crearla.
            - Lista numerada bajo la categoría NARANJA.
            - Al final, dame un número total: "De ${contadorCarpetas} carpetas, te faltan cargar X en Odoo".
        `;

        const result = await model.generateContent(prompt);
        console.log("\n==================================================");
        console.log("📊 DICTAMEN DE AUDITORÍA GLOBAL");
        console.log("==================================================\n");
        console.log(result.response.text());
        console.log("\n==================================================");

        fs.writeFileSync('auditoria_global.txt', result.response.text());
        console.log("💾 Se ha guardado una copia del reporte en 'auditoria_global.txt'.");

    } catch (error) {
        console.error("❌ Error en la auditoría global:", error.message);
    }
}

ejecutarAuditoriaGlobal();