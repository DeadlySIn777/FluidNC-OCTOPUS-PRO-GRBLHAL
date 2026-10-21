# Security and machine-control boundaries

The current service is intended for a local Windows workstation and binds to
`127.0.0.1`. Do not expose it through a LAN bind, public tunnel or reverse proxy.
It starts disconnected and requires explicit port selection, identity/preflight
checks, control ownership and staged commissioning before protected actions.

Do not include credentials, serial numbers, machine journals or customer programs
in public reports. Use GitHub private vulnerability reporting when available;
otherwise open an issue containing only a request for a private contact channel.

The optional Claude advisor sends the operator's question, a summary of the
live controller state and, when selected, the loaded program to Anthropic
through the Claude Code CLI signed in on that PC. It has no command channel to
the controller; leave it disabled (`MR1_ADVISOR=off`) where programs must not
leave the workstation.

Software feed hold, reset and unlock are not an electrical E-stop. Machine energy
isolation, drive alarms, wiring and physical acceptance remain separate work.
`legacy/` (including the former firmware-root scripts in
`legacy/grblhal-diagnostics-2025/`) contains obsolete diagnostics that can write
settings, disable limits or move motors; they must not be executed as current
tests or installation steps.

