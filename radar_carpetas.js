const fs = require('fs');
const path = require('path');

// Reemplaza esto con tu ruta exacta de Windows
const rutaDirectorio = 'C:\\Users\\gusta\\BEIGEL S.R.L\\Edgar Uner - 2026 Locales';
function escanearOportunidadesLocales() {
    console.log("📡 Iniciando barrido de la carpeta de Ofertas Locales...\n");

    try {
        const carpetas = fs.readdirSync(rutaDirectorio, { withFileTypes: true });

        let contadorOfertas = 0;

        carpetas.forEach(item => {
            if (item.isDirectory() && item.name.toUpperCase().startsWith('OF')) {
                // Expresión regular para separar: OF 18-26 | Rodrigo | Reles...
                const regex = /^OF\s*(\d{1,2}(?:-25|-26)?)\s*[-]?\s*([^-]+)\s*-\s*(.+)$/i;
                const match = item.name.match(regex);

                if (match) {
                    const codigo = `OF ${match[1].trim()}`;
                    const cliente = match[2].trim();
                    const proyecto = match[3].trim();
                    const fechaMod = fs.statSync(path.join(rutaDirectorio, item.name)).mtime;

                    console.log(`🏷️ [${codigo}] | 🏢 CLIENTE: ${cliente.padEnd(15)} | 📝 PROYECTO: ${proyecto.substring(0, 30)}... | 📅 Modificado: ${fechaMod.toLocaleDateString()}`);
                    contadorOfertas++;
                }
            }
        });

        console.log(`\n✅ Se detectaron y estructuraron ${contadorOfertas} carpetas de ofertas comerciales.`);
        console.log("Estas variables ya están listas para cruzarse con Odoo y Outlook.");

    } catch (error) {
        console.error("❌ Error accediendo a la ruta. Verifica que la rutaDirectorio sea correcta:", error.message);
    }
}

escanearOportunidadesLocales();