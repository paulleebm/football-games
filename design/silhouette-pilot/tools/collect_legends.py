import json
import re
import html
import time
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse
import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SESSION = requests.Session()
SESSION.headers['User-Agent'] = 'FootballSilhouettePilot/1.0 (local research and attribution collection)'
sys.stdout.reconfigure(encoding='utf-8')
CACHED = {}
PLAYERS = [
    ('marcelo', '마르셀루', 'Marcelo', 'Marcelo (footballer, born 1988)', '넓고 둥근 곱슬머리 외곽선'),
    ('david-luiz', '다비드 루이스', 'David Luiz', 'David Luiz', '어깨까지 내려오는 풍성한 곱슬머리'),
    ('marouane-fellaini', '마루안 펠라이니', 'Marouane Fellaini', 'Marouane Fellaini', '크고 둥근 아프로 헤어'),
    ('ronaldinho', '호나우지뉴', 'Ronaldinho', 'Ronaldinho', '뒤로 넘긴 긴 머리와 두드러진 귀'),
    ('carles-puyol', '카를레스 푸욜', 'Carles Puyol', 'Carles Puyol', '목 아래까지 길게 내려오는 곱슬머리'),
    ('zlatan-ibrahimovic', '즐라탄 이브라히모비치', 'Zlatan Ibrahimović', 'Zlatan Ibrahimović', '뒤로 묶은 긴 머리와 각진 턱'),
    ('andrea-pirlo', '안드레아 피를로', 'Andrea Pirlo', 'Andrea Pirlo', '중간 길이의 가르마 머리와 수염'),
    ('carlos-valderrama', '카를로스 발데라마', 'Carlos Valderrama', 'Carlos Valderrama', '매우 크고 풍성한 아프로 헤어'),
]

def clean(value):
    return html.unescape(re.sub('<[^>]+>', '', value or '')).strip()

def get_json(url, params):
    response = SESSION.get(url, params=params, timeout=35)
    response.raise_for_status()
    return response.json()

def collect(player, file_title=None):
    slug, name_ko, name_en, title, reason = player
    if file_title is None:
        data = get_json('https://en.wikipedia.org/w/api.php', {'action':'query','titles':title,'prop':'pageimages','piprop':'original','format':'json'})
        page = next(iter(data['query']['pages'].values()))
        url = page['original']['source'].split('?')[0]
        file_title = 'File:' + unquote(urlparse(url).path.rsplit('/', 1)[1])
    if file_title.replace('_',' ') in CACHED:
        page = CACHED[file_title.replace('_',' ')]
    else:
        data = get_json('https://commons.wikimedia.org/w/api.php', {'action':'query','titles':file_title,'prop':'imageinfo','iiprop':'url|size|extmetadata','format':'json'})
        page = next(iter(data['query']['pages'].values()))
    info = page['imageinfo'][0]
    info['url'] = info['url'].split('?')[0]
    ext = info.get('extmetadata', {})
    suffix = Path(unquote(urlparse(info['url']).path)).suffix.lower()
    output = ROOT/'sources'/(slug+suffix)
    output.parent.mkdir(parents=True, exist_ok=True)
    downloaded_url=info['url']
    response = SESSION.get(downloaded_url, timeout=70)
    source_status='original_unmodified'
    if response.status_code == 429:
        time.sleep(3)
        parts=info['url'].split('/commons/')
        filename=parts[1].rsplit('/',1)[1]
        downloaded_url=parts[0].replace('upload.wikimedia.org','thumb.wikimedia.org')+'/commons/thumb/'+parts[1]+'/960px-'+filename
        response=SESSION.get(downloaded_url, timeout=70)
        source_status='commons_thumbnail_unmodified'
    response.raise_for_status()
    output.write_bytes(response.content)
    with Image.open(output) as img:
        img.verify()
    with Image.open(output) as img:
        width, height = img.size
    return {
        'id':slug, 'nameKo':name_ko, 'nameEn':name_en,
        'sourcePageUrl':info['descriptionurl'], 'sourceImageUrl':info['url'], 'downloadedImageUrl':downloaded_url,
        'author':clean(ext.get('Artist',{}).get('value','unverified')),
        'license':clean(ext.get('LicenseShortName',{}).get('value','unverified')),
        'licenseUrl':clean(ext.get('LicenseUrl',{}).get('value','unverified')),
        'date':clean(ext.get('DateTimeOriginal',{}).get('value','')),
        'selectionReason':reason,
        'sourceFile':str(output.relative_to(ROOT)).replace('\\','/'),
        'width':width, 'height':height,
        'commonsFileTitle':file_title,
        'sourceDescription':clean(ext.get('ImageDescription',{}).get('value','')),
        'downloadedAt':'2026-09-12',
        'sourceStatus':source_status,
        'qualityStatus':'pending_visual_review',
    }

if __name__ == '__main__':
    old_file=ROOT/'metadata'/'legends.json'
    records=json.loads(old_file.read_text(encoding='utf-8')) if old_file.exists() else []
    selected = {
        'marouane-fellaini': 'File:Fellaini 2017-03-09.jpg',
        'ronaldinho': 'File:Ronaldinho061115.jpg',
        'carles-puyol': 'File:Carles Puyol 2011.jpg',
        'andrea-pirlo': 'File:1 andrea pirlo 2014.jpg',
    }
    batch = get_json('https://commons.wikimedia.org/w/api.php', {'action':'query','titles':'|'.join(selected.values()),'prop':'imageinfo','iiprop':'url|size|extmetadata','format':'json'})
    CACHED = {page['title']:page for page in batch['query']['pages'].values()}
    for player in PLAYERS:
        if player[0] not in selected:
            continue
        try:
            record = collect(player, selected[player[0]])
            records = [entry for entry in records if entry['id'] != player[0]]
            records.append(record)
            print(json.dumps(record, ensure_ascii=True), flush=True)
        except Exception as exc:
            print(player[0], str(exc), flush=True)
        time.sleep(2)
    (ROOT/'metadata').mkdir(parents=True, exist_ok=True)
    (ROOT/'metadata'/'legends.json').write_text(json.dumps(records, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
