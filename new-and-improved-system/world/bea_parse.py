# Node graph amendment 2: parse BEA Use tables (Before Redefinitions, producer prices, SUMMARY level, 1997-2023) into
# .cache/bea/use_summary.json: { year: { ind: [codes], names: {code: name}, use: {commodity: {industry: $M}}, rowTotal: {commodity: total use}, inter: {industry: total intermediate inputs} } }
import openpyxl, json, sys
wb = openpyxl.load_workbook('.cache/bea/io/IOUse_Before_Redefinitions_PRO_1997-2023_Summary.xlsx', read_only=True)
num = lambda v: float(v) if isinstance(v, (int, float)) else (float(v) if isinstance(v, str) and v.replace('.', '', 1).replace('-', '', 1).isdigit() else 0.0)
out = {}
for y in wb.sheetnames:
    rows = list(wb[y].iter_rows(values_only=True)); hdr = rows[5]; codes = [c for c in hdr[2:] if c]
    cols = {c: i + 2 for i, c in enumerate(hdr[2:]) if c}
    ind = [c for c in codes if not str(c).startswith(('F', 'T'))]
    names, use, rowTotal, inter = {}, {}, {}, {}
    for r in rows[7:]:
        code = r[0]
        if not code: continue
        names[code] = r[1]
        if code == 'T005': inter = {c: num(r[cols[c]]) for c in ind}; continue
        if str(code).startswith(('T', 'V')): continue
        use[code] = {c: num(r[cols[c]]) for c in ind if num(r[cols[c]]) > 0}
        tc = next((c for c in ('T019', 'T007') if c in cols), None); rowTotal[code] = num(r[cols[tc]]) if tc else sum(use[code].values())
    out[y] = {'ind': ind, 'names': names, 'use': use, 'rowTotal': rowTotal, 'inter': inter}
json.dump(out, open('.cache/bea/use_summary.json', 'w'))
y = out['2016']; print(len(out), 'years;', len(y['ind']), 'industries;', 'semis(334) top customers:', sorted(((v / y['rowTotal']['334'], k) for k, v in y['use']['334'].items()), reverse=True)[:6])
