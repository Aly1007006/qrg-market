resource "yandex_logging_group" "application" {
  name             = "qrg-production-application"
  description      = "Structured application logs; application policy forbids secrets and raw PII"
  folder_id        = var.folder_id
  retention_period = "720h"
  labels           = local.labels
}
