# openvg_simple_canvas
This is simple canvas implementation which is based on [node-openvg-canvas](https://github.com/luismreis/node-openvg-canvas).  
It is simplified version compared to original one, due to some limitations of ShivaVG implementation. No shadow, no clipping, etc ...  Modern browser support multiple instances of canvas in a single page.  
I plan to rewrite the whole code to support multiple canvas with new architecture near soon.

## Installation

```javascript
npm install napi_sdl2
npm install napi_openvg
npm install openvg_ttf
npm install openvg_simple_canvas
```

## Usage

Attach canvas to SDL window :
```javascript
canvas = new Canvas(screen_width, screen_height);
let ctx = canvas.getContext("2d");
ctx.window = sdl_window;
canvas.ctx = ctx;
```
Draw rect:
```javascript
ctx.fillStyle = "green";
ctx.fillRect(400,400, 150, 75);
ctx.strokeStyle = "#0000FF";
ctx.strokeRect(300,300, 150, 75);
```

Fill rect with gradient:
```javascript
let grd = ctx.createRadialGradient(75,50,5,90,60,100);

grd.addColorStop(0,"red");
grd.addColorStop(1,"white");

ctx.fillStyle = grd;
ctx.fillRect(10,10,150,80);
```
Draw image:
```javascript
let img = new Image();
img.src = 'data/a.jpg';
ctx.drawImage(img, 10, 320); 
```

Draw text string:
```javascript
ctx.font = "24px sans-serif";	
ctx.fillStyle = "black";
ctx.strokeStyle = 'black';
ctx.fillText('Test 123', 100, 100);
```
