# Guía Rápida de Instalación

## 1️⃣ Requisitos

- Windows 10/11
- Git instalado ([descargar](https://git-scm.com/download/win))
- VS Code con PlatformIO ([descargar](https://code.visualstudio.com/))
- Cable USB-C

## 2️⃣ Instalación en 3 Pasos

### Paso 1: Abrir PowerShell como Administrador

```
Click derecho en Inicio → Windows Terminal (Admin)
```

### Paso 2: Navegar a esta carpeta

```powershell
cd "C:\ruta\a\grblhal-octopus-pro-v11"
```

### Paso 3: Ejecutar el script

```powershell
.\build_and_flash.bat
```

## 3️⃣ Seguir las instrucciones en pantalla

El script automáticamente:
- ✅ Clona el repositorio grblHAL
- ✅ Configura para Octopus Pro v1.1
- ✅ Compila el firmware
- ✅ Te guía para flashear

---

## ⚡ Modo DFU (Para Flashear)

1. **APAGA** la placa
2. Pon jumper **BOOT0** en HIGH
3. Conecta USB y **ENCIENDE**
4. Debe aparecer "STM32 BOOTLOADER" en Administrador de Dispositivos

---

## 📁 Contenido de esta Carpeta

| Archivo | Descripción |
|---------|-------------|
| `build_and_flash.bat` | Script automático |
| `platformio_octopus_pro_v11.ini` | Configuración PlatformIO |
| `README.md` | Documentación completa |
| `CABLEADO.md` | Diagramas de cableado |
| `GUIA_RAPIDA.md` | Este archivo |

---

## 🆘 ¿Problemas?

1. **Git no encontrado**: Instalar Git y reiniciar terminal
2. **PlatformIO no encontrado**: Instalar extensión en VS Code
3. **No flashea**: Verificar modo DFU (jumper BOOT0)
4. **No aparece COM**: Quitar jumper BOOT0 después de flashear
