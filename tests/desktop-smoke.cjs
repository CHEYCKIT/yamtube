const { _electron: electron } = require('playwright')
const assert = require('node:assert/strict')
const { mkdtemp, writeFile, readFile, rm, readdir, mkdir } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { createHash } = require('node:crypto')
const historyFixture = require('./fixtures/history.cjs')

;(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yamtube-smoke-'))
  const cookies = join(directory, 'cookies.txt')
  await writeFile(cookies, '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t9999999999\tSAPISID\tsynthetic-test-only\n.youtube.com\tTRUE\t/\tTRUE\t9999999999\tSID\tsynthetic-test-only\n')
  const stamp=Date.now()
  const user=(id,name)=>({id,name,hasPassword:false,passwordHash:null,passwordSalt:null,passwordIterations:null,createdAt:stamp,updatedAt:stamp})
  const userProfile=(id,userId)=>({id,userId,name:'Fixture',color:'#2563eb',textColor:'#ffffff',avatarDataUrl:null,createdAt:stamp,updatedAt:stamp})
  const entry=(videoId,title,age)=>({videoId,title,channelId:null,channelName:'Fixture',thumbnailUrl:null,watchedAt:stamp-age})
  const accountKey='youtube:'+createHash('sha256').update('@worldtube-fixture').digest('hex')
  const seed={version:1,users:[user('fixture-guest-user','Guest'),user('fixture-account-user','Fixture YouTube account')],profiles:[userProfile('fixture-guest-profile','fixture-guest-user'),userProfile('fixture-account-profile','fixture-account-user')],
    session:{activeUserId:'fixture-guest-user',activeProfileIdByUser:{'fixture-guest-user':'fixture-guest-profile','fixture-account-user':'fixture-account-profile'}},
    histories:{'fixture-guest-profile':[entry('video000001','Guest older video',2000),entry('short000001','Guest recent Short',1000)],'fixture-account-profile':[entry(historyFixture.ids.regular,'Remote history fixture',1000),entry(historyFixture.ids.short,'History Short fixture',2000),entry(historyFixture.ids.lockup,'History lockup fixture',3000)]},
    subscriptions:{},savedPlaylists:{},savedVideos:{},searchHistories:{},settings:{youtubeLibraryOwners:{guest:'fixture-guest-user',[accountKey]:'fixture-account-user'}}}
  await mkdir(join(directory,'worldtube'),{recursive:true})
  await writeFile(join(directory,'worldtube','worldtube-data.json'),JSON.stringify(seed))
  const executablePath=process.env.LOKTUBE_SMOKE_APP || process.env.YAMTUBE_SMOKE_APP || process.env.WORLDTUBE_SMOKE_APP
  const app = await electron.launch({executablePath,args:['--no-sandbox','--disable-gpu',...(!executablePath?['.']:[])], cwd:process.cwd(),
    env:{...process.env, DISPLAY:process.env.DISPLAY || ':99', XDG_CONFIG_HOME:directory}, timeout:30_000})
  const errors=[]
  app.process().stdout.on('data', (data)=>{ if(process.env.SMOKE_VERBOSE) process.stdout.write(data) })
  app.process().stderr.on('data', (data)=>{ if(process.env.SMOKE_VERBOSE) process.stderr.write(data) })
  try {
    const page=await app.firstWindow()
    page.on('pageerror',error=>errors.push(error.message))
    await page.getByRole('link',{name:'YouTube account',exact:true}).waitFor({timeout:20_000})
    assert.equal((await page.evaluate(()=>window.api.getYoutubeAccount())).signedIn,false)
    assert.equal(await page.getByText('Create local user',{exact:true}).count(),0)
    await page.getByRole('link',{name:'YouTube account',exact:true}).click()
    await page.getByRole('heading',{name:'Account & privacy'}).waitFor()
    assert.equal((await page.evaluate(()=>window.api.getProtection())).enabled,true)
    assert.equal(await page.evaluate(async()=>{try{await fetch('https://googleads.g.doubleclick.net/pagead/id');return false}catch{return true}}),true)
    assert.ok((await page.evaluate(()=>window.api.getProtection())).blocked>=1)
    console.log('PASS: desktop boot, guest library, account UI and real request blocking')
    await require('./desktop-window.cjs')({app,page})
    await require('./desktop-history.cjs').guest({page})

    // Synthetic server fixtures exercise the real IPC, cookie parser,
    // InnerTube parser and library selection without a Google credential.
    await app.evaluate(({net,dialog},{cookies,historyPages,historyTokens})=>{
      globalThis.__smokeOriginalFetch=net.fetch
      globalThis.__smokeAuthenticated=false
      globalThis.__historyRemoved=[]
      globalThis.__historyFeedbackFails=false
      globalThis.__historyFeedbackRequests=0
      globalThis.__historyFeedbackAuthenticated=false
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[cookies]})
      net.fetch=async(input,init)=>{
        const request=new Request(input,init)
        const url=new URL(request.url)
        const json=(data)=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}})
        const video={videoRenderer:{videoId:'jNQXAC9IVRw',title:{simpleText:'Remote history fixture'},
          thumbnail:{thumbnails:[{url:'https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg'}]},
          ownerText:{runs:[{text:'Fixture creator'}]},lengthText:{simpleText:'0:19'},viewCountText:{simpleText:'1 view'}}}
        if(url.pathname==='/youtubei/v1/account/accounts_list') {
          globalThis.__smokeAuthenticated=request.headers.get('cookie')?.includes('SAPISID=synthetic-test-only') && request.headers.get('authorization')?.startsWith('SAPISIDHASH ')
          return json({actions:[{accountSectionListRenderer:{contents:[{accountItemSectionRenderer:{contents:[{accountItem:{
            accountName:{simpleText:'Fixture YouTube account'},hasChannel:true,
            channelHandle:{simpleText:'@worldtube-fixture'},accountByline:{simpleText:'fixture@example.test'},
            serviceEndpoint:{selectActiveIdentityEndpoint:{supportedTokens:[]}}}}]}}]}}]})
        }
        if(url.pathname==='/youtubei/v1/feedback') {
          globalThis.__historyFeedbackRequests++
          globalThis.__historyFeedbackAuthenticated=request.headers.get('cookie')?.includes('SAPISID=synthetic-test-only') && request.headers.get('authorization')?.startsWith('SAPISIDHASH ')
          const body=JSON.parse(await request.text())
          const id=historyTokens.find(([,token])=>token===body.feedbackTokens?.[0])?.[0]
          const processed=!!id && !globalThis.__historyFeedbackFails
          if(processed) globalThis.__historyRemoved.push(id)
          return json({feedbackResponses:[{isProcessed:processed}]})
        }
        if(url.pathname==='/youtubei/v1/browse') {
          const body=JSON.parse(await request.text())
          if(body.continuation==='fixture-history-next') return json(historyPages.next)
          if(body.browseId==='FEhistory') {
            const data=structuredClone(historyPages.initial)
            data.contents.sectionListRenderer.contents[0].itemSectionRenderer.contents=data.contents.sectionListRenderer.contents[0].itemSectionRenderer.contents.filter(item=>{
              const serialized=JSON.stringify(item)
              return !globalThis.__historyRemoved.some(id=>serialized.includes(id))
            })
            return json(data)
          }
          const contents=['FEhistory','FEwhat_to_watch'].includes(body.browseId) ? [video,{videoRenderer:{videoId:'invalid0000',thumbnail:{thumbnails:[null]}}}] : body.browseId==='FEchannels' ? [{channelRenderer:{channelId:'UCfixture',title:{simpleText:'Fixture subscription'},thumbnail:{thumbnails:[]}}}] : []
          return json({contents:{sectionListRenderer:{contents:[{itemSectionRenderer:{contents}}]}}})
        }
        if(url.pathname==='/youtubei/v1/subscription/subscribe' || url.pathname==='/youtubei/v1/subscription/unsubscribe') return json({})
        if(url.pathname==='/api/stats/watchtime' || url.pathname==='/api/stats/playback') return new Response(null,{status:204})
        if(url.pathname==='/youtubei/v1/config') return json({})
        if(url.hostname==='easylist.to') return globalThis.__smokeOriginalFetch(input,init)
        return json({})
      }
    }, {cookies,historyPages:{initial:historyFixture.page(),next:historyFixture.page([],true)},historyTokens:Object.values(historyFixture.ids).map(id=>[id,historyFixture.feedback(id)])})
    await Promise.all([
      page.waitForEvent('domcontentloaded',{timeout:15_000}),
      page.getByRole('button',{name:'Import YouTube cookies',exact:true}).click({noWaitAfter:true})
    ])
    await page.getByText('Connected to your YouTube account',{exact:true}).waitFor({timeout:15_000})
    assert.equal((await page.evaluate(()=>window.api.getYoutubeAccount())).name,'Fixture YouTube account')
    assert.equal(await app.evaluate(()=>globalThis.__smokeAuthenticated),true)
    const profile=await page.evaluate(()=>window.api.getSessionState())
    assert.equal(profile.activeUser.name,'Fixture YouTube account')
    const database=await readFile(profile.dataPath,'utf8')
    assert.equal(database.includes('synthetic-test-only'),false)
    const session=await page.evaluate(()=>window.api.getYoutubeAccount())
    if(!session.persistent) assert.equal((await readdir(join(profile.dataPath,'..'))).includes('youtube-session.enc'),false)
    const history=await page.evaluate(()=>window.api.getYoutubeHistory())
    assert.equal(history.videos[0].title,'Remote history fixture')
    assert.equal((await page.evaluate(()=>window.api.listSubscriptions()))[0].channelName,'Fixture subscription')
    assert.equal((await page.evaluate(()=>window.api.getHomeFeed())).ok,true)
    await page.screenshot({path:'.cache/account-connected.png',fullPage:true})
    console.log('PASS: cookie import, authenticated headers, account identity, remote history/subscriptions and secret-free library')
    await require('./desktop-history.cjs').account({app,page,profile})
    await require('./desktop-features.cjs')({app,page,profile})

    // Multi-account cookies need a verified active header, never a guessed
    // first account. A rejected import must leave the prior session intact.
    await app.evaluate(({net})=>{
      globalThis.__smokeAccountFetch=net.fetch
      globalThis.__smokeAccountMode='ambiguous'
      net.fetch=async(input,init)=>{
        const url=new URL(typeof input==='string'?input:input.url)
        const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}})
        if(url.pathname==='/youtubei/v1/account/accounts_list') return json({contents:[
          {accountItem:{accountName:{simpleText:'Wrong first account'}}},
          {accountItem:{accountName:{simpleText:'Other account'}}}
        ]})
        if(url.pathname==='/youtubei/v1/account/account_menu') return json(globalThis.__smokeAccountMode==='active' ? {
          actions:[{multiPageMenuRenderer:{header:{activeAccountHeaderRenderer:{accountName:{simpleText:'Fixture YouTube account'},channelHandle:{simpleText:'@worldtube-fixture'}}}}}]
        } : {})
        return globalThis.__smokeAccountFetch(input,init)
      }
    })
    const failed=await page.evaluate(async()=>{try{await window.api.importYoutubeCookies();return ''}catch(error){return error.message}})
    assert.match(failed,/did not identify an active account/)
    assert.equal((await page.evaluate(()=>window.api.getYoutubeAccount())).name,'Fixture YouTube account')
    assert.equal((await page.evaluate(()=>window.api.getSessionState())).activeProfileId,profile.activeProfileId)
    await app.evaluate(()=>{globalThis.__smokeAccountMode='active'})
    await page.evaluate(()=>window.api.importYoutubeCookies())
    assert.equal((await page.evaluate(()=>window.api.getSessionState())).activeProfileId,profile.activeProfileId)
    await app.evaluate(({net})=>{net.fetch=globalThis.__smokeAccountFetch})
    console.log('PASS: missing selected flag, active-account fallback, ambiguous rejection and existing session preservation')

    // A second account must receive its own local library.
    const firstProfile=profile.activeProfileId
    const jsonCookies=join(directory,'cookies.json')
    await writeFile(jsonCookies,JSON.stringify([{domain:'.youtube.com',path:'/',name:'SAPISID',value:'synthetic-test-only',expirationDate:9999999999}]))
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},jsonCookies)
    await app.evaluate(()=>{
      const original=globalThis.__smokeOriginalFetch
      const { net }=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')
      const fixture=net.fetch
      net.fetch=async(input,init)=>{
        const response=await fixture(input,init)
        const url=new URL(typeof input==='string'?input:input.url)
        if(url.pathname!=='/youtubei/v1/account/accounts_list') return response
        return new Response((await response.text()).replaceAll('@worldtube-fixture','@second-fixture').replaceAll('Fixture YouTube account','Second YouTube account'),{headers:{'content-type':'application/json'}})
      }
    })
    await page.evaluate(()=>window.api.importYoutubeCookies())
    const secondProfile=await page.evaluate(()=>window.api.getSessionState())
    assert.notEqual(secondProfile.activeProfileId,firstProfile)
    const requestsBefore=await app.evaluate(()=>globalThis.__historyFeedbackRequests)
    await assert.rejects(page.evaluate(id=>window.api.removeYoutubeHistoryVideo(id),history.videos[0].historyId),/expired|changed/)
    assert.equal(await app.evaluate(()=>globalThis.__historyFeedbackRequests),requestsBefore,'stale history cannot mutate another account')
    await page.evaluate(()=>window.api.signOutYoutube())
    assert.equal((await page.evaluate(()=>window.api.getYoutubeAccount())).signedIn,false)
    assert.equal((await page.evaluate(()=>window.api.getSessionState())).activeUser.name,'Guest')
    console.log('PASS: JSON import through IPC, account library isolation and sign-out')

    const signInBrowser=process.env.LOKTUBE_SMOKE_BROWSER || process.env.YAMTUBE_SMOKE_BROWSER || process.env.WORLDTUBE_SMOKE_FIREFOX
    const signInBrowserName=process.env.LOKTUBE_SMOKE_BROWSER_NAME || process.env.YAMTUBE_SMOKE_BROWSER_NAME || 'Firefox'
    if(signInBrowser) {
      await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},resolve(signInBrowser))
      await page.reload()
      await page.getByRole('link',{name:'YouTube account',exact:true}).click()
      await page.getByRole('button',{name:'Add portable browser…',exact:true}).click()
      await page.getByRole('button',{name:`Sign in with ${signInBrowserName}`,exact:true}).waitFor()
      const browserId=await page.getByLabel('Sign-in browser',{exact:true}).inputValue()
      assert.ok(browserId)
      await page.reload()
      await page.getByRole('link',{name:'YouTube account',exact:true}).click()
      await page.getByRole('button',{name:`Sign in with ${signInBrowserName}`,exact:true}).waitFor()
      assert.equal(await page.getByLabel('Sign-in browser',{exact:true}).inputValue(),browserId)
      // Sign-in must use the remembered browser, without opening a file picker.
      await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>{throw new Error('Unexpected executable picker during sign-in')}})
      await page.getByRole('button',{name:`Sign in with ${signInBrowserName}`,exact:true}).click()
      await page.getByRole('button',{name:'Cancel sign-in',exact:true}).waitFor()
      const profileDirectory=join(profile.dataPath,'..','browser-signin')
      const launched=await app.evaluate(async(_electron,directory)=>{
        const fs=process.getBuiltinModule('node:fs')
        const path=process.getBuiltinModule('node:path')
        for(let i=0;i<100;i++) {
          try {
            if(fs.readdirSync(directory).some((name)=>fs.existsSync(path.join(directory,name,'cookies.sqlite')))) return true
          } catch {}
          await new Promise(resolve=>setTimeout(resolve,100))
        }
        return false
      },profileDirectory)
      assert.equal(launched,true,`${signInBrowserName} must actually launch and create its cookie database before cancellation`)
      await page.getByRole('button',{name:'Cancel sign-in',exact:true}).click()
      await page.getByRole('button',{name:`Sign in with ${signInBrowserName}`,exact:true}).waitFor({state:'visible'})
      // Finish cancellation before checking temporary-profile cleanup.
      await page.waitForFunction(name=>!document.body.textContent.includes(`Waiting for ${name}`),signInBrowserName)
      assert.deepEqual(await readdir(profileDirectory),[])
      console.log(`PASS: portable browser remembered after reload, real ${signInBrowserName} launch without a picker, cancellation and profile cleanup`)
    }
    await require('./desktop-home.cjs')({app,page})
    assert.deepEqual(errors,[])
    console.log('Desktop smoke tests passed.')
  } finally {
    // Electron's normal close should be attempted first. In CI, an orphaned
    // Chromium child can leave Playwright's close promise unresolved even after
    // all functional tests passed. Bound teardown and terminate its own
    // launched child process rather than hanging the entire workflow.
    let closeTimeout
    const closed=app.close().then(()=>true,(error)=>{console.warn('Electron test teardown:',error.message);return false})
    const timeout=new Promise(resolve=>{
      closeTimeout=setTimeout(()=>resolve(false),8000)
    })
    const gracefullyClosed=await Promise.race([closed,timeout])
    clearTimeout(closeTimeout)
    if(!gracefullyClosed){
      console.warn('Electron smoke teardown timed out; terminating isolated test process')
      app.process()?.kill('SIGKILL')
    }
    await rm(directory,{recursive:true,force:true})
  }
})().catch(error=>{console.error(error);process.exitCode=1})
