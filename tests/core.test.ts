import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RequestPolicy, redirectHeaders, scopedCredentialHeaders } from '../src/main/requestPolicy'
import { youtubeCookieHeader, parseNetscapeCookies } from '../src/main/youtubeCookies'
import { PlaybackHistory } from '../src/main/playbackHistory'

const policy = new RequestPolicy(['easylist', 'easyprivacy'].map((name) => readFileSync(`resources/filters/${name}.txt`, 'utf8')).join('\n'))

test('bundled production filters block advertising and tracking domains', () => {
  for (const url of [
    'https://googleads.g.doubleclick.net/pagead/id',
    'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
    'https://www.google-analytics.com/collect?v=1',
    'https://www.youtube.com/api/stats/ads?ver=2',
    'https://www.youtube.com/pagead/adview?ai=test'
  ]) assert.equal(policy.blocks(url), true, url)
})

test('media, captions, account auth, attestation and explicit history sync survive filtering', () => {
  for (const url of [
    'https://rr1---sn-test.googlevideo.com/videoplayback?id=test',
    'https://rr1---sn-test.googlevideo.com/videoplayback?alr=yes',
    'https://www.youtube.com/api/timedtext?v=jNQXAC9IVRw',
    'https://www.youtube.com/youtubei/v1/account/accounts_list',
    'https://www.youtube.com/youtubei/v1/browse',
    'https://www.youtube.com/youtubei/v1/att/get',
    'https://www.youtube.com/api/jnn/v1/GenerateIT',
    'https://www.youtube.com/api/stats/playback?cpn=test',
    'https://www.youtube.com/api/stats/watchtime?st=30'
  ]) assert.equal(policy.blocks(url), false, url)
})

test('history exception does not allow lookalike domains or arbitrary stats', () => {
  const strict = new RequestPolicy('||youtube.com^\n||example.test^')
  assert.equal(strict.blocks('https://www.youtube.com/api/stats/playback'), false)
  assert.equal(strict.blocks('https://www.youtube.com/api/stats/watchtime'), false)
  assert.equal(strict.blocks('https://www.youtube.com/api/stats/ads'), true)
  assert.equal(strict.blocks('https://example.test/api/stats/playback'), true)
  assert.equal(strict.blocks('http://www.youtube.com/api/stats/playback'), true)
})

test('redirects cannot forward YouTube cookies or authorization to another origin', () => {
  const headers = new Headers({cookie:'secret',authorization:'secret','x-goog-authuser':'0','x-goog-pageid':'secret',accept:'*/*'})
  const stripped = redirectHeaders(headers, new URL('https://www.youtube.com/'), new URL('https://evil.test/'))
  assert.deepEqual([...stripped.keys()], ['accept'])
  assert.equal(redirectHeaders(headers, new URL('https://www.youtube.com/a'), new URL('https://www.youtube.com/b')).get('cookie'), 'secret')
})

test('absolute URLs from upstream responses cannot receive account credentials', () => {
  const headers = new Headers({cookie:'secret',authorization:'secret',accept:'*/*'})
  for (const url of ['https://evil.test/youtubei/v1/browse', 'https://www.youtube.com.evil.test/youtubei/v1/browse',
    'http://www.youtube.com/youtubei/v1/browse', 'https://rr1.googlevideo.com/videoplayback', 'https://www.youtube.com/pagead/adview']) {
    const scoped=scopedCredentialHeaders(headers,new URL(url))
    assert.equal(scoped.has('cookie'),false,url)
    assert.equal(scoped.has('authorization'),false,url)
  }
  assert.equal(scopedCredentialHeaders(headers,new URL('https://www.youtube.com/api/stats/watchtime')).get('cookie'),'secret')
  assert.equal(scopedCredentialHeaders(headers,new URL('https://www.youtube.com/youtubei/v1/browse')).get('cookie'),'secret')
})

const cookie = (extra = {}) => ({host:'.youtube.com', name:'SAPISID', value:'synthetic-secret', path:'/', expiry:9999999999, ...extra})

test('cookie imports scope secrets to YouTube and drop expired cookies', () => {
  const header = youtubeCookieHeader([cookie(), cookie({host:'.google.com',name:'SID',value:'never-import'}),
    cookie({host:'youtube.com.evil.test',name:'BAD'}), cookie({name:'EXPIRED',expiry:1}), cookie({name:'PATH',path:'/private'})])
  assert.equal(header, 'SAPISID=synthetic-secret')
  assert.throws(()=>youtubeCookieHeader([cookie({expiry:1})]), /No signed-in YouTube/)
})

test('Netscape imports support HttpOnly cookies and reject raw header/JSON files', () => {
  assert.equal(parseNetscapeCookies('# Netscape HTTP Cookie File\n#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t9999999999\tSAPISID\tsynthetic'), 'SAPISID=synthetic')
  assert.equal(parseNetscapeCookies('.youtube.com\tTRUE\t/\tTRUE\t0\t__Secure-3PAPISID\tsynthetic'), '__Secure-3PAPISID=synthetic; SAPISID=synthetic')
  assert.throws(()=>parseNetscapeCookies('SAPISID=secret'), /No signed-in YouTube/)
  assert.throws(()=>parseNetscapeCookies('x'.repeat(2*1024*1024+1)), /too large/)
  assert.throws(()=>youtubeCookieHeader([cookie({value:'secret\r\nCookie: injected'})]), /No signed-in YouTube/)
})

function tracker() {
  let now = 100_000
  let revision = 1
  let profile = 'one'
  const events: unknown[] = []
  const tracking = new PlaybackHistory({currentRevision:()=>revision,currentProfile:async()=>profile,
    recordLocal:async(entry)=>{events.push(['local',entry.videoId])},syncFailed:(failed)=>events.push(['syncFailed',failed]),now:()=>now})
  const source = {entry:{videoId:'jNQXAC9IVRw',title:'Test',channelId:null,channelName:'Test',thumbnailUrl:null},revision:1,profileId:'one',
    remote:async()=>({addToWatchHistory:async()=>{events.push('remote-add')},updateWatchTime:async(position:number)=>{events.push(['remote-time',position])}})}
  return {tracking,events,source,advance:()=>{now+=30_000},switchAccount:()=>{revision++},switchProfile:()=>{profile='two'}}
}

test('fetching/registering metadata never creates a watch', () => {
  const {tracking,events,source} = tracker()
  tracking.register(source)
  assert.deepEqual(events,[])
})

test('concurrent playback events add history once and throttle progress, including a final update', async () => {
  const {tracking,events,source,advance} = tracker()
  const token=tracking.register(source)
  await Promise.all([tracking.progress({token,position:1,ended:false}),tracking.progress({token,position:2,ended:false})])
  assert.equal(events.filter(x=>x==='remote-add').length,1)
  assert.equal(events.filter(x=>Array.isArray(x)&&x[0]==='local').length,1)
  assert.equal(events.filter(x=>Array.isArray(x)&&x[0]==='remote-time').length,1)
  advance()
  await tracking.progress({token,position:32,ended:false})
  await tracking.progress({token,position:35,ended:true})
  assert.deepEqual(events.filter(x=>Array.isArray(x)&&x[0]==='remote-time'),[['remote-time',1],['remote-time',32],['remote-time',35]])
})

test('stale tabs cannot write watches into a changed account or library', async () => {
  for (const change of ['switchAccount','switchProfile'] as const) {
    const context=tracker()
    const token=context.tracking.register(context.source)
    context[change]()
    await context.tracking.progress({token,position:20,ended:false})
    assert.deepEqual(context.events,[])
  }
})

test('account switches during remote metadata loading stop the pending watch', async () => {
  const context=tracker()
  let finish!: (value:Awaited<ReturnType<typeof context.source.remote>>)=>void
  const token=context.tracking.register({...context.source,remote:()=>new Promise(resolve=>{finish=resolve})})
  const pending=context.tracking.progress({token,position:20,ended:false})
  // Yield microtasks until the remote request is pending.
  for(let i=0;i<10&&!finish;i++) await Promise.resolve()
  context.switchAccount()
  finish(await context.source.remote())
  await pending
  assert.equal(context.events.includes('remote-add'),false)
})

test('failed history sync preserves local history and retries on later playback', async () => {
  const context=tracker()
  let attempts=0
  const token=context.tracking.register({...context.source,remote:async()=>{
    if(attempts++===0) throw new Error('offline')
    return context.source.remote()
  }})
  await context.tracking.progress({token,position:1,ended:false})
  assert.deepEqual(context.events,[['local','jNQXAC9IVRw'],['syncFailed',true]])
  context.advance()
  await context.tracking.progress({token,position:31,ended:false})
  assert.equal(context.events.includes('remote-add'),true)
  assert.deepEqual(context.events.at(-1),['syncFailed',false])
})

test('guest watches remain local and invalid progress cannot produce history', async () => {
  const context=tracker()
  const token=context.tracking.register({...context.source,remote:null})
  await assert.rejects(context.tracking.progress({token,position:NaN,ended:false}), /Invalid playback/)
  await context.tracking.progress({token,position:2,ended:false})
  assert.deepEqual(context.events,[['local','jNQXAC9IVRw']])
})
