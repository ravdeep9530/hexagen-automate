terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "agentic" {
  name     = "agentic-platform"
  location = "East US"
}

resource "azurerm_postgresql_server" "db" {
  name                = "agentic-db"
  location            = azurerm_resource_group.agentic.location
  resource_group_name = azurerm_resource_group.agentic.name

  sku_name   = "GP_Gen5_2"
  storage_mb = 5120
  version    = "11"

  administrator_login          = "postgres"
  administrator_login_password = "P@ssw0rd123!"

  ssl_enforcement_enabled = true
}

resource "azurerm_kubernetes_cluster" "agents" {
  name                = "agentic-aks"
  location            = azurerm_resource_group.agentic.location
  resource_group_name = azurerm_resource_group.agentic.name
  dns_prefix          = "agentic"

  default_node_pool {
    name       = "default"
    node_count = 3
    vm_size    = "Standard_D2_v2"
  }
}
