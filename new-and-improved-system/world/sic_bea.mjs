// Node graph amendment 2: SIC (1987, 4-digit as filed with the SEC) → BEA summary industry code (71 industries, 2017 NAICS basis).
// Fixed by hand from the SIC and NAICS definitions; no data was looked at to choose it.
export function sicToBea(sic) {
  const s = String(sic ?? '').padStart(4, '0'), n2 = +s.slice(0, 2), n3 = +s.slice(0, 3), n4 = +s;
  if (!n4) return null;
  if (n2 <= 2 || n2 === 7) return '111CA';
  if (n2 === 8 || n2 === 9) return '113FF';
  if (n2 === 10 || n2 === 12 || n2 === 14) return '212';
  if (n2 === 13) return n3 === 138 ? '213' : '211';
  if (n2 >= 15 && n2 <= 17) return '23';
  if (n2 === 20 || n2 === 21) return '311FT';
  if (n2 === 22) return '313TT';
  if (n2 === 23 || n2 === 31) return '315AL';
  if (n2 === 24) return '321';
  if (n2 === 25) return '337';
  if (n2 === 26) return '322';
  if (n2 === 27) return n3 <= 274 ? '511' : '323';
  if (n2 === 28) return '325';
  if (n2 === 29) return '324';
  if (n2 === 30) return '326';
  if (n2 === 32) return '327';
  if (n2 === 33) return '331';
  if (n2 === 34) return '332';
  if (n2 === 35) return n3 === 357 ? '334' : '333';
  if (n2 === 36) return [365, 366, 367].includes(n3) ? '334' : '335';
  if (n2 === 37) return n3 === 371 ? '3361MV' : '3364OT';
  if (n2 === 38) return n3 === 381 || n3 === 382 ? '334' : n3 === 386 ? '333' : '339';
  if (n2 === 39) return '339';
  if (n2 === 40) return '482';
  if (n2 === 41) return '485';
  if (n2 === 42) return n3 === 422 ? '493' : '484';
  if (n2 === 44) return '483';
  if (n2 === 45) return '481';
  if (n2 === 46) return '486';
  if (n2 === 47) return '487OS';
  if (n2 === 48) return '513';
  if (n2 === 49) return n3 === 495 ? '562' : '22';
  if (n2 === 50 || n2 === 51) return '42';
  if (n2 === 53) return '452';
  if (n2 === 54) return '445';
  if (n2 === 55) return '441';
  if (n2 === 58) return '722';
  if (n2 >= 52 && n2 <= 59) return '4A0';
  if (n2 === 60 || n2 === 61) return '521CI';
  if (n2 === 62) return '523';
  if (n2 === 63 || n2 === 64) return '524';
  if (n2 === 65) return 'ORE';
  if (n2 === 67) return n4 === 6798 ? 'ORE' : '525';
  if (n2 === 70) return '721';
  if (n2 === 72 || n2 === 75 || n2 === 76) return '81';
  if (n2 === 73) return n4 === 7372 ? '511' : n4 === 7374 ? '514' : n3 === 737 ? '5415' : n3 === 731 ? '5412OP' : '561';
  if (n2 === 78) return '512';
  if (n2 === 79) return '713';
  if (n2 === 80) return n3 === 805 ? '623' : n3 === 806 ? '622' : '621';
  if (n2 === 82) return '61';
  if (n2 === 83) return '624';
  if (n2 === 87 || n2 === 89) return '5412OP';
  return null;
}

// outside nodes → BEA codes they plausibly touch ('ALL' = macro-wide). Fixed before any test result.
export const OUTSIDE_BEA = {
  'root:hyperscaler_capex': ['334', '335', '333', '23', '22', '331', '332', '327', '5415', '514', '511'],
  'fred:PCU334413334413': ['334'], 'fred:PCU33443344': ['334'], 'fred:IPG3344S': ['334'],
  'fred:PCU335311335311': ['335', '22'], 'fred:PCU335313335313': ['335', '22'], 'fred:PCU2211222112': ['335', '22'],
  'fred:APU000072610': ['22'], 'fred:DHHNGSP': ['211', '22', '324', '325'], 'fred:PCOPPUSDM': ['212', '331', '332', '335'],
  'fred:PALUMUSDM': ['212', '331', '332'], 'fred:TLPWRCONS': ['23', '22', '335', '333'], 'fred:TLCOMCONS': ['23', '327', '332', '321'],
  'fred:DGS10': ['ALL'], 'fred:DTWEXBGS': ['ALL'], 'fred:RSAFS': ['ALL'], 'fred:DCOILWTICO': ['211', '213', '324', '481', '486'],
  'fred:CBBTCUSD': ['514', '523', '521CI'], 'fred:TSIFRGHT': ['484', '482', '481', '483', '493', '42'],
  // amendment 2b
  'fred:A34SNO': ['334'], 'fred:A34SUO': ['334'], 'fred:A34STI': ['334'], 'fred:A34ANO': ['334'], 'fred:A35SNO': ['335'], 'fred:A35SUO': ['335'], 'fred:A33SNO': ['333'],
  'fred:A36SNO': ['3361MV', '3364OT'], 'fred:NEWORDER': ['333', '334', '335'], 'fred:ADEFNO': ['3364OT', '334'], 'fred:ANAPNO': ['3364OT'], 'fred:TLMFGCONS': ['23', '333', '332', '327'],
  'fred:IPG3341S': ['334'], 'fred:CAPUTLG3344S': ['334'], 'fred:IPG2211S': ['22'], 'fred:PCU518210518210': ['514', '5415'], 'fred:CES6054150001': ['5415'], 'fred:CES5051800001': ['514'],
  'fred:PURANUSDM': ['212', '22'], 'fred:PNICKUSDM': ['212', '331'], 'fred:PIORECRUSDM': ['212', '331'], 'fred:PCOALAUUSDM': ['212', '22'],
  'fred:XTEXVA01KRM667S': ['334'], 'fred:XTEXVA01JPM667S': ['334', '333', '3361MV'], 'fred:XTEXVA01CNM667S': ['334', '42', '4A0', '315AL', '339'],
  'fred:RAILFRTCARLOADSD11': ['482', '212', '325'], 'fred:TRUCKD11': ['484'], 'fred:NOFDFSA066MSFRBPHI': ['ALL'], 'fred:CFNAI': ['ALL'],
  'wsts:worldwide': ['334'], 'c30:datacenter': ['23', '335', '333', '22'], 'btc:hash-rate': ['514', '523', '521CI'], 'btc:miners-revenue': ['514', '523', '521CI'],
};
