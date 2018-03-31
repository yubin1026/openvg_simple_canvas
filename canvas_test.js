'use strict';

const util = require("util");
const fs = require('fs');

const SDL2 = require('napi_sdl2');
const VG = require('napi_openvg');
const Canvas = require('openvg_simple_canvas');
const Image = Canvas.Image;

let reflow_flag = true;
let canvas;

function draw_scene(ctx)
{
	if(!reflow_flag) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

	ctx.fillStyle = "green";
	ctx.fillRect(400,400, 150, 75);
	ctx.strokeStyle = "#0000FF";
	ctx.strokeRect(300,300, 150, 75);

	ctx.strokeStyle = "#000000";
	ctx.moveTo(100,100);
	ctx.lineTo(200, 200);
	ctx.stroke();


	ctx.beginPath();
	ctx.arc(200,200,40,0,2*Math.PI);
	ctx.stroke();
	
	let grd = ctx.createRadialGradient(75,50,5,90,60,100);

	grd.addColorStop(0,"red");
	grd.addColorStop(1,"white");

	// Fill with gradient
	ctx.fillStyle = grd;
	ctx.fillRect(10,10,150,80);
	
	let img = new Image();
	img.src = 'data/a.jpg';
	ctx.drawImage(img, 10, 320); 
	
	
	ctx.font = "24px sans-serif";	
	ctx.fillStyle = "black";
	ctx.strokeStyle = 'black';
	ctx.fillText('Test 123', 100, 100);
	
	VG.vgFlush();
	SDL2.SDL_GL_SwapWindow( ctx.window );
	reflow_flag = false;
}

function main()
{
	SDL2.SDL_Init(SDL2.SDL_INIT_EVERYTHING);
	SDL2.SDL_GL_SetAttribute(SDL2.SDL_GL_CONTEXT_FLAGS, SDL2.SDL_GL_CONTEXT_FORWARD_COMPATIBLE_FLAG);
	SDL2.SDL_GL_SetAttribute(SDL2.SDL_GL_DOUBLEBUFFER, 1);
	SDL2.SDL_GL_SetAttribute(SDL2.SDL_GL_MULTISAMPLEBUFFERS, 8);
	SDL2.SDL_GL_SetAttribute(SDL2.SDL_GL_MULTISAMPLESAMPLES, 8);
	SDL2.SDL_GL_SetAttribute(SDL2.SDL_GL_DEPTH_SIZE, 24);
	SDL2.SDL_GL_SetAttribute(SDL2.SDL_GL_STENCIL_SIZE, 8);
	SDL2.SDL_GL_SetAttribute(SDL2.SDL_GL_CONTEXT_MAJOR_VERSION, 2);
	SDL2.SDL_GL_SetAttribute(SDL2.SDL_GL_CONTEXT_MINOR_VERSION, 1);

	let [screen_width, screen_height] = [800, 800];

	let sdl_window = SDL2.SDL_CreateWindow("Canvas Test", 
		0, 0, screen_width, screen_height, SDL2.SDL_WINDOW_OPENGL | SDL2.SDL_WINDOW_SHOWN | SDL2.SDL_WINDOW_RESIZABLE);
	let sdl_context = SDL2.SDL_GL_CreateContext( sdl_window );
	SDL2.SDL_GL_SetSwapInterval(1);
	 
	let quit = false;
	VG.vgCreateContextSH(screen_width, screen_height);

	canvas = new Canvas(screen_width, screen_height);
	let ctx = canvas.getContext("2d");
	ctx.window = sdl_window;
	canvas.ctx = ctx;

	draw_scene(ctx);
			
	while(!quit)
	{
		let event = {};
		let remaining_time = 0.01;
		SDL2.SDL_PumpEvents();
		while(1) {
			let ret = SDL2.SDL_PeepEvents(event, 1, SDL2.SDL_GETEVENT, SDL2.SDL_FIRSTEVENT, SDL2.SDL_LASTEVENT);
			if(ret == 1) break;
			SDL2.SDL_Delay(10);
			//draw_scene(ctx);
			SDL2.SDL_PumpEvents();
		}

		switch(event.type)
		{
			case "MOUSEBUTTONDOWN":
				break;
			case "MOUSEBUTTONUP":
				break;
			case "MOUSEWHEEL":
				break;
			case "WINDOWEVENT":
				if(event.event == "WINDOWEVENT_RESIZED") {
					[screen_width, screen_height] = SDL2.SDL_GetWindowSize(ctx.window);

					VG.vgResizeSurfaceSH(screen_width, screen_height);
					canvas.width = screen_width;
					canvas.height = screen_height;

					reflow_flag = true;
					draw_scene(ctx);
				} else if(event.event == "WINDOWEVENT_SIZE_CHANGED") {
		
				} else if(event.event == "WINDOWEVENT_EXPOSED") {
				}
				break;
			case "KEYDOWN":
				break;
			case "QUIT":
				quit = true;
				break;
		}
	}
	SDL2.SDL_DestroyWindow(ctx.window);
	VG.vgDestroyContextSH();
	SDL2.SDL_Quit();
}

main();
