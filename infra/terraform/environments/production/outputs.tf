output "zone" {
  description = "The only configured Kazakhstan availability zone."
  value       = local.zone
}

output "network_id" {
  description = "Production VPC ID."
  value       = yandex_vpc_network.production.id
}

output "application_subnet_id" {
  description = "Private application subnet ID."
  value       = yandex_vpc_subnet.application.id
}

output "application_security_group_id" {
  description = "Security group for the future application compute tier."
  value       = yandex_vpc_security_group.application.id
}

output "migration_security_group_id" {
  description = "Security group for the one-shot migration runner."
  value       = yandex_vpc_security_group.migration.id
}

output "postgres_cluster_id" {
  description = "Managed PostgreSQL cluster ID; no password or connection string is exposed."
  value       = yandex_mdb_postgresql_cluster.production.id
}

output "media_bucket_name" {
  description = "Private encrypted media bucket name."
  value       = yandex_storage_bucket.media.bucket
}

output "container_registry_id" {
  description = "Container Registry ID used to form immutable image references."
  value       = yandex_container_registry.production.id
}

output "application_service_account_id" {
  description = "Runtime service account ID."
  value       = yandex_iam_service_account.application.id
}

output "application_secret_id" {
  description = "Application runtime Lockbox secret container ID. No payload is exposed."
  value       = yandex_lockbox_secret.application.id
}

output "migration_secret_id" {
  description = "Migration-only Lockbox secret container ID. No payload is exposed."
  value       = yandex_lockbox_secret.migration.id
}

output "application_log_group_id" {
  description = "Cloud Logging group ID."
  value       = yandex_logging_group.application.id
}
