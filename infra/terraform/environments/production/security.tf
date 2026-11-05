resource "yandex_kms_symmetric_key" "production" {
  name                = "qrg-production"
  description         = "Customer-managed encryption key for QRG production data"
  folder_id           = var.folder_id
  default_algorithm   = "AES_256"
  rotation_period     = "8760h"
  deletion_protection = true
  labels              = local.labels

  lifecycle {
    prevent_destroy = true
  }
}

resource "yandex_iam_service_account" "application" {
  name        = "qrg-production-application"
  description = "Runtime identity for QRG web and API"
  folder_id   = var.folder_id
}

resource "yandex_iam_service_account" "migration" {
  name        = "qrg-production-migration"
  description = "Short-lived identity for the controlled database migration job"
  folder_id   = var.folder_id
}

resource "yandex_lockbox_secret" "application" {
  name                = "qrg-production-application"
  description         = "Operator-managed application runtime configuration with a least-privilege database URL"
  folder_id           = var.folder_id
  kms_key_id          = yandex_kms_symmetric_key.production.id
  deletion_protection = true
  labels              = local.labels

  lifecycle {
    prevent_destroy = true
  }
}

resource "yandex_lockbox_secret" "migration" {
  name                = "qrg-production-migration"
  description         = "Operator-managed migration configuration with the schema-owner database URL"
  folder_id           = var.folder_id
  kms_key_id          = yandex_kms_symmetric_key.production.id
  deletion_protection = true
  labels              = local.labels

  lifecycle {
    prevent_destroy = true
  }
}

resource "yandex_lockbox_secret" "object_storage_credentials" {
  name                = "qrg-production-object-storage"
  description         = "S3-compatible access key generated directly into Lockbox"
  folder_id           = var.folder_id
  kms_key_id          = yandex_kms_symmetric_key.production.id
  deletion_protection = true
  labels              = local.labels

  lifecycle {
    prevent_destroy = true
  }
}

resource "yandex_lockbox_secret_iam_member" "application_runtime" {
  secret_id = yandex_lockbox_secret.application.id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.application.id}"
}

resource "yandex_lockbox_secret_iam_member" "application_storage" {
  secret_id = yandex_lockbox_secret.object_storage_credentials.id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.application.id}"
}

resource "yandex_lockbox_secret_iam_member" "migration_runtime" {
  secret_id = yandex_lockbox_secret.migration.id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.migration.id}"
}

resource "yandex_kms_symmetric_key_iam_member" "application" {
  symmetric_key_id = yandex_kms_symmetric_key.production.id
  role             = "kms.keys.encrypterDecrypter"
  member           = "serviceAccount:${yandex_iam_service_account.application.id}"
}

resource "yandex_resourcemanager_folder_iam_member" "application_logging" {
  folder_id = var.folder_id
  role      = "logging.writer"
  member    = "serviceAccount:${yandex_iam_service_account.application.id}"
}
