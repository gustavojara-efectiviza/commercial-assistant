require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// 🚀 EL CAMBIO CLAVE: Ahora es una lista (Array) de rutas. 
// En el futuro, haremos que un menú te pregunte qué rutas poner aquí.
const rutasAAnalizar = [
    'C:\\Users\\gusta\\BEIGEL S.R.L\\Edgar Uner - 2026 Locales',
    'C:\\Users\\gusta\\BEIGEL S.R.L\\Edgar Uner - 2026 Representadas' // <-- VERIFICA ESTE NOMBRE
];

async function generarAnalisisIntegral() {
    console.log("🔄 Iniciando Analizador Integral Multiproyecto...\n");

    try {
        // --- 1. RECOPILACIÓN DE DATOS LOCALES (AHORA MULTI-CARPETA) ---
        console.log("1️⃣  Leyendo estructura de archivos locales...");
        let listadoCarpetas = "";
        let totalOportunidades = 0;

        rutasAAnalizar.forEach(ruta => {
            try {
                const nombreCarpetaRaiz = path.basename(ruta);
                listadoCarpetas += `\n--- ORIGEN: ${nombreCarpetaRaiz} ---\n`;

                const carpetas = fs.readdirSync(ruta, { withFileTypes: true });
                carpetas.forEach(item => {
                    if (item.isDirectory() && item.name.toUpperCase().startsWith('OF')) {
                        listadoCarpetas += `- ${item.name}\n`;
                        totalOportunidades++;
                    }
                });
                console.log(`   ✅ Leída exitosamente: ${nombreCarpetaRaiz}`);
            } catch (err) {
                console.log(`   ⚠️ No se pudo acceder a: ${ruta}. Revisa si el nombre es exacto.`);
            }
        });

        console.log(`   📊 Total de oportunidades físicas detectadas: ${totalOportunidades}`);

        // --- 2. RECOPILACIÓN DE CORREOS ---
        console.log("\n2️⃣  Cargando actividad de Outlook (Enviados/Recibidos)...");
        let correosRecibidos = "Bandeja de entrada no proporcionada.";
        let correosEnviados = "Bandeja de salida no proporcionada.";
        try { correosRecibidos = fs.readFileSync('recibidos.CSV', 'utf8'); } catch (e) { }
        try { correosEnviados = fs.readFileSync('correos.CSV', 'utf8'); } catch (e) { }

        // --- 3. DATOS DEL CRM (Odoo Simulados) ---
        console.log("3️⃣  Cargando estado actual del CRM (Odoo)...");
        const datosCRM = `
            Ventas Registradas: Concret Mix ($43.5K), Rodrigo ($5.8K), Perseverancia ($2.7K), Rieder ($0.2K).
            Oportunidades en curso registradas: Engineering ($8K), Bit7even ($3.8K), Enersur, Elkem.
        `;

        // --- 4. ANÁLISIS CON INTELIGENCIA ARTIFICIAL ---
        console.log("\n🧠 Ejecutando cruce de datos con Gemini AI. Evaluando grado de actualización...");

        const prompt = `
            Eres el Director de Inteligencia Comercial de Beigel SRL, evaluando la gestión operativa de Gustavo Jara.
            Tu tarea es auditar el "Grado de Actualización del CRM (Odoo)" comparando lo que está anotado en el sistema vs. la realidad de sus carpetas de trabajo.

            FUENTE 1: CARPETAS LOCALES REALES (Lo que realmente está cotizando)
            ${listadoCarpetas}

            FUENTE 2: CRM (Lo que declaró oficialmente)
            ${datosCRM}

            INSTRUCCIONES ESTRICTAS:
            1. Compara la cantidad y los nombres de los clientes en la FUENTE 1 con la FUENTE 2. 
            2. Si Gustavo tiene decenas de carpetas "OF" (Ofertas) creadas en sus directorios locales, pero solo 8 declaradas en el CRM, el nivel de actualización es crítico.
            3. Identifica "Fugas de Pipeline": Enumera las 5 oportunidades más evidentes (clientes) que tienen carpeta física pero no figuran en el registro del CRM.
            
            PRESENTA TU INFORME ASÍ:
            - 📊 ÍNDICE DE SALUD DEL CRM: [Calcula un porcentaje estimado. Explica de forma contundente la matemática: "Detecté X oportunidades físicas vs Y registradas"].
            - 🚨 OPORTUNIDADES FANTASMA: [Lista de proyectos que Gustavo debe cargar en Odoo urgentemente].
            - 🎯 RECOMENDACIÓN GERENCIAL: [Qué hacer].
        `;

        const result = await model.generateContent(prompt);

        console.log("\n==================================================");
        console.log("📑 DICTAMEN DE AUDITORÍA IA");
        console.log("==================================================\n");
        console.log(result.response.text());
        console.log("\n==================================================");

    } catch (error) {
        console.error("❌ Error general en el analizador:", error.message);
    }
}

generarAnalisisIntegral();