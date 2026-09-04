# Circular Chef

Circular Chef transforma alimentos sobrantes en tres propuestas culinarias detalladas. La interfaz está desarrollada con Next.js y la generación se realiza desde el servidor mediante la API de OpenAI.

La clave de OpenAI nunca se envía al navegador. El backend valida las entradas, llama a la Responses API y exige una salida estructurada que cumpla el esquema de las recetas.

## Funcionalidad

- Entrada manual de alimentos sobrantes.
- Importación de inventario desde CSV o Excel.
- Configuración de comensales, tiempo máximo, estilo y restricciones.
- Tres recetas con cantidades, preparación, pasos, tiempos y temperaturas.
- Notas de aprovechamiento, seguridad alimentaria y elementos descartados.
- Comprobación del estado de la conexión con OpenAI.
- Aplicación web, despliegue Docker y empaquetado de escritorio.

## Arquitectura

```text
Navegador
   │  /api/models y /api/recipes
   ▼
Next.js (servidor)
   │  HTTPS + OPENAI_API_KEY
   ▼
OpenAI Responses API
```

Los archivos CSV o Excel se leen en el navegador; después de la previsualización, únicamente el inventario convertido a texto se incluye en la solicitud de generación.

## Desarrollo local

Necesitas Node.js 22.13 o posterior, conexión a Internet y una clave de OpenAI con facturación disponible.

```bash
npm ci
```

Crea `.env.local`:

```dotenv
OPENAI_API_KEY=sk-tu-clave
OPENAI_MODEL=gpt-5.6-terra
```

Inicia la aplicación:

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000). La cabecera debería mostrar **OpenAI conectado**.

## Variables de entorno

| Variable | Obligatoria | Predeterminado | Uso |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Sí | — | Credencial privada de la API. |
| `OPENAI_MODEL` | No | `gpt-5.6-terra` | Modelo para comprobar la conexión y generar recetas. |
| `OPENAI_ORGANIZATION_ID` | No | — | Organización enviada a OpenAI. |
| `OPENAI_PROJECT_ID` | No | — | Proyecto enviado a OpenAI. |
| `APP_PORT` | No | `3100` | Puerto local publicado por Docker. |
| `APP_IMAGE` | No | `effiwaste-ai-chef:latest` | Nombre de la imagen Docker. |

No uses el prefijo `NEXT_PUBLIC_` para ninguna credencial: esas variables pueden terminar en el JavaScript del navegador.

## Despliegue en el servidor

Producción ejecuta un único contenedor de Next.js. Nginx permanece instalado en el servidor y publica el contenedor mediante HTTPS.

### 1. Instalar Docker

Instala Docker Engine con el repositorio oficial de Docker para tu versión de Ubuntu y verifica:

```bash
docker --version
docker compose version
```

### 2. Obtener el código

```bash
sudo mkdir -p /opt/aichef
sudo chown "$USER":"$USER" /opt/aichef
git clone -b main URL_DE_TU_REPOSITORIO /opt/aichef
cd /opt/aichef
```

Si ya está clonado:

```bash
cd /opt/aichef
git switch main
git pull --ff-only origin main
```

### 3. Crear la configuración privada

```bash
cp .env.example .env
nano .env
```

Contenido mínimo:

```dotenv
APP_PORT=3100
OPENAI_API_KEY=sk-tu-clave-real
OPENAI_MODEL=gpt-5.6-terra
APP_IMAGE=effiwaste-ai-chef:latest
```

Protege el archivo:

```bash
chmod 600 .env
```

`.env` está excluido de Git. No pegues la clave en `compose.yaml`, en el código, en capturas ni en comandos que terminen en el historial del shell.

### 4. Construir e iniciar

```bash
docker compose up -d --build --remove-orphans
docker compose ps
docker compose logs --tail=100 app
```

La aplicación queda escuchando sólo en `127.0.0.1:3100`. Compruébala desde el servidor:

```bash
curl -I http://127.0.0.1:3100
curl -sS http://127.0.0.1:3100/api/models
```

El segundo comando debe devolver `{"online":true}`.

### 5. Configurar Nginx

El repositorio incluye `deploy/nginx/aichef.conf`, preparado para `circularchef.effichef.es`:

```bash
sudo cp deploy/nginx/aichef.conf /etc/nginx/sites-available/aichef
sudo ln -s /etc/nginx/sites-available/aichef /etc/nginx/sites-enabled/aichef
sudo nginx -t
sudo systemctl reload nginx
```

Si el enlace ya existe, no vuelvas a crearlo. Si cambia el dominio, sustituye `server_name` antes de recargar Nginx.

### 6. DNS y HTTPS

En el proveedor DNS crea un registro `A` para el subdominio apuntando a la IPv4 pública del servidor. Cuando la resolución pública sea correcta:

```bash
sudo certbot --nginx -d circularchef.effichef.es
sudo nginx -t
sudo systemctl reload nginx
curl -I https://circularchef.effichef.es
```

### 7. Actualizaciones

Cuando `main` tenga una nueva versión:

```bash
cd /opt/aichef
./scripts/deploy.sh
```

El script actualiza `main`, reconstruye la imagen, recrea la aplicación, retira servicios antiguos y muestra su estado. Nginx y el certificado no necesitan volver a configurarse.

## Aplicación de escritorio

El instalador incluye Electron, Node.js y la aplicación compilada, pero necesita conexión a Internet. En el primer inicio solicita la clave de OpenAI, la valida y la guarda cifrada con el almacén seguro del sistema cuando está disponible. Después inicia el servidor interno sólo en `127.0.0.1`.

También puedes suministrar `OPENAI_API_KEY` y `OPENAI_MODEL` como variables del proceso; en ese caso no aparece el formulario.

```bash
npm run desktop:dev
npm run desktop:package
npm run desktop:dist
npm run desktop:dist:win
```

Los artefactos se generan en `release/`.

## API interna

`GET /api/models` comprueba que existe la clave y que OpenAI reconoce el modelo. Devuelve `{"online":true}` cuando la configuración funciona.

`POST /api/recipes` acepta:

```json
{
  "description": "900 g de pollo asado, 500 g de arroz cocido y dos pimientos",
  "servings": 4,
  "maxTime": 45,
  "restrictions": "sin frutos secos",
  "style": "mediterránea"
}
```

El endpoint limita tamaños y rangos, rechaza solicitudes de otro origen y utiliza salida estructurada estricta. Las respuestas se solicitan con `store: false`.

## Calidad y pruebas

```bash
npm run lint
npm test
npm run test:desktop
```

La suite comprueba la integración con OpenAI, el esquema de recetas, la protección de la clave, Docker/Nginx y el paquete de escritorio.

## Seguridad y privacidad

- La credencial sólo se utiliza en el backend.
- El cliente fija el destino a `https://api.openai.com/v1/` y no admite una URL arbitraria.
- Docker publica la aplicación únicamente en loopback para que Nginx sea el punto de entrada.
- La generación desactiva el almacenamiento de la respuesta mediante `store: false`.
- El inventario y las restricciones se envían a OpenAI; no introduzcas datos personales o secretos.
- Las recetas deben revisarse por cocina y por el sistema APPCC antes de aplicarse.
- Configura límites de gasto y alertas en la cuenta de OpenAI.

## Solución de problemas

Si aparece **OpenAI sin conexión**:

```bash
docker compose ps
docker compose logs --tail=100 app
curl -sS http://127.0.0.1:3100/api/models
```

Revisa `OPENAI_MODEL`, la validez de `OPENAI_API_KEY`, la conectividad HTTPS de salida y que la cuenta tenga acceso y saldo. Un HTTP `429` puede indicar límite temporal, cuota o saldo insuficiente.

Si Nginx devuelve `502`, comprueba primero `curl -I http://127.0.0.1:3100`. Si responde, ejecuta `sudo nginx -t` y recarga Nginx.

Si el dominio abre otro sitio o devuelve `404`, prueba directamente el servidor:

```bash
curl -I --resolve circularchef.effichef.es:443:IP_PUBLICA https://circularchef.effichef.es
```

Si funciona, el contenedor y Nginx están correctos; queda corregir o esperar la resolución DNS del cliente.

## Referencias

- [OpenAI API: crear una respuesta](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Modelos de OpenAI](https://platform.openai.com/docs/models)
- [Docker Engine para Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Certbot con Nginx](https://certbot.eff.org/instructions?ws=nginx&os=ubuntufocal)
