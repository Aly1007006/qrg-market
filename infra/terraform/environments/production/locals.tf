locals {
  project = "qrg-market"
  zone    = "kz1-a"

  labels = merge(
    {
      project     = local.project
      environment = "production"
      managed-by  = "terraform"
      residency   = "kazakhstan"
    },
    var.labels,
  )
}
