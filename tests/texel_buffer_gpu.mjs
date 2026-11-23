// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { createServer } from '../scripts/serve.mjs';

assert.ok(process.argv[2], 'Pass the captured shader_control_flow_tests output file');
assert.ok(process.env.CHROME_PATH, 'Set CHROME_PATH to Chrome with SwiftShader support');
const log = await readFile(process.argv[2], 'utf8');
const helper = log.split('TBO_SHADER_BEGIN\n')[1]?.split('\nTBO_SHADER_END')[0];
assert.ok(helper, 'The test output must include the generated WGSL texel-buffer helper');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH, headless: process.env.HEADLESS === '1',
    protocolTimeout: 180_000,
    args: ['--no-sandbox', '--enable-unsafe-webgpu',
      '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--use-angle=swiftshader',
      '--disable-vulkan-surface', '--enable-dawn-features=allow_unsafe_apis'],
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/__texel_test`);
  await page.exposeFunction('reportProgress', text => console.log(text));
  console.log(await page.evaluate(async helper=>{
    const adapter=await navigator.gpu.requestAdapter();const device=await adapter.requestDevice();
    await window.reportProgress('GPU device ready');
    const code=helper+'\n@group(0) @binding(2) var<storage,read_write> output:array<vec4<u32>>;\n@compute @workgroup_size(1) fn main(){output[0]=bitcast<vec4<u32>>(tbo_fetch0(0u)); output[1]=bitcast<vec4<u32>>(tbo_fetch0(1u));}';
    const module=device.createShaderModule({code});
    const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
    if(errors.length)throw Error(errors.map(e=>e.message+' at '+e.lineNum).join('\n')+'\n'+code);
    await window.reportProgress('WGSL compilation passed');
    device.pushErrorScope('validation');
    const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
    await window.reportProgress('Compute pipeline ready');
    const data=device.createBuffer({size:256,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    const info=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const output=device.createBuffer({size:32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
    const read=device.createBuffer({size:32,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[data,info,output].map((buffer,binding)=>({binding,resource:{buffer}}))});
    const cases=[
      {name:'RGBA32 float',bits:32,n:4,kind:0,values:[1.5,-2,3.25,4],expected:[1.5,-2,3.25,4],float:true},
      {name:'RGBA32 uint',bits:32,n:4,kind:1,values:[0,42,0xffffffff,7],expected:[0,42,0xffffffff,7],integer:true},
      {name:'RGBA16 sint',bits:16,n:4,kind:2,values:[-32768,-1,0,32767],expected:[0xffff8000,0xffffffff,0,32767],integer:true},
      {name:'RGBA16 float',bits:16,n:4,kind:0,values:[0x3c00,0x4000,0xbc00,0],expected:[1,2,-1,0]},
      {name:'RGBA8 unorm',bits:8,n:4,kind:3,values:[0,128,255,64],expected:[0,128/255,1,64/255]},
      {name:'RGBA8 snorm',bits:8,n:4,kind:4,values:[-128,-64,0,127],expected:[-1,-64/127,0,1]},
      {name:'R32 float offset',bits:32,n:1,kind:0,values:[2.5],expected:[2.5,0,0,1],float:true,offset:16},
      {name:'R32 uint defaults',bits:32,n:1,kind:1,values:[42],expected:[42,0,0,1],integer:true},
      {name:'empty',bits:32,n:4,kind:0,values:[1,2,3,4],expected:[0,0,0,0],float:true,empty:true},
      {name:'updated backing buffer',bits:32,n:4,kind:0,values:[9,8,7,6],expected:[9,8,7,6],float:true}
    ];
    for(const test of cases){
      await window.reportProgress('Testing '+test.name);
      const bytes=new ArrayBuffer(256),view=new DataView(bytes);const offset=test.offset??0;
      test.values.forEach((value,c)=>{const at=offset+c*test.bits/8;if(test.float)view.setFloat32(at,value,true);else if(test.bits===32)view.setUint32(at,value,true);else if(test.bits===16)view.setUint16(at,value,true);else view.setUint8(at,value);});
      device.queue.writeBuffer(data,0,bytes);device.queue.writeBuffer(info,0,new Uint32Array([offset,test.empty?0:1,test.bits|(test.n<<8)|(test.kind<<16),0]));
      const commands=device.createCommandEncoder();const pass=commands.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();commands.copyBufferToBuffer(output,0,read,0,32);device.queue.submit([commands.finish()]);
      await read.mapAsync(GPUMapMode.READ);const result=read.getMappedRange().slice(0);read.unmap();
      const values=test.integer?new Uint32Array(result):new Float32Array(result);
      test.expected.forEach((want,c)=>{if(!Number.isFinite(values[c])||Math.abs(values[c]-want)>1e-6)throw Error(test.name+': '+values+' expected '+test.expected);});
      if(new Uint32Array(result).slice(4).some(x=>x!==0))throw Error(test.name+' out-of-range fetch was not zero');
    }
    const error=await device.popErrorScope();if(error)throw Error(error.message);device.destroy();
    return `WebGPU SwiftShader texel-buffer GPU tests: ${cases.length} cases passed (formats, offsets, defaults, OOB, empty, updates).`;
  },helper));
} finally {
  await browser?.close();
  server.close();
}
