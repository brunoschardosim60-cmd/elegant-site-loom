import { describe, expect, it } from 'vitest';
import { readPreBarcode, preBarcodeRegions } from '@/lib/pre-barcode';
import type { OcrPage } from '@/lib/photo-fields';

// Code 128 fixtures produced independently with ReportLab, including its checksum.
const patterns = {
  luft: 'AcAaCaCaAaAaAaCcAaCaAaCaAcCaAaAaAcCaCaAaAaAcCaCaAaAaAcCaCaAaAaAcCaCaAaAaAcCaCaAaAaAcCaCaAaAaAcCaCaAaAaAcCaCaAaAaAcCaCaAaAaAcCaCaAaCaAcAaAaCaAcAaCaCaA',
  pre: 'BaAbAdAaBcAcBcAcAaAbCaBbAaCaDaBaBbBbBaBbBbBaBbBbBaBbBbBbBaBbCaBaAcBcCaAaB',
  fiscal: 'BaAbCbAcAcBaCbAbBaBbAcAbBaCcAaAbBaCbAcCaBaDaAcAaBaBbBbAaCbBbAaAbBdCaBaAcBaBbBbBbAcAbBaBbBbAdAbBaAaBbCbAcAcBaAbCbBaAdAaBbBcBaBaAaAcBcAbAcBbAdAaBbBcCaAaB',
};
function fixture(pattern: string) {
  const widths = [...pattern].map(c => c.toLowerCase().charCodeAt(0) - 96);
  const width = widths.reduce((a,b)=>a+b,0)*3+80, height=180;
  const pixels = new Uint8Array(width*height).fill(255);
  let x=40;
  [...pattern].forEach((c,i)=>{const w=widths[i]!*3;if(c===c.toUpperCase())for(let y=50;y<110;y++)pixels.fill(0,y*width+x,y*width+x+w);x+=w;});
  const page:OcrPage={text:'PRÉ-MANIFESTO DI00000000001',blocks:[{paragraphs:[{lines:[{words:[
    {text:'DI00000000001',confidence:50,bbox:{x0:40,x1:width-40,y0:120,y1:145}},
  ]}]}]}]};
  return {gray:{pixels,width,height},page};
}
describe('Local pré barcode recovery',()=>{
  it('decodes the Code 39 format printed on Luft pré-manifestos',()=>{
    const {gray,page}=fixture(patterns.luft);
    expect(readPreBarcode(gray,page)).toBe('DI00000000001');
  });
  it('decodes the checksum-protected ID and preserves leading zeroes',()=>{
    const {gray,page}=fixture(patterns.pre);
    expect(readPreBarcode(gray,page)).toBe('DI00000000001');
  });
  it('never turns a CT-e fiscal access key into an internal CTC or pré',()=>{
    const {gray,page}=fixture(patterns.fiscal);
    expect(readPreBarcode(gray,page)).toBeUndefined();
  });
  it('does not scan arbitrary background sheets without a page ID or heading',()=>{
    const {gray}=fixture(patterns.pre);
    expect(readPreBarcode(gray,{text:'DACTE'})).toBeUndefined();
    expect(preBarcodeRegions({text:'unknown'},gray.width,gray.height)).toEqual([]);
  });
  it('honours cancellation before decoding',()=>{
    const {gray,page}=fixture(patterns.pre),controller=new AbortController();controller.abort();
    expect(()=>readPreBarcode(gray,page,controller.signal)).toThrow();
  });
});
