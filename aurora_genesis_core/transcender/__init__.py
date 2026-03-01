"""Transcender: Triplet synthesis and hierarchical compression module."""

from aurora_genesis_core.transcender.triplet_synthesis import TripletOperator
from aurora_genesis_core.transcender.rewrite_rules import RewriteRule
from aurora_genesis_core.transcender.compression_metrics import CompressionMetrics
from aurora_genesis_core.transcender.promotion_system import PromotionSystem

__all__ = [
    "TripletOperator",
    "RewriteRule",
    "CompressionMetrics",
    "PromotionSystem",
]
