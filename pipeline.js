const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const readline = require('readline');

// Rutas de archivos
const ODOO_FILE = path.join(__dirname, 'mi_odoo_real.txt');
const CSV_FILES = ['correos.CSV', 'correos1.CSV', 'correos2.CSV', 'correos3.CSV'];
const FOLDERS_DIR = path.join(__dirname, 'Edgar Uner - 2026 Locales y Representadas');

// Helper para meses
const meses = {
    'enero': 0, 'febrero': 1, 'marzo': 2, 'abril': 3, 'mayo': 4, 'junio': 5,
    'julio': 6, 'agosto': 7, 'septiembre': 8, 'octubre': 9, 'noviembre': 10, 'diciembre': 11
};

function extractDateFromBody(body) {
    if (!body) return null;
    const match = /Enviad[oa] el:\s*(?:[a-z]+,\s*)?(\d{1,2})\s*de\s*([a-z]+)\s*de\s*(\d{4})/i.exec(body);
    if (match) {
        const dia = parseInt(match[1], 10);
        const mes = meses[match[2].toLowerCase()];
        const anio = parseInt(match[3], 10);
        if (mes !== undefined) {
            return new Date(anio, mes, dia);
        }
    }
    return null;
}

function extractEmailDomain(email) {
    if (!email) return 'Desconocido';
    const match = email.match(/@([\w.-]+)/);
    return match ? match[1] : 'Desconocido';
}

function similarity(s1, s2) {
    const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(' ').filter(x => x.length > 2);
    const w1 = normalize(s1);
    const w2 = normalize(s2);
    let common = 0;
    for (const word of w1) {
        if (w2.includes(word)) common++;
    }
    return common / (w1.length || 1);
}

function isDateInRange(date, start, end) {
    return date >= start && date <= end;
}

async function processCSV(filePath, startDate, endDate) {
    return new Promise((resolve) => {
        const results = [];
        let count = 0;
        const intensidad = {};

        if (!fs.existsSync(filePath)) {
            return resolve({ results, count, intensidad });
        }

        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => {
                count++;
                const body = data['Cuerpo'] || '';
                const fromAddress = data['De: (dirección)'] || '';
                
                const date = extractDateFromBody(body);
                if (date && isDateInRange(date, startDate, endDate)) {
                    results.push(data);
                    const domain = extractEmailDomain(fromAddress);
                    intensidad[domain] = (intensidad[domain] || 0) + 1;
                }
            })
            .on('end', () => {
                resolve({ results, count, intensidad });
            })
            .on('error', (err) => {
                console.error(`Error procesando ${filePath}:`, err.message);
                resolve({ results, count, intensidad });
            });
    });
}

function parseOdooData() {
    if (!fs.existsSync(ODOO_FILE)) return [];
    const content = fs.readFileSync(ODOO_FILE, 'utf-8');
    const lines = content.split('\n');
    const opportunities = [];
    
    for (const line of lines) {
        // ID: 7783 | NOMBRE: LPI ANDE 1753 ... | ESTADO: Won
        const match = /ID:\s*(\d+)\s*\|\s*NOMBRE:\s*(.*?)\s*\|\s*ESTADO:\s*(.*)/.exec(line);
        if (match) {
            opportunities.push({
                id: match[1],
                nombre: match[2].trim(),
                estado: match[3].trim()
            });
        }
    }
    return opportunities;
}

function processFolders(startDate, endDate) {
    const foldersProcessed = [];
    if (!fs.existsSync(FOLDERS_DIR)) {
        console.warn(`[Aviso] El directorio de carpetas físicas no existe: ${FOLDERS_DIR}`);
        return foldersProcessed;
    }

    try {
        const items = fs.readdirSync(FOLDERS_DIR);
        for (const item of items) {
            const itemPath = path.join(FOLDERS_DIR, item);
            const stats = fs.statSync(itemPath);
            if (stats.isDirectory()) {
                if (isDateInRange(stats.mtime, startDate, endDate)) {
                    foldersProcessed.push({
                        name: item,
                        mtime: stats.mtime
                    });
                }
            }
        }
    } catch (e) {
        console.error("Error al leer carpetas:", e);
    }
    return foldersProcessed;
}

function generarPromptGemini(datos) {
    return `
Eres el analista experto de Beigel SRL utilizando el "Método del Águila".
Utiliza el siguiente JSON de datos para redactar el contenido textual exacto de las 12 diapositivas del reporte.

Datos:
${JSON.stringify(datos, null, 2)}

Estructura de las 12 diapositivas esperadas (devuelve sólo el texto listo para usar):
1. Portada
2. Resumen Ejecutivo (Ventas cerradas vs pipeline)
3. Alertas Semáforo (Carpetas sin respaldo Odoo)
4. Intensidad de Gestión (Top clientes por interacciones)
5. Análisis de Correos (Eficiencia de comunicación)
6. Oportunidades Clave en Progreso
7. Oportunidades Ganadas (Éxitos)
8. Brechas de Sincronización (Físico vs Digital)
9. Acciones Correctivas
10. Proyección a Corto Plazo
11. Recomendaciones Estratégicas
12. Cierre y Próximos Pasos
`;
}

async function consolidarFuentes(inicio, fin) {
    const fechaInicio = new Date(inicio);
    const fechaFin = new Date(fin);
    // Para que sea inclusivo el fin del dia
    fechaFin.setHours(23, 59, 59, 999);

    console.log(`Consolidando fuentes desde ${fechaInicio.toISOString()} hasta ${fechaFin.toISOString()}`);

    // 1. Procesar Odoo
    const odooOpps = parseOdooData();
    const ventas_cerradas = odooOpps.filter(o => o.estado.toLowerCase() === 'won');
    const pipeline_activo = odooOpps.filter(o => o.estado.toLowerCase() !== 'won' && o.estado.toLowerCase() !== 'lost');

    // 2. Procesar Correos
    let totalCorreos = 0;
    const intensidad_clientes = {};
    for (const file of CSV_FILES) {
        console.log(`Escaneando ${file}...`);
        const { count, intensidad } = await processCSV(path.join(__dirname, file), fechaInicio, fechaFin);
        totalCorreos += count;
        for (const domain in intensidad) {
            intensidad_clientes[domain] = (intensidad_clientes[domain] || 0) + intensidad[domain];
        }
    }

    // 3. Procesar Carpetas Locales
    const carpetasFijas = processFolders(fechaInicio, fechaFin);
    
    // 4. Cruce de Información (Fuzzy Matching para Alertas Semaforo)
    const alertas_semaforo = [];
    for (const carpeta of carpetasFijas) {
        let matched = false;
        for (const opp of odooOpps) {
            // Coincidencia exacta por ID o fuzzy matching
            if (carpeta.name.includes(opp.id) || similarity(carpeta.name, opp.nombre) > 0.3) {
                matched = true;
                break;
            }
        }
        if (!matched) {
            alertas_semaforo.push({
                carpeta_local: carpeta.name,
                modificacion: carpeta.mtime,
                riesgo: "Carpeta activa sin oportunidad respaldada en Odoo"
            });
        }
    }

    const datos_pre_reporte = {
        rango_fechas: { inicio, fin },
        ventas_cerradas,
        pipeline_activo,
        alertas_semaforo,
        resumen_actividad: {
            correos_procesados: totalCorreos,
            carpetas_modificadas: carpetasFijas.length,
            intensidad_clientes
        }
    };

    const prompt_gemini = generarPromptGemini(datos_pre_reporte);

    const informe_final = {
        datos: datos_pre_reporte,
        prompt_para_diapositivas: prompt_gemini
    };

    const outputFile = path.join(__dirname, 'informe_final_datos.json');
    fs.writeFileSync(outputFile, JSON.stringify(informe_final, null, 2));
    console.log(`✅ Archivo generado exitosamente: ${outputFile}`);
}

// Interfaz para ejecución interactiva
if (require.main === module) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question('Ingrese fecha de inicio (YYYY-MM-DD): ', (inicio) => {
        rl.question('Ingrese fecha de fin (YYYY-MM-DD): ', async (fin) => {
            if (!inicio || !fin) {
                // Fechas por defecto para facilitar pruebas si el usuario da enter
                inicio = '2025-04-01';
                fin = '2025-04-30';
                console.log(`Usando fechas por defecto: ${inicio} a ${fin}`);
            }
            try {
                await consolidarFuentes(inicio, fin);
            } catch (err) {
                console.error("Error durante la consolidación:", err);
            }
            rl.close();
        });
    });
}

module.exports = { consolidarFuentes };
