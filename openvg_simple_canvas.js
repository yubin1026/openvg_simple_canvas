"use strict";

const util = require('util');
const fs = require('fs');
const VG = require('napi_openvg');
const Font = require('openvg_ttf');
const STB_Image = require('napi_stb_image');

module.exports = Canvas;
module.exports.Image = Image;

function Canvas(width, height) {
  this.width = width;
  this.height = height;

  let context2d = createCanvasRenderingContext2D(this);
  this.getContext = function (contextId, args) {
    if (contextId === '2d') {
      return context2d;
    } else {
      return null;
    }
  };
}

function Image (path) {
  this.width = 0;
  this.height = 0;
  this.handle = undefined;

  function setSource(path) {
    if(path == null) {
      if(this.handle) {
        VG.vgDestroyImage(this.handle);
      }
      return;
    }

    let stat = fs.statSync(path);
    let handle = fs.openSync(path, 'r');
    let buf = new Buffer(stat.size);
    let read = fs.readSync(handle, buf, 0, stat.size, null); 
    fs.closeSync(handle);

    let imgData = STB_Image.stbi_load_from_memory(buf);

    this.width = imgData.width;
    this.height = imgData.height;

    this.handle = VG.vgCreateImage( VG.VG_lABGR_8888, this.width, this.height, VG.VG_IMAGE_QUALITY_BETTER);
    VG.vgImageSubData(this.handle, imgData.buffer, this.width * 4, VG.VG_lABGR_8888, 0, 0, this.width, this.height);
    buf = null;
    imgData = null;
  }
  Object.defineProperty(this, 'src', { enumerable: false, set: setSource });
}

function drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh, paintFn) {
  let mm = VG.vgGetMatrix();
  let savMatrixMode = VG.vgGeti(VG.VG_MATRIX_MODE);
  VG.vgSeti(VG.VG_MATRIX_MODE, VG.VG_MATRIX_IMAGE_USER_TO_SURFACE);

  VG.vgLoadMatrix(mm);
  VG.vgTranslate(dx, dy);
  VG.vgScale(dw / sw, dh / sh);

  VG.vgSeti(VG.VG_IMAGE_MODE, VG.VG_DRAW_IMAGE_NORMAL);

  if (sx === 0 && sy === 0 && sw === img.width && sh === img.height) {
    paintFn(img.handle);

  } else {
    let handle = VG.vgCreateImage(VG.VG_lRGBA_8888, sw, sh, VG.VG_IMAGE_QUALITY_BETTER);

    VG.vgCopyImage(handle, 0, 0, img.handle, sx, sy, sw, sh, true);
    paintFn(handle);
    VG.vgDestroyImage(handle);
  }

  VG.vgSeti(VG.VG_MATRIX_MODE, savMatrixMode);
  VG.vgLoadMatrix(mm);
}

const MAX_STOPS_ESTIMATE = 10;
const EXCESS_FACTOR = 2;

let colorBuffer = [];
let defaultStopArray = [0, 0, 0, 0, 0,  1, 1, 1, 1, 1];
let parameterArray = [];
let stopArray = [];

function Gradient (type, parameters) {
  this.type = type;
  this.parameters = parameters;
  this.stopCount = 0;
  this.stops = null;
};

Gradient.prototype.addColorStop = function (stop, baseColor) {
  color.parseColor(colorBuffer, baseColor);
  this.stops = {
    next : this.stops,
    stop : stop,
    r : colorBuffer[0],
    g : colorBuffer[1],
    b : colorBuffer[2],
    a : colorBuffer[3]
  };

  this.stopCount++;
};

Gradient.prototype.stopArray = function (alpha) {
  if (this.stopCount === 0) {
    defaultStopArray[9] = alpha;
    return defaultStopArray;
  }

  let i = this.stopCount * 5;
  let stop = this.stops;
  do {
    stopArray[--i] = stop.a * alpha;
    stopArray[--i] = stop.b;
    stopArray[--i] = stop.g;
    stopArray[--i] = stop.r;
    stopArray[--i] = stop.stop;
    stop = stop.next;
  } while (i > 0);

  return stopArray;
};

Gradient.prototype.parameterArray = function () {
  for (let i = 0; i < this.parameters.length; i++) {
    parameterArray[i] = this.parameters[i];
  }
  return parameterArray;
};

Gradient.prototype.configurePaint = function (paint, alpha) {
  let paintType, paintParam;

  if ('linearGradient' === this.type) {
    paintType  = VG.VG_PAINT_TYPE_LINEAR_GRADIENT;
    paintParam = VG.VG_PAINT_LINEAR_GRADIENT;
  } else {
    paintType  = VG.VG_PAINT_TYPE_RADIAL_GRADIENT;
    paintParam = VG.VG_PAINT_RADIAL_GRADIENT;
  }

  VG.vgSetParameteri(paint, VG.VG_PAINT_TYPE, paintType);
  VG.vgSetParameterfv(paint, paintParam, this.parameters.length, this.parameterArray());

  VG.vgSetParameteri(paint, VG.VG_PAINT_COLOR_RAMP_SPREAD_MODE, VG.VG_COLOR_RAMP_SPREAD_PAD);
  VG.vgSetParameteri(paint, VG.VG_PAINT_COLOR_RAMP_PREMULTIPLIED,  0);
  VG.vgSetParameterfv(paint, VG.VG_PAINT_COLOR_RAMP_STOPS, this.stopCount * 5, this.stopArray(alpha));
};


function Path() {
  this.vgPath = VG.vgCreatePath(VG.VG_PATH_FORMAT_STANDARD, VG.VG_PATH_DATATYPE_F, 1.0, 0.0, 0, 0, VG.VG_PATH_CAPABILITY_ALL);

  this.rendered    = false;
  this.openSubpath = false;

  this.segments    = []; 
  this.segmentsPos = 0;
  this.data        = [];
  this.dataPos     = 0;
  this.sx          = 0; 
  this.sy          = 0;
  this.x           = 0; 
  this.y           = 0;
}

Path.prototype.destroy = function () {
  VG.vgDestroyPath(this.vgPath);
};

Path.prototype.beginPath = function () {
  if (this.rendered) {
    VG.vgClearPath(this.vgPath, VG.VG_PATH_CAPABILITY_ALL);
    this.rendered = false;
  }
  this.segmentsPos = 0;
  this.dataPos = 0;
  this.sx = 0;
  this.sy = 0;
  this.x = 0;
  this.y = 0;
  this.openSubpath = false;
};

Path.prototype.renderPath = function () {
  if (this.segmentsPos === 0) return;
  VG.vgAppendPathData(this.vgPath, this.segmentsPos, this.segments, this.data);

  this.rendered = true;
  this.segmentsPos = 0;
  this.dataPos = 0;
  this.sx = 0;
  this.sy = 0;
  this.x = 0;
  this.y = 0;
  this.openSubpath = false;
};

Path.prototype.addVGPath = function (vgPath, transform) {
  let currentMatrix = [];
  this.renderPath();

  currentMatrix = VG.vgGetMatrix();
  VG.vgLoadMatrix(transform.m);
  VG.vgTransformPath(this.vgPath, vgPath);
  VG.vgLoadMatrix(currentMatrix);
};

Path.prototype.addPath = function (path, transform) {
  path.renderPath();
  this.addVGPath(path.vgPath, transform);
};

Path.prototype.fill = function () {
  this.renderPath();
  VG.vgDrawPath(this.vgPath, VG.VG_FILL_PATH);
};

Path.prototype.stroke = function () {
  this.renderPath();
  VG.vgDrawPath(this.vgPath, VG.VG_STROKE_PATH);
};

Path.prototype.closePath = function () {
  this.segments[this.segmentsPos++] = VG.VG_CLOSE_PATH;
  this.x = this.sx;
  this.y = this.sy;
  this.openSubpath = false;
};

Path.prototype.moveTo = function (x, y) {
  this.segments[this.segmentsPos++] = VG.VG_MOVE_TO;
  this.data[this.dataPos++] = x;
  this.data[this.dataPos++] = y;
  this.x = this.sx = x;
  this.y = this.sy = y;
  this.openSubpath = true;
};

Path.prototype.lineTo = function (x, y) {
  this.segments[this.segmentsPos++] = VG.VG_LINE_TO;
  this.data[this.dataPos++] = x;
  this.data[this.dataPos++] = y;
  this.x = x;
  this.y = y;
  this.openSubpath = true;
};

Path.prototype.quadraticCurveTo = function (cpx, cpy, x, y) {
  this.segments[this.segmentsPos++] = VG.VG_QUAD_TO;
  this.data[this.dataPos++] = cpx;
  this.data[this.dataPos++] = cpy;
  this.data[this.dataPos++] = x;
  this.data[this.dataPos++] = y;
  this.x = x;
  this.y = y;
  this.openSubpath = true;
};

Path.prototype.bezierCurveTo = function (cp1x, cp1y, cp2x, cp2y, x, y) {
  this.segments[this.segmentsPos++] = VG.VG_CUBIC_TO;
  this.data[this.dataPos++] = cp1x;
  this.data[this.dataPos++] = cp1y;
  this.data[this.dataPos++] = cp2x;
  this.data[this.dataPos++] = cp2y;
  this.data[this.dataPos++] = x;
  this.data[this.dataPos++] = y;
  this.x = x;
  this.y = y;
  this.openSubpath = true;
};

Path.prototype.arcTo = function (x1, y1, x2, y2, radiusX, radiusY, rotation) {
  if (radiusY === undefined) {
    radiusY = radiusX;
    rotation = 0;
  }

  let scaleX = radiusY / radiusX;
  let cosRotation = Math.cos(-rotation);
  let sinRotation = Math.sin(-rotation);
  function transform(px, py) {
    return {
      x: (px * cosRotation - py * sinRotation) * scaleX,
      y: px * sinRotation + py * cosRotation
    };
  }
  function reverseTransform(px, py) {
    return {
      x:  px * cosRotation / scaleX + py * sinRotation,
      y: -px * sinRotation / scaleX + py * cosRotation
    };
  }

  let p0 = transform(this.x, this.y);
  let p1 = transform(x1, y1);
  let p2 = transform(x2, y2);

  let v1 = { x: p1.x - p0.x, y: p1.y - p0.y };
  let v2 = { x: p2.x - p1.x, y: p2.y - p1.y };
  let modV1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
  let modV2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

  v1.x = v1.x / modV1;
  v1.y = v1.y / modV1;
  v2.x = v2.x / modV2;
  v2.y = v2.y / modV2;

  let dotProduct = v1.x * v2.x + v1.y * v2.y;
  let crossProduct = v1.x * v2.y - v1.y * v2.x;

  if (crossProduct === 0) {
    return;
  }

  let sign = crossProduct > 0 ? 1 : -1;
  let cosAlpha = dotProduct;
  let sinAlpha = Math.sqrt(1 - cosAlpha * cosAlpha);

  let t = radiusY * sinAlpha / (1 + cosAlpha);
  let pstart = reverseTransform(p1.x - t * v1.x, p1.y - t * v1.y);
  let pend   = reverseTransform(p1.x + t * v2.x, p1.y + t * v2.y);

  this.segments[this.segmentsPos++] = this.openSubpath ? VG.VG_LINE_TO_ABS : VG.VG_MOVE_TO_ABS;
  this.data[this.dataPos++] = pstart.x;
  this.data[this.dataPos++] = pstart.y;

  this.segments[this.segmentsPos++] = sign < 0 ? VG.VG_SCWARC_TO_ABS : VG.VG_SCCWARC_TO_ABS;
  this.data[this.dataPos++] = radiusX;
  this.data[this.dataPos++] = radiusY;
  this.data[this.dataPos++] = rotation * 180 / Math.PI;
  this.data[this.dataPos++] = pend.x;
  this.data[this.dataPos++] = pend.y;

  this.x = pend.x;
  this.y = pend.y;
  this.openSubpath = true;
};

Path.prototype.rect = function (x, y, w, h) {
  this.segments[this.segmentsPos++] = VG.VG_MOVE_TO_ABS;
  this.data[this.dataPos++] = x;
  this.data[this.dataPos++] = y;
  this.segments[this.segmentsPos++] = VG.VG_HLINE_TO_REL;
  this.data[this.dataPos++] = w;
  this.segments[this.segmentsPos++] = VG.VG_VLINE_TO_REL;
  this.data[this.dataPos++] = h;
  this.segments[this.segmentsPos++] = VG.VG_HLINE_TO_REL;
  this.data[this.dataPos++] = -w;
  this.segments[this.segmentsPos++] = VG.VG_CLOSE_PATH;
  this.x = this.sx = x;
  this.y = this.sy = y;
  this.openSubpath = true;
};

Path.prototype.arc = function (x, y, radius, startAngle, endAngle, anticlockwise) {
  if (anticlockwise === undefined) { anticlockwise = false; }
  this.ellipse(x, y, radius, radius, 0, startAngle, endAngle, anticlockwise);
};

Path.prototype.ellipse = function (x, y, radiusX, radiusY, rotation, startAngle, endAngle, anticlockwise) {
  let self = this;
  let px, py;
  function rotateP() {
    let tx = px * Math.cos(rotation) - py * Math.sin(rotation);
    py = px * Math.sin(rotation) + py * Math.cos(rotation);
    px = tx;
  }

  px = radiusX * Math.cos(startAngle);
  py = radiusY * Math.sin(startAngle);

  rotateP();
  let vgRotation = rotation * 180 / Math.PI;

  function addArc(command) {
    self.segments[self.segmentsPos++] = command;
    self.data[self.dataPos++] = radiusX;
    self.data[self.dataPos++] = radiusY;
    self.data[self.dataPos++] = vgRotation;
    self.data[self.dataPos++] = x + px;
    self.data[self.dataPos++] = y + py;
  }

  this.segments[this.segmentsPos++] = this.openSubpath ? VG.VG_LINE_TO_ABS : VG.VG_MOVE_TO_ABS;
  this.data[this.dataPos++] = x + px;
  this.data[this.dataPos++] = y + py;

  let angle;

  if (anticlockwise) {
    if (startAngle - endAngle >= 2 * Math.PI) {
      startAngle = 2 * Math.PI;
      endAngle = 0;
    }

    while (endAngle > startAngle) endAngle -= 2 * Math.PI;

    angle = startAngle - Math.PI;

    while (angle > endAngle) {
      px = radiusX * Math.cos(angle);
      py = radiusY * Math.sin(angle);
      rotateP();
      addArc(VG.VG_SCWARC_TO_ABS);
      angle -= 2 * Math.PI;
    }
    px = radiusX * Math.cos(endAngle);
    py = radiusY * Math.sin(endAngle);
    rotateP();
    addArc(VG.VG_SCWARC_TO_ABS);
  } else {
    if (endAngle - startAngle >= 2 * Math.PI) {
      endAngle = 2 * Math.PI;
      startAngle = 0;
    }

    while (endAngle < startAngle) endAngle += 2 * Math.PI;

    angle = startAngle + Math.PI;
    while (angle < endAngle) {
      px = radiusX * Math.cos(angle);
      py = radiusY * Math.sin(angle);
      rotateP();
      addArc(VG.VG_SCCWARC_TO_ABS);
      angle += 2 * Math.PI;
    }
    px = radiusX * Math.cos(endAngle);
    py = radiusY * Math.sin(endAngle);
    rotateP();
    addArc(VG.VG_SCCWARC_TO_ABS);
  }
  this.openSubpath = true;
};

const compositeOperation2vg = {
  'source-atop'     : VG.VG_BLEND_SRC,
  'source-in'       : VG.VG_BLEND_SRC_IN,
  'source-out'      : VG.VG_BLEND_SRC, // Not implemented ?
  'source-over'     : VG.VG_BLEND_SRC_OVER,
  'destination-atop': VG.VG_BLEND_DST_IN, // Not implemented ?
  'destination-in'  : VG.VG_BLEND_DST_IN,
  'destination-out' : VG.VG_BLEND_DST_IN, // Not implemented ?
  'destination-over': VG.VG_BLEND_DST_OVER,
  'lighter'         : VG.VG_BLEND_LIGHTEN,
  'copy'            : VG.VG_BLEND_SRC, // Not implemented ?
  'xor'             : VG.VG_BLEND_SRC, // Not implemented ?

  'openVG-multiply' : VG.VG_BLEND_MULTIPLY,
  'openVG-screen'   : VG.VG_BLEND_SCREEN,
  'openVG-darker'   : VG.VG_BLEND_DARKEN,
  'openVG-additive' : VG.VG_BLEND_ADDITIVE
};

const lineCap2vg = {
  'butt'   : VG.VG_CAP_BUTT,
  'round'  : VG.VG_CAP_ROUND,
  'square' : VG.VG_CAP_SQUARE
};

const lineJoin2vg = {
  'round' : VG.VG_JOIN_ROUND,
  'bevel' : VG.VG_JOIN_BEVEL,
  'miter' : VG.VG_JOIN_MITER
};


function createCanvasRenderingContext2D(canvas) {
  let width  = canvas.width;
  let height = canvas.height;

  let baseTransform = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];

  let fillPaint = VG.vgCreatePaint();
  let strokePaint = VG.vgCreatePaint();

  let fillGradient = null;
  let fillPattern = null;
  let fillColor = [0, 0, 0, 1];
  let imageFillColor = [1, 1, 1, 1];
  let applyFillStyle = fillStyleSolid;
  let fillStyleApplied = false;

  let strokeGradient = null;
  let strokePattern = null;
  let strokeColor = [0, 0, 0, 1];
  let applyStrokeStyle = strokeStyleSolid;
  let strokeStyleApplied = false;

  let effectiveColor = [];
  let immediatePath = VG.vgCreatePath(VG.VG_PATH_FORMAT_STANDARD, VG.VG_PATH_DATATYPE_F, 1.0, 0.0, 0, 0, VG.VG_PATH_CAPABILITY_ALL);

  let currentPath = new Path();
  let currentFont;
  let drawingStateStack = [];

  let globalAlpha;
  let globalCompositeOperation;
  let blendMode;
  let imageSmoothingEnabled;
  
  let strokeStyle;
  let fillStyle;
  
  let lineWidth;
  let lineCap;
  let lineJoin;
  let miterLimit;

  let LINE_DASH_INITIAL_SIZE = 100;
  let LINE_DASH_EXCESS_FACTOR = 2;

  let lineDashPattern = [];
  let lineDashOffset = 0.0;
  let dashList;

  let font;
  let textAlign;
  let textBaseline;

  // Context2D Object
  let Context2D = {};

  function getCanvas() { return canvas; }
  Object.defineProperty(Context2D, 'canvas', { get: getCanvas });

  Context2D.save = function () {
    let current = {
      matrix: [],
      strokeStyle: strokeStyle,
      fillStyle: fillStyle,
      globalAlpha: globalAlpha,
      imageSmoothingEnabled: imageSmoothingEnabled,
      lineWidth: lineWidth,
      lineCap: lineCap,
      lineJoin: lineJoin,
      miterLimit: miterLimit,
      lineDashOffset: lineDashOffset,
      dashList: dashList,
      globalCompositeOperation: globalCompositeOperation,
      font: font,
      textAlign: textAlign,
      textBaseline: textBaseline
    };
    current.matrix = VG.vgGetMatrix();
    drawingStateStack.push(current);
  };

  Context2D.restore = function () {
    let current = drawingStateStack.pop();

    VG.vgLoadMatrix(current.matrix);
    Context2D.strokeStyle = current.strokeStyle;
    Context2D.fillStyle = current.fillStyle;
    Context2D.globalAlpha = current.globalAlpha;
    Context2D.imageSmoothingEnabled = current.imageSmoothingEnabled;
    Context2D.lineWidth = current.lineWidth;
    Context2D.lineCap = current.lineCap;
    Context2D.lineJoin = current.lineJoin;
    Context2D.miterLimit = current.miterLimit;

    internalSetLineDash(current);
    Context2D.lineDashOffset = current.lineDashOffset;

    Context2D.globalCompositeOperation = current.globalCompositeOperation;
    if (Context2D.font !== current.font) {
      Context2D.font = current.font;
    }
    Context2D.textAlign = current.textAlign;
    Context2D.textBaseline = current.textBaseline;
  };

  Context2D.scale = function (x, y) {
    VG.vgScale(x, y);
  };

  Context2D.rotate = function (angle) {
    VG.vgRotate(angle * 180 / Math.PI);
  };

  Context2D.translate = function (x, y) {
    VG.vgTranslate(x, y);
  };

  Context2D.transform = function (a, b, c, d, e, f) {
    VG.vgMultMatrix([a, b, 0.0, c, d, 0.0, e, f, 1.0]);
  };

  Context2D.setTransform = function (a, b, c, d, e, f) {
    VG.vgLoadMatrix([a, b, 0.0, c, d, 0.0, e, f, 1.0]);
  };

  Context2D.resetTransform = function () {
    VG.vgLoadIdentity();
    VG.vgMultMatrix(baseTransform);
  };

  function getGlobalAlpha() { return globalAlpha; }
  function setGlobalAlpha(newGlobalAlpha) {
    if (0 <= newGlobalAlpha && newGlobalAlpha <= 1.0) {
      globalAlpha = newGlobalAlpha;
    }
  }
  Object.defineProperty(Context2D, 'globalAlpha', { get: getGlobalAlpha, set: setGlobalAlpha });

  function getGlobalCompositeOperation() { return globalCompositeOperation; }
  function setGlobalCompositeOperation(newGlobalCompositeOperation) {
    let vgBlendMode = compositeOperation2vg[newGlobalCompositeOperation];
    if (vgBlendMode) {
      globalCompositeOperation = newGlobalCompositeOperation;
      blendMode = vgBlendMode;
      VG.vgSeti(VG.VG_BLEND_MODE, vgBlendMode);
    } 
    let saveBlendMode = VG.vgGeti(VG.VG_BLEND_MODE);
  }
  Object.defineProperty(Context2D, 'globalCompositeOperation', { get: getGlobalCompositeOperation, set: setGlobalCompositeOperation });

  function getImageSmoothingEnabled() { return imageSmoothingEnabled; }
  function setImageSmoothingEnabled(newImageSmoothingEnabled) {
    imageSmoothingEnabled = newImageSmoothingEnabled;
    VG.vgSeti(VG.VG_RENDERING_QUALITY,
            newImageSmoothingEnabled ?
            VG.VG_RENDERING_QUALITY_BETTER :
            VG.VG_RENDERING_QUALITY_FASTER);
  }
  Object.defineProperty(Context2D, 'imageSmoothingEnabled', { get: getImageSmoothingEnabled, set: setImageSmoothingEnabled });

  function applyGradient(paint, gradient, paintMode) {
    gradient.configurePaint(paint, globalAlpha);
    VG.vgSetPaint(paint, paintMode);
  }

  function applyPattern(paint, pattern, paintMode) {
    VG.vgSetParameteri(paint, VG.VG_PAINT_TYPE, VG.VG_PAINT_TYPE_PATTERN);
    VG.vgSetParameteri(paint, VG.VG_PAINT_PATTERN_TILING_MODE, pattern.tilingMode);
    VG.vgPaintPattern(paint, pattern.image.vgHandle);
    VG.vgSetPaint(paint, paintMode);
  }

  function strokeStyleSolid() {
    color.applyAlpha(effectiveColor, strokeColor, globalAlpha);    
    VG.vgSetParameteri(strokePaint, VG.VG_PAINT_TYPE,  VG.VG_PAINT_TYPE_COLOR);
    VG.vgSetParameterfv(strokePaint, VG.VG_PAINT_COLOR, 4, effectiveColor);
    VG.vgSetPaint(strokePaint, VG.VG_STROKE_PATH);
  }

  function strokeStyleGradient() {    
    applyGradient(strokePaint, strokeGradient, VG.VG_STROKE_PATH);
  }

  function strokeStylePattern() {
    applyPattern(strokePaint, strokePattern, VG.VG_STROKE_PATH);
  }

  function applyStrokeStyleWithReset() {
    if (!strokeStyleApplied) {
      applyStrokeStyle();
      strokeStyleApplied = true;
    }
  }

  function getStrokeStyle() { return strokeStyle; }
  function setStrokeStyle(newStrokeStyle) {
    strokeStyle = newStrokeStyle; 
    if ('string' === typeof newStrokeStyle) {
      color.parseColor(strokeColor, newStrokeStyle);
      applyStrokeStyle = strokeStyleSolid;
    } else if (newStrokeStyle instanceof Gradient) {
      strokeGradient = newStrokeStyle;
      applyStrokeStyle = strokeStyleGradient;
    } 
    strokeStyleApplied = false;
  }
  Object.defineProperty(Context2D, 'strokeStyle',  { get: getStrokeStyle, set: setStrokeStyle });

  function fillStyleSolid() {
    color.applyAlpha(effectiveColor, fillColor, globalAlpha);

    VG.vgSetParameteri(fillPaint, VG.VG_PAINT_TYPE,  VG.VG_PAINT_TYPE_COLOR);
    VG.vgSetParameterfv(fillPaint, VG.VG_PAINT_COLOR, 4, effectiveColor);
    VG.vgSetPaint(fillPaint, VG.VG_FILL_PATH);
  }

  function fillStyleGradient() {
    applyGradient(fillPaint, fillGradient, VG.VG_FILL_PATH);
  }

  function applyFillStyleWithReset() {
    if (!fillStyleApplied) {
      applyFillStyle();
      fillStyleApplied = true;
    }
  }

  function getFillStyle() { return fillStyle; }
  function setFillStyle(newFillStyle) {
    fillStyle = newFillStyle; 

    if ('string' === typeof newFillStyle) {
      color.parseColor(fillColor, newFillStyle);
      applyFillStyle = fillStyleSolid;
    } else if (newFillStyle instanceof Gradient) {
      fillGradient = newFillStyle;
      applyFillStyle = fillStyleGradient;
    }
    fillStyleApplied = false;
  }
  Object.defineProperty(Context2D, 'fillStyle', { get: getFillStyle, set: setFillStyle });

  Context2D.createLinearGradient = function (x0, y0, x1, y1) {
    return new Gradient('linearGradient', [x0, y0, x1, y1]);
  };

  Context2D.createRadialGradient = function (x0, y0, r0, x1, y1, r1) {
    return new Gradient('radialGradient', [x0, y0, x1, y1, r1]);
  };

  Context2D.clearRect = function (x, y, w, h) {
    VG.vgClear(x, y, w, h);
  };

  Context2D.fillRect = function (x, y, w, h) {    
    VG.vgClearPath(immediatePath, VG.VG_PATH_CAPABILITY_ALL);
    VG.vguRect(immediatePath, x, y, w, h);

    applyFillStyleWithReset();
    VG.vgDrawPath(immediatePath, VG.VG_FILL_PATH);
  };

  Context2D.strokeRect = function (x, y, w, h) {
    VG.vgClearPath(immediatePath, VG.VG_PATH_CAPABILITY_ALL);
    VG.vguRect(immediatePath, x, y, w, h);
    applyStrokeStyleWithReset();
    VG.vgDrawPath(immediatePath, VG.VG_STROKE_PATH);
  };

  Context2D.drawImage = function (img, sx, sy, sw, sh, dx, dy, dw, dh) {
    if (sw === undefined) {
      dh = img.height;
      dw = img.width;
      dy = sy;
      dx = sx;
      sy = 0;
      sx = 0;
      sh = img.height;
      sw = img.width;
    } else
    if (dx === undefined) {
      dh = sh;
      dw = sw;
      dy = sy;
      dx = sx;
      sy = 0;
      sx = 0;
      sh = img.height;
      sw = img.width;
    }

    function paintImage(vgHandle) {
      if (globalAlpha === 1) {
        VG.vgSeti(VG.VG_IMAGE_MODE, VG.VG_DRAW_IMAGE_NORMAL);
      } else {
        VG.vgSeti(VG.VG_IMAGE_MODE, VG.VG_DRAW_IMAGE_MULTIPLY);
        imageFillColor[3] = globalAlpha;
        VG.vgSetParameterfv(fillPaint, VG.VG_PAINT_COLOR, 4, imageFillColor);
      }
      VG.vgDrawImage(vgHandle);

      if (globalAlpha !== 1) {
        VG.vgSetParameterfv(fillPaint, VG.VG_PAINT_COLOR, 4, effectiveColor);
      }
    }
    drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh, paintImage);
  };

  function getLineWidth() { return lineWidth; }
  function setLineWidth(newLineWidth) {
    lineWidth = newLineWidth;
    VG.vgSetf(VG.VG_STROKE_LINE_WIDTH, newLineWidth);
  }
  Object.defineProperty(Context2D, 'lineWidth', { get: getLineWidth, set: setLineWidth });

  function getLineCap() { return lineCap; }
  function setLineCap(newLineCap) {
    let vgCapStyle = lineCap2vg[newLineCap];
    if (vgCapStyle) {
      lineCap = newLineCap;
      VG.vgSeti(VG.VG_STROKE_CAP_STYLE, vgCapStyle);
    } 
  }
  Object.defineProperty(Context2D, 'lineCap', { get: getLineCap, set: setLineCap });

  function getLineJoin() { return lineJoin; }
  function setLineJoin(newLineJoin) {
    let vgJoinStyle = lineJoin2vg[newLineJoin];
    if (vgJoinStyle) {
      lineJoin = newLineJoin;
      VG.vgSeti(VG.VG_STROKE_JOIN_STYLE, vgJoinStyle);
    }
  }
  Object.defineProperty(Context2D, 'lineJoin', { get: getLineJoin, set: setLineJoin });

  function getMiterLimit() { return miterLimit; }
  function setMiterLimit(newMiterLimit) {
    miterLimit = newMiterLimit;
    VG.vgSetf(VG.VG_STROKE_MITER_LIMIT, newMiterLimit);
  }
  Object.defineProperty(Context2D, 'miterLimit', { get: getMiterLimit, set: setMiterLimit });

  Context2D.setLineDash = function (segments) {
    dashList = [];
    for(let i = 0; i < segments.length; i++) {
      dashList[i] = segments[i];
      if(i != 0) {
        dashList[i] += dashList[i-1];
      }
    }
    VG.vgSetfv(VG.VG_STROKE_DASH_PATTERN, dashList.length, dashList);
  };

  function internalSetLineDash(state) {
    if (state.dashList === dashList) return;

    dashList = state.dashList;
    for (let i = 0; i < dashList.length; i++)
      lineDashPattern[i] = dashList[i];

    VG.vgSetfv(VG.VG_STROKE_DASH_PATTERN, dashList.length, dashList);
  }

  Context2D.getLineDash = function () {
    return dashList;
  };

  function getLineDashOffset() { return lineDashOffset; }
  function setLineDashOffset(newLineDashOffset) {
    if (lineDashOffset !== newLineDashOffset) {
      lineDashOffset = newLineDashOffset;
      VG.vgSetf(VG.VG_STROKE_DASH_PHASE, newLineDashOffset);
    }
  }
  Object.defineProperty(Context2D, 'lineDashOffset', { get: getLineDashOffset, set: setLineDashOffset });

  function getFont() { return font; }
  function setFont(newFont) {
    let parsedFont = textFn.parseFont(newFont);
    if (parsedFont) {
      textFn.loadTypeface(parsedFont, function (err, typeface) {
        font = textFn.serialize(parsedFont);
        currentFont = parsedFont;
        currentFont.typeface = typeface;
      });        
    }
  }
  Object.defineProperty(Context2D, 'font', { get: getFont, set: setFont });

  function getTextAlign() { return textAlign; }
  function setTextAlign(newTextAlign) {
    if (textFn.setTextAlign(newTextAlign)) {
      textAlign = newTextAlign;
    }
  }
  Object.defineProperty(Context2D, 'textAlign', { get: getTextAlign, set: setTextAlign });

  function getTextBaseline() { return textBaseline; }
  function setTextBaseline(newTextBaseline) {
    if (textFn.setTextBaseline(newTextBaseline)) {
      textBaseline = newTextBaseline;
    }
  }
  Object.defineProperty(Context2D, 'textBaseline', { get: getTextBaseline, set: setTextBaseline });

  Context2D.fillText = function (text, x, y, maxWidth) {
    function paint(textPath) {
      applyFillStyleWithReset();
      VG.vgDrawPath(textPath, VG.VG_FILL_PATH);
    }
    textFn.renderText(x, y, text, currentFont.typeface, currentFont.size, paint);
  };

  Context2D.strokeText = function (text, x, y, maxWidth) {
    function paint(textPath) {
      applyStrokeStyleWithReset();
      VG.vgDrawPath(textPath, VG.VG_STROKE_PATH);
    }
    textFn.renderText(x, y, text, currentFont.typeface, currentFont.size, paint);
  };

  Context2D.measureText = function (text) {
    return textFn.measureText(text, currentFont.typeface, currentFont.size);
  };
  
  Context2D.beginPath = function () {
    currentPath.beginPath();
  };

  Context2D.fill = function (path) {
    if (path === undefined) path = currentPath;
    applyFillStyleWithReset();
    path.fill();
  };

  Context2D.stroke = function (path) {
    if (path === undefined) path = currentPath;
    applyStrokeStyleWithReset();
    path.stroke();
  };

  Context2D.closePath = function () {
    currentPath.closePath();
  };

  Context2D.moveTo = function (x, y) {
    currentPath.moveTo(x, y);
  };

  Context2D.lineTo = function (x, y) {
    currentPath.lineTo(x, y);
  };

  Context2D.quadraticCurveTo = function (cpx, cpy, x, y) {
    currentPath.quadraticCurveTo(cpx, cpy, x, y);
  };

  Context2D.bezierCurveTo = function (cp1x, cp1y, cp2x, cp2y, x, y) {
    currentPath.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
  };

  Context2D.arcTo = function (x1, y1, x2, y2, radiusX, radiusY, rotation) {
    currentPath.arcTo(x1, y1, x2, y2, radiusX, radiusY, rotation);
  };

  Context2D.rect = function (x, y, w, h) {
    currentPath.rect(x, y, w, h);
  };

  Context2D.arc = function (x, y, radius, startAngle, endAngle, anticlockwise) {
    currentPath.arc(x, y, radius, startAngle, endAngle, anticlockwise);
  };

  Context2D.ellipse = function (x, y, radiusX, radiusY, rotation, startAngle, endAngle, anticlockwise) {
    currentPath.ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, anticlockwise);
  };

  // Initialization
  VG.vgLoadIdentity();
  VG.vgMultMatrix(baseTransform);
  VG.vgSetfv(VG.VG_CLEAR_COLOR, 4, [ 1.0, 1.0, 1.0, 1.0 ]);

  Context2D.globalAlpha = 1.0;
  Context2D.globalCompositeOperation = 'source-over';
  Context2D.imageSmoothingEnabled = true;

  Context2D.strokeStyle = 'black';
  Context2D.fillStyle = 'black';
  Context2D.lineWidth = 1;
  Context2D.lineCap = 'butt';
  Context2D.lineJoin = 'miter';
  Context2D.miterLimit = 10;

  Context2D.setLineDash([]);
  Context2D.lineDashOffset = 0.0;

  Context2D.font = '10px sans-serif';
  Context2D.textAlign = 'start';
  Context2D.textBaseline = 'alphabetic';

  return Context2D;
};


let namedColors = {
  transparent : 0x000000,
  aliceblue : 0xF0F8FF,
  antiquewhite : 0xFAEBD7,
  aqua : 0x00FFFF,
  aquamarine : 0x7FFFD4,
  azure : 0xF0FFFF,
  beige : 0xF5F5DC,
  bisque : 0xFFE4C4,
  black : 0x000000,
  blanchedalmond : 0xFFEBCD,
  blue : 0x0000FF,
  blueviolet : 0x8A2BE2,
  brown : 0xA52A2A,
  burlywood : 0xDEB887,
  cadetblue : 0x5F9EA0,
  chartreuse : 0x7FFF00,
  chocolate : 0xD2691E,
  coral : 0xFF7F50,
  cornflowerblue : 0x6495ED,
  cornsilk : 0xFFF8DC,
  crimson : 0xDC143C,
  cyan : 0x00FFFF,
  darkblue : 0x00008B,
  darkcyan : 0x008B8B,
  darkgoldenrod : 0xB8860B,
  darkgray : 0xA9A9A9,
  darkgreen : 0x006400,
  darkgrey : 0xA9A9A9,
  darkkhaki : 0xBDB76B,
  darkmagenta : 0x8B008B,
  darkolivegreen : 0x556B2F,
  darkorange : 0xFF8C00,
  darkorchid : 0x9932CC,
  darkred : 0x8B0000,
  darksalmon : 0xE9967A,
  darkseagreen : 0x8FBC8F,
  darkslateblue : 0x483D8B,
  darkslategray : 0x2F4F4F,
  darkslategrey : 0x2F4F4F,
  darkturquoise : 0x00CED1,
  darkviolet : 0x9400D3,
  deeppink : 0xFF1493,
  deepskyblue : 0x00BFFF,
  dimgray : 0x696969,
  dimgrey : 0x696969,
  dodgerblue : 0x1E90FF,
  firebrick : 0xB22222,
  floralwhite : 0xFFFAF0,
  forestgreen : 0x228B22,
  fuchsia : 0xFF00FF,
  gainsboro : 0xDCDCDC,
  ghostwhite : 0xF8F8FF,
  gold : 0xFFD700,
  goldenrod : 0xDAA520,
  gray : 0x808080,
  green : 0x008000,
  greenyellow : 0xADFF2F,
  grey : 0x808080,
  honeydew : 0xF0FFF0,
  hotpink : 0xFF69B4,
  indianred : 0xCD5C5C,
  indigo : 0x4B0082,
  ivory : 0xFFFFF0,
  khaki : 0xF0E68C,
  lavender : 0xE6E6FA,
  lavenderblush : 0xFFF0F5,
  lawngreen : 0x7CFC00,
  lemonchiffon : 0xFFFACD,
  lightblue : 0xADD8E6,
  lightcoral : 0xF08080,
  lightcyan : 0xE0FFFF,
  lightgoldenrodyellow : 0xFAFAD2,
  lightgray : 0xD3D3D3,
  lightgreen : 0x90EE90,
  lightgrey : 0xD3D3D3,
  lightpink : 0xFFB6C1,
  lightsalmon : 0xFFA07A,
  lightseagreen : 0x20B2AA,
  lightskyblue : 0x87CEFA,
  lightslategray : 0x778899,
  lightslategrey : 0x778899,
  lightsteelblue : 0xB0C4DE,
  lightyellow : 0xFFFFE0,
  lime : 0x00FF00,
  limegreen : 0x32CD32,
  linen : 0xFAF0E6,
  magenta : 0xFF00FF,
  maroon : 0x800000,
  mediumaquamarine : 0x66CDAA,
  mediumblue : 0x0000CD,
  mediumorchid : 0xBA55D3,
  mediumpurple : 0x9370DB,
  mediumseagreen : 0x3CB371,
  mediumslateblue : 0x7B68EE,
  mediumspringgreen : 0x00FA9A,
  mediumturquoise : 0x48D1CC,
  mediumvioletred : 0xC71585,
  midnightblue : 0x191970,
  mintcream : 0xF5FFFA,
  mistyrose : 0xFFE4E1,
  moccasin : 0xFFE4B5,
  navajowhite : 0xFFDEAD,
  navy : 0x000080,
  oldlace : 0xFDF5E6,
  olive : 0x808000,
  olivedrab : 0x6B8E23,
  orange : 0xFFA500,
  orangered : 0xFF4500,
  orchid : 0xDA70D6,
  palegoldenrod : 0xEEE8AA,
  palegreen : 0x98FB98,
  paleturquoise : 0xAFEEEE,
  palevioletred : 0xDB7093,
  papayawhip : 0xFFEFD5,
  peachpuff : 0xFFDAB9,
  peru : 0xCD853F,
  pink : 0xFFC0CB,
  plum : 0xDDA0DD,
  powderblue : 0xB0E0E6,
  purple : 0x800080,
  red : 0xFF0000,
  rosybrown : 0xBC8F8F,
  royalblue : 0x4169E1,
  saddlebrown : 0x8B4513,
  salmon : 0xFA8072,
  sandybrown : 0xF4A460,
  seagreen : 0x2E8B57,
  seashell : 0xFFF5EE,
  sienna : 0xA0522D,
  silver : 0xC0C0C0,
  skyblue : 0x87CEEB,
  slateblue : 0x6A5ACD,
  slategray : 0x708090,
  slategrey : 0x708090,
  snow : 0xFFFAFA,
  springgreen : 0x00FF7F,
  steelblue : 0x4682B4,
  tan : 0xD2B48C,
  teal : 0x008080,
  thistle : 0xD8BFD8,
  tomato : 0xFF6347,
  turquoise : 0x40E0D0,
  violet : 0xEE82EE,
  wheat : 0xF5DEB3,
  white : 0xFFFFFF,
  whitesmoke : 0xF5F5F5,
  yellow : 0xFFFF00,
  yellowgreen : 0x9ACD32
};


let namedColorValues = [];

(function () {
  let pos = 0;
  for (let color in namedColors) {
    let rgb = namedColors[color];
    namedColors[color] = pos;
    namedColorValues[pos++] = (rgb >>> 16) / 255;
    namedColorValues[pos++] = (rgb >>> 8 & 0xff) / 255;
    namedColorValues[pos++] = (rgb & 0xff) / 255;
    namedColorValues[pos++] = 1.0;
  }
  namedColorValues[namedColors['transparent'] + 3] = 0.0;
})();

let color = {};
//module.exports = color;

color.applyAlpha = function(dest, vector, alpha) {
  dest[0] = vector[0];
  dest[1] = vector[1];
  dest[2] = vector[2];
  dest[3] = vector[3] * alpha;
};

color.parseColor = function(dest, colorString) {
  if (colorString.charAt(0) === '#') {
    return parseHexColor(dest, colorString);
  } else if (colorString.indexOf('rgba(') === 0) {
    return parseRGBAColor(dest, colorString);
  } else if (colorString.indexOf('rgb(') === 0) {
    return parseRGBColor(dest, colorString);
  } else if (colorString.indexOf('hsla(') === 0) {
    return parseHSLAColor(dest, colorString);
  } else if (colorString.indexOf('hsl(') === 0) {
    return parseHSLColor(dest, colorString);
  } else {
    return namedColor(dest, colorString);
  }
};


function parseHexColor(dest, colorString) {
  let hexLen = 1, r, g, b;
  while (hexLen < colorString.length) {
    let c = colorString.charCodeAt(hexLen);
    if (!(c >= 48 && c <= 48 + 9) &&
        !(c >= 65 && c <= 65 + 5) &&
        !(c >= 97 && c <= 97 + 5))
      break;
    hexLen++;
  }

  if (hexLen === 7) {
    dest[0] = parseInt(colorString.substr(1, 2), 16) / 255.0;
    dest[1] = parseInt(colorString.substr(3, 2), 16) / 255.0;
    dest[2] = parseInt(colorString.substr(5, 2), 16) / 255.0;
    dest[3] = 1.0;
  } else if (hexLen === 4) {
    r = parseInt(colorString.substr(1, 1), 16);
    g = parseInt(colorString.substr(2, 1), 16);
    b = parseInt(colorString.substr(3, 1), 16);
    dest[0] = (r << 4 | r) / 255.0;
    dest[1] = (g << 4 | g) / 255.0;
    dest[2] = (b << 4 | b) / 255.0;
    dest[3] = 1.0;
  }
}

function parseRGBAColor(dest, colorString) {
  colorString = colorString.substr(5).split(/ *, */);

  if (colorString[0].charAt(colorString[0].length - 1) === '%') {
    dest[0] = parseFloat(colorString[0]) / 100;
    dest[1] = parseFloat(colorString[1]) / 100;
    dest[2] = parseFloat(colorString[2]) / 100;
  } else {
    dest[0] = parseInt(colorString[0], 10) / 255.0;
    dest[1] = parseInt(colorString[1], 10) / 255.0;
    dest[2] = parseInt(colorString[2], 10) / 255.0;
  }

  dest[3] = parseFloat(colorString[3]);
}

function parseRGBColor(dest, colorString) {
  colorString = colorString.substr(4).split(/ *, */);

  if (colorString[0].charAt(colorString[0].length - 1) === '%') {
    dest[0] = parseFloat(colorString[0]) / 100;
    dest[1] = parseFloat(colorString[1]) / 100;
    dest[2] = parseFloat(colorString[2]) / 100;
  } else {
    dest[0] = parseInt(colorString[0], 10) / 255.0;
    dest[1] = parseInt(colorString[1], 10) / 255.0;
    dest[2] = parseInt(colorString[2], 10) / 255.0;
  }

  dest[3] = 1.0;
}

function hsl2RGB(dest, h, s, l) {
  if (h < 0) {
    h = (((h % 360) + 360) % 360);
  } else if (h >= 360) {
    h = h % 360;
  }

  let c = (1 - (l > 0.5 ? 2 * l - 1 : 1 - 2 * l)) * s;
  let hh = h / 60;
  let x = c * (1 - Math.abs(hh % 2 - 1));

  if (hh === undefined) {
    dest[0] = dest[1] = dest[2] = 0;
  } else if (hh < 1) {
    dest[0] = c;
    dest[1] = x;
    dest[2] = 0;
  } else if (hh < 2) {
    dest[0] = x;
    dest[1] = c;
    dest[2] = 0;
  } else if (hh < 3) {
    dest[0] = 0;
    dest[1] = c;
    dest[2] = x;
  } else if (hh < 4) {
    dest[0] = 0;
    dest[1] = x;
    dest[2] = c;
  } else if (hh < 5) {
    dest[0] = x;
    dest[1] = 0;
    dest[2] = c;
  } else {
    dest[0] = c;
    dest[1] = 0;
    dest[2] = x;
  }

  let m = l - c * 0.5;
  dest[0] += m;
  dest[1] += m;
  dest[2] += m;
}

function parseHSLAColor(dest, colorString) {
  colorString = colorString.substr(5).split(/ *, */);
  let h = parseFloat(colorString[0]);
  let s = parseFloat(colorString[1]) * 0.01;
  let l = parseFloat(colorString[2]) * 0.01;

  hsl2RGB(dest, h, s, l);

  dest[3] = parseFloat(colorString[3]);
}

function parseHSLColor(dest, colorString) {
  colorString = colorString.substr(4).split(/ *, */);
  let h = parseFloat(colorString[0]);
  let s = parseFloat(colorString[1]) * 0.01;
  let l = parseFloat(colorString[2]) * 0.01;

  hsl2RGB(dest, h, s, l);

  dest[3] = 1.0;
}

function namedColor(dest, colorString) {
  let pos = namedColors[colorString];
  if (pos !== undefined) {
    dest[0] = namedColorValues[pos++];
    dest[1] = namedColorValues[pos++];
    dest[2] = namedColorValues[pos++];
    dest[3] = namedColorValues[pos];
  } else {
    dest[0] = dest[1] = dest[2] = dest[3] = NaN;
  }
}

function floatToHex(v) {
  v = Math.floor(v * 255);
  if (v < 16) {
    return '0' + v.toString(16);
  } else {
    return v.toString(16);
  }
}

function toHexColor(colorArray) {
  return '#' + floatToHex(colorArray[0]) + floatToHex(colorArray[1]) +
    floatToHex(colorArray[2]);
}

function toRGBAColor(colorArray) {
  return 'rgba(' + colorArray[0] * 255 + colorArray[1] * 255 +
    colorArray[2] * 255 + ')';
}


let weights = 'normal|bold|bolder|lighter|[1-9]00';
let styles = 'normal|italic|oblique|bold';
let units = 'px|pt|pc|in|cm|mm|%';
let string = '\'([^\']+)\'|"([^"]+)"|[\\w-]+';

let fontre = new RegExp('^ *' +
  '(?:(' + weights + ') *)?' +
  '(?:(' + styles + ') *)?' +
  '([\\d\\.]+)(' + units + ') *' +
  '((?:' + string + ')( *, *(?:' + string + '))*)'
  );

// only support 1 font
let parseFontCache = {};
let textFn = {};

textFn.parseFont = function(str) {
  if (parseFontCache[str]) 
    return parseFontCache[str];
  let captures = fontre.exec(str);
  if (!captures) return;

  let font = {
    weight : captures[1] || 'normal',
    style : captures[2] || 'normal',
    specifiedSize : parseFloat(captures[3]),
    size : null,
    unit : captures[4],
    family : captures[5].replace(/["']/g, ''),
    typeface : null
  };

  switch (font.unit) {
  case 'px':
    font.size = font.specifiedSize;
    break;
  case 'pt':
    font.size = font.specifiedSize / 0.75;
    break;
  case 'in':
    font.size = font.specifiedSize * 96;
    break;
  case 'mm':
    font.size = font.specifiedSize * 96.0 / 25.4;
    break;
  case 'cm':
    font.size = font.specifiedSize * 96.0 / 2.54;
    break;
  }
  return parseFontCache[str] = font;
};

let typefaceByFilename = {};
textFn.loadTypeface = function(font, callback) {
  if (font.face) {
    callback(undefined, font.face);
    return;
  }

  let filename = '/Library/Fonts/AppleGothic.ttf';
  let typeface = typefaceByFilename[filename];
  if (typeface) {
    font.face = typeface;
    callback(undefined, typeface);
    return;
  }

  typeface = new Font();
  typeface.loadFile(filename);
  font.face = typeface;
  typefaceByFilename[filename] = typeface;

  callback(undefined, typeface);
};

textFn.serialize = function(parsedFont) {
  let result = '';
  if (parsedFont.style !== 'normal') {
    result += parsedFont.style + ' ';
  }

  if (parsedFont.weight !== 'normal' && parsedFont.weight !== 400) {
    result += parsedFont.weight + ' ';
  }
  result += parsedFont.specifiedSize + parsedFont.unit;
  result += ' ' + parsedFont.family;
  return result;
};

let noop = function () { return 0; };
let textAlignOffsetFunctions = {
  left  : noop,
  right : function (width) { return -width; },
  center: function (width) { return -width / 2; },
  start : null,
  end   : null
};

textAlignOffsetFunctions.start = textAlignOffsetFunctions.left;
textAlignOffsetFunctions.end = textAlignOffsetFunctions.right;

let textBaselineOffsetFunctions = {
  top        : function (ascender, descender) { return ascender; },
  middle     : function (ascender, descender) { return ((ascender + descender) / 2 - descender); },
  alphabetic : noop, // no-op
  bottom     : function (ascender, descender) { return -descender; },
  hanging    : null,
  ideographic: null
};

textBaselineOffsetFunctions.hanging = textBaselineOffsetFunctions.ideographic = textBaselineOffsetFunctions.top;

let textAlignOffset, textBaselineOffset;

textFn.setTextAlign = function(textAlign) {
  let newFn = textAlignOffsetFunctions[textAlign];
  if (newFn) {
    textAlignOffset = newFn;
  }
  return !!newFn;
};

textFn.setTextBaseline = function(textBaseline) {
  let newFn = textBaselineOffsetFunctions[textBaseline];
  if (newFn) {
    textBaselineOffset = newFn;
  }
  return !!newFn;
};

function textWidth(text, font, size) {
  let tw = 0.0;
  let dpi = 220.0;
  let ppem = size * dpi / 72.0 ;
    ppem = size;

  let scale = ppem / font.unitsPerEm;
  let adv = 0.0;

  for (let i = 0; i < text.length; i++) {
    let ch = text.charCodeAt(i);
    let glyph = font.glyphIndex(ch);
    if (glyph < 0 || glyph === undefined) {
      continue; //glyph is undefined
    }
    tw += (font.glyphAdvances(glyph) * scale) | 0;
  }
  return tw;
}

textFn.measureText = function(text, font, pointSize) {
  let metrics = {
    width: 0, 
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: 0,

    fontBoundingBoxAscent: 0,
    fontBoundingBoxDescent: 0,
    actualBoundingBoxAscent: 0,
    actualBoundingBoxDescent: 0,
    emHeightAscent: font.ascender * pointSize / 65536.0,
    emHeightDescent: font.descender * pointSize / 65536.0,
    hangingBaseline: 0,
    alphabeticBaseline: 0,
    ideographicBaseline: 0,
    freetypeExtra: null
  };

  if (text.length === 0) {
    return metrics;
  }

  let dpi = 220.0;
  let ppem = pointSize * dpi / 72.0 ;
  ppem = pointSize;

  let scale = ppem / font.unitsPerEm;
  let adv = 0.0;

  let xx = 0, yy = 0;
  for (let i = 0; i < text.length; i++) {
    let ch = text.charCodeAt(i);
    let glyph = font.glyphIndex(ch);
    if (glyph < 0 || glyph === undefined) {
      continue; 
    }

    let bbox = font.glyphBBoxes(glyph);

    bbox.minX = bbox.minX * scale;
    bbox.maxX = bbox.maxX * scale;
    bbox.minY = bbox.minY * scale;
    bbox.maxY = bbox.maxY * scale;

    if (xx + bbox.minX < metrics.actualBoundingBoxLeft) {
      metrics.actualBoundingBoxLeft = xx + bbox.minX;
    }
    if (xx + bbox.maxX > metrics.actualBoundingBoxRight) {
      metrics.actualBoundingBoxRight = xx + bbox.maxX;
    }

    if (yy + bbox.minY < metrics.actualBoundingBoxDescent) {
      metrics.actualBoundingBoxDescent = yy + bbox.minY;
    }
    if (yy + bbox.maxY > metrics.actualBoundingBoxAscent) {
      metrics.actualBoundingBoxAscent = yy + bbox.maxY;
    }

    xx += font.glyphAdvances(glyph) * scale;
    yy += 0;
  }
   metrics.width = xx;
  return metrics;
};

function renderToPath(text, font, size) {
  let textPath = VG.vgCreatePath(VG.VG_PATH_FORMAT_STANDARD, VG.VG_PATH_DATATYPE_F,1.0, 0.0, 0, 0, VG.VG_PATH_CAPABILITY_ALL);

  let offset = 0;

  let dpi = 220.0;
  let ppem = size * dpi / 72.0 ;
  ppem = size;
  let scale = ppem / font.unitsPerEm;
  let adv = 0.0;

  VG.vgSeti(VG.VG_MATRIX_MODE, VG.VG_MATRIX_PATH_USER_TO_SURFACE);
  VG.vgLoadIdentity();

  for (let i = 0; i < text.length; i++) {
    let ch = text.charCodeAt(i);
    let glyph = font.glyphIndex(ch);

    if (glyph < 0 || glyph === undefined) {
      continue; 
    }
    let glyphs = font.glyphs(ch, glyph);

    VG.vgTranslate(adv, (font.ascender * scale));
    VG.vgScale(scale, -scale);
    
    VG.vgTransformPath(textPath, glyphs);
   
    VG.vgSeti(VG.VG_MATRIX_MODE, VG.VG_MATRIX_PATH_USER_TO_SURFACE);
    VG.vgLoadIdentity();

    let cur = (font.glyphAdvances(glyph) * scale) | 0;
    adv += cur;  
  }
  return textPath;
}

textFn.renderText = function(x, y, text, font, size, paintFn) {
  let currentMatrix = [], currentLineWidth;

  currentMatrix = VG.vgGetMatrix();
  currentLineWidth = VG.vgGetf(VG.VG_STROKE_LINE_WIDTH);

  let mat = [
     1.0,   0.0, 0.0,
     0.0,  1.0, 0.0,
       x,     y, 1.0
  ];

  if (textAlignOffset !== noop) { 
    mat[6] += textAlignOffset(textWidth(text, font, size));
  }
  mat[7] += textBaselineOffset(font.ascender  * size / 65536.0, font.descender * size / 65536.0);

  let textPath = renderToPath(text, font, size);
  
  VG.vgLoadMatrix(currentMatrix);
  VG.vgMultMatrix(mat);
  paintFn(textPath);

  VG.vgSetf(VG.VG_STROKE_LINE_WIDTH, currentLineWidth);
  VG.vgLoadMatrix(currentMatrix);
  VG.vgDestroyPath(textPath);
};
