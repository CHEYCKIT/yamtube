import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RequestPolicy, redirectHeaders, scopedCredentialHeaders } from '../src/main/requestPolicy'
import { youtubeCookieHeader, parseNetscapeCookies, parseYoutubeCookies } from '../src/main/youtubeCookies'
import { inspectAccountResponse } from '../src/main/youtubeIdentity'
import { browserCandidates, browserFromExecutable, registryBrowserExecutables } from '../src/main/browserDiscovery'
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
    'https://www.youtube.com/youtubei/v1/feedback',
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

test('English controls cover search filters, music and collection UI; Spanish stays selectable', async () => {
  const {translateFor}=await import('../src/shared/locale')
  assert.equal(translateFor('en','Fecha de subida'),'Upload date')
  assert.equal(translateFor('en','Guardar en Music'),'Save to Music')
  assert.equal(translateFor('en','Esta colección está vacía.'),'This collection is empty.')
  assert.equal(translateFor('en','Resultados para “{query}”',{query:'music'}),'Results for “music”')
  assert.equal(translateFor('es','Play'),'Reproducir')
  assert.equal(translateFor('es','Upload date'),'Fecha de subida')
})

test('Windows native and DOM side-button events navigate once while repeated clicks work', async () => {
  const {MouseHistoryNavigation}=await import('../src/renderer/src/tabs/mouseNavigation')
  const events:string[]=[]
  let now=0
  const navigation=new MouseHistoryNavigation(direction=>events.push(direction),()=>now)
  navigation.handle('back','native')
  now+=5
  navigation.handle('back','mouse')
  now+=40
  navigation.handle('back','native')
  now+=5
  navigation.handle('back','mouse')
  navigation.handle('forward','mouse')
  now+=5
  navigation.handle('forward','native')
  now+=200
  navigation.handle('forward','native')
  assert.deepEqual(events,['back','back','forward','forward'])
})

test('diagnostic logs redact cookies, authorization, tokens and signed media URLs', async () => {
  const {redactDiagnostics}=await import('../src/main/diagnosticLog')
  const message=`Request failed: Cookie: SID=cookie-secret; SAPISID=sapisid-secret\nAuthorization: Bearer bearer-secret\n{"poToken":"potoken-secret","visitorData":"visitor-secret"}\nhttps://rr1.googlevideo.com/videoplayback?pot=query-secret&sig=signed-secret\nhttps://www.youtube.com/api/manifest/hls_playlist/sig/path-secret/playlist.m3u8`
  const redacted=redactDiagnostics(message)
  for(const secret of ['cookie-secret','sapisid-secret','bearer-secret','potoken-secret','visitor-secret','query-secret','signed-secret','path-secret']) assert.equal(redacted.includes(secret),false,secret)
  assert.equal(redacted.includes('Request failed'),true)
  assert.equal(redacted.includes('https://rr1.googlevideo.com/videoplayback'),true)
})

test('JSON cookie exports from any browser are scoped, validated and support sessions', () => {
  const row = {domain:'.youtube.com',path:'/',name:'SAPISID',value:'synthetic',expirationDate:9999999999}
  assert.equal(parseYoutubeCookies(JSON.stringify([row,{...row,domain:'.google.com',name:'SID',value:'excluded'}])), 'SAPISID=synthetic')
  assert.equal(parseYoutubeCookies(JSON.stringify({cookies:[{...row,session:true,expirationDate:-1}]})), 'SAPISID=synthetic')
  assert.equal(parseYoutubeCookies('\uFEFF# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSAPISID\tsynthetic'), 'SAPISID=synthetic')
  for (const change of [{expirationDate:1},{expirationDate:'forever'},{expirationDate:-1},{value:'secret\r\nCookie: bad'},{domain:'youtube.com.evil.test'},{path:'/private'},{value:''}]) {
    assert.throws(()=>parseYoutubeCookies(JSON.stringify([{...row,...change}])), /No signed-in YouTube/)
  }
  assert.throws(()=>parseYoutubeCookies('{invalid'), /Invalid cookie JSON/)
  assert.throws(()=>parseYoutubeCookies('{}'), /Expected a Cookie-Editor/)
})

const accountItem = (name: string, extra = {}) => ({accountItem:{accountName:{simpleText:name},channelHandle:{simpleText:`@${name}`},...extra}})
test('account verification accepts a sole account without a selected flag across response layouts', () => {
  for (const response of [
    {actions:[{accountSectionListRenderer:{contents:[accountItem('one')]}}]},
    {contents:[accountItem('one',{isSelected:false})]},
    {contents:[{accountItemRenderer:{accountName:{runs:[{text:'one'}]},channelHandle:{content:'@one'}}}]}
  ]) assert.equal(inspectAccountResponse(response).identity?.name,'one')
})

test('account verification resolves the active identity and refuses ambiguous or guest accounts', () => {
  assert.equal(inspectAccountResponse({contents:[accountItem('one'),accountItem('two')]}).identity,null)
  assert.equal(inspectAccountResponse({contents:[accountItem('one'),accountItem('two',{isSelected:true})]}).identity?.name,'two')
  assert.equal(inspectAccountResponse({contents:[accountItem('disabled',{isDisabled:true}),accountItem('two')]}).identity?.name,'two')
  const response={actions:[{multiPageMenuRenderer:{header:{activeAccountHeaderRenderer:{
    accountName:{runs:[{text:'Active account'}]},channelHandle:{simpleText:'@active'},accountByline:{simpleText:'user@example.test'},
    accountPhoto:{thumbnails:[{url:'https://example.test/photo.png'}]}
  }}}}]}
  const result=inspectAccountResponse(response)
  assert.equal(result.identity?.name,'Active account')
  assert.equal(result.identity?.avatarUrl,'https://example.test/photo.png')
  assert.equal(result.headers,1)
  for(const data of [{},{contents:[{accountItem:{accountName:{simpleText:'N/A'}}}]},{contents:[accountItem('disabled',{isDisabled:true})]},
    {logged_in:true,name:'Unverified'}, {contents:[accountItem('Guest',{isGuest:true})]},
    {contents:[accountItem('Sign in',{serviceEndpoint:{signInEndpoint:{}}})]},
    {contents:[accountItem('one',{isSelected:true}),accountItem('two',{isSelected:true})]}]) {
    assert.equal(inspectAccountResponse(data).identity,null)
  }
})

test('Windows browser discovery finds standard and per-user Zen installations and registry commands', () => {
  const paths=browserCandidates('win32',{PROGRAMFILES:'C:\\Program Files',LOCALAPPDATA:'C:\\Users\\Example\\AppData\\Local'},'C:\\Users\\Example').map(browser=>browser.executable)
  assert.ok(paths.includes('C:\\Program Files\\Zen Browser\\zen.exe'))
  assert.ok(paths.includes('C:\\Users\\Example\\AppData\\Local\\Programs\\Zen Browser\\zen.exe'))
  assert.ok(paths.includes('C:\\Program Files\\Mozilla Firefox\\firefox.exe'))
  const registry='    (Default)    REG_SZ    "D:\\Portable Zen\\zen.exe" -osint -url "%1"\n    (Default) REG_SZ C:\\Program Files\\Mozilla Firefox\\firefox.exe -url "%1"\n    (Default) REG_EXPAND_SZ "%LOCALAPPDATA%\\Zen Browser\\zen.exe"\n    (Default) REG_SZ "C:\\Chrome\\chrome.exe" "%1"'
  assert.deepEqual(registryBrowserExecutables(registry),['D:\\Portable Zen\\zen.exe','C:\\Program Files\\Mozilla Firefox\\firefox.exe','%LOCALAPPDATA%\\Zen Browser\\zen.exe'])
  assert.equal(browserFromExecutable('C:\\Program Files\\Zen Browser\\ZEN.EXE','win32')?.name,'Zen')
  assert.equal(browserFromExecutable('C:\\Zen\\zen.exe','win32')?.id,browserFromExecutable('c:\\zen\\ZEN.EXE','win32')?.id)
  assert.equal(browserFromExecutable('/opt/chrome/chrome','linux'),null)
  const duplicates=browserCandidates('win32',{},'', ['C:\\Zen\\zen.exe','c:\\zen\\ZEN.EXE']).filter(browser=>browser.executable.toLowerCase()==='c:\\zen\\zen.exe')
  assert.equal(duplicates.length,1)
})

test('browser discovery includes macOS apps and Linux PATH installs', () => {
  assert.ok(browserCandidates('darwin',{},'/Users/example').some(browser=>browser.executable==='/Applications/Zen.app/Contents/MacOS/zen'))
  assert.ok(browserCandidates('linux',{PATH:'/opt/bin'},'/home/example').some(browser=>browser.executable==='/opt/bin/zen'))
})

test('coalesced SABR segments return matching bytes and delivery metadata', async () => {
  const {SabrResponseProcessor}=await import('../src/renderer/src/player/sabr/responseProcessor')
  const {mediaSegment,sabrMetadata}=await import('./fixtures/sabr')
  const {concatenateChunks}=await import('googlevideo/utils')
  const metadata=sabrMetadata()
  const processor=new SabrResponseProcessor(metadata)
  const result=await processor.processChunk(concatenateChunks([mediaSegment(1,0),mediaSegment(2,5000),mediaSegment(3,10000)]))
  assert.deepEqual(result?.data,new Uint8Array([1,1,1]))
  const header=metadata.streamInfo?.mediaHeader
  assert.equal(header?.sequenceNumber,1)
  assert.equal(header?.startMs,'0')
  processor.assertComplete()
})

test('SABR framing is independent of every possible HTTP split, including varints', async () => {
  const {SabrResponseProcessor}=await import('../src/renderer/src/player/sabr/responseProcessor')
  const {mediaSegment,sabrMetadata}=await import('./fixtures/sabr')
  const {concatenateChunks}=await import('googlevideo/utils')
  const payload=new Uint8Array(300).fill(42)
  const bytes=concatenateChunks([mediaSegment(1,0,payload),mediaSegment(2,5000)])
  for(let split=0;split<=bytes.length;split++) {
    const metadata=sabrMetadata()
    const processor=new SabrResponseProcessor(metadata)
    const first=await processor.processChunk(bytes.subarray(0,split))
    const result=first ?? await processor.processChunk(bytes.subarray(split))
    assert.deepEqual(result?.data,payload,`split ${split}`)
    assert.equal(metadata.streamInfo?.mediaHeader?.sequenceNumber,1,`split ${split}`)
    processor.assertComplete()
  }
  const metadata=sabrMetadata()
  const processor=new SabrResponseProcessor(metadata)
  let result
  for(const byte of bytes){result=await processor.processChunk(new Uint8Array([byte]));if(result)break}
  assert.deepEqual(result?.data,payload)
  assert.equal(metadata.streamInfo?.mediaHeader?.sequenceNumber,1)
})

test('repeated forward and backward SABR requests never claim the following segment was buffered', async () => {
  const {SabrResponseProcessor}=await import('../src/renderer/src/player/sabr/responseProcessor')
  const {mediaSegment,sabrMetadata}=await import('./fixtures/sabr')
  const {concatenateChunks}=await import('googlevideo/utils')
  for(const sequence of [1,2,3,4,5,3,2,1,4,5,6]) {
    const metadata=sabrMetadata()
    const result=await new SabrResponseProcessor(metadata).processChunk(concatenateChunks([
      mediaSegment(sequence,(sequence-1)*5000),mediaSegment(sequence+1,sequence*5000)
    ]))
    assert.equal(result?.data?.[0],sequence)
    assert.equal(metadata.streamInfo?.mediaHeader?.sequenceNumber,sequence)
    assert.equal(metadata.streamInfo?.mediaHeader?.startMs,String((sequence-1)*5000))
  }
})

test('truncated SABR media and split headers fail instead of succeeding with empty data', async () => {
  const {SabrResponseProcessor}=await import('../src/renderer/src/player/sabr/responseProcessor')
  const {mediaSegment,sabrMetadata}=await import('./fixtures/sabr')
  const bytes=mediaSegment(1,0,new Uint8Array(300))
  for(const cut of [1,2,bytes.length-4,bytes.length-1]) {
    const processor=new SabrResponseProcessor(sabrMetadata())
    assert.equal(await processor.processChunk(bytes.subarray(0,cut)),undefined)
    assert.throws(()=>processor.assertComplete(),/before its media segment completed/)
  }
})

test('SABR control-only responses and mixed track payloads retain their protocol behavior', async () => {
  const {SabrResponseProcessor}=await import('../src/renderer/src/player/sabr/responseProcessor')
  const {mediaSegment,sabrMetadata,umpPart}=await import('./fixtures/sabr')
  const {concatenateChunks}=await import('googlevideo/utils')
  const {SabrRedirect,UMPPartId}=await import('googlevideo/protos')
  const metadata=sabrMetadata()
  const processor=new SabrResponseProcessor(metadata)
  assert.equal(await processor.processChunk(umpPart(UMPPartId.SABR_REDIRECT,SabrRedirect.encode({url:'https://example.test/videoplayback'}).finish())),undefined)
  processor.assertComplete()
  assert.equal(metadata.streamInfo?.redirect?.url,'https://example.test/videoplayback')
  const mixed=sabrMetadata()
  const result=await new SabrResponseProcessor(mixed).processChunk(concatenateChunks([mediaSegment(1,0,new Uint8Array([99]),140),mediaSegment(1,0)]))
  assert.deepEqual(result?.data,new Uint8Array([1,1,1]))
  assert.equal(mixed.streamInfo?.mediaHeader?.itag,137)
})

test('history preserves mixed renderer order instead of pinning Shorts or grouping video types', async () => {
  const {parseYoutubeHistoryFeed}=await import('../src/main/youtubeHistoryFeed')
  const regular=(id:string,title:string)=>({videoRenderer:{videoId:id,title:{simpleText:title},ownerText:{runs:[{text:'Creator'}]},thumbnail:{thumbnails:[]}}})
  const short={shortsLockupViewModel:{onTap:{innertubeCommand:{reelWatchEndpoint:{videoId:'short000001'}}},overlayMetadata:{primaryText:{content:'Short'}}}}
  const lockup={lockupViewModel:{contentId:'video000002',contentType:'LOCKUP_CONTENT_TYPE_VIDEO',metadata:{lockupMetadataViewModel:{title:{content:'Older video'}}}}}
  const data={contents:{sectionListRenderer:{contents:[{itemSectionRenderer:{contents:[regular('video000001','Recent video'),{reelShelfRenderer:{items:[short]}},lockup,regular('video000003','Oldest video')]}}]}}}
  assert.deepEqual(parseYoutubeHistoryFeed(data).items.map(item=>item.video.videoId),['video000001','short000001','video000002','video000003'])
})

test('history recognizes only removal feedback actions, across legacy and Shorts menus', async () => {
  const {parseYoutubeHistoryFeed}=await import('../src/main/youtubeHistoryFeed')
  const menu={menuRenderer:{items:[{menuServiceItemRenderer:{text:{simpleText:'Not interested'},serviceEndpoint:{feedbackEndpoint:{feedbackToken:'wrong-action'}}}}],topLevelButtons:[{buttonRenderer:{icon:{iconType:'CLOSE'},serviceEndpoint:{feedbackEndpoint:{feedbackToken:'remove-video'}}}}]}}
  const command={innertubeCommand:{feedbackEndpoint:{feedbackToken:'remove-short'}}}
  const item={title:{content:'Remove from watch history'},rendererContext:{commandContext:{onTap:command}}}
  const listViewModel={listItems:[{listItemViewModel:item}]}
  const sheetViewModel={content:{listViewModel}}
  const sheet={innertubeCommand:{showSheetCommand:{panelLoadingStrategy:{inlineContent:{sheetViewModel}}}}}
  const result=parseYoutubeHistoryFeed({contents:[
    {videoRenderer:{videoId:'video000001',title:{simpleText:'Video'},menu}},
    {shortsLockupViewModel:{onTap:{reelWatchEndpoint:{videoId:'short000001'}},overlayMetadata:{primaryText:{content:'Short'}},menuOnTap:sheet}},
    {videoRenderer:{videoId:'video000002',title:{simpleText:'No action'},menu:{menuRenderer:{items:menu.menuRenderer.items}}}}
  ]})
  assert.deepEqual(result.items.map(item=>item.feedbackToken),['remove-video','remove-short',null])
})

test('history continuation follows the feed, not a Shorts shelf carousel, and ignores sidebars', async () => {
  const {parseYoutubeHistoryFeed}=await import('../src/main/youtubeHistoryFeed')
  const video={videoRenderer:{videoId:'video000001',title:{simpleText:'Feed video'}}}
  const continuation=(token:string)=>({continuationItemRenderer:{continuationEndpoint:{continuationCommand:{token}}}})
  const result=parseYoutubeHistoryFeed({contents:{sectionListRenderer:{contents:[video,{reelShelfRenderer:{items:[continuation('carousel')]}},continuation('next-feed')]}},sidebar:{videoRenderer:{videoId:'video000002',title:{simpleText:'Sidebar'}}}})
  assert.equal(result.continuation,'next-feed')
  assert.equal(result.items.length,1)
  const next=parseYoutubeHistoryFeed({onResponseReceivedActions:[{appendContinuationItemsAction:{continuationItems:[video,continuation('next-page')]}}]})
  assert.equal(next.items[0].video.title,'Feed video')
  assert.equal(next.continuation,'next-page')
})

test('history deletion suppresses late playback writes and a new explicit watch can be recorded', async () => {
  const context=tracker()
  const token=context.tracking.register(context.source)
  await context.tracking.progress({token,position:2,ended:false})
  const removal=await context.tracking.suspendForHistoryRemoval(context.source.entry.videoId,'one')
  const count=context.events.length
  context.advance()
  await context.tracking.progress({token,position:40,ended:true})
  assert.equal(context.events.length,count)
  removal.commit()
  await context.tracking.progress({token,position:45,ended:true})
  assert.equal(context.events.length,count)
  const fresh=context.tracking.register(context.source)
  await context.tracking.progress({token:fresh,position:1,ended:false})
  assert.equal(context.events.filter(item=>item==='remote-add').length,2)
})

test('failed history deletion resumes tracking and waits for in-flight writes before removal', async () => {
  const context=tracker()
  let finish!:()=>void
  let started!:()=>void
  const entered=new Promise<void>(resolve=>{started=resolve})
  const token=context.tracking.register({...context.source,remote:async()=>({addToWatchHistory:async()=>{started();await new Promise<void>(resolve=>{finish=resolve})},updateWatchTime:async()=>{context.events.push('updated')}})})
  const progress=context.tracking.progress({token,position:1,ended:false})
  await entered
  let drained=false
  const pending=context.tracking.suspendForHistoryRemoval(context.source.entry.videoId,'one').then(result=>{drained=true;return result})
  await Promise.resolve()
  assert.equal(drained,false)
  finish()
  await progress
  const removal=await pending
  assert.equal(context.events.includes('updated'),false)
  removal.rollback()
  context.advance()
  await context.tracking.progress({token,position:31,ended:false})
  assert.equal(context.events.includes('updated'),true)
})
