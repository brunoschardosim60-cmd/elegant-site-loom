import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPhotosWithFallback, PHOTO_READING_TARGET_MS, PHOTO_READING_BUDGET_MS, type PhotoReadResult } from '@/lib/photo-reader';
import type { readPrePhotos } from '@/lib/photo-ocr';
import { markLocalPhoto } from '@/lib/local-photo';
const mocks = vi.hoisted(() => ({ ai: vi.fn(), local: vi.fn() }));
vi.mock('@/lib/photo-ai', () => ({ readAiPhotos: mocks.ai }));
vi.mock('@/lib/photo-ocr', () => ({ readPrePhotos: mocks.local }));
type OnResult = Parameters<typeof readPrePhotos>[1];
type OnProgress = NonNullable<Parameters<typeof readPrePhotos>[2]>;
type Success = Exclude<PhotoReadResult, { error: string }>;
const files = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'].map(name => new File(['synthetic'], name, { type: 'image/jpeg' }));
function reading(index: number, local = false): Success {
  const ctc = String(index + 1).padStart(10, '0');
  const pre: Success['pre'] = { kind: 'pre', id: `DI${String(index + 1).padStart(10, '0')}`, issueDate: '2026-08-28', plate: 'ABC1D23', driver: 'MOTORISTA', ctcs: [ctc],
    readingSource: 'gemini', aiReader: 'lite', expectedRows: 1, totalVolumes: 3, headerReview: [], documents: [{ ctc, nf: `${100 + index}-1`, volumes: '3', client: 'LAB TESTE', recipient: 'CLIENTE TESTE', review: [] }] };
  return { text: 'synthetic', milliseconds: 20, pre: local ? markLocalPhoto(pre) : pre };
}
beforeEach(() => { mocks.ai.mockReset(); mocks.local.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('AI first, bounded local fallback', () => {
  it('does not start a cancelled import', async () => {
    const stop=new AbortController();stop.abort();const result=vi.fn();await readPhotosWithFallback(files,result,undefined,stop.signal);
    expect(mocks.ai).not.toHaveBeenCalled();expect(mocks.local).not.toHaveBeenCalled();expect(result).not.toHaveBeenCalled();
  });
  it('returns one AI result without running local OCR or an orientation worker', async () => {
    mocks.ai.mockImplementation(async(_files:File[],result:OnResult)=>result(0,reading(0)));
    const result=vi.fn();await readPhotosWithFallback([files[0]!],result);
    expect(mocks.ai.mock.calls[0]![4]).toEqual({singlePass:false,selective:true,quotaFallback:true,preferredModel:'lite',orientations:[0],onProvisional:expect.any(Function)});
    expect(mocks.local).not.toHaveBeenCalled();expect(result).toHaveBeenCalledExactlyOnceWith(0,expect.objectContaining({pendingVerification:false,pre:expect.objectContaining({readingSource:'gemini'})}));
  });
  it('limits concurrent photos to two and preserves file indices when results arrive out of order', async () => {
    const calls:{file:File,result:OnResult}[]=[],result=vi.fn();
    mocks.ai.mockImplementation((list:File[],send:OnResult)=>{calls.push({file:list[0]!,result:send});return new Promise(()=>{});});
    const run=readPhotosWithFallback(files,result);await waitFor(()=>expect(calls).toHaveLength(2));
    calls[1]!.result(0,reading(1));await waitFor(()=>expect(calls).toHaveLength(3));expect(calls[2]!.file).toBe(files[2]);
    calls[0]!.result(0,reading(0));await waitFor(()=>expect(calls).toHaveLength(4));
    calls[3]!.result(0,reading(3));calls[2]!.result(0,reading(2));await run;
    expect(result.mock.calls.map(([index])=>index)).toEqual([1,0,3,2]);expect(mocks.local).not.toHaveBeenCalled();
  });
  it('uses local OCR only for the failed photo and leaves the successful AI data intact', async () => {
    mocks.ai.mockImplementation(async(list:File[],send:OnResult)=>send(0,list[0]===files[0]?{error:'Cota diária esgotada.'}:reading(1)));
    mocks.local.mockImplementation(async(_files:File[],send:OnResult)=>send(0,reading(0,true)));
    const result=vi.fn();await readPhotosWithFallback(files.slice(0,2),result,undefined,undefined,true);
    expect(mocks.local).toHaveBeenCalledOnce();expect(mocks.local.mock.calls[0]![0]).toEqual([files[0]]);expect(mocks.local.mock.calls[0]![4]).toBe(true);
    const fallback=result.mock.calls.find(([i])=>i===0)![1];expect(fallback.pre).toMatchObject({readingSource:'local',readingFallback:true});expect(fallback.pre.headerReview).toContain('Gemini: Cota diária esgotada.');
    expect(result.mock.calls.find(([i])=>i===1)![1].pre.readingSource).toBe('gemini');
  });
  it.each(['callback','exception'])('does not hide authentication failure (%s) behind local reading', async mode=>{
    mocks.ai.mockImplementation(async(_files:File[],send:OnResult)=>{if(mode==='exception')throw new Error('Entre na sua conta para ler fotos.');send(0,{error:'Sua equipe não está autorizada.',fallback:false});});
    const result=vi.fn();await readPhotosWithFallback([files[0]!],result);expect(result.mock.calls[0]![1].fallback).toBe(false);expect(mocks.local).not.toHaveBeenCalled();
  });
  it('falls back when the AI cannot identify a document', async()=>{
    const unknown=reading(0);unknown.pre.kind='unknown';unknown.pre.documents=[];
    mocks.ai.mockImplementation(async(_files:File[],send:OnResult)=>send(0,unknown));mocks.local.mockImplementation(async(_files:File[],send:OnResult)=>send(0,reading(0,true)));
    const result=vi.fn();await readPhotosWithFallback([files[0]!],result);expect(result.mock.calls[0]![1].pre.readingFallback).toBe(true);
  });
  it('starts fallback only after the technical AI deadline and ignores a late response', async()=>{
    vi.useFakeTimers();let late!:OnResult;mocks.ai.mockImplementation((_files:File[],send:OnResult)=>{late=send;return new Promise(()=>{});});
    mocks.local.mockImplementation(async(_files:File[],send:OnResult)=>send(0,reading(0,true)));
    const result=vi.fn(),run=readPhotosWithFallback([files[0]!],result);
    await vi.advanceTimersByTimeAsync(26999);expect(mocks.local).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);await run;
    expect(result.mock.calls[0]![1].milliseconds).toBe(27000);late(0,reading(0));expect(result).toHaveBeenCalledOnce();
  });
  it('settles at the technical deadline even when both readers ignore cancellation, without accepting late callbacks', async()=>{
    vi.useFakeTimers();let late!:OnResult;let progress!:OnProgress;
    mocks.ai.mockImplementation(()=>new Promise(()=>{}));mocks.local.mockImplementation((_files:File[],send:OnResult,update:OnProgress)=>{late=send;progress=update;return new Promise(()=>{});});
    const result=vi.fn(),update=vi.fn(),run=readPhotosWithFallback([files[0]!],result,update);
    await vi.advanceTimersByTimeAsync(PHOTO_READING_BUDGET_MS);await run;
    expect(result).toHaveBeenCalledExactlyOnceWith(0,expect.objectContaining({error:expect.stringContaining('tempo de segurança')}));
    const before=update.mock.calls.length;late(0,reading(0,true));progress(0,'tarde');expect(result).toHaveBeenCalledOnce();expect(update).toHaveBeenCalledTimes(before);
  });
  it('warns at fifteen seconds but accepts a difficult photo that the AI finishes later without running local OCR', async()=>{
    vi.useFakeTimers();let finish!:OnResult;let aiSignal!:AbortSignal;
    mocks.ai.mockImplementation((_files:File[],send:OnResult,_progress:OnProgress,signal:AbortSignal)=>{finish=send;aiSignal=signal;return new Promise(()=>{});});
    const result=vi.fn(),progress=vi.fn(),run=readPhotosWithFallback([files[0]!],result,progress);
    await vi.advanceTimersByTimeAsync(PHOTO_READING_TARGET_MS);
    expect(aiSignal.aborted).toBe(false);expect(result).not.toHaveBeenCalled();expect(mocks.local).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledWith(0,expect.stringContaining('Continuamos lendo'));
    await vi.advanceTimersByTimeAsync(1000);finish(0,reading(0));await run;
    expect(result.mock.calls[0]![1].milliseconds).toBe(16000);expect(mocks.local).not.toHaveBeenCalled();
    const count=progress.mock.calls.length;await vi.advanceTimersByTimeAsync(PHOTO_READING_BUDGET_MS);expect(progress).toHaveBeenCalledTimes(count);expect(result).toHaveBeenCalledOnce();
  });
  it('allows local recovery beyond the progress target when AI quota fails immediately', async()=>{
    vi.useFakeTimers();let finish!:OnResult;mocks.ai.mockImplementation(async(_files:File[],send:OnResult)=>send(0,{error:'Sem cota'}));
    mocks.local.mockImplementation((_files:File[],send:OnResult)=>{finish=send;return new Promise(()=>{});});
    const result=vi.fn(),run=readPhotosWithFallback([files[0]!],result);
    await vi.advanceTimersByTimeAsync(20000);expect(result).not.toHaveBeenCalled();finish(0,reading(0,true));await run;
    expect(result.mock.calls[0]![1]).toMatchObject({milliseconds:20000,pre:{readingSource:'local',readingFallback:true}});
  });
  it.each(['ai','local'])('stops promptly during %s and does not start queued photos', async phase=>{
    let late!:OnResult;const stop=new AbortController();
    mocks.ai.mockImplementation((_files:File[],send:OnResult)=>{if(phase==='local'){send(0,{error:'Sem cota'});return Promise.resolve();}late=send;return new Promise(()=>{});});
    mocks.local.mockImplementation((_files:File[],send:OnResult)=>{late=send;return new Promise(()=>{});});
    const result=vi.fn(),run=readPhotosWithFallback([files[0]!],result,undefined,stop.signal);
    await waitFor(()=>expect(phase==='local'?mocks.local:mocks.ai).toHaveBeenCalledOnce());stop.abort();await run;late(0,reading(0));expect(result).not.toHaveBeenCalled();
  });
  it('sanitizes credential strings in both failure messages',async()=>{
    const secret=`AQ.${'x'.repeat(40)}`;mocks.ai.mockImplementation(async(_files:File[],send:OnResult)=>send(0,{error:`Falhou ${secret}; access_token=private-ai-token`}));
    mocks.local.mockImplementation(async(_files:File[],send:OnResult)=>send(0,{error:'Falha local Bearer private-local-token'}));
    const result=vi.fn();await readPhotosWithFallback([files[0]!],result);const message=result.mock.calls[0]![1].error;
    expect(message).toContain('Falha local');for(const value of [secret,'private-ai-token','private-local-token'])expect(message).not.toContain(value);
  });
});
