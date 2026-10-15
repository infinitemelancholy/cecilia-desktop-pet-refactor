"""Compile small flow atlases; registered high-resolution poses remain intact."""
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def encode_flow(field):
    span=max(1.,float(np.abs(field).max())+.01)
    pixels=np.clip(np.round(field/span*127+128),1,255).astype('uint8')
    return Image.fromarray(pixels,'RGBA'),span


def pack_flow_field(field,span):
    encoded=np.clip(np.round(field/span*127+128),1,255).astype('uint8')
    height,width=field.shape[:2]
    pixels=np.full((height*2,width,4),255,dtype='uint8')
    pixels[:height,:,:3]=encoded[:,:,:3]
    pixels[height:,:,0]=encoded[:,:,3]
    pixels[height:,:,1:3]=128
    return Image.fromarray(pixels,'RGBA')


def flow_atlas(first,second):
    from smooth_motion import engine
    torch,model,_=engine()
    import torch.nn.functional as F
    width,height=first.size
    grid_width=128 if width<1000 else 256
    grid_height=144
    def tensor(image):
        rgba=np.asarray(image,dtype=np.float32)/255
        rgba[:,:,:3]=rgba[:,:,:3]*rgba[:,:,3:4]+.5*(1-rgba[:,:,3:4])
        value=torch.from_numpy(rgba[:,:,:3].transpose(2,0,1)).unsqueeze(0).cuda()
        return F.pad(value,(0,(-width)%64,0,(-height)%64))
    a,b=tensor(first),tensor(second)
    fields=[]
    identical=first.tobytes()==second.tobytes()
    with torch.inference_mode():
        for moment in np.linspace(0,1,9):
            if identical:field=np.zeros((grid_height,grid_width,4),dtype=np.float32)
            else:
                flows,_,_=model(torch.cat((a,b),1),timestep=float(moment),scale_list=[4,2,1,.5,.25])
                flow=flows[-1].clone()[:,:,:height,:width]
                if moment==0:flow[:,:2]=0
                elif moment==1:flow[:,2:4]=0
                value=flow[0].permute(1,2,0).cpu().numpy()
                field=cv2.resize(value,(grid_width,grid_height),interpolation=cv2.INTER_AREA)
            fields.append(field)
    span=max(1.,max(float(np.abs(field).max()) for field in fields)+.01)
    sheet=Image.new('RGBA',(grid_width*9,grid_height*2))
    for index,field in enumerate(fields):
        image=pack_flow_field(field,span);sheet.paste(image,(index*grid_width,0));image.close()
    return sheet,span,[grid_width,grid_height]


def compile_actor(poses,durations,loop,root,prefix,assets):
    root=Path(root);folder=root/'art/runtime/gpu120-v1';folder.mkdir(parents=True,exist_ok=True)
    width,height=poses[0].size
    pose_key=prefix+'_poses';relative=f'art/runtime/gpu120-v1/{pose_key}.png'
    atlas=Image.new('RGBA',(width*len(poses),height))
    for index,image in enumerate(poses):atlas.paste(image,(index*width,0))
    atlas.save(root/relative,compress_level=6);atlas.close();assets[pose_key]=relative
    segments=[]
    for index,pose in enumerate(poses):
        next_index=(index+1)%len(poses) if loop else min(index+1,len(poses)-1)
        sheet,span,grid=flow_atlas(pose,poses[next_index])
        key=f'{prefix}_flow_{index:02d}';relative=f'art/runtime/gpu120-v1/{key}.png'
        sheet.save(root/relative,compress_level=6);sheet.close();assets[key]=relative
        segments.append({'poseAsset':pose_key,'flowAsset':key,'range':span,'grid':grid,
                         'first':[index*width,0,width,height],
                         'second':[next_index*width,0,width,height],
                         'duration':float(durations[index]),'hold':index==next_index})
    return segments


def actor_layer(segments,time_ms,target):
    elapsed=time_ms;segment=segments[-1]
    for candidate in segments:
        segment=candidate
        if elapsed<candidate['duration']:break
        elapsed-=candidate['duration']
    t=max(0,min(1,elapsed/segment['duration']))
    # Smooth easing preserves starts and endpoints without changing duration.
    t=t*t*(3-2*t)
    position=t*8;left=min(7,int(math.floor(position)));weight=position-left
    width,height=segment['grid']
    first=segment['first'];second=segment['second']
    return {'asset':segment['poseAsset'],'source':first if t<.5 else second,
      'target':list(target),'motion':{'asset':segment['flowAsset'],
        'first':first,'second':second,'poseSize':first[2:],
        'flowFirst':[left*width,0,width,height],
        'flowSecond':[(left+1)*width,0,width,height],
        'anchorMix':weight,'time':t,'range':segment['range'],'gridHeight':height}}
