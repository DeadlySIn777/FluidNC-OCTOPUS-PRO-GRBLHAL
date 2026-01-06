#!/usr/bin/env python3
"""Generate a self-signed SSL certificate for local HTTPS development."""

from datetime import datetime, timedelta
import os

try:
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
except ImportError:
    print("Installing cryptography package...")
    os.system("pip install cryptography")
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

import socket

def get_local_ip():
    """Get the local IP address of this machine."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "192.168.1.100"

def generate_cert():
    local_ip = get_local_ip()
    print(f"Generating certificate for localhost and {local_ip}")
    
    # Generate private key
    key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    
    # Certificate subject
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "FluidCNC Local Dev"),
        x509.NameAttribute(NameOID.COMMON_NAME, "FluidCNC"),
    ])
    
    # Build certificate with SAN for localhost and local IP
    import ipaddress
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.utcnow())
        .not_valid_after(datetime.utcnow() + timedelta(days=365))
        .add_extension(
            x509.SubjectAlternativeName([
                x509.DNSName("localhost"),
                x509.DNSName(socket.gethostname()),
                x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
                x509.IPAddress(ipaddress.IPv4Address(local_ip)),
            ]),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    
    # Save private key
    with open("server.key", "wb") as f:
        f.write(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption()
        ))
    print("Created: server.key")
    
    # Save certificate
    with open("server.crt", "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    print("Created: server.crt")
    
    print(f"\n✅ Certificate generated for:")
    print(f"   - https://localhost:8443")
    print(f"   - https://{local_ip}:8443")
    print(f"\n⚠️  This is a self-signed cert. You'll need to accept the browser warning.")
    print(f"   On your laptop, go to https://{local_ip}:8443 and click 'Advanced' → 'Proceed'")

if __name__ == "__main__":
    generate_cert()
