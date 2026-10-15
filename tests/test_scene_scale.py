import json, unittest
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]

def visible(layer,m):
    x,y,w,h=layer['source'];dx,dy,dw,dh=layer['target']
    with Image.open(ROOT/m['assets'][layer['asset']]) as im:
        a=np.asarray(im.crop((x,y,x+w,y+h)))[:,:,3]>180
    yy,xx=np.where(a)
    scale=layer.get('matrix',[1,0,0,1,0,0])[0]
    return (xx.max()-xx.min()+1)*dw/w*scale,(yy.max()-yy.min()+1)*dh/h*scale

class SceneScale(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.m=json.loads((ROOT/'manifest.json').read_text('utf8'))
    def test_standing_owner_does_not_grow_between_solo_and_chat(self):
        for outfit,data in self.m['outfits'].items():
            for name in ('idle','lawrence-care','hazelita-chat','hazelita-showcase'):
                clip=data['clips'][name];layer=clip['frames'][len(clip['frames'])//2]['layers'][0]
                with self.subTest(outfit=outfit,scene=name):
                    self.assertAlmostEqual(visible(layer,self.m)[1],189,delta=3)
    def test_partners_use_requested_relative_height_on_the_shared_ground(self):
        for outfit,data in self.m['outfits'].items():
            for name,expected in [('lawrence-care',198),('hazelita-chat',189),('hazelita-showcase',189)]:
                clip=data['clips'][name];layer=next(l for l in clip['frames'][len(clip['frames'])//2]['layers'] if l.get('actor')==name.split('-')[0])
                with self.subTest(outfit=outfit,scene=name):
                    self.assertAlmostEqual(visible(layer,self.m)[1],expected,delta=3)
    def test_standing_interactions_do_not_inflate_the_owners_lower_hair_and_body(self):
        def hair_width(layer):
            x,y,w,h=layer['source']
            with Image.open(ROOT/self.m['assets'][layer['asset']]) as im:a=np.asarray(im.crop((x,y,x+w,y+h)))
            r,g,b=a[:,:,:3].astype(int).transpose(2,0,1)
            mask=(a[:,:,3]>180)&(g>r-4)&(g>b+18)&(g>140)
            yy,xx=np.where(mask)
            return (xx.max()-xx.min()+1)*layer['target'][2]/w*layer.get('matrix',[1,0,0,1,0,0])[0]
        for outfit,data in self.m['outfits'].items():
            neutral=hair_width(data['clips']['idle']['frames'][0]['layers'][0])
            for name in ('lawrence-care','hazelita-chat','hazelita-showcase','lawrence-sleeve'):
                clip=data['clips'][name];layer=clip['frames'][len(clip['frames'])//2]['layers'][0]
                with self.subTest(outfit=outfit,scene=name):
                    self.assertLessEqual(hair_width(layer),neutral*1.1+1)

if __name__=='__main__':unittest.main()
