"""Famous-investor persona agents — all 13 from the upstream ai-hedge-fund roster.

Each persona reads the analyst layer's signals + raw data and produces its own
verdict from a distinctive investment philosophy.

Phase 4c shipped 6 personas (Buffett, Burry, Druckenmiller, Cathie Wood, Taleb,
Damodaran). Phase 4d adds the remaining 7: Munger, Pabrai, Graham, Ackman, Lynch,
Fisher, Jhunjhunwala.
"""

from cfp_agents.personas.ackman import AckmanPersona
from cfp_agents.personas.buffett import BuffettPersona
from cfp_agents.personas.burry import BurryPersona
from cfp_agents.personas.cathie_wood import CathieWoodPersona
from cfp_agents.personas.damodaran import DamodaranPersona
from cfp_agents.personas.druckenmiller import DruckenmillerPersona
from cfp_agents.personas.fisher import FisherPersona
from cfp_agents.personas.graham import GrahamPersona
from cfp_agents.personas.jhunjhunwala import JhunjhunwalaPersona
from cfp_agents.personas.lynch import LynchPersona
from cfp_agents.personas.munger import MungerPersona
from cfp_agents.personas.pabrai import PabraiPersona
from cfp_agents.personas.taleb import TalebPersona

__all__ = [
    "AckmanPersona",
    "BuffettPersona",
    "BurryPersona",
    "CathieWoodPersona",
    "DamodaranPersona",
    "DruckenmillerPersona",
    "FisherPersona",
    "GrahamPersona",
    "JhunjhunwalaPersona",
    "LynchPersona",
    "MungerPersona",
    "PabraiPersona",
    "TalebPersona",
]


def all_personas() -> list:
    """Return one instance of each persona, in stable order."""
    return [
        BuffettPersona(),
        MungerPersona(),
        BurryPersona(),
        DruckenmillerPersona(),
        CathieWoodPersona(),
        TalebPersona(),
        DamodaranPersona(),
        GrahamPersona(),
        AckmanPersona(),
        LynchPersona(),
        FisherPersona(),
        PabraiPersona(),
        JhunjhunwalaPersona(),
    ]
