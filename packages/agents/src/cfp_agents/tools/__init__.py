"""Tools personas can call from their lens() to ground reasoning in real
computed numbers instead of LLM hand-waving."""

from cfp_agents.tools.dcf import DcfResult, compute_dcf
from cfp_agents.tools.magic_formula import MagicFormulaResult, compute_magic_formula

__all__ = [
    "DcfResult",
    "MagicFormulaResult",
    "compute_dcf",
    "compute_magic_formula",
]
