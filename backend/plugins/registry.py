"""
Plugin registry — maps plugin IDs to adapter classes.
Register new adapters here to make them available in the application.
"""

from typing import Dict, Type
from backend.plugins.base import BaseAdapter
from backend.plugins.adapters.generic import GenericAdapter

# Registry: plugin_id -> adapter class
_REGISTRY: Dict[str, Type[BaseAdapter]] = {
    GenericAdapter.plugin_id: GenericAdapter,
}


def register_adapter(adapter_cls: Type[BaseAdapter]) -> None:
    """Register a new adapter in the registry."""
    _REGISTRY[adapter_cls.plugin_id] = adapter_cls


def get_adapter(plugin_id: str, website_url: str) -> BaseAdapter:
    """Get an instantiated adapter for the given plugin_id. Falls back to generic."""
    cls = _REGISTRY.get(plugin_id, GenericAdapter)
    return cls(website_url)


def list_plugins() -> list[dict]:
    """Return metadata for all registered plugins."""
    return [
        {
            "plugin_id": cls.plugin_id,
            "plugin_name": cls.plugin_name,
            "description": cls.plugin_description,
        }
        for cls in _REGISTRY.values()
    ]
