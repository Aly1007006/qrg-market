# QRG MARKET production core (Kazakhstan)

This directory describes the deployable production **core** for Yandex Cloud Kazakhstan. It is intentionally fixed to `kz1-a`, currently the only Kazakhstan availability zone. Two database hosts in the same zone reduce some instance-level risk but are not Multi-AZ and do not protect against a zone outage.

## What this stack configures

- private application and database subnets;
- security groups with public ingress only on ALB port 443;
- a private two-host Managed PostgreSQL 17 cluster, 14-day automatic backup retention, weekly 30-day recovery points, no public IP, and a customer-managed KMS disk key;
- a private versioned KMS-encrypted media bucket with public read/list/config disabled;
- separate runtime and migration service accounts;
- separate Lockbox secret containers for application runtime and database migrations; Terraform does not manage their payloads;
- an Object Storage static key written directly to Lockbox by the provider, not exposed as an output;
- separate `qrg-web` and `qrg-api` repositories, retention policies, and push/weekly vulnerability scanning;
- a 30-day Cloud Logging group.

The following are deliberately not in this stack yet: Compute/instance group, ALB resources, Certificate Manager certificate, DNS zone/records, monitoring notification channel, alert resources, CI cloud identity, and a secondary Kazakhstan backup provider. Those need real decisions or identifiers and are deployment blockers, not placeholder strings to apply.

## Prerequisites

1. A dedicated production cloud/folder in the Kazakhstan console.
2. A least-privilege Terraform operator identity authenticated using a short-lived IAM token or approved federation. Do not commit a service-account key.
3. A separate private, versioned, KMS-encrypted Object Storage bucket for Terraform state.
4. A real production domain, Certificate Manager plan, immutable application image/runtime design, monitoring channel, and approved second KZ provider before public deployment.
5. Current `kz1-a` PostgreSQL resource preset and disk type selected from the live catalog.

The Terraform operator needs only the service-specific permissions required to create the resources in this stack, plus `vpc.user` and `kms.keys.user` where required by Managed PostgreSQL. Do not grant a blanket production `admin` role to CI.

## State bootstrap

State is sensitive. Create the state bucket out of band with public access disabled, versioning and KMS encryption enabled, and access limited to the Terraform operator identity. Copy `backend.hcl.example` outside the repository and replace only the bucket name. Provide S3 credentials through the operator environment:

```powershell
$env:AWS_ACCESS_KEY_ID = '<from-approved-secret-manager>'
$env:AWS_SECRET_ACCESS_KEY = '<from-approved-secret-manager>'
terraform init -backend-config='C:\secure\qrg-production.backend.hcl'
```

Never pass secrets through `-backend-config` arguments, `.tfvars`, outputs, plans, or CI logs. Production applies must be serialized by the protected deployment environment; Object Storage state locking has not been verified for this account.

## Safe validation

```powershell
terraform fmt -check -recursive ../../..
terraform init -backend=false -input=false
terraform validate
```

Copy `terraform.tfvars.example` to a secure untracked location. A plan requires real cloud authentication and must be reviewed and saved only in encrypted CI storage with restricted retention. This repository never auto-applies the stack.

## Secrets and database bootstrap

`yandex_lockbox_secret.application` contains only the application runtime values and a least-privilege runtime `DATABASE_URL`. `yandex_lockbox_secret.migration` contains the separate schema-owner `DATABASE_URL` and is readable only by the one-shot migration identity. After the stack is applied, an authorized operator creates both versions out of band; Terraform never receives either password. Halyk remains disabled and customer requests remain disabled until their separate gates pass. The storage access key is generated directly into the separate Object Storage Lockbox secret.

The database roles and database are also intentionally not Terraform resources: provider password fields would place password material in Terraform state. Bootstrap the two roles according to `docs/operations/database-roles.md`, use distinct generated passwords, enable `postgis` and `pg_trgm`, then run the migration image once from the migration security group. Do not start application replicas before a successful migration. The application identity must never receive the migration secret.

## Official references used

- [Kazakhstan region and endpoints](https://yandex.cloud/en/docs/overview/concepts/region)
- [Terraform provider for Kazakhstan](https://yandex.cloud/ru-kz/docs/terraform/concepts/providers)
- [Remote state in Kazakhstan Object Storage](https://yandex.cloud/ru-kz/docs/terraform/tutorials/terraform-state-storage)
- [Managed PostgreSQL Terraform resource](https://yandex.cloud/en/docs/terraform/resources/mdb_postgresql_cluster)
- [Managed PostgreSQL backups](https://yandex.cloud/en/docs/managed-postgresql/operations/cluster-backups)
- [Lockbox Terraform reference](https://yandex.cloud/en/docs/lockbox/tf-ref)
- [Object Storage encryption](https://yandex.cloud/en/docs/storage/operations/buckets/encrypt)
- [Container Registry access roles](https://yandex.cloud/en/docs/container-registry/security/)
