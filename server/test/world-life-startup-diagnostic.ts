/** Read-only prepared-world startup measurement. Does not generate assets or change runtime limits.
 * Run from the repository root: node server/test/world-life-startup-diagnostic.ts
 * Temporary SQLite is isolated. Instrumentation changes this process only and is restored on exit.
 */
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, loadavg, freemem, totalmem } from 'node:os';
import { resolve, join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { startApplication } from '../src/app/application.ts';
import { parseConfig } from '../src/app/config.ts';
import { createGame } from '../src/game/index.ts';
import { silentLogger } from '../src/common/logger.ts';
import type { CreateGame } from '../src/contracts.ts';
import { startTrusted } from './tls-helpers.ts';

const directory = await mkdtemp(join(tmpdir(),'world-life-startup-'));
const config = { ...parseConfig({ host:'127.0.0.1',clientDir:resolve('client/dist'),worldDir:resolve('client/public'),contentDir:resolve('server/content'),dbPath:join(directory,'game.sqlite'),defaultMap:'market' },join(directory,'config.json')),port:0 };
const originalRead = fs.promises.readFile;
const originalParse = JSON.parse;
const startedAt = performance.now();
let stage = 'application-before-game';
let stageAt = startedAt;
let stageCpu = process.cpuUsage();
let inFlight = 0;
const stages: Record<string,unknown>[] = [];
const reads = new Map<string,{calls:number;bytes:number;sumMs:number;maxMs:number;maxInFlight:number}>();
let jsonCalls = 0, jsonMs = 0;
const environment = { node:process.version,loadAverage:loadavg(),freeBytes:freemem(),totalBytes:totalmem(),rssBytes:process.memoryUsage().rss };
const loop = monitorEventLoopDelay({resolution:20});loop.enable();
function mark(next:string):void {
  const at = performance.now(); const cpu = process.cpuUsage(stageCpu);
  const entry = {stage,wallMs:at-stageAt,cpuMs:(cpu.user+cpu.system)/1000,rssBytes:process.memoryUsage().rss,freeBytes:freemem()};
  stages.push(entry);console.log(JSON.stringify({startupStage:entry}));
  stage=next;stageAt=at;stageCpu=process.cpuUsage();
}
fs.promises.readFile = (async (...args:Parameters<typeof originalRead>) => {
  const path = String(args[0]);
  if(path.endsWith('/maps/market/manifest.json')) mark('map-market');
  else if(path.endsWith('/maps/demo/manifest.json')) mark('map-demo');
  else if(path.endsWith('/maps/demo/science.json')) mark('map-science');
  else if(path.endsWith('/content/npcs.json')) mark('npc-read');
  const bucket = stage;
  const stats = reads.get(bucket) ?? {calls:0,bytes:0,sumMs:0,maxMs:0,maxInFlight:0};reads.set(bucket,stats);
  const began = performance.now();stats.calls++;inFlight++;stats.maxInFlight=Math.max(stats.maxInFlight,inFlight);
  try {
    const value = await Reflect.apply(originalRead,fs.promises,args) as Buffer|string;
    stats.bytes += typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength;
    return value;
  } finally {
    inFlight--;const ms=performance.now()-began;stats.sumMs+=ms;stats.maxMs=Math.max(stats.maxMs,ms);
    if(path.endsWith('/content/npcs.json')) mark('scene-and-game-compose');
  }
}) as typeof originalRead;
syncBuiltinESMExports();
JSON.parse = ((text:string,reviver?:Parameters<typeof originalParse>[1]) => {
  const at=performance.now();jsonCalls++;
  try{return originalParse(text,reviver);}finally{jsonMs+=performance.now()-at;}
}) as typeof originalParse;
const measuredGame:CreateGame=async(settings,deps)=>{
  mark('world-directory-check');
  const game=await createGame(settings,deps);
  mark('http-attach-and-listen');
  return game;
};
let app:Awaited<ReturnType<typeof startApplication>>|undefined;
try {
  app=await startTrusted(startApplication, config,measuredGame,silentLogger);
  mark('ready');loop.disable();
  console.log(JSON.stringify({startupDiagnostic:{startupMs:performance.now()-startedAt,environment,after:{loadAverage:loadavg(),freeBytes:freemem(),rssBytes:process.memoryUsage().rss},stages,fileReads:Object.fromEntries(reads),json:{calls:jsonCalls,wallMs:jsonMs},eventLoopDelay:{maxMs:loop.max/1e6,meanMs:loop.mean/1e6},targetHardware:'unverified: shared Linux container'}}));
} catch(error) {
  mark('failed');console.log(JSON.stringify({startupDiagnostic:{failed:true,error:error instanceof Error?error.message:String(error),stages,fileReads:Object.fromEntries(reads)}}));throw error;
} finally {
  loop.disable();JSON.parse=originalParse;fs.promises.readFile=originalRead;syncBuiltinESMExports();
  await app?.stop('startup-diagnostic');await rm(directory,{recursive:true,force:true});
}
