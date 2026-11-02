import json, re, html, time
from pathlib import Path
from urllib.parse import quote
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DATA = {p['id']:p['profile'] for p in json.loads((ROOT.parents[1]/'crawler/data/dataset.json').read_text(encoding='utf-8-sig'))}
FILES = {
 'haaland':('ManCity20240722-031 (cropped).jpg','뒤로 묶은 금발과 긴 머리 윤곽'),
 'salah':('Salah in 2018.jpg','풍성한 곱슬머리와 수염 윤곽'),
 'modric':('Luka Modric 2018.png','귀를 덮는 중장발과 가는 턱선'),
 'cucurella':('Marc Cucurella Argentina v Spain 19 July 2026-064 (cropped).jpg','양옆으로 크게 퍼지는 긴 곱슬머리'),
 'sane':('20180602 FIFA Friendly Match Austria vs. Germany Leroy Sané 850 0668.jpg','둥글고 높게 부푼 아프로 머리'),
 'ake':('Nathan Aké Fenerbahçe 20260717 (5) (cropped).jpg','굵은 레게 머리와 길게 내려오는 머리 윤곽'),
 'grealish':('ManCity20240722-017 (cropped).jpg','뒤로 넘긴 머리와 헤어밴드, 옆머리 대비'),
 'griezmann':('Antoine Griezmann (51100409504) (cropped).jpg','밴드로 넘긴 긴 머리와 뒤통수 볼륨'),
}
session=requests.Session()
session.headers['User-Agent']='FootballSilhouettePilot/1.0 (local Wikimedia asset research)'
(ROOT/'sources').mkdir(parents=True,exist_ok=True)
(ROOT/'metadata').mkdir(parents=True,exist_ok=True)
out=json.loads((ROOT/'metadata/current.json').read_text(encoding='utf-8')) if (ROOT/'metadata/current.json').exists() else []
for pid,(title,reason) in FILES.items():
 if any(x['id']==pid and x['sourceTitle']==title for x in out): continue
 try:
  page='https://commons.wikimedia.org/wiki/File:'+quote(title.replace(' ','_'))
  r=session.get(page,timeout=30); r.raise_for_status()
  soup=BeautifulSoup(r.text,'html.parser')
  orig=soup.select_one('.fullImageLink a') or soup.select_one('.fullMedia a.internal')
  imageurl=orig['href']
  if imageurl.startswith('//'): imageurl='https:'+imageurl
  def field(label):
   el=soup.find(id=label)
   if el:
    cell=el.find_parent('td') if el.name!='td' else el
    nxt=cell.find_next_sibling('td') if cell else None
    return nxt.get_text(' ',strip=True) if nxt else ''
   return ''
  licenseel=soup.select_one('.licensetpl_short')
  licenseurl=soup.select_one('.licensetpl_link')
  lic=licenseel.get_text(' ',strip=True) if licenseel else None
  licurl=licenseurl.get_text(' ',strip=True) if licenseurl else None
  if not licurl:
   a=soup.select_one('a[href*="creativecommons.org/licenses/"]')
   licurl=a.get('href') if a else None
  if licurl and licurl.startswith('//'): licurl='https:'+licurl
  ext=Path(title).suffix.lower()
  dest=ROOT/'sources'/f'{pid}{ext}'
  originalurl=imageurl
  img=session.get(imageurl.split('?')[0],timeout=50)
  if img.status_code==429:
   preview=soup.select_one('.fullImageLink img')
   if preview:
    imageurl=preview['src']
    if imageurl.startswith('//'): imageurl='https:'+imageurl
    img=session.get(imageurl,timeout=50)
  img.raise_for_status(); dest.write_bytes(img.content)
  from PIL import Image
  with Image.open(dest) as im: size=list(im.size)
  p=DATA[pid]
  item={'id':pid,'nameKo':p['nameKo'],'nameEn':p['nameEn'],'sourcePageUrl':page,'sourceImageUrl':imageurl,'sourcePath':dest.relative_to(ROOT).as_posix(),'author':field('fileinfotpl_aut'),'license':lic,'licenseUrl':licurl,'selectionReason':reason,'date':field('fileinfotpl_date'),'sourceTitle':title,'dimensions':size,'qualityNotes':'원본 다운로드 완료, 인물/머리카락 시각 검수 대기','reuseStatus':'license metadata captured; attribution and share-alike required if CC BY-SA','downloadedAt':'2026-09-12'}
  item['originalSourceImageUrl']=originalurl
  out=[x for x in out if x['id']!=pid]+[item]
  (ROOT/'metadata/current.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
  print(pid, size, lic, item['author'], flush=True)
 except Exception as e:
  print('ERROR',pid,str(e),flush=True)
 time.sleep(1)
