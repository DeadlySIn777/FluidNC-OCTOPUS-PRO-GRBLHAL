# Security and machine-control boundaries

The current service is intended for a local Windows workstation and binds to
`127.0.0.1`. Do not expose it through a LAN bind, public tunnel or reverse proxy.
It starts disconnected and requires explicit port selection, identity/preflight
checks, control ownership and staged commissioning before protected actions.

Do not include credentials, serial numbers, machine journals or customer programs
in public reports. Use GitHub private vulnerability reporting when available;
otherwise open an issue containing only a request for a private contact channel.

Software feed hold, reset and unlock are not an electrical E-stop. Machine energy
isolation, drive alarms, wiring and physical acceptance remain separate work.
`legacy/` contains obsolete diagnostics that can write settings or move motors;
they must not be executed as current tests or installation steps.

