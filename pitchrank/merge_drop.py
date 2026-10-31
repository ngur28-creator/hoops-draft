"""One-off helper: merge a browser crawl drop (part A = matches, part H = history) into pitchrank/data."""
import json, sys, os

DATA = os.path.join(os.path.dirname(__file__), 'data')
meta = json.load(open(os.path.join(DATA, 'meta.json')))
matches = {}
for line in open(os.path.join(DATA, 'matches.ndjson')):
    if line.strip():
        m = json.loads(line)
        matches[m['id']] = m
hist_file = os.path.join(DATA, 'history.ndjson')
hist = {}
if os.path.exists(hist_file):
    for line in open(hist_file):
        if line.strip():
            h = json.loads(line)
            hist[(h['t'], h['s'])] = h

for path in sys.argv[1:]:
    d = json.load(open(path))
    if d.get('kind') == 'A':
        known = {c['id'] for c in meta['comps']}
        for c in d['comps']:
            if c['id'] not in known:
                meta['comps'].append(c)
        meta['teams'].update(d['teams'])
        for k, v in d['colors'].items():
            meta['colors'].setdefault(k, v)
        for k, v in d['players'].items():
            meta['players'].setdefault(k, v)
        added = 0
        for m in d['matches']:
            if m['rows'] is None:
                m['rows'] = []
            old = matches.get(m['id'])
            if old is None or (not old['rows'] and m['rows']):
                matches[m['id']] = m
                added += 1
        print(path, 'matches added/updated', added)
    elif d.get('kind') == 'H':
        meta['histFields'] = d['FK']
        for k, v in d.get('colors', {}).items():
            meta['colors'].setdefault(k, v)
        for h in d['hist']:
            hist[(h['t'], h['s'])] = h
        print(path, 'history seasons', len(d['hist']))

json.dump(meta, open(os.path.join(DATA, 'meta.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
with open(os.path.join(DATA, 'matches.ndjson'), 'w') as f:
    for m in sorted(matches.values(), key=lambda m: (m['ts'], m['id'])):
        f.write(json.dumps(m, ensure_ascii=False, separators=(',', ':')) + '\n')
with open(hist_file, 'w') as f:
    for h in sorted(hist.values(), key=lambda h: (h['t'], h['y'])):
        f.write(json.dumps(h, ensure_ascii=False, separators=(',', ':')) + '\n')
print('total matches', len(matches), 'history seasons', len(hist))
