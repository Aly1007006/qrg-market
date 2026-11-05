resource "yandex_vpc_network" "production" {
  name        = "qrg-production"
  description = "QRG MARKET production network in Kazakhstan"
  folder_id   = var.folder_id
  labels      = local.labels
}

resource "yandex_vpc_subnet" "application" {
  name           = "qrg-production-application"
  description    = "Private application subnet"
  folder_id      = var.folder_id
  zone           = local.zone
  network_id     = yandex_vpc_network.production.id
  v4_cidr_blocks = ["10.42.0.0/24"]
  labels         = local.labels
}

resource "yandex_vpc_subnet" "database" {
  name           = "qrg-production-database"
  description    = "Private Managed PostgreSQL subnet"
  folder_id      = var.folder_id
  zone           = local.zone
  network_id     = yandex_vpc_network.production.id
  v4_cidr_blocks = ["10.42.1.0/24"]
  labels         = local.labels
}

resource "yandex_vpc_security_group" "load_balancer" {
  name        = "qrg-production-alb"
  description = "Only public HTTPS ingress; HTTP is intentionally absent until redirect is configured"
  folder_id   = var.folder_id
  network_id  = yandex_vpc_network.production.id
  labels      = local.labels

}

resource "yandex_vpc_security_group" "application" {
  name        = "qrg-production-application"
  description = "No public ingress and no SSH; accepts traffic only from ALB health checks and ALB"
  folder_id   = var.folder_id
  network_id  = yandex_vpc_network.production.id
  labels      = local.labels

}

resource "yandex_vpc_security_group" "migration" {
  name        = "qrg-production-migration"
  description = "Attached only to the controlled, one-shot migration runner"
  folder_id   = var.folder_id
  network_id  = yandex_vpc_network.production.id
  labels      = local.labels

}

resource "yandex_vpc_security_group" "database" {
  name        = "qrg-production-database"
  description = "PostgreSQL accepts only application and migration identities"
  folder_id   = var.folder_id
  network_id  = yandex_vpc_network.production.id
  labels      = local.labels

}

resource "yandex_vpc_security_group_rule" "alb_public_https" {
  security_group_binding = yandex_vpc_security_group.load_balancer.id
  direction              = "ingress"
  description            = "Public HTTPS"
  protocol               = "TCP"
  port                   = 443
  v4_cidr_blocks         = ["0.0.0.0/0"]
}

resource "yandex_vpc_security_group_rule" "alb_to_web" {
  security_group_binding = yandex_vpc_security_group.load_balancer.id
  direction              = "egress"
  description            = "ALB to Next.js"
  protocol               = "TCP"
  port                   = 3000
  security_group_id      = yandex_vpc_security_group.application.id
}

resource "yandex_vpc_security_group_rule" "web_from_alb" {
  security_group_binding = yandex_vpc_security_group.application.id
  direction              = "ingress"
  description            = "ALB to Next.js"
  protocol               = "TCP"
  port                   = 3000
  security_group_id      = yandex_vpc_security_group.load_balancer.id
}

resource "yandex_vpc_security_group_rule" "web_healthchecks" {
  security_group_binding = yandex_vpc_security_group.application.id
  direction              = "ingress"
  description            = "Yandex ALB health checks"
  protocol               = "TCP"
  port                   = 3000
  predefined_target      = "loadbalancer_healthchecks"
}

resource "yandex_vpc_security_group_rule" "application_to_database" {
  security_group_binding = yandex_vpc_security_group.application.id
  direction              = "egress"
  description            = "Application to PostgreSQL"
  protocol               = "TCP"
  port                   = 6432
  security_group_id      = yandex_vpc_security_group.database.id
}

resource "yandex_vpc_security_group_rule" "database_from_application" {
  security_group_binding = yandex_vpc_security_group.database.id
  direction              = "ingress"
  description            = "Application to PostgreSQL"
  protocol               = "TCP"
  port                   = 6432
  security_group_id      = yandex_vpc_security_group.application.id
}

resource "yandex_vpc_security_group_rule" "migration_to_database" {
  security_group_binding = yandex_vpc_security_group.migration.id
  direction              = "egress"
  description            = "Migration runner to PostgreSQL"
  protocol               = "TCP"
  port                   = 6432
  security_group_id      = yandex_vpc_security_group.database.id
}

resource "yandex_vpc_security_group_rule" "database_from_migration" {
  security_group_binding = yandex_vpc_security_group.database.id
  direction              = "ingress"
  description            = "Controlled migration runner to PostgreSQL"
  protocol               = "TCP"
  port                   = 6432
  security_group_id      = yandex_vpc_security_group.migration.id
}

resource "yandex_vpc_security_group_rule" "application_https" {
  security_group_binding = yandex_vpc_security_group.application.id
  direction              = "egress"
  description            = "TLS access to registry, Lockbox, Object Storage and external providers"
  protocol               = "TCP"
  port                   = 443
  v4_cidr_blocks         = ["0.0.0.0/0"]
}

resource "yandex_vpc_security_group_rule" "application_dns_udp" {
  security_group_binding = yandex_vpc_security_group.application.id
  direction              = "egress"
  description            = "DNS over UDP"
  protocol               = "UDP"
  port                   = 53
  v4_cidr_blocks         = ["0.0.0.0/0"]
}

resource "yandex_vpc_security_group_rule" "application_dns_tcp" {
  security_group_binding = yandex_vpc_security_group.application.id
  direction              = "egress"
  description            = "DNS over TCP"
  protocol               = "TCP"
  port                   = 53
  v4_cidr_blocks         = ["0.0.0.0/0"]
}

resource "yandex_vpc_security_group_rule" "migration_https" {
  security_group_binding = yandex_vpc_security_group.migration.id
  direction              = "egress"
  description            = "TLS access to registry and Lockbox"
  protocol               = "TCP"
  port                   = 443
  v4_cidr_blocks         = ["0.0.0.0/0"]
}

resource "yandex_vpc_security_group_rule" "migration_dns_udp" {
  security_group_binding = yandex_vpc_security_group.migration.id
  direction              = "egress"
  description            = "DNS over UDP"
  protocol               = "UDP"
  port                   = 53
  v4_cidr_blocks         = ["0.0.0.0/0"]
}
