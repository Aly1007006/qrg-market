resource "yandex_storage_bucket" "media" {
  bucket        = var.media_bucket_name
  folder_id     = var.folder_id
  force_destroy = false
  max_size      = 53687091200

  anonymous_access_flags {
    read        = false
    list        = false
    config_read = false
  }

  versioning {
    enabled = true
  }

  server_side_encryption_configuration {
    rule {
      apply_server_side_encryption_by_default {
        kms_master_key_id = yandex_kms_symmetric_key.production.id
        sse_algorithm     = "aws:kms"
      }
    }
  }

  lifecycle_rule {
    id      = "cleanup-noncurrent-versions"
    enabled = true

    filter {
      prefix = ""
    }

    noncurrent_version_expiration {
      days = 90
    }
  }

  lifecycle_rule {
    id                                     = "abort-incomplete-multipart-uploads"
    enabled                                = true
    abort_incomplete_multipart_upload_days = 7

    filter {
      prefix = ""
    }
  }

  tags = local.labels

  lifecycle {
    prevent_destroy = true
  }
}

resource "yandex_storage_bucket_iam_binding" "application" {
  bucket  = yandex_storage_bucket.media.bucket
  role    = "storage.editor"
  members = ["serviceAccount:${yandex_iam_service_account.application.id}"]
}

resource "yandex_iam_service_account_static_access_key" "application_storage" {
  service_account_id = yandex_iam_service_account.application.id
  description        = "QRG production media access; material is written directly to Lockbox"

  output_to_lockbox {
    secret_id            = yandex_lockbox_secret.object_storage_credentials.id
    entry_for_access_key = "S3_ACCESS_KEY_ID"
    entry_for_secret_key = "S3_SECRET_ACCESS_KEY"
  }

  depends_on = [yandex_storage_bucket_iam_binding.application]
}
