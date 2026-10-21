#!/usr/bin/env python3
"""Compile-and-link check of both MR1 images with a system arm-none-eabi-gcc.

This mirrors the btt_octopus_pro_f429_mr1 PlatformIO environments closely enough
to catch compile, warning and link errors in the MR1 profile, board map and
driver code. It is NOT the release build: it uses the system compiler, the HAL
and startup files in this tree, and no pinned PlatformIO packages. Its images
must never be flashed and their hashes are not candidate hashes.

    python tools/compile_check_mr1.py [--out DIR] [--variant production|lab|both]

With --out, each image is written to DIR/<variant>/firmware.bin so that
validate_mr1_profile.py can audit it (MR1_FIRMWARE_IMAGE / MR1_LAB_IMAGE).
MR1 sources (Src/, boards/, Inc/mr1_*) must compile without warnings.
"""
from pathlib import Path
import argparse
import concurrent.futures
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CONFIG = {'production': 'Inc/mr1_octopus_config.h', 'lab': 'Inc/mr1_servo_axis_lab_config.h'}
CPU = ['-mcpu=cortex-m4', '-mthumb', '-mfpu=fpv4-sp-d16', '-mfloat-abi=hard']
DEFINES = ['-DUSE_HAL_DRIVER', '-DSTM32F4', '-DSTM32F429xx', '-DHSE_VALUE=8000000', '-DHAS_BOOTLOADER',
           '-DVECT_TAB_OFFSET=0x8000', '-DBOARD_BTT_OCTOPUS_PRO_MR1=', '-D_USE_IOCTL=1', '-D_USE_WRITE=1',
           '-D_VOLUMES=1', '-DOVERRIDE_MY_MACHINE']
INCLUDES = ['.', 'Inc', 'boards', 'FatFs', 'FatFs/STM', 'Drivers/FATFS/Target', 'Drivers/CMSIS/Include',
            'Drivers/CMSIS/Device/ST/STM32F4xx/Include', 'Drivers/STM32F4xx_HAL_Driver/Inc',
            'Middlewares/ST/STM32_USB_Device_Library/Class/CDC/Inc', 'Middlewares/ST/STM32_USB_Device_Library/Core/Inc',
            'USB_DEVICE/App', 'USB_DEVICE/Target', 'grbl', 'spindle', 'eeprom']
SOURCE_DIRS = ['Src', 'grbl', 'spindle', 'eeprom', 'Drivers/STM32F4xx_HAL_Driver/Src',
               'Middlewares/ST/STM32_USB_Device_Library/Core/Src', 'Middlewares/ST/STM32_USB_Device_Library/Class/CDC/Src',
               'USB_DEVICE/App', 'USB_DEVICE/Target']
STRICT = ('Src/', 'boards/', 'Inc/mr1_')


def build(variant, out):
    out.mkdir(parents=True, exist_ok=True)
    cflags = CPU + DEFINES + [f'-I{ROOT / i}' for i in INCLUDES] + [
        '-include', str(ROOT / CONFIG[variant]), '-Os', '-ffunction-sections', '-fdata-sections', '-Wall', '-std=gnu11']
    sources = sorted(path for directory in SOURCE_DIRS for path in (ROOT / directory).glob('*.c'))

    def compile_one(src):
        obj = out / (src.relative_to(ROOT).as_posix().replace('/', '__') + '.o')
        result = subprocess.run(['arm-none-eabi-gcc', *cflags, '-c', str(src), '-o', str(obj)],
                                capture_output=True, text=True, cwd=ROOT)
        return src.relative_to(ROOT).as_posix(), obj, result.returncode, result.stderr

    failures, warnings, objects = [], [], []
    with concurrent.futures.ThreadPoolExecutor(os.cpu_count()) as pool:
        for rel, obj, code, err in pool.map(compile_one, sources):
            if code:
                failures.append(f'{rel}\n{err}')
                continue
            objects.append(str(obj))
            # Warnings raised inside MR1 code (not upstream grbl or vendor code) fail the check.
            mr1 = [line for line in err.splitlines() if 'warning:' in line
                   and any(line.startswith(prefix) or f'/{prefix}' in line for prefix in STRICT)]
            if mr1:
                warnings.append(f'{rel}\n' + '\n'.join(mr1))
    startup = next((ROOT / 'StartupF429').glob('*.s'))
    result = subprocess.run(['arm-none-eabi-gcc', *CPU, '-c', '-x', 'assembler-with-cpp', str(startup),
                             '-o', str(out / 'startup.o')], capture_output=True, text=True)
    if result.returncode:
        failures.append(f'startup\n{result.stderr}')
    if failures or warnings:
        for item in failures:
            print(f'COMPILE FAIL [{variant}] {item[:4000]}')
        for item in warnings:
            print(f'MR1 WARNING [{variant}] {item[:2000]}')
        return False
    result = subprocess.run(['arm-none-eabi-gcc', *CPU, f'-T{ROOT / "STM32F429ZGTX_BL32K_I2C_FLASH.ld"}', '-Wl,--gc-sections',
                             '-specs=nano.specs', '-specs=nosys.specs', '-Wl,-u,_printf_float', '-Wl,-u,_scanf_float',
                             *objects, str(out / 'startup.o'), '-lm', '-o', str(out / 'firmware.elf')],
                            capture_output=True, text=True)
    if result.returncode:
        print(f'LINK FAIL [{variant}]\n{result.stderr[:4000]}')
        return False
    subprocess.run(['arm-none-eabi-objcopy', '-O', 'binary', str(out / 'firmware.elf'), str(out / 'firmware.bin')], check=True)
    size = (out / 'firmware.bin').stat().st_size
    print(f'PASS [{variant}]: {len(objects)} objects compiled and linked; {size} bytes (check image only, never flash)')
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--out', help='keep images in this directory')
    parser.add_argument('--variant', choices=['production', 'lab', 'both'], default='both')
    args = parser.parse_args()
    if shutil.which('arm-none-eabi-gcc') is None:
        sys.exit('arm-none-eabi-gcc not found (e.g. apt-get install gcc-arm-none-eabi libnewlib-arm-none-eabi)')
    variants = ['production', 'lab'] if args.variant == 'both' else [args.variant]
    base = Path(args.out).resolve() if args.out else Path(tempfile.mkdtemp(prefix='mr1-compile-check-'))
    ok = all([build(variant, base / variant) for variant in variants])
    if not args.out:
        shutil.rmtree(base, ignore_errors=True)
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
