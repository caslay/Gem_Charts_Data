# 🏛️ Completed Cloud & DNS Infrastructure Manifest

**Domain:** `quegar.com`  
**Date:** September 1, 2026  
**Status:** Live & Configured (Pre-Deployment Phase)

---

### 1. Domain & DNS Configuration (Porkbun)
* **Domain Registered:** `quegar.com`
* **Default Parking Records Deleted:** Removed `ALIAS` and wildcard `CNAME` pointing to `uixie.porkbun.com`.
* **Configured A Records:**
  * `@` (Apex) $\rightarrow$ `57.181.64.238` (TTL 600)
  * `core.quegar.com` $\rightarrow$ `57.181.64.238` (TTL 600)
  * `mcp.quegar.com` $\rightarrow$ `57.181.64.238` (TTL 600)

---

### 2. VPS Instance Provisioning (AWS Lightsail)
* **Instance Name:** `quegar-core`
* **Region & Zone:** Tokyo (`ap-northeast-1a`)
* **Operating System:** Ubuntu 24.04 LTS (OS Only)
* **Plan Tier:** $7.00 USD/mo (Micro) — Dual-stack, General Purpose
* **Compute Specs:** 2 vCPUs, 1 GB RAM, 40 GB SSD
* **SSH Key Downloaded:** `LightsailDefaultKey-ap-northeast-1.pem`

---

### 3. IP Allocation
* **Static Public IPv4:** `57.181.64.238` (Attached to `quegar-core` as `quegar-core-ip`)
* **Private IPv4 (Internal AWS):** `172.26.12.138`
* **Public IPv6:** `2406:da14:1e64:3400:9c20:c9b4:42a9:599`

---

### 4. Cloud Firewall Rules (Lightsail Inbound)
* **SSH:** TCP Port `22` (Enabled)
* **HTTP:** TCP Port `80` (Enabled for Let's Encrypt / Caddy challenges)
* **HTTPS:** TCP Port `443` (Enabled for `0.0.0.0/0` anywhere)

---

### 5. Current Operational State
* VPS is running and reachable at `57.181.64.238`.
* Porkbun DNS records are pointing to the static IP.
* Server terminal / SSH connection and code deployment are paused pending local IDE engine updates.