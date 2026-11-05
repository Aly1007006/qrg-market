variable "cloud_id" {
  description = "Yandex Cloud Kazakhstan cloud ID. This is an identifier, not a credential."
  type        = string
  nullable    = false

  validation {
    condition     = length(trimspace(var.cloud_id)) > 0
    error_message = "cloud_id must be supplied by the production operator."
  }
}

variable "folder_id" {
  description = "Dedicated production folder ID in Yandex Cloud Kazakhstan."
  type        = string
  nullable    = false

  validation {
    condition     = length(trimspace(var.folder_id)) > 0
    error_message = "folder_id must be supplied by the production operator."
  }
}

variable "media_bucket_name" {
  description = "Globally unique private bucket name selected by the operator."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.media_bucket_name))
    error_message = "media_bucket_name must be a valid 3-63 character S3 bucket name."
  }
}

variable "postgres_resource_preset_id" {
  description = "Managed PostgreSQL preset verified as available in kz1-a at deployment time."
  type        = string
  nullable    = false

  validation {
    condition     = length(trimspace(var.postgres_resource_preset_id)) > 0
    error_message = "Select an available kz1-a PostgreSQL preset from the current Yandex Cloud catalog."
  }
}

variable "postgres_disk_type_id" {
  description = "Managed PostgreSQL disk type verified as available in kz1-a."
  type        = string
  nullable    = false

  validation {
    condition     = length(trimspace(var.postgres_disk_type_id)) > 0
    error_message = "Select an available kz1-a PostgreSQL disk type."
  }
}

variable "postgres_disk_size_gb" {
  description = "Managed PostgreSQL disk size in GiB."
  type        = number
  default     = 50

  validation {
    condition     = var.postgres_disk_size_gb >= 20
    error_message = "postgres_disk_size_gb must be at least 20 GiB."
  }
}

variable "labels" {
  description = "Additional non-sensitive labels."
  type        = map(string)
  default     = {}
}
