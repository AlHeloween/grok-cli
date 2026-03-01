"""Fractal Context Engine: Navigation paradigm for compute-reduction memory.

Implements velocity-based drill-down algorithm using dual quaternion semantic velocity
to dynamically decide how deep to look into the fractal memory tree.

Per Aurora-Genesis Navigation paradigm:
- Clocal: Last W tokens (standard dense attention)
- Cglobal: Infinite history via Sierpinski lattice with recursive drill-down
- Scaling: O(W·Q) + O(K·log N) instead of O(Q²)
"""

from __future__ import annotations

from typing import Optional, Union
import torch
from torch import nn

from aurora_genesis_core.probe.dual_quaternion import (
    DualQuaternionTensor,
    hamilton_product,
    dual_quat_conjugate,
)
from aurora_genesis_core.memory.lattice_addressing import (
    SierpinskiLatticeAddress,
    LatticeAddressing,
)
from aurora_genesis_core.memory.lattice_storage import LatticeMemoryStorage, MemoryEntry
from aurora_genesis_core.memory.lattice_retrieval import LatticeRetrieval

# Optional import for caching
try:
    from aurora_genesis_core.memory.fractal_tree_cache import FractalTreeCache
    HAS_CACHE = True
except ImportError:
    HAS_CACHE = False
    FractalTreeCache = None

# Optional import for profiling
try:
    from aurora_genesis_core.utils.navigation_profiler import get_profiler
    HAS_PROFILER = True
except ImportError:
    HAS_PROFILER = False
    def get_profiler():
        return None


class FractalNode:
    """Represents a node in the fractal memory tree."""
    
    def __init__(
        self,
        address: SierpinskiLatticeAddress,
        embedding: Optional[torch.Tensor] = None,  # [8] dual quaternion
        embedding_dual: Optional[torch.Tensor] = None,  # [8] dual quaternion velocity
        children: Optional[list[FractalNode]] = None,
        entry: Optional[MemoryEntry] = None,
    ):
        self.address = address
        self.embedding = embedding  # Primal: z_p
        self.embedding_dual = embedding_dual  # Dual: z_d (semantic velocity)
        self.children = children or []
        self.entry = entry
    
    def has_children(self) -> bool:
        """Check if node has children."""
        return len(self.children) > 0


class FractalContextEngine:
    """
    Fractal Context Engine implementing Navigation paradigm.
    
    Core Logic:
    1. Split context into Clocal (window) + Cglobal (fractal)
    2. Use dual quaternion inner product ⟨q,k⟩dq for relevance
    3. Use dual component magnitude ||zd|| as "uncertainty signal"
    4. Recursively drill down when ||zd|| > tau (high uncertainty)
    5. Stop when ||zd|| < tau (stable/static) or leaf reached
    
    Scaling: O(W·Q) + O(K·log N) instead of O(Q²)
    """
    
    def __init__(
        self,
        memory_storage: LatticeMemoryStorage,
        lattice_addressing: LatticeAddressing,
        window_size: int = 2048,
        tau: float = 0.1,  # Uncertainty threshold
        max_depth: int = 7,  # Maximum fractal level
        max_nodes_per_level: int = 4,  # Top-K per level (hard cap)
        device: Optional[str] = None,
        enable_cache: bool = True,  # Enable fractal tree caching
        cache_size: int = 1000,  # Maximum cache size
    ):
        """
        Initialize Fractal Context Engine.
        
        Args:
            memory_storage: Lattice memory storage
            lattice_addressing: Lattice addressing utilities
            window_size: Local context window size (W)
            tau: Uncertainty threshold for drill-down decision
            max_depth: Maximum fractal level to drill down
            max_nodes_per_level: Maximum nodes to retrieve per level (hard cap)
            device: PyTorch device
            enable_cache: If True, enable fractal tree caching
            cache_size: Maximum cache size
        """
        self.memory_storage = memory_storage
        self.lattice_addressing = lattice_addressing
        self.window_size = int(window_size)
        self.tau = float(tau)
        self.max_depth = int(max_depth)
        self.max_nodes_per_level = int(max_nodes_per_level)
        
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = device
        
        # Initialize retrieval system
        self.retrieval = LatticeRetrieval(
            storage=memory_storage,
            addressing=lattice_addressing,
        )
        
        # Initialize cache if available
        self.cache: Optional[FractalTreeCache] = None
        if enable_cache and HAS_CACHE:
            self.cache = FractalTreeCache(
                max_cache_size=cache_size,
                enable_conjugate_cache=True,
            )
    
    def get_context(
        self,
        query_dq: DualQuaternionTensor,
        local_tokens: Optional[torch.Tensor] = None,
        apply_temporal_decay: bool = False,
        current_time: Optional[float] = None,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """
        Get hybrid context: Clocal (window) + Cglobal (fractal).
        
        Args:
            query_dq: Query dual quaternion tensor [8] or [batch, 8]
            local_tokens: Local context tokens [batch, W, hidden_dim] (optional)
            apply_temporal_decay: If True, apply temporal decay to dual component
            current_time: Current time for temporal decay (if None, no decay)
        
        Returns:
            (Clocal, Cglobal) where:
            - Clocal: [batch, W, hidden_dim] or [W, hidden_dim]
            - Cglobal: [batch, K, hidden_dim] or [K, hidden_dim]
        """
        # 1. Always grab Local Window (Standard Attention)
        if local_tokens is not None:
            Clocal = local_tokens
        else:
            # If no local tokens provided, return empty
            Clocal = torch.empty(0, device=self.device)
        
        # 2. Retrieve Global Context via Fractal Drill-Down
        Cglobal = self.recursive_search(
            query_dq,
            start_level=0,
            apply_temporal_decay=apply_temporal_decay,
            current_time=current_time,
        )
        
        return Clocal, Cglobal
    
    def recursive_search(
        self,
        query: DualQuaternionTensor,
        start_level: int = 0,
        apply_temporal_decay: bool = False,
        current_time: Optional[float] = None,
    ) -> torch.Tensor:
        """Recursive drill-down search with profiling."""
        if HAS_PROFILER:
            profiler = get_profiler()
            if profiler:
                start_time = profiler.start_timer("recursive_search")
        
        try:
            # Get root nodes first
            root_addresses = self._get_level_addresses(start_level)
            if not isinstance(root_addresses, list):
                root_addresses = [root_addresses] if root_addresses is not None else []
            
            # Build fractal tree
            if self.cache is not None:
                root_nodes = []
                for addr in root_addresses:
                    node = self.cache.get_node(addr, self.memory_storage, self.lattice_addressing, self.max_depth)
                    if node is not None:
                        root_nodes.append(node)
            else:
                root_nodes = self._build_fractal_tree(root_addresses, max_level=self.max_depth)
            
            if not isinstance(root_nodes, list):
                root_nodes = [root_nodes] if root_nodes is not None else []
            
            # Now call recursive search with root_nodes
            selected_nodes = self._recursive_search_impl(query, root_nodes, start_level, apply_temporal_decay, current_time)
            
            # Extract embeddings from selected nodes
            if not selected_nodes:
                return torch.empty(0, 8, device=self.device)
            
            embeddings = []
            for node in selected_nodes[:self.max_nodes_per_level]:
                if node.embedding is not None:
                    # Note: Temporal decay is applied during node selection in _recursive_search_impl
                    # The embeddings returned here are already from the decay-filtered selection
                    embeddings.append(node.embedding)
            
            if not embeddings:
                return torch.empty(0, 8, device=self.device)
            
            return torch.stack(embeddings, dim=0)  # [K, 8]
        finally:
            if HAS_PROFILER:
                profiler = get_profiler()
                if profiler:
                    profiler.end_timer("recursive_search", start_time)
    
    def _recursive_search_impl(
        self,
        query: DualQuaternionTensor,
        nodes: list[FractalNode],
        current_level: int,
        apply_temporal_decay: bool = False,
        current_time: Optional[float] = None,
    ) -> list[FractalNode]:
        """
        Internal recursive search implementation.
        
        Args:
            query: Query dual quaternion
            nodes: Current level nodes
            current_level: Current fractal level
            apply_temporal_decay: If True, apply temporal decay to dual component
            current_time: Current time for temporal decay
        
        Returns:
            Selected nodes (summaries or leaf details)
        """
        selected_nodes = []
        
        if current_level > self.max_depth:
            return selected_nodes
        
        for node in nodes:
            if node.embedding is None:
                continue
            
            # Calculate Dual Quaternion Inner Product: ⟨q, k⟩dq
            node_dq = DualQuaternionTensor(node.embedding)
            
            # Use cached conjugate if available
            if self.cache is not None:
                # Get conjugate from cache
                k_conj_data = self.cache.get_conjugate(node.embedding)
                k_conj = DualQuaternionTensor(k_conj_data)
                # Compute Q ⊗ K*
                score_dq = hamilton_product(query, k_conj)
            else:
                score_dq = self._dual_quat_inner_product(query, node_dq)
            
            # Extract primal similarity (relevance check)
            similarity = self._extract_primal_similarity(score_dq)
            
            # Extract dual velocity (uncertainty signal)
            velocity = self._extract_dual_velocity(score_dq)
            
            # Apply temporal decay if enabled
            if apply_temporal_decay and node.entry is not None and current_time is not None:
                if self.cache is not None:
                    # Use cached decay factor
                    decay_factor = self.cache.get_temporal_decay(
                        node.address,
                        node.entry,
                        current_time,
                        decay_lambda=0.01,
                    )
                    velocity = velocity * decay_factor
                else:
                    velocity = self._decay_velocity(velocity, node.entry, current_time)
            
            # RELEVANCE CHECK: Is this branch even related?
            if similarity > 0.5:  # Relevance threshold
                
                # SCALING LOGIC: The "Policy Gate"
                # If velocity is high, it means this memory is "unstable" or "dense"
                # We must dig deeper to find the specific detail.
                if velocity > self.tau and node.has_children() and current_level < self.max_depth:
                    # Drill down (Recursive Step)
                    child_nodes = self._recursive_search_impl(
                        query,
                        node.children,
                        current_level=current_level + 1,
                        apply_temporal_decay=apply_temporal_decay,
                        current_time=current_time,
                    )
                    selected_nodes.extend(child_nodes)
                else:
                    # Stop and use this summary (Base Case)
                    # This effectively "compresses" 1000s of tokens into 1 node
                    selected_nodes.append(node)
        
        # Hard cap: Maximum K nodes per level
        return selected_nodes[:self.max_nodes_per_level]
    
    def _dual_quat_inner_product(
        self,
        q: DualQuaternionTensor,
        k: DualQuaternionTensor,
    ) -> DualQuaternionTensor:
        """
        Compute dual quaternion inner product: Score(Q,K) = Re(Q⊗K*) + εDu(Q⊗K*)
        
        Args:
            q: Query dual quaternion
            k: Key dual quaternion
        
        Returns:
            Result dual quaternion (primal = similarity, dual = velocity)
        """
        # Step 1: Compute K* (conjugate of K)
        k_conj = dual_quat_conjugate(k)
        
        # Step 2: Compute Q⊗K* (Hamilton product)
        qk_star = hamilton_product(q, k_conj)
        
        return qk_star
    
    def _extract_primal_similarity(self, score_dq: DualQuaternionTensor) -> float:
        """
        Extract primal similarity from dual quaternion inner product.
        
        Uses rotation quaternion's w component (cosine similarity).
        
        Args:
            score_dq: Dual quaternion inner product result
        
        Returns:
            Similarity score (0-1)
        """
        # Extract rotation quaternion (primal part)
        rotation = score_dq.rotation  # [4]
        
        # Use w component as cosine similarity
        similarity = rotation[0].item()  # w component
        
        # Normalize to [0, 1] range (for normalized quaternions, w ∈ [-1, 1])
        similarity = (similarity + 1.0) / 2.0
        
        return float(similarity)
    
    def _extract_dual_velocity(self, score_dq: DualQuaternionTensor) -> float:
        """
        Extract dual velocity magnitude from dual quaternion inner product.
        
        Uses translation quaternion's magnitude as "semantic variance" signal.
        
        Args:
            score_dq: Dual quaternion inner product result
        
        Returns:
            Velocity magnitude (||zd||)
        """
        # Extract translation quaternion (dual part)
        translation = score_dq.translation  # [4]
        
        # Compute magnitude: ||zd||
        velocity = torch.norm(translation).item()
        
        return float(velocity)
    
    def _get_level_addresses(self, level: int) -> list[SierpinskiLatticeAddress]:
        """
        Get all addresses at a given fractal level.
        
        Args:
            level: Fractal level (0 = root, higher = finer)
        
        Returns:
            List of addresses at this level
        """
        addresses = []
        n_per_level = self.lattice_addressing.n_per_level
        
        for index in range(n_per_level):
            addr = SierpinskiLatticeAddress(
                level=level,
                index=index,
                sub_index=0,
            )
            addresses.append(addr)
        
        return addresses
    
    def _build_fractal_tree(
        self,
        addresses: list[SierpinskiLatticeAddress],
        max_level: int = 7,
    ) -> list[FractalNode]:
        """
        Build fractal tree from storage.
        
        Args:
            addresses: Root addresses
            max_level: Maximum level to build
        
        Returns:
            List of root nodes with children
        """
        nodes = []
        
        for addr in addresses:
            node = self._build_node(addr, max_level=max_level)
            if node is not None:
                nodes.append(node)
        
        return nodes
    
    def _build_node(
        self,
        address: SierpinskiLatticeAddress,
        max_level: int = 7,
    ) -> Optional[FractalNode]:
        """
        Build a single node and its children recursively.
        
        Args:
            address: Node address
            max_level: Maximum level to build
        
        Returns:
            FractalNode or None if no data
        """
        if address.level > max_level:
            return None
        
        # Read entry from storage
        entries = self.memory_storage.read_leaf(address)
        
        # Extract embedding from entry (if available)
        embedding = None
        embedding_dual = None
        entry = None
        
        if entries:
            # Use first entry's embedding
            entry = entries[0]
            if entry.embedding:
                embedding = torch.tensor(
                    entry.embedding[:8],  # Ensure 8 dimensions
                    device=self.device,
                    dtype=torch.float32,
                )
                # If entry has dual component, use it; otherwise derive from embedding
                # For now, assume dual is zero (would be populated by Evolver)
                embedding_dual = torch.zeros(8, device=self.device, dtype=torch.float32)
        
        # Build children if not at max level
        children = []
        if address.level < max_level:
            child_addresses = self.lattice_addressing.get_child_addresses(
                address,
                max_level=max_level,
            )
            for child_addr in child_addresses:
                child_node = self._build_node(child_addr, max_level=max_level)
                if child_node is not None:
                    children.append(child_node)
        
        return FractalNode(
            address=address,
            embedding=embedding,
            embedding_dual=embedding_dual,
            children=children,
            entry=entry,
        )
    
    def _apply_temporal_decay(
        self,
        embedding: torch.Tensor,
        embedding_dual: Optional[torch.Tensor],
        entry: MemoryEntry,
        current_time: Optional[float],
    ) -> torch.Tensor:
        """
        Apply temporal decay to embedding based on entry timestamp.
        
        Decay function: zd(t) → 0 as time passes (mimics biological forgetting).
        
        Args:
            embedding: Primal embedding [8]
            embedding_dual: Dual embedding (velocity) [8] or None
            entry: Memory entry with metadata
            current_time: Current time for decay calculation
        
        Returns:
            Decayed embedding [8]
        """
        if current_time is None or embedding_dual is None:
            return embedding
        
        # Get entry timestamp from metadata
        entry_time = entry.metadata.get("timestamp", 0.0) if entry.metadata else 0.0
        
        # Compute time difference
        dt = current_time - entry_time
        
        # Decay factor: exponential decay (zd decays over time)
        # zd(t) = zd(0) * exp(-λ * dt)
        decay_lambda = 0.01  # Decay rate (configurable)
        decay_factor = torch.exp(-decay_lambda * dt)
        
        # Apply decay to dual component
        # For embedding, we can decay the dual part's influence
        # Simplified: reduce embedding by decayed dual component
        if embedding_dual is not None:
            decayed_dual = embedding_dual * decay_factor
            # Update embedding: z_p(t) = z_p(0) + dt * zd(t) (first-order evolution)
            embedding = embedding + dt * decayed_dual
        
        return embedding
    
    def _decay_velocity(
        self,
        velocity: float,
        entry: MemoryEntry,
        current_time: float,
    ) -> float:
        """
        Apply temporal decay to velocity magnitude.
        
        Decay function: ||zd||(t) → 0 as time passes.
        
        Args:
            velocity: Current velocity magnitude
            entry: Memory entry with metadata
            current_time: Current time
        
        Returns:
            Decayed velocity magnitude
        """
        # Get entry timestamp from metadata
        entry_time = entry.metadata.get("timestamp", 0.0) if entry.metadata else 0.0
        
        # Compute time difference
        dt = current_time - entry_time
        
        # Decay factor: exponential decay
        decay_lambda = 0.01  # Decay rate (configurable)
        import math
        decay_factor = math.exp(-decay_lambda * dt)
        
        # Apply decay
        decayed_velocity = velocity * decay_factor
        
        return decayed_velocity
