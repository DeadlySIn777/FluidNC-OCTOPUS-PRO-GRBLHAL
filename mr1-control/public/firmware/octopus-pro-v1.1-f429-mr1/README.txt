MR-1 OCTOPUS PRO V1.1 F429 FIRMWARE CANDIDATE
================================================

This image is only for a board physically marked:

  BIGTREETECH OCTOPUS PRO V1.1
  STM32F429ZGT6

It is a stock-BTT-bootloader image linked at 0x08008000. Do not flash it to an
F446, H723, Octopus V1.0/V1.0.1, non-Pro Octopus, or Scylla.

Preferred installation uses a FAT32 microSD card and BTT's USB-only MCU power
jumper. Keep 24 V, 36 V, drivers, motors, spindle, probes, outputs, and all field
wiring physically disconnected. Copy firmware.bin to the card root, insert the
card, and connect USB-C. Disconnect USB before touching the card or jumper. A
successful bootloader update renames firmware.bin to FIRMWARE.CUR.

Remove the USB-power jumper before later connecting the 24 V main supply. DFU is
recovery-only because an incorrect DFU operation can overwrite the stock SD
bootloader.

SHA-256:
F4AB32BD2CB7D0985A07915CF1C4349A3A7FD8546C765265B23EB98B904E5E9D

This clean-built image passed the source profile and six workflow tests. It has
not passed physical board, machine, motion, probe, spindle, or safety testing.
