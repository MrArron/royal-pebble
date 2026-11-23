# Generates android/app/src/main/res/drawable/ic_launcher_foreground.xml from the C3b art
# (tools/store/icon_c.js geometry). Run from android/app/src/main/res: python3 ../../../../../tools/store/gen_launcher_icon.py
import sys
S=1.1
def X(x): return round(54+(x-50)*S,2)
def Y(y): return round(57+(y-52)*S,2)
def rect(x,y,w,h,c): return f'    <path android:fillColor="{c}" android:pathData="M{X(x)},{Y(y)}h{round(w*S,2)}v{round(h*S,2)}h{-round(w*S,2)}z"/>'
def poly(pts,c):
    d="M"+" L".join(f"{X(x)},{Y(y)}" for x,y in pts)+"z"
    return f'    <path android:fillColor="{c}" android:pathData="{d}"/>'
def circle(cx,cy,r,c):
    R=round(r*S,2); x=X(cx); y=Y(cy)
    return f'    <path android:fillColor="{c}" android:pathData="M{x-R},{y}a{R},{R} 0 1,0 {2*R},0a{R},{R} 0 1,0 {-2*R},0z"/>'
def wave(y,amp,w,phase,c,a=1.0):
    ws=round(w*S,2); am=round(amp*S,2)
    x=-ws+ (phase*S%ws)
    d=f"M{round(x,2)},{Y(y)}"
    while x<108+ws:
        d+=f" q{round(ws/4,2)},{-am} {round(ws/2,2)},0 t{round(ws/2,2)},0"; x+=ws
    d+=" V108 H-20 Z"
    col=c if a==1.0 else c.replace('#','#%02X'%round(a*255))
    return f'    <path android:fillColor="{col}" android:pathData="{d}"/>'
hull="#EEF3F9"
out=[]
out.append(circle(59,30,3.6,"#FA4A36"))
out.append(poly([(45.5,33),(54.5,33),(53.7,41),(46.3,41)],"#F2B705"))
out.append(rect(45.5,35,9,1.4,"#0B3D91"))
out.append(rect(33,41,34,3.6,"#FFFFFF"))
out.append(rect(35,42.1,30,1.3,"#0B3D91"))
out.append(rect(37,44.6,26,8,hull))
for y in (46.5,49.8):
    for x in (39.5,43,46.5,50,53.5,57,60.5): out.append(rect(x-0.8,y,1.6,1.6,"#0B3D91"))
out.append(wave(62,2.2,11,-4,"#4FC3F7",0.55))
out.append(f'    <path android:fillColor="{hull}" android:pathData="M{X(35.5)},{Y(52.6)} H{X(64.5)} Q{X(62.5)},{Y(61)} {X(52)},{Y(67.5)} H{X(48)} Q{X(37.5)},{Y(61)} {X(35.5)},{Y(52.6)}z"/>')
out.append(rect(36,53.6,28,1.1,"#0B3D91"))
out.append(wave(66,2.4,12,-9,"#4FC3F7",0.9))
out.append(wave(72,2.2,13,-2,"#1E88E5"))
fg='''<?xml version="1.0" encoding="utf-8"?>
<!-- Royal Pebble launcher icon, foreground (C3b: the ship bow-on over layered waves,
     the sun in the Pebble logo's coral). Generated from tools/store/icon_c.js' C3b
     geometry, scaled into the adaptive icon's 66dp safe zone. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
'''+"\n".join(out)+"\n</vector>\n"
open("drawable/ic_launcher_foreground.xml","w").write(fg)
