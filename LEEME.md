# Vira · maqueta de la app

Maqueta interactiva de la app de las pulseras, en un solo archivo: `index.html`. Es una demostración conceptual con datos simulados: no se conecta a pulseras reales. Desde la E3, los giros salen de rutas de OpenStreetMap y ya no de Google Maps.

## Cómo abrirla

- **En el computador:** abre `index.html` con Chrome o Edge (doble clic). La primera vez necesita internet para cargar las tipografías; sin internet usa Bahnschrift y Segoe UI, que se parecen.
- **En un teléfono:** copia el archivo al teléfono y ábrelo con Chrome. En pantallas angostas la app ocupa toda la pantalla, sin el marco, para probarla con repartidores. En Android, las vibraciones también hacen vibrar el teléfono.

## Qué tiene

| Parte | Qué muestra |
|---|---|
| Inicio con el logo | Los dos arcos se dibujan y aparece el punto ámbar |
| Guía de tres pasos | Una pulsera en cada brazo · vibra el lado del giro · luz ámbar para pedidos. Se puede deslizar |
| Permisos | Los cinco permisos de Android (incluida la ubicación para seguir la ruta), con los diálogos del sistema |
| Emparejar | La lista de dispositivos de Android, la pulsera que vibra y su lugar en el brazo |
| Pulseras | Las dos pulseras a tamaño real, con conexión y batería. Al tocar una, vibra |
| En ruta | Pantalla oscura con el próximo giro; el borde del lado del giro pulsa |
| Pedido | Notificación de la app de reparto, luces ámbar en las dos pulseras y aviso en la app |
| Actividad | Los giros del día, cada uno del lado en que vibró, y los pedidos en ámbar |
| Ajustes | Intensidad, luces de pedidos, apps de reparto, aviso de batería baja |
| Batería | Hoja inferior con la carga aproximada de cada pulsera |

## Panel de presentación (a la derecha)

- **Reproducir recorrido:** recorre la app sola en cerca de un minuto y medio, con un texto que explica cada paso. Sirve para la presentación de E2.
- **Desde cero:** vuelve a la primera vez que se abre la app.
- **Lo que siente el repartidor:** las dos pulseras físicas, que vibran y se encienden igual que en la app.
- **Simular:** giro a la izquierda, giro a la derecha, pedido nuevo, batería baja y desconexión.

## Ruta real con OpenStreetMap (agregado el 29-oct-2026, para la E3)

En el panel de la derecha, la sección **Ruta real · OpenStreetMap**:

1. Elige un trayecto de Santiago (o toca el mapa para cambiar el destino) y si va en bici o en moto.
2. La maqueta le pide la ruta a OSRM, un motor de rutas gratuito que usa los mapas de OpenStreetMap (servidor de prueba de FOSSGIS, `routing.openstreetmap.de`).
3. **Recorrer la ruta** simula al repartidor avanzando por esa ruta, 10 veces más rápido que en la calle. Antes de cada giro real, la pantalla En ruta muestra la calle y la distancia, y vibra la pulsera de ese lado: unos 60 m antes en bici y 120 m antes en moto. Cada giro queda anotado en Actividad.

Qué es real y qué no: **los giros y las calles son reales** (los calcula OpenStreetMap); **el avance del repartidor es simulado** (en la app real lo da el GPS del teléfono).

El fondo del mapa es el estilo «positron» de **OpenFreeMap** (datos de OpenStreetMap, gratis y sin clave). **El sector de Santiago de los tres trayectos viene guardado en `vendor/mapa_santiago.js`** (teselas, tipografías e íconos, 4,3 MB), así que el mapa se ve **sin internet** y abriendo con doble clic. Fuera de esa zona, el mapa se completa desde OpenFreeMap si hay conexión. La librería del mapa también está en `vendor/` (MapLibre GL JS 4.7.1).

**Hay que copiar la carpeta completa** (`index.html` + `vendor/`), no solo el HTML.

Para regenerar el paquete (otra zona o datos más nuevos): `node vendor/build_mapa_santiago.mjs vendor/mapa_santiago.js` (necesita Node e internet). El área y los zooms se cambian al inicio del script. No se usa PMTiles porque pide el archivo por partes y eso no funciona al abrir con doble clic (`file://`).

Sin internet, los tres trayectos predefinidos usan una ruta guardada el 29 de octubre; lo único que necesita internet es calcular una ruta nueva tocando el mapa.

## Panel para la plataforma (agregado el 29-oct-2026)

Lo que vería Uber Eats, Rappi o PedidosYa: se abre con el botón **«Ver el panel de la plataforma»** del panel de la derecha, o directo con la dirección `?vista=plataforma` (sirve también en el celular en vertical: https://vicente-ca.github.io/vira-maqueta/?vista=plataforma).

- Muestra las métricas del informe `reports/Métricas de valor para plataformas.md`: exposición a pantalla en movimiento (la principal, comparando con pulsera vs. sin pulsera), uso de la pulsera, avisos a tiempo, giros correctos y satisfacción; un gráfico semanal y una tabla por zona.
- **Los números son simulados** (piloto ficticio de 8 semanas con 92 repartidores) y el panel lo dice. Solo la franja «En esta demostración» usa datos reales de la ruta de OpenStreetMap recorrida.
- Aplica las reglas de privacidad propuestas: datos agregados, zonas con menos de 20 repartidores por grupo ocultas, y el indicador de accidentes por millón de entregas aparece como «no se informa aquí» porque requiere los datos de la plataforma.

## Publicada en internet

**https://vicente-ca.github.io/vira-maqueta/** (GitHub Pages, repositorio público [vicente-ca/vira-maqueta](https://github.com/vicente-ca/vira-maqueta)). Es la forma más simple de abrirla en cualquier teléfono, incluido el iPhone.

Para publicar cambios: en esta carpeta, `git add -A`, `git commit -m "…"` y `git push`. GitHub Pages se actualiza solo en uno o dos minutos.

## Abrirla en un iPhone sin internet público (por wifi)

En el iPhone no sirve abrir `index.html` desde la app Archivos (la vista previa no carga `vendor/`). Si no quieres usar la versión publicada, hay que servirla desde el computador:

1. En la carpeta `Innova`, ejecuta `npx --yes http-server "E2/Diseno_y_marca/App_Vira" -p 8767 -c-1` (o la configuración `app-vira-node` de `.claude/launch.json`).
2. El comando muestra «Available on: http://10.x.x.x:8767». Abre esa dirección en Safari del iPhone, conectado **al mismo wifi** que el computador.
3. Si no carga: en redes de la universidad suele estar bloqueado que dos aparatos se vean entre sí. Prueba en la casa, o activa el **compartir internet** del iPhone, conecta el computador a esa red y usa la nueva dirección que muestre el comando.

En iPhone **el teléfono no vibra** (Safari no lo permite a las páginas web); las pulseras dibujadas y los bordes de la pantalla sí reaccionan.

## En el teléfono

Con pantalla angosta la maqueta ocupa toda la pantalla. En ese modo se ocultan la barra de estado y la barra de gestos dibujadas (el teléfono ya tiene las suyas), se respeta el notch (`safe-area`), la barra del navegador toma el color de la pantalla (oscuro en «En ruta»), no se recarga al tirar hacia abajo y los botones no seleccionan texto al mantenerlos presionados. **Hay que probarlo en un teléfono real**: nada de esto se ve en la simulación del computador. Para cambiar el destino tocando el mapa, se necesita internet. El servidor de prueba es solo para demostraciones: para operar de verdad habría que instalar el motor de rutas propio o contratar un servicio.

## Direcciones útiles

Si se sirve con un servidor local (por ejemplo, la configuración `app-vira-node` de `.claude/launch.json`, que solo necesita Node; `app-vira` necesita Python), se puede abrir directo en un estado:

- `?tour=1` inicia el recorrido automático.
- `?shot=route`, `?shot=order`, `?shot=activity`, `?shot=settings`, `?shot=sheet`, `?shot=onb1`…`onb3`, `?shot=perm`, `?shot=pair`, `?shot=cdm`, `?shot=sys` muestran cada pantalla sin animación (para capturas).

## Pendiente de decidir

- Nombre final (Vira o Seña) y logo final.
- Patrón exacto de vibración y si el aviso de pedido se apaga solo.
