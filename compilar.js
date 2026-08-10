const fs = require('fs');
const path = require('path');

// Rutas de archivos
const INPUT_JSON = path.join(__dirname, 'informe_final_datos.json');
const TEMPLATE_HTML = path.join(__dirname, 'template.html');
const OUTPUT_HTML = path.join(__dirname, 'reporte_junio_final.html');

// Palabras clave aprobadas para grandes proyectos de infraestructura (Página 4)
const PROJECT_KEYWORDS = [
    'ande', 'lpi', 'lpn', 'itaipu', 'itaipú', 'acaray', 'se ', 'ssee', 'subestacion', 'subestación',
    'hospital', 'trafo seco', 'trafos secos', 'trafos seco', 'trafo de distrib', 'skid', 'roggio',
    'cie', 'parglass', 'concretmix', 'cajubi', 'consorcio', 'datacenter', 'id '
];

// Clientes conocidos para mejorar el desglose de nombres
const KNOWN_CLIENTS = [
    'ANDE', 'Itaipu', 'Itaipú', 'Cargill', 'Elkem', 'ELKEM', 'CIE', 'WEG', 'VMA',
    'Concretmix', 'CONO SRL', 'CONO', 'Unicentro', 'Chortitzer', 'Linde', 'Inpagas',
    'Tecnomyl', 'Cecon', 'CECON', 'Perseverancia', 'Netlogic', 'Inmersa', 'INMERSA',
    'Garden Automotores', 'Garden', 'Petroquim', 'Alcoenergy', 'Alcogreen', 'Cogorno',
    'Amandau', 'Upisa', 'Inpet', 'Clyfsa', 'Caiassa', 'ADM', 'Hospital de Itaugua',
    'Hospital Nacional de Itaugua', 'Hospital', 'Roggio', 'TEPISA', 'CAJUBI', 'Consorcio',
    'Linkcenter', 'LINKCENTER', 'Claro'
];

// Formateador de fechas
function formatFecha(str) {
    if (!str) return '';
    const parts = str.split('-');
    if (parts.length !== 3) return str;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// Analizador semántico del nombre de Odoo para extraer cliente y solución
function parseOpportunity(opp) {
    const name = opp.nombre || '';
    let client = 'Cliente General';
    let solution = name;
    let product = 'Servicio / Provisión';

    // 1. Buscar cliente conocido en el nombre
    for (const kc of KNOWN_CLIENTS) {
        const regex = new RegExp('\\b' + kc + '\\b', 'i');
        if (regex.test(name)) {
            client = kc;
            break;
        }
    }

    // 2. Intentar desglosar usando guiones, viñetas o asteriscos
    const parts = name.split(/\s*[-–—•\*]\s*/);
    if (parts.length > 1) {
        // Encontrar en qué parte está el cliente
        const clientPartIndex = parts.findIndex(p => new RegExp(client, 'i').test(p));
        if (clientPartIndex !== -1) {
            if (clientPartIndex === 0) {
                solution = parts.slice(1).join(' - ');
            } else {
                solution = parts[0];
                product = parts.slice(1).join(' - ');
            }
        } else {
            solution = parts[0];
            product = parts.slice(1).join(' - ');
        }
    } else {
        // Buscar patrón "para [Nombre]"
        const clientMatch = name.match(/para\s+([A-Z][a-zA-Z\s\.]+)/i);
        if (clientMatch) {
            client = clientMatch[1].trim();
        }
    }

    // Limpieza de cliente por defecto si sigue genérico y hay siglas de empresas
    if (client === 'Cliente General') {
        const capitalizedMatch = name.match(/\b([A-Z]{3,})\b/);
        if (capitalizedMatch) {
            client = capitalizedMatch[1];
        }
    }

    // Remover redundancia del nombre del cliente en el detalle de la solución
    if (client !== 'Cliente General') {
        solution = solution.replace(new RegExp('\\b' + client + '\\b', 'gi'), '')
                           .replace(/^\s*[-–—•\*]\s*/, '')
                           .replace(/\s*[-–—•\*]\s*$/, '')
                           .trim();
    }

    if (!solution) solution = name;
    
    // Formatear mayúsculas y acortar strings muy largos
    if (client.length > 30) client = client.substring(0, 30) + '...';
    if (solution.length > 120) solution = solution.substring(0, 120) + '...';
    if (product.length > 40) product = product.substring(0, 40) + '...';

    return { client, solution, product };
}

// Filtro de proyectos de infraestructura
function isLargeProject(opp) {
    const name = (opp.nombre || '').toLowerCase();
    return PROJECT_KEYWORDS.some(kw => name.includes(kw));
}

// Función principal de compilación
function compilarReporte() {
    console.log('📖 Leyendo archivos de datos y plantillas...');

    if (!fs.existsSync(INPUT_JSON)) {
        console.error(`❌ Error: No se encontró el archivo de datos en ${INPUT_JSON}`);
        process.exit(1);
    }
    if (!fs.existsSync(TEMPLATE_HTML)) {
        console.error(`❌ Error: No se encontró la plantilla HTML en ${TEMPLATE_HTML}`);
        process.exit(1);
    }

    const rawData = fs.readFileSync(INPUT_JSON, 'utf8');
    const jsonParsed = JSON.parse(rawData);
    
    // Acceder a los datos bajo la propiedad "datos"
    const datos = jsonParsed.datos || {};
    
    const rango_fechas = datos.rango_fechas || { inicio: '2026-06-04', fin: '2026-06-04' };
    const ventas_cerradas = datos.ventas_cerradas || [];
    const pipeline_activo = datos.pipeline_activo || [];

    console.log(`📊 Odoo data: ${ventas_cerradas.length} ventas cerradas y ${pipeline_activo.length} oportunidades en pipeline.`);

    // 1. Formatear período
    const periodoStr = `Del ${formatFecha(rango_fechas.inicio)} al ${formatFecha(rango_fechas.fin)}`;

    // 2. Procesar Página 1: Cierres Ganados ("Won")
    let cierresHtml = '';
    if (ventas_cerradas.length === 0) {
        cierresHtml = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Sin ventas ganadas en este período</td></tr>`;
    } else {
        ventas_cerradas.forEach(opp => {
            const parsed = parseOpportunity(opp);
            const uniqueId = `won-${opp.id}`;
            cierresHtml += `
                <tr id="row-${uniqueId}">
                    <td><input type="text" id="input-${uniqueId}-asesor" class="editable-input" value="Gustavo" oninput="saveToLocalStorage(this.id, this.value)"></td>
                    <td><input type="text" id="input-${uniqueId}-cliente" class="editable-input" value="${parsed.client}" oninput="saveToLocalStorage(this.id, this.value)"></td>
                    <td><input type="text" id="input-${uniqueId}-solucion" class="editable-input" value="${parsed.solution}" oninput="saveToLocalStorage(this.id, this.value)"></td>
                    <td><input type="number" id="input-${uniqueId}-monto" class="editable-input monto-field" value="0" placeholder="0" oninput="saveToLocalStorage(this.id, this.value); calculateCierresTotal()"></td>
                    <td><input type="text" id="input-${uniqueId}-oc" class="editable-input" value="" placeholder="Pendiente" oninput="saveToLocalStorage(this.id, this.value)"></td>
                    <td><input type="text" id="input-${uniqueId}-entrega" class="editable-input" value="" placeholder="Inmediata" oninput="saveToLocalStorage(this.id, this.value)"></td>
                </tr>`;
        });
    }

    // 3. Procesar Página 2: Negocios Activos (Normales)
    const pipelineNormal = pipeline_activo.filter(opp => !isLargeProject(opp));
    let activosHtml = '';
    if (pipelineNormal.length === 0) {
        activosHtml = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Sin oportunidades activas estándar</td></tr>`;
    } else {
        pipelineNormal.forEach(opp => {
            const parsed = parseOpportunity(opp);
            const uniqueId = `active-${opp.id}`;
            activosHtml += `
                <tr id="row-${uniqueId}">
                    <td><input type="text" id="input-${uniqueId}-asesor" class="editable-input" value="Gustavo" oninput="saveToLocalStorage(this.id, this.value)"></td>
                    <td><input type="text" id="input-${uniqueId}-cliente" class="editable-input" value="${parsed.client}" oninput="saveToLocalStorage(this.id, this.value)"></td>
                    <td><input type="text" id="input-${uniqueId}-solucion" class="editable-input" value="${parsed.solution}" oninput="saveToLocalStorage(this.id, this.value)"></td>
                    <td><input type="number" id="input-${uniqueId}-monto" class="editable-input monto-field" value="0" placeholder="0" oninput="saveToLocalStorage(this.id, this.value)"></td>
                    <td>
                        <div class="semaphore-container">
                            <span class="sem-pill sem-green" onclick="selectSemaphore(this, 'green')">🟢 Av.</span>
                            <span class="sem-pill sem-yellow" onclick="selectSemaphore(this, 'yellow')">🟡 Trab.</span>
                            <span class="sem-pill sem-red" onclick="selectSemaphore(this, 'red')">🔴 Riesg.</span>
                            <input type="hidden" id="input-${uniqueId}-status" class="sem-input" value="">
                        </div>
                    </td>
                    <td><input type="number" id="input-${uniqueId}-prob" class="editable-input" value="" placeholder="%" oninput="saveToLocalStorage(this.id, this.value)"></td>
                    <td><input type="text" id="input-${uniqueId}-medidas" class="editable-input" value="" placeholder="Plan de empuje..." oninput="saveToLocalStorage(this.id, this.value)"></td>
                </tr>`;
        });
    }

    // 4. Procesar Página 4: Licitaciones y Proyectos (Infraestructura)
    const pipelineProyectos = pipeline_activo.filter(opp => isLargeProject(opp));
    let proyectosHtml = '';
    if (pipelineProyectos.length === 0) {
        proyectosHtml = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Sin grandes proyectos de infraestructura activos</td></tr>`;
    } else {
        pipelineProyectos.forEach(opp => {
            const parsed = parseOpportunity(opp);
            const uniqueId = `project-${opp.id}`;
            proyectosHtml += `
                <tr id="row-${uniqueId}">
                    <td><input type="text" id="input-${uniqueId}-asesor" class="editable-input" value="Gustavo" oninput="saveToLocalStorage(this.id, this.value)"></td>
                    <td><input type="text" id="input-${uniqueId}-cliente" class="editable-input" value="${parsed.client}" oninput="saveToLocalStorage(this.id, this.value)"></td>
                    <td><input type="text" id="input-${uniqueId}-solucion" class="editable-input" value="${parsed.solution}" oninput="saveToLocalStorage(this.id, this.value)"></td>
                    <td><input type="number" id="input-${uniqueId}-monto" class="editable-input monto-field" value="0" placeholder="0" oninput="saveToLocalStorage(this.id, this.value)"></td>
                    <td>
                        <div class="semaphore-container">
                            <span class="sem-pill sem-green" onclick="selectSemaphore(this, 'green')">🟢 Av.</span>
                            <span class="sem-pill sem-yellow" onclick="selectSemaphore(this, 'yellow')">🟡 Trab.</span>
                            <span class="sem-pill sem-red" onclick="selectSemaphore(this, 'red')">🔴 Riesg.</span>
                            <input type="hidden" id="input-${uniqueId}-status" class="sem-input" value="">
                        </div>
                    </td>
                    <td><input type="number" id="input-${uniqueId}-prob" class="editable-input" value="" placeholder="%" oninput="saveToLocalStorage(this.id, this.value)"></td>
                    <td><input type="text" id="input-${uniqueId}-medidas" class="editable-input" value="" placeholder="Acción estratégica..." oninput="saveToLocalStorage(this.id, this.value)"></td>
                </tr>`;
        });
    }

    // 5. Procesar Página 5: Presupuestos Emitidos (Oferta enviada y en revisión)
    const pipelinePresupuestos = pipeline_activo.filter(opp => 
        opp.estado === 'Oferta enviada' || opp.estado === 'Oferta en revisión'
    );
    let presupuestosHtml = '';
    if (pipelinePresupuestos.length === 0) {
        presupuestosHtml = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Sin presupuestos emitidos registrados en Odoo</td></tr>`;
    } else {
        pipelinePresupuestos.forEach(opp => {
            const parsed = parseOpportunity(opp);
            const uniqueId = `budget-${opp.id}`;
            presupuestosHtml += `
                <tr id="row-${uniqueId}">
                    <td><input type="text" id="input-${uniqueId}-cliente" class="editable-input" value="${parsed.client}" oninput="saveDynamicTables()"></td>
                    <td><input type="text" id="input-${uniqueId}-detail" class="editable-input" value="${parsed.solution}" oninput="saveDynamicTables()"></td>
                    <td><input type="number" id="input-${uniqueId}-amount" class="editable-input monto-field" value="0" placeholder="0" oninput="saveDynamicTables()"></td>
                    <td>
                        <select id="input-${uniqueId}-status" class="editable-input" onchange="saveDynamicTables()" style="width: 100%; background: transparent; color: inherit; border: none; font-size: 0.75rem;">
                            <option value="Enviada" ${opp.estado === 'Oferta enviada' ? 'selected' : ''} style="background-color: var(--bg-secondary);">Enviada</option>
                            <option value="En revisión" ${opp.estado === 'Oferta en revisión' ? 'selected' : ''} style="background-color: var(--bg-secondary);">En revisión</option>
                            <option value="Borrador" style="background-color: var(--bg-secondary);">Borrador</option>
                        </select>
                    </td>
                    <td class="no-print"><button class="btn-delete-row" onclick="deleteRow(this)">🗑️</button></td>
                </tr>`;
        });
    }

    // 6. Leer plantilla HTML y reemplazar placeholders
    console.log('🔄 Reemplazando marcadores de posición en la plantilla...');
    let templateHtml = fs.readFileSync(TEMPLATE_HTML, 'utf8');

    templateHtml = templateHtml
        .replace(/{{RANGO_FECHAS}}/g, periodoStr)
        .replace(/{{CIERRES_ROWS}}/g, cierresHtml)
        .replace(/{{NEGOCIOS_ACTIVOS_ROWS}}/g, activosHtml)
        .replace(/{{LICITACIONES_PROYECTOS_ROWS}}/g, proyectosHtml)
        .replace(/{{PRESUPUESTOS_ROWS}}/g, presupuestosHtml);

    // 7. Guardar reporte final
    fs.writeFileSync(OUTPUT_HTML, templateHtml, 'utf8');
    console.log(`✅ ¡Reporte compilado con éxito! Archivo creado en: ${OUTPUT_HTML}`);
}

compilarReporte();
