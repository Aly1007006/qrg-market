terraform {
  required_version = ">= 1.10.0, < 2.0.0"

  required_providers {
    yandex = {
      source  = "yandex-cloud/yandex"
      version = "0.225.0"
    }
  }

  # Supply backend.hcl outside Git. The state bucket is bootstrapped separately.
  backend "s3" {}
}

provider "yandex" {
  cloud_id         = var.cloud_id
  folder_id        = var.folder_id
  zone             = local.zone
  endpoint         = "api.yandexcloud.kz:443"
  storage_endpoint = "https://storage.yandexcloud.kz"
}
