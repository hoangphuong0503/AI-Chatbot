"""Merge non-secret defaults; preserve all existing keys and secrets without printing values."""
from pathlib import Path
import re

root=Path(__file__).resolve().parents[1]
path=root/'.env'
text=path.read_text(encoding='utf-8') if path.exists() else ''
defaults={}
for line in (root/'.env.example').read_text(encoding='utf-8').splitlines():
    if re.match(r'^[A-Z_]+=',line):
        name,value=line.split('=',1)
        defaults[name]=value
existing=set(re.findall(r'^([A-Z_]+)=',text,re.M))
for name,value in defaults.items():
    if name not in existing:
        text=text.rstrip('\n')+'\n'+name+'='+value+'\n'
# Exact endpoint/model requested by the user; never copy credentials between providers.
for name,value in {'CHAT_API_BASE_URL':'https://discovery-api.intern-ai.org.cn/v1','CHAT_MODEL':'deepseek-v4-flash-0731'}.items():
    text=re.sub(r'^'+name+r'=.*$',name+'='+value,text,flags=re.M)
path.write_text(text,encoding='utf-8')
print('Backend configuration defaults merged. Existing secret values preserved. No secrets printed.')
