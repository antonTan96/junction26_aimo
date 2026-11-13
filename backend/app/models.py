import datetime
from sqlalchemy import (
    Column,
    String,
    Integer,
    Numeric,
    Boolean,
    DateTime,
    JSON,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from .database import Base

class Product(Base):
    __tablename__ = "products"

    sku = Column(String(32), primary_key=True, index=True)
    name = Column(String(128), nullable=False)
    category = Column(String(64), nullable=False, index=True)
    dietary_tags = Column(JSON, nullable=False, default=list)
    pack_format = Column(String(64), nullable=False)
    pack_volume_litres = Column(Numeric(10, 2), nullable=False)
    min_lead_time_hours = Column(Integer, nullable=False, default=24)
    is_active = Column(Boolean, nullable=False, default=True)

    # Confidential internal columns (NEVER exposed to external agents)
    internal_cost_eur = Column(Numeric(10, 2), nullable=False)
    internal_margin_pct = Column(Numeric(5, 2), nullable=False)
    roadmap_status = Column(String(32), nullable=False, default="LIVE")  # 'LIVE' or 'UNRELEASED'

    stock = relationship("WarehouseStock", back_populates="product", uselist=False, cascade="all, delete-orphan")
    contract_prices = relationship("TenantContractPrice", back_populates="product", cascade="all, delete-orphan")

class TenantContractPrice(Base):
    __tablename__ = "tenant_contract_prices"

    tenant_id = Column(String(64), primary_key=True)
    sku = Column(String(32), ForeignKey("products.sku", ondelete="CASCADE"), primary_key=True)
    contract_pack_price_eur = Column(Numeric(10, 2), nullable=False)

    product = relationship("Product", back_populates="contract_prices")

class WarehouseStock(Base):
    __tablename__ = "warehouse_stock"

    sku = Column(String(32), ForeignKey("products.sku", ondelete="CASCADE"), primary_key=True)
    available_packs = Column(Integer, nullable=False, default=0)
    reserved_packs = Column(Integer, nullable=False, default=0)

    product = relationship("Product", back_populates="stock")

class TenantPolicy(Base):
    __tablename__ = "tenant_policies"

    tenant_id = Column(String(64), primary_key=True)
    tenant_name = Column(String(128), nullable=False)
    max_auto_approve_eur = Column(Numeric(10, 2), nullable=False, default=800.00)
    max_auto_approve_litres = Column(Numeric(10, 2), nullable=False, default=600.00)
    allowed_categories = Column(JSON, nullable=False, default=list)

class QuoteLock(Base):
    __tablename__ = "quote_locks"

    quote_id = Column(String(32), primary_key=True, index=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    sku = Column(String(32), nullable=False, index=True)
    pack_quantity = Column(Integer, nullable=False)
    total_litres = Column(Numeric(10, 2), nullable=False)
    locked_total_eur = Column(Numeric(10, 2), nullable=False)
    deliver_by = Column(DateTime, nullable=False)
    status = Column(String(32), nullable=False, default="LOCKED")  # 'LOCKED', 'CONSUMED', 'RELEASED', 'EXPIRED'
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)

class Order(Base):
    __tablename__ = "orders"

    order_id = Column(String(32), primary_key=True, index=True)
    quote_id = Column(String(32), nullable=False, unique=True, index=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    po_reference = Column(String(64), nullable=False)
    status = Column(String(32), nullable=False)  # 'CONFIRMED', 'PENDING_APPROVAL', 'REJECTED'
    total_eur = Column(Numeric(10, 2), nullable=False)
    violation_reasons = Column(JSON, nullable=True)
    approved_by = Column(String(128), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "po_reference", name="uq_tenant_po"),
    )

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
    tenant_id = Column(String(64), nullable=False, index=True)
    actor_type = Column(String(32), nullable=False)  # 'agent', 'human', 'system'
    actor_id = Column(String(128), nullable=False)
    action = Column(String(64), nullable=False)
    payload_summary = Column(JSON, nullable=False, default=dict)
