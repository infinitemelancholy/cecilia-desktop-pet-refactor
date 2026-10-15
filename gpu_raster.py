"""Independent CPU reference for inspecting the GPU shader's pose/flow output."""
from collections import OrderedDict

import cv2
import numpy as np
from PIL import Image


class RasterReference:
    def __init__(self,root,manifest):
        self.root=root;self.manifest=manifest;self.cache=OrderedDict()

    def image(self,key):
        if key not in self.cache:
            with Image.open(self.root/self.manifest['assets'][key]) as image:
                self.cache[key]=image.convert('RGBA')
            while len(self.cache)>8:
                _,old=self.cache.popitem(last=False);old.close()
        self.cache.move_to_end(key)
        return self.cache[key]

    def crop(self,key,bounds,size):
        x,y,w,h=bounds
        return np.asarray(self.image(key).crop((x,y,x+w,y+h)).resize(size,Image.Resampling.BILINEAR),dtype=np.float32)/255

    def layer(self,layer):
        dx,dy,dw,dh=layer['target'];size=(round(dw),round(dh))
        motion=layer.get('motion')
        if not motion:
            result=self.crop(layer['asset'],layer['source'],size)
            result[:,:,:3]*=result[:,:,3:4]
        else:
            fields=[];ownership=[]
            for bounds in (motion['flowFirst'],motion['flowSecond']):
                upper=self.crop(motion['asset'],bounds,size)
                lower=list(bounds);lower[1]+=motion['gridHeight']
                bottom=self.crop(motion['asset'],lower,size)
                fields.append(np.dstack([upper[:,:,:3],bottom[:,:,0]]))
                ownership.append(bottom[:,:,1:2])
            mix=motion['anchorMix']
            field=((fields[0]*(1-mix)+fields[1]*mix)*255-128)*motion['range']/127
            xs,ys=np.meshgrid(np.arange(size[0],dtype='float32'),np.arange(size[1],dtype='float32'))
            warped=[]
            for bounds,offset in ((motion['first'],field[:,:,:2]),(motion['second'],field[:,:,2:])):
                image=self.crop(layer['asset'],bounds,size)
                image[:,:,:3]*=image[:,:,3:4]
                map_x=xs+offset[:,:,0]*size[0]/motion['poseSize'][0]
                map_y=ys+offset[:,:,1]*size[1]/motion['poseSize'][1]
                warped.append(cv2.remap(image,map_x,map_y,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT))
            result=warped[0] if motion['time']<motion.get('sourceSwitch',.5) else warped[1]
            if motion.get('visibility'):
                def ease(t):
                    t=np.clip(t,0,1);return t*t*(3-2*t)
                weight=ownership[0]*(1-mix)+ownership[1]*mix
                exponent=motion.get('ownershipExponent',1);wa=weight**exponent;wb=(1-weight)**exponent
                weight=wa/np.maximum(wa+wb,1e-6)
                weight=1+(weight-1)*ease(motion['time']/.04)
                weight*=1-ease((motion['time']-.96)/.04)
                result=warped[0]*weight+warped[1]*(1-weight)
        result[result[:,:,3]<.008]=0
        if motion and motion.get('groundLimit'):result[round(size[1]*motion['groundLimit']):]=0
        if layer.get('footCut'):result[round(size[1]*layer['footCut']):,round(size[0]*.39):round(size[0]*.64)]=0
        if layer.get('stableMaterial'):
            u,v=np.meshgrid((np.arange(size[0])+.5)/size[0],(np.arange(size[1])+.5)/size[1])
            def smooth(a,b,p):
                t=np.clip((p-a)/(b-a),0,1);return t*t*(3-2*t)
            arms=np.clip(smooth(.46,.49,v)*(1-smooth(.64,.70,v))*(1-smooth(.40,.44,u)+smooth(.56,.60,u)),0,1)[:,:,None]
            stable=self.crop(layer['asset'],layer['stableMaterial'],size);stable[:,:,:3]*=stable[:,:,3:4]
            result=stable*(1-arms)+result*arms
        if layer.get('guestMask'):
            neutral=self.crop(layer['asset'],layer['guestMask'],size)
            result[neutral[:,:,3]<.008]*=layer.get('guestOpacity',1)
        return result*(layer.get('opacity',1))

    def frame(self,frame,width=192):
        result=np.zeros((208,width,4),dtype=np.float32)
        for layer in frame['layers']:
            pixels=self.layer(layer);dx,dy,dw,dh=layer['target']
            matrix=np.float32([[1,0,dx],[0,1,dy]])
            positioned=cv2.warpAffine(pixels,matrix,(width,208),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
            result[:]=positioned+result*(1-positioned[:,:,3:4])
        return result

    def close(self):
        for image in self.cache.values():image.close()
        self.cache.clear()
