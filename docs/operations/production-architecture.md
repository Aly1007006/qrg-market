# Production architecture

## Target boundary

```text
Internet
  -> HTTPS 443 / Application Load Balancer
  -> qrg-web (Next.js, private compute)
  -> qrg-api (NestJS, loopback/private only)
  -> Managed PostgreSQL 17 (private 6432, TLS)

qrg-api -> private Object Storage through HTTPS
runtime -> Lockbox through HTTPS
containers -> Cloud Logging / Monitoring
CI -> immutable qrg-web and qrg-api images in Container Registry
```

Only the load balancer may receive public traffic. The API, database, metrics, debug interfaces, container runtime, and SSH are not public. The intended application unit runs both images on private compute so Next.js reaches NestJS through loopback/private networking; the browser never receives a database or private API address.

## Current state

The repository contains validated Terraform for the production core, hardened OCI images, health endpoints, and a gated build/scan pipeline. No Yandex Cloud resource was created in PHASE 9 because cloud credentials, a folder, billing confirmation, a domain, a certificate, an approved runtime image strategy, and monitoring destinations were not provided.

Compute and ALB are not represented by pretend resources. Before adding them, approve one reproducible option:

1. a fixed-size `kz1-a` instance group using a reviewed immutable base image and instance identity to read Lockbox; or
2. a Kazakhstan-available managed container runtime whose private-network, Lockbox, health-check, graceful-shutdown, and residency behavior is verified from current provider documentation.

Kubernetes is out of scope. Public SSH and manual source deployment are prohibited.

## One-zone risk

Yandex Cloud Kazakhstan currently exposes only `kz1-a`. Multiple VMs and two PostgreSQL hosts can mitigate individual host failure, but a zone-wide incident can still stop the service and primary managed backups. This is not regional disaster recovery. An independent encrypted backup copy at a second provider physically located in Kazakhstan is mandatory before production readiness.

## Data flows and residency

- PostgreSQL, media, Terraform state, application logs containing production data, and primary backups must remain in Kazakhstan.
- The independent backup provider must contractually identify Kazakhstan storage location and backup-processing location.
- Analytics events remain data-minimized; raw IP and customer phone values are not analytics identifiers.
- Halyk card data never enters QRG. Merchant acceptance and callback behavior remain unverified.

## Health and shutdown

- API liveness: `/api/v1/health` (process only).
- API readiness: `/api/v1/health/ready` (includes database ping).
- Web container liveness: `/` until a dedicated public-independent web health route is justified.
- Images run as `node`, have `STOPSIGNAL SIGTERM`, and the API enables Nest shutdown hooks.
- Runtime policy requires read-only root filesystems, `/tmp` tmpfs, all Linux capabilities dropped, and `no-new-privileges`.

The ALB must route only to ready application units and must never use the database endpoint as a public health target.
