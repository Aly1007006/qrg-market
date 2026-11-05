resource "yandex_mdb_postgresql_cluster" "production" {
  name                   = "qrg-production"
  description            = "QRG MARKET production database in Kazakhstan"
  folder_id              = var.folder_id
  environment            = "PRODUCTION"
  network_id             = yandex_vpc_network.production.id
  security_group_ids     = [yandex_vpc_security_group.database.id]
  deletion_protection    = true
  disk_encryption_key_id = yandex_kms_symmetric_key.production.id
  labels                 = local.labels

  config {
    version                   = "17"
    backup_retain_period_days = 14

    resources {
      resource_preset_id = var.postgres_resource_preset_id
      disk_type_id       = var.postgres_disk_type_id
      disk_size          = var.postgres_disk_size_gb
    }

    backup_window_start {
      hours   = 2
      minutes = 0
    }

    access {
      data_lens    = false
      web_sql      = false
      serverless   = false
      yandex_query = false
    }
  }

  host {
    name             = "qrg-pg-1"
    zone             = local.zone
    subnet_id        = yandex_vpc_subnet.database.id
    assign_public_ip = false
  }

  host {
    name             = "qrg-pg-2"
    zone             = local.zone
    subnet_id        = yandex_vpc_subnet.database.id
    assign_public_ip = false
  }

  maintenance_window {
    type = "WEEKLY"
    day  = "SUN"
    hour = 3
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "yandex_mdb_postgresql_backup_retention_policy" "weekly" {
  cluster_id      = yandex_mdb_postgresql_cluster.production.id
  policy_name     = "qrg-weekly-30-days"
  description     = "Additional weekly recovery points retained for 30 days"
  retain_for_days = 30

  cron = {
    day_of_month = "*"
    day_of_week  = "1"
    month        = "*"
  }
}
