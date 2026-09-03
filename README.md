# Effiwaste AI Chef

Aplicación que propone tres recetas de reaprovechamiento a partir de los
alimentos disponibles mediante Ollama. Puede utilizar Ollama en el mismo equipo
durante el desarrollo o conectarse de forma segura a un servidor al desplegarse
en Vercel.

## Requisitos

- Node.js 22 o posterior.
- Ollama instalado y en ejecución.
- El modelo `llama3.2:3b`, que es el utilizado siempre por AI Chef.

## Puesta en marcha

1. Descarga el modelo la primera vez:

   ```bash
   ollama pull llama3.2:3b
   ```

2. Comprueba que Ollama está iniciado:

   ```bash
   ollama serve
   ```

3. La primera vez, instala las dependencias desde esta carpeta:

   ```bash
   npm install
   ```

4. Inicia la interfaz:

   ```bash
   npm run dev
   ```

5. Abre `http://localhost:3000`.

La luz de estado de la cabecera indicará si Ollama está conectado. AI Chef
utiliza siempre `llama3.2:3b`; no es necesario configurar un selector.

## Configuración opcional

Ollama se busca en `http://127.0.0.1:11434`. Para utilizar otra dirección:

En Windows PowerShell:

```powershell
$env:OLLAMA_BASE_URL="http://127.0.0.1:11434"
npm run dev
```

En macOS o Linux:

```bash
OLLAMA_BASE_URL=http://127.0.0.1:11434 npm run dev
```

Variables disponibles:

| Variable | Uso |
| --- | --- |
| `OLLAMA_BASE_URL` | URL de Ollama. En producción debe ser una URL HTTPS. |
| `OLLAMA_API_KEY` | Token compartido con el proxy del servidor. Es obligatorio para una URL remota. |
| `OLLAMA_MODEL` | Modelo instalado que debe usar la aplicación. Por defecto, `llama3.2:3b`. |
| `OLLAMA_ALLOW_INSECURE_HTTP` | Permite HTTP remoto sólo si vale `true`; no debe utilizarse en Internet. |

Las variables no llevan el prefijo `NEXT_PUBLIC_`: sólo se leen en las rutas de
servidor y nunca se incluyen en el JavaScript que recibe el navegador.

## Alojar Ollama en un servidor

La carpeta `deploy/ollama` incluye un despliegue con Docker Compose. Ollama sólo
está disponible dentro de la red de Docker y Caddy publica la API con HTTPS y un
token Bearer. No abras el puerto `11434` en el cortafuegos.

Necesitas un servidor Linux con Docker y Docker Compose, y un dominio o subdominio
que apunte a la IP pública del servidor. Por ejemplo, `ollama.midominio.com`.

1. Copia la carpeta `deploy/ollama` al servidor y entra en ella.
2. Crea la configuración local:

   ```bash
   cp env.example .env
   openssl rand -hex 32
   ```

3. Edita `.env`: indica el dominio y pega como `OLLAMA_API_KEY` el token generado.
4. Permite únicamente SSH, HTTP (`80`) y HTTPS (`443`) en el cortafuegos. Mantén
   `11434` cerrado.
5. Inicia el servicio para CPU:

   ```bash
   docker compose up -d
   ```

   Si el servidor tiene una GPU NVIDIA y ya dispone de NVIDIA Container Toolkit:

   ```bash
   docker compose -f compose.yaml -f compose.gpu.yaml up -d
   ```

6. Descarga el modelo dentro del volumen persistente:

   ```bash
   docker compose exec ollama ollama pull llama3.2:3b
   ```

7. Comprueba la API desde otro equipo:

   ```bash
   curl -fsS \
     -H "Authorization: Bearer TU_TOKEN" \
     https://ollama.midominio.com/api/tags
   ```

Caddy solicitará y renovará automáticamente el certificado TLS cuando el DNS
apunte al servidor y los puertos 80 y 443 sean accesibles. Para revisar el
servicio utiliza `docker compose logs -f`.

## Desplegar la web en Vercel

El proyecto compila como una aplicación Next.js y sus dos rutas `/api/models` y
`/api/recipes` se ejecutan como funciones de servidor. La generación admite hasta
300 segundos, aunque el límite efectivo depende del plan configurado en Vercel.

1. Sube este proyecto a un repositorio Git y, en Vercel, selecciona **Add New →
   Project** e importa el repositorio. Como alternativa, ejecuta `npx vercel` desde
   la raíz del proyecto.
2. En **Project Settings → Environment Variables**, añade estas variables tanto
   para Production como para Preview si quieres que ambos entornos funcionen:

   ```text
   OLLAMA_BASE_URL=https://ollama.midominio.com
   OLLAMA_API_KEY=el-mismo-token-configurado-en-el-servidor
   OLLAMA_MODEL=llama3.2:3b
   ```

3. No definas `OLLAMA_ALLOW_INSECURE_HTTP` en Vercel.
4. Despliega o vuelve a desplegar el proyecto después de guardar las variables.
5. Abre la web y pulsa el indicador de conexión. Después genera una receta de
   prueba mientras observas `docker compose logs -f` en el servidor.

El navegador siempre llama a la misma web mediante `/api/...`; es Vercel quien
se conecta a Ollama. Por eso no hay que habilitar CORS ni revelar la URL o el token
al cliente. El control de origen incluido reduce llamadas desde otras webs, pero
si la aplicación será pública conviene añadir también límites de uso o autenticación
en Vercel para evitar que terceros consuman la capacidad del servidor.

## Qué hace

- Acepta los sobrantes escritos en lenguaje natural o importados desde un
  archivo CSV o Excel (`.xlsx`).
- Al importar un archivo, muestra una previsualización editable de cada
  ingrediente, cantidad y unidad antes de permitir generar las recetas.
- Tiene en cuenta comensales, tiempo, estilo culinario y restricciones.
- Pide exactamente tres recetas en español, con ingredientes cuantificados y
  pasos de elaboración numerados.
- Calcula preparación, cocción, duración total y tamaño de la ración.
- Cada paso incluye duración y temperatura o potencia cuando corresponde.
- Advierte sobre ingredientes que el modelo considera dudosos y recuerda que
  toda propuesta debe validarse según el sistema APPCC del establecimiento.
- Envía los alimentos únicamente al servidor de Ollama configurado; el navegador
  no se conecta directamente a Ollama.

## Formato de los archivos

La primera hoja de un archivo Excel, o el CSV completo, debe contener estas
columnas recomendadas:

| ingrediente | cantidad | unidad |
| --- | ---: | --- |
| Tomate maduro | 2.5 | kg |
| Pan del desayuno | 3 | barras |
| Queso | 500 | g |

También se reconocen encabezados equivalentes como `producto`, `alimento`,
`peso`, `nombre`, `ingredient`, `amount` o `unit`. Los CSV pueden utilizar
coma, punto y coma o tabulador como separador. Si no hay encabezados, la
aplicación interpreta las tres primeras columnas en el orden ingrediente,
cantidad y unidad.

Después de seleccionar el archivo, revisa y corrige la tabla de
previsualización. No se generarán recetas mientras exista alguna fila sin
nombre, sin unidad o con una cantidad que no sea mayor que cero.

## Verificación

```bash
npm run build
npm test
```

## Aplicación de escritorio e instalador

La versión de escritorio incluye Node.js, la aplicación web compilada y el motor de Ollama.
La persona que la recibe no necesita instalar dependencias ni utilizar una terminal. En el primer
inicio, AI Chef arranca Ollama y descarga automáticamente el modelo `llama3.2:3b`; para ello se
necesitan conexión a Internet y varios GB de espacio libre. Los siguientes inicios funcionan con
el modelo guardado en el equipo.

Para generar el instalador en el sistema operativo actual:

```bash
npm install
npm run desktop:dist
```

Para generar desde macOS el instalador de Windows x64:

```bash
npm run desktop:dist:win
```

Los archivos para compartir se crean en `release/`:

- macOS: imagen de instalación `.dmg` y archivo `.zip`.
- Windows: instalador `.exe` (NSIS).
- Linux: ejecutable `.AppImage`.

En macOS, el proceso reutiliza `/Applications/Ollama.app` si ya existe y, si no, descarga el
paquete oficial. Para Windows x64, descarga el paquete autónomo oficial de Ollama, verifica su
suma SHA-256 y lo incorpora al instalador; no es necesario tener un equipo Windows para construir
el `.exe`. Debido al tamaño de los componentes de aceleración de Ollama, la descarga y el
empaquetado pueden tardar varios minutos.

### Firma para distribución pública

Un instalador sin firma puede abrirse manualmente, pero macOS Gatekeeper o Windows SmartScreen
mostrarán una advertencia. Para una distribución pública sin avisos es necesario firmar y, en
macOS, notarizar el instalador con certificados propios de Apple; en Windows se requiere un
certificado de firma de código. Electron Builder utiliza automáticamente las credenciales de firma
configuradas en el entorno de compilación.
