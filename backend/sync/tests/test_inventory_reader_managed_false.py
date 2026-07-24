"""WP 666 — verify inventory_reader proxies are read-only."""
from django.test import TestCase

from inventory_reader.models import (
    B2BSalesOrderRO, CustomerRO, LocationRO, POSOrderRO, ProductRO,
    PurchaseOrderRO, SupplierRO, SalesReturnRO, PurchaseReturnRO,
    StockMovementRO, RoleRO, UserProfileRO, UserLocationAssignmentRO,
    PurchaseOrderLineRO, POSOrderLineRO, B2BSalesOrderLineRO,
    SalesReturnLineRO, PurchaseReturnLineRO, PurchaseAmendmentRO,
)


READ_ONLY_MODELS = [
    B2BSalesOrderRO, CustomerRO, LocationRO, POSOrderRO, ProductRO,
    PurchaseOrderRO, SupplierRO, SalesReturnRO, PurchaseReturnRO,
    StockMovementRO, RoleRO, UserProfileRO, UserLocationAssignmentRO,
    PurchaseOrderLineRO, POSOrderLineRO, B2BSalesOrderLineRO,
    SalesReturnLineRO, PurchaseReturnLineRO, PurchaseAmendmentRO,
]


class InventoryReaderManagedFalseTests(TestCase):
    """All proxy models must declare managed=False so migrate doesn't touch
    inventory's tables, and so accidental save() calls never write."""

    def test_all_models_managed_false(self):
        bad = [m for m in READ_ONLY_MODELS if m._meta.managed]
        self.assertEqual(bad, [], f'These models are managed=True: {bad}')

    def test_all_fks_have_db_constraint_false(self):
        # FKs across the inventory boundary must not declare DB constraints,
        # otherwise migrate would try to create them in the accounting DB.
        for model in READ_ONLY_MODELS:
            for field in model._meta.get_fields():
                if hasattr(field, 'db_constraint') and field.is_relation:
                    self.assertFalse(
                        field.db_constraint,
                        f'{model.__name__}.{field.name} has db_constraint=True',
                    )
