# Node graph amendment 2b: free non-FRED outside nodes → .cache/graph/extra.json  {id: {name, obs: [{m: 'YYYY-MM', v, avail}]}}
# WSTS global semiconductor billings (+45d), Census C30 data-center construction (+35d, current vintage), NY Fed GSCPI (+5d),
# blockchain.info hash rate and miner revenue (daily → monthly mean, +1d). Run with the scratchpad venv python (needs openpyxl).
import json, re, io, urllib.request, datetime, calendar, openpyxl
UA = {'User-Agent': 'Mozilla/5.0 research saieagle@gmail.com'}
get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60).read()
def avail(y, m, days): last = datetime.date(y, m, calendar.monthrange(y, m)[1]); return (last + datetime.timedelta(days=days)).isoformat()
out = {}
# WSTS
page = get('https://www.wsts.org/67/Historical-Billings-Report').decode('utf8', 'ignore'); url = re.search(r'href="([^"]+Historical-Billings-Report[^"]+\.xlsx)"', page).group(1)
ws = openpyxl.load_workbook(io.BytesIO(get(url)), read_only=True, data_only=True)['Monthly Data']; year = None; obs = []
for r in ws.iter_rows(values_only=True):
    if isinstance(r[0], (int, float)) or (isinstance(r[0], str) and r[0].strip().isdigit()): year = int(r[0]); continue
    if year and r[0] == 'Worldwide':
        for i, v in enumerate(r[1:13]):
            if isinstance(v, (int, float)) and v > 0: obs.append({'m': f'{year}-{i+1:02d}', 'v': float(v), 'avail': avail(year, i + 1, 45)})
out['wsts:worldwide'] = {'name': 'WSTS worldwide semiconductor billings', 'obs': obs}
# Census C30 data center
wb = openpyxl.load_workbook(io.BytesIO(get('https://www.census.gov/construction/c30/xlsx/privsatime.xlsx')), read_only=True, data_only=True); rows = list(wb[wb.sheetnames[0]].iter_rows(values_only=True))
hdr = next(r for r in rows if r and r[0] == 'Date'); col = next(i for i, h in enumerate(hdr) if h and 'Data center' in str(h)); obs = []
for r in rows:
    mm = re.match(r'([A-Za-z]{3})-(\d{2})', str(r[0] or ''))
    if mm and isinstance(r[col], (int, float)):
        y = 2000 + int(mm.group(2)); m = list(calendar.month_abbr).index(mm.group(1)); obs.append({'m': f'{y}-{m:02d}', 'v': float(r[col]), 'avail': avail(y, m, 35)})
out['c30:datacenter'] = {'name': 'Census private construction: data centers', 'obs': sorted(obs, key=lambda o: o['m'])}
# NY Fed GSCPI (level in std devs → the model uses the YoY change in level)
try:
    wb = openpyxl.load_workbook(io.BytesIO(get('https://www.newyorkfed.org/medialibrary/research/interactives/gscpi/downloads/gscpi_data.xlsx')), read_only=True, data_only=True); obs = []
    for sh in wb.sheetnames:
        for r in wb[sh].iter_rows(values_only=True):
            if isinstance(r[0], datetime.datetime) and isinstance(r[1], (int, float)): obs.append({'m': r[0].strftime('%Y-%m'), 'v': float(r[1]), 'avail': avail(r[0].year, r[0].month, 5), 'level': True})
        if obs: break
    if obs: out['nyfed:gscpi'] = {'name': 'NY Fed Global Supply Chain Pressure Index', 'obs': obs, 'level': True}
except Exception as e: print('GSCPI skipped:', e)
# blockchain.info
for ch, name in [('hash-rate', 'Bitcoin network hash rate'), ('miners-revenue', 'Bitcoin miners revenue (USD)')]:
    j = json.loads(get(f'https://api.blockchain.info/charts/{ch}?timespan=all&format=json&sampled=false')); acc = {}
    for p in j['values']:
        d = datetime.datetime.utcfromtimestamp(p['x']); acc.setdefault((d.year, d.month), []).append(p['y'])
    out['btc:' + ch] = {'name': name, 'obs': [{'m': f'{y}-{m:02d}', 'v': sum(a) / len(a), 'avail': avail(y, m, 1)} for (y, m), a in sorted(acc.items()) if a]}
json.dump(out, open('.cache/graph/extra.json', 'w'))
for k, s in out.items(): print(k, len(s['obs']), s['obs'][0]['m'], '→', s['obs'][-1]['m'])
