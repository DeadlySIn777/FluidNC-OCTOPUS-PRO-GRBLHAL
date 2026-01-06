# 🛠️ Quick Start Guide / Guía de Inicio Rápido

---

## 🇺🇸 ENGLISH

### What You Need (Shopping List)

| Item | Where to Buy | Price |
|------|--------------|-------|
| **ESP32 DevKit (38-pin)** | Amazon/AliExpress | ~$8 |
| **MPU-6050 Accelerometer** | Amazon/AliExpress | ~$3 |
| **INMP441 I2S Microphone** | Amazon/AliExpress | ~$3 |
| **ACS712 Current Sensor (30A)** | Amazon/AliExpress | ~$3 |
| **GC9A01 1.28" Round TFT** | Amazon/AliExpress | ~$8 |
| **RS-485 Module (MAX485)** *(optional)* | Amazon/AliExpress | ~$2 |
| **Jumper wires** | Amazon/AliExpress | ~$5 |

**Total: ~$30-35** (or ~$25 without display)

---

### Step 1: Wire Everything

#### 1.1 MPU-6050 (Vibration Sensor)
Connect these 4 wires:
```
MPU-6050    →    ESP32
─────────────────────────
VCC         →    3.3V (Pin 1)
GND         →    GND (Pin 14)
SDA         →    GPIO 21 (Pin 33)
SCL         →    GPIO 22 (Pin 36)
```
📍 **Mount this on your spindle or gantry** - it detects vibrations!

#### 1.2 INMP441 (Microphone)
Connect these 6 wires:
```
INMP441     →    ESP32
─────────────────────────
VCC         →    3.3V (Pin 1)
GND         →    GND (Pin 14)
SD          →    GPIO 32 (Pin 7)
WS          →    GPIO 25 (Pin 9)
SCK         →    GPIO 26 (Pin 10)
L/R         →    GND (Pin 14)
```
📍 **Mount this near the spindle** - it hears chatter!

#### 1.3 ACS712 (Current Sensor)
Connect these 3 wires:
```
ACS712      →    ESP32
─────────────────────────
VCC         →    5V (Pin 19)
GND         →    GND (Pin 14)
OUT         →    GPIO 34 (Pin 5)
```
⚠️ **IMPORTANT:** The ACS712 must be wired IN SERIES with ONE wire of your spindle power!
- Cut ONE of the spindle power wires
- Run it THROUGH the ACS712 holes (IP+ and IP-)
- The other spindle wires stay as they are

#### 1.4 Round TFT Display (Optional but Cool!)
Connect these 8 wires:
```
GC9A01      →    ESP32
─────────────────────────
VCC         →    3.3V (Pin 1)
GND         →    GND (Pin 14)
SCL         →    GPIO 18 (Pin 30)
SDA         →    GPIO 23 (Pin 37)
CS          →    GPIO 15 (Pin 23)
DC          →    GPIO 2 (Pin 24)
RST         →    GPIO 4 (Pin 26)
BL          →    GPIO 5 (Pin 29)
```
📍 **Mount on spindle or where you can see it!**

#### 1.5 Connect to Your CNC Controller
Connect these 3 wires to your BTT Octopus Pro or FluidNC:
```
ESP32       →    CNC Controller
─────────────────────────────────
GPIO 17     →    RX (receive data)
GPIO 16     →    TX (send data)
GND         →    GND
```

#### 1.6 VFD Modbus (Optional - for Real Spindle Data)
If you want to see real RPM, current, and voltage from your VFD:

**You need an RS-485 module** (like MAX485)

```
ESP32       →    RS-485 Module    →    VFD
────────────────────────────────────────────
GPIO 13     →    DI               
GPIO 14     →    RO               
GPIO 27     →    DE + RE (tie together)
GND         →    GND
3.3V        →    VCC
                 A                 →    RS+
                 B                 →    RS-
```

**Set your VFD parameters:**
- PD163 = 1
- PD164 = 1
- PD165 = 1

---

### Step 2: Flash the Firmware

1. **Install PlatformIO** (VS Code extension)
2. **Open the project folder** `chatter-esp32`
3. **Plug in the ESP32** via USB
4. **Click Upload** (→ arrow in PlatformIO)
5. Wait for "Success!"

---

### Step 3: Connect to WiFi

**Option A: Use the Hotspot (Easy!)**
1. Look for WiFi network: **ChatterDetect**
2. Password: **chatter123**
3. Go to: **http://192.168.4.1**
4. Enter your home WiFi name and password
5. Click "Save & Connect"
6. ESP32 will reboot and connect

**Option B: Edit the Code**
1. Open `src/main.cpp`
2. Find these lines:
   ```cpp
   const char* WIFI_SSID = "YOUR_WIFI_SSID";
   const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
   ```
3. Change them to your WiFi info
4. Re-upload

---

### Step 4: Use It!

1. Open **FluidCNC** web interface in your browser
2. Look for the **Chatter Detection** panel (bottom right)
3. It will connect automatically!

**What the colors mean:**
- 🟢 **Green** = Good, keep cutting
- 🟡 **Yellow** = Warning, getting rough
- 🔴 **Red** = CHATTER! Feed is being reduced

**Set up your material first!**
Click the material panel and tell it:
- What material (aluminum, steel, wood, etc.)
- What operation (roughing, finishing)
- Tool size (6mm, 1/4", etc.)
- Number of flutes (2, 3, 4)

**This makes detection much smarter!**

---

### Troubleshooting

| Problem | Solution |
|---------|----------|
| ESP32 not connecting to WiFi | Use hotspot mode (ChatterDetect) |
| No data in web UI | Check ESP32 IP, try http://chatter.local |
| Chatter score always 0 | Check sensor wiring, try "Learn" button |
| Current always 0 | ACS712 not wired in series correctly |
| VFD data not showing | Check RS-485 wiring, swap A/B if needed |

---

---

## 🇪🇸 ESPAÑOL

### Lo Que Necesitas (Lista de Compras)

| Artículo | Dónde Comprar | Precio |
|----------|---------------|--------|
| **ESP32 DevKit (38 pines)** | Amazon/AliExpress | ~$8 |
| **Acelerómetro MPU-6050** | Amazon/AliExpress | ~$3 |
| **Micrófono INMP441 I2S** | Amazon/AliExpress | ~$3 |
| **Sensor de Corriente ACS712 (30A)** | Amazon/AliExpress | ~$3 |
| **Pantalla Redonda GC9A01 1.28"** | Amazon/AliExpress | ~$8 |
| **Módulo RS-485 (MAX485)** *(opcional)* | Amazon/AliExpress | ~$2 |
| **Cables dupont** | Amazon/AliExpress | ~$5 |

**Total: ~$30-35** (o ~$25 sin pantalla)

---

### Paso 1: Conectar Todo

#### 1.1 MPU-6050 (Sensor de Vibración)
Conecta estos 4 cables:
```
MPU-6050    →    ESP32
─────────────────────────
VCC         →    3.3V (Pin 1)
GND         →    GND (Pin 14)
SDA         →    GPIO 21 (Pin 33)
SCL         →    GPIO 22 (Pin 36)
```
📍 **Monta esto en tu husillo o pórtico** - ¡detecta vibraciones!

#### 1.2 INMP441 (Micrófono)
Conecta estos 6 cables:
```
INMP441     →    ESP32
─────────────────────────
VCC         →    3.3V (Pin 1)
GND         →    GND (Pin 14)
SD          →    GPIO 32 (Pin 7)
WS          →    GPIO 25 (Pin 9)
SCK         →    GPIO 26 (Pin 10)
L/R         →    GND (Pin 14)
```
📍 **Monta esto cerca del husillo** - ¡escucha el chatter!

#### 1.3 ACS712 (Sensor de Corriente)
Conecta estos 3 cables:
```
ACS712      →    ESP32
─────────────────────────
VCC         →    5V (Pin 19)
GND         →    GND (Pin 14)
OUT         →    GPIO 34 (Pin 5)
```
⚠️ **¡IMPORTANTE!** El ACS712 debe estar conectado EN SERIE con UN cable del husillo:
- Corta UNO de los cables de alimentación del husillo
- Pásalo POR los agujeros del ACS712 (IP+ e IP-)
- Los otros cables del husillo se quedan igual

#### 1.4 Pantalla TFT Redonda (¡Opcional pero Genial!)
Conecta estos 8 cables:
```
GC9A01      →    ESP32
─────────────────────────
VCC         →    3.3V (Pin 1)
GND         →    GND (Pin 14)
SCL         →    GPIO 18 (Pin 30)
SDA         →    GPIO 23 (Pin 37)
CS          →    GPIO 15 (Pin 23)
DC          →    GPIO 2 (Pin 24)
RST         →    GPIO 4 (Pin 26)
BL          →    GPIO 5 (Pin 29)
```
📍 **¡Monta donde puedas verla!**

#### 1.5 Conectar a Tu Controlador CNC
Conecta estos 3 cables a tu BTT Octopus Pro o FluidNC:
```
ESP32       →    Controlador CNC
─────────────────────────────────
GPIO 17     →    RX (recibe datos)
GPIO 16     →    TX (envía datos)
GND         →    GND
```

#### 1.6 VFD Modbus (Opcional - para Datos Reales del Husillo)
Si quieres ver RPM real, corriente y voltaje de tu VFD:

**Necesitas un módulo RS-485** (como MAX485)

```
ESP32       →    Módulo RS-485    →    VFD
────────────────────────────────────────────
GPIO 13     →    DI               
GPIO 14     →    RO               
GPIO 27     →    DE + RE (unir juntos)
GND         →    GND
3.3V        →    VCC
                 A                 →    RS+
                 B                 →    RS-
```

**Configura los parámetros del VFD:**
- PD163 = 1
- PD164 = 1
- PD165 = 1

---

### Paso 2: Cargar el Firmware

1. **Instala PlatformIO** (extensión de VS Code)
2. **Abre la carpeta del proyecto** `chatter-esp32`
3. **Conecta el ESP32** por USB
4. **Haz clic en Upload** (→ flecha en PlatformIO)
5. ¡Espera "Success!"

---

### Paso 3: Conectar al WiFi

**Opción A: Usar el Hotspot (¡Fácil!)**
1. Busca la red WiFi: **ChatterDetect**
2. Contraseña: **chatter123**
3. Ve a: **http://192.168.4.1**
4. Escribe el nombre y contraseña de tu WiFi
5. Haz clic en "Save & Connect"
6. El ESP32 se reiniciará y conectará

**Opción B: Editar el Código**
1. Abre `src/main.cpp`
2. Busca estas líneas:
   ```cpp
   const char* WIFI_SSID = "TU_WIFI_NOMBRE";
   const char* WIFI_PASS = "TU_WIFI_CONTRASEÑA";
   ```
3. Cámbialas a tu información WiFi
4. Vuelve a cargar

---

### Paso 4: ¡Úsalo!

1. Abre la interfaz web de **FluidCNC** en tu navegador
2. Busca el panel **Chatter Detection** (abajo a la derecha)
3. ¡Se conectará automáticamente!

**Qué significan los colores:**
- 🟢 **Verde** = Bien, sigue cortando
- 🟡 **Amarillo** = Advertencia, se pone difícil
- 🔴 **Rojo** = ¡CHATTER! Se reduce el avance

**¡Configura tu material primero!**
Haz clic en el panel de material y dile:
- Qué material (aluminio, acero, madera, etc.)
- Qué operación (desbaste, acabado)
- Tamaño de herramienta (6mm, 1/4", etc.)
- Número de filos (2, 3, 4)

**¡Esto hace la detección mucho más inteligente!**

---

### Solución de Problemas

| Problema | Solución |
|----------|----------|
| ESP32 no conecta al WiFi | Usa modo hotspot (ChatterDetect) |
| No hay datos en la web | Revisa IP del ESP32, prueba http://chatter.local |
| Puntuación siempre 0 | Revisa cableado de sensores, prueba botón "Learn" |
| Corriente siempre 0 | ACS712 no está en serie correctamente |
| Datos del VFD no aparecen | Revisa cableado RS-485, intercambia A/B si es necesario |

---

## 📷 Visual Wiring Guide / Guía Visual de Cableado

Open `wiring.html` in your browser for a visual diagram!
¡Abre `wiring.html` en tu navegador para un diagrama visual!

---

## 🎉 You Did It! / ¡Lo Lograste!

Your CNC now has:
- ✅ Real-time chatter detection / Detección de chatter en tiempo real
- ✅ Automatic feed reduction / Reducción automática del avance
- ✅ Tool breakage protection / Protección contra rotura de herramienta
- ✅ VFD telemetry (optional) / Telemetría del VFD (opcional)
- ✅ Beautiful round display / Hermosa pantalla redonda

**Need help?** Open an issue on GitHub!
**¿Necesitas ayuda?** ¡Abre un issue en GitHub!
