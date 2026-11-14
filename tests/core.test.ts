import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RequestPolicy, redirectHeaders, scopedCredentialHeaders } from '../src/main/requestPolicy'
import { youtubeCookieHeader, parseNetscapeCookies, parseYoutubeCookies } from '../src/main/youtubeCookies'
import { parseYoutubeWebContext, extractYoutubePageContext, isGuestYoutubeHome } from '../src/main/youtubeSessionContext'
import { inspectAccountResponse } from '../src/main/youtubeIdentity'
import { browserCandidates, browserFromExecutable, registryBrowserExecutables } from '../src/main/browserDiscovery'
import { PlaybackHistory } from '../src/main/playbackHistory'
import { mapRecommendedShorts, interleaveShorts, selectDiverseShorts, shortsTopicQuery } from '../src/main/shortsRecommendations'
import { mapMusicPlaylistTracks } from '../src/main/musicPlaylistItems'
import { ratingFromInfo } from '../src/main/videoRatingState'
import { youtubeUrlToAppRoute, loktubeProtocolToRoute } from '../src/main/externalYoutubeLinks'
import { decodeTabSession, encodeTabSession, TAB_SESSION_KEY } from '../src/renderer/src/tabs/tabSession'
import { dropIndexAt } from '../src/renderer/src/tabs/pointerReorder'
import { removeHomeNewsShelves, isNewsShelfHeading, isNewsBroadcaster, excludeHomeNewsBroadcasters } from '../src/main/homeNewsFilter'
import { assertPlayableVideo, getPlayableResponse } from '../src/main/playbackAvailability'

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


test('a valid streaming player response continues without triggering a fallback', async () => {
  let fallbackCalls = 0
  const accepted = {playability_status:{status:'OK'},streaming_data:{adaptive_formats:[{itag:251}]}}
  const result = await getPlayableResponse(async()=>accepted,async()=>{fallbackCalls++;return accepted})
  assert.equal(result.fromAccount,false)
  assert.equal(fallbackCalls,0)
})

test('anonymous LOGIN_REQUIRED is recovered using the connected account once', async () => {
  const calls: string[] = []
  const result = await getPlayableResponse(
    async()=>{calls.push('anonymous');return {playability_status:{status:'LOGIN_REQUIRED'}}},
    async()=>{calls.push('signed-in');return {playability_status:{status:'OK'},streaming_data:{adaptive_formats:[]}}})
  assert.deepEqual(calls,['anonymous','signed-in'])
  assert.equal(result.fromAccount,true)
  assert.equal(result.info.playability_status.status,'OK')
})

test('when YouTube rejects both clients, playback fails with an actionable denial and no extra requests', async () => {
  let signedInCalls = 0
  await assert.rejects(
    getPlayableResponse(
      async()=>({playability_status:{status:'LOGIN_REQUIRED'}}),
      async()=>{signedInCalls++;return {playability_status:{status:'LOGIN_REQUIRED'}}}),
    /YouTube declined playback/
  )
  assert.equal(signedInCalls,1)
})

test('LOGIN_REQUIRED never falls through to DASH generation or a generic streaming error', async () => {
  await assert.rejects(getPlayableResponse(async()=>({playability_status:{status:'LOGIN_REQUIRED'}})), /requires a signed-in account/)
  assert.throws(()=>assertPlayableVideo({playability_status:{status:'OK'}},false),/no streaming formats/)
  assert.throws(()=>assertPlayableVideo({playability_status:{status:'UNPLAYABLE'},streaming_data:{}},true),/status: UNPLAYABLE/)
})

test('failed signed-in playback request surfaces YouTube denial and reports no credentials', async () => {
  const reported: unknown[] = []
  await assert.rejects(getPlayableResponse(async()=>({playability_status:{status:'LOGIN_REQUIRED'}}),
    async()=>{throw new Error('simulated network failure')},(error)=>reported.push(error)),/YouTube declined playback/)
  assert.equal(reported.length,1)
})



test('home Shorts mapper accepts ShortsLockupView and ReelItem but rejects ordinary videos', () => {
  const title = { toString: () => 'Short from lockup' }
  const results = mapRecommendedShorts([
    {type:'Video',video_id:'ordinary001',title:'Not a Short'},
    {type:'ShortsLockupView',entity_id:'not-a-video-id',on_tap_endpoint:{payload:{reelWatchEndpoint:{videoId:'abcdefghijk'}}},
      overlay_metadata:{primary_text:title,secondary_text:{toString:()=> '12K views'}},thumbnail:[{url:'https://img.test/short1.jpg'}]},
    {type:'ReelItem',id:'123456789ab',title:{toString:()=> 'Short from reel'},thumbnails:[{url:'https://img.test/reel.jpg'}]},
    {type:'ShortsLockupView',on_tap_endpoint:{payload:{reelWatchEndpoint:{videoId:'abcdefghijk'}}},
      overlay_metadata:{primary_text:title},thumbnail:[]},
    {type:'ReelItem',id:'bad',title:'Invalid identifier',thumbnails:[]}
  ])
  assert.deepEqual(results.map((video)=>video.videoId),['abcdefghijk','123456789ab'])
  assert.equal(results[0].title,'Short from lockup')
  assert.equal(results[0].thumbnailUrl,'https://img.test/short1.jpg')
  assert.equal(results[0].viewCountText,'12K views')
  assert.equal(results[1].title,'Short from reel')
  assert.equal(results[1].thumbnailUrl,'https://img.test/reel.jpg')
})

test('home Shorts mapper skips malformed objects instead of poisoning the home feed', () => {
  assert.deepEqual(mapRecommendedShorts([null,1,{}, {type:'ShortsLockupView',overlay_metadata:{primary_text:'Unlinked'}},
    {type:'ReelItem',id:'00000000000',title:'A short without a thumbnail'}]).map((video)=>video.videoId),['00000000000'])
})

test('Home Shorts search follows subject rather than a recent channel name, and interleaves results', () => {
  assert.equal(shortsTopicQuery('How to restore a classic car in 10 minutes!'), 'how restore classic shorts')
  assert.equal(shortsTopicQuery('shorts'), null)
  const short = (videoId: string, channelId: string) => ({videoId,title:'Video',channelId,channelName:channelId,thumbnailUrl:null,
    durationText:null,viewCountText:null,publishedText:null})
  const batches = [[short('aaaaaaaaaaa','UC1'),short('bbbbbbbbbbb','UC1'),short('ccccccccccc','UC1')],
    [short('ddddddddddd','UC2'),short('eeeeeeeeeee','UC3')],
    [short('fffffffffff','UC2'),short('ggggggggggg','UC4')]]
  const mixed = interleaveShorts(batches)
  assert.deepEqual(mixed.slice(0,5).map(x=>x.videoId),['aaaaaaaaaaa','ddddddddddd','fffffffffff','bbbbbbbbbbb','eeeeeeeeeee'])
  const chosen = selectDiverseShorts(mixed,12,2)
  assert.equal(chosen.filter(x=>x.channelId==='UC1').length,2)
  assert.ok(new Set(chosen.map(x=>x.channelId)).size>=4)
  assert.equal(chosen.length,6)
})

test('Music playlist parser maps typed YouTube Music tracks without treating albums or continuations as songs', () => {
  const tracks = mapMusicPlaylistTracks([
    {item_type:'song',id:'aaaaaaaaaaa',title:'Song A',artists:[{name:'Artist',channel_id:'UCartist'}],thumbnails:[{url:'https://example.test/a.jpg'}]},
    {item_type:'video',id:'bbbbbbbbbbb',title:'Video B',authors:[{name:'Creator'}]},
    {item_type:'album',id:'ccccccccccc',title:'An album'},
    {type:'ContinuationItem',token:'next'},
    {item_type:'song',id:'aaaaaaaaaaa',title:'Duplicate'}
  ])
  assert.deepEqual(tracks.map(x=>x.videoId),['aaaaaaaaaaa','bbbbbbbbbbb'])
  assert.equal(tracks[0].channelName,'Artist')
  assert.equal(tracks[0].channelId,'UCartist')
  assert.equal(tracks[0].thumbnailUrl,'https://example.test/a.jpg')
  assert.equal(tracks[1].channelName,'Creator')
})

test('YouTube user rating state distinguishes likes, dislikes and neutral without inventing counts', () => {
  assert.equal(ratingFromInfo({basic_info:{is_liked:true,is_disliked:false}}),'like')
  assert.equal(ratingFromInfo({basic_info:{is_liked:false,is_disliked:true}}),'dislike')
  assert.equal(ratingFromInfo({basic_info:{is_liked:false,is_disliked:false}}),'none')
  assert.equal(ratingFromInfo({}),'none')
})


test('YouTube sign-in preserves selected Google index, Brand Account and browser region', () => {
  const context = parseYoutubeWebContext({
    loggedIn: true, 'x-goog-authuser': '2', 'x-goog-pageid': 'UCabcdefghijklmnopqrstuv',
    'x-goog-visitor-id': 'Cgtsb2t0dWJlLXRlc3Q=', hl: 'fr-FR', gl: 'FR',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36'
  })
  assert.deepEqual(context, {
    loggedIn: true, accountIndex: 2, pageId: 'UCabcdefghijklmnopqrstuv',
    visitorData: 'Cgtsb2t0dWJlLXRlc3Q=', language: 'fr-FR', region: 'FR',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36'
  })
  assert.deepEqual(parseYoutubeWebContext({ SESSION_INDEX: 0, LOGGED_IN: true, INNERTUBE_CONTEXT: {
    client: { gl: 'GB', hl: 'en', visitorData: 'CgtnYnVua3g=' }
  } }), { loggedIn: true, accountIndex: 0, visitorData: 'CgtnYnVua3g=', language: 'en', region: 'GB' })
})

test('legacy YouTube sign-ins recover account context from authenticated first-party HTML', () => {
  const html = '<script>ytcfg.set({"LOGGED_IN":true,"SESSION_INDEX":"1","DELEGATED_SESSION_ID":"UCabcdefghijk",' +
    '"INNERTUBE_CONTEXT":{"client":{"gl":"FR","hl":"fr","visitorData":"CgthY2NvdW50"}}});</script>'
  assert.deepEqual(extractYoutubePageContext(html), {
    loggedIn: true, accountIndex: 1, pageId: 'UCabcdefghijk', visitorData: 'CgthY2NvdW50',
    language: 'fr', region: 'FR'
  })
  assert.equal(extractYoutubePageContext('<script>ytcfg.set({"LOGGED_IN":false,"SESSION_INDEX":"0"})</script>'), null)
  assert.equal(extractYoutubePageContext('<script>ytcfg.set({"LOGGED_IN":true,"evil":{"x":"}"}});</script>')?.loggedIn, true)
})

test('signed-out YouTube home responses are rejected instead of posing as For you', () => {
  assert.equal(isGuestYoutubeHome({ responseContext: { mainAppWebResponseContext: { loggedOut: true } } }), true)
  assert.equal(isGuestYoutubeHome({ responseContext: { mainAppWebResponseContext: { loggedOut: false } } }), false)
  assert.equal(isGuestYoutubeHome({ responseContext: {} }), false)
  assert.equal(isGuestYoutubeHome(null), false)
  const malicious = parseYoutubeWebContext({ loggedIn: true, 'x-goog-pageid': 'a\r\ncookie: secret', gl: 'US\n' })
  assert.equal(malicious?.pageId, undefined)
  assert.equal(malicious?.region, undefined)
})


test('YouTube editorial news shelves are removed before the HomeFeed videos memo is flattened', () => {
  const video = (id: string) => ({ richItemRenderer: { content: { videoRenderer: { videoId: id } } } })
  const shelf = (title: string, id: string) => ({
    richSectionRenderer: { content: {
      richShelfRenderer: { title: { runs: [{ text: title }] }, contents: [video(id)] }
    } }
  })
  const home = { contents: { twoColumnBrowseResultsRenderer: { tabs: [
    { tabRenderer: { content: { richGridRenderer: { contents: [
      video('organic-one'), shelf('Breaking news', 'fox-news'),
      shelf('Latest news', 'abc-news'), shelf('Top news', 'eight-news'),
      shelf('Live music', 'music-rec'), video('organic-two'),
      shelf('News from around the world', 'global-news'),
      shelf('Recommended live music', 'other-recommendation')
    ] } } } }
  ] } } }
  const original = JSON.stringify(home)
  const { value: filtered, removed } = removeHomeNewsShelves(home)
  const items = filtered.contents.twoColumnBrowseResultsRenderer.tabs[0]
    .tabRenderer.content.richGridRenderer.contents
  assert.equal(removed, 4)
  assert.deepEqual(items.map((item) => JSON.stringify(item).match(/(?:organic-one|music-rec|organic-two|other-recommendation)/)?.[0]),
    ['organic-one', 'music-rec', 'organic-two', 'other-recommendation'])
  assert.equal(JSON.stringify(home), original, 'filtering a Home response must not modify the original payload')
})

test('YouTube news shelves are removed from continuation and localized home sections only', () => {
  const news = (title: string) => ({ itemSectionRenderer: { contents: [
    { shelfRenderer: { title: { simpleText: title }, content: { horizontalListRenderer: { items: [
      { videoRenderer: { videoId: 'fox-abc' } }
    ] } } } }
  ] } })
  const original = { onResponseReceivedActions: [
    { appendContinuationItemsAction: { continuationItems: [
      news('Actualités'), news('Últimas noticias'), news('Nachrichten'), news('Ultime notizie'),
      { richItemRenderer: { content: { videoRenderer: { videoId: 'wanted-video' } } } }
    ] } }
  ] }
  const { value, removed } = removeHomeNewsShelves(original)
  const remaining = value.onResponseReceivedActions[0].appendContinuationItemsAction.continuationItems
  assert.equal(removed, 4)
  assert.equal(remaining.length, 1)
  assert.equal(isNewsShelfHeading('Breaking News'), true)
  assert.equal(isNewsShelfHeading('Top Stories'), true)
  assert.equal(isNewsShelfHeading('Tech news analysis'), false)
  assert.equal(isNewsShelfHeading('News from around the world'), true)
  assert.equal(isNewsShelfHeading('Live music'), false)
})

test('Home hides explicitly identified news broadcasters but keeps unrelated FOX/ABC recommendations', () => {
  for (const name of ['FOX News', 'FOX 5 New York', 'ABC News', 'ABC7', '8 News Now', 'CNN',
    'NBC News', 'Reuters', 'CBS News', 'Sky News', 'News 8 WTNH']) {
    assert.equal(isNewsBroadcaster(name), true, name)
  }
  for (const name of ['FOX Sports', 'Fox Racing', 'ABC Kids', 'ABC Music', 'Newschool', 'BBC Earth',
    'Science Channel', '8-bit Music', 'The Daily Show', '']) {
    assert.equal(isNewsBroadcaster(name), false, name)
  }
  const items = [{ channelName: 'Fox Racing', videoId: 'A' },
    { channelName: 'FOX 5 New York', videoId: 'B' },
    { channelName: '8 News Now', videoId: 'C' },
    { channelName: 'ABC Music', videoId: 'D' }]
  assert.deepEqual(excludeHomeNewsBroadcasters(items).map((item) => item.videoId), ['A', 'D'])
})


test('browser-to-LokTube links resolve YouTube URLs to local internal routes', () => {
  const cases: [string,string][] = [
    ['https://www.youtube.com/watch?v=jNQXAC9IVRw&t=27','/watch/jNQXAC9IVRw'],
    ['https://youtu.be/jNQXAC9IVRw','/watch/jNQXAC9IVRw'],
    ['https://m.youtube.com/shorts/jNQXAC9IVRw','/watch/jNQXAC9IVRw'],
    ['https://www.youtube.com/live/jNQXAC9IVRw','/watch/jNQXAC9IVRw'],
    ['https://music.youtube.com/watch?v=jNQXAC9IVRw','/watch/jNQXAC9IVRw'],
    ['https://www.youtube.com/playlist?list=PLabcDEFghi123','/collection/playlist/PLabcDEFghi123'],
    ['https://www.youtube.com/results?search_query=music%20video','/search?q=music%20video'],
    ['https://www.youtube.com/feed/subscriptions','/subscriptions'],
    ['https://www.youtube.com/feed/history','/history'],
    ['https://youtube.com/','/'],
    ['https://www.youtube.com/@somecreator','/search?q=%40somecreator'],
    ['https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv','/channel/UCabcdefghijklmnopqrstuv']
  ]
  for (const [url,expected] of cases) {
    assert.equal(youtubeUrlToAppRoute(url),expected,url)
    assert.equal(loktubeProtocolToRoute('loktube://open?url='+encodeURIComponent(url)),expected,url)
  }
})

test('external protocol ingress rejects arbitrary websites and unsafe link structures', () => {
  const invalid = [
    'javascript:alert(1)','file:///etc/passwd','https://www.youtube.com.evil.test/watch?v=jNQXAC9IVRw',
    'https://evil.test/watch?v=jNQXAC9IVRw','https://user:pass@www.youtube.com/watch?v=jNQXAC9IVRw',
    'https://www.youtube.com:1337/watch?v=jNQXAC9IVRw','https://www.youtube.com/watch?v=bad',
    'https://www.youtube.com/redirect?q=https%3A%2F%2Fevil.test'
  ]
  for (const url of invalid) assert.equal(youtubeUrlToAppRoute(url),null,url)
  for (const uri of [
    'loktube://evil?url=https%3A%2F%2Fyoutube.com%2F',
    'loktube://open?url=javascript%3Aalert(1)',
    'loktube://open?url=https%3A%2F%2Fwww.youtube.com%2F&url=https%3A%2F%2Fwww.youtube.com%2F',
    'loktube://open?url=https%3A%2F%2Fyoutube.com%2F#fragment',
    'loktube://open?path=%2Faccount',
    'http://www.youtube.com/watch?v=jNQXAC9IVRw'
  ]) assert.equal(loktubeProtocolToRoute(uri),null,uri)
})


test('tab sessions round trip selected tab, order, navigation history, and titles', () => {
  assert.equal(TAB_SESSION_KEY, 'loktube.tabs.v1')
  const original = [
    { id: 'home', entries: ['/','/history'], index: 1, title: '' },
    { id: 'video', entries: ['/','/watch/jNQXAC9IVRw','/search?q=some%20music'], index: 1, title: 'A YouTube video' },
    { id: 'music', entries: ['/music'], index: 0, title: '' }
  ]
  const encoded = encodeTabSession(original, 'video')
  assert.deepEqual(decodeTabSession(encoded), {
    version: 1, tabs: original, activeId: 'video'
  })
  const reordered = [original[2], original[0], original[1]]
  assert.deepEqual(decodeTabSession(encodeTabSession(reordered,'home'))?.tabs.map(t => t.id),
    ['music','home','video'])
  assert.equal(decodeTabSession(encodeTabSession([{id:'new',entries:['/'],index:0,title:''}],'new'))?.tabs.length,1)
})

test('tab sessions ignore malformed data and reject unsafe restored routes', () => {
  for (const raw of [null, '', '{invalid', '{}', '[]','{"version":99,"tabs":[]}', '{"version":1,"tabs":[]}'])
    assert.equal(decodeTabSession(raw),null)
  const data = { version: 1, activeId: 'gone', tabs: [
    { id: 'good', entries: ['/','/search?q=rock','javascript:alert(1)', '//evil.test','/watch/jNQXAC9IVRw'], index: 99, title: 'Good' },
    { id: 'good', entries: ['/other'], index: 0, title:'Duplicate' },
    { id: 'bad', entries: ['https://evil.test'], index: 0, title:'Invalid' },
    { id: 'second', entries: ['/music'], index: -20, title:'Music' }
  ]}
  assert.deepEqual(decodeTabSession(JSON.stringify(data)), {
    version: 1, activeId:'good',
    tabs: [
      { id:'good', entries:['/','/search?q=rock','/watch/jNQXAC9IVRw'], index:2, title:'Good' },
      { id:'second', entries:['/music'], index:0, title:'Music' }
    ]
  })
  assert.equal(decodeTabSession(JSON.stringify({version:1,tabs:[{id:'one',entries:['//evil'],index:0}]})),null)
})

test('saved tab-session history caps entries without losing current navigation', () => {
  const entries=Array.from({length:60},(_,i)=>'/search?q='+i)
  const data=decodeTabSession(encodeTabSession([{id:'one',entries,index:59,title:''}],'one'))
  assert.equal(data?.tabs[0].entries.length,50)
  assert.equal(data?.tabs[0].entries[49],'/search?q=59')
  assert.equal(data?.tabs[0].index,49)
})


test('pointer tab insertion follows neighboring centers without jumping during drag', () => {
  const centers=[100,300,500,700]
  assert.equal(dropIndexAt(500,3,centers),2)
  assert.equal(dropIndexAt(85,3,centers),0)
  assert.equal(dropIndexAt(301,3,centers),2)
  assert.equal(dropIndexAt(550,0,centers),2)
  assert.equal(dropIndexAt(750,0,centers),3)
})
