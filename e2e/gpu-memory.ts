import type { Page } from '@playwright/test';

export type GpuMemoryKind = 'texture' | 'buffer' | 'renderbuffer';
export type GpuMemoryContext = {
  id: number;
  // The canvas is in the document.
  connected: boolean;
  // A lost context holds no memory; `bytes` and `objects` are then what was not deleted before.
  lost: boolean;
  bytes: Record<GpuMemoryKind, number>;
  objects: Record<GpuMemoryKind, number>;
  // The drawing buffer: the color and depth (if any), and when antialiased 4 samples of both and
  // the resolved color. 0 once lost.
  drawingBufferBytes: number;
  unknownFormats: number[];
  // The largest objects: kind, bytes and what allocated them (the call, size and internal format).
  largest: { kind: GpuMemoryKind; bytes: number; allocations: string[] }[];
};

// Estimates the GPU memory each WebGL2 context holds from the calls that allocate and delete
// textures, buffers and renderbuffers. Sizes are the bytes the data needs (no driver padding,
// alignment or internal copies), mipmaps are counted per level, and RGB formats as 4 bytes a
// texel. Programs, shaders, framebuffers and query objects are not counted.
export function observeGpuMemory() {
  const gl = WebGL2RenderingContext;
  type Entry = { kind: 'texture' | 'buffer' | 'renderbuffer'; bytes: Map<string, number>; notes: Map<string, string> };
  type State = {
    id: number;
    context: WebGL2RenderingContext;
    lost: boolean;
    unit: number;
    textures: Map<string, WebGLTexture | null>;
    buffers: Map<number, WebGLBuffer | null>;
    renderbuffer: WebGLRenderbuffer | null;
    entries: Map<object, Entry>;
    unknown: Set<number>;
  };
  const states: State[] = [];
  const byContext = new WeakMap<WebGL2RenderingContext, State>();
  const state = (context: WebGL2RenderingContext) => {
    let found = byContext.get(context);
    if (!found) {
      found = {
        id: states.length,
        context,
        lost: false,
        unit: 0,
        textures: new Map(),
        buffers: new Map(),
        renderbuffer: null,
        entries: new Map(),
        unknown: new Set(),
      };
      byContext.set(context, found);
      states.push(found);
      const own = found;
      (context.canvas as HTMLCanvasElement).addEventListener?.('webglcontextlost', () => (own.lost = true));
    }
    return found;
  };

  const sized: Record<number, number> = {
    [gl.R8]: 1,
    [gl.R8UI]: 1,
    [gl.RG8]: 2,
    [gl.R16F]: 2,
    [gl.R16UI]: 2,
    [gl.RGB8]: 4,
    [gl.SRGB8]: 4,
    [gl.RGBA8]: 4,
    [gl.SRGB8_ALPHA8]: 4,
    [gl.RGB10_A2]: 4,
    [gl.R11F_G11F_B10F]: 4,
    [gl.RG16F]: 4,
    [gl.R32F]: 4,
    [gl.R32UI]: 4,
    [gl.RGBA8UI]: 4,
    [gl.RGB16F]: 8,
    [gl.RGBA16F]: 8,
    [gl.RG32F]: 8,
    [gl.RG32UI]: 8,
    [gl.RGB32F]: 16,
    [gl.RGBA32F]: 16,
    [gl.RGBA32UI]: 16,
    [gl.DEPTH_COMPONENT16]: 2,
    [gl.DEPTH_COMPONENT24]: 4,
    [gl.DEPTH_COMPONENT32F]: 4,
    [gl.DEPTH24_STENCIL8]: 4,
    [gl.DEPTH32F_STENCIL8]: 8,
    [gl.STENCIL_INDEX8]: 1,
  };
  const channels: Record<number, number> = {
    [gl.RED]: 1,
    [gl.ALPHA]: 1,
    [gl.LUMINANCE]: 1,
    [gl.LUMINANCE_ALPHA]: 2,
    [gl.RG]: 2,
    [gl.RGB]: 4,
    [gl.RGBA]: 4,
    [gl.DEPTH_COMPONENT]: 1,
    [gl.DEPTH_STENCIL]: 1,
  };
  const typeBytes: Record<number, number> = {
    [gl.UNSIGNED_BYTE]: 1,
    [gl.HALF_FLOAT]: 2,
    [gl.FLOAT]: 4,
    [gl.UNSIGNED_SHORT]: 2,
    [gl.UNSIGNED_INT]: 4,
    [gl.UNSIGNED_INT_24_8]: 4,
  };
  const texelBytes = (own: State, internalformat: number, type?: number) => {
    if (sized[internalformat]) return sized[internalformat];
    if (channels[internalformat] && type !== undefined && typeBytes[type]) {
      // Depth formats with a 4-byte type are one value a texel.
      return internalformat === gl.DEPTH_STENCIL ? 4 : channels[internalformat] * typeBytes[type];
    }
    own.unknown.add(internalformat);
    return 4;
  };

  const cubeFace = (target: number) =>
    target >= gl.TEXTURE_CUBE_MAP_POSITIVE_X && target <= gl.TEXTURE_CUBE_MAP_NEGATIVE_Z;
  const bound = (own: State, target: number) =>
    own.textures.get(`${own.unit}:${cubeFace(target) ? gl.TEXTURE_CUBE_MAP : target}`) ?? null;
  const set = (own: State, object: object | null, kind: Entry['kind'], key: string, bytes: number, note = '') => {
    if (!object) return;
    let entry = own.entries.get(object);
    if (!entry) own.entries.set(object, (entry = { kind, bytes: new Map(), notes: new Map() }));
    entry.bytes.set(key, bytes);
    if (note) entry.notes.set(key, note);
  };
  const sourceSize = (source: unknown) => {
    const s = source as Record<string, number>;
    return [
      s.videoWidth || s.naturalWidth || s.displayWidth || s.width || 0,
      s.videoHeight || s.naturalHeight || s.displayHeight || s.height || 0,
    ];
  };

  const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...args: any[]) => any>;
  const wrap = (name: string, before: (own: State, args: any[]) => void) => {
    const original = proto[name];
    proto[name] = function (this: WebGL2RenderingContext, ...args: any[]) {
      const result = original.apply(this, args);
      before(state(this), args);
      return result;
    };
  };

  wrap('activeTexture', (own, [unit]) => (own.unit = unit - gl.TEXTURE0));
  wrap('bindTexture', (own, [target, texture]) => own.textures.set(`${own.unit}:${target}`, texture));
  wrap('bindBuffer', (own, [target, buffer]) => own.buffers.set(target, buffer));
  wrap('bindBufferBase', (own, [target, , buffer]) => own.buffers.set(target, buffer));
  wrap('bindBufferRange', (own, [target, , buffer]) => own.buffers.set(target, buffer));
  wrap('bindRenderbuffer', (own, [, renderbuffer]) => (own.renderbuffer = renderbuffer));

  wrap('texImage2D', (own, args) => {
    const [target, level, internalformat] = args;
    let width, height, type;
    if (args.length === 6) {
      [width, height] = sourceSize(args[5]);
      type = args[4];
    } else {
      [width, height, , , type] = args.slice(3);
    }
    const bytes = width * height * texelBytes(own, internalformat, type);
    set(
      own,
      bound(own, target),
      'texture',
      `${target}:${level}`,
      bytes,
      `texImage2D ${width}x${height} 0x${internalformat.toString(16)}`,
    );
  });
  wrap('texImage3D', (own, [target, level, internalformat, width, height, depth, , , type]) =>
    set(
      own,
      bound(own, target),
      'texture',
      `${target}:${level}`,
      width * height * depth * texelBytes(own, internalformat, type),
      `texImage3D ${width}x${height}x${depth} 0x${internalformat.toString(16)}`,
    ),
  );
  wrap('compressedTexImage2D', (own, [target, level, , , , , data, offset, length]) => {
    const bytes =
      typeof data === 'number' ? data : length || data.byteLength - (offset ?? 0) * (data.BYTES_PER_ELEMENT ?? 1);
    set(own, bound(own, target), 'texture', `${target}:${level}`, bytes);
  });
  wrap('copyTexImage2D', (own, [target, level, internalformat, , , width, height]) =>
    set(own, bound(own, target), 'texture', `${target}:${level}`, width * height * texelBytes(own, internalformat)),
  );
  wrap('texStorage2D', (own, [target, levels, internalformat, width, height]) => {
    const faces = target === gl.TEXTURE_CUBE_MAP ? 6 : 1;
    const note = `texStorage2D ${faces}x${width}x${height} ${levels} levels 0x${internalformat.toString(16)}`;
    for (let level = 0; level < levels; level++) {
      const w = Math.max(1, width >> level);
      const h = Math.max(1, height >> level);
      set(
        own,
        bound(own, target),
        'texture',
        `storage:${level}`,
        faces * w * h * texelBytes(own, internalformat),
        note,
      );
    }
  });
  wrap('texStorage3D', (own, [target, levels, internalformat, width, height, depth]) => {
    for (let level = 0; level < levels; level++) {
      const w = Math.max(1, width >> level);
      const h = Math.max(1, height >> level);
      const d = target === gl.TEXTURE_3D ? Math.max(1, depth >> level) : depth;
      const note = `texStorage3D ${width}x${height}x${depth} ${levels} levels 0x${internalformat.toString(16)}`;
      set(own, bound(own, target), 'texture', `storage:${level}`, w * h * d * texelBytes(own, internalformat), note);
    }
  });
  wrap('generateMipmap', (own, [target]) => {
    const texture = bound(own, target);
    const entry = texture && own.entries.get(texture);
    if (!entry) return;
    // The chain below each face's level 0 adds about a third of it.
    for (const [key, bytes] of [...entry.bytes]) {
      if (key.endsWith(':0') && !key.startsWith('storage')) entry.bytes.set(`${key}:mips`, Math.round(bytes / 3));
    }
  });
  wrap('bufferData', (own, [target, data, , srcOffset, length]) => {
    const element = data?.BYTES_PER_ELEMENT ?? 1;
    const bytes =
      typeof data === 'number'
        ? data
        : length
          ? length * element
          : (data?.byteLength ?? 0) - (srcOffset ?? 0) * element;
    set(own, own.buffers.get(target) ?? null, 'buffer', 'data', bytes);
  });
  wrap('renderbufferStorage', (own, [, internalformat, width, height]) =>
    set(
      own,
      own.renderbuffer,
      'renderbuffer',
      'storage',
      width * height * texelBytes(own, internalformat),
      `${width}x${height} 0x${internalformat.toString(16)}`,
    ),
  );
  wrap('renderbufferStorageMultisample', (own, [, samples, internalformat, width, height]) =>
    set(
      own,
      own.renderbuffer,
      'renderbuffer',
      'storage',
      Math.max(1, samples) * width * height * texelBytes(own, internalformat),
      `${samples} samples ${width}x${height} 0x${internalformat.toString(16)}`,
    ),
  );
  for (const name of ['deleteTexture', 'deleteBuffer', 'deleteRenderbuffer']) {
    wrap(name, (own, [object]) => object && own.entries.delete(object));
  }

  const report = () =>
    states.map((own) => {
      const bytes = { texture: 0, buffer: 0, renderbuffer: 0 };
      const objects = { texture: 0, buffer: 0, renderbuffer: 0 };
      const sizes: { kind: Entry['kind']; bytes: number; allocations: string[] }[] = [];
      for (const entry of own.entries.values()) {
        objects[entry.kind]++;
        let size = 0;
        for (const value of entry.bytes.values()) size += value;
        bytes[entry.kind] += size;
        sizes.push({ kind: entry.kind, bytes: size, allocations: [...new Set(entry.notes.values())] });
      }
      const canvas = own.context.canvas as HTMLCanvasElement;
      const lost = own.lost || own.context.isContextLost();
      const attributes = own.context.getContextAttributes();
      const pixels = lost || !attributes ? 0 : own.context.drawingBufferWidth * own.context.drawingBufferHeight;
      const sample = 4 + (attributes?.depth || attributes?.stencil ? 4 : 0);
      return {
        id: own.id,
        connected: canvas.isConnected === true,
        lost,
        bytes,
        objects,
        drawingBufferBytes: pixels * (attributes?.antialias ? 4 * sample + 4 : sample),
        unknownFormats: [...own.unknown],
        largest: sizes.sort((a, b) => b.bytes - a.bytes).slice(0, 20),
      };
    });
  Object.assign(window, { suiGpuMemory: report });
}

export const gpuMemory = (page: Page) =>
  page.evaluate(() => (window as unknown as { suiGpuMemory: () => GpuMemoryContext[] }).suiGpuMemory());

export const totalBytes = (context: GpuMemoryContext) =>
  context.lost
    ? 0
    : context.bytes.texture + context.bytes.buffer + context.bytes.renderbuffer + context.drawingBufferBytes;
