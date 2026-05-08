"""Famous-investor persona agents — orthogonal voices for the ensemble.

Roster designed for SIGNAL DIVERSIFICATION, not coverage of every famous
name. The bar for a slot: produces a signal uncorrelated with the others.

Quality + moats:    Buffett
Deep value short:   Burry
Macro + tape:       Druckenmiller
Tail / vol:         Taleb
Reflexivity:        Soros            (NEW — bubble/anti-bubble cycles)
Pure quant:         Simons           (NEW — no narrative, only edges)
Special situations: Klarman          (NEW — replaces Graham overlap)
Event-driven:       Greenblatt       (NEW — magic formula + spinoffs)
Momentum/VCP:       Minervini        (NEW — buy strength, stage analysis)
Disruption growth:  Cathie Wood
DCF + risk premia:  Damodaran
Growth bucket:      Lynch
Activist FCF:       Ackman

Dropped from prior roster (Phase B): Munger (Buffett-overlap), Pabrai
(Buffett-overlap), Fisher (Lynch-overlap), Graham (Klarman-overlap),
Jhunjhunwala (no US fit).
"""

from cfp_agents.personas.ackman import AckmanPersona
from cfp_agents.personas.buffett import BuffettPersona
from cfp_agents.personas.burry import BurryPersona
from cfp_agents.personas.cathie_wood import CathieWoodPersona
from cfp_agents.personas.damodaran import DamodaranPersona
from cfp_agents.personas.druckenmiller import DruckenmillerPersona
from cfp_agents.personas.greenblatt import GreenblattPersona
from cfp_agents.personas.klarman import KlarmanPersona
from cfp_agents.personas.lynch import LynchPersona
from cfp_agents.personas.minervini import MinerviniPersona
from cfp_agents.personas.simons import SimonsPersona
from cfp_agents.personas.soros import SorosPersona
from cfp_agents.personas.taleb import TalebPersona

__all__ = [
    "AckmanPersona",
    "BuffettPersona",
    "BurryPersona",
    "CathieWoodPersona",
    "DamodaranPersona",
    "DruckenmillerPersona",
    "GreenblattPersona",
    "KlarmanPersona",
    "LynchPersona",
    "MinerviniPersona",
    "SimonsPersona",
    "SorosPersona",
    "TalebPersona",
]


def all_personas() -> list:
    """Return one instance of each persona, in stable order."""
    return [
        BuffettPersona(),
        BurryPersona(),
        DruckenmillerPersona(),
        TalebPersona(),
        SorosPersona(),
        SimonsPersona(),
        KlarmanPersona(),
        GreenblattPersona(),
        MinerviniPersona(),
        CathieWoodPersona(),
        DamodaranPersona(),
        LynchPersona(),
        AckmanPersona(),
    ]
