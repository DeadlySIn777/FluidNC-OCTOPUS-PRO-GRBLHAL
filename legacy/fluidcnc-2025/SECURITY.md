# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in FluidCNC, please report it responsibly:

1. **Do NOT** open a public GitHub issue
2. Email the maintainer directly or use GitHub's private security advisory feature
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Security Considerations

### Web Application Security

FluidCNC is a browser-based CNC controller. Key security considerations:

#### HTTPS Requirement
- Web Serial API **requires** HTTPS (except localhost)
- Use `generate-cert.py` to create self-signed certificates for local development
- For production, use proper SSL certificates

#### Local Network Only
- FluidCNC is designed for **local network use only**
- Do NOT expose the controller to the public internet
- Use a dedicated CNC network or VLAN if possible

#### Machine Safety
- The application controls physical CNC machinery
- Always verify G-code before running
- Use physical E-stop in addition to software controls
- Never leave machine unattended during operation

### Files That Should NEVER Be Committed

- `server.crt`, `server.key` - SSL certificates
- `*.pem` - Certificate files
- Any machine-specific calibration with sensitive data

### Safe Defaults

- No auto-connect to serial ports (requires user gesture)
- WebSocket on port 81 (local network)
- All communication is local (no cloud services)
- No telemetry or analytics

## Best Practices for Deployment

1. **Use on isolated network** - Keep CNC controller on dedicated network
2. **Physical E-stop** - Always have hardware emergency stop
3. **Review G-code** - Use built-in simulator before running
4. **Update firmware** - Keep grblHAL firmware updated
5. **Backup settings** - Export machine parameters regularly
