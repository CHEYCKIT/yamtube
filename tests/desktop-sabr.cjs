const assert=require('node:assert/strict')
const {readFile}=require('node:fs/promises')
const {join,resolve}=require('node:path')
const {pathToFileURL}=require('node:url')

module.exports=async({app,page})=>{
  const {build}=require('esbuild')
  const helper=resolve('.cache/tests/sabr-fixtures.mjs')
  await build({entryPoints:['tests/fixtures/sabr.ts'],outfile:helper,bundle:true,platform:'node',format:'esm',packages:'external'})
  const {umpPart}=await import(pathToFileURL(helper).href)
  const sidxHelper=resolve('.cache/tests/mp4-sidx.mjs')
  await build({entryPoints:['src/renderer/src/player/sabr/mp4Sidx.ts'],outfile:sidxHelper,bundle:true,platform:'node',format:'esm'})
  const {parseMp4Sidx}=await import(pathToFileURL(sidxHelper).href)
  const {MediaHeader,UMPPartId,VideoPlaybackAbrRequest}=await import('googlevideo/protos')
  const tracks=[]
  for(const [kind,itag] of [['video',137],['audio',140]]) {
    const file=await readFile(join(__dirname,`fixtures/sabr-${kind}.mp4`))
    let indexStart=0,indexSize=0
    for(let offset=0;offset<file.length;offset+=file.readUInt32BE(offset)) {
      const size=file.readUInt32BE(offset)
      assert.ok(size>0)
      if(file.toString('ascii',offset+4,offset+8)==='sidx'){indexStart=offset;indexSize=size;break}
    }
    assert.ok(indexStart>0)
    const sidx=file.subarray(indexStart,indexStart+indexSize)
    const refs=parseMp4Sidx(sidx.buffer.slice(sidx.byteOffset,sidx.byteOffset+sidx.byteLength),indexStart)
    assert.ok(refs.length>=6)
    const avc=file.indexOf(Buffer.from('avcC'))
    const codec=kind==='video'?`avc1.${file.toString('hex',avc+5,avc+8)}`:'mp4a.40.2'
    tracks.push({kind,itag,file,refs,init:file.subarray(0,indexStart+indexSize),format:{itag,lastModified:'1',mimeType:`${kind}/mp4; codecs="${codec}"`,bitrate:kind==='video'?60000:32000,
      initRange:{start:0,end:indexStart-1},indexRange:{start:indexStart,end:indexStart+indexSize-1},
      ...(kind==='video'?{width:160,height:90,frameRate:10}:{audioSampleRate:48000,audioChannels:1,isOriginal:true,isDefault:true,language:'en'})}})
  }
  const delivered=[]
  let truncated=0,empty=0
  const packet=(track,sequence,isInit)=>{
    const ref=track.refs[sequence-1]
    const data=isInit?track.init:track.file.subarray(ref.startByte,ref.endByte+1)
    const header=MediaHeader.encode({headerId:1,itag:track.itag,sequenceNumber:isInit?0:sequence,isInitSeg:isInit,
      startMs:isInit?'0':String(Math.round(ref.startSeconds*1000)),durationMs:isInit?'0':String(Math.round((ref.endSeconds-ref.startSeconds)*1000)),contentLength:String(data.length),formatId:{itag:track.itag,lastModified:'1'}}).finish()
    return Buffer.concat([umpPart(UMPPartId.MEDIA_HEADER,header),umpPart(UMPPartId.MEDIA,Buffer.concat([Buffer.from([1]),data])),umpPart(UMPPartId.MEDIA_END,new Uint8Array([1]))])
  }
  await page.route('https://sabr-fixture.googlevideo.com/**',async route=>{
    const request=VideoPlaybackAbrRequest.decode(route.request().postDataBuffer())
    const track=tracks.find(item=>item.kind===(request.clientAbrState.enabledTrackTypesBitfield===2?'video':'audio'))
    const isInit=!request.selectedFormatIds.some(format=>format.itag===track.itag)
    const time=Number(request.clientAbrState.playerTimeMs)/1000
    let index=track.refs.findIndex(ref=>time>=ref.startSeconds-0.001 && time<ref.endSeconds-0.001)
    if(index<0) index=track.refs.length-1
    const claimed=request.bufferedRanges.find(range=>range.formatId.itag===track.itag)
    // A real server skips segments the client says it already buffered. The
    // former coalesced-chunk bug falsely claimed the following segment here.
    if(claimed?.endSegmentIndex===index+1) index++
    index=Math.min(index,track.refs.length-1)
    const parts=isInit?[packet(track,0,true)]:[packet(track,index+1,false),...(index+1<track.refs.length?[packet(track,index+2,false)]:[])]
    delivered.push({kind:track.kind,isInit,requested:time,index,claimed:claimed?.endSegmentIndex})
    let body=Buffer.concat(parts)
    if(!isInit && track.kind==='video' && index===1 && !truncated) { truncated++;body=parts[0].subarray(0,-1) }
    if(!isInit && track.kind==='audio' && index===2 && !empty) { empty++;body=Buffer.alloc(0) }
    await route.fulfill({status:200,headers:{'content-type':'application/vnd.yt-ump','access-control-allow-origin':'*'},body})
  })
  const payload={manifest:{durationSeconds:30,formats:tracks.map(track=>track.format)},stream:{abrUrl:'https://sabr-fixture.googlevideo.com/videoplayback',poToken:'AA==',ustreamerConfigB64:'AA==',clientInfo:{clientNameId:1,clientVersion:'1',osName:'fixture',osVersion:'1'}}}
  await app.evaluate(({ipcMain},sabr)=>{
    ipcMain.removeHandler('youtube:get-video-info')
    ipcMain.handle('youtube:get-video-info',(_event,{videoId})=>({ok:true,data:{playbackToken:'',videoId,title:'SABR continuity fixture',channelId:null,channelName:'Fixture',channelThumbnailUrl:null,subscriberCountText:null,captions:[],storyboardVtt:null,relatedVideos:[],thumbnailUrl:null,lengthSeconds:30,durationText:'0:30',viewCountText:null,likeCountText:null,publishedText:null,category:null,description:null,dashManifest:null,liveManifests:null,sabr}}))
  },payload)
  await page.evaluate(()=>{location.hash='/watch/sabrVideo01'})
  try {
    await page.waitForFunction(()=>{const video=document.querySelector('.wt-watch-player-slot video');return video?.readyState>=2 && video.duration>=29},{},{timeout:15000})
    await page.waitForFunction(()=>{const video=document.querySelector('.wt-watch-player-slot video');return video?.buffered.length && video.buffered.end(video.buffered.length-1)>=14},{},{timeout:15000})
    await page.evaluate(()=>{const video=document.querySelector('.wt-watch-player-slot video');video.pause();video.currentTime=11})
    await page.waitForFunction(()=>{const video=document.querySelector('.wt-watch-player-slot video');return video.buffered.length && video.buffered.end(video.buffered.length-1)>=24},{},{timeout:15000})
    const ranges=await page.evaluate(()=>{const video=document.querySelector('.wt-watch-player-slot video');return Array.from({length:video.buffered.length},(_,i)=>[video.buffered.start(i),video.buffered.end(i)])})
    assert.equal(ranges.length,1,`coalesced responses must not leave missing five-second ranges: ${JSON.stringify(ranges)}`)
    assert.ok(ranges[0][0]<0.1 && ranges[0][1]>=24)
    assert.equal(truncated,1)
    assert.equal(empty,1)
    assert.ok(delivered.filter(item=>!item.isInit&&item.kind==='video'&&item.index===1).length>=2,'truncated media must be requested again')
    assert.ok(delivered.filter(item=>!item.isInit&&item.kind==='audio'&&item.index===2).length>=2,'empty media must be requested again')
    for(const boundary of [5,10,15,20]) {
      await page.evaluate(async time=>{const video=document.querySelector('.wt-watch-player-slot video');video.currentTime=time-0.2;await video.play()},boundary)
      await page.waitForFunction(time=>document.querySelector('.wt-watch-player-slot video').currentTime>time+0.1,boundary)
      const after=await page.evaluate(()=>{const video=document.querySelector('.wt-watch-player-slot video');video.pause();return video.currentTime})
      assert.ok(after<boundary+1,`must play through ${boundary}s rather than jumping ahead: ${after}`)
      await page.keyboard.press('ArrowLeft')
      const rewound=await page.evaluate(()=>{const video=document.querySelector('.wt-watch-player-slot video');video.pause();return video.currentTime})
      assert.ok(rewound<after-4.5 && rewound>after-5.5,`left arrow must rewind past ${boundary}s: ${rewound}`)
    }
    await page.screenshot({path:'.cache/loktube-sabr-continuity.png'})
    console.log('PASS: real SABR/UMP playback retries truncated/empty responses, buffers across repeated five-second boundaries and rewinds through them')
  } catch(error) {
    console.error('SABR fixture delivery trace:',JSON.stringify(delivered))
    throw error
  } finally {
    await page.locator('a[href="#/"]:visible').first().click()
    await page.getByRole('button',{name:'Close player',exact:true}).click()
    await page.unroute('https://sabr-fixture.googlevideo.com/**')
  }
}
