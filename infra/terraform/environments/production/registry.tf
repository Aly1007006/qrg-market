resource "yandex_container_registry" "production" {
  name      = "qrg-production"
  folder_id = var.folder_id
  labels    = local.labels
}

resource "yandex_container_repository" "web" {
  name = "${yandex_container_registry.production.id}/qrg-web"
}

resource "yandex_container_repository" "api" {
  name = "${yandex_container_registry.production.id}/qrg-api"
}

resource "yandex_container_repository_lifecycle_policy" "web" {
  name          = "qrg-web-retention"
  status        = "active"
  repository_id = yandex_container_repository.web.id

  rule {
    description   = "Remove stale untagged layers while keeping rollback candidates"
    untagged      = true
    tag_regexp    = ".*"
    expire_period = "168h"
    retained_top  = 10
  }
}

resource "yandex_container_repository_lifecycle_policy" "api" {
  name          = "qrg-api-retention"
  status        = "active"
  repository_id = yandex_container_repository.api.id

  rule {
    description   = "Remove stale untagged layers while keeping rollback candidates"
    untagged      = true
    tag_regexp    = ".*"
    expire_period = "168h"
    retained_top  = 10
  }
}

resource "yandex_cloudregistry_scan_policy" "production" {
  name               = "qrg-production-scan"
  description        = "Scan every QRG image on push and weekly"
  registry_id        = yandex_container_registry.production.id
  disabled           = false
  scan_lang_packages = true

  rules = {
    push_rule = {
      disabled = false
      paths    = ["*"]
    }

    schedule_rules = [{
      disabled      = false
      paths         = ["*"]
      interval_unit = "DAYS"
      amount        = 7
    }]
  }
}

resource "yandex_container_registry_iam_binding" "application_puller" {
  registry_id = yandex_container_registry.production.id
  role        = "container-registry.images.puller"
  members     = ["serviceAccount:${yandex_iam_service_account.application.id}"]
}

resource "yandex_container_registry_iam_binding" "migration_puller" {
  registry_id = yandex_container_registry.production.id
  role        = "container-registry.images.puller"
  members     = ["serviceAccount:${yandex_iam_service_account.migration.id}"]
}
