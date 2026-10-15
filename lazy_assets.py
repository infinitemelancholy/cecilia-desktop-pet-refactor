"""Serve requested, allowlisted local PNGs through the existing native binding."""
import base64,json
from collections import OrderedDict
import secrets
from urllib.parse import unquote
from pathlib import Path

BINDING='ceciliaReadPNG'
REQUEST_SCRIPT=r'''(()=>{
  window.__ceciliaAssetRequests?.stop();
  const pending=new Map();let serial=0;
  window.__ceciliaRequestAsset=id=>new Promise((resolve,reject)=>{
    const key=++serial,timer=setTimeout(()=>{
      pending.delete(key);reject(Error('Local PNG request timed out'));
    },4000);
    pending.set(key,{resolve,reject,timer});
    window.ceciliaReadPNG(JSON.stringify({key,id}));
  });
  window.__ceciliaDeliverAsset=(key,source,error)=>{
    const item=pending.get(key);if(!item)return;
    pending.delete(key);clearTimeout(item.timer);
    if(error)item.reject(Error(error));else item.resolve(source);
  };
  window.__ceciliaAssetRequests={stop(){
    for(const item of pending.values()){
      clearTimeout(item.timer);item.reject(Error('Animation asset source stopped'));
    }
    pending.clear();delete window.__ceciliaRequestAsset;delete window.__ceciliaDeliverAsset;
    delete window.__ceciliaAssetRequests;
  }};
  return true;
})()'''

class LocalAssets:
    def __init__(self,root,manifest):
        root=Path(root).resolve();self.paths={};self.requests=0;self.bytes_served=0
        self.cache=OrderedDict();self.cache_limit=32*1024*1024
        self.cache_bytes=0;self.cache_hits=0;self.disk_reads=0
        self.token=secrets.token_urlsafe(24)
        self.base_url='https://cecilia.invalid/local-png/'+self.token+'/'
        for name,relative in manifest['assets'].items():
            path=(root/relative).resolve()
            if not path.is_relative_to(root):raise ValueError('Asset path is outside the bundle')
            self.paths[name]=path
    def request(self,name):
        if name not in self.paths:raise ValueError('PNG is not listed in this animation manifest')
        path=self.paths[name];stat=path.stat();signature=(stat.st_mtime_ns,stat.st_size)
        cached=self.cache.get(name)
        if cached and cached[0]==signature:
            self.cache.move_to_end(name);self.cache_hits+=1
            source=cached[1]
        else:
            if cached:self.cache_bytes-=len(self.cache.pop(name)[1])
            raw=path.read_bytes();self.disk_reads+=1
            png=raw.startswith(b'\x89PNG\r\n\x1a\n')
            webp=raw.startswith(b'RIFF') and raw[8:12]==b'WEBP'
            if not png and not webp:raise ValueError('Unreadable local animation image')
            mime='image/png' if png else 'image/webp'
            source='data:'+mime+';base64,'+base64.b64encode(raw).decode('ascii')
            if len(source)<=self.cache_limit:
                self.cache[name]=(signature,source);self.cache_bytes+=len(source)
            while self.cache_bytes>self.cache_limit:
                _,old=self.cache.popitem(last=False);self.cache_bytes-=len(old[1])
        self.requests+=1;self.bytes_served+=stat.st_size
        return source

    def image_response(self,url):
        name=unquote(url[len(self.base_url):]) if url.startswith(self.base_url) else None
        if name not in self.paths:return {'responseCode':404,'body':''}
        try:
            source=self.request(name)
            return {'responseCode':200,'responseHeaders':[
                {'name':'Content-Type','value':source.split(';',1)[0][5:]},
                {'name':'Access-Control-Allow-Origin','value':'*'},
                {'name':'Cache-Control','value':'private,max-age=3600'}],
                'body':source.split(',',1)[1]}
        except (OSError,ValueError):return {'responseCode':500,'body':''}

    def close(self):self.cache.clear();self.cache_bytes=0

    def install(self,transport):
        if hasattr(transport,'intercept_images'):
            transport.intercept_images(self.base_url,self.image_response)
            transport.evaluate('window.__ceciliaAssetBaseURL='+json.dumps(self.base_url)+';'
                'window.__ceciliaAssetRequests={stop(){delete window.__ceciliaRequestAsset;delete window.__ceciliaAssetBaseURL;}};'
                'window.__ceciliaRequestAsset=id=>Promise.resolve(window.__ceciliaAssetBaseURL+id);true;')
            return
        def receive(payload):
            key=None;source=None;error=None
            try:
                request=json.loads(payload);key=request['key']
                if type(key)!=int or key<=0 or not isinstance(request['id'],str):raise ValueError('Invalid asset request')
                source=self.request(request['id'])
            except (OSError,ValueError,KeyError,TypeError) as failure:error=str(failure)
            transport.evaluate('window.__ceciliaDeliverAsset?.('+json.dumps(key)+','+json.dumps(source)+','+json.dumps(error)+');true;')
        transport.bind(BINDING,receive)
        transport.evaluate(REQUEST_SCRIPT)
