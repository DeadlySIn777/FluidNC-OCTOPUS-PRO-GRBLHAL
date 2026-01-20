; ===========================================
; STEPPER MOTOR TEST - 1200mm Travel
; Motors DISCONNECTED from lead screws
; Testing: NEMA17 60Ncm + TMC2209 UART
; ===========================================

; Setup
G21          ; Metric (mm)
G91          ; Relative positioning (important - no homing needed)
G94          ; Feed per minute

; Disable soft limits for this test (motors are free)
$20=0        ; Soft limits OFF

; === TEST X AXIS ===
; Forward 1200mm at 3000 mm/min
G1 X1200 F3000
G4 P1        ; Pause 1 second
; Reverse back
G1 X-1200 F3000
G4 P1

; === TEST Y AXIS ===
; Forward 1200mm at 3000 mm/min
G1 Y1200 F3000
G4 P1
; Reverse back
G1 Y-1200 F3000
G4 P1

; === TEST Z AXIS ===
; Z is slower for safety even though disconnected
; Forward 1200mm at 1500 mm/min
G1 Z1200 F1500
G4 P1
; Reverse back
G1 Z-1200 F1500
G4 P1

; === COMBINED MOTION TEST ===
; Test all axes moving together
G1 X600 Y600 Z300 F2000
G4 P0.5
G1 X-600 Y-600 Z-300 F2000

; === STRESS TEST - Fast Acceleration ===
; Quick back-and-forth to test acceleration
G1 X100 F5000
G1 X-100 F5000
G1 X100 F5000
G1 X-100 F5000

G1 Y100 F5000
G1 Y-100 F5000
G1 Y100 F5000
G1 Y-100 F5000

; Re-enable soft limits
$20=1

; Done
M2           ; End program

; ===========================================
; EXPECTED RESULTS:
; - Motors should run smooth, no skipping
; - TMC2209 StealthChop = quiet operation
; - No overheating (check after test)
; - Current should stay under 1.5A per motor
; ===========================================
